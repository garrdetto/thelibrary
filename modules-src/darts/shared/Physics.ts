/** Dart flight: a throw intent becomes a launch velocity, and a fixed-step integrator with gravity and quadratic air drag finds where it meets the board plane. A player's throw is judged by where the power meter stopped: the exact middle of the green lands on the aim point, anywhere in the green lands within seven holes of it, and the further out (yellow, then red) the further it can miss (`meterReach`). The computer keeps its own Gaussian release error by skill. Board space: metres, origin at the bull, x right, y up, z towards the thrower. */
import { BULL_HEIGHT, HOLE_PITCH_MM, OCHE_DISTANCE, RADII, scoreAt } from './Board'
import type { BoardKind, DartThrow, FlightParams, ThrowIntent, Vec3 } from './interfaces'
import { gaussian, type Rng } from './Rng'

export const GRAVITY = 9.81
/** Quadratic drag per metre: ½ρC_dA/m for a 22 g steel-tip dart with standard flights. */
export const DRAG = 0.006
export const IDEAL_SPEED = 6.4
export const MIN_SPEED = 2.5
export const MAX_SPEED = 11
export const STEP = 1 / 2000
export const MAX_FLIGHT_SECONDS = 2
/** Release point of a right-handed thrower standing on the oche with the arm extended. */
export const RELEASE: Vec3 = [0.11, 1.6 - BULL_HEIGHT, OCHE_DISTANCE - 0.5]
export const FLOOR_Y = -BULL_HEIGHT
export const MAX_YAW = 0.12
export const MAX_AIM = 0.4

/** Release spread (standard deviation of the launch direction, radians) for each skill. One milliradian is about 1.8 mm on the board. */
export const SPREAD = {
  easy: 0.0025,
  normal: 0.0045,
  hard: 0.0075,
  pub: 0.016,
  league: 0.0095,
  county: 0.0062,
  pro: 0.0041,
} as const

export type SpreadLevel = keyof typeof SPREAD

/** The player's steadiness settings; the other levels are the computer's. */
export const PLAYER_LEVELS = ['easy', 'normal', 'hard'] as const
export type PlayerLevel = (typeof PLAYER_LEVELS)[number]

/** Distance between neighbouring tip holes on the soft-tip board, in metres: the unit the meter's misses are measured in. */
export const HOLE = HOLE_PITCH_MM / 1000

/**
 * The power meter, as fractions of IDEAL_SPEED off the ideal: `perfect` is the half-width of the solid green (a third of the earlier ±1.7 %), `fade` where
 * the green has faded fully to yellow, and `band` the half-width of the yellow; past it the meter runs on into red. A release `d` green half-widths from the middle misses the aim point by at
 * most `reach(d)`: nothing up to `exact` (the Perfect window between the meter's two white lines, ±0.24 % (15 % wider than the earlier ±0.21 %), well inside the solid green), then measured from the lines as if they sat at `reachLine` (±0.67 %): `greenHoles` holes
 * at `reachLine`'s edge of the green, on through the yellow (the reach eases in from nothing over `lineRamp` green half-widths past the lines) to `yellowHoles` at the edge of the band (easing in slowly, so a release well past the green still lands close), and staying there in
 * the red, where the extra speed also drops (soft) or lifts (hard) the dart. Outside the lines every dart misses by at least `meterFloor`: nothing at the
 * lines, growing to `greenEdgeHoles` holes at the edge of the green (`floorSpread` to all of it), then holding. On top of that, `nearMissChance` of
 * the darts outside the lines miss by a few holes (`nearMissHoles`, low to high), so a dart that just misses the white lines often leaves the bull.
 * Past the green a dart can also miss further, with `meterMissChance` (from `lineMissChance` at the green edge up to `bandMissChance` at the band
 * edge), by `missFloor` to all of the reach, in any direction. Every miss distance here is 40 % bigger than it first was. The cross meter (`ThrowIntent.cross`, a test option) has no chance in it: the
 * vertical reading misses high or low and the horizontal one left or right, each by `crossDistance`, with `sideRedHoles` more per 5 % into the red sideways.
 * `levelScale` tightens (Easy) or widens (Hard) the reach.
 */
