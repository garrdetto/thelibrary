import type { Env } from './env.js'
import { parseStored } from './http.js'
import { newLotState, sanitizeLotState, sanitizeShell, shellOf, type LotShell, type LotState, type NewSim } from '../../modules-src/hood/shared/Lot'
import { LOTS_PER_STREET, MAX_STREETS } from '../../modules-src/hood/shared/Street'
import { SERVICE_KINDS, type ServiceKind } from '../../modules-src/hood/shared/Jobs'
import { REQUEST_WINDOW_MS, type PlayerWorker, type TownRequest } from '../../modules-src/hood/shared/TownSim'

/** A lot shows as home only while its Durable Object has touched the row recently. */
export const HOME_FRESH_MS = 3 * 60 * 1000

let tablesReady: Promise<unknown> | null = null

export function ensureHoodTables(env: Env) {
  tablesReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hood_lots (
      street INTEGER NOT NULL, lot INTEGER NOT NULL, owner_id TEXT NOT NULL UNIQUE, owner_name TEXT NOT NULL,
      state TEXT NOT NULL, shell TEXT NOT NULL, home INTEGER NOT NULL DEFAULT 0, visitors INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL, PRIMARY KEY (street, lot))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hood_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, street INTEGER NOT NULL, lot INTEGER NOT NULL, kind TEXT NOT NULL, by_name TEXT NOT NULL, at INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS hood_requests_street_at ON hood_requests (street, at)'),
  ]).catch(error => {
    tablesReady = null
    throw error
  })
  return tablesReady
}

type LotRow = { street: number; lot: number; owner_id: string; owner_name: string; state: string; shell: string; home: number; visitors: number; updated_at: number }

export async function loadLot(env: Env, street: number, lot: number): Promise<LotState | null> {
  await ensureHoodTables(env)
  const row = await env.DB.prepare('SELECT state FROM hood_lots WHERE street = ? AND lot = ?').bind(street, lot).first<{ state: string }>()
  if (!row) return null
  return sanitizeLotState(parseStored<unknown>(row.state, null), street, lot)
}

export async function lotOwner(env: Env, street: number, lot: number): Promise<string | null> {
  await ensureHoodTables(env)
  const row = await env.DB.prepare('SELECT owner_id FROM hood_lots WHERE street = ? AND lot = ?').bind(street, lot).first<{ owner_id: string }>()
  return row?.owner_id ?? null
}

export async function saveLot(env: Env, state: LotState, home: boolean, visitors: number): Promise<void> {
  await ensureHoodTables(env)
  await env.DB.prepare('UPDATE hood_lots SET state = ?, shell = ?, home = ?, visitors = ?, updated_at = ? WHERE street = ? AND lot = ? AND owner_id = ?')
    .bind(JSON.stringify(state), JSON.stringify(shellOf(state)), home ? 1 : 0, visitors, Date.now(), state.street, state.lot, state.ownerId)
    .run()
}

export async function homeOf(env: Env, userId: string): Promise<{ street: number; lot: number } | null> {
  await ensureHoodTables(env)
  const row = await env.DB.prepare('SELECT street, lot FROM hood_lots WHERE owner_id = ?').bind(userId).first<{ street: number; lot: number }>()
  return row ? { street: Number(row.street), lot: Number(row.lot) } : null
}

export interface StreetLot {
  lot: number
  owner: string
  home: boolean
  visitors: number
  shell: LotShell
  mine: boolean
}

export async function streetLots(env: Env, street: number, userId: string | null): Promise<(StreetLot | null)[]> {
  await ensureHoodTables(env)
  const { results } = await env.DB.prepare('SELECT lot, owner_id, owner_name, shell, home, visitors, updated_at FROM hood_lots WHERE street = ?').bind(street).all<Omit<LotRow, 'street' | 'state'>>()
  const lots: (StreetLot | null)[] = Array.from({ length: LOTS_PER_STREET }, () => null)
  const fresh = Date.now() - HOME_FRESH_MS
  const now = Date.now()
  for (const row of results) {
    const index = Number(row.lot)
    if (index < 0 || index >= LOTS_PER_STREET) continue
    const live = Number(row.updated_at) > fresh
    const shell = sanitizeShell(parseStored<unknown>(row.shell, null))
    shell.workers = shell.workers.filter(w => w.until > now)
    lots[index] = {
      lot: index, owner: row.owner_name, home: live && Number(row.home) === 1, visitors: live ? Number(row.visitors) : 0,
      shell,
      mine: !!userId && row.owner_id === userId,
    }
  }
  return lots
}

