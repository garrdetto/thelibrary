import { defaultRadarSettings, type RadarSettings } from './axiom-radar-settings'

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
    rugScore: number | null
    mintAuthority: boolean | null
    freezeAuthority: boolean | null
    top10Pct: number | null
  }
  score: number
  factors: RadarFactor[]
  lastSnapshotAt: number | null
  priceChange: { s30: number | null; m1: number | null; m5: number | null; m10: number | null }
  viewersPerMin: number | null
  viewerSurge: boolean
  holdersChange5m: number | null
  pulse: RadarPulseMetrics | null
  quality: { score: number | null; checks: RadarQualityCheck[] }
  viewerRank: number | null
  signal: 'buy' | 'watch' | null
  signalReasons: string[]
  alerts: string[]
  pinned: boolean
  onPulse: boolean
}

export type RadarPaperTrade = {
  id: number
  mint: string
  symbol: string
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
  seenAt: number
}

export type RadarQualityCheck = { label: string; status: 'pass' | 'warn' | 'fail'; detail: string }

export type RadarWallet = {
  wallet: string
  runnerHits: number
  source: 'holder' | 'early-buyer'
  updatedAt: number
  entries: Array<{ mint: string; symbol: string; pct: number | null; good: boolean; timestamp: number }>
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
