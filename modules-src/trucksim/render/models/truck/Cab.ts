/**
 * The cab of every truck style: a two-tone lower body (secondary rocker band, primary upper), a greenhouse of painted pillars
 * and real see-through glass (windshield split on the classic long hood), a rounded roof, a dark interior (dash, steering wheel
 * on the driver's left, seats, headliner), door seams, handles and grab rails, west-coast or aero mirrors, wipers, the sleeper
 * box (flat top, raised roof with a step-up, or the aero roof fairing with cab extenders), the visor, roof marker lamps, air
 * horns, roof light bars and the paint stripes. Everything is written into a `PartBatch` in the vehicle frame.
 */

import type { TruckLook } from '../../../shared/Catalog'
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { PartBatch } from './Batch'
import type { TruckLayout } from './Layout'
import {
  at, bar, bezier2, boxAt, cylinder, latheZ, loft, mix, panel, roundCorners, sideRibbon, slab, smooth, sphere, torus, tube,
  type P2, type P3,
} from './Geometry'

/** Sorted X range for a side: offsets `a < b` from the centreline on side `s`. */
export function xr(s: number, a: number, b: number): [number, number] {
  return s > 0 ? [a, b] : [-b, -a]
}

/** The A-pillar line of a cab at fraction `f` (0 at the beltline, 1 at the roof) on side `s`. */
export function pillarPoint(L: TruckLayout, s: number, f: number): P3 {
  const hr = L.hw - L.tumble
  const yRB = L.roofY - 0.11
  return [s * mix(L.hw - 0.035, hr - 0.03, f), mix(L.beltY, yRB, f), mix(L.cabFrontZ - 0.04, L.cabFrontZ - L.rake - 0.035, f)]
}

/** A small lamp pod facing +Z: chrome bucket and a lens of the given slot, centred on (x, y, z). */
export function lampPod(b: PartBatch, lens: 'head' | 'lampAmber' | 'lampWhite' | 'lampRed' | 'tail' | 'reverse', x: number, y: number, z: number, radius: number, housing: 'chrome' | 'satinBlack' = 'chrome'): void {
  const bucket: P2[] = [[radius * 0.55, -radius * 1.1], [radius * 0.95, -radius * 0.8], [radius * 1.12, -radius * 0.2], [radius * 1.12, 0.004]]
  b.add(housing, at(latheZ(bucket, 16, { capStart: true }), x, y, z))
  const lensProfile: P2[] = [[radius, -0.004], [radius * 0.96, radius * 0.12], [radius * 0.7, radius * 0.24], [0.0005, radius * 0.3]]
  b.add(lens, at(latheZ(lensProfile, 16, { capStart: true }), x, y, z))
}

function cabShell(b: PartBatch, L: TruckLayout): void {
  const { hw, cabFloorY: yF, beltY: yB, cabFrontZ: zF, cabBackZ: zB } = L
  const band = yF + L.lowerBand
  b.add('secondary', slab(-hw, hw, yF, band, zB, zF, 0.012, 0.05, 0.08))
  b.add('primary', slab(-hw, hw, band, yB, zB, zF, 0.03, 0.012, 0.08))
  b.add('plastic', boxAt(-hw + 0.01, hw - 0.01, yF - 0.035, yF + 0.005, zB + 0.06, zF - 0.06))
}

