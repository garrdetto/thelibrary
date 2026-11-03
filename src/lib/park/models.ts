import { MeshBuilder, mat4, hexColor, STRIDE } from './gl'
import type { Mat4, Vec3 } from './gl'
import { M } from './materials'

export const C = {
  white: hexColor('#f3f1ea'), cream: hexColor('#efe3c4'), wood: hexColor('#8a5a36'), darkWood: hexColor('#5e3d24'), steel: hexColor('#9aa3ad'), dark: hexColor('#33363c'),
  leaf: hexColor('#4f8f3a'), leafDark: hexColor('#3b7030'), leafLight: hexColor('#7ab650'), pine: hexColor('#2f6b3f'), trunk: hexColor('#6b4a30'), birchBark: hexColor('#e9e6dc'),
  rock: hexColor('#8f8c86'), water: hexColor('#4d9bd6'), skin: hexColor('#e8b48f'), pants: hexColor('#3a4a6b'), gold: hexColor('#d8b24a'), red: hexColor('#d8432f'), blue: hexColor('#3a77d0'),
  green: hexColor('#3fae5c'), roof: hexColor('#ffffff'), stone: hexColor('#c9c3b5'), black: hexColor('#202226'), glass: hexColor('#9fd2ef'),
}

export const SHIRTS: Vec3[] = ['#e5483b', '#3b7be5', '#3fbf5f', '#f2c230', '#9b51e0', '#f08a24', '#1fb5b0', '#e85d9b', '#ffffff', '#2d3b55', '#8bc34a', '#c0392b', '#5dade2', '#f5b7b1', '#a3e4d7', '#6e2c00'].map(hexColor)

const S = mat4.scaling

const colorKey = (r: number, g: number, b: number) => (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)
const AUTO_MATERIALS = new Map<number, number>()
const tag = (mat: number, ...colors: Vec3[]) => { for (const c of colors) AUTO_MATERIALS.set(colorKey(c[0], c[1], c[2]), mat) }
tag(M.structural, C.dark)
tag(M.chrome, C.gold, hexColor('#d8b24a'))
tag(M.wood, C.wood, C.darkWood, hexColor('#7a4a2c'), hexColor('#8b6038'), hexColor('#563b27'), hexColor('#786247'), hexColor('#b39a73'), hexColor('#c9a27a'), hexColor('#6b4a2c'))
tag(M.concrete, C.stone, hexColor('#9b9b95'), hexColor('#e5d7c2'), hexColor('#d8c9a2'))
tag(M.steel, C.steel)
tag(M.foliage, C.leaf, C.leafDark, C.leafLight, C.pine, hexColor('#4f8f3a'))
tag(M.bark, C.trunk, C.birchBark, hexColor('#6b4a30'))
tag(M.stone, C.rock, hexColor('#8f8c86'))
tag(M.water, C.water)
tag(M.glass, C.glass, hexColor('#8fd3e8'), hexColor('#6fd0ee'), hexColor('#6ccaf5'), hexColor('#9fd2ef'))
tag(M.rubber, C.black, hexColor('#2a2a2a'), hexColor('#2b2b2b'), hexColor('#2c2a26'))
tag(M.skin, C.skin)
MeshBuilder.autoMaterial = (r, g, b, tint) => AUTO_MATERIALS.get(colorKey(r, g, b)) ?? (tint > 0.5 ? M.ridePaint : M.paint)

const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const foliage = (low: Vec3, high: Vec3) => (n: Vec3): Vec3 => mix3(low, high, Math.max(0, Math.min(1, n[2] * 0.55 + 0.5)))

