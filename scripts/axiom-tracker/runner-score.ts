import type { RadarHolderRisk, RadarSafetyPlan, RadarScoreCap, RadarScoreCheck, RadarScoreGate, RadarScoreLedger, RadarScorePart, RadarScorePillar } from '../../src/lib/axiom-radar-types.js'

/** Step 1: any of these makes the score 0. Percentages of supply. */
export const disqualifyAbove = { dev: 5, top10: 30, bundlers: 35, fresh: 10, snipers: 30, insiders: 30, linked: 30, proTraders: 50 }
export const serialLaunches = 20
export const serialGraduationRate = 0.1
/** A dev with at least this many graduated coins is a prolific launcher, not a serial rugger, however many coins they made. */
export const serialGraduatedEnough = 10
export const deadChartBuyers = 5
/** Each percentage point the top 10 hold above this costs one point. */
export const top10PenaltyFrom = 15
export const unverifiedCap = 45
export const fallingCap = 40
export const learnedLimits = { minimum: -20, maximum: 15 }
/** No early coin earns every point; in a replay of the tracker's history the coins that went on to double reached 60-75. Points are raised by a quarter so that band reads 75-95. */
export const scoreStretch = 1.25
/**
 * Readings that cost points instead of zeroing the score. A ticker earlier coins crashed under is normal during a meta (the
 * one that runs shares its name with a dozen copies), links copied from an older coin are often a shared tweet, and a holder
 * group trimming a couple of points is profit-taking; only a big sell-off (`severeSelling`) still makes it 0.
 */
export const softPenalties = { recycledName: 10, copiedLinks: 6, sellingEach: 8, sellingMax: 16 }
/** A serial launcher (many coins, few graduated) stays visible but cannot rank as a pick. */
export const serialLauncherCap = 40
/**
 * Price movement over the last 5 seconds, 30 seconds, 1 minute and 5 minutes, weighted so the 5-minute move counts most and
 * the 5-second move least. Each change is read against the size of a strong move for that window (a 2% move in 5 seconds is
 * as strong as 30% in 5 minutes) and held to -1..+1, so one spike cannot carry it.
 */
export const movementWindows = [
  { key: 's5', label: '5s', weight: 0.1, strong: 2 },
  { key: 's30', label: '30s', weight: 0.2, strong: 6 },
  { key: 'm1', label: '1m', weight: 0.3, strong: 10 },
  { key: 'm5', label: '5m', weight: 0.4, strong: 30 },
] as const
/** Points a rising coin earns for movement, and the most a falling one loses. */
export const movementPoints = 10

/** The weighted movement from -1 (falling hard in every window) to +1, over the windows that have a reading. */
export function movementSignal(change: RunnerInput['priceChange']) {
  let weighted = 0
  let weights = 0
  const readings: string[] = []
  for (const window of movementWindows) {
    const value = change[window.key]
    if (value === null || value === undefined || !Number.isFinite(value)) continue
    weighted += window.weight * Math.max(-1, Math.min(1, value / window.strong))
    weights += window.weight
    readings.push(`${window.label} ${value > 0 ? '+' : ''}${round1(value)}%`)
  }
  return weights ? { signal: weighted / weights, readings, coverage: weights } : null
}
export const sweetSpots = { early: { low: 8_000, high: 60_000 }, graduated: { low: 30_000, high: 300_000 } }

export type PricePoint = { t: number; price: number }
export type RunnerLinks = { twitter: string | null; telegram: string | null; website: string | null }

