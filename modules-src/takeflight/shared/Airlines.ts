/**
 * The airline career: three invented airlines, each with a licence to join, a fleet, the airports it serves and a daily schedule
 * of numbered routes generated from the day, plus the rank ladder from First Officer to Chief Pilot. A route is flown from its
 * origin's stand to a runway landing at its destination; it pays by rank and score, with a bonus inside the scheduled block
 * time, and counts toward promotion. Pure and exact, so the Worker regenerates a route from its id and applies it itself.
 */
import { airportById } from './Airports'
import type { LicenceId } from './Career'
import { SimRandom } from '../sim/SimMath'

export type AirlineId = 'skylark' | 'northline' | 'meridian'
export type RankId = 'fo' | 'captain' | 'senior' | 'check' | 'chief'

export interface Airline {
  id: AirlineId
  name: string
  code: string
  blurb: string
  requires: LicenceId
  /** Aircraft families the airline flies. */
  fleet: string[]
  airports: string[]
  passengers: [number, number]
}

export interface Rank {
  id: RankId
  title: string
  /** Airline flights, airline hours and average airline score needed to reach this rank. */
  flights: number
  hours: number
  score: number
  /** Pay multiplier. */
  pay: number
}

export interface AirlineRoute {
  id: string
  airline: AirlineId
  day: number
  flight: string
  from: string
  to: string
  passengers: number
  km: number
  /** Scheduled block time, minutes. */
  block: number
  /** Base pay before the rank multiplier. */
  pay: number
}

export interface AirlineMembership {
  id: AirlineId
  rank: RankId
  flights: number
  seconds: number
  onTime: number
  earned: number
  /** Newest-first scores of airline flights (at most `AIRLINE_SCORES`). */
  scores: number[]
  joinedAt: number
}

export const AIRLINE_IDS: readonly AirlineId[] = ['skylark', 'northline', 'meridian']
export const AIRLINE_SCORES = 10
const ROUTES_PER_DAY = 6
const DAY_MS = 86400000

export const AIRLINES: Record<AirlineId, Airline> = {
  skylark: { id: 'skylark', name: 'Skylark Commuter', code: 'SKL', blurb: 'Short hops between the region’s fields in twins and turboprops.', requires: 'instrument', fleet: ['duet', 'sprite'], airports: ['harrow', 'ashby', 'corran', 'fenwick', 'halvard'], passengers: [1, 3] },
  northline: { id: 'northline', name: 'Northline Regional', code: 'NLR', blurb: 'Scheduled turboprop service linking the towns to Halvard.', requires: 'commercial', fleet: ['sprite'], airports: ['halvard', 'ashby', 'corran', 'fenwick', 'harrow'], passengers: [3, 7] },
  meridian: { id: 'meridian', name: 'Meridian Executive', code: 'MXA', blurb: 'Business jet charters between the larger airports.', requires: 'atp', fleet: ['vesta'], airports: ['halvard', 'corran', 'ashby', 'fenwick'], passengers: [3, 8] },
}

export const RANKS: readonly Rank[] = [
  { id: 'fo', title: 'First Officer', flights: 0, hours: 0, score: 0, pay: 1 },
  { id: 'captain', title: 'Captain', flights: 4, hours: 1.5, score: 65, pay: 1.35 },
  { id: 'senior', title: 'Senior Captain', flights: 10, hours: 4, score: 72, pay: 1.7 },
  { id: 'check', title: 'Check Captain', flights: 18, hours: 8, score: 78, pay: 2.05 },
  { id: 'chief', title: 'Chief Pilot', flights: 30, hours: 15, score: 84, pay: 2.5 },
]

/** Cruise speeds used for block times, km/h. */
const CRUISE_KMH: Record<string, number> = { wren: 200, duet: 300, sprite: 420, vesta: 740, haulmaster: 330 }

export function rankOf(id: RankId): Rank {
  return RANKS.find((rank) => rank.id === id) ?? RANKS[0]
}

export function nextRank(id: RankId): Rank | null {
  const index = RANKS.findIndex((rank) => rank.id === id)
  return index >= 0 && index < RANKS.length - 1 ? RANKS[index + 1] : null
}

export function averageScore(scores: readonly number[]): number {
  if (scores.length === 0) return 0
  let sum = 0
  for (const s of scores) sum += s
  return sum / scores.length
}

