/** Every tunable for Demo Derby: engine overrides, bindings, arena size, car bodies, paint and number options, vehicle physics, damage, AI and scoring. */
import { ENGINE_DEFAULTS, type ActionBindings, type EngineConfig } from '../../engine'
import moduleJson from './module.json'

export type Action = 'forward' | 'back' | 'left' | 'right' | 'brake' | 'reset' | 'camera' | 'debug'

export interface ModuleMeta {
  id: string
  title: string
  accent: string
  modes: readonly ('solo' | 'online')[]
}

export type BodyStyle = 'wagon' | 'sedan'
export type NumberFont = 'block' | 'stencil' | 'brush' | 'western' | 'outline' | 'scrawl'

export interface PaintOption {
  id: string
  name: string
  hex: string
}

export interface FontOption {
  id: NumberFont
  name: string
  family: string
  weight: string
  italic: boolean
  /** Letter spacing as a fraction of the font size. */
  tracking: number
  /** Draws a hollow number with a thick stroke instead of a filled one. */
  hollow: boolean
  /** Adds stencil bridges across the glyphs. */
  stencil: boolean
  /** Rotates the number a little and adds paint drips underneath. */
  rough: boolean
}

export interface BodySpec {
  id: BodyStyle
  name: string
  blurb: string
  length: number
  width: number
  /** Body floor (rocker bottom) height above the ground. */
  sill: number
  /** Belt line (top of the doors) height above the ground. */
  belt: number
  /** Roof height above the ground. */
  roof: number
  /** Height of the hood at the nose and of the deck or tailgate top at the tail. */
  noseTop: number
  tailTop: number
  /** Where the cowl (windshield base), B pillar and C pillar sit along the length, as fractions from the nose. */
  cowl: number
  bPillar: number
  cPillar: number
  /** How far the windshield and backlight lean back, in metres along the length. */
  windshieldRake: number
  backlightRake: number
  /** Fractions of the length where the door seams are. */
  seams: readonly number[]
  roofRack: boolean
  quadLamps: boolean
  mass: number
  wheelbase: number
  track: number
  wheelRadius: number
  wheelWidth: number
  /** Chassis collider half extents (x, y, z) and the height of the body origin above the ground. */
  colliderHalf: readonly [number, number, number]
  centreHeight: number
}

export interface VehicleSpec {
  suspensionRest: number
  suspensionTravel: number
  suspensionStiffness: number
  suspensionCompression: number
  suspensionRelaxation: number
  maxSuspensionForce: number
  frictionSlip: number
  sideFrictionStiffness: number
  engineForce: number
  reverseForce: number
  brakeForce: number
  rollingBrake: number
  maxSteer: number
  steerRate: number
  /** Speed (m/s) at which steering lock has shrunk to steerAtSpeedScale of the maximum. */
  steerFadeSpeed: number
  steerAtSpeedScale: number
  topSpeed: number
  reverseTopSpeed: number
  linearDamping: number
  angularDamping: number
  bodyFriction: number
  bodyRestitution: number
  /** Below this speed with throttle held for longer than stuckSeconds the car counts as stuck. */
  stuckSpeed: number
  stuckSeconds: number
  flipRecoverSeconds: number
}

export interface DamageSpec {
  /** Contact force (N) that counts as keeping active for the no-contact clock, without damage. */
  contactThreshold: number
  /** Contact force (N) below which a touch is not a hit. */
  hitThreshold: number
  /** Contact force that counts as a full-strength hit. */
  hitFull: number
  /** Health lost by a full-strength hit on the receiving car. */
  maxHitDamage: number
  /** Multipliers by the zone of the car that took the hit. */
  zone: { front: number; rear: number; side: number }
  /** Share of a front hit that also goes to the engine. */
  engineShare: { front: number; rear: number; side: number }
  /** Power left at zero engine health. */
  powerFloor: number
  /** Dent radius (m), depth (m) and vertex colour darkening at a full-strength hit. */
  dentRadius: number
  dentDepth: number
  dentMaxDepth: number
  dentDarken: number
  /** Seconds after a hit before the same pair can register again. */
  hitCooldown: number
  /** Cars that have not hit anyone for this long are called out of the heat. */
  idleOutSeconds: number
  idleWarnSeconds: number
  /** Smoke starts below this engine health. */
  smokeBelow: number
}

export interface AiLevel {
  id: 'rookie' | 'local' | 'veteran'
  name: string
  throttle: number
  aggression: number
  /** Seconds between target re-picks. */
  retarget: number
  /** How much the AI prefers a backing-in hit over a nose hit (0–1). */
  rearPreference: number
}

