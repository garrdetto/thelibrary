import type { DurableObjectNamespace, Env } from './env'
import { HttpError } from './http'
import { requireUser } from './auth'

export async function requireMapleAdmin(request: Request, env: Env, message = 'Sign in as the administrator to manage Fox Plains.') {
  const user = await requireUser(request, env, message)
  if (!user.isAdmin) throw new HttpError(403, 'Administrator access required.')
  return user
}

/** Tells the shared-world Durable Objects (Fox Plains and Fox Lake) to re-register published items and vehicles. */
export async function refreshWorldCatalog(env: Env) {
  const worlds: [DurableObjectNamespace | undefined, string][] = [[env.MAPLE_WORLD, 'maple-street'], [env.FOX_LAKE_WORLD, 'fox-lake']]
  await Promise.all(worlds.map(async ([ns, name]) => {
    if (!ns) return
    try {
      await ns.get(ns.idFromName(name)).fetch(new Request('https://maple-world/catalog', { method: 'POST' }))
    } catch (error) {
      console.error(`${name} catalog refresh failed`, error)
    }
  }))
}
