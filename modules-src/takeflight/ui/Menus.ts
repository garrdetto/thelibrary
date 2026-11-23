/**
 * Take Flight's screens: the start screen (where to start, wind, time of day, assists and graphics quality), the pause screen,
 * the crash screen and the controls panel where every key, button and axis can be rebound with deadzone and curve per axis.
 * All are DOM cards over the 3D view, keyboard reachable, and built once; `show*` swaps which is visible.
 */
import type { AssistSettings } from '../sim/Assists'
import { assistMultiplier } from '../sim/Assists'
import type { AxisAction, KeyAction } from '../input/Bindings'
import { ACTION_LABELS, AXIS_ACTIONS, BUTTON_ACTIONS, defaultBindings } from '../input/Bindings'
import type { InputManager } from '../input/InputManager'
import type { QualityTier } from '../render/Quality'

export type StartKind = 'runway09' | 'runway27' | 'stand' | 'final09' | 'final27' | 'cruise'
export type WindKind = 'calm' | 'light' | 'crosswind' | 'gusty'
export type TimeKind = 'morning' | 'noon' | 'evening' | 'night'

export interface FlightOptions {
  start: StartKind
  wind: WindKind
  time: TimeKind
  assists: AssistSettings
  tier: QualityTier
}

export interface MenuHandlers {
  fly(options: FlightOptions): void
  resume(): void
  restart(): void
  quit(): void
  quality(tier: QualityTier): void
}

const START_LABELS: Record<StartKind, string> = {
  runway09: 'Runway 09, ready',
  runway27: 'Runway 27, ready',
  stand: 'Parked on the apron',
  final09: '3 mi final, runway 09',
  final27: '3 mi final, runway 27',
  cruise: 'Cruising at 3,500 ft',
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
  private readonly crash: HTMLDivElement
  private readonly controls: HTMLDivElement
  private readonly crashText: HTMLParagraphElement
  private readonly multiplierText: HTMLSpanElement
  private returnTo: 'start' | 'pause' = 'start'

  constructor(private readonly parent: HTMLElement, private readonly input: InputManager, private readonly handlers: MenuHandlers, tier: QualityTier, private readonly aircraftName: string) {
    this.options = { start: 'runway09', wind: 'light', time: 'noon', assists: { autoTrim: false, stallProtection: false, landingGuidance: true }, tier }
    this.multiplierText = make('span')
    this.start = this.buildStart()
    this.pause = this.buildPause()
    this.crashText = make('p')
    this.crash = this.screen(make('div', { className: 'tf-card' }, make('h2', { textContent: 'Flight ended' }), this.crashText, make('div', { className: 'tf-row' }, button('Fly again', () => this.handlers.restart(), 'tf-btn primary'), button('Change flight', () => this.handlers.quit()))))
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
      make('p', { textContent: `Student pilot · ${this.aircraftName} at Harrow Field. Learn the controls, fly the pattern and land on the centreline.` }),
      choice('Start', START_LABELS, o.start, (v) => (o.start = v)),
      choice('Wind', WIND_LABELS, o.wind, (v) => (o.wind = v)),
      choice('Time of day', TIME_LABELS, o.time, (v) => (o.time = v)),
      assists,
      choice('Graphics', TIER_LABELS, o.tier, (v) => {
        o.tier = v
        this.handlers.quality(v)
      }),
      button('Fly', () => this.handlers.fly(this.options), 'tf-btn primary wide'),
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
    const keyActions: KeyAction[] = ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight', 'throttleUp', 'throttleDown', 'flapsDown', 'flapsUp', 'gear', 'brakes', 'parkingBrake', 'trimUp', 'trimDown', 'view', 'lights', 'hud', 'devOverlay', 'pause']
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
    this.crash.hidden = true
    this.controls.hidden = true
  }

  showStart(): void {
    this.hideAll()
    this.start.hidden = false
    ;(this.start.querySelector('.tf-btn.primary') as HTMLButtonElement | null)?.focus()
  }

  showPause(): void {
    this.hideAll()
    this.pause.hidden = false
    ;(this.pause.querySelector('.tf-btn.primary') as HTMLButtonElement | null)?.focus()
  }

  showCrash(reason: string): void {
    this.hideAll()
    this.crashText.textContent = `The flight ended: ${reason}.`
    this.crash.hidden = false
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
    return !this.start.hidden || !this.pause.hidden || !this.crash.hidden || !this.controls.hidden
  }

  dispose(): void {
    for (const screen of [this.start, this.pause, this.crash, this.controls]) screen.remove()
  }
}
