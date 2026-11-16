import type { Env } from './env.js'
import { HttpError } from './http.js'
import { NOTICE_PLACES, saveWithKnockouts } from './score-notices.js'
import { SlotEngine, type EngineState } from '../../modules-src/sunvault/engine/slotEngine'
import { STARTING_BALANCE_CENTS } from '../../modules-src/sunvault/engine/paytable'

export const VAULT_BOARDS = { win: 'sunvault-win', multiple: 'sunvault-multiple', total: 'sunvault-total' } as const
export type VaultBoard = (typeof VAULT_BOARDS)[keyof typeof VAULT_BOARDS]

const TABLE = `CREATE TABLE IF NOT EXISTS sunvault_profiles (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  streak INTEGER NOT NULL DEFAULT 0,
  last_collect TEXT,
  round_win INTEGER NOT NULL DEFAULT 0,
  round_bet INTEGER NOT NULL DEFAULT 0,
  round_forced INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

let ready: Promise<unknown> | null = null
export function ensureVaultTable(env: Env) {
  ready ??= env.DB.prepare(TABLE).run().catch((error) => {
    ready = null
    throw error
  })
  return ready
}

export interface VaultProfile {
  userId: string
  state: EngineState
  streak: number
  lastCollect: string | null
  roundWin: number
  roundBet: number
  roundForced: boolean
  version: number
}

type ProfileRow = { state: string; streak: number; last_collect: string | null; round_win: number; round_bet: number; round_forced: number; version: number }

export async function loadVaultProfile(env: Env, userId: string): Promise<VaultProfile> {
  await ensureVaultTable(env)
  const select = () => env.DB.prepare('SELECT state, streak, last_collect, round_win, round_bet, round_forced, version FROM sunvault_profiles WHERE user_id = ?').bind(userId).first<ProfileRow>()
  let row = await select()
  if (!row) {
    const state = new SlotEngine({ balance: STARTING_BALANCE_CENTS }).toState()
    const now = Date.now()
    await env.DB.prepare('INSERT INTO sunvault_profiles (user_id, state, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING').bind(userId, JSON.stringify(state), now, now).run()
    row = await select()
    if (!row) throw new HttpError(500, 'Sun Vault could not open your balance.')
  }
  return {
    userId,
    state: JSON.parse(row.state) as EngineState,
    streak: row.streak,
    lastCollect: row.last_collect,
    roundWin: row.round_win,
    roundBet: row.round_bet,
    roundForced: row.round_forced === 1,
    version: row.version,
  }
}

export async function saveVaultProfile(env: Env, profile: VaultProfile): Promise<void> {
  const result = await env.DB.prepare(`UPDATE sunvault_profiles SET state = ?, streak = ?, last_collect = ?, round_win = ?, round_bet = ?, round_forced = ?, version = version + 1, updated_at = ?
    WHERE user_id = ? AND version = ?`)
    .bind(JSON.stringify(profile.state), profile.streak, profile.lastCollect, profile.roundWin, profile.roundBet, profile.roundForced ? 1 : 0, Date.now(), profile.userId, profile.version)
    .run()
  if (!result.meta.changes) throw new HttpError(409, 'Sun Vault is open in another tab. Reload this page to carry on.')
}

async function tenthPlace(env: Env, board: VaultBoard): Promise<number | null> {
  const row = await env.DB.prepare('SELECT value FROM module_scores WHERE module = ? ORDER BY value DESC, created_at ASC, id ASC LIMIT 1 OFFSET 9').bind(board).first<{ value: number }>()
  return row?.value ?? null
}

function topQuery(env: Env, board: VaultBoard) {
  return () => env.DB.prepare(`SELECT id, user_id FROM module_scores WHERE module = ? ORDER BY value DESC, created_at ASC, id ASC LIMIT ${NOTICE_PLACES}`).bind(board)
}

export async function recordRound(env: Env, user: { id: string; username: string }, roundWin: number, roundBet: number): Promise<VaultBoard[]> {
  if (roundWin <= 0 || roundBet <= 0) return []
  const now = Date.now()
  const placed: VaultBoard[] = []
  const multiple = Math.round((roundWin * 100) / roundBet)
  const ranked: readonly (readonly [VaultBoard, number])[] = [[VAULT_BOARDS.win, roundWin], [VAULT_BOARDS.multiple, multiple]]
  for (const [board, value] of ranked) {
    const cutoff = await tenthPlace(env, board)
    if (cutoff !== null && value <= cutoff) continue
    await saveWithKnockouts(env, { game: board, scorer: user, top: topQuery(env, board) }, () =>
      env.DB.prepare('INSERT INTO module_scores (id, user_id, username, module, value, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(`${user.id}:${crypto.randomUUID()}`, user.id, user.username, board, value, now)
        .run(),
    )
    placed.push(board)
  }
  await saveWithKnockouts(env, { game: VAULT_BOARDS.total, scorer: user, top: topQuery(env, VAULT_BOARDS.total) }, () =>
    env.DB.prepare(`INSERT INTO module_scores (id, user_id, username, module, value, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET value = module_scores.value + excluded.value, created_at = excluded.created_at, username = excluded.username`)
      .bind(`${user.id}:total`, user.id, user.username, VAULT_BOARDS.total, roundWin, now)
      .run(),
  )
  return placed
}
