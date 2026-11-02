import { MeshBuilder, mat4, hexColor } from './gl'
import type { Mat4, Vec3 } from './gl'
import { C, SHIRTS } from './models'
import type { Part, RideAnim, RideModel } from './models'

const T = mat4.translation
const POOL = hexColor('#4cb8e6'), POOL_DEEP = hexColor('#2a86c4'), FOAM = hexColor('#e9f8ff'), ROCK = hexColor('#8d8478'), ROCK_DARK = hexColor('#6f675d'), PAD = hexColor('#5fae4a'), FIBERGLASS = hexColor('#f3f1ea')
const HIDDEN = mat4.scaling(0.0001, 0.0001, 0.0001)

type Path = { at: (u: number) => { p: Vec3; yaw: number; pitch: number }; length: number }

function path(points: Vec3[]): Path {
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]))
  const total = lengths[lengths.length - 1] || 1
  return {
    length: total,
    at: (u: number) => {
      const d = Math.max(0, Math.min(1, u)) * total
      let i = 1
      while (i < lengths.length - 1 && lengths[i] < d) i++
      const a = points[i - 1], b = points[i], seg = lengths[i] - lengths[i - 1] || 1, f = (d - lengths[i - 1]) / seg
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
      return { p: [a[0] + dx * f, a[1] + dy * f, a[2] + dz * f], yaw: Math.atan2(dy, dx), pitch: Math.atan2(dz, Math.hypot(dx, dy)) }
    },
  }
}

function helix(cx: number, cy: number, r: number, z0: number, z1: number, turns: number, start: number, steps = 70): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i <= steps; i++) { const u = i / steps, a = start + u * turns * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z0 + (z1 - z0) * u]) }
  return out
}

function curve(points: Vec3[], steps = 10): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)]
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t
      out.push([0, 1, 2].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)) as Vec3)
    }
  }
  out.push(points[points.length - 1])
  return out
}

function deck(b: MeshBuilder, W: number, H: number, color: Vec3 = C.cream) { b.box(null, 0, 0, 0, W * 2, H * 2, 0.3, color) }

function pool(b: MeshBuilder, x0: number, y0: number, x1: number, y1: number, color: Vec3 = POOL) {
  b.quad(null, [x0, y0, 0.34], [x1, y0, 0.34], [x1, y1, 0.34], [x0, y1, 0.34], color)
  for (const [x, y, sx, sy] of [[(x0 + x1) / 2, y0, x1 - x0 + 0.3, 0.3], [(x0 + x1) / 2, y1, x1 - x0 + 0.3, 0.3], [x0, (y0 + y1) / 2, 0.3, y1 - y0], [x1, (y0 + y1) / 2, 0.3, y1 - y0]] as const) b.box(null, x, y, 0.3, sx, sy, 0.14, C.white)
}

function tower(b: MeshBuilder, x: number, y: number, height: number, size = 3) {
  const h = size / 2 - 0.3
  for (const dx of [-h, h]) for (const dy of [-h, h]) b.box(null, x + dx, y + dy, 0.3, 0.3, 0.3, height, C.white)
  for (let z = 2; z < height - 0.5; z += 2.4) { b.box(null, x, y - h, z, size - 0.3, 0.12, 0.12, C.white); b.box(null, x - h, y, z + 1.2, 0.12, size - 0.3, 0.12, C.white) }
  b.box(null, x, y, height, size, size, 0.25, C.wood)
  b.box(null, x, y + size / 2, height + 0.25, size, 0.1, 1, C.white)
  for (let z = 1.4; z < height; z += 1.5) b.box(null, x + h + 0.35, y, z, 0.6, size * 0.6, 0.1, C.wood)
  b.cylinder(null, x, y, height + 0.25, size * 0.75, 0, 1.1, 4, FIBERGLASS, 1, false)
}

function person(color: Vec3, scale = 1): MeshBuilder {
  const b = new MeshBuilder()
  b.sphere(null, 0, 0, 0.62 * scale, 0.22 * scale, C.skin, 0, 3, 6)
  b.box(null, 0, 0, 0.18 * scale, 0.42 * scale, 0.32 * scale, 0.36 * scale, color)
  return b
}

function rider(k: number, extra?: (b: MeshBuilder) => void): MeshBuilder {
  const b = person(SHIRTS[(k * 5 + 1) % SHIRTS.length])
  extra?.(b)
  return b
}

function along(track: Path, rate: number, offset: number, lift = 0.2) {
  return (t: RideAnim): Mat4 => {
    if (!t.running) return offset > 0.001 ? HIDDEN : (() => { const s = track.at(0); return mat4.chain(T(s.p[0], s.p[1], s.p[2] + lift), mat4.rotZ(s.yaw)) })()
    const u = ((t.spin * rate + offset) % 1 + 1) % 1
    const s = track.at(u)
    return mat4.chain(T(s.p[0], s.p[1], s.p[2] + lift), mat4.rotZ(s.yaw), mat4.rotY(-s.pitch * 0.6))
  }
}

