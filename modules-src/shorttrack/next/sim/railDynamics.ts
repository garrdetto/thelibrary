import type { Controls, SimCar } from './car'
import { clamp } from './math'
import type { Quad, RailVehicle } from './railCar'
import { lookup } from './railCar'
import type { Track, Vec3 } from './track'
import type { World } from './world'

/**
 * The Setup Lab's car on the track test: a planar rigid body on the banked surface (as `dynamics.ts`) carrying a sprung
 * body with heave, pitch and separate front and rear roll joined by the frame's twist stiffness. Every corner reads its
 * spring, bump spring and motion ratio from the Lab (`RailVehicle.spring`), so ride height, travel to the bump springs,
 * bottoming and lifting a wheel come from the setup sheet. Load moves through roll centres, jacking, anti-dive and
 * anti-squat from the Lab's geometry; the fronts get camber and bump steer from their own travel and the rear axle
 * steers with body roll. The rears are on a spool whose stagger turns the car, the tires lose grip with load (the Lab's
 * tire), and the splitter makes downforce that grows as the nose drops until it scrapes the track.
 */

export type RailState = {
  veh: RailVehicle
  /** Sprung body relative to the road: heave (m, + up), pitch (rad, + nose up), front and rear roll (rad, + right side down). */
  z: number; zv: number; th: number; thv: number; pf: number; pfv: number; pr: number; prv: number
  /** Yaw rate (rad/s, + = left) and the spool's spin (rad/s). */
  r: number
  omega: number
  alpha: Quad<number>
  /** Tire loads (N), wheel travel (m, + = bump), share of grip in use, tire forces in the wheel frame (N). */
  fz: Quad<number>
  travel: Quad<number>
  travelV: Quad<number>
  use: Quad<number>
  fx: Quad<number>
  fy: Quad<number>
  /** Bump springs touching and suspension at the end of its travel, per corner. */
  bump: Quad<boolean>
  stop: Quad<boolean>
  /** Clearance of each `veh.clearance` point (m) and whether it is on the track. */
  clear: number[]
  scrape: boolean[]
  /** Road wheel steer (rad, + left) front left/right, rear axle steer (rad), ground camber (°) LF/RF. */
  steerL: number; steerR: number; steerRear: number
  camberG: [number, number]
  /** Long and lateral acceleration in the road plane (m/s²), effective normal acceleration (m/s²). */
  ax: number; ay: number; gn: number
  fb: number
  avOut: number
  rpm: number
  ratio: number
  slipR: [number, number]
  downF: number; downR: number
  /** True while the track test's driver has the wheel: steering follows its hands (rate-limited) instead of the keys' ramp. */
  direct: boolean
  /** Front and rear grip trim from the setup's handling against the baseline (1 = none), and the phase weights behind it. */
  trimF: number; trimR: number
  phaseW: { entry: number; center: number; exit: number }
  /** Running peaks the track page reads and clears. */
  peak: { bottom: number; bumpT: number; liftT: number; noseLift: number; minClear: number }
}

const G = 9.81, RHO = 1.2
/** Grip taken off the overloaded end per balance point of handling change (tight: fronts, loose: rears), and the most. */
export const HANDLING_GAIN = 0.025
const HANDLING_MAX = 0.4

/**
 * How the setup's handling change acts right now: the corner phase comes from the pedals (braking = entry, throttle
 * past 0.3 = exit, between = center) and only counts while the car is cornering. A tight phase takes grip off the
 * fronts, a loose one off the rears, so the baseline setup stays balanced at the limit.
 */
