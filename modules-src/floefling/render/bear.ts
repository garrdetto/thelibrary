import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { Look } from '../looks'
import { SWING_DELAY, ZONE_Y } from '../sim/constants'
import { glossy, matte } from './materials'

export type BearPose = 'idle' | 'toss' | 'swing' | 'whiff' | 'cheer' | 'slump'

const WOUND = Math.PI + 0.95
const CONTACT = Math.PI / 2
const FINISH = -1.0
const SHOULDER_Y = ZONE_Y + 0.14

const ease = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

export class Bear {
  readonly root: TransformNode
  private body: TransformNode
  private head: TransformNode
  private swingPivot: TransformNode
  private tossArm: TransformNode
  private fur: StandardMaterial
  private scarf: StandardMaterial
  private stripe: StandardMaterial
  private pose: BearPose = 'idle'
  private poseTime = 0

  constructor(scene: Scene, base: Vector3, look: Look) {
    this.root = new TransformNode('bear', scene)
    this.root.position.copyFrom(base)
    this.fur = matte(scene, 'bear-fur', look.bear)
    this.scarf = matte(scene, 'bear-scarf', look.scarf)
    this.stripe = matte(scene, 'bear-stripe', look.scarfStripe)
    const dark = glossy(scene, 'bear-dark', '#15161a', 0.12)
    const wood = matte(scene, 'bat-wood', '#9a6a3a')
    const grip = matte(scene, 'bat-grip', '#3b2a1e')
    const pad = matte(scene, 'bear-pad', '#3c3a40')

    this.body = new TransformNode('bear-body', scene)
    this.body.parent = this.root
    const part = (mesh: Mesh, parent: TransformNode, material: StandardMaterial, x: number, y: number, z: number) => {
      mesh.parent = parent
      mesh.position.set(x, y, z)
      mesh.material = material
      return mesh
    }
    for (const side of [-1, 1]) {
      part(CreateCapsule('bear-leg', { radius: 0.21, height: 0.75, tessellation: 12 }, scene), this.root, this.fur, side * 0.27, 0.38, 0)
      const foot = part(CreateSphere('bear-foot', { diameter: 0.42, segments: 10 }, scene), this.root, this.fur, side * 0.27, 0.08, -0.08)
      foot.scaling.set(1, 0.55, 1.3)
    }
    const torso = part(CreateSphere('bear-torso', { diameter: 1, segments: 18 }, scene), this.body, this.fur, 0, 1.12, 0)
    torso.scaling.set(1.05, 1.32, 0.9)
    const belly = part(CreateSphere('bear-belly', { diameter: 0.8, segments: 14 }, scene), this.body, matte(scene, 'bear-belly', '#ffffff'), 0, 1.02, -0.13)
    belly.scaling.set(0.95, 1.2, 0.7)

    const neck = part(CreateTorus('bear-scarf', { diameter: 0.62, thickness: 0.17, tessellation: 20 }, scene), this.body, this.scarf, 0, 1.7, -0.02)
    neck.scaling.set(1, 1, 0.9)
    const tail = part(CreateBox('bear-scarf-tail', { width: 0.16, height: 0.5, depth: 0.05 }, scene), this.body, this.scarf, 0.18, 1.45, -0.33)
    tail.rotation.set(0.15, 0, -0.2)
    part(CreateBox('bear-scarf-band', { width: 0.165, height: 0.07, depth: 0.055 }, scene), tail, this.stripe, 0, -0.14, 0).position.z = -0.002

    this.head = new TransformNode('bear-head', scene)
    this.head.parent = this.body
    this.head.position.set(0, 1.98, -0.1)
    part(CreateSphere('bear-skull', { diameter: 0.64, segments: 16 }, scene), this.head, this.fur, 0, 0, 0)
    const snout = part(CreateSphere('bear-snout', { diameter: 0.34, segments: 12 }, scene), this.head, this.fur, 0, -0.07, -0.3)
    snout.scaling.set(1, 0.78, 1.15)
    part(CreateSphere('bear-nose', { diameter: 0.12, segments: 10 }, scene), this.head, dark, 0, -0.02, -0.49)
    for (const side of [-1, 1]) {
      part(CreateSphere('bear-eye', { diameter: 0.075, segments: 8 }, scene), this.head, dark, side * 0.13, 0.09, -0.27)
      const ear = part(CreateSphere('bear-ear', { diameter: 0.19, segments: 10 }, scene), this.head, this.fur, side * 0.21, 0.24, 0.02)
      ear.scaling.z = 0.6
    }
    const hat = part(CreateSphere('bear-hat', { diameter: 0.66, segments: 16, slice: 0.5 }, scene), this.head, this.scarf, 0, 0.08, 0.03)
    hat.scaling.y = 0.95
    hat.rotation.x = -0.25
    const brim = part(CreateTorus('bear-hat-brim', { diameter: 0.64, thickness: 0.1, tessellation: 22 }, scene), this.head, this.stripe, 0, 0.09, 0.03)
    brim.rotation.x = -0.25
    part(CreateSphere('bear-pom', { diameter: 0.17, segments: 10 }, scene), this.head, this.stripe, 0, 0.42, 0.1)

    this.swingPivot = new TransformNode('bear-swing', scene)
    this.swingPivot.parent = this.root
    this.swingPivot.position.set(0, SHOULDER_Y, 0)
    const arm = part(CreateCapsule('bear-arm', { radius: 0.15, height: 0.75, tessellation: 12 }, scene), this.swingPivot, this.fur, 0.33, 0, 0)
    arm.rotation.z = Math.PI / 2
    part(CreateSphere('bear-paw', { diameter: 0.3, segments: 10 }, scene), this.swingPivot, this.fur, 0.66, 0, 0)
    const bat = part(CreateCylinder('bat', { height: 1.35, diameterTop: 0.22, diameterBottom: 0.075, tessellation: 14 }, scene), this.swingPivot, wood, 1.3, 0, 0)
    bat.rotation.z = -Math.PI / 2
    const cap = part(CreateSphere('bat-cap', { diameter: 0.22, segments: 10 }, scene), this.swingPivot, wood, 1.97, 0, 0)
    cap.scaling.x = 0.4
    const knob = part(CreateCylinder('bat-knob', { height: 0.06, diameter: 0.12, tessellation: 12 }, scene), this.swingPivot, grip, 0.6, 0, 0)
    knob.rotation.z = Math.PI / 2
    const wrap = part(CreateCylinder('bat-wrap', { height: 0.3, diameter: 0.09, tessellation: 12 }, scene), this.swingPivot, grip, 0.78, 0, 0)
    wrap.rotation.z = Math.PI / 2

    this.tossArm = new TransformNode('bear-toss-arm', scene)
    this.tossArm.parent = this.body
    this.tossArm.position.set(0.5, 1.52, -0.05)
    const lift = part(CreateCapsule('bear-arm2', { radius: 0.14, height: 0.72, tessellation: 12 }, scene), this.tossArm, this.fur, 0, -0.3, 0)
    lift.rotation.z = 0.05
    part(CreateSphere('bear-paw2', { diameter: 0.28, segments: 10 }, scene), this.tossArm, this.fur, 0, -0.66, 0)
    const sole = part(CreateSphere('bear-pad2', { diameter: 0.16, segments: 8 }, scene), this.tossArm, pad, 0, -0.7, -0.09)
    sole.scaling.z = 0.4
    this.setPose('idle')
  }

