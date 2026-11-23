/**
 * Front ends per family. Classic long hood: square hood with a two-tone band and side louvers, tall upright chrome grille
 * surround with vertical bars, sweeping fenders over the steer wheels, twin round headlights in chrome buckets on the fenders,
 * external chrome air cleaners and fender mirrors. Square vocational hood: integrated painted grille and rectangular fender
 * lamps. Aero: one sloped hood blending into the fenders, swept headlight lenses that follow the hood corner, a wrap-around
 * bumper with fog lamps, hood mirrors. Sloped vocational: the aero shape made boxier with a tall grille. Cab-over: grille panel
 * and lamps on the flat face, front fascia, corner steps and quarter fenders under the cab. Plus every bumper option, the
 * engine bay seen through the wheel arches, and the brand badge in raised block letters.
 */

import type { GrilleOption, TruckLook } from '../../../shared/Catalog'
import type { PartBatch, PartKey } from './Batch'
import type { TruckLayout } from './Layout'
import { HOOD_BAND } from './Layout'
import {
  archBottom, at, bar, boxAt, clampedRadii, cornerStrip, endInset, insetSection, latheX, latheZ, loft, mix, panel, rectProfile,
  roundCorners, roundRect, sideRibbon, slab, slabX, smooth, sphere, sweep, tube, type P2, type P3, type Section,
} from './Geometry'
import { blockLetters, wordCells } from './Letters'
import { lampPod, xr } from './Cab'

/** The brand name as a raised badge facing +Z (rotated by `yaw`). */
export function badge(b: PartBatch, word: string, x: number, y: number, z: number, cell: number, yaw = 0, plate: PartKey = 'plastic'): void {
  const w = (wordCells(word) + 2) * cell
  const h = 7 * cell
  b.add(plate, at(slab(-w / 2, w / 2, -h / 2, h / 2, -0.006, 0.006, Math.min(0.004, h / 3)), x, y, z, 0, yaw))
  for (const letter of blockLetters(word, cell, 0.005)) {
    at(letter, 0, 0, 0.006)
    b.add('chrome', at(letter, x, y, z, 0, yaw))
  }
}

function engineBay(b: PartBatch, L: TruckLayout): void {
  if (L.style === 'cabover') {
    b.add('darkSteel', slab(-0.44, 0.44, 0.6, 1.18, -0.95, 0.8, 0.05))
    return
  }
  b.add('darkSteel', slab(-0.42, 0.42, 0.62, L.hoodBottom + 0.12, L.cabFrontZ + 0.05, L.noseZ - 0.38, 0.06))
  b.add('darkSteel', boxAt(-0.52, 0.52, 0.72, Math.max(1.2, L.hoodTopFront - 0.12), L.noseZ - 0.32, L.noseZ - 0.2))
  for (const s of [1, -1]) {
    const [x0, x1] = xr(s, 0.68, 0.71)
    b.add('plastic', boxAt(x0, x1, 0.45, 1.25, -L.archR, L.archR))
  }
}

interface FenderSpec {
  frontTop: number
  rearTop: number
  frontBase: number
  rearBase: number
  rt: number
  crestLift: number
}

function fenders(b: PartBatch, L: TruckLayout, spec: FenderSpec): void {
  const R = L.wheelR
  const archTop = R + L.archR
  const crest = archTop + spec.crestLift
  const zf = L.noseZ - 0.03
  const zr = L.cabFrontZ + 0.02
  const top = (z: number) => z >= 0 ? mix(crest, spec.frontTop, smooth(z / zf)) : mix(crest, spec.rearTop, smooth(z / zr))
  for (const s of [1, -1]) {
    const [x0, x1] = xr(s, L.hoodHalfWidth - 0.1, L.fenderX)
    b.add('primary', loft((z) => ({
      x0, x1, y0: archBottom(z, 0, R, L.archR, z > 0 ? spec.frontBase : spec.rearBase), y1: top(z), rt: spec.rt, rb: 0.03,
    }), zr, zf, { steps: 30, re: 0.05, seg: 4 }))
  }
}

