import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Lab } from '../../railsetup/sim/lab'
import { railVehicle } from '../../railsetup/sim/vehicle'
import { createCar } from '../next/sim/car'
import { TRACKS, labTrack, labParkShift, makeConfig, STEP } from '../next/sim/config'
import { rng } from '../next/sim/math'
import { place } from '../next/sim/physics'
import { createWorld, simulate } from '../next/sim/race'
import { labTrackSpec, parseRailVehicle } from '../next/sim/railCar'
import type { Controls } from '../next/sim/car'
import type { RailVehicle } from '../next/sim/railCar'
import { newRailState } from '../next/sim/railDynamics'
import { lineLat, railPhase } from '../next/sim/railDriver'
import { Track } from '../next/sim/track'
import { runRail } from './railRun'

const car = (inputs: Record<string, number> = {}): RailVehicle => {
  const l = new Lab()
  Object.assign(l.inputs, inputs)
  l.update()
  return railVehicle(l, 'test')
}
const DEF = car()
const SPEC = { radiusFt: 120, bankDeg: 12, straightBankDeg: 4 }
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length

/** Runs the car on a flat test track with fixed controls and reports the body after `seconds`. */
function hold(veh: RailVehicle, ctl: Controls, seconds: number, speed = 25, lat = 0) {
  let clock = 0
  const w = createWorld(labTrack({ radiusFt: 300, bankDeg: 0, straightBankDeg: 0 }), rng(1), () => clock, 'next')
  const c = createCar('host', { local: true, player: true, stockCar: true })
  w.cars.set(c.id, c)
  place(w, c, 4, lat)
  c.rail = newRailState(veh, w.track)
  c.vx = Math.sin(c.h) * speed
  c.vz = Math.cos(c.h) * speed
  c.rail.omega = speed / ((veh.rollout[2] + veh.rollout[3]) / (4 * Math.PI))
  for (let i = 0; i < seconds / STEP; i++) {
    clock += STEP
    simulate(w, STEP, () => ctl)
  }
  return c
}

test('the Lab’s track keeps Thrill Park Speedway’s length and takes the Lab’s radius and banking', () => {
  const base = TRACKS.parkoval
  for (const radiusFt of [40, 120, 300]) {
    const def = labTrack({ radiusFt, bankDeg: 15, straightBankDeg: 5 }), T = new Track(def, makeConfig(def))
    assert.ok(Math.abs(T.R - radiusFt * 0.3048) < 1e-9)
    assert.ok(Math.abs(T.L + 2 * T.R - (base.L + 2 * base.R)) < 1e-9, 'end to end length kept')
    assert.equal(def.turnBank, 15)
    assert.equal(def.straightBank, 5)
    assert.equal(def.theme, 'park')
    assert.ok(Math.abs(labParkShift(def) - (base.R - T.R)) < 1e-9)
  }
  assert.deepEqual(labTrackSpec(new URLSearchParams('lab=1&rad=999&bank=-4')), { radiusFt: 300, bankDeg: 0, straightBankDeg: 0 })
  assert.deepEqual(labTrackSpec(new URLSearchParams('lab=1&rad=150&bank=12')), { radiusFt: 150, bankDeg: 12, straightBankDeg: 4 })
})

test('the track page refuses a setup message that is not a car', () => {
  assert.equal(parseRailVehicle({ v: 1, name: 'x' }), null)
  assert.equal(parseRailVehicle({ ...DEF, mass: 1e9 }), null)
  assert.ok(parseRailVehicle(JSON.parse(JSON.stringify(DEF))))
})

test('the test driver runs clean, repeatable laps', () => {
  const a = runRail(DEF, SPEC, 5), b = runRail(DEF, SPEC, 5)
  assert.deepEqual(a.laps, b.laps, 'deterministic')
  assert.equal(a.nan, false)
  assert.equal(a.recovered, 0)
  assert.equal(a.laps.length, 5)
  for (const t of a.laps) assert.ok(t > 17 && t < 22, `lap ${t}`)
})

