import { TRUCK_DIM, TRUCK_SCALE } from './config'
import { speedOf } from './car'
import type { Controls, SimCar, Zone } from './car'
import { clamp, lerp, mod } from './math'
import type { World } from './world'
import { AI_TOUCH, aiPace, sgnDs } from './ai'
import { stepCarNext } from './dynamics'

/** True while either axle has a tire on the flat concrete below the banking. */
export function concreteContact(w: World, c: SimCar): boolean {
  const sh = Math.sin(c.h), ch = Math.cos(c.h), k = c.stockCar ? 0.98 : 0.98 * TRUCK_SCALE, half = 0.83 * k
  for (const lg of [TRUCK_DIM.FA * k, TRUCK_DIM.RA * k]) for (const b of [1, -1]) {
    if (w.track.toTrack(c.x + sh * lg - ch * half * b, c.z + ch * lg + sh * half * b).lat < -w.track.HW) return true
  }
  return false
}

export function stepCar(w: World, c: SimCar, dt: number, ctl: Controls, cap: number | null): void {
  if (w.model === 'next') {
    stepCarNext(w, c, dt, ctl, cap)
    finishStep(w, c)
    return
  }
  const CFG = w.cfg, T = w.track, DIRT = T.dirt
  const tgt = clamp(ctl.steer, -1, 1)
  const growing = Math.abs(tgt) > Math.abs(c.steer) && (Math.sign(tgt) === Math.sign(c.steer) || c.steer === 0)
  c.steerV = (c.steerV || 0) + ((tgt - c.steer) * (growing ? CFG.steerRampIn : CFG.steerRampOut) - (c.steerV || 0)) * Math.min(1, dt * CFG.steerDamp)
  c.steer = clamp(c.steer + c.steerV * dt, -1, 1)
  c.thr = ctl.thr ? 1 : 0
  c.brk = ctl.brk ? 1 : 0
  let sh = Math.sin(c.h), ch = Math.cos(c.h), vf = c.vx * sh + c.vz * ch
  const d = c.dmg, tp = c.tp, apron = tp.lat < -T.HW
  const gripF = Math.max(0.8, 1 - 0.0012 * (d.l + d.rt) - 0.0006 * (d.f + d.r)) * (c.gripB || 1)
  const aOn = T.aMaxAt(tp.s, Math.max(tp.lat, -T.HW + 0.01), CFG.grip * gripF)
  const aMax = apron ? lerp(aOn, T.aMaxAt(tp.s, tp.lat, CFG.apronGrip * gripF), CFG.offTrack) : aOn
  const onConcrete = concreteContact(w, c), cs = onConcrete ? CFG.concreteSpeed : 1
  c.ck = (c.ck || 0) + ((onConcrete ? 1 : 0) - (c.ck || 0)) * Math.min(1, dt / 0.15)
  const bst = c.boost || 1, powF = Math.max(0.55, 1 - 0.0035 * d.f - 0.0012 * (d.l + d.rt + d.r)) * bst * cs * (c.powB || 1), dragF = (1 + 0.005 * d.f) / (bst * bst) / (cs * cs * cs)
  let ax = 0
  if (c.thr) {
    if (vf > -0.5) ax += Math.min(CFG.maxAccel, (CFG.power * powF) / Math.max(vf, 1))
    else ax += CFG.brake
  }
  if (c.brk) {
    if (vf > 0.5) ax -= CFG.brake
    else if (!c.thr) ax -= 4
  }
  if (cap && vf > cap) ax = Math.min(ax, 0) - 3
  let res = CFG.roll + CFG.drag * dragF * vf * vf + CFG.scrub * Math.abs(c.steer) * vf * vf
  if (!c.thr) res += CFG.engineBrake * Math.min(1, Math.abs(vf) / 5)
  const steerMax = CFG.steerLow / (1 + Math.abs(vf) * CFG.steerSpeed)
  const pull = clamp((d.l - d.rt) * 0.0012, -0.15, 0.15) * Math.min(1, Math.abs(vf) / 10)
  let yaw = ((vf * Math.tan(clamp(c.steer + pull, -1, 1) * steerMax)) / CFG.wheelbase) * lerp(1, CFG.concreteTurn, c.ck)
  const lon = Math.abs(ax) * 0.85, latAvail = Math.sqrt(Math.max(aMax * aMax * 0.2, aMax * aMax - lon * lon))
  const ratio = Math.abs(vf * yaw) / latAvail
  if (DIRT) {
    if (ratio > 1) yaw *= Math.min(1, 1.25 / ratio)
    if (c.thr && vf > 9 && Math.abs(c.steer) > 0.15) c.av += Math.sign(c.steer) * (c.ai || c.auto ? 0.55 : 1.0) * Math.min(1, Math.abs(c.steer)) * Math.min(1, (vf - 9) / 12) * dt * 1.5
    c.h += (yaw + c.av) * dt
    c.av *= Math.exp(-dt * 3.2)
  } else {
    if (ratio > 1) {
      yaw *= 1 / ratio
      if (c.thr && ratio > 1.8 && vf > 12) c.av += Math.sign(yaw) * CFG.spinRate * (ratio - 1.8) * dt * 6
    }
    c.h += (yaw + c.av) * dt
    c.av *= Math.exp(-dt * (ratio > 1.3 ? 3 : 6))
  }
  sh = Math.sin(c.h)
  ch = Math.cos(c.h)
  vf = c.vx * sh + c.vz * ch
  let vl = -c.vx * ch + c.vz * sh
  vl += clamp(DIRT ? -vl * 6.5 : -vl / dt, -latAvail, latAvail) * dt
  c.slip = Math.abs(vl) + Math.max(0, ratio - (DIRT ? 1 : 1.15)) * 10 + (c.brk && vf > 20 ? 2 : 0)
  res += CFG.slideScrub * Math.abs(vl)
  let nv = vf + ax * dt
  const sg = Math.sign(nv)
  if (sg !== 0) {
    const after = nv - sg * res * dt
    nv = Math.sign(after) !== sg ? 0 : after
  }
  if (nv < -CFG.reverseMax) nv = -CFG.reverseMax
  if (onConcrete) {
    const nf = Math.max(CFG.concreteSpeed, c.cf - (dt * (1 - CFG.concreteSpeed)) / 0.35)
    if (nv > 0) nv *= nf / c.cf
    c.cf = nf
  } else c.cf = Math.min(1, c.cf + (dt * (1 - CFG.concreteSpeed)) / 1.5)
  c.vx = sh * nv - ch * vl
  c.vz = ch * nv + sh * vl
  c.vf = nv
  c.x += c.vx * dt
  c.z += c.vz * dt
  c.tp = T.toTrack(c.x, c.z)
  finishStep(w, c)
}

