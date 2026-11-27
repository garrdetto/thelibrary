import { z } from 'zod'
import type { Env } from '../env.js'
import { json, parseStored, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { snapshotSchema } from '../../../modules-src/railsetup/sim/files'
import { hardpointsSchema } from '../../../modules-src/railsetup/sim/hardpoints'

const MAX_SETUPS = 100
const fileName = z.string().trim().min(1).max(80)

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), setup: snapshotSchema }),
  z.object({ action: z.literal('delete'), name: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal('hardpoints'), name: fileName, hardpoints: hardpointsSchema }),
  z.object({ action: z.literal('clear-hardpoints') }),
])

let tableReady: Promise<unknown> | null = null

function ensureTables(env: Env) {
  tableReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS railsetup_setups (
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, name)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS railsetup_hardpoints (
      user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
  ]).catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

async function state(env: Env, userId: string) {
  const rows = await env.DB.prepare('SELECT data FROM railsetup_setups WHERE user_id = ? ORDER BY updated_at').bind(userId).all<{ data: string }>()
  const hp = await env.DB.prepare('SELECT name, data FROM railsetup_hardpoints WHERE user_id = ?').bind(userId).first<{ name: string; data: string }>()
  const setups = rows.results.map(row => parseStored<unknown>(row.data, null)).filter(Boolean)
  return { signedIn: true, setups, hardpoints: hp ? { name: hp.name, hardpoints: parseStored<unknown>(hp.data, null) } : null }
}

export async function railsetup(request: Request, env: Env) {
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ signedIn: false, setups: [], hardpoints: null })
    await ensureTables(env)
    return json(await state(env, user.id))
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save setups to your account.')
  await ensureTables(env)
  const input = actions.parse(await readJson(request, 64_000))
  const now = Date.now()
  if (input.action === 'save') {
    const exists = await env.DB.prepare('SELECT 1 FROM railsetup_setups WHERE user_id = ? AND name = ?').bind(user.id, input.setup.name).first()
    if (!exists) {
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM railsetup_setups WHERE user_id = ?').bind(user.id).first<{ n: number }>()
      if ((count?.n ?? 0) >= MAX_SETUPS) return json({ error: `You can keep up to ${MAX_SETUPS} setups. Delete one first.` }, 400)
    }
    await env.DB.prepare(`INSERT INTO railsetup_setups (user_id, name, data, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).bind(user.id, input.setup.name, JSON.stringify(input.setup), now).run()
  } else if (input.action === 'delete') {
    await env.DB.prepare('DELETE FROM railsetup_setups WHERE user_id = ? AND name = ?').bind(user.id, input.name).run()
  } else if (input.action === 'hardpoints') {
    await env.DB.prepare(`INSERT INTO railsetup_hardpoints (user_id, name, data, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`).bind(user.id, input.name, JSON.stringify(input.hardpoints), now).run()
  } else {
    await env.DB.prepare('DELETE FROM railsetup_hardpoints WHERE user_id = ?').bind(user.id).run()
  }
  return json(await state(env, user.id))
}
