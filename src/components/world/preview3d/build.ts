import * as THREE from 'three'
import type { TelloLand } from '../../../../modules-src/tello/region'
import { COVER, ROOF, treeUnits } from '../../../../modules-src/tello/data/MapData'
import type { BuildingData, BuildingKind, RoadKind } from '../../../../modules-src/tello/data/MapData'
import type { LightStyle, WallStyle, WorldExtras } from '../../../../modules-src/tello/edits/WorldEdits'
import { resample, signedArea, triangulate } from '../../../../modules-src/tello/world/Poly'

/** A square (or any) area of the map, map metres: x east, z north. */
export interface PreviewWindow { x0: number; z0: number; x1: number; z1: number }

export interface PreviewOptions {
  /** Most terrain grid nodes along a side; larger windows skip nodes (default 400). */
  maxNodes?: number
  /** Most trees drawn, nearest the window's centre first (default 25,000). */
  maxTrees?: number
  /** Metres added round the window (default 4). */
  margin?: number
}

export interface PreviewStats { triangles: number; trees: number; buildings: number; ms: number }

export interface PreviewScene {
  /** In three's frame: x = map x, y = height (map metres), z = -map z. */
  group: THREE.Group
  stats: PreviewStats
  dispose(): void
}

type V3 = [number, number, number]
type RGB = readonly [number, number, number]

const UP: V3 = [0, 1, 0]
const DOWN: V3 = [0, -1, 0]
const SUN = new THREE.Vector3(-0.45, 0.8, 0.4).normalize()

function linear(hex: number): RGB {
  const c = new THREE.Color(hex)
  return [c.r, c.g, c.b]
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function shade(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k]
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Map point to three's frame. */
function T(x: number, y: number, z: number): V3 {
  return [x, y, -z]
}

class Builder {
  readonly pos: number[] = []
  readonly col: number[] = []
  readonly idx: number[] = []

  get count(): number {
    return this.pos.length / 3
  }

  vert(p: V3, c: RGB): number {
    this.pos.push(p[0], p[1], p[2])
    this.col.push(c[0], c[1], c[2])
    return this.pos.length / 3 - 1
  }

  tri(a: number, b: number, c: number, toward: V3): void {
    const P = this.pos
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2]
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    if (nx * toward[0] + ny * toward[1] + nz * toward[2] < 0) this.idx.push(a, c, b)
    else this.idx.push(a, b, c)
  }

  face(pts: V3[], toward: V3, c: RGB): void {
    const base = this.count
    for (const p of pts) this.vert(p, c)
    for (let k = 1; k + 1 < pts.length; k++) this.tri(base, base + k, base + k + 1, toward)
  }

  get triangles(): number {
    return this.idx.length / 3
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }
}

interface Box { x0: number; z0: number; x1: number; z1: number }

function within(b: Box, x: number, z: number, inset = 0): boolean {
  return x >= b.x0 + inset && x <= b.x1 - inset && z >= b.z0 + inset && z <= b.z1 - inset
}

function ringBox(p: ArrayLike<number>): Box {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let k = 0; k + 1 < p.length; k += 2) {
    if (p[k] < x0) x0 = p[k]
    if (p[k] > x1) x1 = p[k]
    if (p[k + 1] < z0) z0 = p[k + 1]
    if (p[k + 1] > z1) z1 = p[k + 1]
  }
  return { x0, z0, x1, z1 }
}

function overlaps(a: Box, b: Box, pad = 0): boolean {
  return a.x0 <= b.x1 + pad && a.x1 >= b.x0 - pad && a.z0 <= b.z1 + pad && a.z1 >= b.z0 - pad
}

function clipAxis(pts: number[], axis: 0 | 1, limit: number, keepAbove: boolean): number[] {
  const out: number[] = []
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = pts[i * 2 + axis]
    const b = pts[j * 2 + axis]
    const aIn = keepAbove ? a >= limit : a <= limit
    const bIn = keepAbove ? b >= limit : b <= limit
    if (aIn) out.push(pts[i * 2], pts[i * 2 + 1])
    if (aIn !== bIn) {
      const t = (limit - a) / (b - a)
      out.push(pts[i * 2] + (pts[j * 2] - pts[i * 2]) * t, pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * t)
    }
  }
  return out
}

/** A ring cut to the box (Sutherland-Hodgman). */
function clipRing(ring: ArrayLike<number>, b: Box): number[] {
  let pts = Array.from(ring)
  pts = clipAxis(pts, 0, b.x0, true)
  if (pts.length >= 6) pts = clipAxis(pts, 0, b.x1, false)
  if (pts.length >= 6) pts = clipAxis(pts, 1, b.z0, true)
  if (pts.length >= 6) pts = clipAxis(pts, 1, b.z1, false)
  return pts.length >= 6 ? pts : []
}

function tangent(pts: ArrayLike<number>, i: number): [number, number] {
  const n = pts.length / 2
  const a = Math.max(0, i - 1)
  const b = Math.min(n - 1, i + 1)
  const dx = pts[b * 2] - pts[a * 2]
  const dz = pts[b * 2 + 1] - pts[a * 2 + 1]
  const len = Math.hypot(dx, dz)
  return len > 1e-6 ? [dx / len, dz / len] : [1, 0]
}

/** Consecutive points of a polyline inside the box, as separate runs of two or more points. */
function runsInside(pts: number[], clip: Box, inset: number): number[][] {
  const runs: number[][] = []
  let run: number[] = []
  for (let k = 0; k + 1 < pts.length; k += 2) {
    if (within(clip, pts[k], pts[k + 1], inset)) run.push(pts[k], pts[k + 1])
    else {
      if (run.length >= 4) runs.push(run)
      run = []
    }
  }
  if (run.length >= 4) runs.push(run)
  return runs
}

/**
 * A box between two map points, `half` either side of the line, from `botA`/`topA` at the first end to `botB`/`topB`
 * at the second (so walls and beams can follow the ground).
 */
