/**
 * Take Flight's screens: the start screen (where to start, wind, time of day, assists and graphics quality), the pause screen
 * (resume, restart, end the flight for its debrief, controls) and the controls panel where every key, button and axis can be rebound with deadzone and curve per axis.
 * All are DOM cards over the 3D view, keyboard reachable, and built once; `show*` swaps which is visible.
 */
import type { AssistSettings } from '../sim/Assists'
import { assistMultiplier } from '../sim/Assists'
import type { AxisAction, KeyAction } from '../input/Bindings'
import { ACTION_LABELS, AXIS_ACTIONS, BUTTON_ACTIONS, defaultBindings } from '../input/Bindings'
import type { InputManager } from '../input/InputManager'
import type { QualityTier } from '../render/Quality'
import type { CheckrideId } from '../shared/Career'
import { WEATHER_LABELS } from '../shared/Weather'
import type { CargoJob } from '../shared/Cargo'
import type { AirlineRoute } from '../shared/Airlines'
import { fleetSpec } from '../shared/Fleet'
import { liveriesFor } from '../shared/Liveries'

const LIVERY_KEY = 'takeflight.liveries.v1'

function readLiveries(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LIVERY_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** The paint scheme saved in this browser for an aircraft family. */
export function savedLivery(family: string): string | undefined {
  return readLiveries()[family]
}

function writeLiveries(value: Record<string, string>): void {
  try {
    localStorage.setItem(LIVERY_KEY, JSON.stringify(value))
  } catch {
    return
  }
}
import type { WeatherKind } from '../shared/Weather'
import { AIRPORTS, airportById } from '../shared/Airports'
import type { AirportSpec } from '../shared/Airports'
import { startsAt } from '../sim/Starts'
import type { StartKind } from '../sim/Starts'

export type { StartKind }
export type WindKind = 'calm' | 'light' | 'crosswind' | 'gusty'
export type TimeKind = 'morning' | 'noon' | 'evening' | 'night'

export interface FlightOptions {
  /** Airport id. */
  airport: string
  /** Aircraft id. */
  aircraft: string
  /** Livery id for the chosen aircraft's family. */
  livery?: string
  start: StartKind
  wind: WindKind
  weather: WeatherKind
  time: TimeKind
  assists: AssistSettings
  tier: QualityTier
  /** The checkride being flown, or null for a free flight. */
  checkride: CheckrideId | null
  /** The cargo contract being flown, or null. */
  job?: CargoJob | null
  /** The airline route being flown, or null. */
  route?: AirlineRoute | null
}

export interface MenuHandlers {
  fly(options: FlightOptions): void
  resume(): void
  restart(): void
  end(): void
  quit(): void
  quality(tier: QualityTier): void
  checkrides(): void
  cargo(): void
  airlines(): void
  boards(): void
}

const KIND_LABELS: Record<AirportSpec['kind'], string> = { grass: 'grass strip', ga: 'general aviation', regional: 'regional', cargo: 'cargo', midsize: 'mid-size', hub: 'international hub', challenge: 'mountain field' }

/** Start choices at an airport, named after its main runway's ends. */
function startLabels(airport: AirportSpec): Partial<Record<StartKind, string>> {
  const [one, two] = airport.runways[0].ends
  const labels: Record<StartKind, string> = {
    runway1: `Runway ${one}, ready`,
    runway2: `Runway ${two}, ready`,
    stand: 'Parked on the apron',
    final1: `3 mi final, runway ${one}`,
    final2: `3 mi final, runway ${two}`,
    cruise: 'Cruising toward the field',
  }
  const out: Partial<Record<StartKind, string>> = {}
  for (const kind of startsAt(airport)) out[kind] = labels[kind]
  return out
}
const WIND_LABELS: Record<WindKind, string> = { calm: 'Calm', light: 'Light, 090° 6 kt', crosswind: 'Crosswind, 180° 12 kt', gusty: 'Gusty, 240° 14 G 24 kt' }
const TIME_LABELS: Record<TimeKind, string> = { morning: 'Morning', noon: 'Midday', evening: 'Sunset', night: 'Night' }
const TIER_LABELS: Record<QualityTier, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' }

function make<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  for (const child of children) node.append(child)
  return node
}

function button(label: string, onClick: () => void, className = 'tf-btn'): HTMLButtonElement {
  const b = make('button', { type: 'button', className, textContent: label })
  b.addEventListener('click', onClick)
  return b
}

