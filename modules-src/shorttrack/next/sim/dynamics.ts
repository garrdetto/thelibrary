import type { Controls, SimCar } from './car'
import { clamp } from './math'
import type { Vec3 } from './track'
import type { World } from './world'

/**
 * The Phase 4 vehicle model (docs/shorttrack/PLAN.md), used when `World.model` is 'next'. Planar rigid body
 * (position, velocity, yaw rate) on the analytic banked surface with:
 * - four wheels sampled against the surface, a sprung body (pitch and roll as damped springs driven by the
 *   accelerations) that moves load between them;
 * - a magic-formula tire per wheel with load sensitivity, combined slip through the friction ellipse and a
 *   relaxation-length lag on the slip angle (stable at 120 Hz down to walking pace);
 * - banking from the true surface normal: the normal load and the inward pull come from the in-plane force
 *   balance, which at the limit reproduces the classic `aMaxAt` exactly;
 * - aero drag and rear-biased downforce, drafting and side-draft;
 * - a dirt surface with a lower, broader tire peak and longer relaxation;
 * - damage feeding back into grip (sides), power and aero (nose and tail).
 * Every quantity is per unit mass, like the classic model, so the engine and drag numbers carry over.
 */


export type Dyn = {
  /** Yaw rate, rad/s. */
  r: number
  /** Pitch and roll as lagged accelerations (m/s²) and their rates: the sprung body's state. */
  pitch: number
  pitchV: number
  roll: number
  rollV: number
  /** Lagged slip angle per wheel (FL, FR, RL, RR), rad. */
  alpha: [number, number, number, number]
  /** Normal load per wheel (per unit mass) and how close each tire is to its limit (0..1+). */
  fz: [number, number, number, number]
  use: [number, number, number, number]
  /** Last step's in-plane force toward the bottom of the banking (per unit mass), for the normal load. */
  fb: number
  /** Body-frame accelerations of the last step. */
  ax: number
  ay: number
  /** Drafting reduction applied this step (0..0.3), for the HUD and sound. */
  draft: number
  /** The `av` this model last wrote: wall and car contacts add their spin kick to `c.av`, and the difference
   * carries into the yaw rate on the next step. */
  avOut: number
}

const GEO = { a: 1.38, b: 1.42, track: 1.66, h: 0.45, iz: 2.3 }
const TIRE = {
  asphalt: { B: 10, C: 1.45, E: -0.4, sigma: 0.45, loadSens: 0.1 },
  dirt: { B: 6, C: 1.25, E: -1.2, sigma: 0.8, loadSens: 0.06 },
}
const AERO = { downforce: 0.0011, rearShare: 0.6 }
/** Fitted so each track's AI lap times land on the classic ones (`tests/physics.test.ts`). */
export const NEXT_TUNE = {
  grip: 1.65, steer: 1.0, brakeFront: 0.6, roll: 0.68, kick: 0.35, lift: 1.0, rearGrip: 1.2,
  /** Shares of the CG height that move load front to back and side to side, and the static left-side weight. */
  pitchH: 0.25, rollH: 0.6, left: 0.55, sideDraft: 0.08,
}
/** Per-track grip trims for the next model, by record id, calibrated against the Phase 0 AI lap traces. */
export const TRACK_GRIP: Record<string, number> = { dellswide: 1.04 }

export function newDyn(): Dyn {
  return { r: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0, alpha: [0, 0, 0, 0], fz: [0, 0, 0, 0], use: [0, 0, 0, 0], fb: 0, ax: 0, ay: 0, draft: 0, avOut: 0 }
}

const magic = (alpha: number, t: { B: number; C: number; E: number }): number => {
  const ba = t.B * alpha
  return Math.sin(t.C * Math.atan(ba - t.E * (ba - Math.atan(ba))))
}

const n = { x: 0, y: 1, z: 0 } as Vec3

