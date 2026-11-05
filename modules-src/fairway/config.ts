/** Every Fairway Nine tunable: the pure physics and course data from tuning.ts plus engine overrides, input bindings, colors, model specs, HUD copy and room settings. */
import { ENGINE_DEFAULTS, ROOM_FORMATS, type ActionBindings, type EngineConfig, type QualityTier, type RoomFormat } from '../../engine'
import moduleJson from './module.json'
import { tuning, type LieKind, type RoundMode, type ShotKind, type SurfaceKind, type Tuning } from './tuning'
import type { TreesSpec } from './models/Trees'
import type { GrassSpec } from './models/Grass'
import type { GolferLook } from './models/Golfer'
import type { ShotPreviewSpec } from './models/ShotPreview'

export type Action =
  | 'swing'
  | 'clubUp'
  | 'clubDown'
  | 'aimLeft'
  | 'aimRight'
  | 'spinUp'
  | 'spinDown'
  | 'powerUp'
  | 'powerDown'
  | 'shotNext'
  | 'shotFull'
  | 'shotChip'
  | 'shotFlop'
  | 'shotSpinner'
  | 'orbit'
  | 'menu'

export interface ModuleMeta {
  id: string
  title: string
  accent: string
  modes: readonly ('solo' | 'online')[]
}

export interface TerrainPalette {
  rough: string
  roughDark: string
  fairway: string
  fairwayStripe: string
  green: string
  greenStripe: string
  bunker: string
  tee: string
  path: string
  waterBed: string
}

export interface TerrainLook {
  palette: TerrainPalette
  cellSize: Readonly<Record<QualityTier, number>>
  margin: number
  /** Sub-cell offsets (in cells) averaged into each vertex's zone weights, so surface edges blend instead of stair-stepping. */
  zoneSamples: readonly (readonly [number, number])[]
  stripeWidth: number
  greenStripeWidth: number
  stripeEdges: readonly [number, number, number, number]
  noiseScales: readonly [number, number]
  noiseWeights: readonly [number, number]
  noiseStrength: number
  roughness: number
}

export interface WaterLook {
  shallow: string
  deep: string
  opacity: number
  roughness: number
  margin: number
  cellSize: number
  levelBelowShore: number
  shoreSamples: number
  fresnelPower: number
  waves: readonly { direction: readonly [number, number]; amplitude: number; wavelength: number; speed: number; steepness: number }[]
}

export interface BallLook {
  color: string
  visualScale: number
  segments: number
  roughness: number
}

export interface TracerLook {
  color: string
  maxPoints: number
  opacity: number
}

export interface FlagLook {
  poleHeight: number
  poleRadius: number
  poleColor: string
  clothColor: string
  clothWidth: number
  clothHeight: number
  clothSegments: number
  flutterAmplitude: number
  flutterFrequency: number
  flutterSpeed: number
  celebrationBoost: number
  cupColor: string
  cupRadius: number
  cupLift: number
  poleSegments: number
  poleRoughness: number
  clothRoughness: number
}

export interface TeeMarkerLook {
  colors: readonly [string, string]
  radius: number
  height: number
  spread: number
  ahead: number
  segments: number
  roughness: number
}

export type TreeLook = Omit<TreesSpec, 'instances'>

export interface GrassFieldLook {
  blade: Omit<GrassSpec, 'capacity'>
  capacity: Readonly<Record<QualityTier, number>>
  radius: number
  replantDistance: number
  edgeFade: number
  heights: Readonly<Record<SurfaceKind, number>>
  tints: Readonly<Record<SurfaceKind, number>>
  heightVariation: number
  widthVariation: number
  tintVariation: number
  maxLean: number
}

export interface SkyLook {
  top: string
  horizon: string
  radius: number
  exponent: number
  widthSegments: number
  heightSegments: number
}

export interface GaugeLook {
  size: number
  outerRadius: number
  outerWidth: number
  cursorRadius: number
  cursorWidth: number
  cursorSize: number
  innerRadius: number
  rhythmWidth: number
  markWidth: number
  track: string
  power: string
  overPower: string
  plan: string
  mark: string
  perfect: string
  cursor: string
  rhythm: string
  good: string
  bad: string
  text: string
  font: string
  labels: {
    perfect: string
    push: string
    pull: string
    hook: string
    slice: string
    power: (power: number, planned: number) => string
    path: (power: number) => string
    contact: (path: string) => string
    rhythm: string
    result: (power: number, parts: readonly string[], loss: number) => string
  }
}

