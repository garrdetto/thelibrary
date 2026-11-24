/**
 * Coaching tips on the HUD: one short line chosen from what the aircraft is doing (parked, lined up, rolling, rotating, climbing,
 * cruising, descending, on approach, flaring, rolling out) and from what is going wrong (stall, steep bank, too fast, flaps over
 * their speed, below or above the glidepath). Key names come from the pilot's own bindings. A tip stays up at least a few seconds
 * unless a warning takes over; T turns tips off and on (remembered in this browser). It only reads the flight.
 */
import type { Bindings, KeyAction } from '../input/Bindings'
import { nearestAirport, pavementAt } from '../shared/Airports'
import type { ApproachState } from '../shared/Approach'
import { FOOT, FPM, KNOT } from '../sim/Atmosphere'
import type { ControlInput } from '../sim/Controls'
import type { FlightModel } from '../sim/FlightModel'

const STORAGE_KEY = 'takeflight.tips.v1'
const REFRESH = 0.25
const HOLD = 3.5

type TipId =
  | 'stall' | 'bank' | 'overspeed' | 'flapSpeed' | 'parked' | 'taxi' | 'lineUp' | 'roll' | 'rotate' | 'rollout'
  | 'flare' | 'gearDown' | 'climbingApproach' | 'fastApproach' | 'slowApproach' | 'low' | 'high' | 'lineUpFinal' | 'landingFlaps' | 'onApproach'
  | 'gearUp' | 'climbSpeed' | 'flapsUp' | 'climb' | 'cruisePower' | 'descend' | 'cruise' | 'trim'

/** Warnings replace any tip at once; everything else waits for the current tip's hold time. */
const URGENT = new Set<TipId>(['stall', 'bank', 'overspeed', 'flapSpeed', 'flare', 'gearDown', 'rotate'])

const CODE_NAMES: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', PageUp: 'PgUp', PageDown: 'PgDn',
  BracketLeft: '[', BracketRight: ']', Equal: '+', Minus: '−', Period: '.', Slash: '/', Backquote: '`', Escape: 'Esc',
  ShiftLeft: 'Shift', NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadEnter: 'Num Enter', Numpad0: 'Num 0',
}