function slideRiders(parts: Part[], tracks: Path[], perTrack: number, rate: number, build: (k: number) => MeshBuilder, lift = 0.25) {
  tracks.forEach((track, ti) => {
    for (let k = 0; k < perTrack; k++) parts.push({ builder: build(ti * perTrack + k), anim: along(track, rate * (1 + ti * 0.06), k / perTrack + ti * 0.13, lift) })
  })
}

function ring(b: MeshBuilder, color: Vec3, r = 0.55) {
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.sphere(null, Math.cos(a) * r, Math.sin(a) * r, 0.18, 0.2, color, 0, 3, 6) }
}

function bodySlides(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  pool(base, W - 4.6, -H + 1, W - 0.6, H - 1)
  const tx = -W + 2.2, ty = -H + 2.2, top = 11.5
  tower(base, tx, ty, top)
  const a = curve([[tx + 1.3, ty + 0.6, top + 0.4], [tx + 4, ty + 1, top - 1.5], ...helix(0, -1, 3.6, top - 3, 2.5, 1.6, Math.PI, 12).slice(1, -1), [W - 4.2, -2.2, 0.8]], 6)
  const b = curve([[tx + 0.6, ty + 1.3, top + 0.4], [tx + 1, ty + 5, top - 3], [-1, H - 3, 7], [1.5, 1, 4], [-0.5, H - 2.5, 2], [W - 4.2, 2.4, 0.8]], 8)
  base.tube(a, 0.7, FIBERGLASS, 9, 1)
  base.tube(b, 0.7, hexColor('#f2c94c'), 9)
  for (const pts of [a, b]) for (let i = 8; i < pts.length - 4; i += 9) { const p = pts[i]; if (p[2] > 1.2) base.cylinder(null, p[0], p[1], 0.3, 0.12, 0.12, p[2] - 0.9, 6, C.white) }
  slideRiders(parts, [path(a), path(b)], 2, 0.14, k => rider(k), 0.05)
  return { base, parts }
}

function tubeSlides(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  pool(base, -W + 1, H - 5, W - 1, H - 0.8)
  const tx = 0, ty = -H + 2.2, top = 9.5
  tower(base, tx, ty, top)
  const tracks = [-1, 1].map(side => curve([[tx + side * 1.4, ty + 1.2, top + 0.3], [side * 3.2, ty + 4, top - 2.5], [side * 0.8, ty + 8, top - 4.5], [side * 3.4, H - 8, 3.2], [side * 1.6, H - 4.6, 0.7]], 8))
  tracks.forEach((pts, i) => { base.tube(pts, 0.85, i ? hexColor('#3a77d0') : hexColor('#3fae5c'), 10); for (let k = 6; k < pts.length - 3; k += 8) if (pts[k][2] > 1) base.cylinder(null, pts[k][0], pts[k][1], 0.3, 0.12, 0.12, pts[k][2] - 1, 6, C.white) })
  slideRiders(parts, tracks.map(path), 3, 0.12, k => rider(k, b => ring(b, k % 2 ? C.gold : C.red)), 0.15)
  return { base, parts }
}

function familyRaft(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  pool(base, -W + 1, H - 5.5, W - 1, H - 0.8)
  const tx = -W + 2.4, ty = -H + 2.4, top = 10.5
  tower(base, tx, ty, top, 3.4)
  const pts = curve([[tx + 1.8, ty + 0.4, top + 0.3], [W - 3, -H + 3, top - 2.5], [W - 3.5, 0, 6.5], [-W + 4, 0.5, 4.4], [-W + 3.5, H - 7, 2.6], [1, H - 4.5, 0.7]], 10)
  base.tube(pts, 1.25, FIBERGLASS, 12, 1)
  for (let k = 6; k < pts.length - 3; k += 7) if (pts[k][2] > 1) base.cylinder(null, pts[k][0], pts[k][1], 0.3, 0.16, 0.16, pts[k][2] - 1.3, 6, C.white)
  const track = path(pts)
  for (let k = 0; k < 3; k++) {
    const raft = new MeshBuilder()
    raft.cylinder(null, 0, 0, 0, 1.05, 1.05, 0.38, 14, k === 1 ? C.blue : C.gold)
    for (let s = 0; s < 4; s++) { const a = s / 4 * Math.PI * 2 + 0.4; raft.sphere(null, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.62, 0.2, C.skin, 0, 3, 6); raft.box(null, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.28, 0.3, 0.3, 0.32, SHIRTS[(k * 4 + s) % SHIRTS.length]) }
    const move = along(track, 0.11, k / 3, 0.0)
    parts.push({ builder: raft, anim: t => mat4.multiply(move(t), mat4.rotZ(t.spin * 1.4 + k)) })
  }
  return { base, parts }
}

