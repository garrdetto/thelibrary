import { MeshBuilder, mat4, hexColor } from './gl'
import type { Mat4, Vec3 } from './gl'
import { SLOT, LIGHTS, GLOW, bulb, bulbRun, bulbText, bulbTextWidth } from './neon'
import type { Part, RideAnim, RideModel } from './models'

// The Demo Derby: an 8 × 8 footprint split into a 5 × 8 walled dirt pad (x from
// -16 to 4) and 3 × 8 roofed bleachers for 200 (x from 4 to 16), the same
// county-fair derby as the Demo Derby learning module. Old full-size cars
// circle, back into each other and grind on the pad while the crowd bobs.
// Slot order: grandstand roof, chase lights, glow lights, bleachers, barrier
// stripes, light towers, sign letters.

const D = { main: 0, lights: LIGHTS, glow: GLOW, stands: 3, stripes: 4, towers: 5, sign: 6 }
const T = mat4.translation
const WHITE: Vec3 = [1, 1, 1]
const DIRT = hexColor('#8f6c46'), MUD = hexColor('#6e5134'), CONCRETE = hexColor('#c9c3b5'), STEEL = hexColor('#9aa3ad'), DARK = hexColor('#33363c')
const RUBBER = hexColor('#202226'), CHROME = hexColor('#d8b24a'), GLASS = hexColor('#9fd2ef'), SKIN = hexColor('#e8b48f'), WOOD = hexColor('#8a5a36')
const CAR_PAINTS = ['#b3261e', '#f5c21b', '#1d3a6b', '#8ed13a', '#ff6a1a', '#6a3b9c', '#e8e4d8', '#1f8f8a'].map(hexColor)
const SHIRTS = ['#e5483b', '#3b7be5', '#3fbf5f', '#f2c230', '#9b51e0', '#f08a24', '#1fb5b0', '#e85d9b', '#ffffff', '#2d3b55', '#8bc34a', '#c0392b'].map(hexColor)

export const DERBY_PAD = { x0: -16, x1: 4, y0: -16, y1: 16 }
export const DERBY_SEATS = { rows: 8, perRow: 25 }

function hash(n: number) { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v) }

/** A 1970s full-size derby car, nose along +x: body, greenhouse, glass band, chrome bumpers, wheels and a roof number disc. */
function derbyCar(b: MeshBuilder, m: Mat4 | null, paint: Vec3, wagon: boolean, wrecked: boolean) {
  const L = 5.4, W = 2.0, crumple = wrecked ? 0.25 : 0
  b.box(m, crumple / 2, 0, 0.32, L - crumple, W, 0.5, paint)
  b.box(m, L / 2 - 0.9, 0, 0.82, 1.7, W - 0.12, 0.06, paint)
  const cabinX = wagon ? 0.15 : 0.35, cabinL = wagon ? 3.1 : 2.3
  b.box(m, cabinX, 0, 0.82, cabinL + 0.04, W - 0.16, 0.38, GLASS)
  b.box(m, cabinX, 0, 1.2, cabinL, W - 0.2, 0.12, paint)
  b.cylinder(m, cabinX, 0, 1.32, 0.42, 0.42, 0.02, 12, WHITE)
  b.box(m, cabinX, 0, 1.335, 0.08, 0.36, 0.01, RUBBER)
  for (const side of [-1, 1]) b.cylinder(mat4.chain(m ?? mat4.identity(), T(0.2, side * (W / 2 + 0.005), 0.58), mat4.rotX(Math.PI / 2)), 0, 0, -0.01, 0.34, 0.34, 0.02, 12, WHITE)
  if (!wrecked) b.box(m, L / 2 + 0.06, 0, 0.36, 0.14, W + 0.04, 0.17, CHROME)
  b.box(m, -L / 2 - 0.06, 0, 0.36, 0.14, W + 0.04, 0.17, CHROME)
  for (const x of [-1.55, 1.55]) for (const y of [-0.86, 0.86]) {
    const sag = wrecked && x > 0 && y > 0 ? -0.12 : 0
    b.cylinder(mat4.chain(m ?? mat4.identity(), T(x, y, 0.36 + sag), mat4.rotX(Math.PI / 2)), 0, 0, -0.12, 0.36, 0.36, 0.24, 10, RUBBER)
  }
}

