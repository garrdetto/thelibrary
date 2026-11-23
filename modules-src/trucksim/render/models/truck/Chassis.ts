/**
 * Everything under and behind the cab: C-channel frame rails with cross members, the steer axle's I-beam and leaf springs,
 * drive axle housings with differentials on air ride (semis) or walking beams (dump tandems), air springs for lift axles,
 * transmission and drive shafts, polished fuel tanks with straps, DEF tank, battery box, air tanks, cab steps, the diamond deck
 * plate, the fifth wheel with its throat, brackets and slider rails, the coiled air lines, tail lamps (brake, tail, reverse,
 * turn), the dump trucks' underride bar, mud flaps and quarter fenders, exhaust stacks by `look.stacks` and the aero side
 * skirts. The moving lift axle beam is built separately by `buildLiftAxle` in its own local frame.
 */

import type { TruckLook } from '../../../shared/Catalog'
import type { PartBatch } from './Batch'
import type { TruckLayout } from './Layout'
import { FIFTH_WHEEL_HEIGHT } from '../../../shared/Catalog'
import {
  at, bar, boxAt, cylinder, latheHardX, latheX, latheZ, mix, panel, rectProfile, ringSection, roundCorners, slab, slabX,
  sweep, tube, type P2, type P3,
} from './Geometry'
import { xr } from './Cab'

function frame(b: PartBatch, L: TruckLayout): void {
  const { railX: rx, frameTop: ft, railH: rh, frameFrontZ: zf, frameRearZ: zr } = L
  for (const s of [1, -1]) {
    const [w0, w1] = xr(s, rx - 0.005, rx + 0.005)
    b.add('darkSteel', boxAt(w0, w1, ft - rh, ft, zr, zf))
    const [f0, f1] = xr(s, rx - 0.09, rx + 0.005)
    b.add('darkSteel', boxAt(f0, f1, ft - 0.012, ft, zr, zf))
    b.add('darkSteel', boxAt(f0, f1, ft - rh, ft - rh + 0.012, zr, zf))
    if (L.style !== 'cabover') {
      const [m0, m1] = xr(s, rx - 0.04, rx + 0.05)
      b.add('darkSteel', boxAt(m0, m1, ft - rh - 0.02, ft - 0.03, zf, L.bumperZ - 0.16))
    }
  }
  const count = Math.max(3, Math.round((zf - zr) / 1.05))
  for (let k = 0; k <= count; k++) {
    const z = mix(zf - 0.08, zr + 0.06, k / count)
    b.add('darkSteel', boxAt(-(rx - 0.006), rx - 0.006, ft - rh + 0.035, ft - 0.035, z - 0.04, z + 0.04))
  }
}

function springPack(b: PartBatch, x: number, zc: number, y0: number, lengths: number[], leaf: number): number {
  let y = y0
  for (let i = lengths.length - 1; i >= 0; i--) {
    const half = lengths[i] / 2
    b.add('darkSteel', slab(x - 0.038, x + 0.038, y, y + leaf, zc - half, zc + half, 0.004, 0.004, 0.02))
    y += leaf
  }
  return y
}

function steerAxle(b: PartBatch, L: TruckLayout): void {
  const R = L.wheelR
  const { railX: rx, frameTop: ft, railH: rh } = L
  const bottom = ft - rh
  b.add('darkSteel', slabX(-0.8, 0.8, R - 0.075, R + 0.035, -0.06, 0.06, 0.02))
  for (const s of [1, -1]) {
    const top = springPack(b, s * rx, 0, R + 0.035, [1.5, 1.3, 1.1, 0.9, 0.7], 0.018)
    for (const z of [0.72, -0.72]) {
      b.add('darkSteel', boxAt(s * rx - 0.035, s * rx + 0.035, top - 0.03, bottom + 0.01, z - 0.04, z + 0.04))
      b.add('darkSteel', at(cylinder(0.05, 0.05, 0.1, 10, 'x'), s * rx, top - 0.01, z))
    }
    b.add('darkSteel', tube([[s * (rx + 0.08), R + 0.06, 0.22], [s * (rx + 0.08), bottom - 0.02, 0.42]], 0.03, 8))
  }
  b.add('darkSteel', tube([[-0.62, R - 0.03, -0.24], [0.62, R - 0.03, -0.24]], 0.022, 8))
  const gz = L.frameFrontZ - 0.15
  b.add('darkSteel', slab(rx + 0.005, rx + 0.17, ft - 0.26, ft - 0.04, gz - 0.12, gz + 0.1, 0.02))
  b.add('darkSteel', tube([[rx + 0.1, ft - 0.28, gz - 0.02], [rx + 0.12, R + 0.1, gz - 0.25], [0.66, R + 0.05, -0.1]], 0.025, 8))
}

