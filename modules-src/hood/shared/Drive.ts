/**
 * How the town's vehicles drive. A drive is planned for the rear axle (the wheels that don't steer), so the body always points
 * along that path the way a real car's does, the front swings wide through corners and the steering angle follows from the
 * path's curvature. Corners are arcs no tighter than the vehicle can turn, speed comes from a forward and backward pass with
 * the vehicle's own acceleration, braking and cornering grip, bays that face the road are backed into, and a vehicle facing
 * the wrong way turns around in the street with a three-point turn. Everything is a pure function of the stops and the pose,
 * so every page and the server agree on where each vehicle is.
 */
import type { VehicleKind } from './TownSim'
import { APRON, LANE, ROAD_SPEED, YARD_SPEED, stopSpot, type Spot, type Stop } from './Town'

export interface Rig {
  /** Model z of the front (steered) axle and of the rear axle (or the middle of a tandem). */
  front: number
  rear: number
  /** Model z of the front and rear bumpers. */
  nose: number
  tail: number
  /** Tightest radius the rear axle can follow. */
  turn: number
  accel: number
  brake: number
  /** Comfortable sideways acceleration in corners. */
  grip: number
  trailer?: { hitch: number; axle: number }
}

export const RIGS: Record<VehicleKind, Rig> = {
  cruiser: { front: 1.45, rear: -1.45, nose: 2.55, tail: -2.45, turn: 5.0, accel: 2.6, brake: 3.4, grip: 3.2 },
  delivery: { front: 1.25, rear: -1.25, nose: 1.95, tail: -1.95, turn: 4.5, accel: 2.2, brake: 3.0, grip: 2.9 },
  pickup: { front: 2.8, rear: -1.1, nose: 3.95, tail: -2.1, turn: 6.2, accel: 2.0, brake: 3.0, grip: 2.7 },
  lawntruck: { front: 2.8, rear: -1.1, nose: 3.95, tail: -2.1, turn: 6.6, accel: 1.4, brake: 2.6, grip: 2.2, trailer: { hitch: -2.25, axle: 2.6 } },
  engine: { front: 3.8, rear: -2.8, nose: 5.15, tail: -4.25, turn: 8.4, accel: 1.3, brake: 2.6, grip: 2.2 },
  ambulance: { front: 2.8, rear: -1.6, nose: 3.85, tail: -2.75, turn: 6.6, accel: 1.8, brake: 2.9, grip: 2.4 },
  garbage: { front: 3.6, rear: -3.0, nose: 4.85, tail: -5.55, turn: 8.4, accel: 1.0, brake: 2.2, grip: 1.8 },
  utility: { front: 2.9, rear: -2.0, nose: 4.05, tail: -3.25, turn: 7.0, accel: 1.4, brake: 2.5, grip: 2.0 },
  shuttle: { front: 2.5, rear: -2.3, nose: 3.75, tail: -3.75, turn: 6.8, accel: 1.5, brake: 2.6, grip: 2.0 },
  bus: { front: 3.6, rear: -3.4, nose: 5.25, tail: -5.25, turn: 8.8, accel: 1.0, brake: 2.1, grip: 1.7 },
  tanker: { front: 3.2, rear: -2.8, nose: 5.4, tail: -5.2, turn: 8.4, accel: 0.9, brake: 2.0, grip: 1.6 },
}

/** How far from the centre line counts as the road, and how far a bumper may reach while turning around. */
const ROAD_EDGE = 4.6
const TURN_EDGE = 5.9
const REVERSE_SPEED = 1.7
const MANEUVER_SPEED = 1.5
const SHIFT_PAUSE = 0.8
const STEP = 0.5

export interface DriveState {
  x: number
  z: number
  yaw: number
  /** Signed: negative while reversing. */
  speed: number
  accel: number
  /** Sideways acceleration, positive to the vehicle's right. */
  lat: number
  /** Front wheel angle, positive steers left. */
  steer: number
  /** Trailer angle relative to the body. */
  trailer: number
}

export interface Path {
  rig: Rig
  x: Float64Array
  z: Float64Array
  /** Which way the body points at each sample. */
  yaw: Float64Array
  /** Signed curvature of the travel path (positive turns left), smoothed. */
  curve: Float64Array
  /** Distance along the whole drive. */
  s: Float64Array
  v: Float64Array
  times: Float64Array
  /** 1 forward, -1 reversing. */
  dir: Int8Array
  duration: number
  end: Spot
}

