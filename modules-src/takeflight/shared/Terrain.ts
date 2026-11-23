/**
 * The region's ground, generated from a seed with deterministic value noise so the page, the terrain renderer and the Worker's
 * re-simulation agree to the bit. Rolling farmland around the airports, hills that rise toward a range in the north, river valleys
 * that fill with lakes below `WATER_LEVEL`, and every airport flattened to its field elevation with a smooth blend.
 */
import { AIRPORTS, pavementAt } from './Airports'
import type { Surface } from './Airports'
import { smoothstep } from '../sim/SimMath'
import { hash2 } from '../sim/SimMath'

export const WORLD_SEED = 0x7a6e31
export const WATER_LEVEL = 92
/** Half the side of the region the renderer draws, metres. */
export const REGION_HALF = 100000

export interface GroundSample {
  height: number
  /** Unit surface normal. */
  nx: number
  ny: number
  nz: number
  surface: Surface
}

export interface Ground {
  heightAt(x: number, z: number): number
  sample(x: number, z: number, out: GroundSample): GroundSample
}

export function createGroundSample(): GroundSample {
  return { height: 0, nx: 0, ny: 1, nz: 0, surface: 'grass' }
}

function lattice(ix: number, iz: number, seed: number): number {
  return hash2(ix, iz, seed) / 4294967296
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = fade(x - ix)
  const fz = fade(z - iz)
  const a = lattice(ix, iz, seed)
  const b = lattice(ix + 1, iz, seed)
  const c = lattice(ix, iz + 1, seed)
  const d = lattice(ix + 1, iz + 1, seed)
  const top = a + (b - a) * fx
  const bottom = c + (d - c) * fx
  return top + (bottom - top) * fz
}

function fbm(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0
  let amplitude = 0.5
  let frequency = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise(x * frequency, z * frequency, seed + o * 1013)
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2.03
  }
  return sum / norm
}

function ridged(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0
  let amplitude = 0.5
  let frequency = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(valueNoise(x * frequency, z * frequency, seed + o * 7919) * 2 - 1)
    sum += amplitude * n * n
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2.1
  }
  return sum / norm
}

/** Natural ground height before any airport is cut in. */
export function naturalHeight(x: number, z: number): number {
  const rolling = fbm(x / 7000, z / 7000, 6, WORLD_SEED)
  const detail = fbm(x / 900, z / 900, 3, WORLD_SEED + 77)
  const north = smoothstep(-6000, -30000, z)
  const range = ridged(x / 14000, z / 14000, 5, WORLD_SEED + 501)
  const valley = valueNoise(x / 16000, z / 16000, WORLD_SEED + 909)
  let h = 70 + rolling * 210 + detail * 18
  h += north * range * 1500
  h -= smoothstep(0.32, 0.12, valley) * 120
  return h
}

/** Blend weight (0..1) toward an airport's field elevation, 1 inside its flattened area. */
function airportWeight(x: number, z: number, out: { elevation: number }): number {
  let best = 0
  for (let a = 0; a < AIRPORTS.length; a++) {
    const airport = AIRPORTS[a]
    const dx = Math.abs(x - airport.x) - airport.halfX
    const dz = Math.abs(z - airport.z) - airport.halfZ
    const ox = dx > 0 ? dx : 0
    const oz = dz > 0 ? dz : 0
    const outside = Math.sqrt(ox * ox + oz * oz)
    const weight = 1 - smoothstep(0, airport.blend, outside)
    if (weight > best) {
      best = weight
      out.elevation = airport.elevation
    }
  }
  return best
}

const field = { elevation: 0 }

export function terrainHeight(x: number, z: number): number {
  const natural = naturalHeight(x, z)
  const weight = airportWeight(x, z, field)
  return weight > 0 ? natural + (field.elevation - natural) * weight : natural
}

const NORMAL_STEP = 4

export const TERRAIN: Ground = {
  heightAt: terrainHeight,
  sample(x, z, out) {
    const h = terrainHeight(x, z)
    const pavement = pavementAt(x, z)
    if (pavement) {
      out.height = h
      out.nx = 0
      out.ny = 1
      out.nz = 0
      out.surface = pavement
      return out
    }
    if (h < WATER_LEVEL) {
      out.height = WATER_LEVEL
      out.nx = 0
      out.ny = 1
      out.nz = 0
      out.surface = 'water'
      return out
    }
    const hx = terrainHeight(x + NORMAL_STEP, z) - terrainHeight(x - NORMAL_STEP, z)
    const hz = terrainHeight(x, z + NORMAL_STEP) - terrainHeight(x, z - NORMAL_STEP)
    const nx = -hx
    const ny = 2 * NORMAL_STEP
    const nz = -hz
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
    out.height = h
    out.nx = nx / length
    out.ny = ny / length
    out.nz = nz / length
    out.surface = 'grass'
    return out
  },
}

/** 0..1 woodland cover: patches on the hills, none on airport ground, water or steep rock. */
export function forestDensity(x: number, z: number): number {
  const patches = fbm(x / 2600, z / 2600, 4, WORLD_SEED + 31)
  const weight = airportWeight(x, z, field)
  return smoothstep(0.52, 0.62, patches) * (1 - smoothstep(0, 0.2, weight))
}

/** A per-field value 0..1 for the farmland patchwork: fields are about 350 m cells with jittered edges. */
export function fieldShade(x: number, z: number): number {
  const jx = x + (valueNoise(x / 180, z / 180, WORLD_SEED + 5) - 0.5) * 120
  const jz = z + (valueNoise(x / 180, z / 180, WORLD_SEED + 6) - 0.5) * 120
  return hash2(Math.floor(jx / 350), Math.floor(jz / 330), WORLD_SEED + 9) / 4294967296
}
