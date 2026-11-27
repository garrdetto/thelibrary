import type { Controls, SimCar } from './car'
import { clamp, lerp, mod } from './math'
import type { RailState } from './railDynamics'
import { newRailState, railSteerMax } from './railDynamics'
import { place } from './physics'
import type { Track } from './track'
import type { World } from './world'

/**
 * The track test's driver, run like a real oval racer through four phases each end: on the straight it holds the
 * outside wall flat out; at its braking marker it stands on the brakes with the wheels straight and trails off the
 * pedal as it turns down across the track to the apron; at the apex (the middle of the turn, inside tires on the
 * edge of the apron) it is off the brake on light maintenance throttle; and on exit it squeezes the throttle back to
 * full as it unwinds the wheel, letting the car run back out to the wall. The braking markers and corner speeds come
 * from a speed plan it learns lap by lap: where the car slides, pushes off the line or touches the wall it slows that
 * corner a little, and where it had grip left it carries more speed. It never reads the setup, so a looser or tighter
 * car shows up as a different line, more sliding and a different lap time, the way a test driver feels it. Fully
 * deterministic.
 */
export type RailDriver = {
  bin: number
  grip: Float64Array
  /** Fastest clean and slowest failed corner speed found so far per stretch (0 / Infinity until known). */
  lo: Float64Array
  hi: Float64Array
  plan: Float64Array
  /** Curvature of the driving line (1/m, + = left) and its length per stretch. */
  kappa: Float64Array
  ds: Float64Array
  /** Corner phase of each stretch (index into PHASES). */
  phase: Uint8Array
  beta: Float64Array
  err: Float64Array
  wall: Uint8Array
  laps: number
  /** The driver's feet: throttle squeezes in, comes off fast; brake goes on hard and trails off. */
  thr: number
  brk: number
  /** Most steering used in this corner, for unwinding it against the throttle on exit. */
  lock: number
  /** Peak steering of the last corner: the brake is trailed off against it as the wheel goes in. */
  peak: number
  /** Seconds spent stopped or barely moving; past 2 s the page puts the car back on the groove. */
  stuck: number
  /** Set when the car had to be put back on track this lap: every corner backs off. */
  incident: boolean
}

export type RailPhase = 'straight' | 'entry' | 'apex' | 'exit'
const PHASES: readonly RailPhase[] = ['straight', 'entry', 'apex', 'exit']

const BIN = 2
/** Straight-line braking the plan counts on (m/s²) and the deceleration a full brake pedal gives. */
const DECEL = 10
const BRAKE_FULL = 11
/** Most brake the driver uses (wheels straight) and the maintenance throttle at the apex. */
const BRAKE_PEAK = 0.9
const APEX_THR = 0.15
const START_MU = 0.85
const TURNING = 0.004

/** Distance from the outside wall and the inside edge (apron) to the car's centre on the line, m. */
const WALL_GAP = 1.25
const APRON_GAP = 1.0

/** Half the stretch held on the apron through the middle of each turn, as a share of the turn. */
const APEX_SPAN = 0.1

type Ends = { entry: number; exit: number }

/** How far down each straight the line leaves the wall before a turn (entry) and gets back to it after (exit), m. */
function ends(T: Track): Ends {
  const entry = Math.min((0.5 - APEX_SPAN) * T.TURN, 0.3 * T.L)
  return { entry, exit: Math.min(entry * 1.25, 0.32 * T.L) }
}

/** Signed distance from the middle of the nearer turn (- before it), m. */
function fromApex(T: Track, s: number): number {
  const a = mod(s - (T.T1 + T.TURN / 2) + T.P / 2, T.P) - T.P / 2, b = mod(s - (T.T2 + T.TURN / 2) + T.P / 2, T.P) - T.P / 2
  return Math.abs(a) < Math.abs(b) ? a : b
}

const smoother = (x: number): number => x * x * x * (x * (6 * x - 15) + 10)

/**
 * The driving line: by the outside wall on the straights, turning down off it before the turn, on the apron through the
 * middle of the turn and back up to the wall down the next straight. Its radius tightens toward the apex and opens up
 * again on exit, so the driver trails the brake in and squeezes the throttle out.
 */
