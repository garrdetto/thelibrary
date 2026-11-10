/** The record book link: tells the page's record book under the frame (`src/components/DartsRecordBoard.tsx`) which board and format the setup form shows and when a result was saved, draws the in-match "All-Time Averages" panel at the lower right, and saves a local player's finished legs and matches to `/api/darts-records` (online rooms save their own results on the server). */
import type { BoardKind, GameState } from '../shared/interfaces'
import {
  BOARD_NAMES,
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

interface Viewer { signedIn: boolean; username: string | null }
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

/** Tells the library page (when the module runs in its frame) which record book tab to show, and whether a result was just saved there. */
function notifyPage(board: BoardKind, mode: RecordMode | null, saved: boolean): void {
  if (window.parent === window) return
  window.parent.postMessage({ type: 'tl-darts', board, mode, saved }, window.location.origin)
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
  private viewer: { at: number; data: Promise<Viewer | null> } | null = null
  private readonly stored = new Map<string, Totals>()
  private storedKey = ''
  private storedLoading: Promise<void> | null = null
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly controller = new AbortController()
  username: string | null = null
  signedIn = false
  private hudKey = ''
  /** Called when saved averages arrive, so the panel can redraw. */
  onChange: (() => void) | null = null

  constructor(private readonly hud: HTMLElement) {}

  private loadViewer(board: BoardKind, mode: RecordMode, fresh = false): Promise<Viewer | null> {
    if (this.viewer && !fresh && performance.now() - this.viewer.at < BOARD_TTL_MS) return this.viewer.data
    const data = fetch(`${API}?board=${board}&mode=${mode}`, { credentials: 'same-origin', signal: this.controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<Viewer>) : null))
      .then((viewer) => {
        if (viewer) {
          this.username = viewer.username
          this.signedIn = viewer.signedIn
        }
        return viewer
      })
      .catch(() => null)
    this.viewer = { at: performance.now(), data }
    return data
  }

  /** Points the page's record book at the setup form's board and format (`mode` null: 701 and the off-standard formats keep no records) and reads who is signed in. */
  async show(board: BoardKind, mode: RecordMode | null, fresh = false): Promise<void> {
    if (mode) notifyPage(board, mode, false)
    await this.loadViewer(board, mode ?? '501', fresh)
  }

  /** Asks the page's record book to reload after a result was saved on the server (online rooms), a moment after the leg ends. */
  refreshPage(board: BoardKind, mode: RecordMode | null, delayMs = 0): void {
    if (!mode) return
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      notifyPage(board, mode, true)
    }, delayMs)
    this.timers.add(timer)
  }

  private post(body: Record<string, unknown>, attempt = 0, done?: () => void): void {
    const send = () =>
      fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
        .then((response) => {
          if (response.ok || response.status === 400 || response.status === 401 || response.status === 403) {
            if (response.ok) done?.()
            return
          }
          throw new Error(`HTTP ${response.status}`)
        })
        .catch(() => {
          if (attempt >= RETRY_MS.length) return
          const timer = setTimeout(() => {
            this.timers.delete(timer)
            this.post(body, attempt + 1, done)
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
      const mode = result.mode
      this.post({ action: 'leg', board, mode, value: result.value, run: runId() }, 0, () => notifyPage(board, mode, true))
    }
  }

  /** Adds the signed-in player's finished match to their all-time average. */
  saveAverage(state: GameState, average: MatchAverage | undefined): void {
    if (!this.signedIn || !average || average.darts <= 0) return
    const board = boardOf(state.config)
    const mode = average.mode
    this.post({ action: 'average', board, mode, darts: average.darts, total: average.total, run: runId() }, 0, () => notifyPage(board, mode, true))
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
