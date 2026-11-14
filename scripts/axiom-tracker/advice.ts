import type { RadarAdvice, RadarAdviceStudy, RadarWarningSign } from '../../src/lib/axiom-radar-learner.js'
import type { RadarToken } from '../../src/lib/axiom-radar-types.js'
import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { learnerState } from './learner-state.js'
import { marketTicks, tickAt } from './live-market.js'
import { median } from './logistic.js'
import { buildRadarTokens, loadModelState } from './radar-query.js'
import { createLogger, runLoop } from './runtime.js'

const logger = createLogger('advice')
const cycleMs = 3_000
const studyEveryMs = 15 * 60_000
const horizonMs = 5 * 60_000
const rebuyWindowMs = 30 * 60_000
const minimumSamples = 20
const glitchMultiple = 50

type Moment = {
  price: number
  priceHigh: number
  firstPrice: number
  viewers: number | null
  viewersHigh: number | null
  viewersBefore: number | null
  liquidity: number | null
  liquidityHigh: number | null
  liquidityBefore: number | null
  buys: number | null
  buysBefore: number | null
  sells: number | null
  volume: number | null
  volumeHigh: number | null
  ageMinutes: number | null
}

const ranUp = (moment: Moment) => moment.priceHigh >= moment.firstPrice * 1.1
const signs: Array<{ key: string; label: string; test: (moment: Moment) => boolean }> = [
  { key: 'viewersOffHigh20', label: 'Viewers 20% below their high', test: moment => moment.viewers !== null && (moment.viewersHigh ?? 0) >= 20 && moment.viewers <= (moment.viewersHigh as number) * 0.8 },
  { key: 'viewersOffHigh40', label: 'Viewers 40% below their high', test: moment => moment.viewers !== null && (moment.viewersHigh ?? 0) >= 20 && moment.viewers <= (moment.viewersHigh as number) * 0.6 },
  { key: 'viewersDrop2m', label: 'Viewers down 25% in 2 minutes', test: moment => moment.viewers !== null && (moment.viewersBefore ?? 0) >= 15 && moment.viewers <= (moment.viewersBefore as number) * 0.75 },
  { key: 'liquidityOffHigh30', label: 'Liquidity 30% below its high', test: moment => moment.liquidity !== null && (moment.liquidityHigh ?? 0) > 3_000 && moment.liquidity <= (moment.liquidityHigh as number) * 0.7 },
  { key: 'liquidityDrop2m', label: 'Liquidity down 15% in 2 minutes', test: moment => moment.liquidity !== null && (moment.liquidityBefore ?? 0) > 3_000 && moment.liquidity <= (moment.liquidityBefore as number) * 0.85 },
  { key: 'buysDrop2m', label: 'Buys down 30% in 2 minutes', test: moment => moment.buys !== null && (moment.buysBefore ?? 0) >= 40 && moment.buys <= (moment.buysBefore as number) * 0.7 },
  { key: 'volumeHalved', label: '5-minute volume half of its high', test: moment => moment.volume !== null && (moment.volumeHigh ?? 0) > 3_000 && moment.volume <= (moment.volumeHigh as number) * 0.5 },
  { key: 'sellsLead', label: 'More sells than buys', test: moment => moment.buys !== null && moment.sells !== null && moment.buys + moment.sells >= 30 && moment.buys / (moment.buys + moment.sells) < 0.45 },
  { key: 'priceOffHigh25', label: 'Price 25% below its high', test: moment => ranUp(moment) && moment.price <= moment.priceHigh * 0.75 },
  { key: 'priceOffHigh50', label: 'Price 50% below its high', test: moment => ranUp(moment) && moment.price <= moment.priceHigh * 0.5 },
  { key: 'old20', label: 'Coin is over 20 minutes old', test: moment => moment.ageMinutes !== null && moment.ageMinutes >= 20 && moment.ageMinutes < 90 },
]
const rebuyDrops = [30, 50, 75]

type SnapshotRow = { viewers: number | null; price: number; liquidity: number | null; volume: number | null; buys: number | null; sells: number | null; t: number }
type Outcome = { end: number; worst: number; best: number }
type Study = RadarAdviceStudy & { levels: Map<string, RadarWarningSign> }

