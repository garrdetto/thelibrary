export const WORLD_SIZE = 1024
export const HALF = WORLD_SIZE / 2
export const GRID = 320
export const CELL = WORLD_SIZE / GRID
export const WATER_LEVEL = 0
export const PLAY_LIMIT = HALF - 34
export const LAKE_CENTER = { x: 10, z: 30 }

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 982451653)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function valueNoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1
}

export function fbm(x: number, z: number, octaves = 4, seed = 0): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 17) * amp
    freq *= 2.03
    amp *= 0.5
  }
  return sum
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function lakeRadius(angle: number): number {
  return 168 + 34 * Math.sin(angle * 3 + 1.1) + 22 * Math.sin(angle * 5 - 0.4) + 12 * Math.sin(angle * 9 + 2.0)
}

export function lakeCoord(x: number, z: number): { s: number; angle: number; radius: number } {
  const dx = x - LAKE_CENTER.x
  const dz = z - LAKE_CENTER.z
  const angle = Math.atan2(dz, dx)
  const radius = lakeRadius(angle)
  return { s: Math.hypot(dx, dz) / radius, angle, radius }
}

export function marshWeight(angle: number): number {
  const a = Math.atan2(Math.sin(angle - 2.3), Math.cos(angle - 2.3))
  return smoothstep(0.75, 0.15, Math.abs(a))
}

const ISLAND = { x: 70, z: -20, r: 26 }

export function trailOffset(x: number, z: number): number {
  const { s, radius } = lakeCoord(x, z)
  return Math.abs(s - 1.42) * radius
}

export function rawHeight(x: number, z: number): number {
  const { s, angle } = lakeCoord(x, z)
  const hills = fbm(x * 0.0042 + 3.1, z * 0.0042 - 1.7, 4, 1) * 34 + fbm(x * 0.016, z * 0.016, 3, 5) * 5
  const marsh = marshWeight(angle)
  let land = 3.2 + Math.max(-1.5, hills) * smoothstep(1.05, 1.9, s)
  land = land * (1 - marsh * smoothstep(2.0, 1.1, s)) + marsh * smoothstep(2.0, 1.1, s) * (0.35 + fbm(x * 0.05, z * 0.05, 2, 9) * 0.3)
  const floor = -1.2 - 15 * Math.pow(Math.max(0, 1 - s), 0.75) * (0.75 + 0.25 * fbm(x * 0.01, z * 0.01, 2, 3)) - fbm(x * 0.03, z * 0.03, 2, 4) * 1.4
  const shore = smoothstep(0.9, 1.12, s)
  let h = floor + (land - floor) * shore
  const di = Math.hypot(x - ISLAND.x, z - ISLAND.z) / ISLAND.r
  if (di < 1.6) h = Math.max(h, (1 - smoothstep(0.2, 1.3, di)) * 5.5 - 1.5 + fbm(x * 0.08, z * 0.08, 2, 11))
  const trail = trailOffset(x, z)
  if (s > 1.2 && trail < 6) h = h * (0.88 + 0.12 * smoothstep(1.5, 6, trail))
  const edge = Math.max(Math.abs(x), Math.abs(z))
  h += smoothstep(HALF - 90, HALF - 4, edge) * 42
  return h
}

export function forestDensity(x: number, z: number): number {
  const { s, angle } = lakeCoord(x, z)
  const patches = fbm(x * 0.0065 + 11, z * 0.0065 - 4, 3, 21) * 0.5 + 0.55
  const meadow = smoothstep(0.1, -0.25, fbm(x * 0.004 - 7, z * 0.004 + 2, 2, 31))
  const shore = smoothstep(1.12, 1.35, s)
  const marsh = 1 - marshWeight(angle) * smoothstep(2.0, 1.2, s) * 0.85
  const trail = smoothstep(3.5, 8, trailOffset(x, z))
  return Math.max(0, Math.min(1, patches * shore * marsh * trail * (1 - meadow * 0.75)))
}

export type Ground = 'water' | 'shore' | 'marsh' | 'meadow' | 'forest' | 'trail' | 'rock'

export class Terrain {
  readonly heights: Float32Array
  readonly verts = GRID + 1

  constructor() {
    this.heights = new Float32Array(this.verts * this.verts)
    for (let j = 0; j < this.verts; j++) {
      for (let i = 0; i < this.verts; i++) {
        this.heights[j * this.verts + i] = rawHeight(-HALF + i * CELL, -HALF + j * CELL)
      }
    }
  }

  heightAt(x: number, z: number): number {
    const gx = Math.min(GRID - 1e-4, Math.max(0, (x + HALF) / CELL))
    const gz = Math.min(GRID - 1e-4, Math.max(0, (z + HALF) / CELL))
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const fx = gx - i
    const fz = gz - j
    const v = this.verts
    const h00 = this.heights[j * v + i]
    const h10 = this.heights[j * v + i + 1]
    const h01 = this.heights[(j + 1) * v + i]
    const h11 = this.heights[(j + 1) * v + i + 1]
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
  }

  slopeAt(x: number, z: number): number {
    const e = CELL
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z)
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e)
    return Math.atan(Math.hypot(dx, dz) / (2 * e))
  }

  depthAt(x: number, z: number): number {
    return WATER_LEVEL - this.heightAt(x, z)
  }

  groundAt(x: number, z: number): Ground {
    const h = this.heightAt(x, z)
    if (h < -0.35) return 'water'
    const { s, angle } = lakeCoord(x, z)
    if (marshWeight(angle) > 0.4 && s < 1.9 && h < 1.4) return 'marsh'
    if (h < 0.9) return 'shore'
    if (s > 1.2 && trailOffset(x, z) < 3) return 'trail'
    if (this.slopeAt(x, z) > 0.62) return 'rock'
    return forestDensity(x, z) > 0.42 ? 'forest' : 'meadow'
  }
}
