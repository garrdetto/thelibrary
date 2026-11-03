/** Leaderboard client for /api/fairway: posts round, closest-to-the-pin and match results, and reads the boards. The hub notifier is injected so this file stays free of engine and DOM imports. */

export type FairwayBoard = 'round' | 'pin' | 'match'

export interface FairwayRecordRow {
  username: string
  value: number
  detail: Record<string, unknown> | null
  date: string
}

export interface FairwayBoardResult {
  board: FairwayBoard
  records: FairwayRecordRow[]
  personalBest: number | null
  signedIn: boolean
}

export type BoardNotifier = (board: FairwayBoard) => void

function runId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    const hex = (length: number) => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
  }
}

/**
 * Saves one result. value is gross strokes for "round", centimetres to the pin for "pin" and the finishing place for
 * "match". The request is same-origin with keepalive so it survives the page closing; afterwards the hub is told which
 * board changed so it can refresh, whether or not the save succeeded (a signed-out visitor gets a 401).
 */
export async function saveRecord(board: FairwayBoard, value: number, detail: Record<string, unknown>, notify: BoardNotifier): Promise<boolean> {
  const rounded = Math.round(value)
  if (!Number.isFinite(rounded) || rounded < 0) return false
  try {
    const response = await fetch('/api/fairway', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', board, value: rounded, run: runId(), detail }),
    })
    notify(board)
    return response.ok
  } catch {
    notify(board)
    return false
  }
}

export async function loadBoard(board: FairwayBoard): Promise<FairwayBoardResult> {
  const response = await fetch(`/api/fairway?board=${encodeURIComponent(board)}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('The record book is unavailable right now.')
  return (await response.json()) as FairwayBoardResult
}
