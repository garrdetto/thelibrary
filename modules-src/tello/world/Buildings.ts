/**
 * Every building in Montello, raised from its real footprint with the roof the
 * 2018 lidar point cloud measured on it: each covering rectangle has its own
 * roof type (gable with the ridge along either axis, hip, single slope or
 * flat) and its own eave and ridge heights. The finishes are Fox Lake's house
 * and downtown surfaces (the same siding, brick, shingle, metal and glass and
 * the same window facades), chosen by the kind of building, since no open
 * data says what a wall looks like. Merged per material and 128 m cell like
 * the rest of Fox Lake's town, with one merged shadow caster per cell.
 * A building the lidar could not measure (built since, or hidden) gets a roof
 * by its kind.
 *
 * Built in town coordinates (x east, z south) under the mirrored town root.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders, hexRGB, type MeshBuilder, type RGB } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import type { Physics } from '../../foxlake/fp/physics/Physics'
import { ROOF, type BuildingData } from '../data/MapData'
import type { TelloLand } from '../region'
import { triangulate } from './Poly'

const SIDING = [0xf1eee6, 0xe6dfcf, 0xd9d4c7, 0xbfc6c9, 0x9db199, 0x8fa3b5, 0xc9b79a, 0xd8c98f, 0x9c4a3c, 0x6f7f8c, 0xb7b0a2, 0xe9e2c8, 0x7d8f7a, 0xa8998a]
const BRICK = [0xb8573f, 0xa5503c, 0xc27a5a, 0xe2d6c2]
const ROOF_TONES = [0x3b3d42, 0x4a3d34, 0x2f3a46, 0x5a3a2e, 0x46494c, 0x3e4a3c, 0x55504a]
const METAL = [0xc9c2b0, 0xa9b0b4, 0x8d9aa0, 0x7f9482, 0xd9d6cf, 0x9a6a55, 0x6f86a0]
const STORE = [0xd9cdb8, 0xc7b299, 0xb8573f, 0xcfc8ba, 0xa9a39a, 0xdcc9a0, 0xb9c1c4, 0xc98f6b]
const TRIM: RGB = hexRGB(0xf2f0ea)
const STOREY = 3.6

type V3 = [number, number, number]

function rand(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  return list[Math.floor(rand(seed, salt) * list.length) % list.length]
}

/** A flat polygon (3 or 4 points) whose front faces `toward`, whatever order the points come in. */
function facing(b: MeshBuilder, pts: V3[], toward: V3, uvs: number[][], color?: RGB): void {
  const [a, c1, c2] = pts
  const ux = c1[0] - a[0], uy = c1[1] - a[1], uz = c1[2] - a[2]
  const vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2]
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz) || 1
  nx /= len; ny /= len; nz /= len
  let order = pts
  let uv = uvs
  if (nx * toward[0] + ny * toward[1] + nz * toward[2] < 0) {
    order = [...pts].reverse()
    uv = [...uvs].reverse()
    nx = -nx; ny = -ny; nz = -nz
  }
  const col = color ?? b.color
  const i = b.vertexCount
  for (let k = 0; k < order.length; k++) b.vertex(order[k][0], order[k][1], order[k][2], nx, ny, nz, uv[k][0], uv[k][1], col)
  b.tri(i, i + 1, i + 2)
  if (order.length === 4) b.tri(i, i + 2, i + 3)
}

interface Edge { ax: number; az: number; bx: number; bz: number; nx: number; nz: number; len: number; at: number }

/** The footprint's edges in town coordinates with their outward normals. */
function edgesOf(p: number[]): Edge[] {
  const n = p.length / 2
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += p[i * 2] * -p[j * 2 + 1] - p[j * 2] * -p[i * 2 + 1]
  }
  const out: Edge[] = []
  let at = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = p[i * 2], az = -p[i * 2 + 1], bx = p[j * 2], bz = -p[j * 2 + 1]
    const ex = bx - ax, ez = bz - az
    const len = Math.hypot(ex, ez)
    if (len < 0.05) continue
    const s = area > 0 ? 1 : -1
    out.push({ ax, az, bx, bz, nx: (s * ez) / len, nz: (-s * ex) / len, len, at })
    at += len
  }
  return out
}