export function treeModel(kind: string): MeshBuilder {
  const b = new MeshBuilder()
  if (kind === 'oak') {
    b.cylinder(null, 0, 0, 0, 0.62, 0.38, 0.45, 12, C.trunk, 0, false)
    b.limb([0, 0, 0.3], [0.12, 0.05, 3.6], 0.4, 0.24, C.trunk)
    for (const [x, y, z] of [[1.3, 0.5, 4.3], [-1.1, -0.6, 4.4], [0.2, -1.2, 4.6], [-0.3, 1.1, 4.8]] as const) b.limb([0.08, 0, 2.7], [x, y, z], 0.16, 0.07, C.trunk, 0, 7)
    const shade = foliage(mix3(C.leafDark, [0.12, 0.2, 0.1], 0.35), C.leafLight)
    for (const [x, y, z, r] of [[0, 0, 5.4, 2.3], [1.4, 0.6, 4.8, 1.6], [-1.3, -0.7, 4.9, 1.7], [0.4, -1.4, 5.0, 1.5], [-0.6, 1.3, 5.5, 1.5], [0.1, 0.1, 6.7, 1.5], [1.0, -0.4, 6.1, 1.25], [-1.0, 0.2, 6.2, 1.2]] as const) b.sphere(null, x, y, z, r, C.leaf, 1, 7, 10, 0.85, 0.32, shade)
  } else if (kind === 'pine') {
    b.limb([0, 0, 0], [0, 0, 8.2], 0.32, 0.08, C.trunk)
    const tiers = 6
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1), z = 1.2 + t * 6.2, r = 2.7 - t * 2.05, h = 2.5 - t * 0.9
      b.cylinder(null, 0, 0, z, r, 0, h, 16, mix3(mix3(C.pine, [0.08, 0.2, 0.12], 0.4), mix3(C.pine, C.leafLight, 0.25), t), 1, true)
      b.cylinder(null, 0, 0, z - 0.02, r * 0.98, r * 0.55, 0.01, 16, mix3(C.pine, [0.05, 0.12, 0.07], 0.6), 1, false)
    }
  } else if (kind === 'birch') {
    b.limb([0, 0, 0], [0.05, 0, 7.0], 0.21, 0.11, C.birchBark)
    for (let i = 0; i < 9; i++) {
      const z = 0.6 + i * 0.68, a = i * 2.1, r = 0.2 - i * 0.009
      b.box(mat4.chain(mat4.translation(0, 0, z), mat4.rotZ(a)), r, 0, 0, 0.03, 0.16, 0.06, hexColor('#2c2a26'))
    }
    b.limb([0, 0, 4.6], [0.9, 0.4, 5.9], 0.08, 0.04, C.birchBark, 0, 6)
    b.limb([0, 0, 5.2], [-0.8, -0.3, 6.5], 0.07, 0.04, C.birchBark, 0, 6)
    const shade = foliage(mix3(C.leafLight, C.leafDark, 0.55), mix3(C.leafLight, [1, 1, 0.7], 0.15))
    for (const [x, y, z, r] of [[0, 0, 6.8, 1.6], [0.8, 0.4, 5.9, 1.15], [-0.7, -0.3, 6.2, 1.1], [0.2, -0.6, 7.8, 1.05], [-0.2, 0.6, 7.4, 1.0]] as const) b.sphere(null, x, y, z, r, C.leafLight, 1, 6, 10, 1.35, 0.3, shade)
  } else if (kind === 'palm') {
    let x = 0, z = 0
    const pts: Vec3[] = []
    for (let i = 0; i <= 8; i++) { pts.push([x, 0, z]); x += 0.07 * i; z += 0.95 }
    for (let i = 0; i < pts.length - 1; i++) {
      b.limb(pts[i], pts[i + 1], 0.3 - i * 0.012, 0.27 - i * 0.012, i % 2 ? C.trunk : mix3(C.trunk, [0.75, 0.6, 0.42], 0.25), 0, 10)
      b.limb(pts[i + 1], [pts[i + 1][0], 0, pts[i + 1][2] + 0.12], 0.3 - i * 0.012, 0.25 - i * 0.012, mix3(C.trunk, [0.2, 0.14, 0.08], 0.4), 0, 10)
    }
    const top = pts[pts.length - 1]
    const leafLow = mix3(C.leaf, [0.15, 0.3, 0.12], 0.4)
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * Math.PI * 2 + (k % 2) * 0.2
      const m = mat4.chain(mat4.translation(top[0], top[1], top[2]), mat4.rotZ(a))
      const seg = 7, len = 3.6 + (k % 3) * 0.4
      for (let i = 0; i < seg; i++) {
        const u0 = i / seg, u1 = (i + 1) / seg
        const p = (u: number, side: number): Vec3 => [u * len, side * 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.25 + 0.05)), 0.5 * u * len * 0.45 - u * u * len * 0.7]
        const c0 = mix3(leafLow, C.leaf, u0), c1 = mix3(leafLow, C.leaf, u1)
        b.quad(m, p(u0, -1), p(u1, -1), p(u1, 0), p(u0, 0), mix3(c0, c1, 0.5), 1)
        b.quad(m, p(u0, 0), p(u1, 0), p(u1, 1), p(u0, 1), mix3(c0, c1, 0.5), 1)
        b.quad(m, p(u0, 0), p(u1, 0), p(u1, -1), p(u0, -1), mix3(c0, c1, 0.5), 1)
        b.quad(m, p(u0, 1), p(u1, 1), p(u1, 0), p(u0, 0), mix3(c0, c1, 0.5), 1)
      }
    }
    for (const [dx, dy] of [[0.25, 0.1], [-0.15, 0.22], [0.0, -0.25]] as const) b.sphere(null, top[0] + dx, top[1] + dy, top[2] - 0.35, 0.2, hexColor('#5a3b1c'), 0, 6, 8)
  } else if (kind === 'bush') {
    const shade = foliage(mix3(C.leafDark, [0.1, 0.18, 0.08], 0.4), C.leaf)
    for (const [x, y, z, r] of [[0, 0, 0.7, 1.15], [0.75, 0.45, 0.55, 0.85], [-0.7, 0.35, 0.5, 0.8], [0.2, -0.65, 0.5, 0.8]] as const) b.sphere(null, x, y, z, r, C.leafDark, 1, 6, 9, 0.8, 0.3, shade)
  } else if (kind === 'flowers') {
    b.cylinder(null, 0, 0, 0, 1.45, 1.4, 0.28, 24, C.darkWood)
    b.cylinder(null, 0, 0, 0.27, 1.32, 1.32, 0.04, 24, hexColor('#4a3726'))
    const leafShade = foliage(C.leafDark, C.leaf)
    for (let k = 0; k < 10; k++) { const a = k * 2.4, r = 0.35 + (k % 3) * 0.32; b.sphere(null, Math.cos(a) * r, Math.sin(a) * r, 0.36, 0.3, C.leafDark, 1, 5, 8, 0.55, 0.3, leafShade) }
    const petals: Vec3[] = [hexColor('#f25c78'), hexColor('#f9d23c'), hexColor('#ffffff'), hexColor('#b05ce0'), hexColor('#ff8a3d')]
    for (let k = 0; k < 26; k++) { const a = k * 2.399, r = 0.15 + Math.sqrt(k / 26) * 1.05; b.sphere(null, Math.cos(a) * r, Math.sin(a) * r, 0.55 + (k % 3) * 0.05, 0.12, petals[k % petals.length], 0, 3, 5, 0.7) }
  } else if (kind === 'hedge') {
    b.box(null, 0, 0, 0, 3.4, 1.0, 1.2, C.leafDark, 1)
    const shade = foliage(mix3(C.leafDark, [0.08, 0.15, 0.07], 0.4), C.leaf)
    for (let i = 0; i < 5; i++) b.sphere(null, -1.4 + i * 0.7, 0, 0.85, 0.72, C.leafDark, 1, 6, 8, 1.0, 0.22, shade)
  } else if (kind === 'rock') {
    const shade = foliage(mix3(C.rock, [0.3, 0.3, 0.28], 0.4), mix3(C.rock, [0.85, 0.84, 0.8], 0.3))
    b.sphere(null, 0, 0, 0.25, 1.5, C.rock, 0, 9, 13, 0.62, 0.5, shade)
    b.sphere(null, 1.0, 0.6, 0.15, 0.75, C.rock, 0, 7, 10, 0.75, 0.55, shade)
    b.sphere(null, -0.9, 0.7, 0.05, 0.45, C.rock, 0, 6, 9, 0.7, 0.5, shade)
  } else if (kind === 'fountain') {
    b.cylinder(null, 0, 0, 0, 1.85, 1.8, 0.6, 28, C.stone)
    b.cylinder(null, 0, 0, 0.6, 1.85, 1.6, 0.08, 28, mix3(C.stone, [1, 1, 1], 0.2))
    b.cylinder(null, 0, 0, 0.52, 1.58, 1.58, 0.05, 28, C.water)
    b.cylinder(null, 0, 0, 0.6, 0.32, 0.22, 1.7, 14, C.stone)
    b.cylinder(null, 0, 0, 2.2, 0.95, 0.6, 0.25, 20, C.stone)
    b.cylinder(null, 0, 0, 2.42, 0.85, 0.85, 0.04, 20, C.water)
    const spray = mix3(C.water, [1, 1, 1], 0.55)
    b.cylinder(null, 0, 0, 2.42, 0.09, 0.02, 1.25, 10, spray)
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2
      for (let i = 1; i <= 6; i++) { const u = i / 6, r = u * 0.85, z = 3.6 + Math.sin(u * Math.PI) * 0.25 - u * u * 1.1; b.sphere(null, Math.cos(a) * r, Math.sin(a) * r, z, 0.07 - u * 0.02, spray, 0, 3, 5, 1.6) }
    }
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2 + 0.2
      for (let i = 1; i <= 5; i++) { const u = i / 5, r = 0.85 + u * 0.6, z = 2.45 - u * u * 1.85; b.sphere(null, Math.cos(a) * r, Math.sin(a) * r, z, 0.055, spray, 0, 3, 5, 1.6) }
    }
  } else if (kind === 'statue') {
    b.box(null, 0, 0, 0, 1.6, 1.6, 0.3, C.stone)
    b.box(null, 0, 0, 0.3, 1.3, 1.3, 1.1, mix3(C.stone, [1, 1, 1], 0.12))
    b.box(null, 0, 0, 1.4, 1.5, 1.5, 0.15, C.stone)
    addPerson(b, { scale: 1.25, z: 1.55, skin: C.gold, shirt: C.gold, pants: C.gold, shoes: C.gold, hair: C.gold, hairStyle: 'short', phase: -1, pose: 'wave' })
  } else if (kind === 'topiary') {
    b.cylinder(null, 0, 0, 0, 0.55, 0.65, 0.6, 16, hexColor('#9a5a3a'))
    b.cylinder(null, 0, 0, 0.6, 0.68, 0.68, 0.08, 16, hexColor('#7a4a2e'))
    b.limb([0, 0, 0.6], [0, 0, 2.0], 0.08, 0.06, C.trunk, 0, 8)
    const shade = foliage(mix3(C.leafDark, [0.08, 0.15, 0.07], 0.4), C.leaf)
    b.sphere(null, 0, 0, 2.2, 0.9, C.leafDark, 1, 12, 16, 1, 0.08, shade)
    b.sphere(null, 0, 0, 3.45, 0.55, C.leafDark, 1, 10, 14, 1, 0.08, shade)
  }
  const height = TREE_HEIGHT[kind] ?? 0
  if (height) b.retag((r, g, bb, tint, _z, mat) => mat === M.paint && tint > 0.5 && g > r && g > bb ? M.foliage : mat === M.ridePaint && g > r && g > bb ? M.foliage : undefined, (z, mat) => {
    const k = Math.max(0, Math.min(1, z / height))
    return mat === M.foliage ? k * k : mat === M.bark ? k * k * 0.45 : 0
  })
  return b
}

