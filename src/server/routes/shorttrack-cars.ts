import { z } from 'zod'
import { CAR_LIMITS, type CustomCarSpec } from '../../../modules-src/shorttrack/shared/CustomCars'
import type { Env } from '../env'
import { HttpError, json, readJson, requireSameOrigin } from '../http'
import { inspectModel } from '../gltf-check'
import { requireMapleAdmin } from '../maplestreet-admin'
import { assetStatusSchema, wantsDrafts } from '../maplestreet-assets'
import { currentUser } from '../auth'
import { CAR_MODEL_KEY, carNameSchema, carSpecSchema, getCar, insertCar, listCars, updateCar } from '../shorttrack-cars'

const idSchema = z.string().uuid()
const updateSchema = z.object({
  id: idSchema,
  status: assetStatusSchema.optional(),
  name: carNameSchema.optional(),
  spec: carSpecSchema.optional(),
}).strict()
const publishStatus = z.enum(['draft', 'published']).catch('published')

function check<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
  throw new HttpError(400, `${where}${issue?.message ?? 'Please check your input and try again.'}`)
}

const requireAdmin = (request: Request, env: Env) => requireMapleAdmin(request, env, 'Sign in as the administrator to manage Short Track cars.')
const isAdmin = async (request: Request, env: Env) => (await currentUser(request, env))?.isAdmin === true

async function serveModel(env: Env, id: string) {
  const stored = await env.FILES.getWithMetadata<{ mime?: string }>(CAR_MODEL_KEY(id), 'arrayBuffer')
  if (!stored.value) return json({ error: 'Model not found.' }, 404)
  return new Response(stored.value, {
    headers: {
      'Content-Type': 'model/gltf-binary',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function parseSpec(form: FormData) {
  const value = form.get('spec')
  if (typeof value !== 'string') throw new HttpError(400, 'Missing spec.')
  try {
    return check(carSpecSchema, JSON.parse(value)) as CustomCarSpec
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'The spec field is not valid JSON.')
  }
}

async function readModel(file: FormDataEntryValue | null) {
  if (!file || typeof file === 'string') return null
  if (file.size === 0 || file.size > CAR_LIMITS.modelBytes) throw new HttpError(413, `Car models must be smaller than ${Math.round(CAR_LIMITS.modelBytes / 1024 / 1024)} MB.`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = inspectModel(file.name, bytes)
  if (kind.type !== 'model/gltf-binary') throw new HttpError(415, 'Save the car as a .glb file.')
  return { bytes, type: kind.type }
}

async function publish(request: Request, env: Env) {
  const user = await requireAdmin(request, env)
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) throw new HttpError(415, 'Send the car as multipart form data.')
  if (Number(request.headers.get('content-length')) > CAR_LIMITS.modelBytes + 128 * 1024) throw new HttpError(413, `Car models must be smaller than ${Math.round(CAR_LIMITS.modelBytes / 1024 / 1024)} MB.`)
  const form = await request.formData()
  const name = check(carNameSchema, form.get('name'))
  const spec = parseSpec(form)
  const model = await readModel(form.get('model'))
  const status = publishStatus.parse(form.get('status'))
  const editing = form.get('id')

  if (typeof editing === 'string' && editing) {
    const id = check(idSchema, editing)
    const existing = await getCar(env, id)
    if (!existing) return json({ error: 'Car not found.' }, 404)
    if (status === 'draft' && existing.status !== 'draft') throw new HttpError(400, 'A live car can’t go back to being a draft. Save it as published, or retire it.')
    if (model) await env.FILES.put(CAR_MODEL_KEY(id), model.bytes, { metadata: { mime: model.type, bytes: model.bytes.byteLength } })
    await updateCar(env, id, { name, spec, status, model: model ? { type: model.type, bytes: model.bytes.byteLength } : undefined })
    return json({ car: await getCar(env, id) })
  }

  if (!model) throw new HttpError(400, 'Choose a .glb model to publish.')
  const id = crypto.randomUUID()
  await env.FILES.put(CAR_MODEL_KEY(id), model.bytes, { metadata: { mime: model.type, bytes: model.bytes.byteLength } })
  try {
    await insertCar(env, { id, name, spec, model: { type: model.type, bytes: model.bytes.byteLength }, status, createdBy: user.id })
  } catch (error) {
    await env.FILES.delete(CAR_MODEL_KEY(id))
    throw error
  }
  return json({ car: await getCar(env, id) }, 201)
}

async function update(request: Request, env: Env) {
  await requireAdmin(request, env)
  const input = check(updateSchema, await readJson(request, 64 * 1024))
  const existing = await getCar(env, input.id)
  if (!existing) return json({ error: 'Car not found.' }, 404)
  if (input.status === 'draft' && existing.status !== 'draft') throw new HttpError(400, 'A live car can’t go back to being a draft. Retire it instead.')
  await updateCar(env, input.id, { name: input.name, spec: input.spec as CustomCarSpec | undefined, status: input.status })
  return json({ car: await getCar(env, input.id) })
}

export async function shorttrackCars(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'GET') {
    const model = url.searchParams.get('model')
    if (model !== null) return serveModel(env, check(idSchema, model))
    const drafts = await wantsDrafts(request, env, isAdmin)
    return json({ cars: await listCars(env, { drafts }), drafts })
  }
  requireSameOrigin(request)
  if (request.method === 'POST') return publish(request, env)
  if (request.method === 'PATCH') return update(request, env)
  return json({ error: 'Method not allowed.' }, 405)
}