function prism(b: Builder, ax: number, az: number, bx: number, bz: number, half: number, botA: number, topA: number, botB: number, topB: number, c: RGB, bottom = false): void {
  const len = Math.hypot(bx - ax, bz - az)
  if (len < 1e-4) return
  const dx = (bx - ax) / len
  const dz = (bz - az) / len
  const lx = -dz * half
  const lz = dx * half
  const ALb = T(ax + lx, botA, az + lz), ALt = T(ax + lx, topA, az + lz)
  const ARb = T(ax - lx, botA, az - lz), ARt = T(ax - lx, topA, az - lz)
  const BLb = T(bx + lx, botB, bz + lz), BLt = T(bx + lx, topB, bz + lz)
  const BRb = T(bx - lx, botB, bz - lz), BRt = T(bx - lx, topB, bz - lz)
  b.face([ALt, ARt, BRt, BLt], UP, c)
  if (bottom) b.face([ALb, ARb, BRb, BLb], DOWN, c)
  b.face([ALb, BLb, BLt, ALt], [-dz, 0, -dx], c)
  b.face([ARb, BRb, BRt, ARt], [dz, 0, dx], c)
  b.face([ALb, ARb, ARt, ALt], [-dx, 0, dz], c)
  b.face([BLb, BRb, BRt, BLt], [dx, 0, -dz], c)
}

function post(b: Builder, x: number, z: number, half: number, y0: number, y1: number, c: RGB): void {
  prism(b, x - half, z, x + half, z, half, y0, y1, y0, y1, c)
}

const COVER_COLOR: Record<number, RGB> = {
  [COVER.meadow]: linear(0x8a9a58),
  [COVER.lawn]: linear(0x6e9a46),
  [COVER.woods]: linear(0x56693a),
  [COVER.marsh]: linear(0x6f7a50),
  [COVER.bare]: linear(0xb2a284),
  [COVER.lot]: linear(0x8b8a84),
  [COVER.field]: linear(0xa9a466),
  [COVER.water]: linear(0x6e6a52),
}
const DRY: Record<number, RGB> = {
  [COVER.meadow]: linear(0xb0a978),
  [COVER.lawn]: linear(0x93a364),
  [COVER.field]: linear(0xc4b27a),
}
const CANOPY_FLOOR = linear(0x3b4e2a)
const BED = linear(0x6e6a52)
const DEEP = linear(0x3e4a44)
const SKIRT = linear(0x6b5a45)

interface TerrainGrid {
  geometry: THREE.BufferGeometry
  water: THREE.BufferGeometry | null
  extent: Box
  cols: number
  rows: number
  step: number
  gx0: number
  gz0: number
}

function buildTerrain(land: TelloLand, win: PreviewWindow, margin: number, maxNodes: number): TerrainGrid {
  const n = land.side
  const cell = land.cell
  const g = land.grids
  const clampNode = (v: number) => Math.min(n - 1, Math.max(0, v))
  const gx0 = clampNode(Math.floor((Math.min(win.x0, win.x1) - margin - land.x0) / cell))
  const gx1 = clampNode(Math.ceil((Math.max(win.x0, win.x1) + margin - land.x0) / cell))
  const gz0 = clampNode(Math.floor((Math.min(win.z0, win.z1) - margin - land.z0) / cell))
  const gz1 = clampNode(Math.ceil((Math.max(win.z0, win.z1) + margin - land.z0) / cell))
  const step = Math.max(1, Math.ceil(Math.max(gx1 - gx0, gz1 - gz0) / Math.max(2, maxNodes - 1)))
  const cols = Math.max(2, Math.floor((gx1 - gx0) / step) + 1)
  const rows = Math.max(2, Math.floor((gz1 - gz0) / step) + 1)
  const count = cols * rows
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  for (let r = 0; r < rows; r++) {
    const j = clampNode(gz0 + r * step)
    const jn = clampNode(j + step)
    const js = clampNode(j - step)
    for (let c = 0; c < cols; c++) {
      const i = clampNode(gx0 + c * step)
      const k = j * n + i
      const v = r * cols + c
      const height = g.ground[k] / 100
      pos[v * 3] = land.x0 + i * cell
      pos[v * 3 + 1] = height
      pos[v * 3 + 2] = -(land.z0 + j * cell)
      const ie = clampNode(i + step)
      const iw = clampNode(i - step)
      const dhdx = (g.ground[j * n + ie] - g.ground[j * n + iw]) / 100 / (Math.max(1, ie - iw) * cell)
      const dhdz = (g.ground[jn * n + i] - g.ground[js * n + i]) / 100 / (Math.max(1, jn - js) * cell)
      const nl = Math.hypot(dhdx, 1, dhdz)
      const lit = (-dhdx * SUN.x + SUN.y + dhdz * SUN.z) / nl
      const relief = Math.min(1.12, Math.max(0.7, 1 + 1.6 * (lit - SUN.y)))
      const cover = g.cover[k]
      let base: RGB = COVER_COLOR[cover] ?? COVER_COLOR[COVER.meadow]
      const dry = DRY[cover]
      if (dry) base = mix(base, dry, (g.tone[k] / 255) * 0.7)
      const canopy = g.canopy[k] / 255
      if (canopy > 0) base = shade(mix(base, CANOPY_FLOOR, canopy * 0.6), 1 - canopy * 0.2)
      const w = g.water[k]
      if (w && w > g.ground[k]) base = mix(BED, DEEP, Math.min(1, (w - g.ground[k]) / 400))
      col[v * 3] = base[0] * relief
      col[v * 3 + 1] = base[1] * relief
      col[v * 3 + 2] = base[2] * relief
    }
  }
  const cells = (cols - 1) * (rows - 1)
  const idx = new Uint32Array(cells * 6)
  let t = 0
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const a = r * cols + c
      const b = a + 1
      const d = a + cols
      const e = d + 1
      idx[t++] = a; idx[t++] = b; idx[t++] = d
      idx[t++] = b; idx[t++] = e; idx[t++] = d
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geometry.setIndex(new THREE.BufferAttribute(idx, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  const remap = new Int32Array(count).fill(-1)
  const wPos: number[] = []
  const wIdx: number[] = []
  const nodeOf = (c: number, r: number) => clampNode(gz0 + r * step) * n + clampNode(gx0 + c * step)
  const waterVert = (c: number, r: number): number => {
    const v = r * cols + c
    if (remap[v] < 0) {
      remap[v] = wPos.length / 3
      wPos.push(pos[v * 3], g.water[nodeOf(c, r)] / 100, pos[v * 3 + 2])
    }
    return remap[v]
  }
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const ka = nodeOf(c, r), kb = nodeOf(c + 1, r), kd = nodeOf(c, r + 1), ke = nodeOf(c + 1, r + 1)
      const wa = g.water[ka], wb = g.water[kb], wd = g.water[kd], we = g.water[ke]
      if (!wa || !wb || !wd || !we) continue
      if (wa <= g.ground[ka] && wb <= g.ground[kb] && wd <= g.ground[kd] && we <= g.ground[ke]) continue
      const a = waterVert(c, r), b = waterVert(c + 1, r), d = waterVert(c, r + 1), e = waterVert(c + 1, r + 1)
      wIdx.push(a, b, d, b, e, d)
    }
  }
  let water: THREE.BufferGeometry | null = null
  if (wIdx.length) {
    water = new THREE.BufferGeometry()
    water.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3))
    water.setIndex(wPos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(wIdx, 1) : new THREE.Uint16BufferAttribute(wIdx, 1))
    water.computeVertexNormals()
    water.computeBoundingSphere()
  }
  const extent: Box = {
    x0: land.x0 + clampNode(gx0) * cell,
    z0: land.z0 + clampNode(gz0) * cell,
    x1: land.x0 + clampNode(gx0 + (cols - 1) * step) * cell,
    z1: land.z0 + clampNode(gz0 + (rows - 1) * step) * cell,
  }
  return { geometry, water, extent, cols, rows, step, gx0, gz0 }
}

