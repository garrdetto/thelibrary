import { z } from 'zod'
import type { RadarPulseMetrics } from '../../src/lib/axiom-radar-types.js'
import { solanaAddressPattern } from './runtime.js'
import { notePulseFlow } from './pulse-market.js'
import { trackerState } from './state.js'

const numeric = z.union([z.number(), z.string().max(40)]).nullable().optional()
const text = z.string().max(300).nullable().optional()

/** One coin from Axiom Pulse's worker feed, as the bridge (1.7+) forwards it: every coin in the three columns, drawn or not. */
export const pulseRowSchema = z.object({
  column: z.enum(['newPairs', 'finalStretch', 'migrated']),
  pairAddress: z.string().regex(solanaAddressPattern),
  tokenAddress: z.string().regex(solanaAddressPattern),
  tokenName: text,
  tokenTicker: text,
  createdAt: z.unknown().optional(),
  marketCap: numeric,
  volume: numeric,
  liquidityNative: numeric,
  numHolders: numeric,
  userCount: numeric,
  numTxns: numeric,
  numBuys: numeric,
  numSells: numeric,
  buyVolume: numeric,
  totalFees: numeric,
  bondingCurvePercent: numeric,
  top10HoldersPercent: numeric,
  devHoldsPercent: numeric,
  devSold: z.boolean().nullable().optional(),
  snipersHoldPercent: numeric,
  insidersHoldPercent: numeric,
  bundlersHoldPercent: numeric,
  freshWalletsHoldPercent: numeric,
  proTradersHoldPercent: numeric,
  devMigrationCount: numeric,
  devCreationCount: numeric,
  kolCount: numeric,
  dexPaid: z.boolean().nullable().optional(),
  twitter: text,
  telegram: text,
  website: text,
}).passthrough()

/** Rows are checked one at a time in `applyPulseFeed`, so one coin with an odd field never costs the whole report. */
export const pulseFeedSchema = z.object({ usdPerSol: z.number().positive().max(100_000), rows: z.array(z.unknown()).max(300) })

export type PulseFeed = { usdPerSol: number; rows: unknown[] }
export type PulseRow = z.infer<typeof pulseRowSchema>

const num = (value: unknown) => {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(parsed) ? parsed : null
}
const percent = (value: unknown) => {
  const parsed = num(value)
  return parsed === null ? null : Math.max(0, Math.min(100, parsed))
}

/** The Pulse row as the card metrics the rest of the tracker already reads; market cap, volume and liquidity turned from SOL into dollars. */
export function metricsFromRow(row: PulseRow, usdPerSol: number, seenAt: number): RadarPulseMetrics {
  const solToUsd = (value: unknown) => {
    const parsed = num(value)
    return parsed === null ? null : parsed * usdPerSol
  }
  const liquiditySol = num(row.liquidityNative)
  return {
    holders: num(row.numHolders),
    devMigrated: num(row.devMigrationCount),
    devCreated: num(row.devCreationCount),
    top10Pct: percent(row.top10HoldersPercent),
    devPct: row.devSold ? 0 : percent(row.devHoldsPercent),
    devSold: Boolean(row.devSold),
    snipersPct: percent(row.snipersHoldPercent),
    insidersPct: percent(row.insidersHoldPercent),
    bundlersPct: percent(row.bundlersHoldPercent),
    freshPct: percent(row.freshWalletsHoldPercent),
    proTradersPct: percent(row.proTradersHoldPercent),
    feesSol: num(row.totalFees),
    txCount: num(row.numTxns),
    buyCount: num(row.numBuys),
    sellCount: num(row.numSells),
    volume: solToUsd(row.volume),
    marketCap: solToUsd(row.marketCap),
    liquidityUsd: liquiditySol === null ? null : liquiditySol * usdPerSol * 2,
    viewers: num(row.userCount),
    column: row.column,
    seenAt,
  }
}

/**
 * Takes every coin in the bridge's Pulse feed into the tracker the same way a Pulse card is taken: card metrics, ticker and
 * launch time, viewer count and Pulse membership. A coin already read from a drawn card keeps the fresher of the two.
 */
export function applyPulseFeed(feed: PulseFeed, now: number) {
  let taken = 0
  let skipped = 0
  for (const raw of feed.rows) {
    const parsed = pulseRowSchema.safeParse(raw)
    if (!parsed.success) { skipped += 1; continue }
    const row = parsed.data
    const mint = row.tokenAddress
    const metrics = metricsFromRow(row, feed.usdPerSol, now)
    trackerState.pulseCards.set(mint, metrics)
    notePulseFlow(mint, metrics)
    const created = typeof row.createdAt === 'number' ? row.createdAt : typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : NaN
    trackerState.pulseNames.set(mint, {
      symbol: (row.tokenTicker ?? '???').slice(0, 24),
      name: (row.tokenName ?? row.tokenTicker ?? 'Unknown').slice(0, 80),
      pairAddress: row.pairAddress,
      createdAt: Number.isFinite(created) ? created : null,
      seenAt: now,
    })
    trackerState.pulse.set(mint, now)
    if (typeof metrics.viewers === 'number') trackerState.viewers.set(mint, { count: metrics.viewers, at: now, source: 'extension' })
    taken += 1
  }
  pulseFeedSeen.at = now
  pulseFeedSeen.count = taken
  pulseFeedSeen.skipped = skipped
  return taken
}

export const pulseFeedSeen = { at: 0, count: 0, skipped: 0 }