export function handlingTrim(h: RailVehicle['handling'], thr: number, brk: number, ay: number): { f: number; r: number; w: { entry: number; center: number; exit: number } } {
  const entry = clamp(brk / 0.15, 0, 1), exit = clamp((thr - 0.3) / 0.4, 0, 1) * (1 - entry), center = Math.max(0, 1 - entry - exit)
  const w = { entry, center, exit }
  if (!h) return { f: 1, r: 1, w }
  const corner = clamp((Math.abs(ay) - 2) / 5, 0, 1)
  const bal = (h.entry * entry + h.center * center + h.exit * exit) * corner * HANDLING_GAIN
  return { f: 1 - clamp(bal, 0, HANDLING_MAX), r: 1 - clamp(-bal, 0, HANDLING_MAX), w }
}
const ENGINE = { peak: 720, peakRpm: 5600, limit: 7800, idle: 2600, drag: 55, eff: 0.9, inertia: 0.22 }
const AERO = { cdA: 0.82, rearClA: 0.55, frontClA: 0.26, groundGain: 1.3, groundH: 0.1, rr: 0.012 }
const TIRE = { grip: 1.12, C: 1.6, B: Math.tan(Math.PI / 3.2), alphaPk: 0.1, kappaPk: 0.14, sigma: 0.45, campOpt: 1.5, campK: 0.006 }
const STOP = { bump: 0.0889, k: 3.0e6, droop: -0.115, ground: 1.6e6, groundC: 2.5e4, scrapeMu: 0.45 }
const DAMP = 0.42
const SUB = 4
const WHEEL_I = 1.2

/** Road wheel lock for full steering input at speed `u` (rad). */
export function railSteerMax(cfg: { steerLow: number }, u: number): number {
  return (0.42 / (1 + Math.abs(u) * 0.055)) * (cfg.steerLow / 0.47)
}

const magic = (x: number): number => Math.sin(TIRE.C * Math.atan(TIRE.B * x))

/** The Lab's tire: grip falls as the load goes up (µ = 1.5 − 0.0004·lb, never below 0.6). */
export const tireMu = (fzN: number): number => Math.max(0.6, 1.5 - 0.0004 * (fzN / 4.4482216))

/** Overall drive ratio for a track: the engine reaches the limiter near the end of the straights. */
export function railRatio(T: Track, veh: RailVehicle): number {
  const t = Math.tan((T.cfg.turnBank * Math.PI) / 180), mu = 1.1
  const vc = Math.sqrt((G * T.R * (mu + t)) / (1 - mu * t))
  const vEnd = Math.min(60, Math.sqrt(vc * vc + 2 * 4.5 * (T.L + T.TURN * 0.35)))
  const r = (veh.rollout[2] + veh.rollout[3]) / (4 * Math.PI)
  return clamp(((ENGINE.limit * 0.96 * 2 * Math.PI) / 60 / vEnd) * r, 3.2, 9)
}

function engineTorque(rpm: number): number {
  const x = Math.max(rpm, ENGINE.idle)
  if (x >= ENGINE.limit) return 0
  const k = (x - ENGINE.peakRpm) / 3200
  return ENGINE.peak * (1 - 0.32 * k * k)
}

export function newRailState(veh: RailVehicle, T: Track): RailState {
  const q = <V>(v: V): Quad<V> => [v, v, v, v]
  return {
    veh, z: 0, zv: 0, th: 0, thv: 0, pf: 0, pfv: 0, pr: 0, prv: 0, r: 0, omega: 0,
    alpha: q(0), fz: [...veh.staticLoad] as Quad<number>, travel: q(0), travelV: q(0), use: q(0), fx: q(0), fy: q(0),
    bump: q(false), stop: q(false), clear: veh.clearance.map((p) => p.h), scrape: veh.clearance.map(() => false),
    steerL: 0, steerR: 0, steerRear: 0, camberG: [lookup(veh.camber[0], 0), lookup(veh.camber[1], 0)],
    ax: 0, ay: 0, gn: G, fb: 0, avOut: 0, rpm: ENGINE.idle, ratio: railRatio(T, veh), slipR: [0, 0], downF: 0, downR: 0,
    peak: { bottom: 0, bumpT: 0, liftT: 0, noseLift: 0, minClear: Infinity }, direct: false,
    trimF: 1, trimR: 1, phaseW: { entry: 0, center: 0, exit: 0 },
  }
}

type Body = {
  ms: number; msF: number; msR: number; ixF: number; ixR: number; iyy: number; iz: number; aS: number
  s0: Quad<number>; damp: Quad<number>; xF: number; xR: number; sb: number; rt: number
}

const bodyCache = new WeakMap<RailVehicle, Body>()

