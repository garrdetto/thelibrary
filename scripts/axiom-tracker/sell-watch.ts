/** One reading of a coin's holder shares and price; `source` keeps Pulse-card and RugCheck/Jupiter numbers from being compared with each other. */
export type ShareReading = { t: number; source: string; top10: number | null; bundlers: number | null; insiders: number | null; dev: number | null; price: number | null }

export type SellState = { readings: ShareReading[]; alerts: Array<{ text: string; until: number; dev: boolean }> }

const keepMs = 3 * 60_000
const windowMs = 60_000
const confirmMs = 4_000
const alertHoldMs = 5 * 60_000

export const sellTriggers = { bundlers: 2, top10: 3, top10PriceDrop: 0.05, insiders: 3, dev: 1 }

const states = new Map<string, SellState>()

function dropIn(readings: ShareReading[], key: 'top10' | 'bundlers' | 'insiders' | 'dev', now: number) {
  const source = readings[readings.length - 1]?.source
  const recent = readings.filter(reading => reading.source === source && now - reading.t <= windowMs && reading[key] !== null)
  if (recent.length < 2) return null
  const latest = recent[recent.length - 1][key] as number
  const confirmed = recent.filter(reading => now - reading.t <= confirmMs).every(reading => (reading[key] as number) <= latest + 0.5)
  if (!confirmed) return null
  const before = Math.max(...recent.filter(reading => now - reading.t >= confirmMs).map(reading => reading[key] as number), -Infinity)
  if (!Number.isFinite(before)) return null
  const startedAt = recent.find(reading => reading[key] === before)?.t ?? now
  return { from: before, to: latest, drop: before - latest, seconds: Math.max(1, Math.round((now - startedAt) / 1_000)) }
}

function priceDrop(readings: ShareReading[], now: number) {
  const prices = readings.filter(reading => now - reading.t <= windowMs && reading.price !== null && reading.price > 0).map(reading => reading.price as number)
  if (prices.length < 2) return 0
  return 1 - prices[prices.length - 1] / Math.max(...prices)
}

const share = (value: number) => `${value < 1 ? value.toFixed(1) : Math.round(value)}%`

/**
 * Watches a coin's holder shares every time they are read (every second while its Pulse card is fresh, every few seconds
 * from RugCheck and Jupiter otherwise) and raises an instant alert when bundlers, the top 10, insiders or the dev start
 * selling. An alert holds for 5 minutes so a gap in the readings does not clear it.
 */
export function watchSells(mint: string, reading: ShareReading, now = reading.t): SellState['alerts'] {
  const state = states.get(mint) ?? { readings: [], alerts: [] }
  state.readings.push(reading)
  while (state.readings.length && now - state.readings[0].t > keepMs) state.readings.shift()
  state.alerts = state.alerts.filter(alert => alert.until > now)
  const raise = (text: string, dev = false) => { if (!state.alerts.some(alert => alert.text.split(':')[0] === text.split(':')[0])) state.alerts.push({ text, until: now + alertHoldMs, dev }) }
  const bundlers = dropIn(state.readings, 'bundlers', now)
  if (bundlers && bundlers.drop >= sellTriggers.bundlers) raise(`Bundlers are selling: ${share(bundlers.from)} to ${share(bundlers.to)} of supply in ${bundlers.seconds}s`)
  const top10 = dropIn(state.readings, 'top10', now)
  const falling = priceDrop(state.readings, now)
  if (top10 && top10.drop >= sellTriggers.top10 && falling >= sellTriggers.top10PriceDrop) raise(`Top holders are selling: top 10 ${share(top10.from)} to ${share(top10.to)} in ${top10.seconds}s, price down ${Math.round(falling * 100)}%`)
  const insiders = dropIn(state.readings, 'insiders', now)
  if (insiders && insiders.drop >= sellTriggers.insiders) raise(`Insiders are selling: ${share(insiders.from)} to ${share(insiders.to)} in ${insiders.seconds}s`)
  const dev = dropIn(state.readings, 'dev', now)
  if (dev && dev.from >= 1 && dev.drop >= sellTriggers.dev) raise(`The dev is selling: ${share(dev.from)} to ${share(dev.to)} in ${dev.seconds}s`, true)
  states.set(mint, state)
  return state.alerts
}

export function forgetSells(keep: Set<string>) {
  for (const mint of states.keys()) if (!keep.has(mint)) states.delete(mint)
}

export function resetSellWatch() {
  states.clear()
}
