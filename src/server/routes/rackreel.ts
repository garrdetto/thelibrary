import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { ensureRackreelTables, loadCategoryBoard, loadRackreelProfile, loadRecordBoard, resetRecordBoard, saveRackreelProfile, saveRackreelProfileIfUnchanged, saveRecords } from '../rackreel.js'
import { adjustSharedWallet } from '../shared-wallet.js'
import { canResetRecords } from '../records.js'
import { CATEGORY_BY_ID } from '../../../modules-src/rackreel/shared/Records'
import { ITEM_BY_ID, applyEvent, applyPlaytime, createCharacter, equip, eventCooldown, makeover, purchase } from '../../../modules-src/rackreel/shared/Economy'
import type { GameEvent, Profile, Slot } from '../../../modules-src/rackreel/shared/Economy'
import { RECORD_BOOK_SEED, SPECIES_BY_ID, classify } from '../../../modules-src/rackreel/systems/LootTableManager'
import type { SpeciesId } from '../../../modules-src/rackreel/systems/LootTableManager'

const slots = ['rod', 'reel', 'line', 'bait', 'rifle', 'scope', 'call', 'scent', 'motor', 'utvKit', 'jacket', 'vest', 'cap', 'pants', 'pack'] as const
const speciesIds = Object.keys(SPECIES_BY_ID) as [SpeciesId, ...SpeciesId[]]

const seedSchema = z.number().int().min(0).max(2147483647).default(0)
const slider = z.number().finite().min(-1).max(1)
const appearanceSchema = z.object({
  face: z.string().max(20), hair: z.string().max(20), beard: z.string().max(20),
  jaw: slider, chin: slider, nose: slider, brow: slider, cheeks: slider, height: slider, build: slider, shoulders: slider,
})

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fish'), species: z.enum(speciesIds), value: z.number().finite().positive(), legendary: z.boolean(), boat: z.boolean(), seed: seedSchema }),
  z.object({ action: z.literal('game'), species: z.enum(speciesIds), value: z.number().finite().min(0), legendary: z.boolean(), doe: z.boolean(), stand: z.boolean(), seed: seedSchema }),
  z.object({ action: z.literal('tick') }),
  z.object({ action: z.literal('buy'), item: z.string().min(1).max(40) }),
  z.object({ action: z.literal('equip'), slot: z.enum(slots), item: z.string().max(40) }),
  z.object({ action: z.literal('create-character'), look: z.object({ jacket: z.string().max(40), vest: z.string().max(40), cap: z.string().max(40), pants: z.string().max(40), pack: z.string().max(40) }), appearance: appearanceSchema.optional() }),
  z.object({ action: z.literal('makeover'), appearance: appearanceSchema }),
  z.object({ action: z.literal('reset-records'), category: z.string().max(40).refine((id) => id in CATEGORY_BY_ID).optional(), password: z.string().min(1).max(128).optional() }),
])

function sizeShare(species: SpeciesId, value: number): number {
  const t = SPECIES_BY_ID[species]
  return (value - t.min) / Math.max(1e-6, t.max - t.min)
}

function plausible(species: SpeciesId, value: number, legendary: boolean): boolean {
  const t = SPECIES_BY_ID[species]
  const top = RECORD_BOOK_SEED[species][0].value * 1.05
  if (value > top) return false
  return legendary || value >= t.min * 0.95
}

const MONEY_ACTIONS = new Set(['fish', 'game', 'tick', 'buy', 'makeover'])

/**
 * The balance of the one wallet this member shares with Fox Plains and Fox Lake. The first time, the profile's own
 * cash moves into it (exactly once: the profile is claimed with a conditional save before the credit, and put back
 * if the credit fails). Returns null when the shared world can't be reached; an unmerged profile then keeps using
 * its own cash.
 */
async function sharedBalance(env: Env, user: { id: string; username: string }, profile: Profile, updatedAt: number): Promise<{ balance: number | null; updatedAt: number }> {
  if (profile.walletMerged) {
    const read = await adjustSharedWallet(env, user, 0)
    return { balance: read.ok ? read.balance : null, updatedAt }
  }
  const cash = profile.cash
  const now = Math.max(Date.now(), updatedAt + 1)
  const claimed: Profile = { ...profile, cash: 0, walletMerged: true }
  if (!await saveRackreelProfileIfUnchanged(env, user.id, claimed, updatedAt, now)) {
    const fresh = await loadRackreelProfile(env, user.id, user.username)
    Object.assign(profile, fresh.profile)
    if (!profile.walletMerged) return { balance: null, updatedAt: fresh.updatedAt }
    const read = await adjustSharedWallet(env, user, 0)
    return { balance: read.ok ? read.balance : null, updatedAt: fresh.updatedAt }
  }
  const moved = await adjustSharedWallet(env, user, cash)
  if (!moved.ok) {
    await saveRackreelProfile(env, user.id, user.username, profile, now + 1)
    return { balance: null, updatedAt: now + 1 }
  }
  profile.cash = 0
  profile.walletMerged = true
  return { balance: moved.balance, updatedAt: now }
}

