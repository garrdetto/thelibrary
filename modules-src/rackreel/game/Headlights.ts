import { SpotLight } from '@babylonjs/core/Lights/spotLight'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'

/** Where the side-by-side's two headlamps sit on its model (metres, model frame: +z forward). */
export const UTV_LAMPS: readonly Vector3[] = [new Vector3(0.52, 1.02, 1.47), new Vector3(-0.52, 1.02, 1.47)]
export const HEADLIGHT = {
  /** The beam: one spot light between the lamps, aimed a little down the trail. */
  origin: new Vector3(0, 1.05, 1.55),
  aim: new Vector3(0, -0.14, 1),
  angle: 1.05,
  exponent: 2.2,
  range: 48,
  intensity: 2.6,
  color: new Color3(1.0, 0.95, 0.82),
  /** The beam only switches on once the night is at least this dark, and only this close to the camera. */
  nightFrom: 0.04,
  reach: 140,
}

/** How bright the headlamp lenses glow: a steady white by day, full at night. */
export function lensGlow(on: boolean, night: number): number {
  if (!on) return 0.04
  return 0.75 + 0.6 * Math.min(1, Math.max(0, night))
}

/** Whether the beam itself should light the world: the lamps are on, it's getting dark and the vehicle is near enough to matter. */
export function beamLit(on: boolean, night: number, distance: number): boolean {
  return on && night >= HEADLIGHT.nightFrom && distance < HEADLIGHT.reach
}

/** The side-by-side's headlights: glowing lenses on the front and a forward beam after dark. On from the start; L switches them. */
export class Headlights {
  on = true
  private readonly lenses: Mesh[] = []
  private readonly lens: StandardMaterial
  private readonly beam: SpotLight
  private lit = false

  constructor(scene: Scene, private readonly root: TransformNode) {
    this.lens = new StandardMaterial('utv-headlamp', scene)
    this.lens.disableLighting = true
    this.lens.diffuseColor = Color3.Black()
    this.lens.specularColor = Color3.Black()
    this.lens.emissiveColor = HEADLIGHT.color.clone()
    this.lens.backFaceCulling = false
    for (const at of UTV_LAMPS) {
      const disc = CreateDisc('utv-headlamp', { radius: 0.075, tessellation: 18 }, scene)
      disc.scaling.set(1.35, 0.7, 1)
      disc.rotation.y = Math.PI
      disc.position.copyFrom(at)
      disc.parent = root
      disc.material = this.lens
      disc.isPickable = false
      this.lenses.push(disc)
    }
    scene.requireLightSorting = true
    this.beam = new SpotLight('utv-headlights', HEADLIGHT.origin.clone(), HEADLIGHT.aim.normalizeToNew(), HEADLIGHT.angle, HEADLIGHT.exponent, scene)
    this.beam.parent = root
    this.beam.diffuse = HEADLIGHT.color.clone()
    this.beam.specular = new Color3(0.15, 0.15, 0.14)
    this.beam.range = HEADLIGHT.range
    this.beam.intensity = HEADLIGHT.intensity
    this.beam.renderPriority = 1
    this.beam.setEnabled(false)
  }

  toggle(): boolean {
    this.on = !this.on
    return this.on
  }

  update(night: number, camera: Vector3): void {
    const visible = this.root.isEnabled()
    const k = lensGlow(this.on && visible, night)
    this.lens.emissiveColor.copyFromFloats(HEADLIGHT.color.r * k, HEADLIGHT.color.g * k, HEADLIGHT.color.b * k)
    const p = this.root.getAbsolutePosition()
    const lit = visible && beamLit(this.on, night, Vector3.Distance(p, camera))
    if (lit !== this.lit) {
      this.lit = lit
      this.beam.setEnabled(lit)
    }
    if (lit) this.beam.intensity = HEADLIGHT.intensity * Math.min(1, night / 0.4 + 0.25)
  }
}