export const METER = {
  perfect: 0.017 / 3,
  fade: 0.03,
  band: 0.085,
  exact: (0.00625 * 1.15) / 0.017,
  reachLine: 0.02 / 0.017,
  lineRamp: 0.4,
  greenHoles: 9.8,
  yellowHoles: 16.8,
  lineMissChance: 0.57,
  bandMissChance: 1,
  missFloor: 0.4,
  greenEdgeHoles: 2.8,
  floorSpread: 0.8,
  nearMissChance: 0.47,
  nearMissHoles: [5.6, 8.4] as readonly [number, number],
  sideRange: 0.15,
  sideRedHoles: 11.2,
  levelScale: { easy: 0.75, normal: 1, hard: 1.25 } as Record<PlayerLevel, number>,
} as const

export function isPlayerLevel(level: SpreadLevel): level is PlayerLevel {
  return (PLAYER_LEVELS as readonly string[]).includes(level)
}

/** How far a release at `speed` is from the middle of the green, in green half-widths (0 dead centre, 1 the edge of the green). */
export function meterDistance(speed: number): number {
  const d = Math.abs(speed / IDEAL_SPEED - 1) / METER.perfect
  // A release drawn exactly on a zone edge counts as the inner zone (floating point can put it a hair outside).
  return Math.max(0, d - 1e-9)
}

/** Which part of the meter a release at `speed` falls in: the dead-centre `perfect` window, the rest of the `green`, the `yellow`, or the red (`low` or `high`). */
export function meterZone(speed: number): 'perfect' | 'green' | 'yellow' | 'low' | 'high' {
  const d = meterDistance(speed)
  if (d <= METER.exact) return 'perfect'
  if (d <= 1) return 'green'
  if (d <= METER.band / METER.perfect) return 'yellow'
  return speed < IDEAL_SPEED ? 'low' : 'high'
}

/** The furthest (metres) a player's dart can land from the aim point for a release at `speed`. */
export function meterReach(speed: number, level: PlayerLevel): number {
  const d = meterDistance(speed)
  if (d <= METER.exact) return 0
  const scale = METER.levelScale[level]
  const green = METER.greenHoles * HOLE
  const past = d - METER.exact + METER.reachLine
  const edge = METER.band / METER.perfect
  const into = Math.min(1, Math.max(0, past - 1) / (edge - 1))
  const t = into * into * (3 - 2 * into) * into
  const yellow = METER.yellowHoles * HOLE
  const reach = (green + (yellow - green) * t) * scale
  return reach * Math.min(1, (d - METER.exact) / METER.lineRamp)
}

export interface Impact {
  /** Where the dart ended up in board space. */
  point: Vec3
  seconds: number
  /** True if it met the board plane (inside or outside the scoring area), false if it fell to the floor first. */
  reachedBoard: boolean
  /** Velocity at the moment of impact, for the angle the dart sticks at. */
  velocity: Vec3
  dart: DartThrow
}

export interface FlightSample {
  t: number
  p: Vec3
  v: Vec3
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0))
}

export function cleanIntent(intent: ThrowIntent): ThrowIntent {
  return {
    aimX: clamp(intent.aimX, -MAX_AIM, MAX_AIM),
    aimY: clamp(intent.aimY, -MAX_AIM, MAX_AIM),
    speed: clamp(intent.speed, MIN_SPEED, MAX_SPEED),
    yaw: clamp(intent.yaw, -MAX_YAW, MAX_YAW),
    wobble: clamp(intent.wobble, 0, 1),
    ...(typeof intent.cross === 'number' && Number.isFinite(intent.cross) ? { cross: clamp(intent.cross, -METER.sideRange, METER.sideRange) } : {}),
  }
}

