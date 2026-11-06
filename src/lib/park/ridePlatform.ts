import { mat4 } from './gl'
import type { Mat4 } from './gl'
import type { RideMesh } from './rideMesh'
import { rideMatrices, splitPieces } from './ridePieces'
import type { RideInstance } from './rideMesh'
import { mainLift } from './rideMotion'
import type { MotionClock } from './rideMotion'
import { CUSTOM_RIDE_LIMITS } from '../../../server/park/index.mjs'
import type { CustomRideMotion, CustomRidePlatform } from '../../../server/park/index.mjs'

/** Part id of the generated base's fixed geometry (drawn with the ride's base). */
export const PLATFORM_PART = 249
/** Part ids of the telescoping column's sections, 250 + section. */
export const COLUMN_PART = 250

const TILE = 4
type V3 = [number, number, number]
type Raw = { triangles: number; positions: Float32Array; normals: Float32Array; colors: Float32Array }

export const STEP_LABEL: Record<CustomRidePlatform['steps'], string> = { none: 'No steps', front: 'Front', back: 'Back', left: 'Left', right: 'Right', sides: 'Left and right', all: 'All four sides' }
export const SHAPE_LABEL: Record<CustomRidePlatform['shape'], string> = { square: 'Square', round: 'Round', octagon: 'Octagon', hexagon: 'Hexagon' }

export const platformTop = (platform: CustomRidePlatform | undefined) => platform?.enabled ? platform.height : 0

const hex = (value: string): V3 => [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255]
const shade = (c: V3, k: number): V3 => [c[0] * k, c[1] * k, c[2] * k]

/** Where the support column runs, in ride space; null when there is none. */
export function columnSpan(platform: CustomRidePlatform | undefined, motion: CustomRideMotion) {
  if (!platform?.enabled || platform.column === 'none') return null
  const z0 = platformTop(platform)
  const z1 = platform.columnTop > z0 + 0.1 ? platform.columnTop : motion.split
  if (z1 - z0 < 0.1) return null
  return { x: motion.pivot[0], y: motion.pivot[1], z0, z1, length: z1 - z0 }
}

