export interface TapeCell {
  cell: number
  value: number
}

export type StripPhase = 'idle' | 'windup' | 'spin' | 'stopping' | 'bounce'

export interface StripRect {
  x: number
  y: number
  w: number
  h: number
}

const WINDUP_TIME = 0.11
const WINDUP_LIFT = 0.16
const ACCEL_TIME = 0.22
const OVERSHOOT = 0.2
const BOUNCE_TIME = 0.2

const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t)
const easeOutBack = (t: number) => {
  const c = 1.4
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}

export class ReelStrip {
  rect: StripRect = { x: 0, y: 0, w: 0, h: 0 }
  readonly rows: number
  curve: number
  respinStyle: boolean
  top = 0
  phase: StripPhase = 'idle'
  maxSpeed = 24
  blur = 0
  speed = 0
  tint: [number, number, number] = [1, 1, 1]
  targetTint: [number, number, number] = [1, 1, 1]
  dimMask = 0
  held = false
  private tape = new Map<number, TapeCell>()
  private delay = 0
  private clock = 0
  private windupStart = 0
  private stopFrom = 0
  private stopTo = 0
  private stopDuration = 0
  private bounceFrom = 0
  private bounceTo = 0
  private pendingStop: { cells: TapeCell[]; onLand: () => void; resolve: () => void } | null = null
  private finish: (() => void) | null = null
  private lastTop = 0

  constructor(rows: number, curve: number, respinStyle: boolean, private feeder: () => TapeCell) {
    this.rows = rows
    this.curve = curve
    this.respinStyle = respinStyle
  }

  setFeeder(feeder: () => TapeCell): void {
    this.feeder = feeder
  }

  get spinning(): boolean {
    return this.phase !== 'idle'
  }

  setCells(cells: readonly TapeCell[]): void {
    this.top = Math.round(this.top)
    this.lastTop = this.top
    this.phase = 'idle'
    this.speed = 0
    this.blur = 0
    for (let row = 0; row < this.rows; row++) this.tape.set(this.top + row, { ...cells[row] })
  }

  setValue(row: number, value: number): void {
    const key = Math.round(this.top) + row
    const current = this.cellAt(key)
    this.tape.set(key, { ...current, value })
  }

  cellAt(position: number): TapeCell {
    let cell = this.tape.get(position)
    if (!cell) {
      cell = this.feeder()
      this.tape.set(position, cell)
    }
    return cell
  }

  visible(row: number): TapeCell {
    return this.cellAt(Math.round(this.top) + row)
  }

  start(delay = 0): void {
    this.delay = delay
    this.clock = 0
    this.windupStart = this.top
    this.phase = 'windup'
    this.pendingStop = null
  }

  stop(cells: readonly TapeCell[], onLand: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (this.phase === 'idle') {
        this.setCells(cells)
        onLand()
        resolve()
        return
      }
      this.pendingStop = { cells: cells.map((cell) => ({ ...cell })), onLand, resolve }
      if (this.phase === 'spin') this.beginStop()
    })
  }

  private beginStop(): void {
    const pending = this.pendingStop
    if (!pending) return
    const speed = Math.max(this.speed, this.maxSpeed * 0.5)
    const travel = Math.max(speed * 0.16, this.rows + 1.4)
    const target = Math.floor(this.top - travel)
    for (let row = 0; row < this.rows; row++) this.tape.set(target + row, pending.cells[row])
    this.stopFrom = this.top
    this.stopTo = target - OVERSHOOT
    this.stopDuration = (2 * (this.stopFrom - this.stopTo)) / speed
    this.bounceFrom = this.stopTo
    this.bounceTo = target
    this.clock = 0
    this.phase = 'stopping'
    this.finish = pending.resolve
  }

  update(dt: number): void {
    this.lastTop = this.top
    for (let k = 0; k < 3; k++) this.tint[k] += (this.targetTint[k] - this.tint[k]) * Math.min(1, dt * 6)
    if (this.phase === 'idle') {
      this.blur = 0
      this.speed = 0
      return
    }
    if (this.delay > 0) {
      this.delay -= dt
      if (this.delay > 0) return
      dt = -this.delay
      this.delay = 0
    }
    this.clock += dt
    if (this.phase === 'windup') {
      const t = Math.min(1, this.clock / WINDUP_TIME)
      this.top = this.windupStart + WINDUP_LIFT * Math.sin(t * Math.PI * 0.5)
      if (t >= 1) {
        this.phase = 'spin'
        this.clock = 0
        this.speed = 0
      }
    } else if (this.phase === 'spin') {
      const accel = Math.min(1, this.clock / ACCEL_TIME)
      this.speed = this.maxSpeed * accel * accel
      this.top -= this.speed * dt
      if (this.pendingStop && accel >= 1) this.beginStop()
    } else if (this.phase === 'stopping') {
      const t = Math.min(1, this.clock / this.stopDuration)
      this.top = this.stopFrom + (this.stopTo - this.stopFrom) * easeOutQuad(t)
      if (t >= 1) {
        this.phase = 'bounce'
        this.clock = 0
        const landed = this.pendingStop
        this.pendingStop = null
        landed?.onLand()
      }
    } else if (this.phase === 'bounce') {
      const t = Math.min(1, this.clock / BOUNCE_TIME)
      this.top = this.bounceFrom + (this.bounceTo - this.bounceFrom) * easeOutBack(t)
      if (t >= 1) {
        this.top = this.bounceTo
        this.phase = 'idle'
        const done = this.finish
        this.finish = null
        done?.()
      }
    }
    const moved = (this.lastTop - this.top) / Math.max(dt, 1e-4)
    this.speed = this.phase === 'spin' ? this.speed : Math.max(0, moved)
    this.blur = Math.min(0.95, Math.max(0, moved) / 26)
    this.prune()
  }

  private prune(): void {
    if (this.tape.size < 64) return
    const anchor = Math.floor(this.top)
    for (const key of this.tape.keys()) if (key < anchor - 24 || key > anchor + 24) this.tape.delete(key)
  }

  slots(out: Uint32Array, offset: number): number {
    const base = Math.floor(this.top)
    for (let j = 0; j < 8; j++) out[offset + j] = this.cellAt(base - 1 + j).cell
    return this.top - base
  }

  screenY(stripPosition: number): { y: number; scale: number } {
    const t = (stripPosition / this.rows) * 2 - 1
    const curve = this.curve
    if (curve <= 0.001) return { y: this.rect.y + (t * 0.5 + 0.5) * this.rect.h, scale: 1 }
    const yn = Math.sin(t * curve) / Math.sin(curve)
    const scale = (Math.cos(t * curve) * curve) / Math.sin(curve)
    return { y: this.rect.y + (yn * 0.5 + 0.5) * this.rect.h, scale }
  }

  forEachVisible(visit: (cell: TapeCell, center: number, rowFloat: number) => void): void {
    const base = Math.floor(this.top)
    for (let k = base; k <= base + this.rows; k++) {
      const center = k - this.top + 0.5
      if (center < 0 || center > this.rows) continue
      visit(this.cellAt(k), center, center - 0.5)
    }
  }
}