function driveHousing(b: PartBatch, L: TruckLayout, z: number, bigDiff: boolean): void {
  const R = L.wheelR
  const housing: P2[] = [[0.0005, -0.86], [0.07, -0.86], [0.075, -0.6], [0.09, -0.36], [0.125, -0.26], [0.125, 0.26], [0.09, 0.36], [0.075, 0.6], [0.07, 0.86], [0.0005, 0.86]]
  b.add('darkSteel', at(latheX(housing, 16), 0, R, z))
  const k = bigDiff ? 1.15 : 1
  const diff: P2[] = [[0.0005, -0.2 * k], [0.12 * k, -0.17 * k], [0.22 * k, -0.06], [0.22 * k, 0.06], [0.15 * k, 0.15 * k], [0.08, 0.21 * k], [0.0005, 0.22 * k]]
  b.add('darkSteel', at(latheZ(diff, 18), 0, R, z))
  for (const s of [1, -1]) b.add('darkSteel', at(cylinder(0.17, 0.17, 0.13, 14, 'z'), s * 0.6, R + 0.1, z - 0.2))
}

function airRide(b: PartBatch, L: TruckLayout, z: number): void {
  const R = L.wheelR
  const { railX: rx, frameTop: ft, railH: rh } = L
  const bottom = ft - rh
  for (const s of [1, -1]) {
    const x = s * (rx + 0.04)
    b.add('darkSteel', boxAt(x - 0.04, x + 0.04, bottom - 0.2, bottom, z + 0.58, z + 0.7))
    b.add('darkSteel', bar([x, bottom - 0.16, z + 0.64], [x, R - 0.07, z], 0.08, 0.07, 0.015, [1, 0, 0]))
    b.add('darkSteel', bar([x, R - 0.07, z], [x, R - 0.05, z - 0.44], 0.08, 0.06, 0.015, [1, 0, 0]))
    b.add('rubber', at(cylinder(0.27, 0.25, Math.max(0.1, bottom - R - 0.04), 18), x, (bottom + R - 0.02) / 2, z - 0.44))
    b.add('darkSteel', boxAt(x - 0.12, x + 0.12, bottom - 0.015, bottom, z - 0.56, z - 0.32))
    b.add('darkSteel', tube([[s * (rx + 0.12), R + 0.02, z + 0.1], [s * (rx + 0.12), bottom - 0.02, z + 0.34]], 0.03, 8))
  }
}

function walkingBeams(b: PartBatch, L: TruckLayout, z1: number, z2: number): void {
  const R = L.wheelR
  const { railX: rx, frameTop: ft, railH: rh } = L
  const bottom = ft - rh
  const zc = (z1 + z2) / 2
  for (const s of [1, -1]) {
    const x = s * (rx + 0.1)
    b.add('darkSteel', bar([x, R - 0.03, z1], [x, R - 0.03, z2], 0.09, 0.16, 0.02, [1, 0, 0]))
    const top = springPack(b, x, zc, R + 0.05, [1.15, 0.95, 0.75, 0.55], 0.028)
    b.add('darkSteel', boxAt(x - 0.06, x + 0.06, top, bottom + 0.02, zc - 0.18, zc + 0.18))
    b.add('darkSteel', tube([[s * 0.18, R + 0.12, z1], [s * (rx - 0.05), bottom - 0.04, z1 + 0.7]], 0.025, 8))
  }
}

function liftAirSprings(b: PartBatch, L: TruckLayout, z: number): void {
  const R = L.wheelR
  const { railX: rx, frameTop: ft, railH: rh } = L
  const bottom = ft - rh
  for (const s of [1, -1]) {
    const x = s * (rx + 0.04)
    b.add('rubber', at(cylinder(0.25, 0.23, Math.max(0.1, bottom - R - 0.08), 16), x, (bottom + R + 0.04) / 2, z - 0.38))
    b.add('darkSteel', boxAt(x - 0.04, x + 0.04, bottom - 0.24, bottom, z + 0.5, z + 0.62))
  }
}

