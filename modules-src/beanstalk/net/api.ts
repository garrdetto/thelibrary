import type { DailyStatus } from '../../sunvault/engine/daily'
import type { Cell, EngineSnapshot, ForceOutcome, SpinResult } from '../engine/engine'

export interface StalkAccount {
  signedIn: true
  admin: boolean
  snapshot: EngineSnapshot
  sticky: (Cell | null)[][]
  daily: DailyStatus
}

export type StalkHello = StalkAccount | { signedIn: false }

export interface StalkSpin {
  result: SpinResult
  records: string[]
  ranked: boolean
}

export interface StalkCollect extends StalkAccount {
  collected: number
  streak: number
}

const ENDPOINT = '/api/beanstalk'

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

export async function fetchStalk(): Promise<StalkHello> {
  try {
    const response = await fetch(ENDPOINT, { credentials: 'same-origin' })
    if (!response.ok) return { signedIn: false }
    return (await response.json()) as StalkHello
  } catch {
    return { signedIn: false }
  }
}

export function stalkSpin(bet: number, force: ForceOutcome | null): Promise<StalkSpin> {
  return post<StalkSpin>(force ? { action: 'spin', bet, force } : { action: 'spin', bet })
}

export function stalkCollect(): Promise<StalkCollect> {
  return post<StalkCollect>({ action: 'collect' })
}
