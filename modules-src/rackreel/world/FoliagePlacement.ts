/** Renderer-free placement for grass and trees: the scatter hash, flat instance buffers (16-float matrices and 4-float tints), the grass chunk generator, and the wind weight the foliage shader applies. */
import { HIGHWAY, fbm, forestDensity, trailOffset } from './Terrain'
import type { Terrain } from './Terrain'

export function hash(x: number, z: number, salt: number): number {
  let h = Math.imul(Math.floor(x) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.floor(z) + salt * 7919, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

/** A growable Float32Array: instances are written straight into it and it is cut to size once. */
export class FloatBatch {
  data: Float32Array
  length = 0

  constructor(capacity = 256) {
    this.data = new Float32Array(capacity)
  }

  reset(): void {
    this.length = 0
  }

  /** Makes room for `floats` more values and returns where they start. */
  reserve(floats: number): number {
    const at = this.length
    const need = at + floats
    if (need > this.data.length) {
      let capacity = this.data.length * 2
      while (capacity < need) capacity *= 2
      const next = new Float32Array(capacity)
      next.set(this.data.subarray(0, at))
      this.data = next
    }
    this.length = need
    return at
  }

  toArray(): Float32Array {
    return this.data.slice(0, this.length)
  }
}

/** Writes the column-major world matrix for a scale, then a yaw-pitch-roll rotation (`tiltX` pitch, `yaw`, `tiltZ` roll), then a translation: the same matrix Babylon's `Matrix.Compose` builds. */
export function composeInstance(out: Float32Array, at: number, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, tiltX = 0, tiltZ = 0): void {
  const sr = Math.sin(tiltZ * 0.5)
  const cr = Math.cos(tiltZ * 0.5)
  const sp = Math.sin(tiltX * 0.5)
  const cp = Math.cos(tiltX * 0.5)
  const sw = Math.sin(yaw * 0.5)
  const cw = Math.cos(yaw * 0.5)
  const qx = cw * sp * cr + sw * cp * sr
  const qy = sw * cp * cr - cw * sp * sr
  const qz = cw * cp * sr - sw * sp * cr
  const qw = cw * cp * cr + sw * sp * sr
  const x2 = qx + qx
  const y2 = qy + qy
  const z2 = qz + qz
  const xx = qx * x2
  const xy = qx * y2
  const xz = qx * z2
  const yy = qy * y2
  const yz = qy * z2
  const zz = qz * z2
  const wx = qw * x2
  const wy = qw * y2
  const wz = qw * z2
  out[at] = (1 - (yy + zz)) * sx
  out[at + 1] = (xy + wz) * sx
  out[at + 2] = (xz - wy) * sx
  out[at + 3] = 0
  out[at + 4] = (xy - wz) * sy
  out[at + 5] = (1 - (xx + zz)) * sy
  out[at + 6] = (yz + wx) * sy
  out[at + 7] = 0
  out[at + 8] = (xz + wy) * sz
  out[at + 9] = (yz - wx) * sz
  out[at + 10] = (1 - (xx + yy)) * sz
  out[at + 11] = 0
  out[at + 12] = x
  out[at + 13] = y
  out[at + 14] = z
  out[at + 15] = 1
}

export type Rgb = readonly [number, number, number]

/** Writes an instance tint: `base` with a brightness and hue wobble of ±`spread` from the instance's own cell, and its 0..1 wind `phase` in alpha. */
export function writeTint(out: Float32Array, at: number, base: Rgb, cx: number, cz: number, salt: number, spread: number, phase: number): void {
  const light = 1 + (hash(cx, cz, salt) - 0.5) * 2 * spread
  out[at] = base[0] * light * (1 + (hash(cx, cz, salt + 1) - 0.5) * spread)
  out[at + 1] = base[1] * light * (1 + (hash(cx, cz, salt + 2) - 0.5) * spread * 0.6)
  out[at + 2] = base[2] * light * (1 + (hash(cx, cz, salt + 3) - 0.5) * spread)
  out[at + 3] = phase
}

/** How far a vertex at local height `y` follows the wind: 0 at and below `threshold` (roots stay put), rising with the square of the height to 1 at `threshold + range`. The foliage vertex shader uses the same curve. */
export function windWeight(y: number, threshold: number, range: number): number {
  const lift = Math.max(0, y - threshold) / range
  return lift * lift
}

/** How much of a grass clump is left at `distance` from the player: 1 inside `start`, shrinking smoothly into the ground by `end`. */
export function grassFade(distance: number, start: number, end: number): number {
  const t = Math.min(1, Math.max(0, (distance - start) / (end - start)))
  return 1 - t * t * (3 - 2 * t)
}

export const GRASS = {
  /** Side of one streamed chunk, metres. */
  chunk: 16,
  /** One candidate clump per cell; a chunk is `cells` of them across. */
  cells: 64,
  /** Clumps start shrinking here and are gone by `fadeEnd`. */
  fadeStart: 60,
  fadeEnd: 84,
  /** Chunks are dropped once their nearest corner is this far away. */
  release: 96,
  /** Spacing of the coarse lattice the slow terrain fields are sampled on. */
  lattice: 2,
  /** Full clumps inside `near`, fewer and wider blades to `mid`, fewest beyond. */
  near: 26,
  mid: 48,
  minHeight: 0.55,
  maxSlope: 0.85,
} as const

export const GRASS_CELLS = GRASS.cells
export const GRASS_CELL = GRASS.chunk / GRASS.cells
/** Most clumps one chunk can hold (open meadow fills about 78 % of its cells). */
export const GRASS_CHUNK_CAPACITY = Math.ceil(GRASS_CELLS * GRASS_CELLS * 0.84)
const LATTICE_NODES = Math.round(GRASS.chunk / GRASS.lattice) + 1
const KEY_OFFSET = 2048
const KEY_SPAN = 4096

export function grassChunkKey(cx: number, cz: number): number {
  return (cx + KEY_OFFSET) * KEY_SPAN + (cz + KEY_OFFSET)
}

/** Distance from (x, z) to the nearest point of chunk (cx, cz). */
export function grassChunkDistance(cx: number, cz: number, x: number, z: number): number {
  const dx = Math.max(cx * GRASS.chunk - x, 0, x - (cx + 1) * GRASS.chunk)
  const dz = Math.max(cz * GRASS.chunk - z, 0, z - (cz + 1) * GRASS.chunk)
  return Math.hypot(dx, dz)
}

export interface GrassHole {
  x: number
  z: number
  r: number
}

export interface GrassChunkData {
  matrices: Float32Array
  colors: Float32Array
  count: number
  minY: number
  maxY: number
}

const LUSH: Rgb = [0.66, 0.78, 0.58]
const DRY: Rgb = [1.18, 1.02, 0.6]

/** Fills one chunk's instance buffers. Forest density, the trail, the slope and the dry/lush patches are sampled on a 2 m lattice and interpolated; height, the highway and the keep-clear holes are exact for every clump. */
export class GrassBuilder {
  private readonly density = new Float32Array(LATTICE_NODES * LATTICE_NODES)
  private readonly trail = new Float32Array(LATTICE_NODES * LATTICE_NODES)
  private readonly patch = new Float32Array(LATTICE_NODES * LATTICE_NODES)
  private readonly slope = new Float32Array(LATTICE_NODES * LATTICE_NODES)
  private readonly near: GrassHole[] = []

  constructor(private readonly terrain: Terrain, private readonly holes: readonly GrassHole[]) {}

  build(cx: number, cz: number, out: GrassChunkData): void {
    const { terrain } = this
    const size = GRASS.chunk
    const x0 = cx * size
    const z0 = cz * size
    const n = LATTICE_NODES
    let any = false
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i * GRASS.lattice
        const z = z0 + j * GRASS.lattice
        const k = j * n + i
        if (terrain.heightAt(x, z) >= GRASS.minHeight - 0.4) any = true
        this.density[k] = forestDensity(x, z)
        this.trail[k] = trailOffset(x, z)
        this.patch[k] = fbm(x * 0.045 + 19, z * 0.045 - 7, 2, 57) + 0.5
        this.slope[k] = terrain.slopeAt(x, z)
      }
    }
    out.count = 0
    out.minY = Infinity
    out.maxY = -Infinity
    if (!any) return
    const near = this.near
    near.length = 0
    for (let i = 0; i < this.holes.length; i++) {
      const hole = this.holes[i]
      if (hole.x + hole.r > x0 && hole.x - hole.r < x0 + size && hole.z + hole.r > z0 && hole.z - hole.r < z0 + size) near.push(hole)
    }
    const cell = GRASS_CELL
    const cells = GRASS_CELLS
    const gx0 = cx * cells
    const gz0 = cz * cells
    const inv = 1 / GRASS.lattice
    const roadEdge = HIGHWAY.halfWidth + 1.5
    const roadClear = terrain.shape.roadClear
    const { matrices, colors } = out
    const capacity = Math.min(matrices.length >> 4, colors.length >> 2)
    let count = 0
    for (let j = 0; j < cells && count < capacity; j++) {
      const gz = gz0 + j
      for (let i = 0; i < cells && count < capacity; i++) {
        const gx = gx0 + i
        const x = (gx + hash(gx, gz, 21)) * cell
        const z = (gz + hash(gx, gz, 22)) * cell
        const h = terrain.heightAt(x, z)
        if (h < GRASS.minHeight) continue
        if (!terrain.inSquare(x, z) && !(terrain.shape.outside?.grassAt?.(x, z) ?? false)) continue
        const px = x - HIGHWAY.x
        const pz = z - HIGHWAY.z
        if (Math.abs(px * HIGHWAY.dz - pz * HIGHWAY.dx) < roadEdge) continue
        if (roadClear && roadClear(x, z) < 0.8) continue
        let clear = true
        for (let k = 0; k < near.length; k++) {
          const hole = near[k]
          const dx = hole.x - x
          const dz = hole.z - z
          if (dx * dx + dz * dz < hole.r * hole.r) {
            clear = false
            break
          }
        }
        if (!clear) continue
        const u = Math.min(n - 1.0001, Math.max(0, (x - x0) * inv))
        const v = Math.min(n - 1.0001, Math.max(0, (z - z0) * inv))
        const iu = Math.floor(u)
        const iv = Math.floor(v)
        const fu = u - iu
        const fv = v - iv
        const a = iv * n + iu
        const w00 = (1 - fu) * (1 - fv)
        const w10 = fu * (1 - fv)
        const w01 = (1 - fu) * fv
        const w11 = fu * fv
        if (this.slope[a] * w00 + this.slope[a + 1] * w10 + this.slope[a + n] * w01 + this.slope[a + n + 1] * w11 > GRASS.maxSlope) continue
        const density = this.density[a] * w00 + this.density[a + 1] * w10 + this.density[a + n] * w01 + this.density[a + n + 1] * w11
        const trail = this.trail[a] * w00 + this.trail[a + 1] * w10 + this.trail[a + n] * w01 + this.trail[a + n + 1] * w11
        const patch = Math.min(1, Math.max(0, this.patch[a] * w00 + this.patch[a + 1] * w10 + this.patch[a + n] * w01 + this.patch[a + n + 1] * w11))
        const open = 1 - density
        const want = (0.06 + 0.74 * open * open) * (trail < 2.4 ? 0.1 : 1) * (0.72 + patch * 0.28)
        if (hash(gx, gz, 23) > want) continue
        const scale = (0.42 + hash(gx, gz, 24) * 0.62) * (0.75 + patch * 0.45)
        const tall = scale * (0.8 + hash(gx, gz, 26) * 0.6)
        const y = h - 0.03
        composeInstance(matrices, count * 16, x, y, z, hash(gx, gz, 25) * 6.283, scale, tall, scale)
        const dry = Math.min(1, Math.max(0, patch * 1.6 - 0.45 + (hash(gx, gz, 27) - 0.5) * 0.6)) * (1 - density * 0.7)
        const light = 0.82 + hash(gx, gz, 28) * 0.36
        const c = count * 4
        colors[c] = (LUSH[0] + (DRY[0] - LUSH[0]) * dry) * light
        colors[c + 1] = (LUSH[1] + (DRY[1] - LUSH[1]) * dry) * light
        colors[c + 2] = (LUSH[2] + (DRY[2] - LUSH[2]) * dry) * light * (0.9 + hash(gx, gz, 29) * 0.2)
        colors[c + 3] = hash(gx, gz, 30)
        if (y < out.minY) out.minY = y
        if (y + tall * 0.6 > out.maxY) out.maxY = y + tall * 0.6
        count++
      }
    }
    out.count = count
  }
}