export function lineLat(T: Track, s: number): number {
  const e = ends(T), d = fromApex(T, s), a = APEX_SPAN * T.TURN, b = T.TURN / 2 + (d < 0 ? e.entry : e.exit)
  return lerp(-T.HW + APRON_GAP, T.HW - WALL_GAP, smoother(clamp((Math.abs(d) - a) / (b - a), 0, 1)))
}

/** Which of the four phases of a corner the driver is in at `s` (`entry` covers the braking zone too). */
export function railPhase(T: Track, s: number): RailPhase {
  const e = ends(T), d = fromApex(T, s)
  if (d < -(T.TURN / 2 + e.entry)) return 'straight'
  if (d < -APEX_SPAN * T.TURN) return 'entry'
  if (d < APEX_SPAN * T.TURN) return 'apex'
  return d < T.TURN / 2 + e.exit ? 'exit' : 'straight'
}

function linePoint(T: Track, s: number): [number, number] {
  const c = T.center(s), l = lineLat(T, s)
  return [c.x + c.nx * l, c.z + c.nz * l]
}

function lineShape(T: Track, s: number): { kappa: number; ds: number } {
  const h = BIN / 2, [ax, az] = linePoint(T, s - h), [bx, bz] = linePoint(T, s), [cx, cz] = linePoint(T, s + h)
  const ux = bx - ax, uz = bz - az, vx = cx - bx, vz = cz - bz
  const la = Math.hypot(ux, uz), lb = Math.hypot(vx, vz), cross = ux * vz - uz * vx
  const turn = Math.atan2(cross, ux * vx + uz * vz)
  return { kappa: -turn / Math.max(1e-6, (la + lb) / 2), ds: la + lb }
}

export function newRailDriver(T: Track): RailDriver {
  const n = Math.ceil(T.P / BIN), grip = new Float64Array(n), kappa = new Float64Array(n), ds = new Float64Array(n), phase = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const s = i * BIN, t = Math.tan(T.bankAt(s)), shape = lineShape(T, s)
    phase[i] = PHASES.indexOf(railPhase(T, s))
    kappa[i] = shape.kappa
    ds[i] = shape.ds
    const k = Math.abs(shape.kappa)
    grip[i] = k > TURNING ? Math.min(80, Math.sqrt((T.cfg.g * (START_MU + t)) / ((1 - START_MU * t) * k))) : 80
  }
  const d: RailDriver = { bin: BIN, grip, lo: new Float64Array(n), hi: new Float64Array(n).fill(Infinity), plan: new Float64Array(n), kappa, ds, phase, beta: new Float64Array(n), err: new Float64Array(n), wall: new Uint8Array(n), laps: 0, thr: 0, brk: 0, lock: 0, peak: 0, stuck: 0, incident: false }
  replan(d)
  return d
}

/** Speed plan: each stretch's corner speed, reached by braking that eases off (trail braking) as the car loads up in the turn. */
function replan(d: RailDriver): void {
  const n = d.grip.length
  d.plan.set(d.grip)
  const brakeBack = () => {
    for (let k = 2 * n; k >= 0; k--) {
      const i = k % n, j = (i + 1) % n, used = (d.plan[j] / d.grip[j]) ** 2
      const a = DECEL * Math.sqrt(Math.max(0.04, 1 - used * used * (Math.abs(d.kappa[j]) > TURNING ? 1 : 0)))
      d.plan[i] = Math.min(d.plan[i], Math.sqrt(d.plan[j] * d.plan[j] + 2 * a * d.ds[i]))
    }
  }
  brakeBack()
  let start = 0
  while (d.phase[start] === 1 || d.phase[start] === 2) start++
  for (let k = 1, apex = Infinity; k <= n; k++) {
    const i = (start + k) % n, p = d.phase[i], prev = (i - 1 + n) % n
    if (p !== 1 && p !== 2) continue
    if (d.phase[prev] !== 1 && d.phase[prev] !== 2) {
      apex = Infinity
      for (let j = i; d.phase[j] === 1 || d.phase[j] === 2; j = (j + 1) % n) if (d.phase[j] === 2) apex = Math.min(apex, d.plan[j])
      continue
    }
    d.plan[i] = Math.min(d.plan[i], Math.max(d.plan[prev], apex))
  }
  brakeBack()
}

