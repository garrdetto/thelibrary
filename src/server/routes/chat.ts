import { z } from 'zod'
import type { Env } from '../env'
import { HttpError, json, parseStored, readJson, requireSameOrigin } from '../http'
import { requireUser } from '../auth'

const GROUP_HISTORY = 80
const PRIVATE_HISTORY = 200
const KEEP = 3000
const MIN_GAP = 1000
const PER_MINUTE = 24
const ONLINE_WINDOW = 45000
const MAX_MEMBERS = 8

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{3,20}$/)
const activity = z.string().regex(/^[a-z0-9-]{1,24}$/)
const post = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), text: z.string().max(2000), to: z.array(username).max(MAX_MEMBERS).optional() }),
  z.object({ action: z.literal('invite'), to: z.array(username).min(1).max(MAX_MEMBERS), module: activity, label: z.string().trim().min(1).max(40), code: z.string().regex(/^[A-Z0-9]{4,8}$/).optional() }),
  z.object({ action: z.literal('delete'), id: z.number().int().positive() }),
])

type Row = { id: number; username: string; body: string; created_at: number; thread: string | null; meta: string | null }
const columns = 'id, username, body, created_at, thread, meta'
const shape = (row: Row) => ({ id: row.id, username: row.username, text: row.body, at: row.created_at, thread: row.thread, meta: parseStored<Record<string, unknown> | null>(row.meta, null) })
const member = "instr(',' || thread || ',', ',' || ? || ',') > 0"

async function threadFor(env: Env, me: string, to: string[] | undefined) {
  const others = [...new Set((to ?? []).filter(name => name !== me))]
  if (!others.length) return null
  const marks = others.map(() => '?').join(',')
  const found = await env.DB.prepare(`SELECT username FROM users WHERE username IN (${marks})`).bind(...others).all<{ username: string }>()
  const missing = others.filter(name => !found.results.some(row => row.username === name))
  if (missing.length) throw new HttpError(404, `No account named ${missing.join(', ')}.`)
  return [me, ...others].sort().join(',')
}

async function rateLimit(env: Env, userId: string, now: number) {
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM chat_messages WHERE user_id = ? AND created_at > ?').bind(userId, now - 60000).first<{ n: number; last: number | null }>()
  if (recent?.last && now - recent.last < MIN_GAP) throw new HttpError(429, 'Slow down a little.')
  if (recent && recent.n >= PER_MINUTE) throw new HttpError(429, 'You are sending messages too quickly. Wait a moment.')
}

async function insert(env: Env, user: { id: string; username: string }, body: string, thread: string | null, meta: unknown, now: number) {
  const row = await env.DB.prepare(`INSERT INTO chat_messages (user_id, username, body, created_at, thread, meta) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${columns}`)
    .bind(user.id, user.username, body, now, thread, meta ? JSON.stringify(meta) : null).first<Row>()
  if (row && row.id % 50 === 0) await env.DB.prepare('DELETE FROM chat_messages WHERE id <= ?').bind(row.id - KEEP).run()
  return row ? shape(row) : null
}

export async function groupChat(request: Request, env: Env) {
  const user = await requireUser(request, env, 'Sign in to join the chat.')
  const me = user.username
  const now = Date.now()
  if (request.method === 'GET') {
    const url = new URL(request.url)
    const after = Number(url.searchParams.get('after') ?? 0) || 0
    const doing = activity.safeParse(url.searchParams.get('activity') ?? 'home')
    let rows: Row[]
    if (after > 0) {
      rows = (await env.DB.prepare(`SELECT ${columns} FROM chat_messages WHERE id > ? AND (thread IS NULL OR ${member}) ORDER BY id ASC LIMIT 300`).bind(after, me).all<Row>()).results
    } else {
      const group = await env.DB.prepare(`SELECT ${columns} FROM chat_messages WHERE thread IS NULL ORDER BY id DESC LIMIT ?`).bind(GROUP_HISTORY).all<Row>()
      const mine = await env.DB.prepare(`SELECT ${columns} FROM chat_messages WHERE thread IS NOT NULL AND ${member} ORDER BY id DESC LIMIT ?`).bind(me, PRIVATE_HISTORY).all<Row>()
      rows = [...group.results, ...mine.results].sort((a, b) => a.id - b.id)
    }
    const [, online] = await env.DB.batch([
      env.DB.prepare('INSERT INTO chat_presence (user_id, username, activity, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, activity = excluded.activity, last_seen = excluded.last_seen')
        .bind(user.id, me, doing.success ? doing.data : 'home', now),
      env.DB.prepare('SELECT username, activity FROM chat_presence WHERE last_seen > ? ORDER BY username ASC LIMIT 200').bind(now - ONLINE_WINDOW),
    ]) as [unknown, { results: { username: string; activity: string | null }[] }]
    return json({ messages: rows.map(shape), me, isAdmin: user.isAdmin, online: online.results })
  }
  if (request.method !== 'POST') throw new HttpError(405, 'This request is not allowed.')
  requireSameOrigin(request)
  const input = post.parse(await readJson(request, 4096))
  if (input.action === 'delete') {
    const row = await env.DB.prepare('SELECT username, thread FROM chat_messages WHERE id = ?').bind(input.id).first<{ username: string; thread: string | null }>()
    if (!row) return json({ ok: true })
    if (!user.isAdmin && row.username !== me) throw new HttpError(403, 'You can only remove your own messages.')
    await env.DB.prepare('DELETE FROM chat_messages WHERE id = ?').bind(input.id).run()
    return json({ ok: true })
  }
  await rateLimit(env, user.id, now)
  if (input.action === 'invite') {
    const thread = await threadFor(env, me, input.to)
    if (!thread) throw new HttpError(400, 'Choose who to invite.')
    const message = await insert(env, user, `invited you to ${input.label}`, thread, { invite: { module: input.module, label: input.label, code: input.code ?? null } }, now)
    return json({ message })
  }
  const text = input.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) throw new HttpError(400, 'Type a message first.')
  if (text.length > 500) throw new HttpError(400, 'Messages can be up to 500 characters.')
  const thread = await threadFor(env, me, input.to)
  return json({ message: await insert(env, user, text, thread, null, now) })
}
