/** Every tunable for Bush League Baseball's page: engine overrides, bindings, quality tiers, field looks, cameras and play-back pacing. Rules and physics tunables live in sim/tuning.ts. */
import { ENGINE_DEFAULTS, type ActionBindings, type EngineConfig } from '../../engine'
import moduleJson from './module.json'

export type Action = 'up' | 'down' | 'left' | 'right' | 'swing' | 'power' | 'bunt' | 'steal' | 'pitch1' | 'pitch2' | 'pitch3' | 'pitch4' | 'pitch5' | 'skip'

export interface ModuleMeta {
  id: string
  title: string
  accent: string
  modes: readonly 'solo'[]
}

export type PitchPace = 'rookie' | 'pro' | 'allstar'

export const config = {
  meta: moduleJson as ModuleMeta,
  engine: {
    ...ENGINE_DEFAULTS,
    renderer: { ...ENGINE_DEFAULTS.renderer, clearColor: '#0b1020', toneMappingExposure: 1.05 },
    camera: { fov: 50, near: 0.1, far: 900, position: [0, 2.2, 3.6], lookAt: [0, 1.2, -18] },
    environment: { background: '#0e1630', fogColor: '#0e1630', fogNear: 220, fogFar: 520 },
    lighting: {
      ...ENGINE_DEFAULTS.lighting,
      skyColor: '#b9d2ff',
      groundColor: '#20301c',
      hemisphereIntensity: 1.1,
      sunColor: '#fff1d6',
      sunIntensity: 2.4,
      sunDirection: [-0.45, 1, 0.3],
      sunDistance: 160,
      shadowExtent: 95,
    },
    quality: {
      ...ENGINE_DEFAULTS.quality,
      tiers: {
        low: { pixelRatioCap: 1, shadows: false, shadowMapSize: 512, post: false },
        medium: { pixelRatioCap: 1.25, shadows: true, shadowMapSize: 1024, post: false },
        high: { pixelRatioCap: 1.75, shadows: true, shadowMapSize: 2048, post: false },
        ultra: { pixelRatioCap: 2, shadows: true, shadowMapSize: 4096, post: false },
      },
    },
  } satisfies EngineConfig,
  bindings: {
    up: [{ kind: 'key', code: 'KeyW' }, { kind: 'key', code: 'ArrowUp' }, { kind: 'axis', axis: 1, direction: -1 }],
    down: [{ kind: 'key', code: 'KeyS' }, { kind: 'key', code: 'ArrowDown' }, { kind: 'axis', axis: 1, direction: 1 }],
    left: [{ kind: 'key', code: 'KeyA' }, { kind: 'key', code: 'ArrowLeft' }, { kind: 'axis', axis: 0, direction: -1 }],
    right: [{ kind: 'key', code: 'KeyD' }, { kind: 'key', code: 'ArrowRight' }, { kind: 'axis', axis: 0, direction: 1 }],
    swing: [{ kind: 'key', code: 'Space' }, { kind: 'mouse', button: 0 }, { kind: 'pad', button: 0 }],
    power: [{ kind: 'key', code: 'KeyF' }, { kind: 'mouse', button: 2 }, { kind: 'pad', button: 1 }],
    bunt: [{ kind: 'key', code: 'KeyB' }, { kind: 'pad', button: 2 }],
    steal: [{ kind: 'key', code: 'KeyR' }, { kind: 'pad', button: 3 }],
    pitch1: [{ kind: 'key', code: 'Digit1' }],
    pitch2: [{ kind: 'key', code: 'Digit2' }],
    pitch3: [{ kind: 'key', code: 'Digit3' }],
    pitch4: [{ kind: 'key', code: 'Digit4' }],
    pitch5: [{ kind: 'key', code: 'Digit5' }],
    skip: [{ kind: 'key', code: 'Enter' }, { kind: 'pad', button: 9 }],
  } satisfies ActionBindings<Action>,
  field: {
    grass: '#2f7a35',
    grassDark: '#286a2e',
    dirt: '#a8754a',
    track: '#8c6440',
    chalk: '#f4f1e8',
    base: '#fbfaf5',
    fence: '#1d3b2c',
    fenceTop: '#e8b23a',
    pole: '#f2d024',
    stands: '#3a4256',
    standsTop: '#2a3042',
    backstop: '#26303f',
    stripes: 14,
  },
  actors: { radius: 0.32, height: 1.85, ball: 0.06, bat: 0.86 },
  pace: {
    rookie: { label: 'Rookie', pitchScale: 2.1, note: 'Pitches travel at about half speed' },
    pro: { label: 'Pro', pitchScale: 1.45, note: 'A little slower than real' },
    allstar: { label: 'All-Star', pitchScale: 1, note: 'Real pitch speed' },
  } satisfies Record<PitchPace, { label: string; pitchScale: number; note: string }>,
  timing: { windup: 1.05, swingLag: 0.15, betweenPitches: 0.8, afterPlay: 1.4, cursorSpeed: 1.6, meterSeconds: 1.15 },
  cameras: {
    batting: { position: [0, 3.3, -6.6], target: [0, 0.85, 16], fov: 50 },
    pitching: { position: [1.1, 3.1, 25.5], target: [0, 0.9, 0], fov: 17 },
    overview: { position: [0, 26, -30], target: [0, 0, 45], fov: 50 },
    play: { fov: 52 },
  },
  copy: {
    controlsBatting: 'Move the cursor with the mouse or WASD · Space or click to swing · F or right-click for a power swing · B to bunt · R to send the runners',
    controlsPitching: '1–5 to pick a pitch · aim with the mouse or WASD · click or Space three times: start, effort, accuracy',
    controlsWatching: 'Sit back and watch · Enter skips ahead',
  },
}

export type ModuleConfig = typeof config
