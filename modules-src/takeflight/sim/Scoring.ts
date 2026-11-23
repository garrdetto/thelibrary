/**
 * Scores a flight from its 10 Hz telemetry and touchdown events. Five weighted categories, each the weighted mean of metrics
 * scored 0..1 between a "good" and a "bad" threshold:
 *   landing 40 (sink rate, G, centreline, touchdown zone, bounces, crab, wings level),
 *   approach 20 (glidepath, speed, centreline tracking, stabilised by 500 ft),
 *   smoothness 15 (jerk, G excursions, bank and pitch excursions),
 *   procedure 15 (flap and never-exceed overspeed, stall warnings, strikes, steep bank, taxi speed),
 *   operations 10 (landed on the runway, full stop, stayed on the pavement, stopped before the end).
 * Categories the flight never reached (no landing, no approach) score zero and the flight is graded Incomplete, so ending a
 * flight early never pays. The total is multiplied by the assists multiplier; a crash scores zero. Renderer-free and exact, so the Worker can re-score a re-flown flight.
 */
import type { AirportSpec, RunwayEnd, RunwaySpec } from '../shared/Airports'
import { aimDistance, pavementAt, runwayEndFor } from '../shared/Airports'
import type { AircraftSpec } from '../shared/AircraftSpec'
import type { AssistSettings } from './Assists'
import { assistMultiplier } from './Assists'
import { FOOT, FPM, KNOT } from './Atmosphere'
import type { CrashReason } from './FlightModel'
import { RAD, atan2 } from './SimMath'
import { CH, CHANNELS, TELEMETRY_HZ } from './Telemetry'
import type { TouchdownEvent } from './Telemetry'

export type CategoryId = 'landing' | 'approach' | 'smoothness' | 'procedure' | 'operations'
export type EndReason = 'stopped' | 'pilot' | 'crash'

export interface FlightData {
  spec: AircraftSpec
  airport: AirportSpec
  assists: AssistSettings
  telemetry: Float32Array
  samples: number
  touchdowns: readonly TouchdownEvent[]
  crashed: CrashReason | null
  ended: EndReason
}

export interface MetricScore {
  id: string
  label: string
  /** Shown value with its unit. */
  value: string
  score: number
  weight: number
  tip: string
}

export interface CategoryScore {
  id: CategoryId
  label: string
  weight: number
  /** 0..100, or null when the flight never reached this part. */
  score: number | null
  metrics: MetricScore[]
}

export interface LandingSummary {
  runway: string
  tick: number
  sinkFpm: number
  g: number
  /** Metres right of the centreline (negative left). */
  centreline: number
  /** Metres past the threshold, and past (positive) or short of the aiming point. */
  fromThreshold: number
  fromAim: number
  bounces: number
  crab: number
  bank: number
  iasKt: number
  surface: string
}

export interface FlightScore {
  total: number
  raw: number
  multiplier: number
  grade: string
  crashed: CrashReason | null
  categories: CategoryScore[]
  landing: LandingSummary | null
  tips: string[]
  seconds: number
  fuelUsed: number
  /** Telemetry sample range for the touchdown graph (start inclusive, end exclusive). */
  graph: { from: number; to: number } | null
}

export const CATEGORY_WEIGHTS: Record<CategoryId, number> = { landing: 40, approach: 20, smoothness: 15, procedure: 15, operations: 10 }
const CATEGORY_LABELS: Record<CategoryId, string> = { landing: 'Landing', approach: 'Approach', smoothness: 'Smoothness', procedure: 'Procedure', operations: 'Operations' }
/** A touchdown after at least this long in the air starts a landing; shorter hops after it are bounces. */
export const LANDING_AIRBORNE = 8
const BOUNCE_WINDOW = 10
const APPROACH_FROM = 4630
const APPROACH_TO_HEIGHT = 200 * FOOT
const STABLE_HEIGHT = 500 * FOOT
const GLIDEPATH_DOT = 0.35
const SAMPLE_DT = 1 / TELEMETRY_HZ