function bowlSlide(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  const bx = 1.6, by = 1.6, R = Math.min(W, H) - 2.4
  pool(base, -W + 0.8, -H + 0.8, -1.6, -1.6, POOL_DEEP)
  for (const [dx, dy] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) base.cylinder(null, bx + dx * R, by + dy * R, 0.3, 0.2, 0.2, 3.5, 6, C.white)
  base.cylinder(null, bx, by, 3.6, 0.9, R, 1.9, 24, FIBERGLASS, 1, false)
  base.cylinder(null, bx, by, 3.62, 0.85, R - 0.15, 1.88, 24, POOL, 0, false)
  base.cylinder(null, bx, by, 0.3, 0.75, 0.75, 3.3, 10, hexColor('#7c3fc0'))
  const tx = -W + 2, ty = H - 2.2, top = 9
  tower(base, tx, ty, top, 2.8)
  const feed = curve([[tx + 1.2, ty - 0.5, top + 0.3], [tx + 4, ty - 1.5, 7.6], [bx + R * 0.95, by + 0.2, 5.6]], 8)
  base.tube(feed, 0.65, FIBERGLASS, 9, 1)
  const spiral = helix(bx, by, R - 0.6, 5.4, 3.9, 2.2, 0, 60).map(([x, y, z], i, arr) => { const f = i / (arr.length - 1), r = 1 - f * 0.78; return [bx + (x - bx) * r, by + (y - by) * r, z] as Vec3 })
  const exit = curve([[bx, by, 3.6], [bx - 1, by - 1, 2.2], [-W + 3, -H + 3, 0.6]], 6)
  base.tube(exit, 0.6, hexColor('#7c3fc0'), 8)
  const track = path([...feed, ...spiral, ...exit])
  for (let k = 0; k < 2; k++) parts.push({ builder: rider(k), anim: along(track, 0.13, k / 2, 0.1) })
  return { base, parts }
}

function funnelSlide(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  pool(base, -W + 1, H - 3.8, W - 1, H - 0.8)
  const tx = -W + 2.2, ty = -H + 2.2, top = 11
  tower(base, tx, ty, top, 3)
  const fx = 1.4, fy = 0.4, zb = 1.2, zt = 8.6, rb = 1.4, rt = 4.6
  const radius = (z: number) => rb + (z - zb) / (zt - zb) * (rt - rb)
  base.cylinder(null, fx, fy, zb, rb, rt, zt - zb, 26, FIBERGLASS, 1, false)
  base.cylinder(null, fx, fy, zb - 0.05, rb, rb, 0.1, 18, POOL)
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; base.box(null, fx + Math.cos(a) * (rt - 0.4), fy + Math.sin(a) * (rt - 0.4), 0.3, 0.3, 0.3, zt - 0.6, C.white) }
  base.cylinder(null, fx, fy, 0.3, 0.6, 0.6, zb, 10, C.white)
  const entry: Vec3 = [fx - radius(4.4) + 0.3, fy, 4.4]
  const feed = curve([[tx + 1.5, ty + 0.4, top + 0.3], [tx + 1, ty + 4, 8.4], [entry[0] - 1.6, fy - 0.6, 5.8], entry], 8)
  base.tube(feed, 0.95, FIBERGLASS, 10, 1)
  const out = curve([[fx, fy + rb - 0.4, zb], [fx - 0.4, fy + 2.6, 0.9], [fx - 1, H - 3.6, 0.7], [fx - 1, H - 2.2, 0.6]], 6)
  base.tube(out, 0.85, FIBERGLASS, 10, 1)
  const feedPath = path(feed), outPath = path(out)
  const raft = new MeshBuilder()
  raft.cylinder(null, 0, 0, 0, 0.95, 0.95, 0.32, 12, C.gold)
  for (let s = 0; s < 4; s++) { const a = s / 4 * Math.PI * 2; raft.sphere(null, Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.58, 0.19, C.skin, 0, 3, 6) }
  parts.push({ builder: raft, anim: t => {
    if (!t.running) { const s = feedPath.at(0); return T(s.p[0], s.p[1], s.p[2]) }
    const u = (t.spin * 0.09) % 1
    if (u < 0.3) { const s = feedPath.at(u / 0.3); return mat4.chain(T(s.p[0], s.p[1], s.p[2] + 0.1), mat4.rotZ(s.yaw)) }
    if (u < 0.8) {
      const f = (u - 0.3) / 0.5, swing = Math.cos(f * Math.PI * 3.5) * (1 - f * 0.7)
      const z = zb + 0.3 + Math.abs(swing) * (6.6 - zb), a = Math.PI + swing * 1.3, r = radius(z) - 0.5
      return mat4.chain(T(fx + Math.cos(a) * r, fy + Math.sin(a) * r, z), mat4.rotZ(a), mat4.rotY(-0.7))
    }
    const s = outPath.at((u - 0.8) / 0.2)
    return mat4.chain(T(s.p[0], s.p[1], s.p[2] + 0.1), mat4.rotZ(s.yaw))
  } })
  return { base, parts }
}

