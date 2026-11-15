import type { RadarHolderTraits, RadarComponentStatus, RadarHistoryPoint, RadarModelState, RadarPaperTrade, RadarPayload, RadarSocials, RadarToken, RadarTokenDetail, RadarWallet, RadarWalletEntry, RadarWeights } from '../../src/lib/axiom-radar-types.js'
import type { RadarSettings } from '../../src/lib/axiom-radar-settings.js'
import { marketTicks, tickAt, type MarketTick } from './live-market.js'
import { assessQuality } from './pulse-cards.js'
import { radarSettings } from './settings-store.js'
import { learnerState, withLearning } from './learner-state.js'
import { activeBotClimb, botClimbHoldMs, freshViewerCount, trackerState } from './state.js'
import type { TrackerDatabase } from './db.js'
import { defaultWeights, radarThresholds, safetyLevel, scoreSetup, viewerDeltas } from './model.js'
import { jupiterReading } from './jupiter.js'
import { detectBotClimb } from './holder-limits.js'
import { scoreRunner, type PricePoint, type RunnerLinks } from './runner-score.js'
import { learnedEdge, learnedFor, runnerState } from './runner-state.js'
import { forgetSells, watchSells } from './sell-watch.js'
import { forgetScoreTrails, recordScore, scoreTrailFor } from './score-trail.js'
import { chartHistory, withChartHistory } from './chart-history.js'
import { pageStatsAt } from './page-stats.js'
import { rankHolderWallets } from './wallet-ranking.js'

const detailWindowMs = 6 * 60 * 60 * 1000
const activeWindowMs = 90_000
const historyWindowMs = 16 * 60_000

type TokenRow = {
  mint: string
  pair_address: string
  symbol: string
  name: string
  image_url: string | null
  pair_created_at: number
  socials_json: string
  rug_score: number | null
  mint_auth: number | null
  freeze_auth: number | null
  top10_pct: number | null
  is_boosted: number
  holders_total: number | null
  dev_pct: number | null
  insider_pct: number | null
  rugged: number | null
  traits_checked_at: number | null
  fresh_pct?: number | null
  links_json?: string | null
  graduated?: number | null
  dex_paid?: number | null
}

type SnapshotRow = {
  mint: string
  viewers: number | null
  price_usd: number | null
  market_cap: number | null
  liquidity_usd: number | null
  volume_5m: number | null
  buys_5m: number | null
  sells_5m: number | null
  timestamp: number
}

type WeightsRow = {
  w_viewer_velocity: number
  w_active_viewers: number
  w_runner_wallets: number
  w_buy_pressure: number
  w_safety: number
  win_rate: number | null
  sample_count: number
  updated_at: number
}

type PaperRow = {
  id: number
  mint: string
  symbol: string
  pair_address: string | null
  entry_price: number
  entry_mcap: number | null
  setup_score: number
  price_5m: number | null
  price_15m: number | null
  price_30m: number | null
  status: 'open' | 'win' | 'loss'
  created_at: number
}

const flag = (value: number | null) => value === null ? null : value === 1

function weightsFromRow(row: WeightsRow | undefined): RadarWeights {
  if (!row) return { ...defaultWeights }
  return { viewerVelocity: row.w_viewer_velocity, activeViewers: row.w_active_viewers, runnerWallets: row.w_runner_wallets, buyPressure: row.w_buy_pressure, safety: row.w_safety }
}

function parseSocials(value: string): RadarSocials {
  try {
    const parsed = JSON.parse(value) as Partial<RadarSocials>
    return { twitter: parsed.twitter ?? null, telegram: parsed.telegram ?? null, website: parsed.website ?? null }
  } catch {
    return { twitter: null, telegram: null, website: null }
  }
}

export function loadModelState(database: TrackerDatabase): RadarModelState {
  const rows = database.prepare('SELECT * FROM model_weights ORDER BY id DESC LIMIT 40').all() as WeightsRow[]
  const latest = rows[0]
  return {
    weights: weightsFromRow(latest),
    winRate: latest?.win_rate ?? null,
    sampleCount: latest?.sample_count ?? 0,
    updatedAt: latest?.updated_at ?? null,
    history: rows.slice().reverse().map(row => ({ updatedAt: row.updated_at, winRate: row.win_rate, sampleCount: row.sample_count, ...weightsFromRow(row) })),
  }
}

function runnerCounts(database: TrackerDatabase, mints: string[]) {
  const counts = new Map<string, number>()
  if (!mints.length) return counts
  const minHits = radarSettings().wallets.minRunnerHits
  const list = JSON.stringify(mints)
  const buyers = database.prepare(`
    SELECT we.mint, COUNT(*) AS count FROM wallet_entries we
    JOIN smart_wallets sw ON sw.wallet = we.wallet
    WHERE sw.runner_hits >= ? AND we.mint IN (SELECT value FROM json_each(?))
    GROUP BY we.mint
  `).all(minHits, list) as Array<{ mint: string; count: number }>
  const holders = database.prepare(`
    SELECT h.mint, COUNT(*) AS count FROM holders h
    WHERE h.mint IN (SELECT value FROM json_each(?))
      AND (SELECT COUNT(*) FROM holders other JOIN good_coins g ON g.mint = other.mint WHERE other.wallet = h.wallet AND other.mint <> h.mint) >= ?
    GROUP BY h.mint
  `).all(list, minHits) as Array<{ mint: string; count: number }>
  for (const row of [...buyers, ...holders]) counts.set(row.mint, (counts.get(row.mint) ?? 0) + row.count)
  return counts
}

