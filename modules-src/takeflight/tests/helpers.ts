import wren from '../shared/aircraft/wren.json'
import { parseAircraft } from '../shared/AircraftSpec'
import { TERRAIN } from '../shared/Terrain'
import { NO_ASSISTS } from '../sim/Assists'
import { SEA_LEVEL_PRESSURE } from '../sim/Atmosphere'
import { Simulation } from '../sim/Simulation'
import type { WindSpec } from '../sim/Wind'
import { CALM } from '../sim/Wind'

export const WREN = parseAircraft(wren)

export function makeSim(wind: WindSpec = CALM, seed = 7): Simulation {
  return new Simulation({ aircraft: WREN, ground: TERRAIN, wind, seed, temperatureOffset: 0, seaLevelPressure: SEA_LEVEL_PRESSURE, assists: { ...NO_ASSISTS } })
}

/** Every number that defines the aircraft's state, for exact comparisons. */
export function snapshot(sim: Simulation): number[] {
  const a = sim.aircraft
  return [a.tick, a.px, a.py, a.pz, a.vx, a.vy, a.vz, a.qx, a.qy, a.qz, a.qw, a.wx, a.wy, a.wz, a.fuel, a.power, a.trim, a.flap, a.elevator, a.aileron, a.rudder]
}