const TREE_HEIGHT: Record<string, number> = { oak: 7.5, pine: 9, birch: 8, palm: 7.5, bush: 2.2, flowers: 1.4, hedge: 2.2, topiary: 4 }

export type PersonLook = { skin: Vec3; hair: Vec3; hairStyle: 'short' | 'long' | 'buzz' | 'cap' | 'bun'; pants: Vec3; shoes: Vec3; shorts?: boolean; cap?: Vec3 }

export const GUEST_LOOKS: PersonLook[] = [
  { skin: hexColor('#e8b48f'), hair: hexColor('#4a3020'), hairStyle: 'short', pants: hexColor('#3a4a6b'), shoes: hexColor('#efefef') },
  { skin: hexColor('#c68a62'), hair: hexColor('#1e1612'), hairStyle: 'long', pants: hexColor('#2b2b30'), shoes: hexColor('#2a2a2a') },
  { skin: hexColor('#8d5b3f'), hair: hexColor('#151010'), hairStyle: 'buzz', pants: hexColor('#7a6a52'), shoes: hexColor('#ffffff') },
  { skin: hexColor('#f0c4a4'), hair: hexColor('#c99a4e'), hairStyle: 'long', pants: hexColor('#5a6f8f'), shoes: hexColor('#d8433a') },
  { skin: hexColor('#a8704c'), hair: hexColor('#2a1c14'), hairStyle: 'cap', pants: hexColor('#3c4f3a'), shoes: hexColor('#efefef'), cap: hexColor('#c8342a') },
  { skin: hexColor('#e3a585'), hair: hexColor('#7a3a1e'), hairStyle: 'bun', pants: hexColor('#c8b48a'), shoes: hexColor('#5a3a2a'), shorts: true },
  { skin: hexColor('#6e4630'), hair: hexColor('#120c0a'), hairStyle: 'short', pants: hexColor('#44607a'), shoes: hexColor('#2a2a2a'), shorts: true },
  { skin: hexColor('#f3d0b4'), hair: hexColor('#8a8a86'), hairStyle: 'short', pants: hexColor('#5a5650'), shoes: hexColor('#3a2a22') },
]
export const STAFF_LOOK: PersonLook = { skin: hexColor('#d9a27c'), hair: hexColor('#3a2a1e'), hairStyle: 'short', pants: hexColor('#2e3440'), shoes: hexColor('#1e1e22') }
export const WALK_FRAMES = 8

type PersonOpts = PersonLook & { scale?: number; z?: number; shirt?: Vec3; shirtTint?: number; phase: number; staffHat?: boolean; pose?: 'wave'; detail?: number }

function hairCap(b: MeshBuilder, cx: number, cy: number, cz: number, r: number, squash: number, color: Vec3, front: number, side: number, back: number, tint = 0, rings = 6, segs = 14) {
  const lowAt = (p: number) => { const f = (1 + Math.cos(p)) / 2; const sd = Math.abs(Math.sin(p)); return front * f * (1 - sd) + side * sd + back * (1 - f) * (1 - sd) }
  for (let j = 0; j < segs; j++) {
    const p0 = j / segs * Math.PI * 2, p1 = (j + 1) / segs * Math.PI * 2
    const l0 = lowAt(p0), l1 = lowAt(p1)
    for (let i = 0; i < rings; i++) {
      const tt = (l: number, k: number) => l + (Math.PI / 2 - l) * k / rings
      const P = (t: number, p: number): Vec3 => [cx + Math.cos(t) * Math.cos(p) * r, cy + Math.cos(t) * Math.sin(p) * r, cz + Math.sin(t) * r * squash]
      const N = (t: number, p: number): Vec3 => { const x = Math.cos(t) * Math.cos(p), y = Math.cos(t) * Math.sin(p), z = Math.sin(t) / squash, l = Math.hypot(x, y, z); return [x / l, y / l, z / l] }
      const a = [tt(l0, i), p0] as const, bb = [tt(l1, i), p1] as const, c = [tt(l1, i + 1), p1] as const, d = [tt(l0, i + 1), p0] as const
      b.smoothTri(null, null, P(...a), P(...bb), P(...c), N(...a), N(...bb), N(...c), color, color, color, tint)
      if (i < rings - 1) b.smoothTri(null, null, P(...a), P(...c), P(...d), N(...a), N(...c), N(...d), color, color, color, tint)
    }
  }
}