/** Shared by both models: the walls, then the line crossings and the AI's lap pacing. */
function finishStep(w: World, c: SimCar): void {
  const T = w.track
  walls(w, c)
  if (!c.isPace) {
    const P = T.P, nsp = mod(c.tp.s - T.S_LINE, P)
    aiPace(w, c, c.sp, nsp)
    if (c.sp > P - 60 && nsp < 60) lineCross(w, c)
    else if (c.sp < 60 && nsp > P - 60) c.cross--
    c.sp = nsp
  }
}

export function lineCross(w: World, c: SimCar): void {
  const race = w.race
  c.cross++
  const now = w.now()
  if (c.cross === 2) c.lapStart = now
  else if (c.cross > 2 && c.lapStart != null) {
    const lt = now - c.lapStart
    c.lastLap = lt
    if (!c.bestLap || lt < c.bestLap) c.bestLap = lt
    c.lapStart = now
    if (c.isPlayer && !c.fin && !c.lapDirty) w.events.push({ t: 'lap', id: c.id, ms: lt * 1000 })
    if (!c.fin && (c.cross - 2 >= race.laps || race.ph === 'checkered' || race.ph === 'done')) c.fin = true
  }
  c.lapDirty = c.fin
}

const CORNERS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

export function walls(w: World, c: SimCar): void {
  const CFG = w.cfg, T = w.track, HW = T.HW
  const sh = Math.sin(c.h), ch = Math.cos(c.h)
  let worst: { pen: number; out: number; px: number; pz: number; s: number } | null = null
  for (const [a, b] of CORNERS) {
    const px = c.x + sh * 2.35 * CFG.carScale * a - ch * 0.95 * CFG.carScale * b, pz = c.z + ch * 2.35 * CFG.carScale * a + sh * 0.95 * CFG.carScale * b, t = T.toTrack(px, pz)
    let pen = t.lat - (HW + 0.1), out = 1
    const pin = -HW - T.AP + 0.1 - t.lat
    if (pin > pen) {
      pen = pin
      out = -1
    }
    if (pen > 0 && (!worst || pen > worst.pen)) worst = { pen, out, px, pz, s: t.s }
  }
  if (!worst) return
  const cn = T.center(worst.s), nx = cn.nx * worst.out, nz = cn.nz * worst.out
  c.x -= nx * worst.pen
  c.z -= nz * worst.pen
  const vn = c.vx * nx + c.vz * nz
  if (vn > 0) {
    const jx = -(1 + CFG.wallRest) * vn * nx, jz = -(1 + CFG.wallRest) * vn * nz
    c.vx += jx
    c.vz += jz
    const fr = 1 - Math.min(0.3, vn * 0.02)
    c.vx *= fr
    c.vz *= fr
    c.av += 0.14 * ((worst.pz - c.z) * jx - (worst.px - c.x) * jz)
    if (vn > 1.2) impact(w, c, worst.px, worst.pz, -nx, -nz, vn, 'wall')
  } else if (speedOf(c) > 12 && w.rand() < 0.25) w.events.push({ t: 'sparks', x: worst.px, y: T.heightAt(worst.s, HW) + 0.4, z: worst.pz, n: 2, vx: c.vx, vz: c.vz })
}

