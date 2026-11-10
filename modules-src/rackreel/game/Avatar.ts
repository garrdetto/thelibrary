import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { ModelRig } from '../core/ModelLibrary'
import { HUNTER_ARMS, solveArm } from '../systems/ArmReach'
import type { Vec3 } from '../systems/ArmReach'
import { legPose, walkGait } from '../systems/Gait'

export const HIP_HEIGHT = 0.98

export type AvatarStance = 'stand' | 'sit' | 'climb'
/** `fish` is the rod held in both hands with the line out (waiting on a bite). */
export type AvatarHands = 'rod' | 'fish' | 'cast' | 'reel' | 'rifle' | 'aim' | 'wheel' | 'free' | 'bow' | 'draw'

export interface AvatarPose {
  stance: AvatarStance
  hands: AvatarHands
  speed: number
  crouch: boolean
  castPower: number
  aimPitch: number
  climbPhase: number
  /** Reel crank angle in radians; the reeling hand follows it round. */
  crankPhase?: number
  /** Rod load 0..1 while fighting a fish: the angler leans back and lifts the rod. */
  rodLoad?: number
}

/** Which way each elbow points while a hand is placed, in the torso's frame. */
export const ELBOW_POLES = {
  right: new Vector3(0.55, -1, -0.35),
  left: new Vector3(-0.55, -1, -0.35),
  drawing: new Vector3(0.7, 0.05, -1),
  bowArm: new Vector3(-0.35, -1, 0.15),
} as const

/**
 * How far the body turns away from the shot, from Meshy's archery and rifle clips measured in Blender:
 * on the rifle the shoulders sit about 48° off the line and at full draw nearly in line with the arrow (left shoulder forward), head square to the shot.
 */
export const SIDE_ON = { aim: { hips: 0.3, torso: 0.52 }, draw: { hips: 0.45, torso: 0.8 } } as const

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const ARM_JOINTS = ['upperArmL', 'foreArmL', 'upperArmR', 'foreArmR'] as const

export class Avatar {
  readonly root: TransformNode
  readonly meshes: AbstractMesh[]
  private readonly j: Record<string, TransformNode> = {}
  private readonly fk = new Map<TransformNode, Vector3>()
  private phase = 0
  private clock = 0
  private crouchBlend = 0
  private castSnap = 0
  private readonly hipBase: number
  private readonly reachWeight = { L: 0, R: 0 }
  private solvedThisFrame = false
  private readonly ikQuat = new Map<TransformNode, Quaternion>()
  private readonly fkQuat = new Quaternion()
  private readonly ikTarget = new Quaternion()
  private readonly inverse = new Matrix()
  private readonly local = new Vector3()
  private readonly chain: TransformNode[] = []
  private wearKey = ''

  constructor(readonly rig: ModelRig) {
    this.root = rig.root
    this.meshes = rig.meshes
    for (const [name, node] of rig.joints) {
      this.j[name] = node
      if (!name.includes(':')) this.fk.set(node, node.rotation.clone())
    }
    for (const name of ARM_JOINTS) this.ikQuat.set(this.j[name], new Quaternion())
    this.hipBase = this.j.hips.position.y
  }

  /** The forearm that holds the rod and the rifle's grip (the hunter's right). */
  get rightHand(): TransformNode {
    return this.j.foreArmL
  }

  /** The forearm that holds the bow (the hunter's left). */
  get leftHand(): TransformNode {
    return this.j.foreArmR
  }

  joint(name: string): TransformNode | undefined {
    return this.j[name]
  }

  get chest(): TransformNode {
    return this.j.torso
  }

  get hips(): TransformNode {
    return this.j.hips
  }

  /** How far the hips have dropped or bobbed from standing height this frame. */
  get hipDrop(): number {
    return this.j.hips.position.y - this.hipBase
  }

  setOutfit(wear: string[]): void {
    const key = wear.join('|')
    if (key === this.wearKey) return
    this.wearKey = key
    for (const [name, mesh] of this.rig.partMeshes) {
      const i = name.indexOf(':')
      if (i < 0) continue
      mesh.setEnabled(name.slice(i + 1).split('+').every((item) => wear.includes(item)))
    }
  }

