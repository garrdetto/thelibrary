import wren from '../shared/aircraft/wren.json'
import { HARROW_FIELD } from '../shared/Airports'
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

/** A simple scripted pilot that flies the Wren down runway 09's glidepath, flares, lands and brakes to a stop. */
export function landingPilot(sim: Simulation, options: { flareHeight?: number; sinkTarget?: number } = {}): (t: number) => void {
  const a = sim.aircraft
  const flareHeight = options.flareHeight ?? 5
  const sinkTarget = options.sinkTarget ?? 0.7
  const aimX = -625 + 250
  return () => {
    const p = sim.pilot
    const height = a.py - 1.3 - HARROW_FIELD.elevation
    const along = aimX - a.px
    if (a.wheelLoad > 0 && a.airborneTicks === 0 && height < 2) {
      p.throttle = 0
      p.pitch = 0
      p.roll = -a.bank * 0.05
      p.yaw = Math.max(-1, Math.min(1, (90 - a.heading) * 0.2 - a.pz * 0.05))
      p.brakeLeft = a.groundSpeed > 3 ? 0.7 : 1
      p.brakeRight = p.brakeLeft
      return
    }
    const course = 90 + Math.max(-20, Math.min(20, -a.pz * 0.08))
    const bankWant = Math.max(-10, Math.min(10, (course - a.heading) * 0.8))
    p.roll = Math.max(-1, Math.min(1, (bankWant - a.bank) * 0.03 - a.wx * 0.6))
    p.yaw = 0
    if (height > flareHeight) {
      const targetHeight = Math.tan((3 * Math.PI) / 180) * Math.max(0, along)
      const vsWant = -Math.sin((3 * Math.PI) / 180) * a.groundSpeed + (targetHeight - height) * 0.15
      p.pitch = Math.max(-1, Math.min(1, (vsWant - a.vy) * 0.08 - a.wz * 1.5 + 0.05))
      p.throttle = Math.max(0, Math.min(1, 0.3 + (70 * 0.514444 - a.ias) * 0.08))
    } else {
      p.throttle = 0
      const vsWant = -Math.max(sinkTarget, height * 0.25)
      p.pitch = Math.max(-1, Math.min(1, (vsWant - a.vy) * 0.25 - a.wz * 1.5 + 0.1))
    }
  }
}