/** Jersey barrier: a wide foot and a narrow top, `len` long along local x. */
function barrier(b: MeshBuilder, m: Mat4, len: number, color: Vec3, tint: number) {
  b.box(m, 0, 0, 0, len - 0.06, 0.62, 0.3, color, tint)
  b.box(m, 0, 0, 0.3, len - 0.06, 0.42, 0.25, color, tint)
  b.box(m, 0, 0, 0.55, len - 0.06, 0.28, 0.3, color, tint)
}

function pad(base: MeshBuilder) {
  const { x0, x1, y0, y1 } = DERBY_PAD
  base.box(null, (x0 + x1) / 2, 0, 0, x1 - x0, y1 - y0, 0.14, DIRT)
  for (let k = 0; k < 14; k++) {
    const cx = -14 + hash(k) * 16, cy = -13 + hash(k + 40) * 26, r = 1 + hash(k + 80) * 2.2
    const pts = 9
    for (let i = 0; i < pts; i++) {
      const a0 = i / pts * Math.PI * 2, a1 = (i + 1) / pts * Math.PI * 2
      const r0 = r * (0.75 + hash(k * 13 + i) * 0.4), r1 = r * (0.75 + hash(k * 13 + ((i + 1) % pts)) * 0.4)
      base.tri(null, [cx, cy, 0.145], [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0 * 1.4, 0.145], [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1 * 1.4, 0.145], MUD)
    }
  }
  const inX0 = x0 + 1, inX1 = x1 - 1, inY0 = y0 + 1, inY1 = y1 - 1
  const run = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay), count = Math.round(len / 3), yaw = Math.atan2(by - ay, bx - ax)
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count
      const stripe = i % 3 === 1
      barrier(base, mat4.chain(T(ax + (bx - ax) * t, ay + (by - ay) * t, 0.14), mat4.rotZ(yaw)), len / count, stripe ? WHITE : CONCRETE, stripe ? SLOT[D.stripes] : 0)
    }
  }
  run(inX0, inY0, inX1, inY0)
  run(inX1, inY0, inX1, inY1)
  run(inX1, inY1, inX0, inY1)
  run(inX0, inY1, inX0, inY0)
  for (const [cx, cy] of [[inX0 + 1.1, inY0 + 1.1], [inX1 - 1.1, inY0 + 1.1], [inX1 - 1.1, inY1 - 1.1], [inX0 + 1.1, inY1 - 1.1]]) {
    for (let i = 0; i < 6; i++) {
      const dx = (i % 3 - 1) * 0.75 * Math.sign(-cx - 6), dy = (Math.floor(i / 3) - 0.5) * 0.75 * Math.sign(-cy)
      for (let level = 0; level < 2 - (i % 2); level++) base.cylinder(null, cx + dx, cy + dy, 0.14 + level * 0.26, 0.4, 0.4, 0.25, 10, RUBBER)
    }
  }
  derbyCar(base, mat4.chain(T(inX0 + 2.2, inY1 - 4.6, 0.14), mat4.rotZ(1.9), mat4.rotX(0.06)), CAR_PAINTS[7], true, true)
  derbyCar(base, mat4.chain(T(inX1 - 2.6, inY0 + 6.2, 0.14), mat4.rotZ(-0.35)), CAR_PAINTS[6], false, true)
  const towers: Vec3[] = [[x0 + 0.45, y0 + 0.45, 0], [x1 - 0.45, y0 + 0.45, 0], [x1 - 0.45, y1 - 0.45, 0], [x0 + 0.45, y1 - 0.45, 0]]
  for (const [tx, ty] of towers) {
    base.cylinder(null, tx, ty, 0, 0.22, 0.15, 12, 8, WHITE, SLOT[D.towers])
    const face = Math.atan2(-ty, -6 - tx)
    const head = mat4.chain(T(tx, ty, 12), mat4.rotZ(face))
    base.box(head, 0.25, 0, -0.1, 0.3, 2.2, 0.9, DARK)
    for (let i = 0; i < 6; i++) bulb(base, head, 0.42, -0.85 + (i % 3) * 0.85, 0.08 + Math.floor(i / 3) * 0.45, 0.17, D.glow, 0, 1)
    base.cylinder(mat4.chain(head, T(0.1, 1.3, 0.2), mat4.rotY(Math.PI / 2)), 0, 0, 0, 0.12, 0.32, 0.5, 8, DARK)
  }
  for (const [a, c] of [[0, 3], [1, 2], [0, 1], [3, 2]] as const) {
    const from = towers[a], to = towers[c], n = Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 1.1)
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, sag = Math.sin(t * Math.PI) * 1.8
      const px = from[0] + (to[0] - from[0]) * t, py = from[1] + (to[1] - from[1]) * t, pz = 11.2 - sag
      const ux = (to[0] - from[0]) / (n * 2.6), uy = (to[1] - from[1]) / (n * 2.6)
      base.tri(null, [px - ux, py - uy, pz], [px + ux, py + uy, pz], [px, py, pz - 0.55], WHITE, i % 2 ? SLOT[D.main] : SLOT[D.stripes])
      base.tri(null, [px + ux, py + uy, pz], [px - ux, py - uy, pz], [px, py, pz - 0.55], WHITE, i % 2 ? SLOT[D.main] : SLOT[D.stripes])
    }
  }
}