export interface ScoringSpec {
  /** Points per full-strength hit landed. */
  hitPoints: number
  knockoutPoints: number
  winPoints: number
  survivalPerSecond: number
}

export interface ModuleConfig {
  meta: ModuleMeta
  engine: EngineConfig
  bindings: ActionBindings<Action>
  arena: {
    length: number
    width: number
    /** Barrier height and thickness. */
    barrierHeight: number
    barrierThickness: number
    barrierSegment: number
    groundColor: string
    groundDark: string
    groundSize: number
    dirtTexture: number
    grandstandRows: number
    grandstandSeats: number
    crowdColors: readonly string[]
    lightPoles: number
  }
  sky: { top: string; horizon: string; radius: number; exponent: number; widthSegments: number; heightSegments: number }
  bodies: readonly BodySpec[]
  paints: readonly PaintOption[]
  fonts: readonly FontOption[]
  numberColors: readonly PaintOption[]
  vehicle: VehicleSpec
  damage: DamageSpec
  ai: readonly AiLevel[]
  scoring: ScoringSpec
  heat: { minOpponents: number; maxOpponents: number; defaultOpponents: number; countdownSeconds: number; spawnRing: number; finishHoldSeconds: number }
  camera: { chaseDistance: number; chaseHeight: number; lookAhead: number; stiffness: number; orbitSpeed: number; pitchMin: number; pitchMax: number; standPosition: readonly [number, number, number] }
  dust: { count: number; life: number; size: number; color: string; slipSpeed: number }
  smoke: { count: number; life: number; size: number; color: string }
  hud: { controlsHint: string }
  storageKey: string
}

const wagon: BodySpec = {
  id: 'wagon',
  name: 'Longroof wagon',
  blurb: 'Full-size 1970s family hauler. Long, heavy, and the tailgate takes a beating.',
  length: 5.6,
  width: 2.02,
  sill: 0.34,
  belt: 1.0,
  roof: 1.5,
  noseTop: 0.9,
  tailTop: 1.0,
  cowl: 0.37,
  bPillar: 0.6,
  cPillar: 0.8,
  windshieldRake: 0.72,
  backlightRake: 0.14,
  seams: [0.37, 0.6, 0.8],
  roofRack: true,
  quadLamps: true,
  mass: 2050,
  wheelbase: 3.2,
  track: 1.76,
  wheelRadius: 0.37,
  wheelWidth: 0.24,
  colliderHalf: [1.0, 0.5, 2.78],
  centreHeight: 0.86,
}

const sedan: BodySpec = {
  id: 'sedan',
  name: 'Boulevard sedan',
  blurb: 'Big four-door cruiser with a long trunk. A little lighter and quicker to turn around.',
  length: 5.4,
  width: 1.98,
  sill: 0.34,
  belt: 0.98,
  roof: 1.44,
  noseTop: 0.88,
  tailTop: 0.9,
  cowl: 0.37,
  bPillar: 0.58,
  cPillar: 0.72,
  windshieldRake: 0.7,
  backlightRake: 0.62,
  seams: [0.37, 0.58, 0.76],
  roofRack: false,
  quadLamps: false,
  mass: 1900,
  wheelbase: 3.1,
  track: 1.72,
  wheelRadius: 0.36,
  wheelWidth: 0.23,
  colliderHalf: [0.98, 0.5, 2.68],
  centreHeight: 0.85,
}