  setLook(look: Look): void {
    this.fur.diffuseColor = Color3.FromHexString(look.bear)
    this.scarf.diffuseColor = Color3.FromHexString(look.scarf)
    this.stripe.diffuseColor = Color3.FromHexString(look.scarfStripe)
  }

  setPose(pose: BearPose): void {
    this.pose = pose
    this.poseTime = 0
  }

  get currentPose(): BearPose {
    return this.pose
  }

  pawPosition(): Vector3 {
    return Vector3.TransformCoordinates(new Vector3(0, -0.72, -0.05), this.tossArm.computeWorldMatrix(true))
  }

  update(dt: number): void {
    this.poseTime += dt
    const t = this.poseTime
    let swing = WOUND + 0.15
    let tilt = 0.55
    let toss = 0.15
    let lean = 0
    let spin = 0
    let squash = 1 + Math.sin(t * 2.2) * 0.012
    let headNod = Math.sin(t * 1.4) * 0.04
    if (this.pose === 'toss') {
      const up = clamp01(t / 0.22)
      const settle = clamp01((t - 0.35) / 0.4)
      toss = 0.15 + ease(up) * 2.45 - ease(settle) * 1.6
      swing = WOUND + 0.15 - ease(clamp01(t / 0.5)) * 0.15
      tilt = 0.55 - ease(clamp01(t / 0.5)) * 0.25
      headNod = -0.35 * ease(up) + 0.2 * settle
      lean = 0.06 * ease(clamp01(t / 0.5))
    } else if (this.pose === 'swing' || this.pose === 'whiff') {
      if (t < SWING_DELAY) {
        const k = ease(t / SWING_DELAY)
        swing = WOUND + (CONTACT - WOUND) * (k * k)
        tilt = 0.3 + (-0.12 - 0.3) * k
      } else {
        const k = clamp01((t - SWING_DELAY) / 0.2)
        swing = CONTACT + (FINISH - CONTACT) * (1 - (1 - k) * (1 - k))
        tilt = -0.12 + 0.6 * ease(k)
      }
      toss = 0.4
      lean = -0.12 * Math.sin(clamp01(t / 0.35) * Math.PI)
      if (this.pose === 'whiff' && t > 0.3) {
        const k = clamp01((t - 0.3) / 0.7)
        spin = ease(k) * Math.PI * 2
        lean = Math.sin(k * Math.PI) * 0.35
        squash = 1 - Math.sin(k * Math.PI) * 0.08
      }
      if (t > 1.6) this.setPose('idle')
    } else if (this.pose === 'cheer') {
      swing = FINISH
      tilt = 0.9 + Math.sin(t * 9) * 0.25
      toss = 2.6 + Math.sin(t * 9) * 0.3
      squash = 1 + Math.abs(Math.sin(t * 9)) * 0.06
      headNod = -0.2
    } else if (this.pose === 'slump') {
      swing = FINISH - 0.3
      tilt = -0.6
      toss = 0.05
      headNod = 0.35
      lean = 0.12
      squash = 0.97
    }
    this.swingPivot.rotation.set(0, swing, tilt)
    this.tossArm.rotation.set(toss, 0, 0.1)
    this.head.rotation.set(headNod, 0, 0)
    this.body.rotation.set(lean, (swing - CONTACT) * 0.18, 0)
    this.root.rotation.y = spin
    this.body.scaling.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash))
  }
}
