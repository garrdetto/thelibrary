import { winTier, type Tally, type TallyOptions, type WinFx } from '../../_shared/win-fx'
import { HAYWIRE_NAMES, REELS, ROWS, Sym, ZONE_MULTIPLIERS, type JackpotTier } from '../engine/paytable'
import type { CellRef, CollectEvent, JackpotPick, SpinResult } from '../engine/slotEngine'
import { formatShort } from '../format'
import type { SlotAudio } from '../audio/synth'
import { EMBER, GOLD, JADE, VIOLET } from '../render/particles'
import { visualCell, type Scene } from '../render/scene'

export type BannerTone = 'gold' | 'violet' | 'jade' | 'ember'

export interface Banner {
  id: number
  kicker: string
  title: string
  subtitle?: string
  amount?: number
  tone: BannerTone
}

export interface DirectorHooks {
  onWin: (roundTotal: number) => void
  onBanner: (banner: Banner | null) => void
  onRespins: (left: number, reset: boolean) => void
  onAnticipation: (active: boolean) => void
  onPick: (pick: JackpotPick) => Promise<void>
  onGlitch?: (active: boolean) => void
  onFlash?: (tier: JackpotTier | null) => void
  onTally?: (open: boolean) => void
}

const calmMotion = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const HAYWIRE_LINES: Record<'wilds' | 'coins' | 'double', string> = {
  wilds: 'Pyramid Wilds surge onto reels 2 to 4.',
  coins: 'A Sphinx and a storm of Sun Coins hit the reels.',
  double: 'Everything this spin pays is multiplied.',
}

const JACKPOT_LEVEL: Record<JackpotTier, number> = { mini: 1, minor: 1, major: 2, grand: 3 }

export class Director {
  private roundWin = 0
  private bannerId = 0

  constructor(private readonly scene: Scene, private readonly audio: SlotAudio, private readonly hooks: DirectorHooks, private readonly fx: WinFx) {}

  hurry(): void {
    this.scene.hurry()
    this.fx.dismiss()
  }

  get currentRoundWin(): number {
    return this.roundWin
  }

  private add(amount: number): void {
    if (amount <= 0) return
    this.roundWin += amount
    this.hooks.onWin(this.roundWin)
  }

  private async banner(banner: Omit<Banner, 'id'>, seconds: number): Promise<void> {
    this.hooks.onBanner({ ...banner, id: ++this.bannerId })
    await this.scene.wait(seconds, true)
    this.hooks.onBanner(null)
    this.scene.resetHurry()
  }

  private openTally(title: string, options: TallyOptions = {}): Tally {
    this.hooks.onTally?.(true)
    return this.fx.tally(title, options)
  }

  private async settle(tally: Tally, turbo: boolean, lead = 0): Promise<void> {
    if (lead > 0) await this.scene.wait(turbo ? lead * 0.6 : lead, true)
    const hold = turbo ? 900 : 1700
    const done = tally.finish({ hold })
    await this.scene.wait(turbo ? 0.55 : 0.75)
    await Promise.race([done, this.scene.wait(hold / 1000 + 0.2, true)])
    tally.close()
    this.hooks.onTally?.(false)
    this.scene.resetHurry()
  }

  private jackpotFlourish(tier: JackpotTier): void {
    const level = JACKPOT_LEVEL[tier]
    this.audio.jackpot(tier)
    this.scene.celebrate(level, tier === 'grand' ? 6 : 3)
    this.scene.coinFountain(tier === 'grand' ? 140 : level > 1 ? 80 : 50)
    this.hooks.onFlash?.(tier)
  }

  async present(result: SpinResult, turbo: boolean): Promise<void> {
    this.scene.resetHurry()
    this.scene.bet = result.bet
    if (result.mode === 'base') {
      this.roundWin = 0
      this.hooks.onWin(0)
    }
    if (result.mode === 'respin') {
      await this.presentRespin(result, turbo)
    } else {
      await this.presentReels(result, turbo)
    }
    this.scene.resetHurry()
    if (result.state.mode === 'base') await this.finishRound(result, turbo)
  }