test('the test driver runs the wall on the straights, the apron at the apex, and brakes and accelerates hard', () => {
  for (const radiusFt of [60, 120, 300]) {
    const T = new Track(labTrack({ ...SPEC, radiusFt }), makeConfig(labTrack({ ...SPEC, radiusFt })))
    const apex = T.T1 + T.TURN / 2
    assert.ok(lineLat(T, T.S_LINE) > T.HW - 1.4, 'by the wall mid-straight')
    assert.ok(lineLat(T, apex) < -T.HW + 1.1, 'on the apron at the apex')
    assert.ok(lineLat(T, apex) > -T.HW + 0.9, 'tires stay on the track')
    assert.deepEqual([railPhase(T, T.S_LINE), railPhase(T, apex - T.TURN * 0.3), railPhase(T, apex), railPhase(T, apex + T.TURN * 0.3)], ['straight', 'entry', 'apex', 'exit'])
  }
  const seen = { straightThr: 0, brakePeak: 0, apexBrake: 0, apexThr: [] as number[], wallLat: [] as number[], apexLat: [] as number[] }
  runRail(DEF, SPEC, 5, undefined, (w, c, d) => {
    if (d.laps < 3) return
    const T = w.track, ph = railPhase(T, c.tp.s), mid = Math.abs((((c.tp.s - T.T1 - T.TURN / 2) % T.P) + T.P) % T.P) < 2
    if (ph === 'straight') seen.straightThr = Math.max(seen.straightThr, d.thr)
    if (ph === 'straight' || ph === 'entry') seen.brakePeak = Math.max(seen.brakePeak, d.brk)
    if (ph === 'apex') seen.apexBrake = Math.max(seen.apexBrake, d.brk)
    if (mid) seen.apexThr.push(d.thr), seen.apexLat.push(c.tp.lat)
    if (Math.abs(c.tp.s % T.P - T.S_LINE) < 2) seen.wallLat.push(c.tp.lat)
  })
  assert.equal(seen.straightThr, 1, 'flat out on the straights')
  assert.ok(seen.brakePeak > 0.7, `hard on the brakes into the turn (${seen.brakePeak})`)
  assert.ok(seen.apexBrake < 0.2, `off the brakes at the apex (${seen.apexBrake})`)
  assert.ok(mean(seen.apexThr) < 0.4, `maintenance throttle at the apex (${mean(seen.apexThr)})`)
  assert.ok(mean(seen.wallLat) > 6, `up by the wall on the straight (${mean(seen.wallLat)})`)
  assert.ok(mean(seen.apexLat) < -5, `down low at the apex (${mean(seen.apexLat)})`)
})

test('throttle lifts the nose and squats the rear; brakes dive the nose', () => {
  const thr = hold(DEF, { thr: 1, brk: 0, steer: 0 }, 1.2, 15).rail!
  assert.ok(thr.th > 0.004, `nose up on throttle (${thr.th})`)
  assert.ok((thr.travel[2] + thr.travel[3]) / 2 > (thr.travel[0] + thr.travel[1]) / 2, 'rear compresses more than the front')
  const brk = hold(DEF, { thr: 0, brk: 1, steer: 0 }, 0.6, 30).rail!
  assert.ok(brk.th < -0.004, `nose down under braking (${brk.th})`)
  assert.ok(brk.fz[0] + brk.fz[1] > DEF.staticLoad[0] + DEF.staticLoad[1], 'weight moves onto the front tires')
})

test('cornering moves weight to the right side and a smaller bar lets the body roll more', () => {
  const turn = (v: RailVehicle) => hold(v, { thr: 0.4, brk: 0, steer: 0.18 }, 1.4, 24, 6).rail!
  const big = turn(car({ bar: 2 })), small = turn(car({ bar: 1.375 }))
  assert.ok(big.ay > 5, `the car is turning left (${big.ay})`)
  assert.ok(big.fz[1] > big.fz[0] && big.fz[3] > big.fz[2], 'right side carries the load in a left turn')
  assert.ok(small.pf > big.pf * 1.3, `roll ${small.pf} vs ${big.pf}`)
})

test('low ride heights bottom the car on the banking; stock heights clear it', () => {
  const stock = runRail(DEF, { radiusFt: 120, bankDeg: 20, straightBankDeg: 8 }, 3)
  const low = runRail(car({ hlf: 1.75, hrf: 1.75, hrr: 2 }), { radiusFt: 120, bankDeg: 20, straightBankDeg: 8 }, 3)
  assert.ok(low.lastPeak.bottom > stock.lastPeak.bottom + 0.3, `scraping ${low.lastPeak.bottom} s vs ${stock.lastPeak.bottom} s`)
  assert.ok(low.lastPeak.minClear < 0, 'the frame touched')
})

test('bump springs only work past their gap, and then hold the corner up', () => {
  const soft = { lf: 300, rf: 300, blf: 0, brf: 0 }
  const free = hold(car(soft), { thr: 0, brk: 1, steer: 0 }, 0.5, 32).rail!
  const stops = hold(car({ ...soft, blf: 4000, brf: 4000, glf: 0.25, grf: 0.25 }), { thr: 0, brk: 1, steer: 0 }, 0.5, 32).rail!
  assert.ok(stops.bump[0] && stops.bump[1], 'the front bump springs are touching under braking')
  assert.ok(!free.bump[0], 'no bump springs, nothing touching')
  assert.ok(stops.travel[0] < free.travel[0] - 0.005, `less dive on the bump springs (${stops.travel[0]} vs ${free.travel[0]})`)
})

test('banking speeds the car up and stagger turns it, as on a real short track', () => {
  const flat = runRail(DEF, { radiusFt: 120, bankDeg: 0, straightBankDeg: 0 }, 5)
  const banked = runRail(DEF, { radiusFt: 120, bankDeg: 20, straightBankDeg: 8 }, 5)
  assert.ok(mean(banked.laps.slice(-3)) < mean(flat.laps.slice(-3)) - 1, 'more banking, quicker laps')
  assert.ok(banked.turn.speed > flat.turn.speed + 2, 'and more corner speed')
  const straight = { thr: 0.6, brk: 0, steer: 0 }
  const even = hold(car({ tcrr: 84 }), straight, 1.5).rail!, staggered = hold(DEF, straight, 1.5).rail!
  assert.ok(staggered.r > even.r + 0.03, `on a spool, stagger turns the car left by itself (${staggered.r} vs ${even.r} rad/s)`)
})