function forward(rows: SnapshotRow[], index: number): Outcome | null {
  const start = rows[index]
  let low = start.price
  let high = start.price
  let last: SnapshotRow | null = null
  for (let ahead = index + 1; ahead < rows.length && rows[ahead].t - start.t <= horizonMs; ahead++) {
    const row = rows[ahead]
    if (row.price > start.price * glitchMultiple) continue
    if (row.price < low) low = row.price
    if (row.price > high) high = row.price
    last = row
  }
  if (!last || last.t - start.t < horizonMs * 0.6) return null
  return { end: last.price / start.price - 1, worst: low / start.price - 1, best: high / start.price - 1 }
}

function before(rows: SnapshotRow[], index: number, spanMs: number, tolerance: number) {
  const target = rows[index].t - spanMs
  let best: SnapshotRow | null = null
  for (let back = index - 1; back >= 0 && rows[index].t - rows[back].t <= spanMs + tolerance; back--) {
    const distance = Math.abs(rows[back].t - target)
    if (distance <= tolerance && (!best || distance < Math.abs(best.t - target))) best = rows[back]
  }
  return best
}

const percent = (count: number, total: number) => total ? Math.round((count / total) * 100) : null

function summarize(key: string, label: string, outcomes: Outcome[]): RadarWarningSign {
  const middle = median(outcomes.map(outcome => outcome.end))
  return { key, label, level: 'none', samples: outcomes.length, fell20Pct: percent(outcomes.filter(outcome => outcome.worst <= -0.2).length, outcomes.length), rose20Pct: percent(outcomes.filter(outcome => outcome.best >= 0.2).length, outcomes.length), medianNext5mPct: middle === null ? null : Math.round(middle * 1000) / 10 }
}

function levelOf(sign: RadarWarningSign, baseline: RadarWarningSign): RadarWarningSign['level'] {
  if (sign.samples < minimumSamples || sign.fell20Pct === null || sign.rose20Pct === null || !baseline.fell20Pct || !baseline.rose20Pct) return 'none'
  const risk = sign.fell20Pct / baseline.fell20Pct
  const upside = sign.rose20Pct / baseline.rose20Pct
  if (risk >= 1.8 && upside <= 1) return 'exit'
  if ((risk >= 1.3 && upside <= 1.1) || upside <= 0.65) return 'tighten'
  return 'none'
}

