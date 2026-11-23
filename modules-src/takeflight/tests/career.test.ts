import { test } from 'node:test'
import assert from 'node:assert/strict'
import wren from '../shared/aircraft/wren.json'
import { MAX_LEVEL, applyFlight, checkrideAvailability, classRating, defaultCareer, evaluateCheckride, flightXp, levelFor, normalizeCareer, pilotRating, summarizeFlight, xpForLevel } from '../shared/Career'
import type { CareerProfile, CheckrideId, FlightSummary } from '../shared/Career'
import { HANGAR, HANGAR_CLASSES } from '../shared/Hangar'
import { FLEET } from '../shared/Fleet'
import { HARROW_FIELD } from '../shared/Airports'
import { TERRAIN } from '../shared/Terrain'
import { scoreFlight } from '../sim/Scoring'
import { SIM_HZ } from '../sim/Simulation'
import { placeStart } from '../sim/Starts'
import { FlightRecorder } from '../sim/Telemetry'
import { WREN, landingPilot, makeSim } from './helpers'

const CONTEXT = { now: 1_000_000, pilotClass: 'single' as const, family: 'wren', classes: HANGAR_CLASSES }
const NO_ASSISTS = { autoTrim: false, stallProtection: false, landingGuidance: false }

function summary(overrides: Partial<FlightSummary> = {}): FlightSummary {
  return {
    aircraft: 'halden-wren', airport: 'harrow', start: 'runway1', wind: 'crosswind', weather: 'fair', time: 'noon', seconds: 300, resumed: false, total: 82, crashed: false,
    assists: { ...NO_ASSISTS }, instrumentsOnly: false,
    categories: { landing: 80, approach: 85, smoothness: 90, procedure: 95, operations: 100 },
    metrics: { 'approach.glidepath': 0.9, 'approach.tracking': 0.9 },
    landing: { tick: 30000, sinkFpm: 150, g: 1.4, centreline: 1, fromAim: 30, bounces: 0, onRunway: true },
    checkride: null,
    ...overrides,
  }
}

function withLevel(level: number, hours: number, licences: CareerProfile['licences'] = ['student']): CareerProfile {
  const p = defaultCareer()
  p.xp = xpForLevel(level)
  p.seconds.single = hours * 3600
  p.licences = licences
  return p
}

test('the level curve rises steadily from 1 to 100', () => {
  assert.equal(levelFor(0), 1)
  for (let level = 2; level <= MAX_LEVEL; level++) {
    assert.ok(xpForLevel(level) > xpForLevel(level - 1))
    assert.equal(levelFor(xpForLevel(level)), level)
    assert.equal(levelFor(xpForLevel(level) - 1), level - 1)
  }
  assert.equal(levelFor(Number.MAX_SAFE_INTEGER), MAX_LEVEL)
})

test('XP grows with score, length and wind, and a crash or a short hop earns none', () => {
  const base = flightXp(summary())
  assert.ok(base > 0)
  assert.ok(flightXp(summary({ total: 95 })) > base)
  assert.ok(flightXp(summary({ seconds: 900 })) > base)
  assert.ok(flightXp(summary({ wind: 'gusty' })) > flightXp(summary({ wind: 'calm' })))
  assert.equal(flightXp(summary({ crashed: true })), 0)
  assert.equal(flightXp(summary({ seconds: 20 })), 0)
})

test('a flight adds XP, hours, a landing and a rating entry without changing the old profile', () => {
  const before = defaultCareer()
  const result = applyFlight(before, summary(), CONTEXT)
  assert.equal(before.xp, 0)
  assert.equal(result.profile.xp, result.xp)
  assert.equal(result.profile.flights, 1)
  assert.equal(result.profile.landings, 1)
  assert.equal(result.profile.seconds.single, 300)
  assert.deepEqual(result.profile.ratings.single, [82])
  assert.equal(result.profile.recent.length, 1)
  assert.ok(result.profile.bestLanding)
})

test('a resumed flight adds its extra time and replaces its own rating entry', () => {
  const first = applyFlight(defaultCareer(), summary(), CONTEXT).profile
  const again = applyFlight(first, summary({ resumed: true, seconds: 120, total: 70 }), CONTEXT).profile
  assert.equal(again.flights, 1)
  assert.equal(again.seconds.single, 420)
  assert.deepEqual(again.ratings.single, [70])
})

test('the Pilot Rating weights recent flights more and needs three of them', () => {
  let p = defaultCareer()
  for (const total of [60, 60]) p = applyFlight(p, summary({ total }), CONTEXT).profile
  assert.equal(pilotRating(p), null)
  p = applyFlight(p, summary({ total: 90 }), CONTEXT).profile
  const rating = classRating(p, 'single')
  assert.ok(rating !== null && rating > 70 && rating < 90, `rating ${rating}`)
  assert.equal(pilotRating(p), rating)
})

