import type { Scene } from '@babylonjs/core/scene'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { Color4 } from '@babylonjs/core/Maths/math.color'

export function createPostProcess(scene: Scene, camera: Camera): DefaultRenderingPipeline {
  const pipeline = new DefaultRenderingPipeline('arena-hd', true, scene, [camera])
  pipeline.samples = 4
  pipeline.fxaaEnabled = true

  pipeline.bloomEnabled = true
  pipeline.bloomThreshold = 0.82
  pipeline.bloomWeight = 0.28
  pipeline.bloomKernel = 64
  pipeline.bloomScale = 0.5

  pipeline.imageProcessingEnabled = true
  const image = pipeline.imageProcessing
  image.toneMappingEnabled = true
  image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
  image.exposure = 1.4
  image.contrast = 1.08
  image.vignetteEnabled = true
  image.vignetteWeight = 1.4
  image.vignetteColor = new Color4(0.05, 0.06, 0.08, 0)
  image.vignetteCameraFov = 1.15

  pipeline.sharpenEnabled = true
  pipeline.sharpen.edgeAmount = 0.18
  return pipeline
}
