import type { RadarHolderRisk, RadarSafetyPlan, RadarScorePart } from '../../src/lib/axiom-radar-types.js'

/** Step 1: any of these makes the score 0. Percentages of supply. */
export const disqualifyAbove = { dev: 5, top10: 25, bundlers: 15, fresh: 10, snipers: 30, insiders: 30, linked: 30 }
export const serialLaunches = 20
export const serialGraduationRate = 0.1
export const deadChartBuyers = 5
/** Each percentage point the top 10 hold above this costs one point. */
export const top10PenaltyFrom = 15
export const unverifiedCap = 45
export const fallingCap = 40
export const learnedLimits = { minimum: -20, maximum: 15 }
export const sweetSpots = { early: { low: 12_000, high: 45_000 }, graduated: { low: 60_000, high: 250_000 } }

export type PricePoint = { t: number; price: number }
export type RunnerLinks = { twitter: string | null; telegram: string | null; website: string | null }

export type RunnerInput = {
  now: number
  marketCap: number | null
  liquidity: number | null
  priceChange: { m1: number | null; m5: number | null }
  ticks: PricePoint[]
  top10: number | null
  dev: number | null
  devSold: boolean
  snipers: number | null
  insiders: number | null
  bundlers: number | null
  linked: number | null
  fresh: number | null
  holders: number | null
  mintAuthority: boolean | null
  freezeAuthority: boolean | null
  rugged: boolean
  devCreated: number | null
  devMigrated: number | null
  recycled: string | null
  buys5m: number | null
  volume5m: number | null
  buyers5m: number | null
  buyVolume5m: number | null
  sellVolume5m: number | null
  feesSol: number | null
  graduated: boolean | null
  dexPaid: boolean | null
  links: RunnerLinks
  reusedLinks: string[]
  smartHolders: number
  viewers: number | null
  viewersPerMin: number | null
  botReason: string | null
  selling: string[]
  devSelling: boolean
  learned: Array<{ tag: string; label: string; points: number }>
}

export type RunnerScore = {
  score: number
  base: number
  parts: RadarScorePart[]
  cuts: string[]
  disqualified: string[]
  holderRisk: RadarHolderRisk
  tags: string[]
  safetyPlan: RadarSafetyPlan
  thesis: string[]
}

const round1 = (value: number) => Math.round(value * 10) / 10
const pct = (value: number) => `${value < 1 ? value.toFixed(1) : Math.round(value)}%`

function minuteCloses(points: PricePoint[]) {
  const closes: PricePoint[] = []
  for (const point of points) {
    const bucket = Math.floor(point.t / 60_000)
    const last = closes[closes.length - 1]
    if (last && Math.floor(last.t / 60_000) === bucket) closes[closes.length - 1] = point
    else closes.push(point)
  }
  return closes
}

/**
 * A pullback of 30-55% from a high that the coin then won back with higher lows: proof of demand beyond the first candle.
 * Full marks when it recovered at least half the drop and two later swing lows are rising; half when it recovered but has
 * not set a higher low yet.
 */
export function waveRecovery(points: PricePoint[]): { points: number; detail: string } {
  const prices = points.filter(point => point.price > 0)
  if (prices.length < 20) return { points: 0, detail: 'Not enough price history yet' }
  let high = prices[0].price
  let best: { depth: number; lowIndex: number; high: number } | null = null
  let lowIndex = 0
  let low = high
  for (let index = 1; index < prices.length; index++) {
    const price = prices[index].price
    if (price > high) {
      high = price
      low = price
      lowIndex = index
      continue
    }
    if (price < low) { low = price; lowIndex = index }
    const depth = 1 - low / high
    if (depth >= 0.3 && depth <= 0.55 && (!best || lowIndex !== best.lowIndex)) best = { depth, lowIndex, high }
  }
  if (!best) return { points: 0, detail: 'No 30-50% pullback survived yet' }
  const after = prices.slice(best.lowIndex)
  const bottom = prices[best.lowIndex].price
  const latest = after[after.length - 1].price
  const recovered = (latest - bottom) / (best.high - bottom)
  if (recovered < 0.5) return { points: 0, detail: `Pulled back ${Math.round(best.depth * 100)}% and has not won it back` }
  const lows = minuteCloses(after).map(point => point.price)
  let higherLows = 0
  for (let index = 2; index < lows.length; index++) if (lows[index - 1] < lows[index - 2] && lows[index - 1] < lows[index] && lows[index - 1] > bottom) higherLows += 1
  const rising = higherLows >= 1 || latest >= best.high
  return rising
    ? { points: 15, detail: `Recovered from a ${Math.round(best.depth * 100)}% pullback with higher lows` }
    : { points: 8, detail: `Recovering from a ${Math.round(best.depth * 100)}% pullback` }
}