function squareHood(b: PartBatch, L: TruckLayout, rt: number): void {
  const { noseZ, cabFrontZ: zF, hoodHalfWidth: hh, hoodBottom: hb, hoodTopRear: tr, hoodTopFront: tf } = L
  const split = hb + HOOD_BAND
  b.add('secondary', loft(() => ({ x0: -hh, x1: hh, y0: hb, y1: split, rt: 0.012, rb: 0.03 }), zF - 0.02, noseZ, { re: 0.04, ends: 'front' }))
  b.add('primary', loft((z) => ({ x0: -hh, x1: hh, y0: split, y1: mix(tr, tf, (z - zF) / (noseZ - zF)), rt, rb: 0.012 }), zF - 0.02, noseZ, { re: 0.04, ends: 'front', steps: 2 }))
}

function classicFront(b: PartBatch, L: TruckLayout, grille: GrilleOption): void {
  const { noseZ, cabFrontZ: zF, hoodHalfWidth: hh, hoodBottom: hb, hoodTopFront: tf } = L
  squareHood(b, L, 0.075)
  const split = hb + HOOD_BAND
  for (const s of [1, -1] as const) {
    for (let k = 0; k < 7; k++) {
      const z = noseZ - 0.32 - k * 0.055
      b.add('grille', sideRibbon([[z, split + 0.14], [z, split + 0.44]], 0.024, s * hh, 0.004, s))
    }
  }
  const gx = 0.54
  const gy0 = 0.84
  const gy1 = tf + 0.03
  const surround = roundCorners([[-gx, gy0, noseZ + 0.035], [gx, gy0, noseZ + 0.035], [gx, gy1, noseZ + 0.035], [-gx, gy1, noseZ + 0.035]], 0.07, 4, true)
  b.add('chrome', sweep(surround, rectProfile(0.08, 0.1, 0.028), { side: [0, 0, 1], closed: true }))
  b.add('grille', boxAt(-0.5, 0.5, gy0 + 0.03, gy1 - 0.03, noseZ - 0.04, noseZ + 0.012))
  grilleFill(b, grille, noseZ + 0.004, gy0 + 0.04, gy1 - 0.04, () => 0.5, () => {
    if (L.model.brand === 'Bedrock') {
      for (let k = 0; k < 9; k++) {
        const y = mix(gy0 + 0.1, gy1 - 0.12, k / 8)
        b.add('chrome', slabX(-0.49, 0.49, y - 0.016, y + 0.016, noseZ + 0.006, noseZ + 0.032, 0.008))
      }
    } else {
      for (let k = 0; k < 15; k++) {
        const x = mix(-0.45, 0.45, k / 14)
        b.add('chrome', slab(x - 0.012, x + 0.012, gy0 + 0.04, gy1 - 0.04, noseZ + 0.006, noseZ + 0.032, 0.008))
      }
    }
  })
  badge(b, L.model.brand, 0, gy1 - 0.12, noseZ + 0.04, 0.014)
  fenders(b, L, { frontTop: 1.04, rearTop: 0.9, frontBase: 0.8, rearBase: 0.66, rt: 0.16, crestLift: 0.12 })
  const lampZ = noseZ - 0.2
  for (const s of [1, -1]) {
    for (const x of [0.81, 1.05]) lampPod(b, 'head', s * x, 1.18, lampZ, 0.104)
    b.add('chrome', tube([[s * 0.74, 1.13, lampZ - 0.12], [s * 1.14, 1.13, lampZ - 0.12]], 0.018, 8))
    b.add('chrome', bar([s * 0.94, 1.13, lampZ - 0.12], [s * 0.94, 1.02, lampZ - 0.14], 0.04, 0.03, 0.01, [1, 0, 0]))
    b.add('lampAmber', slab(s > 0 ? 1.04 : -1.18, s > 0 ? 1.18 : -1.04, 0.88, 0.95, noseZ - 0.04, noseZ - 0.01, 0.01))
    const az = zF + 0.42
    const ax = s * 0.86
    const cleaner: P2[] = [[0.0005, 0], [0.12, 0.005], [0.175, 0.04], [0.182, 0.09], [0.182, 0.78], [0.175, 0.83], [0.12, 0.865], [0.0005, 0.87]]
    b.add('chrome', at(latheX(cleaner, 28, {}), ax, 1.18, az, 0, 0, Math.PI / 2))
    for (const y of [1.36, 1.86]) b.add('steel', at(latheX([[0.188, -0.03], [0.19, 0.03]], 28, { capStart: false }), ax, y, az, 0, 0, Math.PI / 2))
    b.add('steel', bar([ax - s * 0.17, 1.6, az], [s * (hh - 0.01), 1.6, az], 0.05, 0.04, 0.01, [0, 1, 0]))
    b.add('chrome', tube([[ax - s * 0.12, 1.9, az + 0.02], [s * (hh - 0.02), 1.9, az + 0.08]], 0.07, 14))
    const mz = noseZ - 0.45
    const baseY = 1.22
    b.add('satinBlack', tube([[s * 1.12, baseY, mz], [s * 1.16, 1.48, mz - 0.02]], 0.012, 8))
    b.add('satinBlack', at(sphere(0.17, 10, 1, 1, 0.55), s * 1.16, 1.56, mz - 0.03))
    b.add('chrome', at(sphere(0.15, 10, 1, 1, 0.3), s * 1.16, 1.56, mz - 0.07))
  }
}

