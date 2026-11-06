/** Post-processing for medium and high quality: an HDR CameraFrame with a soft bloom on sun glints and boat lights, gentle grading, vibrance and a light vignette. Low quality renders straight to the screen. */
import * as pc from 'playcanvas'
import type { QualityTier } from '../config'

export class PostFx {
  private frame: pc.CameraFrame | null = null
  private bloom = 0

  constructor(app: pc.AppBase, camera: pc.CameraComponent, quality: QualityTier) {
    if (quality === 'low') return
    const f = new pc.CameraFrame(app, camera)
    f.rendering.toneMapping = pc.TONEMAP_ACES
    f.rendering.samples = quality === 'high' ? 4 : 2
    f.rendering.sharpness = 0.2
    this.bloom = quality === 'high' ? 0.02 : 0.014
    f.bloom.intensity = this.bloom
    f.bloom.blurLevel = 12
    f.grading.enabled = true
    f.grading.saturation = 1.08
    f.grading.contrast = 1.05
    f.grading.brightness = 1.02
    f.vignette.intensity = 0.18
    f.vignette.inner = 0.6
    f.vignette.outer = 1.3
    f.vignette.curvature = 0.6
    f.colorEnhance.enabled = true
    f.colorEnhance.vibrance = 0.18
    f.colorEnhance.shadows = 0.12
    f.colorEnhance.dehaze = 0.05
    f.update()
    this.frame = f
  }

  /** After dark the bloom carries the boat's nav lights and the moon a little further. */
  setNight(night: number): void {
    const f = this.frame
    if (!f) return
    const want = this.bloom * (1 + night * 1.8)
    if (Math.abs(f.bloom.intensity - want) > 0.002) { f.bloom.intensity = want; f.update() }
  }
}
