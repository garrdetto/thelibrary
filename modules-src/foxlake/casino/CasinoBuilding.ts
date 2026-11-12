/**
 * The casino's building in town coordinates, made with the town's builders
 * (fp/core/Geo.ts) under the town's node: brick walls with the doorway on
 * South St, a flat roof with a parapet, carpet, a coffered ceiling with light
 * panels, the bar (counter, brass rail, back bar with lit shelves), stools,
 * the blackjack table and the slot cabinets (`CabinetModel.ts`). Walls and
 * roof don't cast sun shadows, so the room reads as lit from inside. Every
 * solid gets a Rapier collider, so walking, the camera and cars respect it.
 * Screens, signs and anything with lettering are built in scene space by
 * `CasinoScreens.ts`, so their text isn't mirrored.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { MeshBuilder, finishMesh, type RGB } from '../fp/core/Geo'
import type { Mats } from '../fp/core/Tex'
import type { Physics } from '../fp/physics/Physics'
import { BAR, BLACKJACK, CASINO, MACHINE_SPOTS } from './CasinoLayout'
import { buildCabinet, buildSlotChair } from './CabinetModel'

const WHITE: RGB = [1, 1, 1]

export function buildCasino(root: TransformNode, mats: Mats, physics: Physics): void {
  const { x0, x1, z0, z1, height: H, wall: W, floorY } = CASINO
  const brick = new MeshBuilder()
  const trim = new MeshBuilder()
  const floor = new MeshBuilder()
  const carpet = new MeshBuilder()
  const ceiling = new MeshBuilder()
  const panels = new MeshBuilder()
  const wood = new MeshBuilder()
  const dark = new MeshBuilder()
  const brass = new MeshBuilder()
  const leather = new MeshBuilder()
  const felt = new MeshBuilder()
  const shelfGlow = new MeshBuilder()
  const bottles = new MeshBuilder()
  const glassB = new MeshBuilder()

  const d = CASINO.door
  const dl = d.x - d.width / 2
  const dr = d.x + d.width / 2
  brick.box(x0, 0, z0, dl, H, z0 + W, { uv: 0.5 })
  brick.box(dr, 0, z0, x1, H, z0 + W, { uv: 0.5 })
  brick.box(dl, d.height, z0, dr, H, z0 + W, { uv: 0.5 })
  brick.box(x0, 0, z1 - W, x1, H, z1, { uv: 0.5 })
  brick.box(x0, 0, z0, x0 + W, H, z1, { uv: 0.5 })
  brick.box(x1 - W, 0, z0, x1, H, z1, { uv: 0.5 })
  brick.box(x0 - 0.15, H, z0 - 0.15, x1 + 0.15, H + 0.7, z0 + 0.15, { uv: 0.5 })
  brick.box(x0 - 0.15, H, z1 - 0.15, x1 + 0.15, H + 0.7, z1 + 0.15, { uv: 0.5 })
  brick.box(x0 - 0.15, H, z0, x0 + 0.15, H + 0.7, z1, { uv: 0.5 })
  brick.box(x1 - 0.15, H, z0, x1 + 0.15, H + 0.7, z1, { uv: 0.5 })
  for (const c of [{ x: x0 + W, z: z0 + W }, { x: x1 - W, z: z0 + W }, { x: x0 + W, z: z1 - W }, { x: x1 - W, z: z1 - W }]) brick.box(c.x - 0.45, 0, c.z - 0.45, c.x + 0.45, H + 0.2, c.z + 0.45, { uv: 0.5 })

  trim.box(dl - 0.25, 0, z0 - 0.08, dl, d.height + 0.25, z0 + W + 0.08)
  trim.box(dr, 0, z0 - 0.08, dr + 0.25, d.height + 0.25, z0 + W + 0.08)
  trim.box(dl - 0.25, d.height, z0 - 0.08, dr + 0.25, d.height + 0.25, z0 + W + 0.08)
  trim.box(d.x - 5, d.height + 0.6, z0 - 3.2, d.x + 5, d.height + 0.85, z0)
  for (const sx of [d.x - 4.6, d.x + 4.6]) trim.cylinder(sx, 0, z0 - 2.9, 0.12, 0.12, d.height + 0.6, 12)
  trim.box(x0 - 0.2, H + 0.7, z0 - 0.2, x1 + 0.2, H + 0.85, z1 + 0.2)

  floor.box(x0 - 6, -0.02, z0 - 6, x1 + 6, 0.02, z0, { uv: 0.4 })
  carpet.flat(x0 + W, z0 + W, x1 - W, z1 - W, floorY, 0.5)
  floor.box(x0 + W, 0, z0 + W, x1 - W, floorY - 0.005, z1 - W, { skipTop: true })

  ceiling.box(x0, H - 0.25, z0, x1, H, z1)
  for (let x = x0 + 2; x < x1 - 1; x += 4) for (let z = z0 + 2; z < z1 - 1; z += 4) {
    dark.box(x - 1.2, H - 0.45, z - 1.2, x + 1.2, H - 0.25, z + 1.2)
    panels.box(x - 0.9, H - 0.47, z - 0.9, x + 0.9, H - 0.45, z + 0.9)
  }

  const C = BAR.counter
  wood.box(C.x0, 0, C.z0, C.x1, C.top - 0.06, C.z1)
  dark.box(C.x0 - 0.1, C.top - 0.06, C.z0 - 0.15, C.x1 + 0.1, C.top, C.z1 + 0.1)
  brass.box(C.x0, 0.18, C.z0 - 0.28, C.x1, 0.22, C.z0 - 0.24)
  for (let x = C.x0 + 1; x < C.x1; x += 3) brass.box(x - 0.02, 0, C.z0 - 0.28, x + 0.02, 0.2, C.z0 - 0.24)
  leather.box(C.x0, C.top - 0.2, C.z0 - 0.08, C.x1, C.top - 0.06, C.z0)
  const B = BAR.backBar
  wood.box(B.x0, 0, B.z0, B.x1, 1.0, B.z1)
  dark.box(B.x0, 1.0, B.z0 - 0.05, B.x1, 1.05, B.z1)
  for (let i = 0; i < 3; i++) {
    const y = 1.5 + i * 0.55
    glassB.box(B.x0 + 0.2, y, B.z0 + 0.15, B.x1 - 0.2, y + 0.03, B.z1)
    shelfGlow.box(B.x0 + 0.2, y - 0.02, B.z1 - 0.06, B.x1 - 0.2, y, B.z1)
    for (let x = B.x0 + 0.5; x < B.x1 - 0.3; x += 0.32 + ((x * 7) % 3) * 0.04) {
      const hgt = 0.26 + ((x * 13 + i) % 5) * 0.03
      const col: RGB = [[0.45, 0.22, 0.06], [0.16, 0.36, 0.12], [0.7, 0.55, 0.2], [0.85, 0.85, 0.82], [0.4, 0.08, 0.06]][Math.floor(x * 3 + i) % 5] as RGB
      bottles.cylinder(x, y + 0.03, B.z0 + 0.45, 0.04, 0.04, hgt, 10, true, col)
      bottles.cylinder(x, y + 0.03 + hgt, B.z0 + 0.45, 0.04, 0.012, 0.07, 10, true, col)
    }
  }
  dark.box(B.x0, 3.2, B.z0 + 0.1, B.x1, 3.3, B.z1)
  for (let x = C.x0 + 2; x < C.x1; x += 3) {
    brass.cylinder(x, 3.0, C.z0 + 0.4, 0.008, 0.008, H - 3.0, 6)
    brass.cylinder(x, 2.75, C.z0 + 0.4, 0.22, 0.05, 0.25, 16)
    panels.cylinder(x, 2.74, C.z0 + 0.4, 0.15, 0.15, 0.01, 16)
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

  const parts: [MeshBuilder, ReturnType<Mats['plain']>, boolean][] = [
    [brick, mats.textured('casino-brick', 'brick', { color: 0x9a6a58 }), false],
    [trim, mats.plain('casino-trim', { color: 0x2b2522, gloss: 0.5, metal: 0.3 }), false],
    [floor, mats.textured('casino-apron', 'concrete'), false],
    [carpet, mats.textured('casino-carpet', 'carpet', { color: 0x6b1c2a, tile: 3 }), false],
    [ceiling, mats.plain('casino-ceiling', { color: 0x1f1b26, gloss: 0.2 }), false],
    [panels, mats.plain('casino-panels', { color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 1.4, unlit: true }), false],
    [wood, mats.textured('casino-wood', 'woodPanel', { color: 0x6d3f22, gloss: 0.55 }), true],
    [dark, mats.plain('casino-dark', { color: 0x141218, gloss: 0.7, metal: 0.2 }), true],
    [brass, mats.plain('casino-brass', { color: 0xc9a14a, gloss: 0.85, metal: 1 }), true],
    [leather, mats.plain('casino-leather', { color: 0x3b1416, gloss: 0.55 }), true],
    [felt, mats.textured('casino-felt', 'carpet', { color: 0x0f5a34, tile: 6 }), false],
    [shelfGlow, mats.plain('casino-shelf-glow', { color: 0xfff6e0, emissive: 0xffc070, emissiveIntensity: 2.2, unlit: true }), false],
    [bottles, mats.plain('casino-bottles', { vcolor: true, gloss: 0.9, metal: 0.05 }), true],
    [glassB, mats.glass('casino-glass', 0xc8d8e0, 0.35), false],
  ]
  for (const [b, mat, cast] of parts) {
    if (b.empty) continue
    const colors = b === bottles
    const mesh = b.toMesh(`casino-${mat.name}`, colors)
    mesh.parent = root
    finishMesh(mesh, mat, { cast, static: true })
  }

  const add = (ax0: number, ay0: number, az0: number, ax1: number, ay1: number, az1: number) => physics.addStaticAABB(ax0, ay0, az0, ax1, ay1, az1)
  add(x0, 0, z0, dl, H, z0 + W)
  add(dr, 0, z0, x1, H, z0 + W)
  add(x0, 0, z1 - W, x1, H, z1)
  add(x0, 0, z0, x0 + W, H, z1)
  add(x1 - W, 0, z0, x1, H, z1)
  add(x0, H - 0.25, z0, x1, H + 0.85, z1)
  add(C.x0, 0, C.z0, C.x1, C.top, C.z1)
  add(B.x0, 0, B.z0, B.x1, 1.05, B.z1)
  physics.addStaticCylinder(T.x, T.top / 2, T.z - 0.3, T.top / 2, 1.2)
  for (const spot of MACHINE_SPOTS) {
    const c = Math.cos(spot.yaw)
    const s = Math.sin(spot.yaw)
    physics.addStaticBox({ cx: spot.x - s * 0.05, cy: 1.0, cz: spot.z - c * 0.05, hx: 0.42, hy: 1.0, hz: 0.42, rotY: spot.yaw })
  }
}