function squareFront(b: PartBatch, L: TruckLayout, grille: GrilleOption): void {
  const { noseZ, hoodTopFront: tf } = L
  squareHood(b, L, 0.09)
  const gy0 = 1.12
  const gy1 = tf - 0.19
  b.add('grille', boxAt(-0.5, 0.5, gy0, gy1, noseZ - 0.03, noseZ + 0.006))
  const surround = roundCorners([[-0.53, gy0 - 0.03, noseZ + 0.012], [0.53, gy0 - 0.03, noseZ + 0.012], [0.53, gy1 + 0.03, noseZ + 0.012], [-0.53, gy1 + 0.03, noseZ + 0.012]], 0.05, 3, true)
  b.add('accent', sweep(surround, rectProfile(0.045, 0.06, 0.016), { side: [0, 0, 1], closed: true }))
  grilleFill(b, grille, noseZ - 0.006, gy0, gy1, () => 0.5, () => {
    for (let k = 0; k < 6; k++) {
      const y = mix(gy0 + 0.06, gy1 - 0.06, k / 5)
      b.add('accent', slabX(-0.49, 0.49, y - 0.018, y + 0.018, noseZ - 0.004, noseZ + 0.02, 0.008))
    }
  })
  b.add('grille', boxAt(-0.62, 0.62, 0.8, L.hoodBottom + 0.02, noseZ - 0.08, noseZ - 0.03))
  badge(b, L.model.brand, 0, tf - 0.075, noseZ + 0.012, 0.012)
  fenders(b, L, { frontTop: 1.14, rearTop: 0.92, frontBase: 0.8, rearBase: 0.66, rt: 0.08, crestLift: 0.1 })
  for (const s of [1, -1]) {
    const x = s * 0.97
    b.add('plastic', slab(x - 0.16, x + 0.16, 0.92, 1.08, noseZ - 0.05, noseZ - 0.015, 0.012))
    b.add('head', slab(x - 0.14, x + 0.14, 0.94, 1.06, noseZ - 0.03, noseZ - 0.01, 0.01))
    b.add('lampAmber', slab(s > 0 ? 1.14 : -1.2, s > 0 ? 1.2 : -1.14, 0.94, 1.06, noseZ - 0.045, noseZ - 0.012, 0.008))
  }
}

