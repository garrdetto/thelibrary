import type { RadarWinner, RadarWinnersSummary } from '../../src/lib/axiom-radar-learner.js'
import type { RadarToken } from '../../src/lib/axiom-radar-types.js'
import type { TrackerDatabase } from './db.js'
import { lifecycleSpecs, lifecycleStart, readFeatures, type LifecycleRow } from './learner.js'
import { learnerState } from './learner-state.js'
import { chanceOf, holdoutAccuracy, median, splitInsights, topReasons, trainClassifier, vectorOf, type Classifier, type FeatureValues } from './logistic.js'

const minimumMultiple = 3
const minimumPeakMcap = 50_000
const maximumStartMcap = 1_000_000
const maximumMultiple = 1_000
const minimumSamples = 30
const poolShare = 15
const sharedAccounts = new Set(['5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM'])

type WinnerRow = LifecycleRow & { pair_address: string | null }
export type WinnersModel = {
  classifier: Classifier
  values: FeatureValues[]
  labels: boolean[]
  hitRate: number | null
  winners: WinnerRow[]
  walletCoins: Map<string, Map<string, number | null>>
}

const multipleOf = (row: LifecycleRow) => row.first_mcap && row.peak_mcap ? row.peak_mcap / row.first_mcap : 0
const isWinner = (row: LifecycleRow) => {
  const multiple = multipleOf(row)
  return (row.first_mcap ?? Infinity) < maximumStartMcap && (row.peak_mcap ?? 0) >= minimumPeakMcap && multiple >= minimumMultiple && multiple <= maximumMultiple
}

const money = (value: number) => value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `$${Math.round(value / 1_000)}K` : `$${Math.round(value)}`

export function loadWinnersModel(database: TrackerDatabase): WinnersModel {
  const rows = database.prepare('SELECT l.*, t.pair_address FROM coin_lifecycles l LEFT JOIN tokens t ON t.mint = l.mint ORDER BY l.first_seen_at ASC').all() as WinnerRow[]
  const winners = rows.filter(isWinner).sort((first, second) => (second.peak_mcap ?? 0) - (first.peak_mcap ?? 0))
  const training = rows.filter(row => row.features_json !== null && (row.outcome !== 'open' || isWinner(row)))
  const values = training.map(row => JSON.parse(row.features_json as string) as FeatureValues)
  const labels = training.map(isWinner)
  const walletCoins = new Map<string, Map<string, number | null>>()
  const holders = database.prepare('SELECT wallet, pct FROM holders WHERE mint = ? AND (pct IS NULL OR pct < ?)')
  for (const winner of winners) {
    for (const holder of holders.all(winner.mint, poolShare) as Array<{ wallet: string; pct: number | null }>) {
      if (sharedAccounts.has(holder.wallet)) continue
      const coins = walletCoins.get(holder.wallet) ?? new Map<string, number | null>()
      coins.set(winner.mint, holder.pct)
      walletCoins.set(holder.wallet, coins)
    }
  }
  return { classifier: trainClassifier(lifecycleSpecs, values, labels, minimumSamples), values, labels, hitRate: holdoutAccuracy(lifecycleSpecs, values, labels, minimumSamples)?.flaggedHitRate ?? null, winners, walletCoins }
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
    lines.push(`${label}: ${format(won)} for the winners vs ${format(rest)} for the rest, one minute after they were first seen.`)
  }
  compare('buys5m', 'Buys in 5 minutes', value => Math.round(value).toLocaleString('en-US'))
  compare('volume5m', '5-minute volume', money)
  compare('viewers', 'Axiom viewers', value => Math.round(value).toLocaleString('en-US'))
  compare('marketCap', 'Market cap', money)
  compare('liquidity', 'Liquidity', money)
  compare('ageAtSight', 'Age when first seen', value => `${Math.round(value)} min`)
  compare('buyRatio', 'Buy share of trades', value => `${Math.round(value * 100)}%`)
  const connected = winners.filter(row => [...model.walletCoins.values()].some(coins => coins.size > 1 && coins.has(row.mint))).length
  if (winners.length >= 3) lines.push(`${connected} of the ${winners.length} winners share at least one top-holder wallet with another winner.`)
  const crashed = winners.filter(row => row.rugged_at !== null)
  if (crashed.length >= 3) lines.push(`${crashed.length} of them later crashed, about ${Math.round(median(crashed.map(row => ((row.rugged_at as number) - lifecycleStart(row)) / 60_000)) ?? 0)} minutes after launch.`)
  return lines
}

export function runWinnersCycle(database: TrackerDatabase, model: WinnersModel, tokens: RadarToken[], now = Date.now()) {
  const holdersOf = database.prepare('SELECT wallet FROM holders WHERE mint = ? AND (pct IS NULL OR pct < ?)')
  const wallets = (mint: string) => (holdersOf.all(mint, poolShare) as Array<{ wallet: string }>).map(row => row.wallet)
  const maker = new Map<string, { chance: number | null; winnerWallets: number; reasons: Array<{ label: string; good: boolean }> }>()
  for (const token of tokens) {
    const vector = vectorOf(model.classifier, lifecycleSpecs, readFeatures(token))
    maker.set(token.mint, { chance: model.classifier.ready ? chanceOf(model.classifier, vector) : null, winnerWallets: sharedWalletCount(model, wallets(token.mint), token.mint), reasons: topReasons(model.classifier, lifecycleSpecs, vector) })
  }
  learnerState.maker = maker
  const rank = (mint: string) => {
    const entry = maker.get(mint)
    return entry ? (entry.chance ?? 0.1) * (1 + 0.2 * Math.min(3, entry.winnerWallets)) : 0
  }
  const top: RadarWinner[] = model.winners.slice(0, 25).map(row => ({
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
  }))
  const symbols = new Map(model.winners.map(row => [row.mint, row]))
  const summary: RadarWinnersSummary = {
    ready: model.classifier.ready,
    studied: model.values.length,
    winners: model.winners.length,
    winnerRate: model.labels.length ? model.labels.filter(Boolean).length / model.labels.length : null,
    flaggedHitRate: model.hitRate,
    minimumMultiple,
    top,
    traits: splitInsights(lifecycleSpecs, model.values, model.labels, 'became big winners'),
    story: story(model),
    wallets: [...model.walletCoins].filter(([, coins]) => coins.size >= 2).sort((first, second) => second[1].size - first[1].size).slice(0, 30).map(([wallet, coins]) => {
      const shares = [...coins.values()].filter((value): value is number => value !== null)
      return { wallet, hits: coins.size, averagePct: shares.length ? Math.round((shares.reduce((total, value) => total + value, 0) / shares.length) * 100) / 100 : null, coins: [...coins.keys()].slice(0, 6).map(mint => ({ mint, symbol: symbols.get(mint)?.symbol ?? '???', pairAddress: symbols.get(mint)?.pair_address ?? null })) }
    }),
    candidates: tokens.filter(token => token.alerts.length === 0 && (token.marketCap ?? 0) < 5_000_000 && rank(token.mint) > 0).sort((first, second) => rank(second.mint) - rank(first.mint)).slice(0, 12).map(token => token.mint),
    updatedAt: now,
  }
  learnerState.winners = summary
  return summary
}
