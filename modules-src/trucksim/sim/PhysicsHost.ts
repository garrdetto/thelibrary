/**
 * What every rig in `sim/` needs from the world it drives in. Standalone Truck Simulator implements it with `SimWorld`
 * (its own Rapier world and streamed terrain); Life Sim can implement it over its town `Physics` (the Fox Plains Rapier world,
 * right-handed town frame) so the same trucks, trailers and machines drive through Montello unchanged.
 *
 * The collision groups use Life Sim's bit layout (`modules-src/foxlake/fp/physics/Physics.ts` `CG` / `MASK`); a test keeps
 * them equal.
 */
import type RAPIER from '@dimforge/rapier3d-compat'

export const CG = {
  GROUND: 1 << 0, STATIC: 1 << 1, VEHICLE: 1 << 2, CHARACTER: 1 << 3, REMOTE: 1 << 4, PROP: 1 << 5, DECK: 1 << 6,
} as const

export const groups = (member: number, filter: number): number => ((member & 0xffff) << 16) | (filter & 0xffff)

export const MASK = {
  ground: groups(CG.GROUND, 0xffff),
  static: groups(CG.STATIC, 0xffff),
  vehicle: groups(CG.VEHICLE, CG.GROUND | CG.STATIC | CG.VEHICLE | CG.CHARACTER | CG.REMOTE | CG.PROP),
  trailer: groups(CG.VEHICLE | CG.DECK, CG.GROUND | CG.STATIC | CG.VEHICLE | CG.CHARACTER | CG.REMOTE | CG.PROP),
  wheelRay: groups(CG.VEHICLE, CG.GROUND | CG.STATIC | CG.PROP | CG.DECK),
} as const

export interface PhysicsGroups {
  /** Tractor and dump-truck chassis. */
  chassis: number
  /** Trailer bodies and decks (a machine can drive up onto a `DECK`). */
  trailer: number
  /** Wheel ray filter for the ray-cast vehicle controllers. */
  wheelRay: number
  /** Tracked machines (excavator), which collide like vehicles and can climb decks. */
  machine: number
}

export const DEFAULT_GROUPS: PhysicsGroups = { chassis: MASK.vehicle, trailer: MASK.trailer, wheelRay: MASK.wheelRay, machine: MASK.vehicle }

export interface PhysicsHost {
  readonly rapier: typeof RAPIER
  readonly world: RAPIER.World
  readonly groups: PhysicsGroups
  /** Ground height in this host's frame, for spawning, resets and AI; colliders are the host's business. */
  heightAt(x: number, z: number): number
  /** Tyre grip multiplier at (x, z), 1 for asphalt. */
  gripAt(x: number, z: number): number
}
