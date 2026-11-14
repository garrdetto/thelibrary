/**
 * Ctrl's full map of Fox Lake (the town, the county road and its places, the
 * Lake Road and the lake country) and the turn-by-turn directions it starts.
 * The map is the shared atlas (Atlas.ts): it opens centred on you, zoomed in,
 * and pans by dragging and zooms with the wheel or the buttons. Click a place
 * (or pick it from the list beside the map) to be routed to its door; click
 * anywhere else to be routed to that spot. The route shows on this map and on
 * the corner minimap, and a banner at the top of the screen calls the next
 * turn and its distance, re-routing when you leave the route, until you are
 * within ARRIVE_RADIUS of the spot.
 */
import type { MapMarker } from '../../rackreel/ui/Minimap'
import type { LotDef } from '../../maplestreet/shared/WorldLayout'
import { Atlas, unscreen, type Poi, type View } from './Atlas'
import { RouteGrid, formatDistance, progressOn, type Route, type RouteWorld, type Step } from './RouteGrid'

const ARRIVE_RADIUS = 22
const OFF_ROUTE = 30
const REROUTE_EVERY = 2.5
/** Zoom range and the opening zoom, in CSS pixels per metre. */
const MIN_ZOOM = 0.22
const MAX_ZOOM = 9
const OPEN_ZOOM = 1.6

const ARROWS: Record<Step['turn'], string> = {
  start: '↑', straight: '↑', left: '↰', right: '↱', 'slight-left': '↖', 'slight-right': '↗', 'sharp-left': '↶', 'sharp-right': '↷', arrive: '⚑',
}

export interface MapHost {
  world: RouteWorld
  atlas: Atlas
  /** The player (or their vehicle) in scene coordinates, and the heading (0 = north, clockwise). */
  where(): { x: number; z: number; heading: number }
  toast(text: string): void
  canvas: HTMLCanvasElement | null
  markers(): MapMarker[]
  lot(lot: LotDef): 'mine' | 'owned' | 'sale' | null
}

export class WorldMap {
  private grid: RouteGrid | null = null
  private readonly root: HTMLDivElement
  private readonly view: HTMLCanvasElement
  private readonly info: HTMLParagraphElement
  private readonly clearBtn: HTMLButtonElement
  private readonly banner: HTMLDivElement
  private readonly bannerArrow: HTMLSpanElement
  private readonly bannerText: HTMLSpanElement
  private readonly bannerLeft: HTMLSpanElement
  private readonly list: HTMLDivElement
  private route: Route | null = null
  private goalName: string | null = null
  private rerouteIn = 0
  private shownText = ''
  private frame = 0
  private readonly cam = { cx: 0, cz: 0, zoom: OPEN_ZOOM }
  private hover: Poi | null = null
  private drag: { x: number; y: number; moved: number; id: number } | null = null
  private queued = false

  constructor(private readonly host: MapHost) {
    this.root = document.createElement('div')
    this.root.className = 'fl-map'
    this.root.hidden = true
    this.root.dataset.hostModal = ''
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-label', 'Map of Fox Lake')
    const head = document.createElement('div')
    head.className = 'fl-map-head'
    const title = document.createElement('h2')
    title.textContent = 'Map of Fox Lake'
    this.info = document.createElement('p')
    this.info.className = 'fl-map-info'
    this.info.setAttribute('aria-live', 'polite')
    const button = (text: string, label: string, onClick: () => void, cls = 'rr-btn') => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = cls
      b.textContent = text
      b.setAttribute('aria-label', label)
      b.addEventListener('click', onClick)
      return b
    }
    const zoomIn = button('+', 'Zoom in', () => this.zoomBy(1.6))
    const zoomOut = button('−', 'Zoom out', () => this.zoomBy(1 / 1.6))
    const me = button('Center on me', 'Center the map on you', () => {
      this.centre()
      this.redraw()
    })
    this.clearBtn = button('Clear route', 'Clear the route', () => {
      this.clear()
      this.redraw()
    })
    const close = button('Close (Ctrl)', 'Close the map', () => this.close(), 'rr-btn primary')
    head.append(title, this.info, zoomIn, zoomOut, me, this.clearBtn, close)
    const body = document.createElement('div')
    body.className = 'fl-map-body'
    this.view = document.createElement('canvas')
    this.view.className = 'fl-map-view'
    this.view.tabIndex = 0
    this.view.setAttribute('aria-label', 'Map. Drag to pan, scroll to zoom, click a place or a spot for directions. Arrow keys pan, plus and minus zoom.')
    this.list = document.createElement('div')
    this.list.className = 'fl-map-places'
    this.list.setAttribute('aria-label', 'Places')
    body.append(this.view, this.list)
    this.root.append(head, body)
    document.body.append(this.root)
    this.bindView()
    addEventListener('keydown', (e) => {
      if (this.root.hidden) return
      if (e.code === 'Escape' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (!e.repeat) this.close()
      }
    }, true)
    addEventListener('resize', () => {
      if (!this.root.hidden) this.redraw()
    })

    this.banner = document.createElement('div')
    this.banner.className = 'fl-directions'
    this.banner.hidden = true
    this.banner.setAttribute('role', 'status')
    this.banner.setAttribute('aria-live', 'polite')
    this.bannerArrow = document.createElement('span')
    this.bannerArrow.className = 'fl-dir-arrow'
    this.bannerArrow.setAttribute('aria-hidden', 'true')
    this.bannerText = document.createElement('span')
    this.bannerText.className = 'fl-dir-text'
    this.bannerLeft = document.createElement('span')
    this.bannerLeft.className = 'fl-dir-left'
    const bannerBody = document.createElement('span')
    bannerBody.className = 'fl-dir-body'
    bannerBody.append(this.bannerText, this.bannerLeft)
    this.banner.append(this.bannerArrow, bannerBody)
    document.body.append(this.banner)
  }

  get open(): boolean {
    return !this.root.hidden
  }

  /** The route being followed (drawn on the minimap too), or null. */
  get current(): Route | null {
    return this.route
  }

  toggle(): void {
    if (this.open) this.close()
    else this.show()
  }

  show(): void {
    this.grid ??= new RouteGrid(this.host.world)
    if (!this.list.childElementCount) this.buildList()
    this.root.hidden = false
    if (document.pointerLockElement) document.exitPointerLock()
    this.centre()
    this.cam.zoom = OPEN_ZOOM
    this.redraw()
    this.view.focus({ preventScroll: true })
  }

  close(): void {
    this.root.hidden = true
    const canvas = this.host.canvas
    if (!canvas) return
    try {
      const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined
      p?.catch?.(() => undefined)
    } catch {
      return
    }
  }

  clear(): void {
    this.route = null
    this.goalName = null
    this.banner.hidden = true
    this.shownText = ''
  }

  /** Every frame: follows the player along the route, re-routes when they stray, and clears on arrival. */
  update(dt: number): void {
    if (this.open && ++this.frame % 6 === 0) this.redraw()
    const route = this.route
    if (!route || !this.grid) return
    const me = this.host.where()
    if (Math.hypot(me.x - route.goal.x, me.z - route.goal.z) < ARRIVE_RADIUS) {
      const name = this.goalName
      this.clear()
      this.host.toast(name ? `You have arrived at ${name}.` : 'You have arrived.')
      if (this.open) this.redraw()
      return
    }
    const p = progressOn(route, me)
    this.rerouteIn -= dt
    if (p.off > OFF_ROUTE && this.rerouteIn <= 0) {
      this.rerouteIn = REROUTE_EVERY
      const next = this.grid.route(me, route.goal)
      if (next) {
        this.route = next
        this.guide(next, progressOn(next, me).along)
        return
      }
    }
    this.guide(route, p.along)
  }

  /** Routes to a place (its door or the road in front of it). */
  routeTo(poi: Poi): void {
    this.go(poi.to, poi.name)
  }

  /** Routes to a spot in scene coordinates, with a name for the directions. */
  routeToScene(x: number, z: number, name: string): void {
    this.go({ x, z }, name)
  }

  private go(goal: { x: number; z: number }, name: string | null): void {
    this.grid ??= new RouteGrid(this.host.world)
    const route = this.grid.route(this.host.where(), goal)
    if (!route) {
      this.host.toast("There's no way to get there from here.")
      return
    }
    this.route = route
    this.goalName = name
    this.rerouteIn = REROUTE_EVERY
    this.guide(route, 0)
    this.redraw()
  }

  private guide(route: Route, along: number): void {
    const next = route.steps.find((s) => s.turn !== 'start' && s.along > along + 3) ?? route.steps[route.steps.length - 1]
    const toTurn = Math.max(0, next.along - along)
    const left = Math.max(0, route.length - along)
    const arrive = this.goalName ? `Arrive at ${this.goalName}` : next.text
    const text = next.turn === 'arrive' ? `${arrive} in ${formatDistance(toTurn)}` : `In ${formatDistance(toTurn)}, ${next.text.charAt(0).toLowerCase()}${next.text.slice(1)}`
    this.banner.hidden = false
    if (text !== this.shownText) {
      this.shownText = text
      this.bannerText.textContent = text
      this.bannerArrow.textContent = ARROWS[next.turn]
    }
    this.bannerLeft.textContent = `${formatDistance(left)} to go · Ctrl for the map`
  }

  // ------------------------------------------------------------ the map view

  private dpr(): number {
    return Math.min(2, devicePixelRatio || 1)
  }

  private currentView(): View {
    return { cx: this.cam.cx, cz: this.cam.cz, s: this.cam.zoom * this.dpr(), rot: 0, W: this.view.width, H: this.view.height }
  }

  private centre(): void {
    const me = this.host.where()
    this.cam.cx = me.x
    this.cam.cz = me.z
  }

  private zoomBy(f: number, px?: number, py?: number): void {
    const v = this.currentView()
    const ax = px ?? v.W / 2
    const ay = py ?? v.H / 2
    const before = unscreen(v, ax, ay)
    this.cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.cam.zoom * f))
    const after = unscreen(this.currentView(), ax, ay)
    this.cam.cx += before.x - after.x
    this.cam.cz += before.z - after.z
    this.redraw()
  }

  private canvasPoint(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.view.getBoundingClientRect()
    return [(e.clientX - r.left) * (this.view.width / r.width), (e.clientY - r.top) * (this.view.height / r.height)]
  }

  private bindView(): void {
    const v = this.view
    v.addEventListener('wheel', (e) => {
      e.preventDefault()
      const [px, py] = this.canvasPoint(e)
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), px, py)
    }, { passive: false })
    v.addEventListener('pointerdown', (e) => {
      v.setPointerCapture(e.pointerId)
      this.drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }
    })
    v.addEventListener('pointermove', (e) => {
      const d = this.drag
      if (d && d.id === e.pointerId) {
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        d.moved += Math.hypot(dx, dy)
        d.x = e.clientX
        d.y = e.clientY
        if (d.moved > 5) {
          this.cam.cx -= dx / this.cam.zoom
          this.cam.cz += dy / this.cam.zoom
          v.style.cursor = 'grabbing'
          this.redraw()
        }
        return
      }
      const [px, py] = this.canvasPoint(e)
      const hit = this.host.atlas.poiAt(this.currentView(), px, py, this.dpr())
      if (hit !== this.hover) {
        this.hover = hit
        v.style.cursor = hit ? 'pointer' : 'crosshair'
        this.redraw()
      }
    })
    const up = (e: PointerEvent) => {
      const d = this.drag
      if (!d || d.id !== e.pointerId) return
      this.drag = null
      v.style.cursor = this.hover ? 'pointer' : 'crosshair'
      if (d.moved > 5) return
      const [px, py] = this.canvasPoint(e)
      const view = this.currentView()
      const poi = this.host.atlas.poiAt(view, px, py, this.dpr())
      if (poi) this.routeTo(poi)
      else this.go(unscreen(view, px, py), null)
    }
    v.addEventListener('pointerup', up)
    v.addEventListener('pointercancel', () => (this.drag = null))
    v.addEventListener('keydown', (e) => {
      const step = 80 / this.cam.zoom
      if (e.key === 'ArrowLeft') this.cam.cx -= step
      else if (e.key === 'ArrowRight') this.cam.cx += step
      else if (e.key === 'ArrowUp') this.cam.cz += step
      else if (e.key === 'ArrowDown') this.cam.cz -= step
      else if (e.key === '+' || e.key === '=') return this.zoomBy(1.4)
      else if (e.key === '-' || e.key === '_') return this.zoomBy(1 / 1.4)
      else return
      e.preventDefault()
      this.redraw()
    })
  }

  private buildList(): void {
    const groups = new Map<string, Poi[]>()
    for (const p of this.host.atlas.pois) {
      if (p.kind === 'stand' || p.kind === 'blind' || (p.kind === 'civic' && p.tier === 3)) continue
      let list = groups.get(p.group)
      if (!list) groups.set(p.group, (list = []))
      list.push(p)
    }
    for (const name of ['County Road', 'Lake country', 'Town']) {
      const list = groups.get(name)
      if (!list?.length) continue
      const h = document.createElement('h3')
      h.textContent = name
      this.list.append(h)
      for (const p of list.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'fl-place'
        const strong = document.createElement('strong')
        strong.textContent = p.name
        b.append(strong)
        if (p.note) {
          const small = document.createElement('span')
          small.textContent = p.note
          b.append(small)
        }
        b.addEventListener('click', () => {
          this.cam.cx = p.x
          this.cam.cz = p.z
          this.cam.zoom = Math.max(this.cam.zoom, 2)
          this.routeTo(p)
        })
        this.list.append(b)
      }
    }
  }

  private redraw(): void {
    if (this.queued) return
    this.queued = true
    requestAnimationFrame(() => {
      this.queued = false
      this.draw()
    })
  }

  private draw(): void {
    if (this.root.hidden) return
    const r = this.view.getBoundingClientRect()
    const dpr = this.dpr()
    const W = Math.max(1, Math.round(r.width * dpr))
    const H = Math.max(1, Math.round(r.height * dpr))
    if (this.view.width !== W || this.view.height !== H) {
      this.view.width = W
      this.view.height = H
    }
    const g = this.view.getContext('2d')!
    const view = this.currentView()
    const atlas = this.host.atlas
    atlas.draw(g, view, { route: this.route, lots: (l) => this.host.lot(l), dpr, hover: this.hover, markers: this.host.markers() })
    const me = this.host.where()
    const mx = W / 2 + (me.x - view.cx) * view.s
    const my = H / 2 - (me.z - view.cz) * view.s
    g.save()
    g.translate(mx, my)
    g.rotate(me.heading)
    g.fillStyle = '#ffd34d'
    g.strokeStyle = '#1b1408'
    g.lineWidth = 2 * dpr
    g.beginPath()
    g.moveTo(0, -12 * dpr)
    g.lineTo(8 * dpr, 9 * dpr)
    g.lineTo(0, 4 * dpr)
    g.lineTo(-8 * dpr, 9 * dpr)
    g.closePath()
    g.fill()
    g.stroke()
    g.restore()
    this.chrome(g, view, dpr)
    this.clearBtn.hidden = !this.route
    const painting = atlas.painted < 1 ? ` Drawing the map… ${Math.round(atlas.painted * 100)}%` : ''
    if (this.hover) this.info.textContent = `${this.hover.name}${this.hover.note ? ` — ${this.hover.note}` : ''} Click for directions.`
    else this.info.textContent = (this.route ? `Route${this.goalName ? ` to ${this.goalName}` : ''}: ${formatDistance(this.route.length)}. Click a place or a spot to change it.` : 'Click a place or any spot for turn-by-turn directions. Drag to pan, scroll to zoom.') + painting
  }

  /** Scale bar and north arrow. */
  private chrome(g: CanvasRenderingContext2D, view: View, dpr: number): void {
    const want = (140 * dpr) / view.s
    const p = Math.pow(10, Math.floor(Math.log10(want)))
    const bar = [1, 2, 5, 10].map((m) => m * p).filter((v) => v <= want).pop() ?? p
    const len = bar * view.s
    const bx = view.W - 20 * dpr - len
    const by = view.H - 22 * dpr
    g.fillStyle = 'rgba(15,22,18,.75)'
    g.fillRect(bx - 10 * dpr, by - 22 * dpr, len + 20 * dpr, 34 * dpr)
    g.fillStyle = '#f2f4ee'
    g.fillRect(bx, by, len, 4 * dpr)
    g.font = `600 ${Math.round(12 * dpr)}px Inter, system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'bottom'
    g.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, bx + len / 2, by - 4 * dpr)
    g.save()
    g.translate(view.W - 34 * dpr, 40 * dpr)
    g.fillStyle = 'rgba(15,22,18,.75)'
    g.beginPath()
    g.arc(0, 4 * dpr, 22 * dpr, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.moveTo(0, -14 * dpr)
    g.lineTo(7 * dpr, 6 * dpr)
    g.lineTo(0, 1 * dpr)
    g.lineTo(-7 * dpr, 6 * dpr)
    g.closePath()
    g.fillStyle = '#f7f5ec'
    g.fill()
    g.font = `800 ${Math.round(11 * dpr)}px Inter, system-ui, sans-serif`
    g.textBaseline = 'top'
    g.fillText('N', 0, 9 * dpr)
    g.restore()
  }
}
