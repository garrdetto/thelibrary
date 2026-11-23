/**
 * The in-flight overlay: airspeed, altitude, vertical speed, heading, ground speed, AGL and G in a corner block; chips for flaps,
 * gear, trim, brakes, lights and the active view; a throttle bar; stall, overspeed and crash warnings; the landing-guidance
 * glidepath bar when that assist is on; ILS localizer and glideslope needles on ILS approaches; and short toasts. DOM nodes are made once and only their text and styles change, at most
 * 15 times a second. `minimal` keeps only the four essentials.
 */
import { FOOT, FPM, KNOT } from '../sim/Atmosphere'
import type { ControlInput } from '../sim/Controls'
import type { FlightModel } from '../sim/FlightModel'
import { RadioLog } from './RadioLog'

const REFRESH = 1 / 15

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  parent.appendChild(node)
  return node
}

export interface HudExtras {
  view: string
  lights: boolean
  parkingBrake: boolean
  /** Glidepath deviation in dots (-2..2, positive = above) or null when no guidance. */
  glidepath: number | null
  /** ILS needles when flying an ILS approach: runway end name, localizer and glideslope dots (positive = right, above). */
  ils: { name: string; localizer: number; glideslope: number } | null
}

export class Hud {
  readonly root: HTMLDivElement
  private readonly values: Record<string, HTMLElement> = {}
  private readonly chips: Record<string, HTMLElement> = {}
  private readonly throttleBar: HTMLElement
  private readonly warning: HTMLElement
  private readonly guide: HTMLElement
  private readonly guideMarker: HTMLElement
  private readonly toastNode: HTMLElement
  private readonly ils: HTMLElement
  private readonly ilsLabel: HTMLElement
  private readonly locMarker: HTMLElement
  private since = 0
  private toastTimer = 0
  /** ATC and ATIS transmissions. */
  readonly radio: RadioLog

  constructor(parent: HTMLElement) {
    this.root = el('div', 'tf-hud', parent)
    this.root.setAttribute('aria-live', 'off')
    const block = el('dl', 'tf-flight', this.root)
    for (const [key, label] of [['ias', 'IAS'], ['alt', 'ALT'], ['vs', 'V/S'], ['hdg', 'HDG'], ['gs', 'GS'], ['agl', 'AGL'], ['g', 'G'], ['aoa', 'AOA']]) {
      el('dt', '', block, label)
      this.values[key] = el('dd', '', block, '—')
    }
    const config = el('div', 'tf-config', this.root)
    for (const key of ['view', 'flaps', 'gear', 'trim', 'brakes', 'lights', 'fuel']) this.chips[key] = el('span', 'tf-chip', config, '—')
    const throttle = el('div', 'tf-throttle', this.root)
    throttle.setAttribute('aria-label', 'Throttle')
    this.throttleBar = el('i', '', throttle)
    this.warning = el('div', 'tf-warning', this.root)
    this.warning.hidden = true
    this.warning.setAttribute('role', 'alert')
    this.guide = el('div', 'tf-guide', this.root)
    this.guide.hidden = true
    this.guideMarker = el('b', '', this.guide)
    this.ils = el('div', 'tf-ils', this.root)
    this.ils.hidden = true
    this.ilsLabel = el('span', '', this.ils, 'ILS')
    const loc = el('div', 'tf-loc', this.ils)
    loc.setAttribute('aria-label', 'Localizer')
    this.locMarker = el('b', '', loc)
    this.toastNode = el('div', 'tf-toast', this.root)
    this.toastNode.style.opacity = '0'
    this.toastNode.setAttribute('role', 'status')
    this.radio = new RadioLog(this.root)
  }

  setMinimal(minimal: boolean): void {
    this.root.classList.toggle('minimal', minimal)
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible
  }

  toast(message: string, seconds = 2.5): void {
    this.toastNode.textContent = message
    this.toastNode.style.opacity = '1'
    this.toastTimer = seconds
  }

  update(a: FlightModel, input: Readonly<ControlInput>, extras: HudExtras, dt: number): void {
    this.radio.update(dt)
    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) this.toastNode.style.opacity = '0'
    }
    this.since += dt
    if (this.since < REFRESH) return
    this.since = 0
    const v = this.values
    v.ias.textContent = `${Math.round(a.ias / KNOT)} kt`
    v.alt.textContent = `${Math.round(a.py / FOOT).toLocaleString('en-US')} ft`
    v.vs.textContent = `${Math.round(a.verticalSpeed / FPM / 10) * 10} fpm`
    v.hdg.textContent = `${String(Math.round(a.heading) % 360).padStart(3, '0')}°`
    v.gs.textContent = `${Math.round(a.groundSpeed / KNOT)} kt`
    v.agl.textContent = `${Math.max(0, Math.round((a.agl - 1.25) / FOOT))} ft`
    v.g.textContent = a.loadFactor.toFixed(2)
    v.aoa.textContent = a.ias / KNOT < 10 ? '—' : `${a.alpha.toFixed(1)}°`
    const spec = a.spec
    const detents = spec.controls.flapDetents
    const flapIndex = Math.max(0, Math.min(detents.length - 1, Math.round(input.flaps)))
    this.chip('view', extras.view, false)
    this.chip('flaps', `Flaps ${detents[flapIndex]}°`, flapIndex > 0)
    this.chip('gear', spec.controls.retractable ? (a.gear > 0.99 ? 'Gear down' : a.gear < 0.01 ? 'Gear up' : 'Gear moving') : 'Fixed gear', spec.controls.retractable && a.gear > 0.99)
    this.chip('trim', `Trim ${a.trim >= 0 ? '+' : ''}${Math.round(a.trim * 100)}`, false)
    this.chip('brakes', extras.parkingBrake ? 'Parking brake' : input.brakeLeft > 0 || input.brakeRight > 0 ? 'Brakes' : 'Brakes off', extras.parkingBrake || input.brakeLeft > 0, extras.parkingBrake ? 'warn' : '')
    this.chip('lights', extras.lights ? 'Lights on' : 'Lights off', extras.lights)
    const fuelShare = a.fuel / spec.mass.fuelCapacity
    this.chip('fuel', `Fuel ${Math.round(fuelShare * 100)}%`, false, fuelShare < 0.1 ? 'bad' : fuelShare < 0.2 ? 'warn' : '')
    this.throttleBar.style.height = `${Math.round(input.throttle * 100)}%`
    let warning = ''
    if (a.crashed) warning = `CRASH — ${a.crashed.toUpperCase()}`
    else if (a.stall > 0.75 && a.wheelLoad <= 0) warning = 'STALL'
    else if (a.ias / KNOT > spec.vSpeeds.vne) warning = 'OVERSPEED'
    else if (a.flap > 0.05 && a.ias / KNOT > spec.vSpeeds.vfe + 3) warning = 'FLAP OVERSPEED'
    this.warning.hidden = warning === ''
    if (warning) this.warning.textContent = warning
    const glidepath = extras.ils ? extras.ils.glideslope : extras.glidepath
    this.guide.hidden = glidepath === null
    if (glidepath !== null) {
      const dots = Math.max(-2, Math.min(2, glidepath))
      this.guideMarker.style.top = `${50 - dots * 22}%`
    }
    this.ils.hidden = extras.ils === null
    if (extras.ils) {
      const label = `ILS ${extras.ils.name}`
      if (this.ilsLabel.textContent !== label) this.ilsLabel.textContent = label
      const dots = Math.max(-2, Math.min(2, extras.ils.localizer))
      this.locMarker.style.left = `${50 + dots * 22}%`
    }
  }

  private chip(key: string, text: string, on: boolean, tone = ''): void {
    const chip = this.chips[key]
    if (chip.textContent !== text) chip.textContent = text
    const className = `tf-chip${on ? ' on' : ''}${tone ? ` ${tone}` : ''}`
    if (chip.className !== className) chip.className = className
  }

  dispose(): void {
    this.root.remove()
  }
}
