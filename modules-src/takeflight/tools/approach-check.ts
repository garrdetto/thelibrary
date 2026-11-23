import wren from '../shared/aircraft/wren.json'
import { parseAircraft } from '../shared/AircraftSpec'
import { TERRAIN } from '../shared/Terrain'
import { Simulation, SIM_HZ } from '../sim/Simulation'
import { NO_ASSISTS } from '../sim/Assists'
import { CALM } from '../sim/Wind'
import { KNOT, FPM, SEA_LEVEL_PRESSURE, createAirSample, sampleAir } from '../sim/Atmosphere'
import { levelTrim } from '../sim/Trim'
import { DEG } from '../sim/SimMath'
const spec = parseAircraft(wren)
for (const power of [0.2, 0.25, 0.3, 0.35]) {
  const sim = new Simulation({ aircraft: spec, ground: TERRAIN, wind: CALM, seed: 1, temperatureOffset: 0, seaLevelPressure: SEA_LEVEL_PRESSURE, assists: NO_ASSISTS })
  const a = sim.aircraft
  const speed = spec.vSpeeds.vapp * KNOT
  const air = sampleAir(400, 0, SEA_LEVEL_PRESSURE, createAirSample())
  const flap = 10 / 30
  const gp = 3
  const trim = levelTrim(spec, a.mass, speed, air.density, flap)
  a.place(-5000, 400, 0, 90, trim.alpha - gp, 0, speed)
  a.vy = -Math.sin(gp * DEG) * speed
  a.trim = trim.trim
  a.flap = flap
  a.power = power
  sim.pilot.flaps = 1
  sim.pilot.throttle = power
  sim.settle()
  const rows = []
  for (let t = 0; t <= 40 * SIM_HZ; t++) {
    sim.stepPilot()
    if (t % (10 * SIM_HZ) === 0) rows.push(`${(t / SIM_HZ).toFixed(0)}s ias ${(a.ias / KNOT).toFixed(0)} vs ${(a.vy / FPM).toFixed(0)} pitch ${a.pitch.toFixed(1)}`)
  }
  console.log('power', power, 'trim', trim.trim.toFixed(3), 'alpha', trim.alpha.toFixed(2), '|', rows.join(' | '))
}
