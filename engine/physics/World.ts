/** Rapier world wrapper: fixed-step stepping with interpolation snapshots, a debug-draw toggle and syncMesh(body, mesh). */
import * as THREE from 'three/webgpu'
import type RAPIER_NS from '@dimforge/rapier3d-compat'
import type { PhysicsConfig } from '../config'

export type Rapier = typeof RAPIER_NS
export type RigidBody = RAPIER_NS.RigidBody

interface Snapshot {
  position: THREE.Vector3
  rotation: THREE.Quaternion
}

export class PhysicsWorld {
  readonly world: RAPIER_NS.World
  private readonly previous = new Map<RigidBody, Snapshot>()
  private debugLines: THREE.LineSegments | null = null
  private readonly scratchPosition = new THREE.Vector3()
  private readonly scratchRotation = new THREE.Quaternion()

  private constructor(
    readonly rapier: Rapier,
    private readonly config: PhysicsConfig,
  ) {
    this.world = new rapier.World(new rapier.Vector3(...config.gravity))
  }

  static async create(config: PhysicsConfig): Promise<PhysicsWorld> {
    const module = await import('@dimforge/rapier3d-compat')
    const rapier = (module.default ?? module) as Rapier
    await rapier.init()
    return new PhysicsWorld(rapier, config)
  }

  track(body: RigidBody): void {
    this.previous.set(body, this.capture(body, { position: new THREE.Vector3(), rotation: new THREE.Quaternion() }))
  }

  untrack(body: RigidBody): void {
    this.previous.delete(body)
  }

  step(dt: number): void {
    for (const [body, snapshot] of this.previous) this.capture(body, snapshot)
    this.world.timestep = dt
    this.world.step()
    this.updateDebug()
  }

  syncMesh(body: RigidBody, mesh: THREE.Object3D, alpha = 1): void {
    const translation = body.translation()
    const rotation = body.rotation()
    this.scratchPosition.set(translation.x, translation.y, translation.z)
    this.scratchRotation.set(rotation.x, rotation.y, rotation.z, rotation.w)
    const snapshot = this.previous.get(body)
    if (snapshot && alpha < 1) {
      mesh.position.lerpVectors(snapshot.position, this.scratchPosition, alpha)
      mesh.quaternion.slerpQuaternions(snapshot.rotation, this.scratchRotation, alpha)
    } else {
      mesh.position.copy(this.scratchPosition)
      mesh.quaternion.copy(this.scratchRotation)
    }
  }

  setDebug(parent: THREE.Object3D | null): void {
    if (!parent) {
      if (this.debugLines) {
        this.debugLines.removeFromParent()
        this.debugLines.geometry.dispose()
        ;(this.debugLines.material as THREE.Material).dispose()
        this.debugLines = null
      }
      return
    }
    if (!this.debugLines) {
      const material = new THREE.LineBasicMaterial({ color: new THREE.Color(this.config.debugColor) })
      this.debugLines = new THREE.LineSegments(new THREE.BufferGeometry(), material)
      this.debugLines.frustumCulled = false
      this.debugLines.name = 'physics-debug'
    }
    parent.add(this.debugLines)
    this.updateDebug()
  }

  get debugEnabled(): boolean {
    return this.debugLines !== null
  }

  private capture(body: RigidBody, snapshot: Snapshot): Snapshot {
    const translation = body.translation()
    const rotation = body.rotation()
    snapshot.position.set(translation.x, translation.y, translation.z)
    snapshot.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w)
    return snapshot
  }

  private updateDebug(): void {
    if (!this.debugLines) return
    const { vertices } = this.world.debugRender()
    const geometry = this.debugLines.geometry
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3))
    geometry.computeBoundingSphere()
  }

  dispose(): void {
    this.setDebug(null)
    this.previous.clear()
    this.world.free()
  }
}
