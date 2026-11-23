import { test } from 'node:test'
import assert from 'node:assert/strict'
import duet from '../shared/aircraft/duet.json'
import { parseAircraft } from '../shared/AircraftSpec'
import type { AircraftSpec } from '../shared/AircraftSpec'
import { TERRAIN } from '../shared/Terrain'
import { NO_ASSISTS } from '../sim/Assists'
import { FPM, KNOT, SEA_LEVEL_PRESSURE, sampleAir } from '../sim/Atmosphere'
import { SIM_HZ, Simulation } from '../sim/Simulation'
import { levelTrim } from '../sim/Trim'
import { CALM } from '../sim/Wind'

/** Published figures each new aircraft must fly to: ground roll (m), climb (fpm) and full-power level speed (kt) ranges. */
const FLEET: { spec: AircraftSpec; roll: [number, number]; climb: [number, number]; level: [number, number] }[] = [
  { spec: parseAircraft(duet), roll: [250, 560], climb: [900, 1700], level: [150, 205] },
]

function sim(spec: AircraftSpec) {
  return new Simulation({ aircraft: spec, ground: TERRAIN, wind: CALM, seed: 3, temperatureOffset: 0, seaLevelPressure: SEA_LEVEL_PRESSURE, assists: { ...NO_ASSISTS } })
}

for (const { spec, roll, climb, level } of FLEET) {
  test(`${spec.name}: rests on its wheels and holds on the parking brake`, () => {
    const s = sim(spec)
    s.aircraft.placeOnGround(TERRAIN, -560, 0, 90)
    s.pilot.parkingBrake = 1
    s.settle()
    for (let i = 0; i < SIM_HZ * 20; i++) s.stepPilot()
    assert.ok(Math.abs(s.aircraft.loadFactor - 1) < 0.02, `load ${s.aircraft.loadFactor}`)
    assert.equal(s.aircraft.crashed, null)
    assert.equal(s.aircraft.strikes, 0, 'no structure touches the ground')
  })

  test(`${spec.name}: take-off, climb with the gear up and level speed are in its envelope`, () => {
    const s = sim(spec)
    const a = s.aircraft
    a.placeOnGround(TERRAIN, -600, 0, 90)
    s.settle()
    s.pilot.throttle = 1
    let liftoff = 0
    for (let t = 0; t < SIM_HZ * 70; t++) {
      const rotated = a.ias / KNOT >= spec.vSpeeds.vr
      s.pilot.pitch = rotated ? (a.pitch < 8 ? 0.35 : 0.05) : 0
      s.pilot.yaw = (90 - a.heading) * 0.15
      if (liftoff && a.agl > 15) s.pilot.gear = 0
      s.stepPilot()
      if (!liftoff && a.wheelLoad === 0 && a.agl > 1.8) liftoff = a.px + 600
    }
    assert.ok(liftoff > roll[0] && liftoff < roll[1], `ground roll ${liftoff} m`)
    for (let i = 0; i < SIM_HZ * 90; i++) {
      s.pilot.pitch = Math.max(-1, Math.min(1, 0.05 + (a.ias / KNOT - spec.vSpeeds.vy) * 0.02 - a.wz * 2))
      s.pilot.roll = -a.bank * 0.02
      s.stepPilot()
    }
    const fpm = a.verticalSpeed / FPM
    assert.ok(fpm > climb[0] && fpm < climb[1], `climb ${fpm} fpm`)
    assert.ok(a.gear < 0.01 || !spec.controls.retractable, 'gear retracted')
    const hold = a.py
    for (let i = 0; i < SIM_HZ * 240; i++) {
      s.pilot.pitch = Math.max(-1, Math.min(1, (hold - a.py) * 0.01 - a.vy * 0.05 - a.wz * 2))
      s.pilot.roll = -a.bank * 0.02
      s.stepPilot()
    }
    const kt = a.ias / KNOT
    assert.ok(kt > level[0] && kt < level[1], `level ${kt} kt`)
    assert.equal(a.crashed, null)
  })

  test(`${spec.name}: stalls near its published stall speed`, () => {
    const s = sim(spec)
    const a = s.aircraft
    sampleAir(1000, 0, SEA_LEVEL_PRESSURE, a.air)
    const speed = spec.vSpeeds.vy * 1.2 * KNOT
    const trim = levelTrim(spec, a.mass, speed, a.air.density, 0)
    a.place(0, 1000, 0, 90, trim.alpha, 0, speed)
    a.trim = trim.trim
    s.pilot.gear = 0
    s.pilot.throttle = 0.1
    s.settle()
    let stallKt = 0
    for (let i = 0; i < SIM_HZ * 90 && !stallKt; i++) {
      s.pilot.pitch = Math.max(-1, Math.min(1, (1000 - a.py) * 0.02 - a.vy * 0.1 - a.wz * 2))
      s.pilot.roll = -a.bank * 0.03
      s.stepPilot()
      if (a.vy < -4 && a.alpha > 14) stallKt = a.ias / KNOT
    }
    assert.ok(stallKt > spec.vSpeeds.vs1 - 9 && stallKt < spec.vSpeeds.vs1 + 7, `stall at ${stallKt} kt`)
  })
}


test('an engine failure on the twin yaws toward the dead engine and replays exactly', async () => {
  const { createInput, decodeInput, encodeInput, INPUT_BYTES } = await import('../sim/Controls')
  const run = () => {
    const s = new Simulation({ aircraft: FLEET[0].spec, ground: TERRAIN, wind: CALM, seed: 5, temperatureOffset: 0, seaLevelPressure: SEA_LEVEL_PRESSURE, assists: { ...NO_ASSISTS }, failure: { engine: 1, agl: 60 } })
    s.aircraft.placeOnGround(TERRAIN, -600, 0, 90)
    s.settle()
    return s
  }
  const s = run()
  const a = s.aircraft
  const log: Uint8Array[] = []
  s.onTick((_t, input) => {
    const b = new Uint8Array(INPUT_BYTES)
    encodeInput(input, b, 0)
    log.push(b)
  })
  s.pilot.throttle = 1
  let failedAt = -1
  for (let t = 0; t < SIM_HZ * 45; t++) {
    s.pilot.pitch = a.ias / KNOT >= FLEET[0].spec.vSpeeds.vr ? (a.pitch < 8 ? 0.3 : 0.05) : 0
    s.pilot.roll = -a.bank * 0.03
    s.stepPilot()
    if (failedAt < 0 && a.failedEngine >= 0) failedAt = a.heading
  }
  assert.equal(a.failedEngine, 1)
  assert.ok(a.heading > failedAt + 3, `engine 2 (right) failing should swing the nose right: ${failedAt} → ${a.heading}`)
  const replay = run()
  const input = createInput()
  for (const b of log) replay.stepWith(decodeInput(b, 0, input))
  assert.equal(replay.aircraft.px, a.px)
  assert.equal(replay.aircraft.heading, a.heading)
})
