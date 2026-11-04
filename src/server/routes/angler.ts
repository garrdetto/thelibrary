import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { canResetRecords } from '../records.js'
import { ensureAnglerTables, loadProfile, loadSession, saveProfile, saveSession } from '../angler.js'
import type { AnglerSession } from '../angler.js'
import { LAKES, depthFeetAt, isLakeId, lakeIds, nearestSpot } from '../../../modules-src/angler/shared/Lakes'
import { activity, biteDelay, conditionsAt, creditsFor, rollCatch, MIN_BITE_SECONDS } from '../../../modules-src/angler/shared/Catch'
import type { CatchResult } from '../../../modules-src/angler/shared/Catch'
import { REELS, RODS } from '../../../modules-src/angler/shared/Gear'
import type { Rig } from '../../../modules-src/angler/shared/Gear'
import { isSpeciesId } from '../../../modules-src/angler/shared/Species'
import { lakeOpen, lbToOz10 } from '../../../modules-src/angler/shared/Profile'
import type { AnglerProfile } from '../../../modules-src/angler/shared/Profile'
import { centralTime, sunPosition } from '../../../modules-src/angler/shared/Astro'
import { applyProgress, evaluateAchievements } from '../../../modules-src/angler/shared/Achievements'
import { purchase, equip } from '../../../modules-src/angler/shared/Shop'

const lakeEnum = z.enum(lakeIds as [string, ...string[]])
const rigSchema = z.object({ rod: z.enum(Object.keys(RODS) as [string, ...string[]]), presentation: z.string().max(20) })
const progressSchema = z.object({ seconds: z.number().min(0).max(600), miles: z.number().min(0).max(20), social: z.number().int().min(0).max(4).optional() }).optional()

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), lake: lakeEnum, x: z.number().finite(), z: z.number().finite(), rig: rigSchema, crowd: z.number().int().min(0).max(16).optional(), progress: progressSchema }),
  z.object({ action: z.literal('stop'), progress: progressSchema }),
  z.object({ action: z.literal('tick'), crowd: z.number().int().min(0).max(16).optional(), progress: progressSchema }),
  z.object({ action: z.literal('buy'), item: z.string().min(1).max(60) }),
  z.object({ action: z.literal('equip'), patch: z.record(z.string().max(30), z.unknown()) }),
  z.object({ action: z.literal('reset-records'), species: z.string().max(20), password: z.string().min(1).max(128).optional() }),
  z.object({ action: z.literal('void-catch'), id: z.string().min(1).max(120), password: z.string().min(1).max(128).optional() }),
])

const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
const STALE_MS = 150_000

type CatchRow = { id: string; username: string; weight: number; length: number; lake: string; spot: string; tier: string; rig: string; created_at: number; species?: string }

function toRecord(row: CatchRow) {
  return { id: row.id, username: row.username, weight: row.weight, length: row.length, lake: row.lake, spot: row.spot, tier: row.tier, rig: row.rig, date: new Date(row.created_at).toISOString(), ...(row.species ? { species: row.species } : {}) }
}

function monthStart(now: number) {
  const ct = centralTime(new Date(now))
  return Date.UTC(ct.year, ct.month, 1, 6)
}

async function board(env: Env, species: string, lake: string, period: string, userId: string | null) {
  const where = ['c.species = ?', 'c.landed = 1']
  const binds: unknown[] = [species]
  if (lake !== 'all') { where.push('c.lake = ?'); binds.push(lake) }
  if (period === 'month') { where.push('c.created_at >= ?'); binds.push(monthStart(Date.now())) }
  const rows = await env.DB.prepare(`SELECT c.id, COALESCE(u.username, c.username) AS username, c.weight, c.length, c.lake, c.spot, c.tier, c.rig, c.created_at FROM angler_catches c LEFT JOIN users u ON u.id = c.user_id WHERE ${where.join(' AND ')} ORDER BY c.weight DESC, c.created_at ASC LIMIT 20`).bind(...binds).all<CatchRow>()
  const personal = userId ? await env.DB.prepare('SELECT MAX(weight) AS best FROM angler_catches WHERE species = ? AND landed = 1 AND user_id = ?').bind(species, userId).first<{ best: number | null }>() : null
  return { species, lake, period, records: rows.results.map(toRecord), personalBest: personal?.best ?? null, signedIn: Boolean(userId) }
}

async function hall(env: Env) {
  const rows = await env.DB.prepare(`SELECT id, username, weight, length, lake, spot, tier, rig, created_at, species FROM (
    SELECT c.id, COALESCE(u.username, c.username) AS username, c.weight, c.length, c.lake, c.spot, c.tier, c.rig, c.created_at, c.species,
      ROW_NUMBER() OVER (PARTITION BY c.species ORDER BY c.weight DESC, c.created_at ASC) AS rn
    FROM angler_catches c LEFT JOIN users u ON u.id = c.user_id WHERE c.landed = 1) WHERE rn = 1`).all<CatchRow>()
  return rows.results.map(toRecord)
}