function stands(base: MeshBuilder, parts: Part[]) {
  const y0 = -15.4, y1 = 15.4, len = y1 - y0
  base.box(null, 10, 0, 0, 12, 32, 0.12, CONCRETE)
  for (let i = 0; i <= 12; i++) {
    const y = y0 + i * len / 12
    base.box(null, 4.35, y, 0.12, 0.08, 0.08, 2.6, STEEL)
  }
  for (const z of [0.9, 1.9, 2.7]) base.box(null, 4.35, 0, z, 0.06, len, 0.06, STEEL)
  const { rows, perRow } = DERBY_SEATS
  const depth = 1.12, rise = 0.55, front = 5.3
  for (let r = 0; r < rows; r++) {
    const x = front + r * depth, z = 0.5 + r * rise
    base.box(null, x - 0.35, 0, z - 0.42, 0.6, len, 0.07, WOOD)
    base.box(null, x + 0.1, 0, z, 0.42, len, 0.08, WHITE, SLOT[D.stands])
    base.box(null, x - 0.05, 0, 0.12, 0.05, len, z - 0.42 - 0.12, DARK)
    for (let k = 0; k <= 8; k++) base.box(null, x - 0.05, y0 + k * len / 8, 0.12, 0.12, 0.12, z - 0.12, STEEL)
  }
  const backX = front + rows * depth + 0.1, topZ = 0.5 + rows * rise
  base.box(null, backX, 0, 0.12, 0.2, len + 0.4, topZ + 1.2, WHITE, SLOT[D.stands])
  for (const side of [-1, 1]) {
    base.box(null, (front + backX) / 2, side * (len / 2 + 0.15), 0.12, backX - front + 0.8, 0.2, 1.1, STEEL)
    for (let s = 0; s < rows; s++) base.box(null, front - 0.5 + s * depth, side * (len / 2 + 0.7), 0.12 + s * rise, depth, 0.9, 0.1, CONCRETE)
  }
  const roofFront = 4.9, roofBack = 15.8, zFront = 8.0, zBack = 9.0
  for (let i = 0; i <= 5; i++) {
    const y = y0 + i * len / 5
    base.cylinder(null, roofBack - 0.4, y, 0.12, 0.16, 0.16, zBack - 0.1, 8, WHITE, SLOT[D.towers])
    base.cylinder(null, roofFront + 0.4, y, 0.12, 0.12, 0.12, zFront - 0.1, 8, WHITE, SLOT[D.towers])
    base.tube([[roofFront + 0.4, y, zFront - 0.05], [roofBack - 0.4, y, zBack - 0.05]], 0.12, STEEL, 6)
  }
  base.quad(null, [roofBack, y0 - 0.8, zBack], [roofBack, y1 + 0.8, zBack], [roofFront, y1 + 0.8, zFront], [roofFront, y0 - 0.8, zFront], WHITE, SLOT[D.main])
  base.quad(null, [roofFront, y0 - 0.8, zFront - 0.15], [roofFront, y1 + 0.8, zFront - 0.15], [roofBack, y1 + 0.8, zBack - 0.15], [roofBack, y0 - 0.8, zBack - 0.15], hexColor('#e8e4da'), 0)
  for (let i = 0; i < 16; i++) {
    const ya = y0 - 0.8 + i * (len + 1.6) / 16, yb = ya + (len + 1.6) / 16
    base.quad(null, [roofFront - 0.02, ya, zFront - 0.6], [roofFront - 0.02, yb, zFront - 0.6], [roofFront - 0.02, yb, zFront], [roofFront - 0.02, ya, zFront], WHITE, i % 2 ? SLOT[D.main] : 0)
  }
  const signZ = zFront + 0.1, signH = 2.4, signW = 18
  base.box(null, roofFront + 0.15, 0, signZ, 0.3, signW, signH, hexColor('#16181f'))
  const cell = Math.min(0.26, (signW - 1.6) / bulbTextWidth('DEMO DERBY'))
  bulbText(base, T(roofFront - 0.05, 0, signZ + signH / 2), 'DEMO DERBY', cell, 0.1, D.sign, 0, 0)
  bulbRun(base, null, [roofFront - 0.05, signW / 2 - 0.3, signZ + signH + 0.08], [roofFront - 0.05, -signW / 2 + 0.3, signZ + signH + 0.08], 34, 0.09, D.lights, 3, 0, 0)
  bulbRun(base, null, [roofFront - 0.05, signW / 2 - 0.3, signZ - 0.08], [roofFront - 0.05, -signW / 2 + 0.3, signZ - 0.08], 34, 0.09, D.lights, 3, 0.5, 0)
  const boothX = backX - 1.3, boothY = y0 + 2.4, boothZ = topZ + 0.1
  base.box(null, boothX, boothY, boothZ, 2.2, 3.2, 2.2, WHITE, SLOT[D.stands])
  base.box(null, boothX - 1.11, boothY, boothZ + 1.0, 0.04, 2.6, 0.9, GLASS)
  base.box(null, boothX, boothY, boothZ + 2.2, 2.6, 3.6, 0.15, WHITE, SLOT[D.main])

  const crowd = new MeshBuilder()
  for (let r = 0; r < rows; r++) {
    const x = front + r * depth + 0.12, z = 0.5 + r * rise + 0.08
    for (let s = 0; s < perRow; s++) {
      const n = r * perRow + s
      const y = y0 + 0.6 + (s + 0.5) * ((len - 1.2) / perRow) + (hash(n) - 0.5) * 0.3
      const shirt = SHIRTS[Math.floor(hash(n + 500) * SHIRTS.length)]
      crowd.box(null, x, y, z, 0.32, 0.42, 0.5, shirt)
      crowd.sphere(null, x - 0.02, y, z + 0.68, 0.14, SKIN, 0, 3, 5)
      if (hash(n + 900) < 0.3) crowd.cylinder(null, x - 0.02, y, z + 0.76, 0.16, 0.15, 0.08, 6, shirt)
    }
  }
  parts.push({ builder: crowd, anim: t => T(0, 0, t.running ? Math.abs(Math.sin(t.spin * 5.5)) * 0.06 : 0) })
}