function toHistory(rows: SnapshotRow[]): RadarHistoryPoint[] {
  return rows.map(row => ({ t: row.timestamp, viewers: row.viewers, marketCap: row.market_cap, priceUsd: row.price_usd }))
}

function percentChange(current: number | null, previous: number | null) {
  return current !== null && previous !== null && previous > 0 ? Math.round(((current - previous) / previous) * 10_000) / 100 : null
}

function viewerGainPerMinute(ticks: MarketTick[], viewers: number | null, now: number) {
  if (viewers === null) return null
  const minuteAgo = tickAt(ticks, now - 60_000, 8_000, 'viewers')
  if (minuteAgo !== null) return viewers - minuteAgo
  const earliest = ticks.find(tick => tick.viewers !== null && now - tick.t <= 60_000)
  if (!earliest || earliest.viewers === null || now - earliest.t < 20_000) return null
  return Math.round(((viewers - earliest.viewers) * 60_000) / (now - earliest.t))
}

function holderGainPerMinute(ticks: MarketTick[], holders: number | null, now: number) {
  if (holders === null) return null
  const earliest = ticks.find(tick => tick.holders !== null && now - tick.t <= 300_000)
  if (!earliest || now - earliest.t < 45_000) return null
  return Math.round(((holders - (earliest.holders as number)) / ((now - earliest.t) / 60_000)) * 10) / 10
}

function liveFigures(mint: string, now: number) {
  const ticks = marketTicks.get(mint) ?? []
  const latest = ticks.at(-1)
  const price = latest?.price ?? null
  const viewers = freshViewerCount(mint, now)
  const card = trackerState.pulseCards.get(mint)
  const pulse = card && now - card.seenAt < 120_000 ? card : null
  const minuteAgo = tickAt(ticks, now - 60_000, 8_000, 'viewers')
  const fiveMinutesAgo = tickAt(ticks, now - 300_000, 25_000, 'viewers')
  const holdersBefore = tickAt(ticks, now - 300_000, 40_000, 'holders')
  const gainOver = (field: 'viewers' | 'holders', current: number | null, spanMs: number, tolerance: number) => {
    const before = current === null ? null : tickAt(ticks, now - spanMs, tolerance, field)
    return current === null || before === null ? null : current - before
  }
  const gainsFor = (field: 'viewers' | 'holders', current: number | null) => ({ s5: gainOver(field, current, 5_000, 2_000), s15: gainOver(field, current, 15_000, 3_000), s30: gainOver(field, current, 30_000, 4_000), m1: gainOver(field, current, 60_000, 8_000) })
  return {
    price,
    viewers,
    pulse,
    market: trackerState.market.get(mint) ?? null,
    priceChange: {
      s30: percentChange(price, tickAt(ticks, now - 30_000, 4_000, 'price')),
      m1: percentChange(price, tickAt(ticks, now - 60_000, 6_000, 'price')),
      m5: percentChange(price, tickAt(ticks, now - 300_000, 20_000, 'price')),
      m10: percentChange(price, tickAt(ticks, now - 600_000, 30_000, 'price')),
    },
    liquidityChange1m: percentChange(latest?.liquidity ?? null, tickAt(ticks, now - 60_000, 6_000, 'liquidity')),
    viewersPerMin: viewerGainPerMinute(ticks, viewers, now),
    viewersDelta1m: viewers !== null && minuteAgo !== null ? viewers - minuteAgo : null,
    viewersDelta5m: viewers !== null && fiveMinutesAgo !== null ? viewers - fiveMinutesAgo : null,
    holdersChange5m: pulse?.holders !== null && pulse?.holders !== undefined && holdersBefore !== null ? pulse.holders - holdersBefore : null,
    holdersPerMin: holderGainPerMinute(ticks, pulse?.holders ?? null, now),
    gains: { viewers: gainsFor('viewers', viewers), holders: gainsFor('holders', pulse?.holders ?? null) },
  }
}

const sparkPrice = (price: number) => Number(price.toPrecision(6))

/** Price series for chart previews: `fast` is one point a second for the last minute, `slow` one every 5 seconds for 10 minutes. */
function sparkSeries(ticks: MarketTick[], now: number) {
  const fast: number[] = []
  const slow: number[] = []
  let bucket = -1
  for (const tick of ticks) {
    if (tick.price === null) continue
    if (now - tick.t <= 60_000) fast.push(sparkPrice(tick.price))
    const current = Math.floor(tick.t / 5_000)
    if (current === bucket) slow[slow.length - 1] = sparkPrice(tick.price)
    else { slow.push(sparkPrice(tick.price)); bucket = current }
  }
  return { fast: fast.slice(-60), slow: slow.slice(-120) }
}

type BuiltToken = { token: RadarToken; liquidityChange1m: number | null }

const surgeLevels = { 1: { gain: 8, percent: 15, sigma: 2 }, 2: { gain: 5, percent: 10, sigma: 1.5 }, 3: { gain: 3, percent: 6, sigma: 1 } } as const