/** A climb in steps (most minutes up, no one minute carrying the move) scores; a single vertical candle does not. */
export function staircase(points: PricePoint[]): { points: number; detail: string } {
  const closes = minuteCloses(points.filter(point => point.price > 0)).slice(-12)
  if (closes.length < 5) return { points: 0, detail: 'Needs 5 minutes of price history' }
  const total = closes[closes.length - 1].price - closes[0].price
  if (total <= 0) return { points: 0, detail: 'Not climbing over the last minutes' }
  let up = 0
  let biggest = 0
  let high = closes[0].price
  let deepest = 0
  for (let index = 1; index < closes.length; index++) {
    const step = closes[index].price - closes[index - 1].price
    if (step > 0) up += 1
    biggest = Math.max(biggest, step)
    high = Math.max(high, closes[index].price)
    deepest = Math.min(deepest, closes[index].price / high - 1)
  }
  const upShare = up / (closes.length - 1)
  const biggestShare = biggest / total
  if (upShare >= 0.55 && biggestShare <= 0.5 && deepest > -0.35) return { points: 10, detail: `Stepping up: ${Math.round(upShare * 100)}% of minutes higher, biggest minute ${Math.round(biggestShare * 100)}% of the move` }
  if (upShare >= 0.45 && biggestShare <= 0.65) return { points: 5, detail: `Mostly stepping up, biggest minute ${Math.round(biggestShare * 100)}% of the move` }
  return { points: 0, detail: biggestShare > 0.65 ? `One candle made ${Math.round(biggestShare * 100)}% of the move` : 'Choppy, no staircase' }
}

/** How far the price falls if holders of `share`% of supply sell into the pool at once (constant-product pool, half its liquidity on each side). */
export function sellImpact(share: number, marketCap: number | null, liquidity: number | null) {
  if (!marketCap || !liquidity || marketCap <= 0 || liquidity <= 0 || share <= 0) return null
  const quote = liquidity / 2
  const sold = (share / 100) * marketCap
  return Math.round((1 - (quote / (quote + sold)) ** 2) * 100)
}

const junkSites = /(^|\.)(axiom\.trade|pump\.fun|dexscreener\.com|jup\.ag|x\.com|twitter\.com|t\.me|solscan\.io|birdeye\.so|photon-sol\.tinyastro\.io|gmgn\.ai)$/i