/** Residents of a street who are on a shift in town right now. */
export async function streetWorkers(env: Env, street: number): Promise<PlayerWorker[]> {
  await ensureHoodTables(env)
  const { results } = await env.DB.prepare('SELECT lot, shell FROM hood_lots WHERE street = ?').bind(street).all<{ lot: number; shell: string }>()
  const now = Date.now()
  const out: PlayerWorker[] = []
  for (const row of results) {
    const shell = sanitizeShell(parseStored<unknown>(row.shell, null))
    for (const w of shell.workers) if (w.until > now) out.push({ name: w.name, look: w.look, job: w.job, level: w.level, lot: Number(row.lot), call: w.call })
  }
  return out
}

/** The street's service calls from the last hour. */
export async function townRequests(env: Env, street: number): Promise<TownRequest[]> {
  await ensureHoodTables(env)
  const since = Date.now() - REQUEST_WINDOW_MS
  const { results } = await env.DB.prepare('SELECT lot, kind, by_name, at FROM hood_requests WHERE street = ? AND at > ? ORDER BY at LIMIT 80').bind(street, since).all<{ lot: number; kind: string; by_name: string; at: number }>()
  return results
    .filter(r => (SERVICE_KINDS as readonly string[]).includes(r.kind))
    .map(r => ({ lot: Number(r.lot), kind: r.kind as ServiceKind, at: Number(r.at), by: r.by_name }))
}

export async function addTownRequest(env: Env, street: number, request: TownRequest): Promise<void> {
  await ensureHoodTables(env)
  await env.DB.prepare('INSERT INTO hood_requests (street, lot, kind, by_name, at) VALUES (?, ?, ?, ?, ?)').bind(street, request.lot, request.kind, (request.by ?? '').slice(0, 40), request.at).run()
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM hood_requests WHERE at < ?').bind(Date.now() - 24 * 60 * 60 * 1000).run()
}

/** How many streets the neighborhood shows: every street with a household, plus one with room to move in. */
export async function streetCount(env: Env): Promise<{ streets: number; open: number }> {
  await ensureHoodTables(env)
  const { results } = await env.DB.prepare('SELECT street, COUNT(*) AS taken FROM hood_lots GROUP BY street ORDER BY street').all<{ street: number; taken: number }>()
  let open = 0
  const taken = new Map(results.map(r => [Number(r.street), Number(r.taken)]))
  while (open < MAX_STREETS - 1 && (taken.get(open) ?? 0) >= LOTS_PER_STREET) open++
  const last = results.length ? Math.max(...results.map(r => Number(r.street))) : 0
  return { streets: Math.min(MAX_STREETS, Math.max(last, open) + 1), open }
}

export type ClaimResult = { ok: true } | { ok: false; reason: 'taken' | 'has-home' }

export async function claimLot(env: Env, userId: string, username: string, street: number, lot: number, householdName: string, sims: NewSim[]): Promise<ClaimResult> {
  await ensureHoodTables(env)
  if (await homeOf(env, userId)) return { ok: false, reason: 'has-home' }
  const state = newLotState(street, lot, userId, username, householdName, sims)
  try {
    const result = await env.DB.prepare('INSERT INTO hood_lots (street, lot, owner_id, owner_name, state, shell, home, visitors, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?) ON CONFLICT(street, lot) DO NOTHING')
      .bind(street, lot, userId, username, JSON.stringify(state), JSON.stringify(shellOf(state)), Date.now())
      .run()
    if (!result.meta.changes) return { ok: false, reason: 'taken' }
    return { ok: true }
  } catch {
    return { ok: false, reason: (await homeOf(env, userId)) ? 'has-home' : 'taken' }
  }
}
