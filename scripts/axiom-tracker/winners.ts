import type { RadarWinner, RadarWinnersSummary } from '../../src/lib/axiom-radar-learner.js'
import type { RadarToken } from '../../src/lib/axiom-radar-types.js'
import type { TrackerDatabase } from './db.js'
import { lifecycleSpecs, lifecycleStart, readFeatures, type LifecycleRow } from './learner.js'
import { learnerState } from './learner-state.js'
import { analyzeShape, type PricePoint, type PriceShape } from './price-shape.js'
import { judgeResearch, poolShare, sharedAccounts, type ResearchVerdict } from './research-verdict.js'
import { parseTraits } from './rise-traits.js'
import { chanceOf, holdoutAccuracy, median, passesRule, splitRules, topReasons, trainClassifier, vectorOf, type Classifier, type FeatureValues, type SplitRule } from './logistic.js'

const minimumMultiple = 3
const minimumPeakMcap = 50_000
const maximumStartMcap = 1_000_000
const maximumMultiple = 1_000
const minimumSamples = 30
const ladderStart = 40_000
const ladderTargets = [50_000, 100_000, 200_000, 500_000, 1_000_000]

const winnersSchema = `
CREATE TABLE IF NOT EXISTS winner_wallets (
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  pct REAL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (mint, wallet)
);
CREATE INDEX IF NOT EXISTS winner_wallets_wallet ON winner_wallets (wallet);
`

type WinnerRow = LifecycleRow & { pair_address: string | null; mint_auth: number | null; freeze_auth: number | null; top10_pct: number | null; fresh_pct: number | null; shape_json?: string | null }
export type WinnersModel = {
  classifier: Classifier
  values: FeatureValues[]
  labels: boolean[]
  hitRate: number | null
  winners: WinnerRow[]
  rows: WinnerRow[]
  verdicts: Map<string, ResearchVerdict>
  rules: SplitRule[]
  walletCoins: Map<string, Map<string, number | null>>
}

const multipleOf = (row: LifecycleRow) => row.first_mcap && row.peak_mcap ? row.peak_mcap / row.first_mcap : 0
const isWinner = (row: LifecycleRow) => {
  const multiple = multipleOf(row)
  return (row.first_mcap ?? Infinity) < maximumStartMcap && (row.peak_mcap ?? 0) >= minimumPeakMcap && multiple >= minimumMultiple && multiple <= maximumMultiple
}

function judge(row: WinnerRow): ResearchVerdict {
  const rise = parseTraits(row.rise_traits_json)
  const mintAuthority = row.mint_auth === null ? null : row.mint_auth === 1
  const freezeAuthority = row.freeze_auth === null ? null : row.freeze_auth === 1
  const early = row.features_json ? JSON.parse(row.features_json) as FeatureValues : {}
  const earlyHolders = typeof early.holders === 'number' && Number.isFinite(early.holders) ? early.holders : null
  return judgeResearch({ rise, freshFallback: row.fresh_pct ?? null, mintAuthority, freezeAuthority, shape: parseShape(row.shape_json), earlyHolders })
}

function parseShape(json: string | null | undefined): PriceShape | null {
  if (!json) return null
  try {
    return JSON.parse(json) as PriceShape
  } catch {
    return null
  }
}

/** Reads the run and fall of each winner from its price history while that history is still kept (24 hours), and stores it. */
function storeShapes(database: TrackerDatabase, winners: WinnerRow[], now: number) {
  const columns = new Set((database.prepare('PRAGMA table_info(coin_lifecycles)').all() as Array<{ name: string }>).map(column => column.name))
  if (!columns.has('shape_json')) database.exec('ALTER TABLE coin_lifecycles ADD COLUMN shape_json TEXT')
  const history = database.prepare('SELECT timestamp AS t, price_usd AS price FROM snapshots WHERE mint = ? AND price_usd > 0 ORDER BY timestamp ASC')
  const save = database.prepare('UPDATE coin_lifecycles SET shape_json = ? WHERE mint = ?')
  for (const winner of winners) {
    if (now - winner.last_at > 25 * 60 * 60_000) continue
    const shape = analyzeShape(history.all(winner.mint) as PricePoint[])
    const stored = parseShape(winner.shape_json)
    if (!shape || (stored && shape.points < stored.points)) continue
    winner.shape_json = JSON.stringify(shape)
    save.run(winner.shape_json, winner.mint)
  }
}