function classify(token: RadarToken, settings: RadarSettings, liquidityChange1m: number | null) {
  const alerts: string[] = []
  if (liquidityChange1m !== null && liquidityChange1m <= -30) alerts.push(`Liquidity fell ${Math.abs(liquidityChange1m).toFixed(0)}% in 1m`)
  if (token.priceChange.s30 !== null && token.priceChange.s30 <= -20) alerts.push(`Price dumped ${Math.abs(token.priceChange.s30).toFixed(0)}% in 30s`)
  if (token.safety.mintAuthority) alerts.push('Mint authority still enabled')
  if (token.safety.freezeAuthority) alerts.push('Freeze authority still enabled')
  if (token.holderTraits?.rugged) alerts.push('RugCheck marked it rugged')
  for (const selling of token.safetyPlan?.selling ?? []) alerts.push(selling)
  const redFlags = token.quality.checks.filter(check => check.status === 'fail').map(check => check.label)
  const buyRules = settings.buy
  const buyChecks: Array<[boolean, string]> = [
    [token.score >= buyRules.minScore, `Score ${token.score} (need ${buyRules.minScore})`],
    [(token.priceChange.m1 ?? -Infinity) >= buyRules.minGain1mPercent, `Up ${token.priceChange.m1?.toFixed(1)}% in 1m`],
    [(token.priceChange.m5 ?? -Infinity) >= buyRules.minGain5mPercent, `Up ${token.priceChange.m5?.toFixed(1)}% in 5m`],
    [(token.viewers ?? 0) >= buyRules.minViewers, `${token.viewers ?? 0} watching on Axiom`],
  ]
  if (buyRules.requireSafe) buyChecks.push([redFlags.length === 0 && token.safety.level !== 'risky', 'No red flags'])
  if (token.holderRisk?.blocked || token.botClimb) return { signal: null, reasons: [] as string[], alerts }
  const rising = (token.priceChange.m5 ?? (token.priceChange.m1 !== null ? token.priceChange.m1 * 2 : null) ?? 0) > 0 && (token.buys5m ?? 0) >= 40 && (token.buyRatio ?? 0) >= 0.45 && token.ageMinutes <= 360 && (token.marketCap ?? 0) <= 20_000_000
  if (!rising) return { signal: null, reasons: [] as string[], alerts }
  if (!alerts.length && buyChecks.every(([passed]) => passed)) {
    const reasons = buyChecks.map(([, reason]) => reason)
    if (token.viewerSurge) reasons.push('Gaining viewers quickly')
    return { signal: 'buy' as const, reasons, alerts }
  }
  const watchReasons: string[] = []
  if (token.viewerSurge) watchReasons.push(`Gaining viewers quickly (+${token.viewersPerMin}/min)`)
  if (token.score >= settings.watch.minScore) watchReasons.push(`Score ${token.score}`)
  if ((token.priceChange.m5 ?? -Infinity) >= settings.watch.minGain5mPercent) watchReasons.push(`Up ${token.priceChange.m5?.toFixed(1)}% in 5m`)
  if (token.runnerWallets > 0) watchReasons.push(`${token.runnerWallets} smart holder${token.runnerWallets === 1 ? '' : 's'}`)
  if (!watchReasons.length) return { signal: null, reasons: [] as string[], alerts }
  if (redFlags.length) watchReasons.push(`Red flags: ${redFlags.join(', ')}`)
  if (alerts.length) watchReasons.push('Has warnings: check before buying')
  return { signal: 'watch' as const, reasons: watchReasons, alerts }
}

function finalize(entries: BuiltToken[], settings: RadarSettings) {
  const level = surgeLevels[settings.surgeSensitivity]
  const gains = entries.map(entry => entry.token.viewersPerMin).filter((gain): gain is number => gain !== null)
  const mean = gains.length ? gains.reduce((total, gain) => total + gain, 0) / gains.length : 0
  const deviation = gains.length ? Math.sqrt(gains.reduce((total, gain) => total + (gain - mean) ** 2, 0) / gains.length) : 0
  for (const { token, liquidityChange1m } of entries) {
    const gain = token.viewersPerMin
    if (gain !== null && gain >= level.gain) {
      const before = Math.max(1, (token.viewers ?? 0) - gain)
      const outlier = gains.length >= 5 && gain >= mean + level.sigma * deviation && gain >= level.gain * 2
      token.viewerSurge = (gain / before) * 100 >= level.percent || outlier
    }
    const verdict = classify(token, settings, liquidityChange1m)
    token.signal = verdict.signal
    token.signalReasons = verdict.reasons
    token.alerts = verdict.alerts
  }
  const tokens = entries.map(entry => entry.token)
  tokens.filter(token => token.viewers !== null).sort((first, second) => (second.viewers ?? 0) - (first.viewers ?? 0)).forEach((token, index) => { token.viewerRank = index + 1 })
  return tokens
}

const traitsCache = new Map<string, { at: number; traits: RadarHolderTraits | null }>()
let lifecycleTableKnown = false