export interface BuildStats { buildings: number; colliders: number }

export function buildBuildings(root: TransformNode, mats: Mats, physics: Physics, land: TelloLand): BuildStats {
  const chunks = new ChunkedBuilders(128)
  const M = {
    siding: mats.textured('h-siding', 'siding', { vcolor: true }),
    brick: mats.textured('h-brick', 'brick', { vcolor: true }),
    boards: mats.textured('h-boards', 'boards', { vcolor: true }),
    metal: mats.textured('t-metal-wall', 'metal', { vcolor: true, tile: 2.2, metal: 0.25, gloss: 0.35 }),
    paint: mats.plain('h-paint', { vcolor: true, gloss: 0.22 }),
    shingles: mats.textured('roof-shingles', 'shingles', { vcolor: true }),
    tin: mats.textured('t-roof-tin', 'metal', { vcolor: true, tile: 1.4, metal: 0.4, gloss: 0.45 }),
    flat: mats.textured('roof-flat', 'roofFlat'),
    foundation: mats.textured('foundation', 'concrete', { color: 0x9c9890, tile: 1.5 }),
    door: mats.textured('door', 'planks', { color: 0x6b4a2e, tile: 1 }),
    garage: mats.textured('garage', 'garage', { color: 0xf0eee8 }),
    glass: mats.glass('glass-house', 0xa9c3d1, 0.38),
    lit: mats.plain('t-window-lit', { color: 0x38424b, gloss: 0.8, keepGloss: true, emissive: 0xffc98a, emissiveIntensity: 0 }),
    store: mats.facade('store'),
    civic: mats.facade('brick'),
    post: mats.plain('t-post', { color: 0xe6e6e2, gloss: 0.45 }),
  }
  if (!mats.nightGlow.some((g) => g.m === M.lit)) mats.nightGlow.push({ m: M.lit, k: 1.7 })
  let colliders = 0
  for (const b of land.doc.buildings) {
    const edges = edgesOf(b.p)
    if (edges.length < 3) continue
    const cx = b.r[0][0]
    const cz = -b.r[0][1]
    const get = (m: Material, colors = false, cast = true) => chunks.get(cx, cz, m, { colors, cast })
    const facade = b.k === 'store' || b.k === 'civic'
    const commercial = facade || b.k === 'industrial'
    const floor = b.f
    const bottom = Math.min(b.l, b.f) - 0.5
    if (b.k === 'canopy') {
      canopy(b, floor, b.m ? b.h : Math.max(4.6, b.h), get(M.paint, true), get(M.post), physics)
      colliders += 4
      continue
    }
    const roofs = roofsOf(b)
    const allFlat = roofs.every((r) => r.type === ROOF.flat)
    const eaves = roofs.map((r) => r.eave)
    const lowEave = Math.min(...eaves)
    const oneCap = allFlat && Math.max(...eaves) - lowEave <= 0.4
    const parapet = oneCap && commercial ? 0.45 : 0
    // Walls: each edge rises to the eave of the block behind it.
    let wall: MeshBuilder
    let color: RGB
    if (facade) {
      wall = get(b.k === 'store' ? M.store : M.civic, true)
      color = hexRGB(pick(b.k === 'store' ? STORE : BRICK, b.s, 1))
    } else if (b.k === 'industrial') {
      wall = get(M.metal, true)
      color = hexRGB(pick(METAL, b.s, 1))
    } else if (b.k === 'shed') {
      wall = get(rand(b.s, 2) < 0.5 ? M.boards : M.metal, true)
      color = hexRGB(rand(b.s, 3) < 0.35 ? 0x8c3b30 : pick(METAL, b.s, 1))
    } else {
      const r = rand(b.s, 2)
      wall = get(r < 0.72 ? M.siding : r < 0.86 ? M.brick : M.boards, true)
      color = hexRGB(r < 0.72 || r >= 0.86 ? pick(SIDING, b.s, 1) : pick(BRICK, b.s, 1))
    }
    // A facade's window rows are 3.6 m apart: stretch them so whole storeys fit the real wall height.
    const storeys = Math.max(1, Math.round(roofs[0].eave / STOREY))
    const vScale = facade ? (storeys * STOREY) / roofs[0].eave : 1
    for (const e of edges) {
      const top = floor + roofBehind(roofs, e).eave + parapet
      facing(wall, [[e.ax, bottom, e.az], [e.bx, bottom, e.bz], [e.bx, top, e.bz], [e.ax, top, e.az]], [e.nx, 0, e.nz],
        [[e.at, (bottom - floor) * vScale], [e.at + e.len, (bottom - floor) * vScale], [e.at + e.len, (top - floor) * vScale], [e.at, (top - floor) * vScale]], color)
    }
    // A block taller than its neighbours shows its own wall above their roofs.
    for (const r of roofs) {
      if (r.eave < lowEave + 0.25) continue
      const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, d]): [number, number] => [r.cx + r.ux * a * r.hx + r.vx * d * r.hz, r.cz + r.uz * a * r.hx + r.vz * d * r.hz])
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i]
        const [bx, bz] = corners[(i + 1) % 4]
        const len = Math.hypot(bx - ax, bz - az)
        facing(wall, [[ax, floor + lowEave - 0.05, az], [bx, floor + lowEave - 0.05, bz], [bx, floor + r.eave, bz], [ax, floor + r.eave, az]], [(ax + bx) / 2 - r.cx, 0, (az + bz) / 2 - r.cz],
          [[0, lowEave * vScale], [len, lowEave * vScale], [len, r.eave * vScale], [0, r.eave * vScale]], color)
      }
    }
    if (!facade) {
      const found = get(M.foundation)
      for (const e of edges) {
        const ox = e.nx * 0.03, oz = e.nz * 0.03
        facing(found, [[e.ax + ox, bottom, e.az + oz], [e.bx + ox, bottom, e.bz + oz], [e.bx + ox, floor + 0.28, e.bz + oz], [e.ax + ox, floor + 0.28, e.az + oz]], [e.nx, 0, e.nz],
          [[e.at, 0], [e.at + e.len, 0], [e.at + e.len, floor + 0.28 - bottom], [e.at, floor + 0.28 - bottom]])
      }
      openings(b, edges, floor, roofs, land, get(M.paint, true, false), get(M.glass, false, false), get(M.lit, false, false), get(b.k === 'house' ? M.door : M.garage, false, false))
    }
    // Roofs.
    const tin = b.k === 'industrial' || (b.k === 'shed' && rand(b.s, 2) >= 0.5)
    const pitched = get(tin ? M.tin : M.shingles, true)
    const tone = hexRGB(tin ? pick([0x8d9296, 0x6f7a7c, 0x7a4a40, 0x5d6f62, 0xb9bdbf], b.s, 5) : pick(ROOF_TONES, b.s, 5))
    const under = get(M.paint, true)
    const over = b.k === 'shed' ? 0.2 : commercial ? 0.25 : 0.38
    if (oneCap) {
      const roof = get(M.flat)
      const ring: number[] = []
      for (let k = 0; k < b.p.length; k += 2) ring.push(b.p[k], -b.p[k + 1])
      const tris = triangulate(ring)
      const y = floor + roofs[0].eave
      for (let t = 0; t < tris.length; t += 3) {
        const pts = [tris[t], tris[t + 1], tris[t + 2]].map((i): V3 => [ring[i * 2], y, ring[i * 2 + 1]])
        facing(roof, pts, [0, 1, 0], pts.map((p) => [p[0], p[2]]))
      }
      if (parapet) {
        const cap = get(M.paint, true)
        const capColor = hexRGB(0x4a4c50)
        for (const e of edges) {
          const ix = -e.nx * 0.3, iz = -e.nz * 0.3
          facing(cap, [[e.ax, y + parapet, e.az], [e.bx, y + parapet, e.bz], [e.bx + ix, y + parapet, e.bz + iz], [e.ax + ix, y + parapet, e.az + iz]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], capColor)
          facing(cap, [[e.ax + ix, y, e.az + iz], [e.bx + ix, y, e.bz + iz], [e.bx + ix, y + parapet, e.bz + iz], [e.ax + ix, y + parapet, e.az + iz]], [-e.nx, 0, -e.nz], [[0, 0], [1, 0], [1, 1], [0, 1]], capColor)
        }
      }
    } else {
      roofs.forEach((r, i) => {
        const lift = i * 0.015
        if (r.type === ROOF.flat) slab(get(M.flat), under, r, floor + r.eave + lift, 0.12)
        else if (r.type === ROOF.hip) hip(pitched, under, r, floor + r.eave + lift, floor + r.ridge + lift, over, tone)
        else if (r.type >= ROOF.shedPlusSecond) shed(pitched, wall, under, r, floor + r.eave + lift, floor + r.ridge + lift, over, tone, color)
        else gable(pitched, wall, under, r, r.type === ROOF.gableFirst, floor + r.eave + lift, floor + r.ridge + lift, over, tone, color)
      })
      const main = roofs[0]
      if (b.k === 'house' && main.type !== ROOF.flat && rand(b.s, 7) < 0.55) {
        const first = main.type === ROOF.gableFirst || (main.type !== ROOF.gableSecond && main.hx >= main.hz)
        const along = (rand(b.s, 8) - 0.5) * (first ? main.hx : main.hz) * 0.9
        const px = main.cx + (first ? main.ux : main.vx) * along
        const pz = main.cz + (first ? main.uz : main.vz) * along
        const rise = main.ridge - main.eave
        get(M.brick, true).orientedBox(px, floor + main.eave + rise * 0.5 + 0.5, pz, 0.3, rise * 0.5 + 0.6, 0.3, main.yaw, { color: hexRGB(0x9a5a48), skipBottom: true })
      }
    }
    // Solid for walkers and cars.
    for (const r of roofs) {
      const top = floor + r.eave
      physics.addStaticBox({ cx: r.cx, cy: (bottom + top) / 2, cz: r.cz, hx: r.hx, hy: (top - bottom) / 2, hz: r.hz, rotY: r.yaw })
      colliders++
    }
  }
  chunks.flush(root, 'tello-buildings')
  return { buildings: land.doc.buildings.length, colliders }
}

