import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceAlert, patternStats, thresholdFor, type AlertRow } from './runner-learning.js'
import { scoreRunner, sellImpact, staircase, waveRecovery, type PricePoint, type RunnerInput } from './runner-score.js'
import { resetSellWatch, watchSells, type ShareReading } from './sell-watch.js'

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
    fresh: 4,
    holders: 260,
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
    viewers: 120,
    viewersPerMin: 14,
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
  assert.equal(parts.distribution, 30)
  assert.equal(parts.momentum, 30)
  assert.equal(parts.hype, 25)
})

test('every step 1 disqualifier, fresh wallets, bot climbs and selling make it 0', () => {
  const cases: Array<[string, Partial<RunnerInput>]> = [
    ['mint', { mintAuthority: true }],
    ['freeze', { freezeAuthority: true }],
    ['dev', { dev: 5.5, devSold: false }],
    ['top10', { top10: 26 }],
    ['bundlers', { bundlers: 16 }],
    ['serial', { devCreated: 400, devMigrated: 6 }],
    ['recycled', { recycled: 'Recycled name: 3 earlier coins called X crashed' }],
    ['dead', { buyers5m: 3 }],
    ['no volume', { volume5m: 0 }],
    ['fresh', { fresh: 10.5 }],
    ['snipers', { snipers: 31 }],
    ['bot', { botReason: '90% of wallets only buy' }],
    ['selling', { selling: ['Bundlers are selling: 12% to 7% of supply in 20s'] }],
  ]
  for (const [name, overrides] of cases) {
    const result = scoreRunner(strong(overrides))
    assert.equal(result.score, 0, name)
    assert.ok(result.disqualified.length > 0, name)
    assert.equal(result.holderRisk.blocked, true, name)
  }
})

test('each point the top 10 hold above 15% costs one point', () => {
  const at15 = scoreRunner(strong({ top10: 15 })).score
  const at22 = scoreRunner(strong({ top10: 22 })).score
  assert.equal(at15 - at22, 7)
  const under = scoreRunner(strong({ top10: 14 })).score
  assert.equal(under - at15, 15)
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