class Writer {
  P: number[] = []; N: number[] = []; C: number[] = []; parts: number[] = []
  get triangles() { return this.parts.length }
  face(a: V3, b: V3, c: V3, color: V3, part: number, inside: V3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz)
    if (l < 1e-9) return
    nx /= l; ny /= l; nz /= l
    const mx = (a[0] + b[0] + c[0]) / 3 - inside[0], my = (a[1] + b[1] + c[1]) / 3 - inside[1], mz = (a[2] + b[2] + c[2]) / 3 - inside[2]
    if (nx * mx + ny * my + nz * mz < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz }
    for (const p of [a, b, c]) { this.P.push(...p); this.N.push(nx, ny, nz); this.C.push(...color) }
    this.parts.push(part)
  }
  quad(a: V3, b: V3, c: V3, d: V3, color: V3, part: number, inside: V3) { this.face(a, b, c, color, part, inside); this.face(a, c, d, color, part, inside) }
  /** A straight-sided solid over a convex outline. */
  prism(outline: [number, number][], z0: number, z1: number, top: V3, side: V3, part: number, bottom = false) {
    const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length, cy = outline.reduce((s, p) => s + p[1], 0) / outline.length
    const inside: V3 = [cx, cy, (z0 + z1) / 2]
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % outline.length]
      this.quad([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], side, part, inside)
      this.face([cx, cy, z1], [p[0], p[1], z1], [q[0], q[1], z1], top, part, inside)
      if (bottom) this.face([cx, cy, z0], [p[0], p[1], z0], [q[0], q[1], z0], shade(side, 0.6), part, inside)
    })
  }
  /** A flat band around an outline: outer wall plus a top ring. */
  band(outline: [number, number][], grow: number, shrink: number, z0: number, z1: number, color: V3, part: number) {
    const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length, cy = outline.reduce((s, p) => s + p[1], 0) / outline.length
    const at = (p: [number, number], k: number): [number, number] => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]
    const inside: V3 = [cx, cy, (z0 + z1) / 2], below: V3 = [cx, cy, z0 - 50]
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % outline.length]
      const po = at(p, grow), qo = at(q, grow), pi = at(p, shrink), qi = at(q, shrink)
      this.quad([po[0], po[1], z0], [qo[0], qo[1], z0], [qo[0], qo[1], z1], [po[0], po[1], z1], color, part, inside)
      this.quad([pi[0], pi[1], z1], [po[0], po[1], z1], [qo[0], qo[1], z1], [qi[0], qi[1], z1], color, part, below)
    })
  }
  /** A square-section bar between two points. */
  beam(a: V3, b: V3, width: number, color: V3, part: number) {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const len = Math.hypot(...d)
    if (len < 1e-6) return
    const dn: V3 = [d[0] / len, d[1] / len, d[2] / len]
    const up: V3 = Math.abs(dn[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
    let s: V3 = [dn[1] * up[2] - dn[2] * up[1], dn[2] * up[0] - dn[0] * up[2], dn[0] * up[1] - dn[1] * up[0]]
    const sl = Math.hypot(...s); s = [s[0] / sl * width / 2, s[1] / sl * width / 2, s[2] / sl * width / 2]
    let u: V3 = [s[1] * dn[2] - s[2] * dn[1], s[2] * dn[0] - s[0] * dn[2], s[0] * dn[1] - s[1] * dn[0]]
    const ul = Math.hypot(...u) || 1; u = [u[0] / ul * width / 2, u[1] / ul * width / 2, u[2] / ul * width / 2]
    const corner = (p: V3, i: number, j: number): V3 => [p[0] + s[0] * i + u[0] * j, p[1] + s[1] * i + u[1] * j, p[2] + s[2] * i + u[2] * j]
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    const A = ring.map(([i, j]) => corner(a, i, j)), B = ring.map(([i, j]) => corner(b, i, j))
    const inside: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    for (let k = 0; k < 4; k++) this.quad(A[k], A[(k + 1) % 4], B[(k + 1) % 4], B[k], color, part, inside)
    this.quad(A[0], A[1], A[2], A[3], color, part, inside)
    this.quad(B[0], B[1], B[2], B[3], color, part, inside)
  }
  cylinder(x: number, y: number, z0: number, z1: number, r: number, color: V3, part: number) {
    const sides = 20, ring: [number, number][] = []
    for (let i = 0; i < sides; i++) { const a = i / sides * Math.PI * 2; ring.push([x + Math.cos(a) * r, y + Math.sin(a) * r]) }
    this.prism(ring, z0, z1, shade(color, 1.05), color, part)
  }
}

/** The base's outline at a scale (1 = the full fill). */
function outline(platform: CustomRidePlatform, size: [number, number], scale: number): [number, number][] {
  const hx = size[0] * TILE / 2 * platform.fill * scale, hy = size[1] * TILE / 2 * platform.fill * scale
  if (platform.shape === 'square') return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]
  const sides = platform.shape === 'round' ? 40 : platform.shape === 'octagon' ? 8 : 6
  const turn = platform.shape === 'octagon' ? Math.PI / 8 : 0
  const fit = platform.shape === 'round' ? 1 : 1 / Math.cos(Math.PI / sides)
  const k = platform.shape === 'octagon' ? fit : 1
  return Array.from({ length: sides }, (_, i) => { const a = turn + i / sides * Math.PI * 2; return [Math.cos(a) * hx * k, Math.sin(a) * hy * k] as [number, number] })
}

const DIRECTIONS: Record<'front' | 'back' | 'left' | 'right', [number, number]> = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] }
export function stepSides(steps: CustomRidePlatform['steps']): (keyof typeof DIRECTIONS)[] {
  if (steps === 'none') return []
  if (steps === 'sides') return ['left', 'right']
  if (steps === 'all') return ['front', 'back', 'left', 'right']
  return [steps]
}

/** How far the base reaches from the centre along a direction, at a scale. */
function extent(platform: CustomRidePlatform, size: [number, number], scale: number, dir: [number, number]) {
  const hx = size[0] * TILE / 2 * platform.fill * scale, hy = size[1] * TILE / 2 * platform.fill * scale
  if (platform.shape === 'square') return Math.abs(dir[0]) * hx + Math.abs(dir[1]) * hy
  const sides = platform.shape === 'round' ? 40 : platform.shape === 'octagon' ? 8 : 6
  const flat = platform.shape === 'hexagon' && dir[1] !== 0 ? Math.cos(Math.PI / sides) : 1
  return (Math.abs(dir[0]) * hx + Math.abs(dir[1]) * hy) * flat
}

const tierScale = (platform: CustomRidePlatform, tier: number) => Math.max(0.2, 1 - tier * platform.inset)

/** Metres the steps reach past the footprint edge (0 when they fit). */
export function stepOverhang(platform: CustomRidePlatform, size: [number, number]) {
  if (!platform.enabled || platform.height < 0.15) return 0
  let worst = 0
  for (const side of stepSides(platform.steps)) {
    const dir = DIRECTIONS[side]
    const reach = stairRun(platform, size, dir).end
    const edge = (Math.abs(dir[0]) * size[0] + Math.abs(dir[1]) * size[1]) * TILE / 2
    worst = Math.max(worst, reach - edge)
  }
  return Math.max(0, worst)
}

