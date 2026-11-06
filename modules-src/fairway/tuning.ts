/** Pure Fairway Nine tunables (physics, clubs, surfaces, wind, meter, camera, match rules, hole data). Shared by config.ts, systems/ and the node tests, so it imports nothing but data. */
import holesJson from './data/holes.json'

export type Vec2 = readonly [number, number]
export type Polygon = readonly Vec2[]

export type SurfaceKind = 'tee' | 'fairway' | 'rough' | 'green' | 'bunker' | 'water' | 'path'
export type LieKind = 'tee' | 'fairway' | 'rough' | 'green' | 'bunker' | 'path'
export type ClubId = 'driver' | 'wood3' | 'hybrid5' | 'iron5' | 'iron7' | 'iron9' | 'pitching' | 'sand' | 'putter'
export type RoundMode = 'solo' | 'pin' | 'online'

export interface HillData {
  x: number
  z: number
  radius: number
  height: number
}

export interface TreeData {
  x: number
  z: number
  scale: number
  variant: number
}

export interface HoleData {
  number: number
  name: string
  par: number
  yards: number
  tee: Vec2
  pin: Vec2
  route: readonly Vec2[]
  teeBox: Polygon
  fairway: readonly Polygon[]
  green: Polygon
  bunkers: readonly Polygon[]
  water: readonly Polygon[]
  paths: readonly Polygon[]
  drops: readonly Vec2[]
  hills: readonly HillData[]
  greenSlope: Vec2
  trees: readonly TreeData[]
  bounds: readonly [minX: number, minZ: number, maxX: number, maxZ: number]
}

export interface ClubSpec {
  id: ClubId
  name: string
  short: string
  loftDegrees: number
  clubSpeed: number
  smashFactor: number
  spinRpm: number
  putter: boolean
}

export interface BallSpec {
  massKg: number
  radiusM: number
  dragCoefficient: number
  liftSlope: number
  liftMax: number
  spinDecaySeconds: number
}

export interface AirSpec {
  density: number
  gravity: number
}

export interface SurfaceContact {
  restitution: number
  tangentialFriction: number
  rollingFriction: number
  spinRetention: number
  backspinCheck: number
}

export interface LieSpec {
  powerRange: readonly [number, number]
  spinFactor: number
  puttingOnly: boolean
}

export interface TreeCollision {
  trunkRadius: number
  trunkHeight: number
  crownRadius: number
  crownCenterHeight: number
  crownDragPerSecond: number
  trunkRestitution: number
}

export interface CupSpec {
  radius: number
  captureSpeed: number
  dunkSpeed: number
}

export interface FlightSpec {
  stepHz: number
  maxSeconds: number
  restSpeed: number
  staticSlopeFactor: number
  bounceMinNormalSpeed: number
  gradientEpsilon: number
  spinRangeFraction: number
  carryRange: readonly [number, number]
}

export interface TerrainShapeSpec {
  basinDepth: number
  basinShoreWidth: number
  bunkerDepth: number
  bunkerLipWidth: number
  greenTiltRadius: number
}

export interface WindSpec {
  speedRange: readonly [number, number]
  referenceHeight: number
  heightExponent: number
  groundFactor: number
}

export type ShotKind = 'full' | 'chip' | 'flop' | 'spinner'

/** How a shot type changes what happens when the ball meets the ground: multipliers on the surface contact, plus how far a checking ball may zip back. */
export interface LandingSpec {
  restitution: number
  friction: number
  check: number
  rolling: number
  reverse: number
}

export interface ShotKindSpec {
  speedScale: number
  loftScale: number
  loftAdd: number
  spinScale: number
  landing: LandingSpec
  /** Swing size on the golfer: backswing and finish length as a fraction of a full swing. */
  backswing: number
  finish: number
}

export interface ShortGameSpec {
  /** Inside this distance to the pin the shot picker defaults to a chip. */
  autoChipRange: number
  /** Power the planner never goes below. */
  minPower: number
  plannerIterations: number
  previewSeed: number
  /** Putts are planned to finish this far past the cup. */
  puttPast: number
}

