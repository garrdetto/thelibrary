import { z } from 'zod'
import { estimateCredits, MESHY_AI_MODELS, MESHY_TARGETS, POLYCOUNT_DEFAULTS, POLYCOUNT_RANGE, PREVIEW_COUNT_MAX, type MeshyJobKind, type MeshyStatus, MESHY_COSTS, type MeshyTarget } from '../../lib/meshy'
import type { Env } from '../env'
import { HttpError, json, readJson, requireSameOrigin } from '../http'
import { requireMapleAdmin } from '../maplestreet-admin'
import { ITEM_MODEL_KEY } from '../maplestreet-items'
import { VEHICLE_MODEL_KEY } from '../maplestreet-vehicles'
import { RIDE_SOURCE_KEY } from '../park-rides'
import { CAR_MODEL_KEY } from '../shorttrack-cars'
import { ensureJobModel, getJobRow, insertJob, isFinal, listJobRows, MESHY_MODEL_KEY, meshyConfigured, meshyFetch, refreshJob, setJob, TASK_PATHS, toJob } from '../meshy'

const REFRESH_PER_LIST = 6
const DATA_URI_LIMIT = 8 * 1024 * 1024

const prompt = z.string().trim().min(3).max(600)
const target = z.enum(MESHY_TARGETS)
const aiModel = z.enum(MESHY_AI_MODELS).default('latest')
const polycount = z.number().int().min(POLYCOUNT_RANGE.min).max(POLYCOUNT_RANGE.max)
const source = z.union([
  z.object({ jobId: z.string().uuid() }).strict(),
  z.object({ itemId: z.string().uuid() }).strict(),
  z.object({ vehicleId: z.string().uuid() }).strict(),
  z.object({ rideId: z.string().regex(/^cr_[a-f0-9]{10}$/) }).strict(),
  z.object({ carId: z.string().uuid() }).strict(),
])

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('text'), target, prompt, negativePrompt: z.string().trim().max(300).default(''), aiModel, count: z.number().int().min(1).max(PREVIEW_COUNT_MAX).default(1), polycount: polycount.optional() }).strict(),
  z.object({ action: z.literal('image'), target, image: z.string().max(7_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/), texture: z.boolean().default(true), aiModel, polycount: polycount.optional(), prompt: z.string().trim().max(600).default('') }).strict(),
  z.object({ action: z.literal('refine'), jobId: z.string().uuid(), texturePrompt: z.string().trim().max(600).default('') }).strict(),
  z.object({ action: z.literal('remesh'), target, source, polycount }).strict(),
  z.object({ action: z.literal('retexture'), target, source, prompt }).strict(),
  z.object({ action: z.literal('cancel'), jobId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('hide'), jobId: z.string().uuid() }).strict(),
])

const requireAdmin = (request: Request, env: Env) => requireMapleAdmin(request, env, 'Sign in as the administrator to use Meshy.')

async function status(env: Env): Promise<MeshyStatus> {
  if (!meshyConfigured(env)) return { connected: false, balance: null, costs: MESHY_COSTS }
  try {
    const data = await meshyFetch<{ balance?: number }>(env, '/v1/balance')
    return { connected: true, balance: typeof data.balance === 'number' ? data.balance : null, costs: MESHY_COSTS }
  } catch (error) {
    if (error instanceof HttpError && error.status === 502) return { connected: false, balance: null, costs: MESHY_COSTS }
    return { connected: true, balance: null, costs: MESHY_COSTS }
  }
}

async function list(env: Env) {
  const rows = await listJobRows(env)
  const stale = rows.filter(r => !isFinal(r.status)).slice(0, REFRESH_PER_LIST)
  const fresh = new Map((await Promise.all(stale.map(r => refreshJob(env, r)))).map(r => [r.id, r]))
  return rows.map(r => toJob(fresh.get(r.id) ?? r))
}

