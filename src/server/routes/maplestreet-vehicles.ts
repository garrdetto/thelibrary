import { z } from 'zod'
import { VEHICLE_LIMITS, type CustomVehicleSpec } from '../../../modules-src/maplestreet/shared/CustomVehicles'
import type { Env } from '../env'
import { HttpError, json, readJson, requireSameOrigin } from '../http'
import { inspectModel } from '../gltf-check'
import { refreshWorldCatalog, requireMapleAdmin } from '../maplestreet-admin'
import { assetStatusSchema, wantsDrafts } from '../maplestreet-assets'
import { currentUser } from '../auth'
import { BUNDLED_ID_PATTERN, bundledVehicle, ensureBundledOverride, getStoreVehicle, insertStoreVehicle, listStoreVehicles, replaceStoreVehicle, updateStoreVehicle, VEHICLE_MODEL_KEY, VEHICLE_WHEEL_KEY, vehicleNameSchema, vehicleSpecSchema } from '../maplestreet-vehicles'

const idSchema = z.string().uuid()
const anyIdSchema = z.union([idSchema, z.string().regex(BUNDLED_ID_PATTERN)])
const updateSchema = z.object({
  id: anyIdSchema,
  active: z.boolean().optional(),
  status: assetStatusSchema.optional(),
  name: vehicleNameSchema.optional(),
  spec: vehicleSpecSchema.optional(),
}).strict()

function check<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
  throw new HttpError(400, `${where}${issue?.message ?? 'Please check your input and try again.'}`)
}

const requireAdmin = (request: Request, env: Env) => requireMapleAdmin(request, env, 'Sign in as the administrator to manage Fox Plains vehicles.')
const isAdmin = async (request: Request, env: Env) => (await currentUser(request, env))?.isAdmin === true
const publishStatus = z.enum(['draft', 'published']).catch('published')

