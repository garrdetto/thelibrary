/** The five lakes: outline, bathymetry, bottom type, named spots and water character. Every function is deterministic so the page, the Worker and the tests agree on the depth under any boat. Distances are metres, depths are feet. */
import { clamp, fbm, smoothstep } from './Random'

export type LakeId = 'silver-birch' | 'mill-pond' | 'tamarack' | 'thunder-bay' | 'wolf-rapids'
export type Bottom = 'sand' | 'gravel' | 'rock' | 'muck' | 'weed' | 'timber'

export interface Feature {
  kind: 'hump' | 'hole' | 'island' | 'weed' | 'timber' | 'rock' | 'channel' | 'bar'
  x: number
  z: number
  r: number
  /** Hump or bar top depth (ft), hole bottom depth (ft), island height (m). */
  value?: number
  /** Channel end point. */
  x2?: number
  z2?: number
}

export interface Spot {
  id: string
  name: string
  x: number
  z: number
}

export interface LakeDef {
  id: LakeId
  name: string
  type: string
  acres: number
  maxDepth: number
  radius: number
  stretch: [number, number]
  seed: number
  harmonics: [number, number, number][]
  features: Feature[]
  landing: { x: number; z: number; heading: number }
  spots: Spot[]
  water: { deep: [number, number, number]; shallow: [number, number, number]; clarity: number }
  surfaceTemp: number[]
  thermocline: number[]
  shore: { pine: number; birch: number; hardwood: number; tamarack: number; cabins: number; reeds: number }
  opensAt: number
  blurb: string
  current?: { x: number; z: number; speed: number }
}