function bodyOf(v: RailVehicle): Body {
  let b = bodyCache.get(v)
  if (b) return b
  const ms = v.mass - v.unsprung[0] - v.unsprung[1]
  const sl = v.staticLoad, Uf = v.unsprung[0] * G, Ur = v.unsprung[1] * G
  const rS = sl[2] + sl[3] - Ur, rD = sl[3] - sl[2], sb = v.springY[2] - v.springY[3], lever = v.trackR / sb
  const s0: Quad<number> = [sl[0] - Uf / 2, sl[1] - Uf / 2, (rS - rD * lever) / 2, (rS + rD * lever) / 2]
  const xF = (v.tires[0][0] + v.tires[1][0]) / 2, xR = (v.tires[2][0] + v.tires[3][0]) / 2
  const rearShare = (sl[2] + sl[3] - Ur) / (sl[0] + sl[1] + sl[2] + sl[3] - Uf - Ur)
  const damp = s0.map((f, i) => {
    const k = Math.max(5e3, (lookup(v.spring[i], 0.005) - lookup(v.spring[i], -0.005)) / 0.01)
    return 2 * DAMP * Math.sqrt(k * Math.max(50, f / G))
  }) as Quad<number>
  const ixx = ms * 0.3
  b = {
    ms, msF: ms * (1 - rearShare), msR: ms * rearShare, ixF: ixx * (1 - rearShare), ixR: ixx * rearShare, iyy: ms * 1.25, iz: v.mass * 1.5, aS: rearShare,
    s0, damp, xF, xR, sb, rt: (v.rollout[0] + v.rollout[3]) / (4 * Math.PI),
  }
  bodyCache.set(v, b)
  return b
}

const nrm = { x: 0, y: 1, z: 0 } as Vec3

export function stepRailCar(w: World, c: SimCar, dt: number, ctl: Controls): void {
  const st = c.rail as RailState, CFG = w.cfg, T = w.track
  const v = st.veh, B = bodyOf(v)
  st.r += (c.av - st.avOut) * 0.35
  const tgt = clamp(ctl.steer, -1, 1)
  if (st.direct) {
    c.steer = clamp(c.steer + clamp(tgt - c.steer, -4 * dt, 4 * dt), -1, 1)
    c.steerV = 0
  } else {
    const growing = Math.abs(tgt) > Math.abs(c.steer) && (Math.sign(tgt) === Math.sign(c.steer) || c.steer === 0)
    c.steerV = (c.steerV || 0) + ((tgt - c.steer) * (growing ? CFG.steerRampIn : CFG.steerRampOut) - (c.steerV || 0)) * Math.min(1, dt * CFG.steerDamp)
    c.steer = clamp(c.steer + c.steerV * dt, -1, 1)
  }
  const thr = clamp(typeof ctl.thr === 'number' ? ctl.thr : ctl.thr ? 1 : 0, 0, 1)
  const brk = clamp(typeof ctl.brk === 'number' ? ctl.brk : ctl.brk ? 1 : 0, 0, 1)
  c.thr = thr > 0.05 ? 1 : 0
  c.brk = brk > 0.05 ? 1 : 0

  const tp = c.tp, apron = tp.lat < -T.HW
  T.normalAt(tp.s, tp.lat, nrm)
  const nh = Math.hypot(nrm.x, nrm.z), cosT = Math.max(0.5, nrm.y), sinT = Math.min(0.87, nh), tanT = sinT / cosT
  const bx = nh > 1e-6 ? nrm.x / nh : 0, bz = nh > 1e-6 ? nrm.z / nh : 0
  const surf = apron ? CFG.apronGrip / CFG.grip : 1
  const gripDmg = Math.max(0.8, 1 - 0.0012 * (c.dmg.l + c.dmg.rt) - 0.0006 * (c.dmg.f + c.dmg.r))

  const speed0 = Math.hypot(c.vx, c.vz), cn = T.center(tp.s)
  const along = c.vx * cn.tx + c.vz * cn.tz, across = c.vx * cn.nx + c.vz * cn.nz
  const look = Math.max(0.03, Math.min(0.08, 2 / Math.max(speed0, 1)))
  const ds = along * look, dl = across * look
  const hA = T.heightAt(tp.s + ds, tp.lat + dl), h0 = T.heightAt(tp.s, tp.lat), hB = T.heightAt(tp.s - ds, tp.lat - dl)
  const aVert = clamp((hA - 2 * h0 + hB) / (look * look), -12, 12)

  const trim = handlingTrim(v.handling, thr, brk, st.ay)
  st.trimF = trim.f
  st.trimR = trim.r
  st.phaseW = trim.w
  const h = dt / SUB
  for (let k = 0; k < SUB; k++) subStep(w, c, st, v, B, h, thr, brk, { surf: surf * gripDmg, cosT, sinT, tanT, bx, bz, aVert })

  const sh2 = Math.sin(c.h), ch2 = Math.cos(c.h), L = v.wheelbase
  c.vf = c.vx * sh2 + c.vz * ch2
  const delta = (st.steerL + st.steerR) / 2
  c.av = st.r - (c.vf * Math.tan(delta)) / L
  st.avOut = c.av
  const slide = Math.max(...st.alpha.map(Math.abs)) * Math.max(0, c.vf)
  c.slip = slide + Math.max(0, Math.abs(st.slipR[0]) + Math.abs(st.slipR[1]) - 0.3) * 8 + (c.brk && c.vf > 20 ? 2 : 0)
  c.tp = T.toTrack(c.x, c.z)
}