function halfPipe(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  const L = W - 1.2, depth = 8.5, half = H - 1.6
  const color = FIBERGLASS
  const prof = (x: number) => { const f = x / L; return depth * f * f }
  for (let i = -12; i < 12; i++) {
    const xa = i / 12 * L, xb = (i + 1) / 12 * L
    base.quad(null, [xa, -half, prof(xa) + 0.4], [xb, -half, prof(xb) + 0.4], [xb, half, prof(xb) + 0.4], [xa, half, prof(xa) + 0.4], color, 1)
    base.quad(null, [xa, half, prof(xa) + 0.4], [xb, half, prof(xb) + 0.4], [xb, -half, prof(xb) + 0.4], [xa, -half, prof(xa) + 0.4], color, 1)
    for (const y of [-half, half]) base.box(null, (xa + xb) / 2, y, prof((xa + xb) / 2) + 0.3, xb - xa + 0.05, 0.25, 0.7, C.white)
  }
  for (const x of [-L * 0.95, -L * 0.6, L * 0.6, L * 0.95]) for (const y of [-half, half]) base.box(null, x, y, 0.3, 0.3, 0.3, prof(x), C.white)
  base.quad(null, [-L * 0.25, -half + 0.2, 0.46], [L * 0.25, -half + 0.2, 0.46], [L * 0.25, half - 0.2, 0.46], [-L * 0.25, half - 0.2, 0.46], POOL)
  tower(base, -W + 1.6, 0, depth + 0.4, 2.4)
  const raft = new MeshBuilder()
  raft.cylinder(null, 0, 0, 0, 0.95, 0.95, 0.32, 12, C.blue)
  for (let s = 0; s < 4; s++) { const a = s / 4 * Math.PI * 2 + 0.6; raft.sphere(null, Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.6, 0.19, C.skin, 0, 3, 6) }
  parts.push({ builder: raft, anim: t => {
    if (!t.running) return T(-L + 0.6, 0, depth + 0.5)
    const f = (t.spin * 0.07) % 1
    const x = -L * Math.cos(f * Math.PI * 5) * (1 - f * 0.75)
    return mat4.chain(T(x, 0, prof(x) + 0.5), mat4.rotY(-Math.atan(2 * depth * x / (L * L))), mat4.rotZ(t.spin))
  } })
  return { base, parts }
}

function trapdoor(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  pool(base, -W + 0.8, H - 3.6, W - 0.8, H - 0.8)
  const tx = 0, ty = -H + 2, top = 15
  tower(base, tx, ty, top, 3)
  base.cylinder(null, tx, ty, top + 0.25, 0.75, 0.75, 2.3, 14, C.glass, 0, false)
  base.cylinder(null, tx, ty, top + 2.55, 0.85, 0.85, 0.25, 14, FIBERGLASS, 1)
  const drop = curve([[tx, ty, top + 0.2], [tx, ty + 0.3, top - 4], [tx, ty + 1.6, 4.5], [tx + 0.4, ty + 4, 1.2], [0, H - 2.4, 0.6]], 10)
  base.tube(drop, 0.62, C.glass, 10)
  base.tube(drop.map(([x, y, z]) => [x, y, z - 0.08] as Vec3), 0.66, FIBERGLASS, 10, 1)
  const track = path(drop)
  parts.push({ builder: rider(3), anim: t => {
    if (!t.running) return T(tx, ty, top + 0.5)
    const f = (t.spin * 0.12) % 1
    if (f < 0.25) return T(tx, ty, top + 0.5)
    const s = track.at(Math.pow((f - 0.25) / 0.75, 0.7))
    return mat4.chain(T(s.p[0], s.p[1], s.p[2] + 0.05), mat4.rotZ(s.yaw), mat4.rotY(-s.pitch))
  } })
  return { base, parts }
}

