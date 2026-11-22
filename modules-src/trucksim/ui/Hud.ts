/**
 * The in-drive heads-up display: a dash cluster (speedometer, tachometer, gear, fuel, lamps, damage), a chip row for cash, clock,
 * level and place, the job card with a GPS arrow, the procedure step list with key hints and a progress bar, a context prompt, stacked
 * toasts and a round minimap the game draws into. Values are written to the DOM or canvases only when they change meaningfully, and
 * `setGauges` allocates nothing.
 */
import type { ProcedureStatus } from '../game/Procedures'
import { clear, decimal, h, keyText, money, prepareRoot, tonnes } from './dom'

export type ToastKind = 'info' | 'good' | 'warn' | 'bad'

export interface GaugeValues {
  speedKph: number
  rpm: number
  gear: number
  automatic: boolean
  fuelL: number
  fuelMaxL: number
  damage: number
  parkingBrake: boolean
  engineBrake: boolean
}

export interface JobView {
  cargo: string
  massKg: number
  from: string
  to: string
  distanceKm: number
  pay: number
  arrowRad: number
}

export type MinimapDraw = (ctx: CanvasRenderingContext2D, size: number) => void

const MAX_TOASTS = 4
const TOAST_MS = 3500
const MINIMAP_INTERVAL_MS = 100
const MINIMAP_SIZE = 148
const DIAL_SIZE = 150
const SPEED_MAX_KPH = 140
const RPM_MAX = 2500
const GREEN_FROM = 1100
const GREEN_TO = 1600
const RED_FROM = 2100
const SWEEP_START = Math.PI * 0.75
const SWEEP = Math.PI * 1.5
const KPH_PER_MPH = 1.609344
const FONT_HEAD = "'TL Fox Dollar', 'Barlow Condensed', 'Oswald', 'Arial Narrow', sans-serif"
const FONT_BODY = "'TL Fox Dollar', Inter, system-ui, sans-serif"

interface Dial {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  face: HTMLCanvasElement
  dpr: number
}

interface StepRow {
  row: HTMLElement
  mark: HTMLElement
  label: HTMLElement
  hint: HTMLElement
  bar: HTMLElement
  fill: HTMLElement
  labelText: string
  hintText: string
  state: number
  progress: number
}

function makeCanvas(size: number, dpr: number, className: string): HTMLCanvasElement {
  const canvas = h('canvas', { class: className, attrs: { 'aria-hidden': 'true' } })
  canvas.width = Math.round(size * dpr)
  canvas.height = Math.round(size * dpr)
  return canvas
}

function angleFor(value: number, max: number): number {
  return SWEEP_START + SWEEP * Math.max(0, Math.min(1, value / max))
}

function drawSpeedFace(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2
  const r = c - 4
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = 'rgba(20,22,26,0.9)'
  ctx.beginPath()
  ctx.arc(c, c, r + 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#d7d9dd'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let v = 0; v <= SPEED_MAX_KPH; v += 10) {
    const a = angleFor(v, SPEED_MAX_KPH)
    const major = v % 20 === 0
    const inner = r - (major ? 12 : 7)
    ctx.strokeStyle = major ? '#d7d9dd' : '#7b8088'
    ctx.lineWidth = major ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner)
    ctx.lineTo(c + Math.cos(a) * (r - 2), c + Math.sin(a) * (r - 2))
    ctx.stroke()
    if (major) {
      ctx.fillStyle = '#d7d9dd'
      ctx.font = `700 12px ${FONT_BODY}`
      ctx.fillText(String(v), c + Math.cos(a) * (r - 24), c + Math.sin(a) * (r - 24))
    }
  }
  ctx.fillStyle = '#9aa0a8'
  ctx.font = `700 12px ${FONT_BODY}`
  ctx.fillText('km/h', c, c + r * 0.34)
  const mphMax = Math.floor(SPEED_MAX_KPH / KPH_PER_MPH / 10) * 10
  for (let v = 0; v <= mphMax; v += 20) {
    const a = angleFor(v * KPH_PER_MPH, SPEED_MAX_KPH)
    ctx.fillStyle = '#c99b3a'
    ctx.font = `600 12px ${FONT_BODY}`
    ctx.fillText(String(v), c + Math.cos(a) * (r - 44), c + Math.sin(a) * (r - 44))
  }
}

