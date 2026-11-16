import type { Env } from './env'

export const ONLINE_WINDOW = 45000
const RECENT_WINDOW = 14 * 24 * 60 * 60 * 1000
const RECENT_LIMIT = 60

export type Presence = { username: string; activity: string | null; online: boolean; lastSeen: number; activeAt: number; since: number }

type PresenceRow = { username: string; activity: string | null; last_seen: number; active_at: number | null; activity_since: number | null }

let tableReady = false
async function ensureTable(env: Env) {
  if (tableReady) return
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS chat_activity (user_id TEXT PRIMARY KEY, active_at INTEGER, activity TEXT, activity_since INTEGER NOT NULL)').run()
  tableReady = true
}

const select = 'SELECT p.username AS username, p.activity AS activity, p.last_seen AS last_seen, a.active_at AS active_at, a.activity_since AS activity_since FROM chat_presence p LEFT JOIN chat_activity a ON a.user_id = p.user_id'

const shape = (row: PresenceRow, now: number): Presence => ({
  username: row.username,
  activity: row.activity,
  online: row.last_seen > now - ONLINE_WINDOW,
  lastSeen: row.last_seen,
  activeAt: row.active_at ?? row.activity_since ?? row.last_seen,
  since: row.activity_since ?? row.last_seen,
})

export async function touchPresence(env: Env, user: { id: string; username: string }, activity: string, active: boolean, now: number) {
  await ensureTable(env)
  const [, , online, recent] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO chat_activity (user_id, active_at, activity, activity_since) VALUES (?1, CASE WHEN ?3 = 1 THEN ?4 ELSE NULL END, ?2, ?4)
      ON CONFLICT(user_id) DO UPDATE SET
        activity_since = CASE WHEN chat_activity.activity IS excluded.activity AND COALESCE((SELECT last_seen FROM chat_presence WHERE user_id = ?1), 0) > ?4 - ?5 THEN chat_activity.activity_since ELSE ?4 END,
        active_at = CASE WHEN ?3 = 1 THEN ?4 ELSE chat_activity.active_at END,
        activity = excluded.activity`)
      .bind(user.id, activity, active ? 1 : 0, now, ONLINE_WINDOW),
    env.DB.prepare('INSERT INTO chat_presence (user_id, username, activity, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, activity = excluded.activity, last_seen = excluded.last_seen')
      .bind(user.id, user.username, activity, now),
    env.DB.prepare(`${select} WHERE p.last_seen > ? ORDER BY p.username ASC LIMIT 200`).bind(now - ONLINE_WINDOW),
    env.DB.prepare(`${select} WHERE p.last_seen <= ? AND p.last_seen > ? ORDER BY p.last_seen DESC LIMIT ?`).bind(now - ONLINE_WINDOW, now - RECENT_WINDOW, RECENT_LIMIT),
  ]) as [unknown, unknown, { results: PresenceRow[] }, { results: PresenceRow[] }]
  return { online: online.results.map(row => shape(row, now)), recent: recent.results.map(row => shape(row, now)) }
}