function matRacer(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  pool(base, W - 3.6, -H + 0.8, W - 0.8, H - 0.8)
  const top = 7.5, x0 = -W + 2.6, x1 = W - 3.4
  tower(base, -W + 1.4, 0, top, Math.min(2.6, H))
  const lanes = 4, laneW = (H * 2 - 2) / lanes
  const lanePath = (lane: number) => { const y = -H + 1 + laneW * (lane + 0.5), pts: Vec3[] = []; for (let i = 0; i <= 24; i++) { const f = i / 24, x = x0 + (x1 - x0) * f; pts.push([x, y, 0.5 + (top - 0.2) * Math.pow(1 - f, 1.6) + Math.sin(f * Math.PI * 3) * 0.55 * (1 - f)]) } return pts }
  const colors = [C.red, C.blue, C.green, C.gold]
  for (let l = 0; l < lanes; l++) {
    const pts = lanePath(l)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], y = a[1], hw = laneW / 2 - 0.08
      base.quad(null, [a[0], y - hw, a[2]], [b[0], y - hw, b[2]], [b[0], y + hw, b[2]], [a[0], y + hw, a[2]], colors[l])
      base.quad(null, [a[0], y + hw, a[2] - 0.05], [b[0], y + hw, b[2] - 0.05], [b[0], y - hw, b[2] - 0.05], [a[0], y - hw, a[2] - 0.05], C.white)
      base.box(null, (a[0] + b[0]) / 2, y + hw, (a[2] + b[2]) / 2 - 0.1, b[0] - a[0], 0.08, 0.3, C.white)
      if (i % 5 === 0 && a[2] > 1) base.cylinder(null, a[0], y, 0.3, 0.12, 0.12, a[2] - 0.6, 6, C.white)
    }
    const track = path(pts)
    const mat = new MeshBuilder()
    mat.box(null, 0, 0, 0.05, 1.1, 0.5, 0.08, colors[(l + 2) % 4])
    mat.sphere(null, 0.45, 0, 0.28, 0.2, C.skin, 0, 3, 6)
    mat.box(null, -0.05, 0, 0.12, 0.8, 0.3, 0.22, SHIRTS[(l * 3 + 2) % SHIRTS.length])
    const pace = 1 + (l * 0.37 % 1) * 0.12
    parts.push({ builder: mat, anim: t => {
      if (!t.running) { const s = track.at(0); return T(s.p[0], s.p[1], s.p[2]) }
      const s = track.at(Math.min(1, ((t.spin * 0.1) % 1.15) * pace))
      return mat4.chain(T(s.p[0], s.p[1], s.p[2] + 0.04), mat4.rotY(-s.pitch))
    } })
  }
  return { base, parts }
}

function aquaLoop(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  pool(base, -W + 0.8, H - 3.4, W - 0.8, H - 0.8)
  const tx = 0, ty = -H + 2, top = 15
  tower(base, tx, ty, top, 2.8)
  base.cylinder(null, tx, ty, top + 0.25, 0.75, 0.75, 2.3, 14, C.glass, 0, false)
  const pts: Vec3[] = [[tx, ty, top + 0.2], [tx, ty + 0.4, top - 3], [tx, ty + 1.8, 5.5], [tx, ty + 3.6, 2.2]]
  const lc: Vec3 = [0, ty + 6.4, 1.6], R = 2.6
  for (let i = 0; i <= 32; i++) { const a = -Math.PI / 2 + i / 32 * Math.PI * 2, side = (i / 32 - 0.5) * 1.3; pts.push([lc[0] + side, lc[1] - Math.cos(a) * R, lc[2] + R + Math.sin(a) * R]) }
  pts.push([0.8, H - 2.6, 1.2], [0.8, H - 1.6, 0.6])
  const smooth = curve(pts, 3)
  base.tube(smooth, 0.62, FIBERGLASS, 10, 1)
  for (const dx of [-1.6, 1.6]) base.box(null, lc[0] + dx, lc[1], 0.3, 0.3, 0.3, lc[2] + R * 2 + 0.4, C.white)
  base.box(null, lc[0], lc[1], lc[2] + R * 2 + 0.7, 3.5, 0.3, 0.3, C.white)
  const track = path(smooth)
  parts.push({ builder: rider(5), anim: t => {
    if (!t.running) return T(tx, ty, top + 0.5)
    const f = (t.spin * 0.13) % 1
    if (f < 0.2) return T(tx, ty, top + 0.5)
    const s = track.at((f - 0.2) / 0.8)
    return mat4.chain(T(s.p[0], s.p[1], s.p[2] + 0.05), mat4.rotZ(s.yaw), mat4.rotY(-s.pitch))
  } })
  return { base, parts }
}

function surfRider(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  const x0 = -W + 1.2, x1 = W - 2.8, y0 = -H + 2.2, y1 = H - 1
  for (let i = 0; i < 10; i++) {
    const xa = x0 + (x1 - x0) * i / 10, xb = x0 + (x1 - x0) * (i + 1) / 10
    const fa = i / 10, fb = (i + 1) / 10, za = 0.4 + 3.2 * fa * fa, zb = 0.4 + 3.2 * fb * fb
    base.quad(null, [xa, y0, za], [xb, y0, zb], [xb, y1, zb], [xa, y1, za], i % 2 ? POOL : hexColor('#5ec4ec'))
  }
  for (const y of [y0 - 0.2, y1 + 0.2]) base.box(null, (x0 + x1) / 2 + 0.6, y, 0.3, x1 - x0 + 1.4, 0.35, 3.9, FIBERGLASS, 1)
  base.box(null, x1 + 1.2, (y0 + y1) / 2, 0.3, 2, y1 - y0 + 0.7, 4.2, FIBERGLASS, 1)
  base.box(null, x0 - 0.2, (y0 + y1) / 2, 0.3, 0.6, y1 - y0, 0.25, C.dark)
  for (let k = 0; k < 5; k++) base.box(null, x0 + 0.8 + k * 1.6, -H + 1, 0.3, 0.9, 1.2, 0.5, C.wood)
  for (let k = 0; k < 6; k++) {
    const stripe = new MeshBuilder()
    stripe.box(null, 0, 0, 0, 0.5, y1 - y0 - 0.4, 0.05, FOAM)
    parts.push({ builder: stripe, anim: t => { const f = ((t.spin * 0.6 + k / 6) % 1), x = x1 - f * (x1 - x0); const g = (x - x0) / (x1 - x0); return T(x, (y0 + y1) / 2, 0.42 + 3.2 * g * g) } })
  }
  const surfer = person(SHIRTS[4])
  surfer.box(null, 0, 0, -0.05, 1.5, 0.45, 0.08, C.gold)
  parts.push({ builder: surfer, anim: t => {
    const sway = t.running ? Math.sin(t.spin * 1.3) : 0
    const x = x0 + (x1 - x0) * (0.42 + 0.12 * Math.sin(t.spin * 0.7)), g = (x - x0) / (x1 - x0)
    return mat4.chain(T(x, (y0 + y1) / 2 + sway * (y1 - y0) * 0.3, 0.45 + 3.2 * g * g), mat4.rotZ(Math.PI + sway * 0.6), mat4.rotY(-0.35))
  } })
  return { base, parts }
}

