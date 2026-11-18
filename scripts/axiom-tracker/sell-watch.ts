/** One reading of a coin's holder shares and price; `source` keeps Pulse-card and on-chain/Jupiter numbers from being compared with each other. */
export type ShareReading = { t: number; source: string; top10: number | null; bundlers: number | null; insiders: number | null; dev: number | null; price: number | null }

export type SellState = { readings: ShareReading[]; alerts: Array<{ text: string; until: number; dev: boolean; severe: boolean }> }

const keepMs = 3 * 60_000
const windowMs = 60_000
const confirmMs = 4_000
const alertHoldMs = 5 * 60_000

/**
 * Only insiders and the dev selling raise alerts. Bundler and top 10 shares falling are not flagged: bundlers often trim to
 * let more buyers in, and the top 10 thins out as a coin runs, so neither costs score points or triggers an exit.
 */
export const sellTriggers = { insiders: 3, dev: 1 }
/** A drop this many times the trigger (or any dev sell) is a dump that zeroes the score; smaller ones only cost points. */
export const severeMultiple = 2

const states = new Map<string, SellState>()

function dropIn(readings: ShareReading[], key: 'insiders' | 'dev', now: number, lookbackMs = windowMs) {
  const source = readings[readings.length - 1]?.source
  const recent = readings.filter(reading => reading.source === source && now - reading.t <= lookbackMs && reading[key] !== null)
  if (recent.length < 2) return null
  const latest = recent[recent.length - 1][key] as number
  const confirmed = recent.filter(reading => now - reading.t <= confirmMs).every(reading => (reading[key] as number) <= latest + 0.5)
  if (!confirmed) return null
  const before = Math.max(...recent.filter(reading => now - reading.t >= confirmMs).map(reading => reading[key] as number), -Infinity)
  if (!Number.isFinite(before)) return null
  const startedAt = recent.find(reading => reading[key] === before)?.t ?? now
  return { from: before, to: latest, drop: before - latest, seconds: Math.max(1, Math.round((now - startedAt) / 1_000)) }
}

const share = (value: number) => `${value < 1 ? value.toFixed(1) : Math.round(value)}%`

/**
 * Watches a coin's holder shares every time they are read (every second while its Pulse card is fresh, every few seconds
 * from the Solana node and Jupiter otherwise) and raises an instant alert when insiders or the dev start
 * selling. An alert holds for 5 minutes so a gap in the readings does not clear it.
 */
export function watchSells(mint: string, reading: ShareReading, now = reading.t): SellState['alerts'] {
  const state = states.get(mint) ?? { readings: [], alerts: [] }
  state.readings.push(reading)
  while (state.readings.length && now - state.readings[0].t > keepMs) state.readings.shift()
  state.alerts = state.alerts.filter(alert => alert.until > now)
  const raise = (text: string, dev = false, severe = dev) => {
    const existing = state.alerts.find(alert => alert.text.split(':')[0] === text.split(':')[0])
    if (existing) { if (severe && !existing.severe) Object.assign(existing, { text, severe, until: now + alertHoldMs }) }
    else state.alerts.push({ text, until: now + alertHoldMs, dev, severe })
  }
  const insiders = dropIn(state.readings, 'insiders', now)
  if (insiders && insiders.drop >= sellTriggers.insiders) raise(`Insiders are selling: ${share(insiders.from)} to ${share(insiders.to)} in ${insiders.seconds}s`, false, insiders.drop >= sellTriggers.insiders * severeMultiple)
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