export function addPerson(b: MeshBuilder, o: PersonOpts) {
  const sc = o.scale ?? 1, oz = o.z ?? 0, hi = (o.detail ?? 1) > 0
  const n = (k: number) => hi ? k : Math.max(4, Math.round(k * 0.5))
  const P = (x: number, y: number, z: number): Vec3 => [x * sc, y * sc, oz + z * sc]
  const shirt = o.shirt ?? C.white, st = o.shirtTint ?? 1
  const walking = o.phase >= 0, ph = walking ? o.phase : 0
  const thighL = 0.44, shinL = 0.42, hipZ = 0.93
  const leg = (side: number) => {
    const q = ph + (side > 0 ? 0 : Math.PI)
    const a = walking ? 0.42 * Math.sin(q) : 0
    const k = walking ? 0.06 + 0.55 * Math.max(0, Math.cos(q)) * (Math.sin(q) > -0.2 ? 1 : 0.4) : 0.04
    const knee: Vec3 = [Math.sin(a) * thighL, 0, -Math.cos(a) * thighL]
    const ankle: Vec3 = [knee[0] + Math.sin(a - k) * shinL, 0, knee[2] - Math.cos(a - k) * shinL]
    return { knee, ankle, footPitch: walking ? Math.max(-0.5, Math.min(0.5, (a - k) * 0.8)) : 0 }
  }
  const L = leg(1), R = leg(-1)
  const drop = (thighL + shinL * Math.cos(0.04)) - Math.max(-L.ankle[2], -R.ankle[2])
  const bob = walking ? -drop : 0
  const H = hipZ + bob
  for (const [side, g] of [[1, L], [-1, R]] as const) {
    const y = side * 0.1
    const hip: Vec3 = [0, y, H], knee: Vec3 = [g.knee[0], y, H + g.knee[2]], ankle: Vec3 = [g.ankle[0], y * 0.95, H + g.ankle[2]]
    b.limb(P(...hip), P(...knee), 0.085 * sc, 0.06 * sc, o.pants, 0, n(10))
    if (hi) b.sphere(null, ...P(...knee), 0.06 * sc, o.shorts ? o.skin : o.pants, 0, 5, 8)
    b.limb(P(...knee), P(...ankle), 0.06 * sc, 0.042 * sc, o.shorts ? o.skin : o.pants, 0, n(10))
    const m = mat4.chain(mat4.translation(...P(ankle[0] + 0.05, ankle[1], Math.max(0.05, ankle[2] - 0.04))), mat4.rotY(g.footPitch), S(1.75 * sc, 0.8 * sc, 0.62 * sc))
    b.sphere(m, 0, 0, 0, 0.075, o.shoes, 0, n(6), n(10))
  }
  b.sphere(mat4.chain(mat4.translation(...P(0, 0, H + 0.04)), S(0.72, 1, 0.62)), 0, 0, 0, 0.19 * sc, o.pants, 0, n(7), n(12))
  const torso = mat4.chain(mat4.translation(...P(0, 0, H + 0.02)), mat4.rotY(walking ? 0.06 : 0), S(0.7, 1, 1))
  b.cylinder(torso, 0, 0, 0, 0.17 * sc, 0.215 * sc, 0.43 * sc, hi ? 16 : 8, shirt, st, false)
  b.sphere(mat4.chain(mat4.translation(...P(walking ? 0.03 : 0, 0, H + 0.45)), S(0.7, 1, 0.42)), 0, 0, 0, 0.215 * sc, shirt, st, n(7), n(14))
  const neckBase = P(walking ? 0.035 : 0, 0, H + 0.5), headC: Vec3 = P(walking ? 0.05 : 0.01, 0, H + 0.71)
  b.limb(neckBase, P(walking ? 0.045 : 0.01, 0, H + 0.62), 0.05 * sc, 0.045 * sc, o.skin, 0, n(8))
  b.sphere(null, ...headC, 0.108 * sc, o.skin, 0, n(9), n(12), 1.2)
  b.sphere(mat4.chain(mat4.translation(headC[0] + 0.035 * sc, headC[1], headC[2] - 0.07 * sc), S(1, 1.05, 0.8)), 0, 0, 0, 0.068 * sc, o.skin, 0, n(6), n(10))
  if (hi) b.sphere(null, headC[0] + 0.106 * sc, headC[1], headC[2] - 0.012 * sc, 0.02 * sc, o.skin, 0, 4, 6, 1.3)
  if (hi) for (const side of [1, -1]) {
    b.sphere(null, headC[0] + 0.09 * sc, headC[1] + side * 0.042 * sc, headC[2] + 0.02 * sc, 0.014 * sc, hexColor('#1c1410'), 0, 4, 6)
    b.sphere(null, headC[0] - 0.005 * sc, headC[1] + side * 0.106 * sc, headC[2], 0.024 * sc, o.skin, 0, 4, 6, 1.4)
  }
  const hr = 0.116 * sc
  if (o.hairStyle === 'buzz') hairCap(b, headC[0] - 0.006 * sc, headC[1], headC[2] + 0.004 * sc, 0.112 * sc, 1.2, o.hair, 0.55, 0.15, -0.55, 0, hi ? 6 : 3, hi ? 14 : 8)
  else if (o.hairStyle === 'cap') {
    hairCap(b, headC[0] - 0.008 * sc, headC[1], headC[2] + 0.005 * sc, hr, 1.2, o.hair, 0.4, 0.05, -0.65, 0, hi ? 6 : 3, hi ? 14 : 8)
    const capC = o.cap ?? C.red
    hairCap(b, headC[0] - 0.004 * sc, headC[1], headC[2] + 0.012 * sc, hr * 1.04, 1.2, capC, 0.42, 0.32, 0.25, 0, hi ? 6 : 3, hi ? 14 : 8)
    b.cylinder(mat4.chain(mat4.translation(headC[0] + 0.085 * sc, headC[1], headC[2] + 0.055 * sc), mat4.rotY(0.18), S(1.4, 1.05, 1)), 0, 0, 0, 0.075 * sc, 0.075 * sc, 0.012 * sc, 14, capC)
  } else {
    hairCap(b, headC[0] - 0.008 * sc, headC[1], headC[2] + 0.006 * sc, hr, 1.2, o.hair, 0.48, o.hairStyle === 'long' ? -0.75 : 0.05, o.hairStyle === 'long' ? -1.15 : -0.7, 0, hi ? 6 : 3, hi ? 14 : 8)
    if (o.hairStyle === 'long') b.sphere(mat4.chain(mat4.translation(headC[0] - 0.07 * sc, headC[1], headC[2] - 0.2 * sc), S(0.45, 1, 1.25)), 0, 0, 0, 0.11 * sc, o.hair, 0, n(6), n(10))
    if (o.hairStyle === 'bun') b.sphere(null, headC[0] - 0.1 * sc, headC[1], headC[2] + 0.08 * sc, 0.055 * sc, o.hair, 0, 6, 8)
  }
  if (o.staffHat) {
    b.cylinder(null, headC[0] - 0.01 * sc, headC[1], headC[2] + 0.07 * sc, 0.125 * sc, 0.118 * sc, 0.09 * sc, 16, C.white, 1)
    b.cylinder(mat4.chain(mat4.translation(headC[0] + 0.08 * sc, headC[1], headC[2] + 0.075 * sc), mat4.rotY(0.12), S(1.5, 1.1, 1)), 0, 0, 0, 0.07 * sc, 0.07 * sc, 0.012 * sc, 12, C.white, 1)
  }
  for (const side of [1, -1]) {
    const q = ph + (side > 0 ? Math.PI : 0)
    const swing = walking ? 0.38 * Math.sin(q) : 0.04
    const shoulder: Vec3 = [walking ? 0.02 : 0, side * 0.215, H + 0.4]
    const wave = o.pose === 'wave' && side > 0
    const ua = wave ? [0.25, 0.32, 0.22] : [Math.sin(swing) * 0.29, 0.035 * side, -Math.cos(swing) * 0.29]
    const elbow: Vec3 = [shoulder[0] + ua[0], shoulder[1] + ua[1] * (wave ? side : 1), shoulder[2] + ua[2]]
    const bend = wave ? 0 : 0.25 + (walking ? Math.max(0, Math.sin(q)) * 0.35 : 0)
    const fa = wave ? [0.05, 0.05, 0.27] : [Math.sin(swing + bend) * 0.26, 0.01 * side, -Math.cos(swing + bend) * 0.26]
    const wrist: Vec3 = [elbow[0] + fa[0], elbow[1] + fa[1] * (wave ? side : 1), elbow[2] + fa[2]]
    b.sphere(null, ...P(...shoulder), 0.075 * sc, shirt, st, n(6), n(10))
    b.limb(P(...shoulder), P(...elbow), 0.064 * sc, 0.05 * sc, shirt, st, n(9))
    if (hi) b.sphere(null, ...P(...elbow), 0.048 * sc, o.skin, 0, 4, 8)
    b.limb(P(...elbow), P(...wrist), 0.047 * sc, 0.036 * sc, o.skin, 0, n(9))
    const hand = mat4.chain(mat4.translation(...P(wrist[0] + fa[0] * 0.18, wrist[1], wrist[2] + fa[2] * 0.18)), S(0.7, 0.55, 1))
    b.sphere(hand, 0, 0, 0, 0.055 * sc, o.skin, 0, n(5), n(8))
  }
}

