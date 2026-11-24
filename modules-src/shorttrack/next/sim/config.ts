export type TrackId = 'prison' | 'bullring' | 'dells' | 'dellswide' | 'dirt' | 'parkoval'

export type TrackDef = {
  name: string
  miles: string
  rec: string
  L: number
  R: number
  W: number
  APRON: number
  turnBank: number
  straightBank: number
  bankIn: number
  bankOut: number
  grooveHigh: number
  grooveLow: number
  steer: number
  smooth: number
  grip?: number
  apronGrip?: number
  gripUp: number
  minLap: number
  theme?: 'prison' | 'park'
  surface?: 'dirt'
  bareInfield?: boolean
}

export const TRACKS: Record<TrackId, TrackDef> = {
  prison: {
    name: 'Prison Speedway', miles: '0.29 mi', rec: 'prison',
    L: 131, R: 33, W: 16, APRON: 6,
    turnBank: 21, straightBank: 10, bankIn: 55, bankOut: 42,
    grooveHigh: 4.5, grooveLow: -4.7,
    steer: 0.97, smooth: 1.63,
    grip: 1.17, apronGrip: 0.92, gripUp: 1.15,
    minLap: 7500,
    theme: 'prison',
  },
  bullring: {
    name: 'Madison International Raceway', miles: '0.5 mi', rec: 'shorttrack',
    L: 150, R: 35, W: 16, APRON: 7,
    turnBank: 24, straightBank: 10, bankIn: 55, bankOut: 40,
    grooveHigh: 5.0, grooveLow: -5.2,
    steer: 0.9, smooth: 1.5,
    gripUp: 1.05,
    minLap: 12000,
  },
  dells: {
    name: 'Fox Speedway', miles: '0.3 mi', rec: 'dells',
    L: 122, R: 35, W: 16, APRON: 6,
    turnBank: 21, straightBank: 11, bankIn: 50, bankOut: 45,
    grooveHigh: 4.0, grooveLow: -4.3,
    steer: 0.85, smooth: 1.65,
    gripUp: 1.1,
    minLap: 8000,
  },
  dellswide: {
    name: 'Dells Raceway Park', miles: '0.27 mi', rec: 'dellswide',
    L: 122, R: 30, W: 16, APRON: 6,
    turnBank: 19, straightBank: 10, bankIn: 60, bankOut: 40,
    grooveHigh: 4.4, grooveLow: -4.7,
    steer: 1.15, smooth: 1.75,
    gripUp: 1.2,
    minLap: 7000,
    bareInfield: true,
  },
  dirt: {
    name: 'Beaver Dam Raceway', miles: '0.3 mi', rec: 'dirt',
    L: 109, R: 50, W: 15, APRON: 6,
    turnBank: 20, straightBank: 10, bankIn: 65, bankOut: 35,
    grooveHigh: 4.8, grooveLow: -5.2,
    steer: 1.6, smooth: 1.04,
    grip: 0.72, apronGrip: 0.6, gripUp: 1.4,
    minLap: 8000,
    surface: 'dirt',
  },
  parkoval: {
    name: 'Thrill Park Speedway', miles: '0.33 mi', rec: 'parkoval',
    L: 163, R: 33.5, W: 16, APRON: 6,
    turnBank: 12, straightBank: 4, bankIn: 55, bankOut: 42,
    grooveHigh: 4.5, grooveLow: -4.7,
    steer: 0.95, smooth: 1.6,
    gripUp: 1.1,
    minLap: 9000,
    theme: 'park',
  },
}

export function trackIdOf(value: string | null | undefined): TrackId {
  return value && Object.prototype.hasOwnProperty.call(TRACKS, value) ? (value as TrackId) : 'prison'
}

/** Tuning for one track, built exactly as the classic module built its CFG (same order of operations). */
export type Config = {
  L: number; R: number; W: number; APRON: number; turnBank: number; straightBank: number; bankIn: number; bankOut: number
  g: number; grip: number; apronGrip: number; aiGrip: number; offTrack: number; concreteTurn: number; concreteSpeed: number
  contactSlow: number; packBoost: number; power: number; maxAccel: number; drag: number; roll: number; engineBrake: number
  brake: number; reverseMax: number; scrub: number; slideScrub: number; wheelbase: number; steerLow: number; steerSpeed: number
  steerRampIn: number; steerRampOut: number; steerDamp: number; carScale: number; spinThreshold: number; spinRate: number
  wallRest: number; carRest: number; carBounce: number; damageScale: number
  /** Contact and damage on the next vehicle model (the classic model ignores them, so its golden traces hold): damage
   * taken is divided by `strength`; `damageLook` scales how big the dents look; `contactDrag` is the share of the classic
   * contact speed loss a car-to-car hit still costs; `contactGrip` scales how much grip a hit takes away for a moment
   * (the nose of the car that hits pushes, the tail of the car that is hit gets loose, a side hit slides both axles). */
  strength: number; damageLook: number; contactDrag: number; contactGrip: number
  paceSpeed: number; aiPaceSpeed: number; cautionSpeed: number; cautionTime: number; aiDecel: number; maxCars: number
  /** Dirt only (the next vehicle model): front and rear tire grip, how much throttle wheelspin costs the rears in side
   * grip, how far the rears fall away past their peak (magic-formula C) and the fronts' relaxation length (m). */
  dirtFrontGrip: number; dirtRearGrip: number; dirtWheelspin: number; dirtRearC: number; dirtFrontSigma: number
}

