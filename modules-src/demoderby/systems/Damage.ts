/** Component damage, renderer-free: panels, wheels (bend, camber, toe, flats, wheels torn off), radiator, driveline, glass, lamps, bumpers and lids, fire; and what that damage does to grip, springs, steering and drive. */
import type { BodySpec, DamageSpec, HandlingSpec } from '../config'

export type Panel = 'frontLeft' | 'frontRight' | 'left' | 'right' | 'rearLeft' | 'rearRight' | 'roof'
export type BoltOn = 'frontBumper' | 'rearBumper'
export type Lid = 'hood' | 'trunk'

export const PANELS: readonly Panel[] = ['frontLeft', 'frontRight', 'left', 'right', 'rearLeft', 'rearRight', 'roof']

/** Wheel order matches the vehicle controller: front-left, front-right, rear-left, rear-right (+X is the right side, forward is -Z). */
export interface WheelDamage {
  integrity: number
  camber: number
  toe: number
  flat: boolean
  off: boolean
}

/** 0 attached, 1 loose (sagging or sprung open), 2 gone. */
export type PartState = 0 | 1 | 2

export interface CarDamage {
  panels: Record<Panel, number>
  wheels: WheelDamage[]
  radiator: number
  driveline: number
  /** 0–1 crack coverage of the glass. */
  glass: number
  /** Broken lamps: front-left, front-right, rear-left, rear-right. */
  lamps: boolean[]
  bolts: Record<BoltOn, PartState>
  lids: Record<Lid, PartState>
  fire: boolean
  /** Bumped every time something visible changes, so the model only rebuilds parts when needed. */
  version: number
}

export type DamageNews =
  | { kind: 'tire'; wheel: number }
  | { kind: 'wheel-off'; wheel: number }
  | { kind: 'bumper'; part: BoltOn; state: PartState }
  | { kind: 'lid'; part: Lid; state: PartState }
  | { kind: 'lamp'; lamp: number }
  | { kind: 'glass'; level: number }
  | { kind: 'radiator' }
  | { kind: 'fire' }

export interface Handling {
  grip: number[]
  spring: number[]
  /** Suspension rest offset per wheel (negative lowers that corner). */
  drop: number[]
  /** Rolling radius share per wheel (a flat rolls on the rim, a lost wheel on the hub). */
  radius: number[]
  drag: number
  steerScale: number
  /** Constant steering offset (rad) from bent front wheels. */
  pull: number
  drive: number
}

export function createDamage(): CarDamage {
  const panels = {} as Record<Panel, number>
  for (const panel of PANELS) panels[panel] = 100
  return {
    panels,
    wheels: [0, 1, 2, 3].map(() => ({ integrity: 100, camber: 0, toe: 0, flat: false, off: false })),
    radiator: 100,
    driveline: 100,
    glass: 0,
    lamps: [false, false, false, false],
    bolts: { frontBumper: 0, rearBumper: 0 },
    lids: { hood: 0, trunk: 0 },
    fire: false,
    version: 0,
  }
}

/** Which panel a point in the chassis frame lies on. */
export function panelAt(spec: BodySpec, x: number, y: number, z: number): Panel {
  if (y > spec.roof - spec.centreHeight - 0.12 && Math.abs(z) < spec.length * 0.3) return 'roof'
  const right = x > 0
  if (z < -spec.length * 0.3) return right ? 'frontRight' : 'frontLeft'
  if (z > spec.length * 0.3) return right ? 'rearRight' : 'rearLeft'
  return right ? 'right' : 'left'
}

export function wheelCentre(spec: BodySpec, wheel: number): [x: number, z: number] {
  return [(wheel % 2 === 0 ? -1 : 1) * (spec.track / 2), (wheel < 2 ? -1 : 1) * (spec.wheelbase / 2)]
}

function hash(a: number, b: number): number {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return value - Math.floor(value)
}

/**
 * Spreads one hit (already turned into body health lost) into the parts around the struck point, in the chassis frame.
 * `seed` makes the bend direction repeatable for the same hit. Returns what visibly changed.
 */