function splashPad(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H, hexColor('#8fd3e8'))
  for (let i = 0; i < 6; i++) base.cylinder(null, 0, 0, 0.3, W - 0.8 - i * 0.9, W - 0.8 - i * 0.9, 0.02 + i * 0.01, 24, i % 2 ? hexColor('#f2c94c') : hexColor('#7fd0e8'))
  for (const [x, y] of [[-W + 1.2, -H + 1.2], [W - 1.2, H - 1.2]]) { base.cylinder(null, x, y, 0.3, 0.12, 0.12, 2.6, 6, C.blue); base.cylinder(null, x, y, 2.8, 0.7, 0.2, 0.5, 8, FIBERGLASS, 1) }
  base.tube(curve([[-W + 1.2, H - 1.5, 0.3], [0, H - 1.5, 3], [W - 1.2, H - 1.5, 0.3]], 8), 0.15, FIBERGLASS, 6, 1)
  const jets = 9
  for (let k = 0; k < jets; k++) {
    const a = k / jets * Math.PI * 2, r = (k % 3 + 1) * 1.2
    const jet = new MeshBuilder()
    jet.cylinder(null, 0, 0, 0, 0.08, 0.16, 1, 6, FOAM)
    parts.push({ builder: jet, anim: t => mat4.chain(T(Math.cos(a) * r, Math.sin(a) * r, 0.32), mat4.scaling(1, 1, 0.2 + Math.max(0, Math.sin(t.spin * 2.2 + k * 1.7)) * (t.running ? 1.8 : 0.4))) })
  }
  for (let k = 0; k < 6; k++) parts.push({ builder: person(SHIRTS[(k * 3) % SHIRTS.length], 0.7), anim: t => { const a = (t.running ? t.spin * 0.45 : 0) + k * 1.05, r = 1.6 + (k % 3) * 0.9; return mat4.chain(T(Math.cos(a) * r, Math.sin(a * 1.3) * r * 0.8, 0.3 + Math.abs(Math.sin(t.spin * 4 + k)) * 0.15), mat4.rotZ(a + Math.PI / 2)) } })
  return { base, parts }
}

function kiddieLagoon(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H, hexColor('#f0dfb0'))
  pool(base, -W + 1, -H + 1, W - 1, H - 1, hexColor('#7dd6f0'))
  base.cylinder(null, 0, 0, 0.3, 0.3, 0.3, 2.4, 8, C.white)
  base.sphere(null, 0, 0, 2.6, 1.6, FIBERGLASS, 1, 6, 12, 0.5)
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; base.sphere(null, Math.cos(a) * 1.1, Math.sin(a) * 1.1, 2.75, 0.25, C.white) }
  for (const s of [-1, 1]) {
    const x = s * (W - 2.6)
    base.box(null, x, -H + 2.4, 0.3, 1.4, 1.4, 1.6, FIBERGLASS, 1)
    base.quad(null, [x - 0.5, -H + 3.1, 1.9], [x + 0.5, -H + 3.1, 1.9], [x + 0.5, -H + 6, 0.4], [x - 0.5, -H + 6, 0.4], hexColor('#3fae5c'))
  }
  const fountain = new MeshBuilder()
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; fountain.box(mat4.chain(T(Math.cos(a) * 1.7, Math.sin(a) * 1.7, 2), mat4.rotZ(a), mat4.rotY(0.9)), 0, 0, 0, 0.08, 0.08, 1.2, FOAM) }
  parts.push({ builder: fountain, anim: t => mat4.scaling(1, 1, t.running ? 0.9 + Math.sin(t.spin * 3) * 0.1 : 0.4) })
  for (let k = 0; k < 7; k++) parts.push({ builder: person(SHIRTS[(k * 5 + 3) % SHIRTS.length], 0.65), anim: t => { const a = (t.running ? t.spin * 0.3 : 0) + k * 0.9, r = 2.8 + (k % 2) * 1.6; return mat4.chain(T(Math.cos(a) * r, Math.sin(a) * r, 0.2 + Math.sin(t.spin * 2 + k) * 0.05), mat4.rotZ(a + Math.PI / 2)) } })
  return { base, parts }
}

