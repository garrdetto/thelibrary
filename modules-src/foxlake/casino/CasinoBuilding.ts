/**
 * The casino's building in its own frame, made with the town's builders (fp/core/Geo.ts) under the casino's frame node:
 * Foxtails Gentlemen's Club as the photos from 16th Road and East Park Street show it, on its real footprint (`FOOTPRINT`,
 * square to the frame): one storey of light grey lap siding over a brick wainscot, low hip roofs in grey shingles with white
 * fascia over the hall, the north wing and the back bay, two skylights, the lit FOXTAIL board on the roof, big dark windows
 * down the south end, octagon portholes, the main door under a little gabled vestibule and a second door between brick
 * pillars where the wing steps forward, with the sidewalk along the front. The flash on top: pink neon under the eaves,
 * cyan neon along the wainscot, and marquee bulbs round every eave, the vestibule, the side door, the roof board and the pole
 * stage in three chase groups (`CasinoLights`, animated by `CasinoHost`); the windows glow pink at night. Inside: dark
 * carpet, a black ceiling with LED panels and a purple LED cove, the pole stage, the DJ booth in the back bay, the bar across
 * the north wing, the blackjack table and the slot cabinets (`CabinetModel.ts`). Walls and roof don't cast sun shadows, so
 * the room reads as lit from inside. Every solid gets a collider. Lettering is built in scene space by `CasinoHost`, so it
 * isn't mirrored.
 */
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { MeshBuilder, finishMesh, type RGB } from '../fp/core/Geo'
import type { Mats } from '../fp/core/Tex'
import type { Physics } from '../fp/physics/Physics'
import { BAR, BLACKJACK, BOOTH, CASINO, FOOTPRINT, MACHINE_SPOTS, ROOMS, STAGE } from './CasinoLayout'
import { buildCabinet, buildSlotChair } from './CabinetModel'

/** The colliders the building adds, in the casino's own frame (CasinoHost places them in the town). */
export type CasinoColliders = Pick<Physics, 'addStaticAABB' | 'addStaticCylinder' | 'addStaticBox'>

/** The glowing materials `CasinoHost` animates: three groups of marquee bulbs that chase in turn, and the neon tubes. */
export interface CasinoLights {
  chase: PBRMaterial[]
  neon: PBRMaterial[]
}

const WHITE: RGB = [1, 1, 1]
/** Brick wainscot height and the sidewalk out front, as the photos from 16th Road show. */
const WAINSCOT = 0.95
const SIDEWALK = 2.6
/** Roof rise per metre of run (about 20 degrees) and the eave overhang. */
const PITCH = 0.36
const OVERHANG = 0.45

/** One wall of the footprint: its slab inside the outline (box corners) and the way its outside faces (unit x or z). */
interface WallRun { x0: number; z0: number; x1: number; z1: number; out: [number, number] }

function wallRuns(): WallRun[] {
  const n = FOOTPRINT.length
  let area = 0
  for (let i = 0; i < n; i++) {
    const a = FOOTPRINT[i]
    const b = FOOTPRINT[(i + 1) % n]
    area += a.x * b.z - b.x * a.z
  }
  const sign = area > 0 ? 1 : -1
  const W = CASINO.wall
  const out: WallRun[] = []
  for (let i = 0; i < n; i++) {
    const a = FOOTPRINT[i]
    const b = FOOTPRINT[(i + 1) % n]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 0.05) continue
    const ix = Math.round((sign * -dz) / len)
    const iz = Math.round((sign * dx) / len)
    out.push({
      x0: Math.min(a.x, b.x, a.x + ix * W),
      x1: Math.max(a.x, b.x, a.x + ix * W),
      z0: Math.min(a.z, b.z, a.z + iz * W),
      z1: Math.max(a.z, b.z, a.z + iz * W),
      out: [-ix, -iz],
    })
  }
  return out
}

/** A row of marquee bulbs from (x0, z0) to (x1, z1) at height y, about `step` metres apart, dealt round the chase groups. */
function bulbRow(groups: MeshBuilder[], x0: number, z0: number, x1: number, z1: number, y: number, step = 0.42, r = 0.055): void {
  const count = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step))
  for (let i = 0; i <= count; i++) {
    const t = i / count
    groups[i % groups.length].cylinder(x0 + (x1 - x0) * t, y - r, z0 + (z1 - z0) * t, r, r, r * 2, 8)
  }
}

