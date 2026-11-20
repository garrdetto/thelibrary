import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { loadVaultProfile, recordRound, saveVaultProfile, type VaultProfile } from '../sunvault.js'
import { SlotEngine, SpinError, type SpinResult } from '../../../modules-src/sunvault/engine/slotEngine'
import { BET_LEVELS_CENTS } from '../../../modules-src/sunvault/engine/paytable'
import { dailyStatus } from '../../../modules-src/sunvault/engine/daily'

const forces = z.enum(['respin', 'collect', 'bigwin', 'free', 'grand', 'pick', 'haywire'])

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('spin'), bet: z.number().int().refine((bet) => BET_LEVELS_CENTS.includes(bet)), force: forces.optional() }),
  z.object({ action: z.literal('collect') }),
])

function view(profile: VaultProfile, admin: boolean) {
  const state = profile.state
  return {
    signedIn: true,
    admin,
    snapshot: SlotEngine.fromState(state).snapshot(),
    daily: dailyStatus(profile.lastCollect, profile.streak, Date.now()),
    resume: state.mode === 'respin' && state.respinGrid ? { grid: state.respinGrid, held: state.held } : null,
  }
}

export async function sunvault(request: Request, env: Env) {
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ signedIn: false })
    return json(view(await loadVaultProfile(env, user.id), user.isAdmin))
  }
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to keep a Sun Vault balance.')
  const input = actions.parse(await readJson(request, 400))
  const profile = await loadVaultProfile(env, user.id)

  if (input.action === 'collect') {
    const status = dailyStatus(profile.lastCollect, profile.streak, Date.now())
    if (!status.canCollect) throw new HttpError(409, "Today's collect is already in the vault.")
    const engine = SlotEngine.fromState(profile.state)
    engine.addCredits(status.amount)
    const next: VaultProfile = { ...profile, state: engine.toState(), streak: status.nextStreak, lastCollect: status.today }
    await saveVaultProfile(env, next)
    return json({ collected: status.amount, streak: status.nextStreak, ...view(next, user.isAdmin) })
  }

  if (input.force && !user.isAdmin) return json({ error: 'Forced outcomes are only for the administrator. Turn on practice mode to force features.' }, 403)
  const engine = SlotEngine.fromState(profile.state)
  let result: SpinResult
  try {
    result = engine.spin(input.bet, input.force ?? null)
  } catch (error) {
    if (error instanceof SpinError) throw new HttpError(400, error.message)
    throw error
  }
  const startsRound = result.mode === 'base'
  const roundWin = (startsRound ? 0 : profile.roundWin) + result.stepWin
  const roundBet = startsRound ? result.bet : profile.roundBet
  const roundForced = (startsRound ? false : profile.roundForced) || Boolean(input.force)
  const finished = result.state.mode === 'base'
  await saveVaultProfile(env, {
    ...profile,
    state: engine.toState(),
    roundWin: finished ? 0 : roundWin,
    roundBet: finished ? 0 : roundBet,
    roundForced: finished ? false : roundForced,
  })
  const records = finished && !roundForced ? await recordRound(env, user, roundWin, roundBet) : []
  return json({ result, records, ranked: !roundForced })
}
