import { z } from 'zod'
import type { TrackerDatabase } from './db.js'
import { mintForPair, readAxiomAnswer, saveHolderList, tradePaths } from './axiom-readers.js'
import { isSolanaAddress } from './runtime.js'

/**
 * Everything the Axiom pages fetch from Axiom's API and receive on their sockets, as the bridge (1.9+) forwards it: kept for a
 * few hours so new readers can be written from real answers, and every wallet in it is recorded per coin straight away.
 */

export const capturedApiSchema = z.object({ url: z.string().max(600), status: z.number().int().min(0).max(999), body: z.string().max(400_000), poll: z.literal(true).optional() }).strict()
export const capturedStreamSchema = z.object({ url: z.string().max(200), text: z.string().max(60_000) }).strict()

const schema = `
CREATE TABLE IF NOT EXISTS axiom_capture (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  pair TEXT,
  body TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS axiom_capture_path ON axiom_capture (kind, path, at);
CREATE TABLE IF NOT EXISTS axiom_wallets (
  pair TEXT NOT NULL,
  wallet TEXT NOT NULL,
  source TEXT NOT NULL,
  fields TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (pair, wallet, source)
);
CREATE INDEX IF NOT EXISTS axiom_wallets_wallet ON axiom_wallets (wallet);
`

/**
 * Only Axiom's public market answers about coins, traders and trades are kept. Anything about the signed-in person (settings,
 * balances, orders, keys, their own trades, friends, presence) is dropped here even if an older bridge sends it.
 */
export const marketPaths = new Set(['/transactions-feed', '/transactions-feed-trader-info', '/transactions-from-traders', '/trader-details-v2', '/sniper-transactions', '/token-info-v2', '/token-and-best-pair-info', '/token-stats', '/dev-tokens', '/dev-transfers', '/reused-image-tokens', '/similar-tokens', '/dex-paid', '/shareholder-claims', '/lighthouse', '/volume-overview', '/pool-state'])
const marketPrefix = /holder|top-?trader/i
export const isMarketPath = (path: string) => marketPaths.has(path) || marketPrefix.test(path)
const keepCaptureMs = 6 * 60 * 60_000
const maxCaptureRows = 20_000
const walletKey = /maker|wallet|owner|trader|signer|user|holder|buyer|seller|account|address|dev|creator|from|to$/i
const notWalletKey = /token|mint|pair|pool|program|curve|vault|quote|base|lp|market|signature|tx|hash|url|image|uri/i
const maxDepth = 7

export type WalletSighting = { wallet: string; key: string; fields: Record<string, string | number | boolean | null> }

function primitiveFields(object: Record<string, unknown>) {
  const fields: Record<string, string | number | boolean | null> = {}
  let count = 0
  for (const [key, value] of Object.entries(object)) {
    if (count >= 40) break
    if (value === null || typeof value === 'number' || typeof value === 'boolean') fields[key] = value
    else if (typeof value === 'string' && value.length <= 120) fields[key] = value
    else continue
    count += 1
  }
  return fields
}

/** Every object in an Axiom answer that names a wallet (a maker, holder, trader, dev...), with the numbers beside it. */
export function walletSightings(value: unknown, skip: Set<string>): WalletSighting[] {
  const found: WalletSighting[] = []
  const visit = (node: unknown, depth: number) => {
    if (depth > maxDepth || found.length >= 2_000 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    const object = node as Record<string, unknown>
    for (const [key, field] of Object.entries(object)) {
      if (isSolanaAddress(field) && !skip.has(field) && walletKey.test(key) && !notWalletKey.test(key)) {
        found.push({ wallet: field, key, fields: primitiveFields(object) })
      }
    }
    for (const field of Object.values(object)) if (field && typeof field === 'object') visit(field, depth + 1)
  }
  visit(value, 0)
  return found
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null
  try { return JSON.parse(trimmed) } catch { return null }
}

function pathOf(url: string) {
  try {
    const parsed = new URL(url)
    return { host: parsed.hostname, path: parsed.pathname.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, ':address'), pair: parsed.searchParams.get('pairAddress') ?? parsed.searchParams.get('pair') ?? parsed.searchParams.get('tokenAddress') ?? null }
  } catch {
    return { host: '', path: url.slice(0, 120), pair: null }
  }
}

