import { mat4 } from './gl'
import type { Mat4 } from './gl'
import type { RideInstance } from './rideMesh'
import { motionMatrix } from './rideMotion'
import type { MotionClock } from './rideMotion'
import { CUSTOM_RIDE_LIMITS } from '../../../server/park/index.mjs'
import type { CustomPieceMotionType, CustomRideMotion, CustomRidePiece } from '../../../server/park/index.mjs'

const TAU = Math.PI * 2
const GRAVITY = 9.81

export const PIECE_INFO: Record<CustomPieceMotionType, { label: string; hint: string; amount: string | null; hang: CustomRidePiece['hang'] }> = {
  spin: { label: 'Spin on its own', hint: 'Each piece turns around its own upright axis while it rides along, like teacups or spinning cages.', amount: null, hang: 'centre' },
  swing: { label: 'Swing freely', hint: 'Each piece hangs from its pivot, swings out as the ride speeds up and sways like a pendulum, like chair swings or hanging gondolas.', amount: 'Looseness', hang: 'top' },
  wobble: { label: 'Wobble', hint: 'Each piece rocks unevenly on its pivot, like a tub on a scrambler.', amount: 'Wobble', hang: 'bottom' },
  flip: { label: 'Flip', hint: 'Each piece somersaults around a level axle through its pivot. At 100% it loops all the way round; lower values rock it back and forth instead.', amount: 'Flip', hang: 'centre' },
  bob: { label: 'Bob', hint: 'Each piece rises and falls on its own beat, like carousel horses.', amount: 'Bounce', hang: 'centre' },
  level: { label: 'Stay level', hint: 'Each piece stays upright while whatever carries it turns or tips, like big wheel gondolas.', amount: 'Sway', hang: 'top' },
}

export const AXIS_LABEL: Record<CustomRidePiece['axis'], string> = { radial: 'Pointing out from the centre', tangent: 'Along the direction of travel', x: 'Across the width', y: 'Across the depth' }

export function newPiece(type: CustomPieceMotionType, height: number): CustomRidePiece {
  const low = Math.max(0.5, Math.round(height * 0.45 * 10) / 10)
  return {
    type, speed: 1, amount: type === 'flip' ? 1 : 0.6,
    from: 0, to: type === 'level' ? Math.round(height * 10) / 10 : low, inner: 1, outer: CUSTOM_RIDE_LIMITS.reachMax,
    split: 'pieces', count: 8, hang: PIECE_INFO[type].hang, axis: 'radial', stagger: type === 'flip' ? 0.3 : 0.5, alternate: false, on: -1,
  }
}

type Split = { parts: Uint8Array; instances: RideInstance[]; claimed: number[] }

class Union {
  parent: Int32Array
  constructor(n: number) { this.parent = new Int32Array(n); for (let i = 0; i < n; i++) this.parent[i] = i }
  find(a: number): number { while (this.parent[a] !== a) { this.parent[a] = this.parent[this.parent[a]]; a = this.parent[a] } return a }
  join(a: number, b: number) { const x = this.find(a), y = this.find(b); if (x !== y) this.parent[x] = y }
}

const centroid = (P: Float32Array, t: number, k: number) => (P[t * 9 + k] + P[t * 9 + 3 + k] + P[t * 9 + 6 + k]) / 3

