import { z } from 'zod'
import type { Env } from '../env'
import { HttpError, json, parseStored, readJson, requireSameOrigin } from '../http'
import { requireUser } from '../auth'
import { moduleIds, normalizeModuleLayout } from '../../lib/module-layout'
import type { ModuleLayout } from '../../lib/module-layout'

const LAYOUT_KEY = 'module-layout'
const id = z.enum(moduleIds)

const layoutInput = z.object({
  order: z.array(id).max(64),
  hidden: z.array(id).max(64),
  featured: id.nullable(),
}).refine(input => input.hidden.length < moduleIds.length, { message: 'Keep at least one module in the library.' })

async function ensureTable(env: Env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS library_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)').run()
}

async function readLayout(env: Env): Promise<ModuleLayout> {
  const row = await env.DB.prepare('SELECT value, updated_at FROM library_settings WHERE key = ?').bind(LAYOUT_KEY).first<{ value: string; updated_at: number }>()
    .catch(error => { if (String(error).includes('no such table')) return null; throw error })
  if (!row) return normalizeModuleLayout(null)
  return normalizeModuleLayout({ ...parseStored<Partial<ModuleLayout>>(row.value, {}), updatedAt: new Date(row.updated_at).toISOString() })
}

export async function moduleLayout(request: Request, env: Env) {
  if (request.method === 'GET') return json({ layout: await readLayout(env) })
  if (request.method !== 'POST') return json({ error: 'Not found.' }, 404)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in as the administrator to arrange the library.')
  if (!user.isAdmin) throw new HttpError(403, 'Administrator access required.')
  const body = await readJson(request, 4000)
  if (body && typeof body === 'object' && 'action' in body && body.action === 'reset') {
    await ensureTable(env)
    await env.DB.prepare('DELETE FROM library_settings WHERE key = ?').bind(LAYOUT_KEY).run()
    return json({ layout: normalizeModuleLayout(null) })
  }
  const input = layoutInput.parse(body)
  const layout = normalizeModuleLayout(input)
  const now = Date.now()
  await ensureTable(env)
  await env.DB.prepare('INSERT INTO library_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(LAYOUT_KEY, JSON.stringify({ order: layout.order, hidden: layout.hidden, featured: layout.featured }), now).run()
  return json({ layout: { ...layout, updatedAt: new Date(now).toISOString() } })
}
