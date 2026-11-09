import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'

export type DeckSeat = 0 | 1

export const CONSOLE_SEAT = new Vector3(0.55, 0.69, -0.92)
export const PASSENGER_SEAT = new Vector3(-0.55, 0.69, -0.92)
export const DECK_SEATS: readonly Vector3[] = [new Vector3(0, 1.095, 1.72), new Vector3(0, 1.045, -2.23)]
export const DECK_SEAT_NAMES = ['front deck', 'rear deck'] as const
export const ANCHOR_MAX_SPEED = 2
export const BOARD_RANGE = 4.5
export const BOARD_MAX_SPEED = 1.5
export const SWIVEL_RATE = 6

export function otherSeat(seat: DeckSeat): DeckSeat {
  return seat === 0 ? 1 : 0
}

export function swivelToward(current: number, cameraYaw: number, boatHeading: number, dt: number): number {
  const target = cameraYaw - boatHeading
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * Math.min(1, dt * SWIVEL_RATE)
}

let ropeMaterial: StandardMaterial | null = null

export function createAnchorLine(scene: Scene, boat: TransformNode): Mesh {
  if (!ropeMaterial || ropeMaterial.getScene() !== scene) {
    ropeMaterial = new StandardMaterial('rr-anchor-rope', scene)
    ropeMaterial.diffuseColor = new Color3(0.52, 0.45, 0.33)
    ropeMaterial.specularColor = new Color3(0.03, 0.03, 0.03)
  }
  const path = [new Vector3(0, 0.84, 2.84), new Vector3(0, 0.62, 3.25), new Vector3(0, 0.25, 3.75), new Vector3(0, -0.6, 4.5)]
  const rope = CreateTube('anchor-line', { path, radius: 0.011, tessellation: 6, cap: 0 }, scene)
  rope.material = ropeMaterial
  rope.parent = boat
  rope.isPickable = false
  rope.setEnabled(false)
  return rope
}