function drawTachFace(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2
  const r = c - 4
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = 'rgba(20,22,26,0.9)'
  ctx.beginPath()
  ctx.arc(c, c, r + 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#d7d9dd'
  ctx.lineWidth = 2
  ctx.stroke()
  const bands: readonly [number, number, string][] = [[GREEN_FROM, GREEN_TO, '#7fc46a'], [RED_FROM, RPM_MAX, '#e05a3a']]
  ctx.lineWidth = 6
  for (const [from, to, color] of bands) {
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.arc(c, c, r - 4, angleFor(from, RPM_MAX), angleFor(to, RPM_MAX))
    ctx.stroke()
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let v = 0; v <= RPM_MAX; v += 250) {
    const a = angleFor(v, RPM_MAX)
    const major = v % 500 === 0
    const inner = r - (major ? 16 : 11)
    ctx.strokeStyle = major ? '#d7d9dd' : '#7b8088'
    ctx.lineWidth = major ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner)
    ctx.lineTo(c + Math.cos(a) * (r - 10), c + Math.sin(a) * (r - 10))
    ctx.stroke()
    if (major) {
      ctx.fillStyle = '#d7d9dd'
      ctx.font = `700 12px ${FONT_BODY}`
      ctx.fillText(String(v / 100), c + Math.cos(a) * (r - 28), c + Math.sin(a) * (r - 28))
    }
  }
  ctx.fillStyle = '#9aa0a8'
  ctx.font = `700 12px ${FONT_BODY}`
  ctx.fillText('rpm x100', c, c + r * 0.4)
}

