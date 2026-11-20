import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { loadVaultProfile, recordRound, saveVaultProfile, type VaultProfile } from '../sunvault.js'
import { MODOLLAZ_BOARDS, loadDollaz, saveDollazAndWallet, type DollazProfile } from '../modollaz.js'
import { BET_LEVELS_CENTS, DollazGame, SpinError, type Round } from '../../../modules-src/modollaz/engine/game'
import { SlotEngine } from '../../../modules-src/sunvault/engine/slotEngine'
import { dailyStatus } from '../../../modules-src/sunvault/engine/daily'

const forces = z.enum(['collect', 'free', 'pick', 'bigwin'])

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('spin'), bet: z.number().int().refine((bet) => BET_LEVELS_CENTS.includes(bet)), force: forces.optional() }),
  z.object({ action: z.literal('collect') }),
])

function machine(vault: VaultProfile, profile: DollazProfile) {
  const game = DollazGame.fromState(profile.state)
  game.setBalance(vault.state.balance)
  return game
}

function view(vault: VaultProfile, profile: DollazProfile, admin: boolean) {
  return {
    signedIn: true,
    admin,
    snapshot: machine(vault, profile).snapshot(),
    daily: dailyStatus(vault.lastCollect, vault.streak, Date.now()),
  }
}

export async function modollaz(request: Request, env: Env) {
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ signedIn: false })
    const vault = await loadVaultProfile(env, user.id)
    return json(view(vault, await loadDollaz(env, user.id), user.isAdmin))
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to spin on your vault balance.')
  const input = actions.parse(await readJson(request, 400))
  const vault = await loadVaultProfile(env, user.id)
  const profile = await loadDollaz(env, user.id)

  if (input.action === 'collect') {
    const status = dailyStatus(vault.lastCollect, vault.streak, Date.now())
    if (!status.canCollect) throw new HttpError(409, "Today's collect is already in the vault.")
    const wallet = SlotEngine.fromState(vault.state)
    wallet.addCredits(status.amount)
    const next: VaultProfile = { ...vault, state: wallet.toState(), streak: status.nextStreak, lastCollect: status.today }
    await saveVaultProfile(env, next)
    return json({ collected: status.amount, streak: status.nextStreak, ...view(next, profile, user.isAdmin) })
  }

  if (input.force && !user.isAdmin) return json({ error: 'Forced outcomes are only for the administrator. Turn on practice mode to force features.' }, 403)
  const game = machine(vault, profile)
  let round: Round
  try {
    round = game.spin(input.bet, input.force ?? null)
  } catch (error) {
    if (error instanceof SpinError) throw new HttpError(400, error.message)
    throw error
  }
  const state = game.toState()
  await saveDollazAndWallet(env, { ...vault, state: { ...vault.state, balance: state.balance } }, { ...profile, state: { ...state, balance: 0 } })
  const ranked = !input.force
  const records = ranked ? await recordRound(env, user, round.win, round.bet, MODOLLAZ_BOARDS) : []
  return json({ round, records, ranked })
}
