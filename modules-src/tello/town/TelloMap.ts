/**
 * Tello's maps: the corner map (turned with the camera, N cycles its range)
 * and the full map of Montello (Ctrl), both drawn from one picture of the
 * town painted once from the baked data: ground cover with hill shading,
 * water, every road by class, every building, then street and place names
 * as vectors at any zoom. Click a spot or pick a place for directions along
 * the real road network; the route shows on both maps with the distance left.
 *
 * Map drawing works in map coordinates (x east, z north).
 */
import type { MapMarker } from '../../rackreel/ui/Minimap'
import type { Poi } from '../data/MapData'
import type { TelloLand } from '../region'
import { RoadGraph, type Route } from './Routes'

const RANGES = [70, 130, 260, 520]
const BASE_PX = 2048
const COVER_RGB: readonly (readonly [number, number, number])[] = [[132, 142, 82], [112, 140, 78], [72, 104, 60], [104, 118, 80], [188, 172, 134], [128, 126, 120], [170, 158, 104], [58, 96, 124]]
const ROAD_STYLE: readonly { color: string; casing: string; scale: number }[] = [
  { color: '#f2d27a', casing: '#5a4a22', scale: 1.5 },
  { color: '#f4f1e8', casing: '#55524a', scale: 1.25 },
  { color: '#dcd8cc', casing: '#6a665c', scale: 1 },
  { color: '#c9b792', casing: '#6b5d43', scale: 1 },
  { color: '#e8e4d6', casing: '', scale: 1 },
  { color: '#b99a6a', casing: '', scale: 1 },
]
const POI_COLOR: Record<string, string> = { fuel: '#ffb347', food: '#ff8f6b', lodging: '#c7a6ff', school: '#ffd966', civic: '#8fd0ff', church: '#ffffff', park: '#9fe08a', shop: '#f6c1e0', water: '#a9dcff' }

interface View { cx: number; cz: number; s: number; rot: number; W: number; H: number }

export interface MapOptions {
  land: TelloLand
  where: () => { x: number; z: number; heading: number }
  toast: (text: string) => void
  canvas: HTMLCanvasElement | null
}

export class TelloMap {
  private readonly land: TelloLand
  private readonly base: HTMLCanvasElement
  private readonly mini: HTMLCanvasElement
  private readonly miniG: CanvasRenderingContext2D
  private readonly graph: RoadGraph
  private zoom = 1
  private timer = 0
  private root: HTMLDivElement | null = null
  private view: HTMLCanvasElement | null = null
  private info: HTMLParagraphElement | null = null
  private center = { x: 0, z: 0 }
  private scale = 0.5
  private goal: { x: number; z: number; name: string } | null = null
  private route: Route | null = null
  private rerouteAt = { x: Infinity, z: Infinity }
  private banner: HTMLDivElement | null = null

  constructor(private readonly opts: MapOptions) {
    this.land = opts.land
    this.graph = new RoadGraph(this.land.doc.roads)
    this.base = this.paint()
    const holder = document.getElementById('minimap')
    this.mini = document.createElement('canvas')
    this.mini.className = 'fl-minimap'
    this.mini.setAttribute('role', 'img')
    this.mini.setAttribute('aria-label', 'Minimap of Montello')
    if (holder) {
      for (const c of Array.from(holder.querySelectorAll('canvas'))) c.style.display = 'none'
      holder.classList.add('fl-minimap-holder')
      holder.append(this.mini)
    }
    this.miniG = this.mini.getContext('2d')!
  }

  get open(): boolean {
    return !!this.root && !this.root.hidden
  }

