import { createCar } from '../next/sim/car'
import { labTrack, STEP } from '../next/sim/config'
import { rng } from '../next/sim/math'
import { place } from '../next/sim/physics'
import { createWorld, simulate } from '../next/sim/race'
import type { RailVehicle } from '../next/sim/railCar'
import { newRailDriver, railDriverControls, railDriverLap, railRecover, lineLat } from '../next/sim/railDriver'
import { newRailState } from '../next/sim/railDynamics'
import type { RailState } from '../next/sim/railDynamics'
import type { Controls, SimCar } from '../next/sim/car'
import type { RailDriver } from '../next/sim/railDriver'
import type { World } from '../next/sim/world'

export type RailRun = {
  laps: number[]
  best: number
  /** Means over the last lap of the run, mid-turn: body roll and pitch (°), tire loads (N), ride F/R (m), speed, balance (front minus rear slip angle, °: + = tight) and body slip (°). */
  turn: { roll: number; pitch: number; fz: number[]; front: number; rear: number; speed: number; under: number; beta: number }
  peak: RailState['peak']
  /** Peaks over the last full lap. */
  lastPeak: RailState['peak']
  nan: boolean
  wall: number
  /** Times the car had to be put back on the track. */
  recovered: number
}

/** Drives `laps` timed laps with the track test's driver (plus an out lap) and reports what the car did. */
export function runRail(veh: RailVehicle, spec = { radiusFt: 120, bankDeg: 12, straightBankDeg: 4 }, laps = 6, override?: (t: number) => Controls | null, probe?: (w: World, c: SimCar, d: RailDriver) => void): RailRun {
  let clock = 0
  const w = createWorld(labTrack(spec), rng(7), () => clock, 'next')
  const T = w.track
  const c = createCar('host', { local: true, player: true, stockCar: true })
  w.cars.set(c.id, c)
  place(w, c, T.S_LINE - 70, lineLat(T, T.S_LINE - 70))
  c.rail = newRailState(veh, T)
  const sh = Math.sin(c.h), ch = Math.cos(c.h)
  c.vx = sh * 18
  c.vz = ch * 18
  c.rail.omega = 18 / ((veh.rollout[2] + veh.rollout[3]) / (4 * Math.PI))
  w.race.ph = 'attack'
  w.race.mode = 'time-attack'
  const d = newRailDriver(T)
  const out: number[] = []
  let lastCross = c.cross, wall = 0, recovered = 0, nan = false, tick = 0, lastPeak = { ...c.rail.peak }
  const acc = { n: 0, roll: 0, pitch: 0, fz: [0, 0, 0, 0], front: 0, rear: 0, speed: 0, under: 0, beta: 0 }
  const max = 120 * 40 * (laps + 2)
  while (out.length < laps && tick < max) {
    clock += STEP
    tick++
    simulate(w, STEP, (car) => override?.(clock) ?? railDriverControls(w, car, d))
    probe?.(w, c, d)
    const st = c.rail
    if (!Number.isFinite(c.x + c.z + c.vx + c.vz + st.z + st.pf)) { nan = true; break }
    if (c.tp.lat > T.HW - 0.3) wall++
    if (d.stuck > 2) {
      railRecover(w, c, d)
      recovered++
    }
    if (c.cross !== lastCross) {
      lastCross = c.cross
      if (c.lastLap != null && c.cross > 2) out.push(c.lastLap)
      railDriverLap(d, T)
      if (out.length === laps - 1) Object.assign(acc, { n: 0, roll: 0, pitch: 0, fz: [0, 0, 0, 0], front: 0, rear: 0, speed: 0, under: 0, beta: 0 })
      lastPeak = { ...st.peak }
      st.peak = { bottom: 0, bumpT: 0, liftT: 0, noseLift: 0, minClear: Infinity }
    }
    const s = ((c.tp.s % T.P) + T.P) % T.P, mid1 = T.L + T.TURN * 0.5, mid2 = 2 * T.L + T.TURN * 1.5
    if (Math.abs(s - mid1) < T.TURN * 0.2 || Math.abs(s - mid2) < T.TURN * 0.2) {
      const u = c.vf
      acc.n++
      acc.roll += ((st.pf + st.pr) / 2) * 57.2958
      acc.pitch += st.th * 57.2958
      st.fz.forEach((f, i) => { acc.fz[i] += f })
      acc.front += (st.travel[0] + st.travel[1]) / 2
      acc.rear += (st.travel[2] + st.travel[3]) / 2
      acc.speed += u
      acc.under += ((Math.abs(st.alpha[0]) + Math.abs(st.alpha[1]) - Math.abs(st.alpha[2]) - Math.abs(st.alpha[3])) / 2) * 57.2958
      acc.beta += Math.atan2(c.vx * Math.cos(c.h) - c.vz * Math.sin(c.h), Math.max(3, u)) * 57.2958
    }
  }
  const n = Math.max(1, acc.n)
  return {
    laps: out, best: out.length ? Math.min(...out) : Infinity, nan, wall, recovered,
    turn: { roll: acc.roll / n, pitch: acc.pitch / n, fz: acc.fz.map((f) => f / n), front: acc.front / n, rear: acc.rear / n, speed: acc.speed / n, under: acc.under / n, beta: acc.beta / n },
    peak: c.rail.peak,
    lastPeak,
  }
}