/** The current holder numbers for one coin: the Pulse card while it is fresh, then Axiom's own coin page read in the last two minutes, otherwise the highest of an older page reading and the latest RugCheck and Jupiter readings, then the last card or the worst numbers on record. */
function holderTraitsFor(database: TrackerDatabase, token: TokenRow, now: number): RadarHolderTraits | null {
  const cached = traitsCache.get(token.mint)
  if (cached && now - cached.at < 2_000) return cached.traits
  if (!lifecycleTableKnown) lifecycleTableKnown = Boolean(database.prepare("SELECT 1 FROM pragma_table_info('coin_lifecycles') WHERE name = 'traits_json'").get())
  const stored = lifecycleTableKnown ? database.prepare('SELECT traits_json FROM coin_lifecycles WHERE mint = ?').get(token.mint) as { traits_json: string | null } | undefined : undefined
  const worst = stored?.traits_json ? JSON.parse(stored.traits_json) as Partial<Record<'top10' | 'dev' | 'snipers' | 'insiders' | 'bundlers' | 'linked' | 'fresh', number | null>> : null
  const card = trackerState.pulseCards.get(token.mint)
  const fresh = card && now - card.seenAt < 120_000 ? card : null
  const cardDev = (source: typeof card | null) => source ? (source.devSold ? 0 : source.devPct) : null
  const first = (...values: Array<number | null | undefined>) => values.find(value => value !== null && value !== undefined) ?? null
  const highest = (...values: Array<number | null | undefined>) => {
    const known = values.filter((value): value is number => value !== null && value !== undefined)
    return known.length ? Math.max(...known) : null
  }
  const jupiter = jupiterReading(token.mint, now)
  const page = pageStatsAt(trackerState.pageStats.get(token.mint), now)
  const checkedAt = Math.max(fresh?.seenAt ?? 0, page.recent?.seenAt ?? 0, token.traits_checked_at ?? 0, card?.seenAt ?? 0) || null
  const traits: RadarHolderTraits = {
    top10: first(fresh?.top10Pct, page.live?.top10, highest(page.recent?.top10, token.top10_pct, jupiter?.top10Pct), card?.top10Pct, page.kept?.top10, worst?.top10),
    dev: first(cardDev(fresh), page.live?.dev, highest(page.recent?.dev, token.dev_pct, jupiter?.devPct), cardDev(card), page.kept?.dev, worst?.dev),
    snipers: first(fresh?.snipersPct, page.recent?.snipers, card?.snipersPct, page.kept?.snipers, worst?.snipers),
    insiders: first(fresh?.insidersPct, page.recent?.insiders, card?.insidersPct, page.kept?.insiders, worst?.insiders),
    bundlers: first(fresh?.bundlersPct, page.recent?.bundlers, card?.bundlersPct, page.kept?.bundlers, worst?.bundlers),
    linked: first(token.insider_pct, worst?.linked),
    fresh: first(page.kept?.fresh, token.fresh_pct, worst?.fresh),
    proTraders: first(page.kept?.proTraders),
    holders: first(fresh?.holders, jupiter?.holders, token.holders_total, card?.holders),
    rugged: token.rugged === 1,
    checkedAt,
  }
  const known = [traits.top10, traits.dev, traits.snipers, traits.insiders, traits.bundlers, traits.linked, traits.fresh, traits.proTraders, traits.holders].some(value => value !== null)
  const result = known ? traits : null
  traitsCache.set(token.mint, { at: now, traits: result })
  if (traitsCache.size > 800) for (const [key, entry] of traitsCache) if (now - entry.at > 120_000) traitsCache.delete(key)
  return result
}

const noLinks: RunnerLinks = { twitter: null, telegram: null, website: null }
const recycledCache = new Map<string, { at: number; linksJson: string | null; reason: string | null; reused: string[] }>()

function parseLinks(json: string | null | undefined): RunnerLinks {
  if (!json) return noLinks
  try {
    const value = JSON.parse(json) as Partial<RunnerLinks>
    return { twitter: value.twitter ?? null, telegram: value.telegram ?? null, website: value.website ?? null }
  } catch {
    return noLinks
  }
}

/** Metadata recycling: a ticker that two or more earlier coins crashed under, or an X account, community or website an older coin already used. */
function recycledFor(database: TrackerDatabase, token: TokenRow, now: number) {
  const links = token.links_json ? parseLinks(token.links_json) : socialLinks(token)
  const cached = recycledCache.get(token.mint)
  if (cached && now - cached.at < 5 * 60_000 && cached.linksJson === (token.links_json ?? null)) return { reason: cached.reason, reused: cached.reused, links }
  const symbol = token.symbol.trim().toLowerCase()
  let crashed = 0
  if (lifecycleTableKnown) crashed = (database.prepare('SELECT COUNT(*) AS count FROM tokens t JOIN coin_lifecycles l ON l.mint = t.mint WHERE lower(trim(t.symbol)) = ? AND t.mint <> ? AND t.pair_created_at < ? AND l.rugged_at IS NOT NULL').get(symbol, token.mint, token.pair_created_at) as { count: number }).count
  const older = database.prepare("SELECT 1 FROM tokens WHERE mint <> ? AND pair_created_at < ? AND (json_extract(links_json, '$.twitter') = ? OR json_extract(links_json, '$.website') = ? OR json_extract(links_json, '$.telegram') = ?) LIMIT 1")
  const reused = [links.twitter, links.telegram, links.website].filter((link): link is string => Boolean(link) && Boolean(older.get(token.mint, token.pair_created_at, link, link, link)))
  const copied = reused.filter(link => link !== links.telegram && !/\/status\/\d+/.test(link))
  const reason = crashed >= 2 ? `Recycled name: ${crashed} earlier coins called ${token.symbol} crashed` : copied.length ? `Copied links: ${copied.length === 1 ? 'its' : 'its X and website'} ${copied.length === 1 ? (copied[0] === links.website ? 'website' : 'X link') : 'links'} came from an older coin` : null
  recycledCache.set(token.mint, { at: now, linksJson: token.links_json ?? null, reason, reused })
  if (recycledCache.size > 800) for (const [key, entry] of recycledCache) if (now - entry.at > 30 * 60_000) recycledCache.delete(key)
  return { reason, reused, links }
}

