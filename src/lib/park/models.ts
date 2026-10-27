import { MeshBuilder, mat4, hexColor } from './gl'
import type { Mat4, Vec3 } from './gl'

export const C = {
  white: hexColor('#f3f1ea'), cream: hexColor('#efe3c4'), wood: hexColor('#8a5a36'), darkWood: hexColor('#5e3d24'), steel: hexColor('#9aa3ad'), dark: hexColor('#33363c'),
  leaf: hexColor('#4f8f3a'), leafDark: hexColor('#3b7030'), leafLight: hexColor('#7ab650'), pine: hexColor('#2f6b3f'), trunk: hexColor('#6b4a30'), birchBark: hexColor('#e9e6dc'),
  rock: hexColor('#8f8c86'), water: hexColor('#4d9bd6'), skin: hexColor('#e8b48f'), pants: hexColor('#3a4a6b'), gold: hexColor('#d8b24a'), red: hexColor('#d8432f'), blue: hexColor('#3a77d0'),
  green: hexColor('#3fae5c'), roof: hexColor('#ffffff'), stone: hexColor('#c9c3b5'), black: hexColor('#202226'), glass: hexColor('#9fd2ef'),
}

export const SHIRTS: Vec3[] = ['#e5483b', '#3b7be5', '#3fbf5f', '#f2c230', '#9b51e0', '#f08a24', '#1fb5b0', '#e85d9b', '#ffffff', '#2d3b55', '#8bc34a', '#c0392b', '#5dade2', '#f5b7b1', '#a3e4d7', '#6e2c00'].map(hexColor)

export function treeModel(kind: string): MeshBuilder {
  const b = new MeshBuilder()
  if (kind === 'oak') {
    b.cylinder(null, 0, 0, 0, 0.35, 0.25, 4, 6, C.trunk)
    b.sphere(null, 0, 0, 5.4, 2.5, C.leaf, 1, 5, 9)
    b.sphere(null, 1.1, 0.6, 4.6, 1.7, C.leafDark, 1, 4, 8)
    b.sphere(null, -1.0, -0.7, 4.8, 1.8, C.leaf, 1, 4, 8)
  } else if (kind === 'pine') {
    b.cylinder(null, 0, 0, 0, 0.3, 0.2, 2, 6, C.trunk)
    b.cylinder(null, 0, 0, 1.5, 2.3, 0, 4, 8, C.pine, 1, true)
    b.cylinder(null, 0, 0, 4, 1.8, 0, 3.6, 8, C.pine, 1, true)
    b.cylinder(null, 0, 0, 6.4, 1.2, 0, 3.6, 8, C.pine, 1, true)
  } else if (kind === 'birch') {
    b.cylinder(null, 0, 0, 0, 0.22, 0.16, 6, 6, C.birchBark)
    b.sphere(null, 0, 0, 6.6, 1.8, C.leafLight, 1, 5, 8, 1.4)
    b.sphere(null, 0.6, 0.3, 5.2, 1.3, C.leafLight, 1, 4, 7)
  } else if (kind === 'palm') {
    let x = 0, z = 0
    const pts: Vec3[] = []
    for (let i = 0; i <= 6; i++) { pts.push([x, 0, z]); x += 0.12 * i; z += 1.25 }
    b.tube(pts, 0.25, C.trunk, 6)
    const top = pts[pts.length - 1]
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2, m = mat4.chain(mat4.translation(top[0], top[1], top[2]), mat4.rotZ(a), mat4.rotY(0.45))
      b.quad(m, [0, -0.45, 0], [3.2, -0.15, -0.2], [3.2, 0.15, -0.2], [0, 0.45, 0], C.leaf, 1)
      b.quad(m, [0, 0.45, 0], [3.2, 0.15, -0.2], [3.2, -0.15, -0.2], [0, -0.45, 0], C.leaf, 1)
    }
    b.sphere(null, top[0], 0, top[2] - 0.2, 0.5, C.trunk)
  } else if (kind === 'bush') {
    b.sphere(null, 0, 0, 0.7, 1.2, C.leafDark, 1, 4, 8, 0.75)
    b.sphere(null, 0.6, 0.4, 0.6, 0.8, C.leaf, 1, 4, 7, 0.8)
  } else if (kind === 'flowers') {
    b.cylinder(null, 0, 0, 0, 1.4, 1.4, 0.25, 10, C.darkWood)
    b.cylinder(null, 0, 0, 0.24, 1.3, 1.3, 0.05, 10, C.leafDark)
    const petals: Vec3[] = [hexColor('#f25c78'), hexColor('#f9d23c'), hexColor('#ffffff'), hexColor('#b05ce0')]
    for (let k = 0; k < 14; k++) { const a = k * 2.4, r = 0.3 + (k % 4) * 0.25; b.sphere(null, Math.cos(a) * r, Math.sin(a) * r, 0.42, 0.18, petals[k % 4], 0, 3, 5) }
  } else if (kind === 'hedge') {
    b.box(null, 0, 0, 0, 3.6, 1.2, 1.5, C.leafDark, 1)
  } else if (kind === 'rock') {
    b.sphere(null, 0, 0, 0.3, 1.5, C.rock, 0, 4, 7, 0.65)
    b.sphere(null, 0.9, 0.5, 0.2, 0.8, C.rock, 0, 3, 6, 0.8)
  } else if (kind === 'fountain') {
    b.cylinder(null, 0, 0, 0, 1.8, 1.8, 0.6, 14, C.stone)
    b.cylinder(null, 0, 0, 0.55, 1.6, 1.6, 0.05, 14, C.water)
    b.cylinder(null, 0, 0, 0.6, 0.3, 0.25, 1.8, 8, C.stone)
    b.cylinder(null, 0, 0, 2.3, 0.9, 0.9, 0.2, 10, C.stone)
    b.sphere(null, 0, 0, 2.6, 0.55, C.water, 0, 4, 8, 1.6)
  } else if (kind === 'statue') {
    b.box(null, 0, 0, 0, 1.4, 1.4, 1.4, C.stone)
    b.cylinder(null, 0, 0, 1.4, 0.35, 0.3, 1.8, 8, C.gold)
    b.sphere(null, 0, 0, 3.6, 0.45, C.gold)
    b.box(null, 0.5, 0, 2.6, 0.9, 0.2, 0.2, C.gold)
  } else if (kind === 'topiary') {
    b.cylinder(null, 0, 0, 0, 0.6, 0.6, 0.6, 8, C.darkWood)
    b.cylinder(null, 0, 0, 0.6, 0.1, 0.1, 1.2, 5, C.trunk)
    b.sphere(null, 0, 0, 2.2, 0.9, C.leafDark, 1, 5, 8)
    b.sphere(null, 0, 0, 3.4, 0.55, C.leafDark, 1, 4, 7)
  }
  return b
}

