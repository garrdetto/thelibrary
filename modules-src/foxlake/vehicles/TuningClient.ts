/**
 * Life Sim's page side of the vehicle tuning (Tuning.ts): reads the published tuning while the map loads (kept on this
 * device for when the site can't be reached) and applies it once the vehicles are registered; the developer panel
 * edits a working copy live and saves it for everyone.
 */
import { store } from '../../maplestreet/src/core/Storage'
import { applyTuning, emptyTuning, isTuningDoc, type TuningDoc } from './Tuning'

const KEY = 'foxlake/vehicle-tuning/v1'
const URL_ = '/api/lifesim-tuning'

let published: TuningDoc = emptyTuning()

/** The tuning everyone has now (what the panel's Reset goes back to). */
export const publishedTuning = (): TuningDoc => published

export async function fetchTuning(): Promise<TuningDoc> {
  const online = location.protocol === 'https:' || location.protocol === 'http:'
  if (online) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const res = await fetch(URL_, { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
      if (res.ok) {
        const data = (await res.json()) as { tuning?: unknown }
        if (isTuningDoc(data.tuning)) {
          store.set(KEY, JSON.stringify(data.tuning))
          return (published = data.tuning)
        }
      }
    } catch {
      /* offline: the copy on this device */
    } finally {
      clearTimeout(timer)
    }
  }
  const cached = store.json<unknown>(KEY)
  return (published = isTuningDoc(cached) ? cached : emptyTuning())
}

/** Applies the published tuning to the registered vehicles (after `registerCustomVehicles`). */
export function applyPublishedTuning(): void {
  applyTuning(published)
}

/** Saves the tuning for everyone (administrator session); resolves with an error message, or null when saved. */
export async function saveTuning(doc: TuningDoc): Promise<string | null> {
  try {
    const res = await fetch(URL_, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) })
    const data = (await res.json().catch(() => ({}))) as { tuning?: unknown; error?: unknown }
    if (!res.ok || !isTuningDoc(data.tuning)) return typeof data.error === 'string' ? data.error : 'The tuning could not be saved.'
    published = data.tuning
    store.set(KEY, JSON.stringify(published))
    return null
  } catch {
    return 'The site could not be reached, so the tuning was not saved.'
  }
}
