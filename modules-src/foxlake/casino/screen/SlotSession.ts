/**
 * Playing one machine: the reels on its screen, the controls, and the
 * presentation of every outcome the math layer returns. Nothing here decides
 * a result; it replays `SpinResult` step by step:
 * - base spin: reels stop (anticipation where a feature is one symbol away),
 *   winning cells pulse, the win counts up;
 * - link Hold & Spin: the board of locked orbs, empty cells respinning, the
 *   respin counter resetting to 3, the GRAND for a full board;
 * - free games (link, gold, collect): the free-game reels, wild 2x/3x badges,
 *   the gold-head meter and converted animals, the Revolution wheel first;
 * - houses: straw, stick and brick frames building up, then the storm blowing
 *   them down tier by tier, each showing its prize;
 * - Cash Collect: the 5x5 board, the collector zone growing with gems;
 * - jackpot pick: 15 tiles turned until one jackpot shows three times.
 */
import { Animation } from '@babylonjs/core/Animations/animation'
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import { CubicEase, EasingFunction } from '@babylonjs/core/Animations/easing'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import type { Scene } from '@babylonjs/core/scene'
import { ReelSet } from './ReelSet'
import { MachineDisplay, money, reelWindow, type PlayInfo } from './MachineDisplay'
import { drawSymbol, roundRect } from './SymbolArt'
import type { CasinoClient } from '../CasinoClient'
import { BET_STEPS } from '../CasinoLayout'
import { METER_FULL, playSpin, type Feature, type HoldSpinStep, type OrbValue, type SpinResult, type SpinStep, type WheelSpin, type WheelWedge } from '../math/machines'
import { cryptoRng } from '../math/rng'

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const HEAD_MARKS = [[4, 'h2'], [7, 'h3'], [13, 'h4'], [15, 'h5']] as const
const TIER_COLOR = ['', '#e8c25a', '#9a6a3a', '#b0402a']
const TIER_NAME = ['', 'STRAW', 'STICK', 'BRICK']

export class SlotSession {
  private reels: ReelSet
  private freeReels: ReelSet | null = null
  private betIndex = 2
  private busy = false
  private win = 0
  private status = 'GOOD LUCK!'
  private message = ''
  private heads: PlayInfo['heads']
  private readonly ui: HTMLElement
  private readonly keyHandler = (e: KeyboardEvent) => this.key(e)
  private closed = false

  constructor(private readonly scene: Scene, private readonly display: MachineDisplay, private readonly client: CasinoClient, private readonly toast: (text: string) => void, private readonly onLeave: () => void) {
    this.reels = this.makeReels(display.def.strips, 'base')
    this.reels.setStops(display.def.strips.map((s) => Math.floor(s.length / 3)))
    this.ui = this.buildUi()
    addEventListener('keydown', this.keyHandler)
    setTimeout(() => {
      if (!this.closed && !this.busy) void this.free
    }, 900)
    this.draw()
    this.display.drawTopper(this.bet)
  }

  private get bet(): number {
    return BET_STEPS[this.betIndex]
  }

  private get def() {
    return this.display.def
  }

  /** The free-games reels, made once (hidden) shortly after sitting down rather than in the middle of a feature. */
  private get free(): ReelSet {
    if (!this.freeReels) {
      this.freeReels = this.makeReels(this.def.freeStrips, 'free')
      this.freeReels.showReels(false)
    }
    return this.freeReels
  }

  private makeReels(strips: string[][], which: 'base' | 'free'): ReelSet {
    if (this.closed) throw new Error('closed')
    const win = reelWindow(this.def.rows)
    const s = this.display.screen
    const W = 0.62
    const H = 0.92
    const cacheKey = `${this.def.id}:${which}`
    const set = new ReelSet(this.scene, s, { cacheKey, rows: this.def.rows, strips, styles: this.display.theme.symbols, width: win.w * W, height: win.h * H, reelBack: this.display.theme.reelBack })
    set.node.position.set(0, H / 2 - (win.y + win.h / 2) * H, -0.004)
    return set
  }

  private draw(): void {
    if (this.closed) return
    const meters = this.def.family === 'collect' ? this.client.meters(this.def.id) : undefined
    this.display.drawPlay({
      credit: this.client.balance, bet: this.bet, win: this.win, status: this.status, message: this.message,
      heads: this.heads,
      meters: this.def.family === 'collect' ? { green: (meters?.green ?? 0) / METER_FULL, pink: (meters?.pink ?? 0) / METER_FULL, blue: (meters?.blue ?? 0) / METER_FULL } : undefined,
    })
    const credit = this.ui.querySelector('[data-credit]')
    if (credit) credit.textContent = this.client.balance === null ? '—' : money(this.client.balance)
    const bet = this.ui.querySelector('[data-bet]')
    if (bet) bet.textContent = money(this.bet)
  }

  private buildUi(): HTMLElement {
    const el = document.createElement('div')
    el.id = 'slot-ui'
    el.dataset.hostModal = '1'
    el.innerHTML = `
      <div class="slot-bar">
        <div class="slot-cell"><span>${this.client.label}</span><b data-credit></b></div>
        <button type="button" data-act="less" aria-label="Lower bet">−</button>
        <div class="slot-cell"><span>BET</span><b data-bet></b></div>
        <button type="button" data-act="more" aria-label="Raise bet">+</button>
        <button type="button" class="spin" data-act="spin">SPIN</button>
        <button type="button" data-act="max">MAX BET</button>
        <button type="button" class="leave" data-act="leave">STAND UP</button>
      </div>
      <p class="slot-help">Space spins · Esc stands up</p>`
    el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act
      if (act === 'spin') void this.spin()
      else if (act === 'less') this.setBet(this.betIndex - 1)
      else if (act === 'more') this.setBet(this.betIndex + 1)
      else if (act === 'max') this.setBet(BET_STEPS.length - 1)
      else if (act === 'leave') this.close()
    })
    document.body.append(el)
    return el
  }

  private setBet(i: number): void {
    if (this.busy) return
    this.betIndex = Math.max(0, Math.min(BET_STEPS.length - 1, i))
    this.display.drawTopper(this.bet)
    this.draw()
  }

  private key(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      e.preventDefault()
      void this.spin()
    } else if (e.code === 'Escape') this.close()
  }

  async spin(): Promise<void> {
    if (this.busy || this.closed) return
    this.busy = true
    this.win = 0
    this.message = ''
    this.status = 'GOOD LUCK!'
    this.heads = undefined
    this.reels.showOverlay(false)
    this.reels.showReels(true)
    this.freeReels?.showReels(false)
    const before = this.client.balance
    try {
      if (this.client.balance !== null) this.client.balance = Math.round((this.client.balance - this.bet) * 100) / 100
      this.draw()
      const r = await this.client.spin(this.def.id, this.bet)
      const settled = this.client.balance
      if (before !== null && settled !== null) this.client.balance = Math.round((before - this.bet) * 100) / 100
      await this.reels.spin(r.base.stops, r.base.anticipation)
      this.paintOrbs(this.reels, r.base)
      await this.showWins(this.reels, r.base)
      if (r.base.morph?.length) this.toast('Revolution! Animals turned into the top animal for this spin.')
      if (r.feature) await this.playFeature(r.feature, r.base)
      this.client.balance = settled
      this.win = r.totalWin
      this.status = r.totalWin > 0 ? (r.totalWin >= this.bet * 20 ? 'BIG WIN!' : 'WINNER!') : 'GOOD LUCK!'
      this.draw()
    } catch (error) {
      if (this.closed) return
      this.client.balance = before
      this.toast((error as Error).message)
      this.draw()
    } finally {
      this.busy = false
    }
  }

  /** Orbs and coins show their values on the reels (link and collector machines). */
  private paintOrbs(set: ReelSet, step: SpinStep): void {
    const orbs = Object.entries(step.orbs ?? {})
    if (!orbs.length) return
    const o = set.overlayContext()
    o.g.clearRect(0, 0, o.w, o.h)
    const style = this.display.theme.symbols.O
    for (const [k, v] of orbs) {
      const [r, row] = k.split(',').map(Number)
      const c = this.cell(set, r, row)
      drawSymbol(c.g, style, c.x, c.y, c.w, c.h, this.orbLabel(v))
    }
    set.showOverlay(true)
  }

  /**
   * Debug and screenshots: plays an unpaid outcome that starts `kind` (found
   * by spinning the math here; no wallet, no server, nothing paid).
   */
  async demo(kind: Feature['kind']): Promise<void> {
    if (this.busy) return
    const rng = cryptoRng()
    let r: SpinResult | null = null
    for (let i = 0; i < 400000 && !r; i++) {
      const x = playSpin(this.def, this.bet, rng, { meters: { green: 0, pink: 0, blue: 0 } })
      if (x.feature?.kind === kind) r = x
    }
    if (!r) return
    this.busy = true
    this.win = 0
    try {
      await this.reels.spin(r.base.stops, r.base.anticipation)
      this.paintOrbs(this.reels, r.base)
      await this.showWins(this.reels, r.base)
      if (r.feature) await this.playFeature(r.feature, r.base)
    } catch {
      /* the player stood up mid-feature */
    } finally {
      this.busy = false
    }
  }

  private async showWins(set: ReelSet, step: SpinStep): Promise<void> {
    if (!step.wins.length) return
    const cells = step.wins.flatMap((w) => w.cells)
    await this.countTo(this.win + step.win, step.win > this.bet * 5 ? 1.4 : 0.6)
    await set.highlight(cells, 1.2)
    set.stopPulse()
  }

  private async countTo(target: number, seconds: number): Promise<void> {
    const start = this.win
    const steps = Math.max(1, Math.round(seconds * 20))
    for (let i = 1; i <= steps && !this.closed; i++) {
      this.win = Math.round((start + ((target - start) * i) / steps) * 100) / 100
      this.draw()
      await wait(50)
    }
    this.win = target
  }

  private async playFeature(f: Feature, base: SpinStep): Promise<void> {
    if (this.closed) return
    if (f.kind === 'holdspin') return this.holdSpin(f, this.reels)
    if (f.kind === 'jackpotpick') return this.jackpotPick(f)
    if (f.kind === 'cashcollect') return this.cashCollect(f)
    if (f.kind === 'houses') return this.houses(f, base)
    return this.freeGames(f)
  }

  // ------------------------------------------------------------ boards on the overlay

  private cell(set: ReelSet, r: number, row: number) {
    const o = set.overlayContext()
    return { g: o.g, x: o.cellX(r), y: o.cellH * row, w: o.cellW, h: o.cellH, o }
  }

  private orbLabel(v: OrbValue): string {
    return 'jackpot' in v ? v.jackpot : money(v.credits)
  }

  private async holdSpin(f: Extract<Feature, { kind: 'holdspin' }>, set: ReelSet): Promise<void> {
    this.status = 'HOLD & SPIN'
    this.message = `${Object.keys(f.start).length} ${this.display.theme.orbName ?? 'ORBS'} LOCKED`
    this.draw()
    await set.highlight(Object.keys(f.start).map((k) => k.split(',').map(Number) as [number, number]), 1.4)
    set.stopPulse()
    const locked = new Map<string, OrbValue>(Object.entries(f.start))
    const orbStyle = this.display.theme.symbols.O
    const paint = (spinning: boolean, flash: Set<string> = new Set()) => {
      const o = set.overlayContext()
      o.g.clearRect(0, 0, o.w, o.h)
      for (let r = 0; r < 5; r++) for (let row = 0; row < this.def.rows; row++) {
        const c = this.cell(set, r, row)
        roundRect(c.g, c.x + 3, c.y + 3, c.w - 6, c.h - 6, 12)
        c.g.fillStyle = '#071226'
        c.g.fill()
        c.g.lineWidth = 3
        c.g.strokeStyle = '#2a4a7a'
        c.g.stroke()
        const v = locked.get(`${r},${row}`)
        if (v) {
          drawSymbol(c.g, orbStyle, c.x, c.y, c.w, c.h, this.orbLabel(v))
          if (flash.has(`${r},${row}`)) {
            c.g.strokeStyle = '#ffffff'
            c.g.lineWidth = 8
            c.g.stroke()
          }
        } else if (spinning) {
          c.g.globalAlpha = 0.35
          drawSymbol(c.g, orbStyle, c.x, c.y + ((Date.now() / 30) % c.h) - c.h / 2, c.w, c.h, '')
          c.g.globalAlpha = 1
        }
      }
      set.showOverlay(true)
    }
    set.showReels(false)
    paint(false)
    for (const step of f.steps as HoldSpinStep[]) {
      if (this.closed) return
      const until = Date.now() + 700
      while (Date.now() < until) {
        paint(true)
        await wait(60)
      }
      const flash = new Set<string>()
      for (const l of step.landed) {
        locked.set(l.cell, l.orb)
        flash.add(l.cell)
        if ('jackpot' in l.orb) this.display.drawTopper(this.bet, l.orb.jackpot)
      }
      paint(false, flash)
      this.status = `RESPINS ${step.left}`
      this.message = step.landed.length ? `+${step.landed.length} · RESET TO 3` : ''
      this.draw()
      await wait(step.landed.length ? 650 : 400)
    }
    if (f.grand) {
      this.display.drawTopper(this.bet, 'GRAND')
      this.message = 'FULL BOARD · GRAND!'
      this.draw()
      await wait(1500)
    }
    this.message = 'COLLECTING'
    await this.countTo(this.win + f.win, 2)
    this.display.drawTopper(this.bet, null)
    set.showOverlay(false)
    set.showReels(true)
  }

  private async freeGames(f: Extract<Feature, { kind: 'freegames' }>): Promise<void> {
    if (f.wheel?.length) await this.wheel(f.wheel)
    if (this.closed) return
    const gold = this.def.family === 'gold' || this.def.family === 'goldwheel'
    const set = this.free
    this.reels.showReels(false)
    set.showReels(true)
    this.message = `${f.awarded} FREE GAMES!`
    this.status = 'FREE GAMES'
    const marks = HEAD_MARKS.map(([at, sym]) => ({ at, glyph: this.display.theme.symbols[sym]?.glyph ?? '★', done: false }))
    if (gold) this.heads = { count: f.startHeads ?? 0, marks: marks.map((m) => ({ ...m, done: (f.startHeads ?? 0) >= m.at })) }
    this.draw()
    await wait(1400)
    let played = 0
    for (const s of f.spins) {
      if (this.closed) return
      played++
      this.status = `FREE GAME ${played} OF ${played + (s.left ?? 0)}`
      this.message = ''
      this.draw()
      set.showOverlay(false)
      await set.spin(s.stops, s.anticipation, true)
      if (!gold) this.paintOrbs(set, s)
      if (gold) {
        this.paintGold(set, s)
        if (s.meter !== undefined) this.heads = { count: s.meter, marks: marks.map((m) => ({ ...m, done: (s.meter ?? 0) >= m.at })) }
        if (s.heads) this.message = `+${s.heads} GOLD HEAD${s.heads > 1 ? 'S' : ''}`
        this.draw()
      }
      if (s.wins.length) {
        await this.countTo(this.win + (s.win - (s.inner?.win ?? 0)), 0.5)
        await set.highlight(s.wins.flatMap((w) => w.cells), 0.9)
        set.stopPulse()
      } else await wait(250)
      if (s.inner?.kind === 'holdspin') await this.holdSpin(s.inner, set)
    }
    this.heads = undefined
    this.message = `FREE GAMES WON ${money(f.win)}`
    this.draw()
    await wait(1600)
    set.showOverlay(false)
    set.showReels(false)
    this.reels.showReels(true)
  }

  private paintGold(set: ReelSet, s: SpinStep): void {
    const o = set.overlayContext()
    o.g.clearRect(0, 0, o.w, o.h)
    const top = this.display.theme.symbols.h1
    const converted = new Set(s.converted ?? [])
    let any = false
    s.grid.forEach((col, r) => col.forEach((sym, row) => {
      const c = this.cell(set, r, row)
      if (converted.has(sym)) {
        drawSymbol(c.g, { ...top, caption: 'GOLD', color: '#b07a08', light: '#fff2b0' }, c.x, c.y, c.w, c.h)
        any = true
      }
      const m = s.wildX?.[`${r},${row}`]
      if (m) {
        c.g.font = `900 ${Math.round(c.h * 0.28)}px "Arial Black",sans-serif`
        c.g.textAlign = 'center'
        c.g.lineWidth = 6
        c.g.strokeStyle = '#3a0a00'
        c.g.strokeText(`x${m}`, c.x + c.w * 0.75, c.y + c.h * 0.22)
        c.g.fillStyle = m === 3 ? '#ff6040' : '#ffe040'
        c.g.fillText(`x${m}`, c.x + c.w * 0.75, c.y + c.h * 0.22)
        any = true
      }
    }))
    set.showOverlay(any)
  }

  private async wheel(spins: WheelSpin[]): Promise<void> {
    const S = 1024
    const tex = new DynamicTexture('wheel', { width: S, height: S }, this.scene, true)
    tex.hasAlpha = true
    const mat = new StandardMaterial('wheel-mat', this.scene)
    mat.disableLighting = true
    mat.emissiveTexture = tex
    mat.opacityTexture = tex
    const disc = CreatePlane('wheel', { size: 0.56 }, this.scene)
    disc.parent = this.display.screen
    disc.position.set(0, 0.02, -0.012)
    disc.material = mat
    const head = this.display.theme.symbols.h1?.glyph ?? '★'
    const label = (w: WheelWedge) => (w.kind === 'credits' ? money(w.credits) : w.kind === 'heads' ? `+${w.heads} ${head}` : w.kind === 'jackpot' ? w.jackpot : 'START')
    const paint = (wedges: WheelWedge[]) => {
      const g = tex.getContext() as CanvasRenderingContext2D
      g.clearRect(0, 0, S, S)
      const n = wedges.length
      wedges.forEach((w, i) => {
        const a0 = (i / n) * Math.PI * 2 - Math.PI / 2
        const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2
        g.beginPath()
        g.moveTo(S / 2, S / 2)
        g.arc(S / 2, S / 2, S * 0.48, a0, a1)
        g.closePath()
        g.fillStyle = w.kind === 'start' ? '#1a8a3a' : w.kind === 'jackpot' ? '#c0202a' : w.kind === 'heads' ? '#b07a08' : i % 2 ? '#2a3a8a' : '#3a2a7a'
        g.fill()
        g.lineWidth = 6
        g.strokeStyle = '#ffe08a'
        g.stroke()
        g.save()
        g.translate(S / 2, S / 2)
        g.rotate((a0 + a1) / 2)
        g.textAlign = 'right'
        g.textBaseline = 'middle'
        g.font = '900 40px "Arial Black",sans-serif'
        g.fillStyle = '#ffffff'
        g.fillText(label(w), S * 0.44, 0)
        g.restore()
      })
      g.beginPath()
      g.arc(S / 2, S / 2, S * 0.08, 0, Math.PI * 2)
      g.fillStyle = '#ffe08a'
      g.fill()
      tex.update(true)
    }
    const pointer = CreatePlane('wheel-pointer', { width: 0.05, height: 0.07 }, this.scene)
    pointer.parent = this.display.screen
    pointer.position.set(0, 0.31, -0.014)
    const pm = new StandardMaterial('wheel-pointer-mat', this.scene)
    pm.disableLighting = true
    pm.emissiveColor = new Color3(1, 0.95, 0.6)
    pointer.material = pm
    this.reels.showReels(false)
    this.status = 'REVOLUTION WHEEL'
    for (let i = 0; i < spins.length && !this.closed; i++) {
      const spin = spins[i]
      if (this.closed) break
      paint(spin.wedges)
      this.message = `SPIN ${i + 1} OF 5`
      this.draw()
      const n = spin.wedges.length
      const target = Math.PI * 2 * 4 + ((spin.landed + 0.5) / n) * Math.PI * 2
      disc.rotation.z = 0
      const anim = new Animation('wheel-spin', 'rotation.z', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
      anim.setKeys([{ frame: 0, value: 0 }, { frame: 180, value: target }])
      const ease = new CubicEase()
      ease.setEasingMode(EasingFunction.EASINGMODE_EASEOUT)
      anim.setEasingFunction(ease)
      const group = new AnimationGroup('wheel', this.scene)
      group.addTargetedAnimation(anim, disc)
      await new Promise<void>((res) => {
        group.onAnimationGroupEndObservable.addOnce(() => res())
        group.play(false)
      })
      group.dispose()
      const w = spin.wedges[spin.landed]
      this.message = w.kind === 'start' ? 'START FREE GAMES!' : w.kind === 'heads' ? `+${w.heads} GOLD HEADS · WHEEL UPGRADES` : `${label(w)} · WHEEL UPGRADES`
      if (w.kind === 'credits' || w.kind === 'jackpot') await this.countTo(this.win + w.credits, 0.8)
      if (w.kind === 'jackpot') this.display.drawTopper(this.bet, w.jackpot)
      this.draw()
      await wait(1100)
    }
    this.display.drawTopper(this.bet, null)
    disc.dispose()
    pointer.dispose()
    mat.dispose()
    pm.dispose()
    tex.dispose()
  }

  private async houses(f: Extract<Feature, { kind: 'houses' }>, base: SpinStep): Promise<void> {
    if (this.closed) return
    const set = this.free
    const frames0: Record<string, number> = {}
    base.grid.forEach((col, r) => col.forEach((s, row) => { if (s === 'H') frames0[`${r},${row}`] = 1 }))
    const paintFrames = (frames: Record<string, number>, prizes: Map<string, string> = new Map(), gone: Set<string> = new Set()) => {
      const o = set.overlayContext()
      o.g.clearRect(0, 0, o.w, o.h)
      for (const [k, tier] of Object.entries(frames)) {
        const [r, row] = k.split(',').map(Number)
        const c = this.cell(set, r, row)
        if (gone.has(k)) {
          c.g.fillStyle = 'rgba(10,8,4,0.8)'
          c.g.fillRect(c.x + 4, c.y + 4, c.w - 8, c.h - 8)
        }
        c.g.lineWidth = 10
        c.g.strokeStyle = TIER_COLOR[tier]
        roundRect(c.g, c.x + 6, c.y + 6, c.w - 12, c.h - 12, 10)
        c.g.stroke()
        c.g.font = `900 ${Math.round(c.h * 0.14)}px "Arial Black",sans-serif`
        c.g.textAlign = 'center'
        c.g.fillStyle = TIER_COLOR[tier]
        c.g.fillText(TIER_NAME[tier], c.x + c.w / 2, c.y + c.h - c.h * 0.1)
        const prize = prizes.get(k)
        if (prize) {
          c.g.font = `900 ${Math.round(c.h * (prize.length > 6 ? 0.18 : 0.24))}px "Arial Black",sans-serif`
          c.g.lineWidth = 6
          c.g.strokeStyle = '#1a0a00'
          c.g.strokeText(prize, c.x + c.w / 2, c.y + c.h / 2)
          c.g.fillStyle = '#fff6a0'
          c.g.fillText(prize, c.x + c.w / 2, c.y + c.h / 2)
        }
      }
      set.showOverlay(true)
    }
    this.status = 'BUILDING FREE GAMES'
    this.message = `${f.awarded} FREE GAMES · ${Object.keys(frames0).length} FRAMES`
    this.draw()
    paintFrames(frames0)
    this.reels.showReels(false)
    set.showReels(true)
    await wait(1400)
    let played = 0
    for (const s of f.spins) {
      if (this.closed) return
      played++
      this.status = `FREE GAME ${played} OF ${played + (s.left ?? 0)}`
      set.showOverlay(false)
      await set.spin(s.stops, s.anticipation, true)
      paintFrames(s.frames ?? {})
      if (s.win > 0) await this.countTo(this.win + s.win, 0.5)
      this.draw()
      await wait(500)
    }
    const frames = f.spins[f.spins.length - 1]?.frames ?? frames0
    const prizes = new Map<string, string>()
    const gone = new Set<string>()
    for (const tier of [1, 2, 3]) {
      this.status = `${TIER_NAME[tier]} HOUSES`
      this.message = 'HUFF... PUFF...'
      this.draw()
      await wait(700)
      for (const rv of f.reveals.filter((x) => x.tier === tier)) {
        prizes.set(rv.cell, rv.jackpot ?? money(rv.credits))
        gone.add(rv.cell)
        if (rv.jackpot) this.display.drawTopper(this.bet, rv.jackpot)
        paintFrames(frames, prizes, gone)
        await this.countTo(this.win + rv.credits, 0.35)
        this.draw()
      }
    }
    this.message = `HOUSES PAID ${money(f.reveals.reduce((a, r) => a + r.credits, 0))}`
    this.draw()
    this.display.drawTopper(this.bet, null)
    await wait(1600)
    set.showOverlay(false)
    set.showReels(false)
    this.reels.showReels(true)
  }

  private async cashCollect(f: Extract<Feature, { kind: 'cashcollect' }>): Promise<void> {
    const set = this.reels
    const o = set.overlayContext()
    const size = Math.min(o.h / 5, o.w / 5)
    const ox = (o.w - size * 5) / 2
    const coin = this.display.theme.symbols.O
    const gem = this.display.theme.symbols.N
    const collector = this.display.theme.symbols.M
    const paint = (step: (typeof f.steps)[number] | null) => {
      o.g.clearRect(0, 0, o.w, o.h)
      o.g.fillStyle = '#04100c'
      o.g.fillRect(ox, 0, size * 5, size * 5)
      for (let r = 0; r < 5; r++) for (let row = 0; row < 5; row++) {
        o.g.strokeStyle = '#1a3a2a'
        o.g.lineWidth = 2
        o.g.strokeRect(ox + r * size + 2, row * size + 2, size - 4, size - 4)
      }
      const z = step?.zone ?? f.steps[0].zone
      roundRect(o.g, ox + z.reel * size, z.row * size, z.size * size, z.size * size, 14)
      o.g.lineWidth = 8
      o.g.strokeStyle = '#ffd040'
      o.g.stroke()
      o.g.globalAlpha = 0.3
      drawSymbol(o.g, collector, ox + z.reel * size, z.row * size, z.size * size, z.size * size)
      o.g.globalAlpha = 1
      if (step) {
        for (const c of step.coins) {
          const [r, row] = c.cell.split(',').map(Number)
          o.g.globalAlpha = c.collected ? 1 : 0.4
          drawSymbol(o.g, coin, ox + r * size, row * size, size, size, money(c.credits))
          o.g.globalAlpha = 1
        }
        for (const g of step.gems) {
          const [r, row] = g.cell.split(',').map(Number)
          drawSymbol(o.g, gem, ox + r * size, row * size, size, size)
        }
      }
      set.showOverlay(true)
    }
    set.showReels(false)
    this.status = 'CASH COLLECT'
    this.message = '5 SPINS'
    paint(null)
    this.draw()
    await wait(1200)
    let collected = 0
    for (const step of f.steps) {
      if (this.closed) return
      paint(step)
      this.status = `SPINS LEFT ${step.left}`
      this.message = step.gems.length ? `+${step.gems.length} GEMS · ZONE ${step.zone.size}x${step.zone.size}` : ''
      await this.countTo(this.win + (step.collected - collected), 0.5)
      collected = step.collected
      this.draw()
      await wait(450)
    }
    this.message = `COLLECTED ${money(f.win)}`
    this.draw()
    await wait(1500)
    set.showOverlay(false)
    set.showReels(true)
  }

  private async jackpotPick(f: Extract<Feature, { kind: 'jackpotpick' }>): Promise<void> {
    const set = this.reels
    const colors: Record<string, string> = { GRAND: '#e0202a', MAJOR: '#7a2ad0', MAXI: '#e08a10', MINOR: '#1a7ad0', MINI: '#20a040' }
    const shown: (string | null)[] = Array(15).fill(null)
    const paint = () => {
      const o = set.overlayContext()
      o.g.clearRect(0, 0, o.w, o.h)
      for (let i = 0; i < 15; i++) {
        const c = this.cell(set, i % 5, Math.floor(i / 5))
        roundRect(c.g, c.x + 6, c.y + 6, c.w - 12, c.h - 12, 14)
        c.g.fillStyle = shown[i] ? colors[shown[i]!] : '#2a2418'
        c.g.fill()
        c.g.lineWidth = 4
        c.g.strokeStyle = '#ffe08a'
        c.g.stroke()
        c.g.textAlign = 'center'
        c.g.textBaseline = 'middle'
        c.g.font = `900 ${Math.round(c.h * 0.2)}px "Arial Black",sans-serif`
        c.g.fillStyle = '#ffffff'
        c.g.fillText(shown[i] ?? '?', c.x + c.w / 2, c.y + c.h / 2)
      }
      set.showOverlay(true)
    }
    set.showReels(false)
    this.status = 'JACKPOT PICK'
    this.message = 'MATCH 3 TO WIN'
    paint()
    this.draw()
    await wait(1000)
    const order = Array.from({ length: 15 }, (_, i) => i).sort((a, b) => ((a * 7 + 3) % 15) - ((b * 7 + 3) % 15))
    for (let i = 0; i < f.tiles.length && !this.closed; i++) {
      shown[order[i]] = f.tiles[i]
      paint()
      await wait(550)
    }
    this.display.drawTopper(this.bet, f.won)
    this.message = `${f.won} JACKPOT!`
    await this.countTo(this.win + f.win, 1.5)
    this.draw()
    await wait(1400)
    this.display.drawTopper(this.bet, null)
    set.showOverlay(false)
    set.showReels(true)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    removeEventListener('keydown', this.keyHandler)
    this.ui.remove()
    this.reels.dispose()
    this.freeReels?.dispose()
    this.display.drawAttract()
    this.display.drawTopper(1, null)
    this.onLeave()
  }
}