async function recent(env: Env, userId: string) {
  const rows = await env.DB.prepare('SELECT id, username, weight, length, lake, spot, tier, rig, created_at, species, landed FROM angler_catches WHERE user_id = ? ORDER BY created_at DESC LIMIT 25').bind(userId).all<CatchRow & { landed: number }>()
  return rows.results.map(row => ({ ...toRecord(row), landed: row.landed === 1 }))
}

function validRig(profile: AnglerProfile, rig: { rod: string; presentation: string }): Rig {
  const rod = rig.rod as Rig['rod']
  if (!profile.rods.includes(rod)) throw new HttpError(400, 'You do not own that rod yet.')
  if (!RODS[rod].presentations.includes(rig.presentation as Rig['presentation'])) throw new HttpError(400, 'That rod cannot fish that presentation.')
  return { rod, presentation: rig.presentation as Rig['presentation'] }
}

function schedule(session: AnglerSession, now: number, crowd: number, extra = 0) {
  const lake = LAKES[session.lake]
  const ctx = { lake, x: session.x, z: session.z, date: new Date(now), rig: session.rig, settled: 60, crowd }
  const act = activity(ctx, conditionsAt(ctx))
  const at = now + extra + biteDelay(act, random) * 1000
  session.nextBiteAt = Math.round(Math.max(at, session.lastBiteAt + MIN_BITE_SECONDS * 1000))
}

async function siteBest(env: Env, species: string) {
  const row = await env.DB.prepare('SELECT MAX(weight) AS best FROM angler_catches WHERE species = ? AND landed = 1').bind(species).first<{ best: number | null }>()
  return row?.best ?? 0
}

