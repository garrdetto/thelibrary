/**
 * The light where Main Street meets State Highway 23 (West Montello Street to the west, East Montello Street to the
 * east), from the owner's drive through it: the grass island between Main Street's two legs with its yellow curb and
 * keep-right sign, mast-arm signals on the north corners and a post-mounted signal between them, the route sign
 * assembly in front of the falls and the two-way arrow; the green guide sign on Main Street; and the stone parapets
 * with iron railings on the West Montello Street bridge.
 *
 * Built in Tello's town frame (x east, z south) under the mirrored town root. The signals run a fixed cycle.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders, finishMesh, hexRGB, MeshBuilder } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import { mainIsland, offsetLine, signalPhase, type SignalGroup, type SignalLamp } from '../data/Streets'
import type { TelloLand } from '../region'
import { PARAPET_H, PARAPET_T } from './Roads'
import type { StaticSink } from './Sink'
import { triangulate } from './Poly'

type Group = SignalGroup
type Lamp = SignalLamp
const LAMPS: Lamp[] = ['red', 'amber', 'green']
const LAMP_COLOR: Record<Lamp, number> = { red: 0xff2a1c, amber: 0xffa31a, green: 0x2dffb0 }

/** A facing in map coordinates (x east, z north) as the yaw that turns a +z-facing local frame toward it in the town frame. */
const yawFacing = (fx: number, fz: number) => Math.atan2(fx, -fz)

export class Intersection {
  private time = 0
  constructor(private readonly lamps: Map<string, Mesh>) {
    this.show(0)
  }

  update(dt: number): void {
    this.time += dt
    this.show(this.time)
  }

  private show(t: number): void {
    const p = signalPhase(t)
    for (const [key, mesh] of this.lamps) {
      const [group, lamp] = key.split(':') as [Group, Lamp]
      mesh.isVisible = p[group] === lamp
    }
  }
}

interface Kit {
  chunks: ChunkedBuilders
  M: Record<string, Material>
  lit: Map<string, MeshBuilder>
}