/** One covering rectangle with its roof, in town coordinates: `u` is its first axis, `v` its second. */
interface Roof { cx: number; cz: number; hx: number; hz: number; yaw: number; ux: number; uz: number; vx: number; vz: number; type: number; eave: number; ridge: number }

/** The building's rectangles with their roofs: as measured, or by the kind of building where the lidar has nothing. */
function roofsOf(b: BuildingData): Roof[] {
  const flatKind = b.k === 'store' || b.k === 'civic' || (b.k === 'industrial' && b.r.length > 1)
  const pitch = b.k === 'industrial' ? 0.2 : b.k === 'shed' ? 0.42 : b.k === 'garage' ? 0.5 : b.k === 'church' ? 1.0 : 0.52 + rand(b.s, 6) * 0.2
  return b.r.map((r) => {
    const c = Math.cos(r[4]), s = Math.sin(r[4])
    let type = r[5] ?? ROOF.unmeasured
    let eave = r[6] ?? 0
    let ridge = r[7] ?? 0
    if (type === ROOF.unmeasured) {
      eave = b.h
      type = flatKind ? ROOF.flat : r[2] >= r[3] ? ROOF.gableFirst : ROOF.gableSecond
      ridge = flatKind ? eave : eave + Math.min(r[2], r[3]) * pitch
    }
    return { cx: r[0], cz: -r[1], hx: r[2], hz: r[3], yaw: r[4], ux: c, uz: -s, vx: -s, vz: -c, type, eave, ridge }
  })
}