/** One integration step (semi-implicit Euler): acceleration = gravity − k|v|v. */
function step(p: number[], v: number[], dt: number): void {
  const speed = Math.hypot(v[0], v[1], v[2])
  const drag = DRAG * speed
  v[0] += -drag * v[0] * dt
  v[1] += (-GRAVITY - drag * v[1]) * dt
  v[2] += -drag * v[2] * dt
  p[0] += v[0] * dt
  p[1] += v[1] * dt
  p[2] += v[2] * dt
}

/** Flies a dart until it crosses the board plane (z = 0) or the floor, interpolating the exact crossing inside the last step. */
export function simulate(flight: FlightParams, samples?: FlightSample[], sampleEvery = 1 / 240, board: BoardKind = 'steel'): Impact {
  const p = [...flight.origin]
  const v = [...flight.velocity]
  let t = 0
  let nextSample = 0
  while (t < MAX_FLIGHT_SECONDS) {
    if (samples && t >= nextSample) {
      samples.push({ t, p: [p[0], p[1], p[2]], v: [v[0], v[1], v[2]] })
      nextSample += sampleEvery
    }
    const prevP = [p[0], p[1], p[2]]
    const prevV = [v[0], v[1], v[2]]
    step(p, v, STEP)
    t += STEP
    if (p[2] <= 0) {
      const f = prevP[2] / (prevP[2] - p[2])
      const point: Vec3 = [prevP[0] + (p[0] - prevP[0]) * f, prevP[1] + (p[1] - prevP[1]) * f, 0]
      const velocity: Vec3 = [prevV[0] + (v[0] - prevV[0]) * f, prevV[1] + (v[1] - prevV[1]) * f, prevV[2] + (v[2] - prevV[2]) * f]
      const seconds = t - STEP + STEP * f
      if (point[1] < FLOOR_Y) break
      samples?.push({ t: seconds, p: point, v: velocity })
      return { point, seconds, reachedBoard: true, velocity, dart: scoreAt(point[0], point[1], 0, board) }
    }
    if (p[1] <= FLOOR_Y) {
      const f = (prevP[1] - FLOOR_Y) / (prevP[1] - p[1])
      const point: Vec3 = [prevP[0] + (p[0] - prevP[0]) * f, FLOOR_Y, prevP[2] + (p[2] - prevP[2]) * f]
      const seconds = t - STEP + STEP * f
      samples?.push({ t: seconds, p: point, v: [v[0], v[1], v[2]] })
      return { point, seconds, reachedBoard: false, velocity: [v[0], v[1], v[2]], dart: missAt(point) }
    }
  }
  const point: Vec3 = [p[0], Math.max(p[1], FLOOR_Y), Math.max(p[2], 0)]
  return { point, seconds: t, reachedBoard: false, velocity: [v[0], v[1], v[2]], dart: missAt(point) }
}

function missAt(point: Vec3): DartThrow {
  return { coordinates: point, sector: 0, multiplier: 0, ring: 'miss', scoreValue: 0, angle: 0, radius: Math.round(Math.hypot(point[0], point[1]) * 1000) }
}

/** Direction from the release point that brings a dart thrown at IDEAL_SPEED onto the aim point, found by re-aiming at the miss until it vanishes (drag and gravity included). */
export function aimDirection(aimX: number, aimY: number, origin: Vec3 = RELEASE): Vec3 {
  let tx = aimX
  let ty = aimY
  let dir: Vec3 = [0, 0, -1]
  for (let i = 0; i < 8; i++) {
    dir = launchDirection(origin, tx, ty, IDEAL_SPEED)
    const hit = simulate({ origin, velocity: [dir[0] * IDEAL_SPEED, dir[1] * IDEAL_SPEED, dir[2] * IDEAL_SPEED] })
    const ex = hit.point[0] - aimX
    const ey = hit.point[1] - aimY
    if (Math.abs(ex) < 1e-5 && Math.abs(ey) < 1e-5) break
    tx -= ex
    ty -= ey
  }
  return dir
}