/** Earth-coloured sides round the cut edge of the terrain, down below the lowest point. */
function addSkirt(b: Builder, grid: TerrainGrid): void {
  const pos = grid.geometry.getAttribute('position') as THREE.BufferAttribute
  const { cols, rows } = grid
  let low = Infinity
  for (let v = 0; v < cols * rows; v++) low = Math.min(low, pos.getY(v))
  const floor = low - 6
  const edge = (list: number[], toward: V3) => {
    for (let k = 0; k + 1 < list.length; k++) {
      const a = list[k], c = list[k + 1]
      const pa: V3 = [pos.getX(a), pos.getY(a), pos.getZ(a)]
      const pc: V3 = [pos.getX(c), pos.getY(c), pos.getZ(c)]
      b.face([pa, pc, [pc[0], floor, pc[2]], [pa[0], floor, pa[2]]], toward, SKIRT)
    }
  }
  const south: number[] = [], north: number[] = [], west: number[] = [], east: number[] = []
  for (let c = 0; c < cols; c++) {
    south.push(c)
    north.push((rows - 1) * cols + c)
  }
  for (let r = 0; r < rows; r++) {
    west.push(r * cols)
    east.push(r * cols + cols - 1)
  }
  edge(south, [0, 0, 1])
  edge(north, [0, 0, -1])
  edge(west, [-1, 0, 0])
  edge(east, [1, 0, 0])
}

const ROAD_COLOR: Record<RoadKind, RGB> = {
  0: linear(0x3c3e41),
  1: linear(0x4a4c50),
  2: linear(0x5c5d5f),
  3: linear(0xa69878),
  4: linear(0xc8c5bc),
  5: linear(0x86694a),
}
const ROAD_LIFT: Record<RoadKind, number> = { 0: 0.068, 1: 0.064, 2: 0.06, 3: 0.058, 4: 0.14, 5: 0.056 }
const LOT_COLOR = linear(0x55575a)
const LOT_EDGE = linear(0x8e8c86)
const DECK = linear(0xa9a69e)
const PARAPET = linear(0xb8b4aa)

function ribbon(b: Builder, land: TelloLand, pts: number[], half: number, lift: number, color: RGB): void {
  const n = pts.length / 2
  if (n < 2) return
  const across = half > 2.6 ? 3 : 2
  const base = b.count
  for (let i = 0; i < n; i++) {
    const [tx, tz] = tangent(pts, i)
    const lx = -tz, lz = tx
    for (let k = 0; k < across; k++) {
      const o = half - (2 * half * k) / (across - 1)
      const x = pts[i * 2] + lx * o
      const z = pts[i * 2 + 1] + lz * o
      b.vert(T(x, land.heightAt(x, z) + lift, z), color)
    }
  }
  for (let i = 0; i + 1 < n; i++) {
    for (let k = 0; k + 1 < across; k++) {
      const a = base + i * across + k
      b.tri(a, a + 1, a + across, UP)
      b.tri(a + 1, a + across + 1, a + across, UP)
    }
  }
}

function addRoads(b: Builder, land: TelloLand, clip: Box): void {
  for (const road of land.doc.roads) {
    if (!road.p || road.p.length < 4) continue
    const half = Math.max(0.4, road.w / 2)
    if (!overlaps(ringBox(road.p), clip, half)) continue
    const kind = (road.k in ROAD_COLOR ? road.k : 1) as RoadKind
    const dense = resample(road.p, 3)
    for (const run of runsInside(dense, clip, Math.min(half, 3))) {
      ribbon(b, land, run, half, ROAD_LIFT[kind], ROAD_COLOR[kind])
      markings(b, land, run, half, kind, road.n)
    }
  }
}

const PAINT_WHITE = linear(0xe8e6df)
const PAINT_YELLOW = linear(0xe0b43a)
const LINED_STREETS = new Set(['West Montello Street', 'East Montello Street', 'Main Street'])

/** A painted stripe `offset` metres left of a line, `width` wide; `dash` metres on and `gap` off when dashed. */
function stripe(b: Builder, land: TelloLand, pts: number[], offset: number, width: number, lift: number, color: RGB, dash = 0, gap = 0): void {
  const n = pts.length / 2
  let along = 0
  let prev: [number, number, number, number] | null = null
  for (let i = 0; i < n; i++) {
    if (i > 0) along += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1])
    const on = !dash || along % (dash + gap) < dash
    const [tx, tz] = tangent(pts, i)
    const lx = -tz, lz = tx
    const x = pts[i * 2] + lx * offset, z = pts[i * 2 + 1] + lz * offset
    const ax = x + lx * width / 2, az = z + lz * width / 2, bx = x - lx * width / 2, bz = z - lz * width / 2
    const cur: [number, number, number, number] = [ax, az, bx, bz]
    if (prev && on) {
      const v0 = b.vert(T(prev[0], land.heightAt(prev[0], prev[1]) + lift, prev[1]), color)
      const v1 = b.vert(T(prev[2], land.heightAt(prev[2], prev[3]) + lift, prev[3]), color)
      const v2 = b.vert(T(ax, land.heightAt(ax, az) + lift, az), color)
      const v3 = b.vert(T(bx, land.heightAt(bx, bz) + lift, bz), color)
      b.tri(v0, v1, v2, UP)
      b.tri(v1, v3, v2, UP)
    }
    prev = cur
  }
}

/** Lane paint as the game draws it: highways get white edge lines and a broken yellow centre, the downtown streets a double yellow. */
function markings(b: Builder, land: TelloLand, pts: number[], half: number, kind: RoadKind, name: string): void {
  const lift = ROAD_LIFT[kind] + 0.012
  if (kind === 0 && half >= 3) {
    stripe(b, land, pts, half - 0.35, 0.12, lift, PAINT_WHITE)
    stripe(b, land, pts, -(half - 0.35), 0.12, lift, PAINT_WHITE)
    stripe(b, land, pts, 0, 0.12, lift, PAINT_YELLOW, 3, 9)
  } else if (kind === 1 && LINED_STREETS.has(name) && half >= 3) {
    stripe(b, land, pts, 0.1, 0.1, lift, PAINT_YELLOW)
    stripe(b, land, pts, -0.1, 0.1, lift, PAINT_YELLOW)
  }
}

function addLots(b: Builder, land: TelloLand, clip: Box): void {
  for (const lot of land.doc.lots) {
    if (!lot.p || lot.p.length < 6) continue
    const box = ringBox(lot.p)
    if (!overlaps(box, clip)) continue
    const ring = box.x0 >= clip.x0 && box.x1 <= clip.x1 && box.z0 >= clip.z0 && box.z1 <= clip.z1 ? lot.p : clipRing(lot.p, clip)
    if (ring.length < 6) continue
    const tris = triangulate(ring)
    if (!tris.length) continue
    const n = ring.length / 2
    const tops: number[] = []
    const grounds: number[] = []
    const base = b.count
    for (let i = 0; i < n; i++) {
      const x = ring[i * 2], z = ring[i * 2 + 1]
      const ground = land.groundAt(x, z)
      grounds.push(ground)
      tops.push(Math.max(lot.f, ground) + 0.04)
      b.vert(T(x, tops[i], z), LOT_COLOR)
    }
    for (let k = 0; k + 2 < tris.length; k += 3) b.tri(base + tris[k], base + tris[k + 1], base + tris[k + 2], UP)
    const ccw = signedArea(ring) > 0
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      if (tops[i] - grounds[i] < 0.08 && tops[j] - grounds[j] < 0.08) continue
      const ax = ring[i * 2], az = ring[i * 2 + 1], cx = ring[j * 2], cz = ring[j * 2 + 1]
      const dx = cx - ax, dz = cz - az
      const ox = ccw ? dz : -dz
      const oz = ccw ? -dx : dx
      b.face([T(ax, tops[i], az), T(cx, tops[j], cz), T(cx, grounds[j] - 0.3, cz), T(ax, grounds[i] - 0.3, az)], [ox, 0, -oz], LOT_EDGE)
    }
  }
}

/** A solid band along a polyline between lateral offsets `offL` and `offR` (left positive), from `bot` to `top`. */
function band(b: Builder, pts: number[], offL: number, offR: number, top: number, bot: number, c: RGB, bottom: boolean): void {
  const n = pts.length / 2
  if (n < 2) return
  const L: [number, number][] = []
  const R: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const [tx, tz] = tangent(pts, i)
    const lx = -tz, lz = tx
    L.push([pts[i * 2] + lx * offL, pts[i * 2 + 1] + lz * offL])
    R.push([pts[i * 2] + lx * offR, pts[i * 2 + 1] + lz * offR])
  }
  const row = (side: [number, number][], y: number) => {
    const at = b.count
    for (const p of side) b.vert(T(p[0], y, p[1]), c)
    return at
  }
  const strip = (a0: number, b0: number, toward: (i: number) => V3) => {
    for (let i = 0; i + 1 < n; i++) {
      const t = toward(i)
      b.tri(a0 + i, b0 + i, a0 + i + 1, t)
      b.tri(b0 + i, b0 + i + 1, a0 + i + 1, t)
    }
  }
  const lt = row(L, top), rt = row(R, top)
  strip(lt, rt, () => UP)
  if (bottom) {
    const lb = row(L, bot), rb = row(R, bot)
    strip(lb, rb, () => DOWN)
  }
  const sideL = (i: number): V3 => {
    const [tx, tz] = tangent(pts, i)
    return [-tz, 0, -tx]
  }
  const sideR = (i: number): V3 => {
    const [tx, tz] = tangent(pts, i)
    return [tz, 0, tx]
  }
  const lb2 = row(L, bot), lt2 = row(L, top)
  strip(lb2, lt2, sideL)
  const rb2 = row(R, bot), rt2 = row(R, top)
  strip(rb2, rt2, sideR)
  const [t0x, t0z] = tangent(pts, 0)
  const [t1x, t1z] = tangent(pts, n - 1)
  b.face([T(L[0][0], bot, L[0][1]), T(R[0][0], bot, R[0][1]), T(R[0][0], top, R[0][1]), T(L[0][0], top, L[0][1])], [-t0x, 0, t0z], c)
  const e = n - 1
  b.face([T(L[e][0], bot, L[e][1]), T(R[e][0], bot, R[e][1]), T(R[e][0], top, R[e][1]), T(L[e][0], top, L[e][1])], [t1x, 0, -t1z], c)
}

function addBridges(b: Builder, land: TelloLand, clip: Box): void {
  for (const bridge of land.doc.bridges) {
    if (!bridge.p || bridge.p.length < 4) continue
    const half = bridge.w / 2 + (bridge.k <= 3 ? 0.9 : 0.35)
    if (!overlaps(ringBox(bridge.p), clip, half)) continue
    const dense = resample(bridge.p, 3)
    for (const run of runsInside(dense, clip, Math.min(half, 3))) {
      band(b, run, half, -half, bridge.y, bridge.y - 0.9, DECK, true)
      if (bridge.k <= 3) {
        band(b, run, half, half - 0.3, bridge.y + 0.85, bridge.y, PARAPET, false)
        band(b, run, -half + 0.3, -half, bridge.y + 0.85, bridge.y, PARAPET, false)
      }
    }
  }
}

const HOUSE_SIDING: RGB[] = [0xe8e4da, 0xd9d2c0, 0xc9cdd1, 0xb9c7d3, 0xe3d9b5, 0xc8b9a0, 0xd6d9cf].map(linear)
const WALL_COLOR: Record<BuildingKind, RGB> = {
  house: linear(0xe2ddd0),
  garage: linear(0xcfc8b8),
  shed: linear(0x9c7b58),
  store: linear(0xa65f45),
  industrial: linear(0xb4b8bb),
  civic: linear(0xb98d6b),
  church: linear(0xe6e1d6),
  canopy: linear(0xeeeeea),
}
const ROOF_PITCHED = linear(0x5d5a57)
const ROOF_FLAT = linear(0x8a8a86)
const POST_COLOR = linear(0x9a9a96)

function aerialRoof(hex: string): RGB | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  const v = parseInt(hex.slice(1), 16)
  const rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  const grey = (rgb[0] + rgb[1] + rgb[2]) / 3
  const out = rgb.map((c) => Math.round(Math.min(255, Math.max(0, (grey + (c - grey) * 1.25) * 0.8))))
  return linear((out[0] << 16) | (out[1] << 8) | out[2])
}