  private async presentReels(result: SpinResult, turbo: boolean): Promise<void> {
    const { scene, audio } = this
    let coinsSeen = 0
    audio.spinStart(turbo)
    const glitching = Boolean(result.haywire) && !calmMotion()
    let landed = false
    if (result.haywire) {
      const seconds = turbo ? 0.8 : 1.3
      void scene.wait(turbo ? 0.12 : 0.28).then(() => {
        if (landed) return
        audio.haywire(seconds)
        if (!glitching) return
        scene.glitch(seconds)
        this.hooks.onGlitch?.(true)
      })
    }
    await scene.spinReels(result, {
      turbo,
      onReelStop: (reel, column) => {
        audio.reelStop(reel)
        for (const cell of column) {
          if (cell.sym === Sym.Coin) audio.coinLand(coinsSeen++)
          if (cell.sym === Sym.Sphinx) audio.roar()
        }
        const scatters = result.grid.slice(0, reel + 1).flat().filter((cell) => cell.sym === Sym.Scatter).length
        if (column.some((cell) => cell.sym === Sym.Scatter)) audio.scatterLand(scatters)
        if (reel === REELS - 1) audio.spinStop()
      },
      onAnticipation: (active) => {
        if (active) audio.anticipationStart(turbo ? 1.6 : 2.5)
        else audio.anticipationStop()
        this.hooks.onAnticipation(active)
      },
    })
    landed = true
    audio.spinStop()
    scene.resetHurry()
    if (glitching) {
      scene.stopGlitch()
      this.hooks.onGlitch?.(false)
    }
    if (result.haywire) await this.presentHaywire(result, turbo)

    const lineTotal = result.lineWins.reduce((sum, win) => sum + win.win, 0)
    if (lineTotal > 0) {
      scene.showLines(result.lineWins, turbo ? 0.9 : 1.6)
      audio.lineWin(lineTotal / result.bet)
      for (const win of result.lineWins) {
        const last = win.cells[win.cells.length - 1]
        scene.burst(scene.cellCenter(last[0], last[1]), 'gold', 0.5)
      }
      this.add(lineTotal)
      await scene.wait(turbo ? 0.6 : 1.2, true)
    }

    if (result.scatter.count >= 3) {
      scene.highlight(result.scatter.cells, VIOLET, 2.5)
      for (const [reel, row] of result.scatter.cells) scene.burst(scene.cellCenter(reel, row), 'violet', 1.2)
      this.add(result.scatter.win)
      audio.freeTrigger()
      await scene.wait(turbo ? 0.5 : 0.9, true)
    }

    if (result.collects.length > 0) {
      for (const event of result.collects) await this.presentCollect(result, event, turbo)
    }

    if (result.zoneAfter > result.zoneBefore) {
      audio.zoneGrow()
      scene.setZone(result.zoneAfter, true)
      const multiplier = ZONE_MULTIPLIERS[result.zoneAfter]
      const zoneCenter = scene.zoneRect(result.zoneAfter)
      scene.floatText(`×${multiplier}`, { x: zoneCenter.x + zoneCenter.w / 2, y: zoneCenter.y + zoneCenter.h / 2 }, scene.layout.cell * 0.6, JADE, 1.6)
      await this.banner({ kicker: 'Sphinx Zone grows', title: `ZONE ×${multiplier}`, subtitle: 'Collectors that land inside the zone multiply what they gather.', tone: 'jade' }, turbo ? 1 : 1.6)
    }

    if (result.pick) await this.presentPick(result.pick, turbo)

    if (result.haywire && result.haywire.multiplier > 1) await this.presentMultiplier(result, lineTotal, turbo)

    if (result.trigger === 'respin') {
      await this.startRespins(result, turbo)
      return
    }

    if (result.trigger === 'free') {
      await this.banner({ kicker: 'Temple scatters', title: `${result.freeSpinsAwarded} FREE SPINS`, subtitle: 'Collectors land on reels 3 to 5. Each collect grows the Sphinx Zone.', tone: 'violet' }, 2.4)
      scene.setTheme('free')
      scene.setZone(0, true)
    } else if (result.trigger === 'retrigger') {
      await this.banner({ kicker: 'Retrigger', title: `+${result.freeSpinsAwarded} FREE SPINS`, tone: 'violet' }, 1.8)
    }

    if (result.featureEnd?.kind === 'free') await this.endFree(result.featureEnd.total, turbo)
  }

