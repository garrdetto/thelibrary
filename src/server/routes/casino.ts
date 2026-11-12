import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { adjustSharedWallet } from '../shared-wallet.js'
import { cryptoRng } from '../../../modules-src/foxlake/casino/math/rng'
import { MACHINE_BY_ID, MACHINES, playSpin, type MachineState } from '../../../modules-src/foxlake/casino/math/machines'
import { act, deal, publicView, type Table } from '../../../modules-src/foxlake/casino/math/blackjack'
import { BAR, BET_STEPS, BLACKJACK_BETS } from '../../../modules-src/foxlake/casino/CasinoLayout'

const TABLES = [
  'CREATE TABLE IF NOT EXISTS casino_tables (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS casino_machine_state (user_id TEXT NOT NULL, machine TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, machine))',
]
let ready: Promise<unknown> | null = null
function ensureTables(env: Env) {
  ready ??= env.DB.batch(TABLES.map((sql) => env.DB.prepare(sql))).catch((error) => {
    ready = null
    throw error
  })
  return ready
}

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('spin'), machine: z.string().max(40), bet: z.number().finite() }),
  z.object({ action: z.literal('bj-deal'), bet: z.number().finite() }),
  z.object({ action: z.literal('bj-act'), act: z.enum(['hit', 'stand', 'double', 'split']) }),
  z.object({ action: z.literal('drink') }),
])

type User = { id: string; username: string }

async function debit(env: Env, user: User, amount: number): Promise<number> {
  const r = await adjustSharedWallet(env, user, -amount)
  if (!r.ok) throw new HttpError(r.reason === 'refused' ? 400 : 503, r.reason === 'refused' ? 'Not enough in your wallet for that.' : 'The cage can\'t reach your wallet right now. Try again in a moment.')
  return r.balance
}

async function credit(env: Env, user: User, amount: number): Promise<number> {
  const r = await adjustSharedWallet(env, user, amount)
  if (!r.ok) throw new HttpError(503, 'The cage can\'t reach your wallet right now. Your win is safe; try again in a moment.')
  return r.balance
}

const settled = (t: Table): boolean => t.phase === 'settled'

async function readBalance(env: Env, user: User): Promise<number | null> {
  const r = await adjustSharedWallet(env, user, 0)
  return r.ok ? r.balance : null
}

async function loadTable(env: Env, user: User): Promise<Table | null> {
  const row = await env.DB.prepare('SELECT data FROM casino_tables WHERE user_id = ?').bind(user.id).first<{ data: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.data) as Table
  } catch {
    return null
  }
}

async function saveTable(env: Env, user: User, table: Table): Promise<void> {
  await env.DB.prepare('INSERT INTO casino_tables (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(user.id, JSON.stringify(table), Date.now()).run()
}

/**
 * Fox Lake's casino. Spins and hands are decided here with a cryptographic RNG
 * and paid through the one wallet signed-in players share with Fox Plains and
 * Rack & Reel (stake taken first, winnings paid after). Guests play the same
 * machines for fun on the page, with play money.
 */
export async function casino(request: Request, env: Env) {
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    const balance = user ? await adjustSharedWallet(env, user, 0) : null
    let table = null
    if (user) {
      await ensureTables(env)
      const t = await loadTable(env, user)
      if (t && t.phase === 'player') table = publicView(t)
    }
    return json({ signedIn: Boolean(user), balance: balance?.ok ? balance.balance : null, machines: MACHINES.map((m) => ({ id: m.id, name: m.name })), bets: BET_STEPS, blackjackBets: BLACKJACK_BETS, beerPrice: BAR.beerPrice, table })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to play for your wallet. Guests play for fun.')
  const input = actions.parse(await readJson(request, 1000))
  const rng = cryptoRng()
  if (input.action === 'drink') {
    const balance = await debit(env, user, BAR.beerPrice)
    return json({ balance })
  }
  if (input.action === 'spin') {
    const def = MACHINE_BY_ID[input.machine]
    if (!def) throw new HttpError(400, 'That machine is out of order.')
    if (!(BET_STEPS as readonly number[]).includes(input.bet)) throw new HttpError(400, 'That bet is not offered.')
    await ensureTables(env)
    const stored = def.family === 'collect' ? await env.DB.prepare('SELECT data FROM casino_machine_state WHERE user_id = ? AND machine = ?').bind(user.id, def.id).first<{ data: string }>() : null
    let state: MachineState = {}
    try {
      state = stored ? (JSON.parse(stored.data) as MachineState) : {}
    } catch {
      state = {}
    }
    await debit(env, user, input.bet)
    const result = playSpin(def, input.bet, rng, state)
    if (def.family === 'collect') {
      await env.DB.prepare('INSERT INTO casino_machine_state (user_id, machine, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, machine) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
        .bind(user.id, def.id, JSON.stringify(result.state), Date.now()).run()
    }
    const balance = result.totalWin > 0 ? await credit(env, user, result.totalWin) : await readBalance(env, user)
    return json({ result, balance })
  }
  await ensureTables(env)
  if (input.action === 'bj-deal') {
    if (!(BLACKJACK_BETS as readonly number[]).includes(input.bet)) throw new HttpError(400, 'That bet is not offered at this table.')
    const prev = await loadTable(env, user)
    if (prev && prev.phase === 'player') throw new HttpError(400, 'Finish the hand in front of you first.')
    await debit(env, user, input.bet)
    const table = deal(input.bet, rng, prev?.shoe ?? null)
    let balance: number | null = null
    if (settled(table) && table.payout > 0) balance = await credit(env, user, table.payout)
    await saveTable(env, user, table)
    return json({ table: publicView(table), balance: balance ?? (await readBalance(env, user)) })
  }
  const table = await loadTable(env, user)
  if (!table || table.phase !== 'player') throw new HttpError(400, 'Place a bet to deal a new hand.')
  const before = structuredClone(table)
  const stake = act(table, input.act, rng)
  if (stake === null) throw new HttpError(400, 'You can\'t do that with this hand.')
  if (stake > 0) {
    try {
      await debit(env, user, stake)
    } catch (error) {
      await saveTable(env, user, before)
      throw error
    }
  }
  let balance: number | null = null
  if (settled(table) && table.payout > 0) balance = await credit(env, user, table.payout)
  await saveTable(env, user, table)
  return json({ table: publicView(table), balance: balance ?? (await readBalance(env, user)) })
}
