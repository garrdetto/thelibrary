/** The HTML/CSS layer over the canvas: player cards (score, legs and sets, average, darts left as dots, Cricket marks), the current turn's darts with a checkout route, the launch-speed meter, big announcements ("Bust!", "Triple 20!", "Winner!"), and the lobby and results panels. */
import './overlay.css'
import { config } from '../config'
import { label } from '../shared/Board'
import type { Announcement, DartThrow, GameState, Player, RoomPlayerView } from '../shared/interfaces'
import { IDEAL_SPEED, METER } from '../shared/Physics'
import { CRICKET_TARGETS, DARTS_PER_TURN, checkoutRoute, currentPlayer, modeLabel, standings } from '../shared/Rules'

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function playerColor(state: GameState, playerId: string): string {
  const index = Math.max(0, state.players.findIndex((player) => player.id === playerId))
  return config.dart.flightColors[index % config.dart.flightColors.length]
}

/** The meter's zones come from the physics so what you see is what the throw uses: the whole good band (green fading to yellow) and its solid green "Perfect" centre. */
const BAND = METER.band
const PERFECT = METER.perfect

function meterRange(): { low: number; high: number } {
  return { low: IDEAL_SPEED * config.gesture.chargeLow, high: IDEAL_SPEED * config.gesture.chargeHigh }
}

const MARK_GLYPHS = ['', '/', 'X', 'Ⓧ']

export class Overlay {
  readonly hud = el<HTMLDivElement>('hud')
  readonly menu = el<HTMLDivElement>('menu')
  readonly lobby = el<HTMLDivElement>('lobby')
  readonly results = el<HTMLDivElement>('results')
  readonly pause = el<HTMLDivElement>('pause')
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
  private meterSpot = ''

  /** Puts the power meter just right of the board: `x` is the board's right edge and `y` the bull's height on screen in CSS pixels, `boardPx` the board's on-screen diameter. */
  placeMeter(x: number, y: number, boardPx: number): void {
    const width = this.hud.clientWidth
    const height = this.hud.clientHeight
    if (!width || !height) return
    const meterHeight = Math.round(Math.min(height * 0.7, Math.max(140, boardPx * 0.8)))
    const left = Math.round(Math.min(width - 44, Math.max(8, x + 14)))
    const top = Math.round(Math.min(height - meterHeight / 2 - 8, Math.max(meterHeight / 2 + 8, y)))
    const tight = left + 40 + 150 > width
    const spot = `${left}:${top}:${meterHeight}:${tight}`
    if (spot === this.meterSpot) return
    this.meterSpot = spot
    this.meterWrap.style.setProperty('--meter-x', `${left}px`)
    this.meterWrap.style.setProperty('--meter-y', `${top}px`)
    this.meterWrap.style.setProperty('--meter-h', `${meterHeight}px`)
    this.meterWrap.classList.toggle('is-tight', tight)
  }

  constructor() {
    const { low, high } = meterRange()
    const band = BAND * IDEAL_SPEED
    this.meterBand.style.bottom = `${((IDEAL_SPEED - band - low) / (high - low)) * 100}%`
    this.meterBand.style.height = `${((band * 2) / (high - low)) * 100}%`
    const core = (PERFECT / BAND) * 50
    this.meterBand.style.setProperty('--perfect-from', `${50 - core}%`)
    this.meterBand.style.setProperty('--perfect-to', `${50 + core}%`)
    this.setPower(null)
    this.announce.style.setProperty('--announce-ms', `${config.timing.announceMs}ms`)
  }

  show(panel: 'menu' | 'lobby' | 'results' | 'pause' | 'none'): void {
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
    const mine = !localIds || localIds.has(player.id)
    const color = playerColor(state, player.id)
    this.turnName.style.color = color
    this.turnName.textContent =
      state.status === 'finished' ? 'Match over'
      : state.status === 'legOver' ? 'Leg over'
      : statusText ?? (mine ? (state.players.length > 1 ? `${player.name} to throw` : 'Your throw') : `${player.name} is throwing`)
    this.renderThrows(player.currentRoundThrows)
    this.renderCheckout(state, player)
    this.hint.textContent = mine && state.status === 'playing' && !player.cpu ? 'Hold to aim and power up · let go in the green · Space works too' : ''
  }

