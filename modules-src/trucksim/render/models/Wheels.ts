/**
 * Truck wheels: 11R22.5-style tyres (sidewalls, shoulder lugs and tread grooves), ten-hand-hole disc rims, hubs with ten lug
 * nuts, the steer axle's chrome hub caps and steering knuckles, and duals on dual axles. Every wheel position has its own pair
 * of nodes (`knuckle` takes position and steer, `hub` the spin) that follow the pose, while the drawing is done by one
 * thin-instanced mesh per part for the whole truck, so even a five-axle truck costs six draw calls for its wheels. Instance
 * matrices are written in place on every update with no allocation. Lift axles are drawn raised when the pose says `lifted`.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Material } from '@babylonjs/core/Materials/material'
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { TruckModel, WheelOption } from '../../shared/Catalog'
import type { WheelPose } from '../../sim/types'
import type { MaterialLibrary } from '../Materials'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { PartBatch } from './truck/Batch'
import { at, boxAt, cylinder, latheHardX, latheX, ringSection, type P2 } from './truck/Geometry'

/** Tyre section width (m). */
export const TIRE_WIDTH = 0.28
/** Centre-to-centre spacing of a dual pair (m). */
export const DUAL_SPACING = 0.33
/** How far a lifted axle is drawn above its rest height (m). */
export const LIFT_RAISE = 0.24

const RIM_RADIUS = 0.286
const DISC_X = -0.14
const BOLT_CIRCLE = 0.143

/** One wheel position of the truck. */
export interface WheelSlot {
  axle: number
  /** +1 on the driver's (left, +X) side, -1 on the right. */
  side: 1 | -1
  steer: boolean
  drive: boolean
  dual: boolean
  lift: boolean
  radius: number
  /** Hub centre at rest (vehicle frame). */
  rest: Vector3
  /** Position and steer of the wheel; its local +X points outboard. */
  knuckle: TransformNode
  /** Child of the knuckle that carries the spin. */
  hub: TransformNode
  /** Hub centre now (vehicle frame), after lift handling. */
  current: Vector3
  steerAngle: number
  spin: number
}

/** All wheels of one truck. */
export interface WheelSet {
  slots: WheelSlot[]
  meshes: Mesh[]
  /** Follows the pose. Pose wheels are matched to slots by side and nearest axle once, then by index. */
  update(wheels: readonly WheelPose[]): void
  /** Swaps rim, hub and cap materials for a wheel option. */
  setFinish(option: WheelOption): void
  dispose(): void
}

interface Instance {
  slot: number
  dx: number
  flip: boolean
  spins: boolean
}

interface Part {
  mesh: Mesh
  buffer: Float32Array
  instances: Instance[]
}

function tireProfile(radius: number): P2[] {
  const hw = TIRE_WIDTH / 2
  const rr = RIM_RADIUS
  const out: P2[] = [
    [rr + 0.004, -hw * 0.75],
    [rr + 0.035, -hw * 0.9],
    [rr + 0.09, -hw * 0.98],
    [radius - 0.11, -hw],
    [radius - 0.055, -hw * 0.97],
    [radius - 0.022, -hw * 0.9],
    [radius - 0.006, -hw * 0.8],
  ]
  for (const g of [-0.07, -0.025, 0.025, 0.07]) {
    out.push([radius, g - 0.016], [radius, g - 0.008], [radius - 0.013, g - 0.005], [radius - 0.013, g + 0.005], [radius, g + 0.008])
  }
  out.push(
    [radius, hw * 0.78],
    [radius - 0.006, hw * 0.8],
    [radius - 0.022, hw * 0.9],
    [radius - 0.055, hw * 0.97],
    [radius - 0.11, hw],
    [rr + 0.09, hw * 0.98],
    [rr + 0.035, hw * 0.9],
    [rr + 0.004, hw * 0.75],
    [rr - 0.004, hw * 0.6],
    [rr - 0.004, -hw * 0.6],
  )
  return out
}

function tireParts(radius: number): VertexData[] {
  const parts: VertexData[] = [latheX(tireProfile(radius), 36, { closed: true })]
  const lugs = 26
  const hw = TIRE_WIDTH / 2
  for (let k = 0; k < lugs; k++) {
    for (const side of [-1, 1]) {
      const angle = (Math.PI * 2 * k) / lugs + (side > 0 ? Math.PI / lugs : 0)
      const lug = boxAt(-0.022, 0.022, -0.013, 0.013, -0.032, 0.032)
      at(lug, side * hw * 0.84, radius - 0.016, 0)
      at(lug, 0, 0, 0, angle)
      parts.push(lug)
    }
  }
  return parts
}

