import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceAlert, patternStats, thresholdFor, type AlertRow } from './runner-learning.js'
import { earlyBonusPoints, fadingPenalty, movementPoints, movementSignal, scoreRunner, sellImpact, serialLauncherCap, softPenalties, staircase, stretchCostFor, waveRecovery, type PricePoint, type RunnerInput } from './runner-score.js'
import { earlyStart, type EarlyInput } from './early-start.js'
import { resetSellWatch, watchSells, type ShareReading } from './sell-watch.js'
import { recordScore, resetScoreTrails } from './score-trail.js'
import { minuteClosesFrom, withChartHistory } from './chart-history.js'

const now = 1_800_000_000_000

/** Twelve minutes climbing in steps, with a 40% pullback in the middle that is won back with higher lows. */
function strongTicks(): PricePoint[] {
  const shape = [1, 1.1, 1.2, 1.35, 1.5, 1.7, 1.9, 2.1, 1.7, 1.4, 1.26, 1.4, 1.55, 1.48, 1.7, 1.85, 1.78, 2, 2.2, 2.15, 2.4, 2.6, 2.55, 2.8]
  return shape.map((price, index) => ({ t: now - (shape.length - 1 - index) * 30_000, price }))
}

function strong(overrides: Partial<RunnerInput> = {}): RunnerInput {
  return {
    now,
    marketCap: 30_000,
    liquidity: 14_000,
    priceChange: { m1: 3, m5: 25 },
    ticks: strongTicks(),
    top10: 12,
    dev: 0,
    devSold: true,
    snipers: 0.5,
    insiders: 2,
    bundlers: 3,
    linked: 1,
    fresh: 1,
    proTraders: 20,
    holders: 360,
    mintAuthority: false,
    freezeAuthority: false,
    devCreated: 3,
    devMigrated: 1,
    recycled: null,
    buys5m: 420,
    volume5m: 38_000,
    buyers5m: 160,
    buyVolume5m: 22_000,
    sellVolume5m: 14_000,
    feesSol: 2.4,
    graduated: false,
    dexPaid: true,
    links: { twitter: 'https://x.com/realcoin', telegram: 'https://t.me/realcoin', website: 'https://realcoin.fun' },
    reusedLinks: [],
    smartHolders: 2,
    viewers: 320,
    viewersPerMin: 14,
    holdersPerMin: 45,
    botReason: null,
    selling: [],
    devSelling: false,
    learned: [],
    ...overrides,
  }
}

test('a clean coin with every pillar scores as a runner', () => {
  const result = scoreRunner(strong())
  assert.deepEqual(result.disqualified, [])
  assert.ok(result.score >= 90, `score ${result.score}`)
  const parts = Object.fromEntries(result.parts.map(part => [part.key, part.points]))
  assert.equal(parts.distribution, 20)
  assert.equal(parts.momentum, 45)
  assert.equal(parts.hype, 15)
})

/** A clean coin with modest attention: scores in the 80s, so moves in either direction show. */
function middling(overrides: Partial<RunnerInput> = {}): RunnerInput {
  return strong({ viewers: 60, viewersPerMin: 3, holdersPerMin: 4, dexPaid: false, smartHolders: 0, ...overrides })
}

test('Axiom demand ranks coins: viewers, viewer growth and holder growth lift the score', () => {
  const quiet = scoreRunner(middling({ viewers: 15, viewersPerMin: 0, holdersPerMin: 0 })).score
  const watched = scoreRunner(middling()).score
  const surging = scoreRunner(middling({ viewers: 320, viewersPerMin: 14, holdersPerMin: 45 })).score
  assert.ok(quiet < watched && watched < surging, `${quiet} ${watched} ${surging}`)
})

test('a prolific dev with many graduated coins is not a serial launcher', () => {
  assert.deepEqual(scoreRunner(strong({ devCreated: 850, devMigrated: 43 })).disqualified, [])
  const serial = scoreRunner(strong({ devCreated: 570, devMigrated: 4 }))
  assert.ok(serial.score <= serialLauncherCap && serial.score > 0, String(serial.score))
  assert.ok(serial.cuts.some(reason => reason.startsWith('Serial launcher')))
})