/** Closed-form drag-free launch direction (the lower of the two ballistic arcs) towards a point on the board plane, as the starting guess. */
function launchDirection(origin: Vec3, tx: number, ty: number, speed: number): Vec3 {
  const dx = tx - origin[0]
  const dz = -origin[2]
  const horizontal = Math.hypot(dx, dz)
  const dy = ty - origin[1]
  const v2 = speed * speed
  const disc = v2 * v2 - GRAVITY * (GRAVITY * horizontal * horizontal + 2 * dy * v2)
  const pitch = disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (GRAVITY * horizontal)) : Math.PI / 4
  const heading = Math.atan2(dx, -dz)
  const cosPitch = Math.cos(pitch)
  return [Math.sin(heading) * cosPitch, Math.sin(pitch), -Math.cos(heading) * cosPitch]
}

/** Rotates a direction by small yaw (about y) and pitch (about the sideways axis) angles. */
function turn(dir: Vec3, yaw: number, pitch: number): Vec3 {
  const horizontal = Math.hypot(dir[0], dir[2])
  const heading = Math.atan2(dir[0], -dir[2]) + yaw
  const elevation = Math.atan2(dir[1], horizontal) + pitch
  const c = Math.cos(elevation)
  return [Math.sin(heading) * c, Math.sin(elevation), -Math.cos(heading) * c]
}

/**
 * Turns an intent into the launch that actually happens. A player's throw (`PLAYER_LEVELS`) is aimed at the aim point moved by a random offset
 * whose size comes from the power meter (`meterReach`), so the middle of the green is exact; inside the green and yellow the speed only decides
 * that scatter, and past the yellow the excess speed drops or lifts the dart. The computer's throw points so a dart at IDEAL_SPEED lands on the aim
 * point (softer drops low, harder flies high), then its release error (Gaussian, standard deviation SPREAD[level] scaled up by an unsteady release)
 * moves the direction and the speed. An optional sideways yaw turns either.
 */
export function launch(intent: ThrowIntent, level: SpreadLevel, rng: Rng, origin: Vec3 = RELEASE): FlightParams {
  const clean = cleanIntent(intent)
  if (isPlayerLevel(level)) return playerLaunch(clean, level, rng, origin)
  const sigma = SPREAD[level] * (1 + clean.wobble * 1.6)
  const ideal = aimDirection(clean.aimX, clean.aimY, origin)
  const yawError = gaussian(rng) * sigma
  const pitchError = gaussian(rng) * sigma
  const speedError = 1 + gaussian(rng) * sigma * 0.6
  const dir = turn(ideal, clean.yaw + yawError, pitchError)
  const speed = clamp(clean.speed * speedError, MIN_SPEED, MAX_SPEED)
  return { origin, velocity: [dir[0] * speed, dir[1] * speed, dir[2] * speed] }
}

/**
 * How likely a release at `speed` is to miss the aim point at all: 0 between the white lines, `lineMissChance` just past them, climbing to
 * `bandMissChance` at the edge of the yellow and staying there in the red. A release outside the lines can still land dead on; it just gets less likely.
 */
export function meterMissChance(speed: number): number {
  const d = meterDistance(speed)
  if (d <= 1) return 0
  const edge = METER.band / METER.perfect
  const into = Math.min(1, (d - 1) / (edge - 1))
  return METER.lineMissChance + (METER.bandMissChance - METER.lineMissChance) * Math.sqrt(into)
}

/**
 * Where a player's dart is pointed, as an offset (metres) from the aim point. Outside the white lines the dart either lands on the aim (with the
 * chance left over from `meterMissChance`) or misses by `missFloor` to all of `meterReach` in a random direction, so it is never thrown far off.
 */
