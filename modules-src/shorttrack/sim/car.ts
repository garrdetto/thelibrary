import { clamp, lerp, mod } from './math'
import type { TrackGeometry, TrackPos } from './track'

export type Damage = { f: number; r: number; l: number; rt: number }
export type DamageZone = keyof Damage

export type SimCar = {
  id: string
  local: boolean
  ai: boolean
  auto?: boolean
  isPace: boolean
  x: number
  z: number
  h: number
  vx: number
  vz: number
  vf: number
  steer: number
  steerV?: number
  av: number
  thr: number
  brk: number
  slip: number
  ck?: number
  cf?: number
  boost?: number
  gripB?: number
  powB?: number
  dmg: Damage
  tp: TrackPos
  sp: number
  cross: number
  looseT?: number
  readonly speed: number
}

export type CarControl = { thr: number | boolean; brk: number | boolean; steer: number }

export type CarCfg = {
  g: number
  grip: number
  apronGrip: number
  offTrack: number
  concreteTurn: number
  concreteSpeed: number
  contactSlow: number
  power: number
  maxAccel: number
  drag: number
  roll: number
  engineBrake: number
  brake: number
  reverseMax: number
  scrub: number
  slideScrub: number
  wheelbase: number
  steerLow: number
  steerSpeed: number
  steerRampIn: number
  steerRampOut: number
  steerDamp?: number
  carScale: number
  spinRate: number
  wallRest: number
  carRest: number
  carBounce: number
}

export type ImpactKind = 'wall' | 'car'

export type CarEnv = {
  random(): number
  axles(car: SimCar): { front: number; rear: number; half: number }
  aiPace(car: SimCar, oldSp: number, newSp: number): void
  lineCross(car: SimCar): void
  impact(car: SimCar, px: number, pz: number, ix: number, iz: number, v: number, kind: ImpactKind): void
  sparks(x: number, y: number, z: number, n: number, vx: number, vz: number): void
}

export const carSpeed = (c: { vx: number; vz: number }): number => Math.hypot(c.vx, c.vz)

export function impactZone(c: Pick<SimCar, 'x' | 'z' | 'h'>, carScale: number, px: number, pz: number, ix: number, iz: number) {
  const sh = Math.sin(c.h), ch = Math.cos(c.h), dx = px - c.x, dz = pz - c.z
  const lx = (dx * ch - dz * sh) / carScale, lz = (dx * sh + dz * ch) / carScale
  const dlx = ix * ch - iz * sh, dlz = ix * sh + iz * ch
  const zone: DamageZone = Math.abs(lz) > 1.6 ? (lz > 0 ? 'f' : 'r') : lx > 0 ? 'l' : 'rt'
  return { lx, lz, dlx, dlz, zone }
}

export function impactDamage(v: number, kind: ImpactKind, damageScale: number): number {
  return Math.max(0, v - (kind === 'car' ? 2 : 1.3)) * (kind === 'car' ? 2.6 : 3.3) * damageScale
}

const CORNERS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

