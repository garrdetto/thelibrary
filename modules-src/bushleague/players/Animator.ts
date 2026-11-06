/** Per-player animation: a base state (idle, ready, run, crouch, stance) cross-faded over a fifth of a second, a timed action layer on top (swing, pitch, throw, catch, slide, celebrate), stride-matched running, two-bone IK pulling the glove hand to a target, and ground alignment that keeps the lowest foot on the dirt. */
import * as THREE from 'three/webgpu'
import { BONES, type BoneName, type Rig } from './Rig'
import * as Clips from './Clips'
import type { Pose } from './Clips'

export type BaseState = 'idle' | 'ready' | 'run' | 'crouch' | 'stance'
export type ActionName = 'swing' | 'bunt' | 'pitch' | 'throw' | 'catchHigh' | 'catchLow' | 'slide' | 'celebrate'

const ACTIONS: Readonly<Record<ActionName, { clip: (t: number, time: number) => Pose; fadeIn: number; fadeOut: number; hold?: boolean }>> = {
  swing: { clip: (t) => Clips.swing(t), fadeIn: 0.02, fadeOut: 0.25 },
  bunt: { clip: (t) => Clips.bunt(t), fadeIn: 0.1, fadeOut: 0.2, hold: true },
  pitch: { clip: (t) => Clips.pitch(t), fadeIn: 0.1, fadeOut: 0.3 },
  throw: { clip: (t) => Clips.throwBall(t), fadeIn: 0.05, fadeOut: 0.2 },
  catchHigh: { clip: (t) => Clips.catchHigh(t), fadeIn: 0.05, fadeOut: 0.2 },
  catchLow: { clip: (t) => Clips.catchLow(t), fadeIn: 0.05, fadeOut: 0.25 },
  slide: { clip: (t) => Clips.slide(t), fadeIn: 0.08, fadeOut: 0.3, hold: true },
  celebrate: { clip: (_t, time) => Clips.celebrate(time), fadeIn: 0.15, fadeOut: 0.3 },
}

const STRIDE = 2.4
const FADE = 0.2

function basePose(state: BaseState, time: number, phase: number, effort: number): Pose {
  switch (state) {
    case 'idle': return Clips.idle(time)
    case 'ready': return Clips.ready(time)
    case 'run': return Clips.run(phase, effort)
    case 'crouch': return Clips.crouch()
    case 'stance': return Clips.stance
  }
}

function blend(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a
  if (t >= 1) return b
  const out: Pose = {}
  for (const key of BONES) {
    const x = a[key]
    const y = b[key]
    if (!x && !y) continue
    const p = x ?? [0, 0, 0]
    const q = y ?? [0, 0, 0]
    out[key] = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]
  }
  return out
}

const euler = new THREE.Euler()
const quat = new THREE.Quaternion()
const va = new THREE.Vector3()
const vb = new THREE.Vector3()
const vc = new THREE.Vector3()
const vt = new THREE.Vector3()

function worldPosition(bone: THREE.Object3D, target: THREE.Vector3): THREE.Vector3 {
  return target.setFromMatrixPosition(bone.matrixWorld)
}

/** Rotates `bone` by a world-space rotation, keeping its parent where it is. */
function rotateWorld(bone: THREE.Bone, rotation: THREE.Quaternion): void {
  const parent = new THREE.Quaternion()
  bone.parent?.getWorldQuaternion(parent)
  const inverse = parent.clone().invert()
  bone.quaternion.premultiply(inverse.multiply(rotation).multiply(parent))
  bone.updateMatrixWorld(true)
}

/** Analytic two-bone IK: bends `a`→`b`→`c` so `c` reaches `target`. */
export function solveTwoBone(a: THREE.Bone, b: THREE.Bone, c: THREE.Bone, target: THREE.Vector3, weight: number): void {
  if (weight <= 0) return
  const keepA = a.quaternion.clone()
  const keepB = b.quaternion.clone()
  worldPosition(a, va)
  worldPosition(b, vb)
  worldPosition(c, vc)
  const lab = va.distanceTo(vb)
  const lbc = vb.distanceTo(vc)
  const lat = Math.max(0.01, Math.min(target.distanceTo(va), lab + lbc - 0.001))
  const ac = vc.clone().sub(va)
  const ab = vb.clone().sub(va)
  const ba = va.clone().sub(vb)
  const bc = vc.clone().sub(vb)
  const at = target.clone().sub(va)
  const acAb = ac.angleTo(ab)
  const baBc = ba.angleTo(bc)
  const acAt = ac.angleTo(at)
  const acAbTarget = Math.acos(Math.max(-1, Math.min(1, (lbc * lbc - lab * lab - lat * lat) / (-2 * lab * lat))))
  const baBcTarget = Math.acos(Math.max(-1, Math.min(1, (lat * lat - lab * lab - lbc * lbc) / (-2 * lab * lbc))))
  const axis0 = new THREE.Vector3().crossVectors(ac, ab).normalize()
  if (axis0.lengthSq() < 1e-6) axis0.set(0, 0, 1)
  const axis1 = new THREE.Vector3().crossVectors(ac, at).normalize()
  rotateWorld(a, quat.setFromAxisAngle(axis0, acAbTarget - acAb))
  rotateWorld(b, quat.setFromAxisAngle(axis0, baBcTarget - baBc))
  if (axis1.lengthSq() > 1e-6) rotateWorld(a, quat.setFromAxisAngle(axis1, acAt))
  if (weight < 1) {
    a.quaternion.copy(keepA.slerp(a.quaternion, weight))
    b.quaternion.copy(keepB.slerp(b.quaternion, weight))
    a.updateMatrixWorld(true)
  }
}