export const LAKES: Record<LakeId, LakeDef> = {
  'silver-birch': {
    id: 'silver-birch', name: 'Silver Birch Lake', type: 'Clear glacial kettle', acres: 420, maxDepth: 68, radius: 620, stretch: [1.25, 0.85], seed: 11,
    harmonics: [[2, 0.1, 0.4], [3, 0.08, 1.9], [5, 0.05, 0.3], [7, 0.03, 2.2]],
    features: [
      { kind: 'hump', x: 180, z: -90, r: 70, value: 9 },
      { kind: 'hump', x: -260, z: 120, r: 55, value: 14 },
      { kind: 'rock', x: 180, z: -90, r: 60 },
      { kind: 'island', x: -120, z: -210, r: 70, value: 9 },
      { kind: 'hole', x: 40, z: 60, r: 160, value: 68 },
      { kind: 'bar', x: 420, z: 40, r: 40, value: 6, x2: 560, z2: 80 },
      { kind: 'weed', x: -520, z: -60, r: 120 },
      { kind: 'weed', x: 330, z: 300, r: 90 },
      { kind: 'rock', x: 470, z: 60, r: 70 },
    ],
    landing: { x: -600, z: 210, heading: 120 },
    spots: [
      { id: 'reef', name: 'Birch Reef', x: 180, z: -90 },
      { id: 'island', name: 'Loon Island point', x: -40, z: -180 },
      { id: 'hole', name: 'The Kettle Hole', x: 40, z: 60 },
      { id: 'bar', name: 'Sandy Bar', x: 470, z: 60 },
      { id: 'weeds', name: 'West Cabbage Bed', x: -510, z: -60 },
      { id: 'hump', name: 'Second Hump', x: -260, z: 120 },
    ],
    water: { deep: [0.03, 0.12, 0.16], shallow: [0.18, 0.32, 0.3], clarity: 0.85 },
    surfaceTemp: [34, 34, 38, 47, 58, 68, 75, 74, 66, 54, 42, 36],
    thermocline: [0, 0, 0, 0, 22, 20, 18, 19, 24, 0, 0, 0],
    shore: { pine: 0.5, birch: 0.35, hardwood: 0.15, tamarack: 0, cabins: 9, reeds: 0.3 },
    opensAt: 0,
    blurb: 'Clear water, steep drop-offs and rock humps. Walleye and smallmouth live on the structure; a few lake trout hold in the kettle hole.',
  },
  'mill-pond': {
    id: 'mill-pond', name: 'Mill Pond Flowage', type: 'Stained river impoundment', acres: 900, maxDepth: 22, radius: 820, stretch: [1.5, 0.7], seed: 23,
    harmonics: [[2, 0.12, 1.2], [3, 0.1, 0.2], [4, 0.07, 2.6], [6, 0.05, 1.1], [9, 0.03, 0.6]],
    features: [
      { kind: 'channel', x: -1100, z: -40, r: 45, value: 22, x2: 1050, z2: 60 },
      { kind: 'timber', x: -380, z: 160, r: 220 },
      { kind: 'timber', x: 300, z: -200, r: 160 },
      { kind: 'weed', x: 650, z: 250, r: 180 },
      { kind: 'weed', x: -760, z: -230, r: 150 },
      { kind: 'island', x: 140, z: 170, r: 55, value: 4 },
      { kind: 'hump', x: 520, z: -60, r: 80, value: 6 },
    ],
    landing: { x: 1080, z: 160, heading: 250 },
    spots: [
      { id: 'channel', name: 'Old River Channel', x: -200, z: -15 },
      { id: 'stumps', name: 'Stump Field', x: -380, z: 160 },
      { id: 'dam', name: 'Dam Face', x: 1060, z: 40 },
      { id: 'weeds', name: 'Lily Bay', x: 650, z: 250 },
      { id: 'timber', name: 'South Timber', x: 300, z: -200 },
    ],
    water: { deep: [0.12, 0.09, 0.04], shallow: [0.28, 0.24, 0.12], clarity: 0.45 },
    surfaceTemp: [33, 33, 38, 50, 62, 72, 79, 78, 68, 54, 41, 35],
    thermocline: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    shore: { pine: 0.2, birch: 0.15, hardwood: 0.55, tamarack: 0.1, cabins: 6, reeds: 0.6 },
    opensAt: 0,
    blurb: 'A shallow, tea-coloured flowage full of stumps, lily pads and an old river channel. Bass, crappie, pike and catfish.',
  },
  tamarack: {
    id: 'tamarack', name: 'Tamarack Bog', type: 'Dark bog lake', acres: 110, maxDepth: 31, radius: 330, stretch: [1.1, 0.95], seed: 37,
    harmonics: [[2, 0.08, 2.1], [3, 0.09, 0.7], [5, 0.06, 1.6], [8, 0.03, 0.2]],
    features: [
      { kind: 'hole', x: 40, z: -30, r: 70, value: 31 },
      { kind: 'weed', x: -200, z: 60, r: 120 },
      { kind: 'weed', x: 150, z: 170, r: 90 },
      { kind: 'timber', x: 210, z: -120, r: 70 },
    ],
    landing: { x: -300, z: -120, heading: 60 },
    spots: [
      { id: 'hole', name: 'The Sink', x: 40, z: -30 },
      { id: 'pads', name: 'Lily Pads', x: -200, z: 60 },
      { id: 'mat', name: 'Bog Mat Edge', x: 150, z: 170 },
      { id: 'snags', name: 'Snag Corner', x: 210, z: -120 },
    ],
    water: { deep: [0.1, 0.06, 0.03], shallow: [0.22, 0.16, 0.08], clarity: 0.35 },
    surfaceTemp: [33, 33, 37, 49, 61, 71, 77, 76, 66, 52, 40, 34],
    thermocline: [0, 0, 0, 0, 12, 10, 9, 10, 14, 0, 0, 0],
    shore: { pine: 0.15, birch: 0.1, hardwood: 0.05, tamarack: 0.7, cabins: 2, reeds: 0.9 },
    opensAt: 0,
    blurb: 'A small, dark bog ringed by tamaracks and floating mats. Bluegill, perch and bullhead, and the occasional heavy pike from the one deep hole.',
  },
  'thunder-bay': {
    id: 'thunder-bay', name: 'Thunder Bay', type: 'Deep, cold big water', acres: 3800, maxDepth: 140, radius: 1450, stretch: [1.3, 0.9], seed: 53,
    harmonics: [[2, 0.09, 0.9], [3, 0.11, 2.4], [4, 0.06, 0.1], [6, 0.05, 1.7], [11, 0.02, 0.4]],
    features: [
      { kind: 'hump', x: 520, z: -300, r: 120, value: 12 },
      { kind: 'rock', x: 520, z: -300, r: 110 },
      { kind: 'hump', x: -700, z: 380, r: 140, value: 18 },
      { kind: 'rock', x: -700, z: 380, r: 120 },
      { kind: 'hole', x: 0, z: 0, r: 520, value: 140 },
      { kind: 'island', x: 260, z: 420, r: 130, value: 16 },
      { kind: 'island', x: -380, z: -420, r: 90, value: 11 },
      { kind: 'bar', x: 1250, z: -120, r: 80, value: 8, x2: 1500, z2: -60 },
      { kind: 'weed', x: -1450, z: 60, r: 220 },
    ],
    landing: { x: -1520, z: -260, heading: 80 },
    spots: [
      { id: 'reef', name: 'Thunder Reef', x: 520, z: -300 },
      { id: 'shoal', name: 'Gull Shoal', x: -700, z: 380 },
      { id: 'basin', name: 'Main Basin', x: 0, z: 0 },
      { id: 'island', name: 'Big Island break', x: 260, z: 300 },
      { id: 'mouth', name: 'River Mouth', x: 1350, z: -100 },
      { id: 'flats', name: 'West Weed Flats', x: -1400, z: 60 },
    ],
    water: { deep: [0.02, 0.1, 0.17], shallow: [0.14, 0.3, 0.32], clarity: 0.9 },
    surfaceTemp: [33, 33, 35, 40, 48, 58, 66, 67, 60, 50, 41, 35],
    thermocline: [0, 0, 0, 0, 30, 28, 26, 27, 34, 0, 0, 0],
    shore: { pine: 0.65, birch: 0.25, hardwood: 0.1, tamarack: 0, cabins: 14, reeds: 0.15 },
    opensAt: 50,
    blurb: 'Big, cold, windy water with reefs and shoals. Musky, lake trout, whitefish and trophy walleye.',
  },
  'wolf-rapids': {
    id: 'wolf-rapids', name: 'Wolf Rapids Reservoir', type: 'Wide tannic river', acres: 1600, maxDepth: 40, radius: 1250, stretch: [2.1, 0.42], seed: 71,
    harmonics: [[2, 0.05, 0.4], [3, 0.08, 1.4], [5, 0.07, 2.2], [7, 0.05, 0.9], [10, 0.03, 1.5]],
    features: [
      { kind: 'channel', x: -2700, z: 0, r: 70, value: 40, x2: 2700, z2: 30 },
      { kind: 'timber', x: -900, z: 230, r: 220 },
      { kind: 'timber', x: 1300, z: -200, r: 200 },
      { kind: 'rock', x: 400, z: 120, r: 140 },
      { kind: 'bar', x: -200, z: -160, r: 60, value: 7, x2: 300, z2: -140 },
      { kind: 'weed', x: 2100, z: 220, r: 160 },
      { kind: 'hole', x: -1800, z: 10, r: 120, value: 40 },
    ],
    landing: { x: -2300, z: 280, heading: 100 },
    spots: [
      { id: 'seam', name: 'Current Seam', x: -400, z: 20 },
      { id: 'wingdam', name: 'Wing Dam', x: 400, z: 120 },
      { id: 'timber', name: 'Drowned Timber', x: -900, z: 230 },
      { id: 'scour', name: 'Scour Hole', x: -1800, z: 10 },
      { id: 'backwater', name: 'Backwater Slough', x: 2100, z: 220 },
    ],
    water: { deep: [0.1, 0.08, 0.04], shallow: [0.26, 0.22, 0.12], clarity: 0.4 },
    surfaceTemp: [33, 33, 37, 48, 60, 70, 77, 76, 67, 54, 41, 34],
    thermocline: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    shore: { pine: 0.3, birch: 0.2, hardwood: 0.5, tamarack: 0, cabins: 8, reeds: 0.4 },
    opensAt: 50,
    current: { x: 1, z: 0, speed: 0.6 },
    blurb: 'A wide, stained river reservoir with current seams, wing dams and drowned timber. Flathead catfish, musky, sauger and the rare lake sturgeon.',
  },
}