test('checkrides need their licences, level, hours and an aircraft of their class', () => {
  const fresh = defaultCareer()
  const ppl = checkrideAvailability(fresh, 'ppl', HANGAR_CLASSES)
  assert.equal(ppl.available, false)
  assert.ok(ppl.reasons.some((r) => r.includes('level 3')))
  assert.equal(checkrideAvailability(withLevel(3, 1), 'ppl', HANGAR_CLASSES).available, true)
  assert.equal(checkrideAvailability(withLevel(30, 30, ['student', 'ppl']), 'instrument', HANGAR_CLASSES).available, true)
  assert.equal(checkrideAvailability(withLevel(30, 30, ['student', 'ppl']), 'multi', HANGAR_CLASSES).available, true, 'the Duet makes the multi-engine checkride available')
  assert.equal(checkrideAvailability(withLevel(60, 60, ['student', 'ppl', 'instrument', 'multi', 'commercial']), 'atp', HANGAR_CLASSES).available, true, 'the Vesta makes the ATP checkride available')
  const noJet = checkrideAvailability(withLevel(60, 60, ['student', 'ppl', 'instrument', 'multi', 'commercial']), 'atp', ['single', 'multi'])
  assert.ok(noJet.reasons.some((r) => r.includes('not in the hangar')))
})

test('passing a checkride earns its licence and a bonus; failing records the attempt', () => {
  const ready = withLevel(3, 1)
  const pass = applyFlight(ready, summary({ checkride: 'ppl' }), CONTEXT)
  assert.equal(pass.checkride?.passed, true)
  assert.equal(pass.licence, 'ppl')
  assert.ok(pass.profile.licences.includes('ppl'))
  assert.ok(pass.checkride && pass.checkride.bonus > 0 && pass.xp > flightXp(summary()))
  const fail = applyFlight(ready, summary({ checkride: 'ppl', assists: { ...NO_ASSISTS, landingGuidance: true } }), CONTEXT)
  assert.equal(fail.checkride?.passed, false)
  assert.equal(fail.licence, null)
  assert.equal(fail.profile.checkrides.ppl?.attempts, 1)
  const early = applyFlight(defaultCareer(), summary({ checkride: 'ppl' }), CONTEXT)
  assert.equal(early.checkride?.passed, false, 'a checkride flown before qualifying does not count')
})

test('the instrument checkride needs the instruments-only HUD and a tight approach', () => {
  const good = summary({ start: 'final1', instrumentsOnly: true, checkride: 'instrument' })
  assert.equal(evaluateCheckride('instrument', good).passed, true)
  assert.equal(evaluateCheckride('instrument', { ...good, instrumentsOnly: false }).passed, false)
  assert.equal(evaluateCheckride('instrument', { ...good, metrics: { 'approach.glidepath': 0.5, 'approach.tracking': 0.9 } }).passed, false)
})

test('a real scored landing passes the Private Pilot criteria', () => {
  const sim = makeSim({ direction: 90, speed: 3.1, gust: 0, turbulence: 0.12 }, 99)
  placeStart(sim.aircraft, sim.pilot, HARROW_FIELD, TERRAIN, 'final1')
  sim.settle()
  const recorder = new FlightRecorder()
  recorder.attach(sim)
  recorder.reset(true)
  const pilot = landingPilot(sim)
  for (let i = 0; i < SIM_HZ * 200; i++) {
    pilot(0)
    sim.stepPilot()
  }
  const score = scoreFlight({ spec: WREN, assists: NO_ASSISTS, telemetry: recorder.telemetryLog(), samples: recorder.samples, touchdowns: recorder.touchdowns, crashed: sim.aircraft.crashed, ended: 'stopped' })
  const s = summarizeFlight(score, { aircraft: WREN.id, airport: HARROW_FIELD.id, start: 'final1', wind: 'crosswind', weather: 'fair', time: 'noon', seconds: score.seconds, resumed: false, assists: NO_ASSISTS, instrumentsOnly: false, checkride: 'ppl' as CheckrideId })
  const evaluation = evaluateCheckride('ppl', s)
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation.criteria.filter((c) => !c.passed)))
})

test('stored careers are cleaned up and the hangar index matches the aircraft data', () => {
  const cleaned = normalizeCareer({ xp: -5, licences: ['ppl', 'pilot-of-the-year'], ratings: { single: [50, 900, 'x'] }, seconds: { single: 'lots' } })
  assert.equal(cleaned.xp, 0)
  assert.deepEqual(cleaned.licences, ['student', 'ppl'])
  assert.deepEqual(cleaned.ratings.single, [50])
  assert.equal(cleaned.seconds.single, 0)
  assert.deepEqual(normalizeCareer(null), defaultCareer())
  assert.equal(HANGAR.length, FLEET.length)
  for (const spec of FLEET) {
    const entry = HANGAR.find((h) => h.id === spec.id)
    assert.ok(entry, spec.id)
    assert.equal(entry.family, spec.family)
    assert.equal(entry.category, spec.category)
  }
})