interface Rect { cx: number; cz: number; hx: number; hz: number; ux: number; uz: number; vx: number; vz: number; type: number; eave: number; ridge: number }

function rectsOf(b: BuildingData): Rect[] {
  const flatKind = b.k === 'store' || b.k === 'civic' || (b.k === 'industrial' && b.r.length > 1)
  const pitch = b.k === 'industrial' ? 0.2 : b.k === 'shed' ? 0.42 : b.k === 'garage' ? 0.5 : b.k === 'church' ? 1.0 : 0.6
  const out: Rect[] = []
  for (const r of b.r) {
    if (!r || r.length < 5 || !(r[2] > 0) || !(r[3] > 0)) continue
    const c = Math.cos(r[4]), s = Math.sin(r[4])
    let type = r[5] ?? ROOF.unmeasured
    let eave = r[6] ?? b.h
    let ridge = r[7] ?? eave
    if (type === ROOF.unmeasured || !(eave > 0)) {
      eave = b.h > 0 ? b.h : 3
      type = flatKind ? ROOF.flat : r[2] >= r[3] ? ROOF.gableFirst : ROOF.gableSecond
      ridge = flatKind ? eave : eave + Math.min(r[2], r[3]) * pitch
    }
    out.push({ cx: r[0], cz: r[1], hx: r[2], hz: r[3], ux: c, uz: s, vx: -s, vz: c, type, eave, ridge })
  }
  return out
}

/** True when the rectangle's centre is in the box and none of it reaches more than 10 m past it. */
function fits(r: Rect, clip: Box): boolean {
  if (!within(clip, r.cx, r.cz, 1)) return false
  const ex = Math.abs(r.ux) * r.hx + Math.abs(r.vx) * r.hz
  const ez = Math.abs(r.uz) * r.hx + Math.abs(r.vz) * r.hz
  return r.cx - ex >= clip.x0 - 10 && r.cx + ex <= clip.x1 + 10 && r.cz - ez >= clip.z0 - 10 && r.cz + ez <= clip.z1 + 10
}

function at(r: Rect, u: number, v: number, y: number): V3 {
  return T(r.cx + r.ux * u + r.vx * v, y, r.cz + r.uz * u + r.vz * v)
}

function outward(r: Rect, p: V3, up = 0): V3 {
  return [p[0] - r.cx, up, p[2] + r.cz]
}

function rectWalls(b: Builder, r: Rect, bottom: number, top: number, c: RGB): void {
  const corners: [number, number][] = [[-r.hx, -r.hz], [r.hx, -r.hz], [r.hx, r.hz], [-r.hx, r.hz]]
  for (let i = 0; i < 4; i++) {
    const [u0, v0] = corners[i]
    const [u1, v1] = corners[(i + 1) % 4]
    const mid = at(r, (u0 + u1) / 2, (v0 + v1) / 2, 0)
    b.face([at(r, u0, v0, bottom), at(r, u1, v1, bottom), at(r, u1, v1, top), at(r, u0, v0, top)], outward(r, mid), c)
  }
}

function flatRoof(b: Builder, r: Rect, y: number, over: number, c: RGB): void {
  b.face([at(r, -r.hx - over, -r.hz - over, y), at(r, r.hx + over, -r.hz - over, y), at(r, r.hx + over, r.hz + over, y), at(r, -r.hx - over, r.hz + over, y)], UP, c)
}

function gableRoof(b: Builder, r: Rect, alongFirst: boolean, eave: number, ridge: number, over: number, roof: RGB, wall: RGB): void {
  const L = alongFirst ? r.hx : r.hz
  const W = alongFirst ? r.hz : r.hx
  const p = (along: number, across: number, y: number): V3 => (alongFirst ? at(r, along, across, y) : at(r, across, along, y))
  const fall = (ridge - eave) / Math.max(0.5, W)
  const low = eave - over * fall
  for (const side of [-1, 1]) {
    b.face([p(-L - over, side * (W + over), low), p(L + over, side * (W + over), low), p(L + over, 0, ridge), p(-L - over, 0, ridge)], outward(r, p(0, side, 0), 1.5), roof)
  }
  for (const end of [-1, 1]) {
    b.face([p(end * L, -W, eave), p(end * L, W, eave), p(end * L, 0, ridge)], outward(r, p(end, 0, 0)), wall)
  }
}

function hipRoof(b: Builder, r: Rect, eave: number, ridge: number, over: number, roof: RGB): void {
  const first = r.hx >= r.hz
  const L = first ? r.hx : r.hz
  const W = first ? r.hz : r.hx
  const p = (along: number, across: number, y: number): V3 => (first ? at(r, along, across, y) : at(r, across, along, y))
  const fall = (ridge - eave) / Math.max(0.5, W)
  const low = eave - over * fall
  const k = Math.max(0, L - W)
  for (const side of [-1, 1]) {
    b.face([p(-L - over, side * (W + over), low), p(L + over, side * (W + over), low), p(k, 0, ridge), p(-k, 0, ridge)], outward(r, p(0, side, 0), 1.5), roof)
  }
  for (const end of [-1, 1]) {
    b.face([p(end * (L + over), -(W + over), low), p(end * (L + over), W + over, low), p(end * k, 0, ridge)], outward(r, p(end, 0, 0), 1.5), roof)
  }
}

function shedRoof(b: Builder, r: Rect, eave: number, ridge: number, over: number, roof: RGB, wall: RGB): void {
  const acrossSecond = r.type === ROOF.shedPlusSecond || r.type === ROOF.shedMinusSecond
  const sign = r.type === ROOF.shedPlusSecond || r.type === ROOF.shedPlusFirst ? 1 : -1
  const L = acrossSecond ? r.hx : r.hz
  const W = acrossSecond ? r.hz : r.hx
  const p = (along: number, across: number, y: number): V3 => (acrossSecond ? at(r, along, across * sign, y) : at(r, across * sign, along, y))
  const fall = (ridge - eave) / (2 * Math.max(0.5, W))
  b.face([p(-L - over, -W - over, eave - over * fall), p(L + over, -W - over, eave - over * fall), p(L + over, W + over, ridge + over * fall), p(-L - over, W + over, ridge + over * fall)], UP, roof)
  b.face([p(-L, W, eave), p(L, W, eave), p(L, W, ridge), p(-L, W, ridge)], outward(r, p(0, 1, 0)), wall)
  for (const end of [-1, 1]) {
    b.face([p(end * L, -W, eave), p(end * L, W, eave), p(end * L, W, ridge)], outward(r, p(end, 0, 0)), wall)
  }
}

