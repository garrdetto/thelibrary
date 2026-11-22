/**
 * Shared types and helpers for the fixed equipment at work zones: the activity a zone reports, the equipment contract (update
 * every frame, dispose when the player is far away), the environment each builder receives and small geometry helpers for
 * placing a rig on the ground facing a heading.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { ExcavatorPose, LoaderPose } from '../../sim/types'
import type { Zone } from '../../shared/WorldLayout'
import type { ZoneActivity } from '../../game/Procedures'
import type { MaterialLibrary } from '../Materials'
import { MachineRig } from '../models/machine/Hydraulics'

/** What a zone's equipment is doing: the procedure's activity plus the AI machine's pose at dump bays. */
export interface WorkZoneActivity extends ZoneActivity {
  machine?: ExcavatorPose | LoaderPose
}

/** One built piece of zone equipment. */
export interface ZoneEquipment {
  update(dt: number, activity: WorkZoneActivity | undefined): void
  dispose(): void
}

/** What every equipment builder is given. */
export interface EquipmentEnv {
  scene: Scene
  parent: TransformNode
  mats: MaterialLibrary
  zone: Zone
  heightAt: (x: number, z: number) => number
}

const WORKING = new Set(['loading', 'unloading', 'filling', 'draining', 'dumping'])

/** True while the zone's procedure is in a step where the equipment itself works. */
export function isWorking(activity: WorkZoneActivity | undefined): boolean {
  return activity !== undefined && WORKING.has(activity.phase)
}

/** Creates a rig on the ground at `(x, z)` turned to `yaw`. */
export function groundRig(env: EquipmentEnv, name: string, x: number, z: number, yaw: number): MachineRig {
  const rig = new MachineRig(env.scene, env.parent, env.mats, `${name}-${env.zone.id}`)
  rig.root.position.set(x, env.heightAt(x, z), z)
  rig.root.rotation.y = yaw
  return rig
}

/** Where a zone's equipment stands: its `equipment` mark, or the zone centre. */
export function standPoint(zone: Zone): { x: number; z: number; heading: number } {
  return zone.equipment ?? { x: zone.x, z: zone.z, heading: zone.heading }
}

/** Yaw and distance from the stand to the zone's centre line, measured square to the zone heading. */
export function lateralToZone(zone: Zone): { yaw: number; distance: number } {
  const stand = standPoint(zone)
  const fx = Math.sin(zone.heading)
  const fz = Math.cos(zone.heading)
  const vx = zone.x - stand.x
  const vz = zone.z - stand.z
  const along = vx * fx + vz * fz
  let lx = vx - along * fx
  let lz = vz - along * fz
  let distance = Math.hypot(lx, lz)
  if (distance < 0.5) {
    lx = fz
    lz = -fx
    distance = 4
  }
  return { yaw: Math.atan2(lx, lz), distance }
}

/** Smooth 0..1 ease. */
export function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  return c * c * (3 - 2 * c)
}