export function applyComponentHit(damage: CarDamage, spec: BodySpec, rules: DamageSpec, x: number, y: number, z: number, loss: number, seed: number): DamageNews[] {
  const news: DamageNews[] = []
  const c = rules.component
  const panel = panelAt(spec, x, y, z)
  damage.panels[panel] = Math.max(0, damage.panels[panel] - loss * c.panelShare)
  const front = panel === 'frontLeft' || panel === 'frontRight'
  const rear = panel === 'rearLeft' || panel === 'rearRight'

  for (let wheel = 0; wheel < 4; wheel++) {
    const state = damage.wheels[wheel]
    if (state.off) continue
    const [wx, wz] = wheelCentre(spec, wheel)
    const distance = Math.hypot(x - wx, z - wz)
    if (distance > c.wheelReach) continue
    const near = 1 - distance / c.wheelReach
    const before = state.integrity
    state.integrity = Math.max(0, state.integrity - loss * c.wheelShare * near)
    const bend = 1 - state.integrity / 100
    const lean = hash(seed, wheel) < 0.5 ? -1 : 1
    state.camber = lean * c.maxCamber * bend * bend
    state.toe = (hash(seed + 3, wheel) - 0.5) * 2 * c.maxToe * bend
    if (!state.flat && state.integrity < c.flatBelow && hash(seed + 7, wheel) < (c.flatBelow - state.integrity) / c.flatBelow + 0.25) {
      state.flat = true
      news.push({ kind: 'tire', wheel })
    }
    if (state.integrity <= 0 && before > 0) {
      state.off = true
      state.flat = true
      news.push({ kind: 'wheel-off', wheel })
    }
  }

  if (front) {
    const before = damage.radiator
    damage.radiator = Math.max(0, damage.radiator - loss * c.radiatorShare)
    if (before >= 50 && damage.radiator < 50) news.push({ kind: 'radiator' })
  }
  if (rear) damage.driveline = Math.max(0, damage.driveline - loss * c.drivelineShare)

  const frontWorst = Math.min(damage.panels.frontLeft, damage.panels.frontRight)
  const rearWorst = Math.min(damage.panels.rearLeft, damage.panels.rearRight)
  const frontAverage = (damage.panels.frontLeft + damage.panels.frontRight) / 2
  const rearAverage = (damage.panels.rearLeft + damage.panels.rearRight) / 2
  const bolt = (part: BoltOn, worst: number, average: number) => {
    const next: PartState = average < c.bumperOff || worst <= 0 ? 2 : worst < c.bumperLoose ? 1 : 0
    if (next > damage.bolts[part]) {
      damage.bolts[part] = next
      news.push({ kind: 'bumper', part, state: next })
    }
  }
  const lid = (part: Lid, average: number) => {
    const next: PartState = average < c.lidOpen ? 1 : 0
    if (next > damage.lids[part]) {
      damage.lids[part] = next
      news.push({ kind: 'lid', part, state: next })
    }
  }
  if (front) {
    bolt('frontBumper', frontWorst, frontAverage)
    lid('hood', frontAverage)
  }
  if (rear) {
    bolt('rearBumper', rearWorst, rearAverage)
    lid('trunk', rearAverage)
  }
  const lampPanels: Panel[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight']
  lampPanels.forEach((lampPanel, lamp) => {
    if (!damage.lamps[lamp] && damage.panels[lampPanel] < c.lightBreak) {
      damage.lamps[lamp] = true
      news.push({ kind: 'lamp', lamp })
    }
  })

  const greenhouse = panel === 'roof' ? 1.6 : panel === 'left' || panel === 'right' ? 1 : 0.45
  const glassBefore = damage.glass
  damage.glass = Math.min(1, damage.glass + loss * c.glassShare * greenhouse)
  if (Math.floor(damage.glass * 4) > Math.floor(glassBefore * 4)) news.push({ kind: 'glass', level: damage.glass })

  if (news.length || loss > 0) damage.version++
  return news
}

/** A roll onto the roof: crushes the roof panel and the glass. */
export function applyRoll(damage: CarDamage, rules: DamageSpec): DamageNews[] {
  damage.panels.roof = Math.max(0, damage.panels.roof - rules.component.rollLoss * 3)
  damage.glass = Math.min(1, damage.glass + 0.35)
  damage.version++
  return [{ kind: 'glass', level: damage.glass }]
}

/** Engine heat and fire for one step: a holed radiator cooks the engine under throttle, and a dying engine catches fire. Returns body health burned. */
export function stepComponents(damage: CarDamage, rules: DamageSpec, engine: { value: number }, throttle: number, dt: number, news: DamageNews[]): number {
  const c = rules.component
  if (damage.radiator < 50 && Math.abs(throttle) > 0.1) {
    engine.value = Math.max(0, engine.value - c.overheatRate * (1 - damage.radiator / 50) * Math.abs(throttle) * dt)
  }
  if (!damage.fire && engine.value < c.fireBelow) {
    damage.fire = true
    damage.version++
    news.push({ kind: 'fire' })
  }
  return damage.fire ? c.fireBurn * dt : 0
}

/** Grip, springs, ride height, drag, steering and drive from the current damage. */
export function handlingOf(damage: CarDamage, rules: HandlingSpec, out?: Handling): Handling {
  const handling = out ?? { grip: [1, 1, 1, 1], spring: [1, 1, 1, 1], drop: [0, 0, 0, 0], radius: [1, 1, 1, 1], drag: 0, steerScale: 1, pull: 0, drive: 1 }
  let drag = 0
  for (let wheel = 0; wheel < 4; wheel++) {
    const state = damage.wheels[wheel]
    const health = state.integrity / 100
    let grip = rules.bentGrip + (1 - rules.bentGrip) * health
    let drop = -0.04 * (1 - health)
    let radius = 1
    if (state.flat) {
      grip = Math.min(grip, rules.flatGrip)
      radius = 1 - rules.flatDrop / 0.37
      drag += rules.flatDrag
    }
    if (state.off) {
      grip = rules.offGrip
      radius = 0.3
      drop = -rules.offDrop * 0.5
      drag += rules.offDrag
    }
    handling.radius[wheel] = radius
    handling.grip[wheel] = grip
    handling.spring[wheel] = rules.bentSpring + (1 - rules.bentSpring) * health
    handling.drop[wheel] = drop
  }
  const left = damage.wheels[0]
  const right = damage.wheels[1]
  const frontBend = 1 - (left.integrity + right.integrity) / 200
  handling.steerScale = 1 - rules.steerLoss * frontBend
  handling.pull = (left.toe + right.toe) * rules.pullPerToe * 0.5 + (left.off ? 0.12 : 0) - (right.off ? 0.12 : 0)
  const rearOff = (damage.wheels[2].off ? 1 : 0) + (damage.wheels[3].off ? 1 : 0)
  handling.drive = (rules.driveFloor + (1 - rules.driveFloor) * damage.driveline / 100) * (1 - rearOff * 0.3)
  handling.drag = drag
  return handling
}