interface Sample { x: number; z: number; h: number; k: number }
interface Run { samples: Sample[]; dir: 1 | -1; slow?: number }

const fwd = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)]
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const laneFor = (dir: number) => (dir > 0 ? LANE : -LANE)
const dirYaw = (dir: number) => (dir > 0 ? Math.PI / 2 : -Math.PI / 2)

/** Samples a polyline with every corner rounded to an arc of at most `radius`, as tight as the segments allow. */
function rounded(pts: [number, number][], radius: number): Sample[] {
  const clean: [number, number][] = []
  for (const p of pts) {
    const last = clean[clean.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) clean.push(p)
  }
  if (clean.length < 2) {
    const p = clean[0] ?? [0, 0]
    return [{ x: p[0], z: p[1], h: 0, k: 0 }]
  }
  const n = clean.length
  const seg = (i: number) => Math.hypot(clean[i + 1][0] - clean[i][0], clean[i + 1][1] - clean[i][1])
  const unit = (i: number): [number, number] => { const l = seg(i); return [(clean[i + 1][0] - clean[i][0]) / l, (clean[i + 1][1] - clean[i][1]) / l] }
  const cut: number[] = new Array(n).fill(0)
  const want: number[] = new Array(n).fill(0)
  const turn: number[] = new Array(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    const u = unit(i - 1), w = unit(i)
    const theta = Math.acos(Math.max(-1, Math.min(1, u[0] * w[0] + u[1] * w[1])))
    turn[i] = theta
    if (theta < 1e-3) continue
    want[i] = radius * Math.tan(Math.min(theta, 3.0) / 2)
  }
  for (let i = 1; i < n - 1; i++) {
    if (!want[i]) continue
    const before = i - 1 === 0 ? seg(i - 1) * 0.85 : (seg(i - 1) * want[i]) / (want[i] + want[i - 1])
    const after = i + 1 === n - 1 ? seg(i) * 0.85 : (seg(i) * want[i]) / (want[i] + want[i + 1])
    cut[i] = Math.min(want[i], before, after)
  }
  const out: Sample[] = []
  const line = (a: [number, number], b: [number, number]) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (l < 1e-6) return
    const h = yawOf(b[0] - a[0], b[1] - a[1])
    const steps = Math.max(1, Math.ceil(l / STEP))
    for (let j = out.length ? 1 : 0; j <= steps; j++) out.push({ x: a[0] + ((b[0] - a[0]) * j) / steps, z: a[1] + ((b[1] - a[1]) * j) / steps, h, k: 0 })
  }
  let cursor: [number, number] = clean[0]
  for (let i = 1; i < n; i++) {
    const v = clean[i]
    if (i === n - 1 || !cut[i]) { line(cursor, v); cursor = v; continue }
    const u = unit(i - 1), w = unit(i)
    const a: [number, number] = [v[0] - u[0] * cut[i], v[1] - u[1] * cut[i]]
    const b: [number, number] = [v[0] + w[0] * cut[i], v[1] + w[1] * cut[i]]
    line(cursor, a)
    const r = cut[i] / Math.tan(turn[i] / 2)
    const side = u[0] * w[1] - u[1] * w[0] > 0 ? -1 : 1
    const h0 = yawOf(u[0], u[1])
    const steps = Math.max(2, Math.ceil(Math.max((turn[i] * r) / STEP, turn[i] / 0.1)))
    const [cx, cz] = [a[0] + Math.cos(h0) * r * side, a[1] - Math.sin(h0) * r * side]
    for (let j = 1; j <= steps; j++) {
      const h = h0 + side * (turn[i] * j) / steps
      out.push({ x: cx - Math.cos(h) * r * side, z: cz + Math.sin(h) * r * side, h, k: side / r })
    }
    if (out.length) { out[out.length - 1].x = b[0]; out[out.length - 1].z = b[1] }
    cursor = b
  }
  return out
}

