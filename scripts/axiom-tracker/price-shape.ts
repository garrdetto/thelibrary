export type PricePoint = { t: number; price: number }

export type PriceShape = {
  points: number
  runStartAt: number
  peakAt: number
  dumpAt: number | null
  steadyRise: boolean
  steadyFall: boolean
}

/** A coin dumped when it fell this far below its peak. */
export const dumpDrop = 0.5
/** A coin that runs and dumps within this long of its breakout is a pump and dump. */
export const quickDumpMs = 15 * 60_000
const minimumPoints = 8
const minimumLegMs = 5 * 60_000
const bucketMs = 60_000

function minuteCloses(points: PricePoint[]) {
  const closes: PricePoint[] = []
  for (const point of points) {
    const bucket = Math.floor(point.t / bucketMs)
    const last = closes[closes.length - 1]
    if (last && Math.floor(last.t / bucketMs) === bucket) closes[closes.length - 1] = point
    else closes.push(point)
  }
  return closes
}

/** How well log price follows a straight line through time, from 0 (not at all) to 1 (exactly). */
function lineFit(points: PricePoint[]) {
  const xs = points.map(point => point.t)
  const ys = points.map(point => Math.log(point.price))
  const meanX = xs.reduce((total, value) => total + value, 0) / xs.length
  const meanY = ys.reduce((total, value) => total + value, 0) / ys.length
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let index = 0; index < xs.length; index++) {
    sxy += (xs[index] - meanX) * (ys[index] - meanY)
    sxx += (xs[index] - meanX) ** 2
    syy += (ys[index] - meanY) ** 2
  }
  return sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy)
}

function stepShare(points: PricePoint[], up: boolean) {
  let moves = 0
  let wanted = 0
  for (let index = 1; index < points.length; index++) {
    const change = points[index].price - points[index - 1].price
    if (change === 0) continue
    moves += 1
    if (change > 0 === up) wanted += 1
  }
  return moves ? wanted / moves : 0
}

/** A climb with no real pullbacks that rises almost every minute on a straight line: the manufactured run before a rug. */
function isSteadyRise(leg: PricePoint[]) {
  if (leg.length < 6 || leg[leg.length - 1].t - leg[0].t < minimumLegMs) return false
  let high = leg[0].price
  let deepest = 0
  for (const point of leg) {
    high = Math.max(high, point.price)
    deepest = Math.min(deepest, point.price / high - 1)
  }
  return deepest > -0.15 && stepShare(leg, true) >= 0.7 && lineFit(leg) >= 0.9
}

/** A slide that falls almost every minute on a straight line with no real bounce: holders being sold into on a schedule. */
function isSteadyFall(leg: PricePoint[]) {
  if (leg.length < 6 || leg[leg.length - 1].t - leg[0].t < minimumLegMs) return false
  if (leg[leg.length - 1].price > leg[0].price * 0.6) return false
  let low = leg[0].price
  let biggestBounce = 0
  for (const point of leg) {
    low = Math.min(low, point.price)
    biggestBounce = Math.max(biggestBounce, point.price / low - 1)
  }
  return biggestBounce < 0.15 && stepShare(leg, false) >= 0.7 && lineFit(leg) >= 0.85
}

/**
 * Reads a coin's price history: where its breakout began (the low before its peak), when it peaked, when it first fell
 * half below that peak, and whether the climb and the slide were both suspiciously steady.
 */
export function analyzeShape(history: PricePoint[]): PriceShape | null {
  const points = history.filter(point => Number.isFinite(point.price) && point.price > 0).sort((first, second) => first.t - second.t)
  if (points.length < minimumPoints) return null
  let peakIndex = 0
  for (let index = 1; index < points.length; index++) if (points[index].price > points[peakIndex].price) peakIndex = index
  let startIndex = 0
  for (let index = 1; index <= peakIndex; index++) if (points[index].price < points[startIndex].price) startIndex = index
  const peak = points[peakIndex]
  const dump = points.slice(peakIndex + 1).find(point => point.price <= peak.price * (1 - dumpDrop)) ?? null
  const closes = minuteCloses(points)
  const rise = minuteCloses(points.slice(startIndex, peakIndex + 1))
  const fall = minuteCloses(points.slice(peakIndex))
  return {
    points: points.length,
    runStartAt: points[startIndex].t,
    peakAt: peak.t,
    dumpAt: dump?.t ?? null,
    steadyRise: closes.length >= 6 && isSteadyRise(rise),
    steadyFall: closes.length >= 6 && isSteadyFall(fall),
  }
}

export function quickDump(shape: PriceShape | null) {
  return shape !== null && shape.dumpAt !== null && shape.dumpAt - shape.runStartAt <= quickDumpMs
}
