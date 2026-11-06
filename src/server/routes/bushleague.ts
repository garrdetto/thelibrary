import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json } from '../http.js'
import { currentUser } from '../auth.js'
import { ratingsBoard } from '../bushleague.js'
import { matchStub } from '../bushleague-match.js'
import type { MatchIdentity, MatchJoin } from '../bushleague-match.js'
import { isRoomCode, isTeamId, roomCode } from '../../../modules-src/bushleague/shared/Online'

const flag = (fallback: '0' | '1') => z.enum(['0', '1']).default(fallback).transform(value => value === '1')
const connectParams = z.object({
  mode: z.enum(['queue', 'create', 'join']),
  code: z.string().optional(),
  team: z.string().refine(isTeamId),
  innings: z.enum(['3', '6', '9']).default('3').transform(value => Number(value) as 3 | 6 | 9),
  dh: flag('1'),
  runner: flag('1'),
  mercy: flag('0'),
  guest: z.string().regex(/^[A-Za-z0-9]{12,64}$/).optional(),
})

function randomUnit(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] / 4294967296
}

/** `/api/bushleague`: GET `?board=ratings` is the public Elo table (plus the caller's own rating); a WebSocket upgrade with `mode=queue|create|join` enters the ranked line or a private room. */
export async function bushleague(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    if (request.method !== 'GET') throw new HttpError(405, 'This request is not allowed.')
    const user = await currentUser(request, env)
    return json(await ratingsBoard(env, user?.id ?? null), 200, { 'cache-control': 'no-store' })
  }

  if (!env.BUSHLEAGUE_MATCH) throw new HttpError(503, 'Online matchups are not available right now.')
  if (request.headers.get('origin') !== url.origin) throw new HttpError(403, 'This request is not allowed.')
  const parsed = connectParams.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) throw new HttpError(400, 'Please reload the page and try again.')
  const params = parsed.data
  const user = await currentUser(request, env)
  let identity: MatchIdentity
  if (user) identity = { key: `member:${user.id}`, name: user.username, member: true, userId: user.id }
  else {
    if (!params.guest) throw new HttpError(400, 'Please reload the page and try again.')
    if (params.mode === 'queue') throw new HttpError(403, 'Sign in to play ranked matchups.')
    identity = { key: `guest:${params.guest}`, name: `Guest-${params.guest.slice(0, 5)}`, member: false }
  }

  const headers = new Headers(request.headers)
  headers.set('x-bl-identity', JSON.stringify(identity))
  if (params.mode === 'queue') {
    return matchStub(env, 'queue')!.fetch(new Request(new URL(`/queue?team=${params.team}`, url), { headers }))
  }

  const join: MatchJoin = { mode: params.mode, team: params.team, options: { innings: params.innings, dh: params.dh, autoRunner: params.runner, mercy: params.mercy } }
  headers.set('x-bl-join', JSON.stringify(join))
  if (params.mode === 'join') {
    const code = (params.code ?? '').toUpperCase()
    if (!isRoomCode(code)) throw new HttpError(400, 'That room code does not look right.')
    const response = await matchStub(env, `room:${code}`)!.fetch(new Request(new URL(`/room?code=${code}`, url), { headers }))
    if (response.status === 404) throw new HttpError(404, 'No room with that code. Check it with your opponent.')
    if (response.status === 409) throw new HttpError(409, 'That room is full.')
    return response
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = roomCode(randomUnit)
    const response = await matchStub(env, `room:${code}`)!.fetch(new Request(new URL(`/room?code=${code}`, url), { headers }))
    if (response.status !== 409) return response
  }
  throw new HttpError(503, 'Could not open a room right now. Please try again.')
}