function addCanopy(b: Builder, land: TelloLand, data: BuildingData, rects: Rect[], wall: RGB): void {
  for (const r of rects) {
    const top = data.f + Math.max(4.6, data.m ? data.h : r.eave)
    const lo = top - 0.6
    const corners: [number, number][] = [[-r.hx, -r.hz], [r.hx, -r.hz], [r.hx, r.hz], [-r.hx, r.hz]]
    rectWalls(b, r, lo, top, wall)
    flatRoof(b, r, top, 0, wall)
    b.face([at(r, -r.hx, -r.hz, lo), at(r, r.hx, -r.hz, lo), at(r, r.hx, r.hz, lo), at(r, -r.hx, r.hz, lo)], DOWN, wall)
    for (const [u, v] of corners) {
      const pu = u * 0.75, pv = v * 0.75
      const x = r.cx + r.ux * pu + r.vx * pv
      const z = r.cz + r.uz * pu + r.vz * pv
      post(b, x, z, 0.22, land.groundAt(x, z) - 0.2, lo, POST_COLOR)
    }
  }
}

function addBuildings(b: Builder, land: TelloLand, clip: Box): number {
  let drawn = 0
  for (const data of land.doc.buildings) {
    if (data.x || !data.r || !data.r.length) continue
    if (!data.r.some((r) => r && within(clip, r[0], r[1], 1))) continue
    const rects = rectsOf(data).filter((r) => fits(r, clip))
    if (!rects.length) continue
    drawn++
    const wall = data.k === 'house' ? HOUSE_SIDING[Math.abs(data.s | 0) % HOUSE_SIDING.length] : WALL_COLOR[data.k] ?? WALL_COLOR.house
    if (data.k === 'canopy') {
      addCanopy(b, land, data, rects, wall)
      continue
    }
    const floor = data.f
    const bottom = Math.min(Number.isFinite(data.l) ? data.l : floor, floor) - 0.2
    const measured = data.rc ? aerialRoof(data.rc) : null
    for (const r of rects) {
      const top = floor + r.eave
      rectWalls(b, r, bottom, top, wall)
      const flat = r.type === ROOF.flat || r.ridge - r.eave < 0.1
      const roof = measured ?? (flat ? ROOF_FLAT : ROOF_PITCHED)
      if (flat) flatRoof(b, r, top, 0.08, roof)
      else if (r.type === ROOF.hip) hipRoof(b, r, top, floor + r.ridge, 0.3, roof)
      else if (r.type >= ROOF.shedPlusSecond) shedRoof(b, r, top, floor + r.ridge, 0.25, roof, wall)
      else gableRoof(b, r, r.type === ROOF.gableFirst, top, floor + r.ridge, 0.3, roof, wall)
    }
  }
  return drawn
}

const WALL_STYLE: Record<WallStyle, { body: RGB; pier: RGB; cap: RGB }> = {
  brick: { body: linear(0x8e3b2e), pier: linear(0x7f3328), cap: linear(0xb9b2a6) },
  stone: { body: linear(0x8a7d6b), pier: linear(0x7a6e5d), cap: linear(0x9d917f) },
  block: { body: linear(0xbdbab3), pier: linear(0xaeaba4), cap: linear(0xcfccc5) },
  wood: { body: linear(0x7a5534), pier: linear(0x6a4a2d), cap: linear(0x86603d) },
  iron: { body: linear(0x1e1f22), pier: linear(0x8e3b2e), cap: linear(0x2a2b2e) },
}
const POLE = linear(0x3a3d40)
const ACORN_POLE = linear(0x1f2b26)
const RAIL = linear(0xa4a8ab)
const RAIL_POST = linear(0x7d8184)
const GLOW: RGB = [1, 1, 1]

function addWalls(b: Builder, land: TelloLand, clip: Box, walls: WorldExtras['walls']): void {
  for (const w of walls) {
    if (!w.pts || w.pts.length < 4) continue
    const pts = w.closed ? [...w.pts, w.pts[0], w.pts[1]] : w.pts
    if (!overlaps(ringBox(pts), clip)) continue
    const style = WALL_STYLE[w.style] ?? WALL_STYLE.block
    const iron = w.style === 'iron'
    const wood = w.style === 'wood'
    const half = iron ? 0.025 : Math.max(0.04, w.th / 2)
    const h = Math.max(0.2, w.h)
    const pillarHalf = iron ? 0.22 : wood ? 0.07 : Math.max(half * 1.6, 0.18)
    const pillar = (x: number, z: number) => {
      if (!within(clip, x, z)) return
      const g = land.heightAt(x, z)
      post(b, x, z, pillarHalf, g - 0.3, g + h + (wood ? 0.05 : 0.15), style.pier)
    }
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.05) continue
      if (!overlaps({ x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) }, clip)) continue
      const pieces = Math.max(1, Math.ceil(len / 4))
      for (let i = 0; i < pieces; i++) {
        const x0 = ax + ((bx - ax) * i) / pieces, z0 = az + ((bz - az) * i) / pieces
        const x1 = ax + ((bx - ax) * (i + 1)) / pieces, z1 = az + ((bz - az) * (i + 1)) / pieces
        if (!within(clip, (x0 + x1) / 2, (z0 + z1) / 2)) continue
        const g0 = land.heightAt(x0, z0), g1 = land.heightAt(x1, z1)
        prism(b, x0, z0, x1, z1, half, g0 - 0.3, g0 + h, g1 - 0.3, g1 + h, style.body)
        if (w.cap && !iron) prism(b, x0, z0, x1, z1, half + 0.04, g0 + h, g0 + h + 0.08, g1 + h, g1 + h + 0.08, style.cap)
      }
      if (w.posts > 0) for (let t = w.posts; t < len - 0.5; t += w.posts) pillar(ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len)
    }
    const corners = w.closed ? w.pts.length / 2 : pts.length / 2
    for (let i = 0; i < corners; i++) pillar(w.pts[i * 2], w.pts[i * 2 + 1])
  }
}

