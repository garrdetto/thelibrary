import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json } from '../http.js'
import { currentUser } from '../auth.js'
import { dartsRoomStub } from '../darts-room.js'
import type { DartsIdentity } from '../darts-room.js'
import { isRoomCode, roomCode } from '../../../modules-src/darts/shared/Room'

const connectParams = z.object({
  mode: z.enum(['create', 'join']),
  code: z.string().optional(),
  guest: z.string().regex(/^[A-Za-z0-9]{12,64}$/).optional(),
})

function randomUnit(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] / 4294967296
}

/** `/api/darts`: GET `?room=<code>` says whether a room is open, full or already playing; a same-origin WebSocket upgrade with `mode=create|join` takes a seat in an Oche Darts room (members by session, guests by a browser key). */
export async function darts(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    if (request.method !== 'GET') throw new HttpError(405, 'This request is not allowed.')
    const code = (url.searchParams.get('room') ?? '').toUpperCase()
    if (!isRoomCode(code)) throw new HttpError(400, 'That room code does not look right.')
    const stub = dartsRoomStub(env, code)
    if (!stub) return json({ open: false, full: false, started: false }, 200, { 'cache-control': 'no-store' })
    const info = await stub.fetch(new Request(new URL('/info', url)))
    return json(await info.json(), 200, { 'cache-control': 'no-store' })
  }

  if (!env.DARTS_ROOM) throw new HttpError(503, 'Online rooms are not available right now.')
  if (request.headers.get('origin') !== url.origin) throw new HttpError(403, 'This request is not allowed.')
  const parsed = connectParams.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) throw new HttpError(400, 'Please reload the page and try again.')
  const params = parsed.data
  const user = await currentUser(request, env)
  let identity: DartsIdentity
  if (user) identity = { key: `member:${user.id}`, name: user.username, member: true }
  else {
    if (!params.guest) throw new HttpError(400, 'Please reload the page and try again.')
    identity = { key: `guest:${params.guest}`, name: `Guest-${params.guest.slice(0, 5)}`, member: false }
  }
  const headers = new Headers(request.headers)
  headers.set('x-darts-identity', JSON.stringify(identity))

  if (params.mode === 'join') {
    const code = (params.code ?? '').toUpperCase()
    if (!isRoomCode(code)) throw new HttpError(400, 'That room code does not look right.')
    const response = await dartsRoomStub(env, code)!.fetch(new Request(new URL(`/room?mode=join&code=${code}`, url), { headers }))
    if (response.status === 404) throw new HttpError(404, 'No room with that code.')
    if (response.status === 409) throw new HttpError(409, 'That room is full or already playing.')
    return response
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = roomCode(randomUnit)
    const response = await dartsRoomStub(env, code)!.fetch(new Request(new URL(`/room?mode=create&code=${code}`, url), { headers }))
    if (response.status !== 409) return response
  }
  throw new HttpError(503, 'Could not open a room right now. Please try again.')
}
