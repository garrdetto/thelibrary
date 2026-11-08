/** REST calls to `/api/hood`: list a street and move a new household in. */
import type { LotShell } from '../../shared/Lot'
import type { Look } from '../../shared/Look'

export interface StreetLotInfo {
  lot: number
  address: string
  owner: string | null
  home: boolean
  visitors: number
  shell: LotShell | null
  mine: boolean
}

export interface StreetInfo {
  me: { signedIn: boolean; name: string | null; home: { street: number; lot: number } | null }
  street: number
  name: string
  streets: number
  open: number
  lots: StreetLotInfo[]
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string }
    return body.error ?? 'Something went wrong. Please try again.'
  } catch {
    return 'Something went wrong. Please try again.'
  }
}

export async function fetchStreet(street?: number): Promise<StreetInfo> {
  const query = street === undefined ? '' : `?street=${street}`
  const response = await fetch(`/api/hood${query}`, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(await readError(response))
  return await response.json() as StreetInfo
}

export async function claimLot(street: number, lot: number, household: { name: string; sims: { name: string; look: Look }[] }): Promise<void> {
  const response = await fetch('/api/hood', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'claim', street, lot, household }),
  })
  if (!response.ok) throw new Error(await readError(response))
}
