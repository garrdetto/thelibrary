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

export type RadarMaker = { chance: number | null; winnerWallets: number; reasons: RadarOutlookReason[]; passes: string[] }

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
  rules: RadarResearchRule[]
  ladder: { start: number; base: number; steps: Array<{ target: number; count: number }> }
  traits: string[]
  story: string[]
  wallets: RadarWinnerWallet[]
  candidates: string[]
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
