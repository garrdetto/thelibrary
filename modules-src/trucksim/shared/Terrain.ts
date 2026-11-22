/**
 * The county's ground as a pure function of position: gentle rolling hills (grades of a few percent), fine detail that fades out
 * near roads and work sites, roads that follow the smooth surface, and flat pads under every site and Haulers Row.
 * Renderer-free and deterministic; the physics heightfields, the terrain meshes and the minimap all sample this.
 */
import { DISTRICT, FIELDS, ROADS, SITES, WORLD_HALF } from './WorldLayout'
import type { Road, RoadKind, Site } from './WorldLayout'

export type SurfaceKind = 'grass' | 'dirt' | 'gravel' | 'asphalt' | 'concrete' | 'field'

/** Tyre grip multiplier per surface (asphalt 1). */
export const SURFACE_GRIP: Record<SurfaceKind, number> = { asphalt: 1, concrete: 1, gravel: 0.82, dirt: 0.72, grass: 0.62, field: 0.55 }

export const PAD_BLEND = 60
export const DISTRICT_BLEND = 320
/** How far the smooth surface the roads follow is drawn toward each site's pad height. */
export const APPROACH = 240
export const SHOULDER = 1.6
const ROAD_REACH = 34
const CELL = 128

interface Segment {
  ax: number
  az: number
  bx: number
  bz: number
  half: number
  kind: RoadKind
  road: Road
}

interface Pad {
  x: number
  z: number
  hw: number
  hd: number
  height: number
  site: Site
}

export interface RoadHit {
  road: Road
  kind: RoadKind
  /** Distance from the road's centre line. */
  distance: number
  half: number
  /** Unit direction of the nearest segment. */
  dirX: number
  dirZ: number
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** Value noise in [-1, 1]. */
export function valueNoise(x: number, z: number, wavelength: number, seed: number): number {
  const fx = x / wavelength
  const fz = z / wavelength
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const tx = fade(fx - ix)
  const tz = fade(fz - iz)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  const top = a + (b - a) * tx
  const bottom = c + (d - c) * tx
  return (top + (bottom - top) * tz) * 2 - 1
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export class Terrain {
  private readonly segments: Segment[] = []
  private readonly grid = new Map<number, number[]>()
  private readonly pads: Pad[] = []
  private readonly districtHeight: number
  readonly seed: number

  constructor(seed = 1337) {
    this.seed = seed
    this.districtHeight = this.rawSmooth(DISTRICT.x, DISTRICT.z)
    for (const road of ROADS) {
      const pts = road.points
      const count = road.loop ? pts.length : pts.length - 1
      for (let i = 0; i < count; i++) {
        const [ax, az] = pts[i]
        const [bx, bz] = pts[(i + 1) % pts.length]
        this.addSegment({ ax, az, bx, bz, half: road.width / 2, kind: road.kind, road })
      }
    }
    for (const site of SITES) {
      if (site.kind === 'town') continue
      this.pads.push({ x: site.x, z: site.z, hw: site.w / 2, hd: site.d / 2, height: this.districtSmooth(site.x, site.z), site })
    }
  }

  private addSegment(segment: Segment): void {
    const index = this.segments.push(segment) - 1
    const reach = segment.half + ROAD_REACH
    const x0 = Math.floor((Math.min(segment.ax, segment.bx) - reach) / CELL)
    const x1 = Math.floor((Math.max(segment.ax, segment.bx) + reach) / CELL)
    const z0 = Math.floor((Math.min(segment.az, segment.bz) - reach) / CELL)
    const z1 = Math.floor((Math.max(segment.az, segment.bz) + reach) / CELL)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = cx * 4096 + cz
        const list = this.grid.get(key)
        if (list) list.push(index)
        else this.grid.set(key, [index])
      }
    }
  }

  private rawSmooth(x: number, z: number): number {
    const s = this.seed
    return 9 * valueNoise(x, z, 1150, s) + 3.6 * valueNoise(x + 311, z - 97, 610, s + 1) + 1.4 * valueNoise(x - 53, z + 211, 290, s + 2) + 8
  }

  private districtSmooth(x: number, z: number): number {
    const raw = this.rawSmooth(x, z)
    const dx = Math.max(Math.abs(x - DISTRICT.x) - DISTRICT.w / 2, 0)
    const dz = Math.max(Math.abs(z - DISTRICT.z) - DISTRICT.d / 2, 0)
    if (dx > DISTRICT_BLEND || dz > DISTRICT_BLEND) return raw
    const weight = 1 - smoothstep(0, DISTRICT_BLEND, Math.sqrt(dx * dx + dz * dz))
    return raw + (this.districtHeight - raw) * weight
  }

  /**
   * The low-frequency surface every road follows: levelled across the Haulers Row district and drawn toward each site's pad
   * height over `APPROACH` metres (a normalised weighted blend, so overlapping approaches stay continuous).
   */
  smoothAt(x: number, z: number): number {
    const base = this.districtSmooth(x, z)
    let sum = 0
    let pull = 0
    for (const pad of this.pads) {
      const dx = Math.max(Math.abs(x - pad.x) - pad.hw, 0)
      const dz = Math.max(Math.abs(z - pad.z) - pad.hd, 0)
      if (dx > APPROACH || dz > APPROACH) continue
      const weight = 1 - smoothstep(0, APPROACH, Math.sqrt(dx * dx + dz * dz))
      sum += weight
      pull += weight * (pad.height - base)
    }
    return sum > 0 ? base + pull / Math.max(1, sum) : base
  }