function greenhouse(b: PartBatch, L: TruckLayout): void {
  const { hw, beltY: yB, roofY: yR, cabFrontZ: zF, cabBackZ: zB } = L
  const hr = hw - L.tumble
  const yRB = yR - 0.11
  const zT = zF - L.rake
  const zDB = L.doorBackZ
  const zBack = zB + 0.03
  const cabover = L.style === 'cabover'
  const dayCab = !L.sleeper || cabover
  for (const s of [1, -1]) {
    b.add('primary', bar(pillarPoint(L, s, -0.03), pillarPoint(L, s, 1.04), 0.075, 0.06, 0.02, [1, 0, 0]))
    b.add('primary', bar([s * (hw - 0.03), yB - 0.01, zDB], [s * (hr - 0.025), yRB + 0.03, zDB], 0.085, 0.05, 0.015, [0, 0, 1]))
    b.add('primary', bar([s * (hw - 0.035), yB - 0.01, zBack + 0.03], [s * (hr - 0.03), yRB + 0.03, zBack + 0.03], 0.07, 0.06, 0.02, [0, 0, 1]))
    b.add('glass', panel(
      [s * (hw - 0.015), yB + 0.025, zF - 0.075], [s * (hw - 0.015), yB + 0.025, zDB + 0.045],
      [s * (hr - 0.01), yRB - 0.005, zDB + 0.045], [s * (hr - 0.01), yRB - 0.005, zT - 0.07], 0.008,
    ))
    b.add('plastic', panel(
      [s * (hw - 0.02), yB + 0.012, zF - 0.06], [s * (hw - 0.02), yB + 0.012, zDB + 0.03],
      [s * (hr - 0.015), yRB + 0.008, zDB + 0.03], [s * (hr - 0.015), yRB + 0.008, zT - 0.055], 0.004,
    ))
    if (zDB - zBack > 0.2) {
      if (cabover && L.sleeper) {
        b.add('primary', panel(
          [s * (hw - 0.02), yB - 0.01, zDB - 0.03], [s * (hw - 0.02), yB - 0.01, zBack + 0.05],
          [s * (hr - 0.012), yRB + 0.02, zBack + 0.05], [s * (hr - 0.012), yRB + 0.02, zDB - 0.03], 0.04,
        ))
        const z0 = zDB - 0.25
        const z1 = Math.max(zBack + 0.5, z0 - 0.75)
        const sideX = (y: number) => mix(hw, hr + 0.008, (y - (yB - 0.01)) / (yRB + 0.03 - yB)) + 0.006
        b.add('glassTint', panel(
          [s * sideX(yB + 0.12), yB + 0.12, z0], [s * sideX(yB + 0.12), yB + 0.12, z1],
          [s * sideX(yB + 0.5), yB + 0.5, z1], [s * sideX(yB + 0.5), yB + 0.5, z0], 0.008,
        ))
      } else {
        b.add('glass', panel(
          [s * (hw - 0.015), yB + 0.025, zDB - 0.045], [s * (hw - 0.015), yB + 0.025, zBack + 0.065],
          [s * (hr - 0.01), yRB - 0.005, zBack + 0.065], [s * (hr - 0.01), yRB - 0.005, zDB - 0.045], 0.008,
        ))
      }
    }
  }
  if (L.front === 'classic') {
    for (const s of [1, -1]) {
      b.add('glass', panel(
        [s * 0.025, yB + 0.025, zF - 0.035], [s * (hw - 0.06), yB + 0.025, zF - 0.035],
        [s * (hr - 0.055), yRB + 0.005, zT - 0.03], [s * 0.025, yRB + 0.005, zT - 0.03], 0.01,
      ))
    }
    b.add('plastic', bar([0, yB, zF - 0.03], [0, yRB + 0.02, zT - 0.025], 0.05, 0.03, 0.01, [1, 0, 0]))
  } else {
    b.add('glass', panel(
      [hw - 0.06, yB + 0.025, zF - 0.035], [-(hw - 0.06), yB + 0.025, zF - 0.035],
      [-(hr - 0.055), yRB + 0.005, zT - 0.03], [hr - 0.055, yRB + 0.005, zT - 0.03], 0.01,
    ))
  }
  if (dayCab) {
    b.add('primary', panel([hw - 0.03, yB - 0.02, zB + 0.025], [-(hw - 0.03), yB - 0.02, zB + 0.025], [-(hr - 0.02), yRB + 0.02, zB + 0.025], [hr - 0.02, yRB + 0.02, zB + 0.025], 0.05))
    const wy0 = yB + 0.14
    const wy1 = Math.min(yB + 0.52, yRB - 0.08)
    b.add('plastic', panel([0.47, wy0 - 0.025, zB - 0.004], [-0.47, wy0 - 0.025, zB - 0.004], [-0.47, wy1 + 0.025, zB - 0.004], [0.47, wy1 + 0.025, zB - 0.004], 0.006))
    b.add('glass', panel([0.43, wy0, zB - 0.01], [-0.43, wy0, zB - 0.01], [-0.43, wy1, zB - 0.01], [0.43, wy1, zB - 0.01], 0.006))
    b.add('plastic', boxAt(-(hw - 0.06), hw - 0.06, yB, yRB, zB + 0.05, zB + 0.065))
  }
  b.add('primary', loft(() => ({ x0: -(hr + 0.015), x1: hr + 0.015, y0: yRB, y1: yR, rt: 0.09, rb: 0.012 }), zB, zT, { re: 0.07 }))
  b.add('plastic', boxAt(-(hr - 0.03), hr - 0.03, yRB - 0.014, yRB, zB + 0.06, zT - 0.06))
  for (const s of [1, -1]) {
    const x0 = s * 0.12
    const x1 = s * 0.62
    const y0 = yB + 0.07
    const y1 = yB + 0.14
    const zAt = (y: number) => zF - 0.035 - ((y - yB) / (yRB - yB)) * L.rake + 0.022
    b.add('plastic', bar([x1, y0, zAt(y0)], [x0, y1, zAt(y1)], 0.018, 0.012, 0.004, [0, 1, 0]))
    b.add('plastic', at(cylinder(0.035, 0.035, 0.03, 10, 'z'), x1, y0 - 0.02, zAt(y0 - 0.02) - 0.01))
  }
}

