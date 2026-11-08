import { MeshBuilder, mat4, hexColor } from './gl'
import type { Vec3 } from './gl'
import { M } from './materials'
import { bulb, neonTube, LIGHTS, GLOW } from './neon'
import { tileCorners, tileIndex, inMap, TUNNEL_HEAD } from '../../../server/park/index.mjs'
import type { ParkState, Entity, TrackPath } from '../../../server/park/index.mjs'

const TILE = 4
const FLOOR_DROP = 0.3
const WALL_HIGH = hexColor('#b4b1a8')
const WALL_LOW = hexColor('#8a8881')
const ROOF_COLOR = hexColor('#7d7b76')
const FLOOR_COLOR = hexColor('#4b4d51')
const RIB_COLOR = hexColor('#cbc8bf')
const COPING = hexColor('#dcd9cf')
const COPING_SIDE = hexColor('#b9b6ac')
const PIT_WALL = hexColor('#bdbab0')
const STRIPE = hexColor('#e0b43c')

type Kind = 'cover' | 'open' | null

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }

/** A quad whose front face looks toward `toward`, whatever order the corners were given in. */
function facing(b: MeshBuilder, a: Vec3, bb: Vec3, c: Vec3, d: Vec3, color: Vec3, toward: Vec3) {
  const n = cross(sub(bb, a), sub(c, a))
  if (dot(n, sub(toward, a)) >= 0) b.quad(null, a, bb, c, d, color)
  else b.quad(null, d, c, bb, a, color)
}

/** True for a tile where track runs in an open cut: the ground is left out of the terrain mesh here. */
export function isTunnelHole(state: ParkState, ti: number) {
  const cells = state.trackCells.get(ti)
  if (!cells) return false
  for (const cell of cells) if (cell.tunnel === 'open') return true
  return false
}

function kindAt(state: ParkState, rideId: number, tx: number, ty: number): Kind {
  if (!inMap(state.map, tx, ty)) return null
  let kind: Kind = null
  for (const cell of state.trackCells.get(tileIndex(state.map, tx, ty)) ?? []) {
    if (cell.ride !== rideId || !cell.tunnel) continue
    if (cell.tunnel === 'open') return 'open'
    kind = 'cover'
  }
  return kind
}

type Crossing = { s: number; z: number }

/**
 * Tunnel graphics for one ride: a concrete tube with ribs and lights wherever
 * the track runs under the ground, and for each open cut a sloped concrete
 * floor, retaining walls with a portal frame where the track enters, and a
 * cement border around the opening.
 */