export function buildCasino(root: TransformNode, mats: Mats, physics: CasinoColliders): CasinoLights {
  const { height: H, wall: W, floorY } = CASINO
  const siding = new MeshBuilder()
  const brick = new MeshBuilder()
  const shingles = new MeshBuilder()
  const windows = new MeshBuilder()
  const doormat = new MeshBuilder()
  const skylight = new MeshBuilder()
  const signBoard = new MeshBuilder()
  const trim = new MeshBuilder()
  const floor = new MeshBuilder()
  const carpet = new MeshBuilder()
  const ceiling = new MeshBuilder()
  const panels = new MeshBuilder()
  const wood = new MeshBuilder()
  const dark = new MeshBuilder()
  const brass = new MeshBuilder()
  const chrome = new MeshBuilder()
  const leather = new MeshBuilder()
  const felt = new MeshBuilder()
  const stage = new MeshBuilder()
  const shelfGlow = new MeshBuilder()
  const bottles = new MeshBuilder()
  const glassB = new MeshBuilder()
  const pink = new MeshBuilder()
  const cyan = new MeshBuilder()
  const purple = new MeshBuilder()
  const chase = [new MeshBuilder(), new MeshBuilder(), new MeshBuilder()]
  const solids: [number, number, number, number, number, number][] = []

  /** A roof or wall face from four corners (a triangle repeats the last), wound so it faces along `hint`. */
  const pitched = (b: MeshBuilder, p0: number[], p1: number[], p2: number[], p3: number[], hint: number[]) => {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2]
    const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2]
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
    const pts = n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] >= 0 ? [p0, p1, p2, p3] : [p0, p3, p2, p1]
    const alongZ = Math.abs(hint[0]) > Math.abs(hint[2])
    b.face(pts[0], pts[1], pts[2], pts[3], pts.map((p) => (alongZ ? [p[2] * 0.5, p[0] * 0.5 + p[1] * 0.5] : [p[0] * 0.5, p[2] * 0.5 + p[1] * 0.5])))
  }
  /** A gable end facing -x at `x`: a triangle from the wall top up to the ridge. */
  const gable = (b: MeshBuilder, x: number, z0: number, z1: number, y0: number, y1: number) => {
    const top = [x, y1, (z0 + z1) / 2]
    pitched(b, [x, y0, z0], [x, y0, z1], top, top, [-1, 0, 0])
  }
  /** A hip roof over a room: shingle slopes with white fascia, and marquee bulbs along the eaves. */
  const hipRoof = (r: { x0: number; x1: number; z0: number; z1: number }) => {
    const X0 = r.x0 - OVERHANG, X1 = r.x1 + OVERHANG, Z0 = r.z0 - OVERHANG, Z1 = r.z1 + OVERHANG
    const e = H
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2
    if (Z1 - Z0 >= X1 - X0) {
      const half = (X1 - X0) / 2
      const top = e + half * PITCH
      const A = [cx, top, Z0 + half], B = [cx, top, Z1 - half]
      pitched(shingles, [X0, e, Z0], [X0, e, Z1], B, A, [-1, 1, 0])
      pitched(shingles, [X1, e, Z1], [X1, e, Z0], A, B, [1, 1, 0])
      pitched(shingles, [X1, e, Z0], [X0, e, Z0], A, A, [0, 1, -1])
      pitched(shingles, [X0, e, Z1], [X1, e, Z1], B, B, [0, 1, 1])
    } else {
      const half = (Z1 - Z0) / 2
      const top = e + half * PITCH
      const A = [X0 + half, top, cz], B = [X1 - half, top, cz]
      pitched(shingles, [X0, e, Z0], [X1, e, Z0], B, A, [0, 1, -1])
      pitched(shingles, [X1, e, Z1], [X0, e, Z1], A, B, [0, 1, 1])
      pitched(shingles, [X0, e, Z1], [X0, e, Z0], A, A, [-1, 1, 0])
      pitched(shingles, [X1, e, Z0], [X1, e, Z1], B, B, [1, 1, 0])
    }
    trim.box(X0, e - 0.22, Z0, X1, e, Z0 + 0.04)
    trim.box(X0, e - 0.22, Z1 - 0.04, X1, e, Z1)
    trim.box(X0, e - 0.22, Z0, X0 + 0.04, e, Z1)
    trim.box(X1 - 0.04, e - 0.22, Z0, X1, e, Z1)
    trim.box(X0, e - 0.24, Z0, X1, e - 0.22, Z1, { skipTop: true })
    bulbRow(chase, X0 - 0.03, Z0, X0 - 0.03, Z1, e - 0.1)
    bulbRow(chase, X0, Z0 - 0.03, X1, Z0 - 0.03, e - 0.1)
    bulbRow(chase, X1 + 0.03, Z0, X1 + 0.03, Z1, e - 0.1)
    bulbRow(chase, X0, Z1 + 0.03, X1, Z1 + 0.03, e - 0.1)
  }

  const doors = [CASINO.door, CASINO.sideDoor]
  const fx = CASINO.hall.x0
  const runs = wallRuns()
  const isHallFront = (r: WallRun) => r.out[0] === -1 && Math.abs(r.x0 - (fx - 0)) < W + 0.01
  for (const r of runs) {
    const [ox, oz] = r.out
    const runsZ = ox !== 0
    const face = runsZ ? (ox < 0 ? r.x0 : r.x1) : oz < 0 ? r.z0 : r.z1
    const a0 = runsZ ? r.z0 : r.x0
    const a1 = runsZ ? r.z1 : r.x1
    const cuts = isHallFront(r) ? doors.filter((dd) => dd.z - dd.width / 2 > r.z0 && dd.z + dd.width / 2 < r.z1).sort((p, q) => p.z - q.z) : []
    const spans: [number, number][] = []
    let from = a0
    for (const c of cuts) {
      spans.push([from, c.z - c.width / 2])
      from = c.z + c.width / 2
    }
    spans.push([from, a1])
    const slab = (b: MeshBuilder, s0: number, s1: number, y0: number, y1: number, out = 0) => {
      if (runsZ) b.box(r.x0 + (ox < 0 ? -out : 0), y0, s0, r.x1 + (ox > 0 ? out : 0), y1, s1, { uv: 0.5 })
      else b.box(s0, y0, r.z0 + (oz < 0 ? -out : 0), s1, y1, r.z1 + (oz > 0 ? out : 0), { uv: 0.5 })
    }
    const solid = (s0: number, s1: number, y0: number, y1: number) => solids.push(runsZ ? [r.x0, y0, s0, r.x1, y1, s1] : [s0, y0, r.z0, s1, y1, r.z1])
    for (const [s0, s1] of spans) {
      if (s1 - s0 < 0.02) continue
      slab(siding, s0, s1, WAINSCOT, H)
      slab(brick, s0, s1, 0, WAINSCOT, 0.05)
      trim.box(...(runsZ ? [face + ox * 0.05 - 0.04, WAINSCOT, s0, face + ox * 0.05 + 0.04, WAINSCOT + 0.06, s1] : [s0, WAINSCOT, face + oz * 0.05 - 0.04, s1, WAINSCOT + 0.06, face + oz * 0.05 + 0.04]) as [number, number, number, number, number, number])
      solid(s0, s1, 0, H)
    }
    for (const c of cuts) {
      const s0 = c.z - c.width / 2
      const s1 = c.z + c.width / 2
      slab(siding, s0, s1, c.height, H)
      solid(s0, s1, c.height, H)
      trim.box(face - 0.06, 0, s0 - 0.1, face + 0.04, c.height + 0.1, s0)
      trim.box(face - 0.06, 0, s1, face + 0.04, c.height + 0.1, s1 + 0.1)
      trim.box(face - 0.06, c.height, s0 - 0.1, face + 0.04, c.height + 0.1, s1 + 0.1)
    }
    const tube = (b: MeshBuilder, y: number, t0 = a0 + 0.2, t1 = a1 - 0.2) => {
      const c = face + (runsZ ? ox : oz) * 0.12
      if (runsZ) b.box(c - 0.03, y, t0, c + 0.03, y + 0.05, t1)
      else b.box(t0, y, c - 0.03, t1, y + 0.05, c + 0.03)
    }
    if (ox === -1 || oz === -1) {
      tube(pink, H - 0.12)
      let t = a0 + 0.2
      for (const c of cuts) {
        tube(cyan, WAINSCOT + 0.1, t, c.z - c.width / 2 - 0.3)
        t = c.z + c.width / 2 + 0.3
      }
      tube(cyan, WAINSCOT + 0.1, t, a1 - 0.2)
    }
  }

  const front = runs.filter((r) => r.out[0] === -1)
  const glassAt = (x: number, z0: number, z1: number, y0: number, y1: number) => {
    trim.box(x - 0.07, y0 - 0.08, z0 - 0.08, x, y1 + 0.08, z1 + 0.08)
    windows.box(x - 0.09, y0, z0, x - 0.07, y1, z1)
  }
  const hz0 = CASINO.hall.z0
  for (const z of [hz0 + 1.8, hz0 + 4.3, hz0 + 6.8, hz0 + 9.3]) glassAt(fx, z - 0.95, z + 0.95, 1.05, 2.25)
  glassAt(fx, CASINO.door.z + 2.2, CASINO.door.z + 4.0, 1.05, 2.25)
  const porthole = (x: number, z: number) => {
    trim.tube([x, 1.75, z], [x - 0.06, 1.75, z], 0.4, 8)
    windows.tube([x - 0.05, 1.75, z], [x - 0.09, 1.75, z], 0.32, 8)
    trim.box(x - 0.1, 1.73, z - 0.32, x - 0.08, 1.77, z + 0.32)
    trim.box(x - 0.1, 1.43, z - 0.02, x - 0.08, 2.07, z + 0.02)
  }
  for (const k of [6.8, 9.4, 12.0]) porthole(fx, CASINO.door.z + k)
  const wingFront = front.find((r) => r.x0 < fx - 1)
  if (wingFront) for (const k of [0.25, 0.5, 0.75]) porthole(wingFront.x0, wingFront.z0 + (wingFront.z1 - wingFront.z0) * k)

  const d = CASINO.door
  const vx = fx - 1.3
  const vz0 = d.z - 1.45
  const vz1 = d.z + 1.45
  for (const [z0, z1] of [[vz0, vz0 + 0.2], [vz1 - 0.2, vz1]]) {
    siding.box(vx, WAINSCOT, z0, fx, d.height + 0.3, z1, { uv: 0.5 })
    brick.box(vx - 0.03, 0, z0 - 0.03, fx, WAINSCOT, z1 + 0.03, { uv: 0.5 })
    solids.push([vx, 0, z0, fx, d.height + 0.3, z1])
  }
  siding.box(vx, d.height, vz0, vx + 0.2, d.height + 0.3, vz1, { uv: 0.5 })
  const ridgeY = d.height + 1.35
  gable(siding, vx, vz0, vz1, d.height + 0.3, ridgeY - 0.1)
  pitched(shingles, [vx - 0.3, d.height + 0.25, vz0 - 0.3], [fx, d.height + 0.25, vz0 - 0.3], [fx, ridgeY, d.z], [vx - 0.3, ridgeY, d.z], [0, 1, -1])
  pitched(shingles, [vx - 0.3, ridgeY, d.z], [fx, ridgeY, d.z], [fx, d.height + 0.25, vz1 + 0.3], [vx - 0.3, d.height + 0.25, vz1 + 0.3], [0, 1, 1])
  trim.box(vx - 0.32, d.height + 0.18, vz0 - 0.32, vx - 0.26, d.height + 0.3, vz1 + 0.32)
  bulbRow(chase, vx - 0.33, vz0 - 0.3, vx - 0.33, d.z, d.height + 0.3 + 0.05, 0.22, 0.05)
  bulbRow(chase, vx - 0.33, d.z, vx - 0.33, vz1 + 0.3, d.height + 0.3 + 0.05, 0.22, 0.05)
  pink.box(vx - 0.36, d.height + 0.42, d.z - 0.9, vx - 0.3, d.height + 0.47, d.z + 0.9)
  floor.box(vx - 0.4, -0.03, vz0 - 0.6, fx, 0.06, vz1 + 0.6, { uv: 0.4 })
  doormat.box(vx - 1.2, 0.0, d.z - 0.8, vx, 0.065, d.z + 0.8)

  const sd = CASINO.sideDoor
  for (const z of [sd.z - sd.width / 2 - 0.55, sd.z + sd.width / 2]) {
    brick.box(fx - 0.45, 0, z, fx, H, z + 0.55, { uv: 0.5 })
    solids.push([fx - 0.45, 0, z, fx, H, z + 0.55])
  }
  bulbRow(chase, fx - 0.5, sd.z - sd.width / 2 - 0.3, fx - 0.5, sd.z - sd.width / 2 - 0.3, sd.height + 0.3)

  const zMin = Math.min(...front.map((r) => r.z0))
  const zMax = Math.max(...front.map((r) => r.z1))
  const walkX = Math.min(...front.map((r) => r.x0))
  floor.box(walkX - SIDEWALK, -0.03, zMin - 2, walkX, 0.05, zMax + 2, { uv: 0.4 })
  floor.box(walkX, -0.03, zMin - 2, fx, 0.05, CASINO.wing.z0, { uv: 0.4 })

  for (const r of [CASINO.hall, CASINO.wing, ...(BOOTH ? [BOOTH] : [])]) hipRoof(r)
  for (let i = 0; i < 2; i++) {
    const sz = hz0 + 2.5 + i * 3.3
    skylight.box(fx + 1.3, H + 0.72, sz, fx + 2.3, H + 0.82, sz + 0.7)
  }
  const signZ = d.z + 2.6
  const signX = (CASINO.hall.x0 + CASINO.hall.x1) / 2
  signBoard.box(signX - 0.1, H + 1.5, signZ - 1.6, signX + 0.1, H + 2.6, signZ + 1.6)
  for (const z of [signZ - 1.2, signZ + 1.2]) chrome.cylinder(signX, H + 0.6, z, 0.05, 0.05, 1.0, 8)
  bulbRow(chase, signX - 0.14, signZ - 1.65, signX - 0.14, signZ + 1.65, H + 2.68, 0.25, 0.05)
  bulbRow(chase, signX - 0.14, signZ - 1.65, signX - 0.14, signZ + 1.65, H + 1.42, 0.25, 0.05)


  for (const r of ROOMS) {
    carpet.flat(r.x0 + 0.01, r.z0 + 0.01, r.x1 - 0.01, r.z1 - 0.01, floorY, 0.5)
    floor.box(r.x0, 0, r.z0, r.x1, floorY - 0.005, r.z1, { skipTop: true })
    ceiling.box(r.x0, H - 0.25, r.z0, r.x1, H, r.z1)
    solids.push([r.x0, H - 0.25, r.z0, r.x1, H + 0.2, r.z1])
    for (let x = r.x0 + 2; x < r.x1 - 1.2; x += 3.2) for (let z = r.z0 + 2; z < r.z1 - 1.2; z += 3.2) {
      dark.box(x - 0.9, H - 0.4, z - 0.9, x + 0.9, H - 0.25, z + 0.9)
      panels.box(x - 0.6, H - 0.42, z - 0.6, x + 0.6, H - 0.4, z + 0.6)
    }
  }
  for (const r of runs) {
    const [ix, iz] = [-r.out[0], -r.out[1]]
    if (ix !== 0) {
      const x = ix > 0 ? r.x1 : r.x0
      purple.box(ix > 0 ? x : x - 0.06, H - 0.55, r.z0 + 0.3, ix > 0 ? x + 0.06 : x, H - 0.5, r.z1 - 0.3)
    } else {
      const z = iz > 0 ? r.z1 : r.z0
      purple.box(r.x0 + 0.3, H - 0.55, iz > 0 ? z : z - 0.06, r.x1 - 0.3, H - 0.5, iz > 0 ? z + 0.06 : z)
    }
  }

  const S = STAGE
  stage.cylinder(S.x, 0, S.z, S.radius, S.radius, S.top, 40)
  dark.cylinder(S.x, S.top, S.z, S.radius + 0.06, S.radius + 0.06, 0.04, 40)
  chrome.cylinder(S.x, S.top, S.z, 0.025, 0.025, H - 0.25 - S.top, 12)
  chrome.cylinder(S.x, H - 0.3, S.z, 0.18, 0.18, 0.05, 16)
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    chase[i % 3].cylinder(S.x + Math.sin(a) * (S.radius + 0.02), S.top - 0.2, S.z + Math.cos(a) * (S.radius + 0.02), 0.045, 0.045, 0.09, 8)
  }
  physics.addStaticCylinder(S.x, S.top / 2, S.z, S.top / 2, S.radius)
  physics.addStaticCylinder(S.x, H / 2, S.z, H / 2, 0.06)
  for (const a of [-0.75, 0.75]) {
    const lx = S.x + Math.sin(a + Math.PI) * 3.4
    const lz = S.z + Math.cos(a + Math.PI) * 3.4
    leather.box(lx - 0.45, 0, lz - 0.45, lx + 0.45, 0.42, lz + 0.45)
    leather.box(lx - 0.45, 0.42, lz - 0.45, lx + 0.45, 0.85, lz - 0.3)
  }

  if (BOOTH) {
    const bx0 = BOOTH.x0 + 0.5
    const bx1 = BOOTH.x1 - W - 0.3
    const bz0 = BOOTH.z0 + W + 1.2
    const bz1 = BOOTH.z1 - W - 1.2
    if (bx1 - bx0 > 0.8 && bz1 - bz0 > 1.5) {
      dark.box(bx0, 0, bz0, bx1, 1.1, bz1)
      cyan.box(bx0 - 0.02, 0.85, bz0 + 0.1, bx0, 1.0, bz1 - 0.1)
      trim.box(bx0 + 0.2, 1.1, bz0 + 0.3, bx1 - 0.2, 1.16, bz1 - 0.3)
      solids.push([bx0, 0, bz0, bx1, 1.1, bz1])
    }
  }

  const C = BAR.counter
  wood.box(C.x0, 0, C.z0, C.x1, C.top - 0.06, C.z1)
  dark.box(C.x0 - 0.1, C.top - 0.06, C.z0 - 0.15, C.x1 + 0.1, C.top, C.z1 + 0.1)
  brass.box(C.x0, 0.18, C.z0 - 0.28, C.x1, 0.22, C.z0 - 0.24)
  for (let x = C.x0 + 1; x < C.x1; x += 3) brass.box(x - 0.02, 0, C.z0 - 0.28, x + 0.02, 0.2, C.z0 - 0.24)
  leather.box(C.x0, C.top - 0.2, C.z0 - 0.08, C.x1, C.top - 0.06, C.z0)
  pink.box(C.x0, 0.08, C.z0 - 0.02, C.x1, 0.12, C.z0)
  const B = BAR.backBar
  wood.box(B.x0, 0, B.z0, B.x1, 1.0, B.z1)
  dark.box(B.x0, 1.0, B.z0 - 0.05, B.x1, 1.05, B.z1)
  for (let i = 0; i < 3; i++) {
    const y = 1.25 + i * 0.35
    glassB.box(B.x0 + 0.2, y, B.z0 + 0.15, B.x1 - 0.2, y + 0.03, B.z1)
    shelfGlow.box(B.x0 + 0.2, y - 0.02, B.z1 - 0.06, B.x1 - 0.2, y, B.z1)
    for (let x = B.x0 + 0.5; x < B.x1 - 0.3; x += 0.32 + ((x * 7) % 3) * 0.04) {
      const hgt = 0.26 + ((x * 13 + i) % 5) * 0.03
      const col: RGB = [[0.45, 0.22, 0.06], [0.16, 0.36, 0.12], [0.7, 0.55, 0.2], [0.85, 0.85, 0.82], [0.4, 0.08, 0.06]][Math.floor(x * 3 + i) % 5] as RGB
      bottles.cylinder(x, y + 0.03, B.z0 + 0.45, 0.04, 0.04, hgt, 10, true, col)
      bottles.cylinder(x, y + 0.03 + hgt, B.z0 + 0.45, 0.04, 0.012, 0.07, 10, true, col)
    }
  }
  dark.box(B.x0, 2.4, B.z0 + 0.1, B.x1, 2.48, B.z1)
  for (let x = C.x0 + 1.5; x < C.x1; x += 2.5) {
    brass.cylinder(x, 2.45, C.z0 + 0.4, 0.008, 0.008, H - 0.25 - 2.45, 6)
    brass.cylinder(x, 2.2, C.z0 + 0.4, 0.22, 0.05, 0.25, 16)
    panels.cylinder(x, 2.19, C.z0 + 0.4, 0.15, 0.15, 0.01, 16)
  }

  for (const s of BAR.stools) {
    brass.cylinder(s.x, 0, s.z, 0.22, 0.18, 0.03, 18)
    brass.cylinder(s.x, 0.03, s.z, 0.035, 0.035, s.y - 0.12, 10)
    brass.cylinder(s.x, 0.28, s.z, 0.2, 0.2, 0.025, 18, false)
    leather.cylinder(s.x, s.y - 0.12, s.z, 0.2, 0.21, 0.09, 20)
  }

  const T = BLACKJACK
  const seg = 28
  for (let i = 0; i < seg; i++) {
    const a0 = -Math.PI / 2 + (i / seg) * Math.PI
    const a1 = -Math.PI / 2 + ((i + 1) / seg) * Math.PI
    const p = (a: number, r: number) => [T.x + Math.sin(a) * r, T.z - Math.cos(a) * r]
    const [ax, az] = p(a0, T.radius)
    const [bx, bz] = p(a1, T.radius)
    felt.quad([[T.x, T.top, T.z], [bx, T.top, bz], [ax, T.top, az], [T.x, T.top, T.z]], [0, 1, 0], [[0.5, 0.5], [0.5 + Math.sin(a1) / 2, 0.5 - Math.cos(a1) / 2], [0.5 + Math.sin(a0) / 2, 0.5 - Math.cos(a0) / 2], [0.5, 0.5]], WHITE)
    const [cx, cz] = p(a0, T.radius + 0.14)
    const [dx, dz] = p(a1, T.radius + 0.14)
    leather.quad([[ax, T.top + 0.02, az], [bx, T.top + 0.02, bz], [dx, T.top + 0.07, dz], [cx, T.top + 0.07, cz]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], WHITE)
    leather.quad([[cx, T.top + 0.07, cz], [dx, T.top + 0.07, dz], [dx, T.top - 0.08, dz], [cx, T.top - 0.08, cz]], [Math.sin((a0 + a1) / 2), 0, -Math.cos((a0 + a1) / 2)], [[0, 0], [1, 0], [1, 1], [0, 1]], WHITE)
  }
  wood.box(T.x - T.radius - 0.14, T.top - 0.12, T.z - 0.02, T.x + T.radius + 0.14, T.top + 0.07, T.z + 0.18)
  wood.box(T.x - 1.2, 0, T.z - 0.9, T.x + 1.2, T.top - 0.08, T.z - 0.2)
  dark.box(T.x - 0.5, T.top, T.z + 0.02, T.x + 0.5, T.top + 0.1, T.z + 0.16)
  for (const s of T.seats) buildSlotChair(leather, brass, s.x, s.z, s.yaw)

  for (const spot of MACHINE_SPOTS) {
    buildCabinet(spot, { dark, trim, brass, leather, panels, glassB })
    buildSlotChair(leather, brass, spot.seat.x, spot.seat.z, spot.seat.yaw)
  }

  const glow = (name: string, color: number, emissive: number, k: number) => mats.plain(name, { color, emissive, emissiveIntensity: k, unlit: true })
  const chaseMats = [glow('casino-bulbs-a', 0xfff4d0, 0xffd27a, 2.4), glow('casino-bulbs-b', 0xfff4d0, 0xffd27a, 2.4), glow('casino-bulbs-c', 0xfff4d0, 0xffd27a, 2.4)]
  const neonMats = [glow('casino-neon-pink', 0xff7ad8, 0xff3cc8, 3.2), glow('casino-neon-cyan', 0x9cf6ff, 0x30e0ff, 3.0), glow('casino-neon-purple', 0xc79bff, 0x9a4dff, 2.6)]
  const parts: [MeshBuilder, ReturnType<Mats['plain']>, boolean][] = [
    [siding, mats.textured('casino-siding', 'siding', { color: 0xcacccb }), false],
    [brick, mats.textured('casino-brick', 'brick', { color: 0xa69e92 }), false],
    [shingles, mats.textured('casino-shingles', 'shingles', { color: 0x75787a }), false],
    [windows, mats.plain('casino-windows', { color: 0x15121a, gloss: 0.9, emissive: 0xff4fb0, emissiveIntensity: 0.3 }), false],
    [doormat, mats.plain('casino-doormat', { color: 0x1f8a7a, gloss: 0.1 }), false],
    [skylight, mats.plain('casino-skylight', { color: 0xdfe6ea, gloss: 0.85, metal: 0.2 }), false],
    [signBoard, mats.plain('casino-sign-board', { color: 0xf4f2ee, emissive: 0xffffff, emissiveIntensity: 0.45 }), false],
    [trim, mats.plain('casino-trim', { color: 0xf2f2ee, gloss: 0.5 }), false],
    [floor, mats.textured('casino-apron', 'concrete'), false],
    [carpet, mats.textured('casino-carpet', 'carpet', { color: 0x2a0f2e, tile: 3 }), false],
    [ceiling, mats.plain('casino-ceiling', { color: 0x0e0b12, gloss: 0.2 }), false],
    [panels, mats.plain('casino-panels', { color: 0xfff1d6, emissive: 0xffd9b0, emissiveIntensity: 1.0, unlit: true }), false],
    [wood, mats.textured('casino-wood', 'woodPanel', { color: 0x4a2a1a, gloss: 0.6 }), true],
    [dark, mats.plain('casino-dark', { color: 0x141218, gloss: 0.75, metal: 0.2 }), true],
    [brass, mats.plain('casino-brass', { color: 0xc9a14a, gloss: 0.85, metal: 1 }), true],
    [chrome, mats.plain('casino-chrome', { color: 0xe8eaee, gloss: 0.95, metal: 1 }), true],
    [leather, mats.plain('casino-leather', { color: 0x3b1416, gloss: 0.55 }), true],
    [felt, mats.textured('casino-felt', 'carpet', { color: 0x0f5a34, tile: 6 }), false],
    [stage, mats.plain('casino-stage', { color: 0x0b0a0e, gloss: 0.95, metal: 0.3 }), true],
    [shelfGlow, mats.plain('casino-shelf-glow', { color: 0xfff6e0, emissive: 0xff70c0, emissiveIntensity: 2.2, unlit: true }), false],
    [bottles, mats.plain('casino-bottles', { vcolor: true, gloss: 0.9, metal: 0.05 }), true],
    [glassB, mats.glass('casino-glass', 0xc8d8e0, 0.35), false],
    [pink, neonMats[0], false],
    [cyan, neonMats[1], false],
    [purple, neonMats[2], false],
    [chase[0], chaseMats[0], false],
    [chase[1], chaseMats[1], false],
    [chase[2], chaseMats[2], false],
  ]
  for (const [b, mat, cast] of parts) {
    if (b.empty) continue
    const mesh = b.toMesh(`casino-${mat.name}`, b === bottles)
    mesh.parent = root
    finishMesh(mesh, mat, { cast, static: true })
  }

  for (const [x0, y0, z0, x1, y1, z1] of solids) physics.addStaticAABB(x0, y0, z0, x1, y1, z1)
  physics.addStaticAABB(C.x0, 0, C.z0, C.x1, C.top, C.z1)
  physics.addStaticAABB(B.x0, 0, B.z0, B.x1, 1.05, B.z1)
  physics.addStaticCylinder(T.x, T.top / 2, T.z - 0.3, T.top / 2, 1.2)
  for (const spot of MACHINE_SPOTS) {
    const c = Math.cos(spot.yaw)
    const s = Math.sin(spot.yaw)
    physics.addStaticBox({ cx: spot.x - s * 0.05, cy: 1.0, cz: spot.z - c * 0.05, hx: 0.42, hy: 1.0, hz: 0.42, rotY: spot.yaw })
  }
  return { chase: chaseMats, neon: neonMats }
}