export const lakeIds = Object.keys(LAKES) as LakeId[]

export function isLakeId(value: unknown): value is LakeId {
  return typeof value === 'string' && value in LAKES
}

const FT = 0.3048

/** 1 at the lake's centre, 0 on the shoreline, negative on land. */
export function interior(lake: LakeDef, x: number, z: number): number {
  const sx = x / lake.stretch[0], sz = z / lake.stretch[1]
  const theta = Math.atan2(sz, sx)
  let r = lake.radius
  for (const [k, amp, phase] of lake.harmonics) r += lake.radius * amp * Math.cos(k * theta + phase)
  r += lake.radius * 0.04 * (fbm(Math.cos(theta) * 3 + 10, Math.sin(theta) * 3 + 10, lake.seed, 3) - 0.5)
  return 1 - Math.hypot(sx, sz) / r
}

function segmentDistance(x: number, z: number, f: Feature): number {
  const ax = f.x, az = f.z, bx = f.x2 ?? f.x, bz = f.z2 ?? f.z
  const dx = bx - ax, dz = bz - az
  const len = dx * dx + dz * dz
  const t = len ? clamp(((x - ax) * dx + (z - az) * dz) / len, 0, 1) : 0
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}

/** Ground height in metres relative to the water surface: negative under water, positive on land and islands. */
export function heightAt(lake: LakeDef, x: number, z: number): number {
  const s = interior(lake, x, z)
  let depthFt: number
  if (s > 0) {
    const shelf = smoothstep(0, 0.08, s)
    const bowl = Math.pow(smoothstep(0, 0.75, s), 0.85)
    depthFt = 2 + shelf * 6 + bowl * (lake.maxDepth * 0.55)
    depthFt *= 0.85 + 0.3 * fbm(x / 140, z / 140, lake.seed + 3, 3)
  } else {
    depthFt = 0
  }
  for (const f of lake.features) {
    if (f.kind === 'hump' || f.kind === 'bar') {
      const d = f.kind === 'bar' ? segmentDistance(x, z, f) : Math.hypot(x - f.x, z - f.z)
      const w = Math.exp(-(d * d) / (f.r * f.r))
      if (s > 0) depthFt = depthFt + ((f.value ?? 8) - depthFt) * w
    } else if (f.kind === 'hole' || f.kind === 'channel') {
      const d = f.kind === 'channel' ? segmentDistance(x, z, f) : Math.hypot(x - f.x, z - f.z)
      const w = Math.exp(-(d * d) / (f.r * f.r))
      if (s > 0) depthFt = Math.max(depthFt, depthFt + ((f.value ?? lake.maxDepth) - depthFt) * w * smoothstep(0, 0.06, s))
    }
  }
  depthFt = Math.min(depthFt, lake.maxDepth)
  let h = s > 0 ? -depthFt * FT * smoothstep(-0.002, 0.03, s) : 0
  if (s <= 0) {
    const land = -s * lake.radius
    h = Math.min(1.2, land * 0.06) + Math.max(0, land - 15) * 0.045 + fbm(x / 260, z / 260, lake.seed + 9, 4) * Math.min(1, land / 120) * 30
  }
  for (const f of lake.features) {
    if (f.kind !== 'island') continue
    const d = Math.hypot(x - f.x, z - f.z) / f.r
    if (d < 1.6) {
      const bump = (f.value ?? 8) * Math.exp(-d * d * 2.2) + 1.5 * (1 - smoothstep(0.9, 1.6, d))
      h = Math.max(h, bump - 2.2 + fbm(x / 40, z / 40, lake.seed + 5, 2) * 1.5)
    }
  }
  return h
}

