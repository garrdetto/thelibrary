/**
 * Where a flight begins: on a stand, lined up on a runway, on a 3-mile final or cruising. Placement is part of the simulation,
 * so it uses only `SimMath`: a recorded flight is its start, conditions and input log, and re-flying it (touchdown replays now,
 * the Worker's score check later) must put the aircraft in exactly the same state. Returns the throttle and parking brake the
 * pilot's controls start with.
 */
import type { AirportSpec } from '../shared/Airports'
import { aimDistance, landingEnds, runwayFrame } from '../shared/Airports'
import type { Ground } from '../shared/Terrain'
import { FOOT, KNOT, SEA_LEVEL_PRESSURE, createAirSample, sampleAir } from './Atmosphere'
import type { ControlInput } from './Controls'
import type { FlightModel } from './FlightModel'
import { DEG, cos, sin } from './SimMath'
import { levelTrim } from './Trim'

/** Starts on the airport's main runway: end 1 is `runways[0].ends[0]`, end 2 the other one. */
export type StartKind = 'runway1' | 'runway2' | 'stand' | 'final1' | 'final2' | 'cruise'

export const START_KINDS: readonly StartKind[] = ['runway1', 'runway2', 'stand', 'final1', 'final2', 'cruise']

export interface StartResult {
  throttle: number
  parkingBrake: boolean
}

const air = createAirSample()
const CRUISE_LEAD = 9000
const CRUISE_CLEARANCE = 450

/** The starts offered at an airport (no final onto a runway end that is not landed on). */
export function startsAt(airport: AirportSpec): StartKind[] {
  const ends = landingEnds(airport, airport.runways[0])
  return START_KINDS.filter((kind) => (kind === 'final1' ? ends.includes(0) : kind === 'final2' ? ends.includes(1) : true))
}

/** Places `aircraft` for `start` at `airport` and sets the matching pilot levers in `pilot`. */
export function placeStart(aircraft: FlightModel, pilot: ControlInput, airport: AirportSpec, ground: Ground, start: StartKind): StartResult {
  const spec = aircraft.spec
  const runway = airport.runways[0]
  const frame = runwayFrame(runway)
  pilot.pitch = 0
  pilot.roll = 0
  pilot.yaw = 0
  pilot.brakeLeft = 0
  pilot.brakeRight = 0
  pilot.flaps = 0
  pilot.gear = 1
  pilot.spoilers = 0
  pilot.reverse = 0
  pilot.trim = 0
  let throttle = 0
  let parkingBrake = false
  if (start === 'stand') {
    const stand = airport.stands[0]
    aircraft.placeOnGround(ground, stand.x, stand.z, stand.heading)
    parkingBrake = true
  } else if (start === 'runway1' || start === 'runway2') {
    const along = start === 'runway1' ? 25 : runway.length - 25
    const heading = start === 'runway1' ? runway.heading : (runway.heading + 180) % 360
    aircraft.placeOnGround(ground, frame.x0 + frame.dx * along, frame.z0 + frame.dz * along, heading)
  } else if (start === 'final1' || start === 'final2') {
    const fromLow = start === 'final1'
    const distance = 3 * 1609
    const aim = aimDistance(runway)
    const along = fromLow ? aim - distance : runway.length - aim + distance
    const heading = fromLow ? runway.heading : (runway.heading + 180) % 360
    const x = frame.x0 + frame.dx * along
    const z = frame.z0 + frame.dz * along
    const slope = runway.glidepath * DEG
    const height = (sin(slope) / cos(slope)) * distance
    const speed = spec.vSpeeds.vapp * KNOT
    const detents = spec.controls.flapDetents
    const flapIndex = detents.length > 1 ? 1 : 0
    const flapShare = detents[flapIndex] / (detents[detents.length - 1] || 1)
    sampleAir(airport.elevation + height, 0, SEA_LEVEL_PRESSURE, air)
    const trim = levelTrim(spec, aircraft.mass, speed, air.density, flapShare)
    aircraft.place(x, airport.elevation + 1.3 + height, z, heading, trim.alpha - runway.glidepath, 0, speed)
    aircraft.vy = -sin(slope) * speed
    aircraft.trim = trim.trim
    aircraft.flap = flapShare
    aircraft.power = 0.3
    pilot.flaps = flapIndex
    throttle = 0.3
  } else {
    const x = frame.x0 - frame.dx * CRUISE_LEAD
    const z = frame.z0 - frame.dz * CRUISE_LEAD
    let highest = airport.elevation
    for (let d = 0; d <= CRUISE_LEAD * 2; d += 250) {
      const h = ground.heightAt(x + frame.dx * d, z + frame.dz * d)
      if (h > highest) highest = h
    }
    const altitude = Math.max(3500 * FOOT, Math.ceil((highest + CRUISE_CLEARANCE) / (500 * FOOT)) * 500 * FOOT)
    const speed = spec.vSpeeds.cruise * KNOT * 0.95
    sampleAir(altitude, 0, SEA_LEVEL_PRESSURE, air)
    const trim = levelTrim(spec, aircraft.mass, speed, air.density, 0)
    aircraft.place(x, altitude, z, runway.heading, trim.alpha, 0, speed)
    aircraft.trim = trim.trim
    aircraft.power = 0.72
    throttle = 0.72
  }
  pilot.throttle = throttle
  pilot.parkingBrake = parkingBrake ? 1 : 0
  return { throttle, parkingBrake }
}

export function startsAirborne(start: StartKind): boolean {
  return start === 'final1' || start === 'final2' || start === 'cruise'
}