function stairRun(platform: CustomRidePlatform, size: [number, number], dir: [number, number]) {
  const count = Math.max(1, Math.ceil(platform.height / 0.2))
  const topEdge = extent(platform, size, tierScale(platform, platform.tiers - 1), dir)
  const baseEdge = extent(platform, size, 1, dir)
  const tread = Math.max(0.28, (baseEdge - topEdge + 0.3) / count)
  return { count, topEdge, tread, end: topEdge + count * tread }
}

/** Builds the base, steps, railing and column as triangles in ride space. */
export function platformGeometry(platform: CustomRidePlatform, motion: CustomRideMotion, size: [number, number]) {
  const w = new Writer()
  if (!platform.enabled) return w
  const top = hex(platform.top), side = hex(platform.side), trim = hex(platform.trim), stepColor = hex(platform.stepColor), fenceColor = hex(platform.fenceColor), columnColor = hex(platform.columnColor)
  const H = platform.height, tierH = H / platform.tiers
  if (H > 0.005) for (let t = 0; t < platform.tiers; t++) {
    const shape = outline(platform, size, tierScale(platform, t))
    const z0 = t * tierH, z1 = (t + 1) * tierH
    w.prism(shape, z0, z1, top, side, PLATFORM_PART)
    if (platform.edge) w.band(shape, 1.012, 0.97, z1 - Math.min(0.12, tierH * 0.45), z1 + 0.012, trim, PLATFORM_PART)
  }
  const sides = H >= 0.15 ? stepSides(platform.steps) : []
  const stairWidth = (dir: [number, number]) => Math.min(3.2, 0.42 * (Math.abs(dir[0]) * size[1] + Math.abs(dir[1]) * size[0]) * TILE * platform.fill)
  for (const name of sides) {
    const dir = DIRECTIONS[name], run = stairRun(platform, size, dir), half = stairWidth(dir) / 2, riser = H / run.count
    const perp: [number, number] = [-dir[1], dir[0]]
    for (let j = 0; j < run.count; j++) {
      const near = run.topEdge - 0.05, far = run.topEdge + (run.count - j) * run.tread
      const corners: [number, number][] = [
        [dir[0] * near + perp[0] * half, dir[1] * near + perp[1] * half], [dir[0] * far + perp[0] * half, dir[1] * far + perp[1] * half],
        [dir[0] * far - perp[0] * half, dir[1] * far - perp[1] * half], [dir[0] * near - perp[0] * half, dir[1] * near - perp[1] * half],
      ]
      w.prism(corners, j * riser, (j + 1) * riser, j % 2 ? shade(stepColor, 1.06) : stepColor, shade(stepColor, 0.82), PLATFORM_PART)
    }
  }
  if (platform.fence && H > 0.005) {
    const shape = outline(platform, size, tierScale(platform, platform.tiers - 1)).map(([x, y]) => { const l = Math.hypot(x, y) || 1, k = Math.max(0.3, (l - 0.15) / l); return [x * k, y * k] as [number, number] })
    const gaps = sides.map(name => ({ dir: DIRECTIONS[name], half: stairWidth(DIRECTIONS[name]) / 2 + 0.1 }))
    const open = (x: number, y: number) => gaps.some(g => x * g.dir[0] + y * g.dir[1] > 0 && Math.abs(x * -g.dir[1] + y * g.dir[0]) < g.half)
    const z = H, rail = platform.fenceHeight, post = 0.07
    let walked = 0
    shape.forEach((p, i) => {
      const q = shape[(i + 1) % shape.length]
      const length = Math.hypot(q[0] - p[0], q[1] - p[1])
      const pieces = Math.max(1, Math.round(length / 1.6))
      for (let k = 0; k < pieces; k++) {
        const a: [number, number] = [p[0] + (q[0] - p[0]) * k / pieces, p[1] + (q[1] - p[1]) * k / pieces]
        const b: [number, number] = [p[0] + (q[0] - p[0]) * (k + 1) / pieces, p[1] + (q[1] - p[1]) * (k + 1) / pieces]
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        if (!open(mid[0], mid[1])) {
          for (const h of [rail, rail * 0.5]) w.beam([a[0], a[1], z + h], [b[0], b[1], z + h], 0.06, fenceColor, PLATFORM_PART)
        }
        walked += length / pieces
        if ((walked >= 1.5 || platform.shape !== 'round') && !(open(a[0], a[1]) && open(mid[0], mid[1]))) { walked = 0; w.beam([a[0], a[1], z], [a[0], a[1], z + rail + 0.04], post, fenceColor, PLATFORM_PART) }
      }
    })
  }
  const span = columnSpan(platform, motion)
  if (span) {
    if (platform.column === 'fixed') w.cylinder(span.x, span.y, span.z0, span.z1, platform.columnRadius, columnColor, PLATFORM_PART)
    else for (let k = 0; k < platform.columnSections; k++) {
      const r = platform.columnRadius * (1 - 0.17 * k)
      w.cylinder(span.x, span.y, span.z0, span.z1, r, k % 2 ? shade(columnColor, 1.12) : columnColor, COLUMN_PART + k)
    }
  }
  return w
}