interface SlopedSpec {
  topRear: number
  topFront: number
  cowlHalf: number
  noseHalf: number
  frontBase: number
  rearBase: number
  rtRear: number
  rtFront: number
}

function slopedShape(L: TruckLayout, spec: SlopedSpec): (z: number) => Section {
  const zF = L.cabFrontZ - 0.02
  const zN = L.noseZ
  const t0 = Math.max(0, (0 - zF) / (zN - zF))
  const W = L.fenderX
  return (z) => {
    const t = (z - zF) / (zN - zF)
    const half = t < t0 ? mix(spec.cowlHalf, W, smooth(t / t0)) : W - (W - spec.noseHalf) * Math.pow((t - t0) / Math.max(1e-3, 1 - t0), 2)
    const base = mix(spec.rearBase, spec.frontBase, smooth((t - t0) * 3))
    return {
      x0: -half, x1: half,
      y0: archBottom(z, 0, L.wheelR, L.archR, base),
      y1: mix(spec.topRear, spec.topFront, Math.pow(t, 1.7)),
      rt: mix(spec.rtRear, spec.rtFront, t), rb: 0.04,
    }
  }
}

function slopedHood(b: PartBatch, L: TruckLayout, spec: SlopedSpec, re = 0.12): (z: number) => Section {
  const shape = slopedShape(L, spec)
  const z0 = L.cabFrontZ - 0.02
  const z1 = L.noseZ
  b.add('primary', loft(shape, z0, z1, { steps: 30, re, ends: 'front', seg: 5 }))
  for (const s of [1, -1]) {
    const x = s * (L.fenderX - 0.02)
    const path: P3[] = []
    const base = spec.rearBase
    const aEnd = Math.PI - Math.asin(Math.min(1, Math.max(0, (base - L.wheelR) / L.archR)))
    const aStart = Math.asin(Math.min(1, Math.max(0, (spec.frontBase - L.wheelR) / L.archR)))
    for (let k = 0; k <= 16; k++) {
      const a = mix(aStart, aEnd, k / 16)
      const z = L.archR * Math.cos(a)
      if (z < z0) continue
      path.push([x, L.wheelR + L.archR * Math.sin(a), z])
    }
    if (path.length > 1) b.add('plastic', tube(path, 0.026, 8))
  }
  return (z) => insetSection(shape(z), endInset(z, z0, z1, re, 'front'), true)
}

/**
 * Fills a grille opening with the chosen insert, or runs `stock` for the model's own bars. `halfAt(y)` is the opening's half
 * width at height y; bars stand just proud of the face at `z`.
 */
function grilleFill(b: PartBatch, style: GrilleOption, z: number, y0: number, y1: number, halfAt: (y: number) => number, stock: () => void): void {
  if (style === 'stock') {
    stock()
    return
  }
  const narrow = Math.min(halfAt(y0), halfAt(y1)) - 0.03
  const ya = y0 + 0.03
  const yb = y1 - 0.03
  if (style === 'bars') {
    const count = Math.max(7, Math.round((narrow * 2) / 0.07))
    for (let k = 0; k < count; k++) {
      const x = mix(-narrow + 0.02, narrow - 0.02, k / (count - 1))
      b.add('chrome', slab(x - 0.012, x + 0.012, ya, yb, z + 0.002, z + 0.028, 0.008))
    }
    return
  }
  if (style === 'slats' || style === 'blackout') {
    const key: PartKey = style === 'blackout' ? 'satinBlack' : 'chrome'
    const count = Math.max(4, Math.round((yb - ya) / (style === 'blackout' ? 0.06 : 0.085)))
    for (let k = 0; k < count; k++) {
      const y = mix(ya + 0.015, yb - 0.015, k / (count - 1))
      const half = halfAt(y) - 0.025
      b.add(key, slabX(-half, half, y - (style === 'blackout' ? 0.02 : 0.015), y + (style === 'blackout' ? 0.02 : 0.015), z + 0.002, z + 0.026, 0.006))
    }
    return
  }
  const rows = Math.max(5, Math.round((yb - ya) / 0.05))
  for (let k = 0; k < rows; k++) {
    const y = mix(ya, yb, k / (rows - 1))
    const half = halfAt(y) - 0.025
    b.add('chrome', boxAt(-half, half, y - 0.005, y + 0.005, z + 0.004, z + 0.016))
  }
  const cols = Math.max(9, Math.round((narrow * 2) / 0.05))
  for (let k = 0; k < cols; k++) {
    const x = mix(-narrow, narrow, k / (cols - 1))
    b.add('chrome', boxAt(x - 0.005, x + 0.005, ya, yb, z + 0.012, z + 0.024))
  }
}