/** The rectangle behind a wall edge (the one holding a point just inside it), or the nearest. */
function roofBehind(roofs: Roof[], e: Edge): Roof {
  const px = (e.ax + e.bx) / 2 - e.nx * 0.5
  const pz = (e.az + e.bz) / 2 - e.nz * 0.5
  let best = roofs[0]
  let bd = Infinity
  for (const r of roofs) {
    const dx = px - r.cx, dz = pz - r.cz
    const du = Math.abs(dx * r.ux + dz * r.uz) - r.hx
    const dv = Math.abs(dx * r.vx + dz * r.vz) - r.hz
    const d = Math.max(du, dv)
    if (d < bd) {
      bd = d
      best = r
    }
  }
  return best
}

function at(r: Roof, u: number, v: number, y: number): V3 {
  return [r.cx + r.ux * u + r.vx * v, y, r.cz + r.uz * u + r.vz * v]
}

/** The roof and its painted underside for one slope. */
function slope(roof: MeshBuilder, under: MeshBuilder, pts: V3[], toward: V3, tone: RGB): void {
  const uv = pts.map((p, i) => (i === 0 ? [0, 0] : [Math.hypot(p[0] - pts[0][0], p[2] - pts[0][2]), p[1] - pts[0][1]]))
  facing(roof, pts, toward, uv, tone)
  facing(under, pts.map((p): V3 => [p[0], p[1] - 0.08, p[2]]), [-toward[0], -toward[1], -toward[2]], uv, TRIM)
}

