import { identityPassword } from '../../src/lib/account-password.js'
import type { Config } from '@netlify/functions'
import { admin, AuthError, getSettings, verifyRequestOrigin } from '@netlify/identity'
import { z } from 'zod'
import { ensureAccountReset, ensureTesterAccount, getGameUser, isTesterLogin } from './lib/game-account.js'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, lt } from 'drizzle-orm'
import { getDb } from '../../db/index.js'
import { racingTickets } from '../../db/schema.js'

const credentials = z.object({
  action: z.literal('connect'),
  username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_-]+$/).transform(value => value.toLowerCase()),
  password: z.string().min(4).max(128),
})

export default async (request: Request) => {
  const headers = { 'Cache-Control': 'private, no-store' }
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers })
  try {
    if (request.method === 'POST' && new URL(request.url).searchParams.get('action') === 'redeem') {
      await ensureAccountReset()
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
      if (!/^[a-f0-9]{64}$/.test(token)) return respond({ error: 'Invalid session.' }, 401)
      const hash = createHash('sha256').update(`pool:${token}`).digest('hex')
      const [ticket] = await getDb().delete(racingTickets).where(and(eq(racingTickets.hash, hash), gt(racingTickets.expiresAt, new Date()))).returning()
      if (!ticket) return respond({ error: 'Session expired. Sign in again.' }, 401)
      const user = await admin.getUser(ticket.owner)
      return respond({ id: user.id, username: user.email?.split('@')[0] ?? 'Player' })
    }
    if (request.method === 'GET') {
      const user = await getGameUser()
      return respond({ username: user ? user.email?.split('@')[0] ?? user.name ?? 'Player' : null })
    }
    if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405)
    verifyRequestOrigin(request)
    await ensureAccountReset()
    if (Number(request.headers.get('content-length')) > 2048) return respond({ error: 'Please check your input.' }, 413)
    const raw = await request.text()
    if (raw.length > 2048) return respond({ error: 'Please check your input.' }, 413)
    const input: unknown = JSON.parse(raw)
    if (z.object({ action: z.literal('ticket') }).strict().safeParse(input).success) {
      const user = await getGameUser()
      if (!user) return respond({ error: 'Sign in to connect to the lobby.' }, 401)
      const token = randomBytes(32).toString('hex')
      const db = getDb()
      await db.delete(racingTickets).where(lt(racingTickets.expiresAt, new Date()))
      await db.insert(racingTickets).values({ hash: createHash('sha256').update(`pool:${token}`).digest('hex'), owner: user.id, username: user.email?.split('@')[0] ?? 'Player', expiresAt: new Date(Date.now() + 60000) })
      return respond({ ticket: token })
    }
    const { username, password } = credentials.parse(input)
    if (isTesterLogin(username, password)) {
      await ensureTesterAccount()
      return respond({ created: true })
    }
    if (username === 'stoegbauer') return respond({ error: 'This username is reserved. Sign in with the existing administrator account.' }, 403)
    const settings = await getSettings()
    if (settings.disableSignup) return respond({ error: 'Registration is currently closed.' }, 403)
    await admin.createUser({ email: `${username}@players.invalid`, password: identityPassword(password), data: { user_metadata: { full_name: username, password_configured: true } } })
    return respond({ created: true })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return respond({ error: 'Use a username of 3–20 letters, numbers, underscores or hyphens, and a password of 4–128 characters.' }, 400)
    if (error instanceof AuthError) {
      if (error.status === 429) return respond({ error: 'Too many attempts. Please wait a minute and try again.' }, 429)
      if (error.status === 401 || error.status === 400) return respond({ error: 'Unable to sign in. Check your username and password.' }, 401)
      if (error.status === 422) return respond({ error: 'Unable to continue. Check your username and password, or choose a different username.' }, 422)
    }
    return respond({ error: 'Accounts are temporarily unavailable. Please try again shortly.' }, 503)
  }
}

export const config: Config = {
  path: '/api/pool-account',
  rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
