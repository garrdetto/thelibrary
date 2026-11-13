/**
 * The county road's buildings, made with the town's builders (fp/core/Geo.ts)
 * in town coordinates under the town's node, like the casino: log cabins with
 * porches, chimneys and woodpiles, the Bear Paw Fuel & Bait station (store,
 * canopy, pump islands, ice chest), the Pine Cone Motel (twelve rooms, office,
 * covered walk, striped parking) and The Rusty Lure Tavern (barn-board
 * roadhouse with a porch and a tin roof). Each place is built in its own frame
 * (x along its front, z toward the road) and turned to face the road. Every
 * solid gets a Rapier collider; lettering is drawn in scene space by
 * RoadsideSigns.ts so it isn't mirrored.
 */
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import type { Material } from '@babylonjs/core/Materials/material'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder, finishMesh } from '../fp/core/Geo'
import type { Mats } from '../fp/core/Tex'
import type { Physics } from '../fp/physics/Physics'
import { ROADSIDE, lotRect, placeFrame, placeToTown, type RoadsidePlace } from './RoadsideLayout'

type Part = 'logs' | 'boards' | 'siding' | 'stucco' | 'shingles' | 'tin' | 'rust' | 'stone' | 'concrete' | 'gravel' | 'asphalt' | 'trim' | 'darkTrim' | 'glass' | 'door' | 'red' | 'white' | 'metal' | 'paint' | 'wood' | 'firewood' | 'screen' | 'glow'

const LOT_Y = 0.03

class Kit {
  readonly b = new Map<Part, MeshBuilder>()
  private frame: Matrix = Matrix.Identity()
  boxes: { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number }[] = []

  constructor(private readonly place: RoadsidePlace) {}

  at(part: Part): MeshBuilder {
    let b = this.b.get(part)
    if (!b) this.b.set(part, (b = new MeshBuilder()))
    b.transform(this.frame)
    return b
  }

  local(): void {
    const f = placeFrame(this.place)
    this.frame = Matrix.RotationY(f.yaw).multiply(Matrix.Translation(f.x, 0, f.z))
  }

  world(): void {
    this.frame = Matrix.Identity()
  }

  /** A solid in the place's frame (axis-aligned there), as a town-space AABB (the frames turn by quarter turns). */
  solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const a = placeToTown(this.place, x0, z0)
    const b = placeToTown(this.place, x1, z1)
    this.boxes.push({ x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z), y0, y1 })
  }
}

/** A horizontal log from (x0, y, z0) to (x1, y, z1). */
function log(b: MeshBuilder, x0: number, y: number, z0: number, x1: number, z1: number, r = 0.15): void {
  b.tube([x0, y, z0], [x1, y, z1], r, 8, true)
}

/** Gable roof over [-hw, hw] x [-hd, hd] with the ridge along x at `ridge`, eaves at `eave`, and `over` overhang. */
function gable(roof: MeshBuilder, ends: MeshBuilder, hw: number, hd: number, eave: number, ridge: number, over: number, thick = 0.12): void {
  const x0 = -hw - over, x1 = hw + over, zf = hd + over, zb = -hd - over
  const ef = eave - over * ((ridge - eave) / hd)
  roof.face([x0, ef, zf], [x1, ef, zf], [x1, ridge, 0], [x0, ridge, 0], [[0, 0], [x1 - x0, 0], [x1 - x0, hd + over], [0, hd + over]].map(([u, v]) => [u * 0.5, v * 0.5]))
  roof.face([x1, ef, zb], [x0, ef, zb], [x0, ridge, 0], [x1, ridge, 0], [[0, 0], [x1 - x0, 0], [x1 - x0, hd + over], [0, hd + over]].map(([u, v]) => [u * 0.5, v * 0.5]))
  roof.face([x0, ef - thick, zf], [x1, ef - thick, zf], [x1, ef, zf], [x0, ef, zf], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]])
  roof.face([x1, ef - thick, zb], [x0, ef - thick, zb], [x0, ef, zb], [x1, ef, zb], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]])
  roof.face([x1, ef - thick, zf], [x0, ef - thick, zf], [x0, ridge - thick, 0], [x1, ridge - thick, 0], [[0, 0], [x1 - x0, 0], [x1 - x0, hd + over], [0, hd + over]].map(([u, v]) => [u * 0.5, v * 0.5]))
  roof.face([x0, ef - thick, zb], [x1, ef - thick, zb], [x1, ridge - thick, 0], [x0, ridge - thick, 0], [[0, 0], [x1 - x0, 0], [x1 - x0, hd + over], [0, hd + over]].map(([u, v]) => [u * 0.5, v * 0.5]))
  for (const sx of [-1, 1]) {
    const x = sx * hw
    const tri = sx > 0 ? [[x, eave, hd], [x, eave, -hd], [x, ridge, 0]] : [[x, eave, -hd], [x, eave, hd], [x, ridge, 0]]
    ends.vertex(tri[0][0], tri[0][1], tri[0][2], sx, 0, 0, tri[0][2] * 0.5, tri[0][1] * 0.5)
    ends.vertex(tri[1][0], tri[1][1], tri[1][2], sx, 0, 0, tri[1][2] * 0.5, tri[1][1] * 0.5)
    ends.vertex(tri[2][0], tri[2][1], tri[2][2], sx, 0, 0, tri[2][2] * 0.5, tri[2][1] * 0.5)
    const n = ends.vertexCount
    ends.tri(n - 3, n - 2, n - 1)
  }
}

