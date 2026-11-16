import { BASE_STRIPS, FREE_STRIPS, PAYLINES, REEL_COIN_PRIZES, RESPIN_COIN_PRIZES, REELS, ROWS, Sym, ZONE_MULTIPLIERS, ZONE_RECTS, type CoinPrize, type WeightedTable, type ZoneRect } from '../engine/paytable'
import { prizeValue, type Cell, type CellRef, type Grid, type LineWin, type SpinResult } from '../engine/slotEngine'
import { formatShort } from '../format'
import { AtlasCell, BAR_UV, cellUv } from './atlas'
import { EMBER, GOLD, JADE, ParticleEmitter, VIOLET, type Color } from './particles'
import { ReelStrip, type TapeCell } from './reelStrip'
import { SpriteBatch } from './spriteBatch'
import { MAX_WINDOWS, type FrameData, type ReelWindowData } from './webgpuRenderer'

export type Theme = 'base' | 'free' | 'respin'
export type Point = { x: number; y: number }

export interface Layout {
  width: number
  height: number
  cell: number
  gap: number
  gridX: number
  gridY: number
  gridW: number
  gridH: number
}

export interface ReelSpinHooks {
  turbo: boolean
  onReelStop: (reel: number, column: readonly Cell[]) => void
  onAnticipation: (active: boolean, reason: 'scatter' | 'coin') => void
}

export interface CellSpinHooks {
  turbo: boolean
  onCellStop: (reel: number, row: number, cell: Cell, isNew: boolean) => void
}

interface Timer {
  at: number
  skippable: boolean
  resolve: () => void
}

interface Flight {
  from: Point
  to: Point
  start: number
  duration: number
  visual: TapeCell
  size: number
  progress: number
  resolve: () => void
}

interface FloatText {
  text: string
  x: number
  y: number
  start: number
  duration: number
  height: number
  color: Color
}

interface Highlight {
  cells: CellRef[]
  color: Color
  start: number
  until: number
}

interface LineShow {
  lines: LineWin[]
  start: number
  allFor: number
}

interface Expansion {
  from: { x: number; y: number; w: number; h: number }
  to: { x: number; y: number; w: number; h: number }
  start: number
  size: number
  value: number
}

interface ZoneState {
  visible: boolean
  level: number
  from: { x: number; y: number; w: number; h: number }
  to: { x: number; y: number; w: number; h: number }
  start: number
  appear: number
}

const LINE_COLORS: readonly Color[] = [
  [1, 0.85, 0.3, 1], [0.35, 0.85, 1, 1], [1, 0.4, 0.55, 1], [0.5, 1, 0.55, 1], [0.85, 0.55, 1, 1],
  [1, 0.6, 0.25, 1], [0.4, 1, 0.9, 1], [1, 0.95, 0.6, 1], [0.6, 0.7, 1, 1], [1, 0.5, 0.9, 1],
]

const THEME_TINT: Record<Theme, [number, number, number]> = {
  base: [1, 1, 1],
  free: [0.78, 0.7, 1.2],
  respin: [0.42, 0.38, 0.5],
}

const REEL_CURVE = 0.5
const CELL_CURVE = 0.2
const pickWeighted = <T,>(table: WeightedTable<T>): T => {
  let total = 0
  for (const weight of table.weights) total += weight
  let roll = Math.random() * total
  for (let index = 0; index < table.items.length; index++) {
    roll -= table.weights[index]
    if (roll < 0) return table.items[index]
  }
  return table.items[table.items.length - 1]
}

export function prizeCell(prize: CoinPrize): number {
  if (prize.kind === 'cash') return Sym.Coin
  if (prize.tier === 'mini') return AtlasCell.CoinMini
  if (prize.tier === 'minor') return AtlasCell.CoinMinor
  return AtlasCell.CoinMajor
}