export type CaptureStats = { polled: number; api: number; streams: number; wallets: number; trades: number; holderReads: number; holderLists: number; traderRows: number; tabVisits: number; holdersPaths: Map<string, number>; tradersPaths: Map<string, number>; paths: Map<string, number> }
export const captureStats: CaptureStats = { polled: 0, api: 0, streams: 0, wallets: 0, trades: 0, holderReads: 0, holderLists: 0, traderRows: 0, tabVisits: 0, holdersPaths: new Map(), tradersPaths: new Map(), paths: new Map() }

let prepared: TrackerDatabase | null = null
let lastPruneAt = 0
let lastPulseSampleAt = 0

function ensureSchema(database: TrackerDatabase) {
  if (prepared === database) return
  database.exec(schema)
  prepared = database
}

/** Stores one report's captured answers and records the wallets in them against the coin's pair address. */
export const capturedTabsSchema = z.object({
  holders: z.object({ paths: z.array(z.string().max(120)).max(40), rows: z.array(z.object({ wallet: z.string().refine(isSolanaAddress, 'Not a Solana address'), pct: z.number().min(0).max(100).nullable() }).strict()).max(150) }).strict().optional(),
  traders: z.object({ paths: z.array(z.string().max(120)).max(40) }).strict().optional(),
}).strict()

const holderListAt = new Map<string, number>()

/** What a coin page's Holders and Top Traders tabs loaded: the API addresses (for the heartbeat) and the holders drawn on the page, used when no API holders list arrived in the last minute. */
function storeTabs(database: TrackerDatabase, pair: string | null, tabs: z.infer<typeof capturedTabsSchema>, now: number) {
  captureStats.tabVisits += 1
  for (const path of tabs.holders?.paths ?? []) captureStats.holdersPaths.set(path, (captureStats.holdersPaths.get(path) ?? 0) + 1)
  for (const path of tabs.traders?.paths ?? []) captureStats.tradersPaths.set(path, (captureStats.tradersPaths.get(path) ?? 0) + 1)
  if (!pair || !tabs.holders?.rows.length || now - (holderListAt.get(pair) ?? 0) < 60_000) return
  const mint = mintForPair(database, pair)
  if (mint && saveHolderList(database, mint, pair, tabs.holders.rows, now)) captureStats.holderLists += 1
}

export function storeCapture(database: TrackerDatabase, input: { pairAddress: string | null; api?: Array<z.infer<typeof capturedApiSchema>>; streams?: Array<z.infer<typeof capturedStreamSchema>>; pulse?: { rows: unknown[] }; tabs?: z.infer<typeof capturedTabsSchema> }, now = Date.now()) {
  if (input.pulse?.rows.length && now - lastPulseSampleAt >= 60_000) {
    ensureSchema(database)
    lastPulseSampleAt = now
    database.prepare('INSERT INTO axiom_capture (kind, path, pair, body, at) VALUES (?, ?, NULL, ?, ?)').run('pulse', 'pulse rows', JSON.stringify(input.pulse.rows.slice(0, 20)), now)
  }
  if (!input.api?.length && !input.streams?.length) {
    if (input.tabs) storeTabs(database, input.pairAddress, input.tabs, now)
    return
  }
  ensureSchema(database)
  const insertCapture = database.prepare('INSERT INTO axiom_capture (kind, path, pair, body, at) VALUES (?, ?, ?, ?, ?)')
  const upsertWallet = database.prepare(`INSERT INTO axiom_wallets (pair, wallet, source, fields, first_at, last_at, seen) VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT (pair, wallet, source) DO UPDATE SET fields = excluded.fields, last_at = excluded.last_at, seen = axiom_wallets.seen + 1`)
  const answers: Array<{ path: string; pair: string | null; parsed: unknown }> = []
  const record = (kind: 'api' | 'socket', path: string, pair: string | null, body: string, parsed: unknown) => {
    insertCapture.run(kind, path, pair, body, now)
    if (kind === 'api') answers.push({ path, pair, parsed })
    captureStats.paths.set(`${kind} ${path}`, (captureStats.paths.get(`${kind} ${path}`) ?? 0) + 1)
    if (!parsed || !pair) return
    const skip = new Set([pair])
    for (const sighting of walletSightings(parsed, skip)) {
      upsertWallet.run(pair, sighting.wallet, `${kind} ${path} ${sighting.key}`.slice(0, 200), JSON.stringify(sighting.fields), now, now)
      captureStats.wallets += 1
    }
  }
  database.transaction(() => {
    for (const answer of input.api ?? []) {
      if (answer.status < 200 || answer.status >= 300) continue
      const parsed = parseJson(answer.body)
      if (parsed === null) continue
      const { host, path, pair } = pathOf(answer.url)
      if (!host.endsWith('axiom.trade') || !isMarketPath(path)) continue
      if (answer.poll) {
        answers.push({ path, pair: pair ?? input.pairAddress, parsed })
        captureStats.polled += 1
        continue
      }
      record('api', path, pair ?? input.pairAddress, answer.body, parsed)
      captureStats.api += 1
    }
  })()
  answers.sort((first, second) => Number(!tradePaths.has(first.path)) - Number(!tradePaths.has(second.path)))
  for (const answer of answers) {
    try {
      const read = readAxiomAnswer(database, answer.path, answer.pair, answer.parsed, now)
      captureStats.trades += read.trades
      if (read.holders) captureStats.holderReads += 1
      if (read.holderList) {
        captureStats.holderLists += 1
        if (answer.pair) holderListAt.set(answer.pair, now)
      }
      captureStats.traderRows += read.traderRows
    } catch { }
  }
  if (input.tabs) storeTabs(database, input.pairAddress, input.tabs, now)
  if (now - lastPruneAt > 60_000) {
    lastPruneAt = now
    database.prepare('DELETE FROM axiom_capture WHERE at < ?').run(now - keepCaptureMs)
    database.prepare('DELETE FROM axiom_capture WHERE id <= (SELECT MAX(id) FROM axiom_capture) - ?').run(maxCaptureRows)
  }
}

