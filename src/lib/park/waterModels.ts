import { MeshBuilder, mat4, hexColor } from './gl'
import type { Vec3 } from './gl'
import { C, SHIRTS } from './models'
import type { Part, RideModel } from './models'
import { WAVE_SETTINGS } from '../../../server/park/index.mjs'

const T = mat4.translation
const WATER_DEEP = hexColor('#2f8fd0'), WATER_SHALLOW = hexColor('#6fd0ee'), FOAM = hexColor('#e9f8ff'), SAND = hexColor('#e8d29a'), HOUSE_BASE = hexColor('#dfe8f0')

function lounger(b: MeshBuilder, x: number, y: number, facing: number, color: Vec3) {
  const m = mat4.chain(T(x, y, 0.3), mat4.rotZ(facing))
  b.box(m, 0, 0, 0.25, 1.7, 0.7, 0.12, color)
  b.box(mat4.chain(m, T(-0.75, 0, 0.35), mat4.rotY(-0.5)), 0, 0, 0, 0.5, 0.7, 0.1, color)
  for (const dx of [-0.7, 0.7]) b.box(m, dx, 0, 0, 0.08, 0.6, 0.25, C.steel)
}

function parasol(b: MeshBuilder, x: number, y: number, color: Vec3) {
  b.cylinder(null, x, y, 0.3, 0.05, 0.05, 2.3, 5, C.dark)
  b.cylinder(null, x, y, 2.4, 1.3, 0, 0.55, 10, color)
}

export function wavePoolModel(w: number, h: number, wave: string): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const setting = WAVE_SETTINGS[wave] ?? WAVE_SETTINGS.rolling
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  const house = Math.min(3.4, W * 0.35)
  const side = Math.min(2, H * 0.28)
  const x0 = -W + house + 0.4, x1 = W - 0.4, y0 = -H + side, y1 = H - side
  const length = x1 - x0
  const beach = x0 + length * 0.68
  base.box(null, 0, 0, 0, W * 2, H * 2, 0.3, C.cream)
  base.quad(null, [x0, y0, 0.08], [x1, y0, 0.08], [x1, y1, 0.08], [x0, y1, 0.08], hexColor('#1f6fa8'))
  base.quad(null, [x0, y0, 0.32], [beach - 2, y0, 0.32], [beach - 2, y1, 0.32], [x0, y1, 0.32], WATER_DEEP)
  base.quad(null, [beach - 2, y0, 0.322], [beach + 0.6, y0, 0.33], [beach + 0.6, y1, 0.33], [beach - 2, y1, 0.322], WATER_SHALLOW)
  base.quad(null, [beach, y0, 0.31], [x1, y0, 0.42], [x1, y1, 0.42], [beach, y1, 0.31], SAND)
  for (const [y, sy] of [[y0 - 0.15, 0.3], [y1 + 0.15, 0.3]] as const) base.box(null, (x0 + beach) / 2, y, 0.3, beach - x0, sy, 0.12, C.white)
  base.box(null, x0 - 0.15, 0, 0.3, 0.3, y1 - y0 + 0.6, 0.12, C.white)
  base.box(null, -W + house / 2, 0, 0.3, house, H * 2 - 0.4, 4.2, HOUSE_BASE, 1)
  base.box(null, -W + house / 2, 0, 4.5, house + 0.5, H * 2, 0.35, C.white)
  for (let k = 0; k < Math.max(2, Math.floor((y1 - y0) / 2.2)); k++) {
    const y = y0 + 1 + k * 2.2
    if (y > y1 - 0.8) break
    base.box(null, -W + house + 0.02, y, 0.5, 0.06, 1.4, 1.6, C.dark)
    for (let r = 0; r < 4; r++) base.box(null, -W + house + 0.06, y, 0.7 + r * 0.38, 0.05, 1.3, 0.08, C.steel)
  }
  base.box(null, -W + house / 2, -H * 0.4, 4.85, house * 0.5, 0.35, 0.9, C.red)
  const rows = Math.max(2, Math.floor((beach - x0) / 3.2))
  for (const [y, facing] of [[-H + side / 2, Math.PI / 2], [H - side / 2, -Math.PI / 2]] as const) {
    for (let k = 0; k < rows; k++) {
      const x = beach + 0.6 + k * 2.2
      if (x > W - 1) break
      lounger(base, x, y, facing, k % 2 ? C.white : hexColor('#f2c94c'))
      if (k % 2 === 0) parasol(base, x + 1.1, y, k % 4 ? C.red : C.blue)
    }
  }
  const tx = (x0 + beach) / 2, ty = y1 + side * 0.45
  for (const dx of [-0.5, 0.5]) for (const dy of [-0.4, 0.4]) base.box(null, tx + dx, ty + dy, 0.3, 0.12, 0.12, 2.4, C.white)
  base.box(null, tx, ty, 2.6, 1.3, 1.1, 0.15, C.white)
  base.box(null, tx, ty + 0.4, 2.75, 1.3, 0.1, 0.6, C.red)
  base.cylinder(null, tx, ty, 3.4, 0.9, 0.2, 0.6, 8, C.red)
  const swells = Math.max(2, Math.min(7, Math.floor((beach - x0) / 4)))
  const span = beach - 1 - (x0 + 0.8)
  for (let k = 0; k < swells; k++) {
    const swell = new MeshBuilder()
    swell.box(null, 0, 0, 0, 1.4, y1 - y0 - 0.3, 0.32, FOAM)
    swell.box(null, -0.75, 0, 0, 0.6, y1 - y0 - 0.3, 0.2, WATER_SHALLOW)
    parts.push({ builder: swell, anim: t => {
      const p = ((t.spin * setting.speed * 0.11 + k / swells) % 1 + 1) % 1
      const lift = (t.running ? setting.height : 0.12) * Math.sin(Math.min(1, p * 1.4) * Math.PI) * (1 - p * 0.45)
      return mat4.chain(T(x0 + 0.8 + p * span, 0, 0.22), mat4.scaling(1, 1, Math.max(0.05, lift)))
    } })
  }
  const foam = new MeshBuilder()
  foam.box(null, 0, 0, 0, 0.5, y1 - y0, 0.06, FOAM)
  parts.push({ builder: foam, anim: t => T(beach - 0.4 + Math.sin(t.spin * setting.speed * 0.7) * (t.running ? 0.6 : 0.15), 0, 0.33) })
  const swimmers = Math.max(4, Math.min(16, Math.round(w * h / 6)))
  for (let k = 0; k < swimmers; k++) {
    const swimmer = new MeshBuilder()
    swimmer.sphere(null, 0, 0, 0.5, 0.22, C.skin, 0, 3, 6)
    swimmer.cylinder(null, 0, 0, 0.18, 0.45, 0.45, 0.16, 10, SHIRTS[(k * 5 + 2) % SHIRTS.length], 1)
    const fx = x0 + 1.2 + ((k * 0.618) % 1) * (beach - x0 - 1.8), fy = y0 + 0.7 + ((k * 0.4142 + 0.37) % 1) * (y1 - y0 - 1.4)
    parts.push({ builder: swimmer, anim: t => {
      const bob = Math.sin(t.spin * setting.speed * 1.8 + fx * 0.5 + k) * (t.running ? setting.height * 0.35 : 0.05)
      return mat4.chain(T(fx + Math.sin(t.spin * 0.3 + k) * 0.6, fy + Math.cos(t.spin * 0.25 + k) * 0.5, 0.15 + bob), mat4.rotZ(k))
    } })
  }
  return { base, parts }
}
