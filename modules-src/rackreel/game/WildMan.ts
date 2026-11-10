/** Wisco Wild Man: the driver NPC on the hunter's 11-joint rig. `Avatar` poses him (sitting on his cooler or at the wheel); cheers from `systems/Cheers.ts` are layered on top and blended in and out, and a spring on the mullet keeps it bouncing. */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { ModelRig } from '../core/ModelLibrary'
import { CHEERS, cheerPose, cheerWeight } from '../systems/Cheers'
import type { CheerId } from '../systems/Cheers'
import { Avatar } from './Avatar'

const JOINTS = ['hips', 'torso', 'head', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'thighL', 'thighR', 'shinL', 'shinR'] as const

export type WildManPlace = 'camp' | 'boat'

export class WildMan {
  readonly avatar: Avatar
  readonly root: TransformNode
  place: WildManPlace = 'camp'
  /** Hip lift from his seat to standing on the floor, and to standing on top of the seat box (metres). */
  standLift = 0.32
  seatLift = 0.88
  onStomp: (() => void) | null = null
  private readonly joints = new Map<string, TransformNode>()
  private readonly base = new Map<string, Vector3>()
  private readonly can: Mesh
  private cheer: { id: CheerId; t: number } | null = null
  private clock = 0
  private look = 0
  private lookTarget = 0
  private lookTimer = 2
  private sip = -1
  private sipTimer = 6
  private mullet = 0
  private mulletVel = 0
  private lastHead = 0
  private lastHeadVel = 0
  private lastHop = 0
  private lastHopVel = 0
  private yaw = 0

  constructor(rig: ModelRig, scene: Scene) {
    this.avatar = new Avatar(rig)
    this.root = rig.root
    for (const name of JOINTS) {
      const j = rig.joints.get(name)
      if (j) this.joints.set(name, j)
    }
    const mullet = rig.joints.get('head:mullet')
    if (mullet) this.joints.set('mullet', mullet)
    this.can = CreateCylinder('wildman-can', { height: 0.122, diameter: 0.066, tessellation: 14 }, scene)
    const mat = new StandardMaterial('wildman-can-mat', scene)
    mat.diffuseColor = new Color3(0.72, 0.1, 0.08)
    mat.specularColor = new Color3(0.4, 0.4, 0.4)
    this.can.material = mat
    this.can.parent = this.avatar.rightHand
    this.can.position.set(0.01, -0.29, 0.05)
    this.can.isPickable = false
  }

  get cheering(): CheerId | null {
    return this.cheer?.id ?? null
  }

  get meshes() {
    return [...this.avatar.meshes, this.can]
  }

  /** Starts a cheer and returns its line. */
  celebrate(id: CheerId): string {
    this.cheer = { id, t: 0 }
    return CHEERS[id].line
  }

  setYaw(yaw: number): void {
    this.yaw = yaw
  }

  private restoreBase(): void {
    for (const [name, rot] of this.base) {
      const j = this.joints.get(name)
      if (j) j.rotation.copyFrom(rot)
    }
  }

  private saveBase(): void {
    for (const [name, j] of this.joints) {
      if (name === 'mullet') continue
      const saved = this.base.get(name)
      if (saved) saved.copyFrom(j.rotation)
      else this.base.set(name, j.rotation.clone())
    }
  }

  update(dt: number): void {
    this.clock += dt
    this.restoreBase()
    const atWheel = this.place === 'boat'
    this.avatar.update(dt, { stance: 'sit', hands: atWheel ? 'wheel' : 'free', speed: 0, crouch: false, castPower: 0, aimPitch: 0, climbPhase: 0 })
    this.saveBase()
    const hips = this.joints.get('hips')!
    const head = this.joints.get('head')!
    this.lookTimer -= dt
    if (this.lookTimer <= 0) {
      this.lookTimer = 2 + Math.random() * 4
      this.lookTarget = (Math.random() - 0.5) * (atWheel ? 0.9 : 1.4)
    }
    this.look += (this.lookTarget - this.look) * Math.min(1, dt * 3)
    head.rotation.y += this.look
    this.can.setEnabled(!atWheel)
    if (!atWheel && !this.cheer) {
      this.sipTimer -= dt
      if (this.sipTimer <= 0 && this.sip < 0) this.sip = 0
      if (this.sip >= 0) {
        this.sip += dt
        const k = Math.sin(Math.min(1, this.sip / 2) * Math.PI)
        const r = this.joints.get('upperArmL')!
        const f = this.joints.get('foreArmL')!
        r.rotation.x += (-1.05 - r.rotation.x) * k
        r.rotation.z += (0.25 - r.rotation.z) * k
        f.rotation.x += (-2.15 - f.rotation.x) * k
        head.rotation.x += -0.35 * k
        if (this.sip >= 2) {
          this.sip = -1
          this.sipTimer = 6 + Math.random() * 7
        }
      }
    }
    let lift = 0
    let hop = 0
    let spin = 0
    let kick = 0
    if (this.cheer) {
      const c = this.cheer
      c.t += dt
      const d = CHEERS[c.id].duration
      if (c.t >= d) {
        this.cheer = null
      } else {
        const w = cheerWeight(c.id, c.t)
        const pose = cheerPose(c.id, c.t)
        for (const [name, target] of Object.entries(pose.joints)) {
          const j = this.joints.get(name)
          if (!j || !target) continue
          j.rotation.x += (target[0] - j.rotation.x) * w
          j.rotation.y += (target[1] - j.rotation.y) * w
          j.rotation.z += (target[2] - j.rotation.z) * w
        }
        lift = w * (pose.stand * this.standLift + pose.onSeat * (this.seatLift - this.standLift))
        hop = w * pose.hop
        spin = w * pose.spin
        kick = w * pose.mullet
        if (pose.stomp) this.onStomp?.()
      }
    }
    hips.position.y += lift + hop
    this.root.rotation.y = this.yaw + spin
    const headVel = (head.rotation.x - this.lastHead) / Math.max(1e-3, dt)
    const headAcc = (headVel - this.lastHeadVel) / Math.max(1e-3, dt)
    this.lastHead = head.rotation.x
    this.lastHeadVel = headVel
    const hopVel = (hop - this.lastHop) / Math.max(1e-3, dt)
    const hopAcc = (hopVel - this.lastHopVel) / Math.max(1e-3, dt)
    this.lastHop = hop
    this.lastHopVel = hopVel
    const drive = -headAcc * 0.02 + hopAcc * 0.02 + kick * 6
    this.mulletVel += (-70 * this.mullet - 7 * this.mulletVel + Math.max(-60, Math.min(60, drive))) * dt
    this.mullet = Math.max(-0.5, Math.min(0.85, this.mullet + this.mulletVel * dt))
    const m = this.joints.get('mullet')
    if (m) m.rotation.x = this.mullet + Math.sin(this.clock * 1.3) * 0.015
  }
}
