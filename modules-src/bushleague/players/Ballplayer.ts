/** One on-field figure: the skinned body on the shared skeleton in a club uniform, a glove on the non-throwing hand, an optional bat, and the Animator. Moving it drives the run cycle and turns it toward where it is going. */
import * as THREE from 'three/webgpu'
import type { BodyType, Hand } from '../sim'
import { Animator, type ActionName, type BaseState } from './Animator'
import { buildBody } from './BodyMesh'
import { groundHeight } from '../view/Mound'
import { modelGeometry, type Gear } from './Models'
import { createRig, proportionsFor, type Rig } from './Rig'
import { createPlayerMaterial, type JerseyLook, type PlayerMaterial, type UniformColors } from './Uniform'

type GloveGeometry = Gear['glove']

export interface BallplayerOptions {
  body: BodyType
  height: number
  throws: Hand
  uniform: UniformColors
  skin: string
  jersey?: JerseyLook
}

export class Ballplayer {
  readonly group = new THREE.Group()
  readonly rig: Rig
  readonly animator: Animator
  readonly mesh: THREE.SkinnedMesh
  readonly glove: THREE.Mesh
  readonly bat: THREE.Group
  private readonly look: PlayerMaterial
  private readonly geometry: THREE.BufferGeometry
  private readonly last = new THREE.Vector3()
  private speed = 0
  private yaw = 0
  private targetYaw = 0
  private placed = false
  readonly throws: Hand
  private readonly lettering: THREE.Texture | null
  private readonly ownsGeometry: boolean

  constructor(options: BallplayerOptions, gloveMaterial: THREE.Material, batGeometry: THREE.BufferGeometry, batMaterial: THREE.Material, gloveGeometry: THREE.BufferGeometry | GloveGeometry, modelBat = false) {
    this.throws = options.throws
    const model = modelGeometry(options.body)
    const proportions = model ? { scale: 1, girth: 1, belly: 0, shoulders: 1 } : proportionsFor(options.body, options.height)
    this.rig = createRig(proportions)
    this.ownsGeometry = !model
    this.geometry = model ?? buildBody(this.rig, proportions)
    if (model) this.group.scale.setScalar(options.height / 1.85)
    this.lettering = options.jersey?.lettering ?? null
    this.look = createPlayerMaterial(options.uniform, options.skin, options.jersey)
    this.mesh = new THREE.SkinnedMesh(this.geometry, this.look.material)
    this.mesh.add(this.rig.root)
    this.mesh.bind(this.rig.skeleton)
    this.mesh.castShadow = true
    this.mesh.frustumCulled = false
    this.group.add(this.mesh)
    const gloveSide = options.throws === 'R' ? 'L' : 'R'
    if (gloveGeometry instanceof THREE.BufferGeometry) {
      this.glove = new THREE.Mesh(gloveGeometry, gloveMaterial)
      this.glove.position.set(gloveSide === 'L' ? 0.07 : -0.07, -0.01, 0.03)
    } else {
      this.glove = new THREE.Mesh(gloveGeometry[gloveSide], gloveMaterial)
      this.glove.scale.setScalar(1.18)
      const out = gloveSide === 'L' ? 1 : -1
      this.glove.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -out), new THREE.Vector3(out, 0, 0), new THREE.Vector3(0, -1, 0)))
      this.glove.position.set(out * 0.1, -0.006, 0)
    }
    this.glove.castShadow = true
    this.rig.bones[`hand.${gloveSide}`].add(this.glove)
    this.bat = new THREE.Group()
    const barrel = new THREE.Mesh(batGeometry, batMaterial)
    if (!modelBat) barrel.position.y = 0.42
    else barrel.position.y = -0.03
    barrel.castShadow = true
    this.bat.add(barrel)
    this.bat.visible = false
    this.rig.bones[`hand.${options.throws}`].add(this.bat)
    this.bat.position.set(options.throws === 'R' ? -0.05 : 0.05, 0, 0.02)
    this.animator = new Animator(this.rig, options.throws === 'L', gloveSide)
  }

  setLook(uniform: UniformColors, skin: string): void {
    this.look.set(uniform, skin)
  }

  showGlove(visible: boolean): void {
    this.glove.visible = visible
  }

  holdBat(visible: boolean): void {
    this.bat.visible = visible
  }

  setBase(state: BaseState): void {
    this.animator.setBase(state)
  }

  play(action: ActionName, duration: number): void {
    this.animator.play(action, duration)
  }

  /** Places the figure at a world point; consecutive calls set its speed and heading. */
  moveTo(position: THREE.Vector3, dt: number, autoBase = true): void {
    if (!this.placed) {
      this.group.position.copy(position)
      this.group.position.y += groundHeight(position.x, position.z)
      this.last.copy(position)
      this.placed = true
      return
    }
    const dx = position.x - this.last.x
    const dz = position.z - this.last.z
    const distance = Math.hypot(dx, dz)
    const speed = dt > 0 ? distance / dt : 0
    this.speed += (speed - this.speed) * Math.min(1, dt * 8)
    if (distance > 0.01) this.targetYaw = Math.atan2(dx, dz)
    this.group.position.copy(position)
    this.group.position.y += groundHeight(position.x, position.z)
    this.last.copy(position)
    if (autoBase && this.animator.base !== 'crouch' && this.animator.base !== 'stance') this.setBase(this.speed > 0.8 ? 'run' : this.animator.base === 'run' ? 'ready' : this.animator.base)
  }

  teleport(position: THREE.Vector3): void {
    this.group.position.copy(position)
    this.group.position.y += groundHeight(position.x, position.z)
    this.last.copy(position)
    this.speed = 0
    this.placed = true
  }

  face(yaw: number, instant = false): void {
    this.targetYaw = yaw
    if (instant) this.yaw = yaw
  }

  faceToward(point: THREE.Vector3, instant = false): void {
    this.face(Math.atan2(point.x - this.group.position.x, point.z - this.group.position.z), instant)
  }

  update(dt: number): void {
    let delta = this.targetYaw - this.yaw
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    this.yaw += delta * Math.min(1, dt * 10)
    this.group.rotation.y = this.yaw
    this.animator.update(dt, this.speed)
    this.speed *= Math.max(0, 1 - dt * 3)
  }

  dispose(): void {
    this.group.removeFromParent()
    if (this.ownsGeometry) this.geometry.dispose()
    this.look.material.dispose()
    this.lettering?.dispose()
  }
}
