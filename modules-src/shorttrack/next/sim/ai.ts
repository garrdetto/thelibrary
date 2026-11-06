import { speedOf } from './car'
import type { Controls, SimCar } from './car'
import { clamp, lerp, mod, wrapA } from './math'
import { resetCar } from './physics'
import { capFor, formSpeed } from './race'
import type { World } from './world'

/**
 * Racecraft constants. AI_TOUCH: lateral spacing at which two cars touch (collision circles are 2 * carScale
 * across); AI_GAP adds a safety margin; AI_PASS is the lane width used to pull alongside; AI_SHIFT how fast (m/s)
 * the AI moves across the track; AI_CORNER the share of the real grip limit used in the turns.
 */
type AiConsts = { AI_TOUCH: number; AI_GAP: number; AI_PASS: number; AI_SHIFT: number; AI_CORNER: number; CAR_LEN: number; AI_LINE_MAX: number; SIDE_LEN: number; SIDE_TIGHT: number; SIDE_ROOM: number }

const cache = new WeakMap<World, AiConsts>()

export function aiConsts(w: World): AiConsts {
  let k = cache.get(w)
  if (!k) {
    const CS = w.cfg.carScale, DIRT = w.track.dirt, AI_TOUCH = 2 * CS, AI_GAP = AI_TOUCH + (DIRT ? 1.0 : 0.6)
    k = {
      AI_TOUCH, AI_GAP, AI_PASS: AI_GAP + 0.9, AI_SHIFT: DIRT ? 2.2 : 2.8, AI_CORNER: DIRT ? 0.975 : 0.998, CAR_LEN: 5.5 * CS, AI_LINE_MAX: w.track.LINE_MAX - 0.5,
      SIDE_LEN: 6.6 * CS, SIDE_TIGHT: AI_GAP + 0.2, SIDE_ROOM: 1.0,
    }
    cache.set(w, k)
  }
  return k
}

export const AI_TOUCH = (w: World): number => aiConsts(w).AI_TOUCH

export function sgnDs(w: World, a: number, b: number): number {
  const P = w.track.P
  let d = mod(a - b, P)
  if (d > P / 2) d -= P
  return d
}

function latVel(w: World, o: SimCar): number {
  const cn = w.track.center(o.tp.s)
  return o.vx * cn.nx + o.vz * cn.nz
}

function headingOff(w: World, o: SimCar): number {
  const tc = w.track.center(o.tp.s)
  return Math.abs(wrapA(Math.atan2(tc.tx, tc.tz) - o.h))
}

/** A car that is spinning, sliding sideways, pointed the wrong way or crawling at racing speed. */
export function isHazard(w: World, o: SimCar, v: number): boolean {
  return !o.isPace && !o.fin && (Math.abs(o.av) > 0.55 || headingOff(w, o) > 0.5 || (speedOf(o) < Math.max(7, v * 0.55) && v > 12))
}

/** Is it safe to move from the current line to `lat`? Sweeps the whole strip the car crosses. */
function laneClear(w: World, c: SimCar, lat: number): boolean {
  const { AI_GAP, CAR_LEN } = aiConsts(w)
  const cur = c.tp.lat, up = lat > cur, lo = up ? cur + 1.2 : lat - AI_GAP, hi = up ? lat + AI_GAP : cur - 1.2
  for (const o of w.cars.values()) {
    if (o === c || !o.vis) continue
    const ds = sgnDs(w, o.tp.s, c.tp.s), rv = c.vf - o.vf
    if (ds > 0 && ds < CAR_LEN + 1 && Math.abs(o.tp.lat - cur) < AI_GAP) return false
    const back = CAR_LEN + 2 + Math.max(0, -rv) * 1.4, fwd = CAR_LEN + 4 + Math.max(0, rv) * 1.1
    if (ds > -back && ds < fwd && o.tp.lat > lo && o.tp.lat < hi) return false
  }
  return true
}