async function serveFile(env: Env, key: string) {
  const stored = await env.FILES.getWithMetadata<{ mime?: string }>(key, 'arrayBuffer')
  if (!stored.value) return json({ error: 'Model not found.' }, 404)
  return new Response(stored.value, {
    headers: {
      'Content-Type': stored.metadata?.mime === 'model/gltf+json' ? 'model/gltf+json' : 'model/gltf-binary',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function parseJsonField(form: FormData, name: string) {
  const value = form.get(name)
  if (typeof value !== 'string') throw new HttpError(400, `Missing ${name}.`)
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new HttpError(400, `The ${name} field is not valid JSON.`)
  }
}

async function readModel(file: FormDataEntryValue | null, limit: number, label: string) {
  if (!file || typeof file === 'string') return null
  if (file.size === 0 || file.size > limit) throw new HttpError(413, `${label} must be smaller than ${Math.round(limit / 1024 / 1024)} MB.`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { bytes, kind: inspectModel(file.name, bytes) }
}

async function publish(request: Request, env: Env) {
  const user = await requireAdmin(request, env)
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) throw new HttpError(415, 'Send the vehicle as multipart form data.')
  if (Number(request.headers.get('content-length')) > VEHICLE_LIMITS.modelBytes + VEHICLE_LIMITS.wheelBytes + 128 * 1024) throw new HttpError(413, 'Models must be smaller than 15 MB.')
  const form = await request.formData()
  const name = check(vehicleNameSchema, form.get('name'))
  const spec = check(vehicleSpecSchema, parseJsonField(form, 'spec')) as CustomVehicleSpec
  const model = await readModel(form.get('model'), VEHICLE_LIMITS.modelBytes, 'Vehicle models')
  if (!model) throw new HttpError(400, 'Choose a .glb or .gltf model to publish.')
  const wheel = await readModel(form.get('wheel'), VEHICLE_LIMITS.wheelBytes, 'Wheel models')
  const status = publishStatus.parse(form.get('status'))
  const editing = form.get('id')
  if (typeof editing === 'string' && editing) return saveOver(env, check(anyIdSchema, editing), user.id, name, spec, model, wheel, status)

  const id = crypto.randomUUID()
  await env.FILES.put(VEHICLE_MODEL_KEY(id), model.bytes, { metadata: { mime: model.kind.type, bytes: model.bytes.byteLength } })
  if (wheel) await env.FILES.put(VEHICLE_WHEEL_KEY(id), wheel.bytes, { metadata: { mime: wheel.kind.type, bytes: wheel.bytes.byteLength } })
  try {
    await insertStoreVehicle(env, id, name, spec, { type: model.kind.type, bytes: model.bytes.byteLength }, wheel ? { type: wheel.kind.type, bytes: wheel.bytes.byteLength } : null, user.id, status)
  } catch (error) {
    await env.FILES.delete(VEHICLE_MODEL_KEY(id))
    if (wheel) await env.FILES.delete(VEHICLE_WHEEL_KEY(id))
    throw error
  }
  if (status === 'published') await refreshWorldCatalog(env)
  return json({ vehicle: await getStoreVehicle(env, id) }, 201)
}

/** Edits from the "Your vehicles" list: the new model replaces the stored one, and players pick it up through the versioned model URL. */
async function saveOver(env: Env, id: string, userId: string, name: string, spec: CustomVehicleSpec, model: { bytes: Uint8Array; kind: { type: string } }, wheel: { bytes: Uint8Array; kind: { type: string } } | null, status: 'draft' | 'published') {
  const bundled = bundledVehicle(id)
  if (bundled) {
    if (status === 'draft') throw new HttpError(400, 'Built-in vehicles can’t be turned into drafts. Save it as published instead.')
    await ensureBundledOverride(env, id, userId)
  }
  if (!await getStoreVehicle(env, id)) return json({ error: 'Vehicle not found.' }, 404)
  await env.FILES.put(VEHICLE_MODEL_KEY(id), model.bytes, { metadata: { mime: model.kind.type, bytes: model.bytes.byteLength } })
  if (wheel) await env.FILES.put(VEHICLE_WHEEL_KEY(id), wheel.bytes, { metadata: { mime: wheel.kind.type, bytes: wheel.bytes.byteLength } })
  const changed = await replaceStoreVehicle(env, id, name, spec, { type: model.kind.type, bytes: model.bytes.byteLength }, wheel ? { type: wheel.kind.type, bytes: wheel.bytes.byteLength } : null, status)
  if (!changed) return json({ error: 'Vehicle not found.' }, 404)
  await refreshWorldCatalog(env)
  return json({ vehicle: await getStoreVehicle(env, id) })
}

async function update(request: Request, env: Env) {
  const user = await requireAdmin(request, env)
  const input = check(updateSchema, await readJson(request, 64 * 1024))
  if (bundledVehicle(input.id)) {
    if (input.status === 'draft') throw new HttpError(400, 'Built-in vehicles can’t be turned into drafts. Retire it instead.')
    await ensureBundledOverride(env, input.id, user.id)
  }
  const changed = await updateStoreVehicle(env, input.id, { active: input.active, status: input.status, name: input.name, spec: input.spec as CustomVehicleSpec | undefined })
  if (!changed) return json({ error: 'Vehicle not found.' }, 404)
  await refreshWorldCatalog(env)
  return json({ vehicle: await getStoreVehicle(env, input.id) })
}

export async function maplestreetVehicles(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'GET') {
    const model = url.searchParams.get('model')
    if (model !== null) return serveFile(env, VEHICLE_MODEL_KEY(anyIdSchema.parse(model)))
    const wheel = url.searchParams.get('wheel')
    if (wheel !== null) return serveFile(env, VEHICLE_WHEEL_KEY(anyIdSchema.parse(wheel)))
    const drafts = await wantsDrafts(request, env, isAdmin)
    return json({ vehicles: await listStoreVehicles(env, { drafts }), drafts })
  }
  requireSameOrigin(request)
  if (request.method === 'POST') return publish(request, env)
  if (request.method === 'PATCH') return update(request, env)
  return json({ error: 'Method not allowed.' }, 405)
}
