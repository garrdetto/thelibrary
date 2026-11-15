import type { TrackerDatabase } from './db.js'
import { recordHeartbeat } from './db.js'
import { buildRadarTokens, loadModelState } from './radar-query.js'
import { radarSettings } from './settings-store.js'
import type { RadarToken } from '../../src/lib/axiom-radar-types.js'
import type { RadarSettings } from '../../src/lib/axiom-radar-settings.js'

/**
 * The Axiom watchlist the Bridge keeps for the Radar: coins that reach the chosen score are starred on Axiom (the Bridge
 * clicks the star on the coin's page) and un-starred when they fall below the remove level, leave the Radar or hit a holder
 * limit. Only coins the Radar starred itself are ever un-starred; the person's own stars are left alone.
 */

const schema = `
CREATE TABLE IF NOT EXISTS axiom_watchlist (
  mint TEXT PRIMARY KEY,
  pair_address TEXT NOT NULL,
  symbol TEXT NOT NULL,
  state TEXT NOT NULL,
  reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

/** Failed star clicks before a coin is given up on. */
export const maxAttempts = 3
/** A coin that left the Radar this long ago is taken off the watchlist. */
export const goneAfterMs = 3 * 60_000

export type WatchRow = { mint: string; pair_address: string; symbol: string; state: 'adding' | 'on' | 'removing'; reason: string | null; attempts: number; added_at: number; updated_at: number }
export type WatchItem = { mint: string; pairAddress: string; symbol: string; reason: string }
type WatchSettings = RadarSettings['axiomWatchlist']

export function watchScore(token: RadarToken, score: WatchSettings['score']) {
  const dex = token.dex?.score ?? null
  if (score === 'dex') return dex
  if (score === 'blend') return dex === null ? token.score : Math.round((token.score + dex) / 2)
  return token.score
}

const scoreName = { runner: 'runner score', dex: 'DexScreener score', blend: 'blended score' } as const

/**
 * What should change, from the coins on the Radar now and the rows the Radar already starred. `add` are new coins to star
 * (best first, up to the free slots), `remove` are starred coins to take off with the reason.
 */
export function planWatchlist(tokens: RadarToken[], rows: WatchRow[], settings: WatchSettings, now: number) {
  const byMint = new Map(tokens.map(token => [token.mint, token]))
  const remove: Array<{ row: WatchRow; reason: string }> = []
  const kept: WatchRow[] = []
  for (const row of rows) {
    if (row.state === 'removing') { remove.push({ row, reason: row.reason ?? 'no longer worth watching' }); continue }
    const token = byMint.get(row.mint)
    const value = token ? watchScore(token, settings.score) : null
    const why = !settings.enabled ? 'the Radar watchlist was turned off'
      : !token ? (now - row.updated_at > goneAfterMs ? 'left the Radar' : null)
      : token.holderRisk?.blocked ? `holder limit: ${token.holderRisk.reasons[0] ?? 'over a limit'}`
      : token.botClimb ? 'bot-driven climb'
      : value !== null && value < settings.removeAt ? `${scoreName[settings.score]} fell to ${value}, under ${settings.removeAt}`
      : null
    if (why) remove.push({ row, reason: why })
    else kept.push(row)
  }
  const watched = new Set(rows.map(row => row.mint))
  const slots = settings.enabled ? Math.max(0, settings.maxCoins - kept.length) : 0
  const add: WatchItem[] = tokens
    .map(token => ({ token, value: watchScore(token, settings.score) }))
    .filter(({ token, value }) => !watched.has(token.mint) && value !== null && value >= settings.addAt && !token.holderRisk?.blocked && !token.botClimb && token.pairAddress)
    .sort((first, second) => (second.value as number) - (first.value as number))
    .slice(0, slots)
    .map(({ token, value }) => ({ mint: token.mint, pairAddress: token.pairAddress, symbol: token.symbol, reason: `${scoreName[settings.score]} ${value}` }))
  return { add, remove }
}

let ready = false
function rowsOf(database: TrackerDatabase) {
  if (!ready) { database.exec(schema); ready = true }
  return database.prepare('SELECT * FROM axiom_watchlist ORDER BY added_at ASC').all() as WatchRow[]
}

/** The coins the Bridge should star and un-star now. Rows to remove are marked so the next visit takes them off. */
export function watchlistStatus(database: TrackerDatabase, now = Date.now()) {
  const settings = radarSettings().axiomWatchlist
  const rows = rowsOf(database)
  const tokens = buildRadarTokens(database, loadModelState(database).weights, now)
  const plan = planWatchlist(tokens, rows, settings, now)
  const mark = database.prepare("UPDATE axiom_watchlist SET state = 'removing', reason = ?, updated_at = ? WHERE mint = ? AND state <> 'removing'")
  for (const { row, reason } of plan.remove) mark.run(reason, now, row.mint)
  const keep = database.prepare('UPDATE axiom_watchlist SET updated_at = ? WHERE mint = ?')
  for (const row of rows) if (tokens.some(token => token.mint === row.mint) && !plan.remove.some(item => item.row.mint === row.mint)) keep.run(now, row.mint)
  const adding = rows.filter(row => row.state === 'adding' && !plan.remove.some(item => item.row.mint === row.mint)).map(row => ({ mint: row.mint, pairAddress: row.pair_address, symbol: row.symbol, reason: row.reason ?? '' }))
  const on = rows.filter(row => row.state === 'on' && !plan.remove.some(item => item.row.mint === row.mint))
  recordHeartbeat(database, 'axiom-watchlist', settings.enabled || rows.length ? 'ok' : 'disabled', settings.enabled
    ? `${on.length} coin${on.length === 1 ? '' : 's'} on the Axiom watchlist${adding.length + plan.add.length ? `, ${adding.length + plan.add.length} to add` : ''}${plan.remove.length ? `, ${plan.remove.length} to remove` : ''}`
    : rows.length ? `Turned off: removing ${rows.length} coin${rows.length === 1 ? '' : 's'}` : 'Turned off')
  return {
    enabled: settings.enabled,
    add: [...adding, ...plan.add],
    remove: plan.remove.map(({ row, reason }) => ({ mint: row.mint, pairAddress: row.pair_address, symbol: row.symbol, reason })),
  }
}

/** What the Bridge did on a coin's page: starred it, un-starred it, or could not. */
export function watchlistResult(database: TrackerDatabase, result: { mint: string; pairAddress: string; symbol: string; action: 'add' | 'remove'; ok: boolean; reason?: string }, now = Date.now()) {
  rowsOf(database)
  const row = database.prepare('SELECT * FROM axiom_watchlist WHERE mint = ?').get(result.mint) as WatchRow | undefined
  if (result.action === 'add') {
    if (result.ok) {
      database.prepare(`INSERT INTO axiom_watchlist (mint, pair_address, symbol, state, reason, attempts, added_at, updated_at) VALUES (?, ?, ?, 'on', ?, 0, ?, ?)
        ON CONFLICT (mint) DO UPDATE SET state = CASE WHEN axiom_watchlist.state = 'removing' THEN 'removing' ELSE 'on' END, attempts = 0, updated_at = excluded.updated_at`).run(result.mint, result.pairAddress, result.symbol.slice(0, 24), result.reason ?? null, now, now)
      return
    }
    const attempts = (row?.attempts ?? 0) + 1
    if (attempts >= maxAttempts) database.prepare('DELETE FROM axiom_watchlist WHERE mint = ?').run(result.mint)
    else database.prepare(`INSERT INTO axiom_watchlist (mint, pair_address, symbol, state, reason, attempts, added_at, updated_at) VALUES (?, ?, ?, 'adding', ?, ?, ?, ?)
      ON CONFLICT (mint) DO UPDATE SET attempts = excluded.attempts, updated_at = excluded.updated_at`).run(result.mint, result.pairAddress, result.symbol.slice(0, 24), result.reason ?? null, attempts, now, now)
    return
  }
  if (!row) return
  if (result.ok || row.attempts + 1 >= maxAttempts) database.prepare('DELETE FROM axiom_watchlist WHERE mint = ?').run(result.mint)
  else database.prepare('UPDATE axiom_watchlist SET attempts = attempts + 1, updated_at = ? WHERE mint = ?').run(now, result.mint)
}