function interior(b: PartBatch, L: TruckLayout): void {
  const { hw, beltY: yB, cabFrontZ: zF, cabBackZ: zB } = L
  b.add('plastic', boxAt(-(hw - 0.06), hw - 0.06, yB - 0.002, yB + 0.008, zB + 0.06, zF - 0.06))
  b.add('plastic', slab(-(hw - 0.07), hw - 0.07, yB - 0.22, yB + 0.13, zF - 0.52, zF - 0.06, 0.05, 0.02, 0.04))
  b.add('plastic', at(torus(0.46, 0.034, 20), 0.55, yB + 0.2, zF - 0.66, -0.62))
  b.add('plastic', bar([0.55, yB + 0.02, zF - 0.48], [0.55, yB + 0.19, zF - 0.64], 0.05, 0.05, 0.02, [1, 0, 0]))
  const seatZ = Math.max(zB + 0.28, zF - 1.4)
  for (const x of [0.55, -0.55]) {
    b.add('plastic', slab(x - 0.25, x + 0.25, yB - 0.32, yB + 0.48, seatZ - 0.07, seatZ + 0.07, 0.07, 0.05, 0.06))
    b.add('plastic', slab(x - 0.14, x + 0.14, yB + 0.5, yB + 0.68, seatZ - 0.05, seatZ + 0.05, 0.05, 0.04, 0.04))
    b.add('plastic', slab(x - 0.25, x + 0.25, yB - 0.42, yB - 0.3, seatZ, seatZ + 0.52, 0.04, 0.03, 0.05))
  }
  b.add('plastic', at(cylinder(0.025, 0.02, 0.4, 8), 0.18, yB - 0.1, seatZ + 0.6, 0.35))
  b.add('plastic', at(sphere(0.06, 8), 0.18, yB + 0.09, seatZ + 0.53))
}

function doors(b: PartBatch, L: TruckLayout, chromeHandles: boolean): void {
  const { hw, cabFloorY: yF, beltY: yB, cabFrontZ: zF } = L
  const zDB = L.doorBackZ
  const seamFront = L.doorFrontZ + 0.03
  for (const s of [1, -1] as const) {
    const seam: P2[] = [[seamFront, yB - 0.02], [seamFront, yF + 0.07], [zDB, yF + 0.07], [zDB, yB - 0.02]]
    b.add('plastic', sideRibbon(seam, 0.007, s * hw, 0.002, s))
    const [hx0, hx1] = xr(s, hw - 0.004, hw + 0.03)
    b.add(chromeHandles ? 'chrome' : 'satinBlack', slab(hx0, hx1, yB - 0.17, yB - 0.13, zDB + 0.08, zDB + 0.26, 0.012))
    const [px0, px1] = xr(s, hw - 0.01, hw + 0.006)
    b.add('plastic', slab(px0, px1, yB - 0.19, yB - 0.11, zDB + 0.06, zDB + 0.28, 0.02))
    const gz = L.style === 'cabover' ? zF - 0.05 : zDB - 0.04
    const y0 = yF + 0.22
    const y1 = yB + (L.style === 'cabover' ? 0.3 : 0.2)
    const path = roundCorners([[s * (hw - 0.01), y0, gz], [s * (hw + 0.045), y0 + 0.03, gz], [s * (hw + 0.045), y1 - 0.03, gz], [s * (hw - 0.01), y1, gz]], 0.04, 3)
    b.add('chrome', tube(path, 0.016, 10))
  }
}

