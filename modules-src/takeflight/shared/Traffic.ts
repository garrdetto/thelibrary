/**
 * AI traffic: a schedule of arrivals and departures on each airport's runway in use, and circuit traffic at the small fields,
 * as poses that are pure functions of the clock (seconds of the day) and the wind. Everyone sees the same traffic at the same
 * time; nothing is simulated, so the traffic never touches the player's flight model, records or replays. Arrivals fly a 3°
 * final from 12 km to the aim point and roll out; departures roll, lift off and climb away; circuit traffic flies a left-hand
 * oval at 1,000 ft. Each airport's arrival and departure alternate half an interval apart, so the runway is never shared.
 */
import { AIRPORTS, aimDistance, runwayEndFor } from './Airports'
import type { AirportSpec } from './Airports'
import { runwayInUse } from './Atc'
import { DEG, cos, sin } from '../sim/SimMath'

export type TrafficKind = 'arrival' | 'departure' | 'circuit'

export interface TrafficPose {
  /** Stable while the same movement is under way. */
  key: string
  family: string
  kind: TrafficKind
  airport: string
  /** World position of the wheels' lowest point (y above sea level). */
  x: number
  y: number
  z: number
  /** Degrees. */
  heading: number
  pitch: number
  bank: number
  speed: number
  gearDown: boolean
  onGround: boolean
}

interface Performance {
  approach: number
  rotate: number
  climb: number
  climbAngle: number
  accel: number
}

export const TRAFFIC_PERFORMANCE: Record<string, Performance> = {
  wren: { approach: 36, rotate: 28, climb: 38, climbAngle: 5, accel: 1.6 },
  duet: { approach: 46, rotate: 36, climb: 52, climbAngle: 6, accel: 2 },
  sprite: { approach: 57, rotate: 44, climb: 72, climbAngle: 6, accel: 2.2 },
  vesta: { approach: 64, rotate: 59, climb: 88, climbAngle: 8, accel: 2.6 },
  haulmaster: { approach: 60, rotate: 47, climb: 66, climbAngle: 5, accel: 1.9 },
}

interface Schedule {
  /** Seconds between arrivals (0: circuit traffic only). */
  interval: number
  families: string[]
  /** Aircraft flying the circuit. */
  circuit: number
}

const SCHEDULES: Record<AirportSpec['kind'], Schedule> = {
  hub: { interval: 180, families: ['vesta', 'sprite', 'haulmaster', 'vesta'], circuit: 0 },
  midsize: { interval: 300, families: ['sprite', 'vesta', 'duet'], circuit: 0 },
  regional: { interval: 420, families: ['sprite', 'duet'], circuit: 0 },
  cargo: { interval: 360, families: ['haulmaster', 'sprite'], circuit: 0 },
  ga: { interval: 0, families: ['wren', 'duet'], circuit: 2 },
  grass: { interval: 0, families: ['wren'], circuit: 1 },
  challenge: { interval: 0, families: [], circuit: 0 },
}

const FINAL_LENGTH = 12000
const GLIDE_SLOPE = 0.0524
const GEAR_DOWN_DISTANCE = 8000
const ROLLOUT = 1000
const TAXI_SPEED = 8
const DEPARTURE_LENGTH = 15000
const CIRCUIT_SPEED = 40
const CIRCUIT_HEIGHT = 300
const CIRCUIT_WIDTH = 1200
const CIRCUIT_RADIUS = CIRCUIT_WIDTH / 2
const CIRCUIT_EXTENSION = 800
const DAY = 86400

function airportOffset(id: string, interval: number): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) % Math.max(1, interval)
}

function familyFor(schedule: Schedule, airport: string, slot: number): string {
  const index = (slot * 7 + airportOffset(airport, 97)) % schedule.families.length
  return schedule.families[(index + schedule.families.length) % schedule.families.length]
}

function pose(out: TrafficPose[], count: number): TrafficPose {
  if (count < out.length) return out[count]
  const created: TrafficPose = { key: '', family: '', kind: 'arrival', airport: '', x: 0, y: 0, z: 0, heading: 0, pitch: 0, bank: 0, speed: 0, gearDown: true, onGround: false }
  out.push(created)
  return created
}

const end = { end: 0 as 0 | 1, name: '', heading: 0, x: 0, z: 0, dx: 0, dz: 0 }