export function buildIntersection(root: TransformNode, mats: Mats, sink: StaticSink, land: TelloLand): Intersection {
  const chunks = new ChunkedBuilders(128)
  const M: Record<string, Material> = {
    pole: mats.plain('tello-signal-pole', { color: 0x8a8d90, gloss: 0.3, metal: 0.6 }),
    head: mats.plain('tello-signal-head', { color: 0x15171a, gloss: 0.25 }),
    plate: mats.plain('tello-signal-plate', { vcolor: true, gloss: 0.2 }),
    lens: mats.plain('tello-signal-lens', { vcolor: true, gloss: 0.6 }),
    curb: mats.plain('tello-curb', { vcolor: true, gloss: 0.05 }),
    grass: mats.plain('tello-island-grass', { color: 0x58733a, gloss: 0 }),
    stone: mats.textured('tello-stone', 'stone', { vcolor: true }),
    iron: mats.plain('tello-lamp-iron', { color: 0x1c1e22, gloss: 0.3 }),
    route: signMaterial(mats, 'tello-sign-route', routeAssembly()),
    keep: signMaterial(mats, 'tello-sign-keep-right', keepRight()),
    marker: signMaterial(mats, 'tello-sign-marker', objectMarker()),
    arrow: signMaterial(mats, 'tello-sign-two-way', twoWayArrow()),
    guide: signMaterial(mats, 'tello-sign-guide', guideSign()),
  }
  const kit: Kit = { chunks, M, lit: new Map() }
  island(kit, land)
  const h = (x: number, z: number) => land.heightAt(x, z)
  // The north-east mast arm reaches west over the highway: Main Street's lamps face south, the highway's face west.
  mastArm(kit, sink, 125.6, h(125.6, 28.7), 28.7, -1, 0, 9.2, [
    { at: 4.2, face: [0, -1], group: 'n' },
    { at: 8.4, face: [0, -1], group: 'n' },
    { at: 2.2, face: [-1, 0], group: 'ew' },
  ])
  // The north-west arm reaches east: a horizontal head for traffic coming from East Montello Street.
  // The north-west arm reaches south over the westbound lane: a horizontal head for traffic from East Montello Street.
  mastArm(kit, sink, 98.4, h(98.4, 28.2), 28.2, 0, -1, 6.4, [{ at: 4.6, face: [1, 0], group: 'ew', flat: true }, { at: 0.55, face: [1, 0], group: 'ew' }])
  pedestal(kit, sink, 110.6, h(110.6, 28.4), 28.4, [0, -1], 'n')
  // A post signal on the island's north end for traffic coming from West Montello Street.
  pedestal(kit, sink, 111.6, h(111.6, 13.2), 13.2, [-1, 0], 'ew', 2.9)
  const nose = mainIsland()
  // Signs.
  board(kit, sink, 114.4, h(114.4, 30.9), 30.9, [0, -1], M.route, 2.5, 1.62, 1.35, true)
  board(kit, sink, 123.7, h(123.7, 29.3), 29.3, [0, -1], M.arrow, 0.9, 0.9, 2.1, false)
  board(kit, sink, nose[0] + 0.1, h(nose[0], nose[1] + 0.6), nose[1] + 0.6, [0, -1], M.keep, 0.6, 0.76, 1.65, false)
  board(kit, sink, nose[0] + 0.1, h(nose[0], nose[1] + 0.6), nose[1] + 0.62, [0, -1], M.marker, 0.46, 0.46, 0.75, false, true)
  const guideZ = -62
  board(kit, sink, guideX(land, guideZ), h(guideX(land, guideZ), guideZ), guideZ, [0, -1], M.guide, 2.3, 1.2, 2.2, true)
  parapets(kit, land)
  chunks.flush(root, 'tello-junction')
  const lamps = new Map<string, Mesh>()
  for (const [key, b] of kit.lit) {
    if (b.empty) continue
    const lamp = key.split(':')[1] as Lamp
    const mesh = b.toMesh(`tello-signal-lit:${key}`)
    mesh.parent = root
    finishMesh(mesh, mats.plain(`tello-signal-${lamp}`, { color: LAMP_COLOR[lamp], emissive: LAMP_COLOR[lamp], emissiveIntensity: 3.2, gloss: 0.6 }), { cast: false, static: true })
    lamps.set(key, mesh)
  }
  return new Intersection(lamps)
}

/** Main Street's east curb at map `z` (where the guide sign stands). */
function guideX(land: TelloLand, z: number): number {
  const main = land.doc.roads.find((r) => r.n === 'Main Street' && r.p[1] < -100)
  if (!main) return 134
  const p = main.p
  for (let k = 0; k + 3 < p.length; k += 2) {
    if ((p[k + 1] - z) * (p[k + 3] - z) <= 0) {
      const t = (z - p[k + 1]) / (p[k + 3] - p[k + 1] || 1)
      return p[k] + (p[k + 2] - p[k]) * t + 6.9
    }
  }
  return 134
}

// ---------------------------------------------------------------- island

function island(kit: Kit, land: TelloLand): void {
  const ring = mainIsland()
  const n = ring.length / 2
  const top = 0.16
  const grass = kit.chunks.get(ring[0], -ring[1], kit.M.grass)
  const y = (x: number, z: number) => land.heightAt(x, z) + top
  for (let k = 0, idx = triangulate(ring); k < idx.length; k += 3) {
    const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]].map((i) => [ring[i * 2], y(ring[i * 2], ring[i * 2 + 1]), -ring[i * 2 + 1]])
    // Wound so the face's normal points up.
    const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
    if (up >= 0) grass.face(a, b, c, c, [[0, 0], [1, 0], [1, 1], [1, 1]])
    else grass.face(a, c, b, b, [[0, 0], [1, 0], [1, 1], [1, 1]])
  }
  // A yellow-painted curb all round, and a concrete nose.
  const curb = kit.chunks.get(ring[0], -ring[1], kit.M.curb, { colors: true })
  const yellow = hexRGB(0xd8b23a)
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 0.05) continue
    const mx = (ax + bx) / 2, mz = (az + bz) / 2
    const yaw = Math.atan2(-(bz - az), bx - ax)
    // Map direction (dx, dz) in the town frame is (dx, -dz); orientedBox's local x maps to (cos yaw, -sin yaw).
    curb.orientedBox(mx, land.heightAt(mx, mz) + top / 2 + 0.01, -mz, len / 2 + 0.1, top / 2 + 0.03, 0.12, -yaw, { color: yellow })
  }
  const nx = ring[0], nz = ring[1]
  curb.cylinder(nx, land.heightAt(nx, nz), -nz, 0.5, 0.45, top + 0.02, 12, true, hexRGB(0xb9b4aa))
}

// ---------------------------------------------------------------- signals

interface HeadSpec { at: number; face: [number, number]; group: Group; flat?: boolean }

function mastArm(kit: Kit, sink: StaticSink, x: number, y: number, mz: number, dx: number, dz: number, reach: number, heads: HeadSpec[]): void {
  const z = -mz
  const pole = kit.chunks.get(x, z, kit.M.pole)
  pole.cylinder(x, y, z, 0.3, 0.26, 0.5, 12)
  pole.cylinder(x, y + 0.5, z, 0.17, 0.12, 7.3, 12)
  const armY = y + 6.3
  const tx = x + dx * reach, tz = z - dz * reach
  pole.tube([x, armY, z], [tx, armY + 0.15, tz], 0.09, 10)
  pole.tube([x, armY + 1.3, z], [x + dx * reach * 0.45, armY + 0.12, z - dz * reach * 0.45], 0.035, 6)
  sink.addStaticCylinder(x, y + 3.6, z, 3.6, 0.2)
  for (const s of heads) {
    const hx = x + dx * s.at, hz = mz + dz * s.at
    const onPole = s.at < 1
    head(kit, hx, onPole ? y + 3.6 : armY - (s.flat ? 0.35 : 0.72), hz, s.face, s.group, !!s.flat)
    if (!onPole) pole.box(hx - 0.03, armY - 0.12, -hz - 0.03, hx + 0.03, armY, -hz + 0.03)
  }
}

function pedestal(kit: Kit, sink: StaticSink, x: number, y: number, mz: number, face: [number, number], group: Group, height = 3.1): void {
  const z = -mz
  const pole = kit.chunks.get(x, z, kit.M.pole)
  pole.cylinder(x, y, z, 0.24, 0.2, 0.35, 10)
  pole.cylinder(x, y + 0.35, z, 0.075, 0.07, height - 0.35, 10)
  head(kit, x, y + height + 0.55, mz, face, group, false)
  sink.addStaticCylinder(x, y + height / 2, z, height / 2, 0.12)
}

/** A signal head facing `face` (map direction) centred at (x, y, map z): housing, backplate with a yellow border, visors, lenses and the lit lamps. */
function head(kit: Kit, x: number, y: number, mz: number, face: [number, number], group: Group, flat: boolean): void {
  const z = -mz
  const yaw = yawFacing(face[0], face[1])
  const frame = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), yaw), new Vector3(x, y, z))
  const sections = flat ? 5 : 3
  const pitch = 0.36
  const W = flat ? pitch * sections + 0.08 : 0.42
  const H = flat ? 0.42 : pitch * sections + 0.08
  const at = (i: number): [number, number] => (flat ? [(i - (sections - 1) / 2) * pitch, 0] : [0, ((sections - 1) / 2 - i) * pitch])
  const body = kit.chunks.get(x, z, kit.M.head)
  const plate = kit.chunks.get(x, z, kit.M.plate, { colors: true })
  const lens = kit.chunks.get(x, z, kit.M.lens, { colors: true, cast: false })
  for (const b of [body, plate, lens]) b.transform(frame)
  body.box(-W / 2, -H / 2, -0.3, W / 2, H / 2, 0)
  plate.box(-W / 2 - 0.16, -H / 2 - 0.16, -0.34, W / 2 + 0.16, H / 2 + 0.16, -0.31, { color: hexRGB(0xe8c21a) })
  plate.box(-W / 2 - 0.11, -H / 2 - 0.11, -0.31, W / 2 + 0.11, H / 2 + 0.11, -0.3, { color: hexRGB(0x101113) })
  for (let i = 0; i < sections; i++) {
    const [cx, cy] = at(i)
    const lampColor = flat ? (['red', 'amber', 'green', 'amber', 'green'] as Lamp[])[i] : LAMPS[i]
    disc(lens, cx, cy, 0.01, 0.13, darkLens(lampColor))
    body.box(cx - 0.15, cy + 0.11, 0, cx + 0.15, cy + 0.14, 0.22)
    body.box(cx - 0.15, cy - 0.12, 0, cx - 0.12, cy + 0.14, 0.2)
    body.box(cx + 0.12, cy - 0.12, 0, cx + 0.15, cy + 0.14, 0.2)
    if (i > 2) continue
    const key = `${group}:${lampColor}`
    let lit = kit.lit.get(key)
    if (!lit) kit.lit.set(key, (lit = new MeshBuilder()))
    lit.transform(frame)
    disc(lit, cx, cy, 0.03, 0.12)
    lit.transform(null)
  }
  for (const b of [body, plate, lens]) b.transform(null)
}

/** A disc facing +z. */
function disc(b: MeshBuilder, cx: number, cy: number, z: number, r: number, c?: [number, number, number], seg = 14): void {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2
    const p1 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z], p2 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z]
    b.quad([[cx, cy, z], p1, p2, p2], [0, 0, 1], [[0.5, 0.5], [0.5 + Math.cos(a0) / 2, 0.5 - Math.sin(a0) / 2], [0.5 + Math.cos(a1) / 2, 0.5 - Math.sin(a1) / 2], [0.5 + Math.cos(a1) / 2, 0.5 - Math.sin(a1) / 2]], c)
  }
}

function darkLens(l: Lamp): [number, number, number] {
  return l === 'red' ? [0.16, 0.03, 0.02] : l === 'amber' ? [0.17, 0.1, 0.02] : [0.02, 0.12, 0.09]
}

// ---------------------------------------------------------------- signs

/** A sign board facing `face` on one or two galvanized posts, its bottom `bottom` metres up. */
function board(kit: Kit, sink: StaticSink, x: number, y: number, mz: number, face: [number, number], mat: Material, w: number, hgt: number, bottom: number, two: boolean, noPost = false): void {
  const z = -mz
  const yaw = yawFacing(face[0], face[1])
  const frame = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), yaw), new Vector3(x, y, z))
  const pole = kit.chunks.get(x, z, kit.M.pole)
  const face0 = kit.chunks.get(x, z, mat, { cast: true })
  pole.transform(frame)
  face0.transform(frame)
  face0.quad([[-w / 2, bottom, 0.04], [w / 2, bottom, 0.04], [w / 2, bottom + hgt, 0.04], [-w / 2, bottom + hgt, 0.04]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]])
  pole.box(-w / 2, bottom, 0, w / 2, bottom + hgt, 0.035)
  if (!noPost) for (const px of two ? [-w * 0.32, w * 0.32] : [0]) pole.box(px - 0.04, 0, -0.08, px + 0.04, bottom + hgt * 0.85, 0)
  pole.transform(null)
  face0.transform(null)
  if (!noPost) sink.addStaticCylinder(x, y + bottom / 2, z, bottom / 2, two ? w * 0.4 : 0.06)
}