  private renderCards(state: GameState): void {
    const turnId = state.currentTurnPlayerId
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
    const route = checkoutRoute(player.score, left, rules.doubleOut)
    this.checkout.hidden = !route
    if (route) this.checkout.textContent = `Checkout ${player.score}: ${route.join(' · ')}`
  }

  setPower(speed: number | null): void {
    if (speed === null) {
      this.meter.classList.remove('is-on')
      this.meterFill.style.height = '0px'
      this.meterLabel.textContent = 'Hold to throw'
      this.meterLabel.dataset.zone = 'idle'
      return
    }
    this.meter.classList.add('is-on')
    const { low, high } = meterRange()
    const ratio = (speed - low) / (high - low)
    // The fill's 3 px top line is centred on the true reading so it lines up with the band exactly.
    this.meterFill.style.height = `calc(${Math.max(0, Math.min(1, ratio)) * 100}% + 1.5px)`
    const off = (speed - IDEAL_SPEED) / IDEAL_SPEED
    const zone = Math.abs(off) <= PERFECT ? 'perfect' : Math.abs(off) <= BAND ? 'good' : off < 0 ? 'low' : 'high'
    const words = { perfect: 'Perfect!', good: 'Good', low: 'Low', high: 'High' } as const
    this.meterLabel.dataset.zone = zone
    this.meterLabel.textContent = `${words[zone]} · ${speed.toFixed(1)} m/s`
  }

  /** Queues announcements and shows the most important one of each batch (a win beats a bust beats a 180 beats a single bed). */
  announceAll(list: Announcement[]): void {
    if (!list.length) return
    const rank: Record<Announcement['kind'], number> = {
      matchWon: 10, setWon: 9, legWon: 8, checkout: 7, bust: 7, oneEighty: 6, ton: 5, innerBull: 4, closed: 4, triple: 3, bull: 3, opened: 3, notOpened: 2, double: 2, miss: 1, score: 0,
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
    el('results-winner').textContent = winner ? (state.players.length > 1 ? `${winner.name} wins!` : `Finished: ${winner.score}${state.gameMode === 'x01' ? '' : ' points'}`) : 'Match over'
    el('results-mode').textContent = modeLabel(state.config)
    const table = el<HTMLTableElement>('results-table')
    const head = make('tr')
    const cricket = state.gameMode === 'cricket'
    const columns = cricket ? ['Player', 'Legs', 'Points', 'MPR', 'Marks', 'Darts'] : state.gameMode === 'x01' ? ['Player', 'Legs', '3-dart avg', '180s', 'Best out', 'Darts'] : ['Player', 'Total', '3-dart avg', 'Best turn', 'Bulls', 'Darts']
    for (const column of columns) head.append(make('th', '', column))
    const rows = standings(state).map((player) => {
      const row = make('tr')
      const legs = String(player.stats.legsWon)
      const values = cricket
        ? [player.name, legs, String(player.score), player.stats.average.toFixed(2), String(player.stats.marks), String(player.stats.darts)]
        : state.gameMode === 'x01'
          ? [player.name, legs, player.stats.average.toFixed(1), String(player.stats.oneEighties), player.stats.bestCheckout ? String(player.stats.bestCheckout) : '–', String(player.stats.darts)]
          : [player.name, String(player.score), player.stats.average.toFixed(1), String(player.stats.highestTurn), String(player.stats.bulls), String(player.stats.darts)]
      for (const value of values) row.append(make('td', '', value))
      return row
    })
    table.replaceChildren(head, ...rows)
    el('results-note').textContent = note
    el<HTMLButtonElement>('results-again').hidden = !canRematch
  }
}
