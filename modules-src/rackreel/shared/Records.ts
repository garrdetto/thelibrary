import { SPECIES, measure } from '../systems/LootTableManager'
import type { Measures, RecordMetric, SpeciesId } from '../systems/LootTableManager'

/**
 * Rack & Reel high scores: the categories the Wisconsin record keepers track, each with the
 * real state benchmark beside the top three players. Shared by the module and `/api/rackreel`.
 */

export interface StateMark {
  value: number
  note: string
}

export interface RecordCategory {
  id: string
  species: SpeciesId
  metric: RecordMetric
  label: string
  unit: 'lb' | 'in' | 'pts'
  state: StateMark
}

export interface HighScore {
  username: string
  value: number
  at: number
}

/** Category id → top three, best first. */
export type RecordBoard = Record<string, HighScore[]>

/** The in-game board and catch card show the top three of each category. */
export const BOARD_SIZE = 3
/** The site's record board under the module lists the top 20, like the other boards. */
export const BOARD_LIMIT = 20

const cat = (species: SpeciesId, metric: RecordMetric, label: string, unit: RecordCategory['unit'], value: number, note: string): RecordCategory =>
  ({ id: `${species}.${metric}`, species, metric, label, unit, state: { value, note } })

/**
 * Wisconsin benchmarks (DNR hook-and-line weights, DNR live-release lengths, Buck & Bear Club and
 * B&C scores). They are shown only as a reference beside each board; players never compete with them.
 */
export const RECORD_CATEGORIES: RecordCategory[] = [
  cat('muskie', 'weight', 'Heaviest', 'lb', 69.69, 'WI record, Sawyer Co., 1949'),
  cat('muskie', 'length', 'Longest', 'in', 63.5, 'WI record fish, Sawyer Co., 1949'),
  cat('walleye', 'weight', 'Heaviest', 'lb', 18, 'WI record, Vilas Co., 1933'),
  cat('walleye', 'length', 'Longest', 'in', 33.75, 'WI live-release record, Marinette Co., 2021'),
  cat('pike', 'weight', 'Heaviest', 'lb', 38, 'WI record, Green Lake Co., 1952'),
  cat('pike', 'length', 'Longest', 'in', 46.25, 'WI live-release record, Oconto Co., 2019'),
  cat('smallmouth', 'weight', 'Heaviest', 'lb', 9.06, 'WI record, Oneida Co., 1950'),
  cat('smallmouth', 'length', 'Longest', 'in', 23, 'WI live-release record, Vilas Co., 2024'),
  cat('perch', 'weight', 'Heaviest', 'lb', 3.25, 'WI record, Winnebago Co., 1954'),
  cat('perch', 'length', 'Longest', 'in', 16.75, 'WI live-release record, Oconto Co., 2025'),
  cat('whitetail', 'score', 'Antler score', 'in', 206.125, 'WI typical record, Burnett Co., 1914'),
  cat('whitetail', 'spread', 'Inside spread', 'in', 20.125, 'WI typical record buck, 1914'),
  cat('whitetail', 'points', 'Most points', 'pts', 30, 'WI non-typical record, Buffalo Co., 1973'),
  cat('whitetail', 'dressed', 'Heaviest (field dressed)', 'lb', 321, 'Verified WI buck, Bayfield Co., 1938'),
  cat('blackbear', 'weight', 'Heaviest', 'lb', 780, 'Unofficial WI heaviest, Waupaca Co., 2014'),
  cat('blackbear', 'skull', 'Skull (length + width)', 'in', 23.3125, 'WI record skull, 2011'),
]

export const CATEGORY_BY_ID = Object.fromEntries(RECORD_CATEGORIES.map((c) => [c.id, c])) as Record<string, RecordCategory>

export function categoriesFor(species: SpeciesId): RecordCategory[] {
  return RECORD_CATEGORIES.filter((c) => c.species === species)
}

/** Category id → measured value for an animal of this size. Does are not scored. */
export function categoryValues(species: SpeciesId, value: number, seed = 0, measures: Measures = measure(species, value, seed)): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of categoriesFor(species)) {
    const v = measures[c.metric]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[c.id] = v
  }
  return out
}

/** Where a value would land on a top-three list: 1–3, or 0 if it misses. Ties go to the earlier entry. */
export function rankOn(list: HighScore[], value: number): 0 | 1 | 2 | 3 {
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (i >= list.length || value > list[i].value) return (i + 1) as 1 | 2 | 3
  }
  return 0
}

/** Puts an entry on a board in place (kept to the top three) and returns its rank. */
export function placeOn(board: RecordBoard, categoryId: string, entry: HighScore): 0 | 1 | 2 | 3 {
  const list = board[categoryId] ?? (board[categoryId] = [])
  const rank = rankOn(list, entry.value)
  if (!rank) return 0
  list.splice(rank - 1, 0, entry)
  list.length = Math.min(list.length, BOARD_SIZE)
  return rank
}

function fraction(v: number, denom: number): string {
  const whole = Math.floor(v + 1e-9)
  let num = Math.round((v - whole) * denom)
  if (num === denom) return `${whole + 1}`
  if (!num) return `${whole}`
  let d = denom
  while (denom === 4 && num % 2 === 0 && d % 2 === 0) {
    num /= 2
    d /= 2
  }
  return `${whole} ${num}/${d}`
}

export function formatRecord(categoryId: string, value: number): string {
  const c = CATEGORY_BY_ID[categoryId]
  if (!c) return String(value)
  if (c.unit === 'pts') return `${Math.round(value)} pts`
  if (c.unit === 'lb') {
    if (c.species === 'whitetail' || c.species === 'blackbear') return `${Math.round(value)} lb`
    const lb = Math.floor(value)
    const oz = Math.round((value - lb) * 16)
    return oz === 16 ? `${lb + 1} lb` : oz ? `${lb} lb ${oz} oz` : `${lb} lb`
  }
  return `${fraction(value, c.metric === 'score' || c.metric === 'spread' ? 8 : c.metric === 'skull' ? 16 : 4)}″`
}

/** One line of the animal's other measurements, for the board's Detail column. */
export function measureSummary(categoryId: string, measures: Measures): string {
  const c = CATEGORY_BY_ID[categoryId]
  if (!c) return ''
  return categoriesFor(c.species)
    .filter((o) => o.id !== categoryId && typeof measures[o.metric] === 'number')
    .map((o) => `${formatRecord(o.id, measures[o.metric]!)}${o.metric === 'spread' ? ' spread' : o.metric === 'skull' ? ' skull' : o.metric === 'length' ? ' long' : ''}`)
    .join(' · ')
}

export function speciesName(species: SpeciesId): string {
  return SPECIES.find((s) => s.id === species)?.name ?? species
}