export function personModel(staffHat = false): MeshBuilder {
  const b = new MeshBuilder()
  b.box(null, 0, -0.12, 0, 0.18, 0.18, 0.8, C.pants)
  b.box(null, 0, 0.12, 0, 0.18, 0.18, 0.8, C.pants)
  b.box(null, 0, 0, 0.78, 0.32, 0.5, 0.62, C.white, 1)
  b.box(null, 0, -0.32, 0.88, 0.14, 0.14, 0.5, C.skin)
  b.box(null, 0, 0.32, 0.88, 0.14, 0.14, 0.5, C.skin)
  b.sphere(null, 0, 0, 1.58, 0.2, C.skin, 0, 4, 7)
  if (staffHat) b.cylinder(null, 0, 0, 1.7, 0.24, 0.22, 0.14, 8, C.white, 1)
  return b
}

export function balloonModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.box(null, 0.25, 0, 0.9, 0.02, 0.02, 1.6, C.white)
  b.sphere(null, 0.25, 0, 2.7, 0.32, C.white, 1, 4, 7, 1.2)
  return b
}

export function umbrellaModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.box(null, 0, 0, 1.1, 0.04, 0.04, 1.1, C.dark)
  b.cylinder(null, 0, 0, 2.1, 0.8, 0, 0.35, 8, C.white, 1, true)
  return b
}