type Surf = { surf: number; cosT: number; sinT: number; tanT: number; bx: number; bz: number; aVert: number }

function subStep(w: World, c: SimCar, st: RailState, v: RailVehicle, B: Body, dt: number, thr: number, brk: number, S: Surf): void {
  const CFG = w.cfg
  const sh = Math.sin(c.h), ch = Math.cos(c.h)
  const u = c.vx * sh + c.vz * ch, vl = c.vx * ch - c.vz * sh, speed = Math.hypot(c.vx, c.vz)
  const N = Math.max(0.2 * G, (G + st.fb * S.sinT) / S.cosT)
  const gn = Math.max(0.2 * G, N + S.aVert * S.cosT)
  st.gn = gn

  const roll = (x: number) => st.pf + (st.pr - st.pf) * clamp((B.xF - x) / (B.xF - B.xR), 0, 1)
  const travel = [0, 1, 2, 3].map((i) => -(st.z + v.tires[i][0] * st.th + v.springY[i] * (i < 2 ? st.pf : st.pr))) as Quad<number>
  const travelV = [0, 1, 2, 3].map((i) => -(st.zv + v.tires[i][0] * st.thv + v.springY[i] * (i < 2 ? st.pfv : st.prv))) as Quad<number>
  const Bf = [0, 0, 0, 0] as Quad<number>
  for (let i = 0; i < 4; i++) {
    let f = B.s0[i] + lookup(v.spring[i], travel[i]) + B.damp[i] * travelV[i]
    const stop = travel[i] > STOP.bump
    if (stop) f += STOP.k * (travel[i] - STOP.bump) + 4e4 * Math.max(0, travelV[i])
    st.stop[i] = stop
    st.bump[i] = travel[i] >= v.bumpTravel[i]
    Bf[i] = Math.max(0, f)
  }
  const dB = Bf.map((f, i) => f - B.s0[i]) as Quad<number>

  const hrcF = lookup(v.rcF, st.pf), hrcR = lookup(v.rcR, st.pr)
  const ayS = st.ay, axS = st.ax
  const fyF = st.fy[0] * Math.cos(st.steerL) + st.fx[0] * Math.sin(st.steerL) + st.fy[1] * Math.cos(st.steerR) + st.fx[1] * Math.sin(st.steerR)
  const fyR = (st.fy[2] + st.fy[3]) * Math.cos(st.steerRear) + (st.fx[2] + st.fx[3]) * Math.sin(st.steerRear)
  const fyFs = fyF - v.unsprung[0] * ayS, fyRs = fyR - v.unsprung[1] * ayS
  const jF = st.fy[0] * lookup(v.jackLF, st.pf) + st.fy[1] * lookup(v.jackRF, st.pf)
  const jR = fyRs * lookup(v.jackR, st.pr)
  const fxF = st.fx[0] + st.fx[1], fxR = st.fx[2] + st.fx[3], fxT = fxF + fxR
  const trF = (travel[0] + travel[1]) / 2, trR = (travel[2] + travel[3]) / 2
  const hOverL = v.cgH / v.wheelbase
  const gF = fxT < 0 ? lookup(v.antiDive, trF) * -fxT * hOverL : 0
  const gR = lookup(v.antiSquat, trR) * fxR * hOverL

  const noseIdx = v.clearance.length - 1
  const noseH = st.clear[noseIdx] ?? 0.1
  const ge = noseH <= 0 ? 0.6 : 1 + AERO.groundGain * clamp((AERO.groundH - noseH) / AERO.groundH, -0.4, 1)
  const q = 0.5 * RHO * speed * speed
  const dFront = q * AERO.frontClA * ge, dRear = q * AERO.rearClA
  st.downF = dFront
  st.downR = dRear

  const barSlack = v.barSlack ? -v.barPre : 0
  const barM = v.barSlack ? v.barF * Math.max(0, st.pf - barSlack) : v.barF * st.pf
  const mspF = dB[0] * v.springY[0] + dB[1] * v.springY[1], mspR = dB[2] * v.springY[2] + dB[3] * v.springY[3]

  let cz = 0, cth = 0, cpf = 0, cpr = 0, scrapeF = 0, scrapeM = 0
  const tireDefF = ((st.fz[0] + st.fz[1]) - (v.staticLoad[0] + v.staticLoad[1])) / (2 * v.tireRate)
  const tireDefR = ((st.fz[2] + st.fz[3]) - (v.staticLoad[2] + v.staticLoad[3])) / (2 * v.tireRate)
  for (let p = 0; p < v.clearance.length; p++) {
    const pt = v.clearance[p], kx = clamp((B.xF - pt.x) / (B.xF - B.xR), 0, 1.4)
    const def = tireDefF + (tireDefR - tireDefF) * kx
    const hNow = pt.h + st.z + pt.x * st.th + pt.y * roll(pt.x) - def
    const rate = st.zv + pt.x * st.thv + pt.y * (pt.x > 0 ? st.pfv : st.prv)
    st.clear[p] = hNow
    st.scrape[p] = hNow < 0
    if (hNow < 0) {
      const f = Math.max(0, -hNow * STOP.ground - rate * STOP.groundC)
      cz += f
      cth += f * pt.x
      if (pt.x > (B.xF + B.xR) / 2) cpf += f * pt.y
      else cpr += f * pt.y
      scrapeF += f * STOP.scrapeMu
      scrapeM -= f * STOP.scrapeMu * pt.y
    }
  }

  const dz = dB[0] + dB[1] + dB[2] + dB[3] + jF + jR + gF + gR - dFront - dRear + cz - B.ms * (gn - G)
  const dth = dB[0] * v.tires[0][0] + dB[1] * v.tires[1][0] + (dB[2] + dB[3]) * B.xR + (jF + gF - dFront) * B.xF + (jR + gR - dRear) * B.xR + cth + B.ms * axS * v.hs
  const MappF = B.msF * ayS * (v.hs - hrcF), MappR = B.msR * ayS * (v.hs - hrcR)
  const dpf = MappF + mspF - barM - v.twist * (st.pf - st.pr) + cpf
  const dpr = MappR + mspR - v.barR * st.pr + v.twist * (st.pf - st.pr) + cpr
  st.zv += (dz / B.ms) * dt
  st.thv += (dth / B.iyy) * dt
  st.pfv += (dpf / B.ixF) * dt
  st.prv += (dpr / B.ixR) * dt
  st.z += st.zv * dt
  st.th += st.thv * dt
  st.pf += st.pfv * dt
  st.pr += st.prv * dt

  const Uf = v.unsprung[0], Ur = v.unsprung[1]
  const dGF = (fyFs * hrcF) / v.trackF, dGR = (fyRs * hrcR) / v.trackR
  const unsF = (Uf * ayS * B.rt) / v.trackF, unsR = (Ur * ayS * B.rt) / v.trackR
  const unsX = ((Uf + Ur) * axS * B.rt) / v.wheelbase / 2
  const lever = v.trackR / B.sb
  const rS = Bf[2] + Bf[3], rD = (Bf[3] - Bf[2]) / lever
  const fz: Quad<number> = [
    Bf[0] + jF / 2 - dGF + gF / 2 - barM / v.trackF + (Uf / 2) * gn - unsF - unsX,
    Bf[1] + jF / 2 + dGF + gF / 2 + barM / v.trackF + (Uf / 2) * gn + unsF - unsX,
    (rS - rD) / 2 + jR / 2 - dGR + gR / 2 - (v.barR * st.pr) / v.trackR + (Ur / 2) * gn - unsR + unsX,
    (rS + rD) / 2 + jR / 2 + dGR + gR / 2 + (v.barR * st.pr) / v.trackR + (Ur / 2) * gn + unsR + unsX,
  ]
  for (let i = 0; i < 4; i++) fz[i] = Math.max(0, fz[i])
  st.fz = fz
  st.travel = travel
  st.travelV = travelV

  const DEG = Math.PI / 180, steerMax = railSteerMax(CFG, u)
  const delta = c.steer * steerMax
  st.steerL = delta + lookup(v.toe[0], travel[0]) * DEG
  st.steerR = delta - lookup(v.toe[1], travel[1]) * DEG
  st.steerRear = -(lookup(v.rearSteerRoll, st.pr) + lookup(v.rearSteerHeave, trR) - lookup(v.rearSteerHeave, 0)) * DEG
  st.camberG = [lookup(v.camber[0], travel[0]) - st.pf / DEG, lookup(v.camber[1], travel[1]) + st.pf / DEG]
  const lean = [st.camberG[0], -st.camberG[1], 0, 0]

  const ratio = st.ratio
  const rpm = Math.max(ENGINE.idle, (Math.abs(st.omega) * ratio * 60) / (2 * Math.PI))
  st.rpm = rpm
  const reverse = brk > 0.05 && thr < 0.05 && u < 0.6
  const drive = reverse ? -brk * 160 * ratio : thr * engineTorque(rpm) * ratio * ENGINE.eff - (1 - thr) * ENGINE.drag * ratio * Math.min(1, Math.abs(u) / 4)
  const brakeF = reverse ? 0 : brk * B.ms * 1.35 * G
  const steerI = [st.steerL, st.steerR, st.steerRear, st.steerRear]
  const caps = [0, 0, 0, 0], sa = [0, 0, 0, 0], uws = [0, 0, 0, 0], re = [0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    const px = v.tires[i][0], py = v.tires[i][1]
    const ui = u - st.r * py, vi = vl + st.r * px
    const cs = Math.cos(steerI[i]), sn = Math.sin(steerI[i])
    const uw = ui * cs + vi * sn, vw = -ui * sn + vi * cs
    const target = Math.atan2(vw, Math.max(Math.abs(uw), 2.5))
    st.alpha[i] += (target - st.alpha[i]) * Math.min(1, (Math.max(Math.abs(uw), 1) * dt) / TIRE.sigma)
    const dir = st.alpha[i] > 0 ? -1 : 1
    const camb = clamp(1 - TIRE.campK * (lean[i] * dir - TIRE.campOpt) ** 2, 0.82, 1)
    caps[i] = tireMu(fz[i]) * TIRE.grip * fz[i] * S.surf * camb * (i < 2 ? st.trimF : st.trimR)
    sa[i] = Math.tan(st.alpha[i])
    uws[i] = uw
    re[i] = v.rollout[i] / (2 * Math.PI) - 0.35 * (fz[i] / v.tireRate)
  }
  const combined = (i: number, kappa: number): [number, number] => {
    const nx = kappa / TIRE.kappaPk, ny = sa[i] / TIRE.alphaPk, rho = Math.hypot(nx, ny)
    if (rho < 1e-9) return [0, 0]
    const f = caps[i] * magic(rho)
    return [(f * nx) / rho, (-f * ny) / rho]
  }
  const den = (i: number) => Math.max(Math.abs(uws[i]), 3)
  const fx: Quad<number> = [0, 0, 0, 0], fy: Quad<number> = [0, 0, 0, 0]
  for (let i = 0; i < 2; i++) {
    const want = (brakeF * v.brakeFront) / 2 + AERO.rr * fz[i] * Math.sign(uws[i] || 1)
    const pure = combined(i, 0)
    const spare = Math.sqrt(Math.max(0, caps[i] * caps[i] - pure[1] * pure[1]))
    if (want <= 0.97 * spare || Math.abs(uws[i]) < 0.5) {
      fx[i] = -Math.sign(uws[i] || 1) * Math.min(want, spare)
      fy[i] = pure[1]
    } else {
      const lock = combined(i, -Math.sign(uws[i] || 1) * 0.6)
      fx[i] = lock[0]
      fy[i] = lock[1]
    }
  }
  const rearBrake = brakeF * (1 - v.brakeFront) * B.rt
  const Ia = WHEEL_I * 2 + ENGINE.inertia * ratio * ratio
  let torque = drive, stiff = 0
  for (let i = 2; i < 4; i++) {
    const kappa = (st.omega * re[i] - uws[i]) / den(i)
    const f = combined(i, kappa)
    const cx = (caps[i] * TIRE.B * TIRE.C) / TIRE.kappaPk
    torque -= f[0] * re[i]
    stiff += (cx * re[i] * re[i]) / den(i)
  }
  let omegaN = st.omega + (dt * torque) / (Ia + dt * stiff)
  if (rearBrake > 0) {
    const dw = (dt * rearBrake) / (Ia + dt * stiff)
    omegaN = st.omega > 0 ? Math.max(0, omegaN - dw) : Math.min(0, omegaN + dw)
  }
  st.omega = omegaN
  for (let i = 2; i < 4; i++) {
    const kappa = clamp((st.omega * re[i] - uws[i]) / den(i), -1, 2)
    st.slipR[i - 2] = kappa
    const f = combined(i, kappa)
    fx[i] = f[0] - AERO.rr * fz[i] * Math.sign(uws[i] || 0)
    fy[i] = f[1]
  }
  st.fx = fx
  st.fy = fy
  let Fx = 0, Fy = 0, Mz = 0
  for (let i = 0; i < 4; i++) {
    const cs = Math.cos(steerI[i]), sn = Math.sin(steerI[i])
    const bfx = fx[i] * cs - fy[i] * sn, bfy = fx[i] * sn + fy[i] * cs
    st.use[i] = caps[i] > 0 ? Math.hypot(fx[i], fy[i]) / caps[i] : 0
    Fx += bfx
    Fy += bfy
    Mz += v.tires[i][0] * bfy - v.tires[i][1] * bfx
  }
  if (scrapeF > 0 && speed > 0.2) {
    Fx -= scrapeF * Math.sign(u)
    Mz += scrapeM * Math.sign(u)
  }
  const m = v.mass
  const drag = q * AERO.cdA
  let ax = (sh * Fx + ch * Fy) / m, az = (ch * Fx - sh * Fy) / m
  if (speed > 0.1) {
    ax -= (c.vx / speed) * (drag / m)
    az -= (c.vz / speed) * (drag / m)
  }
  const fb = ax * S.bx + az * S.bz
  const ab = G * S.tanT + fb / S.cosT
  ax += S.bx * (ab - fb)
  az += S.bz * (ab - fb)
  st.fb = fb
  c.vx += ax * dt
  c.vz += az * dt
  st.r += (Mz / B.iz) * dt
  c.h += st.r * dt
  if (thr < 0.05 && !reverse && Math.hypot(c.vx, c.vz) < 0.3) {
    const k = Math.max(0, 1 - dt * 6)
    c.vx *= k
    c.vz *= k
    st.r *= k
    st.omega *= k
  }
  if (u < -CFG.reverseMax) {
    const kk = -CFG.reverseMax / u
    c.vx *= kk
    c.vz *= kk
  }
  st.ax = Fx / m
  st.ay = Fy / m
  c.x += c.vx * dt
  c.z += c.vz * dt

  const pk = st.peak
  const anyScrape = st.scrape.some(Boolean)
  if (anyScrape) pk.bottom += dt
  if (st.bump.some(Boolean)) pk.bumpT += dt
  if (fz.some((f) => f <= 0)) pk.liftT += dt
  pk.noseLift = Math.max(pk.noseLift, st.th)
  pk.minClear = Math.min(pk.minClear, ...st.clear)
  if (anyScrape && speed > 6 && w.rand() < dt * 30) {
    const p = v.clearance[st.scrape.findIndex(Boolean)]
    const lx = c.x + sh * p.x + ch * p.y, lz = c.z + ch * p.x - sh * p.y, tpp = w.track.toTrack(lx, lz)
    w.events.push({ t: 'sparks', x: lx, y: w.track.heightAt(tpp.s, tpp.lat) + 0.05, z: lz, n: 2, vx: c.vx, vz: c.vz, nx: -sh, nz: -ch, k: 'wall' })
  }
}
