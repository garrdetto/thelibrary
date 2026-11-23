/**
 * Server-side verification of a submitted flight record: the header must name conditions the page offers (a wind and time
 * preset, standard atmosphere, a known aircraft, airport and start, a checkride's exact setup, a contract's or route's
 * payload), and re-flying its input log from the same start must reproduce the score in its footer exactly. The Worker builds
 * the career's flight summary from the re-flown score, so careers and leaderboards never take the page's numbers on trust.
 * Pure and deterministic; the cost is a full re-flight (about 1.4 s of CPU per 10 minutes flown), so flights are capped.
 */
import { airportById } from './Airports'
import { jobsFor } from './Cargo'
import { routesFor } from './Airlines'
import type { AirlineId } from './Airlines'
import { CHECKRIDES, CHECKRIDE_SPECS, summarizeFlight } from './Career'
import type { CheckrideId, FlightSummary, TimeKind } from './Career'
import { HOURS, windKindOf } from './Conditions'
import { FLEET } from './Fleet'
import type { FlightRecordData } from './FlightRecord'
import { TERRAIN } from './Terrain'
import { WEATHER_KINDS } from './Weather'
import { SEA_LEVEL_PRESSURE } from '../sim/Atmosphere'
import { INPUT_BYTES } from '../sim/Controls'
import { Reflight } from '../sim/Reflight'
import { scoreFlight } from '../sim/Scoring'
import type { FlightScore } from '../sim/Scoring'
import { SIM_HZ } from '../sim/Simulation'
import { START_KINDS } from '../sim/Starts'

/** Longest flight the Worker re-flies. */
export const MAX_VERIFY_SECONDS = 90 * 60

export type Verification =
  | { ok: true; score: FlightScore; summary: FlightSummary; flight: string; ticks: number }
  | { ok: false; error: string }

const fail = (error: string): Verification => ({ ok: false, error })

function payloadFor(job: string | null | undefined, route: string | null | undefined): number | null {
  if (job) {
    const match = /^d(\d+)-(\d)$/.exec(job)
    const found = match ? jobsFor(Number(match[1]))[Number(match[2])] : undefined
    return found ? found.kg : -1
  }
  if (route) {
    const match = /^(skylark|northline|meridian)-d(\d+)-(\d)$/.exec(route)
    const found = match ? routesFor(match[1] as AirlineId, Number(match[2]))[Number(match[3])] : undefined
    return found ? found.passengers * 90 : -1
  }
  return null
}

/** Checks a decoded record and re-flies it; on success returns the re-flown score and the summary built from it. */
export function verifyRecord(record: FlightRecordData): Verification {
  const { header, footer, inputs } = record
  const spec = FLEET.find((s) => s.id === header.aircraft)
  if (!spec) return fail('Unknown aircraft.')
  const airport = airportById(header.airport)
  if (!airport) return fail('Unknown airport.')
  if (!START_KINDS.includes(header.start)) return fail('Unknown start.')
  if (!WEATHER_KINDS.includes(header.weather)) return fail('Unknown weather.')
  const windKind = windKindOf(header.wind)
  if (!windKind || header.windKind !== windKind) return fail('The wind is not one the page offers.')
  if (!header.time || !(header.time in HOURS)) return fail('Unknown time of day.')
  if (header.temperatureOffset !== 0 || header.seaLevelPressure !== SEA_LEVEL_PRESSURE) return fail('The atmosphere is not standard.')
  if (typeof header.flight !== 'string' || !/^[a-z0-9]{8,32}$/.test(header.flight)) return fail('The record has no flight id.')
  if (!Number.isInteger(header.seed) || header.seed <= 0) return fail('Bad seed.')
  const checkride = header.checkride ?? null
  if (checkride !== null) {
    if (!CHECKRIDES.includes(checkride)) return fail('Unknown checkride.')
    const setup = CHECKRIDE_SPECS[checkride].setup
    const same = (setup.aircraft ?? 'halden-wren') === header.aircraft && setup.airport === header.airport && setup.start === header.start && setup.wind === windKind && setup.weather === header.weather && setup.time === header.time
      && JSON.stringify(setup.failure ?? null) === JSON.stringify(header.failure ?? null)
    if (!same) return fail('The checkride was not flown in its set conditions.')
  } else if (header.failure) return fail('Engine failures are only flown in checkrides.')
  if (header.job && header.route) return fail('A flight carries a contract or a route, not both.')
  const payload = payloadFor(header.job, header.route)
  if ((header.payload ?? null) !== payload) return fail('The payload does not match the contract.')
  if (footer.ticks <= 0 || inputs.length !== footer.ticks * INPUT_BYTES) return fail('The input log is incomplete.')
  if (footer.ticks > MAX_VERIFY_SECONDS * SIM_HZ) return fail(`Flights longer than ${MAX_VERIFY_SECONDS / 60} minutes cannot be verified.`)
  const replay = new Reflight(spec, TERRAIN, header, inputs, true)
  while (replay.step(20000) > 0);
  const recorder = replay.recorder!
  const crashed = replay.sim.aircraft.crashed
  if ((crashed !== null) !== (footer.ended === 'crash')) return fail('The flight did not re-fly to the same ending.')
  const score = scoreFlight({ spec, assists: header.assists, telemetry: recorder.telemetryLog(), samples: recorder.samples, touchdowns: recorder.touchdowns, crashed, ended: footer.ended })
  if (score.total !== footer.score) return fail('The flight did not re-fly to the same score.')
  const summary = summarizeFlight(score, {
    aircraft: spec.id, airport: airport.id, start: header.start, wind: windKind, weather: header.weather, time: header.time as TimeKind,
    seconds: score.seconds, resumed: false, assists: { ...header.assists }, instrumentsOnly: footer.instrumentsOnly === true && !header.assists.landingGuidance,
    engineFailure: replay.sim.aircraft.failedEngine >= 0, checkride: checkride as CheckrideId | null, job: header.job ?? null, route: header.route ?? null,
  })
  replay.dispose()
  return { ok: true, score, summary, flight: header.flight, ticks: footer.ticks }
}
