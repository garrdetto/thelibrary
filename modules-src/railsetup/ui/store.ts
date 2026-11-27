import type { Hardpoints } from '../sim/hardpoints'
import type { Snapshot } from '../sim/lab'

export type Remote = { signedIn: boolean; setups: Snapshot[]; hardpoints: { name: string; hardpoints: Hardpoints } | null }

const URL_ = '/api/railsetup'

export async function loadRemote(): Promise<Remote> {
  try {
    const response = await fetch(URL_, { credentials: 'same-origin' })
    if (!response.ok) throw new Error('offline')
    return await response.json() as Remote
  } catch {
    return { signedIn: false, setups: [], hardpoints: null }
  }
}

async function post(body: unknown): Promise<Remote | { error: string }> {
  try {
    const response = await fetch(URL_, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json() as Remote & { error?: string }
    if (!response.ok) return { error: data.error ?? 'Could not save to your account.' }
    return data
  } catch {
    return { error: 'Could not reach the library to save. Export the setup to keep a file.' }
  }
}

export const saveSetup = (setup: Snapshot) => post({ action: 'save', setup })
export const deleteSetup = (name: string) => post({ action: 'delete', name })
export const saveHardpoints = (name: string, hardpoints: Hardpoints) => post({ action: 'hardpoints', name, hardpoints })
export const clearHardpoints = () => post({ action: 'clear-hardpoints' })

const PREF = 'tl-railsetup-ui'
type Prefs = { help?: boolean; shut?: number[]; shutMobile?: number[] }

export function readPrefs(): Prefs {
  try { return JSON.parse(localStorage.getItem(PREF) || '{}') as Prefs } catch { return {} }
}

export function writePrefs(p: Prefs) {
  try { localStorage.setItem(PREF, JSON.stringify({ ...readPrefs(), ...p })) } catch { return }
}
