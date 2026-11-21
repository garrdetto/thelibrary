import type { Env } from './env.js'
import { HttpError } from './http.js'
import type { VaultProfile } from './sunvault.js'
import { DollazGame, type GameState } from '../../modules-src/modollaz/engine/game'

export const MODOLLAZ_BOARDS = { win: 'modollaz-win', multiple: 'modollaz-multiple', total: 'modollaz-total' } as const

const TABLE = `CREATE TABLE IF NOT EXISTS modollaz_profiles (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
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

export interface DollazProfile {
  userId: string
  state: GameState
  version: number
}

type Row = { state: string; version: number }

export async function loadDollaz(env: Env, userId: string): Promise<DollazProfile> {
  await ensureTable(env)
  const select = () => env.DB.prepare('SELECT state, version FROM modollaz_profiles WHERE user_id = ?').bind(userId).first<Row>()
  let row = await select()
  if (!row) {
    const now = Date.now()
    await env.DB.prepare('INSERT INTO modollaz_profiles (user_id, state, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING')
      .bind(userId, JSON.stringify(new DollazGame({ balance: 0 }).toState()), now, now).run()
    row = await select()
    if (!row) throw new HttpError(500, "Mo' Dollaz could not open your machine.")
  }
  return { userId, state: JSON.parse(row.state) as GameState, version: row.version }
}

export async function saveDollazAndWallet(env: Env, vault: VaultProfile, profile: DollazProfile): Promise<void> {
  const now = Date.now()
  const [walletWrite, machineWrite] = await env.DB.batch([
    env.DB.prepare(`UPDATE sunvault_profiles SET state = ?, version = version + 1, updated_at = ?
      WHERE user_id = ? AND version = ? AND (SELECT version FROM modollaz_profiles WHERE user_id = ?) = ?`)
      .bind(JSON.stringify(vault.state), now, vault.userId, vault.version, profile.userId, profile.version),
    env.DB.prepare(`UPDATE modollaz_profiles SET state = ?, version = version + 1, updated_at = ?
      WHERE user_id = ? AND version = ? AND (SELECT version FROM sunvault_profiles WHERE user_id = ?) = ?`)
      .bind(JSON.stringify(profile.state), now, profile.userId, profile.version, vault.userId, vault.version + 1),
  ]) as { meta: { changes: number } }[]
  if (!walletWrite.meta.changes || !machineWrite.meta.changes) throw new HttpError(409, 'Your vault balance changed in another tab. Reload this page to carry on.')
}
