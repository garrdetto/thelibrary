/** The bow's sight, built in code: a thin round housing on a short bar off the riser, a see-through lens inside it, and one fibre-optic pin standing up from the bottom of the ring to a glowing point at its centre. Aiming looks through the ring from `SIGHT_EYE`, so the point sits on the target. */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
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
/** The lens is clear glass: all but invisible, with just a glint off its face (mesh visibility, which this scene blends; material alpha isn't honoured here). */
const LENS_VISIBILITY = 0.12
/** The pin: a fibre from the bottom of the ring up to the centre, ending in a bright bead. */
const PIN_RADIUS = 0.0006
const PIN_BEAD = 0.0017
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

  const glass = new StandardMaterial('rr-bow-sight-glass', scene)
  glass.diffuseColor = new Color3(0.9, 0.92, 0.94)
  glass.specularColor = Color3.White()
  glass.specularPower = 200
  glass.emissiveColor = new Color3(0.04, 0.04, 0.045)
  glass.backFaceCulling = false
  glass.twoSidedLighting = true
  const lens = CreateDisc('bow-sight-lens', { radius: RING_DIAMETER / 2 - RING_TUBE * 0.9, tessellation: 48 }, scene)
  lens.material = glass
  lens.parent = mount
  lens.visibility = LENS_VISIBILITY
  lens.alphaIndex = 2

  const fibre = new StandardMaterial('rr-bow-sight-fibre', scene)
  fibre.diffuseColor = new Color3(0.12, 0.3, 0.1)
  fibre.emissiveColor = PIN_GLOW.scale(0.35)
  fibre.specularColor = Color3.Black()
  const pinLength = RING_DIAMETER / 2 - RING_TUBE / 2
  const pin = CreateCylinder('bow-sight-pin', { height: pinLength, diameter: PIN_RADIUS * 2, tessellation: 8 }, scene)
  pin.material = fibre
  pin.parent = mount
  pin.position.set(0, -pinLength / 2, 0.004)

  const glow = new StandardMaterial('rr-bow-sight-glow', scene)
  glow.diffuseColor = Color3.Black()
  glow.specularColor = Color3.Black()
  glow.emissiveColor = PIN_GLOW
  glow.disableLighting = true
  const bead = CreateSphere('bow-sight-bead', { diameter: PIN_BEAD * 2, segments: 8 }, scene)
  bead.material = glow
  bead.parent = mount
  bead.position.set(0, 0, 0.004)

  const meshes: Mesh[] = [bar, post, ring, lens, pin, bead]
  for (const m of meshes) {
    m.isPickable = false
    m.alwaysSelectAsActiveMesh = true
    m.receiveShadows = false
  }
  return meshes
}