test('a recycled name, copied links and small holder trims cost points instead of zeroing a mover', () => {
  const clean = scoreRunner(middling()).score
  const recycled = scoreRunner(middling({ recycled: 'Recycled name: 16 earlier coins called JENSEN crashed' })).score
  const copied = scoreRunner(middling({ recycled: 'Copied links: its website came from an older coin' })).score
  const trim = scoreRunner(middling({ selling: ['Bundlers are selling: 7% to 5% of supply in 17s'], severeSelling: [] })).score
  assert.ok(recycled > 0 && recycled < clean && recycled >= clean - softPenalties.recycledName, `${clean} ${recycled}`)
  assert.ok(copied > recycled && copied < clean, `${clean} ${copied}`)
  assert.ok(trim > 0 && trim < clean, `${clean} ${trim}`)
})

test('every step 1 disqualifier, fresh wallets, bot climbs and selling make it 0', () => {
  const cases: Array<[string, Partial<RunnerInput>]> = [
    ['mint', { mintAuthority: true }],
    ['freeze', { freezeAuthority: true }],
    ['dev', { dev: 5.5, devSold: false }],
    ['top10', { top10: 36 }],
    ['bundlers', { bundlers: 36 }],
    ['pro traders', { proTraders: 76 }],
    ['dead', { buyers5m: 3 }],
    ['no volume', { volume5m: 0 }],
    ['fresh', { fresh: 10.5 }],
    ['snipers', { snipers: 31 }],
    ['bot', { botReason: '90% of wallets only buy' }],
    ['selling', { selling: ['Bundlers are selling: 12% to 7% of supply in 20s'] }],
    ['dumping', { selling: ['Bundlers are selling: 12% to 7% of supply in 20s', 'Insiders are selling: 4% to 3% in 9s'], severeSelling: ['Bundlers are selling: 12% to 7% of supply in 20s'] }],
  ]
  for (const [name, overrides] of cases) {
    const result = scoreRunner(strong(overrides))
    assert.equal(result.score, 0, name)
    assert.ok(result.disqualified.length > 0, name)
    assert.equal(result.holderRisk.blocked, true, name)
  }
})

test('a top 10 up to 35% costs nothing; over 35% makes it 0', () => {
  const at10 = scoreRunner(middling({ top10: 10 })).score
  assert.equal(scoreRunner(middling({ top10: 22 })).score, at10)
  assert.equal(scoreRunner(middling({ top10: 35 })).score, at10)
  assert.equal(scoreRunner(middling({ top10: 35.5 })).score, 0)
})

test('above $10K, market cap and distance to migration never cost points', () => {
  const early = scoreRunner(middling({ marketCap: 20_000, graduated: false })).score
  assert.equal(scoreRunner(middling({ marketCap: 66_000, graduated: false })).score, early)
  assert.equal(scoreRunner(middling({ marketCap: 10_000, graduated: false })).score, early)
})

test('a 30-50% pullback won back with higher lows earns the multi-wave points', () => {
  assert.equal(waveRecovery(strongTicks()).points, 15)
  const vertical = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4].map((price, index) => ({ t: now - (20 - index) * 30_000, price }))
  assert.equal(waveRecovery(vertical).points, 0)
})

test('a staircase scores and a single vertical candle does not', () => {
  assert.equal(staircase(strongTicks()).points, 10)
  const vertical = [1, 1.01, 1, 1.02, 1.01, 3.2, 3.1].map((price, index) => ({ t: now - (6 - index) * 60_000, price }))
  assert.equal(staircase(vertical).points, 0)
})

test('holder numbers that were never read cap the score at 45', () => {
  const result = scoreRunner(strong({ top10: null, dev: null, devSold: false }))
  assert.ok(result.score <= 45, `score ${result.score}`)
})

