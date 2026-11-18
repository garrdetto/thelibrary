import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, parseStored, readJson, readText, requireSameOrigin } from '../http.js'
import { currentUser, randomHex, sha256 } from '../auth.js'
import { gemini, TEXT_MODEL } from '../gemini.js'
import { courseShotSchema, ensureGsproTables, insertCourseShots, insertShots, SESSION_GAP_MS, sessionId, sessionLabel, shotColumns, shotFromOpenConnect, shotInputSchema, toBridgeStatus, toSession, toShot } from '../gspro.js'
import { normalizeClub } from '../../lib/gspro/clubs.js'
import type { ShotInput } from '../../lib/gspro/types.js'

const ingestLimit = 1_500_000
const bridgeShot = z.object({
  ref: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  at: z.number().int().positive(),
  club: z.string().max(24).nullable().optional(),
  handed: z.enum(['RH', 'LH']).optional(),
  payload: z.record(z.string(), z.unknown()),
})
const ingestInput = z.object({
  shots: z.array(bridgeShot).max(200).optional(),
  course: z.array(z.unknown()).max(100).optional(),
  bag: z.array(z.object({ name: z.string().min(1).max(40), loft: z.number().finite().min(0).max(80) })).max(30).optional(),
  heartbeat: z.object({
    version: z.string().max(32),
    gsproConnected: z.boolean(),
    monitorConnected: z.boolean(),
    queued: z.number().int().min(0).max(1_000_000),
    listen: z.string().max(64),
    roundFile: z.boolean().optional(),
  }).optional(),
})

async function bridgeUser(request: Request, env: Env) {
  const header = request.headers.get('authorization') ?? ''
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!/^gsb_[a-f0-9]{48}$/.test(key)) return null
  return env.DB.prepare('SELECT user_id FROM gspro_bridge WHERE key_hash = ?').bind(await sha256(key)).first<{ user_id: string }>()
}

/** The open bridge session for a shot at `at`, or a new one when the last shot was more than 30 minutes earlier. */
async function bridgeSession(env: Env, userId: string, at: number) {
  const open = await env.DB.prepare(`SELECT id, last_shot_at FROM gspro_sessions WHERE user_id = ? AND source = 'bridge' AND closed = 0 ORDER BY last_shot_at DESC LIMIT 1`).bind(userId).first<{ id: string; last_shot_at: number }>()
  if (open && at - open.last_shot_at < SESSION_GAP_MS && at >= open.last_shot_at - SESSION_GAP_MS) return open.id
  const id = sessionId()
  await env.DB.prepare(`INSERT INTO gspro_sessions (id, user_id, label, source, started_at, last_shot_at, shot_count) VALUES (?, ?, ?, 'bridge', ?, ?, 0)`).bind(id, userId, sessionLabel(at, 'GSPro'), at, at).run()
  return id
}

async function ingest(request: Request, env: Env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  await ensureGsproTables(env)
  const owner = await bridgeUser(request, env)
  if (!owner) return json({ error: 'Unknown bridge key. Create a new one on the GSPro Analyzer page.' }, 401)
  const parsed = ingestInput.safeParse(JSON.parse(await readText(request, ingestLimit)))
  if (!parsed.success) return json({ error: 'The bridge update could not be read.' }, 400)
  const now = Date.now()
  const shots = [...(parsed.data.shots ?? [])].sort((a, b) => a.at - b.at)
  let added = 0
  const accepted: string[] = []
  let current: { id: string; shots: ShotInput[]; raw: string[] } | null = null
  const flush = async () => {
    if (!current) return
    added += await insertShots(env, owner.user_id, current.id, 'bridge', current.shots, current.raw)
    current = null
  }
  for (const item of shots) {
    const at = Math.min(item.at, now + 60_000)
    const shot = shotFromOpenConnect(item.payload, { ref: item.ref, at, club: normalizeClub(item.club ?? null), handed: item.handed ?? 'RH' })
    accepted.push(item.ref)
    if (!shot) continue
    const last: number = current ? current.shots[current.shots.length - 1].at : 0
    if (!current || at - last > SESSION_GAP_MS) {
      await flush()
      current = { id: await bridgeSession(env, owner.user_id, at), shots: [], raw: [] }
    }
    current!.shots.push(shot)
    current!.raw.push(JSON.stringify(item.payload).slice(0, 4000))
  }
  await flush()
  const courseItems = parsed.data.course ?? []
  const course = courseItems.map(item => courseShotSchema.safeParse(item)).filter(result => result.success).map(result => result.data!)
  const acceptedCourse = courseItems.map(item => item && typeof item === 'object' && 'ref' in item ? String((item as { ref: unknown }).ref) : '').filter(Boolean)
  const addedCourse = course.length ? await insertCourseShots(env, owner.user_id, course) : 0
  if (parsed.data.bag) await env.DB.prepare('INSERT INTO gspro_settings (user_id, bag, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET bag = excluded.bag, updated_at = excluded.updated_at').bind(owner.user_id, JSON.stringify(parsed.data.bag), now).run()
  const status = parsed.data.heartbeat ? JSON.stringify(parsed.data.heartbeat) : null
  await env.DB.prepare('UPDATE gspro_bridge SET last_seen_at = ?, status = COALESCE(?, status) WHERE user_id = ?').bind(now, status, owner.user_id).run()
  return json({ ok: true, accepted, added, acceptedCourse, addedCourse, skippedCourse: courseItems.length - course.length })
}