/** Config fields only the next vehicle model reads (contact and damage), left out of the classic comparisons. */
export const NEXT_CONTACT_KEYS = ['strength', 'damageLook', 'contactDrag', 'contactGrip'] as const

/** Stock dirt tire numbers for the next model. AI cars never run a looser rear or a grippier front than these (`dynamics.ts`), so a
 * looser Track Test setting changes how the drivers' cars slide without spinning the AI field. */
export const DIRT_STOCK = { dirtFrontGrip: 1.05, dirtRearGrip: 0.8, dirtWheelspin: 0.35, dirtRearC: 1.4, dirtFrontSigma: 1.2 }

export function makeConfig(track: TrackDef): Config {
  const c: Config = {
    L: 180, R: 62, W: 16, APRON: 7, turnBank: 24, straightBank: 6, bankIn: 60, bankOut: 40,
    g: 9.81, grip: 1.05, apronGrip: 0.82, aiGrip: 0, offTrack: 0.7, concreteTurn: 0.10, concreteSpeed: 0.8,
    contactSlow: 0.4, packBoost: 0.02, power: 360, maxAccel: 11, drag: 0.0009, roll: 0.3, engineBrake: 4.6,
    brake: 7, reverseMax: 6, scrub: 0.0065, slideScrub: 0.5,
    wheelbase: 2.8, steerLow: 0.47, steerSpeed: 0.07, steerRampIn: 8, steerRampOut: 6, steerDamp: 0,
    carScale: 1.15, spinThreshold: 1.6, spinRate: 0.8,
    wallRest: 0.22, carRest: 0.15, carBounce: 0.7, damageScale: 0.7,
    strength: 1.5, damageLook: 1.6, contactDrag: 0.4, contactGrip: 1,
    paceSpeed: 31.0, aiPaceSpeed: 30.50, cautionSpeed: 29, cautionTime: 25, aiDecel: 5.5, maxCars: 20,
    ...DIRT_STOCK,
  }
  for (const k of ['L', 'R', 'W', 'APRON', 'turnBank', 'straightBank', 'bankIn', 'bankOut'] as const) c[k] = track[k]
  const dirt = track.surface === 'dirt'
  if (track.grip) c.grip = track.grip
  if (track.apronGrip) c.apronGrip = track.apronGrip
  c.aiGrip = c.grip
  c.grip *= track.gripUp || 1
  c.apronGrip *= track.gripUp || 1
  if (dirt) {
    c.scrub *= 0.55
    c.slideScrub = 0.22
  }
  c.steerLow *= track.steer || 1
  c.steerRampIn /= track.smooth || 1
  c.steerRampOut /= track.smooth || 1
  c.steerDamp = 14 / (track.smooth || 1)
  return c
}

export type AiLevel = { sk: [number, number]; dc: number; pass: number; gb: number; pb: number; lc: number; ag: number; pace: number; vary: number }
export type Difficulty = 'easy' | 'medium' | 'hard'

export const AI_LEVELS: Record<Difficulty, AiLevel> = {
  easy: { sk: [1.17, 0.03], dc: 10.7, pass: 41, gb: 1.081, pb: 1.0375, lc: 1.52, ag: 0.5, pace: 1.0375, vary: 0.010 },
  medium: { sk: [1.2, 0.025], dc: 11.2, pass: 46, gb: 1.106, pb: 1.0625, lc: 1.28, ag: 0.81, pace: 1.01875, vary: 0.008 },
  hard: { sk: [1.23, 0.02], dc: 11.7, pass: 51, gb: 1.131, pb: 1.081, lc: 1.04, ag: 0.95, pace: 0.99375, vary: 0.006 },
}

export const STEP = 1 / 120

/** Truck body measurements the classic physics reads from the model (`TM.DIM`, `TRUCK_SCALE`). */
export const TRUCK_DIM = { FA: 1.62, RA: -1.55 }
export const TRUCK_SCALE = 0.9