/** The moving beam of a lift axle, in its own frame: origin at the hub centre height and axle station. */
export function buildLiftAxle(b: PartBatch, L: TruckLayout): void {
  const R = L.wheelR
  const { railX: rx, frameTop: ft, railH: rh } = L
  const bottom = ft - rh - R
  b.add('darkSteel', cylinder(0.13, 0.13, 1.72, 14, 'x'))
  for (const s of [1, -1]) {
    b.add('darkSteel', at(cylinder(0.42, 0.42, 0.16, 20, 'x'), s * (L.track / 2 - 0.24), 0, 0))
    const x = s * (rx + 0.04)
    b.add('darkSteel', bar([x, 0, 0], [x, bottom - 0.2, 0.56], 0.08, 0.07, 0.015, [1, 0, 0]))
    b.add('darkSteel', bar([x, 0, 0], [x, 0.04, -0.38], 0.08, 0.06, 0.015, [1, 0, 0]))
    b.add('darkSteel', boxAt(x - 0.12, x + 0.12, 0.04, 0.06, -0.5, -0.26))
    b.add('darkSteel', at(cylinder(0.16, 0.16, 0.12, 12, 'z'), s * 0.6, 0.1, -0.18))
  }
}

function driveline(b: PartBatch, L: TruckLayout): void {
  const R = L.wheelR
  const ft = L.frameTop
  const transFront = L.style === 'cabover' ? -0.95 : L.cabFrontZ + 0.08
  const transBack = transFront - 0.85
  b.add('darkSteel', slab(-0.24, 0.24, ft - 0.46, ft - 0.08, transBack, transFront, 0.05))
  const drives = L.rearAxles.filter((axle) => axle.drive)
  if (drives.length === 0) return
  b.add('darkSteel', tube([[0, ft - 0.3, transBack], [0, R + 0.06, drives[0].z + 0.22]], 0.052, 12))
  for (let i = 0; i + 1 < drives.length; i++) b.add('darkSteel', tube([[0, R + 0.06, drives[i].z - 0.22], [0, R + 0.06, drives[i + 1].z + 0.22]], 0.048, 12))
}

function fuelTank(b: PartBatch, L: TruckLayout, s: number, zFront: number, length: number): void {
  const r = L.tankR
  const x = s * (L.railX + 0.06 + r)
  const y = L.tankY
  const zc = zFront - length / 2
  const h = length / 2
  const profile: P2[] = [[0.0005, -h], [r * 0.7, -h + 0.006], [r * 0.93, -h + 0.03], [r, -h + 0.07], [r, h - 0.07], [r * 0.93, h - 0.03], [r * 0.7, h - 0.006], [0.0005, h]]
  b.add('aluminum', at(latheZ(profile, 30), x, y, zc))
  for (const dz of [h - 0.17, -(h - 0.17)]) {
    b.add('steel', at(latheHardX(ringSection(r + 0.002, r + 0.01, -0.025, 0.025, 0.002), 30), x, y, zc + dz, 0, Math.PI / 2))
    const [bx0, bx1] = xr(s, L.railX + 0.005, Math.abs(x) - r * 0.4)
    b.add('satinBlack', boxAt(bx0, bx1, y - 0.04, y + 0.04, zc + dz - 0.03, zc + dz + 0.03))
  }
  b.add('chrome', at(cylinder(0.11, 0.11, 0.035, 16), x - s * 0.1, y + r * 0.95, zFront - 0.18))
}

function stepBox(b: PartBatch, L: TruckLayout, s: number): void {
  const z0 = L.stepsBackZ
  const z1 = L.stepsFrontZ
  const yF = L.cabFloorY
  const [x0, x1] = xr(s, L.railX + 0.1, L.hw - 0.01)
  const [t0, t1] = xr(s, L.railX + 0.14, L.hw - 0.015)
  for (let y = 0.48; y < yF - 0.12; y += 0.32) {
    b.add('aluminum', slab(t0, t1, y - 0.035, y, z0 + 0.02, z1 - 0.02, 0.008))
    b.add('deck', boxAt(t0 + 0.01, t1 - 0.01, y, y + 0.006, z0 + 0.04, z1 - 0.04))
  }
  for (const z of [z0, z1]) b.add('plastic', boxAt(x0, x1, 0.4, yF, z - 0.015, z + 0.015))
  b.add('plastic', boxAt(s > 0 ? x0 : x1 - 0.02, s > 0 ? x0 + 0.02 : x1, 0.4, yF, z0, z1))
}