function trapezoidGrille(b: PartBatch, z: number, y0: number, y1: number, bottomHalf: number, topHalf: number, bars: number, surround: PartKey, grille: GrilleOption): void {
  b.add('grille', panel([-bottomHalf, y0, z - 0.004], [bottomHalf, y0, z - 0.004], [topHalf, y1, z - 0.004], [-topHalf, y1, z - 0.004], 0.03))
  const loop = roundCorners([[-bottomHalf - 0.02, y0 - 0.02, z + 0.014], [bottomHalf + 0.02, y0 - 0.02, z + 0.014], [topHalf + 0.02, y1 + 0.02, z + 0.014], [-topHalf - 0.02, y1 + 0.02, z + 0.014]], 0.06, 4, true)
  b.add(surround, tube(loop, 0.02, 10, { closed: true }))
  grilleFill(b, grille, z, y0, y1, (y) => mix(bottomHalf, topHalf, (y - y0) / (y1 - y0)), () => {
    for (let k = 1; k <= bars; k++) {
      const t = k / (bars + 1)
      const y = mix(y0, y1, t)
      const half = mix(bottomHalf, topHalf, t) - 0.01
      b.add('chrome', slabX(-half, half, y - 0.011, y + 0.011, z + 0.002, z + 0.02, 0.006))
    }
  })
}

function hoodMirror(b: PartBatch, base: P3, s: number): void {
  const head: P3 = [base[0] + s * 0.1, base[1] + 0.26, base[2] - 0.08]
  b.add('satinBlack', tube([base, [head[0] - s * 0.02, head[1] - 0.06, head[2] + 0.01]], 0.011, 8))
  b.add('satinBlack', slab(head[0] - 0.075, head[0] + 0.075, head[1] - 0.06, head[1] + 0.06, head[2] - 0.03, head[2] + 0.03, 0.025))
  b.add('chrome', at(sphere(0.13, 10, 1, 0.8, 0.25), head[0], head[1], head[2] - 0.03))
}

function aeroFront(b: PartBatch, L: TruckLayout, grille: GrilleOption): void {
  const shape = slopedHood(b, L, { topRear: L.hoodTopRear, topFront: L.hoodTopFront, cowlHalf: 1.08, noseHalf: 1.0, frontBase: 0.74, rearBase: 0.86, rtRear: 0.22, rtFront: 0.32 }, 0.09)
  const zN = L.noseZ
  const face = shape(zN)
  const gy0 = Math.max(face.y0 + 0.03, 0.84)
  const gy1 = face.y1 - 0.05
  trapezoidGrille(b, zN, gy0, gy1, 0.46, 0.56, 5, 'chrome', grille)
  badge(b, L.model.brand, 0, gy1 - 0.035, zN + 0.03, 0.011)
  for (const s of [1, -1] as const) {
    b.add('chrome', cornerStrip(shape, zN - 0.6, zN - 0.08, 8, s, 6, 64, 0.004, 0.01))
    b.add('glass', cornerStrip(shape, zN - 0.58, zN - 0.09, 8, s, 8, 62, 0.03, 0.008))
    b.add('lampAmber', cornerStrip(shape, zN - 0.74, zN - 0.61, 3, s, 14, 52, 0.012, 0.014))
    for (const [dz, deg] of [[0.2, 30], [0.4, 26]] as const) {
      const z = zN - dz
      const section = shape(z)
      const [rt] = clampedRadii(section)
      const theta = s > 0 ? (deg * Math.PI) / 180 : Math.PI - (deg * Math.PI) / 180
      const cx = (s > 0 ? section.x1 - rt : section.x0 + rt) + Math.cos(theta) * (rt - 0.01)
      const cy = section.y1 - rt + Math.sin(theta) * (rt - 0.01)
      const pod = latheZ([[0.05, -0.03], [0.056, 0.0], [0.04, 0.016], [0.0005, 0.02]], 14, { capStart: true })
      b.add('head', at(pod, cx, cy, z, 0, s * 0.55))
    }
    const mz = zN - 0.55
    const top = shape(mz)
    hoodMirror(b, [s * (top.x1 - 0.18), top.y1 - 0.05, mz], s)
  }
}