const isPositiveIn = (verdicts: Map<string, ResearchVerdict>, row: WinnerRow) => (verdicts.get(row.mint)?.negatives.length ?? 1) === 0

const money = (value: number) => value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `$${Math.round(value / 1_000)}K` : `$${Math.round(value)}`

export function loadWinnersModel(database: TrackerDatabase): WinnersModel {
  database.exec(winnersSchema)
  const rows = database.prepare('SELECT l.*, t.pair_address, t.mint_auth, t.freeze_auth, t.top10_pct, t.fresh_pct FROM coin_lifecycles l LEFT JOIN tokens t ON t.mint = l.mint ORDER BY l.first_seen_at ASC').all() as WinnerRow[]
  const winners = rows.filter(isWinner).sort((first, second) => (second.peak_mcap ?? 0) - (first.peak_mcap ?? 0))
  storeShapes(database, winners, Date.now())
  const verdicts = new Map<string, ResearchVerdict>()
  for (const winner of winners) verdicts.set(winner.mint, judge(winner))
  const positive = (row: WinnerRow) => isWinner(row) && isPositiveIn(verdicts, row)
  const training = rows.filter(row => row.features_json !== null && (row.outcome !== 'open' || isWinner(row)))
  const values = training.map(row => JSON.parse(row.features_json as string) as FeatureValues)
  const labels = training.map(positive)
  const walletCoins = new Map<string, Map<string, number | null>>()
  const keep = database.prepare('INSERT OR IGNORE INTO winner_wallets (mint, wallet, pct, saved_at) SELECT mint, wallet, pct, ? FROM holders WHERE mint = ?')
  const holders = database.prepare('SELECT wallet, pct FROM winner_wallets WHERE mint = ? AND (pct IS NULL OR pct < ?)')
  const savedAt = Date.now()
  database.transaction(() => { for (const winner of winners) keep.run(savedAt, winner.mint) })()
  for (const winner of winners.filter(positive)) {
    for (const holder of holders.all(winner.mint, poolShare) as Array<{ wallet: string; pct: number | null }>) {
      if (sharedAccounts.has(holder.wallet)) continue
      const coins = walletCoins.get(holder.wallet) ?? new Map<string, number | null>()
      coins.set(winner.mint, holder.pct)
      walletCoins.set(holder.wallet, coins)
    }
  }
  return { verdicts, classifier: trainClassifier(lifecycleSpecs, values, labels, minimumSamples), values, labels, hitRate: holdoutAccuracy(lifecycleSpecs, values, labels, minimumSamples)?.flaggedHitRate ?? null, winners, rows, rules: splitRules(lifecycleSpecs, values, labels), walletCoins }
}

function sharedWalletCount(model: WinnersModel, wallets: string[], mint: string) {
  let count = 0
  for (const wallet of wallets) {
    const coins = model.walletCoins.get(wallet)
    if (coins && (coins.size > 1 || !coins.has(mint))) count += 1
  }
  return count
}

