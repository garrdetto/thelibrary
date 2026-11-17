import { z } from 'zod'
import type { TrackerDatabase } from './db.js'
import { solanaAddressPattern } from './runtime.js'

/**
 * Everything the Axiom pages fetch from Axiom's API and receive on their sockets, as the bridge (1.9+) forwards it: kept for a
 * few hours so new readers can be written from real answers, and every wallet in it is recorded per coin straight away.
 */

export const capturedApiSchema = z.object({ url: z.string().max(600), status: z.number().int().min(0).max(999), body: z.string().max(400_000) }).strict()
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
      if (typeof field === 'string' && solanaAddressPattern.test(field) && !skip.has(field) && walletKey.test(key) && !notWalletKey.test(key)) {
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

export type CaptureStats = { api: number; streams: number; wallets: number; paths: Map<string, number> }
export const captureStats: CaptureStats = { api: 0, streams: 0, wallets: 0, paths: new Map() }

let prepared: TrackerDatabase | null = null
let lastPruneAt = 0
let lastPulseSampleAt = 0

function ensureSchema(database: TrackerDatabase) {
  if (prepared === database) return
  database.exec(schema)
  prepared = database
}

/** Stores one report's captured answers and records the wallets in them against the coin's pair address. */
export function storeCapture(database: TrackerDatabase, input: { pairAddress: string | null; api?: Array<z.infer<typeof capturedApiSchema>>; streams?: Array<z.infer<typeof capturedStreamSchema>>; pulse?: { rows: unknown[] } }, now = Date.now()) {
  if (input.pulse?.rows.length && now - lastPulseSampleAt >= 60_000) {
    ensureSchema(database)
    lastPulseSampleAt = now
    database.prepare('INSERT INTO axiom_capture (kind, path, pair, body, at) VALUES (?, ?, NULL, ?, ?)').run('pulse', 'pulse rows', JSON.stringify(input.pulse.rows.slice(0, 20)), now)
  }
  if (!input.api?.length && !input.streams?.length) return
  ensureSchema(database)
  const insertCapture = database.prepare('INSERT INTO axiom_capture (kind, path, pair, body, at) VALUES (?, ?, ?, ?, ?)')
  const upsertWallet = database.prepare(`INSERT INTO axiom_wallets (pair, wallet, source, fields, first_at, last_at, seen) VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT (pair, wallet, source) DO UPDATE SET fields = excluded.fields, last_at = excluded.last_at, seen = axiom_wallets.seen + 1`)
  const record = (kind: 'api' | 'socket', path: string, pair: string | null, body: string, parsed: unknown) => {
    insertCapture.run(kind, path, pair, body, now)
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
      if (!host.endsWith('axiom.trade')) continue
      record('api', path, pair ?? input.pairAddress, answer.body, parsed)
      captureStats.api += 1
    }
    for (const frame of input.streams ?? []) {
      const parsed = parseJson(frame.text)
      if (parsed === null) continue
      const { path } = pathOf(frame.url)
      const room = typeof (parsed as { room?: unknown }).room === 'string' ? (parsed as { room: string }).room : null
      const pairInRoom = room?.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null
      record('socket', `${path}${room ? ` ${room.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, ':address')}` : ''}`, pairInRoom ?? input.pairAddress, frame.text, parsed)
      captureStats.streams += 1
    }
  })()
  if (now - lastPruneAt > 60_000) {
    lastPruneAt = now
    database.prepare('DELETE FROM axiom_capture WHERE at < ?').run(now - keepCaptureMs)
    database.prepare('DELETE FROM axiom_capture WHERE id <= (SELECT MAX(id) FROM axiom_capture) - ?').run(maxCaptureRows)
  }
}

/** The heartbeat line: how much the bridge captured in the last interval and the busiest paths. */
export function captureNote() {
  const busiest = [...captureStats.paths].sort((first, second) => second[1] - first[1]).slice(0, 4).map(([path, count]) => `${path} ×${count}`).join(', ')
  const note = captureStats.api || captureStats.streams ? `; captured ${captureStats.api} API answers and ${captureStats.streams} socket messages, ${captureStats.wallets} wallet sightings${busiest ? ` (${busiest})` : ''}` : ''
  captureStats.api = 0
  captureStats.streams = 0
  captureStats.wallets = 0
  captureStats.paths.clear()
  return note
}
