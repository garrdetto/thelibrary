import type { Controls, SimCar } from './car'
import { clamp, mod } from './math'
import type { RailState } from './railDynamics'
import { newRailState, railSteerMax } from './railDynamics'
import { place } from './physics'
import type { Track } from './track'
import type { World } from './world'

/**
 * The track test's driver: follows the groove (high on entry, low at the apex) with pure pursuit, holds the car with
 * yaw and slip feedback, and drives a speed plan that it learns lap by lap: where the car slides, pushes off the line or
 * touches the wall it slows that corner a little, and where it had grip left it carries more speed. It never reads the
 * setup, so a looser or tighter car shows up as a different line, more sliding and a different lap time, the way a test
 * driver feels it. Fully deterministic.
 */
export type RailDriver = {
  bin: number
  grip: Float64Array
  /** Fastest clean and slowest failed corner speed found so far per stretch (0 / Infinity until known). */
  lo: Float64Array
  hi: Float64Array
  plan: Float64Array
  beta: Float64Array
  err: Float64Array
  wall: Uint8Array
  laps: number
  /** The driver's foot: throttle eases back in, comes off fast. */
  thr: number
  /** Seconds spent stopped or barely moving; past 2 s the page puts the car back on the groove. */
  stuck: number
  /** Set when the car had to be put back on track this lap: every corner backs off. */
  incident: boolean
}

const BIN = 2
const DECEL = 7.5
const START_MU = 0.85

export function lineLat(T: Track, s: number): number {
  return clamp(T.grooveLat(s), T.LINE_MIN, T.LINE_MAX)
}

/** How far through a turn `s` is (0 at entry, 1 at exit), or -1 on a straight. */
function turnPart(T: Track, s: number): number {
  s = mod(s, T.P)
  if (s >= T.L && s < T.L + T.TURN) return (s - T.L) / T.TURN
  if (s >= 2 * T.L + T.TURN) return (s - 2 * T.L - T.TURN) / T.TURN
  return -1
}

function lineRadius(T: Track, s: number): number {
  s = mod(s, T.P)
  const inTurn = (s >= T.L && s < T.L + T.TURN) || s >= 2 * T.L + T.TURN
  return inTurn ? T.R + lineLat(T, s) : Infinity
}

export function newRailDriver(T: Track): RailDriver {
  const n = Math.ceil(T.P / BIN), grip = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const s = i * BIN, t = Math.tan(T.bankAt(s)), r = lineRadius(T, s)
    grip[i] = Number.isFinite(r) ? Math.sqrt((T.cfg.g * r * (START_MU + t)) / (1 - START_MU * t)) : 80
  }
  const d: RailDriver = { bin: BIN, grip, lo: new Float64Array(n), hi: new Float64Array(n).fill(Infinity), plan: new Float64Array(n), beta: new Float64Array(n), err: new Float64Array(n), wall: new Uint8Array(n), laps: 0, thr: 0, stuck: 0, incident: false }
  replan(d)
  return d
}

function replan(d: RailDriver): void {
  const n = d.grip.length
  d.plan.set(d.grip)
  for (let pass = 0; pass < 2; pass++) for (let k = 2 * n; k >= 0; k--) {
    const i = k % n, j = (i + 1) % n
    d.plan[i] = Math.min(d.plan[i], Math.sqrt(d.plan[j] * d.plan[j] + 2 * DECEL * d.bin))
  }
}

/** Forget what the driver learned about the limit (keeps its speeds as a starting point), e.g. after a setup change. */
export function railDriverRelearn(d: RailDriver): void {
  d.lo.fill(0)
  d.hi.fill(Infinity)
}

/** Ends a lap: slows the corners where the car slid, pushed wide or touched the wall, speeds up the clean ones. */
export function railDriverLap(d: RailDriver, T: Track): void {
  const n = d.grip.length, back = Math.round(24 / d.bin)
  const slow = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (d.beta[i] > 0.09 || d.err[i] > 1.5 || d.wall[i]) for (let k = 0; k <= back; k++) slow[(i - k + n) % n] = 1
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(lineRadius(T, i * d.bin))) continue
    if (d.incident) {
      d.hi[i] = Math.min(d.hi[i], d.grip[i])
      d.grip[i] *= 0.96
      d.lo[i] = Math.min(d.lo[i], d.grip[i])
      continue
    }
    const g = d.grip[i]
    if (slow[i]) {
      d.hi[i] = Math.min(d.hi[i], g)
      d.lo[i] = Math.min(d.lo[i], g * 0.985)
      d.grip[i] = d.lo[i] > 0 ? d.lo[i] : g * 0.97
    } else {
      d.lo[i] = Math.max(d.lo[i], g)
      d.grip[i] = Number.isFinite(d.hi[i]) ? (d.hi[i] - d.lo[i] > 0.004 * d.lo[i] ? (d.lo[i] + d.hi[i]) / 2 : d.lo[i]) : g * 1.03
    }
  }
  for (let i = 0; i < n; i++) {
    const a = d.grip[(i - 1 + n) % n], b = d.grip[(i + 1) % n]
    if (Number.isFinite(lineRadius(T, i * d.bin))) d.grip[i] = Math.min(d.grip[i], (a + b) / 2 + 0.6)
  }
  d.beta.fill(0)
  d.err.fill(0)
  d.wall.fill(0)
  d.incident = false
  d.laps++
  replan(d)
}