/** What is still missing for the next rank, as short phrases; empty when the pilot qualifies (or holds the top rank). */
export function promotionGaps(member: AirlineMembership): string[] {
  const next = nextRank(member.rank)
  if (!next) return []
  const gaps: string[] = []
  if (member.flights < next.flights) gaps.push(`${next.flights - member.flights} more airline flight${next.flights - member.flights === 1 ? '' : 's'}`)
  const hours = member.seconds / 3600
  if (hours < next.hours) gaps.push(`${(next.hours - hours).toFixed(1)} more airline hours`)
  const average = averageScore(member.scores)
  if (average < next.score) gaps.push(`an average airline score of ${next.score} (now ${Math.round(average)})`)
  return gaps
}

/** The highest rank the member qualifies for, never lower than the one held. */
export function earnedRank(member: AirlineMembership): RankId {
  let rank = member.rank
  for (;;) {
    const next = nextRank(rank)
    if (!next || promotionGaps({ ...member, rank }).length > 0) return rank
    rank = next.id
  }
}

function distanceKm(from: string, to: string): number {
  const a = airportById(from)
  const b = airportById(to)
  if (!a || !b) return 0
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.round(Math.sqrt(dx * dx + dz * dz) / 100) / 10
}

function airlineSeed(id: AirlineId): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

/** The routes an airline flies on `day`. */
export function routesFor(airlineId: AirlineId, day: number): AirlineRoute[] {
  const airline = AIRLINES[airlineId]
  const random = new SimRandom(((day * 2654435761) ^ airlineSeed(airlineId)) | 1)
  const cruise = Math.min(...airline.fleet.map((family) => CRUISE_KMH[family] ?? 300))
  const routes: AirlineRoute[] = []
  for (let i = 0; i < ROUTES_PER_DAY; i++) {
    const from = airline.airports[Math.floor(random.next() * airline.airports.length)]
    let to = from
    while (to === from) to = airline.airports[Math.floor(random.next() * airline.airports.length)]
    const [low, high] = airline.passengers
    const passengers = low + Math.floor(random.next() * (high - low + 1))
    const km = distanceKm(from, to)
    const block = Math.round(14 + (km / cruise) * 60)
    const pay = Math.round((90 + km * 7 + passengers * 18) / 5) * 5
    const number = 100 + Math.floor(random.next() * 800)
    routes.push({ id: `${airlineId}-d${day}-${i}`, airline: airlineId, day, flight: `${airline.code} ${number}`, from, to, passengers, km, block, pay })
  }
  return routes
}

/** The route with this id if it is still open at `now` (scheduled today or yesterday). */
export function openRoute(id: string, now: number): AirlineRoute | null {
  const match = /^(skylark|northline|meridian)-d(\d+)-(\d)$/.exec(id)
  if (!match) return null
  const day = Number(match[2])
  const today = Math.floor(now / DAY_MS)
  if (day !== today && day !== today - 1) return null
  return routesFor(match[1] as AirlineId, day)[Number(match[3])] ?? null
}

export interface RouteOutcome {
  paid: number
  onTime: boolean
  reason: string | null
}

/** Pay for a route: base × rank × (60–100 % with the score), plus 20 % inside the block time; nothing unless it landed on a runway at the destination. */
export function routePay(route: AirlineRoute, rank: RankId, flight: { crashed: boolean; total: number; landedAt: string | null; onRunway: boolean; seconds: number; family: string }): RouteOutcome {
  if (!AIRLINES[route.airline].fleet.includes(flight.family)) return { paid: 0, onTime: false, reason: 'That aircraft is not in the airline’s fleet.' }
  if (flight.crashed) return { paid: 0, onTime: false, reason: 'The flight ended in a crash.' }
  if (flight.landedAt !== route.to) return { paid: 0, onTime: false, reason: 'The flight did not reach its destination.' }
  if (!flight.onRunway) return { paid: 0, onTime: false, reason: 'The aircraft did not land on the runway.' }
  const onTime = flight.seconds <= route.block * 60
  const share = 0.6 + 0.4 * Math.max(0, Math.min(100, flight.total)) / 100
  return { paid: Math.round(route.pay * rankOf(rank).pay * share * (onTime ? 1.2 : 1)), onTime, reason: null }
}

export function newMembership(id: AirlineId, now: number): AirlineMembership {
  return { id, rank: 'fo', flights: 0, seconds: 0, onTime: 0, earned: 0, scores: [], joinedAt: now }
}
