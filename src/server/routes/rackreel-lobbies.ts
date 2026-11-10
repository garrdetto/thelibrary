import { z } from 'zod'
import type { Env } from '../env.js'
import { json, readJson, requireSameOrigin } from '../http.js'
import { currentUser } from '../auth.js'
import { closeLobby, ensureLobbyTable, listLobbies, publishLobby } from '../rackreel-lobbies.js'

const code = z.string().regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
const key = z.string().regex(/^[a-z0-9]{16,40}$/)

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), code, key, players: z.number().int().min(1).max(4), guest: z.string().max(20).optional() }),
  z.object({ action: z.literal('close'), code, key }),
])

export async function rackreelLobbies(request: Request, env: Env) {
  await ensureLobbyTable(env)
  if (request.method === 'GET') return json({ lobbies: await listLobbies(env) })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const input = actions.parse(await readJson(request, 500))
  if (input.action === 'close') {
    await closeLobby(env, input.code, input.key)
    return json({ closed: true })
  }
  const user = await currentUser(request, env)
  const host = user?.username ?? (input.guest && /^Guest-[a-z0-9]{4}$/.test(input.guest) ? input.guest : 'Guest')
  const listed = await publishLobby(env, input.code, input.key, host, input.players)
  return listed ? json({ listed: true }) : json({ error: 'That party code is already listed.' }, 409)
}
