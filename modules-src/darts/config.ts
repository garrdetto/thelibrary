/** Every tunable for Oche Darts: engine overrides, the pub room's look, the board texture resolution, the throw gesture mapping and the timings the page uses. */
import { ENGINE_DEFAULTS, type EngineConfig } from '../../engine'
import moduleJson from './module.json'

export interface ModuleMeta {
  id: string
  title: string
  accent: string
  modes: readonly ('solo' | 'online')[]
}

export interface DartsConfig {
  meta: ModuleMeta
  engine: EngineConfig
  board: {
    /** Square texture size in pixels for the face, roughness/metal and bump maps (2048 keeps every wire sharp at 1080p and above). */
    textureSize: number
    lowTextureSize: number
    thickness: number
    surroundRadius: number
    surroundDepth: number
  }
  room: { wall: string; wallTrim: string; floor: string; oche: string; cabinet: string }
  camera: { eyeHeight: number; distanceBehindOche: number; boardHalfExtent: number; minFov: number; maxFov: number }
  gesture: {
    touchAimOffsetPx: number
    keyboardStepM: number
    keyboardFineM: number
    /** Seconds for the power meter to swing from empty to full and back. */
    chargeSeconds: number
    /** Launch speed at the bottom and top of the meter, as fractions of the ideal speed. */
    chargeLow: number
    chargeHigh: number
    /** Release steadiness for a held throw (0 perfectly steady, 1 very shaky). */
    holdWobble: number
  }
  dart: { length: number; flightColors: readonly string[] }
  timing: { cpuThinkMs: number; turnPauseMs: number; legPauseMs: number; announceMs: number }
}

export const config: DartsConfig = {
  meta: moduleJson as ModuleMeta,
  engine: {
    ...ENGINE_DEFAULTS,
    renderer: { ...ENGINE_DEFAULTS.renderer, clearColor: '#120d0b', toneMapping: 'neutral', toneMappingExposure: 1.05 },
    camera: { fov: 20, near: 0.05, far: 60, position: [0, 1.62, 2.67], lookAt: [0, 1.73, 0] },
    environment: { background: '#120d0b', fogColor: '#120d0b', fogNear: 14, fogFar: 40 },
    lighting: {
      ...ENGINE_DEFAULTS.lighting,
      skyColor: '#ffe9cf',
      groundColor: '#2a1a12',
      hemisphereIntensity: 0.45,
      sunColor: '#fff1dc',
      sunIntensity: 0.7,
      sunDirection: [0.3, 1, 1.2],
      sunDistance: 8,
      shadowMapSize: 1024,
      shadowExtent: 2.5,
    },
    post: { enabled: true, effects: { bloom: { strength: 0.18, radius: 0.35, threshold: 0.92 }, vignette: 0.32 } },
  },
  board: { textureSize: 2048, lowTextureSize: 1024, thickness: 0.038, surroundRadius: 0.33, surroundDepth: 0.03 },
  room: { wall: '#3b1f1a', wallTrim: '#24120d', floor: '#5a3a24', oche: '#d9c9a3', cabinet: '#4a2a17' },
  camera: { eyeHeight: 1.62, distanceBehindOche: 0.3, boardHalfExtent: 0.3, minFov: 12, maxFov: 34 },
  gesture: {
    touchAimOffsetPx: 64,
    keyboardStepM: 0.005,
    keyboardFineM: 0.001,
    chargeSeconds: 1.6,
    chargeLow: 0.7,
    chargeHigh: 1.2,
    holdWobble: 0.12,
  },
  dart: { length: 0.155, flightColors: ['#ff4d5e', '#39d0ff', '#ffcf4a', '#7cdc6a'] },
  timing: { cpuThinkMs: 650, turnPauseMs: 1600, legPauseMs: 3200, announceMs: 1500 },
}