export function visualCell(cell: Cell, respin: boolean): TapeCell {
  if (cell.sym === Sym.Coin && cell.prize) {
    return cell.prize.kind === 'cash' ? { cell: Sym.Coin, value: cell.value } : { cell: prizeCell(cell.prize), value: 0 }
  }
  if (cell.sym === Sym.Sphinx) return { cell: Sym.Sphinx, value: respin ? cell.value : 0 }
  if (respin) return { cell: AtlasCell.Blank, value: 0 }
  return { cell: cell.sym, value: 0 }
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export class Scene {
  layout: Layout = { width: 1, height: 1, cell: 1, gap: 0, gridX: 0, gridY: 0, gridW: 1, gridH: 1 }
  strips: ReelStrip[] = []
  stripMode: 'reels' | 'cells' = 'reels'
  theme: Theme = 'base'
  bet = 100
  time = 0
  readonly particles = new ParticleEmitter()
  private readonly back = new SpriteBatch(8)
  private readonly under = new SpriteBatch(256)
  private readonly over = new SpriteBatch(1024)
  private readonly top = new SpriteBatch(512)
  private readonly slots = new Uint32Array(MAX_WINDOWS * 8)
  private readonly windows: ReelWindowData[] = []
  private timers: Timer[] = []
  private hurrying = false
  private tint: [number, number, number] = [1, 1, 1]
  private flights: Flight[] = []
  private floats: FloatText[] = []
  private highlights: Highlight[] = []
  private lineShow: LineShow | null = null
  private anticipationReel: number | null = null
  private celebrateUntil = 0
  private celebrateLevel = 0
  private moteClock = 0
  private zone: ZoneState = { visible: false, level: 0, from: { x: 0, y: 0, w: 0, h: 0 }, to: { x: 0, y: 0, w: 0, h: 0 }, start: 0, appear: 0 }
  private shake = 0
  private expansions: Expansion[] = []

  constructor() {
    this.buildReelStrips()
  }

  resize(width: number, height: number): void {
    const gapRatio = 0.045
    const cell = Math.max(24, Math.min((width * 0.9) / (REELS + (REELS - 1) * gapRatio), (height * 0.8) / ROWS))
    const gap = cell * gapRatio
    const gridW = REELS * cell + (REELS - 1) * gap
    const gridH = ROWS * cell
    this.layout = { width, height, cell, gap, gridW, gridH, gridX: (width - gridW) / 2, gridY: (height - gridH) / 2 + height * 0.015 }
    this.particles.scale = cell / 180
    this.positionStrips()
    if (this.zone.visible) {
      const rect = this.zoneRect(this.zone.level)
      this.zone.from = rect
      this.zone.to = rect
    }
  }

  cellRect(reel: number, row: number): { x: number; y: number; w: number; h: number } {
    const { gridX, gridY, cell, gap } = this.layout
    return { x: gridX + reel * (cell + gap), y: gridY + row * cell, w: cell, h: cell }
  }

  cellCenter(reel: number, row: number): Point {
    const rect = this.cellRect(reel, row)
    if (this.stripMode === 'reels' && this.strips[reel]) {
      const { y } = this.strips[reel].screenY(row + 0.5)
      return { x: rect.x + rect.w / 2, y }
    }
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  }

  meterPoint(): Point {
    return { x: this.layout.width / 2, y: this.layout.height + this.layout.cell * 0.2 }
  }

  private stripFor(reel: number, row: number): { strip: ReelStrip; row: number } {
    if (this.stripMode === 'reels') return { strip: this.strips[reel], row }
    return { strip: this.strips[reel * ROWS + row], row: 0 }
  }

  visibleAt(reel: number, row: number): TapeCell {
    const { strip, row: stripRow } = this.stripFor(reel, row)
    return strip.visible(stripRow)
  }

  setCellValue(reel: number, row: number, value: number): void {
    const { strip, row: stripRow } = this.stripFor(reel, row)
    strip.setValue(stripRow, value)
  }

  private randomReelCell(reel: number): TapeCell {
    const strips = this.theme === 'free' ? FREE_STRIPS : BASE_STRIPS
    const strip = strips[reel]
    const sym = strip[Math.floor(Math.random() * strip.length)]
    if (sym === Sym.Coin) {
      const prize = pickWeighted(REEL_COIN_PRIZES)
      return { cell: prizeCell(prize), value: prize.kind === 'cash' ? prizeValue(prize, this.bet) : 0 }
    }
    return { cell: sym, value: 0 }
  }

  private randomRespinCell(): TapeCell {
    const roll = Math.random()
    if (roll < 0.1) {
      const prize = pickWeighted(RESPIN_COIN_PRIZES)
      return { cell: prizeCell(prize), value: prize.kind === 'cash' ? prizeValue(prize, this.bet) : 0 }
    }
    if (roll < 0.12) return { cell: Sym.Sphinx, value: 0 }
    return { cell: AtlasCell.Blank, value: 0 }
  }

  private buildReelStrips(columns?: readonly (readonly TapeCell[])[]): void {
    this.stripMode = 'reels'
    this.strips = Array.from({ length: REELS }, (_, reel) => {
      const strip = new ReelStrip(ROWS, REEL_CURVE, false, () => this.randomReelCell(reel))
      strip.setCells(columns?.[reel] ?? Array.from({ length: ROWS }, () => this.randomReelCell(reel)))
      return strip
    })
    this.positionStrips()
  }

  private positionStrips(): void {
    const { gridY, gridH, cell } = this.layout
    if (this.stripMode === 'reels') {
      this.strips.forEach((strip, reel) => {
        const rect = this.cellRect(reel, 0)
        strip.rect = { x: rect.x, y: gridY, w: cell, h: gridH }
      })
      return
    }
    this.strips.forEach((strip, index) => {
      const rect = this.cellRect(Math.floor(index / ROWS), index % ROWS)
      const inset = cell * 0.035
      strip.rect = { x: rect.x + inset, y: rect.y + inset, w: rect.w - inset * 2, h: rect.h - inset * 2 }
    })
  }

  showGrid(grid: Grid): void {
    this.buildReelStrips(grid.map((column) => column.map((cell) => visualCell(cell, false))))
  }

  setTheme(theme: Theme): void {
    this.theme = theme
  }

  wait(seconds: number, skippable = false): Promise<void> {
    if (skippable && this.hurrying) return Promise.resolve()
    return new Promise((resolve) => this.timers.push({ at: this.time + seconds, skippable, resolve }))
  }

  hurry(): void {
    this.hurrying = true
    const skipped = this.timers.filter((timer) => timer.skippable)
    this.timers = this.timers.filter((timer) => !timer.skippable)
    for (const timer of skipped) timer.resolve()
  }

  get isHurrying(): boolean {
    return this.hurrying
  }

  resetHurry(): void {
    this.hurrying = false
  }

  clearEffects(): void {
    this.expansions = []
    this.highlights = []
    this.lineShow = null
    this.floats = []
    for (const strip of this.strips) strip.dimMask = 0
  }

  async spinReels(result: SpinResult, hooks: ReelSpinHooks): Promise<void> {
    if (this.stripMode !== 'reels') this.buildReelStrips()
    this.clearEffects()
    const turbo = hooks.turbo
    const speed = turbo ? 34 : 25
    const columns = result.grid.map((column) => column.map((cell) => visualCell(cell, false)))
    this.strips.forEach((strip, reel) => {
      strip.maxSpeed = speed
      strip.start(reel * (turbo ? 0.02 : 0.05))
    })
    const landings: Promise<void>[] = []
    await this.wait(turbo ? 0.3 : 0.62, true)
    for (let reel = 0; reel < REELS; reel++) {
      if (reel > 0) await this.wait(turbo ? 0.08 : 0.19, true)
      const anticipation = result.anticipation
      if (reel === REELS - 1 && anticipation && !this.hurrying) {
        await landings[reel - 1]
        this.anticipationReel = reel
        this.strips[reel].maxSpeed = speed * 1.4
        hooks.onAnticipation(true, anticipation.reason)
        await this.wait(turbo ? 1.6 : 2.5, true)
        this.anticipationReel = null
        hooks.onAnticipation(false, anticipation.reason)
      }
      const column = result.grid[reel]
      landings.push(this.strips[reel].stop(columns[reel], () => {
        hooks.onReelStop(reel, column)
        this.landEffects(reel, column, false)
      }))
    }
    await Promise.all(landings)
  }

  private landEffects(reel: number, column: readonly Cell[], respin: boolean): void {
    column.forEach((cell, row) => {
      const point = this.cellCenter(reel, respin ? 0 : row)
      if (cell.sym === Sym.Scatter) this.particles.stars(point.x, point.y, 14, VIOLET)
      else if (cell.sym === Sym.Coin) this.particles.sparks(point.x, point.y, 10, GOLD, 260)
      else if (cell.sym === Sym.Sphinx) this.particles.scarabs(point.x, point.y, 10)
    })
  }

  async enterCells(grid: Grid, held: readonly (readonly boolean[])[]): Promise<void> {
    this.clearEffects()
    this.stripMode = 'cells'
    this.strips = []
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) {
        const strip = new ReelStrip(1, CELL_CURVE, true, () => this.randomRespinCell())
        strip.setCells([visualCell(grid[reel][row], true)])
        strip.held = held[reel][row]
        strip.targetTint = strip.held ? [1, 1, 1] : [0.62, 0.58, 0.55]
        this.strips.push(strip)
      }
    }
    this.positionStrips()
    this.theme = 'respin'
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) {
        if (!held[reel][row]) continue
        const point = this.cellCenter(reel, row)
        this.particles.sparks(point.x, point.y, 16, GOLD, 360)
      }
    }
    this.shake = 0.35
    await this.wait(0.55)
  }

  async spinCells(result: SpinResult, hooks: CellSpinHooks): Promise<void> {
    if (this.stripMode !== 'cells' || !result.heldBefore || !result.respin) return
    const heldBefore = result.heldBefore
    const respin = result.respin
    const turbo = hooks.turbo
    const order: number[] = []
    for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) if (!heldBefore[reel][row]) order.push(reel * ROWS + row)
    order.forEach((index, k) => {
      const strip = this.strips[index]
      strip.maxSpeed = turbo ? 30 : 22
      strip.start(k * 0.012)
    })
    await this.wait(turbo ? 0.28 : 0.55, true)
    const landings: Promise<void>[] = []
    for (let k = 0; k < order.length; k++) {
      if (k > 0) await this.wait(turbo ? 0.035 : 0.08, true)
      const index = order[k]
      const reel = Math.floor(index / ROWS)
      const row = index % ROWS
      const cell = result.grid[reel][row]
      const strip = this.strips[index]
      const isNew = respin.newCells.some(([r, w]) => r === reel && w === row)
      landings.push(strip.stop([visualCell(cell, true)], () => {
        if (isNew) {
          strip.held = true
          strip.targetTint = [1, 1, 1]
          this.landEffects(reel, [cell], true)
          const point = this.cellCenter(reel, row)
          this.particles.sparks(point.x, point.y, 18, cell.sym === Sym.Sphinx ? JADE : GOLD, 380)
        }
        hooks.onCellStop(reel, row, cell, isNew)
      }))
    }
    await Promise.all(landings)
  }

  async exitCells(grid: Grid): Promise<void> {
    const columns = grid.map((column, reel) => column.map((cell) => (cell.sym === Sym.Coin || cell.sym === Sym.Sphinx ? visualCell(cell, false) : this.randomReelCell(reel))))
    this.clearEffects()
    this.buildReelStrips(columns)
    this.shake = 0.2
    await this.wait(0.3)
  }

  showLines(lines: readonly LineWin[], allFor: number): void {
    if (lines.length === 0) return
    this.lineShow = { lines: [...lines], start: this.time, allFor }
  }

  highlight(cells: readonly CellRef[], color: Color, duration: number): void {
    this.highlights.push({ cells: [...cells], color, start: this.time, until: this.time + duration })
  }

  floatText(text: string, at: Point, height: number, color: Color = GOLD, duration = 1.4): void {
    this.floats.push({ text, x: at.x, y: at.y, start: this.time, duration, height, color })
  }

  fly(from: Point, to: Point, visual: TapeCell, duration: number, sizeScale = 0.62): Promise<void> {
    return new Promise((resolve) => {
      this.flights.push({ from, to, start: this.time, duration, visual: { ...visual }, size: this.layout.cell * sizeScale, progress: 0, resolve })
    })
  }

  burst(at: Point, kind: 'gold' | 'jade' | 'violet' | 'stars' | 'scarab', amount = 1): void {
    const n = Math.round(18 * amount)
    if (kind === 'gold') this.particles.sparks(at.x, at.y, n, GOLD, 420)
    else if (kind === 'jade') this.particles.sparks(at.x, at.y, n, JADE, 420)
    else if (kind === 'violet') this.particles.sparks(at.x, at.y, n, VIOLET, 420)
    else if (kind === 'scarab') this.particles.scarabs(at.x, at.y, n)
    else this.particles.stars(at.x, at.y, n, GOLD)
  }

  sandStorm(): void {
    const { gridX, gridY, gridW, gridH } = this.layout
    this.particles.sandStorm(gridX - gridW * 0.05, gridY + gridH * 0.2, gridW * 1.1, gridH * 0.9, 60)
    this.shake = 0.5
  }

  coinFountain(count = 60): void {
    const { width, height } = this.layout
    this.particles.coinFountain(width * 0.5, height + 10, count, 1.4)
  }

  celebrate(level: number, duration: number): void {
    this.celebrateLevel = Math.max(this.celebrateLevel, level)
    this.celebrateUntil = Math.max(this.celebrateUntil, this.time + duration)
  }

  stopCelebration(): void {
    this.celebrateUntil = 0
    this.celebrateLevel = 0
  }

  zoneRect(level: number): { x: number; y: number; w: number; h: number } {
    return this.areaRect(ZONE_RECTS[Math.max(0, Math.min(ZONE_RECTS.length - 1, level))])
  }

  areaRect(rect: ZoneRect): { x: number; y: number; w: number; h: number } {
    const a = this.cellRect(rect.reel, rect.row)
    const b = this.cellRect(rect.reel + rect.width - 1, rect.row + rect.height - 1)
    return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y }
  }

  expand(collector: CellRef, area: ZoneRect, size: number): number {
    const start = this.cellRect(collector[0], collector[1])
    const to = this.areaRect(area)
    this.expansions.push({ from: start, to, start: this.time, size, value: 0 })
    this.particles.sandStorm(to.x, to.y, to.w, to.h, 40)
    this.particles.scarabs(to.x + to.w / 2, to.y + to.h / 2, 20)
    this.shake = 0.45
    return this.expansions.length - 1
  }

  expansionCenter(index: number): Point {
    const expansion = this.expansions[index]
    if (!expansion) return { x: 0, y: 0 }
    return { x: expansion.to.x + expansion.to.w / 2, y: expansion.to.y + expansion.to.h / 2 }
  }

  setExpansionValue(index: number, value: number): void {
    const expansion = this.expansions[index]
    if (expansion) expansion.value = value
  }

  setZone(level: number, visible: boolean): void {
    const target = this.zoneRect(level)
    if (!visible) {
      this.zone.visible = false
      return
    }
    if (!this.zone.visible) {
      this.zone = { visible: true, level, from: target, to: target, start: this.time, appear: this.time }
      return
    }
    this.zone = { ...this.zone, level, from: this.currentZoneRect(), to: target, start: this.time }
    const center = { x: target.x + target.w / 2, y: target.y + target.h / 2 }
    this.particles.scarabs(center.x, center.y, 24)
    this.shake = 0.25
  }

  private currentZoneRect(): { x: number; y: number; w: number; h: number } {
    const t = Math.min(1, (this.time - this.zone.start) / 0.7)
    const k = easeOutBack(t)
    const { from, to } = this.zone
    return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), w: lerp(from.w, to.w, k), h: lerp(from.h, to.h, k) }
  }

  update(dt: number): FrameData {
    this.time += dt
    const due = this.timers.filter((timer) => timer.at <= this.time)
    if (due.length > 0) {
      this.timers = this.timers.filter((timer) => timer.at > this.time)
      for (const timer of due) timer.resolve()
    }
    for (const strip of this.strips) strip.update(dt)
    const target = THEME_TINT[this.theme]
    for (let k = 0; k < 3; k++) this.tint[k] += (target[k] - this.tint[k]) * Math.min(1, dt * 2.5)
    this.shake = Math.max(0, this.shake - dt)
    this.updateFlights(dt)
    this.highlights = this.highlights.filter((highlight) => highlight.until > this.time)
    this.floats = this.floats.filter((float) => this.time - float.start < float.duration)
    this.emitAmbient(dt)
    this.applyFocus()

    this.back.clear()
    this.under.clear()
    this.over.clear()
    this.top.clear()
    this.drawBackdrop()
    this.drawFrame()
    this.collectWindows()
    this.drawZone()
    this.drawLines()
    this.drawHighlights()
    this.drawValues()
    this.drawExpansions()
    this.drawHeldFrames()
    this.drawAnticipation()
    this.drawFlights()
    this.drawFloats()
    return { time: this.time, dt, back: this.back, under: this.under, windows: this.windows, over: this.over, top: this.top, spawns: this.particles.drain() }
  }

  private updateFlights(dt: number): void {
    const arrived: Flight[] = []
    for (const flight of this.flights) {
      flight.progress += (dt / flight.duration) * (this.hurrying ? 3 : 1)
      if (flight.progress >= 1) arrived.push(flight)
      else if (Math.random() < 0.7) {
        const point = this.flightPoint(flight, flight.progress)
        this.particles.ember(point.x, point.y, GOLD)
      }
    }
    if (arrived.length === 0) return
    this.flights = this.flights.filter((flight) => flight.progress < 1)
    for (const flight of arrived) {
      this.particles.sparks(flight.to.x, flight.to.y, 12, GOLD, 300)
      flight.resolve()
    }
  }

  private flightPoint(flight: Flight, t: number): Point {
    const k = easeOutCubic(Math.min(1, t))
    const mid = { x: (flight.from.x + flight.to.x) / 2, y: Math.min(flight.from.y, flight.to.y) - this.layout.cell * 0.9 }
    const a = 1 - k
    return { x: a * a * flight.from.x + 2 * a * k * mid.x + k * k * flight.to.x, y: a * a * flight.from.y + 2 * a * k * mid.y + k * k * flight.to.y }
  }

  private emitAmbient(dt: number): void {
    const { width, height, gridX, gridY, gridW, gridH } = this.layout
    this.moteClock += dt
    while (this.moteClock > 0.18) {
      this.moteClock -= 0.18
      this.particles.mote(width, height)
    }
    if (this.time < this.celebrateUntil) {
      const rate = 8 + this.celebrateLevel * 10
      const count = Math.floor(rate * dt + Math.random())
      for (let k = 0; k < count; k++) {
        const side = Math.random() < 0.5 ? 0.15 : 0.85
        this.particles.coinFountain(width * side, height + 10, 1, 0.8)
      }
      if (Math.random() < dt * (3 + this.celebrateLevel * 2)) this.particles.stars(gridX + Math.random() * gridW, gridY + Math.random() * gridH, 12, GOLD)
    }
    if (this.anticipationReel !== null) {
      const rect = this.strips[this.anticipationReel]?.rect
      if (rect) {
        for (let k = 0; k < 3; k++) {
          const onLeft = Math.random() < 0.5
          this.particles.ember(onLeft ? rect.x : rect.x + rect.w, rect.y + Math.random() * rect.h, EMBER)
        }
      }
    }
    if (this.zone.visible && this.stripMode === 'reels' && Math.random() < dt * 4) {
      const rect = this.currentZoneRect()
      this.particles.ember(rect.x + Math.random() * rect.w, rect.y + rect.h, JADE)
    }
  }

  private focusCells(): CellRef[] | null {
    const show = this.lineShow
    if (show) {
      const elapsed = this.time - show.start
      if (elapsed < show.allFor || show.lines.length === 1) return show.lines.flatMap((line) => line.cells)
      const index = Math.floor((elapsed - show.allFor) / 1.1) % show.lines.length
      return show.lines[index].cells
    }
    if (this.highlights.length > 0) return this.highlights.flatMap((highlight) => highlight.cells)
    return null
  }

  private applyFocus(): void {
    if (this.stripMode !== 'reels') return
    const focus = this.focusCells()
    this.strips.forEach((strip, reel) => {
      if (!focus || strip.spinning) {
        strip.dimMask = 0
        return
      }
      let mask = 0
      for (let row = 0; row < ROWS; row++) if (!focus.some(([r, w]) => r === reel && w === row)) mask |= 1 << row
      strip.dimMask = mask
    })
  }

  private drawBackdrop(): void {
    const { width, height } = this.layout
    const size = Math.max(width, height) * (1.06 + Math.sin(this.time * 0.07) * 0.015)
    const sx = Math.sin(this.time * 0.11) * width * 0.008
    this.back.quad(width / 2 + sx, height / 2, size / 2, size / 2, [0, 0, 1, 1], { color: [this.tint[0], this.tint[1], this.tint[2], 1] })
  }

  private shakeOffset(): Point {
    if (this.shake <= 0) return { x: 0, y: 0 }
    const amount = this.shake * this.layout.cell * 0.04
    return { x: Math.sin(this.time * 71) * amount, y: Math.cos(this.time * 53) * amount }
  }

  private drawFrame(): void {
    const { gridX, gridY, gridW, gridH, cell, gap } = this.layout
    const offset = this.shakeOffset()
    const x = gridX + offset.x
    const y = gridY + offset.y
    const u = this.under
    u.cell(AtlasCell.Glow, x + gridW / 2, y + gridH / 2, Math.max(gridW, gridH) * 1.5, { color: [0, 0, 0, 0.75] })
    const pad = cell * 0.07
    u.rect(x - pad, y - pad, gridW + pad * 2, gridH + pad * 2, [0.06, 0.035, 0.02, 1])
    const band = cell * 0.2
    const glow: Color = this.theme === 'free' ? [0.75, 0.45, 1, 0.55] : this.theme === 'respin' ? [0.4, 1, 0.6, 0.45] : [1, 0.7, 0.3, 0.35]
    const pulse = 0.7 + 0.3 * Math.sin(this.time * 2.2)
    u.frame(x - pad, y - pad, gridW + pad * 2, gridH + pad * 2, cell * 0.12, [glow[0], glow[1], glow[2], glow[3] * pulse], 1)
    const pillar = cell * 0.11
    u.quad(x - pad - pillar / 2, y + gridH / 2, gridH / 2 + pad, pillar / 2, BAR_UV, { rotation: Math.PI / 2 })
    u.quad(x + gridW + pad + pillar / 2, y + gridH / 2, gridH / 2 + pad, pillar / 2, BAR_UV, { rotation: -Math.PI / 2 })
    u.band(x - pad - pillar, y - pad - band, gridW + (pad + pillar) * 2, band)
    u.band(x - pad - pillar, y + gridH + pad, gridW + (pad + pillar) * 2, band)
    for (let reel = 1; reel < REELS; reel++) {
      const sx = x + reel * (cell + gap) - gap / 2
      u.rect(sx - gap * 0.18, y, gap * 0.36, gridH, [0.85, 0.62, 0.22, 1])
    }
    for (const [cx, cy] of [[x - pad - pillar / 2, y - pad - band / 2], [x + gridW + pad + pillar / 2, y - pad - band / 2], [x - pad - pillar / 2, y + gridH + pad + band / 2], [x + gridW + pad + pillar / 2, y + gridH + pad + band / 2]]) {
      u.cell(AtlasCell.Glow, cx, cy, band * 2.4, { color: [glow[0], glow[1], glow[2], 0.7 * pulse], additive: 1 })
      u.cell(Sym.Ankh, cx, cy, band * 1.6, { shimmer: 1 })
    }
  }

  private collectWindows(): void {
    const offset = this.shakeOffset()
    this.windows.length = 0
    this.strips.slice(0, MAX_WINDOWS).forEach((strip, index) => {
      const frac = strip.slots(this.slots, index * 8)
      this.windows.push({
        x: strip.rect.x + offset.x,
        y: strip.rect.y + offset.y,
        w: strip.rect.w,
        h: strip.rect.h,
        rows: strip.rows,
        curve: strip.curve,
        frac,
        blur: strip.blur,
        tint: strip.tint,
        dimMask: strip.dimMask,
        respinStyle: strip.respinStyle,
        slots: this.slots,
        slotOffset: index * 8,
      })
    })
  }

  private drawValues(): void {
    const { cell } = this.layout
    const offset = this.shakeOffset()
    for (const strip of this.strips) {
      const fade = 1 - Math.min(1, strip.blur * 1.8)
      if (fade <= 0.02) continue
      const cellH = strip.rect.h / strip.rows
      strip.forEachVisible((visual, center) => {
        if (visual.value <= 0) return
        if (visual.cell !== Sym.Coin && visual.cell !== Sym.Sphinx) return
        const edge = Math.min(center, strip.rows - center)
        const alpha = fade * Math.min(1, edge * 2.4)
        if (alpha <= 0.02) return
        const { y, scale } = strip.screenY(center)
        const x = strip.rect.x + strip.rect.w / 2 + offset.x
        const text = formatShort(visual.value)
        if (visual.cell === Sym.Coin) {
          this.over.text(text, x, y + offset.y + cellH * 0.03 * scale, cellH * 0.27 * scale, { color: [1, 1, 1, alpha] }, cell * 0.58)
        } else {
          this.over.rect(x - cell * 0.36, y + offset.y + cellH * 0.25 * scale, cell * 0.72, cellH * 0.2 * scale, [0.02, 0.1, 0.04, 0.85 * alpha])
          this.over.text(text, x, y + offset.y + cellH * 0.35 * scale, cellH * 0.18 * scale, { color: [1, 1, 1, alpha] }, cell * 0.68)
        }
      })
    }
  }

  private drawExpansions(): void {
    if (this.stripMode !== 'reels') return
    const { cell } = this.layout
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 4)
    for (const expansion of this.expansions) {
      const t = Math.min(1, (this.time - expansion.start) / 0.6)
      const k = easeOutBack(t)
      const r = {
        x: lerp(expansion.from.x, expansion.to.x, k),
        y: lerp(expansion.from.y, expansion.to.y, k),
        w: lerp(expansion.from.w, expansion.to.w, k),
        h: lerp(expansion.from.h, expansion.to.h, k),
      }
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2
      const side = Math.min(r.w, r.h)
      this.over.cell(AtlasCell.Glow, cx, cy, Math.max(r.w, r.h) * 1.5, { color: [0.4, 1, 0.6, 0.35 * pulse], additive: 1 })
      this.over.rect(r.x, r.y, r.w, r.h, [0.02, 0.07, 0.03, 0.97])
      this.over.cell(Sym.Sphinx, cx, cy, side * 1.0, { shimmer: 0.35 })
      this.over.glowFrame(r.x, r.y, r.w, r.h, cell * 0.03, [0.5, 1, 0.65, 0.9])
      if (t < 1) continue
      this.over.rect(r.x + cell * 0.06, r.y + cell * 0.06, cell * 0.5, cell * 0.26, [0.02, 0.15, 0.06, 0.92])
      this.over.text(`×${expansion.size}`, r.x + cell * 0.31, r.y + cell * 0.19, cell * 0.24, { color: [0.75, 1, 0.8, 1] })
      if (expansion.value > 0) {
        const textY = cy + side * 0.36
        this.over.rect(cx - side * 0.4, textY - side * 0.085, side * 0.8, side * 0.17, [0.02, 0.09, 0.04, 1])
        this.over.text(formatShort(expansion.value), cx, textY, side * 0.15, { color: [1, 1, 1, 1] }, side * 0.68)
      }
    }
  }

  private drawHeldFrames(): void {
    if (this.stripMode !== 'cells') return
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 4)
    for (const strip of this.strips) {
      if (!strip.held || strip.spinning) continue
      const { x, y, w, h } = strip.rect
      this.over.glowFrame(x, y, w, h, this.layout.cell * 0.018, [1, 0.8, 0.35, 0.85 * pulse])
    }
  }

  private drawZone(): void {
    if (!this.zone.visible || this.stripMode !== 'reels') return
    const appear = Math.min(1, (this.time - this.zone.appear) / 0.5)
    const rect = this.currentZoneRect()
    const { cell } = this.layout
    const pulse = 0.65 + 0.35 * Math.sin(this.time * 3.4)
    const color: Color = [0.45, 1, 0.65, 0.95 * appear * pulse]
    this.over.glowFrame(rect.x, rect.y, rect.w, rect.h, cell * 0.03, color)
    for (const [cx, cy] of [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]]) {
      this.over.cell(AtlasCell.Glow, cx, cy, cell * 0.35, { color: [0.6, 1, 0.75, appear], additive: 1 })
    }
    const multiplier = ZONE_MULTIPLIERS[this.zone.level]
    const labelY = rect.y - cell * 0.02
    this.over.rect(rect.x + rect.w - cell * 0.5, labelY - cell * 0.13, cell * 0.48, cell * 0.24, [0.02, 0.15, 0.06, 0.92 * appear])
    this.over.text(`×${multiplier}`, rect.x + rect.w - cell * 0.26, labelY - cell * 0.01, cell * 0.22, { color: [0.75, 1, 0.8, appear] })
  }

  private drawLines(): void {
    const show = this.lineShow
    if (!show) return
    const elapsed = this.time - show.start
    const { cell, gridX, gridW, gap } = this.layout
    const fade = Math.min(1, elapsed / 0.25)
    const cycling = elapsed >= show.allFor && show.lines.length > 1
    const visible = cycling ? [show.lines[Math.floor((elapsed - show.allFor) / 1.1) % show.lines.length]] : show.lines
    for (const win of visible) {
      const rows = PAYLINES[win.line]
      const color = LINE_COLORS[win.line % LINE_COLORS.length]
      const points = rows.map((row, reel) => this.cellCenter(reel, row))
      const all: Point[] = [{ x: gridX - gap * 2, y: points[0].y }, ...points, { x: gridX + gridW + gap * 2, y: points[points.length - 1].y }]
      for (let k = 0; k < all.length - 1; k++) {
        this.over.line(all[k].x, all[k].y, all[k + 1].x, all[k + 1].y, cell * 0.11, [color[0], color[1], color[2], 0.28 * fade], 1)
        this.over.line(all[k].x, all[k].y, all[k + 1].x, all[k + 1].y, cell * 0.035, [color[0], color[1], color[2], 0.95 * fade])
      }
      if (cycling) {
        const last = win.cells[win.cells.length - 1]
        const at = this.cellCenter(last[0], last[1])
        this.over.rect(at.x - cell * 0.42, at.y + cell * 0.28, cell * 0.84, cell * 0.2, [0, 0, 0, 0.75])
        this.over.text(formatShort(win.win), at.x, at.y + cell * 0.38, cell * 0.17, { color: [color[0], color[1], color[2], 1] }, cell * 0.8)
      }
    }
  }

  private drawHighlights(): void {
    const focus = this.focusCells()
    if (!focus || this.stripMode !== 'reels') return
    const { cell } = this.layout
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 7)
    const seen = new Set<string>()
    const color = this.highlights[0]?.color ?? GOLD
    for (const [reel, row] of focus) {
      const key = `${reel}:${row}`
      if (seen.has(key) || this.strips[reel]?.spinning) continue
      seen.add(key)
      const center = this.cellCenter(reel, row)
      const visual = this.visibleAt(reel, row)
      this.over.cell(AtlasCell.Glow, center.x, center.y, cell * 1.35, { color: [color[0], color[1], color[2], 0.28 + 0.2 * pulse], additive: 1 })
      this.over.cell(visual.cell, center.x, center.y, cell * (1.02 + 0.06 * pulse), { shimmer: 1 })
      const half = cell * 0.48
      this.over.frame(center.x - half, center.y - half, half * 2, half * 2, cell * 0.022, [color[0], color[1], color[2], 0.7 + 0.3 * pulse], 1)
    }
  }

  private drawAnticipation(): void {
    if (this.anticipationReel === null) return
    const strip = this.strips[this.anticipationReel]
    if (!strip) return
    const { x, y, w, h } = strip.rect
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 14)
    this.over.glowFrame(x, y, w, h, this.layout.cell * 0.035, [1, 0.6 + 0.3 * pulse, 0.15, 0.95])
    this.over.cell(AtlasCell.Glow, x + w / 2, y, w * 1.4, { color: [1, 0.6, 0.2, 0.5 * pulse], additive: 1 })
    this.over.cell(AtlasCell.Glow, x + w / 2, y + h, w * 1.4, { color: [1, 0.6, 0.2, 0.5 * pulse], additive: 1 })
  }

  private drawFlights(): void {
    for (const flight of this.flights) {
      const point = this.flightPoint(flight, flight.progress)
      const flip = Math.abs(Math.cos(flight.progress * Math.PI * 3))
      const size = flight.size * (1 + Math.sin(flight.progress * Math.PI) * 0.35)
      this.top.cell(AtlasCell.Glow, point.x, point.y, size * 1.8, { color: [1, 0.75, 0.3, 0.6], additive: 1 })
      this.top.quad(point.x, point.y, (size / 2) * Math.max(0.15, flip), size / 2, cellUv(flight.visual.cell), { shimmer: 1 })
      if (flight.visual.value > 0) this.top.text(formatShort(flight.visual.value), point.x, point.y + size * 0.62, size * 0.32, { color: [1, 0.95, 0.75, 1] }, size * 1.4)
    }
  }

  private drawFloats(): void {
    for (const float of this.floats) {
      const t = (this.time - float.start) / float.duration
      const alpha = Math.min(1, t * 6) * (1 - Math.max(0, (t - 0.6) / 0.4))
      const scale = 0.7 + easeOutBack(Math.min(1, t * 3)) * 0.3
      const y = float.y - t * this.layout.cell * 0.5
      this.top.text(float.text, float.x, y, float.height * scale, { color: [float.color[0], float.color[1], float.color[2], alpha] })
    }
  }
}

