import assert from 'node:assert/strict'
import { test } from 'node:test'
import { earlyCuts, earlyRules, earlyStart, fadingReason, stretchAboveLow, withEarlyGate, type EarlyInput } from './early-start.js'
import { advanceEarly, earlyLogRules, earlyResult, summarizeEarly, type EarlyRow } from './early-log.js'
import { averageViewers, viewerGainPerMinute } from './radar-query.js'
import type { MarketTick } from './live-market.js'

const now = 1_800_000_000_000

/** Jojo's readings 53 seconds before it left its $20-26K range. */
function jojo(overrides: Partial<EarlyInput> = {}): EarlyInput {
  return { ageMinutes: 5.9, marketCap: 25_309, viewers: 584, viewersBefore: 534, volume5m: 59_443, volumeBefore: 45_323, trades5m: 1_998, tradesBefore: 1_380, stretchPct: 26, minuteChange: 15.7, ...overrides }
}

test('the pattern fires on the readings Jojo showed a minute before it ran', () => {
  const early = earlyStart(jojo())
  assert.equal(early.firing, true, early.missing.join(', '))
  assert.equal(early.score, 90)
  assert.deepEqual(early.signs.map(sign => sign.points), [25, 20, 15, 12, 12, 6])
  assert.equal(early.signs.reduce((total, sign) => total + sign.max, 0), 100)
  assert.equal(early.fading, null)
})

test('each missing part stops it firing and is named', () => {
  const cases: Array<[Partial<EarlyInput>, string]> = [
    [{ ageMinutes: 22 }, 'minutes old'],
    [{ marketCap: 9_000, viewers: 400, viewersBefore: 370, volume5m: 20_000, volumeBefore: 15_000 }, 'market cap or more'],
    [{ viewers: 90, viewersBefore: 80, marketCap: 10_500, volume5m: 12_000, volumeBefore: 10_000 }, '100+ watching'],
    [{ marketCap: 120_000, volume5m: 150_000, volumeBefore: 120_000 }, 'per $1K'],
    [{ volume5m: 18_000, volumeBefore: 15_000 }, 'volume at least its market cap'],
    [{ tradesBefore: 1_900 }, 'trades up'],
    [{ viewersBefore: 580 }, 'viewers up'],
    [{ stretchPct: 60 }, '3-minute low'],
    [{ minuteChange: -9 }, 'not falling'],
  ]
  for (const [overrides, said] of cases) {
    const early = earlyStart(jojo(overrides))
    assert.equal(early.firing, false, said)
    assert.ok(early.missing.some(label => label.includes(said)), `${said}: ${early.missing.join(' | ')}`)
  }
  const unread = earlyStart(jojo({ viewers: null, viewersBefore: null }))
  assert.equal(unread.firing, false)
  assert.equal(unread.signs[0].status, 'unknown')
})

test('a failed gate stops it firing without changing the reading', () => {
  const open = earlyStart(jojo())
  const blocked = withEarlyGate(open, 'Bundlers hold 60% (limit 35%)')
  assert.equal(blocked.firing, false)
  assert.equal(blocked.score, open.score)
  assert.equal(blocked.blockedBy, 'Bundlers hold 60% (limit 35%)')
  assert.equal(withEarlyGate(blocked, null).firing, true)
  assert.equal(earlyStart(jojo({ blockedBy: 'Mint authority still enabled' })).firing, false)
})

test('an old, quiet or stretched coin reads low, and fading trading or a falling price costs points', () => {
  const quiet = earlyStart({ ageMinutes: 240, marketCap: 400_000, viewers: 30, viewersBefore: 30, volume5m: 9_000, volumeBefore: 9_000, trades5m: 60, tradesBefore: 60, stretchPct: 4, minuteChange: 0 })
  assert.ok(quiet.score <= 15, String(quiet.score))
  const fading = earlyStart(jojo({ trades5m: 1_200 }))
  assert.equal(fading.fading, '5-minute trades down 13% from a minute ago')
  assert.equal(fading.score, 90 - 15 - earlyCuts.fading)
  assert.equal(fadingReason({ trades5m: 500, tradesBefore: 500, volume5m: 9_000, volumeBefore: 10_000 }), '5-minute volume down 10% from a minute ago')
  assert.equal(fadingReason({ trades5m: 500, tradesBefore: 510, volume5m: null, volumeBefore: null }), null)
  assert.equal(earlyStart(jojo({ minuteChange: -9 })).score, 90 - earlyCuts.falling)
  assert.equal(earlyStart(jojo({ stretchPct: 80 })).signs[5].points, 0)
})

test('the stretch above the 3-minute low ignores one stray reading and older prices', () => {
  const steady = Array.from({ length: 60 }, (_, index) => ({ t: now - (60 - index) * 1_000, price: 1 }))
  assert.equal(stretchAboveLow(steady, now, 1.26), 26)
  const stray = steady.map((point, index) => index === 30 ? { ...point, price: 0.5 } : point)
  assert.equal(stretchAboveLow(stray, now, 1.26), 26)
  const realDip = steady.map((point, index) => index >= 30 && index < 34 ? { ...point, price: 0.5 } : point)
  assert.equal(stretchAboveLow(realDip, now, 1), 100)
  const old = [{ t: now - 10 * 60_000, price: 0.1 }, { t: now - 9 * 60_000, price: 0.1 }, { t: now - 8 * 60_000, price: 0.1 }, ...steady]
  assert.equal(stretchAboveLow(old, now, 1.1), 10)
  assert.equal(stretchAboveLow(steady.slice(0, 2), now, 1), null)
  assert.equal(stretchAboveLow(steady, now, null), null)
  assert.equal(earlyRules.lowWindowMs, 180_000)
})