function signMaterial(mats: Mats, name: string, canvas: HTMLCanvasElement): Material {
  const m = mats.plain(name, { gloss: 0.15 }) as PBRMaterial
  m.albedoTexture = mats.canvasTexture(name, canvas)
  return m
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

/** WEST 23 / NORTH 22 / EAST 23 with their arrows, as on the assembly in front of the falls. */
function routeAssembly(): HTMLCanvasElement {
  const [c, g] = canvasOf(768, 512)
  g.fillStyle = '#5c5f62'
  g.fillRect(0, 0, 768, 512)
  const cols: [string, string, string][] = [['WEST', '23', 'left'], ['NORTH', '22', 'right'], ['EAST', '23', 'right']]
  cols.forEach(([dir, num, arrow], i) => {
    const x = 12 + i * 252
    plaque(g, x, 10, 240, 86)
    g.fillStyle = '#111'
    g.font = 'bold 62px Arial, Helvetica, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(dir, x + 120, 56)
    plaque(g, x, 104, 240, 240)
    g.fillStyle = '#111'
    g.fillRect(x + 14, 118, 212, 212)
    g.fillStyle = '#fff'
    g.fillRect(x + 22, 126, 196, 196)
    g.fillStyle = '#111'
    g.font = 'bold 150px Arial, Helvetica, sans-serif'
    g.fillText(num, x + 120, 232)
    plaque(g, x, 352, 240, 150)
    drawArrow(g, x + 120, 427, arrow === 'left' ? -1 : 1)
  })
  return c
}

function plaque(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#fff'
  g.fillRect(x, y, w, h)
  g.strokeStyle = '#111'
  g.lineWidth = 6
  g.strokeRect(x + 7, y + 7, w - 14, h - 14)
}

function drawArrow(g: CanvasRenderingContext2D, cx: number, cy: number, dir: number): void {
  g.fillStyle = '#111'
  g.beginPath()
  g.moveTo(cx + dir * 80, cy)
  g.lineTo(cx + dir * 20, cy - 46)
  g.lineTo(cx + dir * 20, cy - 18)
  g.lineTo(cx - dir * 80, cy - 18)
  g.lineTo(cx - dir * 80, cy + 18)
  g.lineTo(cx + dir * 20, cy + 18)
  g.lineTo(cx + dir * 20, cy + 46)
  g.closePath()
  g.fill()
}

/** The keep-right sign: an arrow bending down and right past an island. */
function keepRight(): HTMLCanvasElement {
  const [c, g] = canvasOf(256, 320)
  g.fillStyle = '#5c5f62'
  g.fillRect(0, 0, 256, 320)
  g.fillStyle = '#fff'
  g.fillRect(8, 8, 240, 304)
  g.strokeStyle = '#111'
  g.lineWidth = 8
  g.strokeRect(18, 18, 220, 284)
  g.fillStyle = '#111'
  g.beginPath()
  g.ellipse(96, 200, 26, 44, 0, 0, Math.PI * 2)
  g.fill()
  g.lineWidth = 22
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(96, 70)
  g.bezierCurveTo(96, 120, 170, 120, 170, 180)
  g.lineTo(170, 230)
  g.stroke()
  g.beginPath()
  g.moveTo(140, 220)
  g.lineTo(200, 220)
  g.lineTo(170, 268)
  g.closePath()
  g.fill()
  return c
}

/** A yellow object marker (the diamond under the keep-right sign). */
function objectMarker(): HTMLCanvasElement {
  const [c, g] = canvasOf(256, 256)
  g.fillStyle = '#5c5f62'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#f3c514'
  g.beginPath()
  g.moveTo(128, 6)
  g.lineTo(250, 128)
  g.lineTo(128, 250)
  g.lineTo(6, 128)
  g.closePath()
  g.fill()
  g.fillStyle = '#ffe680'
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    g.beginPath()
    g.arc(128 + i * 40, 128 + j * 40, 12, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

/** The yellow two-way arrow facing Main Street across the junction. */
function twoWayArrow(): HTMLCanvasElement {
  const [c, g] = canvasOf(256, 256)
  g.fillStyle = '#5c5f62'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#f3c514'
  g.beginPath()
  g.moveTo(128, 4)
  g.lineTo(252, 128)
  g.lineTo(128, 252)
  g.lineTo(4, 128)
  g.closePath()
  g.fill()
  g.strokeStyle = '#111'
  g.lineWidth = 6
  g.beginPath()
  g.moveTo(128, 18)
  g.lineTo(238, 128)
  g.lineTo(128, 238)
  g.lineTo(18, 128)
  g.closePath()
  g.stroke()
  g.fillStyle = '#111'
  g.beginPath()
  g.moveTo(44, 128)
  g.lineTo(92, 88)
  g.lineTo(92, 114)
  g.lineTo(164, 114)
  g.lineTo(164, 88)
  g.lineTo(212, 128)
  g.lineTo(164, 168)
  g.lineTo(164, 142)
  g.lineTo(92, 142)
  g.lineTo(92, 168)
  g.closePath()
  g.fill()
  return c
}

/** The green guide sign on Main Street: Oxford to the left, Princeton and Wautoma to the right. */
function guideSign(): HTMLCanvasElement {
  const [c, g] = canvasOf(512, 268)
  g.fillStyle = '#0f6a3c'
  g.fillRect(0, 0, 512, 268)
  g.strokeStyle = '#f4f4f0'
  g.lineWidth = 6
  g.strokeRect(9, 9, 494, 250)
  g.fillStyle = '#f4f4f0'
  g.font = 'bold 64px Arial, Helvetica, sans-serif'
  g.textBaseline = 'middle'
  g.textAlign = 'left'
  g.fillText('Oxford', 150, 66)
  g.fillText('Princeton', 40, 150)
  g.fillText('Wautoma', 40, 222)
  arrowSmall(g, 92, 66, -1)
  arrowSmall(g, 430, 186, 1)
  return c
}

function arrowSmall(g: CanvasRenderingContext2D, cx: number, cy: number, dir: number): void {
  g.fillStyle = '#f4f4f0'
  g.beginPath()
  g.moveTo(cx + dir * 46, cy)
  g.lineTo(cx + dir * 8, cy - 28)
  g.lineTo(cx + dir * 8, cy - 11)
  g.lineTo(cx - dir * 46, cy - 11)
  g.lineTo(cx - dir * 46, cy + 11)
  g.lineTo(cx + dir * 8, cy + 11)
  g.lineTo(cx + dir * 8, cy + 28)
  g.closePath()
  g.fill()
}

// ---------------------------------------------------------------- bridge parapets

/** Tan stone parapets with an iron railing along both edges of each town bridge, and a pier at every end. */
function parapets(kit: Kit, land: TelloLand): void {
  for (const b of land.doc.bridges) {
    if (!b.s) continue
    const half = b.w / 2 + 0.9
    for (const side of [1, -1]) {
      const edge = offsetLine(b.p, side * (half - PARAPET_T))
      for (let k = 0; k + 3 < edge.length; k += 2) {
        const ax = edge[k], az = edge[k + 1], bx = edge[k + 2], bz = edge[k + 3]
        const len = Math.hypot(bx - ax, bz - az)
        const mx = (ax + bx) / 2, mz = (az + bz) / 2
        const yaw = -Math.atan2(-(bz - az), bx - ax)
        const stone = kit.chunks.get(mx, -mz, kit.M.stone, { colors: true })
        const iron = kit.chunks.get(mx, -mz, kit.M.iron)
        stone.orientedBox(mx, b.y + 0.375 - 0.3, -mz, len / 2, 0.375 + 0.3, PARAPET_T, yaw, { color: hexRGB(0xb9a888) })
        stone.orientedBox(mx, b.y + 0.79, -mz, len / 2 + 0.02, 0.04, PARAPET_T + 0.04, yaw, { color: hexRGB(0xc9bca2) })
        const tx = (bx - ax) / len, tz = (bz - az) / len
        for (const rail of [PARAPET_H - 0.04, 1.0]) iron.orientedBox(mx, b.y + rail, -mz, len / 2, 0.025, 0.03, yaw)
        for (let s = 0; s <= len; s += 1.9) iron.box(ax + tx * s - 0.03, b.y + 0.83, -(az + tz * s) - 0.03, ax + tx * s + 0.03, b.y + PARAPET_H, -(az + tz * s) + 0.03)
        for (let s = 0.16; s < len; s += 0.16) iron.box(ax + tx * s - 0.01, b.y + 0.83, -(az + tz * s) - 0.01, ax + tx * s + 0.01, b.y + PARAPET_H - 0.04, -(az + tz * s) + 0.01)
        for (const [px, pz] of [[ax, az], [bx, bz]]) stone.box(px - 0.32, b.y - 0.4, -pz - 0.32, px + 0.32, b.y + 1.3, -pz + 0.32, { color: hexRGB(0xb3a283) })
      }
    }
  }
}
