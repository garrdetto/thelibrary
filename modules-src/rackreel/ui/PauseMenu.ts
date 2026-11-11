import type { OpenLobby } from '../game/Online'

export interface Sensitivity {
  look: number
  aim: number
  /** The arrow keys turn the view the other way left/right (the mouse never changes). Off: Left shows more to the right. */
  invertX: boolean
  /** The arrow keys tilt the view the other way (the mouse never changes). Off: Up looks further down. */
  invertY: boolean
}

export const DEFAULT_SENSITIVITY: Sensitivity = { look: 1, aim: 1, invertX: false, invertY: false }

export interface PauseParty {
  status(): string
  code(): string
  isHost(): boolean
  isGuest(): boolean
  members(): string[]
  lobbyOpen(): boolean
  host(): Promise<string>
  setLobby(open: boolean): Promise<void>
  join(code: string): Promise<void>
  leave(): void
}

/** View options kept per device, like the look settings. */
export interface Graphics {
  shadows: boolean
}

export const DEFAULT_GRAPHICS: Graphics = { shadows: true }
const GRAPHICS_KEY = 'tl-rackreel-graphics'

export function loadGraphics(): Graphics {
  try {
    const raw = JSON.parse(localStorage.getItem(GRAPHICS_KEY) ?? '{}') as Partial<Graphics>
    return { shadows: typeof raw.shadows === 'boolean' ? raw.shadows : DEFAULT_GRAPHICS.shadows }
  } catch {
    return { ...DEFAULT_GRAPHICS }
  }
}

export function saveGraphics(g: Graphics): void {
  try {
    localStorage.setItem(GRAPHICS_KEY, JSON.stringify(g))
  } catch {
    return
  }
}

export interface PauseHooks {
  resume(): void
  inventory(): void
  records(): void
  respawn(): void
  sensitivity(): Sensitivity
  setSensitivity(s: Sensitivity): void
  graphics(): Graphics
  setGraphics(g: Graphics): void
  party: PauseParty
}

/** The flips used to move the mouse too; the new key starts everyone on the arrow-key defaults while keeping their speeds from the old one. */
const SENSITIVITY_KEY = 'tl-rackreel-sensitivity-2'
const OLD_SENSITIVITY_KEY = 'tl-rackreel-sensitivity'
export const SENSITIVITY_MIN = 0.2
export const SENSITIVITY_MAX = 3

function clampSensitivity(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 1
  return Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, n))
}

/** Mouse-look settings are a preference for this device, like the module's other view options. */
export function loadSensitivity(): Sensitivity {
  try {
    const saved = localStorage.getItem(SENSITIVITY_KEY)
    const old = saved ? null : (JSON.parse(localStorage.getItem(OLD_SENSITIVITY_KEY) ?? '{}') as Partial<Sensitivity>)
    const raw = old ? { look: old.look, aim: old.aim } : (JSON.parse(saved ?? '{}') as Partial<Sensitivity>)
    return {
      look: clampSensitivity(raw.look),
      aim: clampSensitivity(raw.aim),
      invertX: typeof raw.invertX === 'boolean' ? raw.invertX : DEFAULT_SENSITIVITY.invertX,
      invertY: typeof raw.invertY === 'boolean' ? raw.invertY : DEFAULT_SENSITIVITY.invertY,
    }
  } catch {
    return { ...DEFAULT_SENSITIVITY }
  }
}

export function saveSensitivity(s: Sensitivity): void {
  try {
    localStorage.setItem(SENSITIVITY_KEY, JSON.stringify(s))
  } catch {
    return
  }
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function button(text: string, cls = 'rr-btn'): HTMLButtonElement {
  const b = h('button', cls, text)
  b.type = 'button'
  return b
}

function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`
}

function codeInput(): HTMLInputElement {
  const input = h('input', 'party-code')
  input.placeholder = 'Code'
  input.maxLength = 6
  input.autocomplete = 'off'
  input.spellcheck = false
  input.setAttribute('aria-label', 'Invite code')
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  })
  return input
}

/** The Esc menu: resume, look sensitivity, inviting players, the open-lobby switch and Respawn at the cabin. */
export class PauseMenu {
  private readonly root: HTMLDivElement
  private readonly party: HTMLElement
  private readonly note: HTMLParagraphElement
  private busy = false

  constructor(private readonly hooks: PauseHooks) {
    this.root = h('div', 'rr-screen pause-screen')
    this.root.id = 'pause'
    this.root.hidden = true
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-labelledby', 'pause-title')
    const card = h('div', 'rr-card pause-card')
    const title = h('h2', undefined, 'Paused')
    title.id = 'pause-title'
    const resume = button('Resume', 'rr-btn primary')
    resume.addEventListener('click', () => this.hooks.resume())
    const head = h('div', 'pause-head')
    head.append(title, resume)

    const look = h('section', 'panel-section')
    look.append(h('h3', undefined, 'Sensitivity controls'))
    const s = hooks.sensitivity()
    const lookRow = this.slider('Mouse look', s.look, (v) => this.hooks.setSensitivity({ ...this.hooks.sensitivity(), look: v }))
    const aimRow = this.slider('Scope & bow aim', s.aim, (v) => this.hooks.setSensitivity({ ...this.hooks.sensitivity(), aim: v }))
    const flipX = this.toggle('Flip arrow-key turning', s.invertX, (on) => this.hooks.setSensitivity({ ...this.hooks.sensitivity(), invertX: on }))
    const flipY = this.toggle('Flip arrow-key up/down', s.invertY, (on) => this.hooks.setSensitivity({ ...this.hooks.sensitivity(), invertY: on }))
    const reset = button('Reset to default')
    reset.addEventListener('click', () => {
      this.hooks.setSensitivity({ ...DEFAULT_SENSITIVITY })
      lookRow.set(1)
      aimRow.set(1)
      flipX.set(DEFAULT_SENSITIVITY.invertX)
      flipY.set(DEFAULT_SENSITIVITY.invertY)
    })
    look.append(lookRow.row, aimRow.row, flipX.row, flipY.row, h('p', 'panel-note', 'The mouse always turns the view the same way; these only flip the arrow keys.'), reset)

    const graphics = h('section', 'panel-section')
    graphics.append(h('h3', undefined, 'Graphics'))
    const shadowRow = this.toggle('Shadows', hooks.graphics().shadows, (on) => this.hooks.setGraphics({ ...this.hooks.graphics(), shadows: on }))
    graphics.append(shadowRow.row, h('p', 'panel-note', 'Turn shadows off for a smoother picture on a slower computer.'))

    this.party = h('section', 'panel-section')
    this.note = h('p', 'panel-note')
    this.note.setAttribute('aria-live', 'polite')

    const actions = h('div', 'rr-actions')
    const inventory = button('Inventory')
    inventory.addEventListener('click', () => this.hooks.inventory())
    const records = button('Record book')
    records.addEventListener('click', () => this.hooks.records())
    const respawn = button('Respawn')
    respawn.title = 'Go back to the cabin'
    respawn.addEventListener('click', () => this.hooks.respawn())
    actions.append(inventory, records, respawn)

    card.append(head, look, graphics, this.party, this.note, actions)
    this.root.append(card)
    document.body.append(this.root)
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        this.hooks.resume()
      }
    })
  }

  get open(): boolean {
    return !this.root.hidden
  }

  show(): void {
    this.note.textContent = ''
    this.root.hidden = false
    this.render()
    ;(this.root.querySelector('.pause-head .primary') as HTMLButtonElement | null)?.focus()
  }

  hide(): void {
    this.root.hidden = true
  }

  refresh(): void {
    if (!this.root.hidden && !this.busy) this.render()
  }

  private slider(label: string, value: number, change: (v: number) => void): { row: HTMLElement; set(v: number): void } {
    const row = h('label', 'pause-slider')
    const name = h('span', undefined, label)
    const input = h('input')
    input.type = 'range'
    input.min = String(SENSITIVITY_MIN)
    input.max = String(SENSITIVITY_MAX)
    input.step = '0.05'
    input.value = String(value)
    const out = h('output', undefined, `${value.toFixed(2)}×`)
    input.addEventListener('input', () => {
      const v = Number(input.value)
      out.textContent = `${v.toFixed(2)}×`
      change(v)
    })
    row.append(name, input, out)
    return { row, set: (v) => {
      input.value = String(v)
      out.textContent = `${v.toFixed(2)}×`
    } }
  }

  private toggle(label: string, value: boolean, change: (on: boolean) => void): { row: HTMLElement; set(on: boolean): void } {
    const row = h('label', 'pause-switch')
    const input = h('input')
    input.type = 'checkbox'
    input.setAttribute('role', 'switch')
    input.checked = value
    input.addEventListener('change', () => change(input.checked))
    row.append(input, h('span', undefined, label))
    return { row, set: (on) => { input.checked = on } }
  }

  private async run(task: () => Promise<unknown>, failure: string): Promise<void> {
    this.busy = true
    try {
      await task()
    } catch (error) {
      this.note.textContent = error instanceof Error && error.message.startsWith('Only') ? error.message : failure
    }
    this.busy = false
    this.render()
  }

  private render(): void {
    const party = this.hooks.party
    const code = party.code()
    this.party.replaceChildren(h('h3', undefined, 'Multiplayer'))
    this.party.append(h('p', 'panel-note', code ? party.status() : 'Up to four hunters share the same woods, deer and lake. Invite a friend with a code or open your lobby so anyone can join from the start screen.'))

    const lobbyRow = h('label', 'pause-switch')
    const lobby = h('input')
    lobby.type = 'checkbox'
    lobby.setAttribute('role', 'switch')
    lobby.checked = party.lobbyOpen()
    lobby.disabled = party.isGuest()
    lobby.addEventListener('change', () => void this.run(() => party.setLobby(lobby.checked), 'Could not open the lobby right now. Try again in a moment.'))
    lobbyRow.append(lobby, h('span', undefined, party.isGuest() ? 'Open lobby (only the party host can change this)' : 'Open lobby: list my party so anyone can join'))
    this.party.append(lobbyRow)

    if (!code) {
      const invite = button('Invite player', 'rr-btn primary')
      invite.addEventListener('click', () => {
        invite.disabled = true
        void this.run(() => party.host(), 'Could not open a party right now. Try again in a moment.')
      })
      const input = codeInput()
      const join = button('Join')
      join.addEventListener('click', () => {
        join.disabled = true
        void this.run(() => party.join(input.value), 'That code did not connect. Check it with your friend.')
      })
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') join.click()
      })
      const row = h('div', 'party-row')
      row.append(h('span', 'panel-note', 'Have a code?'), input, join)
      this.party.append(invite, row)
      return
    }

    const codeRow = h('div', 'party-row')
    codeRow.append(h('div', 'big-num', code))
    const copy = button('Copy invite link')
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(inviteLink(code))
        this.note.textContent = 'Invite link copied. Send it to a friend, or share the code; the library chat can also send an invite.'
      } catch {
        this.note.textContent = inviteLink(code)
      }
    })
    const copyCode = button('Copy code')
    copyCode.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code)
        this.note.textContent = 'Code copied.'
      } catch {
        this.note.textContent = code
      }
    })
    codeRow.append(copy, copyCode)
    const members = party.members()
    const leave = button('Leave party')
    leave.addEventListener('click', () => {
      party.leave()
      this.render()
    })
    this.party.append(codeRow, h('p', 'panel-note', members.length ? `With you: ${members.join(', ')}` : 'Waiting for players to join…'), leave)
  }
}

export interface LobbyHooks {
  list(): Promise<OpenLobby[]>
  join(code: string): Promise<void>
}

/** The start screen's open lobbies and invite-code box. */
export class LobbyBrowser {
  private readonly listEl: HTMLUListElement
  private readonly status: HTMLParagraphElement
  private timer = 0
  private joining = false

  constructor(parent: HTMLElement, before: Element | null, private readonly hooks: LobbyHooks) {
    const section = h('section', 'lobby-browser')
    section.setAttribute('aria-labelledby', 'lobby-title')
    const head = h('div', 'lobby-head')
    const title = h('h3', undefined, 'Open lobbies')
    title.id = 'lobby-title'
    const refresh = button('Refresh')
    refresh.addEventListener('click', () => void this.load())
    head.append(title, refresh)
    this.listEl = h('ul', 'lobby-list')
    const input = codeInput()
    const join = button('Join')
    join.addEventListener('click', () => void this.join(input.value))
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') join.click()
    })
    const row = h('div', 'party-row')
    row.append(h('span', 'panel-note', 'Have an invite code?'), input, join)
    this.status = h('p', 'panel-note')
    this.status.setAttribute('aria-live', 'polite')
    section.append(head, this.listEl, row, this.status)
    parent.insertBefore(section, before)
  }

  start(): void {
    window.clearInterval(this.timer)
    void this.load()
    this.timer = window.setInterval(() => void this.load(), 8000)
  }

  stop(): void {
    window.clearInterval(this.timer)
    this.timer = 0
  }

  private async load(): Promise<void> {
    let lobbies: OpenLobby[]
    try {
      lobbies = await this.hooks.list()
    } catch {
      this.listEl.replaceChildren(h('li', 'lobby-empty', 'Could not load the lobby list. Try Refresh.'))
      return
    }
    if (!lobbies.length) {
      this.listEl.replaceChildren(h('li', 'lobby-empty', 'No open lobbies right now. Head out and open your own from the Esc menu.'))
      return
    }
    this.listEl.replaceChildren(...lobbies.map((lobby) => {
      const li = h('li', 'lobby-item')
      const full = lobby.players >= 4
      const text = h('div')
      text.append(h('strong', undefined, `${lobby.host}'s party`), h('small', undefined, `${lobby.players} of 4 · code ${lobby.code}`))
      const b = button(full ? 'Full' : 'Join', full ? 'rr-btn' : 'rr-btn primary')
      b.disabled = full || this.joining
      b.addEventListener('click', () => void this.join(lobby.code))
      li.append(text, b)
      return li
    }))
  }

  private async join(code: string): Promise<void> {
    if (this.joining) return
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (clean.length !== 6) {
      this.status.textContent = 'Invite codes are six letters and numbers.'
      return
    }
    this.joining = true
    this.status.textContent = `Joining ${clean}…`
    try {
      await this.hooks.join(clean)
      this.status.textContent = ''
    } catch {
      this.status.textContent = 'That party did not answer. It may have closed or be full.'
    }
    this.joining = false
  }
}