/** A window in a wall facing +z at z = zFace (local frame): frame, sill, dark pane and muntins. */
function windowZ(k: Kit, cx: number, y0: number, w: number, h: number, zFace: number, dir: 1 | -1, frame: Part = 'trim'): void {
  const t = 0.08
  const zo = zFace + dir * 0.04
  const f = k.at(frame)
  f.box(cx - w / 2 - t, y0 - t, zo - 0.05, cx + w / 2 + t, y0, zo + 0.05)
  f.box(cx - w / 2 - t, y0 + h, zo - 0.05, cx + w / 2 + t, y0 + h + t, zo + 0.05)
  f.box(cx - w / 2 - t, y0, zo - 0.05, cx - w / 2, y0 + h, zo + 0.05)
  f.box(cx + w / 2, y0, zo - 0.05, cx + w / 2 + t, y0 + h, zo + 0.05)
  f.box(cx - 0.025, y0, zo - 0.03, cx + 0.025, y0 + h, zo + 0.03)
  f.box(cx - w / 2, y0 + h / 2 - 0.025, zo - 0.03, cx + w / 2, y0 + h / 2 + 0.025, zo + 0.03)
  f.box(cx - w / 2 - t - 0.04, y0 - t - 0.05, zo - 0.02, cx + w / 2 + t + 0.04, y0 - t, zo + dir * 0.16)
  k.at('glass').box(cx - w / 2, y0, zo - 0.015, cx + w / 2, y0 + h, zo + 0.015)
}

/** The same in a wall facing ±x at x = xFace. */
function windowX(k: Kit, cz: number, y0: number, w: number, h: number, xFace: number, dir: 1 | -1, frame: Part = 'trim'): void {
  const t = 0.08
  const xo = xFace + dir * 0.04
  const f = k.at(frame)
  f.box(xo - 0.05, y0 - t, cz - w / 2 - t, xo + 0.05, y0, cz + w / 2 + t)
  f.box(xo - 0.05, y0 + h, cz - w / 2 - t, xo + 0.05, y0 + h + t, cz + w / 2 + t)
  f.box(xo - 0.05, y0, cz - w / 2 - t, xo + 0.05, y0 + h, cz - w / 2)
  f.box(xo - 0.05, y0, cz + w / 2, xo + 0.05, y0 + h, cz + w / 2 + t)
  f.box(xo - 0.03, y0, cz - 0.025, xo + 0.03, y0 + h, cz + 0.025)
  f.box(xo - 0.03, y0 + h / 2 - 0.025, cz - w / 2, xo + 0.03, y0 + h / 2 + 0.025, cz + w / 2)
  k.at('glass').box(xo - 0.015, y0, cz - w / 2, xo + 0.015, y0 + h, cz + w / 2)
}

function door(k: Kit, cx: number, w: number, h: number, zFace: number, part: Part = 'door'): void {
  const d = k.at(part)
  d.box(cx - w / 2, 0.02, zFace - 0.02, cx + w / 2, h, zFace + 0.06)
  const t = k.at('trim')
  t.box(cx - w / 2 - 0.1, 0, zFace, cx - w / 2, h + 0.1, zFace + 0.09)
  t.box(cx + w / 2, 0, zFace, cx + w / 2 + 0.1, h + 0.1, zFace + 0.09)
  t.box(cx - w / 2 - 0.1, h, zFace, cx + w / 2 + 0.1, h + 0.1, zFace + 0.09)
  k.at('metal').box(cx + w / 2 - 0.16, 1.0, zFace + 0.06, cx + w / 2 - 0.1, 1.06, zFace + 0.12)
}

