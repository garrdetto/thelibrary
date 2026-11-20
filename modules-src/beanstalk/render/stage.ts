import { REELS, ROWS, Sym, isWild } from '../engine/paytable'
import { stripsFor, type CellRef, type Grid, type Mode, type SpinResult } from '../engine/engine'
import { DISPLAY_FONT, buildBlurred, buildSymbols, leaf, star } from './art'

export interface StageHooks {
  spinStart(): void
  reelStop(reel: number, castle: boolean): void
  anticipation(on: boolean): void
  plant(index: number): void
  grow(index: number, kind: 'climb' | 'spread'): void
  win(multiple: number): void
}

export interface PlayOptions {
  turbo: boolean
  reduced: boolean
}

interface ReelAnim {
  spinning: boolean
  startedAt: number
  stopAt: number
  phase: number
  filler: number[]
}

interface Particle {
  kind: 'leaf' | 'coin' | 'spark'
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  born: number
  life: number
  size: number
}

interface Connector {
  from: CellRef
  to: CellRef
  born: number
  duration: number
}

interface Cloud {
  x: number
  y: number
  scale: number
  speed: number
}

const key = (reel: number, row: number) => reel * ROWS + row
const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

export class Stage {
  private readonly ctx: CanvasRenderingContext2D
  private readonly tiles: HTMLCanvasElement[]
  private readonly blurred: HTMLCanvasElement[]
  private readonly observer: ResizeObserver
  private raf = 0
  private width = 0
  private height = 0
  private dpr = 1
  private cell = 100
  private originX = 0
  private originY = 0
  private grid: Grid
  private held: boolean[][] | null = null
  private mode: Mode = 'base'
  private reels: ReelAnim[] = []
  private landedAt: number[] = Array(REELS).fill(-1)
  private pops = new Map<number, number>()
  private bolts: { cell: CellRef; born: number }[] = []
  private connectors: Connector[] = []
  private highlight: Set<number> | null = null
  private focus: Set<number> | null = null
  private winText: { text: string; sub: string; born: number; big: number } | null = null
  private multiplierFlash: { value: number; born: number } | null = null
  private glitchUntil = 0
  private anticipating = -1
  private particles: Particle[] = []
  private clouds: Cloud[] = []
  private reduced = false
  private destroyed = false

  constructor(private readonly canvas: HTMLCanvasElement, initial: Grid, private readonly hooks: StageHooks) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is not available.')
    this.ctx = ctx
    this.tiles = buildSymbols()
    this.blurred = buildBlurred(this.tiles)
    this.grid = initial.map((reel) => reel.map((cell) => ({ ...cell })))
    for (let index = 0; index < 7; index++) this.clouds.push({ x: Math.random(), y: 0.04 + Math.random() * 0.5, scale: 0.6 + Math.random() * 0.9, speed: 0.004 + Math.random() * 0.01 })
    for (let reel = 0; reel < REELS; reel++) this.reels.push({ spinning: false, startedAt: 0, stopAt: 0, phase: 0, filler: this.fillerFor(reel, 'base') })
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

  tileImage(sym: Sym): HTMLCanvasElement {
    return this.tiles[sym]
  }

  setMode(mode: Mode): void {
    this.mode = mode
    for (let reel = 0; reel < REELS; reel++) this.reels[reel].filler = this.fillerFor(reel, mode)
  }

  setIdle(grid: Grid, held: boolean[][] | null): void {
    this.grid = grid.map((reel) => reel.map((cell) => ({ ...cell })))
    this.held = held
    if (!held) this.connectors = []
  }

  clearWins(): void {
    this.highlight = null
    this.focus = null
    this.winText = null
    this.multiplierFlash = null
  }

  burst(kind: 'leaf' | 'coin', count: number): void {
    const now = performance.now()
    for (let index = 0; index < count; index++) {
      const coin = kind === 'coin'
      this.particles.push({
        kind,
        x: this.width * (0.15 + Math.random() * 0.7),
        y: coin ? this.height * 0.45 : -20,
        vx: (Math.random() - 0.5) * (coin ? 520 : 80),
        vy: coin ? -320 - Math.random() * 420 : 40 + Math.random() * 90,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 6,
        born: now,
        life: 2600 + Math.random() * 1400,
        size: coin ? 10 + Math.random() * 10 : 14 + Math.random() * 14,
      })
    }
  }

