/** Engine settings for The Hood: a warm daylight rig, wide shadows for a whole lot, and the module accent. */
import { ENGINE_DEFAULTS, type EngineConfig } from '../../engine'
import moduleJson from './module.json'

export interface ModuleMeta {
  id: string
  title: string
  accent: string
  modes: readonly ('solo' | 'online')[]
}

export const config: { meta: ModuleMeta; engine: EngineConfig } = {
  meta: moduleJson as ModuleMeta,
  engine: {
    ...ENGINE_DEFAULTS,
    renderer: { ...ENGINE_DEFAULTS.renderer, toneMapping: 'agx', toneMappingExposure: 1.05, clearColor: '#9cc8ec' },
    camera: { fov: 42, near: 0.3, far: 600, position: [0, 60, 80], lookAt: [0, 0, 0] },
    lighting: { ...ENGINE_DEFAULTS.lighting, sunIntensity: 2.4, hemisphereIntensity: 0.9, groundColor: '#55603f', shadowExtent: 36, sunDistance: 60 },
    post: { enabled: true, effects: { ao: { radius: 0.5, thickness: 1.2, intensity: 0.8, resolutionScale: 0.5, samples: 12 }, bloom: { strength: 0.22, radius: 0.35, threshold: 0.92 }, vignette: 0.18 } },
    environment: { ...ENGINE_DEFAULTS.environment, background: '#9cc8ec', fogColor: '#9cc8ec', fogNear: 90, fogFar: 260 },
  },
}