/** The lot: gravel or asphalt from the road's edge back, in town space. */
function lot(k: Kit, p: RoadsidePlace): void {
  const r = lotRect(p)
  k.world()
  k.at(p.surface).flat(r.cx - r.sx / 2, r.cz - r.sz / 2, r.cx + r.sx / 2, r.cz + r.sz / 2, LOT_Y, p.surface === 'gravel' ? 0.8 : 1)
  k.local()
}

// ---------------------------------------------------------------- cabin

function cabin(k: Kit, p: RoadsidePlace): void {
  const hw = p.w / 2
  const hd = p.d / 2
  const H = 2.7
  const courses = 9
  const step = H / courses
  const logs = k.at('logs')
  const front = [
    { x0: -0.55, x1: 0.55, y0: 0, y1: 2.15 },
    { x0: -hw + 0.9, x1: -hw + 2.3, y0: 1.0, y1: 2.05 },
    { x0: hw - 2.3, x1: hw - 0.9, y0: 1.0, y1: 2.05 },
  ]
  const side = [{ x0: -0.8, x1: 0.8, y0: 1.0, y1: 2.05 }]
  const wallLogs = (len: number, holes: { x0: number; x1: number; y0: number; y1: number }[], put: (a: number, b: number, y: number) => void) => {
    for (let c = 0; c < courses; c++) {
      const y = step * (c + 0.5)
      let spans: [number, number][] = [[-len - 0.35, len + 0.35]]
      for (const h of holes) {
        if (y < h.y0 || y > h.y1) continue
        spans = spans.flatMap(([a, b]) => (h.x1 <= a || h.x0 >= b ? [[a, b] as [number, number]] : ([[a, h.x0], [h.x1, b]] as [number, number][]).filter(([u, v]) => v - u > 0.2)))
      }
      for (const [a, b] of spans) put(a, b, y)
    }
  }
  wallLogs(hw, front, (a, b, y) => log(logs, a, y, hd, b, hd))
  wallLogs(hw, [], (a, b, y) => log(logs, a, y, -hd, b, -hd))
  wallLogs(hd, side, (a, b, y) => log(logs, -hw, y + step * 0.5, a, -hw, b))
  wallLogs(hd, side, (a, b, y) => log(logs, hw, y + step * 0.5, a, hw, b))
  k.at('wood').box(-hw + 0.1, 0, -hd + 0.1, hw - 0.1, H, hd - 0.1, { skipBottom: true })
  const ridge = H + hd * 0.75
  gable(k.at(p.id === 'cabin-tamarack' ? 'tin' : 'shingles'), k.at('logs'), hw, hd, H, ridge, 0.55)
  door(k, 0, 0.95, 2.1, hd + 0.12)
  windowZ(k, -hw + 1.6, 1.0, 1.3, 1.0, hd + 0.12, 1)
  windowZ(k, hw - 1.6, 1.0, 1.3, 1.0, hd + 0.12, 1)
  windowX(k, 0, 1.0, 1.5, 1.0, hw + 0.12, 1)
  windowX(k, 0, 1.0, 1.5, 1.0, -hw - 0.12, -1)
  const porchD = 2.4
  const deck = k.at('boards')
  deck.box(-hw - 0.3, 0, hd, hw + 0.3, 0.42, hd + porchD)
  for (let i = 0; i < 3; i++) deck.box(-0.9, 0, hd + porchD + i * 0.3, 0.9, 0.42 - (i + 1) * 0.14, hd + porchD + (i + 1) * 0.3)
  const posts = k.at('logs')
  for (const x of [-hw - 0.1, -1.2, 1.2, hw + 0.1]) posts.cylinder(x, 0.42, hd + porchD - 0.15, 0.11, 0.1, 2.25, 8)
  log(posts, -hw - 0.3, 2.62, hd + porchD - 0.15, hw + 0.3, hd + porchD - 0.15, 0.12)
  for (const x of [-hw - 0.1, hw + 0.1]) k.at('wood').box(x - 0.04, 0.95, hd, x + 0.04, 1.0, hd + porchD - 0.15)
  for (const [a, b] of [[-hw - 0.1, -1.2], [1.2, hw + 0.1]] as const) {
    k.at('wood').box(a, 0.95, hd + porchD - 0.19, b, 1.0, hd + porchD - 0.11)
    for (let x = a + 0.15; x < b - 0.05; x += 0.15) k.at('wood').box(x - 0.02, 0.42, hd + porchD - 0.17, x + 0.02, 0.95, hd + porchD - 0.13)
  }
  const pr = k.at(p.id === 'cabin-tamarack' ? 'tin' : 'shingles')
  pr.face([-hw - 0.4, 2.62, hd + porchD + 0.35], [hw + 0.4, 2.62, hd + porchD + 0.35], [hw + 0.4, H + 0.42, hd], [-hw - 0.4, H + 0.42, hd], [[0, 0], [p.w * 0.5, 0], [p.w * 0.5, 1.4], [0, 1.4]])
  pr.face([hw + 0.4, 2.55, hd + porchD + 0.35], [-hw - 0.4, 2.55, hd + porchD + 0.35], [-hw - 0.4, H + 0.35, hd], [hw + 0.4, H + 0.35, hd], [[0, 0], [p.w * 0.5, 0], [p.w * 0.5, 1.4], [0, 1.4]])
  const stone = k.at('stone')
  const cx = p.id === 'cabin-loon' ? -hw - 0.55 : hw + 0.55
  stone.box(cx - 0.55, 0, -0.75, cx + 0.55, 2.2, 0.75, { uv: 0.6 })
  stone.box(cx - 0.4, 2.2, -0.5, cx + 0.4, ridge + 0.9, 0.5, { uv: 0.6 })
  k.at('darkTrim').box(cx - 0.45, ridge + 0.9, -0.55, cx + 0.45, ridge + 1.0, 0.55)
  const wood = k.at('firewood')
  const wx = p.id === 'cabin-loon' ? hw + 0.7 : -hw - 0.7
  for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) {
    const z = -hd + 0.6 + i * 0.26 + (r % 2) * 0.13
    if (z > hd - 0.4) continue
    log(wood, wx - 0.4, 0.13 + r * 0.24, z, wx + 0.4, z, 0.115)
  }
  k.at('wood').box(wx - 0.6, 1.1, -hd + 0.4, wx + 0.6, 1.16, hd - 0.2)
  const sx = -p.lotHalf + 2
  const sz = p.setback - 7.06
  for (const d of [-0.72, 0.72]) {
    k.at('wood').box(sx + d - 0.05, 0, sz - 0.12, sx + d + 0.05, 1.75, sz - 0.02)
    k.solid(sx + d - 0.06, 0, sz - 0.12, sx + d + 0.06, 1.75, sz)
  }
  k.solid(-hw - 0.2, 0, -hd - 0.2, hw + 0.2, ridge, hd + 0.2)
  k.solid(-hw - 0.3, 0, hd, hw + 0.3, 0.42, hd + porchD)
  k.solid(cx - 0.55, 0, -0.75, cx + 0.55, ridge + 1, 0.75)
  k.solid(wx - 0.5, 0, -hd + 0.4, wx + 0.5, 1.1, hd - 0.2)
}