export type TreeKind = 'pine' | 'hardwood' | 'birch'

export const HARDWOOD_COLORS: readonly Rgb[] = [
  [0.48, 0.62, 0.26], [0.42, 0.56, 0.22], [0.55, 0.64, 0.28], [1.0, 0.52, 0.14], [0.95, 0.3, 0.1], [1.0, 0.78, 0.24], [0.86, 0.42, 0.12], [0.62, 0.66, 0.24],
]
export const BIRCH_COLORS: readonly Rgb[] = [[0.95, 0.86, 0.3], [0.7, 0.78, 0.3], [1.0, 0.72, 0.2]]
const PINE_COLOR: Rgb = [1, 1, 1]

/** The crown colour of the tree in cell (cx, cz): the same palette pick the stands have always used. */
export function crownColor(kind: TreeKind, cx: number, cz: number): Rgb {
  if (kind === 'hardwood') return HARDWOOD_COLORS[Math.floor(hash(cx, cz, 10) * HARDWOOD_COLORS.length)]
  if (kind === 'birch') return BIRCH_COLORS[Math.floor(hash(cx, cz, 10) * BIRCH_COLORS.length)]
  return PINE_COLOR
}

/** Splits an index list into blades (triangles that share vertices) and returns it reordered tallest blade first, with the index count after each blade, so drawing a prefix draws the most visible blades. */
export function orderBlades(positions: ArrayLike<number>, indices: ArrayLike<number>): { indices: Uint16Array; ends: number[] } {
  const vertices = positions.length / 3
  const weld = new Map<string, number>()
  const parent = new Int32Array(vertices)
  for (let i = 0; i < vertices; i++) {
    const key = `${positions[i * 3].toFixed(4)},${positions[i * 3 + 1].toFixed(4)},${positions[i * 3 + 2].toFixed(4)}`
    const first = weld.get(key)
    if (first === undefined) weld.set(key, i)
    parent[i] = first ?? i
  }
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t])
    const b = find(indices[t + 1])
    const c = find(indices[t + 2])
    parent[b] = a
    parent[c] = a
  }
  const blades = new Map<number, { top: number; triangles: number[] }>()
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t])
    let blade = blades.get(root)
    if (!blade) {
      blade = { top: -Infinity, triangles: [] }
      blades.set(root, blade)
    }
    blade.triangles.push(t)
    for (let k = 0; k < 3; k++) blade.top = Math.max(blade.top, positions[indices[t + k] * 3 + 1])
  }
  const order = [...blades.values()].sort((a, b) => b.top - a.top)
  const out = new Uint16Array(indices.length)
  const ends: number[] = []
  let at = 0
  for (const blade of order) {
    for (const t of blade.triangles) {
      out[at++] = indices[t]
      out[at++] = indices[t + 1]
      out[at++] = indices[t + 2]
    }
    ends.push(at)
  }
  return { indices: out, ends }
}