function slopedFront(b: PartBatch, L: TruckLayout, grille: GrilleOption): void {
  const shape = slopedHood(b, L, { topRear: L.hoodTopRear, topFront: L.hoodTopFront, cowlHalf: 1.12, noseHalf: 1.12, frontBase: 0.8, rearBase: 0.84, rtRear: 0.14, rtFront: 0.18 })
  const zN = L.noseZ
  const face = shape(zN)
  const gy0 = face.y0 + 0.08
  const gy1 = face.y1 - 0.06
  b.add('grille', slab(-0.5, 0.5, gy0, gy1, zN - 0.03, zN + 0.012, 0.02))
  const surround = roundCorners([[-0.53, gy0 - 0.03, zN + 0.014], [0.53, gy0 - 0.03, zN + 0.014], [0.53, gy1 + 0.03, zN + 0.014], [-0.53, gy1 + 0.03, zN + 0.014]], 0.05, 3, true)
  b.add('accent', sweep(surround, rectProfile(0.04, 0.06, 0.015), { side: [0, 0, 1], closed: true }))
  grilleFill(b, grille, zN + 0.002, gy0, gy1, () => 0.5, () => {
    for (let k = 0; k < 7; k++) {
      const y = mix(gy0 + 0.05, gy1 - 0.05, k / 6)
      b.add('chrome', slabX(-0.48, 0.48, y - 0.014, y + 0.014, zN + 0.004, zN + 0.024, 0.006))
    }
  })
  badge(b, L.model.brand, 0, gy1 + 0.07, zN + 0.004, 0.012)
  const zHood = L.cabFrontZ - 0.02
  if (zHood > -L.archR) {
    const aFrom = Math.acos(Math.max(-1, Math.min(1, zHood / L.archR)))
    for (const s of [1, -1]) {
      const path: P3[] = []
      for (let k = 0; k <= 10; k++) {
        const a = mix(aFrom - 0.05, Math.PI - 0.5, k / 10)
        path.push([s * L.track / 2, L.wheelR + L.archR * Math.sin(a) - 0.04, L.archR * Math.cos(a)])
      }
      b.add('plastic', sweep(path, rectProfile(0.38, 0.03, 0.012), { side: [1, 0, 0] }))
    }
  }
  for (const s of [1, -1]) {
    const x = s * 0.82
    b.add('plastic', slab(x - 0.17, x + 0.17, gy0 - 0.02, gy0 + 0.14, zN - 0.02, zN + 0.014, 0.012))
    b.add('head', slab(x - 0.15, x + 0.15, gy0, gy0 + 0.12, zN - 0.01, zN + 0.022, 0.012))
    b.add('lampAmber', slab(x - 0.15, x + 0.15, gy0 + 0.15, gy0 + 0.2, zN - 0.02, zN + 0.016, 0.008))
  }
}

