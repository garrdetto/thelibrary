import { z } from 'zod'
import type { Env } from '../env'
import { binary, json, parseStored, readJson, requireSameOrigin } from '../http'
import { requireUser } from '../auth'
import { IMAGE_MODEL, base64ToBytes, gemini, imageTypes } from '../gemini'
import { canResetRecords } from '../records'
import { issueTicket, redeemTicket } from './account'
import type { Scheme } from '../../lib/racing'
import { displayScheme, presets } from '../../lib/racing'

const minimumLapMilliseconds = { circuit: 8000, oval: 4000, shorttrack: 12000, dells: 9000 }
const raceModes = z.enum(['practice', 'multiplayer', 'time-attack', 'race'])
const trackIds = z.enum(['circuit', 'oval', 'shorttrack', 'dells'])
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const vehicleIds = z.enum(['challenger', 'escalade', 'lamborghini', 'ram', 'muscle-red'])
const bodyStyles = z.enum(['gt', 'coupe', 'muscle', 'prototype'])

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ticket') }),
  z.object({ action: z.literal('reset-records'), password: z.string().min(1).max(128).optional(), mode: raceModes, track: trackIds }),
  z.object({ action: z.literal('lap'), run: z.string().uuid(), lap: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), milliseconds: z.number().int().min(4000).max(600000), mode: raceModes, track: trackIds.default('circuit') }).refine(lap => lap.milliseconds >= minimumLapMilliseconds[lap.track]),
  z.object({ action: z.literal('preset'), name: z.string().max(40), bodyStyle: bodyStyles.optional() }),
  z.object({ action: z.literal('body'), bodyStyle: bodyStyles }),
  z.object({ action: z.literal('paint'), vehicle: vehicleIds, body: hex, stripe: hex, pattern: z.enum(['plain', 'stripes', 'flames', 'chevrons', 'checker', 'lightning']) }),
  z.object({ action: z.literal('vehicle'), vehicle: vehicleIds }),
  z.object({ action: z.literal('stock-car'), body: hex, stripe: hex, accent: hex, number: z.number().int().min(0).max(99) }),
  z.object({ action: z.literal('generate'), prompt: z.string().trim().min(3).max(500) }),
])

async function loadScheme(env: Env, userId: string) {
  const row = await env.DB.prepare('SELECT scheme FROM racing_profiles WHERE user_id = ?').bind(userId).first<{ scheme: string }>()
  return parseStored<Scheme | null>(row?.scheme, null)
}

export async function racing(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'POST' && url.searchParams.get('action') === 'redeem') {
    const ticket = await redeemTicket(request, env, '')
    const scheme = await loadScheme(env, ticket.user_id)
    return json({ id: ticket.user_id, username: ticket.username, scheme: displayScheme(scheme ?? presets[0]) })
  }
  if (request.method === 'GET' && url.searchParams.has('records')) {
    const mode = raceModes.parse(url.searchParams.get('mode') ?? 'practice')
    const track = trackIds.parse(url.searchParams.get('track') ?? 'circuit')
    const rows = await env.DB.prepare('SELECT username, milliseconds, created_at, mode, track FROM racing_laps WHERE track = ? AND mode = ? ORDER BY milliseconds ASC, created_at ASC, id ASC LIMIT 20')
      .bind(track, mode).all<{ username: string; milliseconds: number; created_at: number; mode: string; track: string }>()
    return json({ records: rows.results.map(row => ({ username: row.username, milliseconds: row.milliseconds, date: new Date(row.created_at).toISOString(), mode: row.mode, track: row.track })) })
  }
  const user = await requireUser(request, env, 'Sign in with your account to enter Racing.')
  const profile = await loadScheme(env, user.id)
  if (request.method === 'GET') {
    const asset = url.searchParams.get('asset')
    if (url.searchParams.has('asset')) {
      if (!asset || profile?.asset !== asset) return json({ error: 'Skin unavailable.' }, 404)
      const stored = await env.FILES.getWithMetadata<{ mime?: string }>(`skin/${user.id}/${asset}`, 'arrayBuffer')
      if (!stored.value) return json({ error: 'Skin unavailable.' }, 404)
      return binary(stored.value, stored.metadata?.mime ?? 'image/png')
    }
    return json({ username: user.username, scheme: displayScheme(profile ?? presets[0]) })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const input = actions.parse(await readJson(request, 1500))
  if (input.action === 'reset-records') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    await env.DB.prepare('DELETE FROM racing_laps WHERE track = ? AND mode = ?').bind(input.track, input.mode).run()
    return json({ reset: true })
  }
  if (input.action === 'lap') {
    await env.DB.prepare('INSERT INTO racing_laps (id, user_id, username, milliseconds, mode, track, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(`${user.id}:${input.run}:${input.lap}`, user.id, user.username, input.milliseconds, input.mode, input.track, Date.now()).run()
    return json({ saved: true })
  }
  if (input.action === 'ticket') return json({ ticket: await issueTicket(env, user.id, user.username, '') })

  const current = profile ?? presets[0]
  let scheme: Scheme | undefined = input.action === 'preset' ? presets.find(item => item.name === input.name) : undefined
  if (input.action === 'generate') {
    const result = await gemini(env).models.generateContent({
      model: IMAGE_MODEL,
      contents: `Create a flat top-down professional motorsport car paint texture. Rectangular image, nose pointing right, car fills the image edge to edge. No background, text, perspective, shadows or wheels. Use racing graphics without police insignia or emergency lights. A bold graphic livery inspired by these ideas: ${input.prompt}`,
      config: { responseModalities: ['IMAGE', 'TEXT'] },
    })
    const part = result.candidates?.[0]?.content?.parts?.find(item => item.inlineData?.mimeType?.startsWith('image/'))?.inlineData
    if (!part?.data || !imageTypes.includes(part.mimeType ?? '')) return json({ error: 'No skin was returned. Try a different description.' }, 502)
    const asset = crypto.randomUUID()
    if (profile?.asset) await env.FILES.delete(`skin/${user.id}/${profile.asset}`)
    await env.FILES.put(`skin/${user.id}/${asset}`, base64ToBytes(part.data), { metadata: { mime: part.mimeType } })
    scheme = { name: input.prompt.slice(0, 40), body: '#dce2df', stripe: '#334b4b', asset }
  }
  if (input.action === 'body') scheme = { ...current, bodyStyle: input.bodyStyle, vehicle: undefined }
  if (input.action === 'paint') scheme = { ...current, vehicle: input.vehicle, vehiclePaints: { ...current.vehiclePaints, [input.vehicle]: { body: input.body, stripe: input.stripe, pattern: input.pattern } } }
  if (input.action === 'vehicle') scheme = { ...current, vehicle: input.vehicle }
  if (input.action === 'stock-car') scheme = { ...current, stockCar: { body: input.body, stripe: input.stripe, accent: input.accent, number: input.number } }
  if (!scheme) return json({ error: 'Choose a valid preset.' }, 400)
  scheme = { ...scheme, bodyStyle: ('bodyStyle' in input ? input.bodyStyle : undefined) ?? profile?.bodyStyle ?? 'gt' }
  await env.DB.prepare('INSERT INTO racing_profiles (user_id, scheme) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET scheme = excluded.scheme')
    .bind(user.id, JSON.stringify(scheme)).run()
  return json({ scheme })
}
