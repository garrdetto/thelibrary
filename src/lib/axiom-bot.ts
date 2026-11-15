import schema from '../../scripts/axiom-paper-bot/axiom_paper/dials.json'

export type BotDialValue = number | boolean | string

type BotDialBase = { key: string; label: string; help: string }
export type BotToggleDial = BotDialBase & { type: 'toggle'; default: boolean }
export type BotNumberDial = BotDialBase & { type: 'number'; default: number; min: number; max: number; step: number; unit: string; slider?: boolean }
export type BotChoiceDial = BotDialBase & { type: 'choice'; default: string; choices: Array<[string, string]> }
export type BotDial = BotToggleDial | BotNumberDial | BotChoiceDial
export type BotDialGroup = { id: string; label: string; caption: string }

export type BotValues = Record<string, BotDialValue>
export type BotSettings = { values: BotValues; updatedAt: number | null }

/** The bot's dials, shared with the Python bot (`scripts/axiom-paper-bot/axiom_paper/dials.json`). */
export const botDialGroups = schema.groups as BotDialGroup[]
export const botDials = schema.dials as unknown as BotDial[]
/** New dial key to the old key it replaced, so values saved under the old name carry over. */
const renamedDials = (schema as { renamed?: Record<string, string> }).renamed ?? {}

/** An old key may name another value in braces, as in `mode.{mode.pick_by}_buy_at`. */
function withRenamedDials(source: Record<string, unknown>): Record<string, unknown> {
  const out = { ...source }
  for (const [key, old] of Object.entries(renamedDials)) {
    if (key in out) continue
    const oldKey = old.replace(/\{([^}]+)\}/g, (_, name: string) => String(source[name] ?? 'score'))
    if (oldKey in out) out[key] = out[oldKey]
  }
  return out
}

export function cleanBotValue(dial: BotDial, value: unknown): BotDialValue {
  if (dial.type === 'toggle') return typeof value === 'boolean' ? value : dial.default
  if (dial.type === 'choice') return dial.choices.some(choice => choice[0] === value) ? value as string : dial.default
  if (typeof value !== 'number' || !Number.isFinite(value)) return dial.default
  return Math.min(dial.max, Math.max(dial.min, value))
}

export function normalizeBotValues(input: unknown): BotValues {
  const source = withRenamedDials((input && typeof input === 'object' ? input : {}) as Record<string, unknown>)
  return Object.fromEntries(botDials.map(dial => [dial.key, cleanBotValue(dial, source[dial.key])]))
}

export const defaultBotValues: BotValues = normalizeBotValues(null)

/** Only the dials present in `input`, each cleaned; unknown keys are dropped. */
export function cleanBotPatch(input: Record<string, unknown>): BotValues {
  const source = withRenamedDials(input)
  return Object.fromEntries(botDials.filter(dial => dial.key in source).map(dial => [dial.key, cleanBotValue(dial, source[dial.key])]))
}

/** Starting points for the dials. Each style sets the same handful of dials and leaves the rest alone. */
export const botPresets: Array<{ id: string; label: string; summary: string; values: BotValues }> = [
  {
    id: 'careful',
    label: 'Careful',
    summary: 'Strict safety checks and the Radar\'s own buy call, three coins at most. Sells at +20% unless the chart is still climbing, stop loss at -15%.',
    values: { 'buy.picky': 'strict', 'buy.max_coins': 3, 'sell.target_pct': 20, 'sell.stop_loss_pct': 15, 'sell.ride_momentum': true, 'sell.ride_trail_pct': 8 },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    summary: 'The defaults: any coin that reaches the score with the usual safety checks. Sells at +30% unless momentum is strong, stop loss at -20%.',
    values: { 'buy.picky': 'normal', 'buy.max_coins': 5, 'sell.target_pct': 30, 'sell.stop_loss_pct': 20, 'sell.ride_momentum': true, 'sell.ride_trail_pct': 12 },
  },
  {
    id: 'bold',
    label: 'Bold',
    summary: 'Looser checks and up to eight coins. Aims for +50% and gives coins room: stop loss at -25%, rides momentum with a 15% trail.',
    values: { 'buy.picky': 'loose', 'buy.max_coins': 8, 'sell.target_pct': 50, 'sell.stop_loss_pct': 25, 'sell.ride_momentum': true, 'sell.ride_trail_pct': 15 },
  },
]