// ---------------------------------------------------------------- gas station

function gasStation(k: Kit, p: RoadsidePlace): void {
  const hw = p.w / 2
  const hd = p.d / 2
  const H = 4.2
  const walls = k.at('siding')
  walls.box(-hw, 0, -hd, hw, H, hd, { skipBottom: true })
  k.at('white').box(-hw - 0.15, H, -hd - 0.15, hw + 0.15, H + 0.75, hd + 0.15)
  k.at('red').box(-hw - 0.18, H + 0.2, hd + 0.1, hw + 0.18, H + 0.55, hd + 0.2)
  k.at('red').box(-hw - 0.18, H + 0.2, -hd - 0.2, hw + 0.18, H + 0.55, -hd - 0.1)
  k.at('darkTrim').box(-hw + 0.3, H + 0.75, -hd + 0.3, hw - 0.3, H + 0.82, hd - 0.3)
  const sf = hd + 0.02
  for (const cx of [-hw + 2.4, hw - 2.4]) {
    k.at('glass').box(cx - 1.9, 0.5, sf - 0.02, cx + 1.9, 2.9, sf + 0.02)
    k.at('metal').box(cx - 1.95, 0.4, sf, cx + 1.95, 0.5, sf + 0.08)
    k.at('metal').box(cx - 1.95, 2.9, sf, cx + 1.95, 3.0, sf + 0.08)
    for (const x of [cx - 1.95, cx, cx + 1.95]) k.at('metal').box(x - 0.04, 0.4, sf, x + 0.04, 3.0, sf + 0.08)
  }
  k.at('glass').box(-0.9, 0.02, sf - 0.02, 0.9, 2.5, sf + 0.02)
  k.at('metal').box(-1.0, 2.5, sf, 1.0, 2.6, sf + 0.1)
  for (const x of [-1.0, 0, 1.0]) k.at('metal').box(x - 0.05, 0, sf, x + 0.05, 2.5, sf + 0.1)
  k.at('concrete').box(-hw - 1.2, 0, hd, hw + 1.2, 0.15, hd + 2.2)
  k.at('white').box(hw - 3.2, 0.15, hd + 0.3, hw - 1.2, 1.25, hd + 1.1)
  k.at('glow').box(hw - 3.1, 1.25, hd + 0.35, hw - 1.3, 1.3, hd + 1.05)
  k.at('red').box(-hw + 0.4, 0.15, hd + 0.35, -hw + 1.3, 1.9, hd + 1.0)
  k.at('glass').box(-hw + 0.45, 0.4, hd + 1.0, -hw + 1.25, 1.8, hd + 1.03)
  k.at('metal').box(-hw - 0.6, 0, -hd + 1, -hw - 0.05, 1.6, -hd + 3)
  const cz = hd + 11
  const cw = 9
  const cd = 6
  const CH = 4.9
  const canopy = k.at('white')
  canopy.box(-cw, CH, cz - cd, cw, CH + 0.25, cz + cd)
  k.at('red').box(-cw - 0.1, CH + 0.25, cz - cd - 0.1, cw + 0.1, CH + 1.05, cz + cd + 0.1)
  k.at('white').box(-cw - 0.12, CH + 0.55, cz - cd - 0.12, cw + 0.12, CH + 0.7, cz + cd + 0.12)
  k.at('glow').box(-cw + 0.5, CH - 0.02, cz - cd + 0.5, cw - 0.5, CH, cz + cd - 0.5)
  for (const x of [-5, 5]) {
    for (const z of [cz - 3, cz + 3]) {
      k.at('metal').box(x - 0.22, 0, z - 0.22, x + 0.22, CH, z + 0.22)
      k.solid(x - 0.25, 0, z - 0.25, x + 0.25, CH, z + 0.25)
    }
    k.at('concrete').box(x - 0.9, 0, cz - 4.2, x + 0.9, 0.2, cz + 4.2)
    k.solid(x - 0.9, 0, cz - 4.2, x + 0.9, 0.2, cz + 4.2)
    for (const z of [cz - 1.2, cz + 1.2]) {
      k.at('red').box(x - 0.42, 0.2, z - 0.3, x + 0.42, 1.75, z + 0.3)
      k.at('white').box(x - 0.44, 1.75, z - 0.32, x + 0.44, 2.0, z + 0.32)
      k.at('glass').box(x - 0.43, 1.15, z - 0.31, x + 0.43, 1.55, z + 0.31)
      k.at('darkTrim').box(x - 0.46, 0.7, z - 0.18, x + 0.46, 0.95, z + 0.18)
      k.at('darkTrim').tube([x + 0.46, 1.0, z], [x + 0.6, 0.6, z], 0.035, 6)
      k.solid(x - 0.45, 0, z - 0.33, x + 0.45, 2.0, z + 0.33)
    }
    for (const z of [cz - 3.9, cz + 3.9]) k.at('red').cylinder(x, 0.2, z, 0.12, 0.12, 0.9, 8)
  }
  k.solid(-hw, 0, -hd, hw, H + 0.8, hd)
  k.solid(hw - 3.2, 0, hd + 0.3, hw - 1.2, 1.3, hd + 1.1)
  k.solid(-hw + 0.4, 0, hd + 0.35, -hw + 1.3, 1.9, hd + 1.0)
  const px = -hw - 4
  const pz = p.setback - 9
  k.at('metal').box(px - 0.18, 0, pz - 0.18, px + 0.18, 6.2, pz + 0.18)
  k.at('white').box(px - 0.25, 6.2, pz - 1.6, px + 0.25, 8.4, pz + 1.6)
  k.at('red').box(px - 0.28, 8.4, pz - 1.65, px + 0.28, 8.6, pz + 1.65)
  k.at('darkTrim').box(px - 0.2, 3.6, pz - 1.4, px + 0.2, 6.0, pz + 1.4)
  k.solid(px - 0.25, 0, pz - 0.25, px + 0.25, 8.6, pz + 0.25)
}

