/** The bow's sight, built in code: a thin round housing on a short bar off the riser, open with no lens, and a tiny glowing arrow standing up from the bottom of the ring with its tip at the centre. Aiming looks through the ring from `SIGHT_EYE`, so the arrow's tip sits on the target. */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'

/** Centre of the sight ring in bow space (+z toward the target, +x to the right of the riser, y up from the grip). */
export const SIGHT_RING = new Vector3(0.045, 0.125, 0.15)
/** Where the shooter's eye sits behind a drawn bow (bow space): at anchor, in line with the ring. */
export const SIGHT_EYE = new Vector3(0.045, 0.125, -0.74)

/** Outer diameter of the housing, and how thick its wall is. */
export const RING_DIAMETER = 0.062
const RING_TUBE = 0.0032
/** The pin: a thin glowing shaft from the bottom of the ring up to an arrowhead whose tip is the ring's centre. */
const PIN_RADIUS = 0.0005
const HEAD_LENGTH = 0.0056
const HEAD_WIDTH = 0.0044
const PIN_GLOW = new Color3(0.35, 1.0, 0.25)

/** Builds the sight onto `bow` (the bow rig's root) and returns its meshes. */
export function mountBowSight(scene: Scene, bow: TransformNode): AbstractMesh[] {
  const mount = new TransformNode('bow-sight', scene)
  mount.parent = bow
  mount.position.copyFrom(SIGHT_RING)

  const metal = new StandardMaterial('rr-bow-sight-metal', scene)
  metal.diffuseColor = new Color3(0.05, 0.05, 0.055)
  metal.specularColor = new Color3(0.3, 0.3, 0.3)
  metal.specularPower = 40
  metal.emissiveColor = new Color3(0.02, 0.02, 0.022)

  const bar = CreateBox('bow-sight-bar', { width: SIGHT_RING.x, height: 0.012, depth: 0.012 }, scene)
  bar.material = metal
  bar.parent = bow
  bar.position.set(SIGHT_RING.x / 2, SIGHT_RING.y - 0.04, (SIGHT_RING.z + 0.03) / 2)
  bar.scaling.z = (SIGHT_RING.z - 0.03) / 0.012

  const post = CreateBox('bow-sight-post', { width: 0.006, height: 0.04 + RING_TUBE, depth: 0.006 }, scene)
  post.material = metal
  post.parent = mount
  post.position.set(0, -RING_DIAMETER / 2 - 0.012, 0)

  const ring = CreateTorus('bow-sight-ring', { diameter: RING_DIAMETER - RING_TUBE, thickness: RING_TUBE, tessellation: 48 }, scene)
  ring.material = metal
  ring.parent = mount
  ring.rotation.x = Math.PI / 2

  const glow = new StandardMaterial('rr-bow-sight-glow', scene)
  glow.diffuseColor = Color3.Black()
  glow.specularColor = Color3.Black()
  glow.emissiveColor = PIN_GLOW
  glow.disableLighting = true
  const shaftLength = RING_DIAMETER / 2 - RING_TUBE / 2 - HEAD_LENGTH
  const pin = CreateCylinder('bow-sight-pin', { height: shaftLength, diameter: PIN_RADIUS * 2, tessellation: 8 }, scene)
  pin.material = glow
  pin.parent = mount
  pin.position.set(0, -HEAD_LENGTH - shaftLength / 2, 0.004)
  const head = CreateCylinder('bow-sight-head', { height: HEAD_LENGTH, diameterTop: 0, diameterBottom: HEAD_WIDTH, tessellation: 4 }, scene)
  head.material = glow
  head.parent = mount
  head.position.set(0, -HEAD_LENGTH / 2, 0.004)
  head.rotation.y = Math.PI / 4

  const meshes: Mesh[] = [bar, post, ring, pin, head]
  for (const m of meshes) {
    m.isPickable = false
    m.alwaysSelectAsActiveMesh = true
    m.receiveShadows = false
  }
  return meshes
}