export interface SpinDialLook {
  width: number
  height: number
  ballRadius: number
  arrowGap: number
  meterWidth: number
  back: string
  top: string
  neutral: string
  backLabel: string
  topLabel: string
  labelFont: string
  /** Ball turns per second drawn at full spin (animation only). */
  turnsPerSecond: number
}

export interface WindDialLook {
  size: number
  aim: string
  calm: string
  breeze: string
  strong: string
}

export interface MinimapLook {
  padding: number
  marginMetres: number
  cornerRadius: number
  treeMetres: number
  colors: {
    rough: string
    fairway: string
    green: string
    bunker: string
    water: string
    path: string
    tee: string
    tree: string
    pin: string
    flag: string
    preview: string
    roll: string
    zone: string
    zoneFill: string
    rest: string
    flight: string
    ball: string
    otherBall: string
    outline: string
  }
}

export interface HudCopy {
  controlsHint: string
  hole: string
  par: string
  stroke: string
  total: string
  wind: string
  club: string
  lie: string
  toPin: string
  spin: string
  shot: string
  power: string
  shotNames: Readonly<Record<ShotKind, string>>
  shotHints: Readonly<Record<ShotKind, string>>
  bag: string
  helpLabel: string
  holeLength: (yards: number, metres: number) => string
  clubDetail: (loft: number, carry: number | null) => string
  putterDetail: string
  spinRpm: (rpm: number) => string
  planDistance: (distance: string, rolling: boolean) => string
  you: string
  waiting: (name: string) => string
  yourTurn: string
  water: string
  out: string
  pickedUp: string
  holeInOne: string
  pinResult: (metres: string, yards: string) => string
  saved: string
  modeNames: Readonly<Record<RoundMode, string>>
  lieLabels: Readonly<Record<LieKind, string>>
  spinLabels: readonly [string, string, string]
  startError: string
  buttons: Readonly<Record<'aimLeft' | 'aimRight' | 'clubDown' | 'clubUp' | 'spinDown' | 'spinUp' | 'powerDown' | 'powerUp' | 'menu', readonly [label: string, name: string]>>
}

export interface PresenterCopy {
  distance: (metres: string, yards: string) => string
  decimalsBelow: number
  wind: (speed: string) => string
  scorecardTitle: string
  finalTitle: string
  pinFinishedTitle: string
  pinNoResult: string
  pinBest: (distance: string) => string
  holeColumn: string
  parColumn: string
  resultColumn: string
  totalColumn: string
  penaltyResult: string
  nextHole: string
  onlineWinner: (names: string, total: number) => string
  soloFinished: (total: number, relative: string) => string
  throughHoles: (played: number, of: number) => string
  holedOut: (label: string, strokes: number) => string
  ordinals: readonly string[]
  strokes: (value: number) => string
  boardEmpty: string
  boardLoading: string
  boardFailed: string
  boardColumns: readonly [string, string, string, string]
  personalBest: (value: string) => string
  lobbyIdle: string
  lobbyHosting: string
  lobbyJoining: string
  lobbyConnected: string
  lobbyLost: string
  lobbyError: (detail: string) => string
  lobbyFull: string
  hostTag: string
  youTag: string
  spectating: string
}

export interface RoomSettings {
  format: RoomFormat
  guestNameKey: string
  playerIdKey: string
  guestPrefix: string
  guestDigits: number
  dropAfterSeconds: number
}

export interface ModuleConfig extends Tuning {
  meta: ModuleMeta
  engine: EngineConfig
  bindings: ActionBindings<Action>
  terrain3d: TerrainLook
  water: WaterLook
  ball3d: BallLook
  tracer: TracerLook
  shotPreview: ShotPreviewSpec
  golfer: GolferLook
  golferTiming: { followSeconds: number }
  minimap: MinimapLook
  flag: FlagLook
  teeMarkers: TeeMarkerLook
  treeLook: TreeLook
  grass: GrassFieldLook
  sky: SkyLook
  gauge: GaugeLook
  spinDial: SpinDialLook
  windDial: WindDialLook
  hud: HudCopy
  presenters: PresenterCopy
  room: RoomSettings
  shadowFollowLead: number
}