export function personModel(look: PersonLook, frame: number, staffHat = false, detail = 1): MeshBuilder {
  const b = new MeshBuilder()
  addPerson(b, { ...look, staffHat, detail, phase: frame >= WALK_FRAMES ? -1 : frame / WALK_FRAMES * Math.PI * 2 })
  const skin = colorKey(look.skin[0], look.skin[1], look.skin[2]), shoes = colorKey(look.shoes[0], look.shoes[1], look.shoes[2])
  b.retag((r, g, bb) => { const k = colorKey(r, g, bb); return k === skin ? M.skin : k === shoes ? M.rubber : M.cloth })
  return b
}

export function balloonModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.limb([0.2, -0.24, 0.9], [0.25, -0.2, 2.42], 0.008, 0.008, C.white, 0, 4)
  b.sphere(null, 0.25, -0.2, 2.75, 0.32, C.white, 1, 10, 14, 1.22)
  b.cylinder(null, 0.25, -0.2, 2.34, 0.03, 0.06, 0.07, 8, C.white, 1)
  return b
}

export function umbrellaModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.limb([0.12, -0.22, 1.05], [0.12, -0.12, 2.15], 0.018, 0.018, C.dark, 0, 6)
  b.cylinder(null, 0.12, -0.12, 1.92, 0.85, 0.05, 0.38, 16, C.white, 1, true)
  b.sphere(null, 0.12, -0.12, 2.31, 0.05, C.dark, 0, 4, 6)
  return b
}

function scaleBuilder(builder: MeshBuilder, sx: number, sy: number, sz: number) {
  for (let i = 0; i < builder.data.length; i += STRIDE) {
    builder.data[i] *= sx; builder.data[i + 1] *= sy; builder.data[i + 2] *= sz
    const nx = builder.data[i + 3] / sx, ny = builder.data[i + 4] / sy, nz = builder.data[i + 5] / sz
    const length = Math.hypot(nx, ny, nz) || 1
    builder.data[i + 3] = nx / length; builder.data[i + 4] = ny / length; builder.data[i + 5] = nz / length
  }
}

