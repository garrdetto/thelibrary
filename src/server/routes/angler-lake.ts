import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json } from '../http.js'
import { currentUser } from '../auth.js'
import { lakeStatus, lakeStub } from '../angler-lake.js'
import type { LakeIdentity } from '../angler-lake.js'
import { lakeIds } from '../../../modules-src/angler/shared/Lakes'
import type { LakeId } from '../../../modules-src/angler/shared/Lakes'
import { INSTANCES_PER_LAKE } from '../../../modules-src/angler/shared/Online'

const lakeEnum = z.enum(lakeIds as [LakeId, ...LakeId[]])
const connectParams = z.object({
  lake: lakeEnum,
  instance: z.coerce.number().int().min(0).max(INSTANCES_PER_LAKE - 1).optional(),
  crew: z.literal('1').optional(),
  guest: z.string().regex(/^[A-Za-z0-9]{12,64}$/).optional(),
})

/** `/api/angler-lake`: GET counts the boats out on every lake; a WebSocket upgrade joins a lake instance (the invited one, or the first with room). */
export async function anglerLake(request: Request, env: Env) {
  const url = new URL(request.url)
  if (!env.ANGLER_LAKE) throw new HttpError(503, 'Shared lakes are not available right now.')

  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    if (request.method !== 'GET') throw new HttpError(405, 'This request is not allowed.')
    const lakes: Record<string, { boats: number; anglers: number }> = {}
    await Promise.all(lakeIds.map(async id => { lakes[id] = await lakeStatus(env, id) }))
    return json({ lakes }, 200, { 'cache-control': 'no-store' })
  }

  if (request.headers.get('origin') !== url.origin) throw new HttpError(403, 'This request is not allowed.')
  const parsed = connectParams.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) throw new HttpError(400, 'Please reload the page and try again.')
  const params = parsed.data
  const user = await currentUser(request, env)
  let base: Omit<LakeIdentity, 'instance'>
  if (user) base = { key: `member:${user.id}`, name: user.username, member: true, userId: user.id, lake: params.lake, crew: Boolean(params.crew) }
  else {
    if (!params.guest) throw new HttpError(400, 'Please reload the page and try again.')
    base = { key: `guest:${params.guest}`, name: `Guest-${params.guest.slice(0, 5)}`, member: false, lake: params.lake, crew: Boolean(params.crew) }
  }

  const order = params.instance !== undefined ? [params.instance] : Array.from({ length: INSTANCES_PER_LAKE }, (_, i) => i)
  for (const instance of order) {
    const stub = lakeStub(env, params.lake, instance)!
    const headers = new Headers(request.headers)
    headers.set('x-angler-identity', JSON.stringify({ ...base, instance }))
    const response = await stub.fetch(new Request(new URL('/connect', url), { headers }))
    if (response.status === 409 && params.instance === undefined) continue
    if (response.status === 409) throw new HttpError(409, 'That lake is full right now.')
    if (response.status === 403) throw new HttpError(403, 'Land more fish to open this lake.')
    return response
  }
  throw new HttpError(409, 'Every boat slot on this lake is taken right now.')
}