function codeName(code: string): string {
  if (CODE_NAMES[code]) return CODE_NAMES[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

export interface TipContext {
  aircraft: FlightModel
  input: Readonly<ControlInput>
  approach: ApproachState | null
  parkingBrake: boolean
}

export class FlightTips {
  readonly root: HTMLDivElement
  private readonly text: HTMLSpanElement
  private enabled: boolean
  private current: TipId | null = null
  private shownFor = 0
  private since = REFRESH
  private cruiseTime = 0
  private texts = new Map<TipId, string>()
  private keyed = ''
  private nearestName = ''
  private nearestDistance = Infinity

  constructor(parent: HTMLElement, private readonly bindings: () => Bindings) {
    this.root = document.createElement('div')
    this.root.className = 'tf-tip'
    this.root.setAttribute('role', 'status')
    this.root.hidden = true
    const label = document.createElement('b')
    label.textContent = 'Tip'
    this.text = document.createElement('span')
    this.root.append(label, this.text)
    parent.appendChild(this.root)
    this.enabled = true
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off'
    } catch {
      this.enabled = true
    }
  }

  get on(): boolean {
    return this.enabled
  }

  /** Turns tips on or off and remembers the choice; returns the new state. */
  toggle(): boolean {
    this.enabled = !this.enabled
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off')
    } catch {
      /* storage unavailable: the choice lasts this visit */
    }
    if (!this.enabled) this.hide()
    return this.enabled
  }

  /** Clears the tip, e.g. when a new flight starts. */
  reset(): void {
    this.hide()
    this.cruiseTime = 0
    this.since = REFRESH
  }

  private hide(): void {
    this.current = null
    this.shownFor = 0
    this.root.hidden = true
  }

  private key(action: KeyAction, fallback: string): string {
    const codes = this.bindings().keys[action]
    if (!codes || codes.length === 0) return fallback
    return codeName(codes[0])
  }

  /** Builds every tip's wording once per aircraft and binding set. */
  private wording(a: FlightModel): Map<TipId, string> {
    const b = this.bindings()
    const signature = `${a.spec.id}|${JSON.stringify(b.keys)}`
    if (signature === this.keyed) return this.texts
    this.keyed = signature
    const v = a.spec.vSpeeds
    const up = this.key('pitchUp', 'S')
    const down = this.key('pitchDown', 'W')
    const left = this.key('rollLeft', 'A')
    const right = this.key('rollRight', 'D')
    const rudder = `${this.key('yawLeft', 'Q')} / ${this.key('yawRight', 'E')}`
    const more = this.key('throttleUp', 'PgUp')
    const less = this.key('throttleDown', 'PgDn')
    const full = this.key('throttleFull', 'F4')
    const idle = this.key('throttleIdle', 'F1')
    const flapsDown = this.key('flapsDown', 'F')
    const flapsUp = this.key('flapsUp', 'R')
    const gear = this.key('gear', 'G')
    const brakes = this.key('brakes', 'Space')
    const park = this.key('parkingBrake', 'P')
    const trim = `${this.key('trimUp', ']')} / ${this.key('trimDown', '[')}`
    const map = this.key('map', 'M')
    const t = new Map<TipId, string>()
    t.set('stall', `Stall: lower the nose (${down}) and add full power (${full}). Pull back again only once the speed builds.`)
    t.set('bank', `Steep bank: roll the wings level with ${left} / ${right} before pulling back.`)
    t.set('overspeed', `Too fast: pull the throttle back (${less}) and raise the nose gently (${up}).`)
    t.set('flapSpeed', `Too fast for flaps: slow below ${v.vfe} kt or raise them (${flapsUp}).`)
    t.set('parked', `Parking brake is on: release it with ${park}, then add a little throttle (${more}) to roll.`)
    t.set('taxi', `Taxi slowly with a little throttle (${more} / ${less}), steer with ${rudder} and brake with ${brakes}. The map (${map}) shows the runway.`)
    t.set('lineUp', `On the runway: add full throttle (${full}) and keep the nose on the centreline with ${rudder}.`)
    t.set('roll', `Keep it straight with ${rudder}. Rotate at ${v.vr} kt.`)
    t.set('rotate', `${v.vr} kt: ease back on the stick (${up}) to lift the nose and fly off.`)
    t.set('rollout', `Down: throttle to idle (${idle}), hold ${brakes} to brake and keep straight with ${rudder}.`)
    t.set('flare', `Flare: throttle to idle (${idle}) and raise the nose gently (${up}) to touch down slowly on the main wheels.`)
    t.set('gearDown', `Gear is up: lower it now with ${gear}.`)
    t.set('climbingApproach', `Climbing on the approach: pull the throttle back (${less}) until you descend at about 500 fpm.`)
    t.set('fastApproach', `Too fast on approach: less throttle (${less}). Aim for ${v.vapp} kt.`)
    t.set('slowApproach', `Getting slow: add a little power (${more}) to hold ${v.vapp} kt.`)
    t.set('low', `Below the glidepath: add a little power (${more}) and hold your height until the guide centres.`)
    t.set('high', `Above the glidepath: less throttle (${less}) and lower the nose a little (${down}).`)
    t.set('lineUpFinal', `Off the centreline: bank gently toward the runway with ${left} / ${right}, then roll level.`)
    t.set('landingFlaps', `Add landing flaps one notch at a time (${flapsDown}) below ${v.vfe} kt.`)
    t.set('onApproach', `On approach: less throttle and hold ${v.vapp} kt. The throttle sets the descent, the nose sets the speed.`)
    t.set('gearUp', `Climbing away: raise the gear (${gear}).`)
    t.set('climbSpeed', `Getting slow in the climb: lower the nose a touch (${down}) to hold ${v.vy} kt.`)
    t.set('flapsUp', `Above 400 ft and climbing: raise the flaps (${flapsUp}).`)
    t.set('climb', `Climb at about ${v.vy} kt with full power. Use trim (${trim}) to take the pressure off the stick.`)
    t.set('cruisePower', `Level off: ease the throttle back (${less}) to about 75 % for cruise.`)
    t.set('descend', '')
    t.set('cruise', `Open the map (${map}) to pick an airport. Line up with its runway 6–8 km out and start down early.`)
    t.set('trim', `Holding pressure on the stick? Trim (${trim}) until the aircraft flies level on its own.`)
    this.texts = t
    return t
  }

  private choose(c: TipContext, dt: number): TipId | null {
    const a = c.aircraft
    if (a.crashed) return null
    const v = a.spec.vSpeeds
    const kt = a.ias / KNOT
    const aglFt = Math.max(0, (a.agl - 1.25) / FOOT)
    const fpm = a.verticalSpeed / FPM
    const onGround = a.wheelLoad > 0
    const input = c.input
    const detents = a.spec.controls.flapDetents.length
    const retractable = a.spec.controls.retractable
    if (!onGround) {
      if (a.stall > 0.6) return 'stall'
      if (Math.abs(a.bank) > 50) return 'bank'
      if (kt > v.vne - 8) return 'overspeed'
      if (a.flap > 0.05 && kt > v.vfe + 3) return 'flapSpeed'
    }
    const gs = a.groundSpeed / KNOT
    const near = nearestAirport(a.px, a.pz)
    this.nearestName = near.name
    this.nearestDistance = Math.sqrt((near.x - a.px) * (near.x - a.px) + (near.z - a.pz) * (near.z - a.pz))
    if (onGround) {
      const onRunway = pavementAt(a.px, a.pz) === 'runway'
      this.cruiseTime = 0
      if (a.touchdowns > 0 && gs > 8 && input.throttle < 0.35) return 'rollout'
      if (c.parkingBrake) return 'parked'
      if (onRunway && gs < v.vr * 0.4 && input.throttle < 0.85) return 'lineUp'
      if (!onRunway && gs < 30) return 'taxi'
      if (input.throttle >= 0.5 && kt >= v.vr - 2) return 'rotate'
      if (input.throttle >= 0.5) return 'roll'
      return null
    }
    const approach = c.approach
    if (approach && approach.distance < 9000 && aglFt < 2500) {
      this.cruiseTime = 0
      if (aglFt < 30 && approach.distance < 1500) return 'flare'
      if (retractable && a.gear < 0.5 && approach.distance < 6000) return 'gearDown'
      if (aglFt < 120) return null
      if (fpm > 250) return 'climbingApproach'
      if (kt > v.vapp + 15) return 'fastApproach'
      if (kt < v.vref - 4) return 'slowApproach'
      if (approach.glideslope < -1.2) return 'low'
      if (approach.glideslope > 1.2) return 'high'
      if (Math.abs(approach.localizer) > 1.2) return 'lineUpFinal'
      if (input.flaps < detents - 1 && approach.distance < 4500 && kt <= v.vfe) return 'landingFlaps'
      return 'onApproach'
    }
    if (aglFt < 1500 && fpm > 150) {
      if (retractable && a.gear > 0.5 && aglFt > 60) return 'gearUp'
      if (kt < v.vy - 6 && aglFt > 80) return 'climbSpeed'
      if (input.flaps > 0 && aglFt > 400) return 'flapsUp'
      return 'climb'
    }
    if (aglFt > 1500 && Math.abs(fpm) < 300) {
      this.cruiseTime += dt
      if (input.throttle > 0.92 && kt > v.cruise * 0.85) return 'cruisePower'
      if (this.nearestDistance < 16000 && this.nearestDistance > 6000 && aglFt > 1800) return 'descend'
      if (this.cruiseTime > 40 && this.cruiseTime < 52) return 'trim'
      return 'cruise'
    }
    return null
  }

  update(context: TipContext, dt: number): void {
    if (!this.enabled) return
    this.shownFor += dt
    this.since += dt
    if (this.since < REFRESH) return
    const step = this.since
    this.since = 0
    const next = this.choose(context, step)
    if (next === this.current) {
      if (next === 'descend') this.setText(next, context)
      return
    }
    if (this.current !== null && next !== null && this.shownFor < HOLD && !URGENT.has(next)) return
    if (next === null && this.current !== null && this.shownFor < HOLD) return
    this.current = next
    this.shownFor = 0
    if (next === null) {
      this.root.hidden = true
      return
    }
    this.setText(next, context)
    this.root.hidden = false
    this.root.classList.toggle('urgent', URGENT.has(next) && next !== 'rotate')
  }

  private setText(id: TipId, context: TipContext): void {
    let text = this.wording(context.aircraft).get(id) ?? ''
    if (id === 'descend') {
      const km = Math.round(this.nearestDistance / 1000)
      text = `${this.nearestName} is ${km} km away: start down now with less throttle, about 500 fpm, and slow toward ${context.aircraft.spec.vSpeeds.vapp} kt.`
    }
    if (this.text.textContent !== text) this.text.textContent = text
  }

  dispose(): void {
    this.root.remove()
  }
}