export function stallModel(kind: string): MeshBuilder {
  const b = new MeshBuilder()
  if (kind === 'toilet') {
    b.box(null, 0, 0, 0, 3.2, 3.2, 2.6, C.cream)
    b.box(null, 0, 0, 2.6, 3.5, 3.5, 0.3, C.white, 1)
    b.box(null, 1.62, -0.7, 0.1, 0.06, 0.8, 1.9, C.blue)
    b.box(null, 1.62, 0.7, 0.1, 0.06, 0.8, 1.9, hexColor('#d04f7a'))
    return b
  }
  b.box(null, -0.4, 0, 0, 2.4, 3.0, 1.1, C.cream)
  b.box(null, 0.85, 0, 0, 0.5, 3.0, 1.15, C.white, 1)
  b.box(null, 0.95, 0, 1.15, 0.7, 3.1, 0.08, C.wood)
  for (const y of [-1.4, 1.4]) b.box(null, 0.9, y, 1.2, 0.12, 0.12, 1.5, C.white)
  b.box(null, -0.9, 0, 1.1, 1.4, 3.0, 1.6, C.cream)
  for (let i = 0; i < 6; i++) {
    const y0 = -1.7 + i * (3.4 / 6), y1 = y0 + 3.4 / 6, col = i % 2 ? C.white : C.white
    const m = null
    b.quad(m, [1.45, y0, 2.7], [1.45, y1, 2.7], [-1.7, y1, 3.3], [-1.7, y0, 3.3], col, i % 2 ? 1 : 0)
    b.quad(m, [-1.7, y0, 3.3], [-1.7, y1, 3.3], [1.45, y1, 2.7], [1.45, y0, 2.7], col, i % 2 ? 1 : 0)
  }
  b.box(null, -0.2, 0, 3.3, 0.5, 2.4, 0.9, C.white, 1)
  return b
}

export function gateModel(): MeshBuilder {
  const b = new MeshBuilder()
  for (const y of [-1.5, 1.5]) b.box(null, 0, y, 0, 0.45, 0.45, 2.8, C.white, 1)
  b.box(null, 0, 0, 2.8, 0.7, 3.6, 0.6, C.white, 1)
  b.box(null, 0, 0, 0, 3.8, 3.6, 0.12, C.stone)
  return b
}

export function parkEntranceModel(): MeshBuilder {
  const b = new MeshBuilder()
  for (const x of [-6.5, 6.5]) {
    b.box(null, x, 0, 0, 3, 3, 7, C.cream)
    b.cylinder(null, x, 0, 7, 2.1, 0, 2.6, 4, C.white, 1)
  }
  b.box(null, 0, 0, 5.2, 10, 1.4, 1.6, C.white, 1)
  b.box(null, 0, -0.75, 5.4, 8.6, 0.1, 1.2, C.cream)
  for (const x of [-3, 0, 3]) b.box(null, x, 0, 0, 0.3, 0.3, 5.2, C.dark)
  b.box(null, 0, 0, 0, 16, 4, 0.15, C.stone)
  return b
}

export function benchModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.box(null, 1.4, 0, 0.45, 0.5, 1.6, 0.08, C.wood)
  b.box(null, 1.62, 0, 0.5, 0.08, 1.6, 0.6, C.wood)
  for (const y of [-0.7, 0.7]) b.box(null, 1.4, y, 0, 0.4, 0.08, 0.45, C.dark)
  return b
}

export function binModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.cylinder(null, 1.45, 1.45, 0, 0.32, 0.36, 0.9, 8, hexColor('#2f6b45'))
  b.cylinder(null, 1.45, 1.45, 0.9, 0.38, 0.3, 0.1, 8, C.dark)
  return b
}

export function lampPostModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.cylinder(null, -1.5, -1.5, 0, 0.1, 0.07, 3.6, 6, C.dark)
  return b
}

export function lampHeadModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.sphere(null, -1.5, -1.5, 3.75, 0.28, hexColor('#fff3c4'), 0, 4, 7)
  return b
}

export function litterModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.box(null, 0, 0, 0.02, 0.3, 0.22, 0.04, C.white, 1)
  b.box(null, 0.4, 0.3, 0.02, 0.18, 0.18, 0.05, C.white, 1)
  return b
}

export type Part = { builder: MeshBuilder; anim: (t: RideAnim, index: number) => Mat4 }
export type RideAnim = { spin: number; phase: string; timer: number; running: boolean; speed: number }
export type RideModel = { base: MeshBuilder; parts: Part[] }

const T = mat4.translation