async function runStudy(database: TrackerDatabase): Promise<Study> {
  const launched = new Map((database.prepare('SELECT mint, pair_created_at FROM tokens').all() as Array<{ mint: string; pair_created_at: number }>).map(row => [row.mint, row.pair_created_at]))
  const mints = (database.prepare('SELECT DISTINCT mint FROM snapshots').all() as Array<{ mint: string }>).map(row => row.mint)
  const series = database.prepare('SELECT viewers, price_usd AS price, liquidity_usd AS liquidity, volume_5m AS volume, buys_5m AS buys, sells_5m AS sells, timestamp AS t FROM snapshots WHERE mint = ? AND price_usd > 0 ORDER BY timestamp ASC')
  const outcomes = new Map<string, Outcome[]>(signs.map(sign => [sign.key, []]))
  const baseline: Outcome[] = []
  const rebuy = new Map(rebuyDrops.map(drop => [drop, { samples: 0, newHigh: 0 }]))
  let unknown = 0
  let measured = 0
  for (let item = 0; item < mints.length; item++) {
    if (item % 25 === 24) await new Promise(resolve => setImmediate(resolve))
    const rows = series.all(mints[item]) as SnapshotRow[]
    if (rows.length < 12) continue
    const created = launched.get(mints[item]) ?? 0
    const active = new Set<string>()
    const dropped = new Set<number>()
    let priceHigh = rows[0].price
    let viewersHigh: number | null = null
    let liquidityHigh: number | null = null
    let volumeHigh: number | null = null
    let previous = rows[0].price
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const held = Math.min(row.price, previous)
      previous = row.price
      const priorHigh = priceHigh
      if (held > priceHigh) priceHigh = held
      if (row.viewers !== null) viewersHigh = Math.max(viewersHigh ?? 0, row.viewers)
      if (row.liquidity !== null) liquidityHigh = Math.max(liquidityHigh ?? 0, row.liquidity)
      if (row.volume !== null) volumeHigh = Math.max(volumeHigh ?? 0, row.volume)
      if (index % 6 === 0) {
        const outcome = forward(rows, index)
        if (outcome) baseline.push(outcome)
      }
      const earlier = before(rows, index, 120_000, 25_000)
      const moment: Moment = { price: row.price, priceHigh, firstPrice: rows[0].price, viewers: row.viewers, viewersHigh, viewersBefore: earlier?.viewers ?? null, liquidity: row.liquidity, liquidityHigh, liquidityBefore: earlier?.liquidity ?? null, buys: row.buys, buysBefore: earlier?.buys ?? null, sells: row.sells, volume: row.volume, volumeHigh, ageMinutes: created > 0 ? (row.t - created) / 60_000 : null }
      for (const sign of signs) {
        const on = sign.test(moment)
        if (on && !active.has(sign.key)) {
          const outcome = forward(rows, index)
          if (outcome) { outcomes.get(sign.key)?.push(outcome); measured += 1 } else unknown += 1
        }
        if (on) active.add(sign.key)
        else active.delete(sign.key)
      }
      if (priceHigh >= rows[0].price * 1.3) {
        for (const drop of rebuyDrops) {
          if (dropped.has(drop) || row.price > priceHigh * (1 - drop / 100)) continue
          dropped.add(drop)
          if (rows[rows.length - 1].t - row.t < 10 * 60_000) continue
          const entry = rebuy.get(drop)
          if (!entry) continue
          entry.samples += 1
          for (let ahead = index + 1; ahead < rows.length && rows[ahead].t - row.t <= rebuyWindowMs; ahead++) {
            if (rows[ahead].price > priorHigh && rows[ahead].price < priorHigh * glitchMultiple) { entry.newHigh += 1; break }
          }
        }
      }
    }
  }
  const base = summarize('baseline', 'Any moment', baseline)
  const results = signs.map(sign => summarize(sign.key, sign.label, outcomes.get(sign.key) ?? [])).map(sign => ({ ...sign, level: levelOf(sign, base) }))
  return {
    baseline: { samples: base.samples, fell20Pct: base.fell20Pct, rose20Pct: base.rose20Pct, medianNext5mPct: base.medianNext5mPct },
    signs: results,
    rebuy: rebuyDrops.map(drop => ({ dropPct: drop, samples: rebuy.get(drop)?.samples ?? 0, newHighPct: percent(rebuy.get(drop)?.newHigh ?? 0, rebuy.get(drop)?.samples ?? 0) })),
    unknownSharePct: percent(unknown, unknown + measured) ?? 0,
    updatedAt: Date.now(),
    levels: new Map(results.map(sign => [sign.key, sign])),
  }
}

type Highs = { viewers: number | null; liquidity: number | null; volume: number | null }

function adviceFor(token: RadarToken, lifecycle: { first_price: number; peak_price: number; rugged_at: number | null; rug_kind: string | null } | undefined, highs: Highs, study: Study, now: number): RadarAdvice {
  const ticks = marketTicks.get(token.mint) ?? []
  const price = token.priceUsd
  const priceHigh = Math.max(lifecycle?.peak_price ?? 0, price ?? 0) || null
  const exitReasons: string[] = []
  const tightenReasons: string[] = []
  const active: string[] = []
  const crashed = Boolean(lifecycle?.rugged_at) && price !== null && priceHigh !== null && price <= priceHigh * 0.7
  if (crashed) exitReasons.push(lifecycle?.rug_kind === 'liquidity pulled' ? 'Liquidity was pulled' : 'Already crashed 75% from its high')
  for (const alert of token.alerts) exitReasons.push(alert)
  if (price !== null && priceHigh !== null) {
    const moment: Moment = {
      price,
      priceHigh,
      firstPrice: lifecycle?.first_price ?? price,
      viewers: token.viewers,
      viewersHigh: highs.viewers,
      viewersBefore: tickAt(ticks, now - 120_000, 15_000, 'viewers'),
      liquidity: token.liquidityUsd,
      liquidityHigh: highs.liquidity,
      liquidityBefore: tickAt(ticks, now - 120_000, 15_000, 'liquidity'),
      buys: token.buys5m,
      buysBefore: ticks.find(tick => tick.buys !== null && Math.abs(now - 120_000 - tick.t) <= 15_000)?.buys ?? null,
      sells: token.sells5m,
      volume: token.volume5m,
      volumeHigh: highs.volume,
      ageMinutes: token.ageMinutes,
    }
    for (const sign of signs) {
      const learned = study.levels.get(sign.key)
      if (!learned || learned.level === 'none' || !sign.test(moment)) continue
      active.push(sign.key)
      const reason = `${sign.label}: ${learned.fell20Pct}% of coins like this fell 20%+ within 5 minutes and ${learned.rose20Pct}% rose 20%+ (normal is ${study.baseline.fell20Pct}% and ${study.baseline.rose20Pct}%)`
      if (learned.level === 'exit') exitReasons.push(reason)
      else tightenReasons.push(reason)
    }
  }
  const drawdownPct = price !== null && priceHigh !== null && priceHigh > 0 ? Math.max(0, Math.round((1 - price / priceHigh) * 1000) / 10) : null
  const rebuyReasons: string[] = []
  let rebuy: RadarAdvice['rebuy'] = 'ok'
  if (crashed || token.alerts.length > 0) {
    rebuy = 'never'
    rebuyReasons.push(crashed ? 'This coin already crashed' : 'This coin has a warning')
  } else {
    if (exitReasons.length || tightenReasons.length) rebuyReasons.push('It is showing warning signs right now')
    const fallen = study.rebuy.filter(entry => drawdownPct !== null && drawdownPct >= entry.dropPct && entry.samples >= 10 && entry.newHighPct !== null && entry.newHighPct < 50).at(-1)
    if (fallen) rebuyReasons.push(`It is ${Math.round(drawdownPct ?? 0)}% below its high: only ${fallen.newHighPct}% of coins that fell ${fallen.dropPct}% made a new high within 30 minutes`)
    if (rebuyReasons.length) rebuy = 'wait'
  }
  return {
    exit: exitReasons.length ? 'exit' : tightenReasons.length ? 'tighten' : 'hold',
    exitReasons: [...exitReasons, ...tightenReasons].slice(0, 6),
    rebuy,
    rebuyReasons,
    signs: active,
    highPrice: priceHigh,
    drawdownPct,
    crashed,
  }
}

