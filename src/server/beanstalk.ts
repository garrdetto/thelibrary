import type { Env } from './env.js'
import { HttpError } from './http.js'
import type { VaultProfile } from './sunvault.js'
import { BeanstalkEngine, type EngineState } from '../../modules-src/beanstalk/engine/engine'

export const BEANSTALK_BOARDS = { win: 'beanstalk-win', multiple: 'beanstalk-multiple', total: 'beanstalk-total' } as const

const TABLE = `CREATE TABLE IF NOT EXISTS beanstalk_profiles (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  round_win INTEGER NOT NULL DEFAULT 0,
  round_bet INTEGER NOT NULL DEFAULT 0,
  round_forced INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

let ready: Promise<unknown> | null = null
function ensureTable(env: Env) {
  ready ??= env.DB.prepare(TABLE).run().catch((error) => {
    ready = null
    throw error
  })
  return ready
}

export interface BeanstalkProfile {
  userId: string
  state: EngineState
  roundWin: number
  roundBet: number
  roundForced: boolean
  version: number
}

type Row = { state: string; round_win: number; round_bet: number; round_forced: number; version: number }

export async function loadBeanstalk(env: Env, userId: string): Promise<BeanstalkProfile> {
  await ensureTable(env)
  const select = () => env.DB.prepare('SELECT state, round_win, round_bet, round_forced, version FROM beanstalk_profiles WHERE user_id = ?').bind(userId).first<Row>()
  let row = await select()
  if (!row) {
    const now = Date.now()
    await env.DB.prepare('INSERT INTO beanstalk_profiles (user_id, state, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING')
      .bind(userId, JSON.stringify(new BeanstalkEngine({ balance: 0 }).toState()), now, now).run()
    row = await select()
    if (!row) throw new HttpError(500, 'Beanstalk Bounty could not open your machine.')
  }
  return { userId, state: JSON.parse(row.state) as EngineState, roundWin: row.round_win, roundBet: row.round_bet, roundForced: row.round_forced === 1, version: row.version }
}

export async function saveBeanstalkAndWallet(env: Env, vault: VaultProfile, profile: BeanstalkProfile): Promise<void> {
  const now = Date.now()
  const [walletWrite, machineWrite] = await env.DB.batch([
    env.DB.prepare(`UPDATE sunvault_profiles SET state = ?, version = version + 1, updated_at = ?
      WHERE user_id = ? AND version = ? AND (SELECT version FROM beanstalk_profiles WHERE user_id = ?) = ?`)
      .bind(JSON.stringify(vault.state), now, vault.userId, vault.version, profile.userId, profile.version),
    env.DB.prepare(`UPDATE beanstalk_profiles SET state = ?, round_win = ?, round_bet = ?, round_forced = ?, version = version + 1, updated_at = ?
      WHERE user_id = ? AND version = ? AND (SELECT version FROM sunvault_profiles WHERE user_id = ?) = ?`)
      .bind(JSON.stringify(profile.state), profile.roundWin, profile.roundBet, profile.roundForced ? 1 : 0, now, profile.userId, profile.version, vault.userId, vault.version + 1),
  ]) as { meta: { changes: number } }[]
  if (!walletWrite.meta.changes || !machineWrite.meta.changes) throw new HttpError(409, 'Your vault balance changed in another tab. Reload this page to carry on.')
}