/**
 * Finds a car alongside. Once per encounter the AI decides, weighted by c.aggr, whether to race it hard (hold its
 * lane, door to door) or give room (an extra car-width and a small lift when the other car is level or ahead).
 */
function sideBySide(w: World, c: SimCar, lane: number): { lane: number; lift: number } {
  const { SIDE_LEN, SIDE_TIGHT, SIDE_ROOM, AI_GAP } = aiConsts(w), T = w.track
  let o: SimCar | null = null, best = 1e9, ds = 0
  for (const q of w.cars.values()) {
    if (q === c || !q.vis || q.isPace) continue
    const d = sgnDs(w, q.tp.s, c.tp.s)
    const dl = Math.abs(q.tp.lat - c.tp.lat)
    if (Math.abs(d) < SIDE_LEN && dl < SIDE_TIGHT + 2.5 && dl < best) {
      best = dl
      o = q
      ds = d
    }
  }
  if (!o) {
    c.sideT += 1 / 120
    if (c.sideT > 1) {
      c.sideId = null
      c.sideMode = null
    }
    return { lane, lift: 1 }
  }
  c.sideT = 0
  if (c.sideId !== o.id) {
    c.sideId = o.id
    const lead = -ds / SIDE_LEN
    const p = clamp((c.aggr ?? 0.5) + lead * 0.2 + (o.isPlayer ? 0 : -0.05), 0.03, 0.97)
    c.sideMode = w.rand() < p ? 'hard' : 'room'
  }
  const dlat = o.tp.lat - c.tp.lat, outside = Math.abs(dlat) > 0.4 ? dlat > 0 : String(c.id) < String(o.id), sep = SIDE_TIGHT + (c.sideMode === 'room' ? SIDE_ROOM : 0.1)
  let ln = outside ? Math.min(lane, o.tp.lat - sep) : Math.max(lane, o.tp.lat + sep)
  ln = clamp(ln, T.LINE_MIN, T.LINE_MAX)
  let lift = 1
  if (c.sideMode === 'room') {
    if (ds > -1.5) lift = 0.985
    if (Math.abs(ln - (outside ? o.tp.lat - sep : o.tp.lat + sep)) > 0.4) lift = Math.min(lift, 0.97)
  }
  if (Math.abs(o.tp.lat - c.tp.lat) < AI_GAP + 0.15 && Math.abs(latVel(w, o) - latVel(w, c)) > 1.2) lift = Math.min(lift, 0.97)
  return { lane: ln, lift }
}

/** Picks the side to pass on: inside first, the outside if that is the only room. */
function passLane(w: World, c: SimCar, ahead: SimCar, gl: number): number | null {
  const { AI_PASS, AI_GAP } = aiConsts(w), T = w.track
  const onLine = (o: number) => clamp(o, T.LINE_MIN, T.LINE_MAX), low = onLine(Math.min(gl, ahead.tp.lat) - AI_PASS), high = onLine(Math.max(gl, ahead.tp.lat) + AI_PASS)
  const opts = [low, high].filter((l) => Math.abs(l - ahead.tp.lat) >= AI_GAP + 0.3)
  if (c.tp.lat > ahead.tp.lat + 0.8) opts.reverse()
  for (const l of opts) if (laneClear(w, c, l)) return l
  return null
}

/** Two wide off the green: the inside file runs the groove, the outside file a lane width above it. */
function startLane(w: World, c: SimCar, gl: number): number {
  const { AI_LINE_MAX, AI_PASS } = aiConsts(w)
  const lo = clamp(gl, w.track.LINE_MIN, AI_LINE_MAX - AI_PASS)
  return c.startFile ? lo + AI_PASS : lo
}