export async function prepareAdvice(database: TrackerDatabase) {
  return runStudy(database)
}

export function runAdviceCycle(database: TrackerDatabase, study: Study, highs: Map<string, Highs>, now = Date.now()) {
  const tokens = buildRadarTokens(database, loadModelState(database).weights, now)
  const lifecycle = database.prepare('SELECT first_price, peak_price, rugged_at, rug_kind FROM coin_lifecycles WHERE mint = ?')
  const seed = database.prepare('SELECT MAX(viewers) AS viewers, MAX(liquidity_usd) AS liquidity, MAX(volume_5m) AS volume FROM snapshots WHERE mint = ?')
  const advice = new Map<string, RadarAdvice>()
  for (const token of tokens) {
    let high = highs.get(token.mint)
    if (!high) {
      high = seed.get(token.mint) as Highs
      highs.set(token.mint, high)
    }
    if (token.viewers !== null) high.viewers = Math.max(high.viewers ?? 0, token.viewers)
    if (token.liquidityUsd !== null) high.liquidity = Math.max(high.liquidity ?? 0, token.liquidityUsd)
    if (token.volume5m !== null) high.volume = Math.max(high.volume ?? 0, token.volume5m)
    advice.set(token.mint, adviceFor(token, lifecycle.get(token.mint) as Parameters<typeof adviceFor>[1], high, study, now))
  }
  if (highs.size > 600) for (const mint of highs.keys()) if (!advice.has(mint)) highs.delete(mint)
  learnerState.advice = advice
  return advice
}

export function startAdvice(database: TrackerDatabase, signal: AbortSignal) {
  let study: Study | null = null
  let studiedAt = 0
  let studying = false
  const highs = new Map<string, Highs>()
  return runLoop('advice', cycleMs, async () => {
    const now = Date.now()
    if (!studying && (!study || now - studiedAt >= studyEveryMs)) {
      studying = true
      try {
        study = await runStudy(database)
        studiedAt = Date.now()
        const { levels: _levels, ...summary } = study
        learnerState.adviceStudy = summary
        logger.info('Warning signs re-tested', { exit: study.signs.filter(sign => sign.level === 'exit').map(sign => sign.key), tighten: study.signs.filter(sign => sign.level === 'tighten').map(sign => sign.key), unknownSharePct: study.unknownSharePct })
      } finally {
        studying = false
      }
    }
    if (!study) return
    const advice = runAdviceCycle(database, study, highs, now)
    const exits = [...advice.values()].filter(item => item.exit === 'exit').length
    recordHeartbeat(database, 'advice', 'ok', `${study.signs.filter(sign => sign.level !== 'none').length} warning signs in use, ${exits} coins flagged to exit`)
  }, logger, signal)
}
