import { FLAT_RIDES } from './catalog.mjs'

export const CUSTOM_RIDE_PREFIX = 'cr_'
export const CUSTOM_RIDE_ID = /^cr_[a-f0-9]{10}$/
export const CUSTOM_RIDE_CATEGORIES = ['gentle', 'thrill', 'water', 'other']
export const CUSTOM_RIDE_MOTIONS = ['none', 'spin', 'swing', 'wheel', 'drop', 'bob']
export const CUSTOM_PIECE_MOTIONS = ['spin', 'swing', 'wobble', 'flip', 'bob', 'level']
export const CUSTOM_PIECE_SPLITS = ['pieces', 'sectors']
export const CUSTOM_PIECE_HANGS = ['top', 'centre', 'bottom', 'clicked']
export const CUSTOM_PIECE_AXES = ['radial', 'tangent', 'x', 'y']
export const CUSTOM_PLATFORM_SHAPES = ['square', 'round', 'octagon', 'hexagon']
export const CUSTOM_PLATFORM_STEPS = ['none', 'front', 'back', 'left', 'right', 'sides', 'all']
export const CUSTOM_PLATFORM_COLUMNS = ['none', 'fixed', 'telescoping']
export const CUSTOM_RIDE_LIMITS = {
  nameMin: 2, nameMax: 40, descriptionMax: 160,
  sizeMin: 1, sizeMax: 12,
  heightMin: 1, heightMax: 80,
  costMin: 100, costMax: 200000,
  upkeepMax: 5000, capacityMin: 1, capacityMax: 200,
  rideTimeMin: 5, rideTimeMax: 300, loadTimeMin: 2, loadTimeMax: 60,
  priceMax: 20, statMax: 10,
  speedMin: 0.1, speedMax: 3,
  meshBytes: 2_500_000, thumbBytes: 300_000, sourceBytes: 15 * 1024 * 1024,
  trianglesMin: 500, trianglesMax: 24000,
  piecesMax: 6, picksMax: 24, instancesMax: 64, pieceCountMax: 32, reachMax: 60,
  riseMax: 40, platformHeightMax: 8, platformTiersMax: 4, platformTriangles: 6000, columnRadiusMax: 4, columnSectionsMax: 4,
}

const L = CUSTOM_RIDE_LIMITS
const clamp = (value, lo, hi, fallback) => { const n = Number(value); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback }
const round = (value, places = 2) => { const k = 10 ** places; return Math.round(value * k) / k }
const pick = (value, list, fallback) => list.includes(value) ? value : fallback

function sanitizePiece(raw, index) {
  const from = round(clamp(raw?.from, 0, L.heightMax, 0)), inner = round(clamp(raw?.inner, 0, L.reachMax, 0))
  return {
    type: pick(raw?.type, CUSTOM_PIECE_MOTIONS, 'spin'),
    speed: round(clamp(raw?.speed, L.speedMin, L.speedMax, 1)),
    amount: round(clamp(raw?.amount, 0, 1, 0.6)),
    from,
    to: round(clamp(raw?.to, from, L.heightMax, Math.max(from, 3))),
    inner,
    outer: round(clamp(raw?.outer, inner, L.reachMax, L.reachMax)),
    split: pick(raw?.split, CUSTOM_PIECE_SPLITS, 'pieces'),
    count: Math.round(clamp(raw?.count, 1, L.pieceCountMax, 8)),
    hang: pick(raw?.hang, CUSTOM_PIECE_HANGS, 'top'),
    axis: pick(raw?.axis, CUSTOM_PIECE_AXES, 'radial'),
    stagger: round(clamp(raw?.stagger, 0, 1, 0.5)),
    alternate: raw?.alternate === true,
    on: Math.round(clamp(raw?.on, -2, index - 1, -1)),
    picks: (Array.isArray(raw?.picks) ? raw.picks : []).filter(p => Array.isArray(p) && p.length === 3 && p.every(v => Number.isFinite(Number(v)))).slice(0, L.picksMax)
      .map(p => [round(clamp(p[0], -L.reachMax, L.reachMax, 0), 3), round(clamp(p[1], -L.reachMax, L.reachMax, 0), 3), round(clamp(p[2], 0, L.heightMax, 0), 3)]),
    matching: raw?.matching !== false,
  }
}

const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback

/** The generated base under a custom ride. Pure and deterministic like sanitizeMotion. */
export function sanitizePlatform(raw) {
  return {
    enabled: raw?.enabled === true,
    shape: pick(raw?.shape, CUSTOM_PLATFORM_SHAPES, 'round'),
    fill: round(clamp(raw?.fill, 0.3, 1, 0.9)),
    height: round(clamp(raw?.height, 0, L.platformHeightMax, 0.6)),
    tiers: Math.round(clamp(raw?.tiers, 1, L.platformTiersMax, 1)),
    inset: round(clamp(raw?.inset, 0, 0.3, 0.1)),
    top: color(raw?.top, '#b8b2a6'),
    side: color(raw?.side, '#6d6a66'),
    trim: color(raw?.trim, '#e0b23c'),
    edge: raw?.edge !== false,
    steps: pick(raw?.steps, CUSTOM_PLATFORM_STEPS, 'front'),
    stepColor: color(raw?.stepColor, '#8e8a84'),
    fence: raw?.fence === true,
    fenceHeight: round(clamp(raw?.fenceHeight, 0.5, 2, 1.1)),
    fenceColor: color(raw?.fenceColor, '#d9dde2'),
    column: pick(raw?.column, CUSTOM_PLATFORM_COLUMNS, 'none'),
    columnRadius: round(clamp(raw?.columnRadius, 0.1, L.columnRadiusMax, 0.6)),
    columnSections: Math.round(clamp(raw?.columnSections, 1, L.columnSectionsMax, 3)),
    columnColor: color(raw?.columnColor, '#9aa3ad'),
    columnTop: round(clamp(raw?.columnTop, 0, L.heightMax, 0)),
  }
}

const text = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/** Validates a motion block. Pure and deterministic so the browser and the online server agree. */
export function sanitizeMotion(raw) {
  const type = CUSTOM_RIDE_MOTIONS.includes(raw?.type) ? raw.type : 'none'
  const pivot = Array.isArray(raw?.pivot) ? raw.pivot : []
  return {
    type,
    speed: round(clamp(raw?.speed, L.speedMin, L.speedMax, 1)),
    amount: round(clamp(raw?.amount, 0, 1, 0.6)),
    axis: raw?.axis === 'y' ? 'y' : 'x',
    split: round(clamp(raw?.split, 0, L.heightMax, 0)),
    pivot: [round(clamp(pivot[0], -30, 30, 0)), round(clamp(pivot[1], -30, 30, 0)), round(clamp(pivot[2], 0, L.heightMax, 0))],
    rise: round(clamp(raw?.rise, 0, L.riseMax, 0)),
    pieces: (Array.isArray(raw?.pieces) ? raw.pieces : []).slice(0, L.piecesMax).map(sanitizePiece),
  }
}

/** Turns a published ride record into a flat-ride definition, or null if it is unusable. */
export function customRideDef(raw) {
  if (!raw || typeof raw !== 'object' || !CUSTOM_RIDE_ID.test(raw.id)) return null
  const name = text(raw.name, L.nameMax)
  if (name.length < L.nameMin) return null
  const size = Array.isArray(raw.size) ? raw.size : []
  const w = Math.round(clamp(size[0], L.sizeMin, L.sizeMax, 3)), h = Math.round(clamp(size[1], L.sizeMin, L.sizeMax, 3))
  const stats = raw.stats ?? {}
  return {
    name,
    category: CUSTOM_RIDE_CATEGORIES.includes(raw.category) ? raw.category : 'gentle',
    size: [w, h],
    cost: Math.round(clamp(raw.cost, L.costMin, L.costMax, 2000)),
    upkeep: Math.round(clamp(raw.upkeep, 0, L.upkeepMax, 40)),
    capacity: Math.round(clamp(raw.capacity, L.capacityMin, L.capacityMax, 12)),
    rideTime: Math.round(clamp(raw.rideTime, L.rideTimeMin, L.rideTimeMax, 30)),
    loadTime: Math.round(clamp(raw.loadTime, L.loadTimeMin, L.loadTimeMax, 8)),
    price: round(clamp(raw.price, 0, L.priceMax, 1.5)),
    stats: { e: round(clamp(stats.e, 0, L.statMax, 2)), i: round(clamp(stats.i, 0, L.statMax, 1.5)), n: round(clamp(stats.n, 0, L.statMax, 1)) },
    height: round(clamp(raw.height, L.heightMin, L.heightMax, 6), 1),
    description: text(raw.description, L.descriptionMax),
    custom: {
      id: raw.id,
      motion: sanitizeMotion(raw.motion),
      platform: sanitizePlatform(raw.platform),
      meshVersion: Math.max(0, Math.round(clamp(raw.meshVersion, 0, 1e9, 0))),
      thumb: raw.thumb === true,
      retired: raw.active === false,
    },
  }
}

/**
 * Adds published rides to FLAT_RIDES. Rides are never removed, so parks that
 * own a retired ride keep it; retired rides only leave the build menu.
 * Returns the ids that were registered.
 */
export function registerCustomRides(list) {
  const ids = []
  if (!Array.isArray(list)) return ids
  for (const raw of list.slice(0, 500)) {
    const def = customRideDef(raw)
    if (!def) continue
    const existing = FLAT_RIDES[def.custom.id]
    if (existing && !existing.custom) continue
    if (existing) { for (const key of Object.keys(existing)) delete existing[key]; Object.assign(existing, def) }
    else FLAT_RIDES[def.custom.id] = def
    ids.push(def.custom.id)
  }
  return ids
}

export const isCustomRide = id => typeof id === 'string' && CUSTOM_RIDE_ID.test(id)
export const buildableRide = def => Boolean(def) && !def.custom?.retired
