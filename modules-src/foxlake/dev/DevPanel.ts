/**
 * Fox Lake's developer panel (F8, administrators only; the site's Developer
 * Panel button can toggle it with a same-origin `tl-dev-panel` message, as in
 * Fox Plains and Kestrel County): spawn any registered vehicle for yourself or
 * beside another player, see and remove the spawned ones, teleport to a place
 * or a player, and give cash. It only draws and asks; FoxLakeDev does the
 * work, and the shared world decides whether each request is allowed.
 *
 * The panel is a `data-host-modal` overlay, so Rack & Reel's own input pauses
 * while it is open and typing an amount never moves the character.
 */
import { formatLeft } from './Placement'
import type { Place } from './Places'
import type { SpawnedRow } from './SharedCars'

export interface VehicleChoice {
  kind: string
  name: string
  /** "Built-in", "Bundled", "Published" or "Retired". */
  group: string
}

export interface PlayerChoice {
  id: string
  name: string
}

/** A request the panel started: `sent` waits for the world's answer, `done` is finished here, `refused` never left. */
export type Outcome = { state: 'sent' } | { state: 'done'; text: string; close?: boolean } | { state: 'refused'; text: string }

export interface DevActions {
  /** May this player open the panel right now. */
  allowed(): boolean
  solo(): boolean
  vehicles(): VehicleChoice[]
  players(): PlayerChoice[]
  spawned(): SpawnedRow[]
  places(): Place[]
  playerName(id: string): string | null
  spawn(kind: string, to: string): Outcome
  remove(id: string): Outcome
  cash(to: string, amount: number): Outcome
  goToPlace(id: string): Outcome
  goHome(): Outcome
  goToPlayer(id: string): Outcome
}

const ANSWER_TIMEOUT_MS = 6000
const REFRESH_MS = 500
const ME = 'me'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function button(text: string, primary = false): HTMLButtonElement {
  const b = el('button', primary ? 'rr-btn primary' : 'rr-btn', text)
  b.type = 'button'
  return b
}

export class DevPanel {
  private readonly root = el('aside', 'fl-dev')
  private readonly note = el('p', 'fl-dev-note')
  private readonly status = el('p', 'fl-dev-status')
  private readonly spawnTo = el('select')
  private readonly cashTo = el('select')
  private readonly filter = el('input')
  private readonly amount = el('input')
  private readonly vehicleList = el('ul', 'fl-dev-list')
  private readonly spawnedTitle = el('h4')
  private readonly spawnedList = el('ul', 'fl-dev-list')
  private readonly placeGrid = el('div', 'fl-dev-grid')
  private readonly playerGrid = el('div', 'fl-dev-grid')
  private readonly spawnedText = new Map<string, HTMLElement>()
  private readonly busyButtons = new Set<HTMLButtonElement>()
  private playersKey = ''
  private spawnedKey = ''
  private vehiclesKey = ''
  private timer = 0
  private waiting = 0
  private wanted = new URLSearchParams(location.search).get('panel') === '1'

  constructor(private readonly actions: DevActions, private readonly canvas: HTMLCanvasElement | null, private readonly canOpen: () => boolean) {
    const root = this.root
    root.hidden = true
    root.dataset.hostModal = ''
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', 'Developer panel')
    root.tabIndex = -1

    const head = el('header', 'fl-dev-head')
    const close = button('Close (F8)')
    close.addEventListener('click', () => this.toggle(false))
    head.append(el('h2', '', 'Developer panel'), close)
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')

    root.append(head, this.note, this.status, this.spawnSection(), this.teleportSection(), this.cashSection())
    document.body.append(root)

    addEventListener('keydown', (e) => {
      if (e.code === 'F8') {
        if (e.repeat || (!this.open && !this.canOpen())) return
        e.preventDefault()
        this.toggle()
      } else if (e.code === 'Escape' && this.open) {
        e.preventDefault()
        e.stopImmediatePropagation()
        this.toggle(false)
      }
    }, true)
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== window.parent || (e.data as { type?: unknown } | null)?.type !== 'tl-dev-panel') return
      if (this.open || this.canOpen()) this.toggle()
      else this.wanted = true
    })
  }

  get open(): boolean {
    return !this.root.hidden
  }

  /** Each frame: opens a panel that was asked for before the player was let in (`?panel=1`, or the site's button). */
  update(): void {
    if (!this.wanted || !this.canOpen()) return
    this.wanted = false
    this.toggle(true)
  }

  /** The world took the tools away (a reconnect as someone else): put the panel away. */
  revoke(): void {
    this.wanted = false
    if (this.open) this.toggle(false)
  }

  toggle(force?: boolean): void {
    const open = force ?? !this.open
    if (open === this.open) return
    if (open) {
      this.root.hidden = false
      if (document.pointerLockElement) document.exitPointerLock()
      this.say('')
      this.refresh(true)
      this.timer = window.setInterval(() => this.refresh(false), REFRESH_MS)
      this.root.focus()
      return
    }
    this.root.hidden = true
    clearInterval(this.timer)
    this.settle()
    if (!this.canvas) return
    this.canvas.focus()
    try {
      const lock = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined
      lock?.catch?.(() => undefined)
    } catch {
      return
    }
  }

  /** The world's answer to the last request. */
  answer(ok: boolean, text: string): void {
    this.settle()
    this.say(text, !ok)
    this.refresh(false)
  }

  private say(text: string, warn = false): void {
    this.status.textContent = text
    this.status.classList.toggle('warn', warn)
  }

  private settle(): void {
    clearTimeout(this.waiting)
    this.waiting = 0
    for (const b of this.busyButtons) b.disabled = false
    this.busyButtons.clear()
  }

  /** Runs one request from a button: shows what happened, or waits for the world's answer with the button held. */
  private run(source: HTMLButtonElement, request: () => Outcome): void {
    if (this.waiting) return
    const outcome = request()
    if (outcome.state === 'refused') return this.say(outcome.text, true)
    if (outcome.state === 'done') {
      this.say(outcome.text)
      if (outcome.close) this.toggle(false)
      return
    }
    source.disabled = true
    this.busyButtons.add(source)
    this.say('Asking the world…')
    this.waiting = window.setTimeout(() => {
      this.settle()
      this.say('The world did not answer. Check the connection and try again.', true)
    }, ANSWER_TIMEOUT_MS)
  }

  private field(label: string, control: HTMLElement): HTMLLabelElement {
    const wrap = el('label')
    wrap.append(el('span', '', label), control)
    return wrap
  }

  private spawnSection(): HTMLElement {
    const section = el('section')
    this.filter.type = 'search'
    this.filter.placeholder = 'Filter by name'
    this.filter.addEventListener('input', () => this.renderVehicles(true))
    section.append(
      el('h3', '', 'Spawn a vehicle'),
      el('p', '', 'A spawned vehicle belongs to nobody: anyone can get in and drive it. It disappears 5 minutes after it was spawned, or as soon as it is empty if someone is in it then.'),
      this.field('Put it', this.spawnTo),
      this.field('Vehicles', this.filter),
      this.vehicleList,
      this.spawnedTitle,
      this.spawnedList,
    )
    return section
  }

  private teleportSection(): HTMLElement {
    const section = el('section')
    section.append(el('h3', '', 'Teleport'), el('p', '', 'Puts you on foot at the nearest safe ground. A vehicle you are in stays where it is.'), this.placeGrid, el('h4', '', 'Players'), this.playerGrid)
    return section
  }

  private cashSection(): HTMLElement {
    const section = el('section')
    const form = el('form', 'fl-dev-cash')
    this.amount.type = 'number'
    this.amount.min = '1'
    this.amount.max = '1000000'
    this.amount.step = '1'
    this.amount.value = '1000'
    this.amount.inputMode = 'numeric'
    this.amount.required = true
    const give = button('Give', true)
    give.type = 'submit'
    form.append(this.field('Amount ($)', this.amount), this.field('To', this.cashTo), give)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      this.run(give, () => this.actions.cash(this.cashTo.value || ME, Number(this.amount.value)))
    })
    section.append(el('h3', '', 'Give cash'), form)
    return section
  }

  /** Brings the lists up to date. Rows are only rebuilt when what they show changed, so focus stays where it was. */
  private refresh(all: boolean): void {
    if (!this.open) return
    if (!this.actions.allowed()) return this.toggle(false)
    this.note.textContent = this.actions.solo()
      ? 'Solo: changes stay on this device. Money is unlimited here, so cash can only be given in the shared world.'
      : 'Shared world: the server checks every request against your administrator session.'
    this.renderPlayers(all)
    this.renderVehicles(all)
    this.renderSpawned(all)
    if (all) this.renderPlaces()
  }

  private renderPlayers(force: boolean): void {
    const players = this.actions.players()
    const key = players.map((p) => `${p.id}=${p.name}`).join('|')
    if (!force && key === this.playersKey) return
    this.playersKey = key
    for (const [select, mine] of [[this.spawnTo, 'In front of me'], [this.cashTo, 'Me']] as const) {
      const chosen = select.value
      const options = [new Option(mine, ME), ...players.map((p) => new Option(select === this.spawnTo ? `Beside ${p.name}` : p.name, p.id))]
      select.replaceChildren(...options)
      select.value = options.some((o) => o.value === chosen) ? chosen : ME
    }
    if (!players.length) {
      this.playerGrid.replaceChildren(el('p', 'fl-dev-empty', 'Nobody else is in the world right now.'))
      return
    }
    this.playerGrid.replaceChildren(...players.map((p) => {
      const b = button(`Go to ${p.name}`)
      b.addEventListener('click', () => this.run(b, () => this.actions.goToPlayer(p.id)))
      return b
    }))
  }

  private renderVehicles(force: boolean): void {
    const all = this.actions.vehicles()
    const key = all.map((v) => v.kind).join('|')
    if (!force && key === this.vehiclesKey) return
    this.vehiclesKey = key
    const text = this.filter.value.trim().toLowerCase()
    const shown = all.filter((v) => !text || v.name.toLowerCase().includes(text) || v.group.toLowerCase().includes(text))
    if (!shown.length) {
      this.vehicleList.replaceChildren(el('li', 'fl-dev-empty', all.length ? 'No vehicle matches that name.' : 'No vehicles are registered yet.'))
      return
    }
    this.vehicleList.replaceChildren(...shown.map((v) => {
      const row = el('li')
      const spawn = button('Spawn')
      spawn.setAttribute('aria-label', `Spawn ${v.name}`)
      spawn.addEventListener('click', () => this.run(spawn, () => this.actions.spawn(v.kind, this.spawnTo.value || ME)))
      row.append(el('span', '', v.name), el('small', '', v.group), spawn)
      return row
    }))
  }

  private renderSpawned(force: boolean): void {
    const rows = this.actions.spawned()
    const key = rows.map((r) => r.id).join('|')
    if (force || key !== this.spawnedKey) {
      this.spawnedKey = key
      this.spawnedText.clear()
      this.spawnedTitle.textContent = `Spawned now (${rows.length})`
      if (!rows.length) this.spawnedList.replaceChildren(el('li', 'fl-dev-empty', 'Nothing is spawned.'))
      else {
        this.spawnedList.replaceChildren(...rows.map((r) => {
          const row = el('li')
          const state = el('small')
          const remove = button('Remove now')
          remove.setAttribute('aria-label', `Remove the ${r.name} now`)
          remove.addEventListener('click', () => this.run(remove, () => this.actions.remove(r.id)))
          this.spawnedText.set(r.id, state)
          row.append(el('span', '', r.name), state, remove)
          return row
        }))
      }
    }
    for (const r of rows) {
      const state = this.spawnedText.get(r.id)
      if (!state) continue
      const who = r.driver ? `${this.actions.playerName(r.driver) ?? 'someone'} is driving` : 'parked'
      const text = r.left > 0 ? `${formatLeft(r.left)} left · ${who}` : r.driver ? `Time is up · ${who}, it goes when they get out` : 'Time is up'
      if (state.textContent !== text) state.textContent = text
    }
  }

  private renderPlaces(): void {
    const home = button('Home')
    home.addEventListener('click', () => this.run(home, () => this.actions.goHome()))
    this.placeGrid.replaceChildren(home, ...this.actions.places().map((p) => {
      const b = button(p.label)
      b.addEventListener('click', () => this.run(b, () => this.actions.goToPlace(p.id)))
      return b
    }))
  }
}
