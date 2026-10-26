import type { Config } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { getStore } from '@netlify/blobs'
import { GoogleGenAI } from '@google/genai'
import { createHash, randomBytes } from 'node:crypto'
import { and, asc, eq, gt, lt } from 'drizzle-orm'
import { z } from 'zod'
import { ensureAccountReset, getGameUser } from './lib/game-account.js'
import { isRecordResetPassword } from './lib/record-reset.js'
import { getDb } from '../../db/index.js'
import { racingLaps, racingProfiles, racingTickets } from '../../db/schema.js'
import type { Scheme } from '../../src/lib/racing.js'
import { displayScheme, presets } from '../../src/lib/racing.js'

const minimumLapMilliseconds = { circuit: 8000, oval: 4000 }

export default async (request: Request) => {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers })
  try {
    const url = new URL(request.url)
    await ensureAccountReset()
    const db = getDb()
    if (request.method === 'POST' && url.searchParams.get('action') === 'redeem') {
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
      if (!/^[a-f0-9]{64}$/.test(token)) return reply({ error: 'Invalid session.' }, 401)
      const hash = createHash('sha256').update(token).digest('hex')
      const [ticket] = await db.delete(racingTickets).where(and(eq(racingTickets.hash, hash), gt(racingTickets.expiresAt, new Date()))).returning()
      if (!ticket) return reply({ error: 'Session expired. Reconnect.' }, 401)
      const [profile] = await db.select().from(racingProfiles).where(eq(racingProfiles.owner, ticket.owner))
      return reply({ id: ticket.owner, username: ticket.username, scheme: displayScheme(profile?.scheme ?? presets[0]) })
    }
    const user = await getGameUser()
    if (!user) return reply({ error: 'Sign in with your workspace account to enter Racing.' }, 401)
    if (request.method === 'GET' && url.searchParams.has('records')) {
      const mode = z.enum(['practice', 'multiplayer', 'time-attack']).parse(url.searchParams.get('mode') ?? 'practice')
      const track = z.enum(['circuit', 'oval']).parse(url.searchParams.get('track') ?? 'circuit')
      const records = await db.select({ username: racingLaps.username, milliseconds: racingLaps.milliseconds, date: racingLaps.createdAt, mode: racingLaps.mode, track: racingLaps.track }).from(racingLaps).where(and(eq(racingLaps.track, track), eq(racingLaps.mode, mode))).orderBy(asc(racingLaps.milliseconds), asc(racingLaps.createdAt), asc(racingLaps.id)).limit(10)
      return reply({ records })
    }
    const owner = user.id
    const [profile] = await db.select().from(racingProfiles).where(eq(racingProfiles.owner, owner))
    if (request.method === 'GET') {
      if (url.searchParams.has('asset')) {
        const asset = url.searchParams.get('asset')
        if (!asset || profile?.scheme.asset !== asset) return reply({ error: 'Skin unavailable.' }, 404)
        const blob = await getStore('racing-skins').getWithMetadata(`${owner}/${asset}`, { type: 'arrayBuffer' })
        if (!blob) return reply({ error: 'Skin unavailable.' }, 404)
        return new Response(blob.data, { headers: { ...headers, 'Content-Type': String(blob.metadata.mime ?? 'image/png') } })
      }
      return reply({ username: user.email?.split('@')[0] ?? 'Driver', scheme: displayScheme(profile?.scheme ?? presets[0]) })
    }
    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
    verifyRequestOrigin(request)
    const raw = await request.text()
    if (raw.length > 1500) return reply({ error: 'Input is too long.' }, 413)
    const input = z.discriminatedUnion('action', [
      z.object({ action: z.literal('ticket') }),
      z.object({ action: z.literal('reset-records'), password: z.string().min(1).max(128), mode: z.enum(['practice', 'multiplayer', 'time-attack']), track: z.enum(['circuit', 'oval']) }),
      z.object({ action: z.literal('lap'), run: z.string().uuid(), lap: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), milliseconds: z.number().int().min(4000).max(600000), mode: z.enum(['practice', 'multiplayer', 'time-attack']), track: z.enum(['circuit', 'oval']).default('circuit') }).refine(lap => lap.milliseconds >= minimumLapMilliseconds[lap.track]),
      z.object({ action: z.literal('preset'), name: z.string().max(40), bodyStyle: z.enum(['gt', 'coupe', 'muscle', 'prototype']).optional() }),
      z.object({ action: z.literal('body'), bodyStyle: z.enum(['gt', 'coupe', 'muscle', 'prototype']) }),
      z.object({ action: z.literal('paint'), vehicle: z.enum(['challenger', 'escalade', 'lamborghini', 'ram', 'muscle-red']), body: z.string().regex(/^#[0-9a-fA-F]{6}$/), stripe: z.string().regex(/^#[0-9a-fA-F]{6}$/), pattern: z.enum(['plain', 'stripes', 'flames', 'chevrons', 'checker', 'lightning']) }),
      z.object({ action: z.literal('vehicle'), vehicle: z.enum(['challenger', 'escalade', 'lamborghini', 'ram', 'muscle-red']) }),
      z.object({ action: z.literal('stock-car'), body: z.string().regex(/^#[0-9a-fA-F]{6}$/), stripe: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), number: z.number().int().min(0).max(99) }),
      z.object({ action: z.literal('generate'), prompt: z.string().trim().min(3).max(500) }),
    ]).parse(JSON.parse(raw))
    if (input.action === 'reset-records') {
      if (!isRecordResetPassword(input.password)) return reply({ error: 'Incorrect reset password.' }, 403)
      await db.delete(racingLaps).where(and(eq(racingLaps.track, input.track), eq(racingLaps.mode, input.mode)))
      return reply({ reset: true })
    }
    if (input.action === 'lap') {
      await db.insert(racingLaps).values({ id: `${owner}:${input.run}:${input.lap}`, owner, username: user.email?.split('@')[0] ?? 'Driver', milliseconds: input.milliseconds, mode: input.mode, track: input.track }).onConflictDoNothing()
      return reply({ saved: true })
    }
    if (input.action === 'ticket') {
      const token = randomBytes(32).toString('hex')
      await db.delete(racingTickets).where(lt(racingTickets.expiresAt, new Date()))
      await db.insert(racingTickets).values({ hash: createHash('sha256').update(token).digest('hex'), owner, username: user.email?.split('@')[0] ?? 'Driver', expiresAt: new Date(Date.now() + 60000) })
      return reply({ ticket: token })
    }
    let scheme: Scheme | undefined = presets.find(item => item.name === ('name' in input ? input.name : ''))
    if (input.action === 'generate') {
      const ai = new GoogleGenAI({ apiKey: process.env.NETLIFY_AI_GATEWAY_KEY, httpOptions: { baseUrl: process.env.NETLIFY_AI_GATEWAY_URL?.replace(/\/$/, ''), timeout: 55000 } })
      const result = await ai.models.generateContent({ model: 'gemini-3.1-flash-image', contents: `Create a flat top-down professional motorsport car paint texture. Rectangular image, nose pointing right, car fills the image edge to edge. No background, text, perspective, shadows or wheels. Use racing graphics without police insignia or emergency lights. A bold graphic livery inspired by these ideas: ${input.prompt}`, config: { responseModalities: ['IMAGE', 'TEXT'] } })
      const part = result.candidates?.[0]?.content?.parts?.find(item => item.inlineData?.mimeType?.startsWith('image/'))?.inlineData
      if (!part?.data || !['image/png', 'image/jpeg', 'image/webp'].includes(part.mimeType ?? '')) return reply({ error: 'No skin was returned. Try a different description.' }, 502)
      const asset = crypto.randomUUID()
      await getStore('racing-skins').set(`${owner}/${asset}`, Buffer.from(part.data, 'base64'), { metadata: { mime: part.mimeType } })
      scheme = { name: input.prompt.slice(0, 40), body: '#dce2df', stripe: '#334b4b', asset }
    }
    if (input.action === 'body') scheme = { ...(profile?.scheme ?? presets[0]), bodyStyle: input.bodyStyle, vehicle: undefined }
    if (input.action === 'paint') scheme = { ...(profile?.scheme ?? presets[0]), vehicle: input.vehicle, vehiclePaints: { ...(profile?.scheme as Scheme | undefined)?.vehiclePaints, [input.vehicle]: { body: input.body, stripe: input.stripe, pattern: input.pattern } } }
    if (input.action === 'vehicle') scheme = { ...(profile?.scheme ?? presets[0]), vehicle: input.vehicle }
    if (input.action === 'stock-car') scheme = { ...(profile?.scheme ?? presets[0]), stockCar: { body: input.body, stripe: input.stripe, accent: input.accent, number: input.number } }
    if (scheme) scheme = { ...scheme, bodyStyle: ('bodyStyle' in input ? input.bodyStyle : undefined) ?? (profile?.scheme as Scheme | undefined)?.bodyStyle ?? 'gt' }
    if (!scheme) return reply({ error: 'Choose a valid preset.' }, 400)
    await db.insert(racingProfiles).values({ owner, scheme }).onConflictDoUpdate({ target: racingProfiles.owner, set: { scheme } })
    return reply({ scheme })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ error: 'Please check your input.' }, 400)
    return reply({ error: 'Racing services are temporarily unavailable. Try again shortly.' }, 503)
  }
}

export const config: Config = { path: '/api/racing', rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } }
