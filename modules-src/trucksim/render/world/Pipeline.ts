/**
 * The HDR post chain, following Rack & Reel's `core/EngineSetup.ts` choices so it runs on both the WebGPU and WebGL2 engines:
 * Babylon's `DefaultRenderingPipeline` on a half-float target with ACES (or `?tonemap=neutral` Khronos PBR Neutral) tone mapping,
 * contrast tuned for daylight, bloom that only catches emissive lamps and the sun disc (anything brighter than `BLOOM_LUMINANCE`
 * before exposure), FXAA or 4× MSAA by tier, a light sharpen, a faint vignette, dithering against sky banding at night, and SSAO
 * on high and ultra. Exposure itself
 * belongs to the atmosphere (it follows the time of day through the scene's image-processing configuration). SSAO steps aside on
 * WebGPU adapters with fewer than 24 inter-stage variables, where PBR with cascaded shadows would no longer fit.
 */
import type { Camera } from '@babylonjs/core/Cameras/camera'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { Color4 } from '@babylonjs/core/Maths/math.color'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline'
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent'
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent'
import '@babylonjs/core/Rendering/prePassRendererSceneComponent'
import type { Scene } from '@babylonjs/core/scene'
import { qualitySettings } from '../Quality'
import type { QualitySettings, QualityTier } from '../Quality'

/** Linear luminance (before exposure) above which a pixel blooms; give lamps an emissive brighter than this to make them glow. */
export const BLOOM_LUMINANCE = 2.8
export const CONTRAST = 1.06

export type ToneMapping = 'aces' | 'neutral'

export interface PipelineOptions {
  /** Defaults to `?tonemap=` (aces unless it says neutral). */
  toneMapping?: ToneMapping
}

export interface WorldPipeline {
  readonly rendering: DefaultRenderingPipeline
  /** Screen-space ambient occlusion on high and ultra, or null. */
  readonly ssao: SSAO2RenderingPipeline | null
  readonly quality: Readonly<QualitySettings>
  setTier(tier: QualityTier): void
  dispose(): void
}

/** `?tonemap=neutral` picks Khronos PBR Neutral; anything else keeps ACES. */
export function toneMappingFromSearch(search: string): ToneMapping {
  return new URLSearchParams(search).get('tonemap') === 'neutral' ? 'neutral' : 'aces'
}

function ssaoFits(scene: Scene): boolean {
  const engine = scene.getEngine() as AbstractEngine & { currentLimits?: { maxInterStageShaderVariables?: number }; isWebGPU?: boolean }
  if (!engine.isWebGPU) return true
  return (engine.currentLimits?.maxInterStageShaderVariables ?? 16) >= 24
}

function buildSsao(scene: Scene, camera: Camera, quality: QualitySettings): SSAO2RenderingPipeline | null {
  if (!quality.ssao || !ssaoFits(scene) || !SSAO2RenderingPipeline.IsSupported) return null
  const ssao = new SSAO2RenderingPipeline('trucksim-ssao', scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera], true)
  ssao.radius = 1.8
  ssao.totalStrength = 0.95
  ssao.base = 0.12
  ssao.samples = quality.tier === 'ultra' ? 16 : 8
  ssao.expensiveBlur = quality.tier === 'ultra'
  ssao.maxZ = 260
  ssao.minZAspect = 0.4
  return ssao
}

function buildRendering(scene: Scene, camera: Camera, quality: QualitySettings, toneMapping: ToneMapping): DefaultRenderingPipeline {
  const pipeline = new DefaultRenderingPipeline('trucksim-hdr', true, scene, [camera])
  pipeline.samples = quality.msaa
  pipeline.fxaaEnabled = quality.fxaa
  pipeline.bloomEnabled = quality.bloom
  pipeline.bloomThreshold = Math.pow(BLOOM_LUMINANCE, 2.2)
  pipeline.bloomWeight = 0.22
  pipeline.bloomKernel = 64
  pipeline.bloomScale = 0.5
  pipeline.sharpenEnabled = quality.sharpen > 0
  if (quality.sharpen > 0) {
    pipeline.sharpen.edgeAmount = quality.sharpen
    pipeline.sharpen.colorAmount = 1
  }
  pipeline.imageProcessingEnabled = true
  const processing = pipeline.imageProcessing
  processing.toneMappingEnabled = true
  processing.toneMappingType = toneMapping === 'neutral' ? ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL : ImageProcessingConfiguration.TONEMAPPING_ACES
  processing.contrast = CONTRAST
  processing.vignetteEnabled = true
  processing.vignetteWeight = 0.9
  processing.vignetteColor = new Color4(0.04, 0.05, 0.04, 0)
  processing.ditheringEnabled = true
  processing.ditheringIntensity = 1 / 255
  return pipeline
}

/**
 * Builds the post chain for `camera` at `tier`. Throws where the engine can't host it (callers that may run on a NullEngine
 * should guard). `setTier` rebuilds it (SSAO first, so the occlusion lands before tone mapping).
 */
export function createPipeline(scene: Scene, camera: Camera, tier: QualityTier, options: PipelineOptions = {}): WorldPipeline {
  const toneMapping = options.toneMapping ?? toneMappingFromSearch(typeof location === 'undefined' ? '' : location.search)
  let quality = qualitySettings(tier)
  let ssao = buildSsao(scene, camera, quality)
  let rendering = buildRendering(scene, camera, quality, toneMapping)
  let disposed = false
  return {
    get rendering() {
      return rendering
    },
    get ssao() {
      return ssao
    },
    get quality() {
      return quality
    },
    setTier(next) {
      if (disposed || next === quality.tier) return
      quality = qualitySettings(next)
      rendering.dispose()
      ssao?.dispose()
      ssao = buildSsao(scene, camera, quality)
      rendering = buildRendering(scene, camera, quality, toneMapping)
    },
    dispose() {
      if (disposed) return
      disposed = true
      rendering.dispose()
      ssao?.dispose()
      ssao = null
    },
  }
}