/** Traffic poses at one airport at `seconds` of the day, written into `out` from index `count`; returns the new count. */
export function airportTraffic(airport: AirportSpec, seconds: number, windFrom: number, windSpeed: number, out: TrafficPose[], count: number): number {
  const schedule = SCHEDULES[airport.kind]
  if (schedule.families.length === 0) return count
  const inUse = runwayInUse(airport, windFrom, windSpeed)
  runwayEndFor(inUse.runway, inUse.heading, end)
  const elevation = airport.elevation
  const t = ((seconds % DAY) + DAY) % DAY
  if (schedule.interval > 0) {
    const interval = schedule.interval
    const offset = airportOffset(airport.id, interval)
    const aim = aimDistance(inUse.runway)
    const aimX = end.x + end.dx * aim
    const aimZ = end.z + end.dz * aim
    const base = Math.floor((t - offset) / interval)
    for (let slot = base - 2; slot <= base + 3; slot++) {
      const family = familyFor(schedule, airport.id, slot)
      const perf = TRAFFIC_PERFORMANCE[family]
      const touchdown = offset + slot * interval
      const approachTime = FINAL_LENGTH / perf.approach
      const decel = (perf.approach * perf.approach - TAXI_SPEED * TAXI_SPEED) / (2 * ROLLOUT)
      const rollTime = (perf.approach - TAXI_SPEED) / decel
      const dt = t - touchdown
      if (dt >= -approachTime && dt < rollTime) {
        const p = pose(out, count++)
        p.key = `${airport.id}-a${slot}`
        p.family = family
        p.kind = 'arrival'
        p.airport = airport.id
        p.heading = inUse.heading
        p.bank = 0
        if (dt < 0) {
          const distance = -dt * perf.approach
          p.x = aimX - end.dx * distance
          p.z = aimZ - end.dz * distance
          p.y = elevation + distance * GLIDE_SLOPE
          p.pitch = 2.5
          p.speed = perf.approach
          p.gearDown = distance < GEAR_DOWN_DISTANCE
          p.onGround = false
        } else {
          const along = perf.approach * dt - 0.5 * decel * dt * dt
          p.x = aimX + end.dx * along
          p.z = aimZ + end.dz * along
          p.y = elevation
          p.pitch = 0
          p.speed = perf.approach - decel * dt
          p.gearDown = true
          p.onGround = true
        }
      }
      const release = touchdown + interval / 2
      const lift = perf.rotate / perf.accel
      const rollLength = 0.5 * perf.accel * lift * lift
      const climbTime = DEPARTURE_LENGTH / perf.climb
      const dr = t - release
      if (dr >= 0 && dr < lift + climbTime) {
        const p = pose(out, count++)
        p.key = `${airport.id}-d${slot}`
        p.family = family
        p.kind = 'departure'
        p.airport = airport.id
        p.heading = inUse.heading
        p.bank = 0
        const startX = end.x + end.dx * 60
        const startZ = end.z + end.dz * 60
        if (dr < lift) {
          const along = 0.5 * perf.accel * dr * dr
          p.x = startX + end.dx * along
          p.z = startZ + end.dz * along
          p.y = elevation
          p.pitch = 0
          p.speed = perf.accel * dr
          p.gearDown = true
          p.onGround = true
        } else {
          const tau = dr - lift
          const travelled = perf.climb * tau
          const angle = perf.climbAngle * DEG
          p.x = startX + end.dx * (rollLength + travelled * cos(angle))
          p.z = startZ + end.dz * (rollLength + travelled * cos(angle))
          p.y = elevation + travelled * sin(angle)
          p.pitch = perf.climbAngle + 3
          p.speed = perf.climb
          p.gearDown = tau < 8
          p.onGround = false
        }
      }
    }
  }
  for (let i = 0; i < schedule.circuit; i++) {
    const family = schedule.families[i % schedule.families.length]
    const runway = inUse.runway
    const straight = runway.length + 2 * CIRCUIT_EXTENSION
    const turn = Math.PI * CIRCUIT_RADIUS
    const period = (2 * straight + 2 * turn) / CIRCUIT_SPEED
    let s = ((t / period + i / schedule.circuit) % 1) * (2 * straight + 2 * turn)
    const centreX = end.x + end.dx * (runway.length / 2)
    const centreZ = end.z + end.dz * (runway.length / 2)
    const leftX = end.dz
    const leftZ = -end.dx
    let along: number
    let side: number
    let heading: number
    let bank = 0
    if (s < straight) {
      along = -straight / 2 + s
      side = 0
      heading = inUse.heading
    } else if ((s -= straight) < turn) {
      const a = s / CIRCUIT_RADIUS
      along = straight / 2 + CIRCUIT_RADIUS * sin(a)
      side = CIRCUIT_RADIUS - CIRCUIT_RADIUS * cos(a)
      heading = inUse.heading - (a / DEG)
      bank = -25
    } else if ((s -= turn) < straight) {
      along = straight / 2 - s
      side = CIRCUIT_WIDTH
      heading = inUse.heading + 180
    } else {
      s -= straight
      const a = s / CIRCUIT_RADIUS
      along = -straight / 2 - CIRCUIT_RADIUS * sin(a)
      side = CIRCUIT_RADIUS + CIRCUIT_RADIUS * cos(a)
      heading = inUse.heading + 180 - (a / DEG)
      bank = -25
    }
    const p = pose(out, count++)
    p.key = `${airport.id}-c${i}`
    p.family = family
    p.kind = 'circuit'
    p.airport = airport.id
    p.x = centreX + end.dx * along + leftX * side
    p.z = centreZ + end.dz * along + leftZ * side
    p.y = elevation + CIRCUIT_HEIGHT
    p.heading = ((heading % 360) + 360) % 360
    p.pitch = 0
    p.bank = bank
    p.speed = CIRCUIT_SPEED
    p.gearDown = family === 'wren'
    p.onGround = false
  }
  return count
}

/** Traffic at every airport within `range` metres of (x, z); returns how many poses were written to `out`. */
export function trafficNear(x: number, z: number, range: number, seconds: number, windFrom: number, windSpeed: number, out: TrafficPose[]): number {
  let count = 0
  for (const airport of AIRPORTS) {
    const dx = airport.x - x
    const dz = airport.z - z
    const reach = range + FINAL_LENGTH + DEPARTURE_LENGTH
    if (dx * dx + dz * dz > reach * reach) continue
    count = airportTraffic(airport, seconds, windFrom, windSpeed, out, count)
  }
  return count
}
