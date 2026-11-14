export const radarFeatureKeys = ['viewerVelocity', 'activeViewers', 'runnerWallets', 'buyPressure', 'safety'] as const
export type RadarFeatureKey = typeof radarFeatureKeys[number]
export type RadarWeights = Record<RadarFeatureKey, number>

export const radarFeatureLabels: Record<RadarFeatureKey, string> = {
  viewerVelocity: '5m viewer velocity',
  activeViewers: 'Active viewers',
  runnerWallets: 'Runner wallet entries',
  buyPressure: '5m buy pressure',
  safety: 'RugCheck safety',
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
}

export type RadarWalletEntry = { wallet: string; runnerHits: number; entryMcap: number | null; timestamp: number }

export type RadarTokenDetail = {
  token: RadarToken
  history: RadarHistoryPoint[]
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
  }
}