function westCoastMirror(b: PartBatch, L: TruckLayout, s: number): void {
  const { hw, beltY: yB, cabFrontZ: zF } = L
  const cabover = L.style === 'cabover'
  const cx = s * (hw + (cabover ? 0.2 : 0.24))
  const cy = yB + (cabover ? 0.12 : 0.24)
  const cz = zF + (cabover ? 0.06 : -0.06)
  const housing = L.front === 'classic' || L.front === 'square' ? 'chrome' : 'satinBlack'
  b.add(housing, slab(cx - 0.1, cx + 0.1, cy - 0.21, cy + 0.21, cz - 0.035, cz + 0.035, 0.03))
  b.add('chrome', boxAt(cx - 0.086, cx + 0.086, cy - 0.192, cy + 0.192, cz - 0.041, cz - 0.034))
  b.add(housing, slab(cx - 0.075, cx + 0.075, cy - 0.43, cy - 0.27, cz - 0.03, cz + 0.03, 0.03))
  b.add('chrome', at(sphere(0.13, 10, 1, 1, 0.3), cx, cy - 0.35, cz - 0.03))
  const arm = housing === 'chrome' ? 'chrome' : 'satinBlack'
  const lowerStart: P3 = cabover ? [s * (hw - 0.01), yB - 0.25, zF - 0.05] : [s * (hw - 0.005), yB - 0.15, zF - 0.12]
  b.add(arm, tube(roundCorners([lowerStart, [s * (hw + 0.1), lowerStart[1] + 0.03, cz - 0.02], [cx, cy - 0.21, cz]], 0.05, 3), 0.013, 8))
  const upperStart = cabover ? ([s * (hw - 0.04), L.roofY - 0.2, zF - L.rake * 0.8] as P3) : pillarPoint(L, s, 0.55)
  b.add(arm, tube(roundCorners([upperStart, [s * (hw + 0.12), cy + 0.32, cz - 0.02], [cx, cy + 0.21, cz]], 0.05, 3), 0.013, 8))
}

function aeroMirror(b: PartBatch, L: TruckLayout, s: number): void {
  const { hw, beltY: yB, cabFrontZ: zF } = L
  const cx = s * (hw + 0.2)
  const cy = yB + 0.3
  const cz = zF - 0.16
  b.add('primary', at(sphere(0.3, 14, 0.58, 1.15, 0.5), cx, cy, cz))
  b.add('chrome', boxAt(cx - 0.07, cx + 0.07, cy - 0.15, cy + 0.15, cz - 0.078, cz - 0.07))
  b.add('satinBlack', bar([s * (hw - 0.01), yB + 0.04, zF - 0.2], [cx - s * 0.05, cy - 0.12, cz], 0.05, 0.035, 0.012, [0, 0, 1]))
}

