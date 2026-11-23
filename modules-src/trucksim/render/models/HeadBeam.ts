/**
 * The light the driven truck's headlights throw on the road: one warm spot light between the two headlamps, aimed a little down
 * the road ahead, parented to the truck's root. It stays enabled for the truck's whole life and is switched by intensity only,
 * because enabling or disabling a Babylon light recompiles every shader in the scene. One beam (not one per lamp) keeps the
 * scene inside the PBR materials' light budget (sun, sky and this). `dispose` removes it.
 */
import { Light } from '@babylonjs/core/Lights/light'
import { SpotLight } from '@babylonjs/core/Lights/spotLight'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'

/**
 * Beam strength with Babylon's standard falloff (a linear fade to `BEAM_RANGE`), which lights the road evenly from the bumper out
 * like a low beam instead of the hot spot at the bumper an inverse-square light makes.
 */
export const BEAM_INTENSITY = 1.8
export const BEAM_RANGE = 75
/** How far ahead (m) the beam's centre meets the road from lamp height. */
export const BEAM_AIM_M = 30
/** Share of the beam that still shows in full daylight (headlights barely light a sunlit road). */
export const DAYLIGHT_SHARE = 0.06
const RAMP_PER_SECOND = 12

export class HeadBeam {
  readonly light: SpotLight
  private level = 0
  private shown = -1

  /** `frontZ` is the truck's front in its own frame, `lampY` the headlamps' height above the ground. */
  constructor(scene: Scene, parent: TransformNode, frontZ: number, lampY: number) {
    const drop = lampY / BEAM_AIM_M
    this.light = new SpotLight('trucksim-headbeam', new Vector3(0, lampY, frontZ + 0.05), new Vector3(0, -drop, 1).normalize(), 1.15, 3, scene)
    this.light.parent = parent
    this.light.diffuse = new Color3(1, 0.94, 0.82)
    this.light.specular = new Color3(0.12, 0.11, 0.1)
    this.light.falloffType = Light.FALLOFF_STANDARD
    this.light.range = BEAM_RANGE
    this.light.intensity = 0
  }

  /**
   * Fades the beam toward on or off (a few frames, like a filament warming). `darkness` (0 midday … 1 night) scales how much of
   * it shows on the road.
   */
  update(on: boolean, dt: number, darkness = 1): void {
    const target = on ? 1 : 0
    if (this.level !== target) {
      const step = Math.min(1, dt * RAMP_PER_SECOND)
      this.level = Math.abs(target - this.level) <= step ? target : this.level + Math.sign(target - this.level) * step
    }
    const intensity = this.level * BEAM_INTENSITY * (DAYLIGHT_SHARE + (1 - DAYLIGHT_SHARE) * Math.min(1, Math.max(0, darkness)))
    if (intensity === this.shown || (intensity !== 0 && Math.abs(intensity - this.shown) < 0.005)) return
    this.shown = intensity
    this.light.intensity = intensity
  }

  get on(): boolean {
    return this.level > 0
  }

  dispose(): void {
    this.light.dispose()
  }
}