/** A gable roof over one rectangle: the ridge along its first axis or its second, eave and ridge at their measured heights. */
function gable(roof: MeshBuilder, wall: MeshBuilder, under: MeshBuilder, r: Roof, alongFirst: boolean, eave: number, ridge: number, over: number, tone: RGB, wallColor: RGB): void {
  const L = alongFirst ? r.hx : r.hz
  const W = alongFirst ? r.hz : r.hx
  const p = (along: number, across: number, y: number): V3 => (alongFirst ? at(r, along, across, y) : at(r, across, along, y))
  const fall = (ridge - eave) / Math.max(0.5, W)
  const low = eave - over * fall
  for (const side of [-1, 1]) {
    const out = p(0, side, 0)
    slope(roof, under, [p(-L - over, side * (W + over), low), p(L + over, side * (W + over), low), p(L + over, 0, ridge), p(-L - over, 0, ridge)], [out[0] - r.cx, 1.5, out[2] - r.cz], tone)
  }
  for (const end of [-1, 1]) {
    const out = p(end, 0, 0)
    facing(wall, [p(end * L, -W, eave), p(end * L, W, eave), p(end * L, 0, ridge - 0.02)], [out[0] - r.cx, 0, out[2] - r.cz], [[0, 0], [2 * W, 0], [W, ridge - eave]], wallColor)
  }
}

/** A hip roof: the ridge along the longer axis, shortened by the half width at each end (a pyramid on a square). */
function hip(roof: MeshBuilder, under: MeshBuilder, r: Roof, eave: number, ridge: number, over: number, tone: RGB): void {
  const first = r.hx >= r.hz
  const L = first ? r.hx : r.hz
  const W = first ? r.hz : r.hx
  const p = (along: number, across: number, y: number): V3 => (first ? at(r, along, across, y) : at(r, across, along, y))
  const fall = (ridge - eave) / Math.max(0.5, W)
  const low = eave - over * fall
  const k = Math.max(0, L - W)
  for (const side of [-1, 1]) {
    const out = p(0, side, 0)
    slope(roof, under, [p(-L - over, side * (W + over), low), p(L + over, side * (W + over), low), p(k, 0, ridge), p(-k, 0, ridge)], [out[0] - r.cx, 1.5, out[2] - r.cz], tone)
  }
  for (const end of [-1, 1]) {
    const out = p(end, 0, 0)
    slope(roof, under, [p(end * (L + over), -(W + over), low), p(end * (L + over), W + over, low), p(end * k, 0, ridge)], [out[0] - r.cx, 1.5, out[2] - r.cz], tone)
  }
}

