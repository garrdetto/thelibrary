import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin'
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate'
import type { Scene } from '@babylonjs/core/scene'

/**
 * Cosmetic body debris for hard hits, simulated by Havok in the presenter's scene. The race itself (chassis, walls,
 * contacts) stays in the deterministic sim (`next/sim/`), so debris never touches a car and differs between peers.
 * Each hit drops a few panel chips on a short-lived invisible slab tilted to the track surface under the hit.
 */
export const DEBRIS = { minImpact: 7, maxPieces: 36, life: 5, perHit: 4 }

type Piece = { mesh: Mesh; agg: PhysicsAggregate; born: number }
type Ground = { mesh: Mesh; agg: PhysicsAggregate; born: number }

export class Debris {
  private pieces: Piece[] = []
  private grounds: Ground[] = []
  private materials = new Map<string, PBRMaterial>()
  private seed = 1

  constructor(private readonly scene: Scene) {}

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  private material(color: string): PBRMaterial {
    let m = this.materials.get(color)
    if (!m) {
      m = new PBRMaterial(`debris-${color}`, this.scene)
      m.albedoColor = Color3.FromHexString(color).toLinearSpace()
      m.metallic = 0.2
      m.roughness = 0.45
      this.materials.set(color, m)
    }
    return m
  }

  /** One hit at (x, y, z) on a surface with normal n, from a car moving at (vx, vz), closing at v m/s. */
  spawn(x: number, y: number, z: number, n: { x: number; y: number; z: number }, vx: number, vz: number, v: number, color = '#5a5f66'): void {
    if (v < DEBRIS.minImpact || !this.scene.getPhysicsEngine()) return
    const now = performance.now() / 1000
    const up = new Vector3(n.x, n.y, n.z).normalize()
    const ground = CreateBox('debris-ground', { width: 14, depth: 14, height: 0.2 }, this.scene)
    ground.isVisible = false
    ground.position.set(x - up.x * 0.55, y - 0.45 - 0.1, z - up.z * 0.55)
    const axis = Vector3.Cross(Vector3.Up(), up)
    const angle = Math.acos(Math.min(1, Math.max(-1, up.y)))
    ground.rotationQuaternion = axis.lengthSquared() > 1e-8 ? Quaternion.RotationAxis(axis.normalize(), angle) : Quaternion.Identity()
    this.grounds.push({ mesh: ground, agg: new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.1 }, this.scene), born: now })
    const count = Math.min(DEBRIS.perHit, 1 + Math.floor((v - DEBRIS.minImpact) / 3))
    for (let i = 0; i < count; i++) {
      while (this.pieces.length >= DEBRIS.maxPieces) this.remove(this.pieces[0])
      const w = 0.12 + this.random() * 0.25, d = 0.08 + this.random() * 0.2
      const mesh = CreateBox('debris', { width: w, depth: d, height: 0.015 }, this.scene)
      mesh.material = this.material(this.random() < 0.6 ? color : '#202226')
      mesh.position.set(x + (this.random() - 0.5) * 0.6, y + 0.1, z + (this.random() - 0.5) * 0.6)
      mesh.rotationQuaternion = Quaternion.FromEulerAngles(this.random() * 6.28, this.random() * 6.28, this.random() * 6.28)
      const agg = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 0.4, friction: 0.7, restitution: 0.25 }, this.scene)
      const k = 0.35 + this.random() * 0.4
      agg.body.setLinearVelocity(new Vector3(vx * k + (this.random() - 0.5) * 4, 1.5 + this.random() * 3, vz * k + (this.random() - 0.5) * 4))
      agg.body.setAngularVelocity(new Vector3((this.random() - 0.5) * 20, (this.random() - 0.5) * 20, (this.random() - 0.5) * 20))
      this.pieces.push({ mesh, agg, born: now })
    }
  }

  private remove(p: Piece | Ground): void {
    p.agg.dispose()
    p.mesh.dispose()
    const list: (Piece | Ground)[] = this.pieces.includes(p as Piece) ? this.pieces : this.grounds
    list.splice(list.indexOf(p), 1)
  }

  /** Retires pieces and slabs past their life. */
  update(): void {
    const now = performance.now() / 1000
    for (const p of [...this.pieces]) if (now - p.born > DEBRIS.life) this.remove(p)
    for (const g of [...this.grounds]) if (now - g.born > DEBRIS.life + 0.5) this.remove(g)
  }

  get count(): number {
    return this.pieces.length
  }

  dispose(): void {
    for (const p of [...this.pieces]) this.remove(p)
    for (const g of [...this.grounds]) this.remove(g)
    for (const m of this.materials.values()) m.dispose()
  }
}