function addLights(b: Builder, glow: Builder, land: TelloLand, clip: Box, lights: WorldExtras['lights']): void {
  for (const l of lights) {
    if (!within(clip, l.x, l.z)) continue
    const g = land.heightAt(l.x, l.z)
    const style: LightStyle = l.style
    const h = Math.max(2, l.h)
    const top = g + h
    if (style === 'acorn') {
      post(b, l.x, l.z, 0.08, g - 0.2, top, ACORN_POLE)
      post(glow, l.x, l.z, 0.2, top, top + 0.5, GLOW)
      post(b, l.x, l.z, 0.12, top + 0.5, top + 0.62, ACORN_POLE)
      continue
    }
    post(b, l.x, l.z, 0.1, g - 0.2, top, POLE)
    const arms = style === 'double' ? [l.yaw, l.yaw + Math.PI] : [l.yaw]
    const reach = style === 'cobra' ? 1.8 : 0.9
    for (const yaw of arms) {
      const dx = Math.cos(yaw), dz = Math.sin(yaw)
      const ex = l.x + dx * reach, ez = l.z + dz * reach
      prism(b, l.x, l.z, ex, ez, 0.05, top - 0.12, top, top - 0.12, top, POLE)
      prism(glow, ex - dx * 0.35, ez - dz * 0.35, ex + dx * 0.35, ez + dz * 0.35, 0.2, top - 0.28, top - 0.06, top - 0.28, top - 0.06, GLOW, true)
    }
  }
}

function addRails(b: Builder, land: TelloLand, clip: Box, rails: WorldExtras['rails']): void {
  for (const rail of rails) {
    if (!rail.pts || rail.pts.length < 4) continue
    if (!overlaps(ringBox(rail.pts), clip)) continue
    const dense = resample(rail.pts, 2)
    for (const run of runsInside(dense, clip, 0)) {
      const n = run.length / 2
      for (let i = 0; i < n; i++) {
        const x = run[i * 2], z = run[i * 2 + 1]
        const [tx, tz] = tangent(run, i)
        const px = x + -tz * rail.side * 0.18
        const pz = z + tx * rail.side * 0.18
        const g = land.heightAt(px, pz)
        post(b, px, pz, 0.07, g - 0.2, g + 0.7, RAIL_POST)
        if (i + 1 < n) {
          const x1 = run[i * 2 + 2], z1 = run[i * 2 + 3]
          const g0 = land.heightAt(x, z), g1 = land.heightAt(x1, z1)
          prism(b, x, z, x1, z1, 0.05, g0 + 0.45, g0 + 0.78, g1 + 0.45, g1 + 0.78, RAIL)
        }
      }
    }
  }
}

interface Parts { pos: number[]; nor: number[]; col: number[]; idx: number[] }

function addPart(out: Parts, g: THREE.BufferGeometry, sx: number, sy: number, sz: number, ty: number, c: RGB): void {
  const p = g.getAttribute('position')
  const nn = g.getAttribute('normal')
  const index = g.getIndex()
  const base = out.pos.length / 3
  for (let i = 0; i < p.count; i++) {
    out.pos.push(p.getX(i) * sx, p.getY(i) * sy + ty, p.getZ(i) * sz)
    const nx = nn.getX(i) / sx, ny = nn.getY(i) / sy, nz = nn.getZ(i) / sz
    const l = Math.hypot(nx, ny, nz) || 1
    out.nor.push(nx / l, ny / l, nz / l)
    out.col.push(c[0], c[1], c[2])
  }
  if (index) for (let k = 0; k < index.count; k++) out.idx.push(base + index.getX(k))
  else for (let k = 0; k < p.count; k++) out.idx.push(base + k)
  g.dispose()
}

function partsGeometry(parts: Parts): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts.pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(parts.nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(parts.col, 3))
  g.setIndex(new THREE.Uint16BufferAttribute(parts.idx, 1))
  g.computeBoundingSphere()
  return g
}

/** Unit-height trees standing on y = 0: pine, hardwood, birch. */
function treeGeometries(): THREE.BufferGeometry[] {
  const trunk = linear(0x5a4030)
  const pine: Parts = { pos: [], nor: [], col: [], idx: [] }
  addPart(pine, new THREE.CylinderGeometry(0.035, 0.045, 0.25, 5, 1, true), 1, 1, 1, 0.125, trunk)
  addPart(pine, new THREE.ConeGeometry(0.22, 0.6, 7, 1, true), 1, 1, 1, 0.15 + 0.3, linear(0x2f4a2c))
  addPart(pine, new THREE.ConeGeometry(0.15, 0.55, 7, 1, true), 1, 1, 1, 0.45 + 0.275, linear(0x36532f))
  const hardwood: Parts = { pos: [], nor: [], col: [], idx: [] }
  addPart(hardwood, new THREE.CylinderGeometry(0.035, 0.05, 0.4, 5, 1, true), 1, 1, 1, 0.2, trunk)
  addPart(hardwood, new THREE.SphereGeometry(1, 8, 6), 0.34, 0.34, 0.34, 0.66, linear(0x4c6b33))
  const birch: Parts = { pos: [], nor: [], col: [], idx: [] }
  addPart(birch, new THREE.CylinderGeometry(0.025, 0.035, 0.45, 5, 1, true), 1, 1, 1, 0.225, linear(0xd8d4c8))
  addPart(birch, new THREE.SphereGeometry(1, 8, 6), 0.24, 0.36, 0.24, 0.64, linear(0x6f8f45))
  return [partsGeometry(pine), partsGeometry(hardwood), partsGeometry(birch)]
}

function pickTrees(land: TelloLand, clip: Box, cx: number, cz: number, cap: number): Uint32Array {
  const g = land.grids
  const units = treeUnits(land.frame)
  const total = g.treeX.length
  let found = new Uint32Array(4096)
  let count = 0
  const ux0 = (clip.x0 - land.x0) * units, ux1 = (clip.x1 - land.x0) * units
  const uz0 = (clip.z0 - land.z0) * units, uz1 = (clip.z1 - land.z0) * units
  for (let i = 0; i < total; i++) {
    const tx = g.treeX[i]
    if (tx < ux0 || tx > ux1) continue
    const tz = g.treeZ[i]
    if (tz < uz0 || tz > uz1) continue
    if (count === found.length) {
      const grown = new Uint32Array(found.length * 2)
      grown.set(found)
      found = grown
    }
    found[count++] = i
  }
  if (count <= cap) return found.subarray(0, count)
  const dist = new Float32Array(count)
  let far = 0
  for (let k = 0; k < count; k++) {
    const i = found[k]
    const d = Math.hypot(land.x0 + g.treeX[i] / units - cx, land.z0 + g.treeZ[i] / units - cz)
    dist[k] = d
    if (d > far) far = d
  }
  const bins = 1024
  const hist = new Uint32Array(bins)
  const binOf = (d: number) => Math.min(bins - 1, Math.floor((d / (far || 1)) * bins))
  for (let k = 0; k < count; k++) hist[binOf(dist[k])]++
  let edge = 0
  let taken = 0
  while (edge < bins && taken + hist[edge] <= cap) taken += hist[edge++]
  let room = cap - taken
  const out = new Uint32Array(cap)
  let o = 0
  for (let k = 0; k < count; k++) {
    const bin = binOf(dist[k])
    if (bin < edge || (bin === edge && room-- > 0)) out[o++] = found[k]
  }
  return out.subarray(0, o)
}

