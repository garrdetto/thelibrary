/** The HTML/CSS layer over the canvas: player cards (score, legs and sets, average, darts left as dots, Cricket marks), the current turn's darts with a checkout route, the launch-speed meter, big announcements ("Bust!", "Triple 20!", "Winner!"), and the lobby and results panels. */
import './overlay.css'
import { config } from '../config'
import { label } from '../shared/Board'
import type { Announcement, DartThrow, GameState, Player, RoomPlayerView } from '../shared/interfaces'
import { IDEAL_SPEED, METER, meterZone } from '../shared/Physics'
import { CRICKET_TARGETS, DARTS_PER_TURN, checkoutRoute, currentPlayer, modeLabel, sideName, sideTotals, standings, throwerName } from '../shared/Rules'

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}

const AWARD_LENGTH = 1.6
const HAT_SVG =
  '<svg viewBox="0 0 64 56" aria-hidden="true"><ellipse cx="32" cy="47" rx="30" ry="7" fill="#1747b8"/><path d="M14 46 L17 8 Q32 2 47 8 L50 46 Q32 52 14 46 Z" fill="#2a6dff"/><path d="M15.4 30 Q32 35 48.6 30 L49.2 38 Q32 44 14.8 38 Z" fill="#0d2f86"/><path d="M21 10 Q24 8 27 8 L25 44 Q22 44 19 43 Z" fill="#8fb6ff" opacity=".45"/><ellipse cx="32" cy="8" rx="15" ry="4" fill="#4d8bff"/></svg>'