export function aiCtl(w: World, c: SimCar, dt: number): Controls {
  const CFG = w.cfg, T = w.track, race = w.race, DIRT = T.dirt, P = T.P, R = T.R, T1 = T.T1, T2 = T.T2, TURN = T.TURN, HW = T.HW
  const { AI_GAP, AI_CORNER, CAR_LEN, AI_LINE_MAX, AI_SHIFT } = aiConsts(w)
  const s = c.tp.s, v = c.vf, ph = race.ph
  let lane: number, target: number
  if (c.isPace) {
    lane = c.pitting ? -HW - 3.5 : -1.6
    target = c.pitting ? 32 : ph === 'pace' && race.formP != null ? formSpeed(w, c) : ph === 'pace' ? CFG.paceSpeed + 0.3 : CFG.cautionSpeed - 1
  } else {
    const slow = ph === 'pace' || ph === 'caution' || c.fin
    c.laneT -= dt
    c.bumpCD = Math.max(0, (c.bumpCD || 0) - dt)
    c.bumpT = Math.max(0, (c.bumpT || 0) - dt)
    c.looseT = Math.max(0, (c.looseT || 0) - dt)
    c.evadeT = Math.max(0, (c.evadeT || 0) - dt)
    const gl = T.grooveLat(s), onLine = (o: number) => clamp(o, T.LINE_MIN, T.LINE_MAX)
    c.startHoldT = Math.max(0, (c.startHoldT || 0) - dt)
    const cur = slow ? c.fileLane : c.startHoldT > 0 ? startLane(w, c, gl) : onLine(gl + c.passOff)
    let ahead: SimCar | null = null, aheadD = 1e9, haz: SimCar | null = null, hazD = 1e9
    for (const o of w.cars.values()) {
      if (o === c || !o.vis) continue
      const ds = mod(o.tp.s - s, P)
      if (ds > 90) continue
      const dl = slow ? Math.abs(o.tp.lat - cur) : Math.min(Math.abs(o.tp.lat - cur), Math.abs(o.tp.lat - c.tp.lat))
      if (ds < 45 && dl < AI_GAP && ds < aheadD) {
        aheadD = ds
        ahead = o
      }
      if (!slow && ds > 1 && ds < 85 && ds < hazD && isHazard(w, o, v)) {
        hazD = ds
        haz = o
      }
    }
    const gap = ahead ? aheadD - CAR_LEN : 1e9
    if (!slow) {
      const held = !!ahead && !ahead.isPace && gap < 10 && ahead.vf < v + 1.5 && !isHazard(w, ahead, v)
      c.heldT = held ? (c.heldT || 0) + dt : Math.max(0, (c.heldT || 0) - dt * 2)
      if (held && ahead && !c.bumpT && !c.bumpCD && c.heldT > lerp(7, 2.5, c.aggr ?? 0.5)) {
        c.bumpT = 1.8
        c.bumpOn = ahead.id
        c.bumpCD = 9 + w.rand() * 5
        c.heldT = 0
      }
      if (c.laneT <= 0) {
        if (c.passOff === 0 && ahead && aheadD < (c.passD || 20) && ahead.vf < v + 1) {
          const pl = passLane(w, c, ahead, gl)
          if (pl != null) {
            c.passOff = pl - gl
            c.laneT = c.laneCD || 3
          } else c.laneT = 0.35
        } else if (c.passOff !== 0 && laneClear(w, c, onLine(gl)) && (!ahead || aheadD > 25)) {
          c.passOff = 0
          c.laneT = (c.laneCD || 3) * 0.66
        }
      }
    }
    lane = slow ? c.fileLane : onLine(T.GROOVE_LOW + c.passOff)
    const mu = CFG.aiGrip * (c.gripB || 1) * Math.max(0.8, 1 - 0.0012 * (c.dmg.l + c.dmg.rt))
    const muP = CFG.grip * (c.gripB || 1) * Math.max(0.8, 1 - 0.0012 * (c.dmg.l + c.dmg.rt) - 0.0006 * (c.dmg.f + c.dmg.r))
    const laneNow = lane
    const vAt = (b: number) => {
      const t = Math.tan(b), lim = Math.sqrt(((CFG.g * (muP + t)) / Math.max(0.05, 1 - muP * t)) * (R + laneNow)) * AI_CORNER
      return Math.min(lim, Math.sqrt(((CFG.g * (mu + t)) / (1 - mu * t)) * (R + laneNow)) * 0.95 * c.skill * aiCornerK(c))
    }
    const vE = vAt(T.bankAt(T1)), vM = vAt((CFG.turnBank * Math.PI) / 180)
    const inT1 = s >= T1 && s < T1 + TURN, inT2 = s >= T2
    if (inT1 || inT2) {
      const into = (inT1 ? s - T1 : s - T2) / TURN
      target = into < 0.2 ? lerp(vE, vM, into / 0.2) : into > 0.55 ? vM * 1.04 : vM
    } else {
      const dT = (s < T1 ? T1 : T2) - s
      target = Math.sqrt(vE * vE + 2 * (c.aiDecel || CFG.aiDecel) * Math.max(0, dT - 6))
    }
    if (ph === 'pace' && race.formP != null && !c.fin) target = Math.min(target, formSpeed(w, c))
    if (ahead) {
      const bumping = c.bumpT > 0 && ahead.id === c.bumpOn && !slow
      const safe = ph === 'pace' ? 2.5 : slow ? 7 : bumping ? 0 : (DIRT ? 2.6 : 1.6) + Math.max(0, v) * (DIRT ? 0.14 : 0.1), cl = Math.max(0, v - ahead.vf)
      if (!bumping) target = Math.min(target, ahead.vf + Math.sqrt(2 * 5 * Math.max(0, gap - safe)))
      if (gap < safe) target = Math.min(target, ahead.vf - (safe - gap) * 0.6)
      else if (!bumping && gap < safe + (cl * cl) / 10) target = Math.min(target, ahead.vf + (gap - safe) * 0.5)
      if (bumping) {
        target = Math.min(target, ahead.vf + 1.6)
        if (gap < 0.5) {
          c.bumpT = Math.min(c.bumpT, 0.35)
          c.laneT = 0
        }
      }
    }
    if (haz) {
      const vl = latVel(w, haz), tArr = hazD / Math.max(4, v - speedOf(haz) * 0.5), pl = clamp(haz.tp.lat + vl * Math.min(1.2, tArr), -HW, HW)
      const roomLo = pl - AI_GAP - 0.5 - T.LINE_MIN, roomHi = T.LINE_MAX - (pl + AI_GAP + 0.5)
      const goLow = roomLo >= 0 && (roomHi < 0 || (c.tp.lat < pl ? roomLo > -1 : roomLo > roomHi + 2))
      const el = clamp(goLow ? pl - AI_GAP - 0.6 : pl + AI_GAP + 0.6, T.LINE_MIN, T.LINE_MAX), fits = Math.abs(el - pl) >= AI_GAP
      c.evadeLane = el
      c.evadeT = 0.5
      if (!fits) target = Math.min(target, speedOf(haz) + hazD * 0.3)
      else if (hazD < 35) target = Math.min(target, v * 0.985)
    }
    if (c.looseT > 0) target *= 0.95
    {
      const room = HW - 1.3 * CFG.carScale - c.tp.lat, drift = latVel(w, c)
      if (drift > 0 && room < drift * (DIRT ? 0.7 : 0.9)) target = Math.min(target, v - (DIRT ? 0.8 : 0.6))
    }
    const cap = capFor(w, c)
    if (cap) target = Math.min(target, cap - 0.3)
    const tc = T.center(s), mis = Math.abs(wrapA(Math.atan2(tc.tx, tc.tz) - c.h))
    if (speedOf(c) < 1.5 || (mis > 1.3 && speedOf(c) < 6)) {
      c.stuckT += dt
      if (c.stuckT > 3) {
        resetCar(w, c)
        c.stuckT = 0
      }
    } else c.stuckT = 0
    c.aiTurn = (inT1 || inT2) && ph !== 'pace'
    c.brkTight = !!(haz && hazD < 35) || !!(ahead && gap < (DIRT ? 2.6 : 1.6) + Math.max(0, v) * 0.06)
    c.brkAt = ahead && gap < 14 ? 0.8 : 2.5
  }
  const Ld = 8 + Math.abs(v) * 0.45, tg = T.center(s + Ld)
  if (!c.isPace && !(ph === 'pace' || ph === 'caution' || c.fin)) {
    const base = T.grooveLat(s + Ld)
    lane = c.startHoldT > 0 ? startLane(w, c, base) : clamp(base + c.passOff, T.LINE_MIN, AI_LINE_MAX)
    if (c.evadeT > 0) lane = c.evadeLane
    if (c.looseT > 0) lane = Math.min(AI_LINE_MAX, lane + 0.6)
    const want = lane, sb = sideBySide(w, c, lane)
    lane = sb.lane
    target *= sb.lift
    if (c.relLane == null) c.relLane = c.tp.lat - base
    const rate = (c.evadeT > 0 ? 7 : sb.lane !== want ? 4.5 : AI_SHIFT) * dt
    c.relLane += clamp(lane - base - c.relLane, -rate, rate)
    lane = clamp(base + c.relLane, T.LINE_MIN, AI_LINE_MAX)
  }
  const tx = tg.x + tg.nx * lane, tz = tg.z + tg.nz * lane
  const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz) || 1, alpha = wrapA(Math.atan2(dx, dz) - c.h)
  const delta = Math.atan(((2 * Math.sin(alpha)) / dist) * CFG.wheelbase), sm = CFG.steerLow / (1 + Math.abs(v) * CFG.steerSpeed)
  const sliding = !c.isPace && (DIRT ? Math.abs(c.av) > 0.8 : Math.abs(c.av) > 0.32 || c.slip > 2.6)
  const steer = clamp(delta / sm - (sliding ? clamp(c.av * 0.6, -0.5, 0.5) : 0), -1, 1)
  const brkAt = !c.isPace && c.aiTurn && !c.brkTight ? 5 : c.brkAt || 2.5
  return { thr: !sliding && v < target - 0.2, brk: !sliding && v > target + brkAt, steer }
}

