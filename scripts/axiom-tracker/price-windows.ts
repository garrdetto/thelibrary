import type { RadarPriceWindow, RadarPriceWindowSource } from '../../src/lib/axiom-radar-types.js'

export type PricedTick = { t: number; price: number | null }

/** Each window and how far from its exact start a reading may sit and still count as that window. */
export const priceWindows: Array<{ key: RadarPriceWindow; ms: number; tolerance: number }> = [
  { key: 's5', ms: 5_000, tolerance: 2_500 },
  { key: 's30', ms: 30_000, tolerance: 6_000 },
  { key: 'm1', ms: 60_000, tolerance: 10_000 },
  { key: 'm5', ms: 300_000, tolerance: 30_000 },
  { key: 'm10', ms: 600_000, tolerance: 45_000 },
]

const percent = (current: number, previous: number) => Math.round(((current - previous) / previous) * 10_000) / 100

/** The longest gap between two readings the price at a window's start may be estimated across. */
export const maxBridgeMs = (windowMs: number) => Math.max(60_000, windowMs * 4)

/** The price at `target` read off the straight line between the last reading before it and the first after it. */
function between(priced: Array<{ t: number; price: number }>, target: number, windowMs: number) {
  let before: { t: number; price: number } | null = null
  let after: { t: number; price: number } | null = null
  for (const tick of priced) {
    if (tick.t <= target) before = tick
    else { after = tick; break }
  }
  if (!before || !after || after.t - before.t > maxBridgeMs(windowMs)) return null
  return before.price + (after.price - before.price) * ((target - before.t) / (after.t - before.t))
}

/**
 * Price change over 5s, 30s, 1m, 5m and 10m for every coin with a price. A window uses the reading nearest its start when
 * there is one (`live`). Otherwise: a reading on each side of the window's start gives the price there on the line between
 * them (`between-readings`); a coin younger than the window shows its change since the first price seen
 * (`since-launch`); the 5-minute window takes DexScreener's own 5-minute change (`dexscreener`); and a coin the tracker
 * only just started following shows its change since the oldest reading it has (`since-tracked`). `sources` names every
 * window that is not `live`.
 */
export function priceWindowChanges(input: { ticks: PricedTick[]; price: number | null; now: number; launchedAt: number | null; dexM5: number | null }) {
  const changes = { s5: null, s30: null, m1: null, m5: null, m10: null } as Record<RadarPriceWindow, number | null>
  const sources: Partial<Record<RadarPriceWindow, RadarPriceWindowSource>> = {}
  const { price, now } = input
  if (price === null || !(price > 0)) return { changes, sources }
  const priced = input.ticks.filter(tick => tick.price !== null && tick.price > 0 && tick.t <= now) as Array<{ t: number; price: number }>
  const earliest = priced[0] ?? null
  for (const window of priceWindows) {
    const target = now - window.ms
    let nearest: { t: number; price: number } | null = null
    for (const tick of priced) {
      const distance = Math.abs(tick.t - target)
      if (distance <= window.tolerance && (!nearest || distance < Math.abs(nearest.t - target))) nearest = tick
    }
    if (nearest) {
      changes[window.key] = percent(price, nearest.price)
      continue
    }
    const estimated = between(priced, target, window.ms)
    if (estimated !== null && estimated > 0) {
      changes[window.key] = percent(price, estimated)
      sources[window.key] = 'between-readings'
      continue
    }
    const younger = input.launchedAt !== null && now - input.launchedAt < window.ms
    if (younger && earliest && now - earliest.t >= 1_000) {
      changes[window.key] = percent(price, earliest.price)
      sources[window.key] = 'since-launch'
      continue
    }
    if (window.key === 'm5' && input.dexM5 !== null && Number.isFinite(input.dexM5)) {
      changes.m5 = Math.round(input.dexM5 * 100) / 100
      sources.m5 = 'dexscreener'
      continue
    }
    if (earliest && earliest.t > target && now - earliest.t >= Math.min(window.ms * 0.4, 20_000)) {
      changes[window.key] = percent(price, earliest.price)
      sources[window.key] = 'since-tracked'
    }
  }
  return { changes, sources }
}