function story(model: WinnersModel) {
  const lines: string[] = []
  const { winners, values, labels } = model
  if (!winners.length) return ['No tracked coin has grown 3x to at least $50K yet. This fills in as the tracker runs.']
  const multiples = winners.map(multipleOf)
  const minutes = winners.map(row => ((row.peak_mcap_at ?? row.peak_at) - row.first_seen_at) / 60_000)
  lines.push(`${winners.length} coins grew at least ${minimumMultiple}x while tracked. They were first seen around ${money(median(winners.map(row => row.first_mcap as number)) ?? 0)}, peaked around ${money(median(winners.map(row => row.peak_mcap as number)) ?? 0)} (${(median(multiples) ?? 0).toFixed(1)}x), and took about ${Math.round(median(minutes) ?? 0)} minutes to get there.`)
  const compare = (key: string, label: string, format: (value: number) => string) => {
    const pick = (wanted: boolean) => values.filter((_, index) => labels[index] === wanted).map(row => row[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    const won = median(pick(true))
    const rest = median(pick(false))
    if (won === null || rest === null || pick(true).length < 5) return
    const ratio = rest === 0 ? (won === 0 ? 1 : Infinity) : won / rest
    if ((ratio > 0.8 && ratio < 1.25) || format(won) === format(rest)) return
    lines.push(`${label}: ${format(won)} for the positive winners vs ${format(rest)} for the rest, one minute after they were first seen.`)
  }
  compare('buys5m', 'Buys in 5 minutes', value => Math.round(value).toLocaleString('en-US'))
  compare('volume5m', '5-minute volume', money)
  compare('viewers', 'Axiom viewers', value => Math.round(value).toLocaleString('en-US'))
  compare('marketCap', 'Market cap', money)
  compare('liquidity', 'Liquidity', money)
  compare('ageAtSight', 'Age when first seen', value => `${Math.round(value)} min`)
  compare('buyRatio', 'Buy share of trades', value => `${Math.round(value * 100)}%`)
  const positives = winners.filter(row => isPositiveIn(model.verdicts, row))
  const connected = positives.filter(row => [...model.walletCoins.values()].some(coins => coins.size > 1 && coins.has(row.mint))).length
  if (positives.length >= 3) lines.push(`${connected} of the ${positives.length} positive winners share at least one top-holder wallet with another positive winner.`)
  const crashed = winners.filter(row => row.rugged_at !== null)
  if (crashed.length >= 3) lines.push(`${crashed.length} of them later crashed, about ${Math.round(median(crashed.map(row => ((row.rugged_at as number) - lifecycleStart(row)) / 60_000)) ?? 0)} minutes after launch.`)
  return lines
}

export function runWinnersCycle(database: TrackerDatabase, model: WinnersModel, tokens: RadarToken[], now = Date.now()) {
  const holdersOf = database.prepare('SELECT wallet FROM holders WHERE mint = ? AND (pct IS NULL OR pct < ?) UNION SELECT wallet FROM winner_wallets WHERE mint = ? AND (pct IS NULL OR pct < ?)')
  const wallets = (mint: string) => (holdersOf.all(mint, poolShare, mint, poolShare) as Array<{ wallet: string }>).map(row => row.wallet)
  const maker = new Map<string, { chance: number | null; winnerWallets: number; reasons: Array<{ label: string; good: boolean }>; passes: string[] }>()
  for (const token of tokens) {
    const values = readFeatures(token)
    const vector = vectorOf(model.classifier, lifecycleSpecs, values)
    maker.set(token.mint, { chance: model.classifier.ready ? chanceOf(model.classifier, vector) : null, winnerWallets: sharedWalletCount(model, wallets(token.mint), token.mint), reasons: topReasons(model.classifier, lifecycleSpecs, vector), passes: model.rules.filter(rule => passesRule(rule, values)).map(rule => rule.key) })
  }
  learnerState.maker = maker
  const rank = (mint: string) => {
    const entry = maker.get(mint)
    return entry ? (entry.chance ?? 0.1) * (1 + 0.2 * Math.min(3, entry.winnerWallets)) : 0
  }
  const describe = (row: WinnerRow): RadarWinner => {
    const early = row.features_json ? JSON.parse(row.features_json) as FeatureValues : {}
    const pick = (key: string) => typeof early[key] === 'number' && Number.isFinite(early[key]) ? early[key] as number : null
    return {
    mint: row.mint,
    symbol: row.symbol,
    pairAddress: row.pair_address,
    firstSeenAt: row.first_seen_at,
    firstMcap: row.first_mcap as number,
    peakMcap: row.peak_mcap as number,
    multiple: Math.round(multipleOf(row) * 10) / 10,
    minutesToPeak: Math.max(0, Math.round(((row.peak_mcap_at ?? row.peak_at) - row.first_seen_at) / 60_000)),
    status: row.rugged_at !== null ? 'crashed' : row.outcome === 'open' ? 'running' : row.outcome === 'survived' ? 'holding' : 'faded',
    lifeMinutes: row.rugged_at === null ? null : Math.round((row.rugged_at - lifecycleStart(row)) / 60_000),
    winnerWallets: sharedWalletCount(model, wallets(row.mint), row.mint),
    early: { viewers: pick('viewers'), buys5m: pick('buys5m'), volume5m: pick('volume5m'), marketCap: pick('marketCap'), ageAtSight: pick('ageAtSight'), buyRatio: pick('buyRatio') },
    matched: model.rules.filter(rule => passesRule(rule, early)).map(rule => rule.label),
    crashKind: row.rug_kind,
    verdict: isPositiveIn(model.verdicts, row) ? 'positive' : 'negative',
    negatives: model.verdicts.get(row.mint)?.negatives ?? [],
    holdersPeak: row.holders_peak,
    topHoldersPct: model.verdicts.get(row.mint)?.topHoldersPct ?? null,
    freshPct: model.verdicts.get(row.mint)?.freshPct ?? null,
    }
  }
  const top = model.winners.slice(0, 40).map(describe)
  const jumps = model.winners.slice().sort((first, second) => multipleOf(second) - multipleOf(first)).slice(0, 80).map(describe)
  const isPositive = (row: WinnerRow) => isPositiveIn(model.verdicts, row)
  const studied = model.winners.filter(row => row.features_json !== null)
  const kinds = new Map<string, number>()
  for (const verdict of model.verdicts.values()) for (const kind of verdict.kinds) kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
  const lowStart = model.rows.filter(row => row.first_mcap !== null && row.first_mcap <= ladderStart && multipleOf(row) <= maximumMultiple)
  const symbols = new Map(model.winners.map(row => [row.mint, row]))
  const summary: RadarWinnersSummary = {
    ready: model.classifier.ready,
    studied: model.values.length,
    winners: model.winners.length,
    winnerRate: model.labels.length ? model.labels.filter(Boolean).length / model.labels.length : null,
    flaggedHitRate: model.hitRate,
    minimumMultiple,
    top,
    jumps,
    positives: model.winners.filter(isPositive).length,
    negatives: model.winners.filter(row => !isPositive(row)).length,
    negativeBreakdown: [...kinds].sort((first, second) => second[1] - first[1]).map(([label, count]) => ({ label, count })),
    separators: splitRules(lifecycleSpecs, studied.map(row => JSON.parse(row.features_json as string) as FeatureValues), studied.map(isPositive)).slice(0, 5).map(rule => `${rule.label}: ${Math.round(rule.rate * 100)}% stayed positive, vs ${Math.round(rule.otherRate * 100)}% otherwise`),
    rules: model.rules.map(rule => ({ key: rule.key, label: rule.label, winnerRate: rule.rate, otherRate: rule.otherRate })),
    ladder: { start: ladderStart, base: lowStart.length, steps: ladderTargets.map(target => ({ target, count: lowStart.filter(row => (row.peak_mcap ?? 0) >= target).length })) },
    traits: model.rules.slice(0, 5).map(rule => `${rule.label}: ${Math.round(rule.rate * 100)}% became positive winners, vs ${Math.round(rule.otherRate * 100)}% otherwise`),
    story: story(model),
    wallets: [...model.walletCoins].filter(([, coins]) => coins.size >= 2).sort((first, second) => second[1].size - first[1].size).slice(0, 30).map(([wallet, coins]) => {
      const shares = [...coins.values()].filter((value): value is number => value !== null)
      return { wallet, hits: coins.size, averagePct: shares.length ? Math.round((shares.reduce((total, value) => total + value, 0) / shares.length) * 100) / 100 : null, coins: [...coins.keys()].slice(0, 6).map(mint => ({ mint, symbol: symbols.get(mint)?.symbol ?? '???', pairAddress: symbols.get(mint)?.pair_address ?? null })) }
    }),
    candidates: tokens.filter(token => token.alerts.length === 0 && !token.holderRisk?.blocked && (token.marketCap ?? 0) < 5_000_000 && rank(token.mint) > 0).sort((first, second) => rank(second.mint) - rank(first.mint)).slice(0, 12).map(token => token.mint),
    updatedAt: now,
  }
  learnerState.winners = summary
  return summary
}