async function requireAdmin(request: Request, env: Env) {
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'This request is not allowed.')
  const user = await currentUser(request, env)
  if (!user) throw new HttpError(401, 'Sign in as the administrator to use the GSPro Analyzer.')
  if (!user.isAdmin) throw new HttpError(403, 'The GSPro Analyzer is only open to the administrator.')
  return user
}

async function bridgeRow(env: Env, userId: string) {
  return env.DB.prepare('SELECT key_hint, created_at, last_seen_at, status FROM gspro_bridge WHERE user_id = ?').bind(userId).first<{ key_hint: string; created_at: number; last_seen_at: number | null; status: string | null }>()
}

async function read(request: Request, env: Env, userId: string) {
  const url = new URL(request.url)
  const params = url.searchParams
  if (params.has('live')) {
    const since = Math.max(0, Number(params.get('since')) || 0)
    const [shots, bridge, session] = await Promise.all([
      env.DB.prepare(`SELECT ${shotColumns} FROM gspro_shots WHERE user_id = ? AND id > ? AND source != 'csv' ORDER BY id DESC LIMIT 60`).bind(userId, since).all(),
      bridgeRow(env, userId),
      env.DB.prepare(`SELECT id, label, source, started_at, last_shot_at, shot_count, closed FROM gspro_sessions WHERE user_id = ? AND source = 'bridge' ORDER BY last_shot_at DESC LIMIT 1`).bind(userId).first(),
    ])
    return json({
      shots: (shots.results as Parameters<typeof toShot>[0][]).map(toShot).reverse(),
      bridge: toBridgeStatus(bridge),
      session: session ? toSession(session as Parameters<typeof toSession>[0]) : null,
      now: Date.now(),
    })
  }
  if (params.has('rounds')) {
    const rows = await env.DB.prepare('SELECT id, course, started_at, last_shot_at, shot_count, players FROM gspro_rounds WHERE user_id = ? ORDER BY last_shot_at DESC LIMIT 200').bind(userId).all<{ id: string; course: string; started_at: number; last_shot_at: number; shot_count: number; players: string }>()
    return json({ rounds: rows.results.map(row => ({ id: row.id, course: row.course, startedAt: row.started_at, lastShotAt: row.last_shot_at, shotCount: row.shot_count, players: parseStored<string[]>(row.players, []) })) })
  }
  if (params.has('round')) {
    const id = params.get('round') ?? ''
    const owned = await env.DB.prepare('SELECT id FROM gspro_rounds WHERE id = ? AND user_id = ?').bind(id, userId).first()
    if (!owned) throw new HttpError(404, 'That round was not found.')
    const rows = await env.DB.prepare('SELECT id, round_id, data FROM gspro_course_shots WHERE round_id = ? ORDER BY hole, hole_shot, id').bind(id).all<{ id: number; round_id: string; data: string }>()
    return json({ shots: rows.results.map(row => ({ ...parseStored<Record<string, unknown>>(row.data, {}), id: row.id, roundId: row.round_id })) })
  }
  if (params.has('bag')) {
    const row = await env.DB.prepare('SELECT bag, updated_at FROM gspro_settings WHERE user_id = ?').bind(userId).first<{ bag: string | null; updated_at: number }>()
    return json({ bag: parseStored<{ name: string; loft: number }[]>(row?.bag, []), updatedAt: row?.updated_at ?? null })
  }
  if (params.has('sessions')) {
    const rows = await env.DB.prepare('SELECT id, label, source, started_at, last_shot_at, shot_count, closed FROM gspro_sessions WHERE user_id = ? ORDER BY last_shot_at DESC LIMIT 300').bind(userId).all()
    return json({ sessions: (rows.results as Parameters<typeof toSession>[0][]).map(row => toSession(row)) })
  }
  if (params.has('shots')) {
    const session = params.get('session')
    const days = Math.min(3650, Math.max(1, Number(params.get('days')) || 90))
    const rows = session
      ? await env.DB.prepare(`SELECT ${shotColumns} FROM gspro_shots WHERE user_id = ? AND session_id = ? ORDER BY id LIMIT 5000`).bind(userId, session).all()
      : await env.DB.prepare(`SELECT ${shotColumns} FROM gspro_shots WHERE user_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 5000`).bind(userId, Date.now() - days * 86_400_000).all()
    const shots = (rows.results as Parameters<typeof toShot>[0][]).map(toShot)
    return json({ shots: session ? shots : shots.reverse() })
  }
  return json({ bridge: toBridgeStatus(await bridgeRow(env, userId)) })
}