function addTrees(group: THREE.Group, land: TelloLand, clip: Box, cx: number, cz: number, cap: number, material: THREE.Material, owned: { geometries: THREE.BufferGeometry[]; instanced: THREE.InstancedMesh[] }): { trees: number; triangles: number } {
  const chosen = pickTrees(land, clip, cx, cz, cap)
  if (!chosen.length) return { trees: 0, triangles: 0 }
  const g = land.grids
  const units = treeUnits(land.frame)
  const perKind = [0, 0, 0]
  for (let k = 0; k < chosen.length; k++) perKind[Math.min(2, g.treeS[chosen[k]] >> 6)]++
  const geos = treeGeometries()
  owned.geometries.push(...geos)
  const names = ['trees-pine', 'trees-hardwood', 'trees-birch']
  const meshes: (THREE.InstancedMesh | null)[] = []
  const filled = [0, 0, 0]
  for (let kind = 0; kind < 3; kind++) {
    if (!perKind[kind]) {
      meshes.push(null)
      continue
    }
    const mesh = new THREE.InstancedMesh(geos[kind], material, perKind[kind])
    mesh.name = names[kind]
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(perKind[kind] * 3), 3)
    meshes.push(mesh)
  }
  let triangles = 0
  for (let k = 0; k < chosen.length; k++) {
    const i = chosen[k]
    const kind = Math.min(2, g.treeS[i] >> 6)
    const mesh = meshes[kind]
    if (!mesh) continue
    const slot = filled[kind]++
    const x = land.x0 + g.treeX[i] / units
    const z = land.z0 + g.treeZ[i] / units
    const h = Math.max(2, g.treeH[i] / 4)
    const r1 = hash(i), r2 = hash(i + 7919)
    const wide = h * (0.85 + r1 * 0.3)
    const yaw = r2 * Math.PI * 2
    const c = Math.cos(yaw), s = Math.sin(yaw)
    const m = mesh.instanceMatrix.array as Float32Array
    const o = slot * 16
    m[o] = c * wide; m[o + 1] = 0; m[o + 2] = -s * wide; m[o + 3] = 0
    m[o + 4] = 0; m[o + 5] = h; m[o + 6] = 0; m[o + 7] = 0
    m[o + 8] = s * wide; m[o + 9] = 0; m[o + 10] = c * wide; m[o + 11] = 0
    m[o + 12] = x; m[o + 13] = land.groundAt(x, z); m[o + 14] = -z; m[o + 15] = 1
    const tint = mesh.instanceColor!.array as Float32Array
    const k3 = slot * 3
    const light = 0.82 + r2 * 0.3
    tint[k3] = light * (0.95 + r1 * 0.1)
    tint[k3 + 1] = light
    tint[k3 + 2] = light * (0.9 + (1 - r1) * 0.1)
  }
  for (let kind = 0; kind < 3; kind++) {
    const mesh = meshes[kind]
    if (!mesh) continue
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
    mesh.computeBoundingSphere()
    group.add(mesh)
    owned.instanced.push(mesh)
    triangles += (geos[kind].getIndex()!.count / 3) * mesh.count
  }
  return { trees: chosen.length, triangles }
}

/**
 * Builds a three.js group of the land inside `win`: terrain, water, roads, lots, bridges, buildings, trees and the
 * World Editor's walls, lights and rails. Pure: no DOM or WebGL; the caller adds `group` to a scene and calls
 * `dispose()` when it is replaced.
 */
export function buildPreviewScene(land: TelloLand, win: PreviewWindow, opts: PreviewOptions = {}): PreviewScene {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const margin = Math.max(0, opts.margin ?? 4)
  const maxNodes = Math.max(16, Math.floor(opts.maxNodes ?? 400))
  const maxTrees = Math.max(0, Math.floor(opts.maxTrees ?? 25000))
  const group = new THREE.Group()
  group.name = 'world-preview'
  const geometries: THREE.BufferGeometry[] = []
  const instanced: THREE.InstancedMesh[] = []
  const materials: THREE.Material[] = []
  let triangles = 0

  const landMat = new THREE.MeshLambertMaterial({ vertexColors: true })
  const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  const waterMat = new THREE.MeshPhongMaterial({ color: 0x3f7fae, specular: 0x5f7f99, shininess: 70, transparent: true, opacity: 0.78, depthWrite: false })
  const glowMat = new THREE.MeshLambertMaterial({ color: 0xfff4cf, emissive: 0xffd88a, emissiveIntensity: 1 })
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true })
  materials.push(landMat, roadMat, waterMat, glowMat, treeMat)

  const addMesh = (geometry: THREE.BufferGeometry | null, material: THREE.Material, name: string, order = 0) => {
    if (!geometry) return
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.renderOrder = order
    group.add(mesh)
    triangles += (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3
  }

  const grid = buildTerrain(land, win, margin, maxNodes)
  const clip = grid.extent
  addMesh(grid.geometry, landMat, 'terrain')
  addMesh(grid.water, waterMat, 'water', 2)

  const roads = new Builder()
  addRoads(roads, land, clip)
  addLots(roads, land, clip)
  addMesh(roads.geometry(), roadMat, 'roads', 1)

  const solids = new Builder()
  addSkirt(solids, grid)
  addBridges(solids, land, clip)
  const buildings = addBuildings(solids, land, clip)
  const glow = new Builder()
  const extras = land.doc.extras
  if (extras) {
    addWalls(solids, land, clip, extras.walls ?? [])
    addLights(solids, glow, land, clip, extras.lights ?? [])
    addRails(solids, land, clip, extras.rails ?? [])
  }
  addMesh(solids.geometry(), landMat, 'solids')
  addMesh(glow.geometry(), glowMat, 'lights')

  const cx = (win.x0 + win.x1) / 2
  const cz = (win.z0 + win.z1) / 2
  const trees = maxTrees > 0 ? addTrees(group, land, clip, cx, cz, maxTrees, treeMat, { geometries, instanced }) : { trees: 0, triangles: 0 }
  triangles += trees.triangles

  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now()
  let disposed = false
  return {
    group,
    stats: { triangles: Math.round(triangles), trees: trees.trees, buildings, ms: Math.round(ended - started) },
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      for (const mesh of instanced) mesh.dispose()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      group.clear()
    },
  }
}