/** Turns a vehicle around in the street with as few forward and reverse arcs as its turning circle and the road allow. */
function turnAround(rig: Rig, x: number, z: number, yaw: number, dir: number): { runs: Run[]; x: number; z: number; yaw: number } {
  const target = dirYaw(dir)
  const dfz = -Math.sin(yaw)
  const sense = Math.abs(z) < 0.3 ? (dfz < 0 ? 1 : -1) : -Math.sign(z) * Math.sign(dfz || 1)
  let need = Math.abs(wrap(target - yaw))
  if (Math.sign(wrap(target - yaw)) !== sense) need = Math.PI * 2 - need
  const runs: Run[] = []
  const ds = 0.25
  const reach = (pz: number, h: number, off: number) => Math.abs(pz + Math.cos(h) * off)
  let turned = 0
  for (let phase = 0; phase < 12 && turned < need - 1e-4; phase++) {
    const forward = phase % 2 === 0
    const samples: Sample[] = [{ x, z, h: forward ? yaw : yaw + Math.PI, k: sense / rig.turn }]
    const last = phase >= 11
    while (turned < need - 1e-4) {
      const dyaw = Math.min(ds / rig.turn, need - turned)
      const step = dyaw * rig.turn
      const [fx, fz] = fwd(yaw + (sense * dyaw) / 2)
      const nx = x + fx * step * (forward ? 1 : -1), nz = z + fz * step * (forward ? 1 : -1)
      const ny = yaw + sense * dyaw
      const edge = forward ? reach(nz, ny, rig.nose - rig.rear) : reach(nz, ny, rig.tail - rig.rear)
      if (!last && edge > TURN_EDGE && samples.length > 2) break
      x = nx; z = nz; yaw = ny; turned += dyaw
      samples.push({ x, z, h: forward ? yaw : yaw + Math.PI, k: sense / rig.turn })
    }
    if (samples.length > 1) runs.push({ samples, dir: forward ? 1 : -1, slow: MANEUVER_SPEED })
  }
  return { runs, x, z, yaw: target }
}

interface Arrival { x: number; pre: [number, number][]; reverse?: [number, number][]; end: Spot }

/** The last part of a drive: where it leaves the lane, the points after that, and the pose it ends in. */
function arrival(to: Stop, rig: Rig, dir: number): Arrival {
  const spot = stopSpot(to)
  const lane = laneFor(dir)
  const reach = Math.max(10, rig.turn * 1.8)
  if (to.kind === 'edge') return { x: spot.x, pre: [[spot.x + rig.rear * dir, lane]], end: { x: spot.x, z: lane, yaw: dirYaw(dir) } }
  if (to.kind === 'drive') {
    const end: Spot = { x: spot.x, z: spot.z, yaw: 0 }
    const rx = end.x, rz = end.z + rig.rear
    return { x: -98.5 - dir * (rig.turn + 2), pre: [[-98.5 - dir * (rig.turn + 2), lane], [-98.5, lane], [-100.5, 13.5], [rx, rz]], end }
  }
  if (to.kind === 'bay') {
    const [bx, bz] = fwd(spot.yaw)
    const side = Math.sign(spot.z)
    if (bz * side < -0.7) {
      const rx = spot.x + bx * rig.rear, rz = spot.z + bz * rig.rear
      const turnX = spot.x + dir * (rig.turn + 2.5)
      return { x: turnX, pre: [[turnX, lane]], reverse: [[turnX, lane], [spot.x, lane], [rx, rz]], end: spot }
    }
    const face = Math.abs(bx) > 0.7 && bx * dir < 0 ? dir : Math.sign(bx) || dir
    const end: Spot = face === Math.sign(bx) ? spot : { x: spot.x, z: spot.z, yaw: dirYaw(face) }
    const rx = spot.x + face * rig.rear
    return { x: rx - face * reach, pre: [[rx - face * reach, lane], [rx - face * reach * 0.4, spot.z], [rx, spot.z]], end }
  }
  const rx = spot.x + dir * rig.rear
  return { x: rx - dir * reach, pre: [[rx - dir * reach, lane], [rx - dir * reach * 0.35, spot.z], [rx, spot.z]], end: { x: spot.x, z: spot.z, yaw: dirYaw(dir) } }
}

