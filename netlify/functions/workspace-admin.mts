import type { Config } from '@netlify/functions'
import { admin, AuthError, verifyRequestOrigin } from '@netlify/identity'
import { z } from 'zod'
import { getGameUser } from './lib/game-account.js'
import { isWorkspaceAdmin, permissionsOf, usernameOf, workspaceAccess } from './lib/workspace-access.js'

const update = z.object({
  id: z.string().uuid(),
  username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_-]+$/).transform(value => value.toLowerCase()),
  pages: z.array(z.enum(['chat', 'image', 'lyrics'])).max(3),
}).strict()

export default async (request: Request) => {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
  try {
    if (request.method === 'GET' && new URL(request.url).pathname === '/api/workspace-access') return respond(await workspaceAccess())
    const actor = await getGameUser()
    if (!actor || !isWorkspaceAdmin(actor)) return respond({ error: 'Administrator access required.' }, 403)
    if (request.method === 'GET') {
      const users = []
      for (let page = 1; ; page++) {
        const batch = await admin.listUsers({ page, perPage: 100 })
        users.push(...batch.filter(user => user.email?.endsWith('@players.invalid')).map(user => ({ id: user.id, username: usernameOf(user), pages: permissionsOf(user), isAdmin: isWorkspaceAdmin(user) })))
        if (batch.length < 100) break
      }
      return respond({ users })
    }
    if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405)
    verifyRequestOrigin(request)
    const raw = await request.text()
    if (raw.length > 2048) return respond({ error: 'Request too large.' }, 413)
    const input = update.parse(JSON.parse(raw))
    const target = await admin.getUser(input.id)
    if (!target.email?.endsWith('@players.invalid')) return respond({ error: 'Account unavailable.' }, 404)
    if (isWorkspaceAdmin(target) || input.username === 'stoegbauer' || usernameOf(target) === 'test' && input.username !== 'test' || input.username === 'test' && usernameOf(target) !== 'test') return respond({ error: 'The administrator and shared tester usernames are reserved.' }, 400)
    await admin.updateUser(target.id, { email: `${input.username}@players.invalid`, confirm: true, user_metadata: { ...target.userMetadata, full_name: input.username }, app_metadata: { ...target.appMetadata, workspace_pages: input.pages } })
    return respond({ ok: true })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return respond({ error: 'Use a username of 3–20 letters, numbers, underscores or hyphens.' }, 400)
    if (error instanceof AuthError && [400, 422].includes(error.status ?? 0)) return respond({ error: 'That username is unavailable. Choose another username.' }, 409)
    return respond({ error: 'Account management is temporarily unavailable. Please try again.' }, 503)
  }
}
export const config: Config = { path: ['/api/workspace-access', '/api/workspace-admin'], rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } }
