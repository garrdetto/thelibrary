/**
 * Where the county's trees, power poles and site signs stand, as a pure function of the layout and the terrain. Trees grow in
 * woodlots (low-frequency noise), along fencerows on a loose grid and as windbreaks round the crop fields, in a ring round
 * Millbrook, densely along the world's edge, and here and there alone in the pasture; never inside a site grown 15 m, a lot at
 * its largest (every land strip bought) grown 10 m, a field, or within reach of a road. Poles march along every rural road on one side, 46 m apart, skipping junctions,
 * sites and lots, with three sagging conductors between neighbours. Every site gets a name sign beside each road entrance.
 * Candidates sit on a world-aligned grid, so a chunk's props never depend on which chunks were loaded first, and a lower prop
 * density keeps a subset of the same trees. Renderer-free; matrices use Babylon's layout.
 */
import { SHOULDER, valueNoise } from '../../shared/Terrain'
import type { Terrain } from '../../shared/Terrain'
import { CHUNK_SIZE, FIELDS, LOTS, MAX_LAND_STRIPS, SITES, WORLD_HALF, lotExtent } from '../../shared/WorldLayout'
import type { Site } from '../../shared/WorldLayout'
import { getRoadNetwork, pointAt, projectOnPath } from './RoadsGeometry'
import type { RoadNetwork, RoadPath } from './RoadsGeometry'

export const SITE_CLEARANCE = 15
export const LOT_CLEARANCE = 10
export const TREE_ROAD_CLEARANCE = 5
export const POLE_SPACING = 46
export const POLE_OFFSET = 3.2
/** Conductor attachment points on a pole of scale 1: lateral offset along the crossarm and height. */
export const CONDUCTORS: readonly [number, number][] = [[-1.05, 9.38], [1.05, 9.38], [0, 10.32]]
export const WIRE_SAG = 0.015

const WOOD_CELL = 8
const SINGLE_CELL = 52
const TOWN_CELL = 13
const FENCEROW_SPACING = 384
const FENCEROW_STEP = 6.5
const WINDBREAK_STEP = 7
const WINDBREAK_OFFSET = 9
const TOWN = SITES.find((site) => site.kind === 'town') as Site

