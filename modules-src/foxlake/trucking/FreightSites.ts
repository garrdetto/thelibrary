/**
 * The freight sites, built with the town's builders in town coordinates under the town's node (like the casino and
 * the roadside places; lettering in scene space through `buildSign`):
 *
 *  - Fox Lake Freight & Gravel (shared/Freight.ts `YARD`): a gravel yard inside a chain-link fence with its gate on
 *    Freight Rd, a steel dock warehouse with three roll-up doors, bumpers and dock lights, the dispatch office (the
 *    board is on its porch), two vertical fuel tanks with a covered loading rack, gravel stockpiles with a loading
 *    hopper on legs over the truck lane, and steel racks.
 *  - Fox Plains Sawmill (`MILL`): a tall metal mill shed with an infeed deck, a decked log pile, an open lumber shed
 *    with stacked packs, a sawdust cone and a cyclone on the roof.
 *  - Pine Ridge landing (`LANDING`): log decks and slash piles in a cleared circle at the end of Pine Ridge Rd.
 *  - Building sites and the Lake Road works: traffic cones and a work zone sign at the stop.
 *
 * Every solid is a Rapier collider (town coordinates), so cars, the hunter and the camera respect it.
 */
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import type { Material } from '@babylonjs/core/Materials/material'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import { MeshBuilder, finishMesh } from '../fp/core/Geo'
import type { Mats } from '../fp/core/Tex'
import type { Physics } from '../fp/physics/Physics'
import { LANDING, MILL, YARD, siteOf } from '../../maplestreet/shared/Freight'
import { buildSign } from '../roadside/RoadsideSigns'
import { TOWN_Y, townToScene } from '../region'

type Part = 'gravel' | 'concrete' | 'steel' | 'metal' | 'roof' | 'siding' | 'dark' | 'yellow' | 'orange' | 'white' | 'tank' | 'wood' | 'bark' | 'logEnd' | 'fence' | 'glow' | 'red' | 'sawdust' | 'asphalt'

class Kit {
  readonly b = new Map<Part, MeshBuilder>()
  readonly solids: [number, number, number, number, number, number][] = []
  at(p: Part): MeshBuilder {
    let b = this.b.get(p)
    if (!b) this.b.set(p, (b = new MeshBuilder()))
    return b
  }
  solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.solids.push([Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1)])
  }
}

const MATS: Record<Part, (m: Mats) => Material> = {
  gravel: (m) => m.textured('fs-gravel', 'gravel', { color: 0x9c9384 }),
  asphalt: (m) => m.textured('fs-asphalt', 'asphalt', { color: 0x8a8a8a }),
  concrete: (m) => m.textured('fs-concrete', 'concrete'),
  steel: (m) => m.plain('fs-steel', { color: 0x4a4e54, gloss: 0.45, metal: 0.6 }),
  metal: (m) => m.textured('fs-metal', 'metal', { color: 0xb9bec4, metal: 0.5, gloss: 0.45 }),
  roof: (m) => m.textured('fs-roof', 'metal', { color: 0x3f5a72, metal: 0.4, gloss: 0.4 }),
  siding: (m) => m.textured('fs-siding', 'siding', { color: 0xd8d2c4 }),
  dark: (m) => m.plain('fs-dark', { color: 0x222426, gloss: 0.3 }),
  yellow: (m) => m.plain('fs-yellow', { color: 0xe8b51e, gloss: 0.5 }),
  orange: (m) => m.plain('fs-orange', { color: 0xf26a1b, gloss: 0.45 }),
  white: (m) => m.plain('fs-white', { color: 0xf2f0ea, gloss: 0.4 }),
  tank: (m) => m.plain('fs-tank', { color: 0xe6e8ea, gloss: 0.55, metal: 0.3 }),
  wood: (m) => m.textured('fs-wood', 'planks', { color: 0xc49a6c }),
  bark: (m) => m.textured('fs-bark', 'bark', { color: 0x8b6a4c, tile: 0.7 }),
  logEnd: (m) => m.plain('fs-log-end', { color: 0xcaa070, gloss: 0.15 }),
  fence: (m) => m.plain('fs-fence', { color: 0x8d9298, gloss: 0.5, metal: 0.7, opacity: 0.55 }),
  glow: (m) => m.plain('fs-glow', { color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 1.4, unlit: true }),
  red: (m) => m.plain('fs-red', { color: 0xb8301f, gloss: 0.5 }),
  sawdust: (m) => m.textured('fs-sawdust', 'dirt', { color: 0xd4b07c }),
}

const NO_CAST = new Set<Part>(['gravel', 'asphalt', 'glow', 'fence'])

function cone(b: MeshBuilder, x: number, y: number, z: number, r: number, h: number) {
  b.cylinder(x, y, z, r, r * 0.08, h, 24, true)
}

function trafficCone(k: Kit, x: number, z: number) {
  k.at('dark').box(x - 0.2, 0, z - 0.2, x + 0.2, 0.04, z + 0.2)
  k.at('orange').cylinder(x, 0.04, z, 0.15, 0.03, 0.7, 12, true)
  k.at('white').cylinder(x, 0.36, z, 0.095, 0.072, 0.1, 12, false)
}

// ---------------------------------------------------------------- the yard

function yard(k: Kit) {
  const { x0, x1, z0, z1, gate } = YARD
  k.at('gravel').flat(x0, z0, x1, z1, 0.03, 0.8)
  k.at('asphalt').flat(x0 + 2, 562, 34, 580, 0.04, 1)
  const F = k.at('fence'), S = k.at('steel')
  const post = (x: number, z: number) => S.cylinder(x, 0, z, 0.04, 0.04, 2.1, 8, true)
  const run = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.round(len / 3))
    for (let i = 0; i <= n; i++) post(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)
    if (ax === bx) {
      F.box(ax - 0.01, 0.05, Math.min(az, bz), ax + 0.01, 2.0, Math.max(az, bz))
      S.box(ax - 0.025, 2.0, Math.min(az, bz), ax + 0.025, 2.05, Math.max(az, bz))
      k.solid(ax - 0.05, 0, az, ax + 0.05, 2.1, bz)
    } else {
      F.box(Math.min(ax, bx), 0.05, az - 0.01, Math.max(ax, bx), 2.0, az + 0.01)
      S.box(Math.min(ax, bx), 2.0, az - 0.025, Math.max(ax, bx), 2.05, az + 0.025)
      k.solid(ax, 0, az - 0.05, bx, 2.1, az + 0.05)
    }
  }
  run(x0, z0, x1, z0)
  run(x0, z1, x1, z1)
  run(x0, z0, x0, z1)
  run(x1, z0, x1, gate.z - 10)
  run(x1, gate.z + 10, x1, z1)
  for (const z of [gate.z - 10, gate.z + 10]) S.cylinder(x1, 0, z, 0.09, 0.09, 2.4, 10, true)

  // Dock warehouse: steel walls on a concrete dock, three roll-up doors facing the yard.
  const wx0 = 2, wx1 = 30, wz0 = 548, wz1 = 561
  k.at('concrete').box(wx0, 0, wz0, wx1, 1.22, wz1 + 0.4)
  k.at('metal').box(wx0, 1.22, wz0, wx1, 7.2, wz1, { skipBottom: true })
  k.at('roof').box(wx0 - 0.4, 7.2, wz0 - 0.4, wx1 + 0.4, 7.45, wz1 + 0.6)
  for (const dx of [8, 16, 24]) {
    k.at('white').box(dx - 1.5, 1.22, wz1, dx + 1.5, 4.3, wz1 + 0.05)
    for (let y = 1.4; y < 4.3; y += 0.25) k.at('steel').box(dx - 1.5, y, wz1 + 0.05, dx + 1.5, y + 0.02, wz1 + 0.07)
    for (const s of [-1, 1]) k.at('dark').box(dx + s * 1.25 - 0.15, 0.6, wz1 + 0.4, dx + s * 1.25 + 0.15, 1.15, wz1 + 0.55)
    k.at('glow').box(dx - 0.2, 4.6, wz1 + 0.05, dx + 0.2, 4.75, wz1 + 0.3)
    k.at('yellow').box(dx - 1.7, 0.02, wz1 + 0.4, dx - 1.55, 0.03, wz1 + 16)
    k.at('yellow').box(dx + 1.55, 0.02, wz1 + 0.4, dx + 1.7, 0.03, wz1 + 16)
  }
  k.at('steel').box(wx1 - 0.2, 0, wz1 - 3, wx1 + 2.5, 1.22, wz1 - 2)
  k.solid(wx0, 0, wz0, wx1, 7.45, wz1 + 0.55)

  // Dispatch office with a porch; the board hangs by the door.
  const ox0 = 36, ox1 = 47, oz0 = 549, oz1 = 557
  k.at('concrete').box(ox0 - 0.5, 0, oz0 - 0.5, ox1 + 0.5, 0.3, oz1 + 2.5)
  k.at('siding').box(ox0, 0.3, oz0, ox1, 3.4, oz1, { skipBottom: true })
  k.at('roof').face([ox0 - 0.5, 3.4, oz1 + 2.6], [ox1 + 0.5, 3.4, oz1 + 2.6], [ox1 + 0.5, 4.3, oz0 - 0.5], [ox0 - 0.5, 4.3, oz0 - 0.5], [[0, 0], [6, 0], [6, 5], [0, 5]])
  k.at('roof').face([ox1 + 0.5, 3.35, oz1 + 2.6], [ox0 - 0.5, 3.35, oz1 + 2.6], [ox0 - 0.5, 4.25, oz0 - 0.5], [ox1 + 0.5, 4.25, oz0 - 0.5], [[0, 0], [6, 0], [6, 5], [0, 5]])
  for (const x of [ox0 - 0.3, ox1 + 0.3]) k.at('steel').box(x - 0.06, 0.3, oz1 + 2.3, x + 0.06, 3.4, oz1 + 2.42)
  k.at('dark').box(ox0 + 4.5, 0.3, oz1, ox0 + 5.5, 2.4, oz1 + 0.06)
  for (const x of [ox0 + 1.2, ox0 + 7.5]) {
    k.at('dark').box(x, 1.0, oz1, x + 2.2, 2.2, oz1 + 0.05)
    k.at('white').box(x - 0.06, 0.94, oz1, x + 2.26, 1.0, oz1 + 0.08)
  }
  k.at('wood').box(ox0 + 6, 0.9, oz1 + 0.05, ox0 + 7.2, 2.1, oz1 + 0.12)
  k.solid(ox0, 0, oz0, ox1, 4.3, oz1)

  // Fuel: two vertical tanks in a containment wall, and the loading rack the tanker parks under.
  k.at('concrete').box(51, 0, 600, 60.5, 0.8, 621)
  for (const z of [605, 616]) {
    k.at('tank').cylinder(55.8, 0.8, z, 3.2, 3.2, 7.5, 32, true)
    k.at('tank').cylinder(55.8, 8.3, z, 3.2, 0.4, 0.8, 32, true)
    k.at('steel').tube([55.8 - 3.25, 0.8, z - 0.4], [55.8 - 3.25, 8.4, z - 0.4], 0.04, 6)
    k.solid(52.5, 0, z - 3.3, 59.1, 9.2, z + 3.3)
  }
  const rx = 44, rz = 612
  for (const dx of [-3.5, 3.5]) for (const dz of [-6, 6]) k.at('steel').box(rx + dx - 0.15, 0, rz + dz - 0.15, rx + dx + 0.15, 5.6, rz + dz + 0.15)
  k.at('white').box(rx - 4, 5.6, rz - 7, rx + 4, 5.9, rz + 7)
  k.at('red').box(rx - 4.05, 5.9, rz - 7.05, rx + 4.05, 6.4, rz + 7.05)
  k.at('steel').box(rx + 3.8, 0, rz - 1, rx + 4.6, 4.2, rz + 1)
  k.at('steel').tube([rx + 4.2, 4.0, rz], [rx + 1.5, 4.6, rz], 0.08, 10)
  k.at('dark').tube([rx + 1.5, 4.6, rz], [rx + 1.2, 3.4, rz], 0.06, 10)
  for (const dx of [-3.5, 3.5]) for (const dz of [-6, 6]) k.solid(rx + dx - 0.2, 0, rz + dz - 0.2, rx + dx + 0.2, 5.6, rz + dz + 0.2)
  k.solid(rx + 3.8, 0, rz - 1, rx + 4.6, 4.2, rz + 1)

  // Gravel: three stockpiles and the loading hopper over the truck lane.
  for (const [x, z, r, h] of [[-3, 597, 6.2, 4.2], [-3, 612, 5.4, 3.6], [0, 588, 4.2, 2.8]] as const) {
    cone(k.at('gravel'), x, 0, z, r, h)
    k.solid(x - r * 0.6, 0, z - r * 0.6, x + r * 0.6, h * 0.7, z + r * 0.6)
  }
  const hx = 8, hz = 610
  for (const dx of [-2.2, 2.2]) for (const dz of [-1.8, 1.8]) {
    k.at('yellow').box(hx + dx - 0.15, 0, hz + dz - 0.15, hx + dx + 0.15, 5.2, hz + dz + 0.15)
    k.solid(hx + dx - 0.2, 0, hz + dz - 0.2, hx + dx + 0.2, 5.2, hz + dz + 0.2)
  }
  k.at('yellow').box(hx - 2.5, 5.2, hz - 2.1, hx + 2.5, 5.5, hz + 2.1)
  k.at('metal').box(hx - 2.4, 5.5, hz - 2.0, hx + 2.4, 7.6, hz + 2.0)
  cone(k.at('gravel'), hx, 7.55, hz, 1.9, 0.8)
  k.at('steel').box(hx - 0.5, 4.6, hz - 0.5, hx + 0.5, 5.2, hz + 0.5)
  k.at('steel').tube([hx - 2.4, 7.4, hz], [hx - 12, 1.0, hz], 0.35, 10)
  for (const f of [0.3, 0.65]) k.at('yellow').box(hx - 2.4 - 9.6 * f - 0.1, 0, hz - 0.1, hx - 2.4 - 9.6 * f + 0.1, 7.4 - 6.4 * f, hz + 0.1)

  // Steel racks by the steel stop.
  for (let x = 36; x < 53; x += 4) {
    for (const dz of [0, 4]) k.at('red').box(x - 0.1, 0, 562.5 + dz - 0.1, x + 0.1, 2.4, 562.5 + dz + 0.1)
    for (const y of [0.8, 1.6]) k.at('red').box(x - 0.1, y, 562.4, x + 0.1, y + 0.08, 566.6)
  }
  for (const y of [0.88, 1.68]) for (let z = 562.8; z < 566.4; z += 0.6) {
    k.at('steel').box(35.5, y, z, 52.5, y + 0.02, z + 0.25)
    k.at('steel').box(35.5, y + 0.02, z + 0.115, 52.5, y + 0.28, z + 0.135)
  }
  k.solid(35.5, 0, 562.3, 52.5, 2.4, 566.7)
}

// ---------------------------------------------------------------- the sawmill

function sawmill(k: Kit) {
  const { x0, x1, z0, z1 } = MILL
  k.at('gravel').flat(x0, z0, x1, z1, 0.03, 0.8)
  const mx0 = 597, mx1 = 615, mz0 = -32, mz1 = 6
  k.at('concrete').box(mx0, 0, mz0, mx1, 0.3, mz1)
  k.at('metal').box(mx0, 0.3, mz0, mx1, 9, mz1, { skipBottom: true })
  k.at('roof').face([mx0 - 0.5, 9, mz1 + 0.5], [mx0 - 0.5, 9, mz0 - 0.5], [(mx0 + mx1) / 2, 11, mz0 - 0.5], [(mx0 + mx1) / 2, 11, mz1 + 0.5], [[0, 0], [20, 0], [20, 5], [0, 5]])
  k.at('roof').face([mx1 + 0.5, 9, mz0 - 0.5], [mx1 + 0.5, 9, mz1 + 0.5], [(mx0 + mx1) / 2, 11, mz1 + 0.5], [(mx0 + mx1) / 2, 11, mz0 - 0.5], [[0, 0], [20, 0], [20, 5], [0, 5]])
  for (const z of [-24, -14, -4]) k.at('dark').box(mx0 - 0.05, 1.2, z - 1.6, mx0, 4.4, z + 1.6)
  k.at('steel').box(mx0 + 2, 0, mz1, mx0 + 14, 1.1, mz1 + 6)
  for (let x = mx0 + 2.5; x < mx0 + 14; x += 1.2) k.at('dark').box(x, 1.1, mz1, x + 0.1, 1.2, mz1 + 6)
  const cy = (mx0 + mx1) / 2
  k.at('tank').cylinder(cy + 3, 11, -20, 1.4, 1.4, 2.6, 20, true)
  k.at('tank').cylinder(cy + 3, 8.6, -20, 0.2, 1.4, 2.4, 20, false)
  k.at('steel').tube([cy + 3, 13.6, -20], [cy + 3, 15, -20], 0.25, 10)
  k.at('steel').tube([cy + 3, 13, -20], [mx1 - 2, 13, -2], 0.3, 10)
  k.solid(mx0, 0, mz0, mx1, 11, mz1)
  k.solid(mx0 + 2, 0, mz1, mx0 + 14, 1.2, mz1 + 6)

  // Log deck: decked logs, butts out, by the infeed.
  const logs = k.at('bark'), ends = k.at('logEnd')
  for (let tier = 0; tier < 3; tier++) for (let i = 0; i < 9 - tier; i++) {
    const z = 15 + i * 0.95 + tier * 0.47
    const y = 0.42 + tier * 0.8
    logs.tube([598, y, z], [612, y, z], 0.42, 12, false)
    ends.tube([597.98, y, z], [598, y, z], 0.4, 12, true)
    ends.tube([612, y, z], [612.02, y, z], 0.4, 12, true)
  }
  k.solid(598, 0, 14.5, 612, 2.4, 23.8)
  cone(k.at('sawdust'), 610, 0, 30, 4, 3.2)
  k.solid(607.5, 0, 27.5, 612.5, 2.4, 32.5)

  // Lumber shed: a roof on posts over stacked packs.
  const sx0 = 576, sx1 = 592, sz0 = -34, sz1 = -18
  for (const x of [sx0, (sx0 + sx1) / 2, sx1]) for (const z of [sz0, sz1]) {
    k.at('steel').box(x - 0.12, 0, z - 0.12, x + 0.12, 5, z + 0.12)
    k.solid(x - 0.15, 0, z - 0.15, x + 0.15, 5, z + 0.15)
  }
  k.at('roof').box(sx0 - 0.6, 5, sz0 - 0.6, sx1 + 0.6, 5.2, sz1 + 0.6)
  for (let x = sx0 + 1; x < sx1 - 1; x += 3.4) for (let t = 0; t < 2; t++) {
    k.at('wood').box(x, 0.12 + t * 1.05, sz0 + 1, x + 2.9, 1.05 + t * 1.05, sz1 - 1)
    k.at('dark').box(x, t * 1.05, sz0 + 2, x + 2.9, 0.12 + t * 1.05, sz0 + 2.2)
  }
  k.solid(sx0 + 1, 0, sz0 + 1, sx1 - 1, 2.2, sz1 - 1)
}

// ---------------------------------------------------------------- the landing

function landing(k: Kit, groundY: number) {
  const { x, z, r } = LANDING
  const y0 = groundY
  k.at('gravel').transform(Matrix.Translation(0, y0, 0))
  const seg = 32
  const g = k.at('gravel')
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2
    const p1 = [x + Math.cos(a1) * r, 0.04, z + Math.sin(a1) * r], p0 = [x + Math.cos(a0) * r, 0.04, z + Math.sin(a0) * r]
    g.face([x, 0.04, z], p1, p1, p0, [[x * 0.8, z * 0.8], [p1[0] * 0.8, p1[2] * 0.8], [p1[0] * 0.8, p1[2] * 0.8], [p0[0] * 0.8, p0[2] * 0.8]])
  }
  g.transform(null)
  const logs = k.at('bark'), ends = k.at('logEnd')
  for (const [cx, cz, along] of [[x - 14, z - 8, 1], [x + 12, z - 12, 0], [x + 6, z + 14, 1]] as const) {
    for (let tier = 0; tier < 3; tier++) for (let i = 0; i < 6 - tier; i++) {
      const off = (i - (5 - tier) / 2) * 0.9
      const y = y0 + 0.4 + tier * 0.75
      const a = along ? [cx - 6, y, cz + off] : [cx + off, y, cz - 6]
      const b = along ? [cx + 6, y, cz + off] : [cx + off, y, cz + 6]
      logs.tube(a, b, 0.38, 12, false)
      ends.tube(along ? [a[0] - 0.02, y, a[2]] : [a[0], y, a[2] - 0.02], a, 0.36, 12, true)
      ends.tube(b, along ? [b[0] + 0.02, y, b[2]] : [b[0], y, b[2] + 0.02], 0.36, 12, true)
    }
    if (along) k.solid(cx - 6, y0, cz - 3, cx + 6, y0 + 2.2, cz + 3)
    else k.solid(cx - 3, y0, cz - 6, cx + 3, y0 + 2.2, cz + 6)
  }
  for (const [sx, sz] of [[x - 18, z + 12], [x + 18, z + 4]] as const) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2
      logs.tube([sx, y0 + 0.2, sz], [sx + Math.cos(a) * 2.4, y0 + 1.2 + (i % 3) * 0.3, sz + Math.sin(a) * 2.4], 0.07, 6, false)
    }
  }
}

// ---------------------------------------------------------------- building sites

function workZones(k: Kit) {
  for (const id of ['site-juniper', 'site-willow', 'site-mill']) {
    const s = siteOf(id)
    if (!s) continue
    for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) trafficCone(k, s.x + dx, s.z + dz * 0.85)
  }
}

export interface FreightSiteMeshes {
  meshes: Mesh[]
  signs: TransformNode
}

/** Builds every freight site under `root` (the town's node). `groundAt` is the scene ground height at a scene point. */
export function buildFreightSites(root: TransformNode, scene: Scene, mats: Mats, physics: Physics, groundAt: (x: number, z: number) => number): FreightSiteMeshes {
  const k = new Kit()
  yard(k)
  sawmill(k)
  const L = townToScene(LANDING.x, 0, LANDING.z)
  const landingY = groundAt(L.x, L.z) - TOWN_Y
  landing(k, landingY)
  workZones(k)
  const meshes: Mesh[] = []
  for (const [part, b] of k.b) {
    if (b.empty) continue
    const mesh = b.toMesh(`freight-${part}`)
    mesh.parent = root
    finishMesh(mesh, MATS[part](mats), { cast: !NO_CAST.has(part), static: true })
    meshes.push(mesh)
  }
  for (const s of k.solids) physics.addStaticAABB(s[0], s[1], s[2], s[3], s[4], s[5])
  const signs = new TransformNode('freight-signs', scene)
  const board = { kind: 'board' as const, bg: '#13314f', fg: '#f4f1e6', border: '#f2a93b' }
  buildSign(scene, signs, 'FOX LAKE FREIGHT', { ...board, sub: '& GRAVEL · DISPATCH' }, 41.5, 4.8, 557.2, 0, 7, 1.4)
  buildSign(scene, signs, 'DISPATCH BOARD', { kind: 'board', bg: '#1d1f22', fg: '#ffd34d', sub: 'TAKE A LOAD — PRESS E' }, 39.4, 1.8, 557.1, 0, 1.6, 0.9)
  buildSign(scene, signs, 'FOX LAKE FREIGHT', { ...board, sub: '& GRAVEL' }, YARD.x1 + 0.15, 3.2, YARD.gate.z - 12, Math.PI / 2, 5, 1.6)
  buildSign(scene, signs, 'FOX PLAINS SAWMILL', { kind: 'board', bg: '#4a2e18', fg: '#f6e3b8', border: '#f6e3b8' }, 597 - 0.06, 7.2, -13, -Math.PI / 2, 12, 1.6)
  buildSign(scene, signs, 'PINE RIDGE LANDING', { kind: 'board', bg: '#2f4a32', fg: '#f3e6c4', border: '#f3e6c4' }, LANDING.x - 24, landingY + 2.4, LANDING.z - 20, -Math.PI * 0.75, 4, 1)
  for (const id of ['site-juniper', 'site-willow', 'site-mill']) {
    const s = siteOf(id)
    if (s) buildSign(scene, signs, 'WORK ZONE', { kind: 'board', bg: '#f26a1b', fg: '#111111', sub: 'DELIVERIES' }, s.x + 7, 1.3, s.z, -Math.PI / 2, 1.5, 0.9)
  }
  return { meshes, signs }
}