  private async presentHaywire(result: SpinResult, turbo: boolean): Promise<void> {
    const haywire = result.haywire
    if (!haywire) return
    const { scene, audio } = this
    audio.haywireHit()
    if (haywire.cells.length > 0) {
      scene.highlight(haywire.cells, EMBER, turbo ? 1.6 : 2.3)
      for (const [reel, row] of haywire.cells) scene.burst(scene.cellCenter(reel, row), 'violet', 0.8)
    }
    const name = HAYWIRE_NAMES[haywire.kind]
    const kicker = haywire.kind === 'double' ? `${name} ×${haywire.multiplier}` : name
    await this.banner({ kicker, title: 'HAYWIRE!', subtitle: HAYWIRE_LINES[haywire.kind], tone: 'ember' }, turbo ? 0.7 : 1.1)
  }

  private async presentMultiplier(result: SpinResult, lineTotal: number, turbo: boolean): Promise<void> {
    const haywire = result.haywire
    if (!haywire) return
    const collected = result.collects.reduce((sum, event) => sum + event.amount, 0)
    const shown = lineTotal + (result.scatter.count >= 3 ? result.scatter.win : 0) + collected + (result.pick?.amount ?? 0)
    const extra = result.stepWin - shown
    if (extra <= 0) return
    const { scene, audio } = this
    const { gridX, gridY, gridW, gridH, cell } = scene.layout
    const center = { x: gridX + gridW / 2, y: gridY + gridH / 2 }
    audio.haywireHit()
    scene.floatText(`×${haywire.multiplier}`, center, cell * 0.8, EMBER, 1.4)
    scene.burst(center, 'stars', 1.5)
    this.add(extra)
    await scene.wait(turbo ? 0.35 : 0.6, true)
  }

  private async presentCollect(result: SpinResult, event: CollectEvent, turbo: boolean): Promise<void> {
    const { scene, audio } = this
    const [creel, crow] = event.collector
    const target = scene.cellCenter(creel, crow)
    audio.roar()
    scene.sandStorm()
    scene.highlight([event.collector, ...event.sources], JADE, 6)
    scene.burst(target, 'scarab', 1.4)
    await scene.wait(turbo ? 0.35 : 0.7, true)
    const expanded = event.size > 1 ? scene.expand(event.collector, event.rect, event.size) : -1
    const goal = expanded >= 0 ? scene.expansionCenter(expanded) : target
    const setValue = (value: number) => (expanded >= 0 ? scene.setExpansionValue(expanded, value) : scene.setCellValue(creel, crow, value))
    if (expanded >= 0) {
      audio.roar()
      audio.zoneGrow()
      scene.floatText(`×${event.size}`, goal, scene.layout.cell * 0.7, JADE, 1.4)
      await scene.wait(turbo ? 0.5 : 0.95, true)
    }
    let gathered = 0
    const tally = this.openTally('SPHINX COLLECT', event.size > 1 ? { subtitle: `${event.size}×${event.size} Sphinx` } : {})
    const flights: Promise<void>[] = []
    for (let index = 0; index < event.sources.length; index++) {
      const [reel, row] = event.sources[index]
      const cell = result.grid[reel][row]
      const from = scene.cellCenter(reel, row)
      const jackpot = result.jackpots.find((award) => award.cell?.[0] === reel && award.cell?.[1] === row)
      const flight = scene.fly(from, goal, visualCell(cell, false), turbo ? 0.38 : 0.6).then(() => {
        gathered += cell.value
        setValue(gathered)
        audio.collectTick(index)
        tally.add(cell.value)
        if (jackpot) {
          tally.subtitle(`${jackpot.tier.toUpperCase()} JACKPOT`)
          this.jackpotFlourish(jackpot.tier)
        }
      })
      flights.push(flight)
      await scene.wait(turbo ? 0.08 : 0.16, true)
    }
    await Promise.all(flights)
    let lead = 0
    if (event.multiplier > 1) {
      audio.zoneGrow()
      scene.floatText(`×${event.multiplier}`, { x: goal.x, y: goal.y - scene.layout.cell * 0.2 }, scene.layout.cell * 0.55, JADE, 1.4)
      scene.burst(goal, 'jade', 2)
      await scene.wait(turbo ? 0.35 : 0.7, true)
      setValue(event.amount)
      tally.subtitle(`×${event.multiplier} Sphinx`)
      tally.set(event.amount)
      lead = 0.9
    }
    this.add(event.amount)
    await this.settle(tally, turbo, lead)
    this.hooks.onFlash?.(null)
  }