/** 1 at or below `good`, 0 at or beyond `bad`, linear between. */
export function band(value: number, good: number, bad: number): number {
  if (value <= good) return 1
  if (value >= bad) return 0
  return 1 - (value - good) / (bad - good)
}

const abs = Math.abs
const round = (value: number, places = 0) => {
  const f = places === 0 ? 1 : places === 1 ? 10 : 100
  return Math.round(value * f) / f
}
const fixed = (value: number, places: number) => round(value, places).toFixed(places)

function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

function metric(id: string, label: string, value: string, score: number, weight: number, tip: string): MetricScore {
  return { id, label, value, score: score < 0 ? 0 : score > 1 ? 1 : score, weight, tip }
}

function categoryScore(metrics: MetricScore[]): number {
  let sum = 0
  let weights = 0
  for (const m of metrics) {
    sum += m.score * m.weight
    weights += m.weight
  }
  return weights > 0 ? round((sum / weights) * 100, 1) : 0
}

export function gradeFor(total: number, crashed: boolean, landed = true): string {
  if (crashed) return 'Crashed'
  if (!landed) return 'Incomplete'
  if (total >= 96) return 'Exceptional'
  if (total >= 88) return 'Excellent'
  if (total >= 75) return 'Good'
  if (total >= 58) return 'Fair'
  return 'Needs work'
}

interface Landing {
  touchdown: TouchdownEvent
  bounces: number
  runway: RunwaySpec | null
  end: RunwayEnd | null
}

export interface RunwayContact {
  runway: RunwaySpec
  end: RunwayEnd
  /** Metres past the threshold along the landing direction, and right of the centreline. */
  along: number
  cross: number
}

/** The runway (and the end flown on `track`) nearest a point on or near the airport, or null when none is close. */
export function runwayContact(airport: AirportSpec, x: number, z: number, track: number): RunwayContact | null {
  let best: RunwayContact | null = null
  for (const runway of airport.runways) {
    const end = runwayEndFor(runway, track)
    const rx = x - end.x
    const rz = z - end.z
    const along = rx * end.dx + rz * end.dz
    const cross = rx * -end.dz + rz * end.dx
    if (along < -600 || along > runway.length + 600 || abs(cross) > 400) continue
    if (!best || abs(cross) < abs(best.cross)) best = { runway, end, along, cross }
  }
  return best
}

function findLanding(data: FlightData): Landing | null {
  let landingIndex = -1
  for (let i = 0; i < data.touchdowns.length; i++) if (data.touchdowns[i].airborne >= LANDING_AIRBORNE) landingIndex = i
  if (landingIndex < 0) return null
  const touchdown = data.touchdowns[landingIndex]
  let bounces = 0
  for (let i = landingIndex + 1; i < data.touchdowns.length; i++) {
    const next = data.touchdowns[i]
    if ((next.tick - touchdown.tick) / 120 <= BOUNCE_WINDOW && next.airborne < LANDING_AIRBORNE) bounces++
  }
  const contact = runwayContact(data.airport, touchdown.x, touchdown.z, touchdown.track)
  return { touchdown, bounces, runway: contact ? contact.runway : null, end: contact ? contact.end : null }
}

function sample(t: Float32Array, index: number, channel: number): number {
  return t[index * CHANNELS + channel]
}