export function tunnelGeometry(state: ParkState, ride: Entity, path: TrackPath, half: number): MeshBuilder | null {
  const map = state.map, P = path.pos, count = path.count
  const holes = new Set<number>()
  for (const [ti, cells] of state.trackCells) if (cells.some(cell => cell.ride === ride.id && cell.tunnel === 'open')) holes.add(ti)
  const W = half + 0.9, H = TUNNEL_HEAD
  const step = Math.max(1, Math.round(1 / path.ds))

  const isCover = (i: number) => {
    const i0 = Math.max(0, i - 1), i1 = Math.min(count - 1, i + 1)
    const tx = P[i1 * 3] - P[i0 * 3], ty = P[i1 * 3 + 1] - P[i0 * 3 + 1], l = Math.hypot(tx, ty) || 1
    const rx = -ty / l, ry = tx / l
    for (const side of [0, 1, -1]) {
      const px = P[i * 3] + rx * W * side, py = P[i * 3 + 1] + ry * W * side
      const kind = kindAt(state, ride.id, Math.floor(px / TILE), Math.floor(py / TILE))
      if (side === 0 ? kind !== 'cover' : kind === 'open') return false
    }
    return true
  }
  const covered: boolean[] = []
  let anyCover = false
  for (let i = 0; i < count; i += step) { const c = isCover(i); covered[i] = c; if (c) anyCover = true }
  if (!anyCover && !holes.size) return null

  const b = new MeshBuilder()
  b.mat = M.concrete

  const frame = (i: number) => {
    const i0 = Math.max(0, i - 1), i1 = Math.min(count - 1, i + 1)
    const T = norm([P[i1 * 3] - P[i0 * 3], P[i1 * 3 + 1] - P[i0 * 3 + 1], P[i1 * 3 + 2] - P[i0 * 3 + 2]])
    const R = norm(cross(T, [0, 0, 1]))
    const U = cross(R, T)
    const p: Vec3 = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]
    const at = (a: number, up: number, along = 0): Vec3 => [p[0] + R[0] * a + U[0] * up + T[0] * along, p[1] + R[1] * a + U[1] * up + T[1] * along, p[2] + R[2] * a + U[2] * up + T[2] * along]
    return { p, T, R, U, at }
  }

  // Tube
  const roofLights: Vec3[][] = [[], []]
  let lampIndex = 0
  for (let i = 0; i + step < count; i += step) {
    const run = covered[i] && covered[i + step]
    if (!run) continue
    const A = frame(i), B = frame(i + step)
    const inside: Vec3 = A.at(0, 1.4)
    const levels = [-0.25, 1.0, H]
    for (let k = 0; k < 2; k++) {
      facing(b, A.at(-W, levels[k]), B.at(-W, levels[k]), B.at(-W, levels[k + 1]), A.at(-W, levels[k + 1]), k === 0 ? WALL_LOW : WALL_HIGH, inside)
      facing(b, A.at(W, levels[k]), B.at(W, levels[k]), B.at(W, levels[k + 1]), A.at(W, levels[k + 1]), k === 0 ? WALL_LOW : WALL_HIGH, inside)
    }
    facing(b, A.at(-W, H), B.at(-W, H), B.at(W, H), A.at(W, H), ROOF_COLOR, inside)
    facing(b, A.at(-W, -0.25), B.at(-W, -0.25), B.at(W, -0.25), A.at(W, -0.25), FLOOR_COLOR, inside)
    const ribEvery = Math.max(1, Math.round(6 / (step * path.ds)))
    if ((i / step) % ribEvery === 0) {
      const w = W - 0.07, h = H - 0.07, len = 0.45
      for (const s of [-1, 1]) facing(b, A.at(s * w, -0.2), A.at(s * w, -0.2, len), A.at(s * w, h, len), A.at(s * w, h), RIB_COLOR, inside)
      facing(b, A.at(-w, h), A.at(-w, h, len), A.at(w, h, len), A.at(w, h), RIB_COLOR, inside)
      facing(b, A.at(-W, 0.25), B.at(-W, 0.25), B.at(-W, 0.5), A.at(-W, 0.5), STRIPE, inside)
      facing(b, A.at(W, 0.25), B.at(W, 0.25), B.at(W, 0.5), A.at(W, 0.5), STRIPE, inside)
    }
    const lampEvery = Math.max(1, Math.round(3 / (step * path.ds)))
    if ((i / step) % lampEvery === 0) {
      lampIndex++
      const phase = ((lampIndex * 0.17) % 0.9) + 0.05
      for (const s of [-1, 1]) {
        const lp = A.at(s * (W - 0.14), 2.3)
        bulb(b, null, lp[0], lp[1], lp[2], 0.13, LIGHTS, phase, 0)
      }
      b.mat = M.concrete
    }
    for (const [side, list] of [[-1, roofLights[0]], [1, roofLights[1]]] as [number, Vec3[]][]) {
      if (!list.length || !covered[i - step]) list.push(A.at(side * W * 0.42, H - 0.12))
      list.push(B.at(side * W * 0.42, H - 0.12))
    }
    if (!covered[i + 2 * step]) { for (const list of roofLights) list.push([NaN, NaN, NaN]) }
  }
  for (const list of roofLights) {
    let run: Vec3[] = []
    for (const pt of list) {
      if (Number.isNaN(pt[0])) { if (run.length > 1) neonTube(b, run, 0.07, GLOW, 5); run = []; continue }
      run.push(pt)
    }
    if (run.length > 1) neonTube(b, run, 0.07, GLOW, 5)
  }
  b.mat = M.concrete

  // Open cuts
  const sampleStride = 2
  const nearestZ = (wx: number, wy: number) => {
    let best = Infinity, z = 0
    for (let i = 0; i < count; i += sampleStride) {
      const dx = P[i * 3] - wx, dy = P[i * 3 + 1] - wy, d = dx * dx + dy * dy
      if (d < best) { best = d; z = P[i * 3 + 2] }
    }
    return z
  }
  const EDGES: [number, number, number, number][] = [[1, 2, 1, 0], [2, 3, 0, 1], [3, 0, -1, 0], [0, 1, 0, -1]]
  const crossings = (axis: 'x' | 'y', line: number, from: number, to: number): Crossing[] => {
    const out: Crossing[] = []
    const lo = axis === 'x' ? 0 : 1, la = axis === 'x' ? 1 : 0
    for (let i = 0; i + 1 < count; i++) {
      const a = P[i * 3 + lo] - line, c = P[(i + 1) * 3 + lo] - line
      if (a === c || a * c > 0) continue
      const t = a / (a - c)
      const lateral = P[i * 3 + la] + (P[(i + 1) * 3 + la] - P[i * 3 + la]) * t
      const s = lateral - from
      if (s < -3 || s > to - from + 3) continue
      const z = P[i * 3 + 2] + (P[(i + 1) * 3 + 2] - P[i * 3 + 2]) * t
      if (out.some(o => Math.abs(o.s - s) < 0.6)) continue
      out.push({ s, z })
    }
    return out
  }

  const ow = W + 0.05
  for (const ti of holes) {
    const x = ti % map.w, y = Math.floor(ti / map.w)
    const ground = tileCorners(map, x, y)
    const cornerXY: [number, number][] = [[x * TILE, y * TILE], [(x + 1) * TILE, y * TILE], [(x + 1) * TILE, (y + 1) * TILE], [x * TILE, (y + 1) * TILE]]
    const floor = cornerXY.map(([wx, wy], k) => Math.min(nearestZ(wx, wy) - FLOOR_DROP, ground[k] - FLOOR_DROP))
    const corner = (k: number, z: number): Vec3 => [cornerXY[k][0], cornerXY[k][1], z]
    const center: Vec3 = [(x + 0.5) * TILE, (y + 0.5) * TILE, (floor[0] + floor[1] + floor[2] + floor[3]) / 4 + 1]
    b.mat = M.concrete
    facing(b, corner(0, floor[0]), corner(1, floor[1]), corner(2, floor[2]), corner(3, floor[3]), FLOOR_COLOR, [center[0], center[1], center[2] + 5])

    EDGES.forEach(([k0, k1, nx, ny]) => {
      const ox = x + nx, oy = y + ny
      if (inMap(map, ox, oy) && holes.has(tileIndex(map, ox, oy))) return
      const p0 = cornerXY[k0], p1 = cornerXY[k1]
      const tx = (p1[0] - p0[0]) / TILE, ty = (p1[1] - p0[1]) / TILE
      const inX = -nx, inY = -ny
      const g0 = ground[k0], g1 = ground[k1], f0 = floor[k0], f1 = floor[k1]
      const groundAt = (s: number) => g0 + (g1 - g0) * s / TILE
      const floorAt = (s: number) => f0 + (f1 - f0) * s / TILE
      const at = (s: number, z: number): Vec3 => [p0[0] + tx * s, p0[1] + ty * s, z]
      const list = nx !== 0 ? crossings('x', p0[0], Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1])) : crossings('y', p0[1], Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]))
      const flip = (nx !== 0 ? ty : tx) < 0
      const gates = list.map(c => ({ s: flip ? TILE - c.s : c.s, z: c.z })).filter(c => c.s > -ow && c.s < TILE + ow)
      const breaks = new Set<number>([0, TILE])
      for (const gate of gates) for (const s of [gate.s - ow, gate.s + ow]) if (s > 0.01 && s < TILE - 0.01) breaks.add(s)
      const cuts = [...breaks].sort((a, c) => a - c)
      const toward: Vec3 = [center[0], center[1], center[2]]
      for (let k = 0; k + 1 < cuts.length; k++) {
        const sa = cuts[k], sb = cuts[k + 1], mid = (sa + sb) / 2
        const gate = gates.find(gt => Math.abs(mid - gt.s) < ow)
        if (gate) {
          const top = gate.z + H
          if (top < Math.min(groundAt(sa), groundAt(sb)) - 0.02) facing(b, at(sa, top), at(sb, top), at(sb, groundAt(sb)), at(sa, groundAt(sa)), PIT_WALL, toward)
          else if (top < Math.max(groundAt(sa), groundAt(sb))) {
            const gs = (g: number) => Math.max(g, top)
            facing(b, at(sa, top), at(sb, top), at(sb, gs(groundAt(sb))), at(sa, gs(groundAt(sa))), PIT_WALL, toward)
          }
        } else facing(b, at(sa, floorAt(sa)), at(sb, floorAt(sb)), at(sb, groundAt(sb)), at(sa, groundAt(sa)), PIT_WALL, toward)
      }

      for (const gate of gates) {
        const top = gate.z + H
        const gs = groundAt(Math.max(0, Math.min(TILE, gate.s)))
        if (gate.s < 0 || gate.s > TILE || top > gs - 0.25) continue
        const ox0 = p0[0] + tx * gate.s, oy0 = p0[1] + ty * gate.s
        const m = mat4.chain(mat4.translation(ox0, oy0, 0), mat4.rotZ(Math.atan2(inY, inX)))
        const base = gate.z - 0.35, lintelTop = Math.min(top + 0.5, gs - 0.02)
        b.mat = M.concrete
        for (const side of [-1, 1]) b.box(m, 0.2, side * (ow + 0.2), base, 0.7, 0.4, lintelTop - base, COPING)
        b.box(m, 0.2, 0, top, 0.7, ow * 2 + 0.8, lintelTop - top, COPING)
        b.box(m, 0.56, 0, top - 0.02, 0.04, ow * 2, 0.05, STRIPE)
        const lampZ = top + (lintelTop - top) / 2
        for (let n = 0; n < 5; n++) {
          const ly = (n / 4 - 0.5) * (ow * 2 + 0.2)
          const wp = mat4.transformPoint(m, [0.6, ly, lampZ])
          bulb(b, null, wp[0], wp[1], wp[2], 0.08, LIGHTS, (n / 5 + 0.05) % 1, 0)
        }
        b.mat = M.concrete
      }

      // Cement border around the rim.
      const lift = 0.1, out = 0.5, over = 0.25
      const ex = (s: number, d: number): Vec3 => [p0[0] + tx * s - inX * d, p0[1] + ty * s - inY * d, groundAt(s) + lift]
      const s0 = -over, s1 = TILE + over
      facing(b, ex(s0, -0.12), ex(s1, -0.12), ex(s1, out), ex(s0, out), COPING, [p0[0], p0[1], ground[k0] + 5])
      const outerTop = (s: number): Vec3 => ex(s, out)
      const outerFoot = (s: number): Vec3 => { const q = ex(s, out); q[2] = groundAt(s) - 0.12; return q }
      facing(b, outerTop(s0), outerTop(s1), outerFoot(s1), outerFoot(s0), COPING_SIDE, [p0[0] - inX * 5, p0[1] - inY * 5, ground[k0]])
      const innerTop = (s: number): Vec3 => ex(s, -0.12)
      const innerFoot = (s: number): Vec3 => { const q = ex(s, -0.12); q[2] = groundAt(s) - 0.4; return q }
      facing(b, innerTop(s0), innerTop(s1), innerFoot(s1), innerFoot(s0), COPING_SIDE, toward)
    })
  }

  return b.data.length ? b : null
}