export function depthFeetAt(lake: LakeDef, x: number, z: number): number {
  return Math.max(0, -heightAt(lake, x, z) / FT)
}

export function bottomAt(lake: LakeDef, x: number, z: number): Bottom {
  const depth = depthFeetAt(lake, x, z)
  let best: Bottom | null = null
  let bestWeight = 0
  for (const f of lake.features) {
    if (f.kind !== 'weed' && f.kind !== 'timber' && f.kind !== 'rock') continue
    const d = Math.hypot(x - f.x, z - f.z) / f.r
    const w = 1 - d + (fbm(x / 30, z / 30, lake.seed + 13, 2) - 0.5) * 0.6
    if (w > bestWeight) { bestWeight = w; best = f.kind === 'weed' ? 'weed' : f.kind === 'timber' ? 'timber' : 'rock' }
  }
  if (best && bestWeight > 0.15 && !(best === 'weed' && depth > 16)) return best
  const n = fbm(x / 70, z / 70, lake.seed + 17, 3)
  if (depth < 4) return n > 0.55 ? 'gravel' : 'sand'
  if (depth < 13) return n > 0.6 ? 'weed' : n > 0.4 ? 'sand' : 'gravel'
  if (depth > lake.maxDepth * 0.6) return 'muck'
  return n > 0.62 ? 'rock' : n > 0.38 ? 'gravel' : 'muck'
}