function row(overrides: Partial<EarlyRow> = {}): EarlyRow {
  return { id: 1, mint: 'm', symbol: 'M', pair_address: null, fired_at: now, price: 1, market_cap: 25_000, score: 90, runner_score: 60, blocked_by: null, peak_15m: 1, low_15m: 1, end_15m: null, hit_win_at: null, hit_loss_at: null, last_price: 1, last_at: now, closed_at: null, ...overrides }
}

test('an early start wins at +50% before -35%, loses the other way round, and is flat with neither by 15 minutes', () => {
  let won = advanceEarly(row(), 1.6, now + 120_000, 1.6)
  assert.equal(earlyResult(won), 'win')
  won = advanceEarly(won, 0.4, now + 300_000, 0.4)
  assert.equal(earlyResult(won), 'win')
  assert.equal(won.low_15m, 0.4)
  won = advanceEarly(won, 0.5, now + earlyLogRules.followMs + 1_000, 0.5)
  assert.equal(won.end_15m, 0.5)
  assert.ok(won.closed_at)
  const lost = advanceEarly(row(), 0.6, now + 60_000, 0.62)
  assert.equal(earlyResult(lost), 'loss')
  const flat = advanceEarly(advanceEarly(row(), 1.2, now + 60_000, 1.2), 1.1, now + earlyLogRules.followMs, 1.1)
  assert.equal(earlyResult(flat), 'flat')
  assert.equal(flat.peak_15m, 1.2)
  assert.equal(earlyResult(row()), null)
})

test('one stray price does not decide an early start, and a coin that vanishes is a loss', () => {
  const stray = advanceEarly(row(), 0.5, now + 10_000, 1)
  assert.equal(earlyResult(stray), null)
  assert.equal(stray.low_15m, 1)
  assert.equal(earlyResult(advanceEarly(stray, 0.5, now + 12_000, 0.5)), 'loss')
  const spike = advanceEarly(row(), 2, now + 10_000, 1)
  assert.equal(earlyResult(spike), null)
  const waiting = advanceEarly(row(), null, now + 60_000)
  assert.equal(waiting.closed_at, null)
  const gone = advanceEarly(row(), null, now + earlyLogRules.goneAfterMs + 1_000)
  assert.equal(earlyResult(gone), 'loss')
  assert.ok(gone.closed_at)
  const wonThenGone = advanceEarly(advanceEarly(row(), 1.7, now + 30_000, 1.7), null, now + 10 * 60_000)
  assert.equal(earlyResult(wonThenGone), 'win')
})

test('the summary counts results and lists the newest first', () => {
  const rows = [
    row({ id: 1, fired_at: now, hit_win_at: now + 1, closed_at: now + 2, peak_15m: 2.4 }),
    row({ id: 2, fired_at: now + 10, hit_loss_at: now + 11, closed_at: now + 12, peak_15m: 1.1 }),
    row({ id: 3, fired_at: now + 20, closed_at: now + 21, peak_15m: 1.3 }),
    row({ id: 4, fired_at: now + 30 }),
    row({ id: 5, fired_at: now + 35, blocked_by: 'Bundlers hold 60% (limit 35%)', hit_win_at: now + 36, closed_at: now + 37, peak_15m: 3.6 }),
    row({ id: 6, fired_at: now + 36, blocked_by: 'Dev holds 9% (limit 5%)' }),
  ]
  const summary = summarizeEarly(rows, now + 40)
  assert.deepEqual([summary.fired, summary.decided, summary.wins, summary.losses, summary.flat], [4, 3, 1, 1, 1])
  assert.equal(summary.medianPeak, 1.3)
  assert.deepEqual(summary.blocked, { fired: 2, decided: 1, wins: 1 })
  assert.deepEqual(summary.recent.map(record => record.id), [6, 5, 4, 3, 2, 1])
  assert.equal(summary.recent[2].result, null)
  assert.equal(summary.recent[1].blockedBy, 'Bundlers hold 60% (limit 35%)')
})

test('viewers gained a minute uses averages, so one jumpy reading does not swing it', () => {
  const tick = (secondsAgo: number, viewers: number | null): MarketTick => ({ t: now - secondsAgo * 1_000, price: 1, viewers, liquidity: null, marketCap: null, holders: null, buys: null })
  const steady: MarketTick[] = Array.from({ length: 80 }, (_, index) => tick(80 - index, 600))
  assert.equal(viewerGainPerMinute(steady, 600, now), 0)
  const jumpy = steady.map(item => now - item.t === 60_000 ? { ...item, viewers: 700 } : item)
  assert.ok(Math.abs(viewerGainPerMinute(jumpy, 600, now) as number) <= 5, String(viewerGainPerMinute(jumpy, 600, now)))
  const rising: MarketTick[] = Array.from({ length: 80 }, (_, index) => tick(80 - index, 500 + index * 2))
  const gain = viewerGainPerMinute(rising, 660, now) as number
  assert.ok(gain >= 100 && gain <= 120, String(gain))
  assert.equal(averageViewers(steady, now - 10_000, now), 600)
  assert.equal(averageViewers([tick(5, null)], now - 10_000, now), null)
  assert.equal(viewerGainPerMinute(steady, null, now), null)
})
