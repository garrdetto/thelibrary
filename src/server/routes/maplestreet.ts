import type { Env } from '../env'
import { HttpError, json } from '../http'
import { currentUser } from '../auth'

const WORLD_NAME = 'maple-street'
const guestKey = /^[A-Za-z0-9]{12,64}$/

function worldStub(env: Env) {
  if (!env.MAPLE_WORLD) throw new HttpError(503, 'Maple Street online is not available right now.')
  return env.MAPLE_WORLD.get(env.MAPLE_WORLD.idFromName(WORLD_NAME))
}

export async function maplestreet(request: Request, env: Env) {
  const url = new URL(request.url)
  const stub = worldStub(env)

  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    if (request.method !== 'GET') throw new HttpError(405, 'This request is not allowed.')
    const status = await stub.fetch(new Request(new URL('/status', url)))
    return json(await status.json())
  }

  if (request.headers.get('origin') !== url.origin) throw new HttpError(403, 'This request is not allowed.')
  const user = await currentUser(request, env)
  let identity: { key: string; name: string; member: boolean }
  if (user) {
    identity = { key: `member:${user.id}`, name: user.username, member: true }
  } else {
    const guest = url.searchParams.get('guest') ?? ''
    if (!guestKey.test(guest)) throw new HttpError(400, 'Please reload the page and try again.')
    const name = (url.searchParams.get('name') ?? '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 16) || 'Neighbor'
    identity = { key: `guest:${guest}`, name: `${name} (guest)`, member: false }
  }

  const headers = new Headers(request.headers)
  headers.set('x-maple-identity', JSON.stringify(identity))
  return stub.fetch(new Request(new URL('/connect', url), { headers }))
}