/** The soft-tip turn awards: LOW TON! and HIGH TON! burst in with a glow, HAT TRICK! drops three blue top hats in above the words. */
function award(kind: 'lowTon' | 'hatTrick' | 'highTon', text: string): HTMLDivElement {
  const box = make('div', `d-award is-${kind}`)
  box.style.setProperty('--award-ms', `${Math.round(config.timing.announceMs * AWARD_LENGTH)}ms`)
  if (kind === 'hatTrick') {
    const hats = make('div', 'd-award-hats')
    for (let i = 0; i < 3; i++) {
      const hat = make('div', 'd-award-hat')
      hat.style.setProperty('--hat-i', String(i))
      hat.innerHTML = HAT_SVG
      hats.append(hat)
    }
    box.append(hats)
  }
  box.append(make('div', 'd-award-text', text))
  return box
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Flight colour per player, or per team in team play so teammates match. */
export function playerColor(state: GameState, playerId: string): string {
  const player = state.players.find((item) => item.id === playerId)
  const index = player?.team ?? Math.max(0, state.players.findIndex((item) => item.id === playerId))
  return config.dart.flightColors[index % config.dart.flightColors.length]
}

/** How far past the yellow (as a fraction of the ideal speed) the meter is fully red. */
const TO_RED = 0.05
/** The green → yellow blend is drawn wider than the zones: yellow starts tinting the green at this fraction of the solid green's half-width, the colour is half-way at `METER.fade`, and green tints the yellow out to `blendEnd()`. Drawing only; the zones are unchanged. */
const BLEND_START = 0.4
const blendEnd = () => METER.fade + (METER.band - METER.fade) * 0.6

function meterRange(): { low: number; high: number } {
  return { low: IDEAL_SPEED * config.gesture.chargeLow, high: IDEAL_SPEED * config.gesture.chargeHigh }
}

/** The side meter's width over the power meter's height, so a fraction of the ideal speed is the same length on both. */
function sideScale(): number {
  return (2 * METER.sideRange) / (config.gesture.chargeHigh - config.gesture.chargeLow)
}

/** Where a side reading (a fraction of the ideal speed, negative left) sits across the side meter, as a CSS percentage. */
function sideAt(fraction: number): string {
  return `${(Math.max(0, Math.min(1, (fraction + METER.sideRange) / (2 * METER.sideRange))) * 100).toFixed(3)}%`
}

/** The side meter's colours, left to right, from the same zones and blend as the power meter. */
function sideGradient(): string {
  const blend = blendEnd()
  const stops: [string, number][] = [
    ['#e8433a', -METER.sideRange], ['#e8433a', -METER.band - TO_RED], ['#ffcf4a', -METER.band], ['#ffcf4a', -blend], ['#90d15a', -METER.fade], ['#22d36a', -METER.perfect * 0.4],
    ['#22d36a', METER.perfect * 0.4], ['#90d15a', METER.fade], ['#ffcf4a', blend], ['#ffcf4a', METER.band], ['#e8433a', METER.band + TO_RED], ['#e8433a', METER.sideRange],
  ]
  return `linear-gradient(to right, ${stops.map(([color, fraction]) => `${color} ${sideAt(fraction)}`).join(', ')})`
}

const MARK_GLYPHS = ['', '/', 'X', 'Ⓧ']

export class Overlay {
  readonly hud = el<HTMLDivElement>('hud')
  readonly menu = el<HTMLDivElement>('menu')
  readonly lobby = el<HTMLDivElement>('lobby')
  readonly results = el<HTMLDivElement>('results')
  readonly pause = el<HTMLDivElement>('pause')
  readonly bracket = el<HTMLDivElement>('bracket')
  private readonly scoreboard = el<HTMLDivElement>('scoreboard')
  private readonly announce = el<HTMLDivElement>('announce')
  private readonly throws = el<HTMLDivElement>('throws')
  private readonly checkout = el<HTMLDivElement>('checkout')
  private readonly hint = el<HTMLDivElement>('hint')
  private readonly turnName = el<HTMLDivElement>('turn-name')
  private readonly meter = el<HTMLDivElement>('meter')
  private readonly meterFill = el<HTMLDivElement>('meter-fill')
  private readonly meterBand = el<HTMLDivElement>('meter-band')
  private readonly meterLabel = el<HTMLDivElement>('meter-label')
  private readonly modeChip = el<HTMLSpanElement>('mode-chip')
  private readonly roomChip = el<HTMLSpanElement>('room-chip')
  private announceTimer: ReturnType<typeof setTimeout> | null = null
  private queue: Announcement[] = []

  private readonly meterWrap = el<HTMLDivElement>('meter-wrap')
  private readonly hmeter = el<HTMLDivElement>('hmeter')
  private readonly hmeterMark = el<HTMLDivElement>('hmeter-mark')
  private meterSpot = ''
  private cross = false
  private sideShown = ''
  private fillShown = ''
  private labelShown = ''

  /** Puts the power meter just right of the board: `x` is the board's right edge and `y` the bull's height on screen in CSS pixels, `boardPx` the board's on-screen diameter. */
  placeMeter(x: number, y: number, boardPx: number, width: number, height: number): void {
    if (!width || !height) return
    const meterHeight = Math.round(Math.min(height * 0.7, Math.max(140, boardPx * 0.8)))
    const half = this.cross ? ((meterHeight - 12) * sideScale() + 12) / 2 : 17
    const left = Math.round(Math.min(width - 27 - half, Math.max(8, x + 14 + half - 17)))
    const top = Math.round(Math.min(height - meterHeight / 2 - 8, Math.max(meterHeight / 2 + 8, y)))
    const tight = left + 23 + half + 150 > width
    const spot = `${left}:${top}:${meterHeight}:${tight}:${this.cross}`
    if (spot === this.meterSpot) return
    this.meterSpot = spot
    this.meterWrap.style.setProperty('--meter-x', `${left}px`)
    this.meterWrap.style.setProperty('--meter-y', `${top}px`)
    this.meterWrap.style.setProperty('--meter-h', `${meterHeight}px`)
    this.meterWrap.style.setProperty('--h-half', `${half}px`)
    this.meterWrap.classList.toggle('is-tight', tight)
  }

  constructor() {
    const { low, high } = meterRange()
    const at = (fraction: number) => `${Math.max(0, Math.min(100, ((IDEAL_SPEED * (1 + fraction) - low) / (high - low)) * 100))}%`
    const style = this.meterBand.style
    style.bottom = '0'
    style.height = '100%'
    style.setProperty('--red-lo', at(-METER.band - TO_RED))
    style.setProperty('--band-lo', at(-METER.band))
    style.setProperty('--perfect-lo', at(-METER.perfect))
    style.setProperty('--perfect-hi', at(METER.perfect))
    style.setProperty('--blend-lo', at(-METER.perfect * BLEND_START))
    style.setProperty('--blend-hi', at(METER.perfect * BLEND_START))
    style.setProperty('--fade-lo', at(-METER.fade))
    style.setProperty('--fade-hi', at(METER.fade))
    style.setProperty('--tail-lo', at(-blendEnd()))
    style.setProperty('--tail-hi', at(blendEnd()))
    style.setProperty('--exact-lo', at(-METER.perfect * METER.exact))
    style.setProperty('--exact-hi', at(METER.perfect * METER.exact))
    const sideBand = el<HTMLDivElement>('hmeter-band').style
    sideBand.background = sideGradient()
    sideBand.setProperty('--exact-lo', sideAt(-METER.perfect * METER.exact))
    sideBand.setProperty('--exact-hi', sideAt(METER.perfect * METER.exact))
    this.meterWrap.style.setProperty('--h-scale', String(sideScale()))
    this.meterWrap.style.setProperty('--green-at', String((IDEAL_SPEED - low) / (high - low)))
    style.setProperty('--band-hi', at(METER.band))
    style.setProperty('--red-hi', at(METER.band + TO_RED))
    this.setPower(null)
    this.announce.style.setProperty('--announce-ms', `${config.timing.announceMs}ms`)
  }

  show(panel: 'menu' | 'lobby' | 'results' | 'pause' | 'bracket' | 'none'): void {
    this.bracket.hidden = panel !== 'bracket'
    this.menu.hidden = panel !== 'menu'
    this.lobby.hidden = panel !== 'lobby'
    this.results.hidden = panel !== 'results'
    this.pause.hidden = panel !== 'pause'
  }

  setRoom(code: string | null): void {
    this.roomChip.hidden = !code
    this.roomChip.textContent = code ? `Room ${code}` : ''
  }

  render(state: GameState, localIds: ReadonlySet<string> | null, statusText?: string): void {
    this.hud.hidden = false
    this.modeChip.textContent = modeLabel(state.config)
    this.renderCards(state)
    const player = currentPlayer(state)
    const mine = (!localIds || localIds.has(player.id)) && !player.cpu
    const color = playerColor(state, player.id)
    const who = player.thrower ? `${player.thrower} (${player.name})` : player.teamName ? `${player.name} (${player.teamName})` : player.name
    this.turnName.style.color = color
    this.turnName.textContent =
      state.status === 'finished' ? 'Match over'
      : state.status === 'legOver' ? 'Leg over'
      : statusText ?? (mine ? (state.players.length > 1 || player.members ? `${who} to throw` : 'Your throw') : `${who} is throwing`)
    this.renderThrows(player.currentRoundThrows)
    this.renderCheckout(state, player)
    this.hint.textContent = mine && state.status === 'playing' && !player.cpu ? (this.cross ? 'Hold to aim, let go in the green for height · click again in the green for line · Space works too' : 'Hold to aim and power up · let go in the green · Space works too') : ''
  }

  private renderCards(state: GameState): void {
    const turnId = state.currentTurnPlayerId
    this.scoreboard.classList.toggle('is-compact', state.players.length > 4)
    const totals = state.config.teamPlay === 'regular' && state.gameMode !== 'x01' ? sideTotals(state) : []
    this.scoreboard.replaceChildren(
      ...state.players.map((player) => {
        const card = make('div', `d-card${player.id === turnId && state.status !== 'finished' ? ' is-turn' : ''}`)
        card.style.setProperty('--card-color', playerColor(state, player.id))
        const head = make('div', 'd-card-head')
        const dot = make('span', `d-dot${player.connectionStatus === 'away' ? ' is-away' : player.cpu ? ' is-cpu' : ''}`)
        dot.title = player.connectionStatus === 'away' ? 'Reconnecting' : player.cpu ? 'Computer' : 'Here'
        head.append(dot, make('span', 'd-card-name', player.name))
        if (player.id === turnId && state.status === 'playing') {
          const darts = make('span', 'd-darts')
          darts.setAttribute('aria-label', `${DARTS_PER_TURN - player.currentRoundThrows.length} darts left`)
          for (let i = 0; i < DARTS_PER_TURN; i++) darts.append(make('i', i < player.currentRoundThrows.length ? 'is-used' : ''))
          head.append(darts)
        }
        card.append(head)
        const score = make('div', 'd-card-score', String(player.score))
        if (state.gameMode === 'x01' && !player.opened) score.title = 'Needs a double to start'
        card.append(score)
        const meta = make('div', 'd-card-meta')
        if (state.config.setsToWin > 1) meta.append(make('span', '', `Sets ${state.sets.won[player.id] ?? 0}`))
        if (state.config.legsPerSet > 1 || state.config.setsToWin > 1) meta.append(make('span', '', `Legs ${state.legs.won[player.id] ?? 0}`))
        meta.append(make('span', '', state.gameMode === 'cricket' ? `MPR ${player.stats.average.toFixed(2)}` : `Avg ${player.stats.average.toFixed(1)}`))
        if (state.gameMode === 'x01' && !player.opened) meta.append(make('span', '', 'needs a double'))
        if (player.members) meta.append(make('span', 'd-card-team', `Up: ${throwerName(player)}`))
        else if (player.teamName) {
          const total = totals.find((side) => side.player.team === player.team)
          meta.append(make('span', 'd-card-team', total ? `${player.teamName} ${total.score}` : player.teamName))
        }
        card.append(meta)
        if (state.gameMode === 'cricket') {
          const marks = make('div', 'd-marks')
          for (const target of CRICKET_TARGETS) {
            const cell = make('div', `d-mark${player.marks[target] >= 3 ? ' is-closed' : ''}`)
            cell.append(make('b', '', MARK_GLYPHS[Math.min(3, player.marks[target])]), document.createTextNode(target === 25 ? 'B' : String(target)))
            marks.append(cell)
          }
          card.append(marks)
        }
        return card
      }),
    )
  }

  private renderThrows(darts: DartThrow[]): void {
    const cells: HTMLElement[] = []
    for (let i = 0; i < DARTS_PER_TURN; i++) {
      const dart = darts[i]
      if (!dart) {
        cells.push(make('div', 'd-throw is-empty', '–'))
        continue
      }
      const kind = dart.sector === 25 ? ' is-bull' : dart.multiplier === 3 ? ' is-triple' : dart.multiplier === 2 ? ' is-double' : ''
      cells.push(make('div', `d-throw${kind}`, label(dart)))
    }
    this.throws.replaceChildren(...cells)
  }

  private renderCheckout(state: GameState, player: Player): void {
    const rules = state.config.rules
    if (rules.mode !== 'x01' || state.status !== 'playing' || !player.opened) {
      this.checkout.hidden = true
      return
    }
    const left = DARTS_PER_TURN - player.currentRoundThrows.length
    const route = checkoutRoute(player.score, left, rules.doubleOut, !!rules.masterOut)
    this.checkout.hidden = !route
    if (route) this.checkout.textContent = `Checkout ${player.score}: ${route.join(' · ')}`
  }

  setPower(speed: number | null): void {
    if (speed === null) {
      if (this.labelShown === 'idle') return
      this.labelShown = 'idle'
      this.fillShown = '0px'
      this.meter.classList.remove('is-on')
      this.meterFill.style.height = '0px'
      this.meterLabel.textContent = 'Hold to throw'
      this.meterLabel.dataset.zone = 'idle'
      return
    }
    if (!this.meter.classList.contains('is-on')) this.meter.classList.add('is-on')
    const { low, high } = meterRange()
    const ratio = (speed - low) / (high - low)
    const fill = `calc(${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(2)}% + 1.5px)`
    if (fill !== this.fillShown) {
      this.fillShown = fill
      this.meterFill.style.height = fill
    }
    const zone = meterZone(speed)
    const words = { perfect: 'Perfect!', green: 'Great', yellow: 'Good', low: 'Low', high: 'High' } as const
    const label = `${words[zone]} · ${speed.toFixed(1)} m/s`
    if (label !== this.labelShown) {
      this.labelShown = label
      this.meterLabel.dataset.zone = zone
      this.meterLabel.textContent = label
    }
  }

  /** Turns the cross meter on or off: a side meter crossing the power meter at the green. Off is the classic one-stage meter, which the administrator can offer (`meter.classic` in shared/Settings). */
  setCross(on: boolean): void {
    if (on === this.cross) return
    this.cross = on
    this.hmeter.hidden = !on
    this.meterWrap.classList.toggle('is-cross', on)
    this.meterSpot = ''
  }

  /** The side meter's live reading (a fraction of the ideal speed, negative left), or null when it isn't sweeping. */
  setSide(side: number | null): void {
    if (side === null) {
      this.meterWrap.classList.remove('is-sweep')
      this.sideShown = ''
      return
    }
    this.meterWrap.classList.add('is-sweep')
    const left = sideAt(side)
    if (left !== this.sideShown) {
      this.sideShown = left
      this.hmeterMark.style.left = left
    }
    const zone = meterZone(IDEAL_SPEED * (1 + Math.abs(side)))
    const words = { perfect: 'Perfect!', green: 'Great', yellow: 'Good', low: 'Wide', high: 'Wide' } as const
    const label = `${words[zone]} · ${zone === 'perfect' ? 'centre' : side < 0 ? 'left' : 'right'}`
    if (label !== this.labelShown) {
      this.labelShown = label
      this.meterLabel.dataset.zone = zone === 'high' ? 'low' : zone
      this.meterLabel.textContent = label
    }
  }

  /** Queues announcements and shows the most important one of each batch (a win beats a bust beats a 180 beats a single bed). */
  announceAll(list: Announcement[]): void {
    if (!list.length) return
    const rank: Record<Announcement['kind'], number> = {
      matchWon: 10, setWon: 9, legWon: 8, checkout: 7, bust: 7, oneEighty: 6, hatTrick: 6, highTon: 6, ton: 5, lowTon: 5, innerBull: 4, closed: 4, triple: 3, bull: 3, opened: 3, notOpened: 2, double: 2, miss: 1, score: 0,
    }
    const best = [...list].sort((a, b) => rank[b.kind] - rank[a.kind])[0]
    if (rank[best.kind] === 0 && best.text.length < 4) return
    this.queue.push(best)
    if (!this.announceTimer) this.next()
  }

  private next(): void {
    const item = this.queue.shift()
    if (!item) {
      this.announceTimer = null
      return
    }
    if (item.kind === 'lowTon' || item.kind === 'hatTrick' || item.kind === 'highTon') {
      this.announce.replaceChildren(award(item.kind, item.text))
      const wait = this.queue.length ? config.timing.announceMs : config.timing.announceMs * AWARD_LENGTH
      this.announceTimer = setTimeout(() => this.next(), wait)
      return
    }
    const span = make('span', '', item.text)
    if (item.kind === 'bust') span.classList.add('is-bust')
    else if (item.kind === 'matchWon' || item.kind === 'legWon' || item.kind === 'setWon' || item.kind === 'checkout') span.classList.add('is-win')
    else if (item.kind === 'oneEighty' || item.kind === 'ton' || item.kind === 'triple' || item.kind === 'innerBull') span.classList.add('is-big')
    this.announce.replaceChildren(span)
    const wait = this.queue.length ? config.timing.announceMs * 0.6 : config.timing.announceMs
    this.announceTimer = setTimeout(() => this.next(), wait)
  }

  renderLobby(code: string, mode: string, players: RoomPlayerView[], you: string, host: boolean, note: string): void {
    el('lobby-code').textContent = code
    el('lobby-mode').textContent = mode
    el('lobby-players').replaceChildren(
      ...players.map((player) => {
        const item = make('li')
        item.append(make('span', `d-dot${player.connected ? '' : ' is-away'}`), make('span', 'd-card-name', `${player.name}${player.id === you ? ' (you)' : ''}`))
        if (player.host) item.append(make('span', 'd-chip', 'Host'))
        return item
      }),
    )
    el('lobby-note').textContent = note
    el<HTMLButtonElement>('lobby-start').hidden = !host
    el<HTMLButtonElement>('lobby-start').disabled = players.filter((player) => player.connected).length < 2
  }

  lobbyError(message: string): void {
    el('lobby-error').textContent = message
  }

  renderResults(state: GameState, note: string, canRematch: boolean): void {
    const winner = state.players.find((player) => player.id === state.winnerId)
    el('results-winner').textContent = winner ? (state.players.length > 1 ? `${sideName(winner)} wins!` : `Finished: ${winner.score}${state.gameMode === 'x01' ? '' : ' points'}`) : 'Match over'
    el('results-mode').textContent = modeLabel(state.config)
    const table = el<HTMLTableElement>('results-table')
    const head = make('tr')
    const cricket = state.gameMode === 'cricket'
    const columns = cricket ? ['Player', 'Legs', 'Points', 'MPR', 'Marks', 'Darts'] : state.gameMode === 'x01' ? ['Player', 'Legs', '3-dart avg', '180s', 'Best out', 'Darts'] : ['Player', 'Total', '3-dart avg', 'Best turn', 'Bulls', 'Darts']
    for (const column of columns) head.append(make('th', '', column))
    const rows = standings(state).map((player) => {
      const row = make('tr')
      const legs = String(player.stats.legsWon)
      const name = player.members ? `${player.name} (${player.members.map((member) => member.name).join(' & ')})` : player.teamName ? `${player.name} · ${player.teamName}` : player.name
      const values = cricket
        ? [name, legs, String(player.score), player.stats.average.toFixed(2), String(player.stats.marks), String(player.stats.darts)]
        : state.gameMode === 'x01'
          ? [name, legs, player.stats.average.toFixed(1), String(player.stats.oneEighties), player.stats.bestCheckout ? String(player.stats.bestCheckout) : '–', String(player.stats.darts)]
          : [name, String(player.score), player.stats.average.toFixed(1), String(player.stats.highestTurn), String(player.stats.bulls), String(player.stats.darts)]
      for (const value of values) row.append(make('td', '', value))
      return row
    })
    table.replaceChildren(head, ...rows)
    el('results-note').textContent = note
    el<HTMLButtonElement>('results-again').hidden = !canRematch
  }
}