const importInput = z.object({ label: z.string().trim().min(1).max(80), sessionId: z.string().regex(/^gs_[a-f0-9]{16}$/).optional(), shots: z.array(shotInputSchema).min(1).max(1000) })
const coachMetric = z.object({ mean: z.number().finite(), sd: z.number().finite() }).nullable()
const coachInput = z.object({
  scope: z.string().max(80),
  handed: z.enum(['RH', 'LH']),
  clubs: z.array(z.object({
    club: z.string().max(24),
    shots: z.number().int().min(1).max(10000),
    carryEstimated: z.boolean(),
    metrics: z.record(z.string().max(24), coachMetric),
  })).min(1).max(30),
})
const coachResult = z.object({ headline: z.string(), tips: z.array(z.object({ title: z.string(), detail: z.string(), drill: z.string().optional() })).max(8) })

const coachInstruction = `You are a golf coach reading launch-monitor numbers from a GSPro simulator session. You get per-club averages (mean) and standard deviations (sd).
Units: speeds mph, carry/total/offline yards (offline: positive = right of target, right-handed view), angles degrees (path positive = in to out; face and faceToPath positive = open; spinAxis positive = fade), spin rpm, apex feet, impact mm.
Carry may be a physics estimate when carryEstimated is true. Give a one-sentence headline and 3 to 6 specific, prioritized tips that cite the numbers. Each tip may have a short drill.
Never invent numbers that are not in the data. Plain words, no markdown.`

async function coach(env: Env, body: unknown) {
  const input = coachInput.parse(body)
  const result = await gemini(env).models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
    config: {
      systemInstruction: coachInstruction,
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { headline: { type: 'string' }, tips: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, drill: { type: 'string' } }, required: ['title', 'detail'] } } }, required: ['headline', 'tips'] },
      maxOutputTokens: 4000,
    },
  })
  try { return json(coachResult.parse(JSON.parse(result.text || '{}'))) } catch { return json({ error: 'The coach did not return usable tips. Please try again.' }, 422) }
}

const actionInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create-key') }),
  z.object({ action: z.literal('revoke-key') }),
  z.object({ action: z.literal('new-session') }),
  z.object({ action: z.literal('import'), data: importInput }),
  z.object({ action: z.literal('update-shot'), id: z.number().int().positive(), club: z.string().max(12).nullable().optional(), excluded: z.boolean().optional() }),
  z.object({ action: z.literal('rename-session'), id: z.string().regex(/^gs_[a-f0-9]{16}$/), label: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('delete-session'), id: z.string().regex(/^gs_[a-f0-9]{16}$/) }),
  z.object({ action: z.literal('delete-round'), id: z.string().regex(/^gr_[a-f0-9]{16}$/) }),
  z.object({ action: z.literal('coach'), data: z.unknown() }),
])