export function stallModel(kind: string, size?: [number, number]): MeshBuilder {
  const b = new MeshBuilder()
  if (kind === 'toilet') {
    b.box(null, 0, 0, -0.05, 3.4, 3.4, 0.15, mix3(C.stone, [0.4, 0.38, 0.35], 0.3))
    b.box(null, 0, 0, 0, 3.1, 3.1, 2.5, C.cream)
    for (const [x, y] of [[1.55, 1.55], [1.55, -1.55], [-1.55, 1.55], [-1.55, -1.55]] as const) b.cylinder(null, x, y, 0, 0.12, 0.12, 2.5, 10, C.white, 1)
    b.box(null, 0, 0, 2.45, 3.4, 3.4, 0.14, C.white, 1)
    const r = 1.95, top = 3.55
    for (const s2 of [-1, 1]) {
      b.quad(null, [-r, s2 * r, 2.59], [r, s2 * r, 2.59], [r, 0, top], [-r, 0, top], hexColor('#8a4a3a'))
      b.quad(null, [r, s2 * r, 2.59], [-r, s2 * r, 2.59], [-r, 0, top], [r, 0, top], hexColor('#8a4a3a'))
      b.tri(null, [s2 * 1.7, -1.7, 2.59], [s2 * 1.7, 1.7, 2.59], [s2 * 1.7, 0, top - 0.12], C.white, 1)
      b.tri(null, [s2 * 1.7, 1.7, 2.59], [s2 * 1.7, -1.7, 2.59], [s2 * 1.7, 0, top - 0.12], C.white, 1)
    }
    b.limb([-r, 0, top + 0.02], [r, 0, top + 0.02], 0.07, 0.07, hexColor('#6a3a2c'), 0, 8)
    for (const [y, col] of [[-0.75, C.blue], [0.75, hexColor('#d04f7a')]] as const) {
      b.box(null, 1.56, y, 0.05, 0.06, 0.95, 2.0, C.white, 1)
      b.box(null, 1.6, y, 0.12, 0.05, 0.78, 1.82, col)
      b.sphere(null, 1.64, y + 0.26, 1.0, 0.05, C.gold, 0, 4, 6)
      b.cylinder(mat4.chain(mat4.translation(1.62, y, 2.22), mat4.rotY(Math.PI / 2)), 0, 0, 0, 0.16, 0.16, 0.04, 16, col)
    }
    if ((size?.[0] ?? 1) > 1 || (size?.[1] ?? 1) > 1) scaleBuilder(b, 2.15, 2.15, 1)
    return b
  }
  if (kind === 'souvenir') {
    const width = 11.4, depth = 23.2
    b.box(null, 0, 0, -0.08, width, depth, 0.18, mix3(C.stone, [0.4, 0.38, 0.35], 0.3))
    b.box(null, -width * 0.39, 0, 1.65, width * 0.2, depth - 0.7, 3.2, C.cream)
    for (const y of [-depth * 0.48, depth * 0.48]) b.box(null, 0, y, 1.55, width, 0.3, 3, C.wood)
    b.box(null, 0, 0, 3.15, width, depth, 0.18, C.red)
    b.box(null, width * 0.48, 0, 2.05, 0.32, depth, 2.9, C.wood)
    b.box(null, width * 0.495, 0, 3.82, 0.22, depth * 0.82, 0.82, C.white, 1)
    b.box(null, width * 0.505, 0, 4.28, 0.12, depth * 0.74, 0.14, C.gold, 1)
    b.box(null, width * 0.51, 0, 2.75, 0.14, depth * 0.56, 1.1, C.glass, 1)
    b.box(null, width * 0.36, 0, 1.05, 1.1, depth * 0.55, 0.3, C.wood)
    for (let i = 0; i < 7; i++) {
      const y = -depth * 0.38 + i * depth * 0.12
      b.box(null, width * 0.42, y, 1.62, 0.62, 1.4, 1.05, [C.red, C.blue, C.green, C.gold, C.water, C.wood, C.red][i], 1)
    }
    b.box(null, 0, -depth * 0.45, 4.3, width * 0.72, 0.34, 1.55, C.white, 1)
    b.box(null, 0, -depth * 0.45, 4.35, width * 0.54, 0.08, 0.82, hexColor('#9b51e0'), 1)
    for (const x of [-width * 0.46, width * 0.46]) b.cylinder(null, x, 0, 0.06, 0.28, 0.28, 0.32, 10, C.dark)
    return b
  }
  b.box(null, -0.45, 0, 0, 2.3, 2.9, 1.05, C.cream)
  b.box(null, -0.45, 0, -0.05, 2.45, 3.05, 0.12, mix3(C.stone, [0.4, 0.38, 0.35], 0.3))
  b.box(null, 0.82, 0, 0, 0.42, 2.9, 1.02, C.white, 1)
  for (let k = 0; k < 5; k++) b.box(null, 1.035, -1.2 + k * 0.6, 0.12, 0.02, 0.36, 0.78, mix3(C.white, [0, 0, 0], 0.12), 1)
  b.box(null, 0.9, 0, 1.02, 0.78, 3.06, 0.08, C.wood)
  b.box(null, -0.95, 0, 1.05, 1.35, 2.9, 1.6, C.cream)
  for (const y of [-1.42, 1.42]) {
    b.cylinder(null, 1.12, y, 1.1, 0.06, 0.06, 1.62, 10, C.white, 1)
    b.cylinder(null, -1.58, y, 0, 0.1, 0.1, 2.7, 10, C.white, 1)
  }
  b.box(null, -0.95, 0, 2.62, 1.55, 3.12, 0.1, C.white, 1)
  const stripes = 10, front = 1.55, backX = -1.7, zF = 2.62, zB = 3.25
  for (let i = 0; i < stripes; i++) {
    const y0 = -1.65 + i * (3.3 / stripes), y1 = y0 + 3.3 / stripes, col = i % 2 ? C.white : C.white, tint = i % 2 ? 0 : 1
    const sag = (y: number) => 0.06 * Math.sin((y - y0) / (y1 - y0) * Math.PI)
    for (let j = 0; j < 4; j++) {
      const u0 = j / 4, u1 = (j + 1) / 4
      const pt = (u: number, y: number): Vec3 => [front + (backX - front) * u, y, zF + (zB - zF) * u - (u < 0.01 ? 0 : 0) - sag(y) * (1 - u)]
      b.quad(null, pt(u0, y0), pt(u0, y1), pt(u1, y1), pt(u1, y0), col, tint)
      b.quad(null, pt(u1, y0), pt(u1, y1), pt(u0, y1), pt(u0, y0), col, tint)
    }
    const ym = (y0 + y1) / 2
    b.tri(null, [front, y0, zF], [front, ym, zF - 0.28], [front, y1, zF], col, tint)
    b.tri(null, [front, y1, zF], [front, ym, zF - 0.28], [front, y0, zF], col, tint)
  }
  b.box(null, -0.35, 0, 3.25, 0.22, 2.5, 0.85, C.white, 1)
  b.box(null, -0.26, 0, 3.32, 0.06, 2.2, 0.7, C.cream)
  b.cylinder(mat4.chain(mat4.translation(-0.3, 0, 4.1), mat4.rotY(Math.PI / 2)), 0, 0, -0.11, 0.45, 0.45, 0.22, 20, C.white, 1)
  return b
}

export function gateModel(): MeshBuilder {
  const b = new MeshBuilder()
  for (const y of [-1.5, 1.5]) b.box(null, 0, y, 0, 0.45, 0.45, 2.8, C.white, 1)
  b.box(null, 0, 0, 2.8, 0.7, 3.6, 0.6, C.white, 1)
  b.box(null, 0, 0, 0, 3.8, 3.6, 0.12, C.stone)
  return b
}

