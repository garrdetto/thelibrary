/**
 * What every shop, civic and industrial building wears beyond its bare walls (Buildings.ts raises the shell): the
 * factory finish of a metal building (a dark wainscot, panel seams every metre, corner and eave trim, downspouts, steel
 * and overhead doors, office windows) and the masonry finish of a store (plinth, pilasters, a pale band under the
 * coping, rear doors and dock doors), with a glass front and entry canopy on the wall that faces the pavement when no
 * photo or business already dresses it. Walls that a downtown storefront (Storefronts.ts) or a business (Businesses.ts)
 * covers are left alone, and so are walls hidden by a neighbour. Everything is laid into the shared place layer, so it
 * adds no draw calls. Town frame (x east, z south).
 */
import { hexRGB, type RGB } from '../../foxlake/fp/core/Geo'
import { dressedWalls, knownFronts } from '../data/Downtown'
import type { BuildingData } from '../data/MapData'
import type { TelloLand } from '../region'
import { edgesOf, pick, rand, roofBehind, roofsOf, wallTone, type Edge } from './Buildings'
import { place } from './Kit'
import type { PlaceLayer } from './PlaceLayer'
import { pointInRing } from './Poly'
import { SIGN_BOARD, SIGN_INK, type Signs } from './Signs'
import { planFronts } from './Storefronts'
import { at, entryCanopy, storeFront, wallBox, wallPacks, wallQuad, type Wall } from './WallKit'

export interface CommercialStats { buildings: number; fronts: number; doors: number }

export interface TakenWall { b: BuildingData; e: Edge }

const DOORS = [0x3d5368, 0x6b2f2a, 0x2f3a33, 0x8a8f93, 0x4d4a44]
const GUTTER: RGB = hexRGB(0xd5d3cc)
const FRAME: RGB = hexRGB(0x2b2e33)
const EIFS: RGB = hexRGB(0xd8d2c4)

const tint = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]

/** A wall's top: the eave of the block behind it plus the parapet a flat commercial roof gets, or the ridge on the high side of a single-slope roof. */
function wallTop(b: BuildingData, roofs: ReturnType<typeof roofsOf>, e: Edge): number {
  const eaves = roofs.map((r) => r.eave)
  const flat = roofs.every((r) => r.type === 0)
  const oneCap = flat && Math.max(...eaves) - Math.min(...eaves) <= 0.4
  const r = roofBehind(roofs, e)
  if (r.type >= 4) {
    const across = r.type === 4 || r.type === 5
    const sign = r.type === 4 || r.type === 6 ? 1 : -1
    const hx = (across ? r.vx : r.ux) * sign
    const hz = (across ? r.vz : r.uz) * sign
    if (e.nx * hx + e.nz * hz > 0.7) return b.f + r.ridge
  }
  return b.f + r.eave + (oneCap && (b.k === 'store' || b.k === 'civic' || b.k === 'industrial') ? 0.45 : 0)
}

function steelDoor(layer: PlaceLayer, w: Wall, t: number, top: number, color: RGB): void {
  const f = w.floor
  const h = Math.min(2.1, top - f - 0.5)
  if (h < 1.7) return
  wallBox(layer, w, t - 0.56, t + 0.56, f, f + h + 0.08, 0, 0.06, FRAME)
  const [x, z] = at(w, t)
  wallQuad(layer.builder(x, z, layer.M.paint), w, t - 0.47, t + 0.47, f + 0.02, f + h, 0.075, color)
  wallBox(layer, w, t + 0.22, t + 0.36, f + 0.95, f + 1.05, 0.07, 0.13, hexRGB(0xc9c6bd))
  const [px, pz] = at(w, t, 0.02)
  layer.lay('wall-pack', px, pz, place(px, f + h + 0.45, pz, 0.8, 0.8, 0.8, Math.atan2(w.e.nx, w.e.nz)), {})
}