function rimParts(): VertexData[] {
  const rr = RIM_RADIUS
  const barrel: P2[] = [
    [rr + 0.018, 0.108], [rr + 0.018, 0.098], [rr + 0.002, 0.092], [rr - 0.002, 0.06], [rr - 0.026, 0.035], [rr - 0.026, -0.04],
    [rr - 0.002, -0.06], [rr + 0.002, -0.092], [rr + 0.018, -0.098], [rr + 0.018, -0.108], [rr + 0.006, -0.108], [rr - 0.01, -0.094],
    [rr - 0.014, -0.062], [rr - 0.038, -0.04], [rr - 0.038, 0.035], [rr - 0.014, 0.06], [rr - 0.01, 0.094], [rr + 0.006, 0.108],
  ]
  const parts: VertexData[] = [latheX(barrel, 36, { closed: true })]
  parts.push(latheHardX(ringSection(0.112, 0.174, DISC_X - 0.007, DISC_X + 0.007, 0.003), 36))
  const outer: P2[] = [[0.226, DISC_X - 0.004], [rr - 0.036, -0.052], [rr - 0.036, -0.036], [0.226, DISC_X + 0.01]]
  parts.push(latheHardX(outer, 40))
  for (let k = 0; k < 10; k++) {
    const spoke = boxAt(-0.006, 0.006, 0.168, 0.232, -0.024, 0.024)
    at(spoke, DISC_X + 0.002, 0, 0, (Math.PI * 2 * (k + 0.5)) / 10)
    parts.push(spoke)
  }
  return parts
}

function lugNuts(x: number, count: number, circle: number, size: number): VertexData[] {
  const parts: VertexData[] = []
  for (let k = 0; k < count; k++) {
    const a = (Math.PI * 2 * k) / count
    const nut = cylinder(size, size, size * 0.9, 6, 'x')
    at(nut, x + size * 0.45, Math.cos(a) * circle, Math.sin(a) * circle)
    parts.push(nut)
    const washer = cylinder(size * 1.35, size * 1.35, 0.005, 10, 'x')
    at(washer, x + 0.0025, Math.cos(a) * circle, Math.sin(a) * circle)
    parts.push(washer)
  }
  return parts
}

function steerHubParts(): VertexData[] {
  const face = DISC_X + 0.007
  const body: P2[] = [[0.0005, face + 0.15], [0.05, face + 0.15], [0.07, face + 0.142], [0.085, face + 0.13], [0.1, face + 0.11], [0.104, face + 0.02], [0.112, face + 0.012], [0.112, face - 0.02]]
  return [latheX(body, 28, { capEnd: true }), ...lugNuts(face, 10, BOLT_CIRCLE, 0.033)]
}

function driveHubParts(): VertexData[] {
  const face = DISC_X + 0.007
  const body: P2[] = [[0.0005, face + 0.16], [0.03, face + 0.16], [0.032, face + 0.145], [0.098, face + 0.145], [0.1, face + 0.13], [0.118, face + 0.12], [0.122, face + 0.02], [0.128, face + 0.012], [0.128, face - 0.02]]
  return [latheX(body, 28, { capEnd: true }), ...lugNuts(face, 10, BOLT_CIRCLE, 0.033), ...lugNuts(face + 0.145, 8, 0.072, 0.024)]
}

function capParts(): VertexData[] {
  const base = DISC_X + 0.007 + 0.1
  const dome: P2[] = [[0.114, base - 0.005], [0.116, base + 0.012], [0.108, base + 0.035], [0.092, base + 0.06], [0.068, base + 0.08], [0.04, base + 0.092], [0.0005, base + 0.097]]
  return [latheX(dome, 32, { capStart: true }), at(cylinder(0.05, 0.05, 0.01, 16, 'x'), base + 0.098, 0, 0)]
}

function knuckleParts(): VertexData[] {
  return [
    at(cylinder(0.42, 0.42, 0.16, 24, 'x'), -0.24, 0, 0),
    at(cylinder(0.45, 0.45, 0.012, 24, 'x'), -0.33, 0, 0),
    at(cylinder(0.09, 0.09, 0.32, 12), -0.38, 0, 0),
    boxAt(-0.4, -0.34, -0.035, 0.035, -0.32, 0.02),
    at(cylinder(0.16, 0.16, 0.12, 16, 'z'), -0.42, 0.14, -0.16),
  ]
}