// Overhead sign over the start of a ride's queue line, where it meets the
// footpath. Local +x faces the footpath; the board takes the instance tint.
export function queueSignModel(): MeshBuilder {
  const b = new MeshBuilder()
  for (const y of [-1.75, 1.75]) b.box(null, 1.75, y, 0, 0.22, 0.22, 3.4, C.dark)
  b.box(null, 1.75, 0, 3.2, 0.26, 3.72, 0.2, C.dark)
  b.box(null, 1.75, 0, 2.55, 0.16, 2.6, 0.62, C.white, 1)
  for (const x of [1.66, 1.84]) b.box(null, x, 0, 2.66, 0.03, 2.1, 0.36, C.cream)
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
  for (let i = 0; i < 3; i++) b.box(null, 1.22 + i * 0.17, 0, 0.45, 0.14, 1.7, 0.05, C.wood)
  for (let i = 0; i < 2; i++) b.box(mat4.chain(mat4.translation(1.66, 0, 0.62 + i * 0.2), mat4.rotY(-0.18)), 0, 0, 0, 0.05, 1.7, 0.13, C.wood)
  for (const y of [-0.72, 0.72]) {
    b.box(null, 1.39, y, 0, 0.06, 0.06, 0.45, C.dark); b.box(null, 1.62, y, 0, 0.06, 0.06, 0.95, C.dark)
    b.box(null, 1.5, y, 0.4, 0.5, 0.06, 0.05, C.dark)
  }
  return b
}

export function binModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.cylinder(null, 1.45, 1.45, 0, 0.3, 0.35, 0.88, 16, hexColor('#2f6b45'))
  for (let k = 0; k < 2; k++) b.cylinder(null, 1.45, 1.45, 0.2 + k * 0.45, 0.32 + k * 0.03, 0.335 + k * 0.03, 0.05, 16, hexColor('#24543a'), 0, false)
  b.cylinder(null, 1.45, 1.45, 0.88, 0.37, 0.33, 0.1, 16, C.dark)
  b.sphere(null, 1.45, 1.45, 0.98, 0.06, C.dark, 0, 4, 6)
  return b
}

export function lampPostModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.cylinder(null, -1.5, -1.5, 0, 0.18, 0.12, 0.35, 12, C.dark)
  b.cylinder(null, -1.5, -1.5, 0.35, 0.08, 0.06, 3.15, 10, C.dark, 0, false)
  b.cylinder(null, -1.5, -1.5, 3.42, 0.08, 0.2, 0.12, 12, C.dark)
  b.cylinder(null, -1.5, -1.5, 3.92, 0.2, 0.3, 0.1, 12, C.dark)
  b.cylinder(null, -1.5, -1.5, 4.02, 0.3, 0.04, 0.22, 12, C.dark)
  return b
}