function choice<T extends string>(title: string, labels: Record<T, string>, current: T, onPick: (value: T) => void): HTMLElement {
  const options = make('div', { className: 'tf-options', role: 'group' } as Partial<HTMLDivElement>)
  options.setAttribute('aria-label', title)
  const buttons: HTMLButtonElement[] = []
  for (const value of Object.keys(labels) as T[]) {
    const b = button(labels[value], () => {
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === b))
      onPick(value)
    })
    b.setAttribute('aria-pressed', String(value === current))
    buttons.push(b)
    options.append(b)
  }
  return make('div', { className: 'tf-field' }, make('span', { textContent: title }), options)
}

export class Menus {
  readonly options: FlightOptions
  private readonly start: HTMLDivElement
  private readonly pause: HTMLDivElement
  private readonly controls: HTMLDivElement
  private readonly multiplierText: HTMLSpanElement
  private returnTo: 'start' | 'pause' = 'start'
  private readonly startSlot = make('div')
  private readonly noticeLine = make('p', { className: 'tf-notice' })
  private readonly liverySlot = make('div')

  constructor(private readonly parent: HTMLElement, private readonly input: InputManager, private readonly handlers: MenuHandlers, tier: QualityTier, private readonly aircraftName: string, private readonly career: HTMLElement, private readonly aircraftLabels: Record<string, string>) {
    this.options = { airport: 'harrow', aircraft: 'halden-wren', start: 'runway1', wind: 'light', weather: 'fair', time: 'noon', assists: { autoTrim: false, stallProtection: false, landingGuidance: true }, tier, checkride: null }
    this.multiplierText = make('span')
    this.renderLiveries()
    this.start = this.buildStart()
    this.pause = this.buildPause()
    this.controls = this.screen(make('div'))
    this.updateMultiplier()
  }

  private screen(card: HTMLElement): HTMLDivElement {
    const screen = make('div', { className: 'tf-screen' })
    screen.hidden = true
    screen.append(card)
    this.parent.append(screen)
    return screen
  }

  private airportField(): HTMLElement {
    const select = make('select', { className: 'tf-select' })
    select.setAttribute('aria-label', 'Airport')
    for (const airport of AIRPORTS) select.append(make('option', { value: airport.id, textContent: `${airport.name} (${airport.icao}) · ${KIND_LABELS[airport.kind]}` }))
    select.value = this.options.airport
    select.addEventListener('change', () => {
      this.options.airport = select.value
      this.renderStarts()
    })
    this.renderStarts()
    return make('label', { className: 'tf-field' }, make('span', { textContent: 'Airport' }), select)
  }

  private renderLiveries(): void {
    const spec = fleetSpec(this.options.aircraft)
    const list = spec ? liveriesFor(spec.family) : []
    if (!spec || list.length === 0) {
      this.liverySlot.replaceChildren()
      return
    }
    const saved = readLiveries()[spec.family]
    const current = list.find((l) => l.id === saved)?.id ?? list[0].id
    this.options.livery = current
    const labels = Object.fromEntries(list.map((l) => [l.id, l.name])) as Record<string, string>
    this.liverySlot.replaceChildren(choice('Paint', labels, current, (v) => {
      this.options.livery = v
      const all = readLiveries()
      all[spec.family] = v
      writeLiveries(all)
    }))
  }

  private renderStarts(): void {
    const airport = airportById(this.options.airport) ?? AIRPORTS[0]
    const labels = startLabels(airport) as Record<StartKind, string>
    if (!(this.options.start in labels)) this.options.start = 'runway1'
    this.startSlot.replaceChildren(choice('Start', labels, this.options.start, (v) => (this.options.start = v)))
  }

  private updateMultiplier(): void {
    const m = assistMultiplier(this.options.assists)
    this.multiplierText.textContent = m < 1 ? `Assists in use: scores count ×${m.toFixed(2)}` : 'No assists: full score'
  }