/** Real X account or community, a tweet (a tie-in to news or a meta), a Telegram group and a real website. */
export function socialPoints(links: RunnerLinks, reused: string[]): { points: number; detail: string; tags: string[] } {
  let points = 0
  const notes: string[] = []
  const tags: string[] = []
  const twitter = links.twitter && !reused.includes(links.twitter) ? links.twitter : null
  if (twitter) {
    if (/\/status\/\d+/.test(twitter)) { points += 3; notes.push('links a tweet (news or meta tie-in)'); tags.push('x-tweet') }
    else if (/x\.com\/i\/communities\/|twitter\.com\/i\/communities\//i.test(twitter)) { points += 6; notes.push('X community'); tags.push('x-community') }
    else if (/(x|twitter)\.com\/[A-Za-z0-9_]{2,}\/?(\?.*)?$/i.test(twitter)) { points += 6; notes.push('X account'); tags.push('x-account') }
  }
  if (links.telegram && !reused.includes(links.telegram) && /t\.me\//i.test(links.telegram)) { points += 2; notes.push('Telegram'); tags.push('telegram') }
  if (links.website && !reused.includes(links.website)) {
    try {
      const host = new URL(links.website).hostname
      if (!junkSites.test(host)) { points += 2; notes.push('website'); tags.push('website') }
    } catch {
      notes.push('broken website link')
    }
  }
  if (reused.length) notes.push(`${reused.length} link${reused.length === 1 ? '' : 's'} copied from an older coin`)
  return { points: Math.min(10, points), detail: notes.length ? notes.join(', ') : 'No X, Telegram or website', tags }
}

function recentHigh(points: PricePoint[], now: number) {
  let high = 0
  for (const point of points) if (now - point.t <= 10 * 60_000) high = Math.max(high, point.price)
  return high || null
}

/** The instant-exit triggers and what a sell-off by the risky holders would do to the price. */
export function safetyPlanFor(input: Pick<RunnerInput, 'top10' | 'bundlers' | 'insiders' | 'marketCap' | 'liquidity' | 'selling'>): RadarSafetyPlan {
  const meaningful = (value: number | null) => value !== null && value >= 1 ? value : null
  const bundleDrop = input.bundlers !== null ? meaningful(sellImpact(input.bundlers, input.marketCap, input.liquidity)) : null
  const topDrop = input.top10 !== null ? meaningful(sellImpact(input.top10 / 2, input.marketCap, input.liquidity)) : null
  const triggers: string[] = []
  if (input.bundlers !== null && input.bundlers >= 1) triggers.push(`Get out if the bundler share drops 2 points or more within a minute (now ${pct(input.bundlers)})`)
  if (input.top10 !== null) triggers.push(`Get out if the top 10 share drops 3 points or more within a minute while the price falls (now ${pct(input.top10)})`)
  if (input.insiders !== null && input.insiders >= 3) triggers.push(`Get out if insiders drop 3 points or more within a minute (now ${pct(input.insiders)})`)
  triggers.push('Get out if the dev sells any of their supply')
  const atRisk = (input.bundlers ?? 0) >= 5 || (input.top10 ?? 0) >= 20
  return {
    level: input.selling.length ? 'exit' : atRisk ? 'watch' : 'ok',
    selling: input.selling,
    bundleDumpPct: bundleDrop,
    topDumpPct: topDrop,
    triggers,
    summary: input.selling.length
      ? input.selling[0]
      : atRisk
        ? [input.bundlers !== null && input.bundlers >= 5 && bundleDrop !== null ? `If bundlers sell their ${pct(input.bundlers)}, the price could fall about ${bundleDrop}%` : null, input.top10 !== null && input.top10 >= 20 && topDrop !== null ? `if the top 10 sell half of their ${pct(input.top10)}, about ${topDrop}%` : null].filter(Boolean).join('; ')
        : 'No large holder group could crash it on its own',
  }
}

/**
 * The runner score out of 100 (Step 2 of the rubric): distribution and dump resistance (30), multi-wave momentum and volume
 * (30), hype and attention (25), chart and liquidity health (15), less one point for each percentage point the top 10 hold
 * above 15%, plus or minus what past alerts taught (Step 3). Step 1 disqualifiers, a bot-driven climb, holders selling right
 * now or fresh wallets over 10% make it 0.
 */
export function scoreRunner(input: RunnerInput): RunnerScore {
  const disqualified: string[] = []
  const tags: string[] = []
  const thesis: string[] = []
  if (input.mintAuthority) disqualified.push('Mint authority still enabled')
  if (input.freezeAuthority) disqualified.push('Freeze authority still enabled')
  if (input.dev !== null && input.dev > disqualifyAbove.dev) disqualified.push(`Dev holds ${pct(input.dev)} (limit ${disqualifyAbove.dev}%)`)
  if (input.top10 !== null && input.top10 > disqualifyAbove.top10) disqualified.push(`Top 10 hold ${pct(input.top10)} (limit ${disqualifyAbove.top10}%)`)
  if (input.bundlers !== null && input.bundlers > disqualifyAbove.bundlers) disqualified.push(`Bundlers hold ${pct(input.bundlers)} (limit ${disqualifyAbove.bundlers}%)`)
  if (input.fresh !== null && input.fresh > disqualifyAbove.fresh) disqualified.push(`Fresh wallets hold ${pct(input.fresh)} (limit ${disqualifyAbove.fresh}%)`)
  for (const [key, label] of [['snipers', 'Snipers'], ['insiders', 'Insiders'], ['linked', 'Linked wallet groups']] as const) {
    const value = input[key]
    if (value !== null && value > disqualifyAbove[key]) disqualified.push(`${label} hold ${pct(value)} (limit ${disqualifyAbove[key]}%)`)
  }
  if (input.devCreated !== null && input.devCreated >= serialLaunches && (input.devMigrated ?? 0) / input.devCreated < serialGraduationRate) disqualified.push(`Serial launcher: the dev made ${Math.round(input.devCreated)} coins and ${Math.round(input.devMigrated ?? 0)} graduated`)
  if (input.recycled) disqualified.push(input.recycled)
  const buyers = input.buyers5m ?? input.buys5m
  if (input.volume5m !== null && input.volume5m <= 0) disqualified.push('No volume: dead chart')
  else if (buyers !== null && buyers < deadChartBuyers) disqualified.push(`Only ${buyers} buyer${buyers === 1 ? '' : 's'} in 5 minutes: dead chart`)
  if (input.botReason) disqualified.push(`Bot-driven climb: ${input.botReason}`)
  if (input.rugged) disqualified.push('RugCheck marked it rugged')
  for (const reason of input.selling) disqualified.push(reason)

  const high = recentHigh(input.ticks, input.now)
  const latest = input.ticks.at(-1)?.price ?? null

  const distributionDetail: string[] = []
  let distribution = 0
  if (input.top10 !== null && input.top10 < 15) { distribution += 15; distributionDetail.push(`top 10 ${pct(input.top10)}`); tags.push('top10-under-15') }
  if (input.bundlers !== null && input.bundlers < 5) { distribution += 5; distributionDetail.push(`bundlers ${pct(input.bundlers)}`); tags.push('bundles-under-5') }
  if (input.snipers !== null && input.snipers <= 1 && high !== null && latest !== null && latest >= high * 0.7) { distribution += 5; distributionDetail.push('snipers out, floor held'); tags.push('snipers-out') }
  if (input.dev !== null && (input.dev < 0.01 || input.devSold)) { distribution += 5; distributionDetail.push('dev holds none'); tags.push('dev-zero') }
  else if (input.dev !== null && input.dev < 2 && !input.devSelling) { distribution += 3; distributionDetail.push(`dev ${pct(input.dev)}, not selling`) }

  const waves = waveRecovery(input.ticks)
  if (waves.points >= 15) { tags.push('wave-recovery'); thesis.push(waves.detail) }
  let activity = 0
  const activityDetail: string[] = []
  if (input.holders !== null && input.holders >= 100) { activity += 3; activityDetail.push(`${input.holders.toLocaleString('en-US')} holders`); tags.push('holders-100') }
  if (input.feesSol !== null && input.feesSol > 0.75) { activity += 3; activityDetail.push(`${input.feesSol.toFixed(1)} SOL fees`); tags.push('fees-paid') }
  if (input.buyVolume5m !== null && input.sellVolume5m !== null && input.buyVolume5m > input.sellVolume5m) { activity += 4; activityDetail.push('organic buys outpace sells'); tags.push('buy-pressure') }
  const spot = input.graduated ? sweetSpots.graduated : sweetSpots.early
  const inSpot = input.marketCap !== null && input.marketCap >= spot.low && input.marketCap <= spot.high
  if (inSpot) tags.push(input.graduated ? 'sweet-spot-graduated' : 'sweet-spot-early')
  const momentum = waves.points + activity + (inSpot ? 5 : 0)

  const social = socialPoints(input.links, input.reusedLinks)
  tags.push(...social.tags)
  const attention = Math.max(input.smartHolders >= 2 ? 5 : input.smartHolders === 1 ? 3 : 0, input.viewers !== null && input.viewersPerMin !== null && input.viewers >= 50 && input.viewersPerMin >= 10 ? 5 : 0)
  if (input.smartHolders > 0) tags.push('smart-money')
  if (input.dexPaid) { tags.push('dex-paid'); thesis.push('DexPaid live') }
  const hype = (input.dexPaid ? 10 : 0) + social.points + attention

  const steps = staircase(input.ticks)
  if (steps.points >= 10) tags.push('staircase')
  const impact = sellImpact(1, input.marketCap, input.liquidity)
  const depth = impact === null ? 0 : impact < 25 ? 5 : impact < 40 ? 3 : 0
  if (depth === 5) tags.push('deep-liquidity')
  const chart = steps.points + depth

  const parts: RadarScorePart[] = [
    { key: 'distribution', label: 'Distribution & dump resistance', points: distribution, max: 30, detail: distributionDetail.join(', ') || 'Top 10 over 15%, or holder numbers not read yet', available: input.top10 !== null || input.dev !== null },
    { key: 'momentum', label: 'Multi-wave momentum & volume', points: momentum, max: 30, detail: [waves.detail, activityDetail.join(', '), inSpot ? `market cap in the ${input.graduated ? '$60K-$250K' : '$12K-$45K'} sweet spot` : null].filter(Boolean).join('; '), available: input.ticks.length > 0 },
    { key: 'hype', label: 'Hype & attention', points: hype, max: 25, detail: [input.dexPaid ? 'DexPaid' : input.dexPaid === false ? 'not DexPaid' : 'DexPaid not checked yet', social.detail, attention ? (input.smartHolders ? `${input.smartHolders} smart wallet${input.smartHolders === 1 ? '' : 's'} in` : 'viewers surging') : null].filter(Boolean).join('; '), available: true },
    { key: 'chart', label: 'Chart & liquidity health', points: chart, max: 15, detail: [steps.detail, impact !== null ? `selling 1% of supply would move the price about ${impact}%` : 'liquidity unknown'].join('; '), available: input.ticks.length > 0 },
  ]
  const base = distribution + momentum + hype + chart
  const cuts: string[] = []
  const penalty = input.top10 !== null && input.top10 > top10PenaltyFrom ? Math.round(input.top10 - top10PenaltyFrom) : 0
  if (penalty) {
    cuts.push(`Top 10 hold ${pct(input.top10 as number)}: -${penalty}`)
    parts.push({ key: 'penalty', label: 'Top 10 over 15%', points: -penalty, max: 0, detail: `One point off for each point above 15% (${pct(input.top10 as number)})`, available: true })
  }
  const learned = Math.max(learnedLimits.minimum, Math.min(learnedLimits.maximum, input.learned.reduce((total, item) => total + item.points, 0)))
  if (learned) {
    parts.push({ key: 'learned', label: 'Learned from past alerts', points: learned, max: learnedLimits.maximum, detail: input.learned.map(item => `${item.label} ${item.points > 0 ? '+' : ''}${item.points}`).join(', '), available: true })
    cuts.push(...input.learned.filter(item => item.points < 0).map(item => `${item.label}: ${item.points}`))
  }
  let score = Math.max(0, Math.min(100, Math.round(base - penalty + learned)))
  if (disqualified.length) score = 0
  if (!disqualified.length && input.top10 === null && input.dev === null) { score = Math.min(score, unverifiedCap); cuts.push(`Holder numbers not read yet (capped at ${unverifiedCap})`) }
  const falling = (input.priceChange.m5 !== null && input.priceChange.m5 <= -25) || (input.priceChange.m1 !== null && input.priceChange.m1 <= -15)
  if (!disqualified.length && falling) { score = Math.min(score, fallingCap); cuts.push(`Falling hard right now (capped at ${fallingCap})`) }
  if (input.holders !== null && input.holders >= 100) thesis.push(`${input.holders.toLocaleString('en-US')} holders`)
  if (input.buyVolume5m !== null && input.sellVolume5m !== null && input.buyVolume5m > input.sellVolume5m) thesis.push('steady 5m buy pressure')
  if (steps.points >= 10) thesis.push('stepping up, not one vertical candle')
  return {
    score,
    base: round1(base),
    parts,
    cuts: disqualified.length ? disqualified : cuts,
    disqualified,
    holderRisk: { blocked: disqualified.length > 0, multiplier: disqualified.length ? 0 : 1, reasons: disqualified },
    tags,
    safetyPlan: safetyPlanFor(input),
    thesis,
  }
}
