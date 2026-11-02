import { z } from 'zod'
import { CUSTOM_LIMITS } from '../../../modules-src/maplestreet/shared/CustomItems'
import type { Env } from '../env'
import { HttpError, json, readJson, requireSameOrigin } from '../http'
import { refreshWorldCatalog, requireMapleAdmin } from '../maplestreet-admin'
import { inspectModel } from '../gltf-check'
import { ITEM_MODEL_KEY, getStoreItem, insertStoreItem, listStoreItems, storeItemSchema, updateStoreItem } from '../maplestreet-items'

const idSchema = z.string().uuid()
const updateSchema = z.object({
  id: idSchema,
  active: z.boolean().optional(),
  name: storeItemSchema.shape.name.optional(),
  price: storeItemSchema.shape.price.optional(),
}).strict()

const requireAdmin = (request: Request, env: Env) => requireMapleAdmin(request, env, 'Sign in as the administrator to manage Maple Street items.')

async function serveModel(env: Env, id: string) {
  const stored = await env.FILES.getWithMetadata<{ mime?: string }>(ITEM_MODEL_KEY(idSchema.parse(id)), 'arrayBuffer')
  if (!stored.value) return json({ error: 'Model not found.' }, 404)
  return new Response(stored.value, {
    headers: {
      'Content-Type': stored.metadata?.mime === 'model/gltf+json' ? 'model/gltf+json' : 'model/gltf-binary',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function field(form: FormData, name: string) {
  const value = form.get(name)
  if (typeof value !== 'string') throw new HttpError(400, `Missing ${name}.`)
  return value
}

const bool = (value: string) => value === 'true'

async function publish(request: Request, env: Env) {
  const user = await requireAdmin(request, env)
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) throw new HttpError(415, 'Send the item as multipart form data.')
  if (Number(request.headers.get('content-length')) > CUSTOM_LIMITS.modelBytes + 64 * 1024) throw new HttpError(413, 'Models must be smaller than 15 MB.')
  const form = await request.formData()
  const file = form.get('model')
  if (!file || typeof file === 'string') throw new HttpError(400, 'Choose a .glb or .gltf model to publish.')
  if (file.size === 0 || file.size > CUSTOM_LIMITS.modelBytes) throw new HttpError(413, 'Models must be smaller than 15 MB.')

  const input = storeItemSchema.parse({
    name: field(form, 'name'),
    price: field(form, 'price'),
    scale: JSON.parse(field(form, 'scale')),
    room: field(form, 'room'),
    func: field(form, 'func'),
    indoor: bool(field(form, 'indoor')),
    solid: bool(field(form, 'solid')),
    yaw: Number(field(form, 'yaw')),
    w: Number(field(form, 'w')),
    d: Number(field(form, 'd')),
    h: Number(field(form, 'h')),
  })

  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = inspectModel(file.name, bytes)
  const id = crypto.randomUUID()
  await env.FILES.put(ITEM_MODEL_KEY(id), bytes, { metadata: { mime: kind.type, bytes: bytes.byteLength } })
  try {
    await insertStoreItem(env, id, input, { type: kind.type, bytes: bytes.byteLength }, user.id)
  } catch (error) {
    await env.FILES.delete(ITEM_MODEL_KEY(id))
    throw error
  }
  await refreshWorldCatalog(env)
  return json({ item: await getStoreItem(env, id) }, 201)
}

async function update(request: Request, env: Env) {
  await requireAdmin(request, env)
  const input = updateSchema.parse(await readJson(request, 2000))
  const changed = await updateStoreItem(env, input.id, input)
  if (!changed) return json({ error: 'Item not found.' }, 404)
  await refreshWorldCatalog(env)
  return json({ item: await getStoreItem(env, input.id) })
}

export async function maplestreetItems(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'GET') {
    const model = url.searchParams.get('model')
    if (model !== null) return serveModel(env, model)
    return json({ items: await listStoreItems(env) })
  }
  requireSameOrigin(request)
  if (request.method === 'POST') return publish(request, env)
  if (request.method === 'PATCH') return update(request, env)
  return json({ error: 'Method not allowed.' }, 405)
}
