import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceAlert, patternStats, thresholdFor, type AlertRow } from './runner-learning.js'
import { scoreRunner, sellImpact, serialLauncherCap, softPenalties, staircase, waveRecovery, type PricePoint, type RunnerInput } from './runner-score.js'
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
    rugged: false,
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
    ['top10', { top10: 31 }],
    ['bundlers', { bundlers: 36 }],
    ['pro traders', { proTraders: 51 }],
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

test('each point the top 10 hold above 15% costs one point', () => {
  const at15 = scoreRunner(middling({ top10: 15 })).score
  const at22 = scoreRunner(middling({ top10: 22 })).score
  assert.equal(at15 - at22, 7)
  assert.equal(scoreRunner(middling({ top10: 14 })).score, at15)
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
  assert.ok(plan.triggers.some(line => line.includes('bundler share')))
})

const reading = (t: number, values: Partial<ShareReading>): ShareReading => ({ t, source: 'pulse', top10: 18, bundlers: 12, insiders: 4, dev: 0, price: 1, ...values })

test('bundlers dropping 2 points within a minute raise an instant alert', () => {
  resetSellWatch()
  for (let second = 0; second < 20; second++) watchSells('coin', reading(now + second * 1_000, {}))
  let alerts: ReturnType<typeof watchSells> = []
  for (let second = 20; second < 30; second++) alerts = watchSells('coin', reading(now + second * 1_000, { bundlers: 8, price: 0.9 }))
  assert.ok(alerts.some(alert => alert.text.startsWith('Bundlers are selling')), JSON.stringify(alerts))
})

test('a one-second flicker or a switch of data source is not a sell', () => {
  resetSellWatch()
  let alerts: ReturnType<typeof watchSells> = []
  for (let second = 0; second < 20; second++) alerts = watchSells('coin', reading(now + second * 1_000, { bundlers: second === 15 ? 7 : 12 }))
  assert.equal(alerts.length, 0)
  resetSellWatch()
  for (let second = 0; second < 10; second++) watchSells('coin', reading(now + second * 1_000, { top10: 24 }))
  for (let second = 10; second < 20; second++) alerts = watchSells('coin', reading(now + second * 1_000, { source: 'chain', top10: 14, price: 0.8 }))
  assert.equal(alerts.length, 0)
})

test('top holders selling needs the price to fall too, and a dev sell is flagged', () => {
  resetSellWatch()
  for (let second = 0; second < 10; second++) watchSells('coin', reading(now + second * 1_000, { top10: 22, dev: 3 }))
  let alerts: ReturnType<typeof watchSells> = []
  for (let second = 10; second < 20; second++) alerts = watchSells('coin', reading(now + second * 1_000, { top10: 17, dev: 1, price: 0.85 }))
  assert.ok(alerts.some(alert => alert.text.startsWith('Top holders are selling')))
  assert.ok(alerts.some(alert => alert.dev))
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
    ...Array.from({ length: 4 }, () => ({ tags_json: '["x-tweet"]', outcome: 'false-positive' as const })),
    { tags_json: '["x-tweet"]', outcome: 'neither' as const },
    ...Array.from({ length: 3 }, () => ({ tags_json: '["dex-paid"]', outcome: 'runner' as const })),
    ...Array.from({ length: 2 }, () => ({ tags_json: '["dex-paid"]', outcome: 'neither' as const })),
  ]
  const stats = patternStats(rows)
  assert.equal(stats.get('x-tweet')?.points, -10)
  assert.equal(stats.get('dex-paid')?.points, 10)
})

test('the ledger lists every gate and rule, and its points add up to the score', () => {
  for (const input of [strong(), strong({ top10: 19, dexPaid: false, smartHolders: 0 }), strong({ bundlers: 40 }), strong({ top10: null, dev: null }), strong({ priceChange: { m1: -20, m5: -30 } })]) {
    const result = scoreRunner(input)
    const ledger = result.ledger
    assert.equal(ledger.score, result.score)
    assert.equal(ledger.gates.length, 14)
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

test('bundlers may hold up to 35% and pro traders up to 50% before the gate fails', () => {
  assert.equal(scoreRunner(strong({ bundlers: 35 })).ledger.gates.find(gate => gate.label === 'Bundlers')?.status, 'pass')
  assert.equal(scoreRunner(strong({ bundlers: 35.5 })).score, 0)
  assert.equal(scoreRunner(strong({ proTraders: 50 })).ledger.gates.find(gate => gate.label === 'Pro traders holding')?.status, 'pass')
  assert.equal(scoreRunner(strong({ proTraders: 0 })).ledger.gates.find(gate => gate.label === 'Pro traders holding')?.status, 'pass')
  assert.equal(scoreRunner(strong({ proTraders: null })).ledger.gates.find(gate => gate.label === 'Pro traders holding')?.status, 'unknown')
  assert.equal(scoreRunner(strong({ proTraders: 62 })).score, 0)
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
  assert.ok(moved.changes[0].reasons.some(reason => reason.includes('Top 10 over 15%')), moved.changes[0].reasons.join(' | '))
  const failed = recordScore('coin', now + 3_000, scoreRunner(middling({ top10: 31 })).ledger)
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

test('a trim of a couple of points is a mild alert; twice the trigger is severe', () => {
  resetSellWatch()
  for (let second = 0; second < 20; second++) watchSells('coin', reading(now + second * 1_000, {}))
  let alerts: ReturnType<typeof watchSells> = []
  for (let second = 20; second < 30; second++) alerts = watchSells('coin', reading(now + second * 1_000, { bundlers: 9.5 }))
  assert.ok(alerts.some(alert => alert.text.startsWith('Bundlers are selling') && !alert.severe), JSON.stringify(alerts))
  for (let second = 30; second < 40; second++) alerts = watchSells('coin', reading(now + second * 1_000, { bundlers: 6 }))
  assert.ok(alerts.some(alert => alert.text.startsWith('Bundlers are selling') && alert.severe), JSON.stringify(alerts))
})
