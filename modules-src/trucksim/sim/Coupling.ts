/**
 * Coupling a tractor to a trailer, the way it is done for real: back the fifth wheel under the kingpin (within 0.35 m, the
 * trailer's plate from 6 cm below to 12 cm above the fifth wheel, within 25° and under 1 m/s) and the jaws lock with a
 * spherical joint that starts with no error and draws the kingpin onto the fifth wheel gently; uncoupling is refused until the
 * landing gear is down. The RGN lowboy's gooseneck: `detachNeck` lowers the deck front onto the ground and leaves the neck on
 * the tractor; `attachNeck` (neck rear within 0.4 m and 10° of the deck front) lifts the deck back over 1.5 s and joins.
 */
import { headingOf } from './types'
import type { BodyPose, Vec3 } from './types'
import type { TrailerRig } from './TrailerRig'
import type { TruckRig } from './TruckRig'

/** Most the kingpin may be from the fifth wheel's centre (horizontally) to couple, m. */
export const COUPLE_DISTANCE = 0.35
/** Lowest the kingpin plate may sit relative to the fifth wheel, m. */
export const COUPLE_HEIGHT_LOW = -0.06
/** Highest the kingpin plate may sit relative to the fifth wheel, m. */
export const COUPLE_HEIGHT_HIGH = 0.12
/** Largest heading difference for coupling, degrees. */
export const COUPLE_ANGLE_DEG = 25
/** Fastest either vehicle may move while coupling or uncoupling, m/s. */
export const COUPLE_SPEED = 1
/** Most the gooseneck's rear may be from the deck front to reattach, m. */
export const NECK_DISTANCE = 0.4
/** Largest heading difference for reattaching the gooseneck, degrees. */
export const NECK_ANGLE_DEG = 10
/** Fastest the rig may move while detaching or reattaching the gooseneck, m/s. */
export const NECK_SPEED = 0.5

/** Why a coupling action was refused (`COUPLING_MESSAGES` has the words). */
export type CouplingReason =
  | 'too-far' | 'too-high' | 'too-low' | 'angle' | 'moving'
  | 'no-fifth-wheel' | 'coupled' | 'not-coupled' | 'busy' | 'gear-up'
  | 'not-lowboy' | 'neck-detached' | 'not-detached'

/** Plain words for every refusal, for the HUD's prompt line. */
export const COUPLING_MESSAGES: Record<CouplingReason, string> = {
  'too-far': 'Line the fifth wheel up under the kingpin',
  'too-high': 'The trailer is too high: lower the landing gear',
  'too-low': 'The trailer is too low: raise the landing gear',
  angle: 'Straighten up with the trailer',
  moving: 'Stop first',
  'no-fifth-wheel': 'This truck has no fifth wheel',
  coupled: 'Already coupled',
  'not-coupled': 'Not coupled to this trailer',
  busy: 'Wait for the coupling to finish',
  'gear-up': 'Lower the landing gear first',
  'not-lowboy': 'Only the lowboy has a removable gooseneck',
  'neck-detached': 'Reattach the gooseneck first',
  'not-detached': 'The gooseneck is not detached',
}

/** The fifth-wheel geometry check and its verdict. */
export interface CoupleCheck {
  ok: boolean
  /** Horizontal distance from the fifth wheel to the kingpin, m. */
  distance: number
  /** Kingpin plate height minus fifth-wheel height, m. */
  heightError: number
  /** Heading difference, degrees. */
  angleDeg: number
  /** Faster of the two, m/s. */
  speed: number
  reason?: CouplingReason
}

/** The gooseneck line-up check and its verdict. */
export interface NeckCheck {
  ok: boolean
  /** Horizontal distance from the neck's rear (on the tractor) to the deck front, m. */
  distance: number
  angleDeg: number
  speed: number
  reason?: CouplingReason
}

/** Whether an action happened, and why not. */
export interface CouplingResult {
  ok: boolean
  reason?: CouplingReason
}

const DEG = 180 / Math.PI

function angleBetween(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return Math.abs(d) * DEG
}