test('a sell by a big holder group is priced against the pool', () => {
  assert.equal(sellImpact(12, 100_000, 30_000), 69)
  assert.equal(sellImpact(1, 100_000, 30_000), 12)
  const plan = scoreRunner(strong({ bundlers: 12, top10: 22, marketCap: 100_000, liquidity: 30_000 })).safetyPlan
  assert.equal(plan.level, 'watch')
  assert.equal(plan.bundleDumpPct, 69)
  assert.ok(plan.summary.includes('69%'))
  assert.ok(!plan.triggers.some(line => line.includes('bundler share') || line.includes('top 10 share')))
})

const reading = (t: number, values: Partial<ShareReading>): ShareReading => ({ t, source: 'pulse', top10: 18, bundlers: 12, insiders: 4, dev: 0, price: 1, ...values })

test('bundlers trimming their share is not flagged, even fast and while the price dips', () => {
  resetSellWatch()
  for (let second = 0; second < 20; second++) watchSells('coin', reading(now + second * 1_000, {}))
  let alerts: ReturnType<typeof watchSells> = []
  for (let second = 20; second < 30; second++) alerts = watchSells('coin', reading(now + second * 1_000, { bundlers: 4, price: 0.9 }))
  assert.equal(alerts.length, 0, JSON.stringify(alerts))
})

test('a one-second flicker or a switch of data source is not a sell', () => {
  resetSellWatch()
  let alerts: ReturnType<typeof watchSells> = []
  for (let second = 0; second < 20; second++) alerts = watchSells('coin', reading(now + second * 1_000, { insiders: second === 15 ? 0 : 4 }))
  assert.equal(alerts.length, 0)
  resetSellWatch()
  for (let second = 0; second < 10; second++) watchSells('coin', reading(now + second * 1_000, { top10: 24 }))
  for (let second = 10; second < 20; second++) alerts = watchSells('coin', reading(now + second * 1_000, { source: 'chain', top10: 14, price: 0.8 }))
  assert.equal(alerts.length, 0)
})

test('the top 10 thinning out on a run is not selling until it halves, and a dev sell is flagged', () => {
  resetSellWatch()
  for (let second = 0; second < 10; second++) watchSells('coin', reading(now + second * 1_000, { top10: 22, dev: 3 }))
  let alerts: ReturnType<typeof watchSells> = []
  for (let second = 10; second < 20; second++) alerts = watchSells('coin', reading(now + second * 1_000, { top10: 14, dev: 1, price: 0.85 }))
  assert.ok(!alerts.some(alert => alert.text.startsWith('Top holders are selling')), JSON.stringify(alerts))
  assert.ok(alerts.some(alert => alert.dev))
  resetSellWatch()
  for (let second = 0; second < 10; second++) watchSells('coin', reading(now + second * 1_000, { top10: 20 }))
  for (let second = 10; second < 20; second++) alerts = watchSells('coin', reading(now + second * 1_000, { top10: 10, price: 1.4 }))
  assert.equal(alerts.length, 0, 'a rising coin whose top 10 halves is not flagged')
  resetSellWatch()
  for (let second = 0; second < 10; second++) watchSells('coin', reading(now + second * 1_000, { top10: 24 }))
  for (let second = 10; second < 20; second++) alerts = watchSells('coin', reading(now + second * 1_000, { top10: 6, price: 0.7 }))
  assert.equal(alerts.length, 0, 'a top 10 losing most of its share while the price falls is not flagged either')
})

function alert(overrides: Partial<AlertRow> = {}): AlertRow {
  return { id: 1, mint: 'm', symbol: 'M', name: null, pair_address: null, alerted_at: now, price: 1, score: 80, threshold: 75, tags_json: '["dex-paid"]', stats_json: '{}', thesis_json: '[]', edge: null, peak_15m: 1, peak_1h: 1, peak_4h: 1, low_10m: 1, dumped_at: null, hit_win_at: null, hit_loss_at: null, outcome: 'open', last_price: 1, last_at: now, closed_at: null, ...overrides }
}

