import { z } from 'zod'
import type { Env } from '../env.js'
import { json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { HANDLING_TRACKS, sanitizeHandling } from '../../../modules-src/shorttrack/shared/Handling'
import type { HandlingTune } from '../../../modules-src/shorttrack/shared/Handling'

const trackId = z.enum(HANDLING_TRACKS as [string, ...string[]])
const input = z.union([
  z.object({ action: z.literal('save'), track: trackId, tune: z.record(z.string(), z.number().finite()) }).strict(),
  z.object({ action: z.literal('reset'), track: trackId }).strict(),
])

let tableReady: Promise<unknown> | null = null
function ensureTable(env: Env) {
  tableReady ??= env.DB.prepare('CREATE TABLE IF NOT EXISTS shorttrack_handling (track TEXT PRIMARY KEY, tune TEXT NOT NULL, updated_by TEXT, updated_at INTEGER NOT NULL)').run().catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

async function liveTunes(env: Env) {
  const rows = await env.DB.prepare('SELECT track, tune, updated_at FROM shorttrack_handling').all<{ track: string; tune: string; updated_at: number }>()
  const tunes: Record<string, HandlingTune> = {}
  const updated: Record<string, number> = {}
  for (const row of rows.results) {
    if (!(HANDLING_TRACKS as string[]).includes(row.track)) continue
    let parsed: unknown = null
    try { parsed = JSON.parse(row.tune) } catch { parsed = null }
    tunes[row.track] = sanitizeHandling(parsed)
    updated[row.track] = row.updated_at
  }
  return { tunes, updated }
}

/**
 * GET: the live handling tune of every Short Track track (public), plus `admin` for the administrator.
 * POST `{action:'save', track, tune}` (admin): publish a track's handling. `{action:'reset', track}`: back to stock.
 */
export async function shorttrackHandling(request: Request, env: Env) {
  await ensureTable(env)
  if (request.method === 'GET') {
    const { tunes, updated } = await liveTunes(env)
    const user = await currentUser(request, env)
    return json({ tunes, updated, admin: user?.isAdmin === true }, 200, { 'Cache-Control': 'no-store' })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in as the administrator to change the handling.')
  if (!user.isAdmin) return json({ error: 'Only the administrator can change the handling.' }, 403)
  const parsed = input.safeParse(await readJson(request, 4000))
  if (!parsed.success) return json({ error: 'Those handling settings could not be read.' }, 400)
  const body = parsed.data
  if (body.action === 'reset') {
    await env.DB.prepare('DELETE FROM shorttrack_handling WHERE track = ?').bind(body.track).run()
    return json({ track: body.track, tune: {}, updatedAt: null })
  }
  const tune = sanitizeHandling(body.tune)
  const now = Date.now()
  if (Object.keys(tune).length === 0) await env.DB.prepare('DELETE FROM shorttrack_handling WHERE track = ?').bind(body.track).run()
  else await env.DB.prepare('INSERT INTO shorttrack_handling (track, tune, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(track) DO UPDATE SET tune = excluded.tune, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind(body.track, JSON.stringify(tune), user.username, now).run()
  return json({ track: body.track, tune, updatedAt: Object.keys(tune).length ? now : null })
}
