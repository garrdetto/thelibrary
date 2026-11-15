import type { RadarHolderRisk, RadarSafetyPlan, RadarScoreCap, RadarScoreCheck, RadarScoreGate, RadarScoreLedger, RadarScorePart, RadarScorePillar } from '../../src/lib/axiom-radar-types.js'

/** Step 1: any of these makes the score 0. Percentages of supply. */
export const disqualifyAbove = { dev: 5, top10: 25, bundlers: 35, fresh: 10, snipers: 30, insiders: 30, linked: 30, proTraders: 50 }
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
  proTraders: number | null
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
  ledger: RadarScoreLedger
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

const share = (value: number | null) => value === null ? 'not read yet' : pct(value)
const money = (value: number) => value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}K` : `$${Math.round(value)}`
const authority = (value: boolean | null) => value === null ? 'not read yet' : value ? 'enabled' : 'revoked'
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const signed = (value: number) => `${value > 0 ? '+' : ''}${round1(value)}`

function check(label: string, reading: string, points: number, max: number, known = true): RadarScoreCheck {
  return { label, reading, points, max, status: !known ? 'unknown' : points >= max ? 'earned' : points > 0 ? 'partial' : 'missed' }
}

const sum = (checks: RadarScoreCheck[]) => checks.reduce((total, item) => total + item.points, 0)

/**
 * The runner score out of 100 (Step 2 of the rubric): distribution and dump resistance (30), multi-wave momentum and volume
 * (30), hype and attention (25), chart and liquidity health (15), less one point for each percentage point the top 10 hold
 * above 15%, plus or minus what past alerts taught (Step 3). Step 1 disqualifiers, a bot-driven climb, holders selling right
 * now or fresh wallets over 10% make it 0. `ledger` lists every gate, rule, adjustment and cap with the reading it used.
 */
export function scoreRunner(input: RunnerInput): RunnerScore {
  const disqualified: string[] = []
  const gates: RadarScoreGate[] = []
  const tags: string[] = []
  const thesis: string[] = []
  const gate = (label: string, reading: string, limit: string, failed: boolean | null, reason?: string) => {
    gates.push({ label, reading, limit, status: failed === null ? 'unknown' : failed ? 'fail' : 'pass' })
    if (failed && reason) disqualified.push(reason)
  }
  const shareGate = (label: string, value: number | null, limit: number, said: string) =>
    gate(label, share(value), `${limit}% or less`, value === null ? null : value > limit, `${said} ${pct(value ?? 0)} (limit ${limit}%)`)

  gate('Mint authority', authority(input.mintAuthority), 'revoked', input.mintAuthority, 'Mint authority still enabled')
  gate('Freeze authority', authority(input.freezeAuthority), 'revoked', input.freezeAuthority, 'Freeze authority still enabled')
  shareGate('Dev holding', input.dev, disqualifyAbove.dev, 'Dev holds')
  shareGate('Top 10 holders', input.top10, disqualifyAbove.top10, 'Top 10 hold')
  shareGate('Bundlers', input.bundlers, disqualifyAbove.bundlers, 'Bundlers hold')
  shareGate('Fresh wallets', input.fresh, disqualifyAbove.fresh, 'Fresh wallets hold')
  shareGate('Snipers', input.snipers, disqualifyAbove.snipers, 'Snipers hold')
  shareGate('Insiders', input.insiders, disqualifyAbove.insiders, 'Insiders hold')
  shareGate('Linked wallet groups', input.linked, disqualifyAbove.linked, 'Linked wallet groups hold')
  gate('Pro traders holding', share(input.proTraders), `0-${disqualifyAbove.proTraders}%`, input.proTraders === null ? null : input.proTraders > disqualifyAbove.proTraders, `Pro traders hold ${pct(input.proTraders ?? 0)} (limit ${disqualifyAbove.proTraders}%)`)
  const created = input.devCreated
  const migrated = input.devMigrated ?? 0
  gate('Serial launcher', created === null ? 'dev history not read yet' : `dev made ${Math.round(created)}, ${Math.round(migrated)} graduated`, `under ${serialLaunches} launches, or ${serialGraduationRate * 100}%+ graduated`,
    created === null ? null : created >= serialLaunches && migrated / created < serialGraduationRate, `Serial launcher: the dev made ${Math.round(created ?? 0)} coins and ${Math.round(migrated)} graduated`)
  gate('Recycled name or links', input.recycled ?? (input.reusedLinks.length ? `${plural(input.reusedLinks.length, 'shared link')} (Telegram or a tweet, allowed)` : 'original'), 'no crashed name, copied X or website', input.recycled !== null, input.recycled ?? undefined)
  const buyers = input.buyers5m ?? input.buys5m
  const dead = input.volume5m !== null && input.volume5m <= 0 ? 'No volume: dead chart' : buyers !== null && buyers < deadChartBuyers ? `Only ${buyers} buyer${buyers === 1 ? '' : 's'} in 5 minutes: dead chart` : null
  gate('Live chart', [buyers !== null ? `${plural(buyers, 'buyer')} in 5m` : null, input.volume5m !== null ? `${money(input.volume5m)} volume` : null].filter(Boolean).join(', ') || 'not read yet',
    `${deadChartBuyers}+ buyers and some volume in 5m`, input.volume5m === null && buyers === null ? null : dead !== null, dead ?? undefined)
  gate('Bot-driven climb', input.botReason ?? 'none seen', 'no bot pattern', input.botReason !== null, `Bot-driven climb: ${input.botReason}`)
  gate('RugCheck', input.rugged ? 'marked rugged' : 'not marked rugged', 'not rugged', input.rugged, 'RugCheck marked it rugged')
  gate('Holders selling now', input.selling.length ? input.selling.join('; ') : 'no sell-off seen', 'no bundler, top 10, insider or dev sell-off', input.selling.length > 0)
  for (const reason of input.selling) disqualified.push(reason)

  const high = recentHigh(input.ticks, input.now)
  const latest = input.ticks.at(-1)?.price ?? null

  const top10Points = input.top10 !== null && input.top10 < 15 ? 15 : 0
  const bundlePoints = input.bundlers !== null && input.bundlers < 5 ? 5 : 0
  const floorHeld = high !== null && latest !== null && latest >= high * 0.7
  const sniperPoints = input.snipers !== null && input.snipers <= 1 && floorHeld ? 5 : 0
  const devPoints = input.dev !== null && (input.dev < 0.01 || input.devSold) ? 5 : input.dev !== null && input.dev < 2 && !input.devSelling ? 3 : 0
  if (top10Points) tags.push('top10-under-15')
  if (bundlePoints) tags.push('bundles-under-5')
  if (sniperPoints) tags.push('snipers-out')
  if (devPoints === 5) tags.push('dev-zero')
  const distributionChecks = [
    check('Top 10 hold under 15%', share(input.top10), top10Points, 15, input.top10 !== null),
    check('Bundlers under 5%', share(input.bundlers), bundlePoints, 5, input.bundlers !== null),
    check('Snipers out (1% or less) and the floor held', `snipers ${share(input.snipers)}, price ${high !== null && latest !== null ? `${Math.round((latest / high) * 100)}% of its 10-minute high (needs 70%)` : 'has no recent high yet'}`, sniperPoints, 5, input.snipers !== null),
    check('Dev holds none (3 if under 2% and not selling)', input.devSold && input.dev !== null ? 'dev sold out' : `${share(input.dev)}${input.devSelling ? ', selling' : ''}`, devPoints, 5, input.dev !== null),
  ]
  const distributionDetail = [top10Points ? `top 10 ${pct(input.top10 as number)}` : null, bundlePoints ? `bundlers ${pct(input.bundlers as number)}` : null, sniperPoints ? 'snipers out, floor held' : null, devPoints === 5 ? 'dev holds none' : devPoints ? `dev ${pct(input.dev as number)}, not selling` : null].filter(Boolean)
  const distribution = sum(distributionChecks)

  const waves = waveRecovery(input.ticks)
  if (waves.points >= 15) { tags.push('wave-recovery'); thesis.push(waves.detail) }
  const holderPoints = input.holders !== null && input.holders >= 100 ? 3 : 0
  const feePoints = input.feesSol !== null && input.feesSol > 0.75 ? 3 : 0
  const buyPressure = input.buyVolume5m !== null && input.sellVolume5m !== null && input.buyVolume5m > input.sellVolume5m
  if (holderPoints) tags.push('holders-100')
  if (feePoints) tags.push('fees-paid')
  if (buyPressure) tags.push('buy-pressure')
  const spot = input.graduated ? sweetSpots.graduated : sweetSpots.early
  const spotLabel = input.graduated ? '$60K-$250K' : '$12K-$45K'
  const inSpot = input.marketCap !== null && input.marketCap >= spot.low && input.marketCap <= spot.high
  if (inSpot) tags.push(input.graduated ? 'sweet-spot-graduated' : 'sweet-spot-early')
  const momentumChecks = [
    check('Won back a 30-55% pullback with higher lows (8 while recovering)', waves.detail, waves.points, 15, input.ticks.length > 0),
    check('100+ holders', input.holders === null ? 'not read yet' : `${input.holders.toLocaleString('en-US')} holders`, holderPoints, 3, input.holders !== null),
    check('Fees over 0.75 SOL', input.feesSol === null ? 'not read yet' : `${input.feesSol.toFixed(2)} SOL`, feePoints, 3, input.feesSol !== null),
    check('Organic buys outpace sells (5m volume)', input.buyVolume5m === null || input.sellVolume5m === null ? 'not read yet' : `${money(input.buyVolume5m)} bought vs ${money(input.sellVolume5m)} sold`, buyPressure ? 4 : 0, 4, input.buyVolume5m !== null && input.sellVolume5m !== null),
    check(`Market cap in the ${spotLabel} sweet spot${input.graduated ? ' (graduated)' : ''}`, input.marketCap === null ? 'not read yet' : money(input.marketCap), inSpot ? 5 : 0, 5, input.marketCap !== null),
  ]
  const activityDetail = [holderPoints ? `${(input.holders as number).toLocaleString('en-US')} holders` : null, feePoints ? `${(input.feesSol as number).toFixed(1)} SOL fees` : null, buyPressure ? 'organic buys outpace sells' : null].filter(Boolean)
  const momentum = sum(momentumChecks)

  const social = socialPoints(input.links, input.reusedLinks)
  tags.push(...social.tags)
  const smartPoints = input.smartHolders >= 2 ? 5 : input.smartHolders === 1 ? 3 : 0
  const surging = input.viewers !== null && input.viewersPerMin !== null && input.viewers >= 50 && input.viewersPerMin >= 10
  const attention = Math.max(smartPoints, surging ? 5 : 0)
  if (input.smartHolders > 0) tags.push('smart-money')
  if (input.dexPaid) { tags.push('dex-paid'); thesis.push('DexPaid live') }
  const viewerReading = input.viewers === null ? 'viewers not read yet' : `${input.viewers.toLocaleString('en-US')} watching, ${input.viewersPerMin === null ? '?' : signed(input.viewersPerMin)}/min`
  const hypeChecks = [
    check('DexPaid', input.dexPaid ? 'paid' : input.dexPaid === false ? 'not paid' : 'not checked yet', input.dexPaid ? 10 : 0, 10, input.dexPaid !== null),
    check('Socials: X account or community 6, tweet 3, Telegram 2, website 2', social.detail, social.points, 10),
    check('Smart wallets in (2+ = 5, 1 = 3) or viewers surging (50+ watching, +10/min)', `${plural(input.smartHolders, 'smart wallet')}; ${viewerReading}`, attention, 5),
  ]
  const hype = sum(hypeChecks)

  const steps = staircase(input.ticks)
  if (steps.points >= 10) tags.push('staircase')
  const impact = sellImpact(1, input.marketCap, input.liquidity)
  const depth = impact === null ? 0 : impact < 25 ? 5 : impact < 40 ? 3 : 0
  if (depth === 5) tags.push('deep-liquidity')
  const chartChecks = [
    check('Climbing in steps, not one candle (5 if mostly)', steps.detail, steps.points, 10, input.ticks.length > 0),
    check('Deep liquidity: selling 1% moves it under 25% (3 if under 40%)', impact === null ? `liquidity ${input.liquidity === null ? 'not read yet' : money(input.liquidity)}` : `selling 1% of supply moves it about ${impact}% (${money(input.liquidity as number)} liquidity)`, depth, 5, impact !== null),
  ]
  const chart = sum(chartChecks)

  const parts: RadarScorePart[] = [
    { key: 'distribution', label: 'Distribution & dump resistance', points: distribution, max: 30, detail: distributionDetail.join(', ') || 'Top 10 over 15%, or holder numbers not read yet', available: input.top10 !== null || input.dev !== null },
    { key: 'momentum', label: 'Multi-wave momentum & volume', points: momentum, max: 30, detail: [waves.detail, activityDetail.join(', '), inSpot ? `market cap in the ${spotLabel} sweet spot` : null].filter(Boolean).join('; '), available: input.ticks.length > 0 },
    { key: 'hype', label: 'Hype & attention', points: hype, max: 25, detail: [input.dexPaid ? 'DexPaid' : input.dexPaid === false ? 'not DexPaid' : 'DexPaid not checked yet', social.detail, attention ? (input.smartHolders ? `${input.smartHolders} smart wallet${input.smartHolders === 1 ? '' : 's'} in` : 'viewers surging') : null].filter(Boolean).join('; '), available: true },
    { key: 'chart', label: 'Chart & liquidity health', points: chart, max: 15, detail: [steps.detail, impact !== null ? `selling 1% of supply would move the price about ${impact}%` : 'liquidity unknown'].join('; '), available: input.ticks.length > 0 },
  ]
  const pillars: RadarScorePillar[] = [
    { key: 'distribution', label: parts[0].label, points: distribution, max: 30, checks: distributionChecks },
    { key: 'momentum', label: parts[1].label, points: momentum, max: 30, checks: momentumChecks },
    { key: 'hype', label: parts[2].label, points: hype, max: 25, checks: hypeChecks },
    { key: 'chart', label: parts[3].label, points: chart, max: 15, checks: chartChecks },
  ]
  const base = distribution + momentum + hype + chart
  const cuts: string[] = []
  const penalty = input.top10 !== null && input.top10 > top10PenaltyFrom ? Math.round(input.top10 - top10PenaltyFrom) : 0
  const adjustments: RadarScoreCheck[] = [{ label: `Top 10 over ${top10PenaltyFrom}%: one point off per point`, reading: share(input.top10), points: -penalty, max: 0, status: input.top10 === null ? 'unknown' : penalty ? 'missed' : 'earned' }]
  if (penalty) {
    cuts.push(`Top 10 hold ${pct(input.top10 as number)}: -${penalty}`)
    parts.push({ key: 'penalty', label: 'Top 10 over 15%', points: -penalty, max: 0, detail: `One point off for each point above 15% (${pct(input.top10 as number)})`, available: true })
  }
  const learnedTotal = input.learned.reduce((total, item) => total + item.points, 0)
  const learned = Math.max(learnedLimits.minimum, Math.min(learnedLimits.maximum, learnedTotal))
  for (const item of input.learned) adjustments.push({ label: `Learned: ${item.label}`, reading: 'pattern seen in past alerts', points: item.points, max: Math.max(0, item.points), status: item.points >= 0 ? 'earned' : 'missed' })
  if (learned !== learnedTotal) adjustments.push({ label: `Learned total held to ${learnedLimits.minimum} to +${learnedLimits.maximum}`, reading: `${signed(learnedTotal)} before the limit`, points: learned - learnedTotal, max: 0, status: 'partial' })
  if (learned) {
    parts.push({ key: 'learned', label: 'Learned from past alerts', points: learned, max: learnedLimits.maximum, detail: input.learned.map(item => `${item.label} ${item.points > 0 ? '+' : ''}${item.points}`).join(', '), available: true })
    cuts.push(...input.learned.filter(item => item.points < 0).map(item => `${item.label}: ${item.points}`))
  }
  const beforeCaps = Math.max(0, Math.min(100, Math.round(base - penalty + learned)))
  let score = beforeCaps
  if (disqualified.length) score = 0
  const unverified = !disqualified.length && input.top10 === null && input.dev === null
  if (unverified) { score = Math.min(score, unverifiedCap); cuts.push(`Holder numbers not read yet (capped at ${unverifiedCap})`) }
  const falling = (input.priceChange.m5 !== null && input.priceChange.m5 <= -25) || (input.priceChange.m1 !== null && input.priceChange.m1 <= -15)
  if (!disqualified.length && falling) { score = Math.min(score, fallingCap); cuts.push(`Falling hard right now (capped at ${fallingCap})`) }
  const change = (value: number | null) => value === null ? '?' : `${signed(value)}%`
  const caps: RadarScoreCap[] = [
    { label: 'Any gate failed: scores 0', cap: 0, applies: disqualified.length > 0, reading: disqualified.length ? `${plural(disqualified.length, 'gate')} failed` : 'no gate failed' },
    { label: `Top 10 and dev not read yet: at most ${unverifiedCap}`, cap: unverifiedCap, applies: unverified, reading: input.top10 === null && input.dev === null ? 'not read yet' : 'read' },
    { label: `Falling hard (5m -25% or 1m -15%): at most ${fallingCap}`, cap: fallingCap, applies: !disqualified.length && falling, reading: `1m ${change(input.priceChange.m1)}, 5m ${change(input.priceChange.m5)}` },
  ]
  if (input.holders !== null && input.holders >= 100) thesis.push(`${input.holders.toLocaleString('en-US')} holders`)
  if (buyPressure) thesis.push('steady 5m buy pressure')
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
    ledger: { gates, pillars, adjustments, caps, base: round1(base), beforeCaps, score, at: input.now },
  }
}