test('an alert that dumps 30% within 10 minutes is a false positive; one that doubles is a runner', () => {
  const dumped = advanceAlert(alert(), 0.65, now + 6 * 60_000)
  assert.equal(dumped.outcome, 'false-positive')
  assert.equal(dumped.hit_loss_at, now + 6 * 60_000)
  const ran = advanceAlert(advanceAlert(alert(), 1.6, now + 10 * 60_000), 2.1, now + 50 * 60_000)
  assert.equal(ran.outcome, 'runner')
  assert.equal(ran.peak_15m, 1.6)
  assert.equal(ran.peak_1h, 2.1)
  const closed = advanceAlert(alert(), 1.1, now + 4 * 60 * 60_000 + 1)
  assert.equal(closed.outcome, 'neither')
  assert.ok(closed.closed_at)
})

test('the alert threshold rises to 80 when fewer than 40% of the last 20 decided alerts won', () => {
  const rows = Array.from({ length: 12 }, (_, index) => alert({ id: index, alerted_at: now + index, hit_win_at: index < 3 ? now + index + 1 : null, hit_loss_at: index < 3 ? null : now + index + 1 }))
  assert.equal(thresholdFor(rows).threshold, 80)
  const better = rows.map((row, index) => index < 6 ? { ...row, hit_win_at: row.alerted_at + 1, hit_loss_at: null } : row)
  assert.equal(thresholdFor(better).threshold, 75)
  assert.equal(thresholdFor(rows.slice(0, 5)).threshold, 75)
})

test('a pattern behind repeated false positives costs 10 points and one behind runners earns 10', () => {
  const rows = [
    ...Array.from({ length: 4 }, () => ({ tags_json: '["x-tweet"]', outcome: 'false-positive' as const, stretch: 10 })),
    { tags_json: '["x-tweet"]', outcome: 'neither' as const, stretch: 10 },
    ...Array.from({ length: 3 }, () => ({ tags_json: '["dex-paid"]', outcome: 'runner' as const, stretch: 10 })),
    ...Array.from({ length: 2 }, () => ({ tags_json: '["dex-paid"]', outcome: 'neither' as const, stretch: 10 })),
  ]
  const stats = patternStats(rows)
  assert.equal(stats.get('x-tweet')?.points, -10)
  assert.equal(stats.get('dex-paid')?.points, 10)
})

test('late alerts teach nothing, motion tags never cost points, and a pattern must fail more than alerts do overall', () => {
  const failed = (tags: string, stretch: number | null) => ({ tags_json: tags, outcome: 'false-positive' as const, stretch })
  const late = patternStats([...Array.from({ length: 6 }, () => failed('["x-tweet","dev-zero"]', 120)), ...Array.from({ length: 6 }, () => failed('["x-tweet","dev-zero"]', null))])
  assert.equal(late.size, 0)
  const motion = patternStats([
    ...Array.from({ length: 6 }, () => failed('["moving-up","viewers-surging","holders-growing","mcap-growing","website"]', 12)),
    ...Array.from({ length: 6 }, () => ({ tags_json: '["telegram"]', outcome: 'neither' as const, stretch: 12 })),
  ])
  for (const tag of ['moving-up', 'viewers-surging', 'holders-growing', 'mcap-growing']) assert.equal(motion.get(tag)?.points, 0, tag)
  assert.equal(motion.get('moving-up')?.count, 6)
  assert.equal(motion.get('website')?.points, -10)
  const everyAlertFails = patternStats(Array.from({ length: 8 }, () => failed('["dev-zero","deep-liquidity","x-tweet"]', 5)))
  for (const tag of ['dev-zero', 'deep-liquidity', 'x-tweet']) assert.equal(everyAlertFails.get(tag)?.points, 0, tag)
})

