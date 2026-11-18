import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'

export type DeckSeat = 0 | 1 | 2 | 3

export const CONSOLE_SEAT = new Vector3(0.6, 1.16, -1.14)
export const PASSENGER_SEAT = new Vector3(-0.6, 1.16, -1.14)
/** The four pedestal fishing seats: two on the front deck, two on the rear deck (the console and passenger seats are separate). */
export const DECK_SEATS: readonly Vector3[] = [new Vector3(-0.41, 1.28, 2.0), new Vector3(0.41, 1.28, 2.0), new Vector3(-0.5, 1.25, -2.07), new Vector3(0.5, 1.25, -2.07)]
export const DECK_SEAT_NAMES = ['front left', 'front right', 'rear left', 'rear right'] as const
export const ANCHOR_MAX_SPEED = 2
export const BOARD_RANGE = 4.5
export const BOARD_MAX_SPEED = 1.5
export const SWIVEL_RATE = 6

/** The seat a crew member takes opposite the captain: corner to corner, so their casts stay apart. */
export function otherSeat(seat: DeckSeat): DeckSeat {
  return (3 - seat) as DeckSeat
}

/** F walks the captain round the four fishing seats in turn. */
export function nextSeat(seat: DeckSeat): DeckSeat {
  return ((seat + 1) % DECK_SEATS.length) as DeckSeat
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
  const path = [new Vector3(0, 0.92, 3.46), new Vector3(0, 0.66, 3.96), new Vector3(0, 0.25, 4.56), new Vector3(0, -0.6, 5.46)]
  const rope = CreateTube('anchor-line', { path, radius: 0.011, tessellation: 6, cap: 0 }, scene)
  rope.material = ropeMaterial
  rope.parent = boat
  rope.isPickable = false
  rope.setEnabled(false)
  return rope
}