function landingCategory(landing: Landing): { metrics: MetricScore[]; summary: LandingSummary } {
  const td = landing.touchdown
  const runway = landing.runway
  const end = landing.end
  let fromThreshold = 0
  let centreline = 0
  let fromAim = 0
  const surface = pavementAt(td.x, td.z) ?? 'grass'
  if (runway && end) {
    const rx = td.x - end.x
    const rz = td.z - end.z
    fromThreshold = rx * end.dx + rz * end.dz
    centreline = rx * -end.dz + rz * end.dx
    fromAim = fromThreshold - aimDistance(runway)
  }
  const onRunway = runway !== null && surface === 'runway'
  const halfWidth = runway ? runway.width * 0.5 : 15
  const sinkFpm = td.sinkRate / FPM
  const crab = abs(angleDiff(td.heading, td.track))
  const metrics = [
    metric('sink', 'Sink rate at touchdown', `${Math.round(sinkFpm)} fpm`, band(sinkFpm, 180, 600), 30, sinkFpm > 400 ? 'Touchdown was firm: hold the flare a little longer and let the speed bleed off, aiming for under 180 fpm.' : 'Ease the descent rate down in the flare: a gentle raise of the nose a few feet above the runway softens the arrival.'),
    metric('g', 'Load at touchdown', `${fixed(td.g, 2)} G`, band(td.g, 1.5, 2.6), 15, 'The wheels took a hard load: reduce the sink rate before the mains touch and keep the nose wheel off until the mains are down.'),
    metric('centreline', 'Distance from centreline', `${fixed(abs(centreline) / FOOT, 0)} ft ${centreline >= 0 ? 'right' : 'left'}`, onRunway ? band(abs(centreline), 1.5, halfWidth) : 0, 15, 'Track the centreline all the way down: small rudder and aileron corrections in the last 200 ft keep you on it.'),
    metric('zone', 'Touchdown zone', fromThreshold < 0 ? `${fixed(-fromThreshold / FOOT, 0)} ft short` : `${fixed(fromAim / FOOT, 0)} ft ${fromAim >= 0 ? 'past' : 'before'} the aim point`, onRunway && fromThreshold > 0 ? band(abs(fromAim), 120, 450) : 0, 15, fromAim > 0 ? 'Landed long: hold the PAPI at two white and two red, reduce power earlier and do not float in the flare.' : 'Landed short of the aim point: keep the aiming-point markings fixed in the windscreen until the flare.'),
    metric('bounces', 'Bounces', String(landing.bounces), 1 - landing.bounces * 0.5, 15, 'The aircraft bounced: arrive slower with the nose slightly up so the wing stops flying as the wheels touch.'),
    metric('crab', 'Crab at touchdown', `${fixed(crab, 1)}°`, band(crab, 2, 10), 10, 'Kick out the crab before touchdown: use rudder to line the nose up with the runway and a little upwind aileron.'),
    metric('bank', 'Wings level at touchdown', `${fixed(abs(td.bank), 1)}°`, band(abs(td.bank), 3, 10), 5, 'Touch down with the wings level, or only slightly low on the upwind side in a crosswind.'),
  ]
  return {
    metrics,
    summary: { runway: end ? end.name : '—', tick: td.tick, sinkFpm: round(sinkFpm), g: round(td.g, 2), centreline: round(centreline, 1), fromThreshold: round(fromThreshold), fromAim: round(fromAim), bounces: landing.bounces, crab: round(crab, 1), bank: round(td.bank, 1), iasKt: round(td.ias / KNOT), surface: onRunway ? 'runway' : surface },
  }
}