/**
 * The finished ride mesh: the fitted model lifted onto the base, split into moving parts,
 * with the base, steps, railing and column added as their own parts.
 */
export function assembleRide(raw: Raw, motion: CustomRideMotion, platform: CustomRidePlatform | undefined, size: [number, number]): RideMesh {
  const lift = platformTop(platform)
  const positions = new Float32Array(raw.positions)
  if (lift) for (let c = 2; c < positions.length; c += 3) positions[c] += lift
  const { parts, instances } = splitPieces(positions, raw.triangles, motion)
  const extra = platform ? platformGeometry(platform, motion, size) : new Writer()
  const added = Math.min(extra.triangles, CUSTOM_RIDE_LIMITS.platformTriangles)
  const triangles = raw.triangles + added, corners = triangles * 3
  const P = new Float32Array(corners * 3), N = new Float32Array(corners * 3), C = new Float32Array(corners * 3), parts2 = new Uint8Array(corners)
  P.set(positions); N.set(raw.normals); C.set(raw.colors); parts2.set(parts)
  P.set(extra.P.slice(0, added * 9), raw.triangles * 9); N.set(extra.N.slice(0, added * 9), raw.triangles * 9); C.set(extra.C.slice(0, added * 9), raw.triangles * 9)
  for (let t = 0; t < added; t++) parts2.fill(extra.parts[t], (raw.triangles + t) * 3, (raw.triangles + t) * 3 + 3)
  let height = 0
  for (let c = 2; c < P.length; c += 3) height = Math.max(height, P[c])
  return { triangles, positions: P, normals: N, colors: C, parts: parts2, height, instances }
}

/** Removes a previously baked base so a saved ride can be rebuilt with new base settings. */
export function stripPlatform(mesh: RideMesh, platform: CustomRidePlatform | undefined): Raw {
  const keep: number[] = []
  for (let t = 0; t < mesh.triangles; t++) if (mesh.parts[t * 3] < PLATFORM_PART) keep.push(t)
  const lift = platformTop(platform)
  const positions = new Float32Array(keep.length * 9), normals = new Float32Array(keep.length * 9), colors = new Float32Array(keep.length * 9)
  keep.forEach((t, i) => {
    positions.set(mesh.positions.subarray(t * 9, t * 9 + 9), i * 9)
    normals.set(mesh.normals.subarray(t * 9, t * 9 + 9), i * 9)
    colors.set(mesh.colors.subarray(t * 9, t * 9 + 9), i * 9)
  })
  if (lift) for (let c = 2; c < positions.length; c += 3) positions[c] -= lift
  return { triangles: keep.length, positions, normals, colors }
}

/** Transforms for the column sections: each stretches up from the base to keep the rising part connected. */
export function columnMatrices(platform: CustomRidePlatform | undefined, motion: CustomRideMotion, lift: number, out: Mat4[]) {
  if (!platform?.enabled || platform.column !== 'telescoping') return
  const span = columnSpan(platform, motion)
  if (!span) return
  const sections = platform.columnSections
  for (let k = 0; k < sections; k++) {
    const share = sections === 1 ? 1 : k / (sections - 1)
    const stretch = Math.max(0.05, (span.length + Math.max(0, lift) * share) / span.length)
    out[COLUMN_PART + k] = mat4.chain(mat4.translation(0, 0, span.z0), mat4.scaling(1, 1, stretch), mat4.translation(0, 0, -span.z0))
  }
}

/** Every part's transform, including the base (fixed) and the telescoping column sections. */
export function partMatrices(motion: CustomRideMotion, platform: CustomRidePlatform | undefined, instances: RideInstance[], clock: MotionClock, rideTime: number, height: number): Mat4[] {
  const out = rideMatrices(motion, instances, clock, rideTime, height)
  out[PLATFORM_PART] = out[0]
  columnMatrices(platform, motion, mainLift(motion, clock, rideTime, height), out)
  return out
}