  async play(result: SpinResult, options: PlayOptions): Promise<void> {
    this.reduced = options.reduced
    const fast = options.turbo ? 0.45 : 1
    this.clearWins()
    this.held = result.held
    if (result.mode === 'base') this.connectors = []
    else this.connectors = this.connectors.filter((link) => result.held?.[link.from[0]][link.from[1]] && result.held?.[link.to[0]][link.to[1]])
    this.setMode(result.mode)
    const start = performance.now()
    if (result.haywire && !options.reduced) this.glitchUntil = start + 99_999
    for (let reel = 0; reel < REELS; reel++) {
      const anim = this.reels[reel]
      anim.spinning = true
      anim.startedAt = start
      anim.stopAt = Number.POSITIVE_INFINITY
      this.landedAt[reel] = -1
    }
    this.hooks.spinStart()
    await this.wait((result.haywire ? 900 : 620) * fast)
    let castles = 0
    for (let reel = 0; reel < REELS; reel++) {
      if (reel === REELS - 1 && result.mode === 'base' && castles >= 2 && !options.turbo) {
        this.anticipating = reel
        this.hooks.anticipation(true)
        await this.wait(1300)
        this.anticipating = -1
        this.hooks.anticipation(false)
      }
      const now = performance.now()
      this.reels[reel].stopAt = now
      this.reels[reel].spinning = false
      this.landedAt[reel] = now
      for (let row = 0; row < ROWS; row++) this.grid[reel][row] = { ...result.landed[reel][row] }
      const castle = result.landed[reel].some((cell) => cell.sym === Sym.Castle)
      if (castle) castles++
      this.hooks.reelStop(reel, castle)
      await this.wait(150 * fast)
    }
    await this.wait(220 * fast)
    this.glitchUntil = result.haywire && !options.reduced ? performance.now() + 380 : 0

    if (result.haywire) {
      let index = 0
      for (const plant of result.haywire.planted) {
        this.bolts.push({ cell: plant.cell, born: performance.now() })
        this.hooks.plant(index++)
        await this.wait(200 * fast)
        this.grid[plant.cell[0]][plant.cell[1]] = { sym: Sym.Seed, mult: plant.mult }
        this.pops.set(key(plant.cell[0], plant.cell[1]), performance.now())
        await this.wait(160 * fast)
      }
      if (result.haywire.kind === 'double') {
        this.multiplierFlash = { value: result.haywire.multiplier, born: performance.now() }
        this.hooks.plant(0)
        await this.wait(700 * fast)
      }
    }

    let step = 0
    for (const grow of result.growth) {
      const duration = (grow.kind === 'climb' ? 280 : 340) * fast
      this.connectors.push({ from: grow.from, to: grow.to, born: performance.now(), duration })
      this.hooks.grow(step++, grow.kind)
      await this.wait(duration)
      this.grid[grow.to[0]][grow.to[1]] = { sym: Sym.Vine, mult: 1 }
      this.pops.set(key(grow.to[0], grow.to[1]), performance.now())
      if (!options.turbo) this.leafPuff(grow.to)
      await this.wait(60 * fast)
    }
    this.grid = result.grid.map((reel) => reel.map((cell) => ({ ...cell })))
    if (result.growth.length) await this.wait(160 * fast)

    if (result.stepWin > 0) {
      const multiple = result.stepWin / result.bet
      const cells = new Set<number>()
      for (const win of result.ways) for (const [reel, row] of win.cells) cells.add(key(reel, row))
      for (const [reel, row] of result.scatter.win > 0 ? result.scatter.cells : []) cells.add(key(reel, row))
      this.highlight = cells
      const big = multiple >= 50 ? 3 : multiple >= 25 ? 2 : multiple >= 12 ? 1 : 0
      this.winText = { text: '', sub: result.multiplier > 1 ? `Bean Burst ×${result.multiplier}` : `${result.ways.length + (result.scatter.win > 0 ? 1 : 0)} win${result.ways.length + (result.scatter.win > 0 ? 1 : 0) === 1 ? '' : 's'}`, born: performance.now(), big }
      this.hooks.win(multiple)
      if (big > 0) this.burst('coin', 30 + big * 30)
      else if (!options.turbo) this.burst('leaf', 10)
      await this.wait((big ? 1700 + big * 600 : 900) * fast)
      if (!options.turbo && result.ways.length > 1 && result.ways.length <= 4) {
        for (const win of result.ways) {
          this.focus = new Set(win.cells.map(([reel, row]) => key(reel, row)))
          await this.wait(620)
        }
        this.focus = null
      }
    }
  }