/** One thing the bot learned: how coins in one band of one feature did after it saw them. */
export type BotLesson = { feature: string; band: string; seen: number; avgPct: number; winPct: number; timing: boolean }

/** What the bot's learner knows, as it reported it. */
export type BotLearning = {
  enabled: boolean
  timing: boolean
  watched: number
  following: number
  trades: number
  avgPct: number | null
  winPct: number | null
  adjust: number
  recentWinPct: number | null
  recentTrades: number
  minSeen: number
  buyLevel: number
  lessons: BotLesson[]
}

export type BotPosition = {
  id: number
  mint: string
  symbol: string
  pairAddress: string | null
  openedAt: number
  entryPrice: number
  price: number
  costUsd: number
  valueUsd: number
  pnlUsd: number
  pnlPct: number
  gainPct: number
  peakGainPct: number
  openPct: number
  stopPrice: number | null
  targetDone: boolean
  score: number
  /** The Radar's exit advice for the coin: hold, tighten or exit, or `left` once it is off the Radar. */
  advice?: string | null
  /** Past its profit target and held while momentum stays strong. */
  riding?: boolean
  costSol?: number
  valueSol?: number
  pnlSol?: number
}

export type BotTrade = {
  id: number
  mint: string
  symbol: string
  pairAddress: string | null
  openedAt: number
  closedAt: number | null
  costUsd: number
  proceedsUsd: number
  pnlUsd: number
  pnlPct: number
  reason: string | null
  score: number
  holdMinutes: number
  costSol?: number
  proceedsSol?: number
  pnlSol?: number
}

/** The account's amounts in SOL. The bot's money is SOL; the dollar fields are these at the current SOL price. */
export type BotAccountSol = {
  startingCash: number
  cash: number
  positionsValue: number
  equity: number
  exposure: number
  exposureLimit: number
  unrealizedPnl: number
  totalPnl: number
  peakEquity: number
  dayPnl: number
}

export type BotFees = { mode: string; source: string; prioritySol: number; bribeSol: number; totalSol: number }

export type BotReport = {
  version: string
  at: number
  startedAt: number
  status: 'running' | 'paused' | 'holding'
  note: string | null
  feed: { ageSeconds: number | null; live: boolean; coins: number }
  account: {
    startingCash: number
    cash: number
    positionsValue: number
    equity: number
    exposure: number
    exposureLimit: number
    unrealizedPnl: number
    totalPnl: number
    totalPnlPct: number
    peakEquity: number
    drawdownPct: number
    dayPnl: number
    dayPnlPct: number
  }
  accountSol?: BotAccountSol
  solUsd?: number | null
  fees?: BotFees
  stats: {
    trades: number
    wins: number
    losses: number
    winRate: number | null
    realizedPnl: number
    averageReturnPct: number | null
    bestPct: number | null
    worstPct: number | null
    profitFactor: number | null
    averageHoldMinutes: number | null
    feesPaid: number
    realizedPnlSol?: number
    feesPaidSol?: number
  }
  positions: BotPosition[]
  trades: BotTrade[]
  equity: Array<{ t: number; equity: number; sol?: number }>
  events: Array<{ id: number; t: number; kind: string; text: string }>
  candidates: Array<{ mint: string; symbol: string; score: number; dex?: number | null; reason: string }>
  learning?: BotLearning
  strength: number
  settingsStamp: number
}

export type BotCommand = { flatten: number; reset: number }

export type BotView = {
  settings: BotSettings
  report: BotReport | null
  reportedAt: number | null
  online: boolean
  command: BotCommand
  now: number
}