export function createCarPhysics(cfg: CarCfg, tg: TrackGeometry, dirt: boolean, env: CarEnv) {
  const { HW, AP, P, S_LINE, center, toTrack, heightAt, aMaxAt } = tg
  const aiTouch = 2 * cfg.carScale

  function sgnDs(a: number, b: number): number {
    let d = mod(a - b, P)
    if (d > P / 2) d -= P
    return d
  }

  function concreteContact(c: SimCar): boolean {
    const sh = Math.sin(c.h), ch = Math.cos(c.h)
    const { front, rear, half } = env.axles(c)
    for (const lg of [front, rear]) for (const b of [1, -1]) {
      if (toTrack(c.x + sh * lg - ch * half * b, c.z + ch * lg + sh * half * b).lat < -HW) return true
    }
    return false
  }

  function walls(c: SimCar): void {
    const sh = Math.sin(c.h), ch = Math.cos(c.h)
    let worst: { pen: number; out: number; px: number; pz: number; s: number } | null = null
    for (const [a, b] of CORNERS) {
      const px = c.x + sh * 2.35 * cfg.carScale * a - ch * 0.95 * cfg.carScale * b
      const pz = c.z + ch * 2.35 * cfg.carScale * a + sh * 0.95 * cfg.carScale * b
      const t = toTrack(px, pz)
      let pen = t.lat - (HW + 0.1), out = 1
      const pin = -HW - AP + 0.1 - t.lat
      if (pin > pen) {
        pen = pin
        out = -1
      }
      if (pen > 0 && (!worst || pen > worst.pen)) worst = { pen, out, px, pz, s: t.s }
    }
    if (!worst) return
    const cn = center(worst.s), nx = cn.nx * worst.out, nz = cn.nz * worst.out
    c.x -= nx * worst.pen
    c.z -= nz * worst.pen
    const vn = c.vx * nx + c.vz * nz
    if (vn > 0) {
      const jx = -(1 + cfg.wallRest) * vn * nx, jz = -(1 + cfg.wallRest) * vn * nz
      c.vx += jx
      c.vz += jz
      const fr = 1 - Math.min(0.3, vn * 0.02)
      c.vx *= fr
      c.vz *= fr
      c.av += 0.14 * ((worst.pz - c.z) * jx - (worst.px - c.x) * jz)
      if (vn > 1.2) env.impact(c, worst.px, worst.pz, -nx, -nz, vn, 'wall')
    } else if (carSpeed(c) > 12 && env.random() < 0.25) env.sparks(worst.px, heightAt(worst.s, HW) + 0.4, worst.pz, 2, c.vx, c.vz)
  }

  function stepCar(c: SimCar, dt: number, ctl: CarControl, cap: number | null | undefined): void {
    const tgt = clamp(ctl.steer, -1, 1)
    const growing = Math.abs(tgt) > Math.abs(c.steer) && (Math.sign(tgt) === Math.sign(c.steer) || c.steer === 0)
    c.steerV = (c.steerV || 0) + ((tgt - c.steer) * (growing ? cfg.steerRampIn : cfg.steerRampOut) - (c.steerV || 0)) * Math.min(1, dt * (cfg.steerDamp as number))
    c.steer = clamp(c.steer + c.steerV * dt, -1, 1)
    c.thr = ctl.thr ? 1 : 0
    c.brk = ctl.brk ? 1 : 0
    let sh = Math.sin(c.h), ch = Math.cos(c.h), vf = c.vx * sh + c.vz * ch
    const d = c.dmg, tp = c.tp, apron = tp.lat < -HW
    const gripF = Math.max(0.8, 1 - 0.0012 * (d.l + d.rt) - 0.0006 * (d.f + d.r)) * (c.gripB || 1)
    const aOn = aMaxAt(tp.s, Math.max(tp.lat, -HW + 0.01), cfg.grip * gripF)
    const aMax = apron ? lerp(aOn, aMaxAt(tp.s, tp.lat, cfg.apronGrip * gripF), cfg.offTrack) : aOn
    const onConcrete = concreteContact(c), cs = onConcrete ? cfg.concreteSpeed : 1
    c.ck = (c.ck || 0) + ((onConcrete ? 1 : 0) - (c.ck || 0)) * Math.min(1, dt / 0.15)
    const bst = c.boost || 1
    const powF = Math.max(0.55, 1 - 0.0035 * d.f - 0.0012 * (d.l + d.rt + d.r)) * bst * cs * (c.powB || 1)
    const dragF = (1 + 0.005 * d.f) / (bst * bst) / (cs * cs * cs)
    let ax = 0
    if (c.thr) {
      if (vf > -0.5) ax += Math.min(cfg.maxAccel, (cfg.power * powF) / Math.max(vf, 1))
      else ax += cfg.brake
    }
    if (c.brk) {
      if (vf > 0.5) ax -= cfg.brake
      else if (!c.thr) ax -= 4
    }
    if (cap && vf > cap) ax = Math.min(ax, 0) - 3
    let res = cfg.roll + cfg.drag * dragF * vf * vf + cfg.scrub * Math.abs(c.steer) * vf * vf
    if (!c.thr) res += cfg.engineBrake * Math.min(1, Math.abs(vf) / 5)
    const steerMax = cfg.steerLow / (1 + Math.abs(vf) * cfg.steerSpeed)
    const pull = clamp((d.l - d.rt) * 0.0012, -0.15, 0.15) * Math.min(1, Math.abs(vf) / 10)
    let yaw = (vf * Math.tan(clamp(c.steer + pull, -1, 1) * steerMax)) / cfg.wheelbase * lerp(1, cfg.concreteTurn, c.ck)
    const lon = Math.abs(ax) * 0.85, latAvail = Math.sqrt(Math.max(aMax * aMax * 0.2, aMax * aMax - lon * lon))
    const ratio = Math.abs(vf * yaw) / latAvail
    if (dirt) {
      if (ratio > 1) yaw *= Math.min(1, 1.25 / ratio)
      if (c.thr && vf > 9 && Math.abs(c.steer) > 0.15) c.av += Math.sign(c.steer) * (c.ai || c.auto ? 0.55 : 1.0) * Math.min(1, Math.abs(c.steer)) * Math.min(1, (vf - 9) / 12) * dt * 1.5
      c.h += (yaw + c.av) * dt
      c.av *= Math.exp(-dt * 3.2)
    } else {
      if (ratio > 1) {
        yaw *= 1 / ratio
        if (c.thr && ratio > 1.8 && vf > 12) c.av += Math.sign(yaw) * cfg.spinRate * (ratio - 1.8) * dt * 6
      }
      c.h += (yaw + c.av) * dt
      c.av *= Math.exp(-dt * (ratio > 1.3 ? 3 : 6))
    }
    sh = Math.sin(c.h)
    ch = Math.cos(c.h)
    vf = c.vx * sh + c.vz * ch
    let vl = -c.vx * ch + c.vz * sh
    vl += clamp(dirt ? -vl * 6.5 : -vl / dt, -latAvail, latAvail) * dt
    c.slip = Math.abs(vl) + Math.max(0, ratio - (dirt ? 1 : 1.15)) * 10 + (c.brk && vf > 20 ? 2 : 0)
    res += cfg.slideScrub * Math.abs(vl)
    let nv = vf + ax * dt
    const sg = Math.sign(nv)
    if (sg !== 0) {
      const after = nv - sg * res * dt
      nv = Math.sign(after) !== sg ? 0 : after
    }
    if (nv < -cfg.reverseMax) nv = -cfg.reverseMax
    if (c.cf === undefined) c.cf = 1
    if (onConcrete) {
      const nf = Math.max(cfg.concreteSpeed, c.cf - (dt * (1 - cfg.concreteSpeed)) / 0.35)
      if (nv > 0) nv *= nf / c.cf
      c.cf = nf
    } else c.cf = Math.min(1, c.cf + (dt * (1 - cfg.concreteSpeed)) / 1.5)
    c.vx = sh * nv - ch * vl
    c.vz = ch * nv + sh * vl
    c.vf = nv
    c.x += c.vx * dt
    c.z += c.vz * dt
    c.tp = toTrack(c.x, c.z)
    walls(c)
    if (!c.isPace) {
      const nsp = mod(c.tp.s - S_LINE, P)
      env.aiPace(c, c.sp, nsp)
      if (c.sp > P - 60 && nsp < 60) env.lineCross(c)
      else if (c.sp < 60 && nsp > P - 60) c.cross--
      c.sp = nsp
    }
  }

  function collidePair(a: SimCar, b: SimCar): void {
    if (!a.local && !b.local) return
    const dx0 = a.x - b.x, dz0 = a.z - b.z, CS = cfg.carScale, RS = 2 * CS
    if (dx0 * dx0 + dz0 * dz0 > 42 * CS * CS) return
    const sa = Math.sin(a.h), ca = Math.cos(a.h), sb = Math.sin(b.h), cb = Math.cos(b.h)
    let best: { o: number; nx: number; nz: number; px: number; pz: number } | null = null
    for (const ka of [-1.35 * CS, 0, 1.35 * CS]) for (const kb of [-1.35 * CS, 0, 1.35 * CS]) {
      const ax = a.x + sa * ka, az = a.z + ca * ka, bx = b.x + sb * kb, bz = b.z + cb * kb
      const dx = ax - bx, dz = az - bz, d2 = dx * dx + dz * dz
      if (d2 < RS * RS && d2 > 1e-6) {
        const d = Math.sqrt(d2), o = RS - d
        if (!best || o > best.o) best = { o, nx: dx / d, nz: dz / d, px: (ax + bx) / 2, pz: (az + bz) / 2 }
      }
    }
    if (!best) return
    const am = a.local ? 1 : 0, bm = b.local ? 1 : 0, w = am + bm
    a.x += (best.nx * best.o * am) / w
    a.z += (best.nz * best.o * am) / w
    b.x -= (best.nx * best.o * bm) / w
    b.z -= (best.nz * best.o * bm) / w
    const rub = 1 - cfg.contactSlow / 120
    if (am) {
      a.vx *= rub
      a.vz *= rub
    }
    if (bm) {
      b.vx *= rub
      b.vz *= rub
    }
    const vn = (a.vx - b.vx) * best.nx + (a.vz - b.vz) * best.nz
    if (vn < 0) {
      const kb = cfg.carBounce, j = (-(1 + cfg.carRest * kb) * vn) / w, jx = j * best.nx, jz = j * best.nz, yk = 0.12 * kb
      if (am) {
        a.vx += jx
        a.vz += jz
        a.av += yk * ((best.pz - a.z) * jx - (best.px - a.x) * jz)
      }
      if (bm) {
        b.vx -= jx
        b.vz -= jz
        b.av += yk * (-(best.pz - b.z) * jx + (best.px - b.x) * jz)
      }
      const hit = -vn, loss = 1 - Math.min(0.08, hit * 0.012)
      const ds = sgnDs(a.tp.s, b.tp.s), front = ds > 0 ? a : b
      if (front.ai && Math.abs(a.tp.lat - b.tp.lat) < aiTouch * 0.85 && hit < 3.5) front.looseT = 0.7
      if (am) {
        a.vx *= loss
        a.vz *= loss
      }
      if (bm) {
        b.vx *= loss
        b.vz *= loss
      }
      if (hit > 2.2) {
        env.impact(a, best.px, best.pz, best.nx, best.nz, hit, 'car')
        env.impact(b, best.px, best.pz, -best.nx, -best.nz, hit, 'car')
      } else if (carSpeed(a) > 10 && env.random() < 0.3) env.sparks(best.px, heightAt(a.tp.s, a.tp.lat) + 0.5, best.pz, 2, a.vx, a.vz)
    }
  }

  return { stepCar, walls, collidePair, concreteContact, sgnDs }
}
