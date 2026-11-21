import type { DailyStatus } from '../../sunvault/engine/daily'
import type { ForceOutcome, GameSnapshot, Round } from '../engine/game'

export interface DollazAccount {
  signedIn: true
  admin: boolean
  snapshot: GameSnapshot
  daily: DailyStatus
}

export type DollazHello = DollazAccount | { signedIn: false }

export interface DollazSpin {
  round: Round
  records: string[]
  ranked: boolean
}

export interface DollazCollect extends DollazAccount {
  collected: number
  streak: number
}

const ENDPOINT = '/api/modollaz'

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error) return body.error
  } catch {
    return `The machine could not be reached (${response.status}).`
  }
  return `The machine could not be reached (${response.status}).`
}

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as T
}

export async function fetchDollaz(): Promise<DollazHello> {
  try {
    const response = await fetch(ENDPOINT, { credentials: 'same-origin' })
    if (!response.ok) return { signedIn: false }
    return (await response.json()) as DollazHello
  } catch {
    return { signedIn: false }
  }
}

export function dollazSpin(bet: number, force: ForceOutcome | null): Promise<DollazSpin> {
  return post<DollazSpin>(force ? { action: 'spin', bet, force } : { action: 'spin', bet })
}

export function dollazCollect(): Promise<DollazCollect> {
  return post<DollazCollect>({ action: 'collect' })
}