// ---------------------------------------------------------------- motel

function motel(k: Kit, p: RoadsidePlace): void {
  const hw = p.w / 2
  const hd = p.d / 2
  const H = 3.1
  k.at('stucco').box(-hw, 0, -hd, hw, H, hd, { skipBottom: true })
  const ridge = H + 1.3
  gable(k.at('shingles'), k.at('stucco'), hw, hd, H, ridge, 0.4)
  const walk = 2.6
  k.at('concrete').box(-hw - 0.4, 0, hd, hw + 0.4, 0.16, hd + walk)
  const wr = k.at('shingles')
  wr.face([-hw - 0.4, 2.75, hd + walk + 0.3], [hw + 0.4, 2.75, hd + walk + 0.3], [hw + 0.4, H + 0.15, hd], [-hw - 0.4, H + 0.15, hd], [[0, 0], [p.w * 0.5, 0], [p.w * 0.5, 1.6], [0, 1.6]])
  wr.face([hw + 0.4, 2.68, hd + walk + 0.3], [-hw - 0.4, 2.68, hd + walk + 0.3], [-hw - 0.4, H + 0.08, hd], [hw + 0.4, H + 0.08, hd], [[0, 0], [p.w * 0.5, 0], [p.w * 0.5, 1.6], [0, 1.6]])
  k.at('trim').box(-hw - 0.4, 2.62, hd + walk + 0.15, hw + 0.4, 2.78, hd + walk + 0.32)
  for (let x = -hw; x <= hw + 0.01; x += p.w / 8) {
    k.at('trim').box(x - 0.09, 0.16, hd + walk - 0.09, x + 0.09, 2.7, hd + walk + 0.09)
    k.solid(x - 0.1, 0, hd + walk - 0.1, x + 0.1, 2.7, hd + walk + 0.1)
  }
  const office = 6
  k.at('glass').box(-hw + 0.6, 0.6, hd + 0.01, -hw + office - 1.6, 2.4, hd + 0.05)
  door(k, -hw + office - 0.9, 1.0, 2.15, hd)
  k.at('trim').box(-hw + office - 0.05, 0, hd, -hw + office + 0.05, H, hd + 0.08)
  const rooms = 12
  const span = (p.w - office) / rooms
  const doorColors: Part[] = ['paint', 'door']
  for (let i = 0; i < rooms; i++) {
    const x0 = -hw + office + i * span
    door(k, x0 + 0.85, 0.9, 2.1, hd, doorColors[i % 2])
    windowZ(k, x0 + span - 1.0, 1.0, 1.0, 1.1, hd, 1, 'white')
    k.at('glow').box(x0 + 0.65, 2.3, hd + 0.08, x0 + 1.05, 2.42, hd + 0.16)
    k.at('metal').box(x0 + span - 1.5, 0.2, hd + 0.05, x0 + span - 0.5, 0.75, hd + 0.75)
  }
  for (let i = 0; i < rooms; i++) windowZ(k, -hw + office + (i + 0.5) * span, 1.6, 0.6, 0.5, -hd, -1, 'white')
  k.at('metal').box(hw + 0.05, 0, -1.5, hw + 1.6, 1.4, 1.5)
  k.solid(-hw, 0, -hd, hw, ridge, hd)
  k.solid(hw + 0.05, 0, -1.5, hw + 1.6, 1.4, 1.5)
  const paint = k.at('white')
  for (let i = 0; i <= 12; i++) {
    const x = -hw + 2 + i * ((p.w - 4) / 12)
    paint.box(x - 0.06, LOT_Y + 0.004, hd + walk + 1.0, x + 0.06, LOT_Y + 0.012, hd + walk + 6.2, { skipBottom: true })
  }
  const px = hw + 3
  const pz = p.setback - 9
  k.at('metal').box(px - 0.2, 0, pz - 0.2, px + 0.2, 5.6, pz + 0.2)
  k.at('metal').box(px - 0.3, 5.6, pz - 2.1, px + 0.3, 8.1, pz + 2.1)
  k.at('darkTrim').box(px - 0.22, 4.1, pz - 1.4, px + 0.22, 5.4, pz + 1.4)
  k.solid(px - 0.25, 0, pz - 0.25, px + 0.25, 8.1, pz + 0.25)
}