export function collidePair(w: World, a: SimCar, b: SimCar): void {
  if (!a.local && !b.local) return
  const CFG = w.cfg, T = w.track
  const dx0 = a.x - b.x, dz0 = a.z - b.z, CS = CFG.carScale, RS = 2 * CS
  if (dx0 * dx0 + dz0 * dz0 > 42 * CS * CS) return
  const sa = Math.sin(a.h), ca = Math.cos(a.h), sb = Math.sin(b.h), cb = Math.cos(b.h)
  let best: { o: number; nx: number; nz: number; px: number; pz: number } | null = null
  for (const ka of [-1.35 * CS, 0, 1.35 * CS]) for (const kb of [-1.35 * CS, 0, 1.35 * CS]) {
    const ax = a.x + sa * ka, az = a.z + ca * ka, bx = b.x + sb * kb, bz = b.z + cb * kb, dx = ax - bx, dz = az - bz, d2 = dx * dx + dz * dz
    if (d2 < RS * RS && d2 > 1e-6) {
      const d = Math.sqrt(d2), o = RS - d
      if (!best || o > best.o) best = { o, nx: dx / d, nz: dz / d, px: (ax + bx) / 2, pz: (az + bz) / 2 }
    }
  }
  if (!best) return
  const am = a.local ? 1 : 0, bm = b.local ? 1 : 0, wt = am + bm
  a.x += (best.nx * best.o * am) / wt
  a.z += (best.nz * best.o * am) / wt
  b.x -= (best.nx * best.o * bm) / wt
  b.z -= (best.nz * best.o * bm) / wt
  const rub = 1 - CFG.contactSlow / 120
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
    const kb = CFG.carBounce, j = (-(1 + CFG.carRest * kb) * vn) / wt, jx = j * best.nx, jz = j * best.nz, yk = 0.12 * kb
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
    {
      const ds = sgnDs(w, a.tp.s, b.tp.s), front = ds > 0 ? a : b
      if (front.ai && Math.abs(a.tp.lat - b.tp.lat) < AI_TOUCH(w) * 0.85 && hit < 3.5) front.looseT = 0.7
    }
    if (am) {
      a.vx *= loss
      a.vz *= loss
    }
    if (bm) {
      b.vx *= loss
      b.vz *= loss
    }
    if (hit > 2.2) {
      impact(w, a, best.px, best.pz, best.nx, best.nz, hit, 'car')
      impact(w, b, best.px, best.pz, -best.nx, -best.nz, hit, 'car')
    } else if (speedOf(a) > 10 && w.rand() < 0.3) w.events.push({ t: 'sparks', x: best.px, y: T.heightAt(a.tp.s, a.tp.lat) + 0.5, z: best.pz, n: 2, vx: a.vx, vz: a.vz })
  }
}

export function impact(w: World, c: SimCar, px: number, pz: number, ix: number, iz: number, v: number, kind: 'wall' | 'car'): void {
  const CFG = w.cfg
  const sh = Math.sin(c.h), ch = Math.cos(c.h), dx = px - c.x, dz = pz - c.z
  const lx = (dx * ch - dz * sh) / CFG.carScale, lz = (dx * sh + dz * ch) / CFG.carScale, dlx = ix * ch - iz * sh, dlz = ix * sh + iz * ch
  const zone: Zone = Math.abs(lz) > 1.6 ? (lz > 0 ? 'f' : 'r') : lx > 0 ? 'l' : 'rt'
  const amt = Math.max(0, v - (kind === 'car' ? 2 : 1.3)) * (kind === 'car' ? 2.6 : 3.3) * CFG.damageScale
  if (c.local && amt > 0.3) damageCar(w, c, [lx, 0.55, lz], [dlx, 0, dlz], amt, zone)
  if (kind === 'car' && !c.local) return
  w.events.push({ t: 'impact', id: c.id, x: px, y: w.track.heightAt(c.tp.s, c.tp.lat) + 0.45, z: pz, v, vx: c.vx, vz: c.vz })
}

export function damageCar(w: World, c: SimCar, lp: [number, number, number], dir: [number, number, number], amt: number, zone: Zone): void {
  c.dmg[zone] = Math.min(100, c.dmg[zone] + amt)
  w.events.push({ t: 'damage', id: c.id, lp, dir, amt, zone })
}

export function place(w: World, c: SimCar, s: number, lat: number): void {
  const T = w.track, cn = T.center(s)
  c.x = cn.x + cn.nx * lat
  c.z = cn.z + cn.nz * lat
  c.h = Math.atan2(cn.tx, cn.tz)
  c.vx = c.vz = c.av = c.vf = 0
  c.dyn = undefined
  c.tp = T.toTrack(c.x, c.z)
  c.sp = mod(c.tp.s - T.S_LINE, T.P)
}

export function resetCar(w: World, c: SimCar): void {
  place(w, c, c.tp.s, -w.track.HW - 2.5)
  c.steer = 0
  c.relLane = null
  w.events.push({ t: 'reset', id: c.id })
}
