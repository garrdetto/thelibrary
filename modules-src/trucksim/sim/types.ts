/**
 * What the physics hands the renderer and the game each frame, and what the controls hand the physics. Plain data, no Rapier or
 * Babylon types, so `render/` and `ui/` never import Rapier and `sim/` never imports Babylon.
 * World frame: metres, Y up, right-handed. Vehicle frame: origin on the ground under the front axle (trucks) or kingpin
 * (trailers), +Z forward, +X to the driver's left.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Quat {
  x: number
  y: number
  z: number
  w: number
}

export interface BodyPose {
  position: Vec3
  rotation: Quat
}

/** One wheel, in the vehicle frame: the hub centre after suspension travel, plus steer (rad, + left) and spin (rad). */
export interface WheelPose {
  x: number
  y: number
  z: number
  steer: number
  spin: number
  radius: number
  dual: boolean
  /** True while a lift axle is raised off the road. */
  lifted: boolean
}

export interface TruckPose extends BodyPose {
  wheels: WheelPose[]
  /** Dump bed angle in radians (0 down). */
  dumpAngle: number
  /** Tailgate swing 0 shut … 1 open. */
  tailgate: number
  brakeLights: boolean
  reversing: boolean
  headlights: boolean
  /** 0 … 1 exhaust load, for smoke and sound. */
  load: number
}

export interface GooseneckPose extends BodyPose {
  /** True while the neck is pinned to the deck; false once detached and riding on the tractor. */
  attached: boolean
}

export interface TrailerPose extends BodyPose {
  wheels: WheelPose[]
  /** Landing gear 0 up … 1 down. */
  landingGear: number
  /** Lowboy only: the gooseneck's world transform. */
  gooseneck: GooseneckPose | null
  /** Reefer doors, hopper gates or tarp: 0 shut … 1 open. */
  doors: number
  brakeLights: boolean
}

export interface ExcavatorPose extends BodyPose {
  /** Upper-house swing (rad, + left), boom, stick and bucket angles (rad) and track travel (m) for tread scrolling. */
  swing: number
  boom: number
  stick: number
  bucket: number
  trackL: number
  trackR: number
  /** How full the bucket is (0 … 1), so the load shows in it. */
  fill?: number
}

export interface LoaderPose extends BodyPose {
  /** Wheel loader lift-arm and bucket angles (rad) and wheel spin (rad). */
  arm: number
  bucket: number
  spin: number
  steer: number
}

export interface DriveInput {
  /** 0 … 1 */
  throttle: number
  /** 0 … 1 service brake */
  brake: number
  /** -1 … 1, + is left */
  steer: number
  parkingBrake: boolean
  engineBrake: boolean
  /** Edge-triggered: true for the one update after the key went down. */
  shiftUp: boolean
  shiftDown: boolean
}

export function emptyInput(): DriveInput {
  return { throttle: 0, brake: 0, steer: 0, parkingBrake: false, engineBrake: false, shiftUp: false, shiftDown: false }
}

export interface MachineInput {
  /** Tracks: -1 … 1 forward/back and turn (+ left). */
  drive: number
  turn: number
  /** Arm controls, -1 … 1 each. */
  swing: number
  boom: number
  stick: number
  bucket: number
}

export function emptyMachineInput(): MachineInput {
  return { drive: 0, turn: 0, swing: 0, boom: 0, stick: 0, bucket: 0 }
}

/** Forward unit vector of a heading. */
export function headingVector(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: Math.cos(heading) }
}

/** Heading of a body's +Z axis from its rotation quaternion. */
export function headingOf(q: Quat): number {
  const fx = 2 * (q.x * q.z + q.w * q.y)
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y)
  return Math.atan2(fx, fz)
}

/** Rotates a vehicle-frame point by a pose into the world. */
export function toWorld(pose: BodyPose, local: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const { x: qx, y: qy, z: qz, w: qw } = pose.rotation
  const { x, y, z } = local
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy + pose.position.x
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz + pose.position.y
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx + pose.position.z
  return out
}