export function nearestSpot(lake: LakeDef, x: number, z: number): { spot: Spot; distance: number } {
  let best = lake.spots[0], bestD = Infinity
  for (const s of lake.spots) {
    const d = Math.hypot(x - s.x, z - s.z)
    if (d < bestD) { bestD = d; best = s }
  }
  return { spot: best, distance: bestD }
}

export function lakeExtent(lake: LakeDef): number {
  return lake.radius * Math.max(lake.stretch[0], lake.stretch[1]) * 1.45 + 320
}

export function waterTempF(lake: LakeDef, date: Date, depthFt: number): number {
  const month = date.getMonth()
  const day = date.getDate() / 31
  const next = (month + 1) % 12
  const surface = lake.surfaceTemp[month] + (lake.surfaceTemp[next] - lake.surfaceTemp[month]) * day
  const thermo = lake.thermocline[month]
  if (!thermo || depthFt <= thermo) return surface - depthFt * 0.05
  return Math.max(39, surface - 8 - (depthFt - thermo) * 0.35)
}

/** Shoreline point along a ray from the lake centre at the given angle. */
export function shorePoint(lake: LakeDef, angle: number): [number, number] {
  let lo = 0, hi = lake.radius * Math.max(lake.stretch[0], lake.stretch[1]) * 1.6
  const dx = Math.cos(angle), dz = Math.sin(angle)
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    if (heightAt(lake, dx * mid, dz * mid) < 0) lo = mid
    else hi = mid
  }
  return [dx * lo, dz * lo]
}

/** Moves a point toward the lake centre until it has at least the given depth. */
export function intoWater(lake: LakeDef, x: number, z: number, minDepthFt: number): [number, number] {
  let px = x, pz = z
  const d = Math.hypot(px, pz) || 1
  const step = 6
  for (let i = 0; i < 600 && depthFeetAt(lake, px, pz) < minDepthFt; i++) {
    px -= (x / d) * step
    pz -= (z / d) * step
  }
  return [px, pz]
}

export interface Landing {
  /** Where boats launch, in water. */
  x: number
  z: number
  heading: number
  /** Shore point for the ramp and dock. */
  shoreX: number
  shoreZ: number
  angle: number
}

const landingCache = new Map<LakeId, Landing>()

export function landingOf(lake: LakeDef): Landing {
  const cached = landingCache.get(lake.id)
  if (cached) return cached
  const angle = Math.atan2(lake.landing.z, lake.landing.x)
  const [sx, sz] = shorePoint(lake, angle)
  const [x, z] = intoWater(lake, sx * 0.995, sz * 0.995, 6)
  const heading = Math.atan2(x, z)
  const result = { x, z, heading, shoreX: sx, shoreZ: sz, angle }
  landingCache.set(lake.id, result)
  return result
}

const spotCache = new Map<LakeId, Spot[]>()

export function spotsOf(lake: LakeDef): Spot[] {
  const cached = spotCache.get(lake.id)
  if (cached) return cached
  const spots = lake.spots.map(s => {
    const [x, z] = intoWater(lake, s.x, s.z, 4)
    return { ...s, x, z }
  })
  spotCache.set(lake.id, spots)
  return spots
}
