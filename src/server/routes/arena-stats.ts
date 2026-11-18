import { z } from 'zod'
import type { Env } from '../env.js'
import { json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { canResetRecords } from '../records.js'
import { ARENA_ACCURACY_MIN_SHOTS, arenaDuelSorts } from '../../lib/arena-duel.js'
import type { ArenaDuelRow, ArenaDuelSort } from '../../lib/arena-duel.js'

const sorts = z.enum(arenaDuelSorts)

const actions = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('match'),
    run: z.string().uuid(),
    kills: z.number().int().min(0).max(30),
    deaths: z.number().int().min(0).max(30),
    shots: z.number().int().min(0).max(6000),
    hits: z.number().int().min(0).max(6000),
    won: z.boolean(),
  }).refine(input => input.hits <= input.shots),
  z.object({ action: z.literal('reset-records'), password: z.string().min(1).max(128).optional() }),
])

let tableReady: Promise<unknown> | null = null

function ensureTables(env: Env) {
  tableReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS arena_duel_stats (
      user_id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL,
      matches INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      shots INTEGER NOT NULL DEFAULT 0,
      hits INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS arena_duel_runs (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL)'),
  ]).catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

const columns = 'COALESCE(u.username, s.username) AS username, s.matches, s.wins, s.kills, s.deaths, s.shots, s.hits'
const orderBy: Record<ArenaDuelSort, string> = {
  kd: 'CAST(s.kills AS REAL) / MAX(s.deaths, 1) DESC, s.kills DESC, s.updated_at ASC',
  accuracy: 'CAST(s.hits AS REAL) / s.shots DESC, s.shots DESC, s.updated_at ASC',
}
const where: Record<ArenaDuelSort, string> = {
  kd: 's.matches > 0',
  accuracy: `s.shots >= ${ARENA_ACCURACY_MIN_SHOTS}`,
}

/** `/api/arena-stats`: Vector Arena's 1v1 Duel record book. Each signed-in player's career totals (matches, wins, kills, deaths, rounds fired and rounds that hit) in D1 `arena_duel_stats`, every match counted once by `<user>:<run>` in `arena_duel_runs` (migration 0044, also created on first use). GET `?sort=kd|accuracy` (public) returns the top 20 by K/D ratio (kills over deaths, at least one death counted) or accuracy (from 30 rounds fired) plus the viewer's own line. POST (signed in, same-origin) `match` adds one finished duel; `reset-records` (admin) clears the book. */
export async function arenaStats(request: Request, env: Env) {
  await ensureTables(env)
  if (request.method === 'GET') {
    const sort = sorts.catch('kd').parse(new URL(request.url).searchParams.get('sort') ?? 'kd')
    const user = await currentUser(request, env)
    const [rows, mine] = await Promise.all([
      env.DB.prepare(`SELECT ${columns} FROM arena_duel_stats s LEFT JOIN users u ON u.id = s.user_id WHERE ${where[sort]} ORDER BY ${orderBy[sort]} LIMIT 20`).all<ArenaDuelRow>(),
      user ? env.DB.prepare(`SELECT ${columns} FROM arena_duel_stats s LEFT JOIN users u ON u.id = s.user_id WHERE s.user_id = ?`).bind(user.id).first<ArenaDuelRow>() : Promise.resolve(null),
    ])
    return json({ sort, rows: rows.results, mine: mine ?? null, signedIn: Boolean(user) }, 200, { 'cache-control': 'no-store' })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to keep your 1v1 record.')
  const input = actions.parse(await readJson(request, 2000))
  if (input.action === 'reset-records') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    await env.DB.batch([env.DB.prepare('DELETE FROM arena_duel_stats'), env.DB.prepare('DELETE FROM arena_duel_runs')])
    return json({ reset: true })
  }
  const now = Date.now()
  const claimed = await env.DB.prepare('INSERT INTO arena_duel_runs (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').bind(`${user.id}:${input.run}`, now).run()
  if (!claimed.meta.changes) return json({ saved: false })
  await env.DB.prepare(`INSERT INTO arena_duel_stats (user_id, username, matches, wins, kills, deaths, shots, hits, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, matches = matches + 1, wins = wins + excluded.wins, kills = kills + excluded.kills,
    deaths = deaths + excluded.deaths, shots = shots + excluded.shots, hits = hits + excluded.hits, updated_at = excluded.updated_at`)
    .bind(user.id, user.username, input.won ? 1 : 0, input.kills, input.deaths, input.shots, input.hits, now).run()
  return json({ saved: true })
}
