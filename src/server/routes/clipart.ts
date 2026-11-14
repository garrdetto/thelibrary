import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, binary, json, parseStored, readJson, requireSameOrigin } from '../http.js'
import { requireUser } from '../auth.js'
import { ClipartLimit, ClipartRefused, RESULT_TTL_SECONDS, decodeDataUrl, ensureClipartTable, generateClipart, recordJob } from '../clipart.js'
import { CLIPART_PRESETS, CLIPART_SLIDER_KEYS, CLIPART_TOUCH_MAX, ENGINES, ENGINE_IDS, NEGATIVE_LIMIT, PROMPT_LIMIT, SAVED_PRESET_LIMIT, closestResolution, engineInfo, normalizeSettings, outputSize } from '../../lib/clipart'
import type { EngineId, SavedPreset } from '../../lib/clipart'

const PRESETS_KEY = 'clipart-presets'
const dataUrl = z.string().max(14_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
const settingsSchema = z.object(Object.fromEntries([...CLIPART_SLIDER_KEYS.map(key => [key, z.number().min(0).max(100)]), ['resolution', z.number().int().min(256).max(2048)], ['clipartTouch', z.number().int().min(0).max(CLIPART_TOUCH_MAX).default(0)]])).strict()

const generateSchema = z.object({
  action: z.literal('generate'),
  engine: z.enum(ENGINE_IDS),
  preset: z.string().max(60),
  settings: settingsSchema,
  prompt: z.string().max(PROMPT_LIMIT).default(''),
  negative: z.string().max(NEGATIVE_LIMIT).default(''),
  image: dataUrl,
  reference: dataUrl.nullable().default(null),
  sourceWidth: z.number().int().min(16).max(20000),
  sourceHeight: z.number().int().min(16).max(20000),
  seed: z.number().int().min(0).max(2_147_483_647).nullable().default(null),
  sourceName: z.string().trim().max(200).default('image'),
}).strict()

const savePresetSchema = z.object({
  action: z.literal('save-preset'),
  name: z.string().trim().min(1).max(60),
  basePreset: z.string().max(60),
  settings: settingsSchema,
  prompt: z.string().max(PROMPT_LIMIT).default(''),
  negative: z.string().max(NEGATIVE_LIMIT).default(''),
}).strict()

const deletePresetSchema = z.object({ action: z.literal('delete-preset'), id: z.string().max(40) }).strict()
const inputSchema = z.discriminatedUnion('action', [generateSchema, savePresetSchema, deletePresetSchema])

async function requireAdmin(request: Request, env: Env) {
  const user = await requireUser(request, env, 'Sign in as the administrator to use the clipart generator.')
  if (!user.isAdmin) throw new HttpError(403, 'Administrator access required.')
  return user
}

function engineStatus(env: Env, id: EngineId) {
  const engine = engineInfo(id)
  if (engine.provider === 'workers-ai') return env.AI ? { ready: true, reason: '' } : { ready: false, reason: 'Workers AI is not bound to this deployment. Add "ai": { "binding": "AI" } to wrangler.jsonc and redeploy.' }
  return env.GEMINI_API_KEY ? { ready: true, reason: '' } : { ready: false, reason: 'Set the GEMINI_API_KEY Worker secret to use Gemini.' }
}

async function readPresets(env: Env): Promise<SavedPreset[]> {
  await ensureClipartTable(env)
  const row = await env.DB.prepare('SELECT value FROM library_settings WHERE key = ?').bind(PRESETS_KEY).first<{ value: string }>()
  return parseStored<SavedPreset[]>(row?.value, []).map(preset => ({ ...preset, settings: normalizeSettings(preset.settings) }))
}

async function writePresets(env: Env, presets: SavedPreset[]) {
  await env.DB.prepare('INSERT INTO library_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(PRESETS_KEY, JSON.stringify(presets), Date.now()).run()
}

async function generate(env: Env, userId: string, input: z.infer<typeof generateSchema>) {
  const status = engineStatus(env, input.engine)
  if (!status.ready) return json({ error: status.reason, notConfigured: true }, 503)
  const engine = engineInfo(input.engine)
  const preset = CLIPART_PRESETS.find(item => item.id === input.preset) ?? CLIPART_PRESETS[0]
  const settings = normalizeSettings(input.settings)
  const size = outputSize(input.sourceWidth, input.sourceHeight, closestResolution(engine, settings.resolution))
  const id = crypto.randomUUID()
  const reference = engine.reference && input.reference ? decodeDataUrl(input.reference) : null
  const job = { id, userId, engine: input.engine, preset: preset.id, sourceName: input.sourceName || 'image', settings }
  try {
    const result = await generateClipart(env, { engine: input.engine, preset, settings, prompt: input.prompt, negative: input.negative, photo: decodeDataUrl(input.image), reference, width: size.width, height: size.height, seed: input.seed })
    await env.FILES.put(`clipart/${id}`, result.bytes, { metadata: { type: result.mime }, expirationTtl: RESULT_TTL_SECONDS })
    await recordJob(env, { ...job, status: 'done', model: result.model, width: result.width, height: result.height, mime: result.mime, bytes: result.bytes.length, prompt: result.promptUsed, error: null })
    return json({ id, url: `/api/clipart?image=${id}`, width: result.width, height: result.height, requested: size, mime: result.mime, engine: input.engine, model: result.model, usedReference: Boolean(reference) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed.'
    await recordJob(env, { ...job, status: 'failed', model: '', width: 0, height: 0, mime: '', bytes: 0, prompt: '', error: message.slice(0, 500) }).catch(() => undefined)
    if (error instanceof ClipartLimit) return json({ error: error.message, limit: error.kind, retryAfter: error.retryAfter }, 429, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : undefined)
    if (error instanceof ClipartRefused) return json({ error: error.message }, 422)
    return json({ error: message }, 502)
  }
}

export async function clipart(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'GET') {
    await requireAdmin(request, env)
    const imageId = url.searchParams.get('image')
    if (imageId) {
      if (!/^[0-9a-f-]{36}$/.test(imageId)) throw new HttpError(400, 'Unknown image.')
      const stored = await env.FILES.getWithMetadata<{ type?: string }>(`clipart/${imageId}`, 'arrayBuffer')
      if (!stored.value) throw new HttpError(404, 'That result has expired or was removed.')
      return binary(stored.value, stored.metadata?.type ?? 'image/png', { 'Cache-Control': 'private, max-age=86400' })
    }
    if (url.searchParams.has('jobs')) {
      await ensureClipartTable(env)
      const rows = await env.DB.prepare('SELECT id, created_at, status, engine, model, preset, source_name, width, height, error FROM clipart_jobs ORDER BY created_at DESC LIMIT 60').all()
      return json({ jobs: rows.results })
    }
    return json({
      engines: ENGINES.map(engine => ({ id: engine.id, ...engineStatus(env, engine.id) })),
      presets: await readPresets(env),
      retentionDays: RESULT_TTL_SECONDS / 86400,
    })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireAdmin(request, env)
  const input = inputSchema.parse(await readJson(request, 30_000_000))
  if (input.action === 'generate') return generate(env, user.id, input)
  const presets = await readPresets(env)
  if (input.action === 'delete-preset') {
    const next = presets.filter(preset => preset.id !== input.id)
    await writePresets(env, next)
    return json({ presets: next })
  }
  const existing = presets.find(preset => preset.name.toLowerCase() === input.name.toLowerCase())
  const saved: SavedPreset = { id: existing?.id ?? crypto.randomUUID().slice(0, 12), name: input.name, basePreset: CLIPART_PRESETS.some(item => item.id === input.basePreset) ? input.basePreset : CLIPART_PRESETS[0].id, settings: normalizeSettings(input.settings), prompt: input.prompt, negative: input.negative }
  const next = existing ? presets.map(preset => preset.id === existing.id ? saved : preset) : [...presets, saved]
  if (next.length > SAVED_PRESET_LIMIT) throw new HttpError(400, `You can keep up to ${SAVED_PRESET_LIMIT} saved presets. Delete one first.`)
  await writePresets(env, next)
  return json({ presets: next, saved })
}
