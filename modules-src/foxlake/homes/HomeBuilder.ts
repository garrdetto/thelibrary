/**
 * The Hood's build and buy mode on your own Fox Lake lot (`hood/src/scene/LotMode.ts`, ported to the town's Babylon
 * scene). E on your lot opens it: the camera rises over the house (right-drag turns it, the wheel zooms, WASD or the
 * arrow keys pan), The Hood's grid shows on the lot, and The Hood's own panels run along the top and bottom.
 *
 * Build: Room (walls and a floor), Wall, Remove wall, Door, Window, Remove opening, Floor (any of The Hood's floors, or
 * erase), Exterior design (The Hood's designer: looks, siding and wainscot, trim, windows and shutters, doors and
 * lanterns, roof, inside walls), Canopy, Porch roof, Pergola, Fence, Chimney and Remove feature. Buy: The Hood's whole
 * catalog with search, categories, sorting and an affordable filter; click to place (R turns it), click something you
 * own to move, turn or sell it. Walls can stand up, be cut away toward the camera, or come down, and the roof can come
 * off. Every step goes to the authority as one of The Hood's build ops; the house redraws from the authority's answer.
 */
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Material } from '@babylonjs/core/Materials/material'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import type { Scene } from '@babylonjs/core/scene'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { MeshBuilder, finishMesh, shareGeometry } from '../fp/core/Geo'
import type { Mats } from '../fp/core/Tex'
import type { Houses } from '../fp/world/Houses'
import { CATALOG, CATEGORY_ICONS, CATEGORY_LABELS, FLOOR_MATERIALS, objectDef, type Category, type ObjectDef } from '../../hood/shared/Catalog'
import { placementError } from '../../hood/shared/Build'
import { D, LotGrid, W, featureEdges, footprintSize, inLot, type LotState, type PlacedObject } from '../../hood/shared/Lot'
import { NEEDS, NEED_LABELS, type Need } from '../../hood/shared/Needs'
import { CANOPY_STYLES, FEATURE_COSTS, FEATURE_LABELS, FENCE_STYLES, PORCH_POSTS, type FeatureKind } from '../../hood/shared/Style'
import { button, el, installStyles, money } from '../../hood/src/ui/Ui'
import { choiceRow, paletteRow, renderStylePanel, type StyleTab } from '../../hood/src/ui/StylePanel'
import { frameYaw, gridToTown, homeFrame, townToGrid, type FoxHome, type HomeFrame, type HoodBuildOp } from '../../maplestreet/shared/HoodHomes'
import type { LotState as TownLot } from '../../maplestreet/shared/BuildRules'
import { TOWN_Y, sceneToTown, townToScene } from '../region'
import { HOME_BASE_Y, type WallMode } from './HomeMesher'

type Mode = 'build' | 'buy'
type Tool = 'room' | 'wall' | 'unwall' | 'door' | 'window' | 'unopen' | 'floor' | 'exterior' | 'canopy' | 'porch' | 'pergola' | 'fence' | 'chimney' | 'unfeature'
type BuySort = 'name' | 'cheap' | 'pricey'

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
  { id: 'fence', label: 'Fence', hint: 'Drag along the grid in the yard, or click one edge. Gates are one tile.' },
  { id: 'chimney', label: 'Chimney', hint: 'Click a tile inside the house to run a brick chimney up through the roof.' },
  { id: 'unfeature', label: 'Remove feature', hint: 'Click a canopy, porch, pergola, fence or chimney to take it down for half its cost back.' },
]
const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[]
const NEED_ICONS: Record<Need, string> = { hunger: '🍽', energy: '💤', hygiene: '🫧', bladder: '🚻', social: '💬', fun: '🎉' }
const DRAG_TOOLS: Tool[] = ['room', 'wall', 'unwall', 'floor', 'porch', 'pergola', 'fence']

function needBadges(def: ObjectDef): Need[] {
  const out = new Set<Need>()
  for (const action of def.actions) for (const need of NEEDS) if ((action.gains[need] ?? 0) > 0) out.add(need)
  return [...out]
}

export interface BuilderHost {
  scene: Scene
  engine: Engine | AbstractEngine
  camera: Camera
  canvas: HTMLCanvasElement
  mats: Mats
  houses: Houses
  townRoot: TransformNode
  /** Money to spend (Infinity in solo). */
  funds(): number
  send(lotId: string, op: HoodBuildOp | { op: 'start' }): void
  setCameraShot(shot: { eye: Vector3; target: Vector3 } | null): void
  toast(text: string): void
}

export class HomeBuilder {
  private ui: HTMLDivElement | null = null
  private dock!: HTMLDivElement
  private topBar!: HTMLDivElement
  private lot: TownLot | null = null
  private frame: HomeFrame | null = null
  private mode: Mode = 'build'
  private tool: Tool = 'room'
  private wallMode: WallMode = 'cut'
  private roof = false
  private floorMat = 0
  private styleTab: StyleTab = 'presets'
  private canopyWidth = 2
  private featureStyle: Record<FeatureKind, string> = { canopy: 'gable', porch: 'square', pergola: 'standard', fence: 'picket', chimney: 'standard' }
  private featureColor: Record<FeatureKind, number> = { canopy: 15, porch: 1, pergola: 26, fence: 1, chimney: 22 }
  private buyDef: ObjectDef | null = null
  private buyRotation = 0
  private buyCategory: Category | 'all' = 'all'
  private buySort: BuySort = 'name'
  private buySearch = ''
  private buyAfford = false
  private buyUi: { root: HTMLElement; search: HTMLInputElement; tabs: HTMLElement; items: HTMLElement; footer: HTMLElement; head: HTMLElement; key: string } | null = null
  private picked: PlacedObject | null = null
  private moving: PlacedObject | null = null
  private drag: { start: [number, number]; end: [number, number] } | null = null
  private hover: { x: number; z: number } | null = null
  private orbit = { yaw: 0, pitch: 0.95, dist: 30, target: new Vector3() }
  private shot = { eye: new Vector3(), target: new Vector3() }
  private pointer: { id: number; button: number; x: number; y: number; moved: boolean; dragging: boolean } | null = null
  private keys = new Set<string>()
  private waiting = false
  private ghostRoot: TransformNode | null = null
  private ghostModel: { id: string; node: TransformNode } | null = null
  private pads = new Map<string, Mesh>()
  private unitBox: Mesh | null = null
  private gridMesh: Mesh | null = null
  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = []

  constructor(private readonly host: BuilderHost) {}

  get isOpen(): boolean {
    return !!this.ui && !this.ui.hidden
  }

  private get home(): FoxHome | null {
    return this.lot ? this.host.houses.home(this.lot.id) : null
  }

  // ------------------------------------------------------------ open and close

  /** Opens the builder on `lot` (yours). A lot that still has its old house becomes The Hood's starter home first. */
  open(lot: TownLot): void {
    this.lot = lot
    this.frame = homeFrame(lot)
    this.buildUi()
    this.ui!.hidden = false
    document.body.classList.add('fl-building')
    if (document.pointerLockElement) document.exitPointerLock()
    const center = this.toScene(W / 2, D / 2)
    this.orbit.target.copyFrom(center)
    this.orbit.yaw = frameYaw(this.frame)
    this.orbit.dist = 30
    this.orbit.pitch = 0.95
    this.placeCamera()
    this.shot.eye.copyFrom(this.host.camera.position)
    this.host.setCameraShot(this.shot)
    this.makeGhosts()
    this.listen()
    if (!this.home) {
      this.waiting = true
      this.host.send(lot.id, { op: 'start' })
    }
    this.applyView()
    this.render()
  }

  close(): void {
    if (!this.ui || this.ui.hidden) return
    this.ui.hidden = true
    document.body.classList.remove('fl-building')
    this.host.setCameraShot(null)
    this.host.houses.setEditing(null)
    for (const [target, type, fn, opts] of this.listeners) target.removeEventListener(type, fn, opts)
    this.listeners.length = 0
    this.keys.clear()
    this.drag = null
    this.pointer = null
    this.picked = null
    this.moving = null
    this.buyDef = null
    this.dropGhosts()
  }

  /** The authority's answer: the home changed (yours or anyone's), or a step was refused. */
  onHome(lotId: string, mine: boolean): void {
    if (!this.isOpen || !this.lot || lotId !== this.lot.id) return
    if (this.waiting) {
      this.waiting = false
      this.host.toast('Your house is now built with The Hood\'s builder. Have fun!')
    }
    const home = this.home
    if (home && this.picked) this.picked = home.objects.find((o) => o.id === this.picked!.id) ?? null
    if (home && this.moving && !home.objects.some((o) => o.id === this.moving!.id)) this.moving = null
    if (mine) this.render()
  }

  onRejected(reason: string): void {
    if (this.isOpen) this.host.toast(reason)
  }

  // ------------------------------------------------------------ the panels

  private buildUi(): void {
    if (this.ui) return
    const root = installStyles('#e8a33c')
    root.classList.add('fl-home')
    root.dataset.hostModal = ''
    root.hidden = true
    this.topBar = el('div', { class: 'panel card', role: 'toolbar', 'aria-label': 'Home builder' })
    this.dock = el('div', { class: 'panel dock', role: 'region', 'aria-label': 'Build and buy' })
    root.append(el('div', { class: 'top' }, this.topBar), el('div', { class: 'bottom' }, this.dock))
    document.body.append(root)
    this.ui = root
  }

  private render(): void {
    if (!this.ui || !this.lot) return
    const funds = this.host.funds()
    const fundsText = Number.isFinite(funds) && funds < 1e8 ? money(funds) : 'Unlimited'
    const modeBtn = (m: Mode, label: string, key: string) => {
      const b = button(label, () => this.setMode(m), `btn${this.mode === m ? ' on' : ''}`, `${label} (${key})`)
      b.setAttribute('aria-pressed', String(this.mode === m))
      return b
    }
    const wallBtn = (w: WallMode, label: string) => {
      const b = button(label, () => { this.wallMode = w; this.applyView(); this.render() }, `btn${this.wallMode === w ? ' on' : ''}`)
      b.setAttribute('aria-pressed', String(this.wallMode === w))
      return b
    }
    const roofBtn = button(this.roof ? 'Roof on' : 'Roof off', () => { this.roof = !this.roof; this.applyView(); this.render() }, `btn${this.roof ? ' on' : ''}`, 'Show or hide the roof')
    roofBtn.setAttribute('aria-pressed', String(this.roof))
    this.topBar.replaceChildren(
      el('div', { class: 'row' },
        el('span', { class: 'title' }, `Lot ${this.lot.id}`),
        el('span', { class: 'sub' }, this.waiting ? 'Setting up your house…' : `${fundsText} to spend`),
        modeBtn('build', 'Build', '1'), modeBtn('buy', 'Buy', '2'),
        el('span', { class: 'sub' }, 'Walls'), wallBtn('up', 'Up'), wallBtn('cut', 'Cutaway'), wallBtn('down', 'Down'), roofBtn,
        button('Done', () => this.close(), 'btn primary', 'Leave the builder (Esc)')),
      el('div', { class: 'hint' }, 'Right-drag turns the view, the wheel zooms, WASD or the arrow keys move it. Esc stops placing, then leaves.'))
    if (this.mode === 'build') this.renderBuild()
    else this.renderBuy()
  }

