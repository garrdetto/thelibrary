import { z } from 'zod'
import { CUSTOM_RIDE_LIMITS as L } from '../../../server/park/index.mjs'
import type { Env } from '../env'
import { HttpError, json, readJson, requireSameOrigin } from '../http'
import { currentUser } from '../auth'
import { requireMapleAdmin } from '../maplestreet-admin'
import { inspectModel } from '../gltf-check'
import { deleteRideRow, getRide, insertRide, listRides, newRideId, RIDE_MESH_KEY, RIDE_SOURCE_KEY, RIDE_THUMB_KEY, rideIdSchema, rideSpecSchema, rideStatusSchema, toCatalogEntry, updateRide } from '../park-rides'
import type { ParkRideSpec, ParkRideStatus } from '../../lib/park-rides'

const MESH_MAGIC = 0x31525054
const MESH_MAGIC_PIECES = 0x32525054
const INSTANCE_BYTES = 24
const requireAdmin = (request: Request, env: Env) => requireMapleAdmin(request, env, 'Sign in as the administrator to manage Thrill Park rides.')
const isAdmin = async (request: Request, env: Env) => (await currentUser(request, env))?.isAdmin === true

/** Draft → published, published ↔ retired. Published rides never go back to draft so drafts are always safe to delete. */
const ALLOWED: Record<ParkRideStatus, ParkRideStatus[]> = { draft: ['draft', 'published'], published: ['published', 'retired'], retired: ['retired', 'published'] }
const statusPatch = z.object({ id: rideIdSchema, status: rideStatusSchema }).strict()
const deleteInput = z.object({ id: rideIdSchema }).strict()

