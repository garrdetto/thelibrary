/**
 * Draws an airport from its `AirportSpec`: asphalt runways, taxiways and aprons laid just above the flattened ground; runway
 * markings built as geometry (threshold bars, designators, centreline, aiming point and touchdown-zone bars, edge stripes) so they
 * stay crisp at any distance; yellow taxiway centrelines and hold-short bars; edge, threshold and end lights as thin instances
 * that brighten at dusk; four-box PAPI units at each runway end whose red and white follow the viewer's glidepath angle; a
 * windsock that swings with the wind; and hangars, an office and a control tower. Everything is static and frozen except the
 * PAPI boxes, the lights' intensity and the windsock. Pavement and markings are matte: no gloss, no specular.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { AirportSpec, RunwaySpec } from '../shared/Airports'
import { runwayCoordinates, runwayFrame } from '../shared/Airports'
import { DEG } from '../sim/SimMath'

const PAVE_LIFT = 0.04
const MARK_LIFT = 0.07
const EDGE_LIGHT_SPACING = 60

/** Rectangles of a stencil digit on a 3 × 5 grid (x, y, w, h in cells, y up). */
const DIGITS: Record<string, [number, number, number, number][]> = {
  '0': [[0, 0, 3, 1], [0, 4, 3, 1], [0, 0, 1, 5], [2, 0, 1, 5]],
  '1': [[1, 0, 1, 5], [0, 3.6, 1, 0.9]],
  '2': [[0, 4, 3, 1], [2, 2, 1, 3], [0, 2, 3, 1], [0, 0, 1, 3], [0, 0, 3, 1]],
  '3': [[0, 4, 3, 1], [0, 2, 3, 1], [0, 0, 3, 1], [2, 0, 1, 5]],
  '4': [[0, 2, 1, 3], [0, 2, 3, 1], [2, 0, 1, 5]],
  '5': [[0, 4, 3, 1], [0, 2, 1, 3], [0, 2, 3, 1], [2, 0, 1, 3], [0, 0, 3, 1]],
  '6': [[0, 4, 3, 1], [0, 0, 1, 5], [0, 2, 3, 1], [2, 0, 1, 3], [0, 0, 3, 1]],
  '7': [[0, 4, 3, 1], [2, 0, 1, 5]],
  '8': [[0, 0, 3, 1], [0, 2, 3, 1], [0, 4, 3, 1], [0, 0, 1, 5], [2, 0, 1, 5]],
  '9': [[0, 4, 3, 1], [0, 2, 1, 3], [0, 2, 3, 1], [2, 0, 1, 5], [0, 0, 3, 1]],
  L: [[0, 0, 1, 5], [0, 0, 3, 1]],
  R: [[0, 0, 1, 5], [0, 4, 3, 1], [2, 2.5, 1, 2], [0, 2, 3, 1], [2, 0, 1, 2]],
  C: [[0, 0, 1, 5], [0, 4, 3, 1], [0, 0, 3, 1]],
}

/** Accumulates flat quads in world space into one mesh. */
class QuadBatch {
  readonly positions: number[] = []
  readonly indices: number[] = []
  readonly uvs: number[] = []

