/** Every Fairway Nine tunable: the pure physics and course data from tuning.ts plus engine overrides, input bindings, colors, model specs, HUD copy and room settings. */
import { ENGINE_DEFAULTS, ROOM_FORMATS, type ActionBindings, type EngineConfig, type QualityTier, type RoomFormat } from '../../engine'
import moduleJson from './module.json'
import { tuning, type LieKind, type RoundMode, type SurfaceKind, type Tuning } from './tuning'
import type { TreesSpec } from './models/Trees'
import type { GrassSpec } from './models/Grass'

export type Action = 'swing' | 'clubUp' | 'clubDown' | 'aimLeft' | 'aimRight' | 'spinUp' | 'spinDown' | 'orbit' | 'menu'

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

export interface AimLook {
  color: string
  dots: number
  spacing: number
  radius: number
  lift: number
  opacity: number
  segments: number
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
  thickness: number
  startAngle: number
  sweep: number
  track: string
  fill: string
  accuracyLine: string
  perfect: string
  needle: string
  fillWidthRatio: number
  lineWidth: number
  needleWidth: number
  needleReach: number
  labels: { straight: string; hook: string; slice: string; power: string; accuracy: string }
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
  readout: (power: number, accuracy: string) => string
  startError: string
  windArrow: string
  buttons: Readonly<Record<'aimLeft' | 'aimRight' | 'clubDown' | 'clubUp' | 'spinDown' | 'spinUp' | 'menu', readonly [label: string, name: string]>>
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
  aimGuide: AimLook
  flag: FlagLook
  teeMarkers: TeeMarkerLook
  treeLook: TreeLook
  grass: GrassFieldLook
  sky: SkyLook
  gauge: GaugeLook
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
  aimGuide: { color: '#4fd27a', dots: 18, spacing: 4, radius: 0.22, lift: 0.04, opacity: 0.8, segments: 12 },
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
    size: 168, thickness: 16, startAngle: Math.PI * 0.85, sweep: Math.PI * 1.3, track: 'rgba(255,255,255,0.14)', fill: '#4fd27a', accuracyLine: '#ffffff', perfect: 'rgba(79,210,122,0.45)',
    needle: '#ffd84a',
    fillWidthRatio: 0.6,
    lineWidth: 3,
    needleWidth: 4,
    needleReach: 1.2,
    labels: { straight: 'Straight', hook: 'Hook', slice: 'Slice', power: 'Setting power…', accuracy: 'Click on the line…' },
  },
  hud: {
    controlsHint: 'Click, Space or tap three times: start, set power, set accuracy. A/D aim · W/S club · Q/E spin · right-drag to look around · Esc for the menu',
    hole: 'Hole',
    par: 'Par',
    stroke: 'Stroke',
    total: 'Total',
    wind: 'Wind',
    club: 'Club',
    lie: 'Lie',
    toPin: 'To pin',
    spin: 'Spin',
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
    readout: (power, accuracy) => `Power ${power}% · ${accuracy}`,
    startError: 'This learning module could not start on this device.',
    windArrow: '↑',
    buttons: {
      aimLeft: ['◀', 'Aim left'],
      aimRight: ['▶', 'Aim right'],
      clubDown: ['Club −', 'Shorter club'],
      clubUp: ['Club +', 'Longer club'],
      spinDown: ['Spin −', 'Less backspin'],
      spinUp: ['Spin +', 'More backspin'],
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
