import type { WorldEdits } from '../../modules-src/tello/edits/WorldEdits'

const ENDPOINT = '/api/world-edits'
const FALLBACK_ERROR = 'Something went wrong with the world edits. Please try again.'

export type WorldEditRevision = {
  id: string
  createdAt: string
  updatedAt: string
  note: string
  ops: number
  bytes: number
  kept: boolean
  published: boolean
  draft: boolean
  author: string
}

export type WorldEditState = {
  edits: WorldEdits | null
  draftRev: string | null
  publishedRev: string | null
  publishedAt: string | null
  updatedAt: string | null
  revisions: WorldEditRevision[]
}

export type PublishedWorldEdits = {
  edits: WorldEdits | null
  rev: string | null
  publishedAt: string | null
}

async function readError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string }
    return data.error || FALLBACK_ERROR
  } catch {
    return FALLBACK_ERROR
  }
}

async function send<T>(query: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${ENDPOINT}${query}`, { credentials: 'same-origin', ...init })
  } catch {
    throw new Error('The server could not be reached. Check your connection and try again.')
  }
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as T
}

function post(body: Record<string, unknown>) {
  return send<WorldEditState>('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export const fetchPublishedEdits = () => send<PublishedWorldEdits>('', { method: 'GET' })
export const fetchDraftState = () => send<WorldEditState>('?draft=1', { method: 'GET', cache: 'no-store' })
export const saveDraft = (edits: WorldEdits, note?: string) => post({ action: 'save', edits, note })
export const snapshotDraft = (note: string) => post({ action: 'snapshot', note })
export const publishDraft = (note?: string) => post({ action: 'publish', note })
export const restoreRevision = (id: string) => post({ action: 'restore', id })
export const unpublishEdits = () => post({ action: 'unpublish' })
export const deleteRevision = (id: string) => post({ action: 'delete', id })