  /** A rectangle in a runway-like frame: origin (ox, oz), along unit (dx, dz), from `a0` to `a1` along and `c0` to `c1` across (right positive). */
  rect(ox: number, oz: number, dx: number, dz: number, a0: number, a1: number, c0: number, c1: number, y: number): void {
    const rx = -dz
    const rz = dx
    const base = this.positions.length / 3
    const corners: [number, number][] = [[a0, c0], [a1, c0], [a1, c1], [a0, c1]]
    for (const [a, c] of corners) {
      this.positions.push(ox + dx * a + rx * c, y, oz + dz * a + rz * c)
      this.uvs.push((ox + dx * a + rx * c) / 20, (oz + dz * a + rz * c) / 20)
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  segment(ax: number, az: number, bx: number, bz: number, width: number, y: number, extend = 0): void {
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1e-6) return
    const dx = (bx - ax) / length
    const dz = (bz - az) / length
    this.rect(ax, az, dx, dz, -extend, length + extend, -width / 2, width / 2, y)
  }

  build(name: string, scene: Scene, material: PBRMaterial | StandardMaterial, parent: TransformNode): Mesh | null {
    if (this.indices.length === 0) return null
    const mesh = new Mesh(name, scene)
    const data = new VertexData()
    data.positions = this.positions
    data.indices = this.indices
    data.uvs = this.uvs
    const normals: number[] = []
    VertexData.ComputeNormals(this.positions, this.indices, normals)
    data.normals = normals
    data.applyToMesh(mesh, false)
    mesh.material = material
    mesh.parent = parent
    mesh.isPickable = false
    mesh.receiveShadows = true
    mesh.freezeWorldMatrix()
    return mesh
  }
}

function matte(name: string, scene: Scene, color: Color3): PBRMaterial {
  const material = new PBRMaterial(name, scene)
  material.albedoColor = color
  material.metallic = 0
  material.roughness = 1
  material.metallicF0Factor = 0
  material.environmentIntensity = 0.6
  return material
}

function lamp(name: string, scene: Scene, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene)
  material.disableLighting = true
  material.emissiveColor = color.clone()
  material.diffuseColor = Color3.Black()
  material.specularColor = Color3.Black()
  return material
}

interface PapiUnit {
  mesh: Mesh
  material: StandardMaterial
  x: number
  y: number
  z: number
  /** Glidepath angle, degrees, above which this box shows white. */
  threshold: number
}

export class AirportRenderer {
  readonly root: TransformNode
  private readonly materials: (PBRMaterial | StandardMaterial)[] = []
  private readonly lampMaterials: { material: StandardMaterial; color: Color3 }[] = []
  private readonly papi: PapiUnit[] = []
  private readonly windsock: TransformNode
  private readonly sock: Mesh
  private readonly red = new Color3(4, 0.15, 0.1)
  private readonly white = new Color3(4, 3.8, 3.4)
  private readonly coords = { along: 0, cross: 0 }

  constructor(private readonly scene: Scene, readonly airport: AirportSpec, parent: TransformNode | null = null) {
    this.root = new TransformNode(`takeflight-airport-${airport.id}`, scene)
    this.root.parent = parent
    const asphalt = this.track(matte('takeflight-asphalt', scene, new Color3(0.085, 0.087, 0.09)))
    const concrete = this.track(matte('takeflight-apron', scene, new Color3(0.2, 0.2, 0.19)))
    const white = this.track(matte('takeflight-marking-white', scene, new Color3(0.78, 0.78, 0.76)))
    const yellow = this.track(matte('takeflight-marking-yellow', scene, new Color3(0.75, 0.55, 0.06)))
    const y0 = airport.elevation
    const pave = new QuadBatch()
    const apron = new QuadBatch()
    const marks = new QuadBatch()
    const taxiMarks = new QuadBatch()
    for (const runway of airport.runways) this.layRunway(runway, y0, pave, marks)
    for (const taxiway of airport.taxiways) {
      for (let i = 1; i < taxiway.points.length; i++) {
        const [ax, az] = taxiway.points[i - 1]
        const [bx, bz] = taxiway.points[i]
        pave.segment(ax, az, bx, bz, taxiway.width, y0 + PAVE_LIFT - 0.005, taxiway.width / 2)
        taxiMarks.segment(ax, az, bx, bz, 0.3, y0 + MARK_LIFT)
      }
    }
    for (const area of airport.aprons) apron.rect(area.x0, area.z0, 1, 0, 0, area.x1 - area.x0, 0, area.z1 - area.z0, y0 + PAVE_LIFT - 0.01)
    for (const runway of airport.runways) this.holdShort(runway, airport, y0, taxiMarks)
    pave.build('takeflight-pavement', scene, asphalt, this.root)
    apron.build('takeflight-apron', scene, concrete, this.root)
    marks.build('takeflight-runway-marks', scene, white, this.root)
    taxiMarks.build('takeflight-taxi-marks', scene, yellow, this.root)
    for (const material of [asphalt, concrete, white, yellow]) material.zOffset = -1
    this.buildLights(y0)
    this.buildBuildings(y0)
    const sock = this.buildWindsock(y0)
    this.windsock = sock.pivot
    this.sock = sock.sock
  }

