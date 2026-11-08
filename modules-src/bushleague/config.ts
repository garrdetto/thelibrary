/** Every tunable for Bush League Baseball's page: engine overrides, bindings, quality tiers, field looks, cameras and play-back pacing. Rules and physics tunables live in sim/tuning.ts. */
import { ENGINE_DEFAULTS, type ActionBindings, type EngineConfig } from '../../engine'
import moduleJson from './module.json'

export type Action = 'up' | 'down' | 'left' | 'right' | 'swing' | 'power' | 'bunt' | 'steal' | 'pitch1' | 'pitch2' | 'pitch3' | 'pitch4' | 'pitch5' | 'skip' | 'camera' | 'replay' | 'stats' | 'mute'

export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  up: 'Cursor up', down: 'Cursor down', left: 'Cursor left', right: 'Cursor right', swing: 'Swing / pitch meter', power: 'Power swing', bunt: 'Bunt', steal: 'Send the runners',
  pitch1: 'Pitch 1', pitch2: 'Pitch 2', pitch3: 'Pitch 3', pitch4: 'Pitch 4', pitch5: 'Pitch 5', skip: 'Skip ahead', camera: 'Change camera', replay: 'Replay last play', stats: 'Stats overlay', mute: 'Sound on/off',
}

export interface ModuleMeta {
  id: string
  title: string
  accent: string
  modes: readonly 'solo'[]
}

export type Difficulty = 'rookie' | 'pro' | 'allstar' | 'mvp' | 'legend'

export interface DifficultyLevel {
  label: string
  /** Pitch flight slow-down for your at-bats (1 = real speed). */
  pace: number
  /** Your contact cursor size. */
  pci: number
  /** Computer club's sharpness, −1…1 (0 is the calibrated league). */
  skill: number
}

export const config = {
  meta: moduleJson as ModuleMeta,
  engine: {
    ...ENGINE_DEFAULTS,
    renderer: { ...ENGINE_DEFAULTS.renderer, clearColor: '#0b1020', toneMappingExposure: 1.05, toneMapping: new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('tone') === 'aces' ? 'aces' : 'agx' },
    post: { enabled: true },
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
    camera: [{ kind: 'key', code: 'KeyV' }, { kind: 'pad', button: 4 }],
    replay: [{ kind: 'key', code: 'KeyY' }, { kind: 'pad', button: 5 }],
    stats: [{ kind: 'key', code: 'Tab' }, { kind: 'pad', button: 8 }],
    mute: [{ kind: 'key', code: 'KeyN' }],
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
  difficulty: {
    rookie: { label: 'Rookie', pace: 2.1, pci: 1.35, skill: -0.5 },
    pro: { label: 'Pro', pace: 1.6, pci: 1.15, skill: -0.2 },
    allstar: { label: 'All-Star', pace: 1.3, pci: 1, skill: 0 },
    mvp: { label: 'MVP', pace: 1.1, pci: 0.92, skill: 0.25 },
    legend: { label: 'Legend', pace: 1, pci: 0.85, skill: 0.5 },
  } satisfies Record<Difficulty, DifficultyLevel>,
  assist: { pci: 1.3, timing: 0.35, aimJitter: 0.02 },
  timing: { windup: 1.05, swingLag: 0.15, betweenPitches: 0.8, afterPlay: 1.4, cursorSpeed: 1.6, meterSeconds: 1.15, replaySpeed: 0.4, replayMax: 6, introSeconds: 4.5 },
  cameras: {
    batting: { position: [0, 1.05, -1.25], target: [0, 0.77, 0.43], fov: 50 },
    centerfield: { position: [1.6, 5.2, 112], target: [0, 1.0, 0], fov: 6.5 },
    pitching: { position: [0, 1.05, -1.25], target: [0, 0.77, 0.43], fov: 50 },
    overview: { position: [0, 26, -30], target: [0, 0, 45], fov: 50 },
    play: { fov: 52 },
  },
  copy: {
    controlsBatting: 'Move the cursor with the mouse or WASD · Space or click to swing · F or right-click for a power swing · B to bunt · R to send the runners · V changes the camera',
    controlsPitching: '1–5 to pick a pitch · aim with the mouse or WASD · click or Space three times: start, effort, accuracy',
    controlsWatching: 'Sit back and watch · Enter skips ahead · V changes the camera · Y replays the last play',
    controlsCommon: 'Tab shows the stats · N toggles sound',
  },
}

export type ModuleConfig = typeof config
