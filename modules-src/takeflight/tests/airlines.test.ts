import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIRLINES, AIRLINE_IDS, RANKS, earnedRank, newMembership, openRoute, promotionGaps, routePay, routesFor } from '../shared/Airlines'
import { airportById } from '../shared/Airports'
import { applyFlight, defaultCareer, joinAirline, leaveAirline, normalizeCareer } from '../shared/Career'
import type { CareerProfile, FlightSummary } from '../shared/Career'
import { HANGAR, HANGAR_CLASSES } from '../shared/Hangar'

const DAY = 86400000
const NOW = 20_400 * DAY + 3_600_000

function pilot(licences: CareerProfile['licences']): CareerProfile {
  return { ...defaultCareer(), licences }
}

function routeFlight(route: { id: string; to: string }, overrides: Partial<FlightSummary> = {}): FlightSummary {
  return {
    aircraft: 'corvane-sprite', airport: 'harrow', start: 'stand', wind: 'calm', weather: 'clear', time: 'noon', seconds: 900, resumed: false, total: 80, crashed: false,
    assists: { autoTrim: false, stallProtection: false, landingGuidance: false }, instrumentsOnly: false,
    categories: { landing: 80 }, metrics: {},
    landing: { tick: 100000, airport: route.to, sinkFpm: 200, g: 1.3, centreline: 2, fromAim: 40, bounces: 0, onRunway: true },
    checkride: null, route: route.id,
    ...overrides,
  }
}

const SPRITE = { now: NOW, pilotClass: 'turboprop' as const, family: 'sprite', classes: HANGAR_CLASSES, payload: 700 }

test('each airline has a daily schedule that is the same for everyone and expires after a day', () => {
  for (const id of AIRLINE_IDS) {
    const day = Math.floor(NOW / DAY)
    const routes = routesFor(id, day)
    assert.equal(routes.length, 6)
    assert.deepEqual(routesFor(id, day), routes)
    for (const route of routes) {
      assert.ok(route.from !== route.to && route.km > 0 && route.pay > 0 && route.block > 14, route.id)
      assert.ok(AIRLINES[id].airports.includes(route.from) && AIRLINES[id].airports.includes(route.to))
      assert.ok(airportById(route.from) && airportById(route.to))
    }
    assert.deepEqual(openRoute(routes[2].id, NOW), routes[2])
    assert.deepEqual(openRoute(routes[2].id, NOW + DAY), routes[2])
    assert.equal(openRoute(routes[2].id, NOW + 2 * DAY), null)
  }
  assert.equal(openRoute('nowhere-d1-0', NOW), null)
})

test('every airline can be flown: its fleet is in the hangar and lifts its largest passenger load', () => {
  for (const id of AIRLINE_IDS) {
    const airline = AIRLINES[id]
    for (const family of airline.fleet) {
      const entry = HANGAR.find((e) => e.family === family)
      assert.ok(entry, `${id} flies ${family}`)
      assert.ok(airline.passengers[1] * 90 <= entry.payload, `${family} lifts ${airline.passengers[1]} passengers`)
    }
  }
})

test('joining needs the airline’s licence, starts as First Officer and moving starts again', () => {
  assert.match(joinAirline(pilot(['student', 'ppl']), 'skylark', NOW).error ?? '', /Instrument/)
  const joined = joinAirline(pilot(['student', 'ppl', 'instrument']), 'skylark', NOW)
  assert.equal(joined.error, null)
  assert.equal(joined.profile.airline?.rank, 'fo')
  assert.equal(joinAirline(joined.profile, 'skylark', NOW).error, 'You already fly for this airline.')
  assert.match(joinAirline(joined.profile, 'meridian', NOW).error ?? '', /Airline Transport/)
  assert.equal(leaveAirline(joined.profile).airline, null)
  assert.deepEqual(normalizeCareer(JSON.parse(JSON.stringify(joined.profile))).airline, joined.profile.airline)
  assert.equal(normalizeCareer({ ...joined.profile, airline: { id: 'nope' } }).airline, null)
})

test('a route pays by rank and score, with an on-time bonus, only at the destination in a fleet aircraft', () => {
  const route = routesFor('northline', Math.floor(NOW / DAY))[0]
  const base = { crashed: false, total: 100, landedAt: route.to, onRunway: true, seconds: route.block * 60 + 1, family: 'sprite' }
  assert.equal(routePay(route, 'fo', base).paid, route.pay)
  assert.equal(routePay(route, 'fo', { ...base, seconds: route.block * 60 }).paid, Math.round(route.pay * 1.2))
  assert.ok(routePay(route, 'chief', base).paid > routePay(route, 'captain', base).paid)
  assert.equal(routePay(route, 'fo', { ...base, landedAt: route.from }).paid, 0)
  assert.equal(routePay(route, 'fo', { ...base, crashed: true }).paid, 0)
  assert.equal(routePay(route, 'fo', { ...base, onRunway: false }).paid, 0)
  assert.equal(routePay(route, 'fo', { ...base, family: 'vesta' }).paid, 0)
})

test('airline flights pay, count toward promotion and promote through the ranks', () => {
  let profile = joinAirline(pilot(['student', 'ppl', 'instrument', 'multi', 'commercial']), 'northline', NOW).profile
  const routes = routesFor('northline', Math.floor(NOW / DAY))
  let promotions = 0
  for (let i = 0; i < 40; i++) {
    const route = routes[i % routes.length]
    const result = applyFlight(profile, routeFlight(route, { total: 90, seconds: 2000 }), { ...SPRITE, now: NOW + i * 3000 })
    assert.ok(result.airline && result.airline.paid > 0, `flight ${i} paid`)
    if (result.airline?.promoted) promotions++
    profile = result.profile
  }
  assert.equal(profile.airline?.rank, 'chief')
  assert.equal(promotions, RANKS.length - 1)
  assert.equal(profile.airline?.flights, 40)
  assert.ok(profile.cash > 0 && profile.airline!.earned === profile.cash)
  assert.deepEqual(promotionGaps(profile.airline!), [])
})

test('a failed or foreign route pays nothing and does not count, and only the pilot’s airline’s routes apply', () => {
  const profile = joinAirline(pilot(['student', 'ppl', 'instrument', 'multi', 'commercial']), 'northline', NOW).profile
  const route = routesFor('northline', Math.floor(NOW / DAY))[1]
  const missed = applyFlight(profile, routeFlight(route, { landing: { tick: 1, airport: route.from, sinkFpm: 100, g: 1.2, centreline: 0, fromAim: 0, bounces: 0, onRunway: true } }), SPRITE)
  assert.equal(missed.airline?.paid, 0)
  assert.equal(missed.profile.airline?.flights, 0)
  assert.equal(missed.profile.cash, 0)
  const foreign = routesFor('skylark', Math.floor(NOW / DAY))[0]
  assert.equal(applyFlight(profile, routeFlight(foreign), SPRITE).airline, null)
  assert.equal(applyFlight(defaultCareer(), routeFlight(route), SPRITE).airline, null)
})

test('earned rank never drops and needs flights, hours and scores together', () => {
  const member = { ...newMembership('skylark', NOW), flights: 50, seconds: 100 * 3600, scores: [60, 60, 60] }
  assert.equal(earnedRank(member), 'fo')
  assert.equal(earnedRank({ ...member, scores: [99] }), 'chief')
  assert.equal(earnedRank({ ...member, rank: 'senior' }), 'senior')
})