async function serveFile(env: Env, key: string, type: string, cache: string) {
  const stored = await env.FILES.getWithMetadata<{ mime?: string }>(key, 'arrayBuffer')
  if (!stored.value) return json({ error: 'File not found.' }, 404)
  return new Response(stored.value, { headers: { 'Content-Type': stored.metadata?.mime ?? type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' } })
}

function checkMesh(bytes: Uint8Array) {
  if (bytes.byteLength < 16 || bytes.byteLength > L.meshBytes) throw new HttpError(413, 'The baked ride is too large. Lower the triangle count and try again.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const triangles = view.getUint32(4, true), magic = view.getUint32(0, true), body = 16 + triangles * 42
  const unreadable = () => new HttpError(400, 'That baked ride could not be read. Bake it again.')
  if ((magic !== MESH_MAGIC && magic !== MESH_MAGIC_PIECES) || triangles < 1 || triangles > L.trianglesMax * 1.05) throw unreadable()
  if (magic === MESH_MAGIC) { if (body !== bytes.byteLength) throw unreadable(); return }
  if (body + 4 > bytes.byteLength) throw unreadable()
  const instances = view.getUint16(body, true)
  if (instances > L.instancesMax || body + 4 + instances * INSTANCE_BYTES !== bytes.byteLength) throw unreadable()
}

function checkThumb(bytes: Uint8Array) {
  if (bytes.byteLength > L.thumbBytes) throw new HttpError(413, 'The preview image is too large.')
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (!webp && !png) throw new HttpError(400, 'The preview image must be WebP or PNG.')
  return webp ? 'image/webp' : 'image/png'
}

const fileBytes = async (value: FormDataEntryValue | null) => value && typeof value !== 'string' && value.size > 0 ? new Uint8Array(await value.arrayBuffer()) : null

async function save(request: Request, env: Env) {
  const user = await requireAdmin(request, env)
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) throw new HttpError(415, 'Send the ride as multipart form data.')
  if (Number(request.headers.get('content-length')) > L.sourceBytes + L.meshBytes + L.thumbBytes + 64 * 1024) throw new HttpError(413, 'That upload is too large.')
  const form = await request.formData()
  const rawId = form.get('id')
  const id = typeof rawId === 'string' && rawId ? rideIdSchema.parse(rawId) : null
  const spec = rideSpecSchema.parse(JSON.parse(String(form.get('spec') ?? 'null'))) as ParkRideSpec
  const status = z.enum(['draft', 'published']).parse(form.get('status') ?? 'draft')
  const rawJob = form.get('sourceJob')
  const sourceJob = typeof rawJob === 'string' && rawJob ? z.string().uuid().parse(rawJob) : undefined
  const mesh = await fileBytes(form.get('mesh'))
  const thumb = await fileBytes(form.get('thumb'))
  const source = await fileBytes(form.get('source'))
  if (mesh) checkMesh(mesh)
  const thumbType = thumb ? checkThumb(thumb) : null
  if (source) {
    if (source.byteLength > L.sourceBytes) throw new HttpError(413, 'Source models must be smaller than 15 MB.')
    inspectModel('source.glb', source)
  }

  const existing = id ? await getRide(env, id) : null
  if (id && !existing) return json({ error: 'Ride not found.' }, 404)
  const nextStatus: ParkRideStatus = existing && existing.status !== 'draft' ? (status === 'published' ? 'published' : existing.status) : status
  if (existing && !ALLOWED[existing.status].includes(nextStatus)) throw new HttpError(409, 'That status change isn’t allowed.')
  if (existing && existing.status !== 'draft' && (existing.spec.size[0] !== spec.size[0] || existing.spec.size[1] !== spec.size[1])) throw new HttpError(409, 'A published ride’s footprint can’t change, because parks have already built it. Make a new ride for a different size.')
  if (nextStatus === 'published' && !mesh && !existing?.meshVersion) throw new HttpError(409, 'Bake the model before publishing the ride.')

  const rideId = existing?.id ?? newRideId()
  if (mesh) await env.FILES.put(RIDE_MESH_KEY(rideId), mesh, { metadata: { bytes: mesh.byteLength } })
  if (thumb) await env.FILES.put(RIDE_THUMB_KEY(rideId), thumb, { metadata: { bytes: thumb.byteLength, mime: thumbType } })
  if (source) await env.FILES.put(RIDE_SOURCE_KEY(rideId), source, { metadata: { bytes: source.byteLength } })
  if (existing) await updateRide(env, rideId, { spec, status: nextStatus, meshBytes: mesh?.byteLength, thumb: Boolean(thumb), source: Boolean(source), sourceJob })
  else await insertRide(env, { id: rideId, spec, status: nextStatus, meshBytes: mesh?.byteLength ?? 0, thumb: Boolean(thumb), source: Boolean(source), sourceJob: sourceJob ?? null, createdBy: user.id })
  return json({ record: await getRide(env, rideId) }, existing ? 200 : 201)
}

async function patch(request: Request, env: Env) {
  await requireAdmin(request, env)
  const input = statusPatch.parse(await readJson(request, 500))
  const ride = await getRide(env, input.id)
  if (!ride) return json({ error: 'Ride not found.' }, 404)
  if (!ALLOWED[ride.status].includes(input.status)) throw new HttpError(409, ride.status === 'draft' ? 'Publish a draft before retiring it, or delete it.' : 'Published rides can be retired but not turned back into drafts.')
  if (input.status === 'published' && !ride.meshVersion) throw new HttpError(409, 'Bake the model before publishing the ride.')
  await updateRide(env, ride.id, { status: input.status })
  return json({ record: await getRide(env, ride.id) })
}

async function remove(request: Request, env: Env) {
  await requireAdmin(request, env)
  const input = deleteInput.parse(await readJson(request, 200))
  const ride = await getRide(env, input.id)
  if (!ride) return json({ error: 'Ride not found.' }, 404)
  if (ride.status !== 'draft') throw new HttpError(409, 'Published rides may be in players’ parks. Retire it instead; it leaves the build menu but existing rides keep working.')
  await deleteRideRow(env, ride.id)
  await Promise.all([RIDE_MESH_KEY, RIDE_THUMB_KEY, RIDE_SOURCE_KEY].map(key => env.FILES.delete(key(ride.id))))
  return json({ ok: true })
}

async function serveDraftAware(request: Request, env: Env, id: string, key: string, type: string) {
  const ride = await getRide(env, rideIdSchema.parse(id))
  if (!ride) return json({ error: 'Ride not found.' }, 404)
  const versioned = new URL(request.url).searchParams.has('v')
  if (ride.status === 'draft') {
    if (!(await isAdmin(request, env))) return json({ error: 'Ride not found.' }, 404)
    return serveFile(env, key, type, 'private, no-store')
  }
  return serveFile(env, key, type, versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
}

export async function parkRides(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'GET') {
    const mesh = url.searchParams.get('mesh'), thumb = url.searchParams.get('thumb'), source = url.searchParams.get('source')
    if (mesh !== null) return serveDraftAware(request, env, mesh, RIDE_MESH_KEY(rideIdSchema.parse(mesh)), 'application/octet-stream')
    if (thumb !== null) return serveDraftAware(request, env, thumb, RIDE_THUMB_KEY(rideIdSchema.parse(thumb)), 'image/webp')
    if (source !== null) return serveDraftAware(request, env, source, RIDE_SOURCE_KEY(rideIdSchema.parse(source)), 'model/gltf-binary')
    if (url.searchParams.get('drafts') === '1') {
      await requireAdmin(request, env)
      return json({ records: await listRides(env, true) })
    }
    const rides = (await listRides(env, false)).map(toCatalogEntry)
    return json({ rides }, 200, { 'Cache-Control': 'public, max-age=30' })
  }
  requireSameOrigin(request)
  if (request.method === 'POST') return save(request, env)
  if (request.method === 'PATCH') return patch(request, env)
  if (request.method === 'DELETE') return remove(request, env)
  return json({ error: 'Method not allowed.' }, 405)
}
