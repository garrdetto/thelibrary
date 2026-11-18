export const arenaDuelSorts = ['kd', 'accuracy'] as const
export type ArenaDuelSort = (typeof arenaDuelSorts)[number]

export const arenaDuelSortNames: Record<ArenaDuelSort, string> = { kd: 'K/D ratio', accuracy: 'Accuracy' }

export const ARENA_ACCURACY_MIN_SHOTS = 30

export interface ArenaDuelRow {
  username: string
  matches: number
  wins: number
  kills: number
  deaths: number
  shots: number
  hits: number
}

export interface ArenaDuelBoardResult {
  sort: ArenaDuelSort
  rows: ArenaDuelRow[]
  mine: ArenaDuelRow | null
  signedIn: boolean
}

export function isArenaDuelSort(value: unknown): value is ArenaDuelSort {
  return typeof value === 'string' && (arenaDuelSorts as readonly string[]).includes(value)
}

export function killDeathRatio(row: Pick<ArenaDuelRow, 'kills' | 'deaths'>): number {
  return row.kills / Math.max(1, row.deaths)
}

export function accuracyShare(row: Pick<ArenaDuelRow, 'shots' | 'hits'>): number {
  return row.shots ? row.hits / row.shots : 0
}

export function formatKd(row: Pick<ArenaDuelRow, 'kills' | 'deaths'>): string {
  return killDeathRatio(row).toFixed(2)
}

export function formatAccuracy(row: Pick<ArenaDuelRow, 'shots' | 'hits'>): string {
  return row.shots ? `${(accuracyShare(row) * 100).toFixed(1)}%` : '—'
}

export async function fetchArenaDuelBoard(sort: ArenaDuelSort): Promise<ArenaDuelBoardResult> {
  const response = await fetch(`/api/arena-stats?sort=${sort}`, { credentials: 'same-origin', cache: 'no-store' })
  const result = await response.json().catch(() => ({})) as Partial<ArenaDuelBoardResult> & { error?: string }
  if (!response.ok || !Array.isArray(result.rows)) throw new Error(result.error ?? 'The 1v1 record book is unavailable right now.')
  return { sort, rows: result.rows, mine: result.mine ?? null, signedIn: Boolean(result.signedIn) }
}