export type RunnerInput = {
  now: number
  marketCap: number | null
  liquidity: number | null
  priceChange: { s5?: number | null; s30?: number | null; m1: number | null; m5: number | null }
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
  holdersPerMin?: number | null
  botReason: string | null
  selling: string[]
  /** Sell-offs big enough to zero the score (a group dumping twice the alert size, or the dev selling); the rest of `selling` costs points. Defaults to all of `selling`. */
  severeSelling?: string[]
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
 * The runner score out of 100, ranked on Axiom's own figures. Step 1 gates make it 0 (mint or freeze on, dev over 5%, top 10
 * over 30%, bundlers over 35%, fresh wallets over 10%, dead charts, bot climbs, a big holder sell-off right now); a serial
 * launcher is capped at 40 and a recycled name, copied links or small holder trims cost points. Then holder percentages (20), Axiom demand and growth: viewers, viewer and holder growth a
 * minute, buy share, holders, volume, fees (45), chart and liquidity (25, with movement over 5s, 30s, 1m and 5m weighted toward 5m) and hype (15); a falling move costs up to 10, raised by `scoreStretch`, less one
 * point for each percentage point the top 10 hold above 15%, plus or minus what past alerts taught. `ledger` lists every
 * gate, rule, adjustment and cap with the reading it used.
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
  const serial = created !== null && created >= serialLaunches && migrated / created < serialGraduationRate && migrated < serialGraduatedEnough
  const serialReason = `Serial launcher: the dev made ${Math.round(created ?? 0)} coins and ${Math.round(migrated)} graduated`
  const buyers = input.buyers5m ?? input.buys5m
  const dead = input.volume5m !== null && input.volume5m <= 0 ? 'No volume: dead chart' : buyers !== null && buyers < deadChartBuyers ? `Only ${buyers} buyer${buyers === 1 ? '' : 's'} in 5 minutes: dead chart` : null
  gate('Live chart', [buyers !== null ? `${plural(buyers, 'buyer')} in 5m` : null, input.volume5m !== null ? `${money(input.volume5m)} volume` : null].filter(Boolean).join(', ') || 'not read yet',
    `${deadChartBuyers}+ buyers and some volume in 5m`, input.volume5m === null && buyers === null ? null : dead !== null, dead ?? undefined)
  gate('Bot-driven climb', input.botReason ?? 'none seen', 'no bot pattern', input.botReason !== null, `Bot-driven climb: ${input.botReason}`)
  gate('RugCheck', input.rugged ? 'marked rugged' : 'not marked rugged', 'not rugged', input.rugged, 'RugCheck marked it rugged')
  const severe = input.severeSelling ?? input.selling
  const mildSelling = input.selling.filter(reason => !severe.includes(reason))
  gate('Big holder sell-off now', severe.length ? severe.join('; ') : mildSelling.length ? 'small trims only (cost points)' : 'no sell-off seen', 'no dev sell or group dumping twice the alert size', severe.length > 0)
  for (const reason of severe) disqualified.push(reason)

  const high = recentHigh(input.ticks, input.now)
  const latest = input.ticks.at(-1)?.price ?? null
  const tier = (value: number | null, steps: Array<[boolean, number]>) => value === null ? 0 : steps.find(([passes]) => passes)?.[1] ?? 0

  const bundlePoints = tier(input.bundlers, [[(input.bundlers ?? 99) < 5, 6], [(input.bundlers ?? 99) < 10, 4], [(input.bundlers ?? 99) < 20, 2], [(input.bundlers ?? 99) < 30, 1]])
  const sharpShare = input.snipers === null && input.insiders === null ? null : (input.snipers ?? 0) + (input.insiders ?? 0)
  const sharpPoints = tier(sharpShare, [[(sharpShare ?? 99) <= 5, 5], [(sharpShare ?? 99) <= 10, 3], [(sharpShare ?? 99) <= 20, 1]])
  const devPoints = input.dev !== null && (input.dev < 0.01 || input.devSold) ? 4 : input.dev !== null && input.dev < 2 && !input.devSelling ? 2 : 0
  const freshPoints = tier(input.fresh, [[(input.fresh ?? 99) <= 2, 5], [(input.fresh ?? 99) <= 5, 3], [(input.fresh ?? 99) <= 10, 1]])
  if (input.top10 !== null && input.top10 < 15) tags.push('top10-under-15')
  if (input.bundlers !== null && input.bundlers < 5) tags.push('bundles-under-5')
  if (input.snipers !== null && input.snipers <= 1 && high !== null && latest !== null && latest >= high * 0.7) tags.push('snipers-out')
  if (devPoints === 4) tags.push('dev-zero')
  const distributionChecks = [
    check('Bundlers: under 5% 6, under 10% 4, under 20% 2, under 30% 1', share(input.bundlers), bundlePoints, 6, input.bundlers !== null),
    check('Snipers and insiders together: 5% or less 5, 10% 3, 20% 1', sharpShare === null ? 'not read yet' : `snipers ${share(input.snipers)}, insiders ${share(input.insiders)}`, sharpPoints, 5, sharpShare !== null),
    check('Dev holds none (2 if under 2% and not selling)', input.devSold && input.dev !== null ? 'dev sold out' : `${share(input.dev)}${input.devSelling ? ', selling' : ''}`, devPoints, 4, input.dev !== null),
    check('Fresh wallets: 2% or less 5, 5% 3, 10% 1', share(input.fresh), freshPoints, 5, input.fresh !== null),
  ]
  const distributionDetail = [bundlePoints >= 4 ? `bundlers ${pct(input.bundlers as number)}` : null, sharpPoints >= 3 ? `snipers and insiders ${pct(sharpShare as number)}` : null, devPoints === 4 ? 'dev holds none' : devPoints ? `dev ${pct(input.dev as number)}, not selling` : null, freshPoints >= 3 ? `fresh wallets ${pct(input.fresh as number)}` : null].filter(Boolean)
  const distribution = sum(distributionChecks)

  const viewers = input.viewers
  const viewerPoints = tier(viewers, [[(viewers ?? 0) >= 150, 13], [(viewers ?? 0) >= 100, 11], [(viewers ?? 0) >= 60, 9], [(viewers ?? 0) >= 35, 7], [(viewers ?? 0) >= 20, 5], [(viewers ?? 0) >= 10, 2]])
  const viewerGrowth = input.viewersPerMin
  const viewerGrowthPoints = tier(viewerGrowth, [[(viewerGrowth ?? 0) >= 6, 6], [(viewerGrowth ?? 0) >= 3, 4], [(viewerGrowth ?? 0) >= 1, 2]])
  const holderGrowth = input.holdersPerMin ?? null
  const holderGrowthPoints = tier(holderGrowth, [[(holderGrowth ?? 0) >= 30, 12], [(holderGrowth ?? 0) >= 15, 9], [(holderGrowth ?? 0) >= 8, 6], [(holderGrowth ?? 0) >= 3, 3], [(holderGrowth ?? 0) >= 1, 1]])
  const flow = input.buyVolume5m !== null && input.sellVolume5m !== null && input.buyVolume5m + input.sellVolume5m > 0
    ? input.buyVolume5m / (input.buyVolume5m + input.sellVolume5m)
    : null
  const buyPoints = tier(flow, [[(flow ?? 0) >= 0.6, 5], [(flow ?? 0) > 0.5, 3]])
  const holderPoints = tier(input.holders, [[(input.holders ?? 0) >= 300, 4], [(input.holders ?? 0) >= 100, 2]])
  const volumePoints = tier(input.volume5m, [[(input.volume5m ?? 0) >= 20_000, 3], [(input.volume5m ?? 0) >= 8_000, 2]])
  const feePoints = input.feesSol !== null && input.feesSol > 0.75 ? 2 : 0
  if (viewerGrowthPoints >= 6 && (viewers ?? 0) >= 35) tags.push('viewers-surging')
  if (holderGrowthPoints >= 6) tags.push('holders-growing')
  if (holderPoints) tags.push('holders-100')
  if (feePoints) tags.push('fees-paid')
  if (buyPoints) tags.push('buy-pressure')
  const demandChecks = [
    check('Watching on Axiom: 150+ 13, 100+ 11, 60+ 9, 35+ 7, 20+ 5, 10+ 2', viewers === null ? 'not read yet' : `${viewers.toLocaleString('en-US')} watching`, viewerPoints, 13, viewers !== null),
    check('Viewers gained a minute: +6 6, +3 4, +1 2', viewerGrowth === null ? 'not read yet' : `${signed(viewerGrowth)}/min`, viewerGrowthPoints, 6, viewerGrowth !== null),
    check('Holders gained a minute: +30 12, +15 9, +8 6, +3 3, +1 1', holderGrowth === null ? 'not read yet' : `${signed(holderGrowth)}/min`, holderGrowthPoints, 12, holderGrowth !== null),
    check('Buys outpace sells (5m volume): 60%+ 5, over half 3', flow === null ? 'not read yet' : `${Math.round(flow * 100)}% of ${money((input.buyVolume5m as number) + (input.sellVolume5m as number))} was buying`, buyPoints, 5, flow !== null),
    check('Holders: 300+ 4, 100+ 2', input.holders === null ? 'not read yet' : `${input.holders.toLocaleString('en-US')} holders`, holderPoints, 4, input.holders !== null),
    check('5-minute volume: $20K+ 3, $8K+ 2', input.volume5m === null ? 'not read yet' : money(input.volume5m), volumePoints, 3, input.volume5m !== null),
    check('Fees over 0.75 SOL', input.feesSol === null ? 'not read yet' : `${input.feesSol.toFixed(2)} SOL`, feePoints, 2, input.feesSol !== null),
  ]
  const demandDetail = [viewerPoints >= 7 ? `${(viewers as number).toLocaleString('en-US')} watching` : null, viewerGrowthPoints >= 4 ? `viewers ${signed(viewerGrowth as number)}/min` : null, holderGrowthPoints >= 6 ? `holders ${signed(holderGrowth as number)}/min` : null, buyPoints >= 5 ? 'buyers in control' : null, holderPoints >= 4 ? `${(input.holders as number).toLocaleString('en-US')} holders` : null].filter(Boolean)
  const momentum = sum(demandChecks)

  const waves = waveRecovery(input.ticks)
  if (waves.points >= 15) { tags.push('wave-recovery'); thesis.push(waves.detail) }
  const steps = staircase(input.ticks)
  if (steps.points >= 10) tags.push('staircase')
  const m5 = input.priceChange.m5
  const rising = m5 !== null && m5 >= 10
  const movement = movementSignal(input.priceChange)
  const movementEarned = movement ? Math.max(0, Math.round(movement.signal * movementPoints)) : 0
  const movementCost = movement ? Math.max(0, Math.round(-movement.signal * movementPoints)) : 0
  if (movement && movement.signal >= 0.5) tags.push('moving-up')
  const shapePoints = Math.max(waves.points >= 15 ? 5 : waves.points ? 3 : 0, steps.points >= 10 ? 5 : steps.points ? 3 : 0)
  const shapeDetail = waves.points >= steps.points ? waves.detail : steps.detail
  const inEarlySpot = input.marketCap !== null && input.marketCap >= sweetSpots.early.low && input.marketCap <= sweetSpots.early.high
  const inGraduatedSpot = Boolean(input.graduated) && input.marketCap !== null && input.marketCap >= sweetSpots.graduated.low && input.marketCap <= sweetSpots.graduated.high
  const inSpot = inEarlySpot || inGraduatedSpot
  if (inSpot) tags.push(inGraduatedSpot && !inEarlySpot ? 'sweet-spot-graduated' : 'sweet-spot-early')
  const impact = sellImpact(1, input.marketCap, input.liquidity)
  const depth = impact === null ? 0 : impact < 25 ? 4 : impact < 40 ? 2 : 0
  if (depth === 4) tags.push('deep-liquidity')
  const nearHigh = high !== null && latest !== null && latest >= high * 0.8
  const chartChecks = [
    check(`Moving up, weighted 5s ${movementWindows[0].weight * 100}%, 30s ${movementWindows[1].weight * 100}%, 1m ${movementWindows[2].weight * 100}%, 5m ${movementWindows[3].weight * 100}%`, movement ? `${movement.readings.join(', ')} (${movement.signal >= 0 ? '+' : ''}${Math.round(movement.signal * 100)}% of a strong move)` : 'not read yet', movementEarned, movementPoints, movement !== null),
    check('Steps up or won back a 30-55% pullback (3 if mostly or recovering)', shapeDetail, shapePoints, 5, input.ticks.length > 0),
    check(`Market cap in the sweet spot ($8K-$60K, or $30K-$300K once graduated)`, input.marketCap === null ? 'not read yet' : money(input.marketCap), inSpot ? 4 : 0, 4, input.marketCap !== null),
    check('Deep liquidity: selling 1% moves it under 25% (2 if under 40%)', impact === null ? `liquidity ${input.liquidity === null ? 'not read yet' : money(input.liquidity)}` : `selling 1% of supply moves it about ${impact}% (${money(input.liquidity as number)} liquidity)`, depth, 4, impact !== null),
    check('Holding within 20% of its 10-minute high', high !== null && latest !== null ? `${Math.round((latest / high) * 100)}% of its high` : 'no recent high yet', nearHigh ? 2 : 0, 2, high !== null),
  ]
  const chart = sum(chartChecks)

  const social = socialPoints(input.links, input.reusedLinks)
  tags.push(...social.tags)
  const socialScore = Math.min(5, Math.round(social.points / 2))
  const smartPoints = input.smartHolders >= 2 ? 4 : input.smartHolders === 1 ? 2 : 0
  if (input.smartHolders > 0) tags.push('smart-money')
  if (input.dexPaid) { tags.push('dex-paid'); thesis.push('DexPaid live') }
  const hypeChecks = [
    check('DexPaid', input.dexPaid ? 'paid' : input.dexPaid === false ? 'not paid' : 'not checked yet', input.dexPaid ? 6 : 0, 6, input.dexPaid !== null),
    check('Socials: X account or community 3, tweet 2, Telegram 1, website 1', social.detail, socialScore, 5),
    check('Smart wallets in: 2+ 4, 1 2', plural(input.smartHolders, 'smart wallet'), smartPoints, 4),
  ]
  const hype = sum(hypeChecks)

  const parts: RadarScorePart[] = [
    { key: 'distribution', label: 'Holder percentages', points: distribution, max: 20, detail: distributionDetail.join(', ') || 'Holder percentages high or not read yet', available: input.bundlers !== null || input.dev !== null || input.fresh !== null },
    { key: 'momentum', label: 'Axiom demand & growth', points: momentum, max: 45, detail: demandDetail.join(', ') || 'Few viewers, slow holder growth or sellers in control', available: viewers !== null || input.holders !== null },
    { key: 'chart', label: 'Chart & liquidity', points: chart, max: 25, detail: [shapeDetail, movement ? `moves ${movement.readings.join(', ')}` : rising ? `up ${Math.round(m5 as number)}% in 5 minutes` : null, impact !== null ? `selling 1% of supply would move the price about ${impact}%` : 'liquidity unknown'].filter(Boolean).join('; '), available: input.ticks.length > 0 },
    { key: 'hype', label: 'Hype', points: hype, max: 15, detail: [input.dexPaid ? 'DexPaid' : input.dexPaid === false ? 'not DexPaid' : 'DexPaid not checked yet', social.detail, input.smartHolders ? `${input.smartHolders} smart wallet${input.smartHolders === 1 ? '' : 's'} in` : null].filter(Boolean).join('; '), available: true },
  ]
  const pillars: RadarScorePillar[] = [
    { key: 'distribution', label: parts[0].label, points: distribution, max: 20, checks: distributionChecks },
    { key: 'momentum', label: parts[1].label, points: momentum, max: 45, checks: demandChecks },
    { key: 'chart', label: parts[2].label, points: chart, max: 25, checks: chartChecks },
    { key: 'hype', label: parts[3].label, points: hype, max: 15, checks: hypeChecks },
  ]
  const base = distribution + momentum + hype + chart
  const cuts: string[] = []
  const penalty = input.top10 !== null && input.top10 > top10PenaltyFrom ? Math.round(input.top10 - top10PenaltyFrom) : 0
  const adjustments: RadarScoreCheck[] = [{ label: `Top 10 over ${top10PenaltyFrom}%: one point off per point`, reading: share(input.top10), points: -penalty, max: 0, status: input.top10 === null ? 'unknown' : penalty ? 'missed' : 'earned' }]
  if (penalty) {
    cuts.push(`Top 10 hold ${pct(input.top10 as number)}: -${penalty}`)
    parts.push({ key: 'penalty', label: 'Top 10 over 15%', points: -penalty, max: 0, detail: `One point off for each point above 15% (${pct(input.top10 as number)})`, available: true })
  }
  const recycledCost = input.recycled === null ? 0 : input.recycled.startsWith('Copied links') ? softPenalties.copiedLinks : softPenalties.recycledName
  adjustments.push({ label: `Recycled name -${softPenalties.recycledName}, copied X or website -${softPenalties.copiedLinks}`, reading: input.recycled ?? (input.reusedLinks.length ? `${plural(input.reusedLinks.length, 'shared link')} (Telegram or a tweet, allowed)` : 'original'), points: -recycledCost, max: 0, status: recycledCost ? 'missed' : 'earned' })
  if (recycledCost) {
    cuts.push(`${input.recycled}: -${recycledCost}`)
    parts.push({ key: 'penalty', label: 'Recycled name or links', points: -recycledCost, max: 0, detail: input.recycled as string, available: true })
  }
  const sellingCost = Math.min(softPenalties.sellingMax, mildSelling.length * softPenalties.sellingEach)
  adjustments.push({ label: `Holders trimming: -${softPenalties.sellingEach} each, at most -${softPenalties.sellingMax}`, reading: mildSelling.length ? mildSelling.join('; ') : 'none', points: -sellingCost, max: 0, status: sellingCost ? 'missed' : 'earned' })
  if (sellingCost) {
    cuts.push(...mildSelling.map(reason => `${reason}: -${softPenalties.sellingEach}`))
    parts.push({ key: 'penalty', label: 'Holders trimming', points: -sellingCost, max: 0, detail: mildSelling.join('; '), available: true })
  }
  adjustments.push({ label: `Falling across 5s, 30s, 1m and 5m (5m weighs most): up to -${movementPoints}`, reading: movement ? movement.readings.join(', ') : 'not read yet', points: -movementCost, max: 0, status: movement === null ? 'unknown' : movementCost ? 'missed' : 'earned' })
  if (movementCost) {
    cuts.push(`Falling (${movement?.readings.join(', ')}): -${movementCost}`)
    parts.push({ key: 'penalty', label: 'Price falling', points: -movementCost, max: 0, detail: movement?.readings.join(', ') ?? '', available: true })
  }
  const learnedTotal = input.learned.reduce((total, item) => total + item.points, 0)
  const learned = Math.max(learnedLimits.minimum, Math.min(learnedLimits.maximum, learnedTotal))
  for (const item of input.learned) adjustments.push({ label: `Learned: ${item.label}`, reading: 'pattern seen in past alerts', points: item.points, max: Math.max(0, item.points), status: item.points >= 0 ? 'earned' : 'missed' })
  if (learned !== learnedTotal) adjustments.push({ label: `Learned total held to ${learnedLimits.minimum} to +${learnedLimits.maximum}`, reading: `${signed(learnedTotal)} before the limit`, points: learned - learnedTotal, max: 0, status: 'partial' })
  if (learned) {
    parts.push({ key: 'learned', label: 'Learned from past alerts', points: learned, max: learnedLimits.maximum, detail: input.learned.map(item => `${item.label} ${item.points > 0 ? '+' : ''}${item.points}`).join(', '), available: true })
    cuts.push(...input.learned.filter(item => item.points < 0).map(item => `${item.label}: ${item.points}`))
  }
  const beforeCaps = Math.max(0, Math.min(100, Math.round((base + learned) * scoreStretch - penalty - recycledCost - sellingCost - movementCost)))
  adjustments.push({ label: `Points raised by a quarter (x${scoreStretch}), top 10 deduction not raised`, reading: `${round1(base + learned)} points`, points: round1((base + learned) * (scoreStretch - 1)), max: 0, status: 'earned' })
  let score = beforeCaps
  if (disqualified.length) score = 0
  const unverified = !disqualified.length && input.top10 === null && input.dev === null
  if (unverified) { score = Math.min(score, unverifiedCap); cuts.push(`Holder numbers not read yet (capped at ${unverifiedCap})`) }
  const falling = (input.priceChange.m5 !== null && input.priceChange.m5 <= -25) || (input.priceChange.m1 !== null && input.priceChange.m1 <= -15)
  if (!disqualified.length && falling) { score = Math.min(score, fallingCap); cuts.push(`Falling hard right now (capped at ${fallingCap})`) }
  if (!disqualified.length && serial) { score = Math.min(score, serialLauncherCap); cuts.push(`${serialReason} (capped at ${serialLauncherCap})`) }
  const change = (value: number | null) => value === null ? '?' : `${signed(value)}%`
  const caps: RadarScoreCap[] = [
    { label: 'Any gate failed: scores 0', cap: 0, applies: disqualified.length > 0, reading: disqualified.length ? `${plural(disqualified.length, 'gate')} failed` : 'no gate failed' },
    { label: `Top 10 and dev not read yet: at most ${unverifiedCap}`, cap: unverifiedCap, applies: unverified, reading: input.top10 === null && input.dev === null ? 'not read yet' : 'read' },
    { label: `Serial launcher (${serialLaunches}+ coins, under ${serialGraduationRate * 100}% and under ${serialGraduatedEnough} graduated): at most ${serialLauncherCap}`, cap: serialLauncherCap, applies: !disqualified.length && serial, reading: created === null ? 'dev history not read yet' : `dev made ${Math.round(created)}, ${Math.round(migrated)} graduated` },
    { label: `Falling hard (5m -25% or 1m -15%): at most ${fallingCap}`, cap: fallingCap, applies: !disqualified.length && falling, reading: `1m ${change(input.priceChange.m1)}, 5m ${change(input.priceChange.m5)}` },
  ]
  if (input.holders !== null && input.holders >= 100) thesis.push(`${input.holders.toLocaleString('en-US')} holders`)
  if (holderGrowthPoints >= 6) thesis.push(`holders ${signed(holderGrowth as number)}/min`)
  if (viewerPoints >= 7) thesis.push(`${(viewers as number).toLocaleString('en-US')} watching on Axiom`)
  if (buyPoints >= 5) thesis.push('steady 5m buy pressure')
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
