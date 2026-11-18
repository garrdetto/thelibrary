import { clubOrder } from './clubs'
import type { EnrichedShot } from './stats'

export type SortDirection = 'asc' | 'desc'

export type SortState<K extends string> = { key: K; direction: SortDirection; byClub: boolean; club: string | 'all' }

/**
 * Sorts rows by one value, missing values always last. With `byClub`, rows are grouped by club in bag order
 * (driver first, putter last) and sorted by the value inside each club.
 */
export function sortRows<T>(rows: T[], value: (row: T) => number | string | null | undefined, direction: SortDirection, club?: (row: T) => string | null) {
  const sign = direction === 'asc' ? 1 : -1
  return rows.map((row, index) => ({ row, index, value: value(row), group: club ? clubOrder(club(row)) : 0 })).sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group
    const missingA = a.value === null || a.value === undefined || (typeof a.value === 'number' && !Number.isFinite(a.value))
    const missingB = b.value === null || b.value === undefined || (typeof b.value === 'number' && !Number.isFinite(b.value))
    if (missingA || missingB) return missingA === missingB ? a.index - b.index : missingA ? 1 : -1
    const order = typeof a.value === 'string' || typeof b.value === 'string' ? String(a.value).localeCompare(String(b.value)) : (a.value as number) - (b.value as number)
    return order === 0 ? a.index - b.index : order * sign
  }).map(item => item.row)
}

export const shotSortKeys = {
  time: { label: 'Time', value: (shot: EnrichedShot) => shot.createdAt, first: 'desc' },
  club: { label: 'Club', value: (shot: EnrichedShot) => clubOrder(shot.club), first: 'asc' },
  carry: { label: 'Carry', value: (shot: EnrichedShot) => shot.carryYards, first: 'desc' },
  total: { label: 'Total', value: (shot: EnrichedShot) => shot.totalYards, first: 'desc' },
  offline: { label: 'Offline (either side)', value: (shot: EnrichedShot) => shot.offline === null ? null : Math.abs(shot.offline), first: 'desc' },
  ballSpeed: { label: 'Ball speed', value: (shot: EnrichedShot) => shot.ballSpeed, first: 'desc' },
  clubSpeed: { label: 'Club speed', value: (shot: EnrichedShot) => shot.clubSpeed, first: 'desc' },
  smash: { label: 'Smash', value: (shot: EnrichedShot) => shot.smash, first: 'desc' },
  launch: { label: 'Launch', value: (shot: EnrichedShot) => shot.launch, first: 'desc' },
  spin: { label: 'Spin', value: (shot: EnrichedShot) => shot.totalSpin, first: 'desc' },
  spinAxis: { label: 'Spin axis', value: (shot: EnrichedShot) => shot.spinAxis, first: 'desc' },
  attackAngle: { label: 'Attack angle', value: (shot: EnrichedShot) => shot.attackAngle, first: 'desc' },
  path: { label: 'Path', value: (shot: EnrichedShot) => shot.path, first: 'desc' },
  face: { label: 'Face', value: (shot: EnrichedShot) => shot.face, first: 'desc' },
} as const

export type ShotSortKey = keyof typeof shotSortKeys

export function sortShots(shots: EnrichedShot[], state: SortState<ShotSortKey>) {
  const filtered = state.club === 'all' ? shots : shots.filter(shot => (shot.club ?? '') === state.club)
  return sortRows(filtered, shotSortKeys[state.key].value, state.direction, state.byClub && state.key !== 'club' ? shot => shot.club : undefined)
}

/** Reads a saved sort for one table, falling back when storage is unavailable or the saved value no longer fits. */
export function loadSort<K extends string>(id: string, keys: readonly K[], fallback: SortState<K>): SortState<K> {
  try {
    const saved = JSON.parse(window.localStorage.getItem(`gs-sort-${id}`) ?? 'null') as Partial<SortState<K>> | null
    if (!saved || !keys.includes(saved.key as K)) return fallback
    return { key: saved.key as K, direction: saved.direction === 'asc' ? 'asc' : 'desc', byClub: Boolean(saved.byClub), club: typeof saved.club === 'string' ? saved.club : 'all' }
  } catch {
    return fallback
  }
}

export function saveSort<K extends string>(id: string, state: SortState<K>) {
  try { window.localStorage.setItem(`gs-sort-${id}`, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