const engine: EngineConfig = {
  ...ENGINE_DEFAULTS,
  renderer: { ...ENGINE_DEFAULTS.renderer, clearColor: '#bcd9f2', toneMappingExposure: 1.05 },
  camera: { ...ENGINE_DEFAULTS.camera, fov: 50, near: 0.05, far: 1600, position: [0, 3, 8], lookAt: [0, 1, -30] },
  lighting: {
    ...ENGINE_DEFAULTS.lighting,
    skyColor: '#d7ebff',
    groundColor: '#3d5a2c',
    hemisphereIntensity: 1.1,
    sunColor: '#fff2d6',
    sunIntensity: 2.6,
    sunDirection: [-0.45, 1, 0.3],
    sunDistance: 90,
    shadowExtent: 45,
  },
  environment: { ...ENGINE_DEFAULTS.environment, background: '#bcd9f2', fogColor: '#c7def0', fogNear: 220, fogFar: 900 },
  net: { ...ENGINE_DEFAULTS.net, maxPeers: 3 },
}

export const config: ModuleConfig = {
  ...tuning,
  meta: moduleJson as ModuleMeta,
  engine,
  bindings: {
    swing: [{ kind: 'mouse', button: 0 }, { kind: 'key', code: 'Space' }, { kind: 'pad', button: 0 }, { kind: 'touch', region: [0, 0, 1, 1] }],
    clubUp: [{ kind: 'key', code: 'KeyW' }, { kind: 'key', code: 'ArrowUp' }, { kind: 'pad', button: 12 }],
    clubDown: [{ kind: 'key', code: 'KeyS' }, { kind: 'key', code: 'ArrowDown' }, { kind: 'pad', button: 13 }],
    aimLeft: [{ kind: 'key', code: 'KeyA' }, { kind: 'key', code: 'ArrowLeft' }, { kind: 'pad', button: 14 }, { kind: 'axis', axis: 0, direction: -1 }],
    aimRight: [{ kind: 'key', code: 'KeyD' }, { kind: 'key', code: 'ArrowRight' }, { kind: 'pad', button: 15 }, { kind: 'axis', axis: 0, direction: 1 }],
    spinUp: [{ kind: 'key', code: 'KeyE' }, { kind: 'pad', button: 5 }],
    spinDown: [{ kind: 'key', code: 'KeyQ' }, { kind: 'pad', button: 4 }],
    powerUp: [{ kind: 'key', code: 'KeyR' }, { kind: 'pad', button: 7 }],
    powerDown: [{ kind: 'key', code: 'KeyF' }, { kind: 'pad', button: 6 }],
    shotNext: [{ kind: 'key', code: 'KeyT' }, { kind: 'pad', button: 3 }],
    shotFull: [{ kind: 'key', code: 'Digit1' }],
    shotChip: [{ kind: 'key', code: 'Digit2' }],
    shotFlop: [{ kind: 'key', code: 'Digit3' }],
    shotSpinner: [{ kind: 'key', code: 'Digit4' }],
    orbit: [{ kind: 'mouse', button: 2 }],
    menu: [{ kind: 'key', code: 'Escape' }, { kind: 'pad', button: 9 }],
  },
  terrain3d: {
    palette: {
      rough: '#3f7a33',
      roughDark: '#2f5f28',
      fairway: '#5da845',
      fairwayStripe: '#6ab851',
      green: '#73c757',
      greenStripe: '#80d264',
      bunker: '#e2d3a4',
      tee: '#68b84f',
      path: '#b8b1a1',
      waterBed: '#4a5a3a',
    },
    cellSize: { low: 3, medium: 2.2, high: 1.6, ultra: 1.2 },
    margin: 60,
    zoneSamples: [
      [-0.25, -0.25],
      [0.25, -0.25],
      [-0.25, 0.25],
      [0.25, 0.25],
      [0, 0],
    ],
    stripeWidth: 7,
    greenStripeWidth: 3.5,
    stripeEdges: [0.46, 0.54, 0.96, 1],
    noiseScales: [0.045, 0.21],
    noiseWeights: [0.65, 0.35],
    noiseStrength: 0.16,
    roughness: 0.92,
  },
  water: {
    shallow: '#4fa7c6',
    deep: '#1a5875',
    opacity: 0.86,
    roughness: 0.12,
    margin: 8,
    cellSize: 1.5,
    levelBelowShore: 0.22,
    shoreSamples: 24,
    fresnelPower: 3,
    waves: [
      { direction: [0.8, 0.6], amplitude: 0.035, wavelength: 4.5, speed: 0.9, steepness: 0.5 },
      { direction: [-0.3, 0.95], amplitude: 0.02, wavelength: 2.2, speed: 0.7, steepness: 0.4 },
    ],
  },
  ball3d: { color: '#ffffff', visualScale: 2.2, segments: 20, roughness: 0.35 },
  tracer: { color: '#fff7d6', maxPoints: 2400, opacity: 0.75 },
  shotPreview: {
    color: '#ffffff',
    zoneColor: '#ffd84a',
    restColor: '#4fd27a',
    maxBalls: 160,
    ballRadius: 0.06,
    flightSpacing: 3.2,
    rollSpacing: 1.1,
    growth: 0.02,
    opacity: 0.5,
    lineOpacity: 0.3,
    zoneDots: 36,
    zoneDotRadius: 0.09,
    restRadius: 0.32,
    lift: 0.05,
  },
  golfer: {
    skin: '#c99a76',
    hair: '#4a3324',
    shirt: '#24507a',
    collar: '#f2f0ea',
    pants: '#d9d2c1',
    belt: '#2b2b2b',
    sock: '#f4f4f0',
    shoe: '#f7f7f4',
    cap: '#f4f4f0',
    capBrim: '#24507a',
    glove: '#fbfbf8',
    shaft: '#c7ccd3',
    grip: '#1c1c1c',
    woodHead: '#1f2328',
    ironHead: '#d7dbe0',
    putterHead: '#9aa0a8',
    segments: 14,
    roughness: 0.72,
  },
  golferTiming: { followSeconds: 0.9 },
  minimap: {
    padding: 10,
    marginMetres: 12,
    cornerRadius: 12,
    treeMetres: 2.2,
    colors: {
      rough: '#2f5f28',
      fairway: '#5da845',
      green: '#80d264',
      bunker: '#e2d3a4',
      water: '#3f93b5',
      path: '#b8b1a1',
      tee: '#6ab851',
      tree: '#1c3a17',
      pin: '#ffffff',
      flag: '#f2483f',
      preview: 'rgba(255,255,255,0.9)',
      roll: 'rgba(255,255,255,0.65)',
      zone: '#ffd84a',
      zoneFill: 'rgba(255,216,74,0.22)',
      rest: '#4fd27a',
      flight: '#fff7d6',
      ball: '#ffffff',
      otherBall: '#ffb24a',
      outline: '#10161f',
    },
  },
  flag: {
    poleHeight: 2.3,
    poleRadius: 0.012,
    poleColor: '#f4f2ea',
    clothColor: '#f2483f',
    clothWidth: 0.55,
    clothHeight: 0.36,
    clothSegments: 12,
    flutterAmplitude: 0.05,
    flutterFrequency: 9,
    flutterSpeed: 6,
    celebrationBoost: 3,
    cupColor: '#141414',
    cupRadius: 0.054,
    cupLift: 0.004,
    poleSegments: 8,
    poleRoughness: 0.4,
    clothRoughness: 0.8,
  },
  teeMarkers: { colors: ['#f4f4f0', '#4fd27a'], radius: 0.09, height: 0.16, spread: 4, ahead: 2, segments: 10, roughness: 0.45 },
  treeLook: {
    species: [
      {
        barkColor: '#7a5a3c',
        barkDark: '#3e2a1a',
        leafLight: '#6f9e3c',
        leafDark: '#1f4219',
        trunkHeight: 4.2,
        trunkRadius: 0.36,
        trunkBend: 0.06,
        branches: 6,
        branchLength: 2.4,
        branchRise: 0.55,
        clumps: 9,
        clumpRadius: 1.55,
        crownRadius: 3.6,
        crownHeight: 4.6,
        crownBase: 2.9,
        roughness: 0.88,
        cards: 180,
        cardSize: 0.8,
        tiers: 0,
      },
      {
        barkColor: '#6a4b33',
        barkDark: '#2f2017',
        leafLight: '#3f7a45',
        leafDark: '#123222',
        trunkHeight: 7.6,
        trunkRadius: 0.3,
        trunkBend: 0.01,
        branches: 0,
        branchLength: 0,
        branchRise: 0,
        clumps: 0,
        clumpRadius: 0,
        crownRadius: 2.9,
        crownHeight: 7.4,
        crownBase: 1.4,
        roughness: 0.9,
        cards: 120,
        cardSize: 0.7,
        tiers: 7,
      },
      {
        barkColor: '#e8e2d6',
        barkDark: '#7d756a',
        leafLight: '#9cc25a',
        leafDark: '#35602a',
        trunkHeight: 6.4,
        trunkRadius: 0.22,
        trunkBend: 0.09,
        branches: 5,
        branchLength: 1.8,
        branchRise: 0.9,
        clumps: 7,
        clumpRadius: 1.15,
        crownRadius: 2.4,
        crownHeight: 4.4,
        crownBase: 3.8,
        roughness: 0.85,
        cards: 160,
        cardSize: 0.55,
        tiers: 0,
      },
    ],
    sphereDetail: 2,
    radialSegments: 8,
    heightSegments: 5,
    displacement: 0.34,
    noiseFrequency: 1.9,
    tierDroop: 0.42,
    tierJag: 0.3,
    swayAmplitude: 0.09,
    swaySpeed: 1.3,
    tintVariation: 0.22,
    normalLift: 0.35,
  },
  grass: {
    blade: {
      bladeWidth: 0.034,
      bladeHeight: 0.2,
      segments: 4,
      curve: 0.05,
      baseColor: '#3a6b2a',
      tipColor: '#8fc45a',
      roughness: 0.85,
      swayAmplitude: 0.035,
      swaySpeed: 2.1,
      swayScale: 0.35,
    },
    capacity: { low: 0, medium: 16000, high: 42000, ultra: 70000 },
    radius: 26,
    replantDistance: 6,
    edgeFade: 0.25,
    heights: { rough: 1, fairway: 0.32, tee: 0.3, green: 0.12, bunker: 0, water: 0, path: 0 },
    tints: { rough: 1, fairway: 1.5, tee: 1.55, green: 1.7, bunker: 1, water: 1, path: 1 },
    heightVariation: 0.6,
    widthVariation: 0.5,
    tintVariation: 0.25,
    maxLean: 0.5,
  },
  sky: { top: '#5f9fe6', horizon: '#d5e9fb', radius: 1200, exponent: 0.6, widthSegments: 32, heightSegments: 16 },
  gauge: {
    size: 196,
    outerRadius: 86,
    outerWidth: 13,
    cursorRadius: 64,
    cursorWidth: 9,
    cursorSize: 7,
    innerRadius: 36,
    rhythmWidth: 4,
    markWidth: 3,
    track: 'rgba(255,255,255,0.14)',
    power: '#4fd27a',
    overPower: '#ffb24a',
    plan: '#ffffff',
    mark: '#ffffff',
    perfect: 'rgba(79,210,122,0.45)',
    cursor: '#ffd84a',
    rhythm: '#39d0ff',
    good: '#4fd27a',
    bad: '#ff6a5a',
    text: '#ffffff',
    font: '800 26px Rajdhani, Inter, system-ui, sans-serif',
    labels: {
      perfect: 'Perfect',
      push: 'Push',
      pull: 'Pull',
      hook: 'Closed (hook)',
      slice: 'Open (slice)',
      power: (power, planned) => `Hold… release at ${planned}% (now ${power}%)`,
      path: (power) => `Power ${power}% · tap at the bottom mark`,
      contact: (path) => `Path: ${path} · click at the top mark and hold`,
      rhythm: 'Keep holding… release when the rings meet',
      result: (power, parts, loss) => `Power ${power}% · ${parts.join(' · ')}${loss > 0 ? ` · Rhythm −${loss}%` : ' · Rhythm perfect'}`,
    },
  },
  spinDial: {
    width: 126,
    height: 104,
    ballRadius: 27,
    arrowGap: 10,
    meterWidth: 16,
    back: '#39d0ff',
    top: '#ffb24a',
    neutral: 'rgba(255,255,255,0.55)',
    backLabel: 'B',
    topLabel: 'T',
    labelFont: '800 10px Inter, system-ui, sans-serif',
    turnsPerSecond: 0.8,
  },
  windDial: { size: 58, aim: '#4fd27a', calm: '#9fe0b4', breeze: '#ffd84a', strong: '#ff6a5a' },
  hud: {
    controlsHint: 'Hold click/Space/tap for power and release at the marker · tap at the bottom mark · click at the top and hold · release when the rings meet. A/D aim · W/S club · R/F power · 1–4 or T shot type · Q/E spin · right-drag to look · Esc menu',
    hole: 'Hole',
    par: 'Par',
    stroke: 'Stroke',
    total: 'Total',
    wind: 'Wind',
    club: 'Club',
    lie: 'Lie',
    toPin: 'To pin',
    spin: 'Spin',
    shot: 'Shot',
    power: 'Power',
    shotNames: { full: 'Full', chip: 'Chip', flop: 'Flop', spinner: 'Spinner' },
    shotHints: {
      full: 'Full swing',
      chip: 'Low chip: lands early and runs out',
      flop: 'Flop: high, soft, stops quickly',
      spinner: 'Spinner: low, checks hard and can zip back',
    },
    bag: 'Golf bag',
    helpLabel: 'Show the controls',
    holeLength: (yards, metres) => `${yards} yd · ${metres} m`,
    clubDetail: (loft, carry) => `Loft ${loft}°${carry === null ? '' : ` · carry ${carry} m`}`,
    putterDetail: 'Rolls the ball on the green',
    spinRpm: (rpm) => `≈ ${rpm.toLocaleString('en-US')} rpm`,
    planDistance: (distance, rolling) => (rolling ? `Stops at ${distance}` : `Carries ${distance}`),
    you: 'you',
    waiting: (name) => `${name} is shooting`,
    yourTurn: 'Your shot',
    water: 'In the water: one-stroke penalty, drop taken',
    out: 'Out of bounds: stroke and distance',
    pickedUp: 'Picked up at the stroke limit',
    holeInOne: 'Hole in one!',
    pinResult: (metres, yards) => `${metres} m (${yards} yd) from the pin`,
    saved: 'Saved to the record book',
    modeNames: { solo: 'Solo round', pin: 'Closest to the pin', online: 'Online room' },
    lieLabels: { tee: 'Tee', fairway: 'Fairway', rough: 'Rough', green: 'Green', bunker: 'Bunker', path: 'Cart path' },
    spinLabels: ['Topspin', 'Neutral', 'Backspin'],
    startError: 'This learning module could not start on this device.',
    buttons: {
      aimLeft: ['◀', 'Aim left'],
      aimRight: ['▶', 'Aim right'],
      clubDown: ['‹', 'Shorter club'],
      clubUp: ['›', 'Longer club'],
      spinDown: ['▼', 'Less backspin'],
      spinUp: ['▲', 'More backspin'],
      powerDown: ['−', 'Less planned power'],
      powerUp: ['+', 'More planned power'],
      menu: ['☰', 'Menu'],
    },
  },
  presenters: {
    distance: (metres, yards) => `${metres} m · ${yards} yd`,
    decimalsBelow: 10,
    wind: (speed) => `${speed} m/s`,
    scorecardTitle: 'Scorecard',
    finalTitle: 'Final scorecard',
    pinFinishedTitle: 'Closest to the pin: results',
    pinNoResult: 'No shot finished on dry land this time.',
    pinBest: (distance) => `Best shot: ${distance} from the pin.`,
    holeColumn: 'Hole',
    parColumn: 'Par',
    resultColumn: 'Result',
    totalColumn: 'Total',
    penaltyResult: 'Penalty',
    nextHole: 'Next hole',
    onlineWinner: (names, total) => `${names} won with ${total} strokes.`,
    soloFinished: (total, relativeToPar) => `You went round in ${total} (${relativeToPar}).`,
    throughHoles: (played, of) => `Through ${played} of ${of} holes.`,
    holedOut: (label, strokes) => `${label} · ${strokes} ${strokes === 1 ? 'stroke' : 'strokes'}`,
    ordinals: ['st', 'nd', 'rd', 'th'],
    strokes: (value) => `${value} strokes`,
    boardEmpty: 'No results yet. Finish a round to set the first one.',
    boardLoading: 'Loading the record book…',
    boardFailed: 'The record book is unavailable right now.',
    boardColumns: ['Rank', 'Player', 'Result', 'Date'],
    personalBest: (value) => `Your best: ${value}`,
    lobbyIdle: 'Host a room or join one with its six-character code.',
    lobbyHosting: 'Opening a room…',
    lobbyJoining: 'Joining the room…',
    lobbyConnected: 'Connected. Waiting for the host to start the match.',
    lobbyLost: 'The connection dropped. Trying to reconnect…',
    lobbyError: (detail) => `The room could not be reached (${detail}). Check the code and try again.`,
    lobbyFull: 'Share the code. Up to four players, three holes. Start when everyone is in.',
    hostTag: 'host',
    youTag: 'you',
    spectating: 'The match had already started, so you are watching.',
  },
  room: {
    format: ROOM_FORMATS.fairway,
    guestNameKey: 'fairway/guest-name',
    playerIdKey: 'fairway/player-id',
    guestPrefix: 'Guest-',
    guestDigits: 5,
    dropAfterSeconds: 25,
  },
  shadowFollowLead: 8,
}