  private detailAt(x: number, z: number): number {
    const s = this.seed
    return 0.65 * valueNoise(x, z, 46, s + 3) + 0.16 * valueNoise(x, z, 13, s + 4)
  }

  /** Nearest road within reach of the point, or null. */
  roadAt(x: number, z: number): RoadHit | null {
    const list = this.grid.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL))
    if (!list) return null
    let best: Segment | null = null
    let bestDistance = Infinity
    let dirX = 0
    let dirZ = 1
    for (const index of list) {
      const s = this.segments[index]
      const ex = s.bx - s.ax
      const ez = s.bz - s.az
      const length2 = ex * ex + ez * ez
      const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * ex + (z - s.az) * ez) / length2)) : 0
      const px = s.ax + ex * t - x
      const pz = s.az + ez * t - z
      const distance = Math.sqrt(px * px + pz * pz) - s.half
      if (distance < bestDistance) {
        bestDistance = distance
        best = s
        const length = Math.sqrt(length2) || 1
        dirX = ex / length
        dirZ = ez / length
      }
    }
    if (!best || bestDistance > ROAD_REACH) return null
    return { road: best.road, kind: best.kind, distance: bestDistance + best.half, half: best.half, dirX, dirZ }
  }

  /** The site pad with the strongest pull at this point, and that pull (1 inside the pad, fading to 0 over `PAD_BLEND`). */
  padAt(x: number, z: number): { pad: Pad; weight: number; outside: number } | null {
    let best: Pad | null = null
    let bestWeight = 0
    let bestOutside = Infinity
    for (const pad of this.pads) {
      const dx = Math.max(Math.abs(x - pad.x) - pad.hw, 0)
      const dz = Math.max(Math.abs(z - pad.z) - pad.hd, 0)
      if (dx > PAD_BLEND || dz > PAD_BLEND) continue
      const outside = Math.sqrt(dx * dx + dz * dz)
      const weight = 1 - smoothstep(0, PAD_BLEND, outside)
      if (weight > bestWeight) {
        bestWeight = weight
        best = pad
        bestOutside = outside
      }
    }
    return best ? { pad: best, weight: bestWeight, outside: bestOutside } : null
  }

  heightAt(x: number, z: number): number {
    const smooth = this.smoothAt(x, z)
    const road = this.roadAt(x, z)
    const pad = this.padAt(x, z)
    const roadMask = road ? smoothstep(road.half + 3, road.half + 16, road.distance) : 1
    const padMask = pad ? smoothstep(0, 28, pad.outside) : 1
    const edge = Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 150 ? 1 + smoothstep(WORLD_HALF - 150, WORLD_HALF, Math.max(Math.abs(x), Math.abs(z))) * 6 : 1
    let h = smooth + this.detailAt(x, z) * roadMask * padMask * edge
    if (pad) h = h + (pad.pad.height - h) * pad.weight
    return h
  }

  /** Unit surface normal by central differences over `step` metres. */
  normalAt(x: number, z: number, step = 1): [number, number, number] {
    const hx = this.heightAt(x + step, z) - this.heightAt(x - step, z)
    const hz = this.heightAt(x, z + step) - this.heightAt(x, z - step)
    const nx = -hx
    const ny = 2 * step
    const nz = -hz
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
    return [nx / length, ny / length, nz / length]
  }

  surfaceAt(x: number, z: number): SurfaceKind {
    const road = this.roadAt(x, z)
    if (road && road.distance <= road.half) return road.kind === 'gravel' ? 'gravel' : 'asphalt'
    if (road && road.distance <= road.half + SHOULDER) return 'gravel'
    const pad = this.padAt(x, z)
    if (pad && pad.outside === 0) {
      switch (pad.pad.site.kind) {
        case 'dealership': case 'truckStop': case 'fuelStation': case 'coldStorage': case 'distribution': return 'asphalt'
        case 'elevator': case 'refinery': return 'concrete'
        case 'quarry': case 'equipmentYard': case 'buildingSupply': case 'steelMill': case 'lumberYard': case 'farm': return 'gravel'
        case 'construction': return 'dirt'
        default: break
      }
    }
    for (const field of FIELDS) {
      if (Math.abs(x - field.x) <= field.w / 2 && Math.abs(z - field.z) <= field.d / 2) return 'field'
    }
    return valueNoise(x, z, 70, this.seed + 9) > 0.62 ? 'dirt' : 'grass'
  }

  /**
   * Fills `out` with an n × n grid of heights covering the square from (x0, z0) to (x0 + size, z0 + size), row by row in z,
   * x varying fastest: `out[iz * n + ix] = heightAt(x0 + ix * size / (n - 1), z0 + iz * size / (n - 1))`.
   */
  sampleGrid(x0: number, z0: number, size: number, n: number, out = new Float32Array(n * n)): Float32Array {
    const step = size / (n - 1)
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) out[iz * n + ix] = this.heightAt(x0 + ix * step, z0 + iz * step)
    }
    return out
  }
}

let shared: Terrain | null = null

/** The one terrain every system samples. */
export function getTerrain(): Terrain {
  shared ??= new Terrain()
  return shared
}