function rimMaterial(mats: MaterialLibrary, option: WheelOption): Material {
  return mats.get(option === 'polished' ? 'chrome' : option === 'black' ? 'satinBlack' : 'steel')
}

function hubMaterial(mats: MaterialLibrary, option: WheelOption): Material {
  return mats.get(option === 'polished' ? 'chrome' : option === 'black' ? 'satinBlack' : 'steel')
}

function capMaterial(mats: MaterialLibrary, option: WheelOption): Material {
  return mats.get(option === 'black' ? 'satinBlack' : 'chrome')
}

function writeMatrix(buffer: Float32Array, offset: number, slot: WheelSlot, instance: Instance): void {
  const sideFlip = slot.side < 0 ? 1 : 0
  const flips = sideFlip + (instance.flip ? 1 : 0)
  const baseYaw = slot.steerAngle + sideFlip * Math.PI
  const yaw = baseYaw + (instance.flip ? Math.PI : 0)
  const spin = instance.spins ? (flips % 2 === 1 ? -slot.spin : slot.spin) : 0
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cs = Math.cos(spin)
  const ss = Math.sin(spin)
  const p = slot.current
  buffer[offset] = cy
  buffer[offset + 1] = 0
  buffer[offset + 2] = -sy
  buffer[offset + 3] = 0
  buffer[offset + 4] = ss * sy
  buffer[offset + 5] = cs
  buffer[offset + 6] = ss * cy
  buffer[offset + 7] = 0
  buffer[offset + 8] = cs * sy
  buffer[offset + 9] = -ss
  buffer[offset + 10] = cs * cy
  buffer[offset + 11] = 0
  buffer[offset + 12] = p.x + instance.dx * Math.cos(baseYaw)
  buffer[offset + 13] = p.y
  buffer[offset + 14] = p.z - instance.dx * Math.sin(baseYaw)
  buffer[offset + 15] = 1
}

