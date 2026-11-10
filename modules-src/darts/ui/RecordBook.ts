/** The record book on the page: the setup form's per-board, per-format board (fewest darts or highest Count Up with how many times each player hit their best, plus the top five all-time averages), the in-match "All-Time Averages" panel at the lower right, and saving a local player's finished legs and matches to `/api/darts-records` (online rooms save their own results on the server). */
import type { BoardKind, GameState } from '../shared/interfaces'
import {
  AVERAGE_MIN_DARTS,
  BOARD_NAMES,
  MODE_NAMES,
  RECORD_LIMITS,
  averageMode,
  averageUnit,
  boardOf,
  formatAverage,
  matchAverages,
  type AverageMode,
  type LegResult,
  type MatchAverage,
  type RecordMode,
} from '../shared/Records'

const API = '/api/darts-records'
const BOARD_TTL_MS = 30_000
const RETRY_MS = [3000, 10_000, 30_000]

export interface BookEntry { username: string; value: number; times: number; date: string }
export interface AverageEntry { username: string; darts: number; total: number; matches: number; average: number }
export interface BookData {
  board: BoardKind
  mode: RecordMode
  records: BookEntry[]
  averages: AverageEntry[]
  you: { best: number | null; times: number; darts: number; total: number; matches: number } | null
  signedIn: boolean
  username: string | null
}
type Totals = { darts: number; total: number; matches: number }

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function runId(): string {
  return crypto.randomUUID()
}

function recordText(mode: RecordMode, value: number): string {
  return mode === 'countup' ? `${value.toLocaleString()} pts` : `${value} darts`
}

export interface AverageRow {
  name: string
  color: string
  /** All-time value including this match when it counts; null for someone with nothing saved (a guest or the computer). */
  allTime: string | null
  match: string
  live: boolean
}

export class RecordBook {
  private readonly cache = new Map<string, { at: number; data: Promise<BookData | null> }>()
  private readonly stored = new Map<string, Totals>()
  private storedKey = ''
  private storedLoading: Promise<void> | null = null
  private shownKey = ''
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly controller = new AbortController()
  username: string | null = null
  signedIn = false
  private hudKey = ''
  /** Called when saved averages arrive, so the panel can redraw. */
  onChange: (() => void) | null = null

  constructor(
    private readonly panel: HTMLElement,
    private readonly hud: HTMLElement,
  ) {}

  private load(board: BoardKind, mode: RecordMode, fresh = false): Promise<BookData | null> {
    const key = `${board}:${mode}`
    const hit = this.cache.get(key)
    if (hit && !fresh && performance.now() - hit.at < BOARD_TTL_MS) return hit.data
    const data = fetch(`${API}?board=${board}&mode=${mode}`, { credentials: 'same-origin', signal: this.controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<BookData>) : null))
      .then((book) => {
        if (book) {
          this.username = book.username
          this.signedIn = book.signedIn
        }
        return book
      })
      .catch(() => null)
    this.cache.set(key, { at: performance.now(), data })
    return data
  }

  /** Fills the setup form's record book for a board and format (`mode` null hides it: 701 and the off-standard formats keep no records). */
  async show(board: BoardKind, mode: RecordMode | null, fresh = false): Promise<void> {
    const key = mode ? `${board}:${mode}` : ''
    this.shownKey = key
    this.panel.hidden = !mode
    if (!mode) return
    if (!this.panel.childElementCount || fresh) this.panel.replaceChildren(make('p', 'd-book-note', 'Loading the record book…'))
    const book = await this.load(board, mode, fresh)
    if (this.shownKey !== key) return
    this.panel.replaceChildren(...this.bookNodes(board, mode, book))
  }

  private bookNodes(board: BoardKind, mode: RecordMode, book: BookData | null): HTMLElement[] {
    const nodes: HTMLElement[] = []
    const fewest = RECORD_LIMITS[mode].order === 'asc'
    nodes.push(make('div', 'd-book-title', `${MODE_NAMES[mode]} · ${BOARD_NAMES[board]}`))
    if (!book) {
      nodes.push(make('p', 'd-book-note', 'The record book could not be loaded right now.'))
      return nodes
    }
    const columns = make('div', 'd-book-cols')
    const best = make('div', 'd-book-col')
    best.append(make('h3', '', fewest ? 'Fewest darts' : 'Highest totals'))
    if (!book.records.length) best.append(make('p', 'd-book-note', fewest ? 'No legs saved yet. Finish one to set the mark.' : 'No totals saved yet.'))
    else {
      const list = make('ol', 'd-book-list')
      book.records.forEach((entry, index) => {
        const item = make('li', entry.username === book.username ? 'is-you' : '')
        item.append(make('span', 'd-book-rank', String(index + 1)), make('span', 'd-book-name', entry.username), make('span', 'd-book-value', recordText(mode, entry.value)))
        const times = make('span', 'd-book-times', entry.times > 1 ? `×${entry.times}` : '')
        times.title = entry.times > 1 ? `Done ${entry.times} times` : 'Done once'
        item.append(times)
        list.append(item)
      })
      best.append(list)
    }
    columns.append(best)
    const average = mode === 'countup' ? null : (mode as AverageMode)
    if (average) {
      const col = make('div', 'd-book-col')
      col.append(make('h3', '', `All-time averages (${averageUnit(average)})`))
      if (!book.averages.length) col.append(make('p', 'd-book-note', `No one has ${AVERAGE_MIN_DARTS} counted darts here yet.`))
      else {
        const list = make('ol', 'd-book-list')
        book.averages.forEach((entry, index) => {
          const item = make('li', entry.username === book.username ? 'is-you' : '')
          item.append(make('span', 'd-book-rank', String(index + 1)), make('span', 'd-book-name', entry.username), make('span', 'd-book-value', entry.average.toFixed(2)))
          const darts = make('span', 'd-book-times', `${entry.darts.toLocaleString()}d`)
          darts.title = `${entry.darts.toLocaleString()} darts over ${entry.matches} ${entry.matches === 1 ? 'match' : 'matches'}`
          item.append(darts)
          list.append(item)
        })
        col.append(list)
      }
      columns.append(col)
    }
    nodes.push(columns)
    const you = book.you
    if (you) {
      const parts: string[] = []
      parts.push(you.best !== null ? `Your best: ${recordText(mode, you.best)}${you.times > 1 ? ` (×${you.times})` : ''}` : 'No best saved yet')
      if (average) parts.push(you.darts ? `your average ${formatAverage(average, you.darts, you.total)} ${averageUnit(average)} over ${you.darts.toLocaleString()} darts` : 'no counted average yet')
      nodes.push(make('p', 'd-book-you', parts.join(' · ')))
    } else nodes.push(make('p', 'd-book-note', 'Sign in to the library to put your legs in the record book.'))
    nodes.push(make('p', 'd-book-note', average
      ? `Every leg counts, alone, against anyone or in a tournament (team matches don't). Averages count when two people play each other, or against the Pro computer.`
      : `Eight-round Count Up totals count, alone or against anyone (team matches don't).`))
    return nodes
  }

  private post(body: Record<string, unknown>, attempt = 0): void {
    const send = () =>
      fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
        .then((response) => {
          if (response.ok || response.status === 400 || response.status === 401 || response.status === 403) return
          throw new Error(`HTTP ${response.status}`)
        })
        .catch(() => {
          if (attempt >= RETRY_MS.length) return
          const timer = setTimeout(() => {
            this.timers.delete(timer)
            this.post(body, attempt + 1)
          }, RETRY_MS[attempt])
          this.timers.add(timer)
        })
    void send()
  }

  /** Saves the signed-in player's results from a leg that just ended. */
  saveLegs(state: GameState, results: LegResult[], playerId: string): void {
    if (!this.signedIn) return
    const board = boardOf(state.config)
    for (const result of results) {
      if (result.playerId !== playerId) continue
      this.post({ action: 'leg', board, mode: result.mode, value: result.value, run: runId() })
      this.cache.delete(`${board}:${result.mode}`)
    }
  }

  /** Adds the signed-in player's finished match to their all-time average. */
  saveAverage(state: GameState, average: MatchAverage | undefined): void {
    if (!this.signedIn || !average || average.darts <= 0) return
    const board = boardOf(state.config)
    this.post({ action: 'average', board, mode: average.mode, darts: average.darts, total: average.total, run: runId() })
    this.cache.delete(`${board}:${average.mode}`)
  }

  /** Forgets the loaded totals so the next match reads them again (with the match that just finished saved). */
  invalidateAverages(): void {
    this.storedKey = ''
  }

  private storedFor(board: BoardKind, mode: AverageMode, name: string | null): Totals | null {
    return name ? this.stored.get(`${board}:${mode}:${name.toLowerCase()}`) ?? null : null
  }

  /** Loads the saved totals of the named members for the match's board and format (once per match). */
  prepareAverages(state: GameState, members: string[]): void {
    const mode = averageMode(state.config)
    if (!mode) return
    const board = boardOf(state.config)
    const names = [...new Set(members.map((name) => name.toLowerCase()))].sort()
    const key = `${board}:${mode}:${names.join(',')}`
    if (key === this.storedKey || !names.length) return
    this.storedKey = key
    this.storedLoading = fetch(`${API}?board=${board}&mode=${mode}&players=${encodeURIComponent(names.join(','))}`, { credentials: 'same-origin', signal: this.controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ players: Record<string, Totals> }>) : null))
      .then((data) => {
        for (const name of names) {
          const totals = data?.players[name]
          if (totals) this.stored.set(`${board}:${mode}:${name}`, totals)
        }
        this.hudKey = ''
        this.onChange?.()
      })
      .catch(() => undefined)
      .finally(() => {
        this.storedLoading = null
      })
  }

  get loadingAverages(): boolean {
    return !!this.storedLoading
  }

  /**
   * Draws the lower-right All-Time Averages panel: each player's all-time PPD or MPR (live: this match's darts are folded in when the match
   * counts) and this match's figure. `memberName` maps a player to a saved account name, or null for guests and the computer.
   */
  renderHud(state: GameState | null, colorOf: (id: string) => string, memberName: (id: string) => string | null, counts: boolean): void {
    const mode = state ? averageMode(state.config) : null
    if (!state || !mode) {
      if (!this.hud.hidden) this.hud.hidden = true
      this.hudKey = ''
      return
    }
    const board = boardOf(state.config)
    const rows: AverageRow[] = matchAverages(state).map((average) => {
      const player = state.players.find((item) => item.id === average.playerId)!
      const name = memberName(player.id)
      const saved = this.storedFor(board, mode, name)
      const match = formatAverage(mode, average.darts, average.total)
      const live = counts && !!name
      const darts = (saved?.darts ?? 0) + (live ? average.darts : 0)
      const total = (saved?.total ?? 0) + (live ? average.total : 0)
      return { name: player.name, color: colorOf(player.id), allTime: name && darts ? formatAverage(mode, darts, total) : null, match, live }
    })
    const key = `${board}:${mode}:${JSON.stringify(rows)}`
    if (key === this.hudKey) return
    this.hudKey = key
    const unit = averageUnit(mode)
    const head = make('div', 'd-avg-head')
    head.append(make('span', '', 'All-Time Averages'), make('span', 'd-avg-unit', `${unit} · ${BOARD_NAMES[board]}`))
    const list = make('div', 'd-avg-rows')
    for (const row of rows) {
      const line = make('div', 'd-avg-row')
      line.style.setProperty('--card-color', row.color)
      const name = make('span', 'd-avg-name', row.name)
      const value = make('span', 'd-avg-value', row.allTime ?? '—')
      value.title = row.allTime ? (row.live ? 'All-time, including this match' : 'All-time (this match does not count toward it)') : 'Nothing saved for this player'
      const match = make('span', 'd-avg-match', `this match ${row.match}`)
      line.append(name, value, match)
      list.append(line)
    }
    const foot = make('div', 'd-avg-foot', counts ? 'This match counts toward the averages' : 'Practice: this match is not counted')
    this.hud.replaceChildren(head, list, foot)
    this.hud.hidden = false
  }

  dispose(): void {
    this.controller.abort()
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }
}
