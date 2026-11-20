import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { loadVaultProfile, recordRound, saveVaultProfile, type VaultProfile } from '../sunvault.js'
import { BEANSTALK_BOARDS, loadBeanstalk, saveBeanstalkAndWallet, type BeanstalkProfile } from '../beanstalk.js'
import { BeanstalkEngine, SpinError, type SpinResult } from '../../../modules-src/beanstalk/engine/engine'
import { BET_LEVELS_CENTS } from '../../../modules-src/beanstalk/engine/paytable'
import { SlotEngine } from '../../../modules-src/sunvault/engine/slotEngine'
import { dailyStatus } from '../../../modules-src/sunvault/engine/daily'

const forces = z.enum(['free', 'grow', 'bigwin', 'haywire'])

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('spin'), bet: z.number().int().refine((bet) => BET_LEVELS_CENTS.includes(bet)), force: forces.optional() }),
  z.object({ action: z.literal('collect') }),
])

function machine(vault: VaultProfile, profile: BeanstalkProfile) {
  const engine = BeanstalkEngine.fromState(profile.state)
  engine.setBalance(vault.state.balance)
  return engine
}

function view(vault: VaultProfile, profile: BeanstalkProfile, admin: boolean) {
  const engine = machine(vault, profile)
  return {
    signedIn: true,
    admin,
    snapshot: engine.snapshot(),
    sticky: engine.stickyGrid(),
    daily: dailyStatus(vault.lastCollect, vault.streak, Date.now()),
  }
}

export async function beanstalk(request: Request, env: Env) {
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ signedIn: false })
    const vault = await loadVaultProfile(env, user.id)
    return json(view(vault, await loadBeanstalk(env, user.id), user.isAdmin))
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to spin on your vault balance.')
  const input = actions.parse(await readJson(request, 400))
  const vault = await loadVaultProfile(env, user.id)
  const profile = await loadBeanstalk(env, user.id)

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
  const engine = machine(vault, profile)
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
  const state = engine.toState()
  await saveBeanstalkAndWallet(env, { ...vault, state: { ...vault.state, balance: state.balance } }, {
    ...profile,
    state: { ...state, balance: 0 },
    roundWin: finished ? 0 : roundWin,
    roundBet: finished ? 0 : roundBet,
    roundForced: finished ? false : roundForced,
  })
  const records = finished && !roundForced ? await recordRound(env, user, roundWin, roundBet, BEANSTALK_BOARDS) : []
  return json({ result, records, ranked: !roundForced })
}
