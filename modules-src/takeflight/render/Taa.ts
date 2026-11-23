/**
 * Temporal anti-aliasing for the ultra tier: Babylon's TAA pipeline accumulates jittered frames while the camera holds still
 * (pause, the debrief behind its card, a parked aircraft in the tower view) and steps aside while it moves, so a moving view
 * never ghosts. `?taa=0|1` overrides the tier for testing. Purely a render effect.
 */
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { TAARenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/taaRenderingPipeline'
import type { Scene } from '@babylonjs/core/scene'

export class Taa {
  private pipeline: TAARenderingPipeline | null = null

  constructor(private readonly scene: Scene, private readonly camera: Camera) {}

  /** Turns TAA on or off (a `?taa=` parameter wins). */
  setEnabled(wanted: boolean): void {
    const param = new URLSearchParams(location.search).get('taa')
    const on = param === '1' ? true : param === '0' ? false : wanted
    if (on && !this.pipeline) {
      try {
        const pipeline = new TAARenderingPipeline('takeflight-taa', this.scene, [this.camera])
        if (!pipeline.isSupported) {
          pipeline.dispose()
          return
        }
        pipeline.samples = 16
        pipeline.disableOnCameraMove = true
        this.pipeline = pipeline
      } catch (error) {
        console.warn('Take Flight: TAA unavailable', error)
      }
    } else if (!on && this.pipeline) {
      this.pipeline.dispose()
      this.pipeline = null
    }
  }

  dispose(): void {
    this.pipeline?.dispose()
    this.pipeline = null
  }
}