  private track<T extends PBRMaterial | StandardMaterial>(material: T): T {
    this.materials.push(material)
    return material
  }

  private layRunway(runway: RunwaySpec, y0: number, pave: QuadBatch, marks: QuadBatch): void {
    const frame = runwayFrame(runway)
    const { dx, dz, x0, z0 } = frame
    const length = runway.length
    const half = runway.width / 2
    const y = y0 + PAVE_LIFT
    const ym = y0 + MARK_LIFT
    pave.rect(x0, z0, dx, dz, -6, length + 6, -half - 1.5, half + 1.5, y)
    marks.rect(x0, z0, dx, dz, 0, length, -half + 0.2, -half + 1.1, ym)
    marks.rect(x0, z0, dx, dz, 0, length, half - 1.1, half - 0.2, ym)
    for (let end = 0; end < 2; end++) {
      const sx = end === 0 ? x0 : x0 + dx * length
      const sz = end === 0 ? z0 : z0 + dz * length
      const ux = end === 0 ? dx : -dx
      const uz = end === 0 ? dz : -dz
      const stripes = runway.width >= 45 ? 12 : runway.width >= 30 ? 8 : 6
      const stripeWidth = 1.8
      const gap = (runway.width - 6 - stripes * stripeWidth) / (stripes - 1 + 2)
      let c = -half + 3
      for (let s = 0; s < stripes; s++) {
        if (s === stripes / 2) c += gap * 2
        marks.rect(sx, sz, ux, uz, 6, 36, c, c + stripeWidth, ym)
        c += stripeWidth + gap
      }
      marks.rect(sx, sz, ux, uz, 2, 5, -half + 0.2, half - 0.2, ym)
      this.designator(runway.ends[end], sx, sz, ux, uz, 48, ym, marks)
      const aim = length >= 1500 ? 400 : 250
      marks.rect(sx, sz, ux, uz, aim, aim + 45, -half / 2 - 4, -half / 2 + 2, ym)
      marks.rect(sx, sz, ux, uz, aim, aim + 45, half / 2 - 2, half / 2 + 4, ym)
      for (const at of [150, 450, 600]) {
        if (at + 22 > length / 2 || Math.abs(at - aim) < 60) continue
        const bars = at === 150 ? 3 : at === 450 ? 2 : 1
        for (let b = 0; b < bars; b++) {
          const off = 3 + b * 2.6
          marks.rect(sx, sz, ux, uz, at, at + 22, -off - 1.8, -off, ym)
          marks.rect(sx, sz, ux, uz, at, at + 22, off, off + 1.8, ym)
        }
      }
    }
    for (let a = 80; a < length - 80; a += 60) marks.rect(x0, z0, dx, dz, a, a + 36, -0.45, 0.45, ym)
  }

  private designator(text: string, sx: number, sz: number, ux: number, uz: number, from: number, y: number, marks: QuadBatch): void {
    const cell = 3.6
    const height = cell * 5
    const charWidth = cell * 3
    const space = cell * 1.2
    const digits = text.replace(/^0/, '0').split('')
    const total = digits.length * charWidth + (digits.length - 1) * space
    let left = -total / 2
    for (const ch of digits) {
      const glyph = DIGITS[ch]
      if (!glyph) continue
      for (const [gx, gy, gw, gh] of glyph) {
        const across0 = left + gx * cell
        const along1 = from + height - gy * cell
        marks.rect(sx, sz, ux, uz, along1 - gh * cell, along1, across0, across0 + gw * cell, y)
      }
      left += charWidth + space
    }
  }