async function recordCatch(env: Env, user: { id: string; username: string }, profile: AnglerProfile, session: AnglerSession, result: CatchResult, now: number) {
  const stats = profile.stats
  const ct = centralTime(new Date(now))
  const day = `${ct.year}-${String(ct.month + 1).padStart(2, '0')}-${String(ct.day).padStart(2, '0')}`
  const spot = nearestSpot(LAKES[session.lake], session.x, session.z)
  const spotName = spot.distance < 160 ? spot.spot.name : 'Open water'
  const weight = lbToOz10(result.weight)
  const length = Math.round(result.length * 4)
  const response: Record<string, unknown> = { ...result, weightOz10: weight, lengthQ: length, spot: spotName, credits: 0, personalBest: false, siteRecord: false, daily: 0 }
  if (result.kind === 'missed') { stats.missed++; return response }
  const id = crypto.randomUUID()
  const landed = result.kind === 'landed'
  if (landed) {
    const previous = stats.bySpecies[result.species]
    const best = await siteBest(env, result.species)
    const personalBest = !previous || weight > previous.best
    const siteRecord = weight > best && (best > 0 || result.percentile >= 0.6)
    let credits = creditsFor(result.weight, result.tier)
    if (personalBest && previous) credits *= 2
    if (siteRecord) { credits *= 2; stats.records++ }
    let daily = 0
    if (stats.lastDaily !== day) { daily = 100; stats.lastDaily = day }
    profile.tc += credits + daily
    stats.tcEarned += credits + daily
    stats.landed++
    stats.bySpecies[result.species] = { n: (previous?.n ?? 0) + 1, best: Math.max(previous?.best ?? 0, weight) }
    stats.tiers[result.tier] = (stats.tiers[result.tier] ?? 0) + 1
    if (!stats.months.includes(ct.month)) stats.months.push(ct.month)
    Object.assign(response, { credits, personalBest, siteRecord, daily })
  } else {
    stats.lost++
    stats.tiers[`lost:${result.tier}`] = (stats.tiers[`lost:${result.tier}`] ?? 0) + 1
    if (result.weight >= 30) stats.tiers['lost:30lb'] = (stats.tiers['lost:30lb'] ?? 0) + 1
  }
  if (!stats.lakes.includes(session.lake)) stats.lakes.push(session.lake)
  const detail = { percentile: Math.round(result.percentile * 10000) / 10000, fight: result.fight }
  await env.DB.prepare('INSERT INTO angler_catches (id, user_id, username, lake, spot, species, weight, length, tier, landed, rig, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, user.username, session.lake, spotName, result.species, weight, length, result.tier, landed ? 1 : 0, `${session.rig.rod}/${session.rig.presentation}`, JSON.stringify(detail), now).run()
  response.id = id
  return response
}

export async function angler(request: Request, env: Env) {
  await ensureAnglerTables(env)
  const url = new URL(request.url)
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    if (url.searchParams.has('hall')) return json({ hall: await hall(env) })
    const species = url.searchParams.get('board')
    if (species) {
      if (!isSpeciesId(species)) throw new HttpError(400, 'Unknown species.')
      const lake = url.searchParams.get('lake') ?? 'all'
      if (lake !== 'all' && !isLakeId(lake)) throw new HttpError(400, 'Unknown lake.')
      const period = url.searchParams.get('period') === 'month' ? 'month' : 'all'
      return json(await board(env, species, lake, period, user?.id ?? null))
    }
    if (!user) return json({ signedIn: false })
    const profile = await loadProfile(env, user.id, user.username)
    const session = await loadSession(env, user.id)
    return json({ signedIn: true, username: user.username, isAdmin: user.isAdmin, profile, recent: await recent(env, user.id), session: session ? { lake: session.lake, nextBiteAt: session.nextBiteAt } : null, serverNow: Date.now() })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save your catches and earn Tackle Credits.')
  const input = actions.parse(await readJson(request, 4000))
  const now = Date.now()

  if (input.action === 'reset-records') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    if (!isSpeciesId(input.species)) throw new HttpError(400, 'Unknown species.')
    await env.DB.prepare('DELETE FROM angler_catches WHERE species = ?').bind(input.species).run()
    return json({ reset: true })
  }
  if (input.action === 'void-catch') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can void catches.' }, 403)
    await env.DB.prepare('UPDATE angler_catches SET landed = 0, tier = ? WHERE id = ?').bind('Voided', input.id).run()
    return json({ voided: true })
  }

  const profile = await loadProfile(env, user.id, user.username)
  let session = await loadSession(env, user.id)

  if (input.action === 'buy') {
    const result = purchase(profile, input.item)
    if (!result.ok) throw new HttpError(400, result.error)
    evaluateAchievements(profile)
    await saveProfile(env, user.id, user.username, profile)
    return json({ profile })
  }
  if (input.action === 'equip') {
    const result = equip(profile, input.patch)
    if (!result.ok) throw new HttpError(400, result.error)
    await saveProfile(env, user.id, user.username, profile)
    return json({ profile })
  }

  const applyTimed = (progress: z.infer<typeof progressSchema>) => {
    if (!progress) return
    const last = session?.lastProgressAt ?? now - 60_000
    const elapsed = Math.max(0, Math.min(600, (now - last) / 1000 + 5))
    const night = sunPosition(new Date(now)).altitude < -6
    const social = progress.social && session && now - (session.lastSocialAt ?? 0) > 30 * 60_000 ? 1 : 0
    applyProgress(profile, Math.min(progress.seconds, elapsed), Math.min(progress.miles, (elapsed * 72) / 3600), night, social)
    if (session) {
      session.lastProgressAt = now
      if (social) session.lastSocialAt = now
    }
  }

  if (input.action === 'start') {
    if (!lakeOpen(profile, input.lake as AnglerSession['lake'])) throw new HttpError(403, `Land ${LAKES[input.lake as AnglerSession['lake']].opensAt} fish to open this lake.`)
    const lake = LAKES[input.lake as AnglerSession['lake']]
    if (depthFeetAt(lake, input.x, input.z) < 1.2) throw new HttpError(400, 'Too shallow to fish here.')
    const rig = validRig(profile, input.rig)
    profile.rig = rig
    const lastBiteAt = session?.lastBiteAt ?? 0
    session = { lake: lake.id, x: input.x, z: input.z, rig, anchoredAt: now, lastSeen: now, nextBiteAt: 0, lastBiteAt, lastProgressAt: session?.lastProgressAt ?? now, lastSocialAt: session?.lastSocialAt ?? 0 }
    applyTimed(input.progress)
    schedule(session, now, input.crowd ?? 0, 8000)
    await saveSession(env, user.id, session)
    evaluateAchievements(profile)
    await saveProfile(env, user.id, user.username, profile)
    return json({ nextBiteAt: session.nextBiteAt, serverNow: now, profile })
  }

  if (input.action === 'stop') {
    applyTimed(input.progress)
    if (session) { session.nextBiteAt = 0; session.lastSeen = now; await saveSession(env, user.id, session) }
    evaluateAchievements(profile)
    await saveProfile(env, user.id, user.username, profile)
    return json({ stopped: true, profile })
  }

  applyTimed(input.progress)
  if (!session || !session.nextBiteAt) {
    evaluateAchievements(profile)
    await saveProfile(env, user.id, user.username, profile)
    return json({ nextBiteAt: null, serverNow: now, profile })
  }
  let result: Record<string, unknown> | null = null
  if (now - session.lastSeen > STALE_MS) {
    schedule(session, now, input.crowd ?? 0)
  } else if (now >= session.nextBiteAt) {
    const lake = LAKES[session.lake]
    const ctx = { lake, x: session.x, z: session.z, date: new Date(now), rig: session.rig, settled: 60, crowd: input.crowd ?? 0 }
    const roll = rollCatch(ctx, random, REELS[profile.reel].bonus)
    result = await recordCatch(env, user, profile, session, roll, now)
    session.lastBiteAt = now
    schedule(session, now, input.crowd ?? 0, roll.fight * 1000 + 6000)
  }
  session.lastSeen = now
  await saveSession(env, user.id, session)
  const unlocked = evaluateAchievements(profile)
  await saveProfile(env, user.id, user.username, profile)
  return json({ result, nextBiteAt: session.nextBiteAt, serverNow: now, profile, unlocked })
}