/** A single slope from the low wall up to the high one, with the wall closed under it. */
function shed(roof: MeshBuilder, wall: MeshBuilder, under: MeshBuilder, r: Roof, eave: number, ridge: number, over: number, tone: RGB, wallColor: RGB): void {
  const acrossSecond = r.type === ROOF.shedPlusSecond || r.type === ROOF.shedMinusSecond
  const sign = r.type === ROOF.shedPlusSecond || r.type === ROOF.shedPlusFirst ? 1 : -1
  const L = acrossSecond ? r.hx : r.hz
  const W = acrossSecond ? r.hz : r.hx
  // `across` runs from the low wall (-W) to the high wall (+W).
  const p = (along: number, across: number, y: number): V3 => (acrossSecond ? at(r, along, across * sign, y) : at(r, across * sign, along, y))
  const fall = (ridge - eave) / (2 * Math.max(0.5, W))
  slope(roof, under, [p(-L - over, -W - over, eave - over * fall), p(L + over, -W - over, eave - over * fall), p(L + over, W + over, ridge + over * fall), p(-L - over, W + over, ridge + over * fall)], [0, 1, 0], tone)
  const high = p(0, 1, 0)
  facing(wall, [p(-L, W, eave), p(L, W, eave), p(L, W, ridge), p(-L, W, ridge)], [high[0] - r.cx, 0, high[2] - r.cz], [[0, 0], [2 * L, 0], [2 * L, ridge - eave], [0, ridge - eave]], wallColor)
  for (const end of [-1, 1]) {
    const out = p(end, 0, 0)
    facing(wall, [p(end * L, -W, eave), p(end * L, W, eave), p(end * L, W, ridge)], [out[0] - r.cx, 0, out[2] - r.cz], [[0, 0], [2 * W, 0], [2 * W, ridge - eave]], wallColor)
  }
}

/** A flat roof over one rectangle with a thin fascia. */
function slab(roof: MeshBuilder, trim: MeshBuilder, r: Roof, y: number, over: number): void {
  const c: V3[] = [at(r, -r.hx - over, -r.hz - over, y), at(r, r.hx + over, -r.hz - over, y), at(r, r.hx + over, r.hz + over, y), at(r, -r.hx - over, r.hz + over, y)]
  facing(roof, c, [0, 1, 0], c.map((p) => [p[0], p[2]]))
  for (let i = 0; i < 4; i++) {
    const a = c[i], b2 = c[(i + 1) % 4]
    facing(trim, [[a[0], y - 0.18, a[2]], [b2[0], y - 0.18, b2[2]], b2, a], [(a[0] + b2[0]) / 2 - r.cx, 0, (a[2] + b2[2]) / 2 - r.cz], [[0, 0], [1, 0], [1, 1], [0, 1]], TRIM)
  }
}

