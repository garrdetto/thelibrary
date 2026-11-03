/** DOM screens from index.html: start screen with mode picker and record book tabs, online lobby, scorecard, pause menu and the turn banner. */
import type { RoundMode } from '../tuning'
import { loadBoard, type FairwayBoard, type FairwayRecordRow } from '../systems/Records'

export type ScreenName = 'start' | 'lobby' | 'scorecard' | 'pause'

export interface ScreenHandlers {
  chooseMode(mode: RoundMode): void
  host(): void
  join(code: string): void
  startMatch(): void
  leaveLobby(): void
  continueRound(): void
  quitToMenu(): void
  resume(): void
  showScorecard(): void
}

export interface LobbyModel {
  status: string
  code: string | null
  roster: readonly { name: string; tag: string }[]
  canStart: boolean
  connected: boolean
}

export interface ScorecardModel {
  eyebrow: string
  title: string
  summary: string
  headers: readonly string[]
  rows: readonly (readonly { text: string; tone?: 'under' | 'over' }[])[]
  continueLabel: string | null
}

export interface BoardCopy {
  empty: string
  loading: string
  failed: string
  columns: readonly [string, string, string, string]
  format(board: FairwayBoard, row: FairwayRecordRow): string
  personalBest(board: FairwayBoard, value: number): string
}

export interface Screens {
  show(name: ScreenName | null): void
  current(): ScreenName | null
  setLobby(model: LobbyModel): void
  setScorecard(model: ScorecardModel): void
  setBanner(text: string | null): void
  refreshBoard(board?: FairwayBoard): void
  dispose(): void
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing #${id}`)
  return found as T
}

export function createScreens(handlers: ScreenHandlers, boardCopy: BoardCopy): Screens {
  const screens: Record<ScreenName, HTMLElement> = {
    start: element('screen-start'),
    lobby: element('screen-lobby'),
    scorecard: element('screen-scorecard'),
    pause: element('screen-pause'),
  }
  const banner = element<HTMLDivElement>('turn-banner')
  const cleanups: (() => void)[] = []
  const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void) => {
    target.addEventListener(type, listener)
    cleanups.push(() => target.removeEventListener(type, listener))
  }
  let visible: ScreenName | null = 'start'

  for (const button of screens.start.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    on(button, 'click', () => handlers.chooseMode(button.dataset.mode as RoundMode))
  }
  on(element('lobby-host'), 'click', () => handlers.host())
  on(element('lobby-join'), 'submit', (event) => {
    event.preventDefault()
    handlers.join(element<HTMLInputElement>('lobby-code').value)
  })
  on(element('lobby-start'), 'click', () => handlers.startMatch())
  on(element('lobby-back'), 'click', () => handlers.leaveLobby())
  on(element('scorecard-continue'), 'click', () => handlers.continueRound())
  on(element('scorecard-menu'), 'click', () => handlers.quitToMenu())
  on(element('pause-resume'), 'click', () => handlers.resume())
  on(element('pause-scorecard'), 'click', () => handlers.showScorecard())
  on(element('pause-quit'), 'click', () => handlers.quitToMenu())

  const tabs = [...element('board-tabs').querySelectorAll<HTMLButtonElement>('[data-board]')]
  const panel = element('board-panel')
  let board: FairwayBoard = 'round'
  let request = 0

  const renderBoard = async () => {
    const ticket = ++request
    panel.textContent = boardCopy.loading
    try {
      const result = await loadBoard(board)
      if (ticket !== request) return
      panel.textContent = ''
      if (!result.records.length) {
        panel.textContent = boardCopy.empty
      } else {
        const table = document.createElement('table')
        table.className = 'fw-table'
        const head = table.createTHead().insertRow()
        for (const column of boardCopy.columns) {
          const cell = document.createElement('th')
          cell.scope = 'col'
          cell.textContent = column
          head.appendChild(cell)
        }
        const body = table.createTBody()
        result.records.forEach((row, index) => {
          const line = body.insertRow()
          line.insertCell().textContent = String(index + 1)
          line.insertCell().textContent = row.username
          line.insertCell().textContent = boardCopy.format(board, row)
          line.insertCell().textContent = new Date(row.date).toISOString().slice(0, 10)
        })
        panel.appendChild(table)
      }
      if (result.personalBest !== null) {
        const best = document.createElement('p')
        best.className = 'fw-note'
        best.textContent = boardCopy.personalBest(board, result.personalBest)
        panel.appendChild(best)
      }
    } catch {
      if (ticket === request) panel.textContent = boardCopy.failed
    }
  }

  const selectTab = (next: FairwayBoard, focus: boolean) => {
    board = next
    for (const tab of tabs) {
      const selected = tab.dataset.board === next
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      if (selected && focus) tab.focus()
    }
    void renderBoard()
  }
  for (const tab of tabs) on(tab, 'click', () => selectTab(tab.dataset.board as FairwayBoard, false))
  on(element('board-tabs'), 'keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.dataset.board === board)
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    selectTab(next.dataset.board as FairwayBoard, true)
  })
  void renderBoard()

  const focusFirst = (name: ScreenName) => {
    const target = screens[name].querySelector<HTMLElement>('button:not([hidden]):not([disabled]), input')
    target?.focus({ preventScroll: true })
  }

  return {
    show(name) {
      visible = name
      for (const [key, screen] of Object.entries(screens)) screen.hidden = key !== name
      if (name) focusFirst(name)
    },
    current: () => visible,
    setLobby(model) {
      element('lobby-status').textContent = model.status
      element('lobby-room').hidden = !model.code
      element('lobby-code-display').textContent = model.code ?? ''
      element('lobby-actions').hidden = model.connected
      const start = element<HTMLButtonElement>('lobby-start')
      start.hidden = !model.canStart
      const roster = element('lobby-roster')
      roster.textContent = ''
      for (const seat of model.roster) {
        const item = document.createElement('li')
        const name = document.createElement('span')
        name.textContent = seat.name
        const tag = document.createElement('span')
        tag.className = 'fw-note'
        tag.textContent = seat.tag
        item.append(name, tag)
        roster.appendChild(item)
      }
    },
    setScorecard(model) {
      element('scorecard-eyebrow').textContent = model.eyebrow
      element('scorecard-title').textContent = model.title
      element('scorecard-summary').textContent = model.summary
      const wrap = element('scorecard-table')
      wrap.textContent = ''
      const table = document.createElement('table')
      table.className = 'fw-table'
      const head = table.createTHead().insertRow()
      for (const header of model.headers) {
        const cell = document.createElement('th')
        cell.scope = 'col'
        cell.textContent = header
        head.appendChild(cell)
      }
      const body = table.createTBody()
      for (const row of model.rows) {
        const line = body.insertRow()
        row.forEach((cell, index) => {
          const target = index === 0 ? document.createElement('th') : line.insertCell()
          if (index === 0) {
            ;(target as HTMLTableCellElement).scope = 'row'
            line.appendChild(target)
          }
          target.textContent = cell.text
          if (cell.tone) target.className = cell.tone === 'under' ? 'fw-under' : 'fw-over'
        })
      }
      wrap.appendChild(table)
      const next = element<HTMLButtonElement>('scorecard-continue')
      next.hidden = !model.continueLabel
      next.textContent = model.continueLabel ?? ''
    },
    setBanner(text) {
      banner.hidden = !text
      if (text && banner.textContent !== text) banner.textContent = text
    },
    refreshBoard(next) {
      if (next && next !== board) selectTab(next, false)
      else void renderBoard()
    },
    dispose() {
      for (const cleanup of cleanups) cleanup()
      cleanups.length = 0
    },
  }
}