function drawNeedle(dial: Dial, size: number, value: number, max: number, readout: string): void {
  const { ctx } = dial
  const c = size / 2
  const r = c - 4
  ctx.setTransform(dial.dpr, 0, 0, dial.dpr, 0, 0)
  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(dial.face, 0, 0, size, size)
  const a = angleFor(value, max)
  ctx.strokeStyle = '#f2a33a'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(c - Math.cos(a) * 8, c - Math.sin(a) * 8)
  ctx.lineTo(c + Math.cos(a) * (r - 14), c + Math.sin(a) * (r - 14))
  ctx.stroke()
  ctx.fillStyle = '#d7d9dd'
  ctx.beginPath()
  ctx.arc(c, c, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 22px ${FONT_HEAD}`
  ctx.fillText(readout, c, c + r * 0.62)
}

function makeDial(face: (ctx: CanvasRenderingContext2D, size: number) => void, className: string, dpr: number): Dial {
  const canvas = makeCanvas(DIAL_SIZE, dpr, className)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const faceCanvas = makeCanvas(DIAL_SIZE, dpr, '')
  const faceCtx = faceCanvas.getContext('2d') as CanvasRenderingContext2D
  faceCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  face(faceCtx, DIAL_SIZE)
  return { canvas, ctx, face: faceCanvas, dpr }
}

/** The driving HUD. Create once with the UI root; call the setters from the frame loop as values change. */
export class Hud {
  private readonly layer: HTMLElement
  private readonly speedDial: Dial
  private readonly tachDial: Dial
  private readonly gearMain: HTMLElement
  private readonly gearSub: HTMLElement
  private readonly fuelFill: HTMLElement
  private readonly fuelText: HTMLElement
  private readonly fuelBar: HTMLElement
  private readonly lampEngine: HTMLElement
  private readonly lampPark: HTMLElement
  private readonly damageText: HTMLElement
  private readonly cashText: HTMLElement
  private readonly clockText: HTMLElement
  private readonly levelText: HTMLElement
  private readonly placeText: HTMLElement
  private readonly jobCard: HTMLElement
  private readonly jobCargo: HTMLElement
  private readonly jobRoute: HTMLElement
  private readonly jobMeta: HTMLElement
  private readonly jobArrow: HTMLElement
  private readonly stepsPanel: HTMLElement
  private readonly stepsTitle: HTMLElement
  private readonly stepsList: HTMLElement
  private readonly stepsMessage: HTMLElement
  private readonly promptLine: HTMLElement
  private readonly toasts: HTMLElement
  private readonly minimapCanvas: HTMLCanvasElement
  private readonly minimapCtx: CanvasRenderingContext2D
  private readonly dpr: number
  private rows: StepRow[] = []
  private stepsTitleText = ''
  private stepsMessageText = ''
  private minimapDraw: MinimapDraw | null = null
  private minimapTimer = 0
  private visible = true
  private lastSpeed = -1
  private lastRpm = -1
  private lastGear = -999
  private lastAuto = false
  private lastFuelPct = -1
  private lastFuelL = -1
  private lastDamage = -1
  private lastPark = false
  private lastEngine = false
  private lastCash = Number.NaN
  private lastMinute = -1
  private lastLevel = -1
  private lastPlace = ''
  private lastPrompt: string | null = null
  private lastArrow = Number.NaN
  private lastDistance = Number.NaN
  private jobKey = ''
  private readonly toastTimers = new Map<HTMLElement, number>()

  constructor(root: HTMLElement) {
    prepareRoot(root)
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    this.speedDial = makeDial(drawSpeedFace, 'ts-dial', this.dpr)
    this.tachDial = makeDial(drawTachFace, 'ts-dial', this.dpr)
    this.speedDial.canvas.setAttribute('role', 'img')
    this.speedDial.canvas.removeAttribute('aria-hidden')
    this.speedDial.canvas.setAttribute('aria-label', 'Speedometer')
    this.tachDial.canvas.setAttribute('role', 'img')
    this.tachDial.canvas.removeAttribute('aria-hidden')
    this.tachDial.canvas.setAttribute('aria-label', 'Tachometer')

    this.gearMain = h('b', { class: 'ts-gear-main', text: 'N' })
    this.gearSub = h('span', { class: 'ts-gear-sub' })
    this.fuelFill = h('i')
    this.fuelBar = h('div', { class: 'ts-fuel-bar', attrs: { role: 'meter', 'aria-label': 'Fuel', 'aria-valuemin': '0', 'aria-valuemax': '100' } }, this.fuelFill)
    this.fuelText = h('span', { class: 'ts-fuel-text' })
    this.lampEngine = h('span', { class: 'ts-lamp', text: 'ENG BRK', attrs: { 'aria-label': 'Engine brake off' } })
    this.lampPark = h('span', { class: 'ts-lamp warn', text: 'PARK', attrs: { 'aria-label': 'Parking brake off' } })
    this.damageText = h('span', { class: 'ts-damage', text: 'DMG 0%' })
    const gearBox = h('div', { class: 'ts-gear', attrs: { 'aria-label': 'Gear' } }, this.gearMain, this.gearSub)
    const side = h('div', { class: 'ts-dash-side' },
      gearBox,
      h('div', { class: 'ts-fuel' }, h('span', { class: 'ts-fuel-label', text: 'FUEL' }), this.fuelBar, this.fuelText),
      h('div', { class: 'ts-lamps' }, this.lampEngine, this.lampPark),
      this.damageText)
    const dash = h('div', { class: 'ts-dash' }, this.speedDial.canvas, this.tachDial.canvas, side)

    this.cashText = h('b', { text: money(0) })
    this.clockText = h('b', { text: '00:00' })
    this.levelText = h('b', { text: '1' })
    this.placeText = h('b', { text: '' })
    const chips = h('div', { class: 'ts-chips' },
      h('span', { class: 'ts-chip cash' }, this.cashText),
      h('span', { class: 'ts-chip' }, h('span', { class: 'dim', text: 'Time ' }), this.clockText),
      h('span', { class: 'ts-chip' }, h('span', { class: 'dim', text: 'Level ' }), this.levelText),
      h('span', { class: 'ts-chip place' }, this.placeText))

    this.jobArrow = h('div', { class: 'ts-arrow', attrs: { 'aria-hidden': 'true' } }, h('i'))
    this.jobCargo = h('b', { class: 'ts-job-cargo' })
    this.jobRoute = h('span', { class: 'ts-job-route' })
    this.jobMeta = h('span', { class: 'ts-job-meta' })
    this.jobCard = h('section', { class: 'ts-job', attrs: { 'aria-label': 'Current job' } },
      this.jobArrow, h('div', { class: 'ts-job-text' }, this.jobCargo, this.jobRoute, this.jobMeta))
    this.jobCard.hidden = true

    this.stepsTitle = h('h3', { class: 'ts-steps-title' })
    this.stepsList = h('ol', { class: 'ts-steps-list' })
    this.stepsMessage = h('p', { class: 'ts-steps-message', attrs: { 'aria-live': 'polite' } })
    this.stepsPanel = h('section', { class: 'ts-steps', attrs: { 'aria-label': 'Procedure steps' } }, this.stepsTitle, this.stepsList, this.stepsMessage)
    this.stepsPanel.hidden = true

    this.promptLine = h('div', { class: 'ts-prompt', attrs: { role: 'status', 'aria-live': 'polite' } })
    this.promptLine.hidden = true
    this.toasts = h('div', { class: 'ts-toasts', attrs: { role: 'status', 'aria-live': 'polite' } })
    this.minimapCanvas = makeCanvas(MINIMAP_SIZE, this.dpr, 'ts-minimap')
    this.minimapCtx = this.minimapCanvas.getContext('2d') as CanvasRenderingContext2D
    this.minimapCanvas.setAttribute('role', 'img')
    this.minimapCanvas.setAttribute('aria-label', 'Minimap')
    this.minimapCanvas.removeAttribute('aria-hidden')

    this.layer = h('div', { class: 'ts-hud' },
      h('div', { class: 'ts-hud-tl' }, chips, this.stepsPanel),
      h('div', { class: 'ts-hud-tr' }, this.jobCard),
      h('div', { class: 'ts-hud-bl' }, this.minimapCanvas),
      h('div', { class: 'ts-hud-br' }, dash),
      this.promptLine, this.toasts)
    root.appendChild(this.layer)
    this.setGauges({ speedKph: 0, rpm: 0, gear: 0, automatic: false, fuelL: 0, fuelMaxL: 1, damage: 0, parkingBrake: false, engineBrake: false })
    this.lastFuelPct = -1
  }

  /** Updates the dash. Canvases redraw only when speed moves by 0.5 km/h or rpm by 10; text only on change. */
  setGauges(values: GaugeValues): void {
    const speed = Math.round(Math.abs(values.speedKph) * 2) / 2
    if (speed !== this.lastSpeed) {
      this.lastSpeed = speed
      const kph = Math.round(speed)
      drawNeedle(this.speedDial, DIAL_SIZE, speed, SPEED_MAX_KPH, `${kph} · ${Math.round(speed / KPH_PER_MPH)} mph`)
    }
    const rpm = Math.round(values.rpm / 10) * 10
    if (rpm !== this.lastRpm) {
      this.lastRpm = rpm
      drawNeedle(this.tachDial, DIAL_SIZE, rpm, RPM_MAX, `${rpm}`)
    }
    if (values.gear !== this.lastGear || values.automatic !== this.lastAuto) {
      this.lastGear = values.gear
      this.lastAuto = values.automatic
      const label = values.gear < 0 ? 'R' : values.gear === 0 ? 'N' : String(values.gear)
      this.gearMain.textContent = values.automatic && values.gear > 0 ? 'A' : label
      this.gearSub.textContent = values.automatic && values.gear > 0 ? label : values.automatic ? 'auto' : 'manual'
    }
    const pct = values.fuelMaxL > 0 ? Math.max(0, Math.min(100, Math.round((values.fuelL / values.fuelMaxL) * 100))) : 0
    const litres = Math.round(values.fuelL)
    if (pct !== this.lastFuelPct) {
      this.lastFuelPct = pct
      this.fuelFill.style.width = `${pct}%`
      this.fuelBar.classList.toggle('low', pct < 15)
      this.fuelBar.setAttribute('aria-valuenow', String(pct))
    }
    if (litres !== this.lastFuelL) {
      this.lastFuelL = litres
      this.fuelText.textContent = `${litres} L`
    }
    const damage = Math.round(values.damage)
    if (damage !== this.lastDamage) {
      this.lastDamage = damage
      this.damageText.textContent = `DMG ${damage}%`
      this.damageText.className = damage >= 60 ? 'ts-damage bad' : damage >= 25 ? 'ts-damage warn' : 'ts-damage'
    }
    if (values.parkingBrake !== this.lastPark) {
      this.lastPark = values.parkingBrake
      this.lampPark.classList.toggle('on', values.parkingBrake)
      this.lampPark.setAttribute('aria-label', values.parkingBrake ? 'Parking brake on' : 'Parking brake off')
    }
    if (values.engineBrake !== this.lastEngine) {
      this.lastEngine = values.engineBrake
      this.lampEngine.classList.toggle('on', values.engineBrake)
      this.lampEngine.setAttribute('aria-label', values.engineBrake ? 'Engine brake on' : 'Engine brake off')
    }
  }

  setCash(cash: number): void {
    if (cash === this.lastCash) return
    this.lastCash = cash
    this.cashText.textContent = money(cash)
  }

  /** `hours` is the time of day, 0 up to 24. */
  setClock(hours: number): void {
    const total = Math.floor((((hours % 24) + 24) % 24) * 60)
    if (total === this.lastMinute) return
    this.lastMinute = total
    const hh = Math.floor(total / 60)
    const mm = total % 60
    this.clockText.textContent = `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`
  }

  setLevel(level: number): void {
    if (level === this.lastLevel) return
    this.lastLevel = level
    this.levelText.textContent = String(level)
  }

  setPlace(text: string): void {
    if (text === this.lastPlace) return
    this.lastPlace = text
    this.placeText.textContent = text
  }

  /** Shows the job card, or hides it for `null`. `arrowRad` is the bearing to the target relative to the truck, 0 ahead, clockwise positive. */
  setJob(view: JobView | null): void {
    if (!view) {
      this.jobCard.hidden = true
      this.jobKey = ''
      this.lastDistance = Number.NaN
      return
    }
    this.jobCard.hidden = false
    const key = `${view.cargo}|${view.massKg}|${view.from}|${view.to}|${view.pay}`
    if (key !== this.jobKey) {
      this.jobKey = key
      this.jobCargo.textContent = `${view.cargo} · ${tonnes(view.massKg)}`
      this.jobRoute.textContent = `${view.from} → ${view.to}`
      this.lastDistance = Number.NaN
    }
    const distance = Math.round(view.distanceKm * 10) / 10
    if (distance !== this.lastDistance) {
      this.lastDistance = distance
      this.jobMeta.textContent = `${decimal(distance)} km left · ${money(view.pay)}`
    }
    const arrow = Math.round(view.arrowRad * 50) / 50
    if (arrow !== this.lastArrow) {
      this.lastArrow = arrow
      this.jobArrow.style.transform = `rotate(${arrow}rad)`
    }
  }

  /** Shows the procedure's steps; `null` hides the panel. Rows are rebuilt only when the step list changes. */
  setSteps(status: ProcedureStatus | null): void {
    if (!status) {
      if (!this.stepsPanel.hidden) this.stepsPanel.hidden = true
      return
    }
    this.stepsPanel.hidden = false
    if (status.title !== this.stepsTitleText) {
      this.stepsTitleText = status.title
      this.stepsTitle.textContent = status.title
    }
    if (status.steps.length !== this.rows.length) this.buildRows(status.steps.length)
    for (let i = 0; i < this.rows.length; i++) {
      const step = status.steps[i]
      const row = this.rows[i]
      const state = step.done || status.done ? 2 : i === status.active ? 1 : 0
      if (row.labelText !== step.label) {
        row.labelText = step.label
        row.label.textContent = step.label
      }
      if (row.hintText !== step.hint) {
        row.hintText = step.hint
        clear(row.hint)
        if (step.hint) row.hint.appendChild(keyText(step.hint))
      }
      if (row.state !== state) {
        row.state = state
        row.row.className = state === 2 ? 'done' : state === 1 ? 'active' : 'next'
        row.mark.textContent = state === 2 ? '✓' : state === 1 ? '▸' : '·'
        row.bar.hidden = state !== 1
        if (state === 1) row.row.setAttribute('aria-current', 'step')
        else row.row.removeAttribute('aria-current')
      }
      const progress = state === 1 ? Math.round(Math.max(0, Math.min(1, step.progress)) * 100) : 0
      if (progress !== row.progress) {
        row.progress = progress
        row.fill.style.width = `${progress}%`
      }
    }
    if (status.message !== this.stepsMessageText) {
      this.stepsMessageText = status.message
      this.stepsMessage.textContent = status.message
      this.stepsMessage.hidden = status.message === ''
    }
  }

  /** Shows the context prompt line ("Press E to …"), or hides it for `null`. */
  prompt(text: string | null): void {
    if (text === this.lastPrompt) return
    this.lastPrompt = text
    clear(this.promptLine)
    if (text) this.promptLine.appendChild(keyText(text))
    this.promptLine.hidden = !text
  }

  /** Pushes a toast; at most four stay, each leaves after 3.5 s. */
  toast(text: string, kind: ToastKind = 'info'): void {
    while (this.toasts.childElementCount >= MAX_TOASTS) this.dropToast(this.toasts.firstElementChild as HTMLElement)
    const node = h('div', { class: `ts-toast ${kind}`, text })
    this.toasts.appendChild(node)
    this.toastTimers.set(node, window.setTimeout(() => this.dropToast(node), TOAST_MS))
  }

  /** Sets the minimap painter; the HUD calls it at most ten times a second with a context already scaled to CSS pixels. */
  setMinimap(draw: MinimapDraw | null): void {
    this.minimapDraw = draw
    if (this.minimapTimer === 0) {
      this.minimapTimer = window.setInterval(() => this.paintMinimap(), MINIMAP_INTERVAL_MS)
    }
    this.paintMinimap()
  }

  setVisible(on: boolean): void {
    this.visible = on
    this.layer.hidden = !on
  }

  dispose(): void {
    if (this.minimapTimer !== 0) window.clearInterval(this.minimapTimer)
    this.minimapTimer = 0
    for (const timer of this.toastTimers.values()) window.clearTimeout(timer)
    this.toastTimers.clear()
    this.minimapDraw = null
    this.layer.remove()
  }

  private paintMinimap(): void {
    if (!this.visible || !this.minimapDraw) return
    const ctx = this.minimapCtx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE)
    ctx.save()
    ctx.beginPath()
    ctx.arc(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    this.minimapDraw(ctx, MINIMAP_SIZE)
    ctx.restore()
  }

  private dropToast(node: HTMLElement): void {
    const timer = this.toastTimers.get(node)
    if (timer !== undefined) window.clearTimeout(timer)
    this.toastTimers.delete(node)
    node.remove()
  }

  private buildRows(count: number): void {
    clear(this.stepsList)
    this.rows = []
    for (let i = 0; i < count; i++) {
      const mark = h('span', { class: 'ts-step-mark', attrs: { 'aria-hidden': 'true' } })
      const label = h('span', { class: 'ts-step-label' })
      const hint = h('span', { class: 'ts-step-hint' })
      const fill = h('i')
      const bar = h('div', { class: 'ts-step-bar', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' } }, fill)
      bar.hidden = true
      const row = h('li', { class: 'next' }, mark, h('div', { class: 'ts-step-body' }, h('div', { class: 'ts-step-line' }, label, hint), bar))
      this.stepsList.appendChild(row)
      this.rows.push({ row, mark, label, hint, bar, fill, labelText: '\u0000', hintText: '\u0000', state: -1, progress: -1 })
    }
  }
}