/** Connected clusters of triangles (welded by position), with crumbs merged into the nearest big cluster. */
function connectedClusters(P: Float32Array, tris: number[], budget: number): number[][] {
  const union = new Union(tris.length), seen = new Map<string, number>()
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3
      const key = `${Math.round(P[o] * 200)},${Math.round(P[o + 1] * 200)},${Math.round(P[o + 2] * 200)}`
      const other = seen.get(key)
      if (other === undefined) seen.set(key, i); else union.join(i, other)
    }
  })
  const groups = new Map<number, number[]>()
  tris.forEach((t, i) => { const root = union.find(i); const list = groups.get(root); if (list) list.push(t); else groups.set(root, [t]) })
  let clusters = [...groups.values()].sort((a, b) => b.length - a.length)
  const crumb = Math.max(6, Math.round(tris.length * 0.02))
  const centre = (list: number[]) => { let x = 0, y = 0, z = 0; for (const t of list) { x += centroid(P, t, 0); y += centroid(P, t, 1); z += centroid(P, t, 2) } return [x / list.length, y / list.length, z / list.length] }
  const keep = clusters.filter((c, i) => i === 0 || c.length >= crumb)
  const extra = clusters.filter((c, i) => i !== 0 && c.length < crumb)
  while (keep.length > budget) extra.push(keep.pop()!)
  const centres = keep.map(centre)
  for (const bit of extra) {
    const [x, y, z] = centre(bit)
    let best = 0, bestD = Infinity
    centres.forEach((c, i) => { const d = (c[0] - x) ** 2 + (c[1] - y) ** 2 + (c[2] - z) ** 2; if (d < bestD) { bestD = d; best = i } })
    keep[best].push(...bit)
  }
  clusters = keep
  return clusters
}

/** Equal slices around the main pivot, turned so the cuts fall where the model is emptiest. */
function sectorClusters(P: Float32Array, tris: number[], count: number, px: number, py: number): number[][] {
  const angles = tris.map(t => Math.atan2(centroid(P, t, 1) - py, centroid(P, t, 0) - px))
  const width = TAU / count
  let bestOffset = 0, bestHits = Infinity
  for (let step = 0; step < 36; step++) {
    const offset = (step / 36) * width
    let hits = 0
    for (const a of angles) { const local = (((a - offset) % width) + width) % width; if (local < width * 0.04 || local > width * 0.96) hits++ }
    if (hits < bestHits) { bestHits = hits; bestOffset = offset }
  }
  const clusters: number[][] = Array.from({ length: count }, () => [])
  tris.forEach((t, i) => clusters[Math.min(count - 1, Math.floor(((((angles[i] - bestOffset) % TAU) + TAU) % TAU) / width))].push(t))
  return clusters.filter(c => c.length)
}

/**
 * Splits a fitted ride into its base (0), main moving part (1) and extra moving pieces (2 + n).
 * Pieces ride on the main moving part unless `on` is -2 (the base) or an earlier piece.
 * Later pieces claim triangles before earlier ones, so a cage listed after the arm it hangs from keeps its own triangles.
 */
