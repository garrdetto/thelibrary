import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Avatar, AvatarHands } from './Avatar'

/** The rod sits in the right palm, blank angled up out of the fist: where its grip rides from the palm's centre (forearm frame), and its tilt. */
export const ROD_IN_HAND = { fromPalm: new Vector3(0.005, 0.021, 0.001), pitch: 0.55 }
/** Where the left hand cups the rod butt for a two-handed cast (rod frame). */
export const ROD_BUTT = new Vector3(0, -0.012, -0.205)
/** The reel's crank hub and knob arm (rod frame), matching the reel `RodFx` builds. */
export const REEL_HUB = new Vector3(-0.05, -0.065, 0.06)
export const REEL_ARM = 0.055
/** The left palm sits just outboard of the knob it pinches. */
const KNOB_PALM = -0.034
/** Knob angle while waiting on a bite: handle down and forward, ready to turn. */
export const WAIT_CRANK = 2.3

/** Rifle grip points (rifle frame): the right palm on the wrist of the stock, the left under the fore-end. */
export const RIFLE_GRIP = new Vector3(0.03, -0.045, -0.15)
export const RIFLE_FOREEND = new Vector3(0, -0.06, 0.25)
/** Distance from the rifle origin back to the butt plate. */
export const RIFLE_BUTT = 0.42

/** Rifle on the shoulder: butt in the pocket of the right shoulder of a side-on shooter (avatar frame). */
export const RIFLE_SHOULDERED = new Vector3(0.09, 1.46, -0.12)
/** Rifle carried at port arms across the chest, muzzle up and left (avatar frame position and pitch/yaw/roll). */
export const RIFLE_CARRY = { position: new Vector3(0.05, 1.2, 0.27), pitch: -0.95, yaw: -0.4, roll: -0.45 }

export function placeRodInHand(rodRoot: TransformNode, avatar: Avatar): void {
  const palm = avatar.palmOffset('right')
  rodRoot.position.set(palm[0] + ROD_IN_HAND.fromPalm.x, palm[1] + ROD_IN_HAND.fromPalm.y, palm[2] + ROD_IN_HAND.fromPalm.z)
  rodRoot.rotationQuaternion = null
  rodRoot.rotation.set(ROD_IN_HAND.pitch, 0, 0)
}

/** The reel knob's centre in the rod frame for a crank angle (the crank turns about the rod frame's x axis). */
export function reelKnob(crank: number, out: Vector3): Vector3 {
  return out.set(REEL_HUB.x + KNOB_PALM, REEL_HUB.y - REEL_ARM * Math.cos(crank), REEL_HUB.z - REEL_ARM * Math.sin(crank))
}

/** Where the left hand goes on the rod for a pose (rod frame), or null when it hangs free. */
export function rodSupport(hands: AvatarHands, crank: number, out: Vector3): Vector3 | null {
  if (hands === 'cast') return out.copyFrom(ROD_BUTT)
  if (hands === 'reel') return reelKnob(crank, out)
  if (hands === 'fish') return reelKnob(WAIT_CRANK, out)
  return null
}

/** Places the rifle in the avatar frame: on the shoulder along the aim pitch, or carried at port arms. */
export function placeRifle(rifleRoot: TransformNode, avatar: Avatar, aiming: boolean, aimPitch: number, recoil: number): void {
  if (rifleRoot.parent !== avatar.root) rifleRoot.parent = avatar.root
  const q = rifleRoot.rotationQuaternion ?? (rifleRoot.rotationQuaternion = new Quaternion())
  const drop = avatar.hipDrop
  if (aiming) {
    const pitch = aimPitch - recoil * 0.12
    Quaternion.FromEulerAnglesToRef(pitch, 0, 0, q)
    const c = Math.cos(pitch)
    const back = RIFLE_BUTT - recoil * 0.06
    rifleRoot.position.set(RIFLE_SHOULDERED.x, RIFLE_SHOULDERED.y + drop - Math.sin(pitch) * back, RIFLE_SHOULDERED.z + c * back)
  } else {
    Quaternion.FromEulerAnglesToRef(RIFLE_CARRY.pitch, RIFLE_CARRY.yaw, RIFLE_CARRY.roll, q)
    rifleRoot.position.copyFrom(RIFLE_CARRY.position).addInPlaceFromFloats(0, drop, 0)
  }
}

/**
 * Puts the hunter's hands on whatever they hold this frame: both palms on the rifle, or the left hand on the rod
 * butt or reel knob (the rod is already in the right hand). Call after the avatar's pose and the gear are placed;
 * reading the right palm first brings the avatar's world matrices up to date for the gear below it.
 */
export class GearHands {
  private readonly right = new Vector3()
  private readonly left = new Vector3()

  apply(dt: number, avatar: Avatar, hands: AvatarHands, gear: { rod?: TransformNode | null; rifle?: TransformNode | null; crank?: number }): void {
    if ((hands === 'rifle' || hands === 'aim') && gear.rifle?.isEnabled()) {
      avatar.palm('right', this.right)
      const m = gear.rifle.computeWorldMatrix(true)
      Vector3.TransformCoordinatesToRef(RIFLE_GRIP, m, this.right)
      Vector3.TransformCoordinatesToRef(RIFLE_FOREEND, m, this.left)
      avatar.solveHands(dt, this.right, this.left)
      return
    }
    if (gear.rod?.isEnabled()) {
      const local = rodSupport(hands, gear.crank ?? 0, this.left)
      if (local) {
        avatar.palm('right', this.right)
        Vector3.TransformCoordinatesToRef(local, gear.rod.computeWorldMatrix(true), this.left)
        avatar.solveHands(dt, null, this.left)
        return
      }
    }
    avatar.solveHands(dt, null, null)
  }
}