function overheadDoor(layer: PlaceLayer, w: Wall, t: number, wide: number, top: number): number {
  const f = w.floor
  const h = Math.min(3.4, top - f - 0.5)
  if (h < 2.3) return 0
  wallBox(layer, w, t - wide / 2 - 0.14, t - wide / 2, f, f + h + 0.14, 0, 0.07, FRAME)
  wallBox(layer, w, t + wide / 2, t + wide / 2 + 0.14, f, f + h + 0.14, 0, 0.07, FRAME)
  wallBox(layer, w, t - wide / 2 - 0.14, t + wide / 2 + 0.14, f + h, f + h + 0.14, 0, 0.07, FRAME)
  const [x, z] = at(w, t)
  wallQuad(layer.builder(x, z, layer.M.garage, false), w, t - wide / 2, t + wide / 2, f + 0.02, f + h, 0.06)
  const [px, pz] = at(w, t, 0.02)
  layer.lay('wall-pack', px, pz, place(px, f + h + 0.5, pz, 0.8, 0.8, 0.8, Math.atan2(w.e.nx, w.e.nz)), {})
  return 1
}

function window(layer: PlaceLayer, w: Wall, t: number, width: number, y0: number, y1: number): void {
  wallBox(layer, w, t - width / 2 - 0.08, t + width / 2 + 0.08, y0 - 0.08, y1 + 0.08, 0, 0.05, hexRGB(0xe6e3da))
  const [x, z] = at(w, t)
  wallQuad(layer.builder(x, z, layer.M.lit, false, false), w, t - width / 2, t + width / 2, y0, y1, 0.07)
  wallBox(layer, w, t - 0.025, t + 0.025, y0, y1, 0.06, 0.09, hexRGB(0xe6e3da))
}

function downspouts(layer: PlaceLayer, w: Wall, top: number, over: [number, number]): void {
  const f = w.floor
  for (const t of [0.3, w.e.len - 0.3]) {
    if (t < over[0] || t > over[1]) continue
    const [x, z] = at(w, t, 0.1)
    layer.builder(x, z, layer.M.paint).cylinder(x, f, z, 0.045, 0.045, top - f - 0.15, 6, false, GUTTER)
  }
}

interface Finish { base: RGB; door: RGB; top: number; glazed: [number, number] | null }

/** The factory finish of a metal building's wall. */
function metalWall(layer: PlaceLayer, w: Wall, fin: Finish): void {
  const { e, floor: f } = w
  const { base, top } = fin
  const [mx, mz] = at(w, e.len / 2)
  const paint = layer.builder(mx, mz, layer.M.paint)
  const high = top - f
  const wain = Math.min(1.15, high * 0.4)
  wallQuad(paint, w, 0, e.len, f, f + wain, 0.025, tint(base, 0.55))
  wallBox(layer, w, 0, e.len, f + wain, f + wain + 0.08, 0, 0.045, tint(base, 1.1))
  const step = e.len > 50 ? 1.3 : 1
  for (let t = step; t < e.len - 0.2; t += step) wallQuad(paint, w, t - 0.025, t + 0.025, f + wain + 0.08, top - 0.3, 0.012, tint(base, 0.8))
  wallBox(layer, w, 0, e.len, top - 0.3, top, 0, 0.07, tint(base, 0.6))
  wallBox(layer, w, 0, 0.17, f, top, 0, 0.06, tint(base, 0.62))
  wallBox(layer, w, e.len - 0.17, e.len, f, top, 0, 0.06, tint(base, 0.62))
  downspouts(layer, w, top, [0, e.len])
}

/** The masonry finish of a store's wall: plinth, pilasters, a band under the coping. */
function masonryWall(layer: PlaceLayer, w: Wall, fin: Finish): void {
  const { e, floor: f } = w
  const { base, top } = fin
  const [mx, mz] = at(w, e.len / 2)
  const paint = layer.builder(mx, mz, layer.M.paint)
  const high = top - f
  const plinth = Math.min(0.75, high * 0.25)
  wallQuad(paint, w, 0, e.len, f, f + plinth, 0.022, tint(base, 0.6))
  wallBox(layer, w, 0, e.len, f + plinth, f + plinth + 0.07, 0, 0.05, tint(base, 1.12))
  const band = Math.min(0.9, high * 0.2)
  wallQuad(paint, w, 0, e.len, top - band - 0.07, top - band, 0.02, tint(base, 0.55))
  wallBox(layer, w, 0, e.len, top - band, top - 0.05, 0, 0.06, EIFS)
  wallBox(layer, w, 0, e.len, top - 0.07, top, 0, 0.11, tint(base, 0.7))
  const bays = Math.floor(e.len / 6.5)
  for (let i = 0; i < bays; i++) {
    const t = (e.len * (i + 1)) / (bays + 1)
    if (fin.glazed && t > fin.glazed[0] - 0.4 && t < fin.glazed[1] + 0.4) continue
    wallBox(layer, w, t - 0.24, t + 0.24, f + plinth, top - band, 0, 0.12, tint(base, 0.9))
  }
  downspouts(layer, w, top, [0, e.len])
}