export const config: ModuleConfig = {
  meta: moduleJson as ModuleMeta,
  engine: {
    ...ENGINE_DEFAULTS,
    renderer: { ...ENGINE_DEFAULTS.renderer, clearColor: '#c9a977', toneMappingExposure: 1.0 },
    camera: { fov: 58, near: 0.2, far: 600, position: [0, 9, 18], lookAt: [0, 0, 0] },
    environment: { ...ENGINE_DEFAULTS.environment, background: '#d9b98a', fogColor: '#d9b98a', fogNear: 90, fogFar: 320 },
    lighting: {
      ...ENGINE_DEFAULTS.lighting,
      skyColor: '#ffe8c4',
      groundColor: '#6b4a2a',
      hemisphereIntensity: 0.55,
      sunColor: '#ffdcae',
      sunIntensity: 3.0,
      sunDirection: [-0.55, 0.9, 0.4],
      sunDistance: 70,
      shadowExtent: 34,
    },
  },
  bindings: {
    forward: [{ kind: 'key', code: 'KeyW' }, { kind: 'key', code: 'ArrowUp' }, { kind: 'axis', axis: 1, direction: -1 }, { kind: 'pad', button: 7 }, { kind: 'touch', region: [0.5, 0.45, 1, 0.75] }],
    back: [{ kind: 'key', code: 'KeyS' }, { kind: 'key', code: 'ArrowDown' }, { kind: 'axis', axis: 1, direction: 1 }, { kind: 'pad', button: 6 }, { kind: 'touch', region: [0.5, 0.75, 1, 1] }],
    left: [{ kind: 'key', code: 'KeyA' }, { kind: 'key', code: 'ArrowLeft' }, { kind: 'axis', axis: 0, direction: -1 }, { kind: 'touch', region: [0, 0.55, 0.25, 1] }],
    right: [{ kind: 'key', code: 'KeyD' }, { kind: 'key', code: 'ArrowRight' }, { kind: 'axis', axis: 0, direction: 1 }, { kind: 'touch', region: [0.25, 0.55, 0.5, 1] }],
    brake: [{ kind: 'key', code: 'Space' }, { kind: 'pad', button: 0 }],
    reset: [{ kind: 'key', code: 'KeyR' }, { kind: 'pad', button: 3 }],
    camera: [{ kind: 'key', code: 'KeyC' }, { kind: 'pad', button: 2 }],
    debug: [{ kind: 'key', code: 'KeyP' }],
  },
  arena: {
    length: 36,
    width: 22,
    barrierHeight: 0.85,
    barrierThickness: 0.6,
    barrierSegment: 3,
    groundColor: '#9c7a52',
    groundDark: '#6b4e2e',
    groundSize: 220,
    dirtTexture: 1024,
    grandstandRows: 9,
    grandstandSeats: 48,
    crowdColors: ['#e3e3e3', '#1f3a73', '#b3312f', '#2d7a3e', '#f0c23a', '#f5a04b', '#7a4ca8', '#ff5f6d', '#3aa7c9', '#2b2b2b', '#ffd7b5', '#c48a5a'],
    lightPoles: 4,
  },
  sky: { top: '#5f8fd6', horizon: '#f2cf9e', radius: 480, exponent: 0.8, widthSegments: 32, heightSegments: 16 },
  bodies: [wagon, sedan],
  paints: [
    { id: 'primer', name: 'Grey primer', hex: '#8a8d90' },
    { id: 'rust', name: 'Rust bucket', hex: '#7a3e1e' },
    { id: 'red', name: 'Barn red', hex: '#b3261e' },
    { id: 'orange', name: 'Safety orange', hex: '#ff6a1a' },
    { id: 'yellow', name: 'School bus', hex: '#f5c21b' },
    { id: 'lime', name: 'Lime', hex: '#8ed13a' },
    { id: 'green', name: 'John boat green', hex: '#2d6b3a' },
    { id: 'teal', name: 'Teal', hex: '#1f8f8a' },
    { id: 'sky', name: 'Sky blue', hex: '#58a6e8' },
    { id: 'navy', name: 'Navy', hex: '#1d3a6b' },
    { id: 'purple', name: 'Grape', hex: '#6a3b9c' },
    { id: 'pink', name: 'Bubblegum', hex: '#f26ba8' },
    { id: 'white', name: 'Flat white', hex: '#e8e4d8' },
    { id: 'black', name: 'Flat black', hex: '#1e1e20' },
    { id: 'brown', name: 'Woodie brown', hex: '#6b4a2a' },
    { id: 'cream', name: 'Cream', hex: '#efe2b8' },
  ],
  fonts: [
    { id: 'block', name: 'Block', family: '"Arial Black", Impact, "Helvetica Neue", Arial, sans-serif', weight: '900', italic: false, tracking: 0.02, hollow: false, stencil: false, rough: false },
    { id: 'stencil', name: 'Stencil', family: 'Impact, "Arial Narrow Bold", "Arial Black", sans-serif', weight: '900', italic: false, tracking: 0.06, hollow: false, stencil: true, rough: false },
    { id: 'brush', name: 'Brush', family: '"Brush Script MT", "Segoe Script", "Comic Sans MS", cursive', weight: '700', italic: true, tracking: 0, hollow: false, stencil: false, rough: false },
    { id: 'western', name: 'Western', family: '"Rockwell Extra Bold", Rockwell, "Courier New", "Georgia", serif', weight: '900', italic: false, tracking: 0.08, hollow: false, stencil: false, rough: false },
    { id: 'outline', name: 'Outline', family: 'Impact, "Arial Black", sans-serif', weight: '900', italic: false, tracking: 0.04, hollow: true, stencil: false, rough: false },
    { id: 'scrawl', name: 'Scrawl', family: '"Marker Felt", "Comic Sans MS", "Segoe Print", "Chalkboard", sans-serif', weight: '700', italic: false, tracking: 0.04, hollow: false, stencil: false, rough: true },
  ],
  numberColors: [
    { id: 'white', name: 'White', hex: '#f4f1ea' },
    { id: 'black', name: 'Black', hex: '#141414' },
    { id: 'yellow', name: 'Yellow', hex: '#ffd21f' },
    { id: 'red', name: 'Red', hex: '#d8261e' },
    { id: 'blue', name: 'Blue', hex: '#1f5fd8' },
    { id: 'green', name: 'Green', hex: '#2fb34a' },
    { id: 'orange', name: 'Orange', hex: '#ff7a1a' },
    { id: 'pink', name: 'Pink', hex: '#ff5fb0' },
  ],
  vehicle: {
    suspensionRest: 0.34,
    suspensionTravel: 0.22,
    suspensionStiffness: 26,
    suspensionCompression: 3.4,
    suspensionRelaxation: 2.6,
    maxSuspensionForce: 60000,
    frictionSlip: 1.9,
    sideFrictionStiffness: 0.55,
    engineForce: 5200,
    reverseForce: 4200,
    brakeForce: 90,
    rollingBrake: 4,
    maxSteer: 0.62,
    steerRate: 2.8,
    steerFadeSpeed: 14,
    steerAtSpeedScale: 0.45,
    topSpeed: 15,
    reverseTopSpeed: 9,
    linearDamping: 0.12,
    angularDamping: 0.9,
    bodyFriction: 0.5,
    bodyRestitution: 0.12,
    stuckSpeed: 1.1,
    stuckSeconds: 1.6,
    flipRecoverSeconds: 3,
  },
  damage: {
    contactThreshold: 30000,
    hitThreshold: 70000,
    hitFull: 480000,
    maxHitDamage: 28,
    zone: { front: 1.25, rear: 0.7, side: 1.0 },
    engineShare: { front: 0.9, rear: 0.1, side: 0.3 },
    powerFloor: 0.28,
    dentRadius: 1.15,
    dentDepth: 0.22,
    dentMaxDepth: 0.42,
    dentDarken: 0.35,
    hitCooldown: 0.35,
    idleOutSeconds: 60,
    idleWarnSeconds: 15,
    smokeBelow: 45,
  },
  ai: [
    { id: 'rookie', name: 'Rookie', throttle: 0.72, aggression: 0.5, retarget: 3.2, rearPreference: 0.3 },
    { id: 'local', name: 'Local', throttle: 0.88, aggression: 0.75, retarget: 2.4, rearPreference: 0.55 },
    { id: 'veteran', name: 'Veteran', throttle: 1, aggression: 1, retarget: 1.6, rearPreference: 0.75 },
  ],
  scoring: { hitPoints: 100, knockoutPoints: 250, winPoints: 1000, survivalPerSecond: 2 },
  heat: { minOpponents: 3, maxOpponents: 9, defaultOpponents: 6, countdownSeconds: 3, spawnRing: 0.78, finishHoldSeconds: 2.5 },
  camera: { chaseDistance: 9.5, chaseHeight: 4.2, lookAhead: 2.5, stiffness: 5.5, orbitSpeed: 0.0045, pitchMin: 0.08, pitchMax: 0.9, standPosition: [0, 11, 26] },
  dust: { count: 600, life: 1.4, size: 0.9, color: '#c8a473', slipSpeed: 2.5 },
  smoke: { count: 400, life: 2.2, size: 1.1, color: '#4a4a4a' },
  hud: { controlsHint: 'W/S or ↑/↓ throttle and reverse · A/D steer · Space brake · R flip back over · C camera · drag to look' },
  storageKey: 'tl-demoderby-look',
}

export function paintById(id: string): PaintOption {
  return config.paints.find((paint) => paint.id === id) ?? config.paints[0]
}

export function numberColorById(id: string): PaintOption {
  return config.numberColors.find((paint) => paint.id === id) ?? config.numberColors[0]
}

export function fontById(id: string): FontOption {
  return config.fonts.find((font) => font.id === id) ?? config.fonts[0]
}

export function bodyById(id: string): BodySpec {
  return config.bodies.find((body) => body.id === id) ?? config.bodies[0]
}

export function aiLevelById(id: string): AiLevel {
  return config.ai.find((level) => level.id === id) ?? config.ai[1]
}
