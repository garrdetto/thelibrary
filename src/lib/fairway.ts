export const fairwayBoards = ['round', 'pin', 'match'] as const
export type FairwayBoard = (typeof fairwayBoards)[number]

export const fairwayBoardNames: Record<FairwayBoard, string> = {
  round: 'Round',
  pin: 'Closest to the pin',
  match: 'Match history',
}

export const fairwayBoardLimits: Record<FairwayBoard, { min: number; max: number }> = {
  round: { min: 9, max: 200 },
  pin: { min: 0, max: 100000 },
  match: { min: 1, max: 4 },
}

export type FairwayRecord = {
  username: string
  value: number
  detail: Record<string, unknown> | null
  date: string
}

export type FairwayBoardResult = {
  board: FairwayBoard
  records: FairwayRecord[]
  personalBest: number | null
  signedIn: boolean
}

export function isFairwayBoard(value: unknown): value is FairwayBoard {
  return typeof value === 'string' && (fairwayBoards as readonly string[]).includes(value)
}

const ordinals = ['st', 'nd', 'rd']

export function formatFairwayValue(board: FairwayBoard, value: number) {
  if (board === 'round') return `${value} strokes`
  if (board === 'pin') {
    const metres = value / 100
    return `${metres.toFixed(metres < 10 ? 2 : 1)} m · ${(metres / 0.9144).toFixed(1)} yd`
  }
  return `${value}${ordinals[value - 1] ?? 'th'} place`
}

export async function fetchFairwayBoard(board: FairwayBoard): Promise<FairwayBoardResult> {
  const response = await fetch(`/api/fairway?board=${encodeURIComponent(board)}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('The record book is unavailable right now. Try again in a moment.')
  return await response.json() as FairwayBoardResult
}

export async function saveFairwayRecord(board: FairwayBoard, value: number, run: string, detail: Record<string, unknown>) {
  const response = await fetch('/api/fairway', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'record', board, value, run, detail }),
  })
  const result = await response.json().catch(() => ({})) as { saved?: boolean; error?: string }
  if (!response.ok) throw new Error(result.error ?? 'The result could not be saved.')
  return Boolean(result.saved)
}
