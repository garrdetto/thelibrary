import type { RadarHolderRisk, RadarScorePart } from '../../src/lib/axiom-radar-types.js'

/** A coin scores low when any of these is exceeded. Percentages of supply. */
export const holderLimits = { top10: 30, dev: 0, fresh: 10, snipers: 10, insiders: 10, bundlers: 10, linked: 10 }

export const moverCaps = { holderLimit: 15, botClimb: 10, rugged: 5, unverified: 45, fewHolders: 40, noGrowthData: 50 }

export type MoverFlowPoint = { t: number; price: number | null; volume5m: number | null; buys5m: number | null; sells5m: number | null }

export type MoverTraits = { top10: number | null; dev: number | null; snipers: number | null; insiders: number | null; bundlers: number | null; linked: number | null; fresh?: number | null }

export type MoverInput = {
  now: number
  ageMinutes: number
  marketCap: number | null
  priceChange: { s30: number | null; m1: number | null; m5: number | null }
  buys5m: number | null
  sells5m: number | null
  volume5m: number | null
  viewers: number | null
  viewersPerMin: number | null
  viewersDelta5m: number | null
  holders: number | null
  holdersPerMin: number | null
  holderChange5mPct: number | null
  smartHolders: number
  traits: MoverTraits | null
  rugged: boolean
  traders5m: number | null
  netBuyers5m: number | null
  flow: MoverFlowPoint[]
}

export type MoverScore = {
  score: number
  base: number
  parts: RadarScorePart[]
  cuts: string[]
  holderRisk: RadarHolderRisk
  botClimb: boolean
  botReason: string | null
}

const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value))
const round1 = (value: number) => Math.round(value * 10) / 10
const signed = (value: number) => `${value >= 0 ? '+' : ''}${Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)}`

function deviation(values: number[]) {
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  return { mean, spread: Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length) }
}

/**
 * Spots a climb that wallets are manufacturing rather than people buying: nearly every trading wallet only ever buys
 * while a handful do all the selling, or minutes of same-sized small buys at a fixed buy share lifting the price with no pullback.
 */