export class Animator {
  private state: BaseState = 'idle'
  private previous: BaseState = 'idle'
  private fade = 1
  private time = 0
  private phase = 0
  private effort = 0
  private action: { name: ActionName; elapsed: number; duration: number } | null = null
  private reachTarget: THREE.Vector3 | null = null
  private reachWeight = 0
  private readonly restHips: number

  constructor(private readonly rig: Rig, private readonly lefty: boolean, private readonly gloveSide: 'L' | 'R') {
    this.restHips = rig.bones.hips.position.y
  }

  setBase(state: BaseState): void {
    if (state === this.state) return
    this.previous = this.state
    this.state = state
    this.fade = 0
  }

  get base(): BaseState {
    return this.state
  }

  play(name: ActionName, duration: number): void {
    this.action = { name, elapsed: 0, duration: Math.max(0.1, duration) }
  }

  get playing(): ActionName | null {
    return this.action?.name ?? null
  }

  stop(): void {
    this.action = null
  }

  /** Pulls the glove hand toward a world point (null releases it). */
  reach(target: THREE.Vector3 | null): void {
    if (target) this.reachTarget = (this.reachTarget ?? new THREE.Vector3()).copy(target)
    else this.reachTarget = null
  }

  update(dt: number, speed: number): void {
    this.time += dt
    this.fade = Math.min(1, this.fade + dt / FADE)
    this.phase = (this.phase + (speed * dt) / STRIDE) % 1
    this.effort += (Math.min(1, Math.max(0, (speed - 4) / 4)) - this.effort) * Math.min(1, dt * 4)
    let pose = blend(basePose(this.previous, this.time, this.phase, this.effort), basePose(this.state, this.time, this.phase, this.effort), this.fade)
    let lowered = 0
    if (this.action) {
      const spec = ACTIONS[this.action.name]
      this.action.elapsed += dt
      const t = Math.min(1, this.action.elapsed / this.action.duration)
      const after = this.action.elapsed - this.action.duration
      const weight = Math.min(1, this.action.elapsed / spec.fadeIn) * (spec.hold || after <= 0 ? 1 : Math.max(0, 1 - after / spec.fadeOut))
      let clip = spec.clip(t, this.time)
      if (this.lefty) clip = Clips.mirror(clip)
      pose = blend(pose, clip, weight)
      if (this.action.name === 'slide') lowered = 0.55 * weight
      if (!spec.hold && after > spec.fadeOut) this.action = null
    }
    const bones = this.rig.bones
    for (const name of BONES) {
      const value = pose[name]
      const bone = bones[name]
      if (!value) {
        bone.quaternion.copy(this.rig.rest[name])
        continue
      }
      euler.set(value[0], value[1], value[2], 'XYZ')
      bone.quaternion.copy(this.rig.rest[name]).multiply(quat.setFromEuler(euler))
    }
    bones.hips.position.y = this.restHips
    this.rig.root.updateMatrixWorld(true)

    this.reachWeight += ((this.reachTarget ? 1 : 0) - this.reachWeight) * Math.min(1, dt * 10)
    if (this.reachTarget && this.reachWeight > 0.01) {
      const side = this.gloveSide
      solveTwoBone(bones[`arm.${side}` as BoneName], bones[`forearm.${side}` as BoneName], bones[`hand.${side}` as BoneName], this.reachTarget, this.reachWeight)
    }

    const parentInverse = new THREE.Matrix4().copy(this.rig.root.parent?.matrixWorld ?? new THREE.Matrix4()).invert()
    let lowest = Infinity
    for (const name of ['foot.L', 'foot.R', 'toe.L', 'toe.R'] as const) {
      vt.setFromMatrixPosition(bones[name].matrixWorld).applyMatrix4(parentInverse)
      lowest = Math.min(lowest, vt.y - (name.startsWith('foot') ? 0.075 : 0.03))
    }
    bones.hips.position.y = this.restHips - lowest - lowered
    this.rig.root.updateMatrixWorld(true)
  }
}