/** A drive from the vehicle's current pose to a stop: out to the lane for the direction of travel, along it, and in at the other end. */
export function route(from: Stop, to: Stop, rush: boolean, kind: VehicleKind, pose: Spot): Path {
  const rig = RIGS[kind]
  const target = stopSpot(to)
  const [fx, fz] = fwd(pose.yaw)
  let x = pose.x + fx * rig.rear, z = pose.z + fz * rig.rear
  const away = to.kind === 'edge' ? to.end : Math.sign(target.x - x) || Math.sign(fx) || 1
  const runs: Run[] = []
  const yaw = pose.yaw
  let pts: [number, number][] = [[x, z]]
  const reach = Math.max(10, rig.turn * 1.8)
  const onRoad = Math.abs(z) <= ROAD_EDGE

  if (from.kind === 'drive') {
    pts.push([-100.5, 23.5], [-99.6, 26.4], [-95.9, 26.4], [-95, 23.5], [-95, APRON], [-95, laneFor(away)], [-95 + away * (rig.turn + 3), laneFor(away)])
  } else if (!onRoad && fz * Math.sign(z) < -0.7) {
    pts.push([x, laneFor(away)], [x + away * (rig.turn + 3), laneFor(away)])
  } else {
    const facing = Math.abs(fx) > 0.3 ? Math.sign(fx) : away
    const lane = laneFor(facing)
    if (facing !== away && onRoad) {
      const k = turnAround(rig, x, z, yaw, away)
      runs.push(...k.runs)
      x = k.x; z = k.z
      pts = [[x, z], [x + away * 3, z], [x + away * (reach * 0.8), laneFor(away)]]
    } else {
      if (Math.abs(z - lane) > 0.1 || !onRoad) pts.push([x + facing * 2, z], [x + facing * reach * 0.6, z + (lane - z) * 0.5], [x + facing * reach, lane])
      if (facing !== away) {
        const last = pts[pts.length - 1]
        pts.push([last[0] + facing * 3, lane])
        runs.push({ samples: rounded(pts, rig.turn), dir: 1 })
        const tail = pts[pts.length - 1]
        const k = turnAround(rig, tail[0], tail[1], dirYaw(facing), away)
        runs.push(...k.runs)
        x = k.x; z = k.z
        pts = [[x, z], [x + away * 3, z], [x + away * (reach * 0.8), laneFor(away)]]
      }
    }
  }

  const a = arrival(to, rig, away)
  const lane = laneFor(away)
  const last = pts[pts.length - 1]
  if ((a.x - last[0]) * away > 2) {
    if (Math.abs(last[1] - lane) > 0.1) pts.push([last[0] + away * reach * 0.6, lane])
    pts.push(...a.pre)
  } else pts.push(...a.pre.slice(-2))
  runs.push({ samples: rounded(pts, rig.turn), dir: 1 })
  if (a.reverse) runs.push({ samples: rounded(a.reverse, rig.turn).map(s => ({ ...s })), dir: -1, slow: REVERSE_SPEED })
  return profile(rig, runs, rush, a.end)
}

function smoothCurve(samples: Sample[], span: number): number[] {
  const out = new Array<number>(samples.length).fill(0)
  const w = Math.max(1, Math.round(span / STEP))
  for (let i = 0; i < samples.length; i++) {
    let sum = 0, n = 0
    for (let j = Math.max(0, i - w); j <= Math.min(samples.length - 1, i + w); j++) { sum += samples[j].k; n++ }
    out[i] = sum / n
  }
  return out
}

/** Speeds and times for every sample: limited by the road, the corners and the vehicle's acceleration and braking, stopped at each end. */
function profile(rig: Rig, runs: Run[], rush: boolean, end: Spot): Path {
  const boost = rush ? 1.35 : 1
  const xs: number[] = [], zs: number[] = [], hs: number[] = [], ks: number[] = [], ss: number[] = [], vs: number[] = [], ts: number[] = [], ds: number[] = []
  let s = 0, t = 0
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r]
    const smp = run.samples.length > 1 ? run.samples : [...run.samples, ...run.samples]
    const curve = smoothCurve(smp, 1.0)
    const look = smoothCurve(smp.map(p => ({ ...p, k: Math.abs(p.k) })), 2.5)
    const n = smp.length
    const seg: number[] = [0]
    for (let i = 1; i < n; i++) seg.push(Math.hypot(smp[i].x - smp[i - 1].x, smp[i].z - smp[i - 1].z))
    const cap = smp.map((p, i) => {
      const road = Math.abs(p.z) <= ROAD_EDGE ? ROAD_SPEED : YARD_SPEED
      let v = road * boost
      if (run.slow) v = Math.min(v, run.slow)
      const k = Math.max(Math.abs(curve[i]), look[i])
      if (k > 1e-4) v = Math.min(v, Math.sqrt((rig.grip * (rush ? 1.25 : 1)) / k))
      return v
    })
    cap[0] = 0
    cap[n - 1] = 0
    const accel = rig.accel * (rush ? 1.3 : 1)
    const brake = rig.brake * (rush ? 1.2 : 1)
    const v = cap.slice()
    for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * accel * seg[i]))
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * brake * seg[i + 1]))
    if (r > 0) t += SHIFT_PAUSE
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const avg = (v[i] + v[i - 1]) / 2
        t += avg > 0.02 ? seg[i] / avg : Math.sqrt((2 * seg[i]) / accel)
        s += seg[i]
      }
      xs.push(smp[i].x); zs.push(smp[i].z); hs.push(wrap(smp[i].h + (run.dir < 0 ? Math.PI : 0))); ks.push(curve[i]); ss.push(s); vs.push(v[i]); ts.push(t); ds.push(run.dir)
    }
  }
  return {
    rig, x: Float64Array.from(xs), z: Float64Array.from(zs), yaw: Float64Array.from(hs), curve: Float64Array.from(ks), s: Float64Array.from(ss),
    v: Float64Array.from(vs), times: Float64Array.from(ts), dir: Int8Array.from(ds), duration: t, end,
  }
}