  private async presentPick(pick: JackpotPick, turbo: boolean): Promise<void> {
    const { scene, audio } = this
    audio.freeTrigger()
    scene.sandStorm()
    scene.celebrate(1, 1.5)
    await this.banner({ kicker: 'The vault stirs', title: 'JACKPOT PICK', subtitle: 'Uncover tiles until three jackpots match. That jackpot is yours.', tone: 'gold' }, turbo ? 1.4 : 2.2)
    await this.hooks.onPick(pick)
    scene.resetHurry()
    this.jackpotFlourish(pick.tier)
    const tally = this.openTally(`${pick.tier.toUpperCase()} JACKPOT`, { subtitle: 'Jackpot Pick' })
    tally.set(pick.amount)
    this.add(pick.amount)
    await this.settle(tally, turbo, 0.9)
    this.hooks.onFlash?.(null)
  }

  private async startRespins(result: SpinResult, turbo: boolean): Promise<void> {
    const { scene, audio } = this
    const coins: CellRef[] = []
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) {
        const sym = result.grid[reel][row].sym
        if (sym === Sym.Coin || sym === Sym.Sphinx) coins.push([reel, row])
      }
    }
    scene.highlight(coins, GOLD, 2.4)
    for (const [reel, row] of coins) scene.burst(scene.cellCenter(reel, row), 'gold', 1)
    audio.respinTrigger()
    await scene.wait(turbo ? 0.6 : 1.1, true)
    await this.banner({ kicker: `${coins.length} sun coins`, title: 'VAULT RESPINS', subtitle: 'Coins lock in place. Every new coin or collector resets the respins to 3. Fill all 15 for the GRAND.', tone: 'gold' }, 2.8)
    await scene.enterCells(result.grid, result.respin?.held ?? [])
    const coinTotal = coins.reduce((sum, [reel, row]) => sum + (result.grid[reel][row].sym === Sym.Coin ? result.grid[reel][row].value : 0), 0)
    for (const [reel, row] of coins) {
      if (result.grid[reel][row].sym !== Sym.Sphinx) continue
      scene.setCellValue(reel, row, coinTotal)
      scene.floatText(formatShort(coinTotal), scene.cellCenter(reel, row), scene.layout.cell * 0.3, JADE, 1.2)
    }
    this.hooks.onRespins(result.respin?.respinsLeft ?? 3, true)
  }

  private async presentRespin(result: SpinResult, turbo: boolean): Promise<void> {
    const { scene, audio } = this
    const respin = result.respin
    if (!respin) return
    let landed = 0
    audio.spinStart(turbo)
    await scene.spinCells(result, {
      turbo,
      onCellStop: (_reel, _row, cell, isNew) => {
        if (!isNew) return
        if (cell.sym === Sym.Sphinx) audio.roar()
        else audio.coinLand(landed++)
      },
    })
    audio.spinStop()
    scene.resetHurry()
    this.hooks.onRespins(respin.respinsLeft, respin.reset)
    if (respin.reset && respin.newCells.length > 0 && !result.featureEnd) audio.respinReset()

    for (const event of result.collects) {
      const [creel, crow] = event.collector
      const target = scene.cellCenter(creel, crow)
      scene.sandStorm()
      scene.burst(target, 'scarab', 1.5)
      await scene.wait(turbo ? 0.3 : 0.6, true)
      const flights = event.sources.map(([reel, row], index) =>
        scene.wait(index * (turbo ? 0.05 : 0.1), true).then(() =>
          scene.fly(scene.cellCenter(reel, row), target, visualCell(result.grid[reel][row], true), turbo ? 0.35 : 0.55, 0.45).then(() => audio.collectTick(index)),
        ),
      )
      await Promise.all(flights)
      scene.setCellValue(creel, crow, event.base)
      scene.floatText(formatShort(event.base), target, scene.layout.cell * 0.3, JADE, 1.2)
    }

    const end = result.featureEnd
    if (!end || end.kind !== 'respin') {
      await scene.wait(turbo ? 0.15 : 0.35, true)
      return
    }

    if (end.grand) {
      this.jackpotFlourish('grand')
      await this.banner({ kicker: 'All 15 spaces filled', title: 'GRAND', subtitle: 'The whole vault is yours.', tone: 'ember' }, turbo ? 1.4 : 2.4)
    }
    const meter = scene.meterPoint()
    let tallied = 0
    const order: CellRef[] = []
    for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) {
      const sym = result.grid[reel][row].sym
      if (sym === Sym.Coin || sym === Sym.Sphinx) order.push([reel, row])
    }
    const tally = this.openTally('VAULT WIN', { subtitle: `Counting ${order.length} coins` })
    for (const [reel, row] of order) {
      const cell = result.grid[reel][row]
      const award = result.jackpots.find((item) => item.cell?.[0] === reel && item.cell?.[1] === row)
      await scene.fly(scene.cellCenter(reel, row), meter, visualCell(cell, true), turbo ? 0.22 : 0.38, 0.5)
      this.add(cell.value)
      tally.add(cell.value)
      tallied += cell.value
      scene.setCellValue(reel, row, 0)
      if (award) {
        tally.subtitle(`${award.tier.toUpperCase()} JACKPOT`)
        this.jackpotFlourish(award.tier)
        await scene.wait(turbo ? 0.35 : 0.7, true)
      }
    }
    const grand = result.stepWin - tallied
    if (grand > 0) {
      await scene.wait(turbo ? 0.2 : 0.4, true)
      tally.subtitle('+ GRAND JACKPOT')
      this.audio.zoneGrow()
      this.scene.coinFountain(120)
      this.hooks.onFlash?.('grand')
      this.add(grand)
      tally.add(grand)
    } else {
      tally.subtitle('Vault Respins complete')
    }
    await this.settle(tally, turbo, 0.5)
    this.hooks.onFlash?.(null)
    await scene.exitCells(result.grid)
    if (result.state.mode === 'free') {
      scene.setTheme('free')
      if (result.state.freeSpinsLeft === result.state.freeSpinsTotal && result.state.freeTotal === 0) {
        await this.banner({ kicker: 'Temple scatters', title: `${result.state.freeSpinsLeft} FREE SPINS`, subtitle: 'Collectors land on reels 3 to 5. Each collect grows the Sphinx Zone.', tone: 'violet' }, 2.4)
      }
      scene.setZone(result.state.zoneLevel, true)
      return
    }
    scene.setTheme('base')
    scene.setZone(0, false)
    if (end.closesFree !== null) await this.endFree(end.closesFree, turbo)
  }

  private async endFree(total: number, turbo: boolean): Promise<void> {
    this.scene.setZone(0, false)
    this.scene.setTheme('base')
    this.scene.coinFountain(40)
    const tally = this.openTally('TEMPLE TOTAL', { subtitle: 'Free spins complete' })
    tally.set(total)
    await this.settle(tally, turbo, 0.9)
  }

  private async finishRound(result: SpinResult, turbo: boolean): Promise<void> {
    const tier = winTier(this.roundWin, result.bet)
    if (!tier) return
    const level = tier === 'huge' ? 3 : 1
    this.scene.celebrate(level, 3 + level)
    this.scene.coinFountain(40 + level * 40)
    await this.fx.celebrate(this.roundWin, result.bet, { turbo })
    this.scene.stopCelebration()
    this.scene.resetHurry()
  }
}
