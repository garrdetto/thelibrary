import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser } from '../auth.js'
import type { SessionUser } from '../auth.js'
import { checkWorldEdits } from '../world-edits.js'
import { EDIT_LIMITS, WORLD_ID } from '../../../modules-src/tello/edits/WorldEdits'
import type { WorldEditRevision, WorldEditState } from '../../lib/world-edits-client'

const REVISION_LIMIT = 60
const PUBLIC_CACHE = { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=60' }
const NO_STORE = { 'Cache-Control': 'no-store' }
const REVISION_COLUMNS = 'id, created_at, updated_at, author, note, ops, bytes, kept'
const editsKey = (revisionId: string) => `world-edits/${WORLD_ID}/${revisionId}`

const TABLES = [
  `CREATE TABLE IF NOT EXISTS world_edit_revisions (id TEXT PRIMARY KEY, world TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    author TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', ops INTEGER NOT NULL, bytes INTEGER NOT NULL, kept INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS world_edit_revisions_world_created ON world_edit_revisions (world, created_at)',
  'CREATE TABLE IF NOT EXISTS world_edit_state (world TEXT PRIMARY KEY, draft_id TEXT, published_id TEXT, published_at INTEGER, updated_at INTEGER NOT NULL)',
]

const note = z.string().trim().max(EDIT_LIMITS.note).optional()
const revisionId = z.string().regex(/^wr_[0-9a-f]{10}$/)
const world = z.string().max(64).optional()

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), world, edits: z.unknown(), note }),
  z.object({ action: z.literal('snapshot'), world, note }),
  z.object({ action: z.literal('publish'), world, note }),
  z.object({ action: z.literal('restore'), world, id: revisionId }),
  z.object({ action: z.literal('unpublish'), world }),
  z.object({ action: z.literal('delete'), world, id: revisionId }),
])

type RevisionRow = { id: string; created_at: number; updated_at: number; author: string; note: string; ops: number; bytes: number; kept: number }
type StateRow = { draft_id: string | null; published_id: string | null; published_at: number | null; updated_at: number }
type DraftMeta = Omit<WorldEditState, 'edits'>

const encoder = new TextEncoder()
const decoder = new TextDecoder()

let ready: Promise<unknown> | null = null
function ensureTables(env: Env) {
  ready ??= env.DB.batch(TABLES.map(sql => env.DB.prepare(sql))).catch(error => { ready = null; throw error })
  return ready
}

function newRevisionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(5))
  return `wr_${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function iso(milliseconds: number | null | undefined) {
  return typeof milliseconds === 'number' ? new Date(milliseconds).toISOString() : null
}

function dateLabel(milliseconds: number) {
  return `${new Date(milliseconds).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function given(value: string | undefined) {
  return value ? value : null
}

function checkWorld(value: string | null | undefined) {
  if (value !== null && value !== undefined && value !== WORLD_ID) throw new HttpError(400, 'That world does not exist.')
}

async function requireAdmin(request: Request, env: Env) {
  const user = await currentUser(request, env)
  if (!user?.isAdmin) throw new HttpError(403, 'Administrator access required.')
  return user
}

function readState(env: Env) {
  return env.DB.prepare('SELECT draft_id, published_id, published_at, updated_at FROM world_edit_state WHERE world = ?').bind(WORLD_ID).first<StateRow>()
}

function readRevision(env: Env, id: string) {
  return env.DB.prepare(`SELECT ${REVISION_COLUMNS} FROM world_edit_revisions WHERE id = ? AND world = ?`).bind(id, WORLD_ID).first<RevisionRow>()
}

async function readEditsText(env: Env, id: string) {
  const stored = await env.FILES.getWithMetadata(editsKey(id), 'arrayBuffer')
  return stored.value ? decoder.decode(stored.value) : null
}

function editsResponse(editsText: string | null, rest: object, headers: Record<string, string>) {
  const tail = JSON.stringify(rest).slice(1)
  const body = `{"edits":${editsText ?? 'null'}${tail === '}' ? '}' : `,${tail}`}`
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers } })
}

function toRevision(row: RevisionRow, draftRev: string | null, publishedRev: string | null): WorldEditRevision {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    note: row.note,
    ops: row.ops,
    bytes: row.bytes,
    kept: row.kept === 1,
    published: row.id === publishedRev,
    draft: row.id === draftRev,
    author: row.author,
  }
}

async function draftState(env: Env, known?: { rev: string; text: string }): Promise<{ meta: DraftMeta; editsText: string | null }> {
  const [state, listed] = await Promise.all([
    readState(env),
    env.DB.prepare(`SELECT ${REVISION_COLUMNS} FROM world_edit_revisions WHERE world = ? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(WORLD_ID, REVISION_LIMIT).all<RevisionRow>(),
  ])
  const draftRev = state?.draft_id ?? null
  const publishedRev = state?.published_id ?? null
  const rows = [...listed.results]
  for (const id of new Set([draftRev, publishedRev])) {
    if (!id || rows.some(row => row.id === id)) continue
    const row = await readRevision(env, id)
    if (row) rows.push(row)
  }
  let editsText: string | null = null
  if (draftRev) editsText = known?.rev === draftRev ? known.text : await readEditsText(env, draftRev)
  if (editsText === null && publishedRev) editsText = await readEditsText(env, publishedRev)
  return {
    editsText,
    meta: {
      draftRev,
      publishedRev,
      publishedAt: publishedRev ? iso(state?.published_at) : null,
      updatedAt: iso(state?.updated_at),
      revisions: rows.map(row => toRevision(row, draftRev, publishedRev)),
    },
  }
}

async function draftResponse(env: Env, known?: { rev: string; text: string }) {
  const { meta, editsText } = await draftState(env, known)
  return editsResponse(editsText, meta, NO_STORE)
}

async function publishedResponse(env: Env) {
  const state = await readState(env).catch(error => { if (String(error).includes('no such table')) return null; throw error })
  const rev = state?.published_id ?? null
  const editsText = rev ? await readEditsText(env, rev) : null
  return editsResponse(editsText, { rev: editsText ? rev : null, publishedAt: editsText ? iso(state?.published_at) : null }, PUBLIC_CACHE)
}

function serialize(input: unknown) {
  const checked = checkWorldEdits(input)
  if (!checked.ok) throw new HttpError(400, checked.error)
  const text = JSON.stringify(checked.edits)
  if (text.length > EDIT_LIMITS.bytes) throw new HttpError(413, 'These world edits are too large to save.')
  return { text, ops: checked.edits.ops.length, bytes: encoder.encode(text).byteLength }
}

async function createDraft(env: Env, user: SessionUser, document: { text: string; ops: number; bytes: number }, revisionNote: string) {
  const id = newRevisionId()
  const now = Date.now()
  await env.FILES.put(editsKey(id), encoder.encode(document.text))
  await env.DB.batch([
    env.DB.prepare('INSERT INTO world_edit_revisions (id, world, created_at, updated_at, author, note, ops, bytes, kept) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
      .bind(id, WORLD_ID, now, now, user.username, revisionNote, document.ops, document.bytes),
    env.DB.prepare('INSERT INTO world_edit_state (world, draft_id, published_id, published_at, updated_at) VALUES (?, ?, NULL, NULL, ?) ON CONFLICT(world) DO UPDATE SET draft_id = excluded.draft_id, updated_at = excluded.updated_at')
      .bind(WORLD_ID, id, now),
  ])
  return draftResponse(env, { rev: id, text: document.text })
}

async function requireDraft(env: Env) {
  const state = await readState(env)
  const draft = state?.draft_id ? await readRevision(env, state.draft_id) : null
  if (!state || !draft) throw new HttpError(400, 'There is no draft yet. Save your edits first.')
  return { state, draft }
}

async function save(env: Env, user: SessionUser, edits: unknown, revisionNote: string | undefined) {
  const document = serialize(edits)
  const state = await readState(env)
  const draft = state?.draft_id ? await readRevision(env, state.draft_id) : null
  if (!draft || draft.kept === 1 || draft.id === state?.published_id) return createDraft(env, user, document, given(revisionNote) ?? '')
  const now = Date.now()
  await env.FILES.put(editsKey(draft.id), encoder.encode(document.text))
  await env.DB.batch([
    env.DB.prepare('UPDATE world_edit_revisions SET updated_at = ?, ops = ?, bytes = ?, note = COALESCE(?, note) WHERE id = ? AND world = ?')
      .bind(now, document.ops, document.bytes, given(revisionNote), draft.id, WORLD_ID),
    env.DB.prepare('UPDATE world_edit_state SET updated_at = ? WHERE world = ?').bind(now, WORLD_ID),
  ])
  return draftResponse(env, { rev: draft.id, text: document.text })
}

async function snapshot(env: Env, revisionNote: string | undefined) {
  const { draft } = await requireDraft(env)
  await env.DB.batch([
    env.DB.prepare('UPDATE world_edit_revisions SET kept = 1, note = COALESCE(?, note) WHERE id = ? AND world = ?').bind(given(revisionNote), draft.id, WORLD_ID),
    env.DB.prepare('UPDATE world_edit_state SET updated_at = ? WHERE world = ?').bind(Date.now(), WORLD_ID),
  ])
  return draftResponse(env)
}

async function publish(env: Env, revisionNote: string | undefined) {
  const { draft } = await requireDraft(env)
  const text = await readEditsText(env, draft.id)
  if (text === null) throw new HttpError(400, 'The draft could not be found. Save your edits again before publishing.')
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('UPDATE world_edit_revisions SET kept = 1, note = COALESCE(?, note) WHERE id = ? AND world = ?').bind(given(revisionNote), draft.id, WORLD_ID),
    env.DB.prepare('UPDATE world_edit_state SET published_id = ?, published_at = ?, updated_at = ? WHERE world = ?').bind(draft.id, now, now, WORLD_ID),
  ])
  return draftResponse(env, { rev: draft.id, text })
}

async function restore(env: Env, user: SessionUser, id: string) {
  const row = await readRevision(env, id)
  if (!row) throw new HttpError(404, 'That revision was not found.')
  const stored = await readEditsText(env, row.id)
  if (stored === null) throw new HttpError(400, 'That revision\'s edits are missing.')
  let parsed: unknown
  try { parsed = JSON.parse(stored) } catch { throw new HttpError(400, 'That revision\'s edits could not be read.') }
  const document = serialize(parsed)
  const label = `Restored from ${dateLabel(row.created_at)}${row.note ? ` (${row.note})` : ''}`
  return createDraft(env, user, document, label.slice(0, EDIT_LIMITS.note))
}

async function unpublish(env: Env) {
  await env.DB.prepare('INSERT INTO world_edit_state (world, draft_id, published_id, published_at, updated_at) VALUES (?, NULL, NULL, NULL, ?) ON CONFLICT(world) DO UPDATE SET published_id = NULL, published_at = NULL, updated_at = excluded.updated_at')
    .bind(WORLD_ID, Date.now()).run()
  return draftResponse(env)
}

async function remove(env: Env, id: string) {
  const state = await readState(env)
  if (id === state?.published_id) throw new HttpError(400, 'This revision is published. Unpublish it or publish another before deleting it.')
  if (id === state?.draft_id) throw new HttpError(400, 'This revision is the current draft and can\'t be deleted.')
  const row = await readRevision(env, id)
  if (!row) throw new HttpError(404, 'That revision was not found.')
  await env.DB.prepare('DELETE FROM world_edit_revisions WHERE id = ? AND world = ?').bind(row.id, WORLD_ID).run()
  await env.FILES.delete(editsKey(row.id))
  return draftResponse(env)
}

export async function worldEdits(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'GET') {
    checkWorld(url.searchParams.get('world'))
    if (!url.searchParams.has('draft')) return publishedResponse(env)
    await requireAdmin(request, env)
    await ensureTables(env)
    return draftResponse(env)
  }
  if (request.method !== 'POST') return json({ error: 'Not found.' }, 404)
  requireSameOrigin(request)
  const user = await requireAdmin(request, env)
  const input = actionSchema.parse(await readJson(request, EDIT_LIMITS.bytes + 4096))
  checkWorld(input.world)
  await ensureTables(env)
  switch (input.action) {
    case 'save': return save(env, user, input.edits, input.note)
    case 'snapshot': return snapshot(env, input.note)
    case 'publish': return publish(env, input.note)
    case 'restore': return restore(env, user, input.id)
    case 'unpublish': return unpublish(env)
    case 'delete': return remove(env, input.id)
  }
}
