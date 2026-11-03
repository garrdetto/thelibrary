import { hexColor } from './gl'
import type { MeshBuilder, Vec3 } from './gl'

const TILE = 4
const LIFT = 0.07
const DECK_DEPTH = 0.32
const RAIL_HEIGHT = 0.95
const RAIL_COLOR = hexColor('#5b4330')
const STRINGER_COLOR = hexColor('#6f563c')

// Corner order matches tileCorners: (0,0), (1,0), (1,1), (0,1).
export type Corners = [number, number, number, number]
export type PathTileStyle = {
  kind: number
  fill: Vec3
  edge: Vec3
  open: [boolean, boolean, boolean, boolean]
  supports?: boolean
  ground: (u: number, v: number) => number
}

const SIDE_EDGES: [[number, number], [number, number]][] = [[[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]], [[0, 0], [1, 0]]]

function bilinear(c: Corners, u: number, v: number) {
  return c[0] * (1 - u) * (1 - v) + c[1] * u * (1 - v) + c[2] * u * v + c[3] * (1 - u) * v
}

function wall(b: MeshBuilder, a: Vec3, bb: Vec3, c: Vec3, d: Vec3, color: Vec3) {
  b.quad(null, a, bb, c, d, color)
  b.quad(null, d, c, bb, a, color)
}

// Which way a ramp climbs: along u or v, and whether the low end is at 0.
export function rampAxis(c: Corners) {
  const riseU = (c[1] + c[2]) - (c[0] + c[3]), riseV = (c[2] + c[3]) - (c[0] + c[1])
  const alongU = Math.abs(riseU) >= Math.abs(riseV)
  const rise = (alongU ? Math.abs(riseU) : Math.abs(riseV)) / 2
  return { alongU, lowAtZero: (alongU ? riseU : riseV) >= 0, rise }
}

export function addPathTile(b: MeshBuilder, x: number, y: number, c: Corners, style: PathTileStyle) {
  const P = (u: number, v: number, z: number): Vec3 => [(x + u) * TILE, (y + v) * TILE, z]
  const top = (u: number, v: number) => bilinear(c, u, v) + LIFT
  const axis = rampAxis(c)
  const stairs = style.kind === 3 && axis.rise > 0.05
  const lowest = Math.min(...c)
  const raised = lowest > Math.min(style.ground(0, 0), style.ground(1, 0), style.ground(1, 1), style.ground(0, 1)) + 0.2

  if (stairs) {
    const steps = Math.max(3, Math.round(axis.rise / 0.2))
    const lo = axis.lowAtZero ? (axis.alongU ? (c[0] + c[3]) / 2 : (c[0] + c[1]) / 2) : (axis.alongU ? (c[1] + c[2]) / 2 : (c[2] + c[3]) / 2)
    const at = (s: number, w: number, z: number): Vec3 => {
      const t = axis.lowAtZero ? s : 1 - s
      return axis.alongU ? P(t, w, z) : P(w, t, z)
    }
    for (let k = 0; k < steps; k++) {
      const s0 = k / steps, s1 = (k + 1) / steps
      const zPrev = lo + axis.rise * s0 + LIFT, z = lo + axis.rise * s1 + LIFT
      const tread = [at(s0, 0, z), at(s1, 0, z), at(s1, 1, z), at(s0, 1, z)]
      b.quad(null, tread[0], tread[1], tread[2], tread[3], style.fill)
      b.quad(null, tread[3], tread[2], tread[1], tread[0], style.fill)
      b.quad(null, at(s0 + 0.012, 0.02, z + 0.012), at(s0 + 0.05, 0.02, z + 0.012), at(s0 + 0.05, 0.98, z + 0.012), at(s0 + 0.012, 0.98, z + 0.012), style.edge)
      b.quad(null, at(s0 + 0.05, 0.98, z + 0.012), at(s0 + 0.05, 0.02, z + 0.012), at(s0 + 0.012, 0.02, z + 0.012), at(s0 + 0.012, 0.98, z + 0.012), style.edge)
      wall(b, at(s0, 0, zPrev), at(s0, 1, zPrev), at(s0, 1, z), at(s0, 0, z), style.edge)
      for (const w of [0, 1]) {
        const under0 = lo + axis.rise * s0 + LIFT - DECK_DEPTH, under1 = lo + axis.rise * s1 + LIFT - DECK_DEPTH
        wall(b, at(s0, w, under0), at(s1, w, under1), at(s1, w, z + 0.06), at(s0, w, z + 0.06), STRINGER_COLOR)
      }
    }
  } else {
    b.quad(null, P(0, 0, top(0, 0)), P(1, 0, top(1, 0)), P(1, 1, top(1, 1)), P(0, 1, top(0, 1)), style.fill)
  }

  for (let side = 0; side < 4; side++) {
    if (!style.open[side]) continue
    const [[u0, v0], [u1, v1]] = SIDE_EDGES[side]
    const z0 = top(u0, v0), z1 = top(u1, v1)
    if (raised && !stairs) wall(b, P(u0, v0, z0), P(u1, v1, z1), P(u1, v1, z1 - DECK_DEPTH), P(u0, v0, z0 - DECK_DEPTH), style.edge)
    const g0 = style.ground(u0, v0), g1 = style.ground(u1, v1)
    if (Math.min(z0 - g0, z1 - g1) < 1.1) continue
    const inset = 0.03
    const iu0 = u0 === 0 ? inset : u0 === 1 ? 1 - inset : u0, iv0 = v0 === 0 ? inset : v0 === 1 ? 1 - inset : v0
    const iu1 = u1 === 0 ? inset : u1 === 1 ? 1 - inset : u1, iv1 = v1 === 0 ? inset : v1 === 1 ? 1 - inset : v1
    const zs = (t: number) => stairs ? top(iu0 + (iu1 - iu0) * t, iv0 + (iv1 - iv0) * t) + axis.rise * 0.08 : top(iu0 + (iu1 - iu0) * t, iv0 + (iv1 - iv0) * t)
    for (const t of [0, 0.5, 1]) {
      const px = (x + iu0 + (iu1 - iu0) * t) * TILE, py = (y + iv0 + (iv1 - iv0) * t) * TILE
      b.cylinder(null, px, py, zs(t), 0.05, 0.05, RAIL_HEIGHT, 5, RAIL_COLOR)
    }
    const rail = (h: number): Vec3[] => [0, 0.5, 1].map(t => [(x + iu0 + (iu1 - iu0) * t) * TILE, (y + iv0 + (iv1 - iv0) * t) * TILE, zs(t) + h] as Vec3)
    b.tube(rail(RAIL_HEIGHT), 0.045, RAIL_COLOR, 5)
    b.tube(rail(RAIL_HEIGHT * 0.5), 0.03, RAIL_COLOR, 4)
  }

  if (raised && style.supports !== false) {
    const cz = bilinear(c, 0.5, 0.5), gz = style.ground(0.5, 0.5)
    if (cz - gz > 0.3) {
      const legs: [number, number][] = cz - gz > 2.5 ? [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]] : [[0.5, 0.5]]
      for (const [u, v] of legs) {
        const z = bilinear(c, u, v) + LIFT - DECK_DEPTH, g = style.ground(u, v)
        if (z > g) b.cylinder(null, (x + u) * TILE, (y + v) * TILE, g, 0.16, 0.14, z - g, 8, hexColor('#68472c'))
      }
    }
  }
}