export async function rackreel(request: Request, env: Env) {
  await ensureRackreelTables(env)
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams
    if (params.has('records')) return json({ records: await loadRecordBoard(env) })
    const category = params.get('board')
    if (category !== null) {
      if (!(category in CATEGORY_BY_ID)) throw new HttpError(400, 'Unknown record board.')
      const viewer = await currentUser(request, env)
      return json(await loadCategoryBoard(env, category, viewer?.id ?? null))
    }
    const user = await currentUser(request, env)
    if (!user) return json({ signedIn: false })
    const loaded = await loadRackreelProfile(env, user.id, user.username)
    const { balance } = await sharedBalance(env, user, loaded.profile, loaded.updatedAt)
    const profile = loaded.profile
    return json({ signedIn: true, username: user.username, profile: { ...profile, cash: balance ?? (profile.walletMerged ? 0 : profile.cash) }, wallet: profile.walletMerged ? (balance === null ? 'unavailable' : 'shared') : 'own' })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save your cash and gear.')
  const input = actions.parse(await readJson(request, 2000))
  const now = Date.now()
  if (input.action === 'reset-records') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    await resetRecordBoard(env, input.category)
    return json({ reset: true, records: {} })
  }
  const loaded = await loadRackreelProfile(env, user.id, user.username)
  const profile = loaded.profile
  const shared = await sharedBalance(env, user, profile, loaded.updatedAt)
  const updatedAt = shared.updatedAt
  const merged = profile.walletMerged === true
  if (merged && shared.balance === null && MONEY_ACTIONS.has(input.action)) throw new HttpError(503, 'Your wallet is shared with Fox Plains, which can\'t be reached right now. Try again in a moment.')
  const before = merged ? (shared.balance ?? 0) : profile.cash
  if (merged) profile.cash = before
  let paid = 0
  let completed: { id: string; text: string; reward: number }[] = []
  let records: { board: Record<string, unknown>; placed: Record<string, number> } | null = null
  if (input.action === 'fish' || input.action === 'game') {
    const template = SPECIES_BY_ID[input.species]
    if (template.kind !== (input.action === 'fish' ? 'fish' : 'game')) throw new HttpError(400, 'That species does not belong there.')
    const doe = input.action === 'game' && input.doe
    if (!doe && !plausible(input.species, input.value, input.legendary)) throw new HttpError(400, 'That size is not possible here.')
    const sizeClass = classify(input.species, input.value)
    const legendary = !doe && (sizeClass === 'near-record' || sizeClass === 'record')
    const trophy = !doe && (legendary || input.value >= template.trophyAt)
    const event: GameEvent = input.action === 'fish'
      ? { type: 'fish', species: input.species, trophy, boat: input.boat, legendary }
      : { type: 'game', species: input.species, doe, stand: input.stand, trophy, legendary }
    const last = input.action === 'fish' ? profile.lastFishAt : profile.lastGameAt
    const accepted = now - last >= eventCooldown(input.action, input.species)
    const result = applyEvent(profile, event, doe ? 0 : sizeShare(input.species, input.value), now)
    paid = result.paid
    completed = result.completed
    if (accepted && !doe) records = await saveRecords(env, user, input.species, input.value, input.seed, now)
  } else if (input.action === 'tick') {
    paid = applyPlaytime(profile, (now - updatedAt) / 60000)
  } else if (input.action === 'create-character') {
    if (profile.verified) throw new HttpError(400, 'Your character is already made. Change clothes at the cabin armoire.')
    const error = createCharacter(profile, input.look, input.appearance)
    if (error) throw new HttpError(400, error)
  } else if (input.action === 'makeover') {
    const error = makeover(profile, input.appearance)
    if (error) throw new HttpError(400, error)
  } else if (input.action === 'buy') {
    if (!ITEM_BY_ID[input.item]) throw new HttpError(400, 'That item is not in the catalog.')
    const error = purchase(profile, input.item)
    if (error) throw new HttpError(400, error)
  } else {
    const error = equip(profile, input.slot as Slot, input.item)
    if (error) throw new HttpError(400, error)
  }
  let balance = profile.cash
  if (merged) {
    const delta = profile.cash - before
    if (delta !== 0) {
      const applied = await adjustSharedWallet(env, user, delta)
      if (!applied.ok) throw new HttpError(applied.reason === 'refused' ? 400 : 503, applied.reason === 'refused' ? 'Not enough cash.' : 'Your shared wallet can\'t be reached right now. Try again in a moment.')
      balance = applied.balance
    } else balance = before
    profile.cash = 0
  }
  await saveRackreelProfile(env, user.id, user.username, profile, now)
  return json({ profile: { ...profile, cash: balance }, paid, completed, wallet: merged ? 'shared' : 'own', ...(records ? { records: records.board, placed: records.placed } : {}) })
}
