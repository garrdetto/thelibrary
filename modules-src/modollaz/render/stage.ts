import type { CollectCell, CollectStep, OrbValue, SpinStep } from '../../foxlake/casino/math/machines'
import type { SymbolId } from '../../foxlake/casino/math/reels'
import { LINES_25 } from '../../foxlake/casino/math/lines'
import { DISPLAY_FONT, GOLD, blurTile, buildTile, drawBag, drawBill, drawCoin, roundRect } from './art'

export interface StageHooks {
  spinStart(): void
  reelStop(reel: number, special: boolean): void
  anticipation(): void
  pop(kind: 'coin' | 'bill' | 'grow'): void
}

export interface PlayOptions {
  turbo: boolean
  reduced: boolean
}

export type Mode = 'base' | 'free'
type Zone = { reel: number; row: number; size: number }

interface ReelAnim {
  from: number
  delta: number
  start: number
  duration: number
  slow: boolean
  stopped: boolean
}

interface BoardItem {
  kind: 'coin' | 'bill'
  label: string
  jackpot: boolean
  born: number
  taken: number
  inZone: boolean
}

interface Board {
  opened: number
  closing: number
  zoneFrom: Zone
  zoneTo: Zone
  zoneAt: number
  zoneMs: number
  items: Map<string, BoardItem>
  spinUntil: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  kind: 'coin' | 'bill' | 'spark'
  spin: number
  rot: number
}

