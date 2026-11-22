export type RadarOutlookReason = { label: string; good: boolean }

export type RadarOutlookPhase = 'early' | 'running' | 'late' | 'overdue'

export type RadarOutlook = {
  runnerChance: number | null
  expectedLifeMinutes: number | null
  minutesLeft: number | null
  expectedPeakMultiple: number | null
  phase: RadarOutlookPhase | null
  similar: number
  reasons: RadarOutlookReason[]
}

/** Where a live coin sits on the 20-tier ladder built from every archived coin (tier 1 = best outcomes, 20 = worst). */
export type RadarTierMatch = {
  tier: number
  expectedTier: number
  risk: number
  score: number
  coins: number
}

export type RadarExplode = {
  chance: number
  learned: boolean
  burstStartedAt: number | null
  startViewers: number | null
  gain: number
  seconds: number
  peakViewers: number | null
  earlyWallets: number
  reasons: RadarOutlookReason[]
}

export type RadarLearnerSummary = {
  ready: boolean
  samples: number
  needed: number
  runners: number
  rugs: number
  watching: number
  runnerRate: number | null
  holdoutAccuracy: number | null
  flaggedHitRate: number | null
  medianLifeMinutes: number | null
  medianTimeToPeakMinutes: number | null
  survival: Array<{ minutes: number; alivePct: number }>
  insights: string[]
  earlyPicks: string[]
  updatedAt: number
}

export type RadarExplosionRecord = {
  mint: string
  symbol: string
  pairAddress: string | null
  startedAt: number
  startViewers: number
  gain: number
  peakViewers: number
  secondsTo100: number | null
  priceMultiple: number | null
}

export type RadarExplosionWallet = { wallet: string; hits: number; coins: Array<{ mint: string; symbol: string; pairAddress: string | null }> }

export type RadarExplosionSummary = {
  ready: boolean
  bursts: number
  exploded: number
  needed: number
  explodeRate: number | null
  holdoutAccuracy: number | null
  flaggedHitRate: number | null
  medianSecondsTo100: number | null
  medianPriceMultiple: number | null
  insights: string[]
  candidates: string[]
  wallets: RadarExplosionWallet[]
  recent: RadarExplosionRecord[]
  updatedAt: number
}

export const radarOutlookPhaseLabels: Record<RadarOutlookPhase, string> = {
  early: 'Early in its run',
  running: 'Mid-run',
  late: 'Near the usual crash time',
  overdue: 'Past the usual crash time',
}

/** How a live coin's chart is climbing right now: minutes since the low it rose from, gain since then, share of 5-minute steps up, and whether it is still making highs. */
export type RadarClimb = { minutes: number; gain: number; upShare: number; rising: boolean; averageVolume5m: number | null; maxLiquidity: number | null }

export type RadarMaker = { chance: number | null; winnerWallets: number; reasons: RadarOutlookReason[]; passes: string[]; climb?: RadarClimb | null; climberLike?: number; climberWallets?: number }

/** A saved steady climber's numbers at one point of its climb (start, 15m, 30m, 60m, 120m, peak). */
export type RadarClimberMilestone = {
  label: string
  minutes: number
  marketCap: number | null
  liquidity: number | null
  volume5m: number | null
  buys5m: number | null
  buyRatio: number | null
  viewers: number | null
  holders: number | null
  top10: number | null
  bundlers: number | null
  insiders: number | null
  snipers: number | null
  fresh: number | null
  dev: number | null
  proTraders: number | null
  walletScore: number | null
  score: number | null
}

/** A coin that rose steadily for an hour or more with real volume and liquidity to $200K or more, kept permanently. */
export type RadarClimber = {
  mint: string
  symbol: string
  pairAddress: string | null
  startAt: number
  peakAt: number
  startMcap: number
  peakMcap: number
  minutes: number
  gain: number
  upShare: number
  averageVolume5m: number | null
  maxLiquidity: number | null
  holdersPeak: number | null
  outcome: string | null
  wallets: number
  milestones: RadarClimberMilestone[]
  shape: Array<number | null>
}

export type RadarResearchRule = { key: string; label: string; winnerRate: number; otherRate: number }

export type RadarEarlyNumbers = { viewers: number | null; buys5m: number | null; volume5m: number | null; marketCap: number | null; ageAtSight: number | null; buyRatio: number | null }

export type RadarWinner = {
  mint: string
  symbol: string
  pairAddress: string | null
  firstSeenAt: number
  firstMcap: number
  peakMcap: number
  multiple: number
  minutesToPeak: number
  status: 'running' | 'crashed' | 'faded' | 'holding'
  lifeMinutes: number | null
  winnerWallets: number
  early: RadarEarlyNumbers
  matched: string[]
  crashKind: string | null
  verdict: 'positive' | 'negative'
  negatives: string[]
  holdersPeak: number | null
  topHoldersPct: number | null
  freshPct?: number | null
}

export type RadarWinnerWallet = { wallet: string; hits: number; averagePct: number | null; coins: Array<{ mint: string; symbol: string; pairAddress: string | null }> }

export type RadarWinnersSummary = {
  ready: boolean
  studied: number
  winners: number
  winnerRate: number | null
  flaggedHitRate: number | null
  minimumMultiple: number
  top: RadarWinner[]
  jumps: RadarWinner[]
  positives: number
  negatives: number
  negativeBreakdown: Array<{ label: string; count: number }>
  separators: string[]
  rules: RadarResearchRule[]
  ladder: { start: number; base: number; steps: Array<{ target: number; count: number }> }
  traits: string[]
  story: string[]
  wallets: RadarWinnerWallet[]
  candidates: string[]
  climbers?: RadarClimber[]
  updatedAt: number
}

export type RadarAdvice = {
  exit: 'hold' | 'tighten' | 'exit'
  exitReasons: string[]
  rebuy: 'ok' | 'wait' | 'never'
  rebuyReasons: string[]
  signs: string[]
  highPrice: number | null
  drawdownPct: number | null
  crashed: boolean
}

export type RadarWarningSign = { key: string; label: string; level: 'exit' | 'tighten' | 'none'; samples: number; fell20Pct: number | null; rose20Pct: number | null; medianNext5mPct: number | null }

export type RadarAdviceStudy = {
  baseline: { samples: number; fell20Pct: number | null; rose20Pct: number | null; medianNext5mPct: number | null }
  signs: RadarWarningSign[]
  rebuy: Array<{ dropPct: number; samples: number; newHighPct: number | null }>
  unknownSharePct: number
  updatedAt: number
}