export function splitPieces(positions: Float32Array, triangles: number, motion: CustomRideMotion): Split {
  const P = positions, parts = new Uint8Array(triangles * 3)
  const moving = motion.type !== 'none'
  const [px, py] = motion.pivot
  const main = new Uint8Array(triangles)
  for (let t = 0; t < triangles; t++) main[t] = moving && centroid(P, t, 2) >= motion.split ? 1 : 0
  const pieces = motion.pieces ?? []
  const owner = new Int16Array(triangles).fill(-1)
  pieces.forEach((piece, g) => {
    for (let t = 0; t < triangles; t++) {
      const z = centroid(P, t, 2)
      if (z < piece.from || z > piece.to) continue
      const r = Math.hypot(centroid(P, t, 0) - px, centroid(P, t, 1) - py)
      if (r < piece.inner || r > piece.outer) continue
      owner[t] = g
    }
  })
  const instances: RideInstance[] = []
  const claimed = pieces.map(() => 0)
  const groupStart: number[] = []
  const cap = CUSTOM_RIDE_LIMITS.instancesMax
  pieces.forEach((piece, g) => {
    groupStart[g] = instances.length
    const tris: number[] = []
    for (let t = 0; t < triangles; t++) if (owner[t] === g) tris.push(t)
    const room = cap - instances.length
    if (!tris.length || room <= 0) { tris.forEach(t => { owner[t] = -1 }); return }
    let clusters = piece.split === 'sectors' ? sectorClusters(P, tris, Math.min(piece.count, room), px, py) : connectedClusters(P, tris, room)
    const info = clusters.map(list => {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
      for (const t of list) for (let k = 0; k < 3; k++) {
        const o = t * 9 + k * 3
        x0 = Math.min(x0, P[o]); x1 = Math.max(x1, P[o]); y0 = Math.min(y0, P[o + 1]); y1 = Math.max(y1, P[o + 1]); z0 = Math.min(z0, P[o + 2]); z1 = Math.max(z1, P[o + 2])
      }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      const cz = piece.hang === 'top' ? z1 : piece.hang === 'bottom' ? z0 : (z0 + z1) / 2
      let reach = 0.3
      for (const t of list) for (let k = 0; k < 3; k++) { const o = t * 9 + k * 3; reach = Math.max(reach, Math.hypot(P[o] - cx, P[o + 1] - cy, P[o + 2] - cz)) }
      return { list, pivot: [cx, cy, cz] as [number, number, number], azimuth: Math.atan2(cy - py, cx - px), reach }
    })
    info.sort((a, b) => a.azimuth - b.azimuth)
    clusters = info.map(i => i.list)
    info.forEach((cluster, index) => {
      let carrier = moving && piece.on !== -2 ? 1 : 0
      if (piece.on >= 0 && piece.on < g) {
        let best = -1, bestD = Infinity
        for (let i = groupStart[piece.on]; i < instances.length; i++) {
          if (instances[i].group !== piece.on) continue
          const q = instances[i].pivot, d = (q[0] - cluster.pivot[0]) ** 2 + (q[1] - cluster.pivot[1]) ** 2 + (q[2] - cluster.pivot[2]) ** 2
          if (d < bestD) { bestD = d; best = i }
        }
        if (best >= 0) carrier = best + 2
      }
      const id = instances.length + 2
      instances.push({ group: g, carrier, index, pivot: cluster.pivot.map(v => Math.round(v * 1000) / 1000) as [number, number, number], azimuth: cluster.azimuth, reach: cluster.reach })
      for (const t of cluster.list) parts.fill(id, t * 3, t * 3 + 3)
      claimed[g] += cluster.list.length
    })
  })
  for (let t = 0; t < triangles; t++) if (owner[t] < 0 || parts[t * 3] < 2) parts.fill(main[t], t * 3, t * 3 + 3)
  return { parts, instances, claimed }
}

const around = (p: [number, number, number], rotation: Mat4) => mat4.chain(mat4.translation(p[0], p[1], p[2]), rotation, mat4.translation(-p[0], -p[1], -p[2]))
const turnedAbout = (azimuth: number, rotation: Mat4) => mat4.chain(mat4.rotZ(azimuth), rotation, mat4.rotZ(-azimuth))
const ease = (u: number) => u - Math.sin(TAU * u) / TAU

/** Smallest rotation that cancels the carrier's tilt, so a hanging piece keeps hanging straight down. */
function hangUpright(carrier: Mat4): Mat4 {
  const ux = carrier[2], uy = carrier[6], uz = carrier[10]
  const length = Math.hypot(ux, uy, uz) || 1
  const x = ux / length, y = uy / length, z = uz / length
  const sin = Math.hypot(x, y)
  if (sin < 1e-5) return z > 0 ? mat4.identity() : mat4.rotX(Math.PI)
  const angle = Math.atan2(sin, z), ax = -y / sin, ay = x / sin
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  const m = mat4.identity()
  m[0] = t * ax * ax + c; m[1] = t * ax * ay; m[2] = -s * ay
  m[4] = t * ax * ay; m[5] = t * ay * ay + c; m[6] = s * ax
  m[8] = s * ay; m[9] = -s * ax; m[10] = c
  return m
}

function axisTurn(piece: CustomRidePiece, instance: RideInstance, angle: number) {
  switch (piece.axis) {
    case 'x': return mat4.rotX(angle)
    case 'y': return mat4.rotY(angle)
    case 'tangent': return turnedAbout(instance.azimuth, mat4.rotY(angle))
    default: return turnedAbout(instance.azimuth, mat4.rotX(angle))
  }
}