interface Grid { cell: number; at: Map<number, number[]> }

function gridOf(rings: { x0: number; x1: number; z0: number; z1: number }[], cell = 64): Grid {
  const at = new Map<number, number[]>()
  rings.forEach((r, i) => {
    for (let gx = Math.floor(r.x0 / cell); gx <= Math.floor(r.x1 / cell); gx++) {
      for (let gz = Math.floor(r.z0 / cell); gz <= Math.floor(r.z1 / cell); gz++) {
        const k = gx * 100003 + gz
        const list = at.get(k)
        if (list) list.push(i)
        else at.set(k, [i])
      }
    }
  })
  return { cell, at }
}

export interface CommercialInput {
  layer: PlaceLayer
  signs: Signs
  land: TelloLand
  /** Walls other builders have dressed. */
  taken: readonly TakenWall[]
  /** Buildings another builder replaces or dresses all round. */
  skip: (b: BuildingData) => boolean
}

const near = (a: Edge, b: Edge) => Math.abs(a.ax - b.ax) < 0.3 && Math.abs(a.az - b.az) < 0.3 && Math.abs(a.bx - b.bx) < 0.3 && Math.abs(a.bz - b.bz) < 0.3

export function dressCommercial(input: CommercialInput): CommercialStats {
  const { layer, signs, land, taken, skip } = input
  const out: CommercialStats = { buildings: 0, fronts: 0, doors: 0 }
  const all = land.doc.buildings
  const boxes = all.map((b) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let k = 0; k < b.p.length; k += 2) {
      x0 = Math.min(x0, b.p[k]); x1 = Math.max(x1, b.p[k])
      z0 = Math.min(z0, -b.p[k + 1]); z1 = Math.max(z1, -b.p[k + 1])
    }
    return { x0, x1, z0, z1 }
  })
  const grid = gridOf(boxes)
  const covered = (self: BuildingData, x: number, z: number): boolean => {
    const list = grid.at.get(Math.floor(x / grid.cell) * 100003 + Math.floor(z / grid.cell))
    if (!list) return false
    for (const i of list) {
      const o = all[i]
      if (o === self || o.k === 'canopy') continue
      const r = boxes[i]
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue
      if (pointInRing(o.p, x, -z)) return true
    }
    return false
  }
  const plans = planFronts(land)
  for (const b of all) {
    if (b.k !== 'store' && b.k !== 'civic' && b.k !== 'industrial') continue
    if (skip(b) || b.n === 'Montello Fire Department') continue
    const edges = edgesOf(b.p)
    if (edges.length < 3) continue
    const roofs = roofsOf(b)
    const known = knownFronts(b.r[0][0], b.r[0][1])[0]?.style ?? dressedWalls(b.r[0][0], b.r[0][1])
    const base = hexRGB(known ? known.wall : wallTone(b))
    const metal = b.k === 'industrial' || (!!known && (known.upper === 'paint' || known.upper === 'siding') && b.k === 'store' && !known.house)
    const door = hexRGB(pick(DOORS, b.s, 4))
    const mine = taken.filter((t) => t.b === b).map((t) => t.e)
    const fronted = plans.filter((p) => p.b === b)
    const isFronted = (e: Edge) => mine.some((m) => near(m, e)) || fronted.some((p) => {
      const mx = (e.ax + e.bx) / 2 - p.ax, mz = (e.az + e.bz) / 2 - p.az
      const along = mx * p.dx + mz * p.dz
      const off = Math.abs(mx * p.dz - mz * p.dx)
      return off < 1.5 && along > -1 && along < p.len + 1 && Math.abs(((e.bx - e.ax) * p.dx + (e.bz - e.az) * p.dz) / e.len) > 0.9
    })
    let frontIndex = -1
    let best = Infinity
    edges.forEach((e, i) => {
      if (e.len < 6 || isFronted(e)) return
      const clear = land.clearAt((e.ax + e.bx) / 2 + e.nx * 4, -((e.az + e.bz) / 2 + e.nz * 4)) - e.len * 0.02
      if (clear < best) {
        best = clear
        frontIndex = i
      }
    })
    const hasFront = mine.length > 0 || fronted.length > 0
    const grandFront = metal || known ? false : true
    out.buildings++
    edges.forEach((e, i) => {
      if (e.len < 3 || isFronted(e)) return
      const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len
      if ([0.5, 0.2, 0.8].some((k) => covered(b, e.ax + dx * e.len * k + e.nx * 0.7, e.az + dz * e.len * k + e.nz * 0.7))) return
      const top = wallTop(b, roofs, e)
      if (top - b.f < 2.2) return
      const w: Wall = { e, t: e.len / 2, floor: b.f }
      const useFront = i === frontIndex && !hasFront && e.len >= 7 && top - b.f >= 3.2
      let glazed: [number, number] | null = null
      if (useFront) {
        const span = Math.min(e.len - 2.4, metal ? 6 : b.k === 'civic' ? 12 : 16)
        const t0 = metal ? 1.2 : (e.len - span) / 2
        glazed = [t0, t0 + span]
        const sill: Wall = { e, t: metal ? t0 + span / 2 : e.len / 2, floor: b.f }
        storeFront(layer, sill, glazed[0], glazed[1], 2.2, tint(base, 0.4))
        entryCanopy(layer, sill, metal ? 0.9 : 1.3)
        wallPacks(layer, w, Math.max(2, Math.floor(e.len / 8)), 3.0)
        if (b.n) {
          const [sx, sz] = at(sill, (glazed[0] + glazed[1]) / 2)
          signs.add({ text: b.n.toUpperCase(), x: sx, z: sz, y: b.f + 3.65, w: Math.min(glazed[1] - glazed[0] - 0.4, Math.max(3, b.n.length * 0.4)), h: 0.62, n: [e.nx, e.nz], board: SIGN_BOARD, ink: SIGN_INK, out: 0.34 })
        }
        out.fronts++
      }
      const fin: Finish = { base, door, top, glazed }
      if (metal) metalWall(layer, w, fin)
      else masonryWall(layer, w, fin)
      if (useFront) return
      const spots: number[] = []
      if (metal) {
        if (e.len >= 6) spots.push(e.len >= 12 ? 2.0 : e.len / 2)
        if (i === frontIndex || (best === Infinity && i === 0)) {
          const room = e.len - 6
          const count = Math.min(3, Math.floor(room / 6))
          for (let k = 0; k < count; k++) out.doors += overheadDoor(layer, w, 5.2 + ((room - 1.6) * (k + 0.5)) / count, 3.6, top)
          if (e.len >= 9) window(layer, w, 3.6, 1.4, b.f + 1.1, b.f + 2.3)
        }
      } else if (e.len >= 6) spots.push(Math.max(1.8, Math.min(e.len - 1.8, e.len * (0.2 + 0.6 * rand(b.s, i + 31)))))
      for (const t of spots) {
        steelDoor(layer, w, t, top, door)
        out.doors++
      }
      if (!metal && !grandFront && e.len >= 14) wallPacks(layer, w, Math.floor(e.len / 9), 3.2)
      if (!metal && grandFront && b.k === 'store' && e.len >= 18 && isRear(edges, frontIndex, i)) {
        const [dxm, dzm] = at(w, e.len / 2)
        layer.lay('dock-door', dxm, dzm, place(dxm, b.f, dzm, 1, 1, 1, Math.atan2(e.nx, e.nz)), {})
        out.doors++
      }
    })
  }
  return out
}

/** Whether edge `i` faces away from the front edge (the back of a store, where its dock door goes). */
function isRear(edges: Edge[], front: number, i: number): boolean {
  if (front < 0) return false
  return edges[front].nx * edges[i].nx + edges[front].nz * edges[i].nz < -0.8
}

/** A metal-panel wall on a free-standing building (the freight depot): the factory finish with its doors left to the caller. */
export function dressMetalWall(layer: PlaceLayer, e: Edge, floor: number, top: number, base: RGB): void {
  metalWall(layer, { e, t: e.len / 2, floor }, { base, door: FRAME, top, glazed: null })
}

/** A wall's door, for callers that place their own. */
export { steelDoor }
