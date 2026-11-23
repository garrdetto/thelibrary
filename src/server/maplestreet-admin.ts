import type { Env } from './env'
import { HttpError } from './http'
import { requireUser } from './auth'
import { FOX_LAKE_WORLD_NAME } from './routes/maplestreet'

export async function requireMapleAdmin(request: Request, env: Env, message = 'Sign in as the administrator to manage published assets.') {
  const user = await requireUser(request, env, message)
  if (!user.isAdmin) throw new HttpError(403, 'Administrator access required.')
  return user
}

/** Asks Life Sim's world Durable Object to write its unsaved lots and accounts to D1 now. */
export async function saveWorld(env: Env) {
  if (!env.FOX_LAKE_WORLD) return
  const failed = new HttpError(503, 'Life Sim couldn’t be checked right now. Please try again shortly.')
  let response: Response
  try {
    const stub = env.FOX_LAKE_WORLD.get(env.FOX_LAKE_WORLD.idFromName(FOX_LAKE_WORLD_NAME))
    response = await stub.fetch(new Request('https://maple-world/save', { method: 'POST' }))
  } catch (error) {
    console.error('Life Sim save failed', error)
    throw failed
  }
  if (!response.ok) throw failed
}

/** Tells Life Sim's world Durable Object to re-register published items and vehicles. */
export async function refreshWorldCatalog(env: Env) {
  if (!env.FOX_LAKE_WORLD) return
  try {
    await env.FOX_LAKE_WORLD.get(env.FOX_LAKE_WORLD.idFromName(FOX_LAKE_WORLD_NAME)).fetch(new Request('https://maple-world/catalog', { method: 'POST' }))
  } catch (error) {
    console.error('Life Sim catalog refresh failed', error)
  }
}