  private setMode(m: Mode): void {
    this.mode = m
    this.picked = null
    this.moving = null
    this.buyDef = null
    this.drag = null
    this.render()
  }

  private renderBuild(): void {
    const home = this.home
    const tools = el('div', { class: 'tools', role: 'toolbar', 'aria-label': 'Build tools' }, ...TOOLS.map((t) => {
      const b = button(t.label, () => { this.tool = t.id; this.render() }, `btn${this.tool === t.id ? ' on' : ''}`)
      b.setAttribute('aria-pressed', String(this.tool === t.id))
      return b
    }))
    const extra: HTMLElement[] = []
    if (this.tool === 'room' || this.tool === 'floor') {
      extra.push(el('div', { class: 'row', style: 'margin-top:6px' }, el('span', { class: 'sub' }, 'Floor'), ...FLOOR_MATERIALS.map((m, i) => {
        const b = el('button', { type: 'button', class: `sw${this.floorMat === i ? ' on' : ''}`, style: `background:${m.color}`, title: m.name, 'aria-label': m.name, 'aria-pressed': String(this.floorMat === i) })
        b.addEventListener('click', () => { this.floorMat = i; this.render() })
        return b
      }), this.tool === 'floor' ? button('Erase floor', () => { this.floorMat = -1; this.render() }, `btn${this.floorMat === -1 ? ' on' : ''}`) : null))
    }
    if (this.tool === 'exterior' && home) {
      extra.push(renderStylePanel(home.style, this.styleTab, (tab) => { this.styleTab = tab; this.render() }, (patch) => this.sendOp({ op: 'style', patch })))
    }
    if (['canopy', 'porch', 'pergola', 'fence', 'chimney'].includes(this.tool)) {
      const kind = this.tool as FeatureKind
      const styles = kind === 'canopy' ? CANOPY_STYLES : kind === 'porch' ? PORCH_POSTS : kind === 'fence' ? FENCE_STYLES : []
      const box = el('div', { class: 'designer' })
      if (styles.length) box.append(choiceRow('Style', styles, this.featureStyle[kind], (o) => FEATURE_LABELS[o] ?? o, (v) => { this.featureStyle[kind] = v; this.render() }))
      if (kind === 'canopy') box.append(choiceRow('Width', [1, 2, 3], this.canopyWidth, (w) => ['Narrow', 'Standard', 'Wide'][w - 1], (v) => { this.canopyWidth = v; this.render() }))
      box.append(paletteRow(kind === 'chimney' ? 'Brick color' : kind === 'porch' ? 'Post and beam color' : 'Color', this.featureColor[kind], (i) => { this.featureColor[kind] = i; this.render() }))
      const price = kind === 'canopy' ? `$${FEATURE_COSTS.canopyPerTile} per width step` : kind === 'porch' ? `$${FEATURE_COSTS.porchPerTile} a tile` : kind === 'pergola' ? `$${FEATURE_COSTS.pergolaPerTile} a tile` : kind === 'fence' ? `$${FEATURE_COSTS.fencePerEdge} a tile, gates $${FEATURE_COSTS.gate}` : `$${FEATURE_COSTS.chimney}`
      box.append(el('div', { class: 'hint' }, price))
      extra.push(box)
    }
    const hint = TOOLS.find((t) => t.id === this.tool)?.hint ?? ''
    this.dock.replaceChildren(tools, ...extra, el('div', { class: 'hint' }, `${hint}${this.tool === 'exterior' ? ' Changing siding costs per wall face; colors and trim are free.' : ' Walls $12, floors $4 a tile, doors $150, windows $90.'}`))
  }

  private renderBuy(): void {
    if (!this.buyUi) {
      const search = el('input', { type: 'search', class: 'search', placeholder: 'Search 140+ items…  ( / )', 'aria-label': 'Search the catalog', value: this.buySearch }) as HTMLInputElement
      search.addEventListener('input', () => { this.buySearch = search.value; this.renderBuy() })
      const sort = el('select', { 'aria-label': 'Sort items' },
        el('option', { value: 'name' }, 'Sort: A to Z'), el('option', { value: 'cheap' }, 'Price: low to high'), el('option', { value: 'pricey' }, 'Price: high to low')) as HTMLSelectElement
      sort.value = this.buySort
      sort.addEventListener('change', () => { this.buySort = sort.value as BuySort; this.renderBuy() })
      const afford = el('input', { type: 'checkbox' }) as HTMLInputElement
      afford.checked = this.buyAfford
      afford.addEventListener('change', () => { this.buyAfford = afford.checked; this.renderBuy() })
      const head = el('span', { class: 'sub' })
      const tabs = el('div', { class: 'cattabs', role: 'tablist', 'aria-label': 'Catalog categories' })
      const items = el('div', { class: 'items buyitems', role: 'list' })
      const footer = el('div', { class: 'buyfoot' })
      const root = el('div', { class: 'buy' }, el('div', { class: 'buyhead' }, search, sort, el('label', { class: 'toggle sm' }, afford, el('span', {}, 'Only what I can afford')), head), tabs, items, footer)
      this.buyUi = { root, search, tabs, items, footer, head, key: '' }
    }
    const ui = this.buyUi
    if (ui.root.parentElement !== this.dock) { this.dock.replaceChildren(ui.root); ui.key = '' }
    const funds = this.host.funds()
    const query = this.buySearch.trim().toLowerCase()
    const matches = (def: ObjectDef) => !query || def.name.toLowerCase().includes(query) || CATEGORY_LABELS[def.category].toLowerCase().includes(query) || def.actions.some((a) => a.label.toLowerCase().includes(query)) || needBadges(def).some((n) => NEED_LABELS[n].toLowerCase().includes(query))
    const affordable = (def: ObjectDef) => !this.buyAfford || def.price <= funds
    const pool = CATALOG.filter((d) => matches(d) && affordable(d))
    const shown = pool.filter((d) => query || this.buyCategory === 'all' || d.category === this.buyCategory)
    shown.sort((a, b) => this.buySort === 'cheap' ? a.price - b.price || a.name.localeCompare(b.name) : this.buySort === 'pricey' ? b.price - a.price || a.name.localeCompare(b.name) : a.name.localeCompare(b.name))
    const key = JSON.stringify([query, this.buyCategory, this.buySort, this.buyAfford, this.buyDef?.id, Math.min(funds, 1e12), this.picked?.id ?? null, this.picked?.r ?? null, !!this.moving])
    if (key === ui.key) return
    ui.key = key
    ui.head.textContent = Number.isFinite(funds) && funds < 1e8 ? `${money(funds)} to spend` : 'Unlimited money (solo)'
    const counts = new Map<string, number>()
    for (const d of pool) counts.set(d.category, (counts.get(d.category) ?? 0) + 1)
    const tab = (id: Category | 'all', label: string, icon: string, n: number) => {
      const on = !query && this.buyCategory === id
      const b = button(`${icon} ${label}`, () => { this.buyCategory = id; if (this.buySearch) { this.buySearch = ''; ui.search.value = '' } this.renderBuy() }, `btn cat${on ? ' on' : ''}`)
      b.append(el('small', { class: 'count' }, String(n)))
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(on))
      b.disabled = n === 0
      return b
    }
    ui.tabs.replaceChildren(tab('all', 'All', '✨', pool.length), ...CATEGORIES.map((c) => tab(c, CATEGORY_LABELS[c], CATEGORY_ICONS[c], counts.get(c) ?? 0)))
    if (!shown.length) {
      ui.items.replaceChildren(el('div', { class: 'hint', style: 'padding:12px' }, query ? `Nothing matches “${this.buySearch.trim()}”. Try a room like “kitchen” or a need like “fun”.` : 'Nothing here fits the budget yet.'))
    } else {
      ui.items.replaceChildren(...shown.map((def) => {
        const cant = def.price > funds
        const badges = needBadges(def)
        const place = def.place === 'outdoor' ? 'Yard' : def.place === 'indoor' ? 'Indoors' : 'Anywhere'
        const b = el('button', { type: 'button', role: 'listitem', class: `item card${this.buyDef?.id === def.id ? ' on' : ''}${cant ? ' cant' : ''}`, title: `${def.name}: ${def.actions.map((a) => a.label).join(', ') || 'decoration'}` },
          el('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap;width:100%' },
            el('span', { class: 'chips' }, el('i', { style: `background:${def.color}` }), el('i', { style: `background:${def.accent}` })),
            el('b', { class: 'name' }, def.name)),
          el('div', { class: 'meta' }, el('span', { class: cant ? 'price cant' : 'price' }, money(def.price)), el('span', {}, `${def.w}×${def.d}`), el('span', {}, place), def.seats && def.seats > 1 ? el('span', {}, `${def.seats} seats`) : null),
          badges.length ? el('div', { class: 'badges' }, ...badges.map((n) => el('span', { class: 'nb', title: NEED_LABELS[n] }, `${NEED_ICONS[n]} ${NEED_LABELS[n]}`))) : el('div', { class: 'badges' }, el('span', { class: 'nb muted' }, 'Decoration')),
        )
        b.addEventListener('click', () => {
          if (cant) { this.host.toast(`${def.name} costs ${money(def.price)}. You have ${money(funds)}.`); return }
          this.buyDef = def; this.moving = null; this.picked = null; this.buyRotation = 0; this.renderBuy()
        })
        return b
      }))
    }
    const picked = this.picked && objectDef(this.picked.def)
    ui.footer.replaceChildren(picked
      ? el('div', { class: 'row' }, el('b', {}, picked.name),
        button('Move', () => { this.moving = this.picked; this.buyRotation = this.picked!.r; this.renderBuy() }),
        button('Turn ⟳', () => this.picked && this.sendOp({ op: 'move', id: this.picked.id, x: this.picked.x, z: this.picked.z, r: (this.picked.r + 1) % 4 })),
        button(`Sell for ${money(Math.floor(picked.price / 2))}`, () => this.sellPicked(), 'btn danger'),
        button('Done', () => { this.picked = null; this.renderBuy() }))
      : el('div', { class: 'hint' }, this.buyDef ? `Placing ${this.buyDef.name}: click the lot to place it, R turns it, Esc or right-click stops.` : this.moving ? 'Click where it should go. R turns it, Esc cancels.' : 'Pick an item to place it, or click something you own to move, turn or sell it.'))
  }

  private sellPicked(): void {
    if (!this.picked) return
    this.sendOp({ op: 'sell', id: this.picked.id })
    this.picked = null
    this.render()
  }

  private sendOp(op: HoodBuildOp): void {
    if (!this.lot) return
    if (this.waiting) return this.host.toast('One moment: your house is still being set up.')
    this.host.send(this.lot.id, op)
  }

  // ------------------------------------------------------------ view and camera

  private applyView(): void {
    if (!this.lot || !this.frame) return
    const cam = this.host.camera.position
    const t = sceneToTown(cam.x, cam.y, cam.z)
    const g = townToGrid(this.frame, t.x, t.z)
    this.host.houses.setEditing(this.lot.id, { walls: this.wallMode, roof: this.roof, camera: { gx: g.gx, gz: g.gz } })
  }

  private placeCamera(): void {
    const o = this.orbit
    const c = Math.cos(o.pitch)
    this.shot.target.copyFrom(o.target)
    this.shot.eye.set(o.target.x + Math.sin(o.yaw) * c * o.dist, o.target.y + Math.sin(o.pitch) * o.dist, o.target.z + Math.cos(o.yaw) * c * o.dist)
  }

  /** Grid metres (x, z) to the scene, on the lot's floor. */
  private toScene(gx: number, gz: number): Vector3 {
    const t = gridToTown(this.frame!, gx, gz)
    const s = townToScene(t.x, HOME_BASE_Y, t.z)
    return new Vector3(s.x, s.y, s.z)
  }

  /** Where the pointer meets the lot's floor, in grid metres. */
  private gridPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.frame) return null
    const canvas = this.host.canvas
    const rect = canvas.getBoundingClientRect()
    const sx = this.host.engine.getRenderWidth() / Math.max(1, rect.width), sy = this.host.engine.getRenderHeight() / Math.max(1, rect.height)
    const ray = this.host.scene.createPickingRay((clientX - rect.left) * sx, (clientY - rect.top) * sy, Matrix.Identity(), this.host.camera)
    const planeY = TOWN_Y + HOME_BASE_Y
    if (Math.abs(ray.direction.y) < 1e-4) return null
    const t = (planeY - ray.origin.y) / ray.direction.y
    if (t < 0) return null
    const p = sceneToTown(ray.origin.x + ray.direction.x * t, planeY, ray.origin.z + ray.direction.z * t)
    const g = townToGrid(this.frame, p.x, p.z)
    return { x: g.gx, z: g.gz }
  }

  private tileOf(p: { x: number; z: number } | null): [number, number] | null {
    if (!p) return null
    const x = Math.floor(p.x), z = Math.floor(p.z)
    return inLot(x, z) ? [x, z] : null
  }

  private cornerOf(p: { x: number; z: number } | null): [number, number] | null {
    if (!p) return null
    if (p.x < -1 || p.z < -1 || p.x > W + 1 || p.z > D + 1) return null
    return [Math.max(0, Math.min(W, Math.round(p.x))), Math.max(0, Math.min(D, Math.round(p.z)))]
  }

  private edgeOf(p: { x: number; z: number } | null): [number, number, 0 | 1] | null {
    if (!p) return null
    const hz = Math.round(p.z), vx = Math.round(p.x)
    const dh = Math.abs(p.z - hz), dv = Math.abs(p.x - vx)
    if (Math.min(dh, dv) > 0.45) return null
    return dh <= dv ? [Math.floor(p.x), hz, 0] : [vx, Math.floor(p.z), 1]
  }

  // ------------------------------------------------------------ input

  private listen(): void {
    const on = (target: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push([target, type, fn as EventListener, opts])
    }
    const canvas = this.host.canvas
    on(canvas, 'pointerdown', (e: PointerEvent) => this.pointerDown(e))
    on(window, 'pointermove', (e: PointerEvent) => this.pointerMove(e))
    on(window, 'pointerup', (e: PointerEvent) => this.pointerUp(e))
    on(canvas, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.orbit.dist = Math.max(8, Math.min(70, this.orbit.dist * Math.exp(e.deltaY * 0.0012))) }, { passive: false })
    on(canvas, 'contextmenu', (e: MouseEvent) => e.preventDefault())
    on(window, 'keydown', (e: KeyboardEvent) => this.keyDown(e), { capture: true })
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code), { capture: true })
    on(window, 'blur', () => this.keys.clear())
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.isOpen) return
    this.pointer = { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, moved: false, dragging: false }
    if (e.button === 0 && this.mode === 'build' && DRAG_TOOLS.includes(this.tool)) {
      const p = this.gridPoint(e.clientX, e.clientY)
      const at = this.byTile() ? this.tileOf(p) : this.cornerOf(p)
      if (at) { this.drag = { start: at, end: at }; this.pointer.dragging = true }
    }
    e.preventDefault()
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.isOpen) return
    const p = this.gridPoint(e.clientX, e.clientY)
    this.hover = p
    const ptr = this.pointer
    if (!ptr || ptr.id !== e.pointerId) return
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y
    if (Math.abs(dx) + Math.abs(dy) > 4) ptr.moved = true
    if (ptr.button === 2 || ptr.button === 1) {
      if (ptr.button === 2) {
        this.orbit.yaw += dx * 0.006
        this.orbit.pitch = Math.max(0.35, Math.min(1.45, this.orbit.pitch + dy * 0.005))
      } else this.pan(-dx * this.orbit.dist * 0.0016, dy * this.orbit.dist * 0.0016)
      ptr.x = e.clientX
      ptr.y = e.clientY
      return
    }
    if (ptr.dragging && this.drag) {
      const at = this.byTile() ? this.tileOf(p) : this.cornerOf(p)
      if (!at) return
      if (this.tool === 'wall' || this.tool === 'unwall' || this.tool === 'fence') {
        const [sx, sz] = this.drag.start
        this.drag.end = Math.abs(at[0] - sx) >= Math.abs(at[1] - sz) ? [at[0], sz] : [sx, at[1]]
      } else this.drag.end = at
    }
  }

  private pointerUp(e: PointerEvent): void {
    const ptr = this.pointer
    if (!ptr || ptr.id !== e.pointerId || !this.isOpen) return
    this.pointer = null
    if (ptr.button === 2) {
      if (!ptr.moved && (this.buyDef || this.moving)) { this.buyDef = null; this.moving = null; this.render() }
      return
    }
    if (ptr.button !== 0) return
    if (ptr.dragging) return this.dragEnd()
    if (!ptr.moved) this.click(this.gridPoint(e.clientX, e.clientY))
  }

  private keyDown(e: KeyboardEvent): void {
    if (!this.isOpen) return
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
    if (e.code === 'Escape') {
      e.preventDefault(); e.stopPropagation()
      if (typing) { (e.target as HTMLElement).blur(); return }
      if (this.drag) { this.drag = null; return }
      if (this.buyDef || this.moving || this.picked) { this.buyDef = null; this.moving = null; this.picked = null; this.render(); return }
      this.close()
      return
    }
    if (typing) return
    e.stopPropagation()
    if (e.code === 'Digit1') { this.setMode('build'); e.preventDefault() }
    else if (e.code === 'Digit2') { this.setMode('buy'); e.preventDefault() }
    else if (e.code === 'KeyR' && this.mode === 'buy') { this.buyRotation = (this.buyRotation + 1) % 4; e.preventDefault() }
    else if ((e.code === 'Delete' || e.code === 'Backspace') && this.picked) { this.sellPicked(); e.preventDefault() }
    else if (e.code === 'Slash' && this.mode === 'buy') { e.preventDefault(); this.buyUi?.search.focus() }
    else this.keys.add(e.code)
  }

  private pan(right: number, forward: number): void {
    const yaw = this.orbit.yaw
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw)
    const rx = -fz, rz = fx
    this.orbit.target.x += rx * right + fx * forward
    this.orbit.target.z += rz * right + fz * forward
    const center = this.toScene(W / 2, D / 2)
    const dx = this.orbit.target.x - center.x, dz = this.orbit.target.z - center.z, d = Math.hypot(dx, dz)
    if (d > 30) { this.orbit.target.x = center.x + dx / d * 30; this.orbit.target.z = center.z + dz / d * 30 }
  }

  private byTile(): boolean {
    return this.tool === 'floor' || this.tool === 'porch' || this.tool === 'pergola'
  }

  // ------------------------------------------------------------ clicks and drags

  private click(p: { x: number; z: number } | null): void {
    if (!this.home) return
    if (this.mode === 'buy') return this.buyClick(p)
    const t = this.tool
    if (t === 'door' || t === 'window' || t === 'unopen') {
      const edge = this.edgeOf(p)
      if (edge) this.sendOp({ op: t, x: edge[0], z: edge[1], v: edge[2] })
      return
    }
    if (t === 'canopy') {
      const edge = this.edgeOf(p)
      if (edge) this.sendOp({ op: 'feature', kind: 'canopy', x: edge[0], z: edge[1], v: edge[2], style: this.featureStyle.canopy, color: this.featureColor.canopy, width: this.canopyWidth })
      return
    }
    if (t === 'fence') {
      const edge = this.edgeOf(p)
      if (edge) this.sendOp({ op: 'feature', kind: 'fence', x: edge[0], z: edge[1], x2: edge[2] === 0 ? edge[0] + 1 : edge[0], z2: edge[2] === 1 ? edge[1] + 1 : edge[1], style: this.featureStyle.fence, color: this.featureColor.fence })
      return
    }
    if (t === 'chimney') {
      const tile = this.tileOf(p)
      if (tile) this.sendOp({ op: 'feature', kind: 'chimney', x: tile[0], z: tile[1], style: 'standard', color: this.featureColor.chimney })
      return
    }
    if (t === 'porch' || t === 'pergola') {
      const tile = this.tileOf(p)
      if (tile) this.sendOp({ op: 'feature', kind: t, x: tile[0], z: tile[1], x2: tile[0], z2: tile[1], style: this.featureStyle[t], color: this.featureColor[t] })
      return
    }
    if (t === 'unfeature') {
      const id = this.featureAt(p)
      if (id !== null) this.sendOp({ op: 'unfeature', id })
      else this.host.toast('Click a canopy, porch, pergola, fence or chimney.')
      return
    }
    if (t === 'floor') {
      const tile = this.tileOf(p)
      if (tile) this.sendOp({ op: 'floor', x0: tile[0], z0: tile[1], x1: tile[0] + 1, z1: tile[1] + 1, floor: this.floorMat })
    }
  }

  /** The feature under a point on the grid: a chimney's tile, a porch or pergola's area, a fence or canopy's edge. */
  private featureAt(p: { x: number; z: number } | null): number | null {
    const home = this.home
    if (!home || !p) return null
    const tile = this.tileOf(p)
    const edge = this.edgeOf(p)
    for (const f of [...home.features].reverse()) {
      if (f.kind === 'chimney' && tile && f.x === tile[0] && f.z === tile[1]) return f.id
      if ((f.kind === 'porch' || f.kind === 'pergola') && tile) {
        const x0 = Math.min(f.x, f.x2 ?? f.x), x1 = Math.max(f.x, f.x2 ?? f.x), z0 = Math.min(f.z, f.z2 ?? f.z), z1 = Math.max(f.z, f.z2 ?? f.z)
        if (tile[0] >= x0 && tile[0] <= x1 && tile[1] >= z0 && tile[1] <= z1) return f.id
      }
      if (edge && f.kind === 'fence' && featureEdges(f).some(([x, z, v]) => x === edge[0] && z === edge[1] && v === edge[2])) return f.id
      if (edge && f.kind === 'canopy' && f.x === edge[0] && f.z === edge[1] && f.v === edge[2]) return f.id
    }
    return null
  }

  private dragEnd(): void {
    const drag = this.drag
    this.drag = null
    if (!drag || !this.home) return
    const [x0, z0] = drag.start
    const [x1, z1] = drag.end
    const t = this.tool
    if (t === 'room') this.sendOp({ op: 'room', x0, z0, x1, z1, floor: Math.max(0, this.floorMat) })
    else if (t === 'wall') this.sendOp({ op: 'wall', x0, z0, x1, z1 })
    else if (t === 'unwall') this.sendOp({ op: 'unwall', x0, z0, x1, z1 })
    else if (t === 'floor') this.sendOp({ op: 'floor', x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1) + 1, z1: Math.max(z0, z1) + 1, floor: this.floorMat })
    else if (t === 'porch' || t === 'pergola') this.sendOp({ op: 'feature', kind: t, x: x0, z: z0, x2: x1, z2: z1, style: this.featureStyle[t], color: this.featureColor[t] })
    else if (t === 'fence') {
      if (x0 !== x1 || z0 !== z1) this.sendOp({ op: 'feature', kind: 'fence', x: x0, z: z0, x2: x1, z2: z1, style: this.featureStyle.fence === 'gate' ? 'picket' : this.featureStyle.fence, color: this.featureColor.fence })
      else {
        const p = this.hover
        if (p) this.click(p)
      }
    }
  }

  private buyClick(p: { x: number; z: number } | null): void {
    const home = this.home
    if (!home) return
    const def = this.moving ? objectDef(this.moving.def) : this.buyDef
    const tile = this.tileOf(p)
    if (def) {
      if (!tile) return
      const [x, z] = this.ghostOrigin(def, tile)
      if (this.moving) {
        this.sendOp({ op: 'move', id: this.moving.id, x, z, r: this.buyRotation })
        this.moving = null
        this.render()
      } else this.sendOp({ op: 'buy', def: def.id, x, z, r: this.buyRotation })
      return
    }
    this.picked = tile ? this.objectAt(home, tile) : null
    this.render()
  }

  /** The item standing on a tile (rugs and other flat items too, when nothing stands on them). */
  private objectAt(home: FoxHome, [tx, tz]: [number, number]): PlacedObject | null {
    let flat: PlacedObject | null = null
    for (const o of home.objects) {
      const def = objectDef(o.def)
      if (!def) continue
      const [fw, fd] = footprintSize(def, o.r)
      if (tx < o.x || tz < o.z || tx >= o.x + fw || tz >= o.z + fd) continue
      if (!def.flat) return o
      flat = o
    }
    return flat
  }

  private ghostOrigin(def: ObjectDef, tile: [number, number]): [number, number] {
    const [fw, fd] = footprintSize(def, this.buyRotation)
    return [tile[0] - Math.floor((fw - 1) / 2), tile[1] - Math.floor((fd - 1) / 2)]
  }

  // ------------------------------------------------------------ previews

  private makeGhosts(): void {
    if (this.ghostRoot || !this.frame) return
    const { scene, mats } = this.host
    const root = new TransformNode('home-builder', scene)
    root.parent = this.host.townRoot
    root.position.set(this.frame.ox, HOME_BASE_Y, this.frame.oz)
    root.rotation.y = frameYaw(this.frame)
    this.ghostRoot = root
    const unit = new MeshBuilder()
    unit.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5)
    this.unitBox = unit.toMesh('home-ghost-unit')
    this.unitBox.setEnabled(false)
    const lines = new MeshBuilder()
    const w = 0.035
    for (let x = 0; x <= W; x++) lines.box(x - w / 2, 0.035, 0, x + w / 2, 0.04, D)
    for (let z = 0; z <= D; z++) lines.box(0, 0.035, z - w / 2, W, 0.04, z + w / 2)
    this.gridMesh = lines.toMesh('home-grid')
    this.gridMesh.parent = root
    this.gridMesh.isPickable = false
    finishMesh(this.gridMesh, mats.plain('hd-grid', { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, opacity: 0.32, unlit: true }), { cast: false, receive: false })
  }

  private dropGhosts(): void {
    this.ghostModel?.node.dispose(false, false)
    this.ghostModel = null
    for (const m of this.pads.values()) m.dispose(false, false)
    this.pads.clear()
    this.gridMesh?.dispose(false, false)
    this.gridMesh = null
    this.unitBox?.dispose(false, false)
    this.unitBox = null
    this.ghostRoot?.dispose(false, false)
    this.ghostRoot = null
  }

  private pad(name: string, ok: boolean): Mesh {
    let mesh = this.pads.get(name)
    if (!mesh) {
      mesh = shareGeometry(this.unitBox!, `home-ghost-${name}`, this.ghostRoot)
      this.pads.set(name, mesh)
    }
    const mat: Material = ok
      ? this.host.mats.plain('hd-ghost-ok', { color: 0x5bd77d, emissive: 0x5bd77d, emissiveIntensity: 0.7, opacity: 0.42, unlit: true })
      : this.host.mats.plain('hd-ghost-bad', { color: 0xe8533c, emissive: 0xe8533c, emissiveIntensity: 0.7, opacity: 0.42, unlit: true })
    mesh.material = mat
    return mesh
  }

  private updateGhosts(): void {
    if (!this.ghostRoot) return
    const keep = new Set<Mesh>()
    const home = this.home
    const p = this.hover
    const def = this.mode === 'buy' ? (this.moving ? objectDef(this.moving.def) ?? null : this.buyDef) : null
    const tile = this.tileOf(p)
    if (def && tile && home) {
      if (this.ghostModel?.id !== def.id) {
        this.ghostModel?.node.dispose(false, false)
        const holder = new TransformNode('home-ghost-model', this.host.scene)
        holder.parent = this.ghostRoot
        this.ghostModel = { id: def.id, node: holder }
        void this.host.houses.hoodFurniture.load().then(() => { if (this.ghostModel?.node === holder) this.host.houses.hoodFurniture.make(def.id, holder) })
      }
      const [x, z] = this.ghostOrigin(def, tile)
      const [fw, fd] = footprintSize(def, this.buyRotation)
      this.ghostModel.node.position.set(x + fw / 2, 0.03, z + fd / 2)
      this.ghostModel.node.rotation.y = -this.buyRotation * Math.PI / 2
      this.ghostModel.node.setEnabled(true)
      const ok = !placementError(home as unknown as LotState, new LotGrid(home), def.id, x, z, this.buyRotation, this.moving?.id ?? -1)
      const pad = this.pad('footprint', ok)
      pad.position.set(x + fw / 2, 0.06, z + fd / 2)
      pad.scaling.set(fw, 0.02, fd)
      keep.add(pad)
    } else if (this.ghostModel) {
      this.ghostModel.node.setEnabled(false)
    }
    if (this.mode === 'buy' && this.picked && home) {
      const pd = objectDef(this.picked.def)
      if (pd) {
        const [fw, fd] = footprintSize(pd, this.picked.r)
        const pad = this.pad('picked', true)
        pad.position.set(this.picked.x + fw / 2, 0.06, this.picked.z + fd / 2)
        pad.scaling.set(fw + 0.1, 0.02, fd + 0.1)
        keep.add(pad)
      }
    }
    if (this.mode === 'build') {
      if (this.drag) {
        const [x0, z0] = this.drag.start
        const [x1, z1] = this.drag.end
        if (this.byTile()) {
          const pad = this.pad('drag', true)
          pad.position.set((Math.min(x0, x1) + Math.max(x0, x1) + 1) / 2, 0.06, (Math.min(z0, z1) + Math.max(z0, z1) + 1) / 2)
          pad.scaling.set(Math.abs(x1 - x0) + 1, 0.02, Math.abs(z1 - z0) + 1)
          keep.add(pad)
        } else {
          const bad = this.tool === 'unwall'
          const tall = this.tool === 'fence' ? 1.2 : 2.4
          const segments: [number, number, number, number][] = this.tool === 'room' ? [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1]] : [[x0, z0, x1, z1]]
          segments.forEach(([ax, az, bx, bz], i) => {
            const bar = this.pad(`seg${i}`, !bad)
            bar.position.set((ax + bx) / 2, tall / 2, (az + bz) / 2)
            bar.scaling.set(Math.max(0.12, Math.abs(bx - ax)), tall, Math.max(0.12, Math.abs(bz - az)))
            keep.add(bar)
          })
        }
      } else if (['door', 'window', 'unopen', 'canopy', 'fence'].includes(this.tool)) {
        const edge = this.edgeOf(p)
        if (edge) {
          const bar = this.pad('edge', this.tool !== 'unopen')
          const [x, z, v] = edge
          if (v === 0) { bar.position.set(x + 0.5, 1.1, z); bar.scaling.set(0.9, 2.2, 0.2) }
          else { bar.position.set(x, 1.1, z + 0.5); bar.scaling.set(0.2, 2.2, 0.9) }
          keep.add(bar)
        }
      } else if (tile && ['floor', 'chimney', 'porch', 'pergola', 'unfeature', 'room', 'wall', 'unwall'].includes(this.tool)) {
        const pad = this.pad('tile', this.tool !== 'unfeature')
        if (this.tool === 'room' || this.tool === 'wall' || this.tool === 'unwall') {
          const c = this.cornerOf(p)
          if (c) { pad.position.set(c[0], 0.3, c[1]); pad.scaling.set(0.22, 0.6, 0.22); keep.add(pad) }
        } else {
          pad.position.set(tile[0] + 0.5, 0.06, tile[1] + 0.5)
          pad.scaling.set(1, 0.02, 1)
          keep.add(pad)
        }
      }
    }
    for (const m of this.pads.values()) m.setEnabled(keep.has(m))
  }

  // ------------------------------------------------------------ every frame

  update(dt: number): void {
    if (!this.isOpen) return
    const k = this.keys
    const speed = this.orbit.dist * 0.9 * dt
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    if (fwd || right) this.pan(right * speed, fwd * speed)
    if (k.has('KeyQ')) this.orbit.yaw -= dt * 1.4
    if (k.has('KeyE')) this.orbit.yaw += dt * 1.4
    this.placeCamera()
    if (this.wallMode === 'cut') this.applyView()
    this.updateGhosts()
  }
}
