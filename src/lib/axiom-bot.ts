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
}

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
  }
  positions: BotPosition[]
  trades: BotTrade[]
  equity: Array<{ t: number; equity: number }>
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