function sleeperBox(b: PartBatch, L: TruckLayout): void {
  if (!L.sleeper || L.style === 'cabover') return
  const { hw, cabFloorY: yF, beltY: yB, cabBackZ: zB, sleeperBackZ: zS, sleeperTopY: top, roofY: yR } = L
  const band = yF + L.lowerBand
  b.add('secondary', slab(-hw, hw, yF, band, zS, zB + 0.03, 0.012, 0.05, 0.08, { ends: 'back' }))
  b.add('primary', slab(-hw, hw, band, top, zS, zB + 0.03, L.raised ? 0.16 : 0.1, 0.012, 0.09, { ends: 'back' }))
  b.add('plastic', boxAt(-hw + 0.01, hw - 0.01, yF - 0.035, yF + 0.005, zS + 0.06, zB))
  for (const s of [1, -1] as const) {
    const wz0 = zB - 0.2
    const wz1 = Math.max(zS + 0.35, wz0 - 0.5)
    const wy0 = yB + 0.06
    const wy1 = yB + 0.36
    b.add('plastic', panel([s * (hw + 0.002), wy0 - 0.025, wz0 + 0.025], [s * (hw + 0.002), wy0 - 0.025, wz1 - 0.025], [s * (hw + 0.002), wy1 + 0.025, wz1 - 0.025], [s * (hw + 0.002), wy1 + 0.025, wz0 + 0.025], 0.006))
    b.add('glassTint', panel([s * (hw + 0.006), wy0, wz0], [s * (hw + 0.006), wy0, wz1], [s * (hw + 0.006), wy1, wz1], [s * (hw + 0.006), wy1, wz0], 0.006))
    const dz0 = zB - 0.14
    const dz1 = Math.max(zS + 0.2, dz0 - 0.62)
    const dy0 = yF + 0.1
    const dy1 = Math.min(yB - 0.12, yF + 0.66)
    b.add('plastic', sideRibbon([[dz0, dy1], [dz0, dy0], [dz1, dy0], [dz1, dy1], [dz0, dy1]], 0.007, s * hw, 0.002, s))
    const [hx0, hx1] = xr(s, hw - 0.004, hw + 0.025)
    b.add('chrome', slab(hx0, hx1, dy1 - 0.1, dy1 - 0.06, dz1 + 0.05, dz1 + 0.2, 0.01))
  }
  if (L.raised && L.style === 'longnose') {
    const hr = hw - L.tumble
    const z0 = zB - 0.02
    const z1 = zB + 0.85
    b.add('primary', loft((z) => {
      const t = smooth((z - z0) / (z1 - z0))
      return { x0: -(mix(hw - 0.01, hr + 0.01, t)), x1: mix(hw - 0.01, hr + 0.01, t), y0: yR - 0.08, y1: mix(top, yR + 0.03, t), rt: 0.14, rb: 0.01 }
    }, z0, z1, { steps: 10, re: 0.1, ends: 'front', insetBottom: false }))
  }
  if (L.style === 'aero') {
    const hr = hw - L.tumble
    const zT = L.cabFrontZ - L.rake
    const z0 = zB - 0.02
    const z1 = zT + 0.04
    b.add('primary', loft((z) => {
      const t = (z - z0) / (z1 - z0)
      const rise = 1 - Math.pow(t, 1.8)
      const half = mix(hw - 0.005, hr + 0.012, smooth(t))
      return { x0: -half, x1: half, y0: yR - 0.08, y1: mix(yR + 0.05, top, rise), rt: mix(0.22, 0.12, t), rb: 0.01 }
    }, z0, z1, { steps: 14, re: 0.12, ends: 'front', insetBottom: false }))
    for (const s of [1, -1] as const) {
      const [x0, x1] = xr(s, hw - 0.03, hw + 0.012)
      b.add('primary', slab(x0, x1, yF + 0.3, top - 0.18, zS - 0.34, zS + 0.03, 0.012, 0.012, 0.012))
    }
  }
}

function roofFairing(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  if (look.roof === 'none' || L.raised || L.bed) return
  const hr = L.hw - L.tumble
  const yR = L.roofY
  const zT = L.cabFrontZ - L.rake
  const flatTop = L.sleeper && L.style !== 'cabover'
  const z0 = (flatTop ? L.sleeperBackZ : L.cabBackZ) + 0.05
  const z1 = zT + 0.2
  const base = flatTop ? Math.max(yR, L.sleeperTopY) : yR
  const low = L.style === 'aero' && !L.sleeper ? Math.max(yR + 0.12, L.model.roofHeight) : base + 0.32
  const top = look.roof === 'tall' ? base + 0.78 : low
  const power = look.roof === 'tall' ? 1.35 : 1.6
  b.add('primary', loft((z) => {
    const t = (z - z0) / (z1 - z0)
    return { x0: -(hr - 0.04), x1: hr - 0.04, y0: base - 0.04, y1: mix(base + 0.02, top, 1 - Math.pow(Math.max(0, t), power)), rt: 0.1, rb: 0.01 }
  }, z0, z1, { steps: 8, re: 0.08, ends: 'both', insetBottom: false }))
  if (look.roof === 'tall') {
    for (const s of [1, -1] as const) {
      const [x0, x1] = xr(s, hr - 0.06, hr - 0.02)
      b.add('secondary', slab(x0, x1, base + 0.05, top - 0.12, z0 + 0.1, z0 + 0.5, 0.01, 0.01, 0.01))
    }
  }
}