function boxes(b: PartBatch, L: TruckLayout): void {
  const ft = L.frameTop
  const rx = L.railX
  const minZ = L.firstRearZ + L.wheelR + 0.16
  const cabover = L.style === 'cabover'
  const tankFront = L.tankFrontZ
  const tankBack = tankFront - L.tankLength
  if (!cabover) for (const s of [1, -1]) stepBox(b, L, s)
  fuelTank(b, L, 1, tankFront, L.tankLength)
  let rightFront = tankFront
  if (L.tankCount > 1) {
    fuelTank(b, L, -1, tankFront, L.tankLength)
    rightFront = tankBack - 0.06
  }
  const batteryLength = 0.62
  if (rightFront - batteryLength > minZ) {
    const [x0, x1] = xr(-1, rx + 0.06, L.hw - 0.06)
    const y0 = L.tankY - 0.27
    const y1 = L.tankY + 0.22
    b.add('satinBlack', slab(x0, x1, y0, y1, rightFront - batteryLength, rightFront, 0.02))
    b.add('deck', boxAt(x0 + 0.01, x1 - 0.01, y1, y1 + 0.012, rightFront - batteryLength + 0.01, rightFront - 0.01))
    b.add('chrome', boxAt(x0 - 0.008, x0, y1 - 0.08, y1 - 0.04, rightFront - batteryLength / 2 - 0.04, rightFront - batteryLength / 2 + 0.04))
  }
  const defFront = tankBack - 0.06
  if (defFront - 0.46 > minZ) {
    const x = rx + 0.06 + 0.22
    b.add('steel', at(latheZ([[0.0005, -0.23], [0.19, -0.225], [0.22, -0.19], [0.22, 0.19], [0.19, 0.225], [0.0005, 0.23]], 22), x, L.tankY - 0.06, defFront - 0.23))
    b.add('hoseBlue', at(cylinder(0.09, 0.09, 0.03, 12), x - 0.06, L.tankY + 0.17, defFront - 0.12))
  }
  const airZ = mix(tankFront, L.firstRearZ, 0.55)
  for (const x of [-0.2, 0.2]) {
    b.add('steel', at(latheZ([[0.0005, -0.48], [0.1, -0.47], [0.12, -0.43], [0.12, 0.43], [0.1, 0.47], [0.0005, 0.48]], 16), x, ft - L.railH - 0.1, airZ))
  }
}

function deckAndFifthWheel(b: PartBatch, L: TruckLayout): void {
  if (L.fifthWheelZ === null) return
  const fz = L.fifthWheelZ
  const ft = L.frameTop
  const rx = L.railX
  const top = FIFTH_WHEEL_HEIGHT
  const deckFront = (L.sleeper ? L.sleeperBackZ : L.cabBackZ) - 0.06
  const deckRear = fz + 0.62
  if (deckFront - deckRear > 0.25) {
    b.add('deck', boxAt(-0.6, 0.6, ft, ft + 0.024, deckRear, deckFront))
    for (const s of [1, -1]) b.add('aluminum', boxAt(s * 0.6 - 0.015, s * 0.6 + 0.015, ft - 0.02, ft + 0.03, deckRear, deckFront))
  }
  b.add('deck', at(cylinder(0.92, 0.92, 0.06, 36), 0, top - 0.03, fz))
  b.add('darkSteel', at(cylinder(0.88, 0.78, 0.06, 28), 0, top - 0.09, fz))
  b.add('rubber', panel([0.045, top + 0.003, fz + 0.03], [-0.045, top + 0.003, fz + 0.03], [-0.27, top + 0.003, fz - 0.47], [0.27, top + 0.003, fz - 0.47], 0.006))
  for (const s of [1, -1]) {
    b.add('darkSteel', panel([s * 0.14, top - 0.01, fz - 0.33], [s * 0.42, top - 0.01, fz - 0.3], [s * 0.4, top - 0.1, fz - 0.52], [s * 0.14, top - 0.1, fz - 0.55], 0.03))
    const [k0, k1] = xr(s, 0.3, 0.38)
    b.add('darkSteel', slab(k0, k1, ft + 0.04, top - 0.09, fz - 0.16, fz + 0.16, 0.012))
    const [r0, r1] = xr(s, rx - 0.07, rx + 0.02)
    b.add('steel', boxAt(r0, r1, ft, ft + 0.045, fz - 0.75, fz + 0.5))
    for (let z = fz - 0.68; z < fz + 0.45; z += 0.1) {
      const [h0, h1] = xr(s, rx + 0.02, rx + 0.025)
      b.add('darkSteel', boxAt(h0, h1, ft + 0.012, ft + 0.032, z - 0.016, z + 0.016))
    }
    b.add('darkSteel', bar([s * rx, ft + 0.03, L.frameRearZ + 0.5], [s * rx, ft - 0.06, L.frameRearZ + 0.02], 0.1, 0.02, 0.006, [1, 0, 0]))
  }
  b.add('darkSteel', boxAt(-0.42, 0.42, ft + 0.03, ft + 0.06, fz - 0.26, fz + 0.26))
  b.add('steel', tube([[0.3, top - 0.075, fz + 0.06], [0.56, top - 0.075, fz + 0.06]], 0.012, 8))
  b.add('steel', tube([[0.56, top - 0.075, fz], [0.56, top - 0.075, fz + 0.12]], 0.016, 8))
}

