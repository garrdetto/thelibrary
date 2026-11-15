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

export function cleanBotValue(dial: BotDial, value: unknown): BotDialValue {
  if (dial.type === 'toggle') return typeof value === 'boolean' ? value : dial.default
  if (dial.type === 'choice') return dial.choices.some(choice => choice[0] === value) ? value as string : dial.default
  if (typeof value !== 'number' || !Number.isFinite(value)) return dial.default
  return Math.min(dial.max, Math.max(dial.min, value))
}

export function normalizeBotValues(input: unknown): BotValues {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return Object.fromEntries(botDials.map(dial => [dial.key, cleanBotValue(dial, source[dial.key])]))
}

export const defaultBotValues: BotValues = normalizeBotValues(null)

/** Only the dials present in `input`, each cleaned; unknown keys are dropped. */
export function cleanBotPatch(input: Record<string, unknown>): BotValues {
  return Object.fromEntries(botDials.filter(dial => dial.key in input).map(dial => [dial.key, cleanBotValue(dial, input[dial.key])]))
}

/** The dials shown first on the Trading bot tab. */
export const botQuickDials = ['risk.strength', 'risk.buy_mode', 'risk.buy_amount_sol', 'risk.max_per_coin_sol', 'entry.signal', 'entry.min_score', 'risk.max_open_positions', 'exit.stop_loss_pct', 'exit.take_profit_pct', 'exit.trailing_stop_pct', 'costs.fee_mode', 'costs.max_fee_sol', 'account.starting_sol']

const balancedStyle: BotValues = Object.fromEntries(
  ['risk.strength', 'entry.signal', 'entry.min_score', 'entry.safety', 'entry.max_failed_checks', 'entry.radar_advice', 'risk.max_open_positions', 'exit.on_tighten', 'exit.left_radar'].map(key => [key, defaultBotValues[key]]),
)

/** Starting points for the dials. Each style sets the same handful of dials and leaves the rest alone. */
export const botPresets: Array<{ id: string; label: string; summary: string; values: BotValues }> = [
  {
    id: 'careful',
    label: 'Careful',
    summary: 'Small bets on the cleanest recommended buys, three coins at most. Sells as soon as the Radar says momentum is fading.',
    values: { ...balancedStyle, 'risk.strength': 3, 'entry.min_score': 75, 'entry.safety': 'safe', 'entry.max_failed_checks': 0, 'risk.max_open_positions': 3, 'exit.on_tighten': 'sell_all', 'exit.left_radar': 'sell' },
  },
  { id: 'balanced', label: 'Balanced', summary: 'The defaults: recommended buys only, modest bets, wide stops, and a tighter stop when momentum fades.', values: balancedStyle },
  {
    id: 'bold',
    label: 'Bold',
    summary: 'Bigger bets on buys and watched coins, up to eight at once, and only the Radar\'s never-rebuy advice blocks a buy. Loses faster when wrong.',
    values: { ...balancedStyle, 'risk.strength': 8, 'entry.signal': 'buy_or_watch', 'entry.min_score': 60, 'entry.max_failed_checks': 2, 'entry.radar_advice': 'never_only', 'risk.max_open_positions': 8 },
  },
]

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
  candidates: Array<{ mint: string; symbol: string; score: number; reason: string }>
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