export function meterMiss(speed: number, level: PlayerLevel, rng: Rng): { x: number; y: number } {
  const d = meterDistance(speed)
  const angle = rng() * 2 * Math.PI
  const roll = rng()
  const spread = rng()
  if (d <= METER.exact) return { x: 0, y: 0 }
  let distance = meterFloor(d, level) * (METER.floorSpread + (1 - METER.floorSpread) * spread)
  if (roll < METER.nearMissChance) {
    const [low, high] = METER.nearMissHoles
    distance = Math.max(distance, (low + (high - low) * spread) * HOLE * METER.levelScale[level])
    if (d <= 1) distance = Math.min(distance, METER.greenHoles * HOLE)
  }
  if (roll < meterMissChance(speed)) distance = Math.max(distance, meterReach(speed, level) * (METER.missFloor + (1 - METER.missFloor) * spread))
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance }
}

/** The least (metres) a release `d` green half-widths from the middle misses by: nothing inside the white lines, growing in a straight line to `greenEdgeHoles` holes at the edge of the green, and holding there past it. */
export function meterFloor(d: number, level: PlayerLevel): number {
  if (d <= METER.exact) return 0
  return METER.greenEdgeHoles * HOLE * METER.levelScale[level] * Math.min(1, (d - METER.exact) / (1 - METER.exact))
}

/**
 * Cross meter (test option): how far (metres) a reading `off` (a fraction of the ideal speed off the middle, either meter) misses along its own
 * axis. Nothing between the white lines, `meterFloor` through the green, then easing up across the yellow to the typical yellow-edge miss; `side`
 * readings past the band add `sideRedHoles` per 5 % (vertical ones get the drop or lift of the speed instead).
 */
export function crossDistance(off: number, level: PlayerLevel, side: boolean): number {
  const d = Math.max(0, Math.abs(off) / METER.perfect - 1e-9)
  if (d <= 1) return meterFloor(d, level)
  const scale = METER.levelScale[level]
  const edge = METER.band / METER.perfect
  const into = Math.min(1, (d - 1) / (edge - 1))
  const t = into * into * (3 - 2 * into)
  const floor = METER.greenEdgeHoles * HOLE * scale
  const yellow = METER.yellowHoles * HOLE * scale * ((1 + METER.missFloor) / 2)
  const red = side ? (Math.max(0, Math.abs(off) - METER.band) / 0.05) * METER.sideRedHoles * HOLE * scale : 0
  return floor + (yellow - floor) * t + red
}

/** The cross meter's aim offset (metres): high or low from the vertical reading, left or right from the horizontal one. */
export function crossMiss(speed: number, side: number, level: PlayerLevel): { x: number; y: number } {
  const off = speed / IDEAL_SPEED - 1
  return { x: Math.sign(side) * crossDistance(side, level, true), y: Math.sign(off) * crossDistance(off, level, false) }
}

function playerLaunch(clean: ThrowIntent, level: PlayerLevel, rng: Rng, origin: Vec3): FlightParams {
  const miss = clean.cross === undefined ? meterMiss(clean.speed, level, rng) : crossMiss(clean.speed, clean.cross, level)
  const offsetX = miss.x
  const offsetY = miss.y
  const ideal = aimDirection(clean.aimX + offsetX, clean.aimY + offsetY, origin)
  const off = clean.speed / IDEAL_SPEED - 1
  const beyond = Math.sign(off) * Math.max(0, Math.abs(off) - METER.band)
  const speed = clamp(IDEAL_SPEED * (1 + beyond), MIN_SPEED, MAX_SPEED)
  const dir = turn(ideal, clean.yaw, 0)
  return { origin, velocity: [dir[0] * speed, dir[1] * speed, dir[2] * speed] }
}

/** Launch plus flight in one call: what a released dart scores. */
export function throwDart(intent: ThrowIntent, level: SpreadLevel, rng: Rng, board: BoardKind = 'steel'): { flight: FlightParams; impact: Impact } {
  const flight = launch(intent, level, rng)
  return { flight, impact: simulate(flight, undefined, undefined, board) }
}

/** True if a board-space point is on the face of the board (scoring area or number ring), where a dart can stick. */
export function onBoardFace(x: number, y: number): boolean {
  return Math.hypot(x, y) * 1000 <= RADII.board
}