/** Speed of a body, m/s. */
function bodySpeed(rig: { body: { linvel(): { x: number; y: number; z: number } } }): number {
  const v = rig.body.linvel()
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

/** World point into a body's frame. */
export function worldToLocal(pose: BodyPose, point: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const { x: qx, y: qy, z: qz, w: qw } = pose.rotation
  const x = point.x - pose.position.x
  const y = point.y - pose.position.y
  const z = point.z - pose.position.z
  const ix = qw * x - qy * z + qz * y
  const iy = qw * y - qz * x + qx * z
  const iz = qw * z - qx * y + qy * x
  const iw = qx * x + qy * y + qz * z
  out.x = ix * qw + iw * qx + iy * qz - iz * qy
  out.y = iy * qw + iw * qy + iz * qx - ix * qz
  out.z = iz * qw + iw * qz + ix * qy - iy * qx
  return out
}

/** The coupling rules on plain numbers: fifth wheel and kingpin positions (world), headings (rad) and speed (m/s). */
export function evaluateCouple(fifth: Vec3, truckHeading: number, kingpin: Vec3, trailerHeading: number, speed: number, out?: CoupleCheck): CoupleCheck {
  const result = out ?? { ok: false, distance: 0, heightError: 0, angleDeg: 0, speed: 0 }
  const dx = kingpin.x - fifth.x
  const dz = kingpin.z - fifth.z
  result.distance = Math.sqrt(dx * dx + dz * dz)
  result.heightError = kingpin.y - fifth.y
  result.angleDeg = angleBetween(truckHeading, trailerHeading)
  result.speed = speed
  result.reason = undefined
  if (result.distance > COUPLE_DISTANCE) result.reason = 'too-far'
  else if (result.heightError > COUPLE_HEIGHT_HIGH) result.reason = 'too-high'
  else if (result.heightError < COUPLE_HEIGHT_LOW) result.reason = 'too-low'
  else if (result.angleDeg > COUPLE_ANGLE_DEG) result.reason = 'angle'
  else if (speed > COUPLE_SPEED) result.reason = 'moving'
  result.ok = result.reason === undefined
  return result
}

const fifthScratch: Vec3 = { x: 0, y: 0, z: 0 }
const kingpinScratch: Vec3 = { x: 0, y: 0, z: 0 }
const localScratch: Vec3 = { x: 0, y: 0, z: 0 }
const worldScratch: Vec3 = { x: 0, y: 0, z: 0 }

/** Can `truck` couple to `trailer` right now? */
export function checkCouple(truck: TruckRig, trailer: TrailerRig, out?: CoupleCheck): CoupleCheck {
  const fifth = truck.fifthWheelWorld(fifthScratch)
  const kingpin = trailer.kingpinWorld(kingpinScratch)
  const truckHeading = headingOf(truck.readState().rotation)
  const trailerHeading = headingOf(trailer.readState().rotation)
  const result = evaluateCouple(fifth, truckHeading, kingpin, trailerHeading, Math.max(bodySpeed(truck), bodySpeed(trailer)), out)
  let blocker: CouplingReason | undefined
  if (truck.model.fifthWheelZ === undefined) blocker = 'no-fifth-wheel'
  else if (truck.trailer || trailer.tractor || trailer.joint) blocker = 'coupled'
  if (blocker) {
    result.reason = blocker
    result.ok = false
  }
  return result
}

/** Locks the jaws when `checkCouple` passes; the joint then draws the kingpin onto the fifth wheel over a moment. */
export function couple(truck: TruckRig, trailer: TrailerRig): CoupleCheck {
  const check = checkCouple(truck, trailer)
  if (!check.ok) return check
  const anchor = worldToLocal(truck.readState(), trailer.kingpinWorld(kingpinScratch), localScratch)
  trailer.joinTo(truck, anchor, false)
  return check
}

/** Pulls the release: refused while the landing gear is not fully down or the rig is moving. */
export function uncouple(truck: TruckRig, trailer: TrailerRig): CouplingResult {
  if (!trailer.joint || trailer.tractor !== truck) return { ok: false, reason: trailer.tractor === truck ? 'neck-detached' : 'not-coupled' }
  if (trailer.neckState !== 'attached') return { ok: false, reason: 'neck-detached' }
  if (trailer.gear < 0.999) return { ok: false, reason: 'gear-up' }
  if (Math.max(bodySpeed(truck), bodySpeed(trailer)) > COUPLE_SPEED) return { ok: false, reason: 'moving' }
  trailer.unjoin(false)
  return { ok: true }
}

/** Lowers the RGN's deck front onto the ground and detaches the gooseneck, which stays on the tractor. */
export function detachNeck(truck: TruckRig, trailer: TrailerRig): CouplingResult {
  if (!trailer.isLowboy) return { ok: false, reason: 'not-lowboy' }
  if (!trailer.joint || trailer.tractor !== truck) return { ok: false, reason: 'not-coupled' }
  if (trailer.neckState !== 'attached') return { ok: false, reason: 'neck-detached' }
  if (trailer.coupling === 'snapping') return { ok: false, reason: 'busy' }
  if (Math.max(bodySpeed(truck), bodySpeed(trailer)) > NECK_SPEED) return { ok: false, reason: 'moving' }
  trailer.startLowering()
  return { ok: true }
}

/** Is the gooseneck on `truck` lined up with the detached RGN deck closely enough to reattach? */
export function checkNeck(truck: TruckRig, trailer: TrailerRig): NeckCheck {
  const result: NeckCheck = { ok: false, distance: Infinity, angleDeg: 180, speed: 0 }
  const rgn = trailer.model.rgn
  if (!trailer.isLowboy || !rgn) return { ...result, reason: 'not-lowboy' }
  if (trailer.tractor !== truck) return { ...result, reason: 'not-coupled' }
  if (trailer.neckState !== 'detached') return { ...result, reason: 'not-detached' }
  localScratch.x = 0
  localScratch.y = 0
  localScratch.z = truck.fifthWheelLocal.z + rgn.neckRearZ
  const neckRear = truck.localToWorld(localScratch, worldScratch)
  localScratch.z = rgn.neckRearZ
  const deckFront = trailer.localToWorld(localScratch, fifthScratch)
  const dx = neckRear.x - deckFront.x
  const dz = neckRear.z - deckFront.z
  result.distance = Math.sqrt(dx * dx + dz * dz)
  result.angleDeg = angleBetween(headingOf(truck.readState().rotation), headingOf(trailer.readState().rotation))
  result.speed = Math.max(bodySpeed(truck), bodySpeed(trailer))
  if (result.distance > NECK_DISTANCE) result.reason = 'too-far'
  else if (result.angleDeg > NECK_ANGLE_DEG) result.reason = 'angle'
  else if (result.speed > NECK_SPEED) result.reason = 'moving'
  result.ok = result.reason === undefined
  return result
}

/** Reattaches the gooseneck when `checkNeck` passes: the deck lifts over 1.5 s, then the neck is pinned and the rig is whole. */
export function attachNeck(truck: TruckRig, trailer: TrailerRig): NeckCheck {
  const check = checkNeck(truck, trailer)
  if (!check.ok) return check
  const anchor = worldToLocal(truck.readState(), trailer.kingpinWorld(kingpinScratch), localScratch)
  trailer.joinTo(truck, anchor, true)
  return check
}