  setWinLabel(text: string): void {
    if (this.winText) this.winText.text = text
  }

  private fillerFor(reel: number, mode: Mode): number[] {
    const strip = stripsFor(mode)[reel]
    return strip.map((sym) => (sym === Sym.Seed ? Sym.Seed : sym))
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
  }

  private leafPuff(cell: CellRef): void {
    const now = performance.now()
    const [cx, cy] = this.center(cell)
    for (let index = 0; index < 5; index++) {
      this.particles.push({ kind: 'leaf', x: cx, y: cy, vx: (Math.random() - 0.5) * 220, vy: -80 - Math.random() * 140, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, born: now, life: 900, size: 10 + Math.random() * 8 })
    }
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.width = Math.max(1, rect.width)
    this.height = Math.max(1, rect.height)
    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
    const padX = Math.max(30, this.width * 0.07)
    const padY = Math.max(18, this.height * 0.05)
    this.cell = Math.max(24, Math.min((this.width - padX * 2) / REELS, (this.height - padY * 2) / ROWS))
    this.originX = (this.width - this.cell * REELS) / 2
    this.originY = (this.height - this.cell * ROWS) / 2
  }

  private center(cell: CellRef): [number, number] {
    return [this.originX + (cell[0] + 0.5) * this.cell, this.originY + (cell[1] + 0.5) * this.cell]
  }

