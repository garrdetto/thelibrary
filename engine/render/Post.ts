/** Post-processing chain installed as the App render pass. With `post.enabled`, a tier that allows post and some `effects`, it builds a TSL RenderPipeline (GTAO, TRAA, bloom, lens flare, vignette, grain) on the HDR scene colour; otherwise, or if the pipeline cannot be built, it renders the scene directly. */
import * as THREE from 'three/webgpu'
import { float, length, mix, mrt, normalView, output, packNormalToRGB, pass, sample, screenUV, smoothstep, uniform, unpackRGBToNormal, velocity, vec4 } from 'three/tsl'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { film } from 'three/addons/tsl/display/FilmNode.js'
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import type { App } from '../core/App'
import type { PostConfig, PostEffects, QualitySettings } from '../config'

export interface PostChain {
  readonly enabled: boolean
  render(): void
  /** Focus distance in metres and blur strength 0–1 for the depth-of-field effect (strength 0 leaves the image untouched); a no-op without one. */
  setFocus(distance: number, strength: number): void
  dispose(): void
}

function hasEffects(effects: PostEffects | undefined): effects is PostEffects {
  return !!effects && !!(effects.ao || effects.taa || effects.bloom || effects.flare || effects.vignette || effects.grain || effects.dof)
}

type FloatUniform = ReturnType<typeof float> & { value: number }

interface Focus {
  distance: FloatUniform
  strength: FloatUniform
}

function buildPipeline(app: App, effects: PostEffects, focus: Focus): THREE.RenderPipeline {
  const scenePass = effects.ao || effects.taa ? pass(app.scene, app.camera, { samples: 0 }) : pass(app.scene, app.camera)
  const targets: Record<string, unknown> = { output }
  if (effects.ao) targets.normal = packNormalToRGB(normalView)
  if (effects.taa) targets.velocity = velocity
  if (effects.ao || effects.taa) scenePass.setMRT(mrt(targets as Parameters<typeof mrt>[0]))
  const depth = scenePass.getTextureNode('depth')
  let color = scenePass.getTextureNode('output') as unknown as ReturnType<typeof vec4>

  if (effects.ao) {
    const normals = scenePass.getTextureNode('normal')
    const sceneNormal = sample((uv) => unpackRGBToNormal(normals.sample(uv)))
    const occlusion = ao(depth, sceneNormal, app.camera)
    occlusion.resolutionScale = effects.ao.resolutionScale
    occlusion.radius.value = effects.ao.radius
    occlusion.thickness.value = effects.ao.thickness
    occlusion.samples.value = effects.ao.samples
    const shade = float(1).sub(float(1).sub(occlusion.getTextureNode().sample(screenUV).r).mul(effects.ao.intensity))
    color = vec4(color.rgb.mul(shade), color.a)
  }
  if (effects.taa) color = traa(color, depth, scenePass.getTextureNode('velocity'), app.camera) as unknown as typeof color
  if (effects.dof) {
    const blurred = dof(color, scenePass.getViewZNode(), focus.distance, float(effects.dof.focalLength), focus.strength.mul(effects.dof.bokehScale)) as unknown as typeof color
    color = mix(color, blurred, focus.strength.mul(1000).min(1)) as unknown as typeof color
  }
  if (effects.bloom) {
    const glow = bloom(color, effects.bloom.strength, effects.bloom.radius, effects.bloom.threshold)
    if (effects.flare) {
      const flare = lensflare(glow, {
        threshold: float(effects.flare.threshold),
        ghostSamples: float(effects.flare.ghostSamples),
        ghostSpacing: float(effects.flare.ghostSpacing),
        ghostAttenuationFactor: float(effects.flare.ghostAttenuation),
      })
      color = color.add(glow).add(flare.getTextureNode().mul(effects.flare.strength)) as typeof color
    } else {
      color = color.add(glow) as typeof color
    }
  }
  if (effects.vignette) {
    const strength = uniform(effects.vignette)
    const edge = smoothstep(0.35, 0.95, length(screenUV.sub(0.5)).mul(1.4))
    color = vec4(color.rgb.mul(float(1).sub(edge.mul(strength))), color.a)
  }
  if (effects.grain) color = film(color, float(effects.grain)) as unknown as typeof color
  const pipeline = new THREE.RenderPipeline(app.renderer)
  pipeline.outputNode = color
  return pipeline
}

export function createPost(app: App, config: PostConfig, quality: QualitySettings): PostChain {
  let pipeline: THREE.RenderPipeline | null = null
  const focus: Focus = { distance: uniform(10) as unknown as FloatUniform, strength: uniform(0) as unknown as FloatUniform }
  if (config.enabled && quality.post && hasEffects(config.effects)) {
    try {
      pipeline = buildPipeline(app, config.effects, focus)
    } catch (error) {
      console.warn('[engine] post-processing unavailable, rendering directly', error)
      pipeline = null
    }
  }
  const active = pipeline
  const render = active ? () => active.render() : () => app.renderer.render(app.scene, app.camera)
  app.setRenderPass(render)
  return {
    enabled: !!active,
    render,
    setFocus(distance, strength) {
      focus.distance.value = Math.max(0.1, distance)
      focus.strength.value = Math.max(0, Math.min(1, strength))
    },
    dispose() {
      app.setRenderPass(null)
      active?.dispose()
    },
  }
}
