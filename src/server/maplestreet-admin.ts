import type { Env } from './env'
import { HttpError } from './http'
import { requireUser } from './auth'

export async function requireMapleAdmin(request: Request, env: Env, message = 'Sign in as the administrator to manage Fox Plains.') {
  const user = await requireUser(request, env, message)
  if (!user.isAdmin) throw new HttpError(403, 'Administrator access required.')
  return user
}

/** Tells the shared-world Durable Object to re-register published items and vehicles. */
export async function refreshWorldCatalog(env: Env) {
  if (!env.MAPLE_WORLD) return
  try {
    const stub = env.MAPLE_WORLD.get(env.MAPLE_WORLD.idFromName('maple-street'))
    await stub.fetch(new Request('https://maple-world/catalog', { method: 'POST' }))
  } catch (error) {
    console.error('Fox Plains catalog refresh failed', error)
  }
}