  private buildStart(): HTMLDivElement {
    const o = this.options
    const assists = make('div', { className: 'tf-field' }, make('span', { textContent: 'Assists' }))
    for (const [key, label] of [['autoTrim', 'Auto-trim'], ['stallProtection', 'Stall protection'], ['landingGuidance', 'Landing guidance']] as const) {
      const box = make('input', { type: 'checkbox', checked: o.assists[key] })
      box.addEventListener('change', () => {
        o.assists[key] = box.checked
        this.updateMultiplier()
      })
      assists.append(make('label', { className: 'tf-check' }, box, label))
    }
    assists.append(make('small', {}, this.multiplierText))
    const keys = make('div', { className: 'tf-keys' })
    for (const [k, what] of [['S / W or ↓ ↑', 'Nose up / down'], ['A / D or ← →', 'Roll'], ['Q / E', 'Rudder'], ['PgUp / PgDn or + −', 'Throttle'], ['F / R', 'Flaps down / up'], ['Space', 'Brakes'], ['[ / ]', 'Trim'], ['C', 'Camera'], ['Esc', 'Pause']]) {
      keys.append(make('kbd', { textContent: k }), make('span', { textContent: what }))
    }
    const card = make('div', { className: 'tf-card' },
      make('h1', { textContent: 'Take Flight' }),
      make('p', { textContent: `${this.aircraftName} and more as your licences grow. Seven airports across a 200 km region, from a grass strip to an international hub. Every flight is scored on smoothness and skill and earns XP toward your licences; stop after landing for the debrief and touchdown replay.` }),
      this.career,
      make('div', { className: 'tf-row' }, button('Licences and checkrides', () => this.handlers.checkrides()), button('Cargo contracts', () => this.handlers.cargo()), button('Airlines', () => this.handlers.airlines()), button('Leaderboards', () => this.handlers.boards())),
      choice('Aircraft', this.aircraftLabels, this.options.aircraft, (v) => {
        this.options.aircraft = v
        this.renderLiveries()
      }),
      this.liverySlot,
      this.noticeLine,
      this.airportField(),
      this.startSlot,
      choice('Wind', WIND_LABELS, o.wind, (v) => (o.wind = v)),
      choice('Weather', WEATHER_LABELS, o.weather, (v) => (o.weather = v)),
      choice('Time of day', TIME_LABELS, o.time, (v) => (o.time = v)),
      assists,
      choice('Graphics', TIER_LABELS, o.tier, (v) => {
        o.tier = v
        this.handlers.quality(v)
      }),
      button('Free flight', () => this.handlers.fly({ ...this.options, checkride: null }), 'tf-btn primary wide'),
      make('div', { className: 'tf-row' }, button('Controls', () => this.showControls('start'))),
      keys,
    )
    return this.screen(card)
  }

  private buildPause(): HTMLDivElement {
    const card = make('div', { className: 'tf-card' },
      make('h2', { textContent: 'Paused' }),
      make('div', { className: 'tf-row' },
        button('Resume', () => this.handlers.resume(), 'tf-btn primary'),
        button('Restart flight', () => this.handlers.restart()),
        button('End flight and debrief', () => this.handlers.end()),
        button('Controls', () => this.showControls('pause')),
        button('Change flight', () => this.handlers.quit()),
      ),
    )
    return this.screen(card)
  }