test('the ledger lists every gate and rule, and its points add up to the score', () => {
  for (const input of [strong(), strong({ top10: 19, dexPaid: false, smartHolders: 0 }), strong({ bundlers: 40 }), strong({ top10: null, dev: null }), strong({ priceChange: { m1: -20, m5: -30 } }), middling({ early: earlyStart(jojoSigns()) }), middling({ dexPaid: false, viewers: 20, early: earlyStart(jojoSigns({ stretchPct: 140, trades5m: 900 })) })]) {
    const result = scoreRunner(input)
    const ledger = result.ledger
    assert.equal(ledger.score, result.score)
    assert.equal(ledger.gates.length, 13)
    assert.equal(ledger.gates.some(gate => gate.status === 'fail'), result.disqualified.length > 0)
    for (const pillar of ledger.pillars) {
      assert.equal(pillar.points, pillar.checks.reduce((total, item) => total + item.points, 0), pillar.key)
      assert.equal(pillar.points, result.parts.find(part => part.key === pillar.key)?.points, pillar.key)
      assert.equal(pillar.max, pillar.checks.reduce((total, item) => total + item.max, 0), pillar.key)
    }
    const adjusted = Math.max(0, Math.min(100, Math.round(ledger.base + ledger.adjustments.reduce((total, item) => total + item.points, 0))))
    assert.equal(ledger.beforeCaps, adjusted)
    const caps = ledger.caps.filter(cap => cap.applies).map(cap => cap.cap)
    assert.equal(ledger.score, Math.min(ledger.beforeCaps, ...caps))
  }
})

test('bundlers may hold up to 35% and pro traders up to 75% before the gate fails', () => {
  assert.equal(scoreRunner(strong({ bundlers: 35 })).ledger.gates.find(gate => gate.label === 'Bundlers')?.status, 'pass')
  assert.equal(scoreRunner(strong({ bundlers: 35.5 })).score, 0)
  assert.equal(scoreRunner(strong({ proTraders: 75 })).ledger.gates.find(gate => gate.label === 'Pro traders holding')?.status, 'pass')
  assert.equal(scoreRunner(strong({ proTraders: 0 })).ledger.gates.find(gate => gate.label === 'Pro traders holding')?.status, 'pass')
  assert.equal(scoreRunner(strong({ proTraders: null })).ledger.gates.find(gate => gate.label === 'Pro traders holding')?.status, 'unknown')
  assert.ok(scoreRunner(strong({ proTraders: 62 })).score > 0)
  assert.equal(scoreRunner(strong({ proTraders: 76 })).score, 0)
})

test('the score trail records each move and says what changed', () => {
  resetScoreTrails()
  const clean = scoreRunner(middling())
  recordScore('coin', now, clean.ledger)
  const steady = recordScore('coin', now + 1_000, clean.ledger)
  assert.equal(steady.changes.length, 0)
  assert.equal(steady.points.length, 1)
  const heavier = scoreRunner(middling({ top10: 19, bundlers: 12 }))
  const moved = recordScore('coin', now + 2_000, heavier.ledger)
  assert.equal(moved.points.length, 2)
  assert.equal(moved.changes.length, 1)
  assert.equal(moved.changes[0].from, clean.score)
  assert.equal(moved.changes[0].to, heavier.score)
  assert.ok(moved.changes[0].reasons.some(reason => reason.includes('Bundlers')), moved.changes[0].reasons.join(' | '))
  const failed = recordScore('coin', now + 3_000, scoreRunner(middling({ top10: 36 })).ledger)
  assert.ok(failed.changes.at(-1)?.reasons.some(reason => reason.startsWith('Top 10 holders gate failed')))
})

test('a coin the radar just found is judged on its earlier chart, not on how long it has been tracked', () => {
  const full = strongTicks()
  const tracked = full.slice(-3)
  const history = minuteClosesFrom(full.slice(0, -3).map(point => [Math.floor((point.t - 59_999) / 1000), point.price, point.price, point.price, point.price, 1] as [number, number, number, number, number, number]).reverse())
  const justFound = scoreRunner(middling({ ticks: tracked }))
  const backfilled = scoreRunner(middling({ ticks: withChartHistory(history, tracked) }))
  const trackedLong = scoreRunner(middling({ ticks: full }))
  assert.ok(backfilled.score > justFound.score, `${backfilled.score} vs ${justFound.score}`)
  assert.equal(backfilled.ledger.pillars.find(pillar => pillar.key === 'chart')?.points, trackedLong.ledger.pillars.find(pillar => pillar.key === 'chart')?.points)
})