/** One derby car's path round the pad: a wandering loop that keeps it inside the barriers, driving nose-first and now and then backing up. */
function carMotion(k: number) {
  const cx = -6, ax = 4.8, ay = 10.6
  const fx = 0.21 + k * 0.037, fy = 0.17 + k * 0.029, px = k * 1.9, py = k * 2.7
  return (t: RideAnim): Mat4 => {
    const s = t.spin * 2.2
    const x = cx + Math.sin(s * fx + px) * ax, y = Math.sin(s * fy + py) * ay
    const dx = Math.cos(s * fx + px) * fx * ax, dy = Math.cos(s * fy + py) * fy * ay
    const backing = Math.sin(s * 0.13 + k * 1.7) < -0.35
    const heading = Math.atan2(dy, dx) + (backing ? Math.PI : 0)
    const rock = t.running ? Math.sin(s * 3.1 + k) * 0.03 : 0
    return mat4.chain(T(x, y, 0.14), mat4.rotZ(heading), mat4.rotX(rock))
  }
}

export function demoDerbyModel(): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  pad(base)
  stands(base, parts)
  for (let k = 0; k < 6; k++) {
    const car = new MeshBuilder()
    derbyCar(car, null, CAR_PAINTS[k], k % 2 === 0, false)
    parts.push({ builder: car, anim: carMotion(k) })
  }
  return { base, parts }
}