function helix(a: P3, c: P3, radius: number, turns: number): P3[] {
  const axis: P3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1
  const t: P3 = [axis[0] / length, axis[1] / length, axis[2] / length]
  const seed: P3 = Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u0: P3 = [t[1] * seed[2] - t[2] * seed[1], t[2] * seed[0] - t[0] * seed[2], t[0] * seed[1] - t[1] * seed[0]]
  const ul = Math.hypot(u0[0], u0[1], u0[2]) || 1
  const u: P3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul]
  const v: P3 = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]]
  const count = Math.round(turns * 12)
  const out: P3[] = []
  for (let k = 0; k <= count; k++) {
    const f = k / count
    const angle = Math.PI * 2 * turns * f
    const ca = Math.cos(angle) * radius
    const sa = Math.sin(angle) * radius
    out.push([a[0] + axis[0] * f + u[0] * ca + v[0] * sa, a[1] + axis[1] * f + u[1] * ca + v[1] * sa, a[2] + axis[2] * f + u[2] * ca + v[2] * sa])
  }
  return out
}

function airLines(b: PartBatch, L: TruckLayout): void {
  if (L.fifthWheelZ === null) return
  const ft = L.frameTop
  const back = (L.sleeper ? L.sleeperBackZ : L.cabBackZ) - 0.22
  const postZ = Math.min(back, L.fifthWheelZ + 0.9)
  b.add('chrome', tube([[-0.3, ft, postZ], [-0.3, ft + 1.05, postZ]], 0.022, 10))
  b.add('chrome', tube(roundCorners([[-0.3, ft + 1.0, postZ], [-0.3, ft + 1.05, postZ - 0.04], [-0.05, ft + 1.05, postZ - 0.06]], 0.04, 3), 0.016, 8))
  const coils: Array<['hoseRed' | 'hoseBlue', number]> = [['hoseRed', -0.2], ['hoseBlue', -0.06]]
  for (const [key, x] of coils) {
    const start: P3 = [x, ft + 1.0, postZ - 0.06]
    const end: P3 = [x + 0.05, ft + 0.42, postZ - 0.32]
    b.add(key, tube(helix(start, end, 0.055, 9), 0.011, 6, {}))
    b.add('steel', boxAt(end[0] - 0.03, end[0] + 0.03, end[1] - 0.06, end[1] - 0.02, end[2] - 0.04, end[2] + 0.02))
  }
  b.add('rubber', tube([[0.08, ft + 1.0, postZ - 0.06], [0.1, ft + 0.7, postZ - 0.3], [0.12, ft + 0.55, postZ - 0.36]], 0.012, 6))
}

