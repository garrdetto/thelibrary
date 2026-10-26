import { z } from 'zod'
import type { Env } from '../env'
import { HttpError, json, readJson, requireSameOrigin } from '../http'
import { requireUser } from '../auth'

const HISTORY = 80
const KEEP = 1000
const MIN_GAP = 1200
const PER_MINUTE = 20

const post = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), text: z.string().max(2000) }),
  z.object({ action: z.literal('delete'), id: z.number().int().positive() }),
])

type Row = { id: number; username: string; body: string; created_at: number }
const shape = (row: Row) => ({ id: row.id, username: row.username, text: row.body, at: row.created_at })

export async function groupChat(request: Request, env: Env) {
  const user = await requireUser(request, env, 'Sign in to join the chat.')
  if (request.method === 'GET') {
    const after = Number(new URL(request.url).searchParams.get('after') ?? 0)
    const rows = after > 0
      ? await env.DB.prepare('SELECT id, username, body, created_at FROM chat_messages WHERE id > ? ORDER BY id ASC LIMIT ?').bind(after, HISTORY).all<Row>()
      : await env.DB.prepare('SELECT id, username, body, created_at FROM (SELECT id, username, body, created_at FROM chat_messages ORDER BY id DESC LIMIT ?) ORDER BY id ASC').bind(HISTORY).all<Row>()
    const latest = await env.DB.prepare('SELECT MAX(id) AS id FROM chat_messages').first<{ id: number | null }>()
    return json({ messages: rows.results.map(shape), latest: latest?.id ?? 0, me: user.username, isAdmin: user.isAdmin })
  }
  if (request.method !== 'POST') throw new HttpError(405, 'This request is not allowed.')
  requireSameOrigin(request)
  const input = post.parse(await readJson(request, 4096))
  if (input.action === 'delete') {
    if (!user.isAdmin) throw new HttpError(403, 'Only the admin can remove messages.')
    await env.DB.prepare('DELETE FROM chat_messages WHERE id = ?').bind(input.id).run()
    return json({ ok: true })
  }
  const text = input.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) throw new HttpError(400, 'Type a message first.')
  if (text.length > 500) throw new HttpError(400, 'Messages can be up to 500 characters.')
  const now = Date.now()
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM chat_messages WHERE user_id = ? AND created_at > ?').bind(user.id, now - 60000).first<{ n: number; last: number | null }>()
  if (recent && recent.last && now - recent.last < MIN_GAP) throw new HttpError(429, 'Slow down a little.')
  if (recent && recent.n >= PER_MINUTE) throw new HttpError(429, 'You are sending messages too quickly. Wait a moment.')
  const row = await env.DB.prepare('INSERT INTO chat_messages (user_id, username, body, created_at) VALUES (?, ?, ?, ?) RETURNING id, username, body, created_at').bind(user.id, user.username, text, now).first<Row>()
  if (row && row.id % 50 === 0) await env.DB.prepare('DELETE FROM chat_messages WHERE id <= ?').bind(row.id - KEEP).run()
  return json({ message: row ? shape(row) : null })
}