function caboverFront(b: PartBatch, L: TruckLayout, grille: GrilleOption): void {
  const { hw, cabFloorY: yF, beltY: yB, cabFrontZ: zF } = L
  const gy0 = yF + 0.14
  const gy1 = yB - 0.12
  b.add('grille', slab(-0.6, 0.6, gy0, gy1, zF - 0.02, zF + 0.012, 0.02))
  const surround = roundCorners([[-0.63, gy0 - 0.03, zF + 0.016], [0.63, gy0 - 0.03, zF + 0.016], [0.63, gy1 + 0.03, zF + 0.016], [-0.63, gy1 + 0.03, zF + 0.016]], 0.05, 3, true)
  b.add('chrome', tube(surround, 0.02, 8, { closed: true }))
  grilleFill(b, grille, zF + 0.002, gy0, gy1, () => 0.6, () => {
    for (let k = 0; k < 6; k++) {
      const y = mix(gy0 + 0.05, gy1 - 0.05, k / 5)
      b.add('chrome', slabX(-0.58, 0.58, y - 0.014, y + 0.014, zF + 0.004, zF + 0.024, 0.006))
    }
  })
  badge(b, L.model.brand, 0, (gy1 + yB) / 2 + 0.005, zF + 0.004, 0.0105)
  for (const s of [1, -1]) {
    const x = s * 0.92
    b.add('chrome', slab(x - 0.19, x + 0.19, yF + 0.06, yF + 0.24, zF - 0.01, zF + 0.016, 0.02))
    for (const dx of [-0.085, 0.085]) b.add('head', slab(x + dx - 0.075, x + dx + 0.075, yF + 0.085, yF + 0.215, zF, zF + 0.026, 0.012))
    b.add('lampAmber', slab(x - 0.12, x + 0.12, yF + 0.28, yF + 0.34, zF - 0.01, zF + 0.016, 0.01))
  }
  b.add('secondary', slab(-0.95, 0.95, 0.6, yF + 0.03, 0.64, zF - 0.02, 0.04, 0.03, 0.05))
  const R = L.wheelR
  for (const s of [1, -1]) {
    const [sx0, sx1] = xr(s, 0.95, hw - 0.01)
    for (const y of [0.56, 0.9]) {
      b.add('aluminum', slab(sx0, sx1, y - 0.03, y, 0.7, 1.08, 0.008))
      b.add('deck', boxAt(sx0 + 0.01, sx1 - 0.01, y, y + 0.006, 0.72, 1.06))
    }
    for (const z of [0.67, 1.1]) b.add('plastic', boxAt(sx0, sx1, 0.42, yF, z - 0.015, z + 0.015))
    const path: P3[] = []
    for (let k = 0; k <= 14; k++) {
      const a = mix(0.35, 2.35, k / 14)
      path.push([s * L.track / 2, R + (R + 0.07) * Math.sin(a), (R + 0.07) * Math.cos(a)])
    }
    b.add('plastic', sweep(path, rectProfile(0.36, 0.03, 0.012), { side: [1, 0, 0] }))
    const [fx0, fx1] = xr(s, L.track / 2 - 0.15, L.track / 2 + 0.15)
    b.add('rubber', boxAt(fx0, fx1, 0.24, 0.92, -0.62, -0.608))
  }
}

