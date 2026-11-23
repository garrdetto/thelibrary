/**
 * Where a flight begins: on a stand, lined up on a runway, on a 3-mile final or cruising. Placement is part of the simulation,
 * so it uses only `SimMath`: a recorded flight is its start, conditions and input log, and re-flying it (touchdown replays now,
 * the Worker's score check later) must put the aircraft in exactly the same state. Returns the throttle and parking brake the
 * pilot's controls start with.
 */
import type { AirportSpec } from '../shared/Airports'
import { runwayFrame } from '../shared/Airports'
import type { Ground } from '../shared/Terrain'
import { FOOT, KNOT, SEA_LEVEL_PRESSURE, createAirSample, sampleAir } from './Atmosphere'
import type { ControlInput } from './Controls'
import type { FlightModel } from './FlightModel'
import { DEG, cos, sin } from './SimMath'
import { levelTrim } from './Trim'

export type StartKind = 'runway09' | 'runway27' | 'stand' | 'final09' | 'final27' | 'cruise'

export const START_KINDS: readonly StartKind[] = ['runway09', 'runway27', 'stand', 'final09', 'final27', 'cruise']

export interface StartResult {
  throttle: number
  parkingBrake: boolean
}

const air = createAirSample()

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
  } else if (start === 'runway09' || start === 'runway27') {
    const along = start === 'runway09' ? 25 : runway.length - 25
    const heading = start === 'runway09' ? runway.heading : (runway.heading + 180) % 360
    aircraft.placeOnGround(ground, frame.x0 + frame.dx * along, frame.z0 + frame.dz * along, heading)
  } else if (start === 'final09' || start === 'final27') {
    const fromLow = start === 'final09'
    const distance = 3 * 1609
    const aim = 250
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
    const altitude = 3500 * FOOT
    const speed = spec.vSpeeds.cruise * KNOT * 0.95
    sampleAir(altitude, 0, SEA_LEVEL_PRESSURE, air)
    const trim = levelTrim(spec, aircraft.mass, speed, air.density, 0)
    aircraft.place(airport.x - 9000, altitude, airport.z + 2500, runway.heading, trim.alpha, 0, speed)
    aircraft.trim = trim.trim
    aircraft.power = 0.72
    throttle = 0.72
  }
  pilot.throttle = throttle
  pilot.parkingBrake = parkingBrake ? 1 : 0
  return { throttle, parkingBrake }
}

export function startsAirborne(start: StartKind): boolean {
  return start === 'final09' || start === 'final27' || start === 'cruise'
}