  /** The town painted once, two metres to the pixel, north up. */
  private paint(): HTMLCanvasElement {
    const land = this.land
    const canvas = document.createElement('canvas')
    canvas.width = BASE_PX
    canvas.height = BASE_PX
    const g = canvas.getContext('2d')!
    const n = land.side
    const { cover, ground, water, canopy } = land.grids
    const small = document.createElement('canvas')
    small.width = n
    small.height = n
    const sg = small.getContext('2d')!
    const img = sg.createImageData(n, n)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i
        const c = COVER_RGB[cover[k]] ?? COVER_RGB[0]
        let r = c[0], gg = c[1], b = c[2]
        const wet = water[k] > ground[k]
        if (wet) {
          const d = Math.min(1, (water[k] - ground[k]) / 300)
          r = 86 - d * 38; gg = 128 - d * 44; b = 150 - d * 30
        } else {
          const f = canopy[k] / 255
          r += (64 - r) * f * 0.6; gg += (98 - gg) * f * 0.6; b += (56 - b) * f * 0.6
          const e = ground[Math.min(n * n - 1, k + 1)] - ground[Math.max(0, k - 1)]
          const s = ground[Math.min(n * n - 1, k + n)] - ground[Math.max(0, k - n)]
          const shade = Math.max(0.72, Math.min(1.25, 1 + (s - e) * 0.0016))
          r *= shade; gg *= shade; b *= shade
        }
        const o = ((n - 1 - j) * n + i) * 4
        img.data[o] = r
        img.data[o + 1] = gg
        img.data[o + 2] = b
        img.data[o + 3] = 255
      }
    }
    sg.putImageData(img, 0, 0)
    g.imageSmoothingEnabled = true
    g.drawImage(small, 0, 0, BASE_PX, BASE_PX)
    const s = BASE_PX / land.size
    const px = (x: number) => (x - land.x0) * s
    const pz = (z: number) => (land.z0 + land.size - z) * s
    g.fillStyle = 'rgba(96,94,90,.85)'
    for (const lot of land.doc.lots) this.ring(g, lot.p, px, pz, true)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const pass of [0, 1]) {
      for (const kind of [5, 4, 3, 2, 1, 0]) {
        const style = ROAD_STYLE[kind]
        if (pass === 0 && !style.casing) continue
        for (const road of land.doc.roads) {
          if (road.k !== kind) continue
          g.strokeStyle = pass === 0 ? style.casing : style.color
          g.lineWidth = Math.max(1, road.w * s * style.scale) + (pass === 0 ? 2 : 0)
          g.beginPath()
          for (let k = 0; k < road.p.length; k += 2) {
            if (k === 0) g.moveTo(px(road.p[k]), pz(road.p[k + 1]))
            else g.lineTo(px(road.p[k]), pz(road.p[k + 1]))
          }
          g.stroke()
        }
      }
    }
    for (const b of land.doc.buildings) {
      g.fillStyle = b.k === 'store' ? '#c9896f' : b.k === 'civic' ? '#d9b45c' : b.k === 'industrial' ? '#a79cb5' : b.k === 'house' ? '#d8c7ae' : '#b9ad9c'
      g.strokeStyle = 'rgba(40,34,28,.55)'
      g.lineWidth = 0.6
      this.ring(g, b.p, px, pz, true)
      g.stroke()
    }
    return canvas
  }

  private ring(g: CanvasRenderingContext2D, p: number[], px: (x: number) => number, pz: (z: number) => number, fill: boolean): void {
    g.beginPath()
    for (let k = 0; k < p.length; k += 2) {
      if (k === 0) g.moveTo(px(p[k]), pz(p[k + 1]))
      else g.lineTo(px(p[k]), pz(p[k + 1]))
    }
    g.closePath()
    if (fill) g.fill()
  }

  /** Draws the map into `g` for a view centred on a map point; `rot` turns it (radians, the camera's yaw is up when rot = -yaw). */
  private draw(g: CanvasRenderingContext2D, v: View, mini: boolean, dpr: number, here: { x: number; z: number; heading: number }): void {
    const land = this.land
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#1c2a22'
    g.fillRect(0, 0, v.W, v.H)
    g.translate(v.W / 2, v.H / 2)
    g.rotate(v.rot)
    g.scale(v.s, v.s)
    g.translate(-v.cx, v.cz)
    g.imageSmoothingEnabled = true
    g.drawImage(this.base, land.x0, -(land.z0 + land.size), land.size, land.size)
    if (this.route) {
      const p = this.route.pts
      g.lineCap = 'round'
      g.lineJoin = 'round'
      for (const [color, width] of [['rgba(10,20,40,.85)', 7], ['#4da3ff', 4]] as const) {
        g.strokeStyle = color
        g.lineWidth = (width * dpr) / v.s
        g.beginPath()
        g.moveTo(here.x, -here.z)
        for (let k = 0; k < p.length; k += 2) g.lineTo(p[k], -p[k + 1])
        if (this.goal) g.lineTo(this.goal.x, -this.goal.z)
        g.stroke()
      }
    }
    const screen = (x: number, z: number): [number, number] => {
      const dx = (x - v.cx) * v.s
      const dy = -(z - v.cz) * v.s
      const c = Math.cos(v.rot), s = Math.sin(v.rot)
      return [v.W / 2 + dx * c - dy * s, v.H / 2 + dx * s + dy * c]
    }
    g.setTransform(1, 0, 0, 1, 0, 0)
    const reach = Math.hypot(v.W, v.H) / 2 / v.s
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    if (!mini && v.s > 0.55) {
      g.font = `700 ${Math.round(11 * dpr)}px Inter, system-ui, sans-serif`
      const drawn = new Set<string>()
      for (const road of land.doc.roads) {
        if (!road.n || road.k > 1) continue
        const mid = Math.floor(road.p.length / 4) * 2
        const x = road.p[mid], z = road.p[mid + 1]
        if (Math.hypot(x - v.cx, z - v.cz) > reach) continue
        const key = `${road.n}|${Math.round(x / 260)},${Math.round(z / 260)}`
        if (drawn.has(key)) continue
        drawn.add(key)
        const [sx, sy] = screen(x, z)
        const a = Math.max(0, mid - 2)
        let ang = Math.atan2(-(road.p[a + 3] - road.p[a + 1]), road.p[a + 2] - road.p[a])
        if (ang > Math.PI / 2) ang -= Math.PI
        if (ang < -Math.PI / 2) ang += Math.PI
        g.save()
        g.translate(sx, sy)
        g.rotate(ang)
        g.lineWidth = 3 * dpr
        g.strokeStyle = 'rgba(20,18,14,.8)'
        g.strokeText(road.n, 0, 0)
        g.fillStyle = '#f4efe2'
        g.fillText(road.n, 0, 0)
        g.restore()
      }
    }
    for (const poi of land.doc.pois) {
      if (Math.hypot(poi.x - v.cx, poi.z - v.cz) > reach) continue
      const [sx, sy] = screen(poi.x, poi.z)
      const water = poi.k === 'water'
      if (!water) {
        g.fillStyle = 'rgba(15,14,12,.85)'
        g.beginPath()
        g.arc(sx, sy, 5 * dpr, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = POI_COLOR[poi.k] ?? '#ffffff'
        g.beginPath()
        g.arc(sx, sy, 3.2 * dpr, 0, Math.PI * 2)
        g.fill()
      }
      if (mini ? water && v.s > 0.3 : v.s > (water ? 0.12 : 0.8)) {
        g.font = `${water ? 'italic 700' : '700'} ${Math.round((water ? 13 : 11) * dpr)}px Inter, system-ui, sans-serif`
        g.lineWidth = 3 * dpr
        g.strokeStyle = 'rgba(20,18,14,.85)'
        g.strokeText(poi.n, sx, sy + (water ? 0 : 13 * dpr))
        g.fillStyle = water ? '#cfeaff' : '#f4efe2'
        g.fillText(poi.n, sx, sy + (water ? 0 : 13 * dpr))
      }
    }
    if (this.goal) {
      const [sx, sy] = screen(this.goal.x, this.goal.z)
      g.fillStyle = '#4da3ff'
      g.strokeStyle = '#0b1830'
      g.lineWidth = 2 * dpr
      g.beginPath()
      g.arc(sx, sy, 7 * dpr, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    }
    const [hx, hy] = screen(here.x, here.z)
    g.save()
    g.translate(hx, hy)
    g.rotate(here.heading + v.rot)
    g.fillStyle = '#ffffff'
    g.strokeStyle = 'rgba(10,10,8,.9)'
    g.lineWidth = 2.5 * dpr
    g.beginPath()
    g.moveTo(0, -11 * dpr)
    g.lineTo(8 * dpr, 9 * dpr)
    g.lineTo(0, 4 * dpr)
    g.lineTo(-8 * dpr, 9 * dpr)
    g.closePath()
    g.stroke()
    g.fill()
    g.restore()
  }

  cycleZoom(): string {
    this.zoom = (this.zoom + 1) % RANGES.length
    return `Map: ${Math.round(RANGES[this.zoom] * 2)} m across`
  }

  /** The corner map, ten times a second. `x`, `z` are map coordinates. */
  drawMini(dt: number, x: number, z: number, cameraYaw: number, facing: number, markers: MapMarker[], toMap: (m: MapMarker) => { x: number; z: number } | null): void {
    this.timer -= dt
    if (this.timer > 0) return
    this.timer = 0.1
    const r = this.mini.getBoundingClientRect()
    if (!r.width) return
    const dpr = Math.min(2, devicePixelRatio || 1)
    const W = Math.round(r.width * dpr)
    if (this.mini.width !== W || this.mini.height !== W) {
      this.mini.width = W
      this.mini.height = W
    }
    const g = this.miniG
    const v: View = { cx: x, cz: z, s: W / 2 / RANGES[this.zoom], rot: -cameraYaw, W, H: W }
    this.draw(g, v, true, dpr, { x, z, heading: facing })
    g.setTransform(1, 0, 0, 1, 0, 0)
    for (const m of markers) {
      const p = toMap(m)
      if (!p) continue
      const dx = (p.x - x) * v.s, dy = -(p.z - z) * v.s
      const c = Math.cos(v.rot), s = Math.sin(v.rot)
      const sx = W / 2 + dx * c - dy * s, sy = W / 2 + dx * s + dy * c
      if (Math.hypot(sx - W / 2, sy - W / 2) > W / 2) continue
      g.fillStyle = m.kind === 'friend' ? '#7fe0ff' : '#ffd166'
      g.strokeStyle = 'rgba(10,10,8,.9)'
      g.lineWidth = 1.5 * dpr
      g.beginPath()
      g.arc(sx, sy, 4 * dpr, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    }
    const rr = W / 2 - 11 * dpr
    const nx = W / 2 + Math.sin(-cameraYaw) * rr
    const ny = W / 2 - Math.cos(-cameraYaw) * rr
    g.fillStyle = 'rgba(15,14,12,.8)'
    g.beginPath()
    g.arc(nx, ny, 9 * dpr, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#ffb347'
    g.font = `800 ${Math.round(11 * dpr)}px Inter, system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('N', nx, ny + 0.5 * dpr)
  }

  // ---------------------------------------------------------------- the full map

  toggle(): void {
    if (this.open) this.hide()
    else this.show()
  }

  private build(): void {
    const root = document.createElement('div')
    root.className = 'fl-map'
    root.hidden = true
    root.setAttribute('data-host-modal', '')
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', 'Map of Montello')
    const head = document.createElement('div')
    head.className = 'fl-map-head'
    const title = document.createElement('h2')
    title.textContent = 'Montello, Wisconsin'
    this.info = document.createElement('p')
    this.info.className = 'fl-map-info'
    head.append(title, this.info)
    const button = (label: string, act: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'rr-btn'
      b.textContent = label
      b.addEventListener('click', act)
      head.append(b)
    }
    button('−', () => this.zoomBy(1 / 1.5))
    button('+', () => this.zoomBy(1.5))
    button('Clear route', () => this.setGoal(null))
    button('Close', () => this.hide())
    const body = document.createElement('div')
    body.className = 'fl-map-body'
    const view = document.createElement('canvas')
    view.className = 'fl-map-view'
    view.tabIndex = 0
    view.setAttribute('aria-label', 'Map. Drag to pan, scroll to zoom, click for directions. Arrow keys pan, plus and minus zoom.')
    const list = document.createElement('div')
    list.className = 'fl-map-places'
    const groups: [string, string[]][] = [['Lakes and rivers', ['water']], ['Parks and sights', ['park']], ['Food and lodging', ['food', 'lodging']], ['Shops and fuel', ['shop', 'fuel']], ['Schools and public buildings', ['school', 'civic', 'church']]]
    for (const [label, kinds] of groups) {
      const pois = this.land.doc.pois.filter((p) => kinds.includes(p.k)).sort((a, b) => a.n.localeCompare(b.n))
      if (!pois.length) continue
      const h = document.createElement('h3')
      h.textContent = label
      list.append(h)
      for (const poi of pois) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'fl-place'
        b.textContent = poi.n
        b.addEventListener('click', () => this.pick(poi))
        list.append(b)
      }
    }
    body.append(view, list)
    root.append(head, body)
    document.body.append(root)
    this.root = root
    this.view = view
    let drag: { x: number; y: number; moved: number } | null = null
    view.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: 0 }
      view.setPointerCapture(e.pointerId)
    })
    view.addEventListener('pointermove', (e) => {
      if (!drag) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      drag.moved += Math.abs(dx) + Math.abs(dy)
      drag.x = e.clientX
      drag.y = e.clientY
      this.center.x -= dx / this.scale
      this.center.z += dy / this.scale
      this.redraw()
    })
    view.addEventListener('pointerup', (e) => {
      const d = drag
      drag = null
      if (!d || d.moved > 6) return
      const r = view.getBoundingClientRect()
      const x = this.center.x + (e.clientX - r.left - r.width / 2) / this.scale
      const z = this.center.z - (e.clientY - r.top - r.height / 2) / this.scale
      if (this.land.inside(x, z, 20)) this.setGoal({ x, z, name: 'the spot you marked' })
    })
    view.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.zoomBy(e.deltaY < 0 ? 1.25 : 0.8)
    }, { passive: false })
    view.addEventListener('keydown', (e) => {
      const step = 60 / this.scale
      if (e.key === 'ArrowLeft') this.center.x -= step
      else if (e.key === 'ArrowRight') this.center.x += step
      else if (e.key === 'ArrowUp') this.center.z += step
      else if (e.key === 'ArrowDown') this.center.z -= step
      else if (e.key === '+' || e.key === '=') this.scale = Math.min(6, this.scale * 1.25)
      else if (e.key === '-') this.scale = Math.max(0.12, this.scale / 1.25)
      else return
      e.preventDefault()
      this.redraw()
    })
    addEventListener('resize', () => this.redraw())
    addEventListener('keydown', (e) => {
      if (this.open && e.key === 'Escape') {
        e.stopPropagation()
        this.hide()
      }
    }, true)
  }

  private zoomBy(k: number): void {
    this.scale = Math.max(0.12, Math.min(6, this.scale * k))
    this.redraw()
  }

  private pick(poi: Poi): void {
    this.center.x = poi.x
    this.center.z = poi.z
    this.setGoal({ x: poi.x, z: poi.z, name: poi.n })
  }

  show(): void {
    if (!this.root) this.build()
    const here = this.opts.where()
    this.center.x = here.x
    this.center.z = here.z
    this.scale = 1.1
    this.root!.hidden = false
    if (document.pointerLockElement) document.exitPointerLock()
    this.view!.focus()
    this.redraw()
  }

  hide(): void {
    if (!this.root || this.root.hidden) return
    this.root.hidden = true
    const canvas = this.opts.canvas
    if (canvas) {
      canvas.focus()
      try {
        const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined
        p?.catch?.(() => undefined)
      } catch {
        /* the next click locks it */
      }
    }
  }

  private redraw(): void {
    const view = this.view
    if (!view || !this.open) return
    const r = view.getBoundingClientRect()
    const dpr = Math.min(2, devicePixelRatio || 1)
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr))
    if (view.width !== W || view.height !== H) {
      view.width = W
      view.height = H
    }
    this.draw(view.getContext('2d')!, { cx: this.center.x, cz: this.center.z, s: this.scale * dpr, rot: 0, W, H }, false, dpr, this.opts.where())
    if (this.info) this.info.textContent = this.goal && this.route ? `Directions to ${this.goal.name}: ${distance(this.route.length)} by road.` : this.goal ? `${this.goal.name} is marked; no road reaches it.` : 'Drag to pan, scroll to zoom. Click a spot or pick a place for directions.'
  }

  private setGoal(goal: { x: number; z: number; name: string } | null): void {
    this.goal = goal
    this.route = null
    if (goal) {
      const here = this.opts.where()
      this.route = this.graph.route(here.x, here.z, goal.x, goal.z)
      this.rerouteAt = { x: here.x, z: here.z }
      this.opts.toast(this.route ? `Directions to ${goal.name}: ${distance(this.route.length)}. The route is on your map.` : `No road reaches ${goal.name}; it is marked on your map.`)
    }
    this.showBanner()
    this.redraw()
  }

  private showBanner(): void {
    if (!this.banner) {
      this.banner = document.createElement('div')
      this.banner.className = 'fl-directions'
      this.banner.setAttribute('aria-live', 'polite')
      document.body.append(this.banner)
    }
    this.banner.hidden = !this.goal
  }

  /** Each half second: the distance left, a fresh route after 60 m of straying, and arrival. */
  private tick = 0
  update(dt: number): void {
    if (!this.goal) return
    this.tick -= dt
    if (this.tick > 0) return
    this.tick = 0.5
    const here = this.opts.where()
    const left = Math.hypot(this.goal.x - here.x, this.goal.z - here.z)
    if (left < 22) {
      this.opts.toast(`You have arrived at ${this.goal.name}.`)
      this.setGoal(null)
      return
    }
    if (Math.hypot(here.x - this.rerouteAt.x, here.z - this.rerouteAt.z) > 60) {
      this.route = this.graph.route(here.x, here.z, this.goal.x, this.goal.z)
      this.rerouteAt = { x: here.x, z: here.z }
    }
    if (this.banner) this.banner.textContent = `To ${this.goal.name} · ${distance(this.route ? this.route.length : left)}`
  }
}

function distance(m: number): string {
  const miles = m / 1609.344
  return miles >= 0.2 ? `${miles.toFixed(1)} mi` : `${Math.round((m * 3.28084) / 10) * 10} ft`
}

