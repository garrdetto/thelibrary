import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { ensureRackreelTables, loadRackreelProfile, saveRackreelProfile } from '../rackreel.js'
import { ITEM_BY_ID, applyEvent, applyPlaytime, equip, purchase } from '../../../modules-src/rackreel/shared/Economy'
import type { GameEvent, Slot } from '../../../modules-src/rackreel/shared/Economy'
import { RECORD_BOOK_SEED, SPECIES_BY_ID } from '../../../modules-src/rackreel/systems/LootTableManager'
import type { SpeciesId } from '../../../modules-src/rackreel/systems/LootTableManager'

const slots = ['rod', 'reel', 'line', 'bait', 'rifle', 'scope', 'call', 'scent', 'motor', 'utvKit', 'jacket', 'vest', 'cap', 'pants', 'pack'] as const
const speciesIds = Object.keys(SPECIES_BY_ID) as [SpeciesId, ...SpeciesId[]]

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fish'), species: z.enum(speciesIds), value: z.number().finite().positive(), legendary: z.boolean(), boat: z.boolean() }),
  z.object({ action: z.literal('game'), species: z.enum(speciesIds), value: z.number().finite().min(0), legendary: z.boolean(), doe: z.boolean(), stand: z.boolean() }),
  z.object({ action: z.literal('tick') }),
  z.object({ action: z.literal('buy'), item: z.string().min(1).max(40) }),
  z.object({ action: z.literal('equip'), slot: z.enum(slots), item: z.string().max(40) }),
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

export async function rackreel(request: Request, env: Env) {
  await ensureRackreelTables(env)
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ signedIn: false })
    const { profile } = await loadRackreelProfile(env, user.id, user.username)
    return json({ signedIn: true, username: user.username, profile })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save your cash and gear.')
  const input = actions.parse(await readJson(request, 2000))
  const now = Date.now()
  const { profile, updatedAt } = await loadRackreelProfile(env, user.id, user.username)
  let paid = 0
  let completed: { id: string; text: string; reward: number }[] = []
  if (input.action === 'fish' || input.action === 'game') {
    const template = SPECIES_BY_ID[input.species]
    if (template.kind !== (input.action === 'fish' ? 'fish' : 'game')) throw new HttpError(400, 'That species does not belong there.')
    const doe = input.action === 'game' && input.doe
    if (!doe && !plausible(input.species, input.value, input.legendary)) throw new HttpError(400, 'That size is not possible here.')
    const trophy = !doe && (input.legendary || input.value >= template.trophyAt)
    const event: GameEvent = input.action === 'fish'
      ? { type: 'fish', species: input.species, trophy, boat: input.boat, legendary: input.legendary }
      : { type: 'game', species: input.species, doe, stand: input.stand, trophy, legendary: !doe && input.legendary }
    const result = applyEvent(profile, event, doe ? 0 : sizeShare(input.species, input.value), now)
    paid = result.paid
    completed = result.completed
  } else if (input.action === 'tick') {
    paid = applyPlaytime(profile, (now - updatedAt) / 60000)
  } else if (input.action === 'buy') {
    if (!ITEM_BY_ID[input.item]) throw new HttpError(400, 'That item is not in the catalog.')
    const error = purchase(profile, input.item)
    if (error) throw new HttpError(400, error)
  } else {
    const error = equip(profile, input.slot as Slot, input.item)
    if (error) throw new HttpError(400, error)
  }
  await saveRackreelProfile(env, user.id, user.username, profile, now)
  return json({ profile, paid, completed })
}