const ROWS = 3
const LINES = LINES_25.slice(0, 20)
const LINE_COLORS = ['#ffd84a', '#5ae0ff', '#ff6ad5', '#7dff7a', '#ff9a3a', '#b48aff', '#ffffff', '#3affc8']
const SPECIAL = new Set<SymbolId>(['S', 'M', 'N', 'W'])
const key = (reel: number, row: number) => `${reel},${row}`
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3
const easeOutBack = (t: number) => {
  const c = 1.25
  const x = clamp01(t) - 1
  return 1 + (c + 1) * x ** 3 + c * x ** 2
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const cashLabel = (credits: number) => (credits >= 1000 ? `$${Math.round(credits).toLocaleString('en-US')}` : credits >= 100 ? `$${Math.round(credits)}` : Number.isInteger(credits) ? `$${credits}` : `$${credits.toFixed(2)}`)

export function orbLabel(value: OrbValue): { text: string; jackpot: boolean } {
  return 'jackpot' in value ? { text: value.jackpot, jackpot: true } : { text: cashLabel(value.credits), jackpot: false }
}

export function cellLabel(cell: CollectCell): { text: string; jackpot: boolean } {
  return cell.jackpot ? { text: cell.jackpot, jackpot: true } : { text: cashLabel(cell.credits), jackpot: false }
}

export class Stage {
  private readonly ctx: CanvasRenderingContext2D
  private readonly observer: ResizeObserver
  private readonly tiles = new Map<SymbolId, HTMLCanvasElement>()
  private readonly blurred = new Map<SymbolId, HTMLCanvasElement>()
  private raf = 0
  private width = 0
  private height = 0
  private dpr = 1
  private strips: SymbolId[][]
  private pos: number[]
  private anims: (ReelAnim | null)[] = Array(5).fill(null)
  private labels = new Map<string, { text: string; jackpot: boolean }>()
  private winCells = new Set<string>()
  private winLines: [number, number][][] = []
  private winBorn = 0
  private mode: Mode = 'base'
  private board: Board | null = null
  private particles: Particle[] = []
  private reduced = false
  private destroyed = false

  constructor(private readonly canvas: HTMLCanvasElement, strips: SymbolId[][], stops: number[], private readonly hooks: StageHooks) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is not available on this device.')
    this.ctx = ctx
    this.strips = strips
    this.pos = stops.slice()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas)
    this.resize()
    this.raf = requestAnimationFrame(this.frame)
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.observer.disconnect()
  }

  setMode(mode: Mode): void {
    this.mode = mode
  }

  setStrips(strips: SymbolId[][], stops?: number[]): void {
    this.strips = strips
    if (stops) this.pos = stops.slice()
    else this.pos = this.pos.map((p, reel) => ((Math.round(p) % strips[reel].length) + strips[reel].length) % strips[reel].length)
  }

  setLabels(orbs: Record<string, OrbValue> | undefined): void {
    this.labels.clear()
    for (const [cell, value] of Object.entries(orbs ?? {})) this.labels.set(cell, orbLabel(value))
  }

  clearWins(): void {
    this.winCells.clear()
    this.winLines = []
  }

  private tile(sym: SymbolId, blur: boolean): HTMLCanvasElement {
    let base = this.tiles.get(sym)
    if (!base) {
      base = buildTile(sym)
      this.tiles.set(sym, base)
    }
    if (!blur) return base
    let soft = this.blurred.get(sym)
    if (!soft) {
      soft = blurTile(base)
      this.blurred.set(sym, soft)
    }
    return soft
  }

  async spin(step: SpinStep, options: PlayOptions): Promise<void> {
    this.reduced = options.reduced
    this.clearWins()
    this.labels.clear()
    this.hooks.spinStart()
    const now = performance.now()
    const quick = options.turbo || options.reduced
    let anticipated = false
    for (let reel = 0; reel < 5; reel++) {
      const length = this.strips[reel].length
      const current = this.pos[reel]
      const loops = (quick ? 1 : 2) + reel
      const delta = (((current - step.stops[reel]) % length) + length) % length + loops * length
      const slow = Boolean(step.anticipation[reel]) && !quick
      const duration = (quick ? 420 + reel * 110 : 760 + reel * 220) + (slow ? 1300 : 0)
      this.anims[reel] = { from: current, delta, start: now, duration, slow, stopped: false }
      if (slow && !anticipated) {
        anticipated = true
        window.setTimeout(() => this.hooks.anticipation(), Math.max(0, duration - 1500))
      }
    }
    const longest = Math.max(...this.anims.map((a) => (a ? a.duration : 0)))
    await this.wait(longest + 60)
    this.setLabels(step.orbs)
    this.pos = step.stops.slice()
  }

  async showWins(step: SpinStep, options: PlayOptions): Promise<void> {
    if (!step.wins.length) return
    this.winCells = new Set(step.wins.flatMap((w) => w.cells.map(([r, row]) => key(r, row))))
    this.winLines = step.wins.filter((w) => 'line' in w && typeof (w as { line?: number }).line === 'number').map((w) => LINES[(w as { line: number }).line].map((row, reel) => [reel, row] as [number, number]).slice(0, w.count))
    this.winBorn = performance.now()
    const big = step.win > 0
    if (big) this.burst('coin', Math.min(40, 8 + step.wins.length * 3))
    await this.wait(options.turbo ? 650 : 1300)
  }

  burst(kind: 'coin' | 'bill' | 'spark', count: number, at?: [number, number]): void {
    if (this.reduced) return
    const unit = Math.min(this.width, this.height)
    const [x, y] = at ?? [this.width / 2, this.height / 2]
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = unit * (0.25 + Math.random() * 0.75)
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - unit * 0.4, life: 1.6 + Math.random(), max: 2.6, size: unit * (kind === 'spark' ? 0.008 : 0.022 + Math.random() * 0.012), kind, spin: (Math.random() - 0.5) * 8, rot: Math.random() * 6 })
    }
  }

  // ------------------------------------------------------------ Cash Collect board

  async openBoard(start: CollectCell[], zone: Zone, options: PlayOptions, onCollect: (credits: number) => void): Promise<void> {
    this.reduced = options.reduced
    this.clearWins()
    const now = performance.now()
    const items = new Map<string, BoardItem>()
    for (const cell of start) {
      const label = cellLabel(cell)
      items.set(cell.cell, { kind: 'bill', label: label.text, jackpot: label.jackpot, born: now, taken: 0, inZone: false })
    }
    this.board = { opened: now, closing: 0, zoneFrom: { ...zone }, zoneTo: { ...zone }, zoneAt: now, zoneMs: 1, items, spinUntil: 0 }
    await this.wait(options.turbo ? 450 : 900)
    for (const cell of start) {
      const item = items.get(cell.cell)
      if (item) item.taken = performance.now()
      onCollect(cell.credits)
      this.hooks.pop('bill')
      await this.wait(options.turbo ? 160 : 320)
    }
  }

  private currentZone(now: number): Zone {
    const board = this.board
    if (!board) return { reel: 0, row: 0, size: 2 }
    const t = easeOut((now - board.zoneAt) / board.zoneMs)
    return { reel: lerp(board.zoneFrom.reel, board.zoneTo.reel, t), row: lerp(board.zoneFrom.row, board.zoneTo.row, t), size: lerp(board.zoneFrom.size, board.zoneTo.size, t) }
  }

  private moveZone(to: Zone, ms: number): void {
    if (!this.board) return
    const now = performance.now()
    this.board.zoneFrom = this.currentZone(now)
    this.board.zoneTo = { ...to }
    this.board.zoneAt = now
    this.board.zoneMs = Math.max(1, ms)
  }

  async boardSpin(step: CollectStep, options: PlayOptions, onCollect: (credits: number) => void): Promise<void> {
    const board = this.board
    if (!board) return
    const quick = options.turbo || options.reduced
    for (const [cell, item] of board.items) if (item.taken) board.items.delete(cell)
    board.spinUntil = performance.now() + (quick ? 320 : 650)
    this.hooks.spinStart()
    await this.wait(quick ? 340 : 680)
    const now = performance.now()
    for (const coin of step.coins) {
      const label = cellLabel(coin)
      board.items.set(coin.cell, { kind: 'coin', label: label.text, jackpot: label.jackpot, born: now, taken: 0, inZone: coin.collected })
    }
    for (const bill of step.gems) {
      const label = cellLabel(bill)
      board.items.set(bill.cell, { kind: 'bill', label: label.text, jackpot: label.jackpot, born: now, taken: 0, inZone: false })
    }
    if (step.coins.length || step.gems.length) this.hooks.pop('coin')
    await this.wait(quick ? 260 : 520)
    const coinWin = step.coins.reduce((sum, coin) => sum + (coin.collected ? coin.credits : 0), 0)
    if (coinWin > 0) {
      const at = performance.now()
      for (const coin of step.coins) if (coin.collected) {
        const item = board.items.get(coin.cell)
        if (item) item.taken = at
      }
      this.burst('coin', 10, this.boardCellCentre(this.currentZone(at)))
      onCollect(coinWin)
      this.hooks.pop('coin')
      await this.wait(quick ? 260 : 480)
    }
    const path = step.path ?? []
    for (let i = 0; i < step.gems.length; i++) {
      const target = path[i]
      if (target) this.moveZone(target, quick ? 200 : 380)
      await this.wait(quick ? 220 : 400)
      const item = board.items.get(step.gems[i].cell)
      if (item) item.taken = performance.now()
      this.burst('bill', 8, this.boardCellCentre(target ?? this.currentZone(performance.now())))
      onCollect(step.gems[i].credits)
      this.hooks.pop('bill')
      await this.wait(quick ? 140 : 260)
    }
    const zone = this.currentZone(performance.now())
    if (Math.round(zone.size) !== step.zone.size || Math.round(zone.reel) !== step.zone.reel || Math.round(zone.row) !== step.zone.row) {
      const grew = Math.round(zone.size) !== step.zone.size
      this.moveZone(step.zone, quick ? 260 : 520)
      if (grew) {
        this.hooks.pop('grow')
        this.burst('spark', 30, this.boardCellCentre(step.zone))
      }
      await this.wait(quick ? 300 : 600)
    }
    await this.wait(quick ? 120 : 260)
  }

  async closeBoard(options: PlayOptions): Promise<void> {
    if (!this.board) return
    this.board.closing = performance.now()
    await this.wait(options.turbo ? 250 : 450)
    this.board = null
  }

  private boardCellCentre(zone: Zone): [number, number] {
    const l = this.boardLayout()
    return [l.x + (zone.reel + zone.size / 2) * l.cell, l.y + (zone.row + zone.size / 2) * l.cell]
  }

  // ------------------------------------------------------------ layout and drawing

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.width = Math.max(1, rect.width)
    this.height = Math.max(1, rect.height)
    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
  }

  private reelLayout(): { x: number; y: number; cell: number } {
    const pad = Math.max(8, Math.min(this.width, this.height) * 0.035)
    const cell = Math.max(20, Math.min((this.width - pad * 2) / 5, (this.height - pad * 2) / (ROWS + 0.12)))
    return { x: (this.width - cell * 5) / 2, y: (this.height - cell * ROWS) / 2, cell }
  }

  private boardLayout(): { x: number; y: number; cell: number } {
    const pad = Math.max(6, Math.min(this.width, this.height) * 0.025)
    const cell = Math.max(16, Math.min((this.width - pad * 2) / 5, (this.height - pad * 2) / 5))
    return { x: (this.width - cell * 5) / 2, y: (this.height - cell * 5) / 2, cell }
  }

  private frame = (now: number) => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.frame)
    const g = this.ctx
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.drawBackdrop(g, now)
    const board = this.board
    const open = board ? clamp01((now - board.opened) / 400) * (board.closing ? 1 - clamp01((now - board.closing) / 400) : 1) : 0
    if (open < 1) {
      g.save()
      g.globalAlpha = 1 - open
      this.drawReels(g, now)
      g.restore()
    }
    if (board && open > 0) {
      g.save()
      g.globalAlpha = open
      this.drawBoard(g, board, now)
      g.restore()
    }
    this.drawParticles(g, now)
  }

  private drawBackdrop(g: CanvasRenderingContext2D, now: number): void {
    const w = this.width
    const h = this.height
    const free = this.mode === 'free'
    const sky = g.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, free ? '#2a0a3a' : '#03140b')
    sky.addColorStop(0.6, free ? '#4a1a4a' : '#082a17')
    sky.addColorStop(1, free ? '#1a0620' : '#020a05')
    g.fillStyle = sky
    g.fillRect(0, 0, w, h)
    g.save()
    g.globalAlpha = 0.07
    g.fillStyle = free ? '#ffd0ff' : '#9dffb0'
    g.font = `400 ${Math.max(18, Math.min(w, h) * 0.07)}px ${DISPLAY_FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const step = Math.max(48, Math.min(w, h) * 0.16)
    const drift = (now / 60) % step
    for (let y = -step; y < h + step; y += step) for (let x = -step; x < w + step; x += step) g.fillText('$', x + ((y / step) % 2) * step * 0.5, y + drift)
    g.restore()
    if (!this.reduced) {
      g.save()
      g.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 14; i++) {
        const t = now / 1000 + i * 1.7
        const x = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1
        const y = (t * 0.05 + i * 0.13) % 1
        const twinkle = 0.4 + 0.6 * Math.sin(t * 2 + i)
        g.fillStyle = `rgba(255,${free ? 180 : 230},120,${0.25 * twinkle})`
        g.beginPath()
        g.arc(x * w, h - y * h, 1.5 + twinkle * 2, 0, Math.PI * 2)
        g.fill()
      }
      g.restore()
    }
  }

  private drawFrame(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cell: number): void {
    const pad = cell * 0.08
    roundRect(g, x - pad, y - pad, w + pad * 2, h + pad * 2, cell * 0.12)
    const rim = g.createLinearGradient(0, y - pad, 0, y + h + pad)
    for (const [at, color] of GOLD) rim.addColorStop(at, color)
    g.save()
    g.shadowColor = this.mode === 'free' ? 'rgba(255,120,220,0.6)' : 'rgba(80,255,140,0.45)'
    g.shadowBlur = cell * 0.35
    g.fillStyle = rim
    g.fill()
    g.restore()
    roundRect(g, x - pad * 0.35, y - pad * 0.35, w + pad * 0.7, h + pad * 0.7, cell * 0.09)
    const inner = g.createLinearGradient(0, y, 0, y + h)
    inner.addColorStop(0, this.mode === 'free' ? '#1a0622' : '#03140a')
    inner.addColorStop(1, this.mode === 'free' ? '#0a020e' : '#010703')
    g.fillStyle = inner
    g.fill()
  }

  private drawReels(g: CanvasRenderingContext2D, now: number): void {
    const { x, y, cell } = this.reelLayout()
    this.drawFrame(g, x, y, cell * 5, cell * ROWS, cell)
    const winning = this.winCells.size > 0
    const pulse = 1 + 0.06 * Math.sin((now - this.winBorn) / 110)
    for (let reel = 0; reel < 5; reel++) {
      const strip = this.strips[reel]
      const length = strip.length
      const anim = this.anims[reel]
      let position = this.pos[reel]
      let speed = 0
      if (anim) {
        const t = (now - anim.start) / anim.duration
        if (t >= 1) {
          if (!anim.stopped) {
            anim.stopped = true
            const visible = [0, 1, 2].map((row) => strip[((Math.round(anim.from - anim.delta) % length) + length + row) % length])
            this.hooks.reelStop(reel, visible.some((sym) => SPECIAL.has(sym)))
          }
          position = anim.from - anim.delta
          this.anims[reel] = null
          this.pos[reel] = ((Math.round(position) % length) + length) % length
          position = this.pos[reel]
        } else {
          const eased = anim.slow ? 1 - (1 - t) ** 4 : easeOutBack(t)
          position = anim.from - anim.delta * eased
          speed = Math.abs(anim.delta) / anim.duration
        }
      }
      g.save()
      g.beginPath()
      g.rect(x + reel * cell, y, cell, cell * ROWS)
      g.clip()
      if (anim?.slow && !anim.stopped) {
        g.fillStyle = `rgba(255,90,210,${0.18 + 0.12 * Math.sin(now / 90)})`
        g.fillRect(x + reel * cell, y, cell, cell * ROWS)
      }
      const base = Math.floor(position)
      const frac = position - base
      const blur = speed > 0.012
      for (let row = -1; row <= ROWS; row++) {
        const index = (((base + row) % length) + length) % length
        const sym = strip[index]
        const cy = y + (row - frac) * cell
        const rest = !anim && row >= 0 && row < ROWS
        const cellKey = key(reel, row)
        const lit = rest && winning && this.winCells.has(cellKey)
        const scale = lit ? pulse : 1
        g.save()
        if (rest && winning && !lit) g.globalAlpha = 0.38
        const inset = cell * 0.03
        const size = (cell - inset * 2) * scale
        const ox = x + reel * cell + (cell - size) / 2
        const oy = cy + (cell - size) / 2
        if (lit) {
          g.shadowColor = 'rgba(255,220,90,0.95)'
          g.shadowBlur = cell * 0.3
        }
        g.drawImage(this.tile(sym, blur), ox, oy, size, size)
        g.restore()
        if (sym === 'N' && rest) {
          const label = this.labels.get(cellKey)
          if (label) drawBill(g, x + reel * cell, cy, cell, cell, label.text, label.jackpot)
        } else if (sym === 'N' && !rest && !blur) drawBill(g, x + reel * cell, cy, cell, cell, '$')
      }
      g.restore()
    }
    if (winning && this.winLines.length) {
      const which = Math.floor((now - this.winBorn) / 650) % (this.winLines.length + 1)
      const lines = which === this.winLines.length ? this.winLines : [this.winLines[which]]
      lines.forEach((line, index) => {
        g.save()
        g.lineWidth = Math.max(3, cell * 0.05)
        g.lineJoin = 'round'
        g.lineCap = 'round'
        g.strokeStyle = LINE_COLORS[(which === this.winLines.length ? index : which) % LINE_COLORS.length]
        g.shadowColor = g.strokeStyle
        g.shadowBlur = cell * 0.15
        g.beginPath()
        line.forEach(([reel, row], i) => {
          const px = x + reel * cell + cell / 2
          const py = y + row * cell + cell / 2
          if (i === 0) g.moveTo(px, py)
          else g.lineTo(px, py)
        })
        g.stroke()
        g.restore()
      })
    }
  }

  private drawBoard(g: CanvasRenderingContext2D, board: Board, now: number): void {
    const { x, y, cell } = this.boardLayout()
    this.drawFrame(g, x, y, cell * 5, cell * 5, cell)
    const spinning = now < board.spinUntil
    for (let reel = 0; reel < 5; reel++) for (let row = 0; row < 5; row++) {
      const cx = x + reel * cell
      const cy = y + row * cell
      roundRect(g, cx + cell * 0.04, cy + cell * 0.04, cell * 0.92, cell * 0.92, cell * 0.1)
      g.fillStyle = row < 2 ? 'rgba(20,60,34,0.55)' : 'rgba(12,40,22,0.75)'
      g.fill()
      g.lineWidth = 1.5
      g.strokeStyle = 'rgba(120,255,160,0.18)'
      g.stroke()
      if (spinning && !this.reduced) {
        g.save()
        g.globalAlpha = 0.25
        const flick = Math.floor(now / 70 + reel * 3 + row * 7) % 3
        if (flick === 0) drawCoin(g, cx, cy, cell, cell, '', true)
        else if (flick === 1) drawBill(g, cx, cy, cell, cell, '$')
        g.restore()
      }
    }
    for (const [cell0, item] of board.items) {
      const [reel, row] = cell0.split(',').map(Number)
      const age = (now - item.born) / 260
      const fade = item.taken ? 1 - clamp01((now - item.taken) / 380) : 1
      if (fade <= 0) continue
      const pop = easeOutBack(age)
      const size = cell * Math.max(0.01, pop) * (item.taken ? 1 + (1 - fade) * 0.4 : 1)
      const cx = x + reel * cell + (cell - size) / 2
      const cy = y + row * cell + (cell - size) / 2
      g.save()
      g.globalAlpha *= fade
      if (item.kind === 'coin') drawCoin(g, cx, cy, size, size, item.label, !item.inZone && !item.taken)
      else drawBill(g, cx, cy, size, size, item.label, item.jackpot)
      g.restore()
    }
    const zone = this.currentZone(now)
    const zx = x + zone.reel * cell
    const zy = y + zone.row * cell
    const zs = zone.size * cell
    g.save()
    roundRect(g, zx + 2, zy + 2, zs - 4, zs - 4, cell * 0.16)
    g.fillStyle = 'rgba(255,215,80,0.12)'
    g.fill()
    g.lineWidth = Math.max(4, cell * 0.07)
    g.strokeStyle = `rgba(255,${200 + Math.round(40 * Math.sin(now / 160))},70,1)`
    g.shadowColor = 'rgba(255,200,60,0.9)'
    g.shadowBlur = cell * 0.35
    g.stroke()
    g.restore()
    const bob = this.reduced ? 0 : Math.sin(now / 240) * 0.04
    g.save()
    g.globalAlpha = 0.92
    drawBag(g, zx + zs * 0.1, zy + zs * 0.06, zs * 0.8, bob)
    g.restore()
    g.save()
    g.font = `400 ${Math.max(11, cell * 0.16)}px ${DISPLAY_FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'top'
    g.fillStyle = '#fff3c4'
    g.strokeStyle = '#1a0e00'
    g.lineWidth = 4
    const text = `${Math.round(zone.size)}×${Math.round(zone.size)}`
    g.strokeText(text, zx + zs / 2, zy + zs * 0.02)
    g.fillText(text, zx + zs / 2, zy + zs * 0.02)
    g.restore()
  }

  private drawParticles(g: CanvasRenderingContext2D, now: number): void {
    if (!this.particles.length) return
    const dt = 1 / 60
    const gravity = Math.min(this.width, this.height) * 1.4
    this.particles = this.particles.filter((p) => {
      p.life -= dt
      if (p.life <= 0) return false
      p.vy += gravity * dt * (p.kind === 'bill' ? 0.35 : 1)
      p.vx *= p.kind === 'bill' ? 0.96 : 0.99
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.spin * dt
      const alpha = Math.min(1, p.life / 0.5)
      g.save()
      g.globalAlpha = alpha
      g.translate(p.x, p.y)
      g.rotate(p.rot)
      if (p.kind === 'coin') {
        g.scale(Math.max(0.15, Math.abs(Math.cos(now / 120 + p.rot))), 1)
        g.beginPath()
        g.arc(0, 0, p.size, 0, Math.PI * 2)
        g.fillStyle = '#ffc93a'
        g.fill()
        g.lineWidth = p.size * 0.18
        g.strokeStyle = '#7a4a00'
        g.stroke()
      } else if (p.kind === 'bill') {
        g.fillStyle = '#5fc15a'
        g.fillRect(-p.size * 1.3, -p.size * 0.6, p.size * 2.6, p.size * 1.2)
        g.strokeStyle = '#1d6a2a'
        g.lineWidth = p.size * 0.15
        g.strokeRect(-p.size * 1.3, -p.size * 0.6, p.size * 2.6, p.size * 1.2)
      } else {
        g.globalCompositeOperation = 'lighter'
        g.fillStyle = '#fff2a0'
        g.beginPath()
        g.arc(0, 0, p.size * 1.6, 0, Math.PI * 2)
        g.fill()
      }
      g.restore()
      return true
    })
  }
}