export function flatRideModel(kind: string, w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const floor = (r: number, color: Vec3 = C.stone) => base.cylinder(null, 0, 0, 0, r, r, 0.4, 16, color)
  if (kind === 'carousel') {
    floor(5.4)
    base.cylinder(null, 0, 0, 0.4, 0.45, 0.45, 5.4, 10, C.gold)
    const top = new MeshBuilder()
    top.cylinder(null, 0, 0, 0.4, 4.9, 4.9, 0.25, 18, hexColor('#b9824f'))
    for (let i = 0; i < 12; i++) {
      const a0 = i / 12 * Math.PI * 2, a1 = (i + 1) / 12 * Math.PI * 2
      top.tri(null, [Math.cos(a0) * 5.3, Math.sin(a0) * 5.3, 4.6], [Math.cos(a1) * 5.3, Math.sin(a1) * 5.3, 4.6], [0, 0, 6.6], i % 2 ? C.white : C.red, i % 2 ? 0 : 1)
      top.quad(null, [Math.cos(a0) * 5.3, Math.sin(a0) * 5.3, 4.0], [Math.cos(a1) * 5.3, Math.sin(a1) * 5.3, 4.0], [Math.cos(a1) * 5.3, Math.sin(a1) * 5.3, 4.6], [Math.cos(a0) * 5.3, Math.sin(a0) * 5.3, 4.6], i % 2 ? C.red : C.white, i % 2 ? 1 : 0)
    }
    top.sphere(null, 0, 0, 6.8, 0.35, C.gold)
    parts.push({ builder: top, anim: t => mat4.rotZ(t.spin * 0.8) })
    for (let k = 0; k < 8; k++) {
      const horse = new MeshBuilder()
      horse.box(null, 0, 0, 0, 0.07, 0.07, 3.6, C.gold)
      horse.box(null, 0, 0, 1.2, 0.5, 1.4, 0.55, k % 2 ? C.white : hexColor('#c9a27a'))
      horse.box(null, 0, 0.75, 1.5, 0.35, 0.4, 0.7, k % 2 ? C.white : hexColor('#c9a27a'))
      const a = k / 8 * Math.PI * 2
      parts.push({ builder: horse, anim: t => mat4.chain(mat4.rotZ(t.spin * 0.8 + a), T(3.6, 0, 0.6 + Math.sin(t.spin * 2.4 + k * 1.3) * 0.35 * (t.running ? 1 : 0))) })
    }
  } else if (kind === 'teacups') {
    floor(5.6, hexColor('#d7c7a7'))
    const plate = new MeshBuilder()
    plate.cylinder(null, 0, 0, 0.4, 5, 5, 0.2, 18, hexColor('#7fb9d8'), 1)
    parts.push({ builder: plate, anim: t => mat4.rotZ(t.spin * 0.4) })
    for (let k = 0; k < 6; k++) {
      const cup = new MeshBuilder()
      cup.cylinder(null, 0, 0, 0, 0.9, 1.25, 1.1, 12, k % 2 ? C.white : hexColor('#f4a3c0'), k % 2 ? 0 : 1)
      cup.cylinder(null, 0, 0, 0.6, 0.15, 0.15, 0.8, 6, C.gold)
      cup.cylinder(null, 0, 0, 1.4, 0.6, 0.6, 0.08, 10, C.gold)
      const a = k / 6 * Math.PI * 2
      parts.push({ builder: cup, anim: t => mat4.chain(mat4.rotZ(t.spin * 0.4 + a), T(3.2, 0, 0.6), mat4.rotZ(t.spin * (1.2 + k * 0.25))) })
    }
  } else if (kind === 'ferris') {
    base.box(null, 0, 0, 0, w * 4 - 1, h * 4 - 1, 0.3, C.stone)
    for (const y of [-2.2, 2.2]) for (const x of [-3.5, 3.5]) base.tube([[x, y, 0.3], [0, y * 0.8, 9.3]], 0.25, C.white, 6)
    base.tube([[0, -2.3, 9.3], [0, 2.3, 9.3]], 0.3, C.dark, 8)
    const wheel = new MeshBuilder()
    for (const y of [-1.4, 1.4]) {
      const pts: Vec3[] = []
      for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; pts.push([Math.cos(a) * 7.4, y, Math.sin(a) * 7.4]) }
      wheel.tube(pts, 0.16, C.white, 5, 1)
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; wheel.tube([[0, y, 0], [Math.cos(a) * 7.4, y, Math.sin(a) * 7.4]], 0.06, C.white, 4) }
    }
    parts.push({ builder: wheel, anim: t => mat4.chain(T(0, 0, 9.3), mat4.rotY(t.spin * 0.25)) })
    for (let k = 0; k < 8; k++) {
      const car = new MeshBuilder()
      car.box(null, 0, 0, -1.9, 1.5, 1.6, 1.3, hexColor('#f0f0f0'), 1)
      car.box(null, 0, 0, -0.6, 0.06, 0.06, 0.7, C.dark)
      car.box(null, 0, 0, -0.65, 1.7, 1.7, 0.12, C.white, 1)
      const a = k / 8 * Math.PI * 2
      parts.push({ builder: car, anim: t => T(Math.cos(a - t.spin * 0.25) * 7.4, 0, 9.3 + Math.sin(a - t.spin * 0.25) * 7.4) })
    }
  } else if (kind === 'swings') {
    floor(5.6)
    base.cylinder(null, 0, 0, 0.4, 0.6, 0.45, 10, 10, C.white, 1)
    const crown = new MeshBuilder()
    crown.cylinder(null, 0, 0, 9.4, 3.6, 3.2, 0.7, 16, C.white, 1)
    crown.cylinder(null, 0, 0, 10.1, 3.2, 0.3, 1.6, 16, C.red)
    parts.push({ builder: crown, anim: t => mat4.rotZ(t.spin * 1.1) })
    for (let k = 0; k < 12; k++) {
      const seat = new MeshBuilder()
      seat.box(null, 0, -0.25, -5.2, 0.03, 0.03, 5.2, C.dark)
      seat.box(null, 0, 0.25, -5.2, 0.03, 0.03, 5.2, C.dark)
      seat.box(null, 0, 0, -5.4, 0.55, 0.6, 0.2, k % 2 ? C.blue : C.gold)
      const a = k / 12 * Math.PI * 2
      parts.push({ builder: seat, anim: t => mat4.chain(mat4.rotZ(t.spin * 1.1 + a), T(3.4, 0, 9.6), mat4.rotY(-Math.min(1, t.speed) * 0.85)) })
    }
  } else if (kind === 'bumper') {
    const S = w * 2 - 0.4
    base.box(null, 0, 0, 0, S * 2, S * 2, 0.3, C.dark)
    for (const [x, y, sx, sy] of [[0, -S, S * 2, 0.3], [0, S, S * 2, 0.3], [-S, 0, 0.3, S * 2], [S, 0, 0.3, S * 2]] as const) base.box(null, x, y, 0.3, sx, sy, 0.5, C.gold)
    for (const x of [-S + 0.3, S - 0.3]) for (const y of [-S + 0.3, S - 0.3]) base.box(null, x, y, 0, 0.3, 0.3, 4, C.white)
    base.box(null, 0, 0, 4, S * 2 + 0.6, S * 2 + 0.6, 0.3, hexColor('#c2483a'), 1)
    for (let k = 0; k < 7; k++) {
      const car = new MeshBuilder()
      car.box(null, 0, 0, 0.3, 1.6, 1.1, 0.5, [C.red, C.blue, C.green, C.gold, hexColor('#9b51e0'), hexColor('#f08a24'), C.white][k])
      car.box(null, -0.4, 0, 0.8, 0.1, 0.1, 3.2, C.dark)
      car.sphere(null, 0.1, 0, 1.1, 0.2, C.skin)
      const fx = 0.7 + k * 0.13, fy = 0.9 + k * 0.11, ph = k * 1.7
      parts.push({ builder: car, anim: t => { const s = t.spin; const x = Math.sin(s * fx + ph) * (S - 1.5), y = Math.sin(s * fy + ph * 1.3) * (S - 1.5); const dx = Math.cos(s * fx + ph) * fx, dy = Math.cos(s * fy + ph * 1.3) * fy; return mat4.chain(T(x, y, 0.3), mat4.rotZ(Math.atan2(dy, dx))) } })
    }
  } else if (kind === 'ship') {
    base.box(null, 0, 0, 0, w * 4 - 1, h * 4 - 1, 0.3, C.stone)
    for (const x of [-1.5, 1.5]) for (const y of [-4.5, 4.5]) base.tube([[x * 2.2, y, 0.3], [0, y * 0.9, 11]], 0.28, C.dark, 6)
    base.tube([[0, -4.4, 11], [0, 4.4, 11]], 0.3, C.dark, 8)
    const hull = new MeshBuilder()
    const L = 7, Wd = 2.3, D = 1.8
    for (const s of [-1, 1]) {
      hull.quad(null, [-L, s * Wd * 0.4, -8.2], [L, s * Wd * 0.4, -8.2], [L, s * Wd, -8.2 + D], [-L, s * Wd, -8.2 + D], hexColor('#7a4a2c'))
      hull.quad(null, [-L, s * Wd, -8.2 + D], [L, s * Wd, -8.2 + D], [L, s * Wd * 0.4, -8.2], [-L, s * Wd * 0.4, -8.2], hexColor('#7a4a2c'))
    }
    hull.box(null, 0, 0, -8.3, L * 2, Wd * 0.8, 0.2, hexColor('#5b341c'))
    hull.box(null, 0, 0, -7.0, L * 2 - 1, Wd * 1.8, 0.15, hexColor('#b98a5c'))
    for (const x of [-L, L]) hull.box(null, x, 0, -8.2, 0.4, Wd * 2, 2.6, hexColor('#7a4a2c'))
    hull.tube([[0, 0, -7], [0, 0, -0.2]], 0.15, C.dark, 6)
    for (const x of [-3, 3]) hull.tube([[x, 0, -6.8], [0, 0, 0]], 0.18, C.dark, 6)
    hull.quad(null, [-2.5, 0.1, -6.6], [2.5, 0.1, -6.6], [2.5, 0.1, -3], [-2.5, 0.1, -3], C.white, 1)
    hull.quad(null, [2.5, -0.1, -6.6], [-2.5, -0.1, -6.6], [-2.5, -0.1, -3], [2.5, -0.1, -3], C.white, 1)
    parts.push({ builder: hull, anim: t => mat4.chain(T(0, 0, 11), mat4.rotY(Math.sin(t.spin * 0.9) * Math.min(1.1, t.timer * 0.08) * (t.running ? 1 : 0))) })
  } else if (kind === 'dropTower') {
    floor(4.8)
    base.box(null, 0, 0, 0.4, 1.6, 1.6, 36, C.white, 1)
    base.cylinder(null, 0, 0, 36.4, 1.4, 0, 2.2, 8, C.red)
    const carriage = new MeshBuilder()
    carriage.cylinder(null, 0, 0, 0, 2.8, 2.8, 1.0, 14, C.dark)
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; carriage.box(null, Math.cos(a) * 2.6, Math.sin(a) * 2.6, -0.6, 0.5, 0.5, 1.2, k % 2 ? C.gold : C.red) }
    parts.push({ builder: carriage, anim: t => { if (!t.running) return T(0, 0, 1.2); const s = t.timer; const z = s < 14 ? 1.2 + s / 14 * 28 : s < 17 ? 29.2 : s < 18.6 ? 29.2 - Math.pow((s - 17) / 1.6, 2) * 26 : Math.max(1.2, 3.2 - (s - 18.6) * 0.5); return T(0, 0, z) } })
  } else if (kind === 'topSpin') {
    base.box(null, 0, 0, 0, w * 4 - 1, h * 4 - 1, 0.3, C.stone)
    for (const y of [-3.4, 3.4]) base.box(null, 0, y, 0.3, 1.2, 0.8, 7.5, C.white, 1)
    const arm = new MeshBuilder()
    for (const y of [-3, 3]) arm.box(null, 0, y, -5, 0.6, 0.5, 5.6, C.red)
    const gondola = new MeshBuilder()
    gondola.box(null, 0, 0, -0.6, 2.2, 5.4, 1.3, C.gold, 1)
    for (let k = 0; k < 6; k++) gondola.sphere(null, 0.3, -2.2 + k * 0.88, 0.9, 0.2, C.skin)
    parts.push({ builder: arm, anim: t => mat4.chain(T(0, 0, 7.6), mat4.rotY(t.running ? Math.sin(t.spin * 0.6) * 2.6 + t.spin * 0.3 : 0)) })
    parts.push({ builder: gondola, anim: t => { const a = t.running ? Math.sin(t.spin * 0.6) * 2.6 + t.spin * 0.3 : 0; return mat4.chain(T(0, 0, 7.6), mat4.rotY(a), T(0, 0, -5), mat4.rotY(t.running ? Math.sin(t.spin * 1.4) * 3 : -a)) } })
  } else if (kind === 'karts') {
    const W = w * 2 - 0.3, H = h * 2 - 0.3
    base.box(null, 0, 0, 0, W * 2, H * 2, 0.15, hexColor('#5f9f45'))
    const lane = (rx: number, ry: number, z: number, col: Vec3, width: number) => {
      for (let i = 0; i < 40; i++) {
        const a0 = i / 40 * Math.PI * 2, a1 = (i + 1) / 40 * Math.PI * 2
        const p = (a: number, r: number): Vec3 => [Math.cos(a) * (rx + r), Math.sin(a) * (ry + r), z]
        base.quad(null, p(a0, -width), p(a1, -width), p(a1, width), p(a0, width), col)
      }
    }
    lane(W - 3.2, H - 3.2, 0.16, hexColor('#3b3e44'), 1.6)
    lane(W - 3.2, H - 3.2, 0.18, C.white, 0.06)
    for (let i = 0; i < 40; i++) {
      const a = (i + 0.5) / 40 * Math.PI * 2
      for (const r of [-1.75, 1.75]) base.box(null, Math.cos(a) * (W - 3.2 + r), Math.sin(a) * (H - 3.2 + r), 0.15, 0.5, 0.5, 0.25, i % 2 ? C.red : C.white)
    }
    for (const [x, y, sx, sy] of [[0, -H, W * 2, 0.15], [0, H, W * 2, 0.15], [-W, 0, 0.15, H * 2], [W, 0, 0.15, H * 2]] as const) base.box(null, x, y, 0.15, sx, sy, 0.9, C.white, 1)
    base.box(null, 0, -0.2, 0.15, 3.5, 1.6, 2.4, C.cream)
    base.box(null, 0, -0.2, 2.55, 4, 2, 0.2, C.white, 1)
    for (let k = 0; k < 6; k++) {
      const kart = new MeshBuilder()
      const col = [C.red, C.blue, C.green, C.gold, hexColor('#9b51e0'), hexColor('#f08a24')][k]
      kart.box(null, 0, 0, 0.12, 1.5, 0.9, 0.35, col)
      kart.box(null, 0.55, 0, 0.12, 0.4, 1.0, 0.2, C.dark)
      for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) kart.cylinder(mat4.chain(T(x, y, 0.18), mat4.rotX(Math.PI / 2)), 0, 0, -0.08, 0.18, 0.18, 0.16, 8, C.black)
      kart.sphere(null, -0.15, 0, 0.75, 0.22, col)
      const speed = 0.55 + k * 0.035, offset = k * 1.05
      parts.push({ builder: kart, anim: t => { const a = offset + (t.running ? t.spin * speed : 0); const rx = W - 3.2 + (k % 2 ? 0.6 : -0.6), ry = H - 3.2 + (k % 2 ? 0.6 : -0.6); return mat4.chain(T(Math.cos(a) * rx, Math.sin(a) * ry, 0.16), mat4.rotZ(Math.atan2(Math.cos(a) * ry, -Math.sin(a) * rx))) } })
    }
  } else if (kind === 'pool') {
    const W = w * 2 - 0.3, H = h * 2 - 0.3
    base.box(null, 0, 0, 0, W * 2, H * 2, 0.3, C.cream)
    const pw = W - 2.4, ph = H - 2.6
    base.quad(null, [-pw, -ph, 0.1], [pw, -ph, 0.1], [pw, ph, 0.1], [-pw, ph, 0.1], hexColor('#36a3e0'))
    base.quad(null, [-pw, -ph, 0.32], [pw, -ph, 0.32], [pw, ph, 0.32], [-pw, ph, 0.32], hexColor('#6ccaf5'))
    for (const [x, y, sx, sy] of [[0, -ph, pw * 2 + 0.6, 0.3], [0, ph, pw * 2 + 0.6, 0.3], [-pw, 0, 0.3, ph * 2], [pw, 0, 0.3, ph * 2]] as const) base.box(null, x, y, 0.3, sx, sy, 0.12, C.white)
    base.box(null, pw - 0.6, 0, 0.42, 0.08, 1.6, 0.9, C.steel)
    for (let k = 0; k < 4; k++) {
      const x = -W + 2.5 + k * ((W * 2 - 5) / 3)
      base.box(null, x, H - 1.1, 0.3, 0.8, 1.8, 0.25, C.white)
      base.cylinder(null, x + 0.9, H - 1.1, 0.3, 0.05, 0.05, 2.2, 5, C.dark)
      base.cylinder(null, x + 0.9, H - 1.1, 2.3, 1.2, 0, 0.5, 8, k % 2 ? C.red : C.white, k % 2 ? 0 : 1)
    }
    for (let k = 0; k < 8; k++) {
      const swimmer = new MeshBuilder()
      swimmer.sphere(null, 0, 0, 0.42, 0.22, C.skin, 0, 3, 6)
      swimmer.box(null, -0.35, 0, 0.32, 0.6, 0.3, 0.05, SHIRTS[(k * 5) % SHIRTS.length])
      const cx = (k % 4 - 1.5) * pw * 0.45, cy = (Math.floor(k / 4) - 0.5) * ph * 0.8, r = 0.8 + (k % 3) * 0.3
      parts.push({ builder: swimmer, anim: t => { const a = t.spin * 0.5 + k * 0.9; return mat4.chain(T(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7, Math.sin(t.spin * 2 + k) * 0.06), mat4.rotZ(a + Math.PI / 2)) } })
    }
  } else if (kind === 'waterslide') {
    const S = w * 2 - 0.3
    base.box(null, 0, 0, 0, S * 2, S * 2, 0.3, C.cream)
    base.quad(null, [-S + 1, 1, 0.34], [S - 1, 1, 0.34], [S - 1, S - 1, 0.34], [-S + 1, S - 1, 0.34], hexColor('#6ccaf5'))
    for (const [x, y, sx, sy] of [[0, 1, S * 2 - 2, 0.3], [0, S - 1, S * 2 - 2, 0.3], [-S + 1, (S) / 2, 0.3, S - 2], [S - 1, S / 2, 0.3, S - 2]] as const) base.box(null, x, y, 0.3, sx, sy, 0.15, C.white)
    const tx = -S + 2.4, ty = -S + 2.4
    for (const dx of [-1.1, 1.1]) for (const dy of [-1.1, 1.1]) base.box(null, tx + dx, ty + dy, 0.3, 0.3, 0.3, 12.5, C.white, 1)
    base.box(null, tx, ty, 12.5, 3, 3, 0.25, C.wood)
    base.box(null, tx, ty, 12.75, 3, 0.1, 1, C.white, 1)
    for (let z = 1.5; z < 12; z += 1.6) base.box(null, tx + 1.4, ty, z, 0.2, 2.6, 0.12, C.wood)
    const helix: Vec3[] = []
    const hx = 1.5, hy = -1.5, R = 4.2, turns = 2.25
    for (let i = 0; i <= 90; i++) { const u = i / 90, a = Math.PI * 1.25 + u * turns * Math.PI * 2; helix.push([hx + Math.cos(a) * R, hy + Math.sin(a) * R, 12.3 - u * 11.4]) }
    helix.unshift([tx + 1.2, ty + 0.3, 12.6])
    base.tube(helix, 0.75, C.white, 8, 1)
    base.cylinder(null, hx, hy, 0.3, 0.35, 0.35, 12, 6, C.white)
    const straight: Vec3[] = [[tx, ty + 1.5, 12.6], [tx + 1, 3, 8], [tx + 2, S - 3, 2.2], [tx + 2.4, S - 2, 0.8]]
    base.tube(straight, 0.6, hexColor('#f2c94c'), 8)
    for (let k = 0; k < 4; k++) {
      const rider = new MeshBuilder()
      rider.sphere(null, 0, 0, 0.75, 0.25, C.skin, 0, 3, 6)
      rider.box(null, 0, 0, 0.4, 0.5, 0.35, 0.35, SHIRTS[(k * 3 + 1) % SHIRTS.length])
      parts.push({ builder: rider, anim: t => {
        if (!t.running) return T(tx, ty, 12.8 + k * 0.01)
        const u = ((t.spin * 0.12 + k / 4) % 1)
        if (k % 2) { const i = u * (straight.length - 1), j = Math.min(straight.length - 2, Math.floor(i)), f = i - j, a = straight[j], b = straight[j + 1]; return T(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f - 0.3) }
        const p = helix[Math.min(helix.length - 1, Math.floor(u * (helix.length - 1)))]
        return T(p[0], p[1], p[2] - 0.45)
      } })
    }
  }
  return { base, parts }
}

