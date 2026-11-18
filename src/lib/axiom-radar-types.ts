import { defaultRadarSettings, type RadarSettings } from './axiom-radar-settings'
import type { RadarAdvice, RadarAdviceStudy, RadarExplode, RadarExplosionSummary, RadarLearnerSummary, RadarMaker, RadarOutlook, RadarTierMatch, RadarWinnersSummary } from './axiom-radar-learner'

export const radarFeatureKeys = ['viewerVelocity', 'activeViewers', 'runnerWallets', 'buyPressure', 'safety'] as const
export type RadarFeatureKey = typeof radarFeatureKeys[number]
export type RadarWeights = Record<RadarFeatureKey, number>

export const radarFeatureLabels: Record<RadarFeatureKey, string> = {
  viewerVelocity: 'Viewer growth',
  activeViewers: 'Active viewers',
  runnerWallets: 'Smart holders',
  buyPressure: '5m buy pressure',
  safety: 'Safety & holder quality',
}

export type RadarSafetyLevel = 'safe' | 'caution' | 'risky' | 'unknown'

export type RadarFactor = {
  key: RadarFeatureKey
  label: string
  value: number
  weight: number
  contribution: number
  available: boolean
}

export type RadarHistoryPoint = { t: number; viewers: number | null; marketCap: number | null; priceUsd: number | null }

export type RadarSocials = { twitter: string | null; telegram: string | null; website: string | null }

export type RadarHolderTraits = { top10: number | null; dev: number | null; snipers: number | null; insiders: number | null; bundlers: number | null; linked: number | null; fresh?: number | null; proTraders?: number | null; holders: number | null; checkedAt: number | null }

export type RadarHolderRisk = { blocked: boolean; multiplier: number; reasons: string[] }

export type RadarScorePart = { key: 'viewers' | 'holders' | 'momentum' | 'buyers' | 'together' | 'distribution' | 'hype' | 'chart' | 'penalty' | 'learned' | 'growth'; label: string; points: number; max: number; detail: string; available: boolean }

/** Price change in percent over each DexScreener score window. */
export type RadarDexMoves = { s5: number | null; s30: number | null; m1: number | null; m5: number | null }
export type RadarDexCheck = { label: string; reading: string; points: number; max: number }
/** The DexScreener score: price movement weighted over 5s, 30s, 1m and 5m, backed by liquidity and volume, from market data alone. */
export type RadarDexScore = { score: number; moves: RadarDexMoves; signal: number | null; checks: RadarDexCheck[]; cuts: string[] }

export type RadarPriceWindow = 's5' | 's30' | 'm1' | 'm5' | 'm10'
/** Where a price-change window came from when the tracker had no reading at its exact start. */
export type RadarPriceWindowSource = 'between-readings' | 'since-launch' | 'since-tracked' | 'dexscreener'

export type RadarScoreStatus = 'earned' | 'partial' | 'missed' | 'unknown'

/** One scoring rule as it stood on the last check: what it read, what it earned and what it could earn. */
export type RadarScoreCheck = { label: string; reading: string; points: number; max: number; status: RadarScoreStatus }

/** One instant disqualifier: the reading against its limit. Any failed gate makes the score 0. */
export type RadarScoreGate = { label: string; reading: string; limit: string; status: 'pass' | 'fail' | 'unknown' }

export type RadarScorePillar = { key: RadarScorePart['key']; label: string; points: number; max: number; checks: RadarScoreCheck[] }

export type RadarScoreCap = { label: string; cap: number; applies: boolean; reading: string }

/** Everything that made the current score: gates, each pillar's rules, adjustments and caps. */
export type RadarScoreLedger = { gates: RadarScoreGate[]; pillars: RadarScorePillar[]; adjustments: RadarScoreCheck[]; caps: RadarScoreCap[]; base: number; beforeCaps: number; score: number; at: number }

/** A moment the score or a gate changed, with what changed. */
export type RadarScoreChange = { t: number; from: number; to: number; reasons: string[] }

/** The score over the last minutes ([time, score] pairs) and the recent changes. */
export type RadarScoreTrail = { points: Array<[number, number]>; changes: RadarScoreChange[] }