function socialLinks(token: TokenRow): RunnerLinks {
  const socials = parseSocials(token.socials_json)
  return { twitter: socials.twitter ?? null, telegram: socials.telegram ?? null, website: socials.website ?? null }
}

/** One price a second from the live feed, preceded by the 10-second snapshots for the minutes before it. */
function priceSeries(snapshots: SnapshotRow[], ticks: MarketTick[]): PricePoint[] {
  const live = ticks.filter(tick => tick.price !== null && tick.price > 0).map(tick => ({ t: tick.t, price: tick.price as number }))
  const startedAt = live[0]?.t ?? Infinity
  const earlier = snapshots.filter(row => row.timestamp < startedAt && row.price_usd !== null && row.price_usd > 0).map(row => ({ t: row.timestamp, price: row.price_usd as number }))
  return [...earlier, ...live]
}

function buildToken(database: TrackerDatabase, token: TokenRow, snapshots: SnapshotRow[], fallback: SnapshotRow | undefined, runners: number, weights: RadarWeights, now: number, settings: RadarSettings, traits: RadarHolderTraits | null): BuiltToken {
  const latest = snapshots.at(-1) ?? fallback
  const live = liveFigures(token.mint, now)
  const stored = viewerDeltas(snapshots, now)
  const viewers = live.viewers ?? stored.viewers
  const delta1m = live.viewers !== null ? live.viewersDelta1m : stored.delta1m
  const delta5m = live.viewers !== null ? live.viewersDelta5m ?? stored.delta5m : stored.delta5m
  const pct5m = delta5m !== null && viewers !== null && viewers - delta5m > 0 ? Math.round((delta5m / (viewers - delta5m)) * 1000) / 10 : stored.pct5m
  const safety = { rugScore: token.rug_score, mintAuthority: flag(token.mint_auth), freezeAuthority: flag(token.freeze_auth), top10Pct: token.top10_pct }
  const buys = live.market?.buys5m ?? latest?.buys_5m ?? null
  const sells = live.market?.sells5m ?? latest?.sells_5m ?? null
  const marketCap = live.market?.marketCap ?? latest?.market_cap ?? null
  const checklist = assessQuality({ pulse: live.pulse, traits, marketCap, rugTop10Pct: token.top10_pct, mintAuthority: safety.mintAuthority, freezeAuthority: safety.freezeAuthority })
  const quality = { score: checklist.score, checks: checklist.checks }
  const { factors } = scoreSetup({ ...safety, viewers, viewersDelta5m: delta5m, viewersPerMin: live.viewersPerMin, quality: quality.score, runnerWallets: runners, buys5m: buys, sells5m: sells }, weights)
  const transactions = (buys ?? 0) + (sells ?? 0)
  const volume5m = live.market?.volume5m ?? latest?.volume_5m ?? null
  const ageMinutes = Math.max(0, Math.round((now - token.pair_created_at) / 60_000))
  const jupiter = jupiterReading(token.mint, now)
  const holderSource = live.pulse?.holders !== null && live.pulse?.holders !== undefined
    ? { holders: live.pulse.holders, perMin: live.holdersPerMin, change5mPct: null }
    : jupiter?.holders !== null && jupiter?.holders !== undefined
      ? { holders: jupiter.holders, perMin: jupiter.holdersPerMin, change5mPct: jupiter.holderChange5mPct }
      : { holders: traits?.holders ?? null, perMin: live.holdersPerMin, change5mPct: null }
  const flow = snapshots.filter(row => row.timestamp >= now - 200_000).map(row => ({ t: row.timestamp, price: row.price_usd, volume5m: row.volume_5m, buys5m: row.buys_5m, sells5m: row.sells_5m }))
  const botReason = detectBotClimb({ now, ageMinutes, buys5m: buys, sells5m: sells, volume5m, traders5m: jupiter?.traders5m ?? null, netBuyers5m: jupiter?.netBuyers5m ?? null, flow })
  const remembered = activeBotClimb(token.mint, now)
  if (botReason) trackerState.botClimbs.set(token.mint, { until: now + botClimbHoldMs, reason: botReason })
  const botClimb = botReason !== null || remembered !== null
  const ticks = marketTicks.get(token.mint) ?? []
  const pulseNow = live.pulse && now - live.pulse.seenAt < 10_000 ? live.pulse : null
  const pageNow = pageStatsAt(trackerState.pageStats.get(token.mint), now).live
  const price = live.price ?? latest?.price_usd ?? null
  const sellAlerts = watchSells(token.mint, pulseNow
    ? { t: now, source: 'pulse', top10: pulseNow.top10Pct, bundlers: pulseNow.bundlersPct, insiders: pulseNow.insidersPct, dev: pulseNow.devSold ? 0 : pulseNow.devPct, price }
    : pageNow
      ? { t: now, source: 'page', top10: pageNow.top10, bundlers: pageNow.bundlers, insiders: pageNow.insiders, dev: pageNow.dev, price }
      : { t: now, source: 'chain', top10: traits?.top10 ?? null, bundlers: traits?.bundlers ?? null, insiders: traits?.insiders ?? null, dev: traits?.dev ?? null, price }, now)
  const recycled = recycledFor(database, token, now)
  const card = live.pulse
  const runnerInput: Parameters<typeof scoreRunner>[0] = {
    now,
    marketCap,
    liquidity: live.market?.liquidityUsd ?? latest?.liquidity_usd ?? null,
    priceChange: { m1: live.priceChange.m1, m5: live.priceChange.m5 },
    ticks: withChartHistory(chartHistory(token.mint), priceSeries(snapshots, ticks)),
    top10: traits?.top10 ?? null,
    dev: traits?.dev ?? null,
    devSold: card?.devSold ?? false,
    snipers: traits?.snipers ?? null,
    insiders: traits?.insiders ?? null,
    bundlers: traits?.bundlers ?? null,
    linked: traits?.linked ?? null,
    fresh: traits?.fresh ?? null,
    proTraders: traits?.proTraders ?? null,
    holders: holderSource.holders,
    mintAuthority: safety.mintAuthority,
    freezeAuthority: safety.freezeAuthority,
    rugged: traits?.rugged ?? false,
    devCreated: Math.max(card?.devCreated ?? -1, jupiter?.devMints ?? -1) >= 0 ? Math.max(card?.devCreated ?? 0, jupiter?.devMints ?? 0) : null,
    devMigrated: Math.max(card?.devMigrated ?? -1, jupiter?.devMigrations ?? -1) >= 0 ? Math.max(card?.devMigrated ?? 0, jupiter?.devMigrations ?? 0) : null,
    recycled: recycled.reason,
    buys5m: buys,
    volume5m,
    buyers5m: jupiter?.organicBuyers5m ?? null,
    buyVolume5m: jupiter?.buyVolume5m ?? null,
    sellVolume5m: jupiter?.sellVolume5m ?? null,
    feesSol: card?.feesSol ?? null,
    graduated: jupiter?.graduated ?? (token.graduated === null || token.graduated === undefined ? null : token.graduated === 1),
    dexPaid: token.dex_paid === null || token.dex_paid === undefined ? null : token.dex_paid === 1,
    links: recycled.links,
    reusedLinks: recycled.reused,
    smartHolders: runners,
    viewers,
    viewersPerMin: live.viewersPerMin,
    holdersPerMin: live.holdersPerMin,
    botReason: botReason ?? remembered?.reason ?? null,
    selling: sellAlerts.map(alert => alert.text),
    devSelling: sellAlerts.some(alert => alert.dev),
    learned: [],
  }
  const firstPass = scoreRunner(runnerInput)
  const learned = learnedFor(firstPass.tags)
  const runner = learned.length ? scoreRunner({ ...runnerInput, learned }) : firstPass
  const built: RadarToken = {
    mint: token.mint,
    pairAddress: token.pair_address,
    symbol: token.symbol,
    name: token.name,
    imageUrl: token.image_url,
    pairCreatedAt: token.pair_created_at,
    ageMinutes,
    socials: parseSocials(token.socials_json),
    isBoosted: token.is_boosted === 1,
    viewers,
    viewersDelta1m: delta1m,
    viewersDelta5m: delta5m,
    viewersPct5m: pct5m,
    history: toHistory(snapshots.filter(row => row.timestamp >= now - 15 * 60_000)),
    runnerWallets: runners,
    priceUsd: live.price ?? latest?.price_usd ?? null,
    marketCap,
    liquidityUsd: live.market?.liquidityUsd ?? latest?.liquidity_usd ?? null,
    volume5m,
    buys5m: buys,
    sells5m: sells,
    buyRatio: transactions ? (buys ?? 0) / transactions : null,
    safety: { level: safetyLevel(safety), ...safety },
    score: runner.score,
    scoreCuts: runner.cuts,
    scoreParts: runner.parts,
    botClimb,
    researchScore: null,
    rawScore: runner.base,
    holderRisk: runner.holderRisk.reasons.length ? runner.holderRisk : null,
    holderTraits: traits,
    factors,
    lastSnapshotAt: live.market?.readAt ?? latest?.timestamp ?? null,
    priceChange: live.priceChange,
    spark: sparkSeries(marketTicks.get(token.mint) ?? [], now),
    viewersPerMin: live.viewersPerMin,
    viewerSurge: false,
    holdersChange5m: live.holdersChange5m,
    holdersPerMin: holderSource.perMin,
    gains: live.gains,
    pulse: live.pulse,
    quality,
    viewerRank: null,
    signal: null,
    signalReasons: [],
    alerts: [],
    pinned: settings.pinned.includes(token.mint),
    onPulse: trackerState.pulse.has(token.mint),
    safetyPlan: runner.safetyPlan,
    runnerTags: runner.tags,
    runnerThesis: runner.thesis,
    learnedEdge: learnedEdge(runner.tags),
    dexPaid: runnerInput.dexPaid,
    scoreLedger: runner.ledger,
    scoreTrail: scoreTrailFor(token.mint),
  }
  return { token: built, liquidityChange1m: live.liquidityChange1m }
}

