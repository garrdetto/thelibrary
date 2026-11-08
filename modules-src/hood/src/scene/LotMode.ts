/** One loaded lot: the house in detail, the Sims on it, Live / Build / Buy, the door and the visitors. */
import * as THREE from 'three/webgpu'
import { placementError, type BuildOp } from '../../shared/Build'
import { CATALOG, CATEGORY_LABELS, FLOOR_MATERIALS, objectDef, type Category, type ObjectDef } from '../../shared/Catalog'
import { CANOPY_STYLES, FEATURE_COSTS, FEATURE_LABELS, FENCE_STYLES, PORCH_POSTS, type FeatureKind } from '../../shared/Style'
import { choiceRow, paletteRow, renderStylePanel, type StyleTab } from '../ui/StylePanel'
import { D, LotGrid, W, footprintSize, inLot, type LotState, type PlacedObject } from '../../shared/Lot'
import { NEEDS, NEED_LABELS, mood, moodLabel } from '../../shared/Needs'
import { clockLabel, clockParts, type LotView, type MemberView, type ServerMessage, type SettingsView, type SimView, type Speed } from '../../shared/Protocol'
import { lotPlacement } from '../../shared/Street'
import { OUTFIT_COLORS, SKIN_TONES } from '../../shared/Look'
import type { LotLink } from '../net/Link'
import type { StreetInfo } from '../net/Api'
import { buildFurniture, seatOffset } from '../models/Furniture'
import { buildGrass } from '../models/Grass'
import { detach } from '../models/Kit'
import { createSimFigure, type SimFigure } from '../models/SimFigure'
import { buildStreetGround, type StreetGround } from '../models/Street'
import type { WallMode } from '../models/House'
import { button, el, money, needColor } from '../ui/Ui'
import { LotModel } from './LotModel'
import type { PointerTarget, Stage } from './Stage'
import { buildShells } from './StreetMode'
import { TownView } from './TownView'
import { SHIFT_SECONDS } from '../../shared/Jobs'
import { renderTownPanel } from '../ui/TownPanel'
import { careerLine, renderJobBoard, servicesPanel, workPanel, type ServicesPanel, type WorkPanel } from '../ui/CareerPanel'
import type { AwayView, OrderView, WorkView } from '../../shared/Protocol'

type Mode = 'live' | 'build' | 'buy'
type SideKind = 'people' | 'settings' | 'town' | 'work' | 'services' | 'jobs'
type Tool = 'room' | 'wall' | 'unwall' | 'door' | 'window' | 'unopen' | 'floor' | 'exterior' | 'canopy' | 'porch' | 'pergola' | 'fence' | 'chimney' | 'unfeature'

interface Actor {
  view: SimView
  figure: SimFigure
  lookKey: string
  pos: THREE.Vector3
  yaw: number
  walk: number
  label: HTMLElement
}

export interface LotModeOptions {
  stage: Stage
  link: LotLink
  street: StreetInfo | null
  practice: boolean
  toast(text: string): void
  exit(reason?: string): void
}

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'room', label: 'Room', hint: 'Drag a rectangle to build four walls and a floor.' },
  { id: 'wall', label: 'Wall', hint: 'Drag along the grid to build a straight wall.' },
  { id: 'unwall', label: 'Remove wall', hint: 'Drag along a wall to take it down.' },
  { id: 'door', label: 'Door', hint: 'Click a wall to add a door.' },
  { id: 'window', label: 'Window', hint: 'Click a wall to add a window.' },
  { id: 'unopen', label: 'Remove opening', hint: 'Click a door or window to remove it.' },
  { id: 'floor', label: 'Floor', hint: 'Drag over tiles to lay a floor.' },
  { id: 'exterior', label: 'Exterior design', hint: 'Siding, brick or stone wainscot, trim, shutters, windows, doors, lights, roof and inside walls.' },
  { id: 'canopy', label: 'Canopy', hint: 'Click a door or window on an outside wall to add a canopy over it.' },
  { id: 'porch', label: 'Porch roof', hint: 'Drag out an area against the house for a covered porch on posts. Lay a deck or patio floor under it.' },
  { id: 'pergola', label: 'Pergola', hint: 'Drag out an area in the yard for a slatted pergola with string lights.' },
  { id: 'fence', label: 'Fence', hint: 'Drag along the grid in the yard, or click one edge. Gates let Sims through.' },
  { id: 'chimney', label: 'Chimney', hint: 'Click a tile inside the house to run a brick chimney up through the roof.' },
  { id: 'unfeature', label: 'Remove feature', hint: 'Click a canopy, porch, pergola, fence or chimney to take it down for half its cost back.' },
]

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[]

export class LotMode implements PointerTarget {
  private readonly stage: Stage
  private readonly link: LotLink
  private readonly ground: StreetGround
  private neighbors: { root: THREE.Group; models: Map<number, LotModel> } | null = null
  private model: LotModel | null = null
  private view: LotView | null = null
  private settings: SettingsView | null = null
  private people: MemberView[] = []
  private role: 'owner' | 'visitor' = 'visitor'
  private guest = false
  private sims: SimView[] = []
  private clock = 0
  private speed: Speed = 1
  private funds = 0
  private home = false
  private selected: string | null = null
  private mode: Mode = 'live'
  private wallMode: WallMode = 'cut'
  private tool: Tool = 'room'
  private floorMat = 0
  private styleTab: StyleTab = 'presets'
  private featureStyle: Record<string, string> = { canopy: 'gable', porch: 'square', pergola: 'standard', fence: 'picket', chimney: 'standard' }
  private featureColor: Record<string, number> = { canopy: 15, porch: 1, pergola: 26, fence: 1, chimney: 22 }
  private canopyWidth = 2
  private buyDef: ObjectDef | null = null
  private buyRotation = 0
  private moving: PlacedObject | null = null
  private picked: PlacedObject | null = null
  private category: Category = 'seating'
  private hoverTile: [number, number] | null = null
  private drag: { start: [number, number]; end: [number, number] } | null = null
  private readonly actors = new Map<string, Actor>()
  private readonly ghost = new THREE.Group()
  private ghostModel: THREE.Group | null = null
  private ghostKey = ''
  private readonly ghostMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5bd77d'), transparent: true, opacity: 0.4, depthWrite: false })
  private readonly ghostBad = new THREE.MeshBasicMaterial({ color: new THREE.Color('#e8533c'), transparent: true, opacity: 0.4, depthWrite: false })
  private time = 0
  private placedCamera = false
  private grid: LotGrid | null = null
  private grass: THREE.InstancedMesh | null = null
  private town: TownView | null = null
  private now = Date.now()
  private work: WorkView[] = []
  private away: AwayView[] = []
  private orders: OrderView[] = []

  private readonly top: HTMLDivElement
  private readonly bottom: HTMLDivElement
  private readonly info = { address: el('div', { class: 'title' }), sub: el('div', { class: 'sub' }), clock: el('div', { class: 'sub' }), funds: el('b'), speeds: el('div', { class: 'row', role: 'group', 'aria-label': 'Speed' }) }
  private readonly peopleButton = button('People', () => this.toggleSide('people'))
  private readonly wallButton = button('Walls: cutaway', () => this.cycleWalls(), 'btn', 'Change how walls are shown')
  private readonly settingsButton = button('Settings', () => this.toggleSide('settings'))
  private readonly townButton = button('Around town', () => this.toggleSide('town'), 'btn', 'The workplaces and the dispatch feed')
  private readonly servicesButton = button('Services', () => this.toggleSide('services'), 'btn', 'Call the police, fire station, EMS, burgers, the lawn crew, City Works or the resort')
  private readonly workButton = button('At work', () => this.toggleSide('work'), 'btn', 'Residents on a shift in town')
  private readonly live = el('div', { class: 'panel dock' })
  private readonly modes = el('div', { class: 'panel card row', role: 'tablist', 'aria-label': 'Mode' })
  private readonly dock = el('div', { class: 'panel dock' })
  private side: { kind: SideKind; node: HTMLElement; work?: WorkPanel; services?: ServicesPanel; sim?: string; key?: string } | null = null
  private menu: HTMLElement | null = null
  private knocks: HTMLElement | null = null
  private liveKey = ''

  constructor(private readonly options: LotModeOptions) {
    this.stage = options.stage
    this.link = options.link
    this.ground = buildStreetGround()
    this.stage.app.graph.add('world', this.ground.group)
    this.stage.app.graph.add('fx', this.ghost)

    const speeds: [Speed, string, string][] = [[0, '⏸', 'Pause'], [1, '▶', 'Normal speed'], [2, '▶▶', 'Fast'], [3, '▶▶▶', 'Fastest']]
    for (const [value, label, title] of speeds) {
      const b = button(label, () => this.link.send({ t: 'speed', speed: value }), 'btn', title)
      b.dataset.speed = String(value)
      this.info.speeds.append(b)
    }
    this.top = el('div', { class: 'top' },
      el('div', { class: 'panel card' }, this.info.address, this.info.sub, el('div', { class: 'row', style: 'margin-top:6px' }, this.info.speeds, this.info.clock), el('div', { class: 'sub' }, this.info.funds)),
      el('div', { class: 'panel card row' }, button(options.practice ? 'Leave practice' : 'Street', () => options.exit(), 'btn', 'Back to the street'), this.peopleButton, this.wallButton, this.townButton, this.servicesButton, this.workButton, this.settingsButton),
    )
    this.bottom = el('div', { class: 'bottom' }, this.live, this.modes)
    this.stage.ui.append(this.top, this.bottom)
    this.settingsButton.hidden = true
    this.servicesButton.hidden = true
    this.workButton.hidden = true
    this.modes.hidden = true
    this.dock.hidden = true
    this.bottom.insertBefore(this.dock, this.modes)
    for (const mode of ['live', 'build', 'buy'] as Mode[]) {
      const tab = button(mode === 'live' ? 'Live' : mode === 'build' ? 'Build' : 'Buy', () => this.setMode(mode), 'btn')
      tab.dataset.mode = mode
      tab.setAttribute('role', 'tab')
      this.modes.append(tab)
    }
    this.info.address.textContent = 'Walking over…'
    addEventListener('keydown', this.onKey)
    this.stage.target = this
    this.link.onMessage = message => this.onMessage(message)
    this.link.onClosed = reason => options.exit(reason)
  }

  private readonly onKey = (event: KeyboardEvent) => {
    const t = event.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    if (event.key === 'Escape') {
      if (this.menu) this.closeMenu()
      else if (this.buyDef || this.moving || this.picked) { this.buyDef = null; this.moving = null; this.picked = null; this.renderDock() }
      else if (this.drag) this.drag = null
    }
    if ((event.key === 'r' || event.key === 'R') && (this.buyDef || this.moving)) this.buyRotation = (this.buyRotation + 1) % 4
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.picked && this.mode === 'buy') this.sellPicked()
    if (event.key === 'Tab' && this.mode === 'live') {
      const mine = this.sims.filter(s => s.mine)
      if (mine.length > 1) {
        event.preventDefault()
        const at = mine.findIndex(s => s.id === this.selected)
        this.selected = mine[(at + 1) % mine.length].id
        this.liveKey = ''
      }
    }
  }

  private onMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.role = message.role
        this.settings = message.settings ?? null
        this.applyLot(message.lot)
        this.modes.hidden = this.role !== 'owner'
        this.settingsButton.hidden = this.role !== 'owner'
        this.servicesButton.hidden = this.role !== 'owner'
        this.workButton.hidden = this.role !== 'owner'
        if (!this.town) {
          const info = this.options.street
          this.town = new TownView(this.stage, { street: message.lot.street, houses: info ? info.lots.map(l => !!l.shell) : [], poll: !this.options.practice && !!info })
          this.town.onUpdate(() => { if (this.side?.kind === 'town') this.renderSide() })
        }
        this.wallMode = this.role === 'owner' ? 'cut' : 'up'
        this.setMode('live')
        return
      case 'lot':
        if (message.settings) this.settings = message.settings
        this.applyLot(message.lot)
        if (this.side) this.renderSide()
        return
      case 'state':
        this.clock = message.clock
        this.speed = message.speed
        this.home = message.home
        if (message.funds !== undefined) this.funds = message.funds
        this.sims = message.sims
        this.now = message.now
        this.town?.syncClock(message.now)
        if (this.role === 'owner') {
          this.work = message.work ?? []
          this.away = message.away ?? []
          this.orders = message.orders ?? []
          this.workButton.textContent = this.work.length ? `At work (${this.work.length})` : 'At work'
          this.town?.setLocalPlayers(this.work.map(w => ({ name: w.name, look: w.look, job: w.career.job, level: w.career.level, lot: this.view?.lot ?? 0, call: w.task?.id.startsWith('call:') ? w.task.id.slice(5) : null })))
          if (this.side && (this.side.kind === 'work' || this.side.kind === 'services' || this.side.kind === 'jobs')) this.renderSide()
        }
        if (!this.selected || !this.sims.some(s => s.id === this.selected && s.mine)) this.selected = this.sims.find(s => s.mine)?.id ?? null
        this.renderStatus()
        return
      case 'people':
        this.people = message.people
        this.peopleButton.textContent = `People (${this.people.length})`
        if (this.side?.kind === 'people') this.renderSide()
        return
      case 'guest':
        this.guest = message.guest
        this.wallMode = message.guest ? 'cut' : 'up'
        this.updateWallView(true)
        this.liveKey = ''
        return
      case 'knock':
        this.showKnock(message.id, message.name)
        return
      case 'knockEnd':
        if (this.knocks?.dataset.id === message.id) { this.knocks.remove(); this.knocks = null }
        return
      case 'town':
        this.town?.setRequests(message.requests)
        return
      case 'notice':
        this.options.toast(message.text)
        return
      case 'bye':
        this.options.toast(message.text)
        return
    }
  }

  private applyLot(view: LotView): void {
    const first = !this.view
    this.view = view
    this.grid = new LotGrid({ walls: view.walls, doors: view.doors, windows: view.windows, floors: view.floors, objects: view.objects, features: view.features })
    this.grass?.removeFromParent()
    this.grass?.dispose()
    this.grass?.geometry.dispose()
    ;(this.grass?.material as THREE.Material | undefined)?.dispose()
    this.grass = null
    if (!this.model) {
      this.model = new LotModel(view.lot, view)
      this.model.group.traverse(node => { node.userData.focus = true })
      this.stage.app.graph.add('props', this.model.group)
      if (this.options.street) {
        this.neighbors = buildShells(this.options.street, view.lot)
        this.stage.app.graph.add('props', this.neighbors.root)
        for (const model of this.neighbors.models.values()) model.setView('up', this.stage.app.camera.position, true)
      }
    } else {
      const sims = [...this.actors.values()].map(a => a.figure.root)
      this.model.rebuild(view)
      for (const root of sims) this.model.group.add(root)
    }
    this.grass = buildGrass(this.grid, matchMedia('(prefers-reduced-motion: reduce)').matches)
    this.model.group.add(this.grass)
    this.picked = null
    this.moving = null
    this.info.address.textContent = view.address
    this.info.sub.textContent = this.options.practice ? 'Practice lot · nothing here is saved' : `${view.householdName} · home of ${view.ownerName}`
    if (first && !this.placedCamera) {
      this.placedCamera = true
      const place = lotPlacement(view.lot)
      const center = this.model.toWorld(10, 0, 9)
      this.stage.rig.bounds = { minX: center.x - 26, maxX: center.x + 26, minZ: center.z - 26, maxZ: center.z + 26 }
      this.stage.rig.maxDistance = 60
      this.stage.rig.jump(center, place.yaw === 0 ? Math.PI + 0.35 : 0.35, 26, 0.8)
    }
    this.updateWallView(true)
    this.liveKey = ''
    if (this.mode !== 'live') this.renderDock()
  }

  private get entitled(): boolean {
    return this.role === 'owner' || this.guest
  }

  private cycleWalls(): void {
    if (!this.entitled) { this.options.toast('You can only look inside once you are let in.'); return }
    this.wallMode = this.wallMode === 'cut' ? 'up' : this.wallMode === 'up' ? 'down' : 'cut'
    this.updateWallView(true)
  }

  private updateWallView(force = false): void {
    if (!this.model) return
    const mode: WallMode = this.entitled ? this.wallMode : 'up'
    const roof = mode === 'up' && (!this.entitled || this.mode === 'live')
    if (force) this.model.setView(mode, this.stage.app.camera.position, roof)
    else this.model.refreshView(this.stage.app.camera.position)
    this.wallButton.textContent = `Walls: ${mode === 'cut' ? 'cutaway' : mode === 'up' ? 'up' : 'down'}`
  }

  private setMode(mode: Mode): void {
    if (mode !== 'live' && this.role !== 'owner') return
    this.mode = mode
    this.closeMenu()
    this.drag = null
    this.buyDef = null
    this.moving = null
    this.picked = null
    for (const tab of this.modes.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      const on = tab.dataset.mode === mode
      tab.classList.toggle('on', on)
      tab.setAttribute('aria-selected', String(on))
    }
    this.live.hidden = mode !== 'live'
    this.dock.hidden = mode === 'live'
    if (mode !== 'live' && this.wallMode === 'up') this.wallMode = 'cut'
    this.updateWallView(true)
    this.renderDock()
    this.liveKey = ''
  }

  private toggleSide(kind: SideKind, sim?: string): void {
    if (this.side?.kind === kind && this.side.sim === sim) { this.side.node.remove(); this.side = null; return }
    this.side?.node.remove()
    this.side = { kind, sim, node: el('div', { class: `panel side${kind === 'jobs' || kind === 'work' ? ' wide' : ''}` }) }
    this.stage.ui.append(this.side.node)
    this.renderSide()
  }

  private renderSide(): void {
    if (!this.side) return
    const node = this.side.node
    const side = this.side
    const shut = () => { node.remove(); if (this.side === side) this.side = null }
    const send = (command: Parameters<LotLink['send']>[0]) => this.link.send(command)
    if (side.kind === 'town') {
      if (this.town?.state) renderTownPanel(node, this.town.state, null, shut)
      return
    }
    if (side.kind === 'work') {
      side.work ??= workPanel(node, send, shut)
      side.work.update(this.work, this.away, this.now)
      return
    }
    if (side.kind === 'services') {
      side.services ??= servicesPanel(node, send, shut)
      side.services.update(this.orders, this.funds, this.sims.filter(s => s.mine && s.hh).map(s => ({ id: s.id, name: s.name })), this.now)
      return
    }
    if (side.kind === 'jobs') {
      const sim = this.sims.find(s => s.id === side.sim)
      if (!sim) return
      const key = JSON.stringify(sim.career ?? null)
      if (side.key === key) return
      side.key = key
      renderJobBoard(node, { id: sim.id, name: sim.name, career: sim.career }, send, shut)
      return
    }
    const close = button('Close', () => { node.remove(); this.side = null })
    if (this.side.kind === 'people') {
      const list = el('div', { class: 'list' }, ...this.people.map(p => {
        const tags = [p.role === 'owner' ? 'Owner' : p.guest ? 'Inside' : 'In the yard', p.me ? 'You' : ''].filter(Boolean).join(' · ')
        const actions: HTMLElement[] = []
        if (this.role === 'owner' && p.role === 'visitor') {
          if (p.guest) actions.push(button('Ask to step out', () => this.link.send({ t: 'askLeave', id: p.id })))
          actions.push(button('Send home', () => this.link.send({ t: 'sendHome', id: p.id })))
          actions.push(button('Block', () => this.link.send({ t: 'sendHome', id: p.id, block: true }), 'btn', `Send ${p.name} home and keep them off this lot`))
        }
        return el('div', { class: 'person' }, el('div', {}, el('b', {}, p.name), el('div', { class: 'sub' }, tags)), el('div', { class: 'row' }, ...actions))
      }))
      node.replaceChildren(el('div', { class: 'row', style: 'justify-content:space-between' }, el('div', { class: 'title' }, 'On this lot'), close),
        el('p', { class: 'sub' }, this.home ? 'The owner is home. Visitors knock at the front door to come inside.' : 'The owner is out, so the house is closed. The yard stays open.'),
        list)
      return
    }
    const s = this.settings
    if (!s) return
    const toggle = (label: string, value: boolean, onChange: (v: boolean) => void) => {
      const input = el('input', { type: 'checkbox' }) as HTMLInputElement
      input.checked = value
      input.addEventListener('change', () => onChange(input.checked))
      return el('label', { class: 'toggle' }, input, el('span', {}, label))
    }
    const named = (title: string, names: string[], list: 'alwaysLetIn' | 'blocked', action: string) => el('div', {},
      el('b', {}, title),
      names.length ? el('div', { class: 'list' }, ...names.map((name, index) => el('div', { class: 'person' }, el('span', {}, name), button(action, () => this.link.send({ t: 'forget', list, index }))))) : el('div', { class: 'hint' }, 'Nobody yet.'),
    )
    node.replaceChildren(
      el('div', { class: 'row', style: 'justify-content:space-between' }, el('div', { class: 'title' }, 'Lot settings'), close),
      toggle('Yard open to the street', s.yardOpen, v => this.link.send({ t: 'settings', yardOpen: v })),
      toggle('Guests may use the fridge, beds and shower', s.guestsUseFridgeBeds, v => this.link.send({ t: 'settings', guestsUseFridgeBeds: v })),
      named('Always let in while I am home', s.alwaysLetIn, 'alwaysLetIn', 'Remove'),
      named('Blocked', s.blocked, 'blocked', 'Unblock'),
    )
  }

  private showKnock(id: string, name: string): void {
    this.knocks?.remove()
    const answer = (allow: boolean, always = false) => {
      this.link.send({ t: 'answer', id, allow, always })
      this.knocks?.remove()
      this.knocks = null
    }
    this.knocks = el('div', { 'data-id': id, class: 'panel card', role: 'alertdialog', 'aria-label': `${name} is at the door`, style: 'position:absolute;top:84px;left:50%;transform:translateX(-50%);pointer-events:auto;text-align:center' },
      el('div', { class: 'title' }, `${name} is knocking`),
      el('div', { class: 'sub', style: 'margin:4px 0 8px' }, 'Let them in? They can come inside until you leave or ask them to step out.'),
      el('div', { class: 'row', style: 'justify-content:center' },
        button('Let in', () => answer(true), 'btn primary'),
        button('Always let in', () => answer(true, true)),
        button('Not now', () => answer(false)),
      ),
    )
    this.stage.ui.append(this.knocks)
    ;(this.knocks.querySelector('.btn.primary') as HTMLButtonElement).focus()
  }

  private renderStatus(): void {
    this.info.clock.textContent = clockLabel(this.clock)
    this.info.funds.textContent = this.role === 'owner' ? `Household funds ${money(this.funds)}` : this.home ? 'The owner is home' : 'The owner is out'
    for (const b of this.info.speeds.querySelectorAll<HTMLButtonElement>('[data-speed]')) b.classList.toggle('on', Number(b.dataset.speed) === this.speed)
    if (this.mode === 'live') this.renderLive()
  }

  private renderLive(): void {
    const mine = this.sims.filter(s => s.mine)
    const sim = mine.find(s => s.id === this.selected)
    const key = JSON.stringify([mine.map(s => [s.id, s.name]), this.selected, !!sim?.needs, sim?.act, sim?.queue, sim?.friends?.map(f => f.name), this.guest, this.role, this.home, sim?.career])
    if (key === this.liveKey) {
      if (sim?.needs) this.updateBars(sim)
      return
    }
    this.liveKey = key
    const portraits = mine.length > 1 ? el('div', { class: 'portraits', role: 'group', 'aria-label': 'Household' }, ...mine.map(s => {
      const b = el('button', { type: 'button', class: `portrait${s.id === this.selected ? ' on' : ''}`, 'aria-pressed': String(s.id === this.selected) },
        el('span', { class: 'dot', style: `background:linear-gradient(${SKIN_TONES[s.look.skin]} 45%, ${OUTFIT_COLORS[s.look.top]} 45%)` }),
        el('span', {}, s.name))
      b.addEventListener('click', () => { this.selected = s.id; this.liveKey = ''; this.renderLive() })
      return b
    })) : null
    const parts: (HTMLElement | null)[] = [portraits]
    if (sim?.needs) {
      const value = mood(sim.needs)
      this.moodText = el('span', { class: 'sub' }, `${moodLabel(value)} · ${value}`)
      parts.push(el('div', { class: 'row', style: 'justify-content:space-between' }, el('b', {}, sim.name), this.moodText))
      this.bars = []
      parts.push(el('div', { class: 'needs' }, ...NEEDS.map(need => {
        const fill = el('i')
        const bar = el('div', { class: 'bar', role: 'meter', 'aria-label': NEED_LABELS[need], 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill)
        this.bars.push({ need, bar, fill })
        return el('div', { class: 'need' }, el('span', {}, NEED_LABELS[need]), bar)
      })))
      const doing = [sim.act, ...(sim.queue ?? [])].filter(Boolean) as string[]
      parts.push(el('div', { class: 'queue' }, ...(doing.length ? doing.map((label, i) => el('span', { class: 'chip' }, i === 0 && sim.act ? `Now: ${label}` : label)) : [el('span', { class: 'hint' }, 'Free time. Click something to do.')]), doing.length ? button('Cancel', () => this.link.send({ t: 'cancel', sim: sim.id }), 'btn', 'Cancel actions') : null))
      if (sim.friends?.length) parts.push(el('div', { class: 'hint' }, `Friends here: ${sim.friends.map(f => `${f.name} ${f.value}`).join(', ')}`))
      if (this.role === 'owner' && sim.hh) {
        const career = sim.career
        parts.push(el('div', { class: 'row', style: 'margin-top:6px;justify-content:space-between' },
          el('span', { class: 'sub' }, careerLine(career)),
          el('div', { class: 'row' },
            career ? button('Go to work', () => this.link.send({ t: 'work', sim: sim.id }), 'btn primary', `Start a ${Math.round(SHIFT_SECONDS / 60)}-minute shift in town`) : null,
            button(career ? 'Jobs' : 'Find a job', () => this.toggleSide('jobs', sim.id), career ? 'btn' : 'btn primary'),
          ),
        ))
      }
    }
    if (this.role === 'visitor') {
      parts.push(el('div', { class: 'row', style: 'margin-top:6px' },
        this.guest ? el('span', { class: 'chip' }, 'You are a guest inside') : button('Knock on the door', () => sim && this.link.send({ t: 'knock', sim: sim.id }), 'btn primary', this.home ? 'Ask to be let in' : 'Nobody is home right now'),
        el('span', { class: 'hint' }, this.guest ? '' : this.home ? 'The yard is open. Knock to come inside.' : 'Nobody is home, so the house is closed.'),
      ))
    }
    this.live.replaceChildren(...parts.filter((p): p is HTMLElement => !!p))
    if (sim?.needs) this.updateBars(sim)
  }

  private bars: { need: (typeof NEEDS)[number]; bar: HTMLElement; fill: HTMLElement }[] = []
  private moodText: HTMLElement | null = null

  private updateBars(sim: SimView): void {
    const needs = sim.needs
    if (!needs) return
    for (const { need, bar, fill } of this.bars) {
      const value = needs[need]
      if (bar.getAttribute('aria-valuenow') === String(value)) continue
      bar.setAttribute('aria-valuenow', String(value))
      fill.style.width = `${value}%`
      fill.style.background = needColor(value)
    }
    const value = mood(needs)
    if (this.moodText) this.moodText.textContent = `${moodLabel(value)} · ${value}`
  }

  private renderDock(): void {
    if (this.mode === 'build') {
      const tools = el('div', { class: 'tools', role: 'toolbar', 'aria-label': 'Build tools' }, ...TOOLS.map(t => {
        const b = button(t.label, () => { this.tool = t.id; this.renderDock() }, `btn${this.tool === t.id ? ' on' : ''}`)
        b.setAttribute('aria-pressed', String(this.tool === t.id))
        return b
      }))
      const extra: HTMLElement[] = []
      if (this.tool === 'room' || this.tool === 'floor') {
        extra.push(el('div', { class: 'row', style: 'margin-top:6px' }, el('span', { class: 'sub' }, 'Floor'), ...FLOOR_MATERIALS.map((m, i) => {
          const b = el('button', { type: 'button', class: `sw${this.floorMat === i ? ' on' : ''}`, style: `background:${m.color}`, title: m.name, 'aria-label': m.name })
          b.addEventListener('click', () => { this.floorMat = i; this.renderDock() })
          return b
        }), this.tool === 'floor' ? button('Erase floor', () => { this.floorMat = -1; this.renderDock() }, `btn${this.floorMat === -1 ? ' on' : ''}`) : null))
      }
      if (this.tool === 'exterior' && this.view) {
        extra.push(renderStylePanel(this.view.style, this.styleTab, tab => { this.styleTab = tab; this.renderDock() }, patch => this.sendBuild({ op: 'style', patch })))
      }
      if (['canopy', 'porch', 'pergola', 'fence', 'chimney'].includes(this.tool)) {
        const kind = this.tool as FeatureKind
        const styles = kind === 'canopy' ? CANOPY_STYLES : kind === 'porch' ? PORCH_POSTS : kind === 'fence' ? FENCE_STYLES : []
        const box = el('div', { class: 'designer' })
        if (styles.length) box.append(choiceRow('Style', styles, this.featureStyle[kind], o => FEATURE_LABELS[o] ?? o, v => { this.featureStyle[kind] = v; this.renderDock() }))
        if (kind === 'canopy') box.append(choiceRow('Width', [1, 2, 3], this.canopyWidth, w => ['Narrow', 'Standard', 'Wide'][w - 1], v => { this.canopyWidth = v; this.renderDock() }))
        box.append(paletteRow(kind === 'chimney' ? 'Brick color' : kind === 'porch' ? 'Post and beam color' : 'Color', this.featureColor[kind], i => { this.featureColor[kind] = i; this.renderDock() }))
        const price = kind === 'canopy' ? `$${FEATURE_COSTS.canopyPerTile} per width step` : kind === 'porch' ? `$${FEATURE_COSTS.porchPerTile} a tile` : kind === 'pergola' ? `$${FEATURE_COSTS.pergolaPerTile} a tile` : kind === 'fence' ? `$${FEATURE_COSTS.fencePerEdge} a tile, gates $${FEATURE_COSTS.gate}` : `$${FEATURE_COSTS.chimney}`
        box.append(el('div', { class: 'hint' }, price))
        extra.push(box)
      }
      const hint = TOOLS.find(t => t.id === this.tool)?.hint ?? ''
      this.dock.replaceChildren(tools, ...extra, el('div', { class: 'hint' }, `${hint}${this.tool === 'exterior' ? ' Changing siding costs per wall face; colors and trim are free.' : ' Walls $12, floors $4 a tile, doors $150, windows $90.'} Right-drag turns the view.`))
      return
    }
    if (this.mode === 'buy') {
      const tabs = el('div', { class: 'tools', role: 'tablist', 'aria-label': 'Catalog' }, ...CATEGORIES.map(c => {
        const b = button(CATEGORY_LABELS[c], () => { this.category = c; this.renderDock() }, `btn${this.category === c ? ' on' : ''}`)
        b.setAttribute('role', 'tab')
        b.setAttribute('aria-selected', String(this.category === c))
        return b
      }))
      const items = el('div', { class: 'items' }, ...CATALOG.filter(d => d.category === this.category).map(def => {
        const b = el('button', { type: 'button', class: `item${this.buyDef?.id === def.id ? ' on' : ''}` },
          el('b', {}, def.name), el('small', {}, `${money(def.price)} · ${def.place === 'outdoor' ? 'yard' : def.place === 'indoor' ? 'indoors' : 'anywhere'}`))
        b.addEventListener('click', () => { this.buyDef = def; this.moving = null; this.picked = null; this.buyRotation = 0; this.renderDock() })
        return b
      }))
      const picked = this.picked && objectDef(this.picked.def)
      const footer = picked
        ? el('div', { class: 'row', style: 'margin-top:6px' }, el('b', {}, picked.name),
          button('Move', () => { this.moving = this.picked; this.buyRotation = this.picked!.r; this.renderDock() }),
          button('Turn', () => this.picked && this.sendBuild({ op: 'move', id: this.picked.id, x: this.picked.x, z: this.picked.z, r: (this.picked.r + 1) % 4 })),
          button(`Sell for ${money(Math.floor(picked.price / 2))}`, () => this.sellPicked()))
        : el('div', { class: 'hint' }, this.buyDef ? `Placing ${this.buyDef.name}: click to place, R to turn, Esc to stop.` : this.moving ? 'Click where it should go. R turns it, Esc cancels.' : 'Pick an item, or click something you own to move or sell it.')
      this.dock.replaceChildren(tabs, items, footer)
    }
  }

  private sellPicked(): void {
    if (!this.picked) return
    this.sendBuild({ op: 'sell', id: this.picked.id })
    this.picked = null
    this.renderDock()
  }

  private sendBuild(op: BuildOp): void {
    this.link.send({ t: 'build', op })
  }

  private localPoint(ndc: THREE.Vector2): THREE.Vector3 | null {
    const point = this.stage.groundPoint(ndc)
    if (!point || !this.model) return null
    return this.model.toLocal(point)
  }

  private tileAt(ndc: THREE.Vector2): [number, number] | null {
    const p = this.localPoint(ndc)
    if (!p) return null
    const x = Math.floor(p.x), z = Math.floor(p.z)
    return inLot(x, z) ? [x, z] : null
  }

  private cornerAt(ndc: THREE.Vector2): [number, number] | null {
    const p = this.localPoint(ndc)
    if (!p) return null
    return [THREE.MathUtils.clamp(Math.round(p.x), 0, W), THREE.MathUtils.clamp(Math.round(p.z), 0, D)]
  }

  private edgeAt(ndc: THREE.Vector2): [number, number, 0 | 1] | null {
    const p = this.localPoint(ndc)
    if (!p) return null
    const hz = Math.round(p.z), vx = Math.round(p.x)
    const dh = Math.abs(p.z - hz), dv = Math.abs(p.x - vx)
    if (Math.min(dh, dv) > 0.45) return null
    return dh <= dv ? [Math.floor(p.x), hz, 0] : [vx, Math.floor(p.z), 1]
  }

  private closeMenu(): void {
    this.menu?.remove()
    this.menu = null
  }

  private openMenu(event: PointerEvent, title: string, entries: { label: string; run: () => void; note?: string }[]): void {
    this.closeMenu()
    const rect = this.stage.app.container.getBoundingClientRect()
    const menu = el('div', { class: 'panel menu', role: 'menu', 'aria-label': title, style: `left:${Math.min(event.clientX - rect.left, rect.width - 200)}px;top:${Math.min(event.clientY - rect.top, rect.height - 60 - entries.length * 38)}px` },
      el('div', { class: 'head' }, title),
      ...entries.map(entry => {
        const b = button(entry.note ? `${entry.label} (${entry.note})` : entry.label, () => { entry.run(); this.closeMenu() })
        b.setAttribute('role', 'menuitem')
        return b
      }),
    )
    this.stage.ui.append(menu)
    this.menu = menu
    ;(menu.querySelector('.btn') as HTMLButtonElement | null)?.focus()
  }

  click(ndc: THREE.Vector2, event: PointerEvent): void {
    if (this.menu) { this.closeMenu(); return }
    if (!this.model || !this.view) return
    if (this.mode === 'build') return this.buildClick(ndc)
    if (this.mode === 'buy') return this.buyClick(ndc)
    const me = this.sims.find(s => s.id === this.selected)
    const roots = [...this.actors.values()].map(a => a.figure.root)
    const simHit = this.stage.pick(ndc, roots)
    if (simHit) {
      const id = simHit.object.userData.simId as string | undefined
      const target = id ? this.sims.find(s => s.id === id) : undefined
      if (target?.mine) { this.selected = target.id; this.liveKey = ''; this.renderLive(); return }
      if (target && me) { this.openMenu(event, target.name, [{ label: `Chat with ${target.name}`, run: () => this.link.send({ t: 'chat', sim: me.id, target: target.id }) }]); return }
    }
    const hit = this.stage.pick(ndc, [...this.model.objects.values()])
    const objectId = hit?.object.userData.objectId as number | undefined
    if (objectId !== undefined && me) {
      const object = this.view.objects.find(o => o.id === objectId)
      const def = object && objectDef(object.def)
      if (object && def && def.actions.length) {
        const own = this.role === 'owner'
        this.openMenu(event, def.name, def.actions.map(action => ({
          label: action.label,
          note: own ? undefined : action.guest === 'no' ? 'household only' : action.guest === 'ask' ? 'if the owner allows' : undefined,
          run: () => this.link.send({ t: 'use', sim: me.id, obj: object.id, act: action.id }),
        })))
        return
      }
    }
    const tile = this.tileAt(ndc)
    if (tile && me) {
      if (this.role === 'visitor' && !this.guest && this.grid?.isInside(...tile)) {
        this.openMenu(event, 'The house', [{ label: 'Knock on the door', run: () => this.link.send({ t: 'knock', sim: me.id }) }])
        return
      }
      this.link.send({ t: 'go', sim: me.id, x: tile[0], z: tile[1] })
    }
  }

  contextMenu(): void {
    if (this.buyDef || this.moving) { this.buyDef = null; this.moving = null; this.renderDock() }
    this.closeMenu()
  }

  private buildClick(ndc: THREE.Vector2): void {
    if (this.tool === 'door' || this.tool === 'window' || this.tool === 'unopen') {
      const edge = this.edgeAt(ndc)
      if (!edge) return
      this.sendBuild({ op: this.tool, x: edge[0], z: edge[1], v: edge[2] })
      return
    }
    if (this.tool === 'canopy') {
      const edge = this.edgeAt(ndc)
      if (edge) this.sendBuild({ op: 'feature', kind: 'canopy', x: edge[0], z: edge[1], v: edge[2], style: this.featureStyle.canopy, color: this.featureColor.canopy, width: this.canopyWidth })
      return
    }
    if (this.tool === 'fence') {
      const edge = this.edgeAt(ndc)
      if (edge) this.sendBuild({ op: 'feature', kind: 'fence', x: edge[0], z: edge[1], x2: edge[2] === 0 ? edge[0] + 1 : edge[0], z2: edge[2] === 1 ? edge[1] + 1 : edge[1], style: this.featureStyle.fence, color: this.featureColor.fence })
      return
    }
    if (this.tool === 'chimney') {
      const tile = this.tileAt(ndc)
      if (tile) this.sendBuild({ op: 'feature', kind: 'chimney', x: tile[0], z: tile[1], style: 'standard', color: this.featureColor.chimney })
      return
    }
    if (this.tool === 'porch' || this.tool === 'pergola') {
      const tile = this.tileAt(ndc)
      if (tile) this.sendBuild({ op: 'feature', kind: this.tool, x: tile[0], z: tile[1], x2: tile[0], z2: tile[1], style: this.featureStyle[this.tool], color: this.featureColor[this.tool] })
      return
    }
    if (this.tool === 'unfeature' && this.model) {
      const hit = this.stage.pick(ndc, [this.model.house.group])
      const ids = hit?.object.userData.featureIds as number[] | undefined
      const id = ids && hit?.instanceId !== undefined ? ids[hit.instanceId] : undefined
      if (id !== undefined) this.sendBuild({ op: 'unfeature', id })
      else this.options.toast('Click a canopy, porch, pergola, fence or chimney.')
      return
    }
    if (this.tool === 'floor') {
      const tile = this.tileAt(ndc)
      if (tile) this.sendBuild({ op: 'floor', x0: tile[0], z0: tile[1], x1: tile[0] + 1, z1: tile[1] + 1, floor: this.floorMat })
    }
  }

  private buyClick(ndc: THREE.Vector2): void {
    if (!this.model || !this.view) return
    const def = this.moving ? objectDef(this.moving.def) : this.buyDef
    if (def) {
      const tile = this.tileAt(ndc)
      if (!tile) return
      const [x, z] = this.ghostOrigin(def, tile)
      if (this.moving) {
        this.sendBuild({ op: 'move', id: this.moving.id, x, z, r: this.buyRotation })
        this.moving = null
        this.renderDock()
      } else this.sendBuild({ op: 'buy', def: def.id, x, z, r: this.buyRotation })
      return
    }
    const hit = this.stage.pick(ndc, [...this.model.objects.values()])
    const id = hit?.object.userData.objectId as number | undefined
    this.picked = id !== undefined ? this.view.objects.find(o => o.id === id) ?? null : null
    this.renderDock()
  }

  private ghostOrigin(def: ObjectDef, tile: [number, number]): [number, number] {
    const [fw, fd] = footprintSize(def, this.buyRotation)
    return [tile[0] - Math.floor((fw - 1) / 2), tile[1] - Math.floor((fd - 1) / 2)]
  }

  dragStart(ndc: THREE.Vector2): boolean {
    if (this.mode !== 'build' || !['room', 'wall', 'unwall', 'floor', 'porch', 'pergola', 'fence'].includes(this.tool)) return false
    const at = this.byTile() ? this.tileAt(ndc) : this.cornerAt(ndc)
    if (!at) return false
    this.drag = { start: at, end: at }
    return true
  }

  dragMove(ndc: THREE.Vector2): void {
    if (!this.drag) return
    const at = this.byTile() ? this.tileAt(ndc) : this.cornerAt(ndc)
    if (!at) return
    if (this.tool === 'wall' || this.tool === 'unwall' || this.tool === 'fence') {
      const [sx, sz] = this.drag.start
      this.drag.end = Math.abs(at[0] - sx) >= Math.abs(at[1] - sz) ? [at[0], sz] : [sx, at[1]]
    } else this.drag.end = at
  }

  dragEnd(): void {
    const drag = this.drag
    this.drag = null
    if (!drag) return
    const [x0, z0] = drag.start
    const [x1, z1] = drag.end
    if (this.tool === 'room') this.sendBuild({ op: 'room', x0, z0, x1, z1, floor: Math.max(0, this.floorMat) })
    else if (this.tool === 'wall') this.sendBuild({ op: 'wall', x0, z0, x1, z1 })
    else if (this.tool === 'unwall') this.sendBuild({ op: 'unwall', x0, z0, x1, z1 })
    else if (this.tool === 'floor') this.sendBuild({ op: 'floor', x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1) + 1, z1: Math.max(z0, z1) + 1, floor: this.floorMat })
    else if (this.tool === 'porch' || this.tool === 'pergola') this.sendBuild({ op: 'feature', kind: this.tool, x: x0, z: z0, x2: x1, z2: z1, style: this.featureStyle[this.tool], color: this.featureColor[this.tool] })
    else if (this.tool === 'fence' && (x0 !== x1 || z0 !== z1)) this.sendBuild({ op: 'feature', kind: 'fence', x: x0, z: z0, x2: x1, z2: z1, style: this.featureStyle.fence === 'gate' ? 'picket' : this.featureStyle.fence, color: this.featureColor.fence })
  }

  private byTile(): boolean {
    return this.tool === 'floor' || this.tool === 'porch' || this.tool === 'pergola'
  }

  hover(ndc: THREE.Vector2): void {
    this.hoverTile = this.tileAt(ndc)
  }

  private updateGhost(): void {
    if (!this.model) return
    this.ghost.position.copy(this.model.group.position)
    this.ghost.rotation.copy(this.model.group.rotation)
    const keep = new Set<THREE.Object3D>()
    const def = this.mode === 'buy' ? (this.moving ? objectDef(this.moving.def) : this.buyDef) : null
    if (def && this.hoverTile && this.view && this.grid) {
      const key = `${def.id}`
      if (this.ghostKey !== key) {
        if (this.ghostModel) detach(this.ghostModel)
        this.ghostModel = buildFurniture(def)
        this.ghostKey = key
        this.ghost.add(this.ghostModel)
      }
      const [x, z] = this.ghostOrigin(def, this.hoverTile)
      const [fw, fd] = footprintSize(def, this.buyRotation)
      this.ghostModel!.position.set(x + fw / 2, 0, z + fd / 2)
      this.ghostModel!.rotation.y = -this.buyRotation * Math.PI / 2
      keep.add(this.ghostModel!)
      const pseudo = { walls: this.view.walls, doors: this.view.doors, windows: this.view.windows, floors: this.view.floors, objects: this.view.objects } as unknown as LotState
      const ok = !placementError(pseudo, this.grid, def.id, x, z, this.buyRotation, this.moving?.id ?? -1)
      const pad = this.pad('footprint', ok)
      pad.position.set(x + fw / 2, 0.05, z + fd / 2)
      pad.scale.set(fw, 0.02, fd)
      keep.add(pad)
    } else if (this.ghostModel) {
      detach(this.ghostModel)
      this.ghostModel = null
      this.ghostKey = ''
    }
    if (this.mode === 'build' && this.drag) {
      const [x0, z0] = this.drag.start
      const [x1, z1] = this.drag.end
      if (this.byTile()) {
        const pad = this.pad('drag', true)
        pad.position.set((Math.min(x0, x1) + Math.max(x0, x1) + 1) / 2, 0.06, (Math.min(z0, z1) + Math.max(z0, z1) + 1) / 2)
        pad.scale.set(Math.abs(x1 - x0) + 1, 0.02, Math.abs(z1 - z0) + 1)
        keep.add(pad)
      } else {
        const bad = this.tool === 'unwall'
        const tall = this.tool === 'fence' ? 1.2 : 2.4
        const segments: [number, number, number, number][] = this.tool === 'room'
          ? [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1]]
          : [[x0, z0, x1, z1]]
        segments.forEach(([ax, az, bx, bz], i) => {
          const bar = this.pad(`seg${i}`, !bad)
          bar.position.set((ax + bx) / 2, tall / 2, (az + bz) / 2)
          bar.scale.set(Math.max(0.12, Math.abs(bx - ax)), tall, Math.max(0.12, Math.abs(bz - az)))
          keep.add(bar)
        })
      }
    }
    for (const child of [...this.ghost.children]) if (!keep.has(child) && child !== this.ghostModel) child.visible = false
    for (const child of keep) child.visible = true
  }

  private readonly pads = new Map<string, THREE.Mesh>()

  private pad(name: string, ok: boolean): THREE.Mesh {
    let mesh = this.pads.get(name)
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat)
      this.pads.set(name, mesh)
      this.ghost.add(mesh)
    }
    mesh.material = ok ? this.ghostMat : this.ghostBad
    return mesh
  }

  private seatPosition(view: SimView): { pos: THREE.Vector3; yaw: number } | null {
    if (view.obj === undefined || view.pose === 'stand' || !this.view) return null
    const object = this.view.objects.find(o => o.id === view.obj)
    const def = object && objectDef(object.def)
    if (!object || !def) return null
    const [fw, fd] = footprintSize(def, object.r)
    const theta = -object.r * Math.PI / 2
    const offset = seatOffset(def, view.seat ?? 0, view.pose === 'lie')
    const c = Math.cos(theta), s = Math.sin(theta)
    return {
      pos: new THREE.Vector3(object.x + fw / 2 + offset.x * c + offset.z * s, offset.y, object.z + fd / 2 - offset.x * s + offset.z * c),
      yaw: theta + Math.PI,
    }
  }

  private syncActors(dt: number): void {
    if (!this.model) return
    const seen = new Set<string>()
    for (const view of this.sims) {
      seen.add(view.id)
      const lookKey = JSON.stringify(view.look)
      let actor = this.actors.get(view.id)
      if (actor && actor.lookKey !== lookKey) { detach(actor.figure.root); actor.label.remove(); this.actors.delete(view.id); actor = undefined }
      if (!actor) {
        const figure = createSimFigure(view.look)
        figure.root.traverse(node => { node.userData.simId = view.id })
        this.model.group.add(figure.root)
        const label = el('div', { class: 'label' })
        this.stage.labels.append(label)
        actor = { view, figure, lookKey, pos: new THREE.Vector3(view.x + 0.5, 0, view.z + 0.5), yaw: view.facing, walk: 0, label }
        this.actors.set(view.id, actor)
      }
      actor.view = view
      const seat = this.seatPosition(view)
      const goal = seat ? seat.pos : new THREE.Vector3(view.x + 0.5, 0, view.z + 0.5)
      const delta = goal.clone().sub(actor.pos)
      const dist = delta.length()
      if (dist > 4) actor.pos.copy(goal)
      else if (dist > 0.0001) actor.pos.addScaledVector(delta, Math.min(1, (dt * Math.max(3.2, dist * 6)) / dist))
      const moving = !seat && dist > 0.05
      actor.walk += ((moving ? 1 : 0) - actor.walk) * Math.min(1, dt * 8)
      const yawGoal = seat ? seat.yaw : moving ? Math.atan2(delta.x, delta.z) : view.facing
      let diff = yawGoal - actor.yaw
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      actor.yaw += diff * Math.min(1, dt * 10)
      actor.figure.root.position.copy(actor.pos)
      actor.figure.root.rotation.y = actor.yaw
      actor.figure.setPose(view.pose, actor.walk, this.time, !!view.act && !moving && view.pose === 'stand')
      actor.figure.setSelected(view.id === this.selected && this.mode === 'live')
      const head = this.model.toWorld(actor.pos.x, view.pose === 'lie' ? 1.0 : view.pose === 'sit' ? 1.75 : 2.15, actor.pos.z)
      const at = this.stage.project(head)
      if (!at) { actor.label.style.display = 'none'; continue }
      actor.label.style.display = ''
      actor.label.style.left = `${at.x}px`
      actor.label.style.top = `${at.y}px`
      const text = `${view.bubble ?? ''}|${view.name}|${view.mine ? view.act ?? '' : ''}|${view.hh ? '' : view.owner}`
      if (actor.label.dataset.text !== text) {
        actor.label.dataset.text = text
        actor.label.replaceChildren(
          view.bubble ? el('div', { class: 'bubble' }, view.bubble) : '',
          el('div', {}, view.hh || !view.owner || view.owner.toLowerCase() === view.name.toLowerCase() ? view.name : `${view.name} (${view.owner})`),
          view.mine && view.act ? el('span', { class: 'act' }, view.act) : '',
        )
      }
    }
    for (const [id, actor] of this.actors) {
      if (seen.has(id)) continue
      detach(actor.figure.root)
      actor.label.remove()
      this.actors.delete(id)
    }
  }

  update(dt: number): void {
    this.time += dt
    if (!this.model) return
    const { hour, minute } = clockParts(this.clock)
    this.stage.setDaylight(hour + minute / 60)
    this.ground.setNight(this.stage.night)
    this.model.house.setNight(this.stage.night, this.home)
    if (this.neighbors) for (const [lot, model] of this.neighbors.models) model.house.setNight(this.stage.night, !!this.options.street?.lots[lot]?.home)
    this.updateWallView()
    if (this.town) {
      this.town.setNight(this.stage.night)
      this.town.update(dt)
      const lawn = this.town.state?.lawns[this.view?.lot ?? 0]
      if (this.grass && lawn !== undefined) this.grass.scale.y = 0.55 + lawn * 0.95
    }
    this.syncActors(dt)
    this.updateGhost()
    this.stage.follow(this.stage.rig.target)
  }

  dispose(): void {
    if (this.stage.target === this) this.stage.target = null
    removeEventListener('keydown', this.onKey)
    this.link.onMessage = () => undefined
    this.link.onClosed = () => undefined
    this.link.close()
    for (const actor of this.actors.values()) actor.label.remove()
    this.actors.clear()
    this.closeMenu()
    this.knocks?.remove()
    this.side?.node.remove()
    this.top.remove()
    this.bottom.remove()
    this.model?.dispose()
    this.town?.dispose()
    if (this.neighbors) {
      for (const model of this.neighbors.models.values()) model.dispose()
      detach(this.neighbors.root)
    }
    for (const pad of this.pads.values()) pad.geometry.dispose()
    if (this.ghostModel) detach(this.ghostModel)
    detach(this.ghost)
    this.ghostMat.dispose()
    this.ghostBad.dispose()
    detach(this.ground.group)
  }
}