function approachCategory(data: FlightData, landing: Landing): MetricScore[] | null {
  const runway = landing.runway
  const end = landing.end
  if (!runway || !end) return null
  const t = data.telemetry
  const elevation = data.airport.elevation
  const aimX = end.x + end.dx * aimDistance(runway)
  const aimZ = end.z + end.dz * aimDistance(runway)
  const vapp = data.spec.vSpeeds.vapp
  let count = 0
  let gpSq = 0
  let speedSq = 0
  let locSq = 0
  let stable: number | null = null
  const last = Math.min(data.samples, Math.floor(landing.touchdown.tick / 12))
  for (let i = 0; i < last; i++) {
    if (sample(t, i, CH.onGround) > 0) continue
    const x = sample(t, i, CH.x)
    const z = sample(t, i, CH.z)
    const along = (aimX - x) * end.dx + (aimZ - z) * end.dz
    const cross = (x - aimX) * -end.dz + (z - aimZ) * end.dx
    if (along < 30 || along > APPROACH_FROM) continue
    if (abs(cross) > along * 0.18 + 150) continue
    if (abs(angleDiff(sample(t, i, CH.heading), end.heading)) > 35) continue
    const height = sample(t, i, CH.y) - 1.3 - elevation
    if (height < APPROACH_TO_HEIGHT) continue
    const dots = (atan2(height, along) * RAD - runway.glidepath) / GLIDEPATH_DOT
    const speed = sample(t, i, CH.ias) / KNOT - vapp
    const loc = atan2(cross, along + runway.length) * RAD
    gpSq += dots * dots
    speedSq += speed * speed
    locSq += loc * loc
    count++
    if (height < STABLE_HEIGHT + 40) {
      let met = 0
      if (abs(speed) <= 10) met++
      if (abs(dots) <= 1) met++
      if (sample(t, i, CH.verticalSpeed) / FPM > -1000) met++
      if (abs(sample(t, i, CH.bank)) < 15) met++
      stable = met / 4
    }
  }
  if (count < 5 / SAMPLE_DT) return null
  const gp = Math.sqrt(gpSq / count)
  const speed = Math.sqrt(speedSq / count)
  const loc = Math.sqrt(locSq / count)
  return [
    metric('glidepath', 'Glidepath holding', `${fixed(gp, 2)} dots RMS`, band(gp, 0.4, 2), 35, 'Hold the glidepath: keep the PAPI at two white and two red, using power for the path and pitch for the speed.'),
    metric('speed', 'Approach speed', `±${fixed(speed, 1)} kt from ${vapp} kt`, band(speed, 4, 15), 30, `Fly the approach at ${vapp} kt: trim for it early so the speed holds itself.`),
    metric('tracking', 'Centreline tracking', `${fixed(loc, 2)}° RMS`, band(loc, 0.6, 3.5), 20, 'Line up earlier on final: small heading changes of 5° or less keep you on the extended centreline.'),
    metric('stable', 'Stabilised by 500 ft', stable === null ? 'not checked' : stable >= 1 ? 'yes' : `${Math.round(stable * 4)} of 4`, stable === null ? 0.5 : stable, 15, 'Be stabilised by 500 ft: on speed, on the glidepath, wings level and sinking less than 1,000 fpm, or go around.'),
  ]
}

function smoothnessCategory(data: FlightData): MetricScore[] | null {
  const t = data.telemetry
  let airborne = 0
  let jerkSq = 0
  let jerkCount = 0
  let gDev = 0
  let maxBank = 0
  let maxPitch = 0
  let previousG = NaN
  for (let i = 0; i < data.samples; i++) {
    if (sample(t, i, CH.onGround) > 0) {
      previousG = NaN
      continue
    }
    airborne++
    const g = sample(t, i, CH.g)
    if (previousG === previousG) {
      const jerk = (g - previousG) / SAMPLE_DT
      jerkSq += jerk * jerk
      jerkCount++
    }
    previousG = g
    const up = sample(t, i, CH.gMax) - 1
    const down = 1 - sample(t, i, CH.gMin)
    if (up > gDev) gDev = up
    if (down > gDev) gDev = down
    const bank = abs(sample(t, i, CH.bank))
    if (bank > maxBank) maxBank = bank
    const pitch = abs(sample(t, i, CH.pitch))
    if (pitch > maxPitch) maxPitch = pitch
  }
  if (airborne < 10 / SAMPLE_DT || jerkCount === 0) return null
  const jerk = Math.sqrt(jerkSq / jerkCount)
  return [
    metric('jerk', 'Control smoothness', `${fixed(jerk, 2)} G/s RMS`, band(jerk, 0.25, 1.5), 40, 'Make smaller, slower control inputs: passengers feel every sudden change in G.'),
    metric('gload', 'Largest G change', `${fixed(gDev, 2)} G`, band(gDev, 0.6, 2), 20, 'Avoid sharp pull-ups and pushovers: keep the load between about 0.5 and 1.6 G.'),
    metric('bankmax', 'Steepest bank', `${Math.round(maxBank)}°`, band(maxBank, 35, 65), 20, 'Keep turns to 30° of bank or less in normal flying.'),
    metric('pitchmax', 'Largest pitch', `${Math.round(maxPitch)}°`, band(maxPitch, 15, 30), 20, 'Keep the pitch attitude within about 15° up or down.'),
  ]
}