export interface MeterSpec {
  /** Power ring fill rate while the button is held (fraction per second). */
  powerRate: number
  powerCap: number
  /** Seconds for the cursor to run from the top mark to the bottom mark (path), then back up (contact). */
  pathSeconds: number
  contactSeconds: number
  /** How far past a mark the cursor may run (fraction of the half turn) before the swing is taken as a full miss. */
  overrun: number
  /** Timing error, as a fraction of the half turn, that counts as a full miss. */
  window: number
  /** Fraction of the window that counts as perfect. */
  perfectZone: number
  missCurve: number
  /** Seconds for the inner rhythm ring to grow out to its mark. */
  rhythmSeconds: number
  rhythmWindow: number
  rhythmPerfect: number
  rhythmOverrun: number
  /** Distance lost on a fully missed rhythm release. */
  maxRhythmLoss: number
  /** Downswing time between the rhythm release and impact. */
  strikeSeconds: number
  /** Start-line change on a full path miss (push right, pull left). */
  maxPushRadians: number
  /** Start-line change from a full clubface miss, on top of its sidespin. */
  maxYawRadians: number
  maxSideSpinTilt: number
}

export interface CameraSpec {
  followDistance: number
  followHeight: number
  followLookAhead: number
  orbitSensitivity: number
  orbitPitchSensitivity: number
  pitchRange: readonly [number, number]
  previewSeconds: number
  previewHeight: number
  previewBack: number
  trackingDistance: number
  trackingHeight: number
  trackingStiffness: number
  followStiffness: number
  greenHeight: number
  greenBack: number
  greenTiltLookAhead: number
  greenBackPerMetre: number
  greenHeightPerMetre: number
  greenLookPerMetre: number
  lookAtLift: number
  groundClearance: number
  previewClearance: number
  trackingClearance: number
  previewLead: number
  minHeadingDistance: number
}

export interface MatchSpec {
  maxStrokesPerHole: number
  onlineHoleCount: number
  maxPlayers: number
  waterPenalty: number
  outOfBoundsPenalty: number
  pinTeeDistance: number
}

export interface AimSpec {
  turnRate: number
  spinStep: number
  nudgeSeconds: number
  /** Planned-power change per second while the power keys are held, and per HUD button press. */
  powerRate: number
  powerStep: number
}

export interface RoundTiming {
  restSeconds: number
  nextTurnSeconds: number
  holeOutSeconds: number
  celebrationSeconds: number
  scorecardSeconds: number
}

export interface Tuning {
  air: AirSpec
  ball: BallSpec
  clubs: readonly ClubSpec[]
  contact: Readonly<Record<SurfaceKind, SurfaceContact>>
  lies: Readonly<Record<LieKind, LieSpec>>
  trees: TreeCollision
  cup: CupSpec
  flight: FlightSpec
  terrain: TerrainShapeSpec
  wind: WindSpec
  meter: MeterSpec
  shots: Readonly<Record<ShotKind, ShotKindSpec>>
  shortGame: ShortGameSpec
  camera: CameraSpec
  match: MatchSpec
  aim: AimSpec
  timing: RoundTiming
  scoreNames: Readonly<Record<string, string>>
  metresPerYard: number
  holes: readonly HoleData[]
}