export function lampHeadModel(): MeshBuilder {
  const b = new MeshBuilder()
  b.sphere(null, -1.5, -1.5, 3.74, 0.24, hexColor('#fff3c4'), 0, 8, 12, 1.15)
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
  } else if (kind === 'zipper') {
    floor(7.5, hexColor('#5b5964'))
    base.cylinder(null, 0, 0, 0.35, 5.2, 5.2, 0.35, 24, C.dark)
    for (const y of [-1.3, 1.3]) {
      for (const x of [-4.7, 4.7]) base.tube([[x, y, 0.55], [0, y, 8.5]], 0.34, C.steel, 8)
      base.tube([[-4.7, y, 0.55], [0, y, 4.4], [4.7, y, 0.55]], 0.22, C.dark, 8)
    }
    base.tube([[0, -1.3, 8.5], [0, 1.3, 8.5]], 0.5, C.red, 10)
    base.cylinder(mat4.chain(T(0, 0, 8.5), mat4.rotX(Math.PI / 2)), 0, 0, -1.65, 0.48, 0.48, 3.3, 12, C.gold)
    base.box(null, -5.3, 0, 0.55, 1.4, 2.8, 0.55, C.cream)
    for (const y of [-1.25, 1.25]) base.box(null, -5.3, y, 1.1, 0.08, 0.08, 1.1, C.steel)

    const wheel = new MeshBuilder()
    const pointOnFrame = (a: number): Vec3 => {
      const x = Math.cos(a), z = Math.sin(a), exponent = 0.58
      return [4.1 * Math.sign(x) * Math.abs(x) ** exponent, 0, 5.4 * Math.sign(z) * Math.abs(z) ** exponent]
    }
    const frame = Array.from({ length: 49 }, (_, i) => pointOnFrame(i / 48 * Math.PI * 2))
    for (const y of [-1, 1]) wheel.tube(frame.map(([x, , z]) => [x, y, z]), 0.24, C.white, 8, 1)
    for (let i = 0; i < 12; i++) {
      const [x, , z] = pointOnFrame(i / 12 * Math.PI * 2)
      wheel.tube([[x, -1, z], [x, 1, z]], 0.13, C.gold, 6)
    }
    wheel.tube([[0, -1, 0], [0, 1, 0]], 0.32, C.red, 10)
    const wheelAngle = (t: RideAnim) => t.spin * 0.82 * (t.running ? 1 : 0.35)
    parts.push({ builder: wheel, anim: t => mat4.chain(T(0, 0, 8.5), mat4.rotY(wheelAngle(t))) })
    for (let k = 0; k < 12; k++) {
      const pod = new MeshBuilder(), point = pointOnFrame(k / 12 * Math.PI * 2)
      pod.box(null, 0, 0, -0.65, 1.45, 1.12, 0.18, C.dark)
      for (const y of [-0.55, 0.55]) {
        pod.tube([[-0.72, y, -0.48], [-0.72, y, 0.68], [0.72, y, 0.68], [0.72, y, -0.48]], 0.055, C.steel, 6)
        pod.tube([[-0.72, y, -0.48], [0.72, y, -0.48]], 0.055, C.steel, 6)
      }
      for (const x of [-0.72, 0.72]) pod.tube([[x, -0.55, -0.48], [x, 0.55, -0.48]], 0.055, C.steel, 6)
      pod.box(null, 0, 0, 0.02, 1.25, 0.12, 0.12, C.gold)
      for (const x of [-0.32, 0.32]) {
        pod.box(null, x, 0, -0.05, 0.3, 0.34, 0.62, k % 2 ? C.red : C.blue, 1)
        pod.sphere(null, x, 0, 0.67, 0.18, C.skin, 0, 4, 7)
      }
      parts.push({ builder: pod, anim: t => mat4.chain(T(0, 0, 8.5), mat4.rotY(wheelAngle(t)), T(point[0], 0, point[2]), mat4.rotY(Math.sin(t.spin * 1.2 + k * 2.7) * (t.running ? 1.05 : 0.15))) })
    }
  } else if (kind === 'gravitron') {
    floor(7.7, hexColor('#454b5c'))
    base.cylinder(null, 0, 0, 0.35, 6.5, 6.5, 0.4, 28, C.dark)
    base.box(null, -5.6, 0, 0.4, 1.8, 3.0, 0.65, C.cream)
    base.box(null, -5.6, 0, 1.05, 1.9, 3.1, 0.12, C.gold)
    const drum = new MeshBuilder(), segments = 36, bottomRadius = 6.15, topRadius = 5.3, bottom = 0.75, top = 6.9
    const exterior = [hexColor('#7b51c9'), hexColor('#d84365'), hexColor('#3a77d0'), hexColor('#e5d7c2')]
    for (let i = 0; i < segments; i++) {
      const a0 = i / segments * Math.PI * 2, a1 = (i + 1) / segments * Math.PI * 2
      const p = (a: number, r: number, z: number): Vec3 => [Math.cos(a) * r, Math.sin(a) * r, z]
      const panelColor = exterior[Math.floor(i / 3) % exterior.length]
      drum.quad(null, p(a0, bottomRadius, bottom), p(a1, bottomRadius, bottom), p(a1, topRadius, top), p(a0, topRadius, top), panelColor, 1)
      if (i % 3 === 0) drum.quad(null, p(a0 + 0.035, bottomRadius + 0.015, bottom + 0.4), p(a0 + 0.07, bottomRadius + 0.015, bottom + 0.4), p(a0 + 0.07, topRadius + 0.015, top - 0.4), p(a0 + 0.035, topRadius + 0.015, top - 0.4), C.white, 1)
      const innerTop = 3.2
      drum.quad(null, p(a0, innerTop, top + 0.02), p(a0, topRadius, top + 0.02), p(a1, topRadius, top + 0.02), p(a1, innerTop, top + 0.02), i % 2 ? hexColor('#272b38') : C.dark, 1)
    }
    const rim = (z: number, radius: number, color: Vec3) => {
      const points: Vec3[] = []
      for (let i = 0; i <= segments; i++) { const a = i / segments * Math.PI * 2; points.push([Math.cos(a) * radius, Math.sin(a) * radius, z]) }
      drum.tube(points, 0.22, color, 8, 1)
    }
    rim(bottom, bottomRadius, C.steel)
    rim(top, topRadius, C.white)
    rim(top + 0.08, 3.2, C.gold)
    drum.cylinder(null, 0, 0, bottom, 1.0, 0.65, top - bottom, 16, C.dark)
    drum.cylinder(null, 0, 0, top, 2.6, 2.6, 0.16, 20, hexColor('#252a35'), 1)
    drum.cylinder(null, 0, 0, top + 0.16, 1.0, 0.25, 0.9, 16, C.gold, 1)
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, x = Math.cos(a), y = Math.sin(a)
      const panel = mat4.chain(T(x * 5.25, y * 5.25, bottom + 0.25), mat4.rotZ(a))
      drum.box(panel, 0, 0, 0, 0.12, 0.62, 5.3, k % 3 ? hexColor('#d7dbe1') : hexColor('#9fa9ba'), 1)
      if (k % 2 === 0) {
        const rider = mat4.chain(T(x * 4.65, y * 4.65, bottom + 0.75), mat4.rotZ(a + Math.PI))
        drum.box(rider, 0, 0, 0.2, 0.42, 0.36, 0.9, [C.red, C.blue, C.green, C.gold][(k / 2) % 4], 1)
        drum.sphere(rider, 0, 0, 1.22, 0.2, C.skin, 0, 5, 7)
        drum.box(rider, 0.02, 0, 0.02, 0.52, 0.42, 0.12, C.dark)
      }
      const lightAngle = a
      drum.sphere(null, Math.cos(lightAngle) * 4.3, Math.sin(lightAngle) * 4.3, top + 0.12, 0.13, k % 2 ? C.gold : hexColor('#f6f2df'), 1, 4, 6)
    }
    parts.push({ builder: drum, anim: t => mat4.chain(T(0, 0, 0), mat4.rotZ(t.spin * (t.running ? 1.25 : 0.3))) })
  }
  return { base, parts }
}

export function carModel(style: string, front: boolean, riders: number): MeshBuilder {
  const b = new MeshBuilder()
  if (style === 'kart') {
    b.box(null, 0, 0, 0.14, 1.12, 0.78, 0.28, front ? C.red : C.blue, 1)
    b.box(null, 0.25, 0, 0.34, 0.54, 0.5, 0.14, C.dark)
    b.box(null, 0.48, 0, 0.4, 0.22, 0.58, 0.1, C.gold, 1)
    for (const x of [-0.38, 0.38]) for (const y of [-0.35, 0.35]) b.cylinder(mat4.chain(T(x, y, 0.12), mat4.rotX(Math.PI / 2)), 0, 0, -0.04, 0.13, 0.13, 0.11, 8, C.dark)
    if (riders) {
      b.box(null, -0.08, 0, 0.48, 0.34, 0.34, 0.1, C.dark)
      b.sphere(null, -0.06, 0, 0.7, 0.16, C.skin, 0, 3, 6)
    }
    return b
  }
  if (style === 'waterSlide' || style === 'lazyRiver') {
    const color = style === 'waterSlide' ? hexColor('#f2c94c') : hexColor('#f08a24')
    const ring: Vec3[] = []
    for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2; ring.push([Math.cos(a) * 0.62, Math.sin(a) * 0.48, 0.14]) }
    b.tube(ring, style === 'waterSlide' ? 0.14 : 0.2, color, 8, 1)
    b.box(null, 0, 0, 0.08, 0.82, 0.52, 0.12, color, 1)
    if (riders) {
      for (let i = 0; i < Math.min(riders, style === 'lazyRiver' ? 2 : 1); i++) {
        const y = style === 'lazyRiver' ? (i ? 0.2 : -0.2) : 0
        b.sphere(null, -0.08, y, 0.72, 0.2, C.skin, 0, 3, 6)
        b.box(null, 0.03, y, 0.43, 0.48, 0.32, 0.35, SHIRTS[(i * 3 + (style === 'lazyRiver' ? 4 : 1)) % SHIRTS.length])
      }
    }
    return b
  }
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
