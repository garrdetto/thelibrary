import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FPM, KNOT, SEA_LEVEL_PRESSURE, createAirSample, sampleAir } from '../sim/Atmosphere'
import { SIM_HZ } from '../sim/Simulation'
import { DEG } from '../sim/SimMath'
import { levelTrim } from '../sim/Trim'
import { HARROW_FIELD } from '../shared/Airports'
import { TERRAIN } from '../shared/Terrain'
import { WREN, makeSim } from './helpers'

test('the Wren settles on its wheels and the parking brake holds it at idle', () => {
  const sim = makeSim()
  const a = sim.aircraft
  a.placeOnGround(TERRAIN, -560, 0, 90)
  sim.pilot.parkingBrake = 1
  sim.settle()
  for (let i = 0; i < SIM_HZ * 30; i++) sim.stepPilot()
  assert.ok(Math.abs(a.loadFactor - 1) < 0.01, `load factor ${a.loadFactor}`)
  assert.ok(Math.abs(a.px + 560) < 0.5, `crept ${a.px + 560} m`)
  assert.equal(a.crashed, null)
})

test('take-off roll, climb and cruise are in the trainer envelope', () => {
  const sim = makeSim()
  const a = sim.aircraft
  a.placeOnGround(TERRAIN, -560, 0, 90)
  sim.settle()
  sim.pilot.throttle = 1
  let liftoff = 0
  for (let t = 0; t < SIM_HZ * 60; t++) {
    const rotated = a.ias / KNOT >= WREN.vSpeeds.vr
    sim.pilot.pitch = rotated ? (a.pitch < 9 ? 0.35 : 0.05) : 0
    sim.pilot.yaw = (90 - a.heading) * 0.15
    sim.stepPilot()
    if (!liftoff && a.wheelLoad === 0 && a.agl > 1.6) liftoff = a.px + 560
  }
  assert.ok(liftoff > 180 && liftoff < 330, `ground roll ${liftoff} m`)
  for (let i = 0; i < SIM_HZ * 90; i++) {
    sim.pilot.pitch = Math.max(-1, Math.min(1, 0.05 + (a.ias / KNOT - WREN.vSpeeds.vy) * 0.02 - a.wz * 2))
    sim.pilot.roll = -a.bank * 0.02
    sim.stepPilot()
  }
  const climb = a.verticalSpeed / FPM
  assert.ok(climb > 450 && climb < 850, `climb ${climb} fpm`)
  const hold = a.py
  for (let i = 0; i < SIM_HZ * 240; i++) {
    sim.pilot.pitch = Math.max(-1, Math.min(1, (hold - a.py) * 0.01 - a.vy * 0.05 - a.wz * 2))
    sim.pilot.roll = -a.bank * 0.02
    sim.stepPilot()
  }
  const cruise = a.ias / KNOT
  assert.ok(cruise > 104 && cruise < 128, `full-power level speed ${cruise} kt`)
  assert.equal(a.crashed, null)
})

test('the stall comes near the published stall speed', () => {
  const sim = makeSim()
  const a = sim.aircraft
  sampleAir(1000, 0, SEA_LEVEL_PRESSURE, a.air)
  const speed = 90 * KNOT
  const trim = levelTrim(WREN, a.mass, speed, a.air.density, 0)
  a.place(0, 1000, 0, 90, trim.alpha, 0, speed)
  a.trim = trim.trim
  sim.settle()
  let stallKt = 0
  for (let i = 0; i < SIM_HZ * 80 && !stallKt; i++) {
    sim.pilot.pitch = Math.max(-1, Math.min(1, (1000 - a.py) * 0.02 - a.vy * 0.1 - a.wz * 2))
    sim.pilot.roll = -a.bank * 0.03
    sim.stepPilot()
    if (a.vy < -4 && a.alpha > 14) stallKt = a.ias / KNOT
  }
  assert.ok(stallKt > WREN.vSpeeds.vs1 - 8 && stallKt < WREN.vSpeeds.vs1 + 6, `stall at ${stallKt} kt`)
})

function approach(torqueYaw: number) {
  const sim = makeSim()
  sim.aircraft.spec.engine.torqueYaw = torqueYaw
  const a = sim.aircraft
  const speed = WREN.vSpeeds.vapp * KNOT
  const air = sampleAir(400, 0, SEA_LEVEL_PRESSURE, createAirSample())
  const trim = levelTrim(WREN, a.mass, speed, air.density, 1 / 3)
  a.place(-5000, 400, 0, 90, trim.alpha - 3, 0, speed)
  a.vy = -Math.sin(3 * DEG) * speed
  a.trim = trim.trim
  a.flap = 1 / 3
  a.power = 0.3
  sim.pilot.flaps = 1
  sim.pilot.throttle = 0.3
  sim.settle()
  return { sim, a }
}

test('a trimmed approach at 30 % power follows a 3 degree path hands off', () => {
  const torque = WREN.engine.torqueYaw
  try {
    const { sim, a } = approach(0)
    for (let i = 0; i < SIM_HZ * 40; i++) sim.stepPilot()
    const fpm = a.verticalSpeed / FPM
    assert.ok(fpm < -280 && fpm > -480, `descent ${fpm} fpm`)
    assert.ok(Math.abs(a.heading - 90) < 0.1 && Math.abs(a.bank) < 0.1, `the symmetric model turned to ${a.heading}`)
    const real = approach(torque)
    for (let i = 0; i < SIM_HZ * 15; i++) real.sim.stepPilot()
    assert.ok(real.a.heading < 90 && real.a.heading > 84, `engine torque should turn the nose gently left, got ${real.a.heading}`)
  } finally {
    WREN.engine.torqueYaw = torque
  }
})

test('a hard arrival breaks the gear', () => {
  const sim = makeSim()
  const a = sim.aircraft
  a.place(0, HARROW_FIELD.elevation + 4, 0, 90, 2, 0, 30)
  a.vy = -7
  sim.settle()
  for (let i = 0; i < SIM_HZ * 3; i++) sim.stepPilot()
  assert.ok(a.crashed !== null)
})

test('a gentle landing is recorded as a touchdown with its sink rate', () => {
  const sim = makeSim()
  const a = sim.aircraft
  a.place(0, HARROW_FIELD.elevation + 1.45, 0, 90, 4, 0, 50 * KNOT)
  a.vy = -0.8
  a.flap = 1
  sim.pilot.flaps = 3
  sim.settle()
  for (let i = 0; i < SIM_HZ * 8; i++) sim.stepPilot()
  assert.equal(a.crashed, null)
  assert.ok(a.touchdowns >= 1)
  assert.ok(a.lastTouchdown !== null && a.lastTouchdown.sinkRate < 2, `sink ${a.lastTouchdown?.sinkRate}`)
})

test('a firm arrival of about 1,000 fpm is forgiven: the gear holds', () => {
  const sim = makeSim()
  const a = sim.aircraft
  a.place(0, HARROW_FIELD.elevation + 1.5, 0, 90, 6, 0, 50 * KNOT)
  a.vy = -5.2
  sim.settle()
  for (let i = 0; i < SIM_HZ * 4; i++) sim.stepPilot()
  assert.equal(a.crashed, null)
  assert.ok(a.touchdowns >= 1)
})