function hash(x: number, z: number, salt: number): number {
  let h = Math.imul(Math.floor(x * 7.31) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.floor(z * 7.31) + salt * 7919, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 0–1 woodland cover at (x, z): woodlots and the woods along the world's edge (also used to shade the grass under them). */
export function woodlandDensity(x: number, z: number, seed: number): number {
  const base = valueNoise(x, z, 560, seed + 61) * 0.65 + valueNoise(x + 211, z - 137, 190, seed + 62) * 0.35
  let density = smooth(0.34, 0.58, base)
  const edge = WORLD_HALF - Math.max(Math.abs(x), Math.abs(z))
  if (edge < 340) density = Math.max(density, 1 - smooth(70, 330, edge))
  return density
}

/** A growable list of thin instances: 16-float matrices and 4-float tints. */
export class InstanceBatch {
  matrices = new Float32Array(16 * 64)
  colors = new Float32Array(4 * 64)
  count = 0

  reset(): void {
    this.count = 0
  }

  /** Adds an instance scaled (sxz, sy, sxz), turned by `yaw`, tilted slightly by `tiltX`/`tiltZ`, standing at (x, y, z). */
  push(x: number, y: number, z: number, yaw: number, sxz: number, sy: number, r: number, g: number, b: number, tiltX = 0, tiltZ = 0): void {
    if ((this.count + 1) * 16 > this.matrices.length) {
      const matrices = new Float32Array(this.matrices.length * 2)
      matrices.set(this.matrices)
      this.matrices = matrices
      const colors = new Float32Array(this.colors.length * 2)
      colors.set(this.colors)
      this.colors = colors
    }
    composeMatrix(this.matrices, this.count * 16, x, y, z, yaw, sxz, sy, tiltX, tiltZ)
    const at = this.count * 4
    this.colors[at] = r
    this.colors[at + 1] = g
    this.colors[at + 2] = b
    this.colors[at + 3] = 1
    this.count++
  }

  /** Copies of the used part, sized for Babylon's thin-instance buffers. */
  takeMatrices(): Float32Array {
    return this.matrices.slice(0, this.count * 16)
  }

  takeColors(): Float32Array {
    return this.colors.slice(0, this.count * 4)
  }
}

/** Writes Babylon's world matrix for scale, then yaw-pitch-roll rotation, then translation. */
export function composeMatrix(out: Float32Array, at: number, x: number, y: number, z: number, yaw: number, sxz: number, sy: number, tiltX: number, tiltZ: number): void {
  const sinRoll = Math.sin(tiltZ * 0.5)
  const cosRoll = Math.cos(tiltZ * 0.5)
  const sinPitch = Math.sin(tiltX * 0.5)
  const cosPitch = Math.cos(tiltX * 0.5)
  const sinYaw = Math.sin(yaw * 0.5)
  const cosYaw = Math.cos(yaw * 0.5)
  const qx = cosYaw * sinPitch * cosRoll + sinYaw * cosPitch * sinRoll
  const qy = sinYaw * cosPitch * cosRoll - cosYaw * sinPitch * sinRoll
  const qz = cosYaw * cosPitch * sinRoll - sinYaw * sinPitch * cosRoll
  const qw = cosYaw * cosPitch * cosRoll + sinYaw * sinPitch * sinRoll
  const xx = qx * qx * 2
  const yy = qy * qy * 2
  const zz = qz * qz * 2
  const xy = qx * qy * 2
  const xz = qx * qz * 2
  const yz = qy * qz * 2
  const wx = qw * qx * 2
  const wy = qw * qy * 2
  const wz = qw * qz * 2
  out[at] = (1 - yy - zz) * sxz
  out[at + 1] = (xy + wz) * sxz
  out[at + 2] = (xz - wy) * sxz
  out[at + 3] = 0
  out[at + 4] = (xy - wz) * sy
  out[at + 5] = (1 - xx - zz) * sy
  out[at + 6] = (yz + wx) * sy
  out[at + 7] = 0
  out[at + 8] = (xz + wy) * sxz
  out[at + 9] = (yz - wx) * sxz
  out[at + 10] = (1 - xx - yy) * sxz
  out[at + 11] = 0
  out[at + 12] = x
  out[at + 13] = y
  out[at + 14] = z
  out[at + 15] = 1
}

export interface SignSpot {
  site: Site
  /** Index of the site in `SITES` (its slot in the sign atlas). */
  slot: number
  x: number
  y: number
  z: number
  /** Heading the board's face looks along (toward approaching traffic). */
  yaw: number
}

interface PoleSpot {
  x: number
  z: number
  y: number
  yaw: number
  /** Lateral unit vector (the crossarm's direction). */
  lateralX: number
  lateralZ: number
  valid: boolean
}

interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface ChunkProps {
  oak: InstanceBatch
  pine: InstanceBatch
  pole: InstanceBatch
  /** Conductors as flat runs of six numbers: a pole attachment point and the next pole's. */
  wires: number[]
  signs: SignSpot[]
}

/**
 * The tree trunks of a chunk as solid obstacles for the physics world, at the given prop density (so exactly the trees that are
 * drawn): oaks and pines, trunk radius from each tree's scale.
 */
export function chunkTreeObstacles(terrain: Terrain, chunkX: number, chunkZ: number, density: number): { x: number; z: number; radius: number; height: number }[] {
  const props = placeChunkProps(terrain, chunkX, chunkZ, density)
  const out: { x: number; z: number; radius: number; height: number }[] = []
  for (const [batch, trunk] of [[props.oak, 0.32], [props.pine, 0.24]] as const) {
    const m = batch.matrices
    for (let i = 0; i < batch.count; i++) {
      const o = i * 16
      const scale = Math.hypot(m[o], m[o + 1], m[o + 2])
      out.push({ x: m[o + 12], z: m[o + 14], radius: Math.min(0.7, Math.max(0.18, trunk * scale)), height: 4 })
    }
  }
  return out
}

export function createChunkProps(): ChunkProps {
  return { oak: new InstanceBatch(), pine: new InstanceBatch(), pole: new InstanceBatch(), wires: [], signs: [] }
}

function grownRect(x: number, z: number, w: number, d: number, margin: number): Rect {
  return { minX: x - w / 2 - margin, maxX: x + w / 2 + margin, minZ: z - d / 2 - margin, maxZ: z + d / 2 + margin }
}

const BLOCKERS: Rect[] = [
  ...SITES.map((site) => grownRect(site.x, site.z, site.w, site.d, SITE_CLEARANCE)),
  ...LOTS.map((spec) => {
    const lot = lotExtent(spec, MAX_LAND_STRIPS)
    return { minX: lot.x - LOT_CLEARANCE, maxX: lot.x + lot.w + LOT_CLEARANCE, minZ: lot.z - LOT_CLEARANCE, maxZ: lot.z + lot.d + LOT_CLEARANCE }
  }),
]
const FIELD_RECTS: Rect[] = FIELDS.map((field) => grownRect(field.x, field.z, field.w, field.d, 1.5))

function inside(rect: Rect, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ
}

/** True where no tree may stand: sites (+15 m), lots (+10 m), fields and near roads (trees past the world's edge are scenery). */
export function treeBlocked(terrain: Terrain, x: number, z: number, nearby: readonly Rect[] = BLOCKERS, fields: readonly Rect[] = FIELD_RECTS): boolean {
  for (const rect of nearby) if (inside(rect, x, z)) return true
  for (const rect of fields) if (inside(rect, x, z)) return true
  const road = terrain.roadAt(x, z)
  return !!road && road.distance < road.half + SHOULDER + TREE_ROAD_CLEARANCE
}

/** True inside a site grown 15 m or a fully grown lot grown 10 m. */
export function siteOrLotBlocked(x: number, z: number): boolean {
  for (const rect of BLOCKERS) if (inside(rect, x, z)) return true
  return false
}

interface PlacementCache {
  poles: PoleSpot[][]
  signs: SignSpot[]
}

const caches = new WeakMap<Terrain, PlacementCache>()

function buildPoleLine(path: RoadPath, network: RoadNetwork, terrain: Terrain): PoleSpot[] {
  const spots: PoleSpot[] = []
  if (path.road.kind === 'street') return spots
  const side = path.index % 2 === 0 ? 1 : -1
  const offset = path.half + SHOULDER + POLE_OFFSET
  const point = { x: 0, z: 0, dirX: 0, dirZ: 0, segment: 0 }
  const projection = { distance: 0, arc: 0, lateral: 0, dirX: 0, dirZ: 0 }
  const count = Math.floor((path.length - 12) / POLE_SPACING)
  for (let k = 0; k <= count; k++) {
    const s = 12 + k * POLE_SPACING
    if (s > path.length - 6 && !path.loop) break
    pointAt(path, s, point)
    const lateralX = point.dirZ * side
    const lateralZ = -point.dirX * side
    const x = point.x + lateralX * offset
    const z = point.z + lateralZ * offset
    let valid = !siteOrLotBlocked(x, z) && Math.abs(x) < WORLD_HALF - 8 && Math.abs(z) < WORLD_HALF - 8
    if (valid) {
      for (const other of network.paths) {
        if (other === path) continue
        if (x < other.minX - 40 || x > other.maxX + 40 || z < other.minZ - 40 || z > other.maxZ + 40) continue
        if (projectOnPath(other, x, z, projection).distance < other.half + SHOULDER + 9) {
          valid = false
          break
        }
      }
    }
    for (const rect of FIELD_RECTS) if (valid && inside(rect, x, z)) valid = false
    spots.push({ x, z, y: valid ? terrain.heightAt(x, z) : 0, yaw: Math.atan2(-lateralZ, lateralX), lateralX, lateralZ, valid })
  }
  return spots
}

function siteEntrances(site: Site, network: RoadNetwork): { x: number; z: number; outX: number; outZ: number; path: RoadPath }[] {
  const rect = grownRect(site.x, site.z, site.w, site.d, 1)
  const found: { x: number; z: number; outX: number; outZ: number; path: RoadPath }[] = []
  const throughOnly = site.kind === 'town' || site.kind === 'lotDistrict'
  const point = { x: 0, z: 0, dirX: 0, dirZ: 0, segment: 0 }
  for (const path of network.paths) {
    if (throughOnly && path.road.kind !== 'road' && path.road.kind !== 'highway') continue
    if (path.maxX < rect.minX || path.minX > rect.maxX || path.maxZ < rect.minZ || path.minZ > rect.maxZ) continue
    let wasInside = inside(rect, pointAt(path, 0, point).x, point.z)
    for (let s = 1; s <= path.length; s += 1) {
      pointAt(path, s, point)
      const now = inside(rect, point.x, point.z)
      if (now !== wasInside) {
        const sign = now ? -1 : 1
        found.push({ x: point.x, z: point.z, outX: point.dirX * sign, outZ: point.dirZ * sign, path })
      }
      wasInside = now
    }
  }
  if (throughOnly || found.length === 0) return found
  found.sort((a, b) => b.path.rank - a.path.rank)
  return [found[0]]
}

function buildSigns(network: RoadNetwork, terrain: Terrain): SignSpot[] {
  const signs: SignSpot[] = []
  SITES.forEach((site, slot) => {
    for (const entrance of siteEntrances(site, network)) {
      const forwardX = -entrance.outX
      const forwardZ = -entrance.outZ
      const rightX = -forwardZ
      const rightZ = forwardX
      const reach = entrance.path.half + SHOULDER + 2.4
      const x = entrance.x + entrance.outX * 9 + rightX * reach
      const z = entrance.z + entrance.outZ * 9 + rightZ * reach
      signs.push({ site, slot, x, z, y: terrain.heightAt(x, z), yaw: Math.atan2(entrance.outX, entrance.outZ) })
    }
  })
  return signs
}

function cacheFor(terrain: Terrain): PlacementCache {
  let cache = caches.get(terrain)
  if (!cache) {
    const network = getRoadNetwork()
    cache = { poles: network.paths.map((path) => buildPoleLine(path, network, terrain)), signs: buildSigns(network, terrain) }
    caches.set(terrain, cache)
  }
  return cache
}

/** Every site sign in the county. */
export function allSignSpots(terrain: Terrain): readonly SignSpot[] {
  return cacheFor(terrain).signs
}

function treeTint(x: number, z: number, pine: boolean): [number, number, number] {
  const brightness = (pine ? 0.86 : 0.84) + hash(x, z, 21) * (pine ? 0.2 : 0.28)
  const hue = hash(x, z, 22) - 0.5
  if (!pine && hash(x, z, 23) < 0.06) return [brightness * 1.16, brightness * 1.02, brightness * 0.7]
  return [brightness * (1 + hue * 0.14), brightness, brightness * (1 - hue * 0.16)]
}

class ChunkPlanter {
  private readonly terrain: Terrain
  private readonly density: number
  private readonly out: ChunkProps
  private readonly blockers: Rect[]
  private readonly fields: Rect[]
  private readonly x0: number
  private readonly z0: number

  constructor(terrain: Terrain, chunkX: number, chunkZ: number, density: number, out: ChunkProps) {
    this.terrain = terrain
    this.density = density
    this.out = out
    this.x0 = chunkX * CHUNK_SIZE
    this.z0 = chunkZ * CHUNK_SIZE
    const bounds: Rect = { minX: this.x0 - 2, maxX: this.x0 + CHUNK_SIZE + 2, minZ: this.z0 - 2, maxZ: this.z0 + CHUNK_SIZE + 2 }
    const meets = (rect: Rect) => rect.minX <= bounds.maxX && rect.maxX >= bounds.minX && rect.minZ <= bounds.maxZ && rect.maxZ >= bounds.minZ
    this.blockers = BLOCKERS.filter(meets)
    this.fields = FIELD_RECTS.filter(meets)
  }

  owns(x: number, z: number): boolean {
    return x >= this.x0 && x < this.x0 + CHUNK_SIZE && z >= this.z0 && z < this.z0 + CHUNK_SIZE
  }

  tree(x: number, z: number, pine: boolean, scaleMin: number, scaleMax: number): void {
    if (!this.owns(x, z)) return
    if (hash(x, z, 97) >= this.density) return
    if (treeBlocked(this.terrain, x, z, this.blockers, this.fields)) return
    const y = this.terrain.heightAt(x, z) - 0.12
    const scale = scaleMin + hash(x, z, 31) * (scaleMax - scaleMin)
    const stretch = 0.9 + hash(x, z, 32) * 0.24
    const yaw = hash(x, z, 33) * Math.PI * 2
    const tiltX = (hash(x, z, 34) - 0.5) * 0.07
    const tiltZ = (hash(x, z, 35) - 0.5) * 0.07
    const [r, g, b] = treeTint(x, z, pine)
    ;(pine ? this.out.pine : this.out.oak).push(x, y, z, yaw, scale, scale * stretch, r, g, b, tiltX, tiltZ)
  }

  woods(): void {
    const seed = this.terrain.seed
    const cells = CHUNK_SIZE / WOOD_CELL
    for (let gz = 0; gz < cells; gz++) {
      for (let gx = 0; gx < cells; gx++) {
        const cx = this.x0 + gx * WOOD_CELL
        const cz = this.z0 + gz * WOOD_CELL
        const x = cx + hash(cx, cz, 1) * WOOD_CELL
        const z = cz + hash(cx, cz, 2) * WOOD_CELL
        const cover = woodlandDensity(x, z, seed)
        if (cover <= 0.02 || hash(cx, cz, 3) > cover * 0.8) continue
        const edge = WORLD_HALF - Math.max(Math.abs(x), Math.abs(z))
        const pine = hash(cx, cz, 4) < 0.12 + 0.22 * (1 - smooth(80, 320, edge))
        this.tree(x, z, pine, pine ? 0.8 : 0.78, pine ? 1.25 : 1.28)
      }
    }
  }

  singles(): void {
    const seed = this.terrain.seed
    const start = (value: number) => Math.ceil(value / SINGLE_CELL) * SINGLE_CELL
    for (let cz = start(this.z0); cz < this.z0 + CHUNK_SIZE; cz += SINGLE_CELL) {
      for (let cx = start(this.x0); cx < this.x0 + CHUNK_SIZE; cx += SINGLE_CELL) {
        if (hash(cx, cz, 5) > 0.1) continue
        const x = cx + hash(cx, cz, 6) * SINGLE_CELL
        const z = cz + hash(cx, cz, 7) * SINGLE_CELL
        if (woodlandDensity(x, z, seed) > 0.3) continue
        this.tree(x, z, hash(cx, cz, 8) < 0.06, 1.1, 1.5)
      }
    }
  }

  fencerows(): void {
    const seed = this.terrain.seed
    for (let axis = 0; axis < 2; axis++) {
      const lineMin = axis === 0 ? this.x0 : this.z0
      const alongMin = axis === 0 ? this.z0 : this.x0
      const firstLine = Math.floor((lineMin - 200) / FENCEROW_SPACING)
      const lastLine = Math.ceil((lineMin + CHUNK_SIZE + 200) / FENCEROW_SPACING)
      for (let k = firstLine; k <= lastLine; k++) {
        const position = k * FENCEROW_SPACING + 96 + (hash(k, axis, 9) - 0.5) * 70
        if (position < lineMin - 3 || position >= lineMin + CHUNK_SIZE + 3) continue
        const firstStep = Math.ceil(alongMin / FENCEROW_STEP)
        for (let j = firstStep; j * FENCEROW_STEP < alongMin + CHUNK_SIZE; j++) {
          const along = j * FENCEROW_STEP + (hash(j, k, 10 + axis) - 0.5) * 2.6
          if (valueNoise(along, k * 97 + axis * 31, 150, seed + 63) < -0.12) continue
          if (hash(j, k, 12 + axis) < 0.12) continue
          const across = position + (hash(j, k, 14 + axis) - 0.5) * 2.4
          const x = axis === 0 ? across : along
          const z = axis === 0 ? along : across
          this.tree(x, z, hash(j, k, 16 + axis) < 0.08, 0.75, 1.2)
        }
      }
    }
  }

  windbreaks(): void {
    FIELDS.forEach((field, index) => {
      const minX = field.x - field.w / 2 - WINDBREAK_OFFSET
      const maxX = field.x + field.w / 2 + WINDBREAK_OFFSET
      const minZ = field.z - field.d / 2 - WINDBREAK_OFFSET
      const maxZ = field.z + field.d / 2 + WINDBREAK_OFFSET
      if (maxX < this.x0 - 3 || minX > this.x0 + CHUNK_SIZE + 3 || maxZ < this.z0 - 3 || minZ > this.z0 + CHUNK_SIZE + 3) return
      const edges: [number, number, number, number][] = [[minX, minZ, maxX, minZ], [minX, maxZ, maxX, maxZ], [minX, minZ, minX, maxZ], [maxX, minZ, maxX, maxZ]]
      edges.forEach(([ax, az, bx, bz], edge) => {
        const length = Math.hypot(bx - ax, bz - az)
        const steps = Math.floor(length / WINDBREAK_STEP)
        for (let j = 0; j <= steps; j++) {
          if (hash(j, index * 4 + edge, 18) < 0.22) continue
          const t = j / Math.max(1, steps)
          const jitter = (hash(j, index * 4 + edge, 19) - 0.5) * 2
          const x = ax + (bx - ax) * t + (bz !== az ? jitter : 0)
          const z = az + (bz - az) * t + (bx !== ax ? jitter : 0)
          this.tree(x, z, hash(j, index * 4 + edge, 20) < 0.35, 0.8, 1.2)
        }
      })
    })
  }

  townRing(): void {
    const minX = TOWN.x - TOWN.w / 2
    const maxX = TOWN.x + TOWN.w / 2
    const minZ = TOWN.z - TOWN.d / 2
    const maxZ = TOWN.z + TOWN.d / 2
    if (this.x0 > maxX + 160 || this.x0 + CHUNK_SIZE < minX - 160 || this.z0 > maxZ + 160 || this.z0 + CHUNK_SIZE < minZ - 160) return
    const start = (value: number) => Math.ceil(value / TOWN_CELL) * TOWN_CELL
    for (let cz = start(this.z0); cz < this.z0 + CHUNK_SIZE; cz += TOWN_CELL) {
      for (let cx = start(this.x0); cx < this.x0 + CHUNK_SIZE; cx += TOWN_CELL) {
        const x = cx + hash(cx, cz, 24) * TOWN_CELL
        const z = cz + hash(cx, cz, 25) * TOWN_CELL
        const dx = Math.max(minX - x, 0, x - maxX)
        const dz = Math.max(minZ - z, 0, z - maxZ)
        const away = Math.hypot(dx, dz)
        const ring = smooth(SITE_CLEARANCE, SITE_CLEARANCE + 12, away) * (1 - smooth(70, 150, away))
        if (ring <= 0 || hash(cx, cz, 26) > ring * 0.42) continue
        this.tree(x, z, hash(cx, cz, 27) < 0.15, 0.85, 1.3)
      }
    }
  }

  poles(cache: PlacementCache): void {
    const network = getRoadNetwork()
    network.paths.forEach((path, pathIndex) => {
      const line = cache.poles[pathIndex]
      for (let k = 0; k < line.length; k++) {
        const spot = line[k]
        if (!spot.valid || !this.owns(spot.x, spot.z)) continue
        const scale = 0.96 + hash(spot.x, spot.z, 41) * 0.08
        const tone = 0.88 + hash(spot.x, spot.z, 42) * 0.2
        this.out.pole.push(spot.x, spot.y - 0.05, spot.z, spot.yaw, 1, scale, tone, tone, tone, (hash(spot.x, spot.z, 43) - 0.5) * 0.025, (hash(spot.x, spot.z, 44) - 0.5) * 0.025)
        const nextIndex = k + 1 < line.length ? k + 1 : path.loop ? 0 : -1
        if (nextIndex < 0 || nextIndex === k) continue
        const next = line[nextIndex]
        if (!next.valid) continue
        const nextScale = 0.96 + hash(next.x, next.z, 41) * 0.08
        for (const [lateral, height] of CONDUCTORS) {
          this.out.wires.push(
            spot.x + spot.lateralX * lateral, spot.y - 0.05 + height * scale, spot.z + spot.lateralZ * lateral,
            next.x + next.lateralX * lateral, next.y - 0.05 + height * nextScale, next.z + next.lateralZ * lateral,
          )
        }
      }
    })
  }

  signs(cache: PlacementCache): void {
    for (const sign of cache.signs) if (this.owns(sign.x, sign.z)) this.out.signs.push(sign)
  }
}

/** Fills `out` (reset first) with the props of chunk (chunkX, chunkZ) at tree density `density` (0–1). */
export function placeChunkProps(terrain: Terrain, chunkX: number, chunkZ: number, density: number, out: ChunkProps = createChunkProps()): ChunkProps {
  out.oak.reset()
  out.pine.reset()
  out.pole.reset()
  out.wires.length = 0
  out.signs.length = 0
  const cache = cacheFor(terrain)
  const planter = new ChunkPlanter(terrain, chunkX, chunkZ, density, out)
  planter.woods()
  planter.fencerows()
  planter.windbreaks()
  planter.townRing()
  planter.singles()
  planter.poles(cache)
  planter.signs(cache)
  return out
}
