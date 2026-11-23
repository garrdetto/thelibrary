import wren from '../shared/aircraft/wren.json'
import { parseAircraft } from '../shared/AircraftSpec'
import { TERRAIN } from '../shared/Terrain'
import { Simulation, SIM_HZ } from '../sim/Simulation'
import { NO_ASSISTS } from '../sim/Assists'
import { CALM } from '../sim/Wind'
import { KNOT, FPM } from '../sim/Atmosphere'

const spec = parseAircraft(wren)
const sim = new Simulation({ aircraft: spec, ground: TERRAIN, wind: CALM, seed: 1, temperatureOffset: 0, seaLevelPressure: 101325, assists: NO_ASSISTS })
const a = sim.aircraft
a.placeOnGround(TERRAIN, -560, 0, 90)
sim.settle()
const p = sim.pilot
console.log('terrain at origin', TERRAIN.heightAt(0,0).toFixed(1), 'start y', a.py.toFixed(2))
for (let i = 0; i < SIM_HZ * 2; i++) sim.stepPilot()
console.log('settled: pitch', a.pitch.toFixed(2), 'agl', a.agl.toFixed(3), 'wheel', a.wheelLoad.toFixed(0), 'G', a.loadFactor.toFixed(3), 'vs', a.vy.toFixed(3))
p.throttle = 1
let t = 0, rotated = false, liftoffX = 0
for (; t < 60 * SIM_HZ; t++) {
  sim.stepPilot()
  const kias = a.ias / KNOT
  if (!rotated && kias >= 55) { rotated = true; console.log('Vr at', (t / SIM_HZ).toFixed(1), 's, roll', (a.px + 560).toFixed(0), 'm') }
  p.pitch = rotated ? (a.pitch < 9 ? 0.35 : 0.05) : 0; p.yaw = (90 - a.heading) * 0.15 - a.wy * -0.5
  if (a.wheelLoad === 0 && !liftoffX) { liftoffX = a.px + 560; console.log('liftoff', (t / SIM_HZ).toFixed(1), 's at', liftoffX.toFixed(0), 'm', kias.toFixed(0), 'kt') }
  if (a.crashed) { console.log('CRASH', a.crashed); break }
}
console.log('after 60s: alt agl', a.agl.toFixed(0), 'ias', (a.ias / KNOT).toFixed(0), 'vs fpm', (a.vy / FPM).toFixed(0), 'pitch', a.pitch.toFixed(1), 'hdg', a.heading.toFixed(1), 'bank', a.bank.toFixed(1))
// climb at Vy with simple pitch hold to target speed
for (let i = 0; i < 120 * SIM_HZ; i++) {
  const err = a.ias / KNOT - 74
  p.pitch = Math.max(-1, Math.min(1, 0.05 + err * 0.02 - a.wz * 2))
  p.roll = -a.bank * 0.02
  sim.stepPilot()
}
console.log('climb Vy: vs fpm', (a.vy / FPM).toFixed(0), 'alt agl', a.agl.toFixed(0), 'alpha', a.alpha.toFixed(1), 'pitch', a.pitch.toFixed(1))
// level cruise full power: hold altitude
const hold = a.py
for (let i = 0; i < 240 * SIM_HZ; i++) {
  p.pitch = Math.max(-1, Math.min(1, (hold - a.py) * 0.01 - a.vy * 0.05 - a.wz * 2 + 0.0))
  p.roll = -a.bank * 0.02
  sim.stepPilot()
}
console.log('level full power: ias', (a.ias / KNOT).toFixed(0), 'tas', (a.tas / KNOT).toFixed(0), 'vs', (a.vy / FPM).toFixed(0), 'alpha', a.alpha.toFixed(2), 'elev', a.elevator.toFixed(2), 'rpm', a.rpm.toFixed(0), 'fuel', a.fuel.toFixed(1))
// stall: idle, hold altitude until stall
p.throttle = 0
let stallKt = 0
for (let i = 0; i < 90 * SIM_HZ; i++) {
  p.pitch = Math.max(-1, Math.min(1, (hold - a.py) * 0.02 - a.vy * 0.1 - a.wz * 2))
  p.roll = -a.bank * 0.03
  sim.stepPilot()
  if (!stallKt && a.vy < -4 && a.alpha > 14) { stallKt = a.ias / KNOT; console.log('stall at', stallKt.toFixed(0), 'kt alpha', a.alpha.toFixed(1)) }
}
console.log('end', a.crashed, 'ias', (a.ias/KNOT).toFixed(0), 'bank', a.bank.toFixed(0), 'pitch', a.pitch.toFixed(0))