function bucketFort(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H, hexColor('#8fd3e8'))
  const colors = [C.red, C.blue, hexColor('#f2c94c'), C.green]
  for (const x of [-W + 1.2, -1, 1, W - 1.2]) for (const y of [-H + 1.2, H - 1.2]) base.box(null, x, y, 0.3, 0.35, 0.35, 7.2, C.white)
  for (const [z, sx] of [[2.4, W * 2 - 2], [4.8, W * 2 - 4]] as const) { base.box(null, 0, 0, z, sx, H * 2 - 2, 0.25, C.wood); base.box(null, 0, -H + 1.2, z + 0.25, sx, 0.08, 0.8, colors[z > 3 ? 1 : 0]) }
  base.cylinder(null, 0, 0, 7.2, 3, 0, 1.6, 4, FIBERGLASS, 1)
  base.box(null, 0, 0, 7.2, 0.3, 4.2, 0.3, C.steel)
  base.tube(curve([[W - 2.2, -1, 4.9], [W - 0.4, 0, 2.8], [W - 0.6, H - 1.8, 0.4]], 8), 0.55, FIBERGLASS, 8, 1)
  base.tube(curve([[-W + 2.2, 1, 2.5], [-W + 0.4, -1, 1.2], [-W + 0.8, -H + 2.2, 0.4]], 8), 0.5, C.green, 8)
  for (let k = 0; k < 6; k++) base.cylinder(null, -W + 1.6 + k * ((W * 2 - 3.2) / 5), H - 1.2, 5.2, 0.12, 0.2, 0.4, 6, colors[k % 4])
  const bucket = new MeshBuilder()
  bucket.cylinder(null, 0, 0, -1.4, 0.9, 1.3, 1.6, 14, FIBERGLASS, 1)
  bucket.cylinder(null, 0, 0, 0.18, 0.05, 1.2, 0.02, 14, POOL)
  parts.push({ builder: bucket, anim: t => { const f = (t.spin * 0.08) % 1, tip = f > 0.85 ? Math.sin((f - 0.85) / 0.15 * Math.PI) * 2.2 : 0; return mat4.chain(T(0, 0, 9.4), mat4.rotX(tip)) } })
  const splash = new MeshBuilder()
  splash.cylinder(null, 0, 0, 0, 1.6, 0.4, 8, 12, FOAM)
  parts.push({ builder: splash, anim: t => { const f = (t.spin * 0.08) % 1; return f > 0.9 && t.running ? mat4.chain(T(0, 1.4, 0.3), mat4.scaling(1, 1, (f - 0.9) * 10 * 0.9)) : HIDDEN } })
  for (let k = 0; k < 8; k++) parts.push({ builder: person(SHIRTS[(k * 7 + 1) % SHIRTS.length], 0.7), anim: t => { const lvl = k % 3, a = (t.running ? t.spin * 0.25 : 0) + k * 0.8; return mat4.chain(T(Math.cos(a) * (W - 2.4) * 0.8, Math.sin(a) * (H - 2.4) * 0.8, lvl === 0 ? 0.3 : lvl === 1 ? 2.65 : 5.05), mat4.rotZ(a + Math.PI / 2)) } })
  return { base, parts }
}

function lilyPads(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H)
  pool(base, -W + 0.9, -H + 1.6, W - 0.9, H - 1.6, POOL_DEEP)
  for (const x of [-W + 1, W - 1]) { base.box(null, x, -H + 1.6, 0.3, 0.3, 0.3, 4.2, C.wood); base.box(null, x, H - 1.6, 0.3, 0.3, 0.3, 4.2, C.wood) }
  for (let k = 0; k < 7; k++) { const y = -H + 1.6 + k * ((H * 2 - 3.2) / 6); base.cylinder(mat4.chain(T(0, y, 3.6), mat4.rotY(Math.PI / 2)), 0, 0, -W + 1, 0.04, 0.04, W * 2 - 2, 4, C.gold) }
  for (let k = 0; k < 6; k++) { const x = -W + 1 + k * ((W * 2 - 2) / 5); base.cylinder(mat4.chain(T(x, 0, 3.6), mat4.rotX(Math.PI / 2)), 0, 0, -H + 1.6, 0.04, 0.04, H * 2 - 3.2, 4, C.gold) }
  const count = Math.max(4, Math.round(W / 1.3))
  for (let k = 0; k < count; k++) {
    const pad = new MeshBuilder()
    pad.cylinder(null, 0, 0, 0, 0.75, 0.75, 0.12, 12, k % 3 === 2 ? hexColor('#e85d9b') : PAD)
    const x = -W + 1.8 + k * ((W * 2 - 3.6) / (count - 1)), y = Math.sin(k * 1.7) * (H - 2.6)
    parts.push({ builder: pad, anim: t => T(x, y, 0.32 + Math.sin(t.spin * 2 + k) * 0.05) })
  }
  for (let k = 0; k < 3; k++) parts.push({ builder: person(SHIRTS[(k * 4 + 2) % SHIRTS.length], 0.8), anim: t => {
    const f = ((t.running ? t.spin * 0.08 : 0) + k / 3) % 1, i = f * (count - 1), a = Math.floor(i), frac = i - a
    const xa = -W + 1.8 + a * ((W * 2 - 3.6) / (count - 1)), xb = -W + 1.8 + Math.min(count - 1, a + 1) * ((W * 2 - 3.6) / (count - 1))
    const ya = Math.sin(a * 1.7) * (H - 2.6), yb = Math.sin(Math.min(count - 1, a + 1) * 1.7) * (H - 2.6)
    return mat4.chain(T(xa + (xb - xa) * frac, ya + (yb - ya) * frac, 0.44 + Math.sin(frac * Math.PI) * 0.6), mat4.rotZ(Math.atan2(yb - ya, xb - xa)))
  } })
  return { base, parts }
}

