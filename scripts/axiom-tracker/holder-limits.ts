import { disqualifyAbove } from './runner-score.js'

/** Holder shares above these make the runner score 0 (Step 1 of the rubric). Percentages of supply. */
export const holderLimits = disqualifyAbove

export type MoverFlowPoint = { t: number; price: number | null; volume5m: number | null; buys5m: number | null; sells5m: number | null }

export type MoverTraits = { top10: number | null; dev: number | null; snipers: number | null; insiders: number | null; bundlers: number | null; linked: number | null; fresh?: number | null }

export type BotClimbInput = { now: number; ageMinutes: number; buys5m: number | null; sells5m: number | null; volume5m: number | null; traders5m: number | null; netBuyers5m: number | null; flow: MoverFlowPoint[] }

const round1 = (value: number) => Math.round(value * 10) / 10

function deviation(values: number[]) {
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  return { mean, spread: Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length) }
}

/**
 * Spots a climb that wallets are manufacturing rather than people buying: nearly every trading wallet only ever buys
 * while a handful do all the selling, or minutes of same-sized small buys at a fixed buy share lifting the price with no pullback.
 */
export function detectBotClimb(input: BotClimbInput): string | null {
  const buys = input.buys5m ?? 0
  const sells = input.sells5m ?? 0
  if (input.traders5m !== null && input.netBuyers5m !== null && input.traders5m >= 50 && input.ageMinutes >= 2) {
    const onlyBuying = input.netBuyers5m / input.traders5m
    const sellerWallets = Math.max(1, input.traders5m - input.netBuyers5m)
    if (onlyBuying >= 0.85) return `${Math.round(onlyBuying * 100)}% of ${input.traders5m} wallets only buy and never sell`
    if (sells >= 40 && sells / sellerWallets >= 8 && onlyBuying >= 0.7) return `${sells} sells came from about ${sellerWallets} wallet${sellerWallets === 1 ? '' : 's'}`
  }
  const recent = input.flow.filter(point => input.now - point.t <= 180_000 && point.price !== null && point.price > 0)
  if (recent.length < 6 || buys + sells < 100) return null
  const traded = recent.filter(point => (point.buys5m ?? 0) + (point.sells5m ?? 0) >= 20 && (point.volume5m ?? 0) > 0)
  if (traded.length < 5) return null
  const sizes = deviation(traded.map(point => (point.volume5m as number) / ((point.buys5m ?? 0) + (point.sells5m ?? 0))))
  const shares = deviation(traded.map(point => (point.buys5m ?? 0) / ((point.buys5m ?? 0) + (point.sells5m ?? 0))))
  const prices = recent.map(point => point.price as number)
  let peak = prices[0]
  let deepestDip = 0
  for (const price of prices) {
    peak = Math.max(peak, price)
    deepestDip = Math.min(deepestDip, price / peak - 1)
  }
  const climb = prices[prices.length - 1] / prices[0] - 1
  const tradeSize = (input.volume5m ?? 0) / (buys + sells)
  const steady = climb >= 0.05 && deepestDip > -0.03 && sizes.mean > 0 && sizes.spread / sizes.mean < 0.1 && shares.spread < 0.025
  if (steady && buys / (buys + sells) >= 0.7 && tradeSize > 0 && tradeSize < 60) return `Steady climb on identical $${Math.round(tradeSize)} buys with no pullback`
  return null
}

/** The holder numbers that break a limit. Any one of them makes the runner score 0. */
export function holderLimitBreaks(traits: MoverTraits | null) {
  if (!traits) return []
  const breaks: string[] = []
  if (traits.top10 !== null && traits.top10 > holderLimits.top10) breaks.push(`Top 10 wallets hold ${round1(traits.top10)}% (limit ${holderLimits.top10}%)`)
  if (traits.dev !== null && traits.dev > holderLimits.dev) breaks.push(`Dev holds ${round1(traits.dev)}% (limit ${holderLimits.dev}%)`)
  if (traits.snipers !== null && traits.snipers > holderLimits.snipers) breaks.push(`Snipers hold ${round1(traits.snipers)}% (limit ${holderLimits.snipers}%)`)
  if (traits.insiders !== null && traits.insiders > holderLimits.insiders) breaks.push(`Insiders hold ${round1(traits.insiders)}% (limit ${holderLimits.insiders}%)`)
  if (traits.bundlers !== null && traits.bundlers > holderLimits.bundlers) breaks.push(`Bundlers hold ${round1(traits.bundlers)}% (limit ${holderLimits.bundlers}%)`)
  if (traits.linked !== null && traits.linked > holderLimits.linked) breaks.push(`Linked wallet groups hold ${round1(traits.linked)}% (limit ${holderLimits.linked}%)`)
  if (typeof traits.fresh === 'number' && traits.fresh > holderLimits.fresh) breaks.push(`Fresh wallets hold ${round1(traits.fresh)}% (limit ${holderLimits.fresh}%)`)
  return breaks
}
