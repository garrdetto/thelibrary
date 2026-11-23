/**
 * Roadside detail for the county, as a pure function of the layout (no terrain), so trees, physics and drawing all agree:
 * - delineator posts every `POST_EVERY` metres on both sides of highways and roads;
 * - speed limit signs for each direction every `SIGN_EVERY` metres (55 highway, 45 road, 25 street) and at Millbrook's edge;
 * - chevron signs on the outside of highway bends;
 * - farmsteads (house, barn, mailbox, a parked pickup) set back along the county roads every `HOME_EVERY` metres, alternating
 *   sides, where nothing else stands;
 * - round hay bales in rows across the wheat fields;
 * - cars parked along Millbrook's streets.
 * Everything keeps clear of sites, lots, fields (except bales), other roads and junctions. `homeRects` lets tree placement keep
 * out of the farmsteads.
 */
import { FIELDS, LOTS, ROADS, SITES, SITE_BY_ID, lotExtent, MAX_LAND_STRIPS } from './WorldLayout'
import type { Road } from './WorldLayout'

export const POST_EVERY = 50
export const SIGN_EVERY = 700
export const HOME_EVERY = 420
const HOME_SETBACK = 34
const HOME_HALF_W = 26
const HOME_HALF_D = 22
const SPEED: Record<Road['kind'], number> = { highway: 55, road: 45, street: 25, gravel: 35 }

export interface Spot {
  x: number
  z: number
  /** Facing (rad): signs face oncoming traffic, houses face the road. */
  yaw: number
}

export interface Farmstead extends Spot {
  siding: string
  /** Mailbox at the road and pickup by the house, in world coordinates. */
  mailbox: Spot
  pickup: Spot
  pickupColor: string
}

export interface RoadsidePlan {
  posts: Spot[]
  signs: (Spot & { text: string })[]
  chevrons: Spot[]
  homes: Farmstead[]
  bales: Spot[]
  parked: (Spot & { color: string; style: number })[]
}

interface Rect { x0: number; z0: number; x1: number; z1: number }

const TOWN = SITE_BY_ID.town
const SIDINGS = ['#e8e3d6', '#c9b79a', '#8e9ea6', '#d8d2c0', '#a4553f', '#f0eee8']
const CAR_COLORS = ['#c9ccd1', '#1d1f23', '#7a1f1f', '#203a63', '#5d6670', '#2e4a33', '#b08d57', '#f2f2ee']

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const blockers: Rect[] = [
  ...SITES.filter((s) => s.kind !== 'town').map((s) => ({ x0: s.x - s.w / 2 - 10, z0: s.z - s.d / 2 - 10, x1: s.x + s.w / 2 + 10, z1: s.z + s.d / 2 + 10 })),
  ...LOTS.map((spec) => {
    const lot = lotExtent(spec, MAX_LAND_STRIPS)
    return { x0: lot.x - 10, z0: lot.z - 10, x1: lot.x + lot.w + 10, z1: lot.z + lot.d + 10 }
  }),
]
const fields: Rect[] = FIELDS.map((f) => ({ x0: f.x - f.w / 2 - 4, z0: f.z - f.d / 2 - 4, x1: f.x + f.w / 2 + 4, z1: f.z + f.d / 2 + 4 }))
const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1
const inTown = (x: number, z: number, pad = 0) => Math.abs(x - TOWN.x) <= TOWN.w / 2 + pad && Math.abs(z - TOWN.z) <= TOWN.d / 2 + pad

/** Distance from (x, z) to the nearest road centre line other than `skip`. */
function roadDistance(x: number, z: number, skip: Road | null): number {
  let best = Infinity
  for (const road of ROADS) {
    if (road === skip) continue
    const pts = road.loop ? [...road.points, road.points[0]] : road.points
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      const dx = bx - ax, dz = bz - az
      const l2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2))
      best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z) - road.width / 2)
    }
  }
  return best
}

/** Walks a road in `step` metre stations: point, unit direction and turn (rad over `span`, + left) at each. */
function walk(road: Road, step: number, visit: (x: number, z: number, dx: number, dz: number, s: number, turn: number) => void): void {
  const pts = road.loop ? [...road.points, road.points[0]] : road.points
  const arc = [0]
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = arc[arc.length - 1]
  const at = (s: number) => {
    let k = 0
    while (k < pts.length - 2 && arc[k + 1] < s) k++
    const seg = arc[k + 1] - arc[k] || 1
    const t = Math.max(0, Math.min(1, (s - arc[k]) / seg))
    const dx = (pts[k + 1][0] - pts[k][0]) / seg, dz = (pts[k + 1][1] - pts[k][1]) / seg
    return { x: pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, z: pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t, dx, dz }
  }
  for (let s = step / 2; s < total; s += step) {
    const p = at(s)
    const a = at(Math.max(0, s - 15)), b = at(Math.min(total, s + 15))
    const turn = Math.atan2(a.dx * b.dz - a.dz * b.dx, a.dx * b.dx + a.dz * b.dz)
    visit(p.x, p.z, p.dx, p.dz, s, -turn)
  }
}

function free(x: number, z: number): boolean {
  return !blockers.some((r) => inRect(r, x, z)) && !fields.some((r) => inRect(r, x, z))
}