class TruckWheels implements WheelSet {
  readonly slots: WheelSlot[] = []
  readonly meshes: Mesh[] = []
  private readonly parts: Part[] = []
  private rim: Mesh | null = null
  private hubs: Mesh[] = []
  private cap: Mesh | null = null
  private mapping = new Int16Array(0)
  private mappedCount = -1

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode,
    model: TruckModel,
    private readonly mats: MaterialLibrary,
    private readonly name: string,
    option: WheelOption,
  ) {
    model.axles.forEach((axle, index) => {
      for (const side of [1, -1] as const) {
        const rest = new Vector3((side * model.track) / 2, model.wheelRadius, axle.z)
        const knuckle = new TransformNode(`${name}-wheel-${index}-${side > 0 ? 'l' : 'r'}`, scene)
        knuckle.parent = parent
        knuckle.position.copyFrom(rest)
        knuckle.rotation.y = side < 0 ? Math.PI : 0
        const hub = new TransformNode(`${knuckle.name}-hub`, scene)
        hub.parent = knuckle
        this.slots.push({
          axle: index, side, steer: axle.steer, drive: axle.drive, dual: axle.dual, lift: !!axle.lift, radius: model.wheelRadius,
          rest, knuckle, hub, current: rest.clone(), steerAngle: 0, spin: 0,
        })
      }
    })
    const tire: Instance[] = []
    const rim: Instance[] = []
    const steerHub: Instance[] = []
    const driveHub: Instance[] = []
    const cap: Instance[] = []
    const knuckle: Instance[] = []
    const half = DUAL_SPACING / 2
    this.slots.forEach((slot, index) => {
      if (slot.dual) {
        tire.push({ slot: index, dx: half, flip: false, spins: true }, { slot: index, dx: -half, flip: true, spins: true })
        rim.push({ slot: index, dx: half, flip: false, spins: true }, { slot: index, dx: -half, flip: true, spins: true })
        ;(slot.drive ? driveHub : steerHub).push({ slot: index, dx: half, flip: false, spins: true })
      } else {
        tire.push({ slot: index, dx: 0, flip: false, spins: true })
        rim.push({ slot: index, dx: 0, flip: false, spins: true })
        ;(slot.drive ? driveHub : steerHub).push({ slot: index, dx: 0, flip: false, spins: true })
      }
      if (slot.steer) {
        cap.push({ slot: index, dx: 0, flip: false, spins: true })
        knuckle.push({ slot: index, dx: 0, flip: false, spins: false })
      }
    })
    this.addPart('tire', tireParts(model.wheelRadius), mats.get('rubber'), tire)
    this.rim = this.addPart('rim', rimParts(), rimMaterial(mats, option), rim)
    const steerHubMesh = this.addPart('hub', steerHubParts(), hubMaterial(mats, option), steerHub)
    const driveHubMesh = this.addPart('drivehub', driveHubParts(), hubMaterial(mats, option), driveHub)
    this.hubs = [steerHubMesh, driveHubMesh].filter((mesh): mesh is Mesh => mesh !== null)
    this.cap = this.addPart('cap', capParts(), capMaterial(mats, option), cap)
    this.addPart('knuckle', knuckleParts(), mats.get('darkSteel'), knuckle)
  }

  private addPart(part: string, geometry: VertexData[], material: Material, instances: Instance[]): Mesh | null {
    if (instances.length === 0) return null
    const batch = new PartBatch()
    batch.addAll('wheel', geometry)
    const built = batch.build(this.scene, `${this.name}-${part}`, this.parent, () => material)
    const mesh = built[0].mesh
    const buffer = new Float32Array(instances.length * 16)
    const record: Part = { mesh, buffer, instances }
    this.write(record)
    mesh.thinInstanceSetBuffer('matrix', buffer, 16, false)
    const info = mesh.getBoundingInfo()
    const min = info.minimum.clone()
    const max = info.maximum.clone()
    min.x -= 0.15
    min.y -= 0.1
    min.z -= 0.15
    max.x += 0.15
    max.y += LIFT_RAISE + 0.15
    max.z += 0.15
    info.reConstruct(min, max)
    this.parts.push(record)
    this.meshes.push(mesh)
    return mesh
  }

  private write(part: Part): void {
    const { buffer, instances } = part
    for (let i = 0; i < instances.length; i++) writeMatrix(buffer, i * 16, this.slots[instances[i].slot], instances[i])
  }

  private remap(wheels: readonly WheelPose[]): void {
    this.mapping = new Int16Array(wheels.length).fill(-1)
    const taken = new Uint8Array(this.slots.length)
    for (let j = 0; j < wheels.length; j++) {
      const wheel = wheels[j]
      const side = wheel.x >= 0 ? 1 : -1
      let best = -1
      let bestDistance = Infinity
      for (let i = 0; i < this.slots.length; i++) {
        if (taken[i] || this.slots[i].side !== side) continue
        const distance = Math.abs(this.slots[i].rest.z - wheel.z)
        if (distance < bestDistance) {
          bestDistance = distance
          best = i
        }
      }
      if (best >= 0) {
        taken[best] = 1
        this.mapping[j] = best
      }
    }
    this.mappedCount = wheels.length
  }

  update(wheels: readonly WheelPose[]): void {
    if (wheels.length !== this.mappedCount) this.remap(wheels)
    for (let j = 0; j < wheels.length; j++) {
      const index = this.mapping[j]
      if (index < 0) continue
      const wheel = wheels[j]
      const slot = this.slots[index]
      const y = slot.lift && wheel.lifted ? Math.max(wheel.y, slot.rest.y + LIFT_RAISE) : wheel.y
      slot.current.set(wheel.x, y, wheel.z)
      slot.steerAngle = wheel.steer
      slot.spin = wheel.spin
      slot.knuckle.position.copyFrom(slot.current)
      slot.knuckle.rotation.y = wheel.steer + (slot.side < 0 ? Math.PI : 0)
      slot.hub.rotation.x = slot.side < 0 ? -wheel.spin : wheel.spin
    }
    for (let p = 0; p < this.parts.length; p++) {
      const part = this.parts[p]
      this.write(part)
      part.mesh.thinInstanceBufferUpdated('matrix')
    }
  }

  setFinish(option: WheelOption): void {
    if (this.rim) this.rim.material = rimMaterial(this.mats, option)
    for (const hub of this.hubs) hub.material = hubMaterial(this.mats, option)
    if (this.cap) this.cap.material = capMaterial(this.mats, option)
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose(false, false)
    for (const slot of this.slots) slot.knuckle.dispose(false, false)
    this.meshes.length = 0
    this.parts.length = 0
    this.slots.length = 0
  }
}

/** Builds the wheels of a truck model under `parent` (the truck root), at rest. */
export function buildWheels(scene: Scene, parent: TransformNode, model: TruckModel, option: WheelOption, mats: MaterialLibrary, name: string): WheelSet {
  return new TruckWheels(scene, parent, model, mats, name, option)
}
