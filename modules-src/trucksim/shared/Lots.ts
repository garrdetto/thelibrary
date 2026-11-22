/**
 * Lot building rules shared by the page and the Worker. Build items are lot-local metres: (x, z) is the footprint's minimum
 * corner and (w, d) its axis-aligned size, `rot` the side the front faces (+z, +x, -z, -x). A `line` item (a fence) runs `w`
 * metres from (x, z) in the `rot` direction with thickness `d`. Validation depends only on a lot's size, so a Life Sim parcel
 * can be a truck lot as well as a Haulers Row lot.
 */
import { BUILDING_BY_ID, DEMOLISH_REFUND } from './Catalog'
import type { BuildDef } from './Catalog'

export type BuildRotation = 0 | 1 | 2 | 3

export interface BuildItem {
  id: string
  def: string
  x: number
  z: number
  w: number
  d: number
  rot: BuildRotation
  color: string
  color2?: string
}

export interface Footprint {
  x: number
  z: number
  w: number
  d: number
}

export interface LotSize {
  w: number
  d: number
}

export interface PublicLot {
  index: number
  owner: string
  company: string
  build: BuildItem[]
}

export const MAX_ITEMS = 160
export const MAX_LINE_LENGTH = 120
export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

const EPSILON = 0.001

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/** The ground rectangle an item covers; a fence is a thin rectangle along its run. */
export function itemFootprint(item: BuildItem): Footprint {
  const def = BUILDING_BY_ID[item.def]
  if (def?.mode !== 'line') return { x: item.x, z: item.z, w: item.w, d: item.d }
  const half = item.d / 2
  switch (item.rot) {
    case 0: return { x: round6(item.x - half), z: item.z, w: item.d, d: item.w }
    case 1: return { x: item.x, z: round6(item.z - half), w: item.w, d: item.d }
    case 2: return { x: round6(item.x - half), z: round6(item.z - item.w), w: item.d, d: item.w }
    default: return { x: round6(item.x - item.w), z: round6(item.z - half), w: item.w, d: item.d }
  }
}

/** What an item costs: per square metre (drag), per metre (line) or flat (place). Unknown defs cost nothing. */
export function itemCost(item: BuildItem): number {
  const def = BUILDING_BY_ID[item.def]
  if (!def) return 0
  if (def.mode === 'drag') return Math.round(def.cost * item.w * item.d)
  if (def.mode === 'line') return Math.round(def.cost * item.w)
  return def.cost
}

/** Cash returned for demolishing an item. */
export function itemRefund(item: BuildItem): number {
  return Math.floor(itemCost(item) * DEMOLISH_REFUND)
}

/** True when any item is a service building (shop or fuel island) where trucks are refuelled and repaired at cost. */
export function hasService(build: readonly BuildItem[]): boolean {
  return build.some((item) => BUILDING_BY_ID[item.def]?.service === true)
}

function overlaps(a: Footprint, b: Footprint): boolean {
  return a.x < b.x + b.w - EPSILON && b.x < a.x + a.w - EPSILON && a.z < b.z + b.d - EPSILON && b.z < a.z + a.d - EPSILON
}

function sizeProblem(def: BuildDef, item: BuildItem): string | null {
  if (def.mode === 'drag') {
    if (item.w < (def.minW ?? 1) - EPSILON || item.d < (def.minD ?? 1) - EPSILON) return `${def.name} is too small.`
    if (item.w > (def.maxW ?? MAX_LINE_LENGTH) + EPSILON || item.d > (def.maxD ?? MAX_LINE_LENGTH) + EPSILON) return `${def.name} is too large.`
    return null
  }
  if (def.mode === 'line') {
    if (Math.abs(item.d - def.d) > EPSILON) return `${def.name} has the wrong thickness.`
    if (item.w < 1 - EPSILON || item.w > MAX_LINE_LENGTH + EPSILON) return `${def.name} must be between 1 and ${MAX_LINE_LENGTH} m long.`
    return null
  }
  const straight = Math.abs(item.w - def.w) <= EPSILON && Math.abs(item.d - def.d) <= EPSILON
  const turned = Math.abs(item.w - def.d) <= EPSILON && Math.abs(item.d - def.w) <= EPSILON
  return straight || turned ? null : `${def.name} has the wrong size.`
}

/**
 * Checks one item against the lot and the items already there. Returns a plain-language reason, or null when it can be built.
 * Structures, add-ons and fences may not overlap each other; paving may sit under anything.
 */
export function validateItem(item: BuildItem, existing: readonly BuildItem[], lot: LotSize): string | null {
  if (typeof item !== 'object' || item === null) return 'That is not a building.'
  const def = BUILDING_BY_ID[item.def]
  if (!def) return 'Unknown building.'
  if (typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 40) return 'That piece has no valid id.'
  if (![item.x, item.z, item.w, item.d].every((value) => typeof value === 'number' && Number.isFinite(value))) return 'That piece has an invalid size or position.'
  if (item.rot !== 0 && item.rot !== 1 && item.rot !== 2 && item.rot !== 3) return 'That piece has an invalid rotation.'
  if (typeof item.color !== 'string' || !COLOR_PATTERN.test(item.color) || (item.color2 !== undefined && (typeof item.color2 !== 'string' || !COLOR_PATTERN.test(item.color2)))) return 'That piece has an invalid colour.'
  if (existing.length >= MAX_ITEMS) return `Your lot is full (${MAX_ITEMS} pieces).`
  if (existing.some((other) => other.id === item.id)) return 'That piece is already on your lot.'
  const size = sizeProblem(def, item)
  if (size) return size
  const footprint = itemFootprint(item)
  if (footprint.x < -EPSILON || footprint.z < -EPSILON || footprint.x + footprint.w > lot.w + EPSILON || footprint.z + footprint.d > lot.d + EPSILON) return 'That piece does not fit inside your lot.'
  if (def.category !== 'paving') {
    for (const other of existing) {
      const otherDef = BUILDING_BY_ID[other.def]
      if (!otherDef || otherDef.category === 'paving') continue
      if (overlaps(footprint, itemFootprint(other))) return `${def.name} overlaps ${otherDef.name}.`
    }
  }
  return null
}

/** Rebuilds a stored item field by field, or returns null when it cannot be a build item. Does not check the lot. */
export function normalizeBuildItem(raw: unknown): BuildItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const source = raw as Record<string, unknown>
  const def = typeof source.def === 'string' ? BUILDING_BY_ID[source.def] : undefined
  if (!def || typeof source.id !== 'string' || source.id.length === 0 || source.id.length > 40) return null
  const numbers = [source.x, source.z, source.w, source.d]
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
  const [x, z, w, d] = numbers as number[]
  const rot = source.rot === 1 || source.rot === 2 || source.rot === 3 ? source.rot : 0
  const color = typeof source.color === 'string' && COLOR_PATTERN.test(source.color) ? source.color : def.defaultColor
  const item: BuildItem = { id: source.id, def: def.id, x, z, w, d, rot, color }
  if (typeof source.color2 === 'string' && COLOR_PATTERN.test(source.color2)) item.color2 = source.color2
  return item
}