/**
 * The early-start reading: signs that show before the price moves (a big crowd for the coin's size, heavy trading for its
 * size, trades and viewers picking up, a young coin, a price still near its 3-minute low), out of 100. `firing` means every
 * sign of the pattern is on and no gate failed; the paper bot does not buy on it.
 */
export type RadarEarlyStart = { score: number; firing: boolean; signs: RadarScoreCheck[]; stretchPct: number | null; fading: string | null; blockedBy: string | null; missing: string[] }

/** One time the early-start pattern was complete, followed for 15 minutes: +50% before -35% wins, -35% first loses. `blockedBy` names the gate that was failing, if one was. */
export type RadarEarlyRecord = { id: number; mint: string; symbol: string; pairAddress: string | null; firedAt: number; price: number; marketCap: number | null; score: number; runnerScore: number | null; peak15m: number | null; low15m: number | null; end15m: number | null; result: 'win' | 'loss' | 'flat' | null; blockedBy: string | null }

/** `fired` to `medianPeak` cover the times no gate was failing; `blocked` counts the times the pattern was complete while a gate held the coin at 0. */
export type RadarEarlySummary = { fired: number; decided: number; wins: number; losses: number; flat: number; medianPeak: number | null; blocked: { fired: number; decided: number; wins: number }; recent: RadarEarlyRecord[]; updatedAt: number }

/** What the coin's risky holders could do to its price, and the instant-exit triggers being watched every second. */
export type RadarSafetyPlan = { level: 'ok' | 'watch' | 'exit'; selling: string[]; bundleDumpPct: number | null; topDumpPct: number | null; triggers: string[]; summary: string }

export type RadarRunnerStats = { marketCap: number | null; liquidity: number | null; holders: number | null; top10: number | null; bundlers: number | null; dev: number | null }

export type RadarRunnerAlert = {
  id: number
  mint: string
  symbol: string
  name: string | null
  pairAddress: string | null
  alertedAt: number
  price: number
  score: number
  threshold: number
  stats: RadarRunnerStats
  thesis: string[]
  edge: string | null
  peak15m: number | null
  peak1h: number | null
  peak4h: number | null
  low10m: number | null
  dumpedAfterMinutes: number | null
  outcome: 'open' | 'false-positive' | 'runner' | 'neither'
  result: 'win' | 'loss' | null
}

export type RadarRunnerPattern = { tag: string; label: string; count: number; falsePositives: number; runners: number; points: number }

export type RadarRunnerSummary = { threshold: number; normalThreshold: number; rollingWinRate: number | null; rollingDecided: number; alerts: RadarRunnerAlert[]; patterns: RadarRunnerPattern[]; updatedAt: number }

/** One of a coin's top holders as the Wallet Score sees it: its stake now and how the coins it held before ended. */
/** `buyInSol` and `profitSol` total the holder's own trades in its earlier coins (`pricedCoins` of them), read from the chain. */
export type RadarWalletHolder = { wallet: string; pct: number; usd: number | null; wins: number; losses: number; verdict: 'good' | 'bad' | 'mixed' | 'new'; whale: boolean; pricedCoins?: number; buyInSol?: number | null; profitSol?: number | null; flips?: number; flipProfitUsd?: number | null }

/** A wallet buying the coin now whose earlier round trips (bought, then sold at least half) made money (scripts/axiom-tracker/flip-traders.ts). */
export type RadarFlipper = { wallet: string; buyUsd: number; flips: number; wins: number; quick: number; putInUsd: number; profitUsd: number; at: number }

/** Who holds the coin and how much: 0–100, 50 when no holder with a real stake has a record yet (scripts/axiom-tracker/wallet-score.ts). */
export type RadarWalletScore = {
  score: number
  holders: number
  known: number
  whales: number
  goodWhales: number
  badWhales: number
  smartUsd: number | null
  smartPct: number
  bestProfitSol?: number | null
  solUsd?: number | null
  ignored: number
  flippersBuying?: number
  flipperBuyUsd?: number
  flippers?: RadarFlipper[]
  buyersSeen?: number
  top: RadarWalletHolder[]
  summary: string
  checkedAt: number | null
  at: number
}

export type RadarGainWindow = 's5' | 's15' | 's30' | 'm1'
export type RadarGainWindows = Record<RadarGainWindow, number | null>