function latestSnapshots(database: TrackerDatabase, mints: string[]) {
  if (!mints.length) return new Map<string, SnapshotRow>()
  const rows = database.prepare(`
    SELECT s.* FROM snapshots s
    JOIN (SELECT mint, MAX(timestamp) AS latest FROM snapshots WHERE mint IN (SELECT value FROM json_each(?)) GROUP BY mint) m
      ON m.mint = s.mint AND m.latest = s.timestamp
  `).all(JSON.stringify(mints)) as SnapshotRow[]
  return new Map(rows.map(row => [row.mint, row]))
}

let builtTokens: { at: number; tokens: RadarToken[] } | null = null

/** Every tracked coin, scored. Built at most once a second; callers within the same second share the result. */
export function buildRadarTokens(database: TrackerDatabase, weights: RadarWeights, now = Date.now()): RadarToken[] {
  if (builtTokens && Math.abs(now - builtTokens.at) < 900) return builtTokens.tokens
  const result = buildRadarTokensNow(database, weights, now)
  builtTokens = { at: now, tokens: result }
  return result
}

function buildRadarTokensNow(database: TrackerDatabase, weights: RadarWeights, now: number): RadarToken[] {
  if (!lifecycleTableKnown) lifecycleTableKnown = Boolean(database.prepare("SELECT 1 FROM pragma_table_info('coin_lifecycles') WHERE name = 'traits_json'").get())
  const tokens = database.prepare('SELECT * FROM tokens WHERE last_seen_at >= ?').all(now - activeWindowMs) as TokenRow[]
  forgetSells(new Set(tokens.map(token => token.mint)))
  if (!tokens.length) return []
  const mints = tokens.map(token => token.mint)
  const snapshotRows = database.prepare(`
    SELECT mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp FROM snapshots
    WHERE timestamp >= ? AND mint IN (SELECT value FROM json_each(?)) ORDER BY timestamp ASC
  `).all(now - historyWindowMs, JSON.stringify(mints)) as SnapshotRow[]
  const byMint = new Map<string, SnapshotRow[]>()
  for (const row of snapshotRows) {
    const list = byMint.get(row.mint) ?? []
    list.push(row)
    byMint.set(row.mint, list)
  }
  const fallbacks = latestSnapshots(database, mints.filter(mint => !byMint.has(mint)))
  const runners = runnerCounts(database, mints)
  const settings = radarSettings()
  const entries = tokens.map(token => buildToken(database, token, byMint.get(token.mint) ?? [], fallbacks.get(token.mint), runners.get(token.mint) ?? 0, weights, now, settings, holderTraitsFor(database, token, now)))
  const finished = finalize(entries, settings)
  for (const token of finished) if (token.scoreLedger) token.scoreTrail = recordScore(token.mint, now, token.scoreLedger)
  forgetScoreTrails(now)
  return finished.filter(token => !token.botClimb || token.pinned).sort((first, second) => Number(second.pinned) - Number(first.pinned) || (second.viewers ?? -1) - (first.viewers ?? -1) || second.score - first.score)
}

