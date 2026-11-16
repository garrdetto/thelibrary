import type { DailyStatus } from '../engine/daily'
import type { EngineSnapshot, ForceOutcome, Grid, SpinResult } from '../engine/slotEngine'

export interface VaultAccount {
  signedIn: true
  admin: boolean
  snapshot: EngineSnapshot
  daily: DailyStatus
  resume: { grid: Grid; held: boolean[][] } | null
}

export type VaultHello = VaultAccount | { signedIn: false }

export interface VaultSpin {
  result: SpinResult
  records: string[]
  ranked: boolean
}

export interface VaultCollect extends VaultAccount {
  collected: number
  streak: number
}

const ENDPOINT = '/api/sunvault'

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error) return body.error
  } catch {
    return `The vault could not be reached (${response.status}).`
  }
  return `The vault could not be reached (${response.status}).`
}

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as T
}

export async function fetchVault(): Promise<VaultHello> {
  try {
    const response = await fetch(ENDPOINT, { credentials: 'same-origin' })
    if (!response.ok) return { signedIn: false }
    return (await response.json()) as VaultHello
  } catch {
    return { signedIn: false }
  }
}

export function vaultSpin(bet: number, force: ForceOutcome | null): Promise<VaultSpin> {
  return post<VaultSpin>(force ? { action: 'spin', bet, force } : { action: 'spin', bet })
}

export function vaultCollect(): Promise<VaultCollect> {
  return post<VaultCollect>({ action: 'collect' })
}
