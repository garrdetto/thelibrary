/**
 * The pressure-wash gear the player holds during the wash: a wand (grip, trigger guard and lance) at the nozzle, aimed along the
 * spray, and, when the water comes from your own pressure washer, a hose that sags from the washer's reel to the wand. The hose is
 * one updatable tube with a fixed number of points, so moving it every frame allocates no new geometry. Materials are the shared
 * library's; `dispose` frees every mesh and node.
 */
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { MaterialLibrary } from '../Materials'

export const HOSE_POINTS = 18
export const WAND_LENGTH = 1.0
const HOSE_RADIUS = 0.022
const UP = new Vector3(0, 1, 0)

export interface Point3 {
  x: number
  y: number
  z: number
}

/**
 * The hose from `from` to `to` as `count` points: a parabolic sag of about a fifth of the span (at least 0.3 m) that never dips
 * below `floor + radius`.
 */
export function hosePath(from: Point3, to: Point3, floor: number, count = HOSE_POINTS, out: Vector3[] = []): Vector3[] {
  const span = Math.hypot(to.x - from.x, to.z - from.z)
  const sag = Math.max(0.3, span * 0.2)
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const y = Math.max(floor + HOSE_RADIUS, from.y + (to.y - from.y) * t - sag * 4 * t * (1 - t))
    const point = out[i] ?? (out[i] = new Vector3())
    point.set(from.x + (to.x - from.x) * t, y, from.z + (to.z - from.z) * t)
  }
  out.length = count
  return out
}

export class WashGear {
  readonly wand: TransformNode
  readonly meshes: Mesh[] = []
  private hose: Mesh | null = null
  private readonly path: Vector3[] = []
  private readonly back = new Vector3()
  private readonly reel: Vector3 | null

  /** `hoseFrom` is the washer's reel in world space (no hose for a wash bay or the public lane); `floor` the ground height there. */
  constructor(private readonly scene: Scene, mats: MaterialLibrary, hoseFrom: Point3 | null, private readonly floor = hoseFrom ? hoseFrom.y - 1.1 : 0) {
    const steel = mats.get('steel')
    const grip = mats.get('satinBlack')
    const trigger = mats.get('hoseRed')
    this.wand = new TransformNode('trucksim-wand', scene)
    this.wand.rotationQuaternion = new Quaternion()
    const lance = CreateCylinder('trucksim-wand-lance', { height: WAND_LENGTH * 0.72, diameter: 0.022, tessellation: 8 }, scene)
    lance.position.y = WAND_LENGTH * 0.64
    lance.material = steel
    const tip = CreateCylinder('trucksim-wand-tip', { height: 0.06, diameterTop: 0.03, diameterBottom: 0.04, tessellation: 8 }, scene)
    tip.position.y = WAND_LENGTH - 0.03
    tip.material = steel
    const handle = CreateBox('trucksim-wand-grip', { width: 0.05, height: 0.28, depth: 0.06 }, scene)
    handle.position.y = 0.14
    handle.material = grip
    const guard = CreateBox('trucksim-wand-trigger', { width: 0.03, height: 0.1, depth: 0.07 }, scene)
    guard.position.set(0, 0.2, -0.05)
    guard.material = trigger
    for (const mesh of [lance, tip, handle, guard]) {
      mesh.parent = this.wand
      mesh.isPickable = false
      this.meshes.push(mesh)
    }
    this.reel = hoseFrom ? new Vector3(hoseFrom.x, hoseFrom.y, hoseFrom.z) : null
    if (this.reel) {
      const rubber = mats.get('rubber')
      hosePath(this.reel, this.reel, this.floor, HOSE_POINTS, this.path)
      this.hose = CreateTube('trucksim-hose', { path: this.path, radius: HOSE_RADIUS, tessellation: 8, updatable: true }, scene)
      this.hose.material = rubber
      this.hose.isPickable = false
      this.meshes.push(this.hose)
    }
  }

  /** Puts the wand's tip at `nozzle`, pointing along `direction` (unit), and drapes the hose to its grip. */
  aim(nozzle: Vector3, direction: Vector3): void {
    nozzle.subtractToRef(direction.scale(WAND_LENGTH), this.back)
    this.wand.position.copyFrom(this.back)
    Quaternion.FromUnitVectorsToRef(UP, direction, this.wand.rotationQuaternion!)
    if (this.hose && this.reel) {
      hosePath(this.reel, this.back, this.floor, HOSE_POINTS, this.path)
      CreateTube('trucksim-hose', { path: this.path, radius: HOSE_RADIUS, tessellation: 8, instance: this.hose }, this.scene)
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose(false, false)
    this.meshes.length = 0
    this.wand.dispose()
    this.hose = null
  }
}
