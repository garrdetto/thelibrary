import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { ModelRig } from '../core/ModelLibrary'

export const HIP_HEIGHT = 0.98

export type AvatarStance = 'stand' | 'sit' | 'climb'
export type AvatarHands = 'rod' | 'cast' | 'reel' | 'rifle' | 'aim' | 'wheel' | 'free'

export interface AvatarPose {
  stance: AvatarStance
  hands: AvatarHands
  speed: number
  crouch: boolean
  castPower: number
  aimPitch: number
  climbPhase: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export class Avatar {
  readonly root: TransformNode
  readonly meshes: AbstractMesh[]
  private readonly j: Record<string, TransformNode> = {}
  private phase = 0
  private clock = 0
  private crouchBlend = 0
  private castSnap = 0
  private readonly hipBase: number

  constructor(readonly rig: ModelRig) {
    this.root = rig.root
    this.meshes = rig.meshes
    for (const [name, node] of rig.joints) this.j[name] = node
    this.hipBase = this.j.hips.position.y
  }

  get rightHand(): TransformNode {
    return this.j.foreArmL
  }

  get chest(): TransformNode {
    return this.j.torso
  }

  setVisible(visible: boolean): void {
    for (const m of this.meshes) m.isVisible = visible
  }

  cast(): void {
    this.castSnap = 1
  }

  update(dt: number, pose: AvatarPose): void {
    this.clock += dt
    const j = this.j
    const k = Math.min(1, dt * 14)
    const set = (node: TransformNode, x: number, y = 0, z = 0) => {
      node.rotation.x += (x - node.rotation.x) * k
      node.rotation.y += (y - node.rotation.y) * k
      node.rotation.z += (z - node.rotation.z) * k
    }
    this.crouchBlend += ((pose.crouch && pose.stance === 'stand' ? 1 : 0) - this.crouchBlend) * Math.min(1, dt * 8)
    this.castSnap = Math.max(0, this.castSnap - dt * 2.2)
    const c = this.crouchBlend
    const run = Math.min(1, pose.speed / 5)
    const moving = pose.speed > 0.15
    const stride = lerp(1.35, 2.1, run) * (1 - c * 0.35)
    if (pose.stance === 'stand') this.phase += (pose.speed / stride) * Math.PI * 2 * dt
    const p = this.phase
    const amp = moving ? Math.min(1, pose.speed / 1.5) : 0
    const swing = lerp(0.42, 0.7, run) * amp
    const breathe = Math.sin(this.clock * 1.6) * 0.012
    let hipY = this.hipBase
    let torsoX = breathe
    let torsoY = 0
    let headX = 0
    if (pose.stance === 'stand') {
      const bob = moving ? Math.abs(Math.cos(p)) * lerp(0.025, 0.06, run) : 0
      hipY = this.hipBase - c * 0.36 + bob - (moving ? lerp(0.01, 0.04, run) : 0)
      torsoX += lerp(0.04, 0.2, run) * amp + c * 0.35
      torsoY = Math.sin(p) * 0.08 * amp
      headX = -torsoX * 0.6
      for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
        const s = Math.sin(p + (sgn > 0 ? 0 : Math.PI))
        const lift = Math.max(0, Math.sin(p + (sgn > 0 ? 0 : Math.PI) + 1.3))
        set(j['thigh' + side], -s * swing - c * 1.05, 0, 0)
        set(j['shin' + side], lift * lerp(0.7, 1.5, run) * amp + 0.05 + c * 1.75)
      }
      j.hips.rotation.y = -torsoY * 0.6
    } else if (pose.stance === 'sit') {
      for (const side of ['L', 'R']) {
        set(j['thigh' + side], -1.48, 0, side === 'L' ? -0.08 : 0.08)
        set(j['shin' + side], 1.35)
      }
      torsoX = -0.05 + breathe
    } else {
      const cp = pose.climbPhase * Math.PI * 2
      for (const [side, off] of [['L', 0], ['R', Math.PI]] as const) {
        const s = Math.sin(cp + off)
        set(j['thigh' + side], -0.55 - s * 0.45)
        set(j['shin' + side], 0.75 + s * 0.55)
      }
      torsoX = 0.12
    }
    j.hips.position.y = hipY
    set(j.torso, torsoX, torsoY, 0)
    set(j.head, headX + (pose.hands === 'aim' ? -pose.aimPitch * 0.4 : 0))

    const armSwing = (side: 'L' | 'R') => (pose.stance === 'stand' ? Math.sin(p + (side === 'L' ? Math.PI : 0)) * swing * 0.75 : 0)
    const R = 'L'
    const Lh = 'R'
    if (pose.stance === 'climb') {
      const cp = pose.climbPhase * Math.PI * 2
      set(j['upperArm' + R], -2.5 + Math.sin(cp + Math.PI) * 0.35, 0, 0.1)
      set(j['foreArm' + R], -0.35)
      set(j['upperArm' + Lh], -2.5 + Math.sin(cp) * 0.35, 0, -0.1)
      set(j['foreArm' + Lh], -0.35)
      return
    }
    switch (pose.hands) {
      case 'wheel':
        set(j['upperArm' + R], -0.85, 0, 0.1)
        set(j['foreArm' + R], -0.7, 0.2)
        set(j['upperArm' + Lh], -0.85, 0, -0.1)
        set(j['foreArm' + Lh], -0.7, -0.2)
        break
      case 'rod':
        set(j['upperArm' + R], -0.25 + armSwing(R) * 0.3, 0, 0.12)
        set(j['foreArm' + R], -1.15)
        set(j['upperArm' + Lh], armSwing(Lh), 0, -0.05)
        set(j['foreArm' + Lh], -0.2 - Math.max(0, -armSwing(Lh)) * 0.6)
        break
      case 'cast': {
        const back = pose.castPower
        const snap = this.castSnap
        set(j['upperArm' + R], lerp(-0.4, -2.4, back) * (1 - snap) - 1.1 * snap, 0, 0.15)
        set(j['foreArm' + R], lerp(-1.1, -1.9, back) * (1 - snap) - 0.6 * snap)
        set(j['upperArm' + Lh], -0.6, 0, -0.1)
        set(j['foreArm' + Lh], -1.1)
        break
      }
      case 'reel': {
        const wob = Math.sin(this.clock * 14) * 0.05
        set(j['upperArm' + R], -0.6, 0, 0.1)
        set(j['foreArm' + R], -0.95 + wob * 0.5)
        set(j['upperArm' + Lh], -0.75 + wob, 0, -0.35)
        set(j['foreArm' + Lh], -1.25 + wob)
        torsoX -= 0.08
        break
      }
      case 'rifle':
        set(j['upperArm' + R], -0.3 + armSwing(R) * 0.2, 0, 0.1)
        set(j['foreArm' + R], -1.25)
        set(j['upperArm' + Lh], -0.55, 0, -0.25)
        set(j['foreArm' + Lh], -1.35)
        break
      case 'aim':
        set(j['upperArm' + R], -1.15 - pose.aimPitch, 0.0, 0.75)
        set(j['foreArm' + R], -1.05, 0.0)
        set(j['upperArm' + Lh], -1.45 - pose.aimPitch, 0.0, -0.2)
        set(j['foreArm' + Lh], -0.35, 0)
        break
      default:
        set(j['upperArm' + R], armSwing(R), 0, 0.06)
        set(j['foreArm' + R], -0.2 - Math.max(0, -armSwing(R)) * 0.6)
        set(j['upperArm' + Lh], armSwing(Lh), 0, -0.06)
        set(j['foreArm' + Lh], -0.2 - Math.max(0, -armSwing(Lh)) * 0.6)
    }
  }
}