function squareBumper(b: PartBatch, L: TruckLayout, key: PartKey, heavy: boolean): void {
  const cabover = L.style === 'cabover'
  const zb = L.bumperZ
  const yc = cabover ? 0.54 : 0.62
  const h = heavy ? 0.42 : cabover ? 0.3 : 0.36
  const d = heavy ? 0.3 : 0.2
  const x0 = cabover ? 1.0 : 0.95
  const x1 = cabover ? 1.22 : L.fenderX
  const wing = cabover ? 0.12 : 0.22
  const path = roundCorners([[-x1, yc, zb - wing], [-x0, yc, zb], [x0, yc, zb], [x1, yc, zb - wing]], 0.12, 4)
  const profile = roundRect({ x0: -h / 2, x1: h / 2, y0: -d, y1: 0, rt: 0.03, rb: 0.03 }, 2)
  b.add(key, sweep(path, profile, { side: [0, 1, 0] }))
  if (heavy) {
    b.add('darkSteel', boxAt(-0.32, 0.32, yc + h / 2 - 0.004, yc + h / 2 + 0.008, zb - d + 0.02, zb - 0.02))
    for (const s of [1, -1]) {
      const x = s * 0.5
      b.add('darkSteel', tube(roundCorners([[x - 0.06, yc - 0.06, zb - 0.02], [x - 0.06, yc - 0.06, zb + 0.08], [x + 0.06, yc - 0.06, zb + 0.08], [x + 0.06, yc - 0.06, zb - 0.02]], 0.05, 4), 0.02, 8))
    }
    b.add('darkSteel', boxAt(-0.08, 0.08, yc - 0.08, yc + 0.04, zb - 0.01, zb + 0.03))
  } else {
    for (const s of [1, -1]) b.add('darkSteel', boxAt(s * 0.42 - 0.04, s * 0.42 + 0.04, yc - h / 2 - 0.04, yc - h / 2 + 0.02, zb - 0.14, zb - 0.04))
  }
}

function aeroBumper(b: PartBatch, L: TruckLayout, key: PartKey): void {
  const zb = L.bumperZ
  const zN = L.noseZ
  const yc = 0.61
  const path = roundCorners([[-1.22, yc, zN - 0.62], [-1.2, yc, zN - 0.12], [-0.9, yc, zb], [0.9, yc, zb], [1.2, yc, zN - 0.12], [1.22, yc, zN - 0.62]], 0.32, 6)
  const profile = roundRect({ x0: -0.19, x1: 0.19, y0: -0.26, y1: 0, rt: 0.08, rb: 0.08 }, 3)
  b.add(key, sweep(path, profile, { side: [0, 1, 0] }))
  const dam = path.map(([x, , z]) => [x * 0.98, 0.37, z - 0.02] as P3)
  b.add('plastic', sweep(dam, roundRect({ x0: -0.05, x1: 0.05, y0: -0.2, y1: 0, rt: 0.02, rb: 0.02 }, 2), { side: [0, 1, 0] }))
  for (const s of [1, -1]) {
    b.add('satinBlack', slab(s * 0.78 - 0.09, s * 0.78 + 0.09, 0.47, 0.65, zb - 0.06, zb + 0.004, 0.03))
    lampPod(b, 'head', s * 0.78, 0.56, zb + 0.004, 0.058, 'satinBlack')
  }
}

function bumper(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  if (L.front === 'aero' && look.bumper !== 'heavy') {
    aeroBumper(b, L, look.bumper === 'chrome' ? 'chrome' : 'secondary')
    return
  }
  if (look.bumper === 'chrome') squareBumper(b, L, 'chrome', false)
  else if (look.bumper === 'heavy') squareBumper(b, L, 'satinBlack', true)
  else squareBumper(b, L, L.front === 'classic' ? 'steel' : 'satinBlack', false)
  if (look.lights === 'full') {
    for (const s of [1, -1]) lampPod(b, 'head', s * 0.66, L.style === 'cabover' ? 0.54 : 0.62, L.bumperZ + 0.004, 0.06)
  }
}

/** Writes the front end (hood, grille, fenders, lamps, bumper, engine bay) of a truck into the batch. */
export function buildFrontEnd(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  engineBay(b, L)
  if (L.front === 'classic') classicFront(b, L, look.grille)
  else if (L.front === 'square') squareFront(b, L, look.grille)
  else if (L.front === 'aero') aeroFront(b, L, look.grille)
  else if (L.front === 'sloped') slopedFront(b, L, look.grille)
  else caboverFront(b, L, look.grille)
  bumper(b, L, look)
}