  private holdShort(runway: RunwaySpec, airport: AirportSpec, y0: number, marks: QuadBatch): void {
    const frame = runwayFrame(runway)
    for (const taxiway of airport.taxiways) {
      const last = taxiway.points[taxiway.points.length - 1]
      const first = taxiway.points[0]
      for (const [point, other] of [[last, taxiway.points[taxiway.points.length - 2]], [first, taxiway.points[1]]] as const) {
        if (!other) continue
        const rx = point[0] - frame.x0
        const rz = point[1] - frame.z0
        const cross = rx * -frame.dz + rz * frame.dx
        if (Math.abs(cross) > 1) continue
        const lx = other[0] - point[0]
        const lz = other[1] - point[1]
        const length = Math.hypot(lx, lz)
        const ux = lx / length
        const uz = lz / length
        const at = runway.width / 2 + 22
        for (let k = 0; k < 4; k++) {
          const off = at + k * 0.9
          marks.rect(point[0], point[1], ux, uz, off, off + 0.3, -taxiway.width / 2, taxiway.width / 2, y0 + MARK_LIFT)
        }
      }
    }
  }

  private lampSet(name: string, color: Color3, size: number, points: number[]): void {
    if (points.length === 0) return
    const material = lamp(name, this.scene, color)
    this.track(material)
    this.lampMaterials.push({ material, color: color.clone() })
    const mesh = CreateSphere(name, { diameter: size, segments: 4 }, this.scene)
    mesh.material = material
    mesh.parent = this.root
    mesh.isPickable = false
    const matrices = new Float32Array((points.length / 3) * 16)
    for (let i = 0; i < points.length / 3; i++) {
      matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, points[i * 3], points[i * 3 + 1], points[i * 3 + 2], 1], i * 16)
    }
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, true)
    mesh.thinInstanceRefreshBoundingInfo(false)
  }

  private buildLights(y0: number): void {
    const edge: number[] = []
    const green: number[] = []
    const red: number[] = []
    const blue: number[] = []
    const y = y0 + 0.35
    for (const runway of this.airport.runways) {
      const { dx, dz, x0, z0 } = runwayFrame(runway)
      const rx = -dz
      const rz = dx
      const half = runway.width / 2 + 1.5
      for (let a = 0; a <= runway.length + 0.1; a += EDGE_LIGHT_SPACING) {
        edge.push(x0 + dx * a + rx * half, y, z0 + dz * a + rz * half, x0 + dx * a - rx * half, y, z0 + dz * a - rz * half)
      }
      for (let c = -half; c <= half + 0.1; c += 3) {
        green.push(x0 - dx * 1 + rx * c, y, z0 - dz * 1 + rz * c)
        red.push(x0 + dx * (runway.length + 1) + rx * c, y, z0 + dz * (runway.length + 1) + rz * c)
      }
      for (let end = 0; end < 2; end++) {
        const ux = end === 0 ? dx : -dx
        const uz = end === 0 ? dz : -dz
        const sx = end === 0 ? x0 : x0 + dx * runway.length
        const sz = end === 0 ? z0 : z0 + dz * runway.length
        const aim = runway.length >= 1500 ? 400 : 250
        const thresholds = [runway.glidepath + 0.5, runway.glidepath + 1 / 6, runway.glidepath - 1 / 6, runway.glidepath - 0.5]
        for (let k = 0; k < 4; k++) {
          const across = -(runway.width / 2 + 15 + k * 9)
          const px = sx + ux * (aim + 20) + -uz * across
          const pz = sz + uz * (aim + 20) + ux * across
          const material = lamp(`takeflight-papi-${end}-${k}`, this.scene, this.white)
          this.track(material)
          const box = CreateBox(`takeflight-papi-${end}-${k}`, { width: 1.2, height: 0.8, depth: 1.2 }, this.scene)
          box.position.set(px, y0 + 0.6, pz)
          box.material = material
          box.parent = this.root
          box.isPickable = false
          box.freezeWorldMatrix()
          this.papi.push({ mesh: box, material, x: px, y: y0 + 0.6, z: pz, threshold: thresholds[k] })
        }
      }
    }
    for (const taxiway of this.airport.taxiways) {
      for (let i = 1; i < taxiway.points.length; i++) {
        const [ax, az] = taxiway.points[i - 1]
        const [bx, bz] = taxiway.points[i]
        const length = Math.hypot(bx - ax, bz - az)
        const ux = (bx - ax) / length
        const uz = (bz - az) / length
        for (let a = 0; a <= length; a += 30) {
          const half = taxiway.width / 2 + 1
          const px = ax + ux * a
          const pz = az + uz * a
          if (this.onRunway(px, pz, 20)) continue
          blue.push(px - uz * half, y0 + 0.3, pz + ux * half, px + uz * half, y0 + 0.3, pz - ux * half)
        }
      }
    }
    this.lampSet('takeflight-edge-lights', new Color3(3, 2.8, 2.3), 0.45, edge)
    this.lampSet('takeflight-threshold-lights', new Color3(0.3, 3, 0.6), 0.45, green)
    this.lampSet('takeflight-end-lights', new Color3(3, 0.2, 0.15), 0.45, red)
    this.lampSet('takeflight-taxi-lights', new Color3(0.25, 0.5, 3), 0.35, blue)
  }

  private onRunway(x: number, z: number, margin: number): boolean {
    for (const runway of this.airport.runways) {
      runwayCoordinates(runway, x, z, this.coords)
      if (this.coords.along > -margin && this.coords.along < runway.length + margin && Math.abs(this.coords.cross) < runway.width / 2 + margin) return true
    }
    return false
  }

  private buildBuildings(y0: number): void {
    const wall = this.track(matte('takeflight-hangar-wall', this.scene, new Color3(0.42, 0.44, 0.46)))
    const roof = this.track(matte('takeflight-hangar-roof', this.scene, new Color3(0.22, 0.24, 0.26)))
    const brick = this.track(matte('takeflight-office', this.scene, new Color3(0.45, 0.28, 0.2)))
    const glass = new PBRMaterial('takeflight-tower-glass', this.scene)
    glass.albedoColor = new Color3(0.05, 0.08, 0.1)
    glass.metallic = 0
    glass.roughness = 0.08
    this.track(glass)
    const static_: Mesh[] = []
    const apron = this.airport.aprons[0]
    if (apron) {
      const runway = this.airport.runways[0]
      const h = runway.heading * DEG
      const px = Math.cos(h)
      const pz = Math.sin(h)
      const ax = (apron.x0 + apron.x1) / 2
      const az = (apron.z0 + apron.z1) / 2
      const side = (ax - runway.cx) * px + (az - runway.cz) * pz >= 0 ? 1 : -1
      const nx = px * side
      const nz = pz * side
      const extent = Math.abs(nx) * (apron.x1 - apron.x0) / 2 + Math.abs(nz) * (apron.z1 - apron.z0) / 2
      const ux = Math.sin(h)
      const uz = -Math.cos(h)
      const yaw = Math.atan2(-uz, ux)
      const place = (name: string, along: number, out: number): TransformNode => {
        const node = new TransformNode(name, this.scene)
        node.position.set(ax + ux * along + nx * out, y0, az + uz * along + nz * out)
        node.rotation.y = yaw
        node.parent = this.root
        return node
      }
      for (let i = 0; i < 3; i++) {
        const node = place(`takeflight-hangar-${i}`, (i - 1) * 46, extent + 22)
        const body = CreateBox(`takeflight-hangar-${i}`, { width: 38, height: 10, depth: 30 }, this.scene)
        body.position.set(0, 5, 0)
        body.material = wall
        body.parent = node
        const cap = CreateCylinder(`takeflight-hangar-roof-${i}`, { height: 38.4, diameter: 30.4, tessellation: 18, arc: 0.5 }, this.scene)
        cap.rotation.z = Math.PI / 2
        cap.rotation.x = Math.PI / 2
        cap.position.set(0, 10, 0)
        cap.scaling.set(1, 1, 0.35)
        cap.material = roof
        cap.parent = node
        static_.push(body, cap)
      }
      const officeNode = place('takeflight-office', 46 * 1.5 + 32, extent + 14)
      const office = CreateBox('takeflight-office', { width: 26, height: 7, depth: 14 }, this.scene)
      office.position.set(0, 3.5, 0)
      office.material = brick
      office.parent = officeNode
      static_.push(office)
    }
    const [tx, ty, tz] = this.airport.tower
    const shaft = CreateCylinder('takeflight-tower', { height: ty - y0 - 3, diameter: 4.5, tessellation: 12 }, this.scene)
    shaft.position.set(tx, y0 + (ty - y0 - 3) / 2, tz)
    shaft.material = wall
    const cab = CreateCylinder('takeflight-tower-cab', { height: 3.4, diameterTop: 8, diameterBottom: 6.5, tessellation: 8 }, this.scene)
    cab.position.set(tx, ty - 1.3, tz)
    cab.material = glass
    const lid = CreateCylinder('takeflight-tower-lid', { height: 0.6, diameter: 9, tessellation: 8 }, this.scene)
    lid.position.set(tx, ty + 0.7, tz)
    lid.material = roof
    static_.push(shaft, cab, lid)
    for (const mesh of static_) {
      if (!mesh.parent) mesh.parent = this.root
      mesh.isPickable = false
      mesh.receiveShadows = true
      mesh.freezeWorldMatrix()
    }
  }

  private buildWindsock(y0: number): { pivot: TransformNode; sock: Mesh } {
    const runway = this.airport.runways[0]
    const { dx, dz, x0, z0 } = runwayFrame(runway)
    const px = x0 + dx * 300 + dz * (runway.width / 2 + 40)
    const pz = z0 + dz * 300 - dx * (runway.width / 2 + 40)
    const metal = this.track(matte('takeflight-pole', this.scene, new Color3(0.5, 0.5, 0.5)))
    const pole = CreateCylinder('takeflight-windsock-pole', { height: 6, diameter: 0.15, tessellation: 6 }, this.scene)
    pole.position.set(px, y0 + 3, pz)
    pole.material = metal
    pole.parent = this.root
    pole.freezeWorldMatrix()
    const pivot = new TransformNode('takeflight-windsock', this.scene)
    pivot.parent = this.root
    pivot.position.set(px, y0 + 5.8, pz)
    pivot.rotationQuaternion = Quaternion.Identity()
    const cloth = this.track(matte('takeflight-windsock-cloth', this.scene, new Color3(0.85, 0.3, 0.05)))
    const sock = CreateCylinder('takeflight-windsock-cloth', { height: 3.6, diameterTop: 0.9, diameterBottom: 0.35, tessellation: 10, cap: 0 }, this.scene)
    sock.rotation.x = Math.PI / 2
    sock.position.z = 1.8
    sock.bakeCurrentTransformIntoVertices()
    sock.material = cloth
    cloth.backFaceCulling = false
    sock.parent = pivot
    sock.isPickable = false
    return { pivot, sock }
  }

  /**
   * Per frame: PAPI colours for a viewer at `eye`, windsock pointing downwind (wind blowing toward `windX`, `windZ` m/s), and lamp
   * brightness for `night` (0 day .. 1 dark).
   */
  update(eye: Vector3, windX: number, windZ: number, night: number): void {
    for (const unit of this.papi) {
      const hx = eye.x - unit.x
      const hz = eye.z - unit.z
      const angle = Math.atan2(eye.y - unit.y, Math.hypot(hx, hz)) / DEG
      unit.material.emissiveColor.copyFrom(angle > unit.threshold ? this.white : this.red)
    }
    const glow = 0.25 + 0.75 * night
    for (const entry of this.lampMaterials) entry.material.emissiveColor.copyFromFloats(entry.color.r * glow, entry.color.g * glow, entry.color.b * glow)
    const speed = Math.hypot(windX, windZ)
    const heading = Math.atan2(windX, windZ)
    const droop = Math.max(0, 1 - speed / 7.7) * (Math.PI / 2.2)
    const pivot = this.windsock.rotationQuaternion as Quaternion
    Quaternion.RotationYawPitchRollToRef(heading, droop, 0, pivot)
    this.sock.scaling.z = 0.6 + Math.min(1, speed / 7.7) * 0.4
  }

  dispose(): void {
    this.root.dispose(false, false)
    for (const material of this.materials) material.dispose()
  }
}