async function serveModel(env: Env, id: string) {
  const row = await getJobRow(env, id)
  if (!row) return json({ error: 'Job not found.' }, 404)
  await ensureJobModel(env, row)
  const stored = await env.FILES.getWithMetadata<{ mime?: string }>(MESHY_MODEL_KEY(id), 'arrayBuffer')
  if (!stored.value) return json({ error: 'Model not found.' }, 404)
  return new Response(stored.value, { headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="meshy-${id.slice(0, 8)}.glb"` } })
}

function bytesToDataUri(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return `data:model/gltf-binary;base64,${btoa(binary)}`
}

/** Meshy reads a source model from a public URL; local development falls back to a data URI. */
async function modelInput(request: Request, env: Env, src: z.infer<typeof source>): Promise<{ input_task_id: string } | { model_url: string }> {
  if ('jobId' in src) {
    const row = await getJobRow(env, src.jobId)
    if (!row || row.status !== 'SUCCEEDED') throw new HttpError(409, 'Pick a finished Meshy model.')
    return { input_task_id: row.task_id }
  }
  const origin = new URL(request.url).origin
  const isPublic = origin.startsWith('https://') && !/localhost|127\.0\.0\.1/.test(origin)
  const [key, path] = 'itemId' in src ? [ITEM_MODEL_KEY(src.itemId), `/api/maplestreet-items?model=${src.itemId}`]
    : 'rideId' in src ? [RIDE_SOURCE_KEY(src.rideId), `/api/park-rides?source=${src.rideId}`]
    : 'carId' in src ? [CAR_MODEL_KEY(src.carId), `/api/shorttrack-cars?model=${src.carId}`]
    : [VEHICLE_MODEL_KEY(src.vehicleId), `/api/maplestreet-vehicles?model=${src.vehicleId}`]
  if (isPublic) return { model_url: `${origin}${path}` }
  const stored = await env.FILES.getWithMetadata(key, 'arrayBuffer')
  if (!stored.value) throw new HttpError(404, 'That model wasn’t found.')
  if (stored.value.byteLength > DATA_URI_LIMIT) throw new HttpError(413, 'That model is too large to send to Meshy from a local server.')
  return { model_url: bytesToDataUri(stored.value) }
}

async function startTask(env: Env, kind: MeshyJobKind, body: Record<string, unknown>) {
  const created = await meshyFetch<{ result?: string }>(env, TASK_PATHS[kind], { method: 'POST', body })
  if (!created.result) throw new HttpError(503, 'Meshy didn’t start the task. Please try again.')
  return created.result
}

async function act(request: Request, env: Env) {
  const user = await requireAdmin(request, env)
  const input = actionSchema.parse(await readJson(request, 7_500_000))
  if (!meshyConfigured(env) && input.action !== 'hide') throw new HttpError(503, 'Meshy isn’t connected yet.')
  const record = async (kind: MeshyJobKind, tgt: MeshyTarget, taskId: string, parentId: string | null, text: string, options: unknown, credits: number) => {
    const id = crypto.randomUUID()
    await insertJob(env, { id, kind, target: tgt, taskId, parentId, prompt: text, options, credits, createdBy: user.id })
    return id
  }

  switch (input.action) {
    case 'text': {
      const ids: string[] = []
      for (let i = 0; i < input.count; i++) {
        const options = { mode: 'preview', prompt: input.prompt, negative_prompt: input.negativePrompt || undefined, ai_model: input.aiModel, topology: 'triangle', target_polycount: input.polycount ?? POLYCOUNT_DEFAULTS[input.target], should_remesh: true, origin_at: 'bottom', moderation: true }
        const taskId = await startTask(env, 'preview', options)
        ids.push(await record('preview', input.target, taskId, null, input.prompt, options, estimateCredits({ kind: 'preview', model: input.aiModel, count: 1 })))
      }
      return json({ ids }, 201)
    }
    case 'image': {
      const options = { image_url: input.image, ai_model: input.aiModel, should_texture: input.texture, enable_pbr: input.texture, texture_prompt: input.prompt || undefined, topology: 'triangle', target_polycount: input.polycount ?? POLYCOUNT_DEFAULTS[input.target], should_remesh: true, origin_at: 'bottom', moderation: true }
      const taskId = await startTask(env, 'image', options)
      const id = await record('image', input.target, taskId, null, input.prompt || 'Image to 3D', { ...options, image_url: '(image)' }, estimateCredits({ kind: 'image', model: input.aiModel, texture: input.texture }))
      return json({ ids: [id] }, 201)
    }
    case 'refine': {
      const parent = await getJobRow(env, input.jobId)
      if (!parent || parent.kind !== 'preview' || parent.status !== 'SUCCEEDED') throw new HttpError(409, 'Pick a finished preview to refine.')
      const options = { mode: 'refine', preview_task_id: parent.task_id, texture_prompt: input.texturePrompt || undefined, enable_pbr: true, remove_lighting: true }
      const taskId = await startTask(env, 'refine', options)
      const id = await record('refine', parent.target, taskId, parent.id, input.texturePrompt || parent.prompt, options, estimateCredits({ kind: 'refine' }))
      return json({ ids: [id] }, 201)
    }
    case 'remesh': {
      const from = await modelInput(request, env, input.source)
      const options = { ...from, target_polycount: input.polycount, topology: 'triangle', target_formats: ['glb'], origin_at: 'bottom' }
      const taskId = await startTask(env, 'remesh', options)
      const parentId = 'jobId' in input.source ? input.source.jobId : null
      const id = await record('remesh', input.target, taskId, parentId, `Remesh to ${input.polycount.toLocaleString()} polygons`, { ...options, model_url: 'model_url' in from ? '(model)' : undefined }, estimateCredits({ kind: 'remesh' }))
      return json({ ids: [id] }, 201)
    }
    case 'retexture': {
      const from = await modelInput(request, env, input.source)
      const options = { ...from, text_style_prompt: input.prompt, enable_original_uv: true, enable_pbr: true, remove_lighting: true }
      const taskId = await startTask(env, 'retexture', options)
      const parentId = 'jobId' in input.source ? input.source.jobId : null
      const id = await record('retexture', input.target, taskId, parentId, input.prompt, { ...options, model_url: 'model_url' in from ? '(model)' : undefined }, estimateCredits({ kind: 'retexture' }))
      return json({ ids: [id] }, 201)
    }
    case 'cancel': {
      const row = await getJobRow(env, input.jobId)
      if (!row) return json({ error: 'Job not found.' }, 404)
      try {
        await meshyFetch(env, `${TASK_PATHS[row.kind]}/${encodeURIComponent(row.task_id)}`, { method: 'DELETE' })
      } catch (error) {
        if (!(error instanceof HttpError) || ![404, 409].includes(error.status)) throw error
      }
      await setJob(env, row.id, { status: isFinal(row.status) ? row.status : 'CANCELED', hidden: 1, error: isFinal(row.status) ? row.error : 'Canceled. Meshy doesn’t refund credits for tasks that already started.' })
      return json({ ok: true })
    }
    case 'hide': {
      await setJob(env, input.jobId, { hidden: 1 })
      return json({ ok: true })
    }
  }
}

export async function meshy(request: Request, env: Env) {
  const url = new URL(request.url)
  await requireAdmin(request, env)
  if (request.method === 'GET') {
    if (url.searchParams.has('status')) return json(await status(env), 200, { 'Cache-Control': 'no-store' })
    const model = url.searchParams.get('model')
    if (model !== null) return serveModel(env, z.string().uuid().parse(model))
    if (!meshyConfigured(env)) return json({ jobs: [], connected: false })
    return json({ jobs: await list(env), connected: true }, 200, { 'Cache-Control': 'no-store' })
  }
  requireSameOrigin(request)
  if (request.method === 'POST') return act(request, env)
  return json({ error: 'Method not allowed.' }, 405)
}