function procedureCategory(data: FlightData): MetricScore[] {
  const t = data.telemetry
  const spec = data.spec
  let flapOver = 0
  let vneOver = 0
  let stall = 0
  let steep = 0
  let taxiFast = 0
  let strikes = 0
  for (let i = 0; i < data.samples; i++) {
    const kt = sample(t, i, CH.ias) / KNOT
    const ground = sample(t, i, CH.onGround) > 0
    if (sample(t, i, CH.flap) > 0.05 && kt > spec.vSpeeds.vfe + 3) flapOver += SAMPLE_DT
    if (kt > spec.vSpeeds.vne) vneOver += SAMPLE_DT
    if (!ground && sample(t, i, CH.stall) > 0.75) stall += SAMPLE_DT
    if (!ground && abs(sample(t, i, CH.bank)) > spec.limits.maxBank) steep += SAMPLE_DT
    if (ground) {
      const surface = pavementAt(sample(t, i, CH.x), sample(t, i, CH.z))
      if ((surface === 'taxiway' || surface === 'apron') && sample(t, i, CH.groundSpeed) / KNOT > 20) taxiFast += SAMPLE_DT
    }
    strikes = sample(t, i, CH.strikes)
  }
  return [
    metric('flaps', 'Flap speed limit', flapOver > 0 ? `${fixed(flapOver, 1)} s over ${spec.vSpeeds.vfe} kt` : 'kept', band(flapOver, 0, 15), 20, `Do not fly faster than ${spec.vSpeeds.vfe} kt with flaps out: retract them after take-off and extend them only below that speed.`),
    metric('vne', 'Never-exceed speed', vneOver > 0 ? `${fixed(vneOver, 1)} s over ${spec.vSpeeds.vne} kt` : 'kept', band(vneOver, 0, 5), 15, `Stay below ${spec.vSpeeds.vne} kt: reduce power and raise the nose in a dive.`),
    metric('stall', 'Stall warnings', stall > 0 ? `${fixed(stall, 1)} s` : 'none', band(stall, 0, 6), 25, 'Watch the airspeed in climbs and turns: lower the nose and add power at the first sign of a stall.'),
    metric('strikes', 'Tail, prop or wingtip strikes', String(strikes), strikes === 0 ? 1 : strikes === 1 ? 0.4 : 0, 20, 'Something other than the wheels touched the ground: do not over-rotate, and keep the wings level near the runway.'),
    metric('steep', `Bank past ${spec.limits.maxBank}°`, steep > 0 ? `${fixed(steep, 1)} s` : 'never', band(steep, 0, 5), 10, `Keep the bank under ${spec.limits.maxBank}°, the aircraft's limit.`),
    metric('taxi', 'Taxi speed', taxiFast > 0 ? `${fixed(taxiFast, 1)} s over 20 kt` : 'kept', band(taxiFast, 0, 10), 10, 'Taxi at a brisk walking pace: under 20 kt on taxiways and the apron.'),
  ]
}