function roofEquipment(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  const hr = L.hw - L.tumble
  const yR = L.roofY
  const yRB = L.roofY - 0.11
  const zT = L.cabFrontZ - L.rake
  const lampSpots = [-0.5, -0.25, 0, 0.25, 0.5]
  if (look.visor) {
    const back = yRB + 0.04
    const frontY = yRB - 0.04
    const depth = L.style === 'cabover' ? 0.26 : 0.34
    b.add('accent', panel([hr - 0.01, back, zT - 0.01], [-(hr - 0.01), back, zT - 0.01], [-(hr - 0.04), frontY, zT + depth], [hr - 0.04, frontY, zT + depth], 0.026))
    for (const x of lampSpots) b.add('lampAmber', slab(x - 0.045, x + 0.045, frontY - 0.035, frontY + 0.005, zT + depth - 0.02, zT + depth + 0.02, 0.012))
    for (const s of [1, -1]) {
      b.add('accent', bar([s * (hr - 0.12), yRB + 0.01, zT - 0.02], [s * (hr - 0.12), frontY + 0.01, zT + depth - 0.06], 0.03, 0.02, 0.006, [1, 0, 0]))
    }
  } else {
    for (const x of lampSpots) b.add('lampAmber', slab(x - 0.045, x + 0.045, yR - 0.035, yR + 0.012, zT + 0.02, zT + 0.075, 0.014))
  }
  const raisedAero = L.style === 'aero' && L.sleeper
  if (look.horn === 'air') {
    const hornY = raisedAero ? L.frameTop - 0.12 : yR + 0.06
    const hornZ = raisedAero ? L.cabFrontZ - 0.35 : zT - 0.45
    const hornX = raisedAero ? -0.12 : -0.3
    for (const [dx, length] of [[0, 0.56], [-0.16, 0.44]] as const) {
      const bell: P2[] = [[0.024, -length / 2], [0.03, -length * 0.1], [0.045, length * 0.3], [0.075, length / 2 - 0.01], [0.078, length / 2]]
      b.add('chrome', at(latheZ(bell, 14, { capStart: true }), hornX + dx, hornY, hornZ))
      b.add('satinBlack', boxAt(hornX + dx - 0.025, hornX + dx + 0.025, hornY - (raisedAero ? -0.03 : 0.06), hornY - (raisedAero ? -0.08 : 0.03), hornZ - 0.08, hornZ + 0.08))
    }
  }
  if (look.lights !== 'stock') {
    const barY = look.visor ? yRB + 0.1 : raisedAero ? yR + 0.02 : yR + 0.1
    const barZ = look.visor ? zT + 0.16 : raisedAero ? zT - 0.03 : zT + 0.12
    const span = hr - 0.12
    b.add('chrome', tube([[-span, barY, barZ], [span, barY, barZ]], 0.022, 10))
    for (const s of [1, -1]) b.add('chrome', bar([s * (span - 0.05), barY, barZ], [s * (span - 0.08), look.visor ? yRB + 0.03 : yR, barZ - 0.1], 0.03, 0.03, 0.008, [1, 0, 0]))
    const pods = look.lights === 'full' ? 7 : 5
    for (let i = 0; i < pods; i++) {
      const x = mix(-span + 0.1, span - 0.1, i / (pods - 1))
      lampPod(b, i % 2 === 0 ? 'head' : 'lampAmber', x, barY + 0.06, barZ + 0.03, 0.05)
    }
  }
  if (look.lights === 'full') {
    const backZ = L.sleeperBackZ
    const top = L.sleeper ? L.sleeperTopY : L.roofY
    const y = top - 0.12
    b.add('chrome', tube([[-(L.hw - 0.15), y, backZ - 0.06], [L.hw - 0.15, y, backZ - 0.06]], 0.02, 10))
    for (let i = 0; i < 5; i++) {
      const x = mix(-(L.hw - 0.3), L.hw - 0.3, i / 4)
      b.add(i === 0 || i === 4 ? 'lampRed' : 'lampAmber', slab(x - 0.05, x + 0.05, y - 0.03, y + 0.03, backZ - 0.11, backZ - 0.07, 0.012))
    }
    for (const s of [1, -1] as const) {
      const [x0, x1] = xr(s, L.hw - 0.005, L.hw + 0.02)
      b.add('lampAmber', slab(x0, x1, L.cabFloorY + 0.1, L.cabFloorY + 0.16, L.doorBackZ - 0.06, L.doorBackZ + 0.02, 0.01))
    }
  }
}