export type RadarToken = {
  mint: string
  pairAddress: string
  symbol: string
  name: string
  imageUrl: string | null
  pairCreatedAt: number
  ageMinutes: number
  socials: RadarSocials
  isBoosted: boolean
  viewers: number | null
  viewersDelta1m: number | null
  viewersDelta5m: number | null
  viewersPct5m: number | null
  history: RadarHistoryPoint[]
  runnerWallets: number
  priceUsd: number | null
  marketCap: number | null
  liquidityUsd: number | null
  volume5m: number | null
  buys5m: number | null
  sells5m: number | null
  buyRatio: number | null
  safety: {
    level: RadarSafetyLevel
    mintAuthority: boolean | null
    freezeAuthority: boolean | null
    top10Pct: number | null
  }
  score: number
  rawScore?: number
  holderRisk?: RadarHolderRisk | null
  scoreCuts?: string[]
  scoreParts?: RadarScorePart[]
  botClimb?: boolean
  researchScore?: number | null
  holderTraits?: RadarHolderTraits | null
  factors: RadarFactor[]
  lastSnapshotAt: number | null
  priceChange: { s5?: number | null; s30: number | null; m1: number | null; m5: number | null; m10: number | null }
  priceChangeSources?: Partial<Record<RadarPriceWindow, RadarPriceWindowSource>>
  spark: { fast: number[]; slow: number[] }
  viewersPerMin: number | null
  viewerSurge: boolean
  holdersChange5m: number | null
  holdersPerMin?: number | null
  gains?: { viewers: RadarGainWindows; holders: RadarGainWindows }
  pulse: RadarPulseMetrics | null
  quality: { score: number | null; checks: RadarQualityCheck[] }
  viewerRank: number | null
  signal: 'buy' | 'watch' | null
  signalReasons: string[]
  alerts: string[]
  pinned: boolean
  onPulse: boolean
  /** The Axiom Discover lists the coin is on in the owner's open tabs. */
  axiomLists?: Array<'trending' | 'surge'>
  outlook?: RadarOutlook | null
  /** The 20-tier archive match: which past tier this coin looks most like, its expected tier and the chance it lands in the worst five. */
  tierMatch?: RadarTierMatch | null
  explode?: RadarExplode | null
  maker?: RadarMaker | null
  advice?: RadarAdvice | null
  safetyPlan?: RadarSafetyPlan | null
  runnerTags?: string[]
  runnerThesis?: string[]
  learnedEdge?: string | null
  dexPaid?: boolean | null
  scoreLedger?: RadarScoreLedger | null
  scoreTrail?: RadarScoreTrail | null
  dex?: RadarDexScore | null
  wallets?: RadarWalletScore | null
  early?: RadarEarlyStart | null
}

export type RadarPaperTrade = {
  id: number
  mint: string
  symbol: string
  pairAddress: string | null
  entryPrice: number
  entryMcap: number | null
  setupScore: number
  return5m: number | null
  return15m: number | null
  return30m: number | null
  status: 'open' | 'win' | 'loss'
  createdAt: number
}

export type RadarModelState = {
  weights: RadarWeights
  winRate: number | null
  sampleCount: number
  updatedAt: number | null
  history: Array<{ updatedAt: number; winRate: number | null; sampleCount: number } & RadarWeights>
}

export type RadarComponentStatus = { component: string; status: string; detail: string | null; updatedAt: number }

export type RadarPulseMetrics = {
  holders: number | null
  devMigrated: number | null
  devCreated: number | null
  top10Pct: number | null
  devPct: number | null
  devSold: boolean
  snipersPct: number | null
  insidersPct: number | null
  bundlersPct: number | null
  feesSol: number | null
  txCount: number | null
  volume: number | null
  marketCap: number | null
  freshPct?: number | null
  proTradersPct?: number | null
  buyCount?: number | null
  sellCount?: number | null
  liquidityUsd?: number | null
  viewers?: number | null
  column?: 'newPairs' | 'finalStretch' | 'migrated'
  seenAt: number
}

export type RadarQualityCheck = { label: string; status: 'pass' | 'warn' | 'fail'; detail: string }

export type RadarWallet = {
  wallet: string
  runnerHits: number
  source: 'holder' | 'early-buyer'
  updatedAt: number
  entries: Array<{ mint: string; symbol: string; pairAddress: string | null; pct: number | null; good: boolean; timestamp: number }>
}

