import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { HAUL_WORLDS, assignLot, claimLot, ensureTrucksimTables, loadPublicLots, loadTrucksimProfile, lotIsFree, saveTrucksimProfileIfUnchanged } from '../trucksim.js'
import { applyAction, moveToLot, withStarterDriveway } from '../../../modules-src/trucksim/shared/Actions'
import type { TruckAction } from '../../../modules-src/trucksim/shared/Actions'
import { LOOK_OPTIONS } from '../../../modules-src/trucksim/shared/Economy'
import { MAX_ITEMS } from '../../../modules-src/trucksim/shared/Lots'

const BODY_LIMIT = 16 * 1024
const MAX_BUILD_PER_REQUEST = 80

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const uid = z.string().min(1).max(24)
const modelId = z.string().min(1).max(40)

const lookSchema = z.object({
  paint: z.object({ primary: hex, secondary: hex, accent: hex, finish: z.enum(LOOK_OPTIONS.finish), stripe: z.enum(LOOK_OPTIONS.stripe) }),
  stacks: z.enum(LOOK_OPTIONS.stacks),
  visor: z.boolean(),
  bumper: z.enum(LOOK_OPTIONS.bumper),
  lights: z.enum(LOOK_OPTIONS.lights),
  wheels: z.enum(LOOK_OPTIONS.wheels),
  mudflaps: z.enum(LOOK_OPTIONS.mudflaps),
  horn: z.enum(LOOK_OPTIONS.horn),
  grille: z.enum(LOOK_OPTIONS.grille).optional(),
  roof: z.enum(LOOK_OPTIONS.roof).optional(),
  skirts: z.boolean().optional(),
})

const metres = z.number().finite().min(-1000).max(1000)

const itemSchema = z.object({
  id: z.string().min(1).max(40),
  def: modelId,
  x: metres,
  z: metres,
  w: z.number().finite().positive().max(1000),
  d: z.number().finite().positive().max(1000),
  rot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  color: hex,
  color2: hex.optional(),
})

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('buy-truck'), model: modelId, look: lookSchema.optional() }),
  z.object({ action: z.literal('buy-trailer'), model: modelId, color: hex.optional() }),
  z.object({ action: z.literal('sell-truck'), uid }),
  z.object({ action: z.literal('sell-trailer'), uid }),
  z.object({ action: z.literal('customize'), uid, look: lookSchema }),
  z.object({ action: z.literal('select'), truck: uid, trailer: uid.nullable() }),
  z.object({ action: z.literal('accept-job'), job: z.string().min(1).max(60) }),
  z.object({ action: z.literal('complete-job'), job: z.string().min(1).max(60), damage: z.number().finite().min(0).max(1) }),
  z.object({ action: z.literal('abandon-job') }),
  z.object({ action: z.literal('refuel'), uid, litres: z.number().finite().positive().max(2000) }),
  z.object({ action: z.literal('repair'), uid }),
  z.object({ action: z.literal('build'), items: z.array(itemSchema).min(1).max(Math.min(MAX_ITEMS, MAX_BUILD_PER_REQUEST)) }),
  z.object({ action: z.literal('demolish'), ids: z.array(z.string().min(1).max(40)).min(1).max(MAX_ITEMS) }),
  z.object({ action: z.literal('rename'), company: z.string().max(100) }),
  z.object({ action: z.literal('claim-lot'), index: z.number().int().min(0).max(99) }),
  z.object({ action: z.literal('buy-land') }),
  z.object({ action: z.literal('wash'), uid, cleaned: z.number().finite().min(0).max(1), place: z.enum(['own', 'public']) }),
  z.object({ action: z.literal('odometer'), uid, km: z.number().finite().min(0).max(1000), fuelUsedL: z.number().finite().min(0).max(1000) }),
])

function haulWorld(request: Request) {
  const params = new URL(request.url).searchParams
  const id = params.get('world') ?? params.get('game') ?? 'county'
  const entry = HAUL_WORLDS[id]
  if (!entry) throw new HttpError(400, 'Unknown haul world.')
  return entry
}

/**
 * Truck Simulator's saved state. GET returns the signed-in driver's profile (assigning a free lot on Haulers Row) and the
 * public lot list; `?lots=1` returns only the lots. POST runs one `TruckAction` through `applyAction` and saves.
 */
export async function trucksim(request: Request, env: Env) {
  await ensureTrucksimTables(env)
  const entry = haulWorld(request)
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams
    const now = Date.now()
    if (params.has('lots')) return json({ lots: await loadPublicLots(env, now) })
    const user = await currentUser(request, env)
    if (!user) return json({ signedIn: false, lots: await loadPublicLots(env, now) })
    const key = entry.profileKey(user.id)
    const loaded = await loadTrucksimProfile(env, key, user.username)
    const lot = await assignLot(env, user.id, user.username, now)
    let profile = loaded.profile
    const fresh = lot === null ? profile : withStarterDriveway(profile.lot === lot ? profile : moveToLot(profile, lot))
    if (profile.lot !== lot || fresh !== profile) {
      profile = lot === null ? { ...profile, lot } : fresh
      await saveTrucksimProfileIfUnchanged(env, key, user.username, profile, loaded.updatedAt, Math.max(now, loaded.updatedAt + 1))
    }
    return json({ signedIn: true, username: user.username, admin: user.isAdmin, profile, lots: await loadPublicLots(env, now) })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save your trucks and lot.')
  const input: TruckAction = actions.parse(await readJson(request, BODY_LIMIT))
  const now = Date.now()
  const key = entry.profileKey(user.id)
  const loaded = await loadTrucksimProfile(env, key, user.username)
  const lot = await assignLot(env, user.id, user.username, now)
  const profile = { ...loaded.profile, lot }
  const claimIndex = input.action === 'claim-lot' ? input.index : -1
  const claimFree = claimIndex >= 0 ? await lotIsFree(env, user.id, claimIndex) : false
  const result = applyAction(profile, input, { now, world: entry.world, lotFree: (index) => index === claimIndex && claimFree })
  if (!result.ok) return json({ ok: false, message: result.message, delta: 0, profile: result.profile })
  if (claimIndex >= 0 && result.profile.lot === claimIndex && !await claimLot(env, user.id, user.username, claimIndex, now)) {
    return json({ ok: false, message: 'Someone already has that lot.', delta: 0, profile })
  }
  const saved = await saveTrucksimProfileIfUnchanged(env, key, user.username, result.profile, loaded.updatedAt, Math.max(now, loaded.updatedAt + 1))
  if (!saved) throw new HttpError(409, 'Your profile changed in another window. Try again.')
  return json({ ok: true, message: result.message, delta: result.delta, paid: result.paid ?? null, profile: result.profile })
}