const returnOf = (price: number | null, entry: number) => price === null || entry <= 0 ? null : price / entry - 1

function paperTrades(database: TrackerDatabase) {
  const rows = database.prepare('SELECT p.id, p.mint, p.symbol, t.pair_address, p.entry_price, p.entry_mcap, p.setup_score, p.price_5m, p.price_15m, p.price_30m, p.status, p.created_at FROM paper_trades p LEFT JOIN tokens t ON t.mint = p.mint ORDER BY p.created_at DESC LIMIT 200').all() as PaperRow[]
  const trades: RadarPaperTrade[] = rows.map(row => ({
    id: row.id,
    mint: row.mint,
    symbol: row.symbol,
    pairAddress: row.pair_address,
    entryPrice: row.entry_price,
    entryMcap: row.entry_mcap,
    setupScore: row.setup_score,
    return5m: returnOf(row.price_5m, row.entry_price),
    return15m: returnOf(row.price_15m, row.entry_price),
    return30m: returnOf(row.price_30m, row.entry_price),
    status: row.status,
    createdAt: row.created_at,
  }))
  const completed = trades.filter(trade => trade.status !== 'open')
  const wins = completed.filter(trade => trade.status === 'win').length
  const returns = completed.map(trade => trade.return15m).filter((value): value is number => value !== null)
  let cumulative = 0
  const pnl = completed.slice().sort((first, second) => first.createdAt - second.createdAt).map(trade => {
    cumulative += (trade.return15m ?? 0) * 100
    return { t: trade.createdAt, cumulative: Math.round(cumulative * 10) / 10, symbol: trade.symbol }
  })
  return {
    trades: trades.slice(0, 100),
    stats: {
      open: trades.filter(trade => trade.status === 'open').length,
      wins,
      losses: completed.length - wins,
      winRate: completed.length ? wins / completed.length : null,
      averageReturn15m: returns.length ? returns.reduce((total, value) => total + value, 0) / returns.length : null,
    },
    pnl,
  }
}

function componentStatuses(database: TrackerDatabase) {
  return database.prepare('SELECT component, status, detail, updated_at AS updatedAt FROM worker_heartbeat ORDER BY component').all() as RadarComponentStatus[]
}

function smartWallets(database: TrackerDatabase, minRunnerHits: number): RadarWallet[] {
  const holders = rankHolderWallets(database, minRunnerHits)
  const holdings = database.prepare(`
    SELECT h.mint, COALESCE(t.symbol, g.symbol, '???') AS symbol, t.pair_address AS pairAddress, h.pct, g.mint IS NOT NULL AS good, h.updated_at AS timestamp FROM holders h
    LEFT JOIN tokens t ON t.mint = h.mint LEFT JOIN good_coins g ON g.mint = h.mint
    WHERE h.wallet = ? ORDER BY good DESC, h.updated_at DESC LIMIT 8
  `)
  const buyers = database.prepare('SELECT wallet, runner_hits AS runnerHits, updated_at AS updatedAt FROM smart_wallets WHERE runner_hits >= ? ORDER BY runner_hits DESC, updated_at DESC LIMIT 20').all(minRunnerHits) as Array<{ wallet: string; runnerHits: number; updatedAt: number }>
  const entries = database.prepare(`
    SELECT we.mint, COALESCE(t.symbol, '???') AS symbol, t.pair_address AS pairAddress, we.timestamp FROM wallet_entries we
    LEFT JOIN tokens t ON t.mint = we.mint WHERE we.wallet = ? ORDER BY we.timestamp DESC LIMIT 8
  `)
  return [
    ...holders.map(wallet => ({ ...wallet, source: 'holder' as const, entries: (holdings.all(wallet.wallet) as Array<{ mint: string; symbol: string; pairAddress: string | null; pct: number | null; good: number; timestamp: number }>).map(entry => ({ ...entry, good: entry.good === 1 })) })),
    ...buyers.map(wallet => ({ ...wallet, source: 'early-buyer' as const, entries: (entries.all(wallet.wallet) as Array<{ mint: string; symbol: string; pairAddress: string | null; timestamp: number }>).map(entry => ({ ...entry, pct: null, good: false })) })),
  ]
}