let cached: RoadsidePlan | null = null

/** The roadside plan (computed once). */
export function roadside(): RoadsidePlan {
  if (cached) return cached
  const plan: RoadsidePlan = { posts: [], signs: [], chevrons: [], homes: [], bales: [], parked: [] }
  ROADS.forEach((road, index) => {
    const rural = road.kind === 'highway' || road.kind === 'road'
    if (rural) {
      walk(road, POST_EVERY, (x, z, dx, dz) => {
        for (const side of [1, -1]) {
          const off = road.width / 2 + 2.4
          const px = x + dz * side * off, pz = z - dx * side * off
          if (inTown(px, pz) || !free(px, pz) || roadDistance(px, pz, road) < 4) continue
          plan.posts.push({ x: px, z: pz, yaw: Math.atan2(dx, dz) })
        }
      })
      walk(road, 30, (x, z, dx, dz, _s, turn) => {
        if (road.kind !== 'highway' || Math.abs(turn) < 0.08) return
        const side = turn > 0 ? -1 : 1
        const off = road.width / 2 + 4
        const px = x + dz * side * off, pz = z - dx * side * off
        if (!free(px, pz) || roadDistance(px, pz, road) < 6) return
        plan.chevrons.push({ x: px, z: pz, yaw: Math.atan2(-side * dz, side * dx) })
      })
    }
    walk(road, SIGN_EVERY, (x, z, dx, dz) => {
      for (const dir of [1, -1]) {
        const off = road.width / 2 + 3
        const px = x - dz * dir * off, pz = z + dx * dir * off
        if (!free(px, pz) || roadDistance(px, pz, road) < 6 || (inTown(px, pz) && road.kind !== 'street')) continue
        const limit = inTown(px, pz) ? 25 : SPEED[road.kind]
        plan.signs.push({ x: px, z: pz, yaw: Math.atan2(-dx * dir, -dz * dir), text: `${limit}` })
      }
    })
    if (road.kind === 'road') {
      let n = 0
      walk(road, HOME_EVERY, (x, z, dx, dz) => {
        const side = n++ % 2 === 0 ? 1 : -1
        const hx = x + dz * side * HOME_SETBACK, hz = z - dx * side * HOME_SETBACK
        if (inTown(hx, hz, 40)) return
        for (const [cx, cz] of [[-HOME_HALF_W, -HOME_HALF_D], [HOME_HALF_W, -HOME_HALF_D], [-HOME_HALF_W, HOME_HALF_D], [HOME_HALF_W, HOME_HALF_D], [0, 0]]) {
          const px = hx + cx, pz = hz + cz
          if (!free(px, pz) || roadDistance(px, pz, road) < 10) return
        }
        const yaw = Math.atan2(-dz * side, dx * side) + Math.PI / 2
        const mx = x + dz * side * (road.width / 2 + 3), mz = z - dx * side * (road.width / 2 + 3)
        const h = hash(index * 131 + n, 7)
        plan.homes.push({
          x: hx, z: hz, yaw, siding: SIDINGS[Math.floor(h * SIDINGS.length)],
          mailbox: { x: mx, z: mz, yaw: Math.atan2(dx, dz) },
          pickup: { x: hx + dx * 14 - dz * side * 4, z: hz + dz * 14 + dx * side * 4, yaw: Math.atan2(-dz * side, dx * side) },
          pickupColor: CAR_COLORS[Math.floor(hash(n, index) * CAR_COLORS.length)],
        })
      })
    }
    if (road.kind === 'street') {
      walk(road, 24, (x, z, dx, dz, s) => {
        for (const side of [1, -1]) {
          if (hash(Math.round(s), index * 2 + (side > 0 ? 1 : 0)) > 0.45) continue
          const off = road.width / 2 - 1.2
          const px = x - dz * side * off, pz = z + dx * side * off
          if (!inTown(px, pz) || roadDistance(px, pz, road) < 8) continue
          const yaw = Math.atan2(dx * side, dz * side)
          plan.parked.push({ x: px, z: pz, yaw, color: CAR_COLORS[Math.floor(hash(Math.round(s) + 3, index) * CAR_COLORS.length)], style: Math.floor(hash(Math.round(s), index + 9) * 4) })
        }
      })
    }
  })
  for (const field of FIELDS) {
    if (field.crop !== 'wheat') continue
    for (let row = -2; row <= 2; row++) {
      for (let k = -4; k <= 4; k++) {
        if (hash(row * 17 + k, Math.round(field.x)) > 0.55) continue
        plan.bales.push({ x: field.x + k * (field.w / 10) + (hash(k, row) - 0.5) * 6, z: field.z + row * (field.d / 6), yaw: hash(row, k) * Math.PI })
      }
    }
  }
  cached = plan
  return plan
}

/** Farmstead rectangles (min/max corners) for tree placement to keep out of. */
export function homeRects(): { minX: number; maxX: number; minZ: number; maxZ: number }[] {
  return roadside().homes.map((h) => ({ minX: h.x - HOME_HALF_W - 6, maxX: h.x + HOME_HALF_W + 6, minZ: h.z - HOME_HALF_D - 6, maxZ: h.z + HOME_HALF_D + 6 }))
}