test('insiders trimming a few points is a mild alert; twice the trigger is severe', () => {
  let alerts: ReturnType<typeof watchSells> = []
  resetSellWatch()
  for (let second = 0; second < 20; second++) watchSells('coin', reading(now + second * 1_000, { insiders: 10 }))
  for (let second = 20; second < 30; second++) alerts = watchSells('coin', reading(now + second * 1_000, { insiders: 6.5 }))
  assert.ok(alerts.some(alert => alert.text.startsWith('Insiders are selling') && !alert.severe), JSON.stringify(alerts))
  for (let second = 30; second < 40; second++) alerts = watchSells('coin', reading(now + second * 1_000, { insiders: 3 }))
  assert.ok(alerts.some(alert => alert.text.startsWith('Insiders are selling') && alert.severe), JSON.stringify(alerts))
})

test('movement over 5s, 30s, 1m and 5m counts, the 5-minute move most and the 5-second move least', () => {
  const flat = { s5: 0, s30: 0, m1: 0, m5: 0 }
  const onlyFiveSeconds = movementSignal({ ...flat, s5: 5 })?.signal ?? 0
  const onlyThirty = movementSignal({ ...flat, s30: 20 })?.signal ?? 0
  const onlyMinute = movementSignal({ ...flat, m1: 40 })?.signal ?? 0
  const onlyFiveMinutes = movementSignal({ ...flat, m5: 80 })?.signal ?? 0
  assert.ok(onlyFiveSeconds < onlyThirty && onlyThirty < onlyMinute && onlyMinute < onlyFiveMinutes, `${onlyFiveSeconds} ${onlyThirty} ${onlyMinute} ${onlyFiveMinutes}`)
  const quiet = scoreRunner(middling({ priceChange: flat })).score
  const climbing = scoreRunner(middling({ priceChange: { s5: 1, s30: 4, m1: 8, m5: 30 } })).score
  const falling = scoreRunner(middling({ priceChange: { s5: -1, s30: -4, m1: -6, m5: -20 } }))
  assert.ok(climbing > quiet, `${quiet} ${climbing}`)
  assert.ok(falling.score < quiet, `${quiet} ${falling.score}`)
  assert.ok(falling.cuts.some(cut => cut.startsWith('Falling (')), JSON.stringify(falling.cuts))
  assert.equal(movementSignal({ m1: null, m5: null }), null)
  assert.ok((movementSignal({ s5: 8, s30: null, m1: null, m5: null })?.signal ?? 1) <= 0.1)
})

test('a coin under $10K market cap starts 50 points down, whatever else it shows', () => {
  const faded = scoreRunner(strong({ marketCap: 4_000, priceChange: { m1: 0, m5: 0 } }))
  const healthy = scoreRunner(strong({ marketCap: 30_000, priceChange: { m1: 0, m5: 0 } }))
  assert.ok(healthy.score >= 70, String(healthy.score))
  assert.ok(faded.score <= healthy.score - 45, `${healthy.score} ${faded.score}`)
  assert.ok(faded.score <= 50, String(faded.score))
  assert.ok(faded.cuts.some(cut => cut.includes('under $10.0K')), JSON.stringify(faded.cuts))
})

/** The early-start readings of a coin about to move: crowd and trading building, price still near its low. */
function jojoSigns(overrides: Partial<EarlyInput> = {}): EarlyInput {
  return { ageMinutes: 5.9, marketCap: 25_309, viewers: 584, viewersBefore: 534, volume5m: 59_443, volumeBefore: 45_323, trades5m: 1_998, tradesBefore: 1_380, stretchPct: 26, minuteChange: 15.7, ...overrides }
}

/** A clean coin with little attention yet, so added and lost points show without hitting 100. */
function plain(overrides: Partial<RunnerInput> = {}): RunnerInput {
  return strong({ ticks: [], dexPaid: false, smartHolders: 0, viewers: 40, viewersPerMin: 1, holdersPerMin: 2, priceChange: { m1: 0, m5: 0 }, ...overrides })
}