export function detectBotClimb(input: Pick<MoverInput, 'now' | 'ageMinutes' | 'buys5m' | 'sells5m' | 'volume5m' | 'traders5m' | 'netBuyers5m' | 'flow'>): string | null {
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

/** The holder numbers that break a limit, worst first. Any one of them keeps the score low. */
export function holderLimitBreaks(traits: MoverTraits | null) {
  if (!traits) return []
  const breaks: string[] = []
  if (traits.top10 !== null && traits.top10 > holderLimits.top10) breaks.push(`Top 10 wallets hold ${round1(traits.top10)}% (limit ${holderLimits.top10}%)`)
  if (traits.dev !== null && traits.dev > holderLimits.dev && traits.dev >= 0.01) breaks.push(`Dev still holds ${traits.dev < 1 ? traits.dev.toFixed(2) : round1(traits.dev)}%`)
  if (traits.fresh !== null && traits.fresh !== undefined && traits.fresh > holderLimits.fresh) breaks.push(`Fresh wallets hold ${round1(traits.fresh)}% (limit ${holderLimits.fresh}%)`)
  if (traits.snipers !== null && traits.snipers > holderLimits.snipers) breaks.push(`Snipers hold ${round1(traits.snipers)}% (limit ${holderLimits.snipers}%)`)
  if (traits.insiders !== null && traits.insiders > holderLimits.insiders) breaks.push(`Insiders hold ${round1(traits.insiders)}% (limit ${holderLimits.insiders}%)`)
  if (traits.bundlers !== null && traits.bundlers > holderLimits.bundlers) breaks.push(`Bundlers hold ${round1(traits.bundlers)}% (limit ${holderLimits.bundlers}%)`)
  if (traits.linked !== null && traits.linked > holderLimits.linked) breaks.push(`Linked wallet groups hold ${round1(traits.linked)}% (limit ${holderLimits.linked}%)`)
  return breaks
}

function viewerStrength(input: MoverInput) {
  if (input.viewers === null || (input.viewersPerMin === null && input.viewersDelta5m === null)) return null
  const strengths: number[] = []
  if (input.viewersPerMin !== null) {
    const before = Math.max(10, input.viewers - input.viewersPerMin)
    strengths.push(0.5 * clamp(input.viewersPerMin / 20) + 0.5 * clamp(input.viewersPerMin / before / 0.2))
  }
  if (input.viewersDelta5m !== null) {
    const before = Math.max(10, input.viewers - input.viewersDelta5m)
    strengths.push(0.5 * clamp(input.viewersDelta5m / 60) + 0.5 * clamp(input.viewersDelta5m / before / 0.6))
  }
  return Math.max(...strengths)
}

function holderStrength(input: MoverInput) {
  if (input.holders === null || (input.holdersPerMin === null && input.holderChange5mPct === null)) return null
  if (input.holdersPerMin !== null) {
    const before = Math.max(50, input.holders - input.holdersPerMin)
    return 0.5 * clamp(input.holdersPerMin / 30) + 0.5 * clamp(input.holdersPerMin / before / 0.08)
  }
  return clamp((input.holderChange5mPct as number) / 30) * (input.holders >= 100 ? 1 : 0.5)
}

const borrowedShare = 0.7

/** Viewer growth and holder growth are the two crowds. When one count is missing it is estimated from the other at 70%, so a missing number never beats a measured one. */
function crowdParts(input: MoverInput): { viewers: RadarScorePart; holders: RadarScorePart; together: boolean } {
  const viewerMax = 25
  const holderMax = 20
  const watched = viewerStrength(input)
  const held = holderStrength(input)
  const viewerRate = input.viewersPerMin !== null ? `${signed(input.viewersPerMin)} a minute` : input.viewersDelta5m !== null ? `${signed(input.viewersDelta5m)} in 5 minutes` : ''
  const holderRate = input.holdersPerMin !== null ? `${signed(input.holdersPerMin)} a minute` : input.holderChange5mPct !== null ? `${signed(input.holderChange5mPct)}% in 5 minutes` : ''
  const viewers: RadarScorePart = watched !== null
    ? { key: 'viewers', label: 'Viewer growth', points: round1(viewerMax * watched), max: viewerMax, detail: `${input.viewers} watching, ${viewerRate}`, available: true }
    : { key: 'viewers', label: 'Viewer growth', points: held === null ? 0 : round1(viewerMax * held * borrowedShare), max: viewerMax, detail: held === null ? 'No Axiom viewer count' : 'No Axiom viewer count: estimated from holder growth', available: false }
  const holders: RadarScorePart = held !== null
    ? { key: 'holders', label: 'Holder growth', points: round1(holderMax * held), max: holderMax, detail: `${(input.holders as number).toLocaleString('en-US')} holders, ${holderRate}`, available: true }
    : { key: 'holders', label: 'Holder growth', points: watched === null ? 0 : round1(holderMax * watched * borrowedShare), max: holderMax, detail: watched === null ? 'No holder count yet' : 'No holder count yet: estimated from viewer growth', available: false }
  return { viewers, holders, together: watched !== null && held !== null && watched >= 0.4 && held >= 0.4 }
}

function momentumPart(input: MoverInput): RadarScorePart {
  const max = 40
  const { m1, m5, s30 } = input.priceChange
  const buys = input.buys5m ?? 0
  const trades = buys + (input.sells5m ?? 0)
  if (m1 === null && m5 === null && s30 === null && !trades) return { key: 'momentum', label: 'Price and buying', points: 0, max, detail: 'No price trend measured yet', available: false }
  const moves: number[] = []
  if (m1 !== null) moves.push(clamp(m1 / 6))
  if (m5 !== null) moves.push(clamp(m5 / 20))
  if (!moves.length && s30 !== null) moves.push(clamp(s30 / 3))
  const price = moves.length ? moves.reduce((total, value) => total + value, 0) / moves.length : 0
  const pressure = trades >= 20 ? clamp((buys / trades - 0.5) / 0.2) : 0
  const activity = buys >= 40 ? clamp(Math.log10(buys / 40)) : 0
  const shown = [m1 !== null ? `${signed(m1)}% in 1m` : null, m5 !== null ? `${signed(m5)}% in 5m` : null].filter(Boolean).join(', ') || (s30 !== null ? `${signed(s30)}% in 30s` : 'no price change yet')
  return { key: 'momentum', label: 'Price and buying', points: round1(max * (0.6 * price + 0.25 * pressure + 0.15 * activity)), max, detail: `${shown}, ${buys} buys${trades ? ` (${Math.round((buys / trades) * 100)}% of trades)` : ''}`, available: true }
}

function buyerPart(input: MoverInput): RadarScorePart {
  const max = 15
  const points = input.smartHolders >= 3 ? 15 : input.smartHolders === 2 ? 11 : input.smartHolders === 1 ? 6 : 0
  return { key: 'buyers', label: 'Buyers from successful coins', points, max, detail: input.smartHolders ? `${input.smartHolders} holder${input.smartHolders === 1 ? '' : 's'} also held coins that ran` : 'None of its top holders held a coin that ran', available: true }
}

/** Why a coin is not a current mover, with the highest score each reason allows. */
function movementCaps(input: MoverInput) {
  const caps: Array<{ cap: number; reason: string }> = []
  const { m1, m5, s30 } = input.priceChange
  const move = m5 ?? (m1 !== null ? m1 * 2 : s30 !== null ? s30 * 3 : null)
  if (move === null) caps.push({ cap: 50, reason: 'No price trend measured yet' })
  else if (move <= -10) caps.push({ cap: 25, reason: `Falling ${Math.abs(move).toFixed(0)}%` })
  else if (move <= 0) caps.push({ cap: 45, reason: 'Not rising' })
  if (m1 !== null && m1 <= -8 && move !== null && move > 0) caps.push({ cap: 45, reason: `Dropped ${Math.abs(m1).toFixed(0)}% in the last minute` })
  const buys = input.buys5m ?? 0
  const trades = buys + (input.sells5m ?? 0)
  if (buys < 10) caps.push({ cap: 15, reason: 'Almost no buys' })
  else if (buys < 40) caps.push({ cap: 35, reason: `Only ${buys} buys in 5 minutes` })
  if (trades >= 20 && buys / trades < 0.45) caps.push({ cap: 40, reason: 'More sells than buys' })
  if (input.viewers !== null && input.viewersPerMin !== null && input.viewers >= 30 && input.viewersPerMin <= -Math.max(5, input.viewers * 0.1)) caps.push({ cap: 45, reason: `Viewers leaving (${signed(input.viewersPerMin)} a minute)` })
  if (input.ageMinutes > 360) caps.push({ cap: 30, reason: 'Older than 6 hours' })
  if ((input.marketCap ?? 0) > 20_000_000) caps.push({ cap: 20, reason: 'Established large token' })
  return caps
}

/**
 * Scores how strongly a coin is moving right now, out of 100: price with real buying (40), viewer growth (25), holder growth (20)
 * and buyers shared with coins that ran (15), plus 10 when viewers and holders are both growing. Holder limits, manufactured
 * climbs and coins that are not moving cap the result.
 */
export function scoreMover(input: MoverInput): MoverScore {
  const { viewers, holders, together } = crowdParts(input)
  const momentum = momentumPart(input)
  const buyers = buyerPart(input)
  const base = Math.round(clamp(momentum.points + viewers.points + holders.points + buyers.points + (together ? 10 : 0), 0, 100))
  const parts: RadarScorePart[] = [momentum, viewers, holders, buyers]
  if (together) parts.push({ key: 'together', label: 'Viewers and holders rising together', points: 10, max: 10, detail: 'Both crowds are growing at once', available: true })

  const caps = movementCaps(input)
  const breaks = holderLimitBreaks(input.traits)
  for (const reason of breaks) caps.push({ cap: moverCaps.holderLimit, reason })
  const botReason = detectBotClimb(input)
  if (botReason) caps.push({ cap: moverCaps.botClimb, reason: `Bot-driven climb: ${botReason}` })
  if (input.rugged) caps.push({ cap: moverCaps.rugged, reason: 'RugCheck marked it rugged' })
  if (!input.traits || (input.traits.top10 === null && input.traits.dev === null)) caps.push({ cap: moverCaps.unverified, reason: 'Holder numbers not checked yet' })
  if (input.holders !== null && input.holders < 50) caps.push({ cap: moverCaps.fewHolders, reason: `Only ${input.holders} holders` })
  if (!viewers.available && !holders.available) caps.push({ cap: moverCaps.noGrowthData, reason: 'No viewer or holder growth to measure' })
  caps.sort((first, second) => first.cap - second.cap)
  const cap = caps.length ? caps[0].cap : 100
  return {
    score: Math.min(base, cap),
    base,
    parts,
    cuts: caps.filter(entry => entry.cap < base).map(entry => entry.reason),
    holderRisk: { blocked: breaks.length > 0, multiplier: breaks.length ? Math.round((moverCaps.holderLimit / 100) * 100) / 100 : 1, reasons: breaks },
    botClimb: botReason !== null,
    botReason,
  }
}