export const tuning: Tuning = {
  air: { density: 1.225, gravity: 9.81 },
  ball: { massKg: 0.04593, radiusM: 0.021335, dragCoefficient: 0.26, liftSlope: 1.5, liftMax: 0.24, spinDecaySeconds: 24 },
  clubs: [
    { id: 'driver', name: 'Driver', short: 'Dr', loftDegrees: 12.5, clubSpeed: 45.5, smashFactor: 1.47, spinRpm: 2700, putter: false },
    { id: 'wood3', name: '3 Wood', short: '3W', loftDegrees: 14, clubSpeed: 42, smashFactor: 1.43, spinRpm: 3400, putter: false },
    { id: 'hybrid5', name: '5 Hybrid', short: '5H', loftDegrees: 17, clubSpeed: 39.5, smashFactor: 1.42, spinRpm: 4300, putter: false },
    { id: 'iron5', name: '5 Iron', short: '5i', loftDegrees: 19, clubSpeed: 38, smashFactor: 1.38, spinRpm: 5200, putter: false },
    { id: 'iron7', name: '7 Iron', short: '7i', loftDegrees: 23, clubSpeed: 36, smashFactor: 1.33, spinRpm: 6600, putter: false },
    { id: 'iron9', name: '9 Iron', short: '9i', loftDegrees: 29, clubSpeed: 34, smashFactor: 1.28, spinRpm: 8000, putter: false },
    { id: 'pitching', name: 'Pitching Wedge', short: 'PW', loftDegrees: 33, clubSpeed: 32.5, smashFactor: 1.24, spinRpm: 8800, putter: false },
    { id: 'sand', name: 'Sand Wedge', short: 'SW', loftDegrees: 42, clubSpeed: 29, smashFactor: 1.16, spinRpm: 9800, putter: false },
    { id: 'putter', name: 'Putter', short: 'Pt', loftDegrees: 0, clubSpeed: 9.6, smashFactor: 1, spinRpm: 0, putter: true },
  ],
  contact: {
    tee: { restitution: 0.32, tangentialFriction: 0.32, rollingFriction: 0.16, spinRetention: 0.5, backspinCheck: 0.12 },
    fairway: { restitution: 0.32, tangentialFriction: 0.3, rollingFriction: 0.14, spinRetention: 0.5, backspinCheck: 0.14 },
    rough: { restitution: 0.18, tangentialFriction: 0.55, rollingFriction: 0.42, spinRetention: 0.3, backspinCheck: 0.05 },
    green: { restitution: 0.24, tangentialFriction: 0.24, rollingFriction: 0.075, spinRetention: 0.6, backspinCheck: 0.28 },
    bunker: { restitution: 0.05, tangentialFriction: 0.85, rollingFriction: 1.6, spinRetention: 0.1, backspinCheck: 0 },
    water: { restitution: 0, tangentialFriction: 1, rollingFriction: 4, spinRetention: 0, backspinCheck: 0 },
    path: { restitution: 0.55, tangentialFriction: 0.12, rollingFriction: 0.06, spinRetention: 0.7, backspinCheck: 0.02 },
  },
  lies: {
    tee: { powerRange: [1, 1], spinFactor: 1, puttingOnly: false },
    fairway: { powerRange: [1, 1], spinFactor: 1, puttingOnly: false },
    rough: { powerRange: [0.6, 0.8], spinFactor: 0.55, puttingOnly: false },
    bunker: { powerRange: [0.45, 0.45], spinFactor: 0, puttingOnly: false },
    green: { powerRange: [1, 1], spinFactor: 0, puttingOnly: true },
    path: { powerRange: [0.95, 0.95], spinFactor: 0.8, puttingOnly: false },
  },
  trees: { trunkRadius: 0.35, trunkHeight: 3.4, crownRadius: 3.3, crownCenterHeight: 5.6, crownDragPerSecond: 7, trunkRestitution: 0.35 },
  cup: { radius: 0.054, captureSpeed: 1.6, dunkSpeed: 3.2 },
  flight: { stepHz: 60, maxSeconds: 40, restSpeed: 0.06, staticSlopeFactor: 0.9, bounceMinNormalSpeed: 0.9, gradientEpsilon: 0.05, spinRangeFraction: 0.45, carryRange: [195, 235] },
  terrain: { basinDepth: 1.6, basinShoreWidth: 6, bunkerDepth: 0.45, bunkerLipWidth: 1.6, greenTiltRadius: 22 },
  wind: { speedRange: [0, 7.5], referenceHeight: 10, heightExponent: 0.22, groundFactor: 0.12 },
  meter: {
    powerRate: 0.62,
    powerCap: 1,
    pathSeconds: 0.62,
    contactSeconds: 0.44,
    overrun: 0.22,
    window: 0.16,
    perfectZone: 0.2,
    missCurve: 1.4,
    rhythmSeconds: 0.5,
    rhythmWindow: 0.22,
    rhythmPerfect: 0.25,
    rhythmOverrun: 0.35,
    maxRhythmLoss: 0.07,
    strikeSeconds: 0.24,
    maxPushRadians: 0.075,
    maxYawRadians: 0.04,
    maxSideSpinTilt: 0.3,
  },
  shots: {
    full: { speedScale: 1, loftScale: 1, loftAdd: 0, spinScale: 1, landing: { restitution: 1, friction: 1, check: 1, rolling: 1, reverse: 0 }, backswing: 1, finish: 1 },
    chip: { speedScale: 0.46, loftScale: 0.55, loftAdd: 0, spinScale: 0.35, landing: { restitution: 0.85, friction: 0.8, check: 0.2, rolling: 1.25, reverse: 0 }, backswing: 0.5, finish: 0.42 },
    flop: { speedScale: 0.66, loftScale: 1, loftAdd: 18, spinScale: 0.9, landing: { restitution: 0.5, friction: 1.7, check: 1.4, rolling: 1.7, reverse: 0 }, backswing: 0.85, finish: 0.85 },
    spinner: { speedScale: 0.62, loftScale: 0.72, loftAdd: 0, spinScale: 1.8, landing: { restitution: 0.85, friction: 1, check: 3.2, rolling: 1.4, reverse: 0.18 }, backswing: 0.58, finish: 0.5 },
  },
  shortGame: { autoChipRange: 40, minPower: 0.03, plannerIterations: 14, previewSeed: 0x5eed, puttPast: 0.35 },
  camera: {
    followDistance: 6.6,
    followHeight: 2.3,
    followLookAhead: 7,
    orbitSensitivity: 0.006,
    orbitPitchSensitivity: 0.004,
    pitchRange: [-0.25, 0.6],
    previewSeconds: 4.5,
    previewHeight: 55,
    previewBack: 70,
    trackingDistance: 16,
    trackingHeight: 6,
    trackingStiffness: 3.2,
    followStiffness: 6,
    greenHeight: 9,
    greenBack: 6,
    greenTiltLookAhead: 2,
    greenBackPerMetre: 0.25,
    greenHeightPerMetre: 0.2,
    greenLookPerMetre: 0.5,
    lookAtLift: 0,
    groundClearance: 1,
    previewClearance: 4,
    trackingClearance: 1.5,
    previewLead: 0.25,
    minHeadingDistance: 0.05,
  },
  match: { maxStrokesPerHole: 10, onlineHoleCount: 3, maxPlayers: 4, waterPenalty: 1, outOfBoundsPenalty: 1, pinTeeDistance: 140 },
  aim: { turnRate: 0.6, spinStep: 0.25, nudgeSeconds: 0.05, powerRate: 0.35, powerStep: 0.02 },
  timing: { restSeconds: 1.2, nextTurnSeconds: 1.4, holeOutSeconds: 2.6, celebrationSeconds: 4, scorecardSeconds: 6 },
  scoreNames: { ace: 'Hole in one', '-4': 'Condor', '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', '0': 'Par', '1': 'Bogey', '2': 'Double bogey', '3': 'Triple bogey' },
  metresPerYard: 0.9144,
  holes: (holesJson as unknown as { holes: HoleData[] }).holes,
}

export function clubById(id: ClubId): ClubSpec {
  const club = tuning.clubs.find((entry) => entry.id === id)
  if (!club) throw new Error(`Unknown club ${id}`)
  return club
}

export const SHOT_KINDS: readonly ShotKind[] = ['full', 'chip', 'flop', 'spinner']

export function clubLaunchSpeed(club: ClubSpec): number {
  return club.clubSpeed * club.smashFactor
}