export type RadarPayload = {
  status: 'live' | 'stale' | 'offline'
  message: string | null
  generatedAt: number
  workerSeenAt: number | null
  components: RadarComponentStatus[]
  tokens: RadarToken[]
  kpis: {
    tracked: number
    fastestSurge: { symbol: string; mint: string; delta: number } | null
    runnerSignals: number
    winRate: number | null
    completedTrades: number
  }
  model: RadarModelState
  paper: {
    trades: RadarPaperTrade[]
    stats: { open: number; wins: number; losses: number; winRate: number | null; averageReturn15m: number | null }
    pnl: Array<{ t: number; cumulative: number; symbol: string }>
  }
  settings: RadarSettings
  savedSettings?: RadarSettings | null
  wallets: RadarWallet[]
  walletTracking: 'on' | 'no-key'
  source?: 'local' | 'relay'
  learner?: RadarLearnerSummary | null
  explosions?: RadarExplosionSummary | null
  winners?: RadarWinnersSummary | null
  adviceStudy?: RadarAdviceStudy | null
  runner?: RadarRunnerSummary | null
  early?: RadarEarlySummary | null
}

export type RadarLiveFigures = Pick<RadarToken, 'viewers' | 'viewersPerMin' | 'viewerSurge' | 'priceUsd' | 'marketCap' | 'priceChange' | 'priceChangeSources' | 'gains' | 'holdersPerMin' | 'advice' | 'holderTraits' | 'holderRisk' | 'score' | 'rawScore' | 'scoreCuts' | 'scoreParts' | 'botClimb' | 'alerts' | 'safetyPlan' | 'runnerThesis' | 'learnedEdge' | 'scoreLedger' | 'scoreTrail' | 'dex'>

export type RadarLivePatch = { at: number; tokens: Record<string, RadarLiveFigures> }

export function liveFiguresOf(token: RadarToken): RadarLiveFigures {
  return { viewers: token.viewers, viewersPerMin: token.viewersPerMin, viewerSurge: token.viewerSurge, priceUsd: token.priceUsd, marketCap: token.marketCap, priceChange: token.priceChange, priceChangeSources: token.priceChangeSources, gains: token.gains, holdersPerMin: token.holdersPerMin, advice: token.advice, holderTraits: token.holderTraits, holderRisk: token.holderRisk, score: token.score, rawScore: token.rawScore, scoreCuts: token.scoreCuts, scoreParts: token.scoreParts, botClimb: token.botClimb, alerts: token.alerts, safetyPlan: token.safetyPlan, runnerThesis: token.runnerThesis, learnedEdge: token.learnedEdge, scoreLedger: token.scoreLedger, scoreTrail: token.scoreTrail, dex: token.dex }
}

export function applyLivePatch(payload: RadarPayload, patch: RadarLivePatch): RadarPayload {
  if (patch.at < payload.generatedAt) return payload
  return { ...payload, tokens: payload.tokens.map(token => patch.tokens[token.mint] ? { ...token, ...patch.tokens[token.mint] } : token) }
}

export type RadarWalletEntry = { wallet: string; runnerHits: number; entryMcap: number | null; pct?: number | null; timestamp: number }

export type RadarLivePoint = { t: number; price: number | null; viewers: number | null }

export type RadarTokenDetail = {
  token: RadarToken
  history: RadarHistoryPoint[]
  live: RadarLivePoint[]
  entries: RadarWalletEntry[]
}

export function emptyRadarPayload(message: string, status: RadarPayload['status'] = 'offline'): RadarPayload {
  return {
    status,
    message,
    generatedAt: Date.now(),
    workerSeenAt: null,
    components: [],
    tokens: [],
    kpis: { tracked: 0, fastestSurge: null, runnerSignals: 0, winRate: null, completedTrades: 0 },
    model: { weights: { viewerVelocity: 1, activeViewers: 1, runnerWallets: 1, buyPressure: 1, safety: 1 }, winRate: null, sampleCount: 0, updatedAt: null, history: [] },
    paper: { trades: [], stats: { open: 0, wins: 0, losses: 0, winRate: null, averageReturn15m: null }, pnl: [] },
    settings: defaultRadarSettings,
    wallets: [],
    walletTracking: 'no-key',
  }
}