/** Windows and a door on a house, garage or shed. */
function openings(b: BuildingData, edges: Edge[], floor: number, roofs: Roof[], land: TelloLand, trim: MeshBuilder, glass: MeshBuilder, lit: MeshBuilder, door: MeshBuilder): void {
  // The front is the wall nearest pavement.
  let front = -1
  let best = Infinity
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (e.len < 2.6) continue
    const mx = (e.ax + e.bx) / 2 + e.nx * 4
    const mz = (e.az + e.bz) / 2 + e.nz * 4
    const clear = land.clearAt(mx, -mz) - e.len * 0.02
    if (clear < best) {
      best = clear
      front = i
    }
  }
  const quad = (m: MeshBuilder, e: Edge, t0: number, t1: number, y0: number, y1: number, out: number, color?: RGB) => {
    const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len
    const ox = e.nx * out, oz = e.nz * out
    facing(m, [[e.ax + dx * t0 + ox, y0, e.az + dz * t0 + oz], [e.ax + dx * t1 + ox, y0, e.az + dz * t1 + oz], [e.ax + dx * t1 + ox, y1, e.az + dz * t1 + oz], [e.ax + dx * t0 + ox, y1, e.az + dz * t0 + oz]],
      [e.nx, 0, e.nz], [[0, 0], [t1 - t0, 0], [t1 - t0, y1 - y0], [0, y1 - y0]], color)
  }
  if (b.k === 'garage' || b.k === 'shed') {
    if (front < 0) return
    const e = edges[front]
    const wallH = roofBehind(roofs, e).eave
    const w = b.k === 'garage' ? Math.min(e.len - 0.8, e.len > 6.5 ? 4.9 : 2.7) : Math.min(e.len - 0.6, 1.6)
    if (w < 0.8) return
    const mid = e.len / 2
    quad(trim, e, mid - w / 2 - 0.1, mid + w / 2 + 0.1, floor, floor + Math.min(wallH - 0.2, 2.25), 0.03, TRIM)
    quad(door, e, mid - w / 2, mid + w / 2, floor + 0.02, floor + Math.min(wallH - 0.3, 2.15), 0.08)
    return
  }
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (e.len < 3.2) continue
    // Windows fit the wall they are in: none on a wall too low for one, two rows on a two-storey wall.
    const wallH = roofBehind(roofs, e).eave
    if (wallH < 2.35) continue
    const storeys = wallH > 4.9 ? 2 : 1
    const count = Math.max(1, Math.floor((e.len - 0.8) / 3.1))
    const gap = e.len / count
    const doorAt = i === front ? Math.floor(count / 2) : -1
    for (let s = 0; s < storeys; s++) {
      const y = floor + 0.95 + s * 2.65
      for (let k = 0; k < count; k++) {
        const mid = gap * (k + 0.5)
        if (s === 0 && k === doorAt) {
          const doorTop = Math.min(2.15, wallH - 0.2)
          quad(trim, e, mid - 0.58, mid + 0.58, floor + 0.1, floor + doorTop + 0.1, 0.03, TRIM)
          quad(door, e, mid - 0.48, mid + 0.48, floor + 0.12, floor + doorTop, 0.08)
          continue
        }
        const w = rand(b.s, i * 13 + k) < 0.3 ? 0.75 : 0.5
        const tall = Math.min(1.25, wallH - (y - floor) - 0.25)
        if (tall < 0.6) continue
        quad(trim, e, mid - w - 0.08, mid + w + 0.08, y - 0.08, y + tall + 0.08, 0.03, TRIM)
        quad(rand(b.s, i * 31 + k * 7 + s) < 0.3 ? lit : glass, e, mid - w, mid + w, y, y + tall, 0.08)
      }
    }
  }
}

/** A fuel canopy: a white slab with a coloured band on four posts. */
function canopy(b: BuildingData, floor: number, height: number, slab: MeshBuilder, post: MeshBuilder, physics: Physics): void {
  const [mx, mz, hx, hz, yaw] = b.r[0]
  const top = floor + height
  slab.orientedBox(mx, top - 0.3, -mz, hx, 0.3, hz, yaw, { color: hexRGB(0xf1f1ee) })
  slab.orientedBox(mx, top - 0.3, -mz, hx + 0.03, 0.12, hz + 0.03, yaw, { color: hexRGB(rand(b.s, 1) < 0.5 ? 0xb3262a : 0x2f6d3a) })
  const c = Math.cos(yaw), s = Math.sin(yaw)
  for (const [a, d] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = a * Math.max(0.6, hx - 1.2), lz = d * Math.max(0.6, hz - 1.2)
    const px = mx + lx * c - lz * s
    const pz = -(mz + lx * s + lz * c)
    post.cylinder(px, floor - 0.3, pz, 0.16, 0.16, height, 10, false)
    physics.addStaticCylinder(px, floor + height / 2, pz, height / 2, 0.2)
  }
}
