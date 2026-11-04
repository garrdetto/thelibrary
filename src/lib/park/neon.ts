import { MeshBuilder, AUTO } from './gl'
import type { Mat4, Vec3 } from './gl'
import { M } from './materials'

// Color slots. A vertex whose tint weight is SLOT[i] takes the ride's i-th
// color (slot 0 is the plain ride tint; 1 is chase lights; 2 is glow lights).
export const SLOT = [1, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const
export const LIGHTS = 1, GLOW = 2

const WHITE: Vec3 = [1, 1, 1]

/** A light bulb: emissive, taking the slot color, chasing when `phase` is in (0, 1]. */
export function bulb(b: MeshBuilder, m: Mat4 | null, x: number, y: number, z: number, r: number, slot: number, phase = 0, detail = 1) {
  b.mat = M.neon
  b.sway = phase > 0 ? 0.01 + (phase % 1) * 0.99 : 0
  b.sphere(m, x, y, z, r, WHITE, SLOT[slot], detail > 0 ? 3 : 2, detail > 0 ? 6 : 4)
  b.mat = AUTO
  b.sway = 0
}

/** A ring of chase bulbs; `waves` is how many bright runs circle the ring at once. */
export function bulbRing(b: MeshBuilder, m: Mat4 | null, cx: number, cy: number, z: number, radius: number, count: number, r: number, slot: number, waves = 3, offset = 0, detail = 1) {
  for (let k = 0; k < count; k++) {
    const a = k / count * Math.PI * 2 + offset
    bulb(b, m, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z, r, slot, waves > 0 ? (k * waves / count) % 1 : 0, detail)
  }
}

/** Bulbs along a line from `a` to `b`, chasing from `a` toward `b`. */
export function bulbRun(b: MeshBuilder, m: Mat4 | null, a: Vec3, c: Vec3, count: number, r: number, slot: number, waves = 1, offset = 0, detail = 1) {
  for (let k = 0; k < count; k++) {
    const u = count > 1 ? k / (count - 1) : 0
    bulb(b, m, a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u, r, slot, waves > 0 ? (u * waves + offset) % 1 : 0, detail)
  }
}

/** A steady neon tube along `points`. */
export function neonTube(b: MeshBuilder, points: Vec3[], radius: number, slot: number, segments = 6) {
  b.mat = M.neon
  b.sway = 0
  b.tube(points, radius, WHITE, segments, SLOT[slot])
  b.mat = AUTO
}

/** A rounded-rectangle neon tube: lying flat (`xy`, w along x) at height z, or standing upright (`yz`, w along y) at x = cx. */
export function neonFrame(b: MeshBuilder, cx: number, cy: number, z: number, w: number, h: number, radius: number, slot: number, corner = 0.6, plane: 'xy' | 'yz' = 'xy') {
  const pts: Vec3[] = []
  const hx = w / 2 - corner, hy = h / 2 - corner
  const at = (u: number, v: number): Vec3 => plane === 'xy' ? [cx + u, cy + v, z] : [cx, cy + u, z + v]
  const arc = (ax: number, ay: number, a0: number) => { for (let i = 0; i <= 4; i++) { const a = a0 + i / 4 * Math.PI / 2; pts.push(at(ax + Math.cos(a) * corner, ay + Math.sin(a) * corner)) } }
  arc(hx, hy, 0); arc(-hx, hy, Math.PI / 2); arc(-hx, -hy, Math.PI); arc(hx, -hy, Math.PI * 1.5)
  pts.push(pts[0])
  neonTube(b, pts, radius, slot, 6)
}

const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['....#', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#..##', '#.#.#', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '&': ['.##..', '#..#.', '#..#.', '.##..', '#.#.#', '#..#.', '.##.#'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
}

/** Width of `text` in cells (5-wide glyphs, one cell of spacing). */
export function bulbTextWidth(text: string) { return Math.max(0, text.length * 6 - 1) }

/**
 * Lettering made of bulbs on a 5×7 dot grid. `m` places the sign: letters run
 * along local -y (left to right as seen from local -x) and stand up local z,
 * with the text centred on the origin.
 */
export function bulbText(b: MeshBuilder, m: Mat4 | null, text: string, cell: number, r: number, slot: number, chase = 0, detail = 1) {
  const upper = text.toUpperCase(), width = bulbTextWidth(upper)
  let col = 0, n = 0
  const total = [...upper].reduce((sum, ch) => sum + (FONT[ch] ?? []).reduce((s, row) => s + (row.match(/#/g)?.length ?? 0), 0), 0) || 1
  for (const ch of upper) {
    const glyph = FONT[ch]
    if (glyph) for (let row = 0; row < 7; row++) for (let c = 0; c < 5; c++) {
      if (glyph[row][c] !== '#') continue
      const y = (width / 2 - col - c) * cell, z = (3 - row) * cell
      bulb(b, m, 0, y, z, r, slot, chase > 0 ? (n / total * chase) % 1 : 0, detail)
      n++
    }
    col += 6
  }
}