/**
 * Lap pacing: each AI car with a target lap time measures a rolling lap at the line and at half distance and
 * trims c.paceK, which scales its corner speed and power (and grip when it needs more). Green-flag laps only.
 */
const PACE_K: [number, number] = [0.82, 1.1]

export function aiPace(w: World, c: SimCar, oldSp: number, nsp: number): void {
  const race = w.race, P = w.track.P
  if (!c.ai || !c.local || !c.lapTgt || c.isPace) return
  if (race.ph !== 'green' || c.fin) {
    c.paceCk = null
    return
  }
  const half = P / 2, hit: -1 | 0 | 1 = oldSp > P - 60 && nsp < 60 ? 0 : oldSp < half && nsp >= half && nsp - oldSp < 60 ? 1 : -1
  if (hit === -1) return
  const now = w.now()
  c.paceCk = c.paceCk || [null, null]
  const prev = c.paceCk[hit]
  c.paceCk[hit] = now
  if (prev == null || now - race.greenT < c.lapTgt * 1.2) return
  const lt = now - prev, err = clamp(lt / c.lapTgt - 1, -0.05, 0.05)
  c.paceK = clamp((c.paceK || 1) * (1 + 0.85 * err), PACE_K[0], PACE_K[1])
  aiPaceApply(c)
}

/** Slowing to a target comes mostly out of the straights (power), so the AI keeps its corner speed. */
export function aiCornerK(c: SimCar): number {
  const k = c.paceK || 1
  return k >= 1 ? k : 1 - (1 - k) * 0.35
}

export function aiPaceApply(c: SimCar): void {
  const k = c.paceK || 1
  c.powB = (c.powB0 || 1) * (k >= 1 ? 1 + (k - 1) * 1.2 : Math.max(0.7, 1 + (k - 1) * 2.2))
  c.gripB = (c.gripB0 || 1) * (k > 1 ? 1 + (k - 1) * 0.7 : 1)
}