function stripeRun(L: TruckLayout): [number, number] {
  const front = L.style === 'cabover' ? L.cabFrontZ - 0.1 : L.cabFrontZ - 0.08
  const back = (L.sleeper && L.style !== 'cabover' ? L.sleeperBackZ : L.cabBackZ) + 0.1
  return [front, back]
}

function stripes(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  const stripe = look.paint.stripe
  if (stripe === 'none') return
  const { hw, cabFloorY: yF, beltY: yB } = L
  const [zFront, zBack] = stripeRun(L)
  const parts: Array<[ 'accent' | 'secondary', VertexData]> = []
  for (const s of [1, -1] as const) {
    const x = s * hw
    if (stripe === 'pinstripe') {
      for (const dy of [0.075, 0.115]) parts.push(['accent', sideRibbon([[zFront, yB - dy], [zBack, yB - dy]], 0.016, x, 0.0025, s)])
    } else if (stripe === 'band') {
      const y = yF + L.lowerBand + 0.3
      parts.push(['secondary', sideRibbon([[zFront, y], [zBack, y]], 0.16, x, 0.0025, s)])
      parts.push(['accent', sideRibbon([[zFront, y + 0.1], [zBack, y + 0.1]], 0.016, x, 0.003, s)])
    } else if (stripe === 'twoTone') {
      const y0 = yF + L.lowerBand
      const y1 = yB - 0.16
      parts.push(['secondary', sideRibbon([[zFront, (y0 + y1) / 2], [zBack, (y0 + y1) / 2]], y1 - y0, x, 0.0025, s)])
      parts.push(['accent', sideRibbon([[zFront, y1 + 0.02], [zBack, y1 + 0.02]], 0.022, x, 0.003, s)])
    } else if (stripe === 'chevron') {
      const mid = yF + L.lowerBand + (yB - yF - L.lowerBand) * 0.45
      const rise = Math.min(0.32, (yB - yF - L.lowerBand) * 0.4)
      const tip = zFront - 0.25
      for (const [k, key] of [[0, 'secondary'], [1, 'accent'], [2, 'secondary']] as const) {
        const z = tip - k * 0.26
        if (z - 0.45 < zBack) break
        parts.push([key, sideRibbon([[z - 0.45, mid + rise], [z, mid], [z - 0.45, mid - rise]], k === 1 ? 0.05 : 0.11, x, 0.0025 + k * 0.0002, s)])
      }
    } else {
      const low = yF + L.lowerBand + 0.12
      const high = yB - 0.1
      const curve = bezier2([zFront, low], [mix(zFront, zBack, 0.35), low], [mix(zFront, zBack, 0.45), high], [zBack, high], 18)
      parts.push(['secondary', sideRibbon(curve, (t) => mix(0.24, 0.1, t), x, 0.0025, s)])
      const edge = curve.map(([z, y], i) => [z, y + mix(0.24, 0.1, i / (curve.length - 1)) / 2 + 0.02] as P2)
      parts.push(['accent', sideRibbon(edge, 0.016, x, 0.003, s)])
    }
  }
  for (const [key, part] of parts) b.add(key, part)
}

/** Writes the cab, sleeper and roof equipment of a truck into the batch. */
export function buildCab(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  cabShell(b, L)
  greenhouse(b, L)
  interior(b, L)
  doors(b, L, L.front === 'classic' || L.front === 'aero')
  for (const s of [1, -1]) {
    if (L.style === 'aero') aeroMirror(b, L, s)
    else westCoastMirror(b, L, s)
  }
  sleeperBox(b, L)
  roofFairing(b, L, look)
  roofEquipment(b, L, look)
  stripes(b, L, look)
}