/** The heartbeat line: how much the bridge captured in the last interval and the busiest paths. */
export const pollStatsSchema = z.object({ sent: z.number().int().min(0), ok: z.number().int().min(0), failed: z.number().int().min(0), status: z.number().int().min(-1).max(999), mints: z.number().int().min(0).max(1000), hidden: z.boolean() }).strict()
let lastPoll: (z.infer<typeof pollStatsSchema> & { at: number }) | null = null

/** Keeps the Pulse tab's latest poll counters for the status line. */
export function notePollStats(stats: z.infer<typeof pollStatsSchema>, now = Date.now()) {
  lastPoll = { ...stats, at: now }
}

/** Describes the Pulse tab's trade polling, or why it is not running. */
export function pollNote(now = Date.now()) {
  if (!lastPoll || now - lastPoll.at > 120_000) return 'Pulse tab trade polling: no word from the tab'
  const status = lastPoll.status === -1 ? 'network error' : `HTTP ${lastPoll.status}`
  return `Pulse tab trade polling: ${lastPoll.ok} of ${lastPoll.sent} feed reads ok, ${lastPoll.failed} failed (last ${status}), ${lastPoll.mints} coins${lastPoll.hidden ? ', tab in background' : ''}`
}

export function captureNote() {
  const busiest = [...captureStats.paths].sort((first, second) => second[1] - first[1]).slice(0, 4).map(([path, count]) => `${path} ×${count}`).join(', ')
  const top = (paths: Map<string, number>) => [...paths].sort((first, second) => second[1] - first[1]).slice(0, 5).map(([path]) => path).join(' ') || 'nothing'
  const tabs = captureStats.tabVisits ? `; opened Holders/Top Traders on ${captureStats.tabVisits} coin pages: ${captureStats.holderLists} holder lists saved, ${captureStats.traderRows} top-trader rows (Holders loaded ${top(captureStats.holdersPaths)}; Top Traders loaded ${top(captureStats.tradersPaths)})` : ''
  const polled = captureStats.polled ? `; read ${captureStats.polled} trades feeds from the Pulse tab` : ''
  captureStats.polled = 0
  const note = captureStats.api || tabs || polled ? `${polled}; captured ${captureStats.api} Axiom answers: ${captureStats.trades} new trades, ${captureStats.holderReads} holder readings, ${captureStats.wallets} wallet sightings${busiest ? ` (${busiest})` : ''}${tabs}` : ''
  captureStats.holderLists = 0
  captureStats.traderRows = 0
  captureStats.tabVisits = 0
  captureStats.holdersPaths.clear()
  captureStats.tradersPaths.clear()
  captureStats.trades = 0
  captureStats.holderReads = 0
  captureStats.api = 0
  captureStats.streams = 0
  captureStats.wallets = 0
  captureStats.paths.clear()
  return note
}