async function act(request: Request, env: Env, userId: string) {
  requireSameOrigin(request)
  const input = actionInput.parse(await readJson(request, 1_500_000))
  switch (input.action) {
    case 'create-key': {
      const key = `gsb_${randomHex(24)}`
      await env.DB.prepare(`INSERT INTO gspro_bridge (user_id, key_hash, key_hint, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(user_id) DO UPDATE SET key_hash = excluded.key_hash, key_hint = excluded.key_hint, created_at = excluded.created_at, last_seen_at = NULL, status = NULL`).bind(userId, await sha256(key), `…${key.slice(-4)}`, Date.now()).run()
      return json({ key, bridge: toBridgeStatus(await bridgeRow(env, userId)) })
    }
    case 'revoke-key':
      await env.DB.prepare('DELETE FROM gspro_bridge WHERE user_id = ?').bind(userId).run()
      return json({ bridge: toBridgeStatus(null) })
    case 'new-session':
      await env.DB.prepare(`UPDATE gspro_sessions SET closed = 1 WHERE user_id = ? AND source = 'bridge' AND closed = 0`).bind(userId).run()
      return json({ ok: true })
    case 'import': {
      const { data } = input
      let id = data.sessionId
      if (id) {
        const owned = await env.DB.prepare('SELECT id FROM gspro_sessions WHERE id = ? AND user_id = ?').bind(id, userId).first()
        if (!owned) throw new HttpError(404, 'That session was not found.')
      } else {
        id = sessionId()
        const first = Math.min(...data.shots.map(shot => shot.at))
        await env.DB.prepare(`INSERT INTO gspro_sessions (id, user_id, label, source, started_at, last_shot_at, shot_count, closed) VALUES (?, ?, ?, 'csv', ?, ?, 0, 1)`).bind(id, userId, data.label, first, first).run()
      }
      const shots = data.shots.map(shot => ({ ...shot, ref: `${id}:${shot.ref}` }))
      const added = await insertShots(env, userId, id, 'csv', shots)
      return json({ sessionId: id, added })
    }
    case 'update-shot': {
      const row = await env.DB.prepare('SELECT session_id FROM gspro_shots WHERE id = ? AND user_id = ?').bind(input.id, userId).first<{ session_id: string }>()
      if (!row) throw new HttpError(404, 'That shot was not found.')
      if (input.club !== undefined) await env.DB.prepare('UPDATE gspro_shots SET club = ? WHERE id = ?').bind(normalizeClub(input.club), input.id).run()
      if (input.excluded !== undefined) await env.DB.prepare('UPDATE gspro_shots SET excluded = ? WHERE id = ?').bind(input.excluded ? 1 : 0, input.id).run()
      const updated = await env.DB.prepare(`SELECT ${shotColumns} FROM gspro_shots WHERE id = ?`).bind(input.id).first()
      return json({ shot: toShot(updated as Parameters<typeof toShot>[0]) })
    }
    case 'rename-session':
      await env.DB.prepare('UPDATE gspro_sessions SET label = ? WHERE id = ? AND user_id = ?').bind(input.label, input.id, userId).run()
      return json({ ok: true })
    case 'delete-session':
      await env.DB.batch([
        env.DB.prepare('DELETE FROM gspro_shots WHERE session_id = ? AND user_id = ?').bind(input.id, userId),
        env.DB.prepare('DELETE FROM gspro_sessions WHERE id = ? AND user_id = ?').bind(input.id, userId),
      ])
      return json({ ok: true })
    case 'delete-round':
      await env.DB.batch([
        env.DB.prepare('DELETE FROM gspro_course_shots WHERE round_id = ? AND user_id = ?').bind(input.id, userId),
        env.DB.prepare('DELETE FROM gspro_rounds WHERE id = ? AND user_id = ?').bind(input.id, userId),
      ])
      return json({ ok: true })
    case 'coach':
      return coach(env, input.data)
  }
}

/**
 * `/api/gspro/ingest` (POST, `Authorization: Bearer gsb_…`, server-to-server, no same-origin check): the local GSPro bridge
 * sends Open Connect shot JSON and heartbeats; shots are grouped into bridge sessions split by 30-minute gaps.
 * `/api/gspro` (admin only): GET `?live&since=<id>`, `?sessions`, `?shots&session=<id>` or `?shots&days=<n>`, or the bridge
 * status; POST actions `create-key`, `revoke-key`, `new-session`, `import`, `update-shot`, `rename-session`, `delete-session`, `coach`.
 */
export async function gspro(request: Request, env: Env) {
  const url = new URL(request.url)
  if (url.pathname.endsWith('/ingest')) return ingest(request, env)
  await ensureGsproTables(env)
  const user = await requireAdmin(request, env)
  if (request.method === 'GET') return read(request, env, user.id)
  if (request.method === 'POST') return act(request, env, user.id)
  return json({ error: 'Method not allowed.' }, 405)
}