export function buildRadarPayload(database: TrackerDatabase, now = Date.now()): RadarPayload {
  const model = loadModelState(database)
  const tokens = buildRadarTokens(database, model.weights, now).map(withLearning)
  const components = componentStatuses(database)
  const workerSeenAt = components.length ? Math.max(...components.map(component => component.updatedAt)) : null
  const status = workerSeenAt && now - workerSeenAt < 30_000 ? 'live' : workerSeenAt && now - workerSeenAt < 5 * 60_000 ? 'stale' : 'offline'
  const surge = tokens.filter(token => token.viewersDelta5m !== null).sort((first, second) => (second.viewersDelta5m ?? 0) - (first.viewersDelta5m ?? 0))[0]
  const runnerSignals = (database.prepare(`
    SELECT COUNT(*) AS count FROM wallet_entries we JOIN smart_wallets sw ON sw.wallet = we.wallet
    WHERE sw.runner_hits >= ? AND we.timestamp >= ?
  `).get(radarSettings().wallets.minRunnerHits, now - 60 * 60_000) as { count: number }).count
  const paper = paperTrades(database)
  return {
    status,
    message: status === 'offline' ? 'The Axiom tracker worker has not reported in. Start it with `pnpm axiom:worker` or `pm2 start ecosystem.axiom.config.js`.' : status === 'stale' ? 'The worker last reported more than 30 seconds ago.' : null,
    generatedAt: now,
    workerSeenAt,
    components,
    tokens,
    kpis: {
      tracked: tokens.length,
      fastestSurge: surge && (surge.viewersDelta5m ?? 0) > 0 ? { symbol: surge.symbol, mint: surge.mint, delta: surge.viewersDelta5m ?? 0 } : null,
      runnerSignals,
      winRate: paper.stats.winRate,
      completedTrades: paper.stats.wins + paper.stats.losses,
    },
    model,
    paper,
    settings: radarSettings(),
    wallets: smartWallets(database, radarSettings().wallets.minRunnerHits),
    walletTracking: process.env.HELIUS_API_KEY?.trim() ? 'on' : 'no-key',
    learner: learnerState.summary,
    explosions: learnerState.explosions,
    winners: learnerState.winners,
    adviceStudy: learnerState.adviceStudy,
    runner: runnerState.summary,
  }
}

function downsample<T>(items: T[], limit: number) {
  if (items.length <= limit) return items
  const step = items.length / limit
  return Array.from({ length: limit }, (_, index) => items[Math.min(items.length - 1, Math.round(index * step))])
}

export function buildTokenDetail(database: TrackerDatabase, mint: string, now = Date.now()): RadarTokenDetail | null {
  const token = database.prepare('SELECT * FROM tokens WHERE mint = ?').get(mint) as TokenRow | undefined
  if (!token) return null
  const model = loadModelState(database)
  const settings = radarSettings()
  const all = database.prepare('SELECT mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp FROM snapshots WHERE mint = ? AND timestamp >= ? ORDER BY timestamp ASC').all(mint, now - detailWindowMs) as SnapshotRow[]
  const recent = all.filter(row => row.timestamp >= now - historyWindowMs)
  const runners = runnerCounts(database, [mint]).get(mint) ?? 0
  const buyers = database.prepare(`
    SELECT we.wallet, sw.runner_hits AS runnerHits, we.entry_mcap AS entryMcap, we.timestamp FROM wallet_entries we
    JOIN smart_wallets sw ON sw.wallet = we.wallet WHERE we.mint = ? ORDER BY we.timestamp ASC
  `).all(mint) as RadarWalletEntry[]
  const holders = database.prepare(`
    SELECT * FROM (
      SELECT h.wallet, (SELECT COUNT(*) FROM holders other JOIN good_coins g ON g.mint = other.mint WHERE other.wallet = h.wallet AND other.mint <> h.mint) AS runnerHits,
        NULL AS entryMcap, h.pct, h.updated_at AS timestamp FROM holders h WHERE h.mint = ?
    ) WHERE runnerHits >= ? ORDER BY runnerHits DESC LIMIT 20
  `).all(mint, settings.wallets.minRunnerHits) as RadarWalletEntry[]
  const [built] = finalize([buildToken(database, token, recent, all.at(-1), runners, model.weights, now, settings, holderTraitsFor(database, token, now))], settings)
  return {
    token: withLearning(built),
    history: toHistory(downsample(all, 360)),
    live: (marketTicks.get(mint) ?? []).map(tick => ({ t: tick.t, price: tick.price, viewers: tick.viewers })),
    entries: [...holders, ...buyers],
  }
}

export { radarThresholds }