function rearEnd(b: PartBatch, L: TruckLayout): void {
  const { railX: rx, frameTop: ft, railH: rh, frameRearZ: z0 } = L
  b.add('darkSteel', boxAt(-rx, rx, ft - rh + 0.02, ft - 0.02, z0, z0 + 0.06))
  const py = ft - rh - 0.02
  b.add('satinBlack', slabX(-0.7, 0.7, py - 0.12, py + 0.1, z0 - 0.03, z0 + 0.02, 0.015))
  for (const s of [1, -1]) {
    const lamps: Array<['tail' | 'reverse' | 'lampAmber', number]> = [['lampAmber', 0.6], ['tail', 0.44], ['reverse', 0.3]]
    for (const [key, x] of lamps) {
      b.add('plastic', slab(s * x - 0.07, s * x + 0.07, py - 0.07, py + 0.07, z0 - 0.045, z0 - 0.02, 0.015))
      b.add(key, slab(s * x - 0.06, s * x + 0.06, py - 0.06, py + 0.06, z0 - 0.055, z0 - 0.035, 0.012))
    }
  }
  if (L.bed) {
    b.add('satinBlack', slabX(-1.12, 1.12, 0.5, 0.64, z0 - 0.14, z0 - 0.04, 0.02))
    for (const s of [1, -1]) {
      b.add('darkSteel', boxAt(s * 0.16 - 0.035, s * 0.16 + 0.035, 0.6, ft - rh, z0 - 0.1, z0 - 0.04))
      b.add('lampRed', slab(s * 1.0 - 0.05, s * 1.0 + 0.05, 0.55, 0.59, z0 - 0.15, z0 - 0.135, 0.008))
    }
  }
}

function flaps(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  const R = L.wheelR
  const half = L.track / 2
  const z = L.lastRearZ - R - 0.2
  const chrome = look.mudflaps === 'chrome'
  for (const s of [1, -1]) {
    const [f0, f1] = xr(s, half - 0.31, half + 0.31)
    b.add('rubber', boxAt(f0, f1, 0.22, 0.98, z - 0.006, z + 0.006))
    const [h0, h1] = xr(s, L.railX, half + 0.31)
    if (chrome) {
      b.add('chrome', tube([[s * L.railX, 1.0, z + 0.02], [s * (half + 0.3), 1.0, z + 0.02]], 0.022, 10))
      b.add('chrome', boxAt(f0, f1, 0.2, 0.27, z - 0.012, z + 0.012))
      b.add('chrome', boxAt(f0, f1, 0.95, 0.99, z - 0.012, z + 0.012))
    } else {
      b.add('satinBlack', boxAt(h0, h1, 0.98, 1.03, z, z + 0.04))
    }
    if (L.semi) {
      const radius = R + 0.07
      const quarter = (z1: number, a0: number, a1: number) => {
        const path: P3[] = []
        for (let k = 0; k <= 10; k++) {
          const a = mix(a0, a1, k / 10)
          path.push([s * half, R + radius * Math.sin(a), z1 + radius * Math.cos(a)])
        }
        b.add('plastic', sweep(path, rectProfile(0.66, 0.025, 0.01), { side: [1, 0, 0] }))
      }
      quarter(L.lastRearZ, Math.PI / 2 - 0.25, Math.PI - 0.4)
      if (L.rearAxles.length > 1) quarter(L.firstRearZ, 0.4, Math.PI / 2 + 0.25)
    }
  }
}

function stackSpot(L: TruckLayout): { z: number; x: number; wallZ: number } {
  if (L.bed) return { z: L.cabBackZ + 0.22, x: L.hw + 0.13, wallZ: L.cabBackZ + 0.22 }
  if (L.style === 'cabover') return { z: L.cabBackZ - 0.18, x: L.hw - 0.22, wallZ: L.cabBackZ }
  const back = L.sleeper ? L.sleeperBackZ : L.cabBackZ
  return { z: back - 0.16, x: L.hw - 0.16, wallZ: back }
}