// ---------------------------------------------------------------- tavern

function tavern(k: Kit, p: RoadsidePlace): void {
  const hw = p.w / 2
  const hd = p.d / 2
  const H = 3.6
  k.at('boards').box(-hw, 0, -hd, hw, H, hd, { skipBottom: true })
  const ridge = H + 2.4
  gable(k.at('rust'), k.at('boards'), hw, hd, H, ridge, 0.6)
  k.at('darkTrim').box(-hw - 0.08, 0, -hd - 0.08, hw + 0.08, 0.5, hd + 0.08)
  for (const x of [-hw, hw]) for (const z of [-hd, hd]) k.at('darkTrim').box(x - 0.12, 0, z - 0.12, x + 0.12, H, z + 0.12)
  const porch = 3
  k.at('boards').box(-hw, 0, hd, hw, 0.35, hd + porch)
  const pr = k.at('rust')
  pr.face([-hw - 0.3, 2.9, hd + porch + 0.3], [hw + 0.3, 2.9, hd + porch + 0.3], [hw + 0.3, H + 0.2, hd], [-hw - 0.3, H + 0.2, hd], [[0, 0], [p.w * 0.5, 0], [p.w * 0.5, 1.7], [0, 1.7]])
  pr.face([hw + 0.3, 2.83, hd + porch + 0.3], [-hw - 0.3, 2.83, hd + porch + 0.3], [-hw - 0.3, H + 0.13, hd], [hw + 0.3, H + 0.13, hd], [[0, 0], [p.w * 0.5, 0], [p.w * 0.5, 1.7], [0, 1.7]])
  for (const x of [-hw + 0.2, -hw / 2, 0, hw / 2, hw - 0.2]) {
    if (Math.abs(x) < 0.1) continue
    k.at('wood').box(x - 0.12, 0.35, hd + porch - 0.25, x + 0.12, 2.9, hd + porch - 0.01)
    k.solid(x - 0.13, 0, hd + porch - 0.26, x + 0.13, 2.9, hd + porch)
  }
  k.at('wood').box(-hw, 2.75, hd + porch - 0.25, hw, 2.95, hd + porch)
  door(k, 0, 1.6, 2.3, hd, 'door')
  windowZ(k, -hw + 2.6, 1.1, 2.2, 1.2, hd, 1, 'darkTrim')
  windowZ(k, hw - 2.6, 1.1, 2.2, 1.2, hd, 1, 'darkTrim')
  windowZ(k, -hw / 2 - 1.2, 1.1, 1.6, 1.2, hd, 1, 'darkTrim')
  windowZ(k, hw / 2 + 1.2, 1.1, 1.6, 1.2, hd, 1, 'darkTrim')
  for (const z of [-hd / 2, hd / 2]) {
    windowX(k, z, 1.2, 1.6, 1.0, hw, 1, 'darkTrim')
    windowX(k, z, 1.2, 1.6, 1.0, -hw, -1, 'darkTrim')
  }
  const bench = k.at('wood')
  for (const x of [-hw + 2.6, hw - 2.6]) {
    bench.box(x - 1.0, 0.75, hd + 0.4, x + 1.0, 0.8, hd + 0.8)
    for (const dx of [-0.9, 0.9]) bench.box(x + dx - 0.04, 0.35, hd + 0.45, x + dx + 0.04, 0.75, hd + 0.75)
  }
  const tx = hw + 4
  const tz = hd + 2
  const t = k.at('wood')
  t.box(tx - 0.9, 0.72, tz - 0.4, tx + 0.9, 0.78, tz + 0.4)
  for (const dz of [-0.75, 0.75]) t.box(tx - 0.9, 0.42, tz + dz - 0.13, tx + 0.9, 0.46, tz + dz + 0.13)
  for (const dx of [-0.7, 0.7]) t.box(tx + dx - 0.05, 0, tz - 0.8, tx + dx + 0.05, 0.72, tz + 0.8)
  k.solid(tx - 0.9, 0, tz - 0.9, tx + 0.9, 0.8, tz + 0.9)
  k.at('metal').box(-hw - 2.6, 0, -hd + 1, -hw - 0.6, 1.5, -hd + 3.2)
  k.solid(-hw - 2.6, 0, -hd + 1, -hw - 0.6, 1.5, -hd + 3.2)
  k.solid(-hw, 0, -hd, hw, ridge, hd)
  k.solid(-hw, 0, hd, hw, 0.35, hd + porch)
  const px = hw + 2
  const pz = p.setback - 9
  for (const dz of [-1.6, 1.6]) {
    k.at('wood').box(px - 0.14, 0, pz + dz - 0.14, px + 0.14, 4.6, pz + dz + 0.14)
    k.solid(px - 0.15, 0, pz + dz - 0.15, px + 0.15, 4.6, pz + dz + 0.15)
  }
  k.at('boards').box(px - 0.12, 3.0, pz - 1.9, px + 0.12, 4.5, pz + 1.9)
}

