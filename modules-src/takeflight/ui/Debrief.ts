/**
 * The debrief after a flight: total score and grade with the assists multiplier, the touchdown numbers, a bar per scoring
 * category that opens to its metrics, the touchdown graph (height and vertical speed over the last 30 seconds, drawn on a
 * canvas), tips from the metrics that cost the most points, and the flight record's size with a download. A small bar runs the
 * touchdown replay. DOM is built once per debrief; nothing here touches the simulation.
 */
import { FOOT, FPM } from '../sim/Atmosphere'
import type { FlightScore } from '../sim/Scoring'
import { CH, CHANNELS } from '../sim/Telemetry'

export interface DebriefHandlers {
  replay(): void
  continueFlight(): void
  again(): void
  change(): void
}

export interface ReplayHandlers {
  speed(): void
  camera(): void
  back(): void
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function button(label: string, onClick: () => void, className = 'tf-btn'): HTMLButtonElement {
  const b = make('button', className, label)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

function tone(score: number): string {
  return score >= 85 ? 'good' : score >= 60 ? 'warn' : 'bad'
}

const feet = (metres: number) => Math.round(Math.abs(metres) / FOOT).toLocaleString('en-US')

export class Debrief {
  private readonly screen: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly bar: HTMLDivElement
  private readonly barLabel: HTMLSpanElement
  private readonly barProgress: HTMLElement
  private readonly speedButton: HTMLButtonElement
  private careerNode: HTMLElement | null = null
  private recordLine: HTMLElement | null = null
  private recordButton: HTMLButtonElement | null = null
  private recordUrl: string | null = null
  private canvas: HTMLCanvasElement | null = null
  private graph: (() => void) | null = null
  private readonly onResize = () => this.graph?.()

  constructor(parent: HTMLElement, private readonly handlers: DebriefHandlers, replay: ReplayHandlers) {
    this.screen = make('div', 'tf-screen tf-debrief-screen')
    this.screen.hidden = true
    this.card = make('div', 'tf-card tf-debrief')
    this.card.setAttribute('role', 'dialog')
    this.card.setAttribute('aria-label', 'Flight debrief')
    this.screen.append(this.card)
    parent.append(this.screen)
    this.bar = make('div', 'tf-replay')
    this.bar.hidden = true
    this.barLabel = make('span', 'tf-replay-label', 'Touchdown replay')
    const track = make('div', 'tf-replay-track')
    track.setAttribute('aria-hidden', 'true')
    this.barProgress = make('i')
    track.append(this.barProgress)
    this.speedButton = button('Full speed', () => replay.speed())
    this.bar.append(this.barLabel, track, this.speedButton, button('Camera', () => replay.camera()), button('Back to debrief', () => replay.back(), 'tf-btn primary'))
    parent.append(this.bar)
    addEventListener('resize', this.onResize)
  }

  get open(): boolean {
    return !this.screen.hidden
  }

  show(score: FlightScore, telemetry: Float32Array, options: { canContinue: boolean; aircraft: string; airport: string; checkride: string | null }): void {
    this.clearRecord()
    const card = this.card
    card.replaceChildren()
    const head = make('div', 'tf-debrief-head')
    const total = make('div', `tf-score ${score.crashed ? 'bad' : tone(score.total)}`)
    total.append(make('b', '', String(score.total)), make('span', '', score.grade))
    const intro = make('div', 'tf-debrief-intro')
    intro.append(make('h2', '', 'Flight debrief'), make('p', '', `${options.aircraft} · ${options.airport} · ${formatDuration(score.seconds)}`))
    if (score.multiplier < 1) intro.append(make('p', 'tf-muted', `${score.raw.toFixed(1)} before assists, counted ×${score.multiplier.toFixed(2)}`))
    if (options.checkride) intro.append(make('p', '', options.checkride))
    if (score.crashed) intro.append(make('p', 'tf-bad', `The flight ended in a crash: ${score.crashed}.`))
    head.append(total, intro)
    card.append(head)
    this.careerNode = make('div', 'tf-career-out')
    this.careerNode.append(make('p', 'tf-muted', 'Adding the flight to your career…'))
    card.append(make('h3', '', options.checkride ? 'Checkride and career' : 'Career'), this.careerNode)

    if (score.landing) {
      const l = score.landing
      const facts = make('dl', 'tf-facts')
      const add = (label: string, value: string) => facts.append(make('dt', '', label), make('dd', '', value))
      add('Runway', l.runway)
      add('Sink rate', `${l.sinkFpm} fpm`)
      add('Touchdown G', l.g.toFixed(2))
      add('Centreline', l.centreline === 0 ? 'on it' : `${feet(l.centreline)} ft ${l.centreline > 0 ? 'right' : 'left'}`)
      add('From aim point', l.fromThreshold < 0 ? `${feet(l.fromThreshold)} ft short of the runway` : `${feet(l.fromAim)} ft ${l.fromAim >= 0 ? 'long' : 'short'}`)
      add('Bounces', String(l.bounces))
      add('Crab', `${l.crab.toFixed(1)}°`)
      add('Speed', `${l.iasKt} kt`)
      card.append(make('h3', '', 'Touchdown'), facts)
    }

    const categories = make('div', 'tf-categories')
    for (const c of score.categories) {
      const row = make('details', 'tf-category')
      const summary = make('summary')
      const label = make('span', 'tf-category-label', c.label)
      label.append(make('small', '', ` ${c.weight}%`))
      const meter = make('span', 'tf-meter')
      const fill = make('i', c.score === null ? '' : tone(c.score))
      fill.style.width = `${c.score ?? 0}%`
      meter.append(fill)
      meter.setAttribute('role', 'img')
      meter.setAttribute('aria-label', c.score === null ? `${c.label}: not flown` : `${c.label}: ${Math.round(c.score)} of 100`)
      summary.append(label, meter, make('span', 'tf-category-score', c.score === null ? '—' : String(Math.round(c.score))))
      row.append(summary)
      if (c.metrics.length) {
        const list = make('ul', 'tf-metrics')
        for (const m of c.metrics) {
          const item = make('li')
          const dot = make('i', tone(m.score * 100))
          dot.setAttribute('aria-hidden', 'true')
          item.append(dot, make('span', '', m.label), make('b', '', m.value))
          list.append(item)
        }
        row.append(list)
      } else row.append(make('p', 'tf-muted', c.id === 'operations' || c.id === 'landing' || c.id === 'approach' ? 'Land and come to a stop to have this scored.' : 'Not enough flying to score this.'))
      categories.append(row)
    }
    card.append(make('h3', '', 'Score'), categories)

    this.graph = null
    if (score.graph) {
      const figure = make('figure', 'tf-graph')
      this.canvas = make('canvas')
      this.canvas.setAttribute('role', 'img')
      this.canvas.setAttribute('aria-label', 'Height and vertical speed over the last 30 seconds before touchdown')
      const legend = make('figcaption')
      legend.append(make('span', 'tf-key height', 'Height (ft)'), make('span', 'tf-key vs', 'Vertical speed (fpm)'), make('span', 'tf-key touch', 'Touchdown'))
      figure.append(this.canvas, legend)
      card.append(make('h3', '', 'Touchdown graph'), figure)
      const range = score.graph
      const touchdown = score.landing ? score.landing.tick : 0
      this.graph = () => this.canvas && drawGraph(this.canvas, telemetry, range.from, range.to, touchdown)
    }

    const tips = make('ul', 'tf-tips')
    for (const tip of score.tips) tips.append(make('li', '', tip))
    card.append(make('h3', '', 'Tips'), tips)

    const footer = make('div', 'tf-debrief-foot')
    this.recordLine = make('small', 'tf-muted', 'Compressing the flight record…')
    this.recordButton = button('Download record', () => this.download(), 'tf-btn small')
    this.recordButton.disabled = true
    footer.append(make('small', 'tf-muted', `Fuel used ${score.fuelUsed.toFixed(1)} kg`), this.recordLine, this.recordButton)
    card.append(footer)

    const actions = make('div', 'tf-row tf-debrief-actions')
    if (score.landing) actions.append(button('Watch touchdown', () => this.handlers.replay(), 'tf-btn primary'))
    if (options.canContinue) actions.append(button('Keep flying', () => this.handlers.continueFlight()))
    actions.append(button('Fly again', () => this.handlers.again(), score.landing ? 'tf-btn' : 'tf-btn primary'), button('Change flight', () => this.handlers.change()))
    card.append(actions)
    this.reveal()
  }

  /** Shows the debrief built by the last `show` again (after the replay). */
  reveal(): void {
    this.bar.hidden = true
    this.screen.hidden = false
    ;(this.card.querySelector('.tf-debrief-actions .tf-btn') as HTMLButtonElement | null)?.focus({ preventScroll: true })
    this.screen.scrollTop = 0
    requestAnimationFrame(() => this.graph?.())
  }

  /** Fills the career block once the flight has been added to the career. */
  setCareer(node: HTMLElement): void {
    this.careerNode?.replaceChildren(node)
  }

  setRecord(bytes: Uint8Array | null, raw: number): void {
    if (!this.recordLine || !this.recordButton) return
    if (!bytes) {
      this.recordLine.textContent = 'Flight record unavailable on this browser'
      return
    }
    this.clearRecord()
    this.recordUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
    this.recordLine.textContent = `Flight record ${formatBytes(bytes.length)} (from ${formatBytes(raw)})`
    this.recordButton.disabled = false
  }

  private download(): void {
    if (!this.recordUrl) return
    const link = document.createElement('a')
    link.href = this.recordUrl
    link.download = `take-flight-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.tfr`
    link.click()
  }

  private clearRecord(): void {
    if (this.recordUrl) URL.revokeObjectURL(this.recordUrl)
    this.recordUrl = null
  }

  showReplay(): void {
    this.screen.hidden = true
    this.bar.hidden = false
  }

  updateReplay(progress: number, clock: number, speed: number): void {
    this.barProgress.style.width = `${Math.round(progress * 100)}%`
    const text = `Touchdown replay · ${speed < 1 ? '½ speed' : 'full speed'} · ${clock < 0 ? `T${clock.toFixed(1)} s` : `T+${clock.toFixed(1)} s`}`
    if (this.barLabel.textContent !== text) this.barLabel.textContent = text
    const label = speed < 1 ? 'Full speed' : 'Half speed'
    if (this.speedButton.textContent !== label) this.speedButton.textContent = label
  }

  hide(): void {
    this.screen.hidden = true
    this.bar.hidden = true
  }

  dispose(): void {
    removeEventListener('resize', this.onResize)
    this.clearRecord()
    this.screen.remove()
    this.bar.remove()
  }
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`
}

function formatBytes(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function niceStep(raw: number): number {
  for (const step of [5, 10, 25, 50, 100, 125, 250, 500, 1000, 2500, 5000]) if (step >= raw) return step
  return Math.ceil(raw / 5000) * 5000
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function drawGraph(canvas: HTMLCanvasElement, t: Float32Array, from: number, to: number, touchdownTick: number): void {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width === 0 || height === 0 || to - from < 2) return
  const ratio = Math.min(2, devicePixelRatio || 1)
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  const g = canvas.getContext('2d')
  if (!g) return
  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  g.clearRect(0, 0, width, height)
  const pad = { l: 44, r: 50, t: 10, b: 22 }
  const w = width - pad.l - pad.r
  const h = height - pad.t - pad.b
  const at = (i: number) => t[i * CHANNELS + CH.tick]
  let maxHeight = 10
  let minVs = -200
  let maxVs = 200
  for (let i = from; i < to; i++) {
    const agl = Math.max(0, t[i * CHANNELS + CH.agl] - 1.25) / FOOT
    const vs = t[i * CHANNELS + CH.verticalSpeed] / FPM
    if (agl > maxHeight) maxHeight = agl
    if (vs < minVs) minVs = vs
    if (vs > maxVs) maxVs = vs
  }
  const heightStep = niceStep(maxHeight / 4)
  maxHeight = heightStep * 4
  let vsStep = niceStep((maxVs - minVs) / 4)
  while (Math.floor(minVs / vsStep) * vsStep + vsStep * 4 < maxVs) vsStep = niceStep(vsStep * 1.01)
  minVs = Math.floor(minVs / vsStep) * vsStep
  maxVs = minVs + vsStep * 4
  const t0 = at(from)
  const t1 = at(to - 1)
  const x = (tick: number) => pad.l + ((tick - t0) / Math.max(1, t1 - t0)) * w
  const yHeight = (feet: number) => pad.t + h - (feet / maxHeight) * h
  const yVs = (fpm: number) => pad.t + h - ((fpm - minVs) / (maxVs - minVs)) * h
  const line = cssColor('--tf-line', 'rgba(255,255,255,0.12)')
  const muted = cssColor('--tf-muted', '#9aa6b2')
  g.font = '11px Inter, system-ui, sans-serif'
  g.strokeStyle = line
  g.fillStyle = muted
  g.lineWidth = 1
  for (let k = 0; k <= 4; k++) {
    const y = pad.t + (h * k) / 4
    g.beginPath()
    g.moveTo(pad.l, y)
    g.lineTo(pad.l + w, y)
    g.stroke()
    g.textAlign = 'right'
    g.fillText(String(Math.round(maxHeight * (1 - k / 4))), pad.l - 6, y + 4)
    g.textAlign = 'left'
    g.fillText(String(Math.round(maxVs - ((maxVs - minVs) * k) / 4)), pad.l + w + 6, y + 4)
  }
  g.textAlign = 'center'
  for (let s = -30; s <= 10; s += 5) {
    const tick = touchdownTick + s * 120
    if (tick < t0 || tick > t1) continue
    g.fillText(`${s > 0 ? '+' : ''}${s}s`, x(tick), height - 6)
  }
  const series = (channel: number, map: (value: number) => number, color: string) => {
    g.strokeStyle = color
    g.lineWidth = 2
    g.beginPath()
    for (let i = from; i < to; i++) {
      const px = x(at(i))
      const py = map(t[i * CHANNELS + channel])
      if (i === from) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.stroke()
  }
  if (minVs < 0 && maxVs > 0) {
    g.strokeStyle = line
    g.setLineDash([4, 4])
    g.beginPath()
    g.moveTo(pad.l, yVs(0))
    g.lineTo(pad.l + w, yVs(0))
    g.stroke()
    g.setLineDash([])
  }
  series(CH.agl, (agl) => yHeight(Math.max(0, agl - 1.25) / FOOT), cssColor('--tf-accent', '#5cc8ff'))
  series(CH.verticalSpeed, (vs) => yVs(vs / FPM), cssColor('--tf-warn', '#f0b429'))
  if (touchdownTick >= t0 && touchdownTick <= t1) {
    g.strokeStyle = cssColor('--tf-good', '#45c46f')
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(x(touchdownTick), pad.t)
    g.lineTo(x(touchdownTick), pad.t + h)
    g.stroke()
  }
}