export function railDriverControls(w: World, c: SimCar, d: RailDriver): Controls {
  const T = w.track, st = c.rail as RailState, v = st.veh
  st.direct = true
  const sh = Math.sin(c.h), ch = Math.cos(c.h)
  const u = c.vx * sh + c.vz * ch, vl = c.vx * ch - c.vz * sh
  const s = c.tp.s, i = Math.floor(mod(s, T.P) / d.bin) % d.grip.length
  const beta = Math.atan2(vl, Math.max(Math.abs(u), 3))
  const err = c.tp.lat - lineLat(T, s)
  d.beta[i] = Math.max(d.beta[i], Math.abs(beta))
  const part = turnPart(T, s)
  if (part >= 0 && part < 0.65) d.err[i] = Math.max(d.err[i], err)
  if (c.tp.lat > T.HW - 1.5) d.wall[i] = 1

  const Ld = clamp(6 + 0.45 * Math.abs(u), 8, 28)
  const cn = T.center(s + Ld), lat = lineLat(T, s + Ld)
  const px = cn.x + cn.nx * lat - c.x, pz = cn.z + cn.nz * lat - c.z
  const dx = px * sh + pz * ch, dy = px * ch - pz * sh
  const kappa = (2 * dy) / Math.max(1, dx * dx + dy * dy)
  const um = Math.max(Math.abs(u), 8)
  const excess = st.r - um * kappa
  const slide = Math.max(0, Math.abs(beta) - 0.05) * Math.sign(beta)
  const delta = Math.atan(v.wheelbase * kappa) - ((excess > 0 ? 1.1 : 0.35) * v.wheelbase / um) * excess + 0.2 * beta + 1.1 * slide
  let steer = clamp(delta / railSteerMax(w.cfg, u), -1, 1)
  const frontAlpha = (Math.abs(st.alpha[0]) + Math.abs(st.alpha[1])) / 2
  if (frontAlpha > 0.105 && Math.abs(steer) > Math.abs(c.steer) && Math.sign(steer) === Math.sign(c.steer)) steer = c.steer

  const ahead = Math.floor(mod(s + Math.max(2, u * 0.3), T.P) / d.bin) % d.plan.length
  const vt = d.plan[ahead], e = vt - u
  let thr = e > 0.8 ? 1 : e > -0.4 ? clamp(0.35 + e * 0.8, 0, 1) : 0
  let brk = e < -0.4 ? clamp(-(e + 0.4) * 0.35, 0, 1) : 0
  const spin = Math.max(st.slipR[0], st.slipR[1])
  if (spin > 0.1) thr *= clamp(1 - (spin - 0.1) * 5, 0.3, 1)
  const loose = Math.max(excess - 0.05, Math.abs(beta) - 0.06)
  if (loose > 0 && u > 8) thr *= clamp(1 - loose * 12, 0.25, 1)
  const rearAlpha = Math.max(Math.abs(st.alpha[2]), Math.abs(st.alpha[3]))
  if (rearAlpha > 0.065 && u > 8) thr *= clamp(1 - (rearAlpha - 0.065) * 15, 0.3, 1)
  if (excess < -0.08 && err > 1 && part >= 0 && part < 0.65) thr *= 0.6
  const here = T.center(s), out = c.vx * here.nx + c.vz * here.nz
  const pushing = Math.min(st.use[0], st.use[1]) > 0.97 && excess < -0.03
  if (out > 0.3 && pushing) {
    const tWall = (T.HW - 1.2 - c.tp.lat) / out
    if (tWall < 1.2) {
      thr = Math.min(thr, clamp(tWall - 0.4, 0, 1))
      if (tWall < 0.8 && Math.abs(beta) < 0.12) brk = Math.max(brk, clamp((0.8 - tWall) * 0.6, 0, 0.45))
    }
  }
  if (Math.abs(beta) > 0.35) {
    thr = Math.min(thr, 0.35)
    brk = 0
  }
  if (brk > 0 && Math.min(st.use[0], st.use[1]) > 0.99) brk *= 0.6
  if (u < 5) brk = 0
  d.thr = thr > d.thr ? Math.min(thr, d.thr + 2.5 / 120) : thr
  d.stuck = Math.abs(u) < 2 ? d.stuck + 1 / 120 : 0
  return { thr: d.thr, brk, steer }
}

/** Puts a stopped or spun car back on the groove where it is, rolling at 10 m/s; the lap it was on doesn't count. */
export function railRecover(w: World, c: SimCar, d?: RailDriver): void {
  const T = w.track, st = c.rail as RailState, s = c.tp.s
  place(w, c, s, lineLat(T, s))
  c.vx = Math.sin(c.h) * 10
  c.vz = Math.cos(c.h) * 10
  c.rail = { ...newRailState(st.veh, T), peak: st.peak, direct: st.direct }
  c.rail.omega = 10 / ((st.veh.rollout[2] + st.veh.rollout[3]) / (4 * Math.PI))
  c.steer = 0
  c.steerV = 0
  c.lapDirty = true
  if (d) {
    d.stuck = 0
    d.thr = 0
    d.incident = true
  }
}