  private buildControls(): HTMLElement {
    const b = this.input.bindings
    const list = make('div', { className: 'tf-binds' })
    const rebuild = () => {
      this.input.save()
      this.controls.replaceChildren(this.buildControls())
    }
    for (const action of AXIS_ACTIONS) {
      const bound = b.axes[action] ?? []
      const row = make('div', { className: 'tf-bind' })
      const desc = bound.length ? bound.map((x) => `axis ${x.axis}${x.invert ? ' inverted' : ''}${x.device ? ` · ${x.device.slice(0, 24)}` : ''}`).join(', ') : 'not bound'
      const bind = button('Bind axis', () => {
        bind.textContent = 'Move it…'
        this.input.captureNextAxis((capture) => {
          const oneWay = action === 'throttle' || action === 'brakeLeft' || action === 'brakeRight'
          b.axes[action] = [{ device: capture.device, axis: capture.axis, invert: oneWay ? false : action === 'pitch' ? capture.value < 0 : false, deadzone: oneWay ? 0.02 : 0.06, curve: oneWay ? 1 : 1.4, unit: oneWay }]
          rebuild()
        })
      })
      row.append(make('div', {}, make('div', { textContent: ACTION_LABELS[action as AxisAction] }), make('small', { textContent: desc })), make('div', { className: 'tf-row' }, bind, button('Clear', () => {
        b.axes[action] = []
        rebuild()
      })))
      const first = bound[0]
      if (first) {
        const tune = make('div', { className: 'tf-axis-tune' })
        const invert = make('input', { type: 'checkbox', checked: first.invert })
        invert.addEventListener('change', () => {
          first.invert = invert.checked
          this.input.save()
        })
        const dead = make('input', { type: 'range', min: '0', max: '0.4', step: '0.01', value: String(first.deadzone) })
        dead.addEventListener('input', () => {
          first.deadzone = Number(dead.value)
          this.input.save()
        })
        const curve = make('input', { type: 'range', min: '1', max: '3', step: '0.1', value: String(first.curve) })
        curve.addEventListener('input', () => {
          first.curve = Number(curve.value)
          this.input.save()
        })
        tune.append(make('label', { className: 'tf-check' }, invert, 'Invert'), make('label', {}, 'Deadzone ', dead), make('label', {}, 'Curve ', curve))
        row.append(tune)
      }
      list.append(row)
    }
    const keyActions: KeyAction[] = ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight', 'throttleUp', 'throttleDown', 'flapsDown', 'flapsUp', 'gear', 'brakes', 'parkingBrake', 'trimUp', 'trimDown', 'view', 'lights', 'hud', 'atis', 'devOverlay', 'pause']
    for (const action of keyActions) {
      const codes = b.keys[action] ?? []
      const buttons = (BUTTON_ACTIONS as string[]).includes(action) ? b.buttons[action] ?? [] : []
      const row = make('div', { className: 'tf-bind' })
      const desc = [...codes, ...buttons.map((x) => `pad ${x.button}`)].join(', ') || 'not bound'
      const keyButton = button('Set key', () => {
        keyButton.textContent = 'Press a key…'
        this.input.captureNextKey((code) => {
          b.keys[action] = [code]
          rebuild()
        })
      })
      const controls = make('div', { className: 'tf-row' }, keyButton)
      if ((BUTTON_ACTIONS as string[]).includes(action)) {
        const padButton = button('Set button', () => {
          padButton.textContent = 'Press it…'
          this.input.captureNextButton((device, index) => {
            b.buttons[action] = [{ device, button: index }]
            rebuild()
          })
        })
        controls.append(padButton)
      }
      row.append(make('div', {}, make('div', { textContent: ACTION_LABELS[action] }), make('small', { textContent: desc })), controls)
      list.append(row)
    }
    const rate = make('input', { type: 'range', min: '0.5', max: '6', step: '0.1', value: String(b.keyRate) })
    rate.addEventListener('input', () => {
      b.keyRate = Number(rate.value)
      this.input.save()
    })
    const yoke = make('input', { type: 'checkbox', checked: b.mouseYoke })
    yoke.addEventListener('change', () => {
      b.mouseYoke = yoke.checked
      this.input.save()
    })
    const pads = this.input.pads().map((p) => p.id).join(', ') || 'none connected (press a button on yours)'
    return make('div', { className: 'tf-card' },
      make('h2', { textContent: 'Controls' }),
      make('p', { textContent: `Devices: ${pads}` }),
      list,
      make('label', { className: 'tf-check' }, 'Keyboard stick speed ', rate),
      make('label', { className: 'tf-check' }, yoke, 'Fly the stick with the mouse'),
      make('div', { className: 'tf-row' },
        button('Done', () => {
          this.input.cancelCapture()
          this.controls.hidden = true
          if (this.returnTo === 'pause') this.pause.hidden = false
          else this.start.hidden = false
        }, 'tf-btn primary'),
        button('Reset to defaults', () => {
          this.input.bindings = defaultBindings()
          rebuild()
        }),
      ),
    )
  }

  private hideAll(): void {
    this.start.hidden = true
    this.pause.hidden = true
    this.controls.hidden = true
  }

  /** A line under the aircraft choice (why an aircraft cannot be flown yet); empty hides it. */
  notice(text: string): void {
    this.noticeLine.textContent = text
    this.noticeLine.hidden = text === ''
  }

  showStart(): void {
    this.hideAll()
    this.start.hidden = false
    ;(this.start.querySelector('.tf-btn.primary') as HTMLButtonElement | null)?.focus({ preventScroll: true })
    this.start.scrollTop = 0
  }

  showPause(): void {
    this.hideAll()
    this.pause.hidden = false
    ;(this.pause.querySelector('.tf-btn.primary') as HTMLButtonElement | null)?.focus()
  }

  showControls(from: 'start' | 'pause'): void {
    this.returnTo = from
    this.hideAll()
    this.controls.replaceChildren(this.buildControls())
    this.controls.hidden = false
  }

  hide(): void {
    this.hideAll()
  }

  get open(): boolean {
    return !this.start.hidden || !this.pause.hidden || !this.controls.hidden
  }

  dispose(): void {
    for (const screen of [this.start, this.pause, this.controls]) screen.remove()
  }
}
