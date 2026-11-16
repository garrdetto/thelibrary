import { z } from 'zod'
import type { Env } from '../env'
import { HttpError, json, parseStored, readJson, requireSameOrigin } from '../http'
import { requireUser } from '../auth'
import { emptyTuning, isTuningDoc, MAX_TUNED, TUNING_FIELDS, TUNING_VERSION } from '../../../modules-src/foxlake/vehicles/Tuning'
import type { TuningDoc } from '../../../modules-src/foxlake/vehicles/Tuning'

const TUNING_KEY = 'lifesim-vehicle-tuning'

const editSchema = z.object(Object.fromEntries(TUNING_FIELDS.map(f => [f.key, z.number().finite().min(f.min).max(f.max).optional()]))).strict()

const docSchema = z.object({
  v: z.literal(TUNING_VERSION),
  vehicles: z.record(z.string().regex(/^(?:[a-z]+|custom:[a-z0-9-]{8,64})$/), editSchema),
}).strict().refine(doc => Object.keys(doc.vehicles).length <= MAX_TUNED, { message: `Tune at most ${MAX_TUNED} vehicles.` })

async function ensureTable(env: Env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS library_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)').run()
}

async function readTuning(env: Env): Promise<TuningDoc> {
  const row = await env.DB.prepare('SELECT value FROM library_settings WHERE key = ?').bind(TUNING_KEY).first<{ value: string }>()
    .catch(error => { if (String(error).includes('no such table')) return null; throw error })
  const stored = row ? parseStored<unknown>(row.value, null) : null
  return isTuningDoc(stored) ? stored : emptyTuning()
}

/** Life Sim's vehicle tuning (modules-src/foxlake/vehicles/Tuning.ts): public GET, administrator POST from the developer panel. */
export async function lifesimTuning(request: Request, env: Env) {
  if (request.method === 'GET') return json({ tuning: await readTuning(env) }, 200, { 'cache-control': 'no-store' })
  if (request.method !== 'POST') return json({ error: 'Not found.' }, 404)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in as the administrator to tune Life Sim vehicles.')
  if (!user.isAdmin) throw new HttpError(403, 'Administrator access required.')
  const body = await readJson(request, 64000)
  const input = docSchema.parse(body)
  const doc: TuningDoc = { v: TUNING_VERSION, vehicles: {} }
  for (const [kind, edit] of Object.entries(input.vehicles)) {
    const clean = Object.fromEntries(Object.entries(edit).filter(([, v]) => v !== undefined))
    if (Object.keys(clean).length) doc.vehicles[kind] = clean
  }
  await ensureTable(env)
  await env.DB.prepare('INSERT INTO library_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(TUNING_KEY, JSON.stringify(doc), Date.now()).run()
  return json({ tuning: doc })
}