function exhaust(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  const ft = L.frameTop
  if (look.stacks === 'none') {
    const z = Math.min(L.cabBackZ + 0.5, L.tankFrontZ - 0.3)
    b.add('steel', at(latheZ([[0.0005, -0.45], [0.13, -0.44], [0.15, -0.4], [0.15, 0.4], [0.13, 0.44], [0.0005, 0.45]], 18), -0.18, ft - L.railH - 0.12, z))
    b.add('steel', tube(roundCorners([[-0.18, ft - L.railH - 0.12, z - 0.45], [-0.95, ft - L.railH - 0.16, z - 0.55], [-1.02, 0.42, z - 0.56]], 0.1, 4), 0.045, 10))
    return
  }
  const spot = stackSpot(L)
  const sides = look.stacks === 'single' ? [-1] : [1, -1]
  const tall = look.stacks === 'dualTall'
  const roof = L.sleeper && L.style !== 'cabover' ? Math.max(L.roofY, L.sleeperTopY) : L.roofY
  const top = roof + (tall ? 0.95 : 0.48)
  const polished = tall || L.front === 'classic'
  for (const s of sides) {
    const x = s * spot.x
    const z = spot.z
    const canTop = L.cabFloorY + (L.bed ? 0.55 : 0.75)
    const canBottom = L.cabFloorY - 0.12
    b.add(polished ? 'chrome' : 'steel', at(latheX([[0.0005, 0], [0.13, 0.005], [0.15, 0.04], [0.15, canTop - canBottom - 0.04], [0.13, canTop - canBottom - 0.005], [0.0005, canTop - canBottom]], 22), x, canBottom, z, 0, 0, Math.PI / 2))
    b.add('chrome', at(cylinder(0.128, 0.128, top - canTop, 18), x, (top + canTop) / 2, z))
    const shieldBottom = canTop + 0.12
    b.add(polished ? 'chrome' : 'steel', at(cylinder(0.19, 0.19, 0.8, 20), x, shieldBottom + 0.4, z))
    for (const y of [shieldBottom + 0.05, shieldBottom + 0.75]) b.add('steel', at(latheHardX(ringSection(0.095, 0.103, -0.012, 0.012, 0.002), 20), x, y, z, 0, 0, Math.PI / 2))
    b.add('chrome', at(latheHardX(ringSection(0.062, 0.078, -0.02, 0.02, 0.004), 20), x, top, z, 0, 0, Math.PI / 2))
    for (const y of [Math.min(L.beltY, top - 0.6), Math.min(roof - 0.3, top - 0.2)]) {
      b.add('steel', bar([x, y, z], [x, y, spot.wallZ + (L.bed ? 0 : 0.01)], 0.03, 0.025, 0.006, [1, 0, 0]))
    }
    if (L.bed) b.add('steel', bar([x, L.cabFloorY + 0.3, z], [s * (L.hw - 0.01), L.cabFloorY + 0.3, z], 0.03, 0.03, 0.006, [0, 0, 1]))
    b.add('steel', tube(roundCorners([[x, canBottom + 0.01, z], [x, canBottom - 0.12, z + 0.05], [s * (L.railX + 0.02), ft - L.railH, z + 0.4]], 0.1, 4), 0.05, 10))
  }
}

function skirts(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  if (!look.skirts || L.bed) return
  const front = L.stepsBackZ - 0.02
  const back = Math.max(L.firstRearZ + L.wheelR + 0.15, (L.sleeper ? L.sleeperBackZ : L.cabBackZ) - 0.2)
  if (front - back < 0.4) return
  for (const s of [1, -1]) {
    const [x0, x1] = xr(s, L.hw - 0.06, L.hw + 0.005)
    b.add('secondary', slab(x0, x1, 0.4, L.cabFloorY + 0.03, back, front, 0.02, 0.04, 0.06))
  }
}

/** Writes the frame, running gear, tanks, deck, fifth wheel, lamps, flaps, exhaust and skirts into the batch. */
export function buildChassis(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  frame(b, L)
  steerAxle(b, L)
  const fixed = L.rearAxles.filter((axle) => !axle.lift)
  fixed.forEach((axle, index) => {
    if (axle.drive) driveHousing(b, L, axle.z, index === 0 && fixed.length > 1)
    else b.add('darkSteel', at(cylinder(0.13, 0.13, 1.72, 14, 'x'), 0, L.wheelR, axle.z))
  })
  if (L.bed && fixed.length === 2) walkingBeams(b, L, fixed[0].z, fixed[1].z)
  else for (const axle of fixed) airRide(b, L, axle.z)
  for (const axle of L.rearAxles) if (axle.lift) liftAirSprings(b, L, axle.z)
  driveline(b, L)
  boxes(b, L)
  deckAndFifthWheel(b, L)
  airLines(b, L)
  rearEnd(b, L)
  flaps(b, L, look)
  exhaust(b, L, look)
  skirts(b, L, look)
}