function pieceLocal(piece: CustomRidePiece, instance: RideInstance, of: number, carrier: Mat4, motion: CustomRideMotion, clock: MotionClock, rideTime: number): Mat4 {
  const s = piece.speed, a = piece.amount, t = clock.spin, settle = Math.min(1, clock.speed)
  const step = of > 1 ? instance.index / of : 0
  const phase = piece.stagger * TAU * step
  const dir = piece.alternate && instance.index % 2 ? -1 : 1
  const pivot = instance.pivot
  switch (piece.type) {
    case 'spin': return around(pivot, mat4.rotZ(dir * t * s * 1.5 + phase))
    case 'bob': return mat4.translation(0, 0, (Math.sin(t * 2.4 * s + phase) * 0.5 + 0.5) * a * 2 * settle)
    case 'wobble': return around(pivot, mat4.chain(mat4.rotX(Math.sin(t * 1.9 * s + phase) * a * 0.4 * settle), mat4.rotY(Math.sin(t * 2.7 * s + phase * 1.7 + 1) * a * 0.4 * settle)))
    case 'flip': {
      if (!clock.running) return mat4.identity()
      const u = Math.min(1, Math.max(0, clock.timer / Math.max(1, rideTime)))
      if (a >= 0.98) {
        const lag = piece.stagger * 0.3 * step
        const v = Math.min(1, Math.max(0, (u - lag) / (1 - 0.3 * piece.stagger)))
        const loops = Math.max(1, Math.round(s * rideTime / 8))
        return around(pivot, axisTurn(piece, instance, dir * TAU * loops * ease(v)))
      }
      const cycles = Math.max(1, Math.round(s * rideTime / 6))
      return around(pivot, axisTurn(piece, instance, dir * Math.sin(TAU * cycles * u + phase) * a * Math.PI * Math.sin(Math.PI * u)))
    }
    case 'level': {
      const sway = Math.sin(t * 1.3 * s + phase) * a * 0.12 * settle
      return around(pivot, mat4.chain(hangUpright(carrier), axisTurn({ ...piece, axis: 'tangent' }, instance, sway)))
    }
    case 'swing': {
      const omega = motion.type === 'spin' ? motion.speed * Math.min(1, clock.speed) : 0
      const radius = Math.hypot(pivot[0] - motion.pivot[0], pivot[1] - motion.pivot[1])
      const lean = Math.min(1.25, Math.atan(omega * omega * radius / GRAVITY) * (0.5 + a))
      const beat = Math.sqrt(GRAVITY / Math.max(0.5, instance.reach)) * 0.6 * s
      const sway = a * 0.22 * settle
      const out = Math.sin(t * beat + phase) * sway, side = Math.sin(t * beat * 0.83 + phase * 2 + 0.7) * sway * 0.6
      return around(pivot, mat4.chain(hangUpright(carrier), turnedAbout(instance.azimuth, mat4.chain(mat4.rotY(-(lean + out)), mat4.rotX(side)))))
    }
    default: return mat4.identity()
  }
}

/**
 * Transforms for every part of a custom ride in ride-local park space: index 0 the base,
 * 1 the main moving part, 2 + n each extra piece, already carried by whatever holds it.
 */
export function rideMatrices(motion: CustomRideMotion, instances: RideInstance[], clock: MotionClock, rideTime: number, height: number): Mat4[] {
  const out: Mat4[] = [mat4.identity(), motionMatrix(motion, clock, rideTime, height)]
  const pieces = motion.pieces ?? []
  const counts = new Map<number, number>()
  for (const instance of instances) counts.set(instance.group, (counts.get(instance.group) ?? 0) + 1)
  instances.forEach((instance, i) => {
    const piece = pieces[instance.group]
    const carrier = out[instance.carrier < i + 2 ? instance.carrier : 0] ?? out[0]
    out.push(piece ? mat4.multiply(carrier, pieceLocal(piece, instance, counts.get(instance.group) ?? 1, carrier, motion, clock, rideTime)) : carrier)
  })
  return out
}