/** Forget what the driver learned about the limit (keeps its speeds as a starting point), e.g. after a setup change. */
export function railDriverRelearn(d: RailDriver): void {
  d.lo.fill(0)
  d.hi.fill(Infinity)
}

/** Ends a lap: slows the corners where the car slid, pushed wide or touched the wall, speeds up the clean ones. */
export function railDriverLap(d: RailDriver, _T?: Track): void {
  const n = d.grip.length, back = Math.round(24 / d.bin)
  const turning = (i: number) => Math.abs(d.kappa[i]) > TURNING
  const slow = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!(d.beta[i] > 0.09 || d.err[i] > 1.5 || d.wall[i])) continue
    const into = d.phase[i] === 1 || d.phase[i] === 2
    for (let k = 0; k < n; k++) {
      const j = (i - k + n) % n
      if (k > back && !(into && (d.phase[j] === 1 || d.phase[j] === 2))) break
      slow[j] = 1
    }
  }
  for (let i = 0; i < n; i++) {
    if (!turning(i)) continue
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
      d.grip[i] = Number.isFinite(d.hi[i]) ? (d.hi[i] - d.lo[i] > 0.004 * d.lo[i] ? (d.lo[i] + d.hi[i]) / 2 : d.lo[i]) : Math.min(80, g * 1.03)
    }
  }
  for (let i = 0; i < n; i++) {
    const a = d.grip[(i - 1 + n) % n], b = d.grip[(i + 1) % n]
    if (turning(i)) d.grip[i] = Math.min(d.grip[i], (a + b) / 2 + 0.6)
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
  const s = c.tp.s, n = d.grip.length, i = Math.floor(mod(s, T.P) / d.bin) % n
  const beta = Math.atan2(vl, Math.max(Math.abs(u), 3))
  const rearShare = v.scales.rear > 1 ? v.scales.rear / 100 : v.scales.rear
  const slip = Math.max(0, Math.abs(beta) - Math.atan(v.wheelbase * (1 - rearShare) * Math.abs(d.kappa[i]))) * Math.sign(beta)
  const err = c.tp.lat - lineLat(T, s)
  const phase = railPhase(T, s)
  d.beta[i] = Math.max(d.beta[i], Math.abs(slip))
  if (phase === 'entry' || phase === 'apex') d.err[i] = Math.max(d.err[i], err)
  if (c.tp.lat > T.HW - 0.95) d.wall[i] = 1

  const Ld = clamp(6 + 0.45 * Math.abs(u), 8, 28)
  const cn = T.center(s + Ld)
  let lat = lineLat(T, s + Ld)
  if (phase === 'exit' && err > 0) {
    const left = Math.max(Ld, T.TURN / 2 + ends(T).exit - fromApex(T, s))
    lat = Math.max(lat, lerp(c.tp.lat, T.HW - WALL_GAP, Ld / left))
  }
  const px = cn.x + cn.nx * lat - c.x, pz = cn.z + cn.nz * lat - c.z
  const dx = px * sh + pz * ch, dy = px * ch - pz * sh
  const kappa = (2 * dy) / Math.max(1, dx * dx + dy * dy)
  const um = Math.max(Math.abs(u), 8)
  const excess = st.r - um * kappa
  const slide = Math.max(0, Math.abs(slip) - 0.05) * Math.sign(slip)
  const delta = Math.atan(v.wheelbase * kappa) - ((excess > 0 ? 1.1 : 0.35) * v.wheelbase / um) * excess + 0.2 * beta + 1.1 * slide
  let steer = clamp(delta / railSteerMax(w.cfg, u), -1, 1)
  const frontAlpha = (Math.abs(st.alpha[0]) + Math.abs(st.alpha[1])) / 2
  if (frontAlpha > 0.105 && Math.abs(steer) > Math.abs(c.steer) && Math.sign(steer) === Math.sign(c.steer)) steer = c.steer
  if (phase === 'exit' && c.steer > 0 && steer < c.steer && Math.abs(slip) < 0.06) steer = Math.max(steer, c.steer - 1.5 / 120)

  const look = Math.max(1, Math.round((Math.max(4, u * 0.25)) / d.bin)), ahead = (i + look) % n
  let dist = 0
  for (let k = 0; k < look; k++) dist += d.ds[(i + k) % n]
  const here = d.plan[i], vt = d.plan[ahead]
  const need = (u * u - vt * vt) / (2 * Math.max(1, dist)) + 1.2 * (u - here)
  let thr: number, brk = 0
  if (phase === 'entry' || phase === 'apex') d.lock = Math.max(d.lock, Math.abs(steer))
  if (need > 0.6 && (phase === 'straight' || phase === 'entry' || u > here + 0.4)) {
    thr = 0
    brk = clamp(need / BRAKE_FULL, 0, BRAKE_PEAK)
    if (phase !== 'straight' && d.peak > 0.02) brk = Math.min(brk, BRAKE_PEAK * clamp(1.1 - Math.abs(steer) / d.peak, 0.2, 1))
  } else if (phase === 'straight') {
    thr = 1
  } else if (phase === 'entry' || phase === 'apex') {
    thr = u < vt - 1.5 ? clamp(APEX_THR + (vt - 1.5 - u) * 0.3, APEX_THR, 1) : u > here + 0.2 ? 0 : APEX_THR
  } else {
    const unwind = d.lock > 0.02 ? clamp(1 - Math.abs(steer) / d.lock, 0, 1) : 1
    const out = clamp((fromApex(T, s) - 0.08 * T.TURN) / (0.42 * T.TURN + ends(T).exit), 0, 1)
    thr = u > vt + 0.4 ? APEX_THR : APEX_THR + (1 - APEX_THR) * Math.max(unwind, out)
  }
  if (phase === 'straight' && d.lock > 0) {
    d.peak = d.lock
    d.lock = 0
  }

  const flat = phase === 'straight' && thr === 1 && Math.abs(slip) < 0.06
  const spin = flat ? 0 : Math.max(st.slipR[0], st.slipR[1])
  if (spin > 0.1) thr *= clamp(1 - (spin - 0.1) * 5, 0.3, 1)
  const loose = Math.max(excess - 0.05, Math.abs(slip) - 0.06)
  if (!flat && loose > 0 && u > 8) thr *= clamp(1 - loose * 12, 0.25, 1)
  const rearAlpha = Math.max(Math.abs(st.alpha[2]), Math.abs(st.alpha[3]))
  if (!flat && rearAlpha > 0.065 && u > 8) thr *= clamp(1 - (rearAlpha - 0.065) * 15, 0.3, 1)
  if (excess < -0.08 && err > 1 && (phase === 'entry' || phase === 'apex')) thr *= 0.6
  const cp = T.center(s), outward = c.vx * cp.nx + c.vz * cp.nz
  const pushing = Math.min(st.use[0], st.use[1]) > 0.97 && excess < -0.03
  if (outward > 0.3 && pushing) {
    const tWall = (T.HW - 1.2 - c.tp.lat) / outward
    if (tWall < 1.2) {
      thr = Math.min(thr, clamp(tWall - 0.4, 0, 1))
      if (tWall < 0.8 && Math.abs(beta) < 0.12) brk = Math.max(brk, clamp((0.8 - tWall) * 0.6, 0, 0.45))
    }
  }
  if (Math.abs(beta) > 0.35) {
    thr = Math.min(thr, 0.35)
    brk = 0
  }
  if (brk > 0 && Math.min(st.use[0], st.use[1]) > 0.99) brk *= 0.75
  if (u < 5) brk = 0
  d.thr = thr > d.thr ? Math.min(thr, d.thr + 4 / 120) : thr
  d.brk = brk > d.brk ? Math.min(brk, d.brk + 8 / 120) : brk
  d.stuck = Math.abs(u) < 2 ? d.stuck + 1 / 120 : 0
  return { thr: d.thr, brk: d.brk, steer }
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
    d.brk = 0
    d.lock = 0
    d.incident = true
  }
}
