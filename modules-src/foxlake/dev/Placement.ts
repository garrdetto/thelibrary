/**
 * Where the developer panel puts a spawned vehicle, in the shared world's
 * (town) coordinates: right-handed, +y up, a chassis whose +x is forward and
 * +z is right, turned `yaw` about +y (forward at yaw 0 is +x, the same
 * convention as fp/physics/Vehicle.ts and Parking.ts). Renderer-free.
 */
import type { SpawnPose } from '../../maplestreet/shared/Protocol'
import { rideHeight, type VehicleTuning } from '../../maplestreet/shared/Vehicles'

/** Ground height under a town point. */
export type Ground = (x: number, z: number) => number

export interface Spot {
  x: number
  z: number
}

/** The chassis yaw of something facing a Rack & Reel heading (forward is (sin h, cos h) in the scene, whose z is the town's mirrored). */
export function yawFromHeading(heading: number): number {
  return Math.PI / 2 - heading
}

/** The chassis yaw of something facing a town yaw (a player snapshot's: forward is (sin y, cos y)). */
export function yawFromTownYaw(yaw: number): number {
  return yaw - Math.PI / 2
}

/**
 * Spots to try, in order, for a vehicle next to someone at (x, z) who faces `yaw`: a few metres ahead of them first
 * (`ahead`, for the administrator's own spawn), or beside them first (for another player).
 */
export function spotsAround(x: number, z: number, yaw: number, tuning: VehicleTuning, first: 'ahead' | 'beside'): Spot[] {
  const fx = Math.cos(yaw)
  const fz = -Math.sin(yaw)
  const rx = Math.sin(yaw)
  const rz = Math.cos(yaw)
  const along = tuning.chassis.hx + 3.5
  const across = tuning.chassis.hz + 2.2
  const ahead = { x: x + fx * along, z: z + fz * along }
  const behind = { x: x - fx * along, z: z - fz * along }
  const right = { x: x + rx * across, z: z + rz * across }
  const left = { x: x - rx * across, z: z - rz * across }
  return first === 'ahead' ? [ahead, right, left, behind] : [right, left, ahead, behind]
}

/**
 * A vehicle at rest on the ground at (x, z): its centre a ride height above the ground and its body laid on the
 * slope under its four corners, so it sits right before anyone has driven it.
 */
export function restingPose(ground: Ground, x: number, z: number, yaw: number, tuning: VehicleTuning): SpawnPose {
  const fx = Math.cos(yaw)
  const fz = -Math.sin(yaw)
  const rx = Math.sin(yaw)
  const rz = Math.cos(yaw)
  const l = Math.max(0.4, tuning.chassis.hx * 0.8)
  const w = Math.max(0.3, tuning.chassis.hz)
  const front = ground(x + fx * l, z + fz * l)
  const back = ground(x - fx * l, z - fz * l)
  const right = ground(x + rx * w, z + rz * w)
  const left = ground(x - rx * w, z - rz * w)
  const f = unit(fx * 2 * l, front - back, fz * 2 * l)
  const side = unit(rx * 2 * w, right - left, rz * 2 * w)
  const u = unit(side.y * f.z - side.z * f.y, side.z * f.x - side.x * f.z, side.x * f.y - side.y * f.x)
  const r = { x: f.y * u.z - f.z * u.y, y: f.z * u.x - f.x * u.z, z: f.x * u.y - f.y * u.x }
  const q = quaternionFromAxes(f, u, r)
  const y = Math.max((front + back + right + left) / 4, ground(x, z)) + rideHeight(tuning) + 0.03
  return { x, y, z, qx: q.x, qy: q.y, qz: q.z, qw: q.w }
}

function unit(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const n = Math.hypot(x, y, z) || 1
  return { x: x / n, y: y / n, z: z / n }
}

/** The rotation that takes the x, y and z axes to three perpendicular unit vectors. */
function quaternionFromAxes(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }): { x: number; y: number; z: number; w: number } {
  const trace = a.x + b.y + c.z
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    return { w: 0.25 / s, x: (b.z - c.y) * s, y: (c.x - a.z) * s, z: (a.y - b.x) * s }
  }
  if (a.x > b.y && a.x > c.z) {
    const s = 2 * Math.sqrt(1 + a.x - b.y - c.z)
    return { w: (b.z - c.y) / s, x: 0.25 * s, y: (b.x + a.y) / s, z: (c.x + a.z) / s }
  }
  if (b.y > c.z) {
    const s = 2 * Math.sqrt(1 + b.y - a.x - c.z)
    return { w: (c.x - a.z) / s, x: (b.x + a.y) / s, y: 0.25 * s, z: (c.y + b.z) / s }
  }
  const s = 2 * Math.sqrt(1 + c.z - a.x - b.y)
  return { w: (a.y - b.x) / s, x: (c.x + a.z) / s, y: (c.y + b.z) / s, z: 0.25 * s }
}

/** "4:07" from milliseconds left. */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
