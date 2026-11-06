/** Typed engine configuration shapes and the shared defaults every module config extends. */

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra'
export type QualityRequest = QualityTier | 'auto'
export type RenderBackend = 'webgpu' | 'webgl2'
export type LayerName = 'world' | 'props' | 'characters' | 'fx' | 'ui'

export type InputBinding =
  | { kind: 'key'; code: string }
  | { kind: 'mouse'; button: number }
  | { kind: 'pad'; button: number }
  | { kind: 'axis'; axis: number; direction: 1 | -1 }
  | { kind: 'touch'; region: readonly [x0: number, y0: number, x1: number, y1: number] }

export type ActionBindings<A extends string = string> = Readonly<Record<A, readonly InputBinding[]>>

export interface LoopConfig {
  simulationHz: number
  maxSubSteps: number
  maxFrameSeconds: number
  frameRateWindowSeconds: number
}

export type ToneMappingName = 'aces' | 'agx' | 'neutral'

export interface RendererConfig {
  preferWebGPU: boolean
  antialias: boolean
  maxPixelRatio: number
  toneMappingExposure: number
  shadows: boolean
  clearColor: string
  /** Output tone mapping; ACES when left out. */
  toneMapping?: ToneMappingName
}

export interface CameraConfig {
  fov: number
  near: number
  far: number
  position: readonly [number, number, number]
  lookAt: readonly [number, number, number]
}

export interface InputConfig {
  padDeadzone: number
  preventDefaultKeys: boolean
}

export interface AssetConfig {
  dracoPath: string | null
  basisPath: string | null
}

export interface PhysicsConfig {
  gravity: readonly [number, number, number]
  debugColor: string
}

export interface LightingConfig {
  skyColor: string
  groundColor: string
  hemisphereIntensity: number
  sunColor: string
  sunIntensity: number
  sunDirection: readonly [number, number, number]
  sunDistance: number
  shadowMapSize: number
  shadowExtent: number
}

export interface EnvironmentConfig {
  background: string
  fogColor: string
  fogNear: number
  fogFar: number
}

export interface QualitySettings {
  pixelRatioCap: number
  shadows: boolean
  shadowMapSize: number
  post: boolean
}

export interface QualityConfig {
  requested: QualityRequest
  tiers: Readonly<Record<QualityTier, QualitySettings>>
  autoTier: Readonly<Record<RenderBackend, QualityTier>>
}

/** Optional post effects, applied in this order on the linear HDR scene colour: ambient occlusion, temporal anti-aliasing, bloom, lens flare, vignette, film grain. Tone mapping and sRGB output follow. */
export interface PostEffects {
  ao?: { radius: number; thickness: number; intensity: number; resolutionScale: number; samples: number }
  taa?: boolean
  bloom?: { strength: number; radius: number; threshold: number }
  flare?: { threshold: number; ghostSamples: number; ghostSpacing: number; ghostAttenuation: number; strength: number }
  vignette?: number
  grain?: number
  /** Depth of field, off until `PostChain.setFocus` gives it a strength (replays, cut-scenes). */
  dof?: { focalLength: number; bokehScale: number }
}

export interface PostConfig {
  enabled: boolean
  effects?: PostEffects
}

export interface HudConfig {
  tokenFallbacks: Readonly<Record<string, string>>
  toastSeconds: number
  zIndex: number
}

export interface NetConfig {
  hostAttempts: number
  rejoinSeconds: number
  maxPeers: number
}

export interface EngineConfig {
  loop: LoopConfig
  renderer: RendererConfig
  camera: CameraConfig
  input: InputConfig
  assets: AssetConfig
  physics: PhysicsConfig
  lighting: LightingConfig
  environment: EnvironmentConfig
  quality: QualityConfig
  post: PostConfig
  hud: HudConfig
  net: NetConfig
}

export const ENGINE_DEFAULTS: EngineConfig = {
  loop: { simulationHz: 60, maxSubSteps: 6, maxFrameSeconds: 0.25, frameRateWindowSeconds: 0.5 },
  renderer: {
    preferWebGPU: true,
    antialias: true,
    maxPixelRatio: 2,
    toneMappingExposure: 1,
    shadows: true,
    clearColor: '#0a0e1a',
  },
  camera: { fov: 55, near: 0.1, far: 2000, position: [6, 5, 8], lookAt: [0, 0, 0] },
  input: { padDeadzone: 0.2, preventDefaultKeys: true },
  assets: { dracoPath: null, basisPath: null },
  physics: { gravity: [0, -9.81, 0], debugColor: '#39d0ff' },
  lighting: {
    skyColor: '#cfe3ff',
    groundColor: '#2a2f3a',
    hemisphereIntensity: 0.9,
    sunColor: '#fff4e0',
    sunIntensity: 2.2,
    sunDirection: [0.5, 1, 0.35],
    sunDistance: 40,
    shadowMapSize: 2048,
    shadowExtent: 20,
  },
  environment: { background: '#0a0e1a', fogColor: '#0a0e1a', fogNear: 40, fogFar: 160 },
  quality: {
    requested: 'auto',
    tiers: {
      low: { pixelRatioCap: 1, shadows: false, shadowMapSize: 512, post: false },
      medium: { pixelRatioCap: 1.5, shadows: true, shadowMapSize: 1024, post: false },
      high: { pixelRatioCap: 2, shadows: true, shadowMapSize: 2048, post: true },
      ultra: { pixelRatioCap: 2, shadows: true, shadowMapSize: 4096, post: true },
    },
    autoTier: { webgpu: 'high', webgl2: 'medium' },
  },
  post: { enabled: false },
  hud: {
    tokenFallbacks: {
      '--lib-bg': '#0a0e1a',
      '--lib-panel': '#111829',
      '--lib-panel2': '#18213a',
      '--lib-text': '#e9effc',
      '--lib-strong': '#ffffff',
      '--lib-soft': '#aab6d3',
      '--lib-muted': '#8d9bba',
      '--lib-dim': '#5f6f93',
      '--lib-line': 'rgba(120,170,255,.16)',
      '--lib-chip': 'rgba(255,255,255,.05)',
      '--lib-accent': '#39d0ff',
      '--lib-on-accent': '#06101f',
      '--lib-shadow': 'rgba(0,0,0,.45)',
    },
    toastSeconds: 2.6,
    zIndex: 10,
  },
  net: { hostAttempts: 5, rejoinSeconds: 4, maxPeers: 8 },
}