function cliffJump(w: number, h: number): RideModel {
  const base = new MeshBuilder(), parts: Part[] = []
  const W = w * 2 - 0.3, H = h * 2 - 0.3
  deck(base, W, H, hexColor('#d8c9a2'))
  pool(base, -W + 0.8, -H + 0.8 + H, W - 0.8, H - 0.8, POOL_DEEP)
  const cy = -H + 2.8
  for (let k = 0; k < 9; k++) { const z = k * 1.2, r = 2.6 - k * 0.12; base.sphere(null, Math.sin(k * 2.1) * 0.5, cy + Math.cos(k * 1.3) * 0.4, z + 0.6, r, k % 2 ? ROCK : ROCK_DARK, 0, 5, 9, 0.6, 0.18) }
  base.box(null, 0, cy + 1.2, 10.4, 2.4, 2.8, 0.3, C.wood)
  base.box(null, 0, cy + 2.7, 10.7, 2.4, 0.1, 0.9, FIBERGLASS, 1)
  base.box(null, 1.6, cy + 0.6, 10.7, 0.1, 1.6, 0.9, FIBERGLASS, 1)
  for (let z = 1; z < 10.3; z += 0.8) base.box(null, -1.8, cy - 1.2 + z * 0.1, z, 0.7, 0.4, 0.12, C.wood)
  for (let k = 0; k < 3; k++) base.sphere(null, -W + 1.4 + k * 0.6, -H + 1.2, 0.5, 0.6, ROCK, 0, 4, 7, 0.7, 0.2)
  const jumper = rider(6)
  parts.push({ builder: jumper, anim: t => {
    const f = ((t.running ? t.spin * 0.14 : 0) % 1)
    if (f < 0.35) return mat4.chain(T(0, cy + 1.6 + f * 1.8, 10.7), mat4.rotZ(Math.PI / 2))
    const g = (f - 0.35) / 0.4
    if (g > 1) return HIDDEN
    return mat4.chain(T(0, cy + 2.3 + g * 3.6, 10.7 + g * 1.5 - g * g * 11), mat4.rotZ(Math.PI / 2), mat4.rotY(g * 0.8))
  } })
  const ripple = new MeshBuilder()
  ripple.cylinder(null, 0, 0, 0, 1, 1, 0.04, 14, FOAM)
  parts.push({ builder: ripple, anim: t => { const f = ((t.running ? t.spin * 0.14 : 0) % 1); return f > 0.73 ? mat4.chain(T(0, cy + 6, 0.36), mat4.scaling(0.4 + (f - 0.73) * 6, 0.4 + (f - 0.73) * 6, 1)) : HIDDEN } })
  return { base, parts }
}

const BUILDERS: Record<string, (w: number, h: number) => RideModel> = { bodySlides, tubeSlides, familyRaft, bowlSlide, funnelSlide, halfPipe, trapdoor, matRacer, aquaLoop, surfRider, splashPad, kiddieLagoon, bucketFort, lilyPads, cliffJump }

export function waterRideModel(kind: string, w: number, h: number): RideModel | null {
  const build = BUILDERS[kind]
  return build ? build(w, h) : null
}

export const WATER_RIDE_TINTS: Record<string, string> = { bodySlides: '#e2513d', tubeSlides: '#3fae5c', familyRaft: '#f08a24', bowlSlide: '#9b51e0', funnelSlide: '#1fb5b0', halfPipe: '#e85d9b', trapdoor: '#d8432f', matRacer: '#f2c94c', aquaLoop: '#3a77d0', surfRider: '#2d3b55', splashPad: '#3a77d0', kiddieLagoon: '#f2c94c', bucketFort: '#f2c94c', lilyPads: '#3fae5c', cliffJump: '#d8432f' }