function operationsCategory(data: FlightData, landing: Landing, summary: LandingSummary): MetricScore[] {
  const t = data.telemetry
  const td = landing.touchdown
  let offPavement = 0
  let stopAlong = summary.fromThreshold
  let lastSurface: string | null = null
  const first = Math.floor(td.tick / 12)
  for (let i = first; i < data.samples; i++) {
    if (sample(t, i, CH.onGround) <= 0) continue
    const x = sample(t, i, CH.x)
    const z = sample(t, i, CH.z)
    lastSurface = pavementAt(x, z)
    if (lastSurface === null && sample(t, i, CH.groundSpeed) / KNOT > 5) offPavement += SAMPLE_DT
    if (landing.end) {
      const along = (x - landing.end.x) * landing.end.dx + (z - landing.end.z) * landing.end.dz
      if (lastSurface === 'runway' && along > stopAlong) stopAlong = along
    }
  }
  const lastIndex = data.samples - 1
  const stopped = lastIndex >= 0 && sample(t, lastIndex, CH.groundSpeed) / KNOT < 1.5 && sample(t, lastIndex, CH.onGround) > 0
  const length = landing.runway ? landing.runway.length : 0
  const overran = landing.runway !== null && stopAlong > length
  const onRunway = summary.surface === 'runway'
  return [
    metric('runway', 'Landed on the runway', onRunway ? 'yes' : 'no', onRunway ? 1 : 0, 30, 'Land on the runway itself: line up early and keep it in front of you.'),
    metric('stop', 'Full stop', stopped ? (lastSurface ? 'on the pavement' : 'on the grass') : data.ended === 'pilot' ? 'ended while rolling' : 'no', stopped ? (lastSurface ? 1 : 0.3) : 0, 25, 'Bring the aircraft to a full stop on the pavement before ending the flight.'),
    metric('pavement', 'Stayed on the pavement', offPavement > 0 ? `${fixed(offPavement, 1)} s on the grass` : 'yes', band(offPavement, 0, 3), 25, 'Keep straight on the rollout with the rudder pedals, and brake evenly.'),
    metric('overrun', 'Stopped before the end', overran ? 'overran' : 'yes', overran ? 0 : 1, 20, 'Touch down in the first third of the runway and brake firmly so you stop before the end.'),
  ]
}

/** Scores one flight. Pure: equal data always gives an equal score. */
export function scoreFlight(data: FlightData): FlightScore {
  const landing = findLanding(data)
  const categories: CategoryScore[] = []
  let summary: LandingSummary | null = null
  const add = (id: CategoryId, metrics: MetricScore[] | null) => categories.push({ id, label: CATEGORY_LABELS[id], weight: CATEGORY_WEIGHTS[id], score: metrics ? categoryScore(metrics) : null, metrics: metrics ?? [] })
  if (landing) {
    const result = landingCategory(landing)
    summary = result.summary
    add('landing', result.metrics)
    add('approach', approachCategory(data, landing))
  } else {
    add('landing', null)
    add('approach', null)
  }
  add('smoothness', smoothnessCategory(data))
  add('procedure', procedureCategory(data))
  add('operations', landing && summary ? operationsCategory(data, landing, summary) : null)
  let weighted = 0
  let weights = 0
  for (const c of categories) {
    weights += c.weight
    if (c.score !== null) weighted += c.score * c.weight
  }
  const raw = weights > 0 ? round(weighted / weights, 1) : 0
  const multiplier = assistMultiplier(data.assists)
  const crashed = data.crashed
  const total = crashed ? 0 : Math.round(raw * multiplier)
  const lost: { tip: string; loss: number }[] = []
  for (const c of categories) {
    if (c.score === null) continue
    let weightSum = 0
    for (const m of c.metrics) weightSum += m.weight
    for (const m of c.metrics) if (m.score < 0.8) lost.push({ tip: m.tip, loss: (1 - m.score) * (m.weight / weightSum) * c.weight })
  }
  lost.sort((a, b) => b.loss - a.loss)
  const tips = lost.slice(0, 4).map((entry) => entry.tip)
  if (crashed) tips.unshift(`The flight ended in a crash (${crashed}). Fly the approach slower and more stable, and flare before touchdown.`)
  if (!landing && !crashed) tips.push('Land and come to a stop to have the landing, approach and operations scored.')
  if (tips.length === 0) tips.push('A clean flight. Try it with stronger wind or fewer assists.')
  const t = data.telemetry
  const seconds = data.samples * SAMPLE_DT
  const fuelUsed = data.samples > 1 ? sample(t, 0, CH.fuel) - sample(t, data.samples - 1, CH.fuel) : 0
  let graph: { from: number; to: number } | null = null
  if (landing) {
    const at = Math.floor(landing.touchdown.tick / 12)
    graph = { from: Math.max(0, at - 30 * TELEMETRY_HZ), to: Math.min(data.samples, at + 8 * TELEMETRY_HZ) }
  }
  return { total, raw, multiplier, grade: gradeFor(total, crashed !== null, landing !== null), crashed, categories, landing: summary, tips, seconds: round(seconds, 1), fuelUsed: round(fuelUsed, 2), graph }
}

