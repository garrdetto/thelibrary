import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser } from '../auth.js'
import { adjustFoxLakeWallet, type WalletOwner } from '../shared-wallet.js'
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

const GUEST_HEADER = 'x-foxlake-guest'

/** The player the cage pays: a signed-in member, or a guest by this browser's Fox Lake town key. */
type Player = { owner: WalletOwner; id: string; member: boolean }

async function playerOf(request: Request, env: Env): Promise<Player | null> {
  const user = await currentUser(request, env)
  if (user) return { owner: { member: user }, id: `member:${user.id}`, member: true }
  const guest = request.headers.get(GUEST_HEADER) ?? ''
  return /^[A-Za-z0-9]{12,64}$/.test(guest) ? { owner: { guest }, id: `guest:${guest}`, member: false } : null
}

function walletError(reason: 'refused' | 'unavailable' | 'missing'): HttpError {
  if (reason === 'refused') return new HttpError(400, 'Not enough money for that.')
  if (reason === 'missing') return new HttpError(400, 'Walk into town first: your Fox Lake money lives there.')
  return new HttpError(503, 'The cage can\'t reach your wallet right now. Try again in a moment.')
}

async function debit(env: Env, player: Player, amount: number): Promise<number> {
  const r = await adjustFoxLakeWallet(env, player.owner, -amount)
  if (!r.ok) throw walletError(r.reason)
  return r.balance
}

async function credit(env: Env, player: Player, amount: number): Promise<number> {
  const r = await adjustFoxLakeWallet(env, player.owner, amount)
  if (!r.ok) throw new HttpError(503, 'The cage can\'t reach your wallet right now. Your win is safe; try again in a moment.')
  return r.balance
}

const settled = (t: Table): boolean => t.phase === 'settled'

async function readBalance(env: Env, player: Player): Promise<number | null> {
  const r = await adjustFoxLakeWallet(env, player.owner, 0)
  return r.ok ? r.balance : null
}

async function loadTable(env: Env, player: Player): Promise<Table | null> {
  const row = await env.DB.prepare('SELECT data FROM casino_tables WHERE user_id = ?').bind(player.id).first<{ data: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.data) as Table
  } catch {
    return null
  }
}

async function saveTable(env: Env, player: Player, table: Table): Promise<void> {
  await env.DB.prepare('INSERT INTO casino_tables (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(player.id, JSON.stringify(table), Date.now()).run()
}

/**
 * Fox Lake's casino. Spins and hands are decided here with a cryptographic RNG
 * and paid from the player's Fox Lake money (what their town jobs and the lake
 * country earn): stake taken first, winnings paid after. Signed-in players use
 * their account's; guests use their town cash, by this browser's town key.
 */
export async function casino(request: Request, env: Env) {
  if (request.method === 'GET') {
    const player = await playerOf(request, env)
    const balance = player ? await readBalance(env, player) : null
    let table = null
    if (player) {
      await ensureTables(env)
      const t = await loadTable(env, player)
      if (t && t.phase === 'player') table = publicView(t)
    }
    return json({ signedIn: Boolean(player?.member), balance, machines: MACHINES.map((m) => ({ id: m.id, name: m.name })), bets: BET_STEPS, blackjackBets: BLACKJACK_BETS, beerPrice: BAR.beerPrice, table })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const player = await playerOf(request, env)
  if (!player) throw new HttpError(400, 'Please reload the page and try again.')
  const input = actions.parse(await readJson(request, 1000))
  const rng = cryptoRng()
  if (input.action === 'drink') {
    const balance = await debit(env, player, BAR.beerPrice)
    return json({ balance })
  }
  if (input.action === 'spin') {
    const def = MACHINE_BY_ID[input.machine]
    if (!def) throw new HttpError(400, 'That machine is out of order.')
    if (!(BET_STEPS as readonly number[]).includes(input.bet)) throw new HttpError(400, 'That bet is not offered.')
    await ensureTables(env)
    const stored = def.family === 'collect' ? await env.DB.prepare('SELECT data FROM casino_machine_state WHERE user_id = ? AND machine = ?').bind(player.id, def.id).first<{ data: string }>() : null
    let state: MachineState = {}
    try {
      state = stored ? (JSON.parse(stored.data) as MachineState) : {}
    } catch {
      state = {}
    }
    await debit(env, player, input.bet)
    const result = playSpin(def, input.bet, rng, state)
    if (def.family === 'collect') {
      await env.DB.prepare('INSERT INTO casino_machine_state (user_id, machine, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, machine) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
        .bind(player.id, def.id, JSON.stringify(result.state), Date.now()).run()
    }
    const balance = result.totalWin > 0 ? await credit(env, player, result.totalWin) : await readBalance(env, player)
    return json({ result, balance })
  }
  await ensureTables(env)
  if (input.action === 'bj-deal') {
    if (!(BLACKJACK_BETS as readonly number[]).includes(input.bet)) throw new HttpError(400, 'That bet is not offered at this table.')
    const prev = await loadTable(env, player)
    if (prev && prev.phase === 'player') throw new HttpError(400, 'Finish the hand in front of you first.')
    await debit(env, player, input.bet)
    const table = deal(input.bet, rng, prev?.shoe ?? null)
    let balance: number | null = null
    if (settled(table) && table.payout > 0) balance = await credit(env, player, table.payout)
    await saveTable(env, player, table)
    return json({ table: publicView(table), balance: balance ?? (await readBalance(env, player)) })
  }
  const table = await loadTable(env, player)
  if (!table || table.phase !== 'player') throw new HttpError(400, 'Place a bet to deal a new hand.')
  const before = structuredClone(table)
  const stake = act(table, input.act, rng)
  if (stake === null) throw new HttpError(400, 'You can\'t do that with this hand.')
  if (stake > 0) {
    try {
      await debit(env, player, stake)
    } catch (error) {
      await saveTable(env, player, before)
      throw error
    }
  }
  let balance: number | null = null
  if (settled(table) && table.payout > 0) balance = await credit(env, player, table.payout)
  await saveTable(env, player, table)
  return json({ table: publicView(table), balance: balance ?? (await readBalance(env, player)) })
}
