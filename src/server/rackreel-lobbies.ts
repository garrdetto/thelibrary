import type { Env } from './env.js'
import { sha256 } from './auth.js'

export const LOBBY_TTL_MS = 45_000
export const LOBBY_LIST_LIMIT = 20

export interface OpenLobby {
  code: string
  host: string
  players: number
}

let tablesReady: Promise<unknown> | null = null

export function ensureLobbyTable(env: Env) {
  tablesReady ??= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rackreel_lobbies (code TEXT PRIMARY KEY, key_hash TEXT NOT NULL, host TEXT NOT NULL, players INTEGER NOT NULL, updated_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS rackreel_lobbies_updated ON rackreel_lobbies (updated_at)'),
  ]).catch((error) => {
    tablesReady = null
    throw error
  })
  return tablesReady
}

export async function listLobbies(env: Env, now = Date.now()): Promise<OpenLobby[]> {
  await env.DB.prepare('DELETE FROM rackreel_lobbies WHERE updated_at < ?').bind(now - LOBBY_TTL_MS * 4).run()
  const rows = await env.DB.prepare('SELECT code, host, players FROM rackreel_lobbies WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT ?')
    .bind(now - LOBBY_TTL_MS, LOBBY_LIST_LIMIT).all<OpenLobby>()
  return rows.results.map((row) => ({ code: row.code, host: row.host, players: row.players }))
}

/** Lists or refreshes a lobby. Only the browser that first listed a code (it holds the key) can refresh or close it. */
export async function publishLobby(env: Env, code: string, key: string, host: string, players: number, now = Date.now()): Promise<boolean> {
  const keyHash = await sha256(key)
  const existing = await env.DB.prepare('SELECT key_hash, updated_at FROM rackreel_lobbies WHERE code = ?').bind(code).first<{ key_hash: string; updated_at: number }>()
  if (existing && existing.key_hash !== keyHash && existing.updated_at >= now - LOBBY_TTL_MS) return false
  await env.DB.prepare('INSERT INTO rackreel_lobbies (code, key_hash, host, players, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET key_hash = excluded.key_hash, host = excluded.host, players = excluded.players, updated_at = excluded.updated_at')
    .bind(code, keyHash, host, players, now).run()
  return true
}

export async function closeLobby(env: Env, code: string, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM rackreel_lobbies WHERE code = ? AND key_hash = ?').bind(code, await sha256(key)).run()
}