test('points go to the signs before a move: the early-start reading adds up to 20 and a price that already ran earns little', () => {
  assert.equal(earlyBonusPoints(null), 0)
  assert.equal(earlyBonusPoints({ score: 90 }), 18)
  assert.equal(earlyBonusPoints({ score: 100 }), 20)
  const quiet = scoreRunner(plain())
  const building = scoreRunner(plain({ early: earlyStart(jojoSigns()) }))
  assert.ok(building.score >= quiet.score + 18, `${quiet.score} ${building.score}`)
  assert.ok(building.tags.includes('early-start'))
  assert.ok(building.thesis.some(line => line.startsWith('early-start pattern on')))
  assert.ok(!quiet.tags.includes('early-start'))
  const pumped = scoreRunner(plain({ priceChange: { s5: 4, s30: 20, m1: 100, m5: 200 } }))
  assert.ok(pumped.score <= quiet.score + Math.ceil(movementPoints * 1.25), `${quiet.score} ${pumped.score}`)
  assert.ok(!pumped.tags.includes('mcap-growing'))
  assert.ok(building.score > pumped.score, `${building.score} ${pumped.score}`)
})

test('a price stretched above its 3-minute low costs points, and one still near it earns chart points', () => {
  assert.equal(stretchCostFor(null), 0)
  assert.equal(stretchCostFor(35), 0)
  assert.equal(stretchCostFor(36), 1)
  assert.equal(stretchCostFor(80), 5)
  assert.equal(stretchCostFor(400), 10)
  const lowCheck = (stretchPct: number) => scoreRunner(plain({ early: earlyStart(jojoSigns({ stretchPct })) })).ledger.pillars.find(pillar => pillar.key === 'chart')?.checks.at(-1)
  assert.equal(lowCheck(10)?.points, 6)
  assert.equal(lowCheck(30)?.points, 3)
  assert.equal(lowCheck(90)?.points, 0)
  assert.equal(scoreRunner(plain()).ledger.pillars.find(pillar => pillar.key === 'chart')?.checks.at(-1)?.status, 'unknown')
  const near = scoreRunner(plain({ early: earlyStart(jojoSigns({ stretchPct: 30 })) }))
  const stretched = scoreRunner(plain({ early: earlyStart(jojoSigns({ stretchPct: 130 })) }))
  assert.ok(stretched.score <= near.score - 10, `${near.score} ${stretched.score}`)
  assert.ok(stretched.cuts.some(cut => cut.startsWith('Already 130% above its 3-minute low')), JSON.stringify(stretched.cuts))
})

test('fading trading costs points', () => {
  const steady = scoreRunner(plain({ early: earlyStart(jojoSigns({ tradesBefore: 1_950, viewersBefore: 584 })) }))
  const fading = scoreRunner(plain({ early: earlyStart(jojoSigns({ tradesBefore: 2_400, viewersBefore: 584 })) }))
  assert.ok(fading.score <= steady.score - fadingPenalty, `${steady.score} ${fading.score}`)
  assert.ok(fading.cuts.some(cut => cut.includes('trades down')), JSON.stringify(fading.cuts))
})

test('the buy share comes from trade counts when the buy and sell volumes cover little of the 5-minute volume', () => {
  const buyCheck = (overrides: Partial<RunnerInput>) => scoreRunner(strong(overrides)).ledger.pillars.find(pillar => pillar.key === 'momentum')?.checks.find(item => item.label.startsWith('Buys outpace sells'))
  assert.equal(buyCheck({})?.points, 5)
  assert.ok(buyCheck({})?.reading.includes('was buying'))
  const thin = buyCheck({ volume5m: 132_000, buyVolume5m: 900, sellVolume5m: 400, buys5m: 1_835, sells5m: 1_830 })
  assert.equal(thin?.points, 3)
  assert.ok(thin?.reading.startsWith('50% of 3,665 trades were buys'), thin?.reading)
  assert.equal(buyCheck({ volume5m: 132_000, buyVolume5m: 900, sellVolume5m: 400, buys5m: 1_200, sells5m: 2_400 })?.points, 0)
  assert.equal(buyCheck({ volume5m: 132_000, buyVolume5m: 900, sellVolume5m: 400 })?.status, 'unknown')
  assert.equal(buyCheck({ buyVolume5m: null, sellVolume5m: null, buys5m: 700, sells5m: 300 })?.points, 5)
})