const MATERIALS: Record<Part, (mats: Mats, p: RoadsidePlace) => Material> = {
  logs: (m) => m.textured('rs-logs', 'bark', { color: 0x9a6a42, tile: 0.6 }),
  boards: (m) => m.textured('rs-boards', 'boards', { color: 0x6e4a33 }),
  siding: (m) => m.textured('rs-siding', 'siding', { color: 0xe9e2d2 }),
  stucco: (m) => m.textured('rs-stucco', 'stucco', { color: 0xe6d8bc }),
  shingles: (m) => m.textured('rs-shingles', 'shingles', { color: 0x5a4a3d }),
  tin: (m) => m.textured('rs-tin', 'metal', { color: 0x3f6b4a, metal: 0.4, gloss: 0.5 }),
  rust: (m) => m.textured('rs-rust', 'metal', { color: 0x8a4a2c, metal: 0.25, gloss: 0.3 }),
  stone: (m) => m.textured('rs-stone', 'stone', { color: 0x9a948a }),
  concrete: (m) => m.textured('rs-concrete', 'concrete'),
  gravel: (m) => m.textured('rs-gravel', 'gravel', { color: 0xa39a8a }),
  asphalt: (m) => m.textured('rs-lot-asphalt', 'asphalt', { color: 0x9a9a9a }),
  trim: (m) => m.plain('rs-trim', { color: 0xf2ece0, gloss: 0.3 }),
  darkTrim: (m) => m.plain('rs-dark-trim', { color: 0x2a2622, gloss: 0.3 }),
  glass: (m) => m.glass('rs-glass', 0x6f8592, 0.62),
  door: (m) => m.textured('rs-door', 'planks', { color: 0x5b3a24 }),
  paint: (m) => m.plain('rs-door-paint', { color: 0x2f5a7a, gloss: 0.5 }),
  red: (m) => m.plain('rs-red', { color: 0xb8301f, gloss: 0.55 }),
  white: (m) => m.plain('rs-white', { color: 0xf4f2ec, gloss: 0.4 }),
  metal: (m) => m.plain('rs-metal', { color: 0x8c9196, gloss: 0.55, metal: 0.6 }),
  wood: (m) => m.textured('rs-wood', 'planks', { color: 0x8a6440 }),
  firewood: (m) => m.textured('rs-firewood', 'bark', { color: 0xa47a52, tile: 0.8 }),
  screen: (m) => m.plain('rs-screen', { color: 0x1a1a1a, opacity: 0.5 }),
  glow: (m) => m.plain('rs-glow', { color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 1.6, unlit: true }),
}

const NO_CAST = new Set<Part>(['glass', 'gravel', 'asphalt', 'glow', 'screen'])

/** Builds every roadside place under `root` (the town's node); returns the static meshes (for culling). */
export function buildRoadside(root: TransformNode, mats: Mats, physics: Physics, asphalt: Material | null): Mesh[] {
  const out: Mesh[] = []
  for (const p of ROADSIDE) {
    const k = new Kit(p)
    lot(k, p)
    k.local()
    if (p.kind === 'cabin') cabin(k, p)
    else if (p.kind === 'gas') gasStation(k, p)
    else if (p.kind === 'motel') motel(k, p)
    else tavern(k, p)
    for (const [part, b] of k.b) {
      if (b.empty) continue
      const mat = part === 'asphalt' && asphalt ? asphalt : MATERIALS[part](mats, p)
      const mesh = b.toMesh(`roadside-${p.id}-${part}`)
      mesh.parent = root
      finishMesh(mesh, mat, { cast: !NO_CAST.has(part), static: true })
      out.push(mesh)
    }
    for (const s of k.boxes) physics.addStaticAABB(s.x0, s.y0, s.z0, s.x1, s.y1, s.z1)
  }
  return out
}