function pointAtDistance(path: Path, s: number, bodyYaw: number, fromX: number, fromZ: number, back: number): [number, number] {
  const n = path.s.length
  if (s <= path.s[0]) {
    const [fx, fz] = fwd(bodyYaw)
    return [fromX - fx * back, fromZ - fz * back]
  }
  if (s >= path.s[n - 1]) return [path.x[n - 1], path.z[n - 1]]
  let lo = 0, hi = n - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path.s[mid] <= s) lo = mid; else hi = mid }
  const span = path.s[hi] - path.s[lo] || 1
  const f = (s - path.s[lo]) / span
  return [path.x[lo] + (path.x[hi] - path.x[lo]) * f, path.z[lo] + (path.z[hi] - path.z[lo]) * f]
}

/** Where the vehicle is, which way it points, how fast it goes and how the wheels are turned, a given number of seconds into a drive. */
export function alongPath(path: Path, t: number): DriveState {
  const { rig } = path
  const n = path.times.length
  let i: number
  if (t <= 0) i = 0
  else if (t >= path.duration) i = n - 1
  else {
    let lo = 0, hi = n - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path.times[mid] <= t) lo = mid; else hi = mid }
    i = lo
  }
  let x: number, z: number, h: number, v: number, a = 0, k: number, s: number
  let dir = path.dir[Math.min(i + 1, n - 1)]
  if (i >= n - 1 || t <= 0) {
    const j = t <= 0 ? 0 : n - 1
    x = path.x[j]; z = path.z[j]; h = path.yaw[j]; v = 0; k = 0; s = path.s[j]
    if (j === n - 1) return { x: path.end.x, z: path.end.z, yaw: path.end.yaw, speed: 0, accel: 0, lat: 0, steer: 0, trailer: 0 }
  } else {
    const t0 = path.times[i], t1 = path.times[i + 1]
    const dt = t1 - t0
    const v0 = path.v[i], v1 = path.v[i + 1]
    const seg = path.s[i + 1] - path.s[i]
    const tau = t - t0
    a = dt > 1e-6 ? (v1 - v0) / dt : 0
    const moved = v0 * tau + 0.5 * a * tau * tau
    const f = seg > 1e-6 ? Math.max(0, Math.min(1, moved / seg)) : 0
    x = path.x[i] + (path.x[i + 1] - path.x[i]) * f
    z = path.z[i] + (path.z[i + 1] - path.z[i]) * f
    h = path.yaw[i] + wrap(path.yaw[i + 1] - path.yaw[i]) * f
    if (seg <= 1e-6) dir = path.dir[i]
    v = seg > 1e-6 ? v0 + a * tau : 0
    if (seg <= 1e-6) a = 0
    k = path.curve[i] + (path.curve[i + 1] - path.curve[i]) * f
    s = path.s[i] + seg * f
  }
  const yaw = wrap(h)
  const [fx, fz] = fwd(yaw)
  const ox = x - fx * rig.rear, oz = z - fz * rig.rear
  const wheelbase = rig.front - rig.rear
  let trailer = 0
  if (rig.trailer) {
    const hx = ox + fx * rig.trailer.hitch, hz = oz + fz * rig.trailer.hitch
    const back = rig.rear - rig.trailer.hitch + rig.trailer.axle
    const [px, pz] = dir > 0 ? pointAtDistance(path, s - back, yaw, x, z, back) : pointAtDistance(path, s + back, yaw, x, z, back)
    const ty = yawOf(hx - px, hz - pz)
    trailer = Math.max(-1.2, Math.min(1.2, wrap(ty - yaw)))
  }
  return { x: ox, z: oz, yaw, speed: dir * v, accel: dir * a, lat: -dir * v * v * k, steer: Math.max(-0.62, Math.min(0.62, Math.atan(wheelbase * k * dir))), trailer }
}