export function carModel(style: string, front: boolean, riders: number): MeshBuilder {
  const b = new MeshBuilder()
  const inverted = style === 'inverted'
  const z0 = inverted ? -2.1 : 0.15
  b.box(null, 0, 0, z0, 2.0, 1.35, 0.75, C.white, 1)
  if (front) b.quad(null, [1.0, -0.67, z0 + 0.75], [1.0, 0.67, z0 + 0.75], [1.5, 0.5, z0 + 0.2], [1.5, -0.5, z0 + 0.2], C.white, 1)
  b.box(null, 0.1, 0, z0 + 0.7, 0.18, 1.2, 0.5, C.dark)
  b.box(null, -0.6, 0, z0 + 0.7, 0.18, 1.2, 0.5, C.dark)
  if (inverted) { b.box(null, 0, 0, -1.4, 0.4, 0.4, 1.4, C.dark); b.box(null, 0, 0, -0.1, 1.6, 0.9, 0.3, C.dark) }
  else for (const x of [-0.7, 0.7]) for (const y of [-0.6, 0.6]) b.cylinder(null, x, y, -0.15, 0.16, 0.16, 0.12, 6, C.dark, 0, true)
  const seats = [[0.35, -0.32], [0.35, 0.32], [-0.35, -0.32], [-0.35, 0.32]]
  for (let k = 0; k < Math.min(riders, 4); k++) b.sphere(null, seats[k][0], seats[k][1], z0 + 1.15, 0.2, C.skin, 0, 3, 6)
  return b
}