  private frame = (now: number) => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.frame)
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    const glitching = now < this.glitchUntil
    ctx.save()
    if (glitching) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6)
    this.drawSky(ctx, now)
    this.drawStalks(ctx, now)
    this.drawBoard(ctx, now)
    this.drawConnectors(ctx, now)
    this.drawBolts(ctx, now)
    this.drawWinText(ctx, now)
    ctx.restore()
    this.drawParticles(ctx, now)
    if (glitching) this.drawGlitch(ctx)
  }

  private drawSky(ctx: CanvasRenderingContext2D, now: number): void {
    const free = this.mode === 'free'
    const sky = ctx.createLinearGradient(0, 0, 0, this.height)
    if (free) {
      sky.addColorStop(0, '#2b1660')
      sky.addColorStop(0.45, '#c2569b')
      sky.addColorStop(1, '#ffc66b')
    } else {
      sky.addColorStop(0, '#2f8fe0')
      sky.addColorStop(0.6, '#8fd3ff')
      sky.addColorStop(1, '#d9f6ff')
    }
    ctx.fillStyle = sky
    ctx.fillRect(-20, -20, this.width + 40, this.height + 40)
    const sun = ctx.createRadialGradient(this.width * 0.84, this.height * 0.14, 0, this.width * 0.84, this.height * 0.14, this.height * 0.5)
    sun.addColorStop(0, free ? 'rgba(255,230,160,0.9)' : 'rgba(255,255,220,0.85)')
    sun.addColorStop(1, 'rgba(255,255,220,0)')
    ctx.fillStyle = sun
    ctx.fillRect(0, 0, this.width, this.height)
    for (const cloud of this.clouds) {
      const x = (((cloud.x + (this.reduced ? 0 : now * cloud.speed * 0.00002)) % 1.3) - 0.15) * this.width
      this.cloud(ctx, x, cloud.y * this.height, cloud.scale * Math.max(40, this.height * 0.09), free ? 'rgba(255,214,235,0.75)' : 'rgba(255,255,255,0.85)')
    }
    if (free) {
      for (let index = 0; index < 30; index++) {
        const x = ((index * 97.13) % 1) * this.width
        const y = ((index * 53.71) % 1) * this.height * 0.4
        ctx.globalAlpha = 0.4 + 0.4 * Math.sin(now / 500 + index)
        star(ctx, x, y, 3, '#fff6d0')
      }
      ctx.globalAlpha = 1
    }
    const hill = ctx.createLinearGradient(0, this.height * 0.8, 0, this.height)
    hill.addColorStop(0, free ? '#6a3a7a' : '#5fc24a')
    hill.addColorStop(1, free ? '#2a1640' : '#2f7a2a')
    ctx.fillStyle = hill
    ctx.beginPath()
    ctx.moveTo(-20, this.height + 20)
    ctx.lineTo(-20, this.height * 0.88)
    ctx.quadraticCurveTo(this.width * 0.25, this.height * 0.78, this.width * 0.5, this.height * 0.88)
    ctx.quadraticCurveTo(this.width * 0.75, this.height * 0.96, this.width + 20, this.height * 0.84)
    ctx.lineTo(this.width + 20, this.height + 20)
    ctx.fill()
  }

  private cloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r * 0.6, 0, Math.PI * 2)
    ctx.arc(x + r * 0.55, y - r * 0.2, r * 0.7, 0, Math.PI * 2)
    ctx.arc(x + r * 1.2, y, r * 0.55, 0, Math.PI * 2)
    ctx.arc(x + r * 0.6, y + r * 0.2, r * 0.6, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawStalks(ctx: CanvasRenderingContext2D, now: number): void {
    const sway = this.reduced ? 0 : Math.sin(now / 1400) * 6
    for (const side of [-1, 1]) {
      const baseX = side < 0 ? this.originX - this.cell * 0.32 : this.originX + this.cell * REELS + this.cell * 0.32
      ctx.save()
      ctx.lineCap = 'round'
      for (const [offset, width, color] of [[0, this.cell * 0.2, '#2f7a24'], [side * this.cell * 0.06, this.cell * 0.11, '#6ccf48']] as const) {
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.beginPath()
        ctx.moveTo(baseX + offset, this.height + 10)
        for (let y = this.height; y > -30; y -= 30) {
          const wave = Math.sin(y / 70 + side) * this.cell * 0.12 + sway * (1 - y / this.height)
          ctx.lineTo(baseX + offset + wave, y)
        }
        ctx.stroke()
      }
      for (let y = this.height * 0.92; y > 0; y -= this.cell * 0.55) {
        const wave = Math.sin(y / 70 + side) * this.cell * 0.12 + sway * (1 - y / this.height)
        leaf(ctx, baseX + wave, y, this.cell * 0.32, side < 0 ? (y % 2 > 1 ? 3.6 : -0.5) : (y % 2 > 1 ? -0.5 : 3.6))
      }
      ctx.restore()
    }
  }

  private drawBoard(ctx: CanvasRenderingContext2D, now: number): void {
    const x = this.originX
    const y = this.originY
    const w = this.cell * REELS
    const h = this.cell * ROWS
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 8
    ctx.fillStyle = '#7a4a1e'
    ctx.beginPath()
    ctx.roundRect(x - 14, y - 14, w + 28, h + 28, 22)
    ctx.fill()
    ctx.restore()
    const frame = ctx.createLinearGradient(x, y - 14, x, y + h + 14)
    frame.addColorStop(0, '#c98a4a')
    frame.addColorStop(0.5, '#8a5524')
    frame.addColorStop(1, '#5a3412')
    ctx.strokeStyle = frame
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.roundRect(x - 9, y - 9, w + 18, h + 18, 18)
    ctx.stroke()
    const panel = ctx.createLinearGradient(x, y, x, y + h)
    panel.addColorStop(0, this.mode === 'free' ? '#fff1d6' : '#fffbe8')
    panel.addColorStop(1, this.mode === 'free' ? '#f3cfa0' : '#e8f3d0')
    ctx.fillStyle = panel
    ctx.beginPath()
    ctx.roundRect(x - 4, y - 4, w + 8, h + 8, 14)
    ctx.fill()
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x - 4, y - 4, w + 8, h + 8, 14)
    ctx.clip()
    for (let reel = 0; reel < REELS; reel++) {
      if (reel > 0) {
        ctx.fillStyle = 'rgba(120,80,30,0.18)'
        ctx.fillRect(x + reel * this.cell - 1, y, 2, h)
      }
      this.drawReel(ctx, reel, now)
    }
    if (this.anticipating >= 0) {
      const glow = 0.35 + 0.25 * Math.sin(now / 90)
      ctx.fillStyle = `rgba(255,220,80,${glow})`
      ctx.fillRect(x + this.anticipating * this.cell, y, this.cell, h)
    }
    ctx.restore()
  }

  private drawReel(ctx: CanvasRenderingContext2D, reel: number, now: number): void {
    const anim = this.reels[reel]
    const x = this.originX + reel * this.cell
    const y = this.originY
    if (anim.spinning) {
      const speed = 0.022
      const phase = (now - anim.startedAt) * speed
      const base = Math.floor(phase)
      const frac = phase - base
      for (let row = -1; row <= ROWS; row++) {
        if (row >= 0 && row < ROWS && this.held?.[reel][row]) continue
        const sym = anim.filler[(((base - row) % anim.filler.length) + anim.filler.length) % anim.filler.length]
        ctx.drawImage(this.blurred[sym], x, y + (row + frac) * this.cell, this.cell, this.cell)
      }
      for (let row = 0; row < ROWS; row++) if (this.held?.[reel][row]) this.drawCell(ctx, reel, row, now, 0)
      return
    }
    const landed = this.landedAt[reel]
    const t = landed < 0 ? 1 : clamp01((now - landed) / 260)
    const drop = this.reduced ? 0 : (1 - easeOutBack(t)) * this.cell * 0.55
    for (let row = 0; row < ROWS; row++) this.drawCell(ctx, reel, row, now, this.held?.[reel][row] ? 0 : drop)
  }

  private drawCell(ctx: CanvasRenderingContext2D, reel: number, row: number, now: number, offset: number): void {
    const cell = this.grid[reel][row]
    const x = this.originX + reel * this.cell
    const y = this.originY + row * this.cell + offset
    const id = key(reel, row)
    const pop = this.pops.get(id)
    let scale = 1
    if (pop !== undefined) {
      const t = (now - pop) / 320
      if (t >= 1) this.pops.delete(id)
      else scale = 1 + Math.sin(t * Math.PI) * 0.22
    }
    const dimmed = (this.focus && !this.focus.has(id)) || (!this.focus && this.highlight && !this.highlight.has(id))
    const lit = this.focus ? this.focus.has(id) : this.highlight?.has(id)
    if (this.held?.[reel][row] && isWild(cell.sym)) {
      ctx.fillStyle = 'rgba(255,215,90,0.35)'
      ctx.fillRect(x + 2, y + 2, this.cell - 4, this.cell - 4)
    }
    if (lit) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 140)
      ctx.save()
      ctx.shadowColor = '#fff38a'
      ctx.shadowBlur = 18 + pulse * 14
      ctx.strokeStyle = `rgba(255,236,120,${0.7 + pulse * 0.3})`
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.roundRect(x + 4, y + 4, this.cell - 8, this.cell - 8, 12)
      ctx.stroke()
      ctx.restore()
      scale *= 1 + pulse * 0.05
    }
    ctx.save()
    ctx.globalAlpha = dimmed ? 0.35 : 1
    const size = this.cell * scale
    ctx.drawImage(this.tiles[cell.sym], x + (this.cell - size) / 2, y + (this.cell - size) / 2, size, size)
    ctx.restore()
    if (cell.sym === Sym.Seed && cell.mult > 1) {
      const r = this.cell * 0.15
      const bx = x + this.cell - r * 1.15
      const by = y + r * 1.15
      ctx.save()
      ctx.globalAlpha = dimmed ? 0.45 : 1
      ctx.fillStyle = cell.mult >= 3 ? '#e8302a' : '#7a2cc0'
      ctx.strokeStyle = '#fff6c8'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(bx, by, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.font = `${Math.round(r * 1.15)}px ${DISPLAY_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`×${cell.mult}`, bx, by + r * 0.08)
      ctx.restore()
    }
    if (this.held?.[reel][row] && isWild(cell.sym)) {
      ctx.strokeStyle = '#ffcf45'
      ctx.lineWidth = 3
      ctx.setLineDash([8, 6])
      ctx.lineDashOffset = -now / 40
      ctx.beginPath()
      ctx.roundRect(x + 3, y + 3, this.cell - 6, this.cell - 6, 10)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  private drawConnectors(ctx: CanvasRenderingContext2D, now: number): void {
    for (const link of this.connectors) {
      const progress = clamp01((now - link.born) / link.duration)
      const [x0, y0] = this.center(link.from)
      const [x1, y1] = this.center(link.to)
      const mx = (x0 + x1) / 2 + (y1 - y0) * 0.28
      const my = (y0 + y1) / 2 - (x1 - x0) * 0.28
      const point = (t: number): [number, number] => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t * t * y1]
      ctx.save()
      ctx.lineCap = 'round'
      for (const [width, color] of [[this.cell * 0.11, '#1f5e1a'], [this.cell * 0.06, '#7fdc52']] as const) {
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        const steps = 16
        for (let index = 1; index <= steps * progress; index++) {
          const [px, py] = point(index / steps)
          ctx.lineTo(px, py)
        }
        const [ex, ey] = point(progress)
        ctx.lineTo(ex, ey)
        ctx.stroke()
      }
      for (const t of [0.3, 0.62, 0.9]) {
        if (t > progress) continue
        const [px, py] = point(t)
        const grown = clamp01((progress - t) * 4)
        leaf(ctx, px, py, this.cell * 0.2 * grown, (t * 9) % 6)
      }
      if (progress < 1) {
        const [ex, ey] = point(progress)
        ctx.fillStyle = 'rgba(255,255,200,0.9)'
        ctx.beginPath()
        ctx.arc(ex, ey, this.cell * 0.06, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }

  private drawBolts(ctx: CanvasRenderingContext2D, now: number): void {
    this.bolts = this.bolts.filter((bolt) => now - bolt.born < 420)
    for (const bolt of this.bolts) {
      const [cx, cy] = this.center(bolt.cell)
      const alpha = 1 - (now - bolt.born) / 420
      ctx.save()
      ctx.strokeStyle = `rgba(200,255,120,${alpha})`
      ctx.shadowColor = '#d6ff8a'
      ctx.shadowBlur = 20
      ctx.lineWidth = 5
      ctx.beginPath()
      let x = cx + (Math.random() - 0.5) * 40
      ctx.moveTo(x, 0)
      for (let y = 0; y < cy; y += cy / 7) {
        x = cx + (Math.random() - 0.5) * 50 * (1 - y / cy)
        ctx.lineTo(x, y)
      }
      ctx.lineTo(cx, cy)
      ctx.stroke()
      ctx.restore()
    }
  }

  private drawWinText(ctx: CanvasRenderingContext2D, now: number): void {
    const flash = this.multiplierFlash
    if (flash && now - flash.born < 1400) {
      const t = (now - flash.born) / 1400
      ctx.save()
      ctx.globalAlpha = 1 - t * t
      ctx.font = `${Math.round(this.cell * (1.2 + t * 0.4))}px ${DISPLAY_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 14
      ctx.strokeStyle = '#4a0f6a'
      ctx.strokeText(`×${flash.value}`, this.width / 2, this.height / 2)
      ctx.fillStyle = '#ffe14a'
      ctx.fillText(`×${flash.value}`, this.width / 2, this.height / 2)
      ctx.restore()
    }
    const win = this.winText
    if (!win || !win.text) return
    const fade = 1 - clamp01((now - win.born - (win.big ? 5200 : 3200)) / 500)
    if (fade <= 0) return
    const t = clamp01((now - win.born) / 400)
    const size = this.cell * (win.big ? 0.62 + win.big * 0.12 : 0.5) * easeOutBack(t)
    if (size <= 0) return
    const cy = this.originY + this.cell * ROWS * 0.5
    ctx.save()
    ctx.globalAlpha = fade
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(20,40,10,0.55)'
    ctx.beginPath()
    ctx.roundRect(this.width / 2 - this.cell * 1.9, cy - size * 0.95, this.cell * 3.8, size * (win.big ? 2.6 : 1.9), 18)
    ctx.fill()
    if (win.big) {
      const label = win.big >= 3 ? 'GIANT WIN' : win.big === 2 ? 'HUGE WIN' : 'BIG WIN'
      ctx.font = `${Math.round(size * 0.55)}px ${DISPLAY_FONT}`
      ctx.fillStyle = '#9ef06a'
      ctx.fillText(label, this.width / 2, cy - size * 0.45)
    }
    ctx.font = `${Math.round(size)}px ${DISPLAY_FONT}`
    ctx.lineWidth = Math.max(4, size * 0.14)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#3a1f06'
    const textY = win.big ? cy + size * 0.35 : cy
    ctx.strokeText(win.text, this.width / 2, textY)
    const gold = ctx.createLinearGradient(0, textY - size / 2, 0, textY + size / 2)
    gold.addColorStop(0, '#fff8c8')
    gold.addColorStop(0.5, '#ffd34a')
    gold.addColorStop(1, '#d8851a')
    ctx.fillStyle = gold
    ctx.fillText(win.text, this.width / 2, textY)
    ctx.font = `${Math.round(size * 0.32)}px ${DISPLAY_FONT}`
    ctx.fillStyle = '#e8ffd8'
    ctx.fillText(win.sub, this.width / 2, textY + size * 0.72)
    ctx.restore()
  }

  private drawParticles(ctx: CanvasRenderingContext2D, now: number): void {
    const dt = 1 / 60
    this.particles = this.particles.filter((particle) => now - particle.born < particle.life)
    for (const particle of this.particles) {
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      particle.rot += particle.vr * dt
      if (particle.kind === 'coin') particle.vy += 900 * dt
      else particle.vx += Math.sin(now / 300 + particle.born) * 4
      const alpha = 1 - (now - particle.born) / particle.life
      ctx.save()
      ctx.globalAlpha = Math.max(0, alpha)
      ctx.translate(particle.x, particle.y)
      ctx.rotate(particle.rot)
      if (particle.kind === 'leaf') leaf(ctx, 0, 0, particle.size, 0)
      else {
        ctx.scale(Math.abs(Math.cos(particle.rot * 2)) * 0.8 + 0.2, 1)
        const coin = ctx.createRadialGradient(-particle.size * 0.3, -particle.size * 0.3, 0, 0, 0, particle.size)
        coin.addColorStop(0, '#fff6c8')
        coin.addColorStop(0.5, '#ffcf45')
        coin.addColorStop(1, '#a8650e')
        ctx.fillStyle = coin
        ctx.beginPath()
        ctx.arc(0, 0, particle.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }

  private drawGlitch(ctx: CanvasRenderingContext2D): void {
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    for (let index = 0; index < 6; index++) {
      const sliceY = Math.random() * h
      const sliceH = 6 + Math.random() * h * 0.06
      const shift = (Math.random() - 0.5) * w * 0.08
      ctx.drawImage(this.canvas, 0, sliceY, w, sliceH, shift, sliceY, w, sliceH)
    }
    ctx.globalCompositeOperation = 'screen'
    for (let index = 0; index < 3; index++) {
      ctx.fillStyle = index % 2 ? 'rgba(0,255,230,0.22)' : 'rgba(255,0,200,0.22)'
      ctx.fillRect(0, Math.random() * h, w, 4 + Math.random() * 24)
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    for (let y = 0; y < h; y += 4 * this.dpr) ctx.fillRect(0, y, w, this.dpr)
    for (let index = 0; index < 5; index++) {
      ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '140,255,90' : '255,60,160'},${0.3 + Math.random() * 0.4})`
      ctx.fillRect(Math.random() * w, Math.random() * h, 10 + Math.random() * 60, 4 + Math.random() * 18)
    }
    ctx.restore()
  }
}
