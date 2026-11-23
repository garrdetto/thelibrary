/**
 * The leaderboards screen: career level, Pilot Rating, hours, best landing (lowest sink rate), best landing score per airport,
 * this week's best flight and airline earnings, read from `/api/takeflight?board=`. Every flight on a board was re-flown and
 * scored by the Worker. Loading, empty and error states are shown in place; the signed-in pilot's own place is shown below.
 */
import { AIRPORTS } from '../shared/Airports'
import { AIRLINES, AIRLINE_IDS } from '../shared/Airlines'

type BoardId = 'level' | 'rating' | 'hours' | 'landing' | 'airport' | 'weekly' | 'airline'

interface BoardReply {
  entries: { rank: number; name: string; value: number }[]
  you: { rank: number; value: number } | null
}

const TABS: { id: BoardId; label: string; heading: string }[] = [
  { id: 'level', label: 'Level', heading: 'Career level' },
  { id: 'rating', label: 'Pilot Rating', heading: 'Pilot Rating' },
  { id: 'hours', label: 'Hours', heading: 'Hours flown' },
  { id: 'landing', label: 'Softest landing', heading: 'Touchdown sink rate (no bounce, on the runway)' },
  { id: 'airport', label: 'Airports', heading: 'Best landing score' },
  { id: 'weekly', label: 'This week', heading: 'Best flight score this week' },
  { id: 'airline', label: 'Airlines', heading: 'Airline earnings' },
]

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function format(board: BoardId, value: number): string {
  switch (board) {
    case 'level': return `Level ${value}`
    case 'rating': return value.toFixed(1)
    case 'hours': return `${(value / 3600).toFixed(1)} h`
    case 'landing': return `${Math.round(value)} fpm`
    case 'airline': return '$' + Math.round(value).toLocaleString('en-US')
    default: return value.toFixed(1)
  }
}

export class Boards {
  private readonly screen: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly tabs: HTMLDivElement
  private readonly filter: HTMLDivElement
  private readonly body: HTMLDivElement
  private board: BoardId = 'level'
  private airport = AIRPORTS[0].id
  private airline: string = AIRLINE_IDS[0]
  private request = 0

  constructor(parent: HTMLElement, private readonly onBack: () => void) {
    this.screen = make('div', 'tf-screen')
    this.screen.hidden = true
    this.card = make('div', 'tf-card tf-boards')
    this.card.setAttribute('role', 'dialog')
    this.card.setAttribute('aria-label', 'Leaderboards')
    this.tabs = make('div', 'tf-tabs')
    this.tabs.setAttribute('role', 'tablist')
    this.filter = make('div', 'tf-row')
    this.body = make('div', 'tf-board')
    this.body.setAttribute('aria-live', 'polite')
    const back = make('button', 'tf-btn', 'Back')
    back.type = 'button'
    back.addEventListener('click', () => this.onBack())
    const row = make('div', 'tf-row')
    row.append(back)
    this.card.append(make('h2', '', 'Leaderboards'), make('p', 'tf-muted', 'Every flight here was re-flown and scored by the server from its record.'), this.tabs, this.filter, this.body, row)
    this.screen.append(this.card)
    parent.append(this.screen)
    for (const tab of TABS) {
      const button = make('button', 'tf-chip', tab.label)
      button.type = 'button'
      button.setAttribute('role', 'tab')
      button.dataset.board = tab.id
      button.addEventListener('click', () => this.select(tab.id))
      this.tabs.append(button)
    }
  }

  get open(): boolean {
    return !this.screen.hidden
  }

  show(): void {
    this.screen.hidden = false
    this.select(this.board)
    ;(this.tabs.querySelector('[aria-selected="true"]') as HTMLButtonElement | null)?.focus({ preventScroll: true })
  }

  hide(): void {
    this.screen.hidden = true
  }

  private select(board: BoardId): void {
    this.board = board
    for (const button of this.tabs.children) {
      const selected = (button as HTMLElement).dataset.board === board
      button.setAttribute('aria-selected', String(selected))
      button.classList.toggle('on', selected)
    }
    this.filter.replaceChildren()
    if (board === 'airport') this.filter.append(this.picker('Airport', AIRPORTS.map((a) => [a.id, a.name]), this.airport, (v) => (this.airport = v)))
    if (board === 'airline') this.filter.append(this.picker('Airline', AIRLINE_IDS.map((id) => [id, AIRLINES[id].name]), this.airline, (v) => (this.airline = v)))
    void this.load()
  }

  private picker(label: string, options: [string, string][], value: string, set: (v: string) => void): HTMLLabelElement {
    const wrap = make('label', 'tf-field')
    const select = make('select')
    for (const [id, name] of options) {
      const option = make('option', '', name)
      option.value = id
      select.append(option)
    }
    select.value = value
    select.addEventListener('change', () => {
      set(select.value)
      void this.load()
    })
    wrap.append(make('span', '', label), select)
    return wrap
  }

  private async load(): Promise<void> {
    const id = ++this.request
    const board = this.board
    const heading = TABS.find((t) => t.id === board)?.heading ?? ''
    this.body.replaceChildren(make('p', 'tf-muted', 'Loading…'))
    const params = new URLSearchParams({ board })
    if (board === 'airport') params.set('airport', this.airport)
    if (board === 'airline') params.set('airline', this.airline)
    let reply: BoardReply
    try {
      const response = await fetch(`/api/takeflight?${params}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error('board')
      reply = (await response.json()) as BoardReply
    } catch {
      if (id === this.request) this.body.replaceChildren(make('p', 'tf-bad', 'The leaderboard could not be loaded. Try again in a moment.'))
      return
    }
    if (id !== this.request) return
    if (reply.entries.length === 0) {
      this.body.replaceChildren(make('p', 'tf-muted', 'No verified flights here yet. Sign in and fly to be the first.'))
      return
    }
    const table = make('table', 'tf-board-table')
    const caption = make('caption', '', heading)
    const head = make('tr')
    head.append(make('th', '', '#'), make('th', '', 'Pilot'), make('th', '', 'Result'))
    const thead = make('thead')
    thead.append(head)
    const tbody = make('tbody')
    for (const entry of reply.entries) {
      const row = make('tr')
      row.append(make('td', '', String(entry.rank)), make('td', '', entry.name), make('td', '', format(board, entry.value)))
      tbody.append(row)
    }
    table.append(caption, thead, tbody)
    this.body.replaceChildren(table)
    if (reply.you) this.body.append(make('p', 'tf-muted', `Your place: ${reply.you.rank} · ${format(board, reply.you.value)}`))
  }

  dispose(): void {
    this.screen.remove()
  }
}