  setVisible(visible: boolean): void {
    for (const m of this.meshes) m.isVisible = visible
  }

  cast(): void {
    this.castSnap = 1
  }

  /** Palm centre of the hunter's right (`right`) or left hand in world space, after this frame's pose. */
  palm(hand: 'right' | 'left', out: Vector3): Vector3 {
    const side = hand === 'right' ? 'L' : 'R'
    const fore = this.j['foreArm' + side]
    this.refresh(fore)
    const p = HUNTER_ARMS[side].palm
    return Vector3.TransformCoordinatesFromFloatsToRef(p[0], p[1], p[2], fore.getWorldMatrix(), out)
  }

  update(dt: number, pose: AvatarPose): void {
    if (!this.solvedThisFrame) this.releaseHands()
    this.solvedThisFrame = false
    this.clock += dt
    const j = this.j
    const k = Math.min(1, dt * 14)
    const set = (node: TransformNode, x: number, y = 0, z = 0) => {
      const r = this.fk.get(node)!
      r.x += (x - r.x) * k
      r.y += (y - r.y) * k
      r.z += (z - r.z) * k
    }
    this.crouchBlend += ((pose.crouch && pose.stance === 'stand' ? 1 : 0) - this.crouchBlend) * Math.min(1, dt * 8)
    this.castSnap = Math.max(0, this.castSnap - dt * 2.2)
    const c = this.crouchBlend
    const run = Math.min(1, pose.speed / 5)
    const moving = pose.speed > 0.15
    const gait = walkGait(pose.speed, c)
    if (pose.stance === 'stand') this.phase += (pose.speed / gait.stride) * Math.PI * 2 * dt
    const p = this.phase
    const amp = gait.amp
    const swing = lerp(0.42, 0.75, run) * amp
    const breathe = Math.sin(this.clock * 1.6) * 0.012
    const sideOn = pose.stance === 'stand' ? (pose.hands === 'aim' ? SIDE_ON.aim : pose.hands === 'draw' ? SIDE_ON.draw : null) : null
    let hipY = this.hipBase
    let torsoX = breathe
    let torsoY = 0
    let hipYaw = 0
    let headX = 0
    if (pose.stance === 'stand') {
      const legK = moving ? Math.min(1, dt * 30) : k
      const setLeg = (node: TransformNode, x: number) => {
        const r = this.fk.get(node)!
        r.x += (x - r.x) * legK
        r.y += -r.y * legK
        r.z += -r.z * legK
      }
      const sinP = Math.sin(p)
      const bob = moving ? Math.abs(Math.cos(p)) * lerp(0.0, 0.05, run) * amp : 0
      hipY = this.hipBase - c * 0.36 + bob - gait.drop * sinP * sinP - gait.sink
      torsoX += lerp(0.05, 0.22, run) * amp + c * 0.35
      torsoY = sinP * lerp(0.12, 0.08, run) * amp
      headX = -torsoX * 0.6
      for (const [side, off] of [['L', 0], ['R', Math.PI]] as const) {
        const legs = legPose(p + off, gait)
        setLeg(j['thigh' + side], legs.thigh - c * 1.05)
        setLeg(j['shin' + side], legs.knee + 0.05 + c * 1.75)
      }
      hipYaw = -torsoY * 0.6
      if (sideOn) {
        hipYaw += sideOn.hips
        torsoY += sideOn.torso
      } else if (pose.hands === 'rifle' || pose.hands === 'fish' || pose.hands === 'reel') {
        torsoY += 0.14
      }
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
    set(j.hips, 0, hipYaw, 0)
    set(j.torso, torsoX, torsoY, 0)
    const turned = this.fk.get(j.hips)!.y + this.fk.get(j.torso)!.y
    set(j.head, headX + (pose.hands === 'aim' ? 0.16 - pose.aimPitch * 0.4 : 0), sideOn ? -turned : -torsoY * 0.5)

    const armSwing = (side: 'L' | 'R') => (pose.stance === 'stand' ? Math.sin(p + (side === 'L' ? Math.PI : 0)) * swing * 0.75 : 0)
    const R = 'L'
    const Lh = 'R'
    if (pose.stance === 'climb') {
      const cp = pose.climbPhase * Math.PI * 2
      set(j['upperArm' + R], -2.5 + Math.sin(cp + Math.PI) * 0.35, 0, 0.1)
      set(j['foreArm' + R], -0.35)
      set(j['upperArm' + Lh], -2.5 + Math.sin(cp) * 0.35, 0, -0.1)
      set(j['foreArm' + Lh], -0.35)
      this.applyFk()
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
      case 'fish':
        set(j['upperArm' + R], -0.42 + armSwing(R) * 0.15, -0.2, 0.08)
        set(j['foreArm' + R], -1.05)
        set(j['upperArm' + Lh], -0.45, 0.35, -0.1)
        set(j['foreArm' + Lh], -1.3)
        break
      case 'cast': {
        const back = pose.castPower
        const snap = this.castSnap
        set(j['upperArm' + R], lerp(-0.5, -2.55, back) * (1 - snap) - 1.15 * snap, -0.15 * back, 0.12)
        set(j['foreArm' + R], lerp(-1.1, -1.75, back) * (1 - snap) - 0.45 * snap)
        set(j['upperArm' + Lh], lerp(-0.7, -1.9, back) * (1 - snap) - 0.9 * snap, 0.35, -0.1)
        set(j['foreArm' + Lh], -1.2)
        set(j.torso, torsoX - back * 0.12 * (1 - snap) + snap * 0.1, torsoY + 0.12 + back * 0.18 * (1 - snap), 0)
        break
      }
      case 'reel': {
        const load = pose.rodLoad ?? 0.4
        const crank = pose.crankPhase ?? this.clock * 14
        const shake = Math.sin(this.clock * 23) * 0.02 * load
        set(j['upperArm' + R], -0.3 - load * 0.35 + shake, -0.4, -0.3)
        set(j['foreArm' + R], -1.4)
        set(j['upperArm' + Lh], -0.3 + Math.sin(crank) * 0.11 + shake, 0.5 + Math.cos(crank) * 0.09, -0.2)
        set(j['foreArm' + Lh], -1.35 + Math.sin(crank) * 0.1)
        set(j.torso, torsoX - 0.06 - load * 0.16, torsoY, 0)
        break
      }
      case 'rifle':
        set(j['upperArm' + R], -0.35 + armSwing(R) * 0.1, -0.1, 0.1)
        set(j['foreArm' + R], -1.3)
        set(j['upperArm' + Lh], -0.7, 0.3, -0.2)
        set(j['foreArm' + Lh], -1.25)
        break
      case 'bow': {
        const pitch = Math.max(-0.4, Math.min(1.1, pose.aimPitch))
        set(j['upperArm' + Lh], -0.75 + pitch * 0.35, 0.15, -0.12)
        set(j['foreArm' + Lh], -0.35, 0)
        set(j['upperArm' + R], -0.55 + pitch * 0.2, -0.3, 0.1)
        set(j['foreArm' + R], -1.45, 0.2)
        set(j.torso, torsoX + 0.06 + pitch * 0.12, torsoY + 0.15, 0)
        set(j.head, pitch * 0.45, -0.15)
        break
      }
      case 'draw': {
        const pitch = Math.max(-0.6, Math.min(1.2, pose.aimPitch))
        set(j['upperArm' + Lh], -1.5 + pitch, -0.45, -0.1)
        set(j['foreArm' + Lh], -0.1, 0)
        set(j['upperArm' + R], -1.55 + pitch, 0.35, 1.25)
        set(j['foreArm' + R], -2.3, 0)
        set(j.torso, torsoX + pitch * 0.18, torsoY, -pitch * 0.05)
        set(j.head, pitch * 0.6, -turned)
        break
      }
      case 'aim':
        set(j['upperArm' + R], -1.1 - pose.aimPitch, 0.3, 0.85)
        set(j['foreArm' + R], -1.5, 0.0)
        set(j['upperArm' + Lh], -1.35 - pose.aimPitch, -0.35, -0.15)
        set(j['foreArm' + Lh], -0.55, 0)
        break
      default:
        set(j['upperArm' + R], armSwing(R), 0, 0.06)
        set(j['foreArm' + R], -0.2 - Math.max(0, -armSwing(R)) * 0.6)
        set(j['upperArm' + Lh], armSwing(Lh), 0, -0.06)
        set(j['foreArm' + Lh], -0.2 - Math.max(0, -armSwing(Lh)) * 0.6)
    }
    this.applyFk()
  }

  /**
   * Puts each palm on its world target (or lets that arm fall back to its animated pose when the target is null),
   * easing in and out so a hand slides onto a grip rather than snapping. Call after `update` and after the gear is
   * placed for the frame; an arm left unsolved for a frame goes back to its animated pose.
   */
  solveHands(dt: number, right: Vector3 | null, left: Vector3 | null, poles: { right?: Vector3; left?: Vector3 } = {}): void {
    this.solvedThisFrame = true
    const rate = Math.min(1, dt * 12)
    this.reach('L', right, poles.right ?? ELBOW_POLES.right, rate)
    this.reach('R', left, poles.left ?? ELBOW_POLES.left, rate)
  }

  private reach(side: 'L' | 'R', target: Vector3 | null, pole: Vector3, rate: number): void {
    const w = (this.reachWeight[side] += ((target ? 1 : 0) - this.reachWeight[side]) * rate)
    const upper = this.j['upperArm' + side]
    const fore = this.j['foreArm' + side]
    if (w < 0.002) {
      this.reachWeight[side] = 0
      this.release(upper)
      this.release(fore)
      return
    }
    if (target) {
      const torso = this.j.torso
      this.refresh(torso)
      torso.getWorldMatrix().invertToRef(this.inverse)
      Vector3.TransformCoordinatesToRef(target, this.inverse, this.local)
      this.local.subtractInPlace(upper.position)
      const q = this.ikQuat.get(upper)!
      const f = this.ikQuat.get(fore)!
      const solved = solveArm(HUNTER_ARMS[side], [this.local.x, this.local.y, this.local.z], [pole.x, pole.y, pole.z] as Vec3)
      q.set(solved.upper[0], solved.upper[1], solved.upper[2], solved.upper[3])
      f.set(solved.fore[0], solved.fore[1], solved.fore[2], solved.fore[3])
    }
    this.blend(upper, w)
    this.blend(fore, w)
  }

  private blend(node: TransformNode, w: number): void {
    const r = this.fk.get(node)!
    Quaternion.FromEulerAnglesToRef(r.x, r.y, r.z, this.fkQuat)
    Quaternion.SlerpToRef(this.fkQuat, this.ikQuat.get(node)!, w, this.ikTarget)
    if (!node.rotationQuaternion) node.rotationQuaternion = new Quaternion()
    node.rotationQuaternion.copyFrom(this.ikTarget)
  }

  private release(node: TransformNode): void {
    if (!node.rotationQuaternion) return
    node.rotationQuaternion = null
    node.rotation.copyFrom(this.fk.get(node)!)
  }

  private releaseHands(): void {
    this.reachWeight.L = 0
    this.reachWeight.R = 0
    for (const name of ARM_JOINTS) this.release(this.j[name])
  }

  private applyFk(): void {
    for (const [node, r] of this.fk) if (!node.rotationQuaternion) node.rotation.copyFrom(r)
  }

  /** Recomputes the world matrices from the root down to `node`, so a pose set this frame is read back exactly. */
  private refresh(node: TransformNode): void {
    const chain = this.chain
    chain.length = 0
    for (let n: TransformNode | null = node; n; n = n.parent as TransformNode | null) chain.push(n)
    for (let i = chain.length - 1; i >= 0; i--) chain[i].computeWorldMatrix(true)
  }
}
