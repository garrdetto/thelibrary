import type { Config } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../db/index.js'
import { poolPracticeRecords } from '../../db/schema.js'
import { getGameUser } from './lib/game-account.js'
import { isRecordResetPassword } from './lib/record-reset.js'

export default async (request: Request) => {
  const headers = { 'Cache-Control': 'private, no-store' }
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers })
  try {
    const user = await getGameUser()
    if (!user) return reply({ error: 'Sign in to view practice high scores.' }, 401)
    const db = getDb()
    if (request.method === 'POST') {
      verifyRequestOrigin(request)
      const raw = await request.text()
      if (raw.length > 500) return reply({ error: 'Input is too long.' }, 413)
      const input = z.object({ id: z.string().uuid(), mode: z.enum(['practice', 'nine-practice']), milliseconds: z.number().int().min(1000).max(2147483647) }).parse(JSON.parse(raw))
      await db.insert(poolPracticeRecords).values({ ...input, owner: user.id, username: user.email?.split('@')[0] ?? 'Player' }).onConflictDoNothing()
      return reply({ saved: true })
    }
    if (request.method === 'DELETE') {
      verifyRequestOrigin(request)
      const raw = await request.text()
      if (raw.length > 500) return reply({ error: 'Input is too long.' }, 413)
      const input = z.object({ mode: z.enum(['practice', 'nine-practice']), password: z.string().min(1).max(128) }).parse(JSON.parse(raw))
      if (!isRecordResetPassword(input.password)) return reply({ error: 'Incorrect reset password.' }, 403)
      await db.delete(poolPracticeRecords).where(eq(poolPracticeRecords.mode, input.mode))
      return reply({ reset: true })
    }
    if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405)
    const mode = z.enum(['practice', 'nine-practice']).parse(new URL(request.url).searchParams.get('mode') ?? 'practice')
    const records = await db.select({ username: poolPracticeRecords.username, milliseconds: poolPracticeRecords.milliseconds, date: poolPracticeRecords.createdAt }).from(poolPracticeRecords).where(eq(poolPracticeRecords.mode, mode)).orderBy(asc(poolPracticeRecords.milliseconds), asc(poolPracticeRecords.createdAt), asc(poolPracticeRecords.id)).limit(10)
    return reply({ records })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ error: 'Please check your practice result.' }, 400)
    return reply({ error: 'Practice high scores are unavailable. Please try again.' }, 503)
  }
}

export const config: Config = { path: '/api/pool-practice', rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } }
