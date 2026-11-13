/**
 * Ctrl's full map of Fox Lake (the town, the county road and the lake
 * country) and the turn-by-turn directions it starts. Click anywhere to set a
 * destination: the route is drawn on the map and a banner at the top of the
 * screen calls the next turn and its distance, re-routing when you leave the
 * route, until you are within ARRIVE_RADIUS of the spot.
 */
import { HALF } from '../../rackreel/world/Terrain'
import { TOWN_SQUARE } from '../region'
import { KIND, ROUTE_CELL, RouteGrid, formatDistance, progressOn, type Route, type RouteWorld, type Step } from './RouteGrid'

const ARRIVE_RADIUS = 22
const OFF_ROUTE = 30
const REROUTE_EVERY = 2.5

const COLORS: Record<number, [number, number, number]> = {
  [KIND.blocked]: [24, 30, 22],
  [KIND.water]: [52, 98, 140],
  [KIND.forest]: [40, 74, 44],
  [KIND.meadow]: [96, 124, 70],
  [KIND.marsh]: [78, 104, 82],
  [KIND.rock]: [118, 114, 104],
  [KIND.trail]: [164, 136, 96],
  [KIND.highway]: [70, 72, 78],
  [KIND.connector]: [86, 88, 94],
  [KIND.road]: [92, 94, 100],
  [KIND.lawn]: [108, 140, 78],
  [KIND.building]: [180, 160, 132],
}

const ARROWS: Record<Step['turn'], string> = {
  start: '↑', straight: '↑', left: '↰', right: '↱', 'slight-left': '↖', 'slight-right': '↗', 'sharp-left': '↶', 'sharp-right': '↷', arrive: '⚑',
}

export interface MapHost {
  world: RouteWorld
  /** The player (or their vehicle) in scene coordinates, and the heading (0 = north, clockwise). */
  where(): { x: number; z: number; heading: number }
  toast(text: string): void
  canvas: HTMLCanvasElement | null
}

export class WorldMap {
  private grid: RouteGrid | null = null
  private background: HTMLCanvasElement | null = null
  private readonly root: HTMLDivElement
  private readonly view: HTMLCanvasElement
  private readonly info: HTMLParagraphElement
  private readonly clearBtn: HTMLButtonElement
  private readonly banner: HTMLDivElement
  private readonly bannerArrow: HTMLSpanElement
  private readonly bannerText: HTMLSpanElement
  private readonly bannerLeft: HTMLSpanElement
  private route: Route | null = null
  private rerouteIn = 0
  private shownText = ''
  private frame = 0

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
    this.clearBtn = document.createElement('button')
    this.clearBtn.type = 'button'
    this.clearBtn.className = 'rr-btn'
    this.clearBtn.textContent = 'Clear route'
    this.clearBtn.addEventListener('click', () => {
      this.clear()
      this.draw()
    })
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'rr-btn primary'
    close.textContent = 'Close (Ctrl)'
    close.addEventListener('click', () => this.close())
    head.append(title, this.info, this.clearBtn, close)
    this.view = document.createElement('canvas')
    this.view.className = 'fl-map-view'
    this.view.addEventListener('click', (e) => this.pick(e))
    this.root.append(head, this.view)
    document.body.append(this.root)
    addEventListener('keydown', (e) => {
      if (this.root.hidden) return
      if (e.code === 'Escape' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (!e.repeat) this.close()
      }
    }, true)
    addEventListener('resize', () => {
      if (!this.root.hidden) this.draw()
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
    const body = document.createElement('span')
    body.className = 'fl-dir-body'
    body.append(this.bannerText, this.bannerLeft)
    this.banner.append(this.bannerArrow, body)
    document.body.append(this.banner)
  }

  get open(): boolean {
    return !this.root.hidden
  }

  toggle(): void {
    if (this.open) this.close()
    else this.show()
  }

  show(): void {
    if (!this.grid) {
      this.grid = new RouteGrid(this.host.world)
      this.background = this.paintBackground(this.grid)
    }
    this.root.hidden = false
    if (document.pointerLockElement) document.exitPointerLock()
    this.draw()
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
    this.banner.hidden = true
    this.shownText = ''
  }

  /** Every frame: follows the player along the route, re-routes when they stray, and clears on arrival. */
  update(dt: number): void {
    if (this.open && ++this.frame % 6 === 0) this.draw()
    const route = this.route
    if (!route || !this.grid) return
    const me = this.host.where()
    if (Math.hypot(me.x - route.goal.x, me.z - route.goal.z) < ARRIVE_RADIUS) {
      this.clear()
      this.host.toast('You have arrived.')
      if (this.open) this.draw()
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

  private guide(route: Route, along: number): void {
    const next = route.steps.find((s) => s.turn !== 'start' && s.along > along + 3) ?? route.steps[route.steps.length - 1]
    const toTurn = Math.max(0, next.along - along)
    const left = Math.max(0, route.length - along)
    const text = next.turn === 'arrive' ? `${next.text} in ${formatDistance(toTurn)}` : `In ${formatDistance(toTurn)}, ${next.text.charAt(0).toLowerCase()}${next.text.slice(1)}`
    this.banner.hidden = false
    if (text !== this.shownText) {
      this.shownText = text
      this.bannerText.textContent = text
      this.bannerArrow.textContent = ARROWS[next.turn]
    }
    this.bannerLeft.textContent = `${formatDistance(left)} to go · Ctrl for the map`
  }

  private pick(e: MouseEvent): void {
    const grid = this.grid
    if (!grid) return
    const t = this.transform()
    const r = this.view.getBoundingClientRect()
    const px = (e.clientX - r.left) * (this.view.width / r.width)
    const py = (e.clientY - r.top) * (this.view.height / r.height)
    const goal = { x: t.x0 + (px - t.ox) / t.s, z: t.z1 - (py - t.oy) / t.s }
    const me = this.host.where()
    const route = grid.route(me, goal)
    if (!route) {
      this.host.toast("There's no way to get there from here.")
      return
    }
    this.route = route
    this.rerouteIn = REROUTE_EVERY
    this.guide(route, 0)
    this.draw()
  }

  private paintBackground(grid: RouteGrid): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = grid.cols
    c.height = grid.rows
    const g = c.getContext('2d')!
    const img = g.createImageData(grid.cols, grid.rows)
    for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) {
      const k = j * grid.cols + i
      const o = ((grid.rows - 1 - j) * grid.cols + i) * 4
      const col = COLORS[grid.kinds[k]] ?? COLORS[KIND.blocked]
      img.data[o] = col[0]
      img.data[o + 1] = col[1]
      img.data[o + 2] = col[2]
      img.data[o + 3] = 255
    }
    g.putImageData(img, 0, 0)
    return c
  }

  /** Scene metres to canvas pixels: north up, the whole of Fox Lake fitted in. */
  private transform(): { s: number; ox: number; oy: number; x0: number; z1: number } {
    const grid = this.grid!
    const w = grid.cols * ROUTE_CELL
    const h = grid.rows * ROUTE_CELL
    const s = Math.min(this.view.width / w, this.view.height / h)
    return { s, ox: (this.view.width - w * s) / 2, oy: (this.view.height - h * s) / 2, x0: grid.x0, z1: grid.z0 + h }
  }

  private draw(): void {
    const grid = this.grid
    if (!grid || !this.background) return
    const r = this.view.getBoundingClientRect()
    const dpr = Math.min(2, devicePixelRatio || 1)
    const W = Math.max(1, Math.round(r.width * dpr))
    const H = Math.max(1, Math.round(r.height * dpr))
    if (this.view.width !== W || this.view.height !== H) {
      this.view.width = W
      this.view.height = H
    }
    const g = this.view.getContext('2d')!
    g.fillStyle = '#12100d'
    g.fillRect(0, 0, W, H)
    const t = this.transform()
    const P = (x: number, z: number) => [t.ox + (x - t.x0) * t.s, t.oy + (t.z1 - z) * t.s] as const
    g.imageSmoothingEnabled = true
    g.drawImage(this.background, t.ox, t.oy, grid.cols * ROUTE_CELL * t.s, grid.rows * ROUTE_CELL * t.s)
    g.font = `700 ${Math.round(14 * dpr)}px Inter, system-ui, sans-serif`
    g.textAlign = 'center'
    g.fillStyle = 'rgba(245,236,214,.85)'
    const town = P((TOWN_SQUARE.x0 + TOWN_SQUARE.x1) / 2, (TOWN_SQUARE.z0 + TOWN_SQUARE.z1) / 2)
    g.fillText('Fox Plains', town[0], town[1])
    const lake = P(0, -HALF * 0.25)
    g.fillText('Bear Paw Lake country', lake[0], lake[1])
    const route = this.route
    if (route) {
      g.lineJoin = 'round'
      g.lineCap = 'round'
      for (const [width, color] of [[7, 'rgba(10,20,40,.7)'], [4, '#4fb3ff']] as const) {
        g.lineWidth = width * dpr
        g.strokeStyle = color
        g.beginPath()
        route.points.forEach((p, i) => {
          const [x, y] = P(p.x, p.z)
          if (i) g.lineTo(x, y)
          else g.moveTo(x, y)
        })
        g.stroke()
      }
      const [gx, gy] = P(route.goal.x, route.goal.z)
      g.fillStyle = '#ff5a4f'
      g.strokeStyle = '#fff'
      g.lineWidth = 2 * dpr
      g.beginPath()
      g.arc(gx, gy, 7 * dpr, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    }
    const me = this.host.where()
    const [mx, my] = P(me.x, me.z)
    g.save()
    g.translate(mx, my)
    g.rotate(me.heading)
    g.fillStyle = '#ffd34d'
    g.strokeStyle = '#1b1408'
    g.lineWidth = 2 * dpr
    g.beginPath()
    g.moveTo(0, -11 * dpr)
    g.lineTo(7 * dpr, 8 * dpr)
    g.lineTo(0, 4 * dpr)
    g.lineTo(-7 * dpr, 8 * dpr)
    g.closePath()
    g.fill()
    g.stroke()
    g.restore()
    this.clearBtn.hidden = !route
    this.info.textContent = route ? `Route: ${formatDistance(route.length)}. Click somewhere else to change it.` : 'Click anywhere to get turn-by-turn directions there.'
  }
}