/** Drafting and side-draft from the cars around `c`: drag factor (<1 in a draft) and a sideways pull (m/s², toward +lat). */
function airflow(w: World, c: SimCar): { drag: number; side: number; draft: number } {
  let draft = 0, side = 0
  const P = w.track.P, len = 5.5 * w.cfg.carScale
  for (const o of w.cars.values()) {
    if (o === c || !o.vis) continue
    let ds = (o.tp.s - c.tp.s) % P
    if (ds > P / 2) ds -= P
    if (ds < -P / 2) ds += P
    const dl = o.tp.lat - c.tp.lat
    if (ds > 3 && ds < 26 && Math.abs(dl) < 1.7) draft = Math.max(draft, 0.3 * (1 - (ds - 3) / 23))
    if (Math.abs(ds) < len && Math.abs(dl) > 1.2 && Math.abs(dl) < 2.8) side += Math.sign(dl) * NEXT_TUNE.sideDraft * (1 - Math.abs(ds) / len)
  }
  return { drag: 1 - draft + (side !== 0 ? 0.05 : 0), side, draft }
}

export function stepCarNext(w: World, c: SimCar, dt: number, ctl: Controls, cap: number | null): void {
  const CFG = w.cfg, T = w.track, DIRT = T.dirt, tire = DIRT ? TIRE.dirt : TIRE.asphalt
  const d = (c.dyn ??= newDyn())
  // the classic contact kicks were tuned for its own quickly-decaying spin; here they become real yaw rate
  d.r += (c.av - d.avOut) * NEXT_TUNE.kick
  const tgt = clamp(ctl.steer, -1, 1)
  const growing = Math.abs(tgt) > Math.abs(c.steer) && (Math.sign(tgt) === Math.sign(c.steer) || c.steer === 0)
  c.steerV = (c.steerV || 0) + ((tgt - c.steer) * (growing ? CFG.steerRampIn : CFG.steerRampOut) - (c.steerV || 0)) * Math.min(1, dt * CFG.steerDamp)
  c.steer = clamp(c.steer + c.steerV * dt, -1, 1)
  c.thr = ctl.thr ? 1 : 0
  c.brk = ctl.brk ? 1 : 0

  const sh = Math.sin(c.h), ch = Math.cos(c.h)
  // body axes: x forward (sh, ch); y toward where positive yaw turns the nose (ch, -sh)
  const u = c.vx * sh + c.vz * ch, v = c.vx * ch - c.vz * sh, speed = Math.hypot(c.vx, c.vz)
  const dmg = c.dmg, tp = c.tp, apron = tp.lat < -T.HW
  const steerMax = (CFG.steerLow / (1 + Math.abs(u) * CFG.steerSpeed)) * NEXT_TUNE.steer
  const pull = clamp((dmg.l - dmg.rt) * 0.0012, -0.15, 0.15) * Math.min(1, Math.abs(u) / 10)
  const delta = clamp(c.steer + pull, -1, 1) * steerMax

  // surface: normal, banking angle and the horizontal direction toward the bottom of the banking
  T.normalAt(tp.s, tp.lat, n)
  const nh = Math.hypot(n.x, n.z), cosT = Math.max(0.5, n.y), sinT = Math.min(0.87, nh), tanT = sinT / cosT
  const bx = nh > 1e-6 ? n.x / nh : 0, bz = nh > 1e-6 ? n.z / nh : 0
  // normal load per unit mass from the in-plane balance (last step's force toward the bottom), plus downforce
  const muSurface = (apron ? CFG.apronGrip : CFG.grip) * NEXT_TUNE.grip * (TRACK_GRIP[w.def.rec] ?? 1) * (c.gripB || 1)
  const gripF = Math.max(0.8, 1 - 0.0012 * (dmg.l + dmg.rt) - 0.0006 * (dmg.f + dmg.r))
  const N = Math.max(0.2 * CFG.g, (CFG.g + d.fb * sinT) / cosT)
  const aeroF = Math.max(0.4, 1 - 0.004 * dmg.f), aeroR = Math.max(0.4, 1 - 0.004 * dmg.r)
  const down = AERO.downforce * speed * speed, downF = down * (1 - AERO.rearShare) * aeroF, downR = down * AERO.rearShare * aeroR

  // sprung body: pitch and roll chase the accelerations through damped springs and move the load between wheels
  const omega = 11, zeta = 0.7
  d.pitchV += (omega * omega * (d.ax - d.pitch) - 2 * zeta * omega * d.pitchV) * dt
  d.pitch += d.pitchV * dt
  d.rollV += (omega * omega * (d.ay - d.roll) - 2 * zeta * omega * d.rollV) * dt
  d.roll += d.rollV * dt
  const L = GEO.a + GEO.b, longT = (d.pitch * GEO.h * NEXT_TUNE.pitchH) / L, latT = (d.roll * GEO.h * NEXT_TUNE.rollH) / GEO.track, bias = NEXT_TUNE.left - 0.5
  const front = (N * GEO.b) / L + downF - longT, rear = (N * GEO.a) / L + downR + longT
  const rf = NEXT_TUNE.roll
  const fz: [number, number, number, number] = [
    Math.max(0, front * (0.5 - bias) - latT * rf), Math.max(0, front * (0.5 + bias) + latT * rf),
    Math.max(0, rear * (0.5 - bias) - latT * (1 - rf)), Math.max(0, rear * (0.5 + bias) + latT * (1 - rf)),
  ]
  const fz0 = N / 4

  // engine, brakes and resistances (classic numbers), as longitudinal demands on the wheels
  const bst = c.boost || 1
  const powF = Math.max(0.55, 1 - 0.0035 * dmg.f - 0.0012 * (dmg.l + dmg.rt + dmg.r)) * bst * (c.powB || 1)
  let drive = 0, brake = 0
  if (c.thr) {
    if (u > -0.5) drive = Math.min(CFG.maxAccel, (CFG.power * powF) / Math.max(u, 1))
    else brake = CFG.brake
  }
  if (c.brk) {
    if (u > 0.5) brake = CFG.brake
    else if (!c.thr) drive = -4
  }
  if (cap && u > cap) brake = Math.max(brake, 3)
  if (!c.thr && !c.brk) brake = Math.max(brake, CFG.engineBrake * Math.min(1, Math.abs(u) / 5) * NEXT_TUNE.lift)
  const air = airflow(w, c)
  d.draft = air.draft
  const dragF = ((1 + 0.005 * dmg.f) / (bst * bst)) * air.drag

  // tires: slip angles with relaxation and the magic-formula side force first; then drive and brakes take what grip
  // is left on each tire (traction control and ABS), and anything over the friction ellipse is scaled back
  const pos: [number, number][] = [[GEO.a, -GEO.track / 2], [GEO.a, GEO.track / 2], [-GEO.b, -GEO.track / 2], [-GEO.b, GEO.track / 2]]
  const brakeShare = [NEXT_TUNE.brakeFront / 2, NEXT_TUNE.brakeFront / 2, (1 - NEXT_TUNE.brakeFront) / 2, (1 - NEXT_TUNE.brakeFront) / 2]
  const caps = [0, 0, 0, 0], fys = [0, 0, 0, 0], uws = [0, 0, 0, 0], vws = [0, 0, 0, 0], css = [1, 1, 1, 1], sns = [0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    const [px, py] = pos[i], steerI = i < 2 ? delta : 0
    const ui = u - d.r * py, vi = v + d.r * px
    const cs = Math.cos(steerI), sn = Math.sin(steerI)
    const uw = ui * cs + vi * sn, vw = -ui * sn + vi * cs
    const target = Math.atan2(vw, Math.max(Math.abs(uw), 3))
    d.alpha[i] += (target - d.alpha[i]) * Math.min(1, (Math.max(Math.abs(uw), 1) * dt) / tire.sigma)
    const mu = muSurface * gripF * Math.max(0.6, 1 - tire.loadSens * (fz[i] / Math.max(fz0, 1e-3) - 1))
    caps[i] = mu * fz[i] * (i >= 2 ? NEXT_TUNE.rearGrip : 1)
    fys[i] = -caps[i] * magic(d.alpha[i], tire)
    uws[i] = uw
    vws[i] = vw
    css[i] = cs
    sns[i] = sn
  }
  const spare = (i: number) => Math.sqrt(Math.max(0, caps[i] * caps[i] - fys[i] * fys[i]))
  const driveAvail = 0.97 * (spare(2) + spare(3))
  const driveUsed = drive > 0 ? Math.min(drive, driveAvail) : drive
  let Fx = 0, Fy = 0, Mz = 0, slip = 0
  for (let i = 0; i < 4; i++) {
    const [px, py] = pos[i], cap_ = caps[i], uw = uws[i], cs = css[i], sn = sns[i]
    let fy = fys[i]
    const share = fz[i] / Math.max(1e-6, fz[2] + fz[3])
    let fx = i >= 2 ? driveUsed * share : 0
    fx -= Math.sign(uw || 1) * Math.min(brake * brakeShare[i], 0.97 * spare(i))
    fx -= Math.sign(uw) * CFG.roll * 0.25
    const total = Math.hypot(fx, fy)
    if (total > cap_ && total > 0) {
      const k = cap_ / total
      fx *= k
      fy *= k
    }
    d.use[i] = cap_ > 0 ? Math.hypot(fx, fy) / cap_ : 0
    d.fz[i] = fz[i]
    slip = Math.max(slip, Math.abs(vws[i]))
    const bfx = fx * cs - fy * sn, bfy = fx * sn + fy * cs
    Fx += bfx
    Fy += bfy
    Mz += px * bfy - py * bfx
  }
  // aero drag and the side-draft, then into world axes
  const dragA = CFG.drag * dragF * speed * speed
  let ax = sh * Fx + ch * Fy, az = ch * Fx - sh * Fy
  if (speed > 0.1) {
    ax -= (c.vx / speed) * dragA
    az -= (c.vz / speed) * dragA
  }
  if (air.side !== 0) {
    const cn = T.center(tp.s)
    ax += cn.nx * air.side
    az += cn.nz * air.side
  }
  // banking: split the force into the part toward the bottom and the rest; the normal force adds g·tanθ
  const fb = ax * bx + az * bz
  const ab = CFG.g * tanT + fb / cosT
  ax += bx * (ab - fb)
  az += bz * (ab - fb)
  d.fb = fb

  // integrate (semi-implicit)
  c.vx += ax * dt
  c.vz += az * dt
  d.r += (Mz / GEO.iz) * dt
  d.r *= Math.exp(-dt * 0.6)
  c.h += d.r * dt
  if (!c.thr && Math.hypot(c.vx, c.vz) < 0.15) {
    c.vx = c.vz = 0
    d.r *= 0.5
  }
  if (u < -CFG.reverseMax) {
    const k = -CFG.reverseMax / u
    c.vx *= k
    c.vz *= k
  }
  // load transfer follows the tire forces (in the road plane), not the inward push of the banking itself
  d.ax = Fx
  d.ay = Fy
  const sh2 = Math.sin(c.h), ch2 = Math.cos(c.h)
  c.vf = c.vx * sh2 + c.vz * ch2
  // the classic fields the AI, the HUD and the sound read: excess yaw over what the steering asks for, and slip
  c.av = d.r - (c.vf * Math.tan(delta)) / L
  d.avOut = c.av
  c.slip = slip + (c.brk && c.vf > 20 ? 2 : 0)
  c.x += c.vx * dt
  c.z += c.vz * dt
  c.tp = T.toTrack(c.x, c.z)
}
