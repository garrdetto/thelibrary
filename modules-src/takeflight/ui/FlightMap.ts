/**
 * The maps: a round heading-up minimap in the HUD's lower right (click it, or press M, for the big map) and a full-screen,
 * north-up region map that pans with a drag and zooms with the wheel or its buttons. Both draw the shaded terrain (painted once by
 * `render/map.worker.ts`), runways with their designators, airports, towns, nearby traffic, the aircraft and the flight's
 * destination with its distance and bearing. Drawing is throttled and uses only canvas calls with fixed styles.
 */
import { AIRPORTS, airportById } from '../shared/Airports'
import type { AirportSpec } from '../shared/Airports'
import { REGION_HALF } from '../shared/Terrain'
import { allRoads } from '../shared/Roads'
import { PLACES, allPlaces } from '../shared/Towns'
import type { BuildingKind, Place } from '../shared/Towns'
import type { TrafficPose } from '../shared/Traffic'

const SHADE_SIZES = [768, 2048]
/** Town plans are drawn once at this many metres per pixel. */
const TOWN_MPP = 4
const BUILDING_COLOURS: Record<BuildingKind, string> = { house: '#c79f86', shop: '#d6b48e', office: '#9ba4ae', tower: '#7d8996', skyscraper: '#56667a', warehouse: '#aab0b4' }

interface TownPlan {
  canvas: HTMLCanvasElement
  x0: number
  z0: number
  size: number
}
const MINI_RANGE = 7000
const MINI_REFRESH = 1 / 12
const BIG_REFRESH = 1 / 20
const DEG = Math.PI / 180
const MIN_SCALE = 8
const MAX_SCALE = 420

export interface MapAircraft {
  x: number
  z: number
  heading: number
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  parent.appendChild(node)
  return node
}

function bearing(fromX: number, fromZ: number, toX: number, toZ: number): number {
  const b = Math.atan2(toX - fromX, -(toZ - fromZ)) / DEG
  return (b + 360) % 360
}

interface RunwayLine {
  ax: number
  az: number
  bx: number
  bz: number
  width: number
  grass: boolean
  ends: [string, string]
}

export class FlightMap {
  readonly mini: HTMLCanvasElement
  private readonly miniContext: CanvasRenderingContext2D | null
  private readonly overlay: HTMLDivElement
  private readonly big: HTMLCanvasElement
  private readonly bigContext: CanvasRenderingContext2D | null
  private readonly info: HTMLSpanElement
  private shade: HTMLCanvasElement | null = null
  private worker: Worker | null = null
  private readonly runways: RunwayLine[] = []
  private destination: AirportSpec | null = null
  private miniSince = MINI_REFRESH
  private bigSince = BIG_REFRESH
  private infoSince = 1
  /** Big map view: centre in world metres and metres per CSS pixel. */
  private centreX = 0
  private centreZ = 0
  private scale = 120
  private follow = true
  private dragging = false
  private dragX = 0
  private dragY = 0
  private readonly teardown: (() => void)[] = []
  private readonly aircraft: MapAircraft = { x: 0, z: 0, heading: 0 }
  private traffic: readonly TrafficPose[] = []
  private trafficCount = 0
  private readonly point = { x: 0, y: 0 }
  private miniRadius = 0
  private miniMpp = 1
  private miniCos = 1
  private miniSin = 0
  /** Minimap projection, heading up, around the aircraft. */
  private readonly project = (x: number, z: number, out: { x: number; y: number }): void => {
    const dx = (x - this.aircraft.x) / this.miniMpp
    const dz = (z - this.aircraft.z) / this.miniMpp
    out.x = this.miniRadius + dx * this.miniCos + dz * this.miniSin
    out.y = this.miniRadius - dx * this.miniSin + dz * this.miniCos
  }
  private readonly subtitles = new Map<AirportSpec, string>()
  private bigWidth = 0
  private readonly plans = new Map<string, TownPlan>()
  private roadPaths: { path: Path2D; main: boolean }[] | null = null
  private bigHeight = 0
  onToggle: ((open: boolean) => void) | null = null

  constructor(hudRoot: HTMLElement, overlayParent: HTMLElement) {
    this.mini = el('canvas', 'tf-minimap', hudRoot)
    this.mini.setAttribute('role', 'button')
    this.mini.setAttribute('aria-label', 'Minimap: open the region map')
    this.mini.tabIndex = -1
    this.miniContext = this.mini.getContext('2d')
    this.overlay = el('div', 'tf-map', overlayParent)
    this.overlay.hidden = true
    this.overlay.setAttribute('role', 'dialog')
    this.overlay.setAttribute('aria-label', 'Region map')
    const bar = el('div', 'tf-map-bar', this.overlay)
    el('strong', '', bar, 'Region map')
    this.info = el('span', 'tf-map-info', bar)
    const tools = el('div', 'tf-map-tools', bar)
    const button = (label: string, title: string, action: () => void) => {
      const b = el('button', 'tf-btn', tools, label)
      b.type = 'button'
      b.title = title
      b.setAttribute('aria-label', title)
      b.addEventListener('click', action)
    }
    button('−', 'Zoom out', () => this.zoom(1.5))
    button('+', 'Zoom in', () => this.zoom(1 / 1.5))
    button('Centre', 'Centre on the aircraft', () => {
      this.follow = true
      this.bigSince = BIG_REFRESH
    })
    button('Whole region', 'Show the whole region', () => {
      this.follow = false
      this.centreX = 0
      this.centreZ = 0
      this.scale = (REGION_HALF * 2.1) / Math.max(1, Math.min(this.bigWidth, this.bigHeight))
      this.bigSince = BIG_REFRESH
    })
    button('Close', 'Close the map (M)', () => this.setOpen(false))
    this.big = el('canvas', 'tf-map-canvas', this.overlay)
    this.bigContext = this.big.getContext('2d')
    el('p', 'tf-map-hint', this.overlay, 'Drag to pan, scroll to zoom. M or Esc closes the map; the aircraft keeps flying.')
    for (const airport of AIRPORTS) {
      this.subtitles.set(airport, `${airport.icao} · ${Math.round(airport.elevation * 3.28084).toLocaleString('en-US')} ft`)
      for (const runway of airport.runways) {
        const dx = Math.sin(runway.heading * DEG)
        const dz = -Math.cos(runway.heading * DEG)
        const half = runway.length / 2
        this.runways.push({ ax: runway.cx - dx * half, az: runway.cz - dz * half, bx: runway.cx + dx * half, bz: runway.cz + dz * half, width: runway.width, grass: runway.surface === 'grass', ends: runway.ends })
      }
    }
    const listen = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) => {
      target.addEventListener(type, handler as EventListener, options)
      this.teardown.push(() => target.removeEventListener(type, handler as EventListener, options))
    }
    listen(this.mini, 'pointerdown', (event) => {
      event.stopPropagation()
      this.setOpen(true)
    })
    listen(this.big, 'pointerdown', (event) => {
      this.dragging = true
      this.dragX = event.clientX
      this.dragY = event.clientY
      this.big.setPointerCapture?.(event.pointerId)
    })
    listen(this.big, 'pointermove', (event) => {
      if (!this.dragging) return
      this.follow = false
      this.centreX -= (event.clientX - this.dragX) * this.scale
      this.centreZ -= (event.clientY - this.dragY) * this.scale
      this.dragX = event.clientX
      this.dragY = event.clientY
      this.bigSince = BIG_REFRESH
    })
    listen(this.big, 'pointerup', () => {
      this.dragging = false
    })
    listen(this.big, 'wheel', (event) => {
      event.preventDefault()
      const rect = this.big.getBoundingClientRect()
      const px = event.clientX - rect.left - rect.width / 2
      const py = event.clientY - rect.top - rect.height / 2
      const factor = event.deltaY > 0 ? 1.25 : 0.8
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor))
      if (!this.follow) {
        this.centreX += px * (this.scale - next)
        this.centreZ += py * (this.scale - next)
      }
      this.scale = next
      this.bigSince = BIG_REFRESH
    }, { passive: false })
    this.paintShade()
  }

  private paintShade(): void {
    if (typeof Worker === 'undefined' || typeof document === 'undefined') return
    try {
      this.worker = new Worker(new URL('../render/map.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      this.worker = null
      return
    }
    this.worker.onmessage = (event: MessageEvent<{ size: number; pixels: Uint8ClampedArray; last: boolean }>) => {
      const { size, pixels } = event.data
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (context) {
        context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), size, size), 0, 0)
        this.shade = canvas
      }
      if (event.data.last) {
        this.worker?.terminate()
        this.worker = null
      }
      this.miniSince = MINI_REFRESH
      this.bigSince = BIG_REFRESH
    }
    this.worker.onerror = () => {
      this.worker?.terminate()
      this.worker = null
    }
    this.worker.postMessage({ sizes: SHADE_SIZES })
  }

  get open(): boolean {
    return !this.overlay.hidden
  }

  /** Highlights the airport a contract, route or checkride flies to, or none. */
  setDestination(airportId: string | null): void {
    this.destination = airportId ? airportById(airportId) ?? null : null
  }

  toggle(): void {
    this.setOpen(!this.open)
  }

  setOpen(open: boolean): void {
    if (open === this.open) return
    this.overlay.hidden = !open
    if (open) {
      this.follow = true
      this.bigSince = BIG_REFRESH
      this.infoSince = 1
    }
    this.onToggle?.(open)
  }

  private zoom(factor: number): void {
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor))
    this.bigSince = BIG_REFRESH
  }

  update(aircraft: MapAircraft, traffic: readonly TrafficPose[], trafficCount: number, dt: number): void {
    this.aircraft.x = aircraft.x
    this.aircraft.z = aircraft.z
    this.aircraft.heading = aircraft.heading
    this.traffic = traffic
    this.trafficCount = trafficCount
    this.miniSince += dt
    if (this.miniSince >= MINI_REFRESH && this.mini.offsetParent !== null) {
      this.miniSince = 0
      this.drawMini()
    }
    if (!this.open) return
    this.bigSince += dt
    this.infoSince += dt
    if (this.bigSince >= BIG_REFRESH) {
      this.bigSince = 0
      this.drawBig()
    }
    if (this.infoSince >= 0.5) {
      this.infoSince = 0
      this.updateInfo()
    }
  }

  private updateInfo(): void {
    const a = this.aircraft
    let target = this.destination
    let label = 'To'
    if (!target) {
      let best = Infinity
      for (const airport of AIRPORTS) {
        const d = (airport.x - a.x) * (airport.x - a.x) + (airport.z - a.z) * (airport.z - a.z)
        if (d < best) {
          best = d
          target = airport
        }
      }
      label = 'Nearest'
    }
    if (!target) return
    const km = Math.sqrt((target.x - a.x) * (target.x - a.x) + (target.z - a.z) * (target.z - a.z)) / 1000
    const course = String(Math.round(bearing(a.x, a.z, target.x, target.z)) % 360).padStart(3, '0')
    const text = `${label}: ${target.name} (${target.icao}) · ${km < 10 ? km.toFixed(1) : Math.round(km)} km · fly ${course}°`
    if (this.info.textContent !== text) this.info.textContent = text
  }

  private fit(canvas: HTMLCanvasElement, width: number, height: number): number {
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(width * ratio))
    const h = Math.max(1, Math.round(height * ratio))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    return ratio
  }

  private drawMini(): void {
    const ctx = this.miniContext
    if (!ctx) return
    const size = this.mini.clientWidth
    if (size === 0) return
    const ratio = this.fit(this.mini, size, size)
    const a = this.aircraft
    const radius = size / 2
    const mpp = MINI_RANGE / radius
    const h = a.heading * DEG
    const cosH = Math.cos(h)
    const sinH = Math.sin(h)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.beginPath()
    ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = '#3d5f7d'
    ctx.fillRect(0, 0, size, size)
    ctx.translate(radius, radius)
    ctx.rotate(-h)
    ctx.scale(1 / mpp, 1 / mpp)
    ctx.translate(-a.x, -a.z)
    if (this.shade) {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(this.shade, -REGION_HALF, -REGION_HALF, REGION_HALF * 2, REGION_HALF * 2)
    }
    this.drawRoads(ctx, mpp)
    this.drawPlaces(ctx, mpp)
    this.drawRunways(ctx, mpp)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const p = this.point
    const project = this.project
    this.miniRadius = radius
    this.miniMpp = mpp
    this.miniCos = cosH
    this.miniSin = sinH
    ctx.fillStyle = '#ffd34d'
    for (let i = 0; i < this.trafficCount; i++) {
      const t = this.traffic[i]
      project(t.x, t.z, p)
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.font = 'italic 600 10px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.lineJoin = 'round'
    for (const place of PLACES) {
      project(place.x, place.z, p)
      const dx = p.x - radius
      const dy = p.y - radius
      if (dx * dx + dy * dy > (radius - 22) * (radius - 22)) continue
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.strokeText(place.name, p.x, p.y + 4)
      ctx.fillStyle = '#f3e3c8'
      ctx.fillText(place.name, p.x, p.y + 4)
    }
    ctx.font = '600 10px Inter, system-ui, sans-serif'
    for (const airport of AIRPORTS) {
      project(airport.x, airport.z, p)
      const dx = p.x - radius
      const dy = p.y - radius
      const inside = dx * dx + dy * dy < (radius - 14) * (radius - 14)
      const target = airport === this.destination
      if (!inside) {
        if (!target) continue
        const length = Math.sqrt(dx * dx + dy * dy) || 1
        const ex = radius + (dx / length) * (radius - 9)
        const ey = radius + (dy / length) * (radius - 9)
        ctx.fillStyle = '#5cc8ff'
        ctx.beginPath()
        ctx.arc(ex, ey, 5, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
      ctx.strokeText(airport.icao, p.x, p.y - 8)
      ctx.fillStyle = target ? '#5cc8ff' : '#ffffff'
      ctx.fillText(airport.icao, p.x, p.y - 8)
    }
    ctx.restore()
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(radius, radius, radius / 2, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2)
    ctx.stroke()
    const nx = radius - sinH * (radius - 10)
    const ny = radius - cosH * (radius - 10)
    ctx.font = '700 11px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.beginPath()
    ctx.arc(nx, ny, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ff8a80'
    ctx.fillText('N', nx, ny + 0.5)
    ctx.textBaseline = 'alphabetic'
    this.drawPlane(ctx, radius, radius, 0, 1)
  }

  private drawPlane(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number): void {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(heading)
    ctx.scale(size, size)
    ctx.beginPath()
    ctx.moveTo(0, -9)
    ctx.lineTo(2, -3)
    ctx.lineTo(9, 1)
    ctx.lineTo(9, 3)
    ctx.lineTo(2, 1.5)
    ctx.lineTo(1.5, 6)
    ctx.lineTo(4, 8)
    ctx.lineTo(4, 9.5)
    ctx.lineTo(0, 8.5)
    ctx.lineTo(-4, 9.5)
    ctx.lineTo(-4, 8)
    ctx.lineTo(-1.5, 6)
    ctx.lineTo(-2, 1.5)
    ctx.lineTo(-9, 3)
    ctx.lineTo(-9, 1)
    ctx.lineTo(-2, -3)
    ctx.closePath()
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#0b0e12'
    ctx.lineWidth = 1.5 / size
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  /** Runways in world coordinates (the context is already transformed to metres). */
  private drawRunways(ctx: CanvasRenderingContext2D, mpp: number): void {
    ctx.lineCap = 'butt'
    for (const r of this.runways) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.lineWidth = Math.max(r.width, 6 * mpp)
      ctx.beginPath()
      ctx.moveTo(r.ax, r.az)
      ctx.lineTo(r.bx, r.bz)
      ctx.stroke()
      ctx.strokeStyle = r.grass ? '#c7e6a3' : '#f2f4f7'
      ctx.lineWidth = Math.max(r.width, 3.5 * mpp)
      ctx.stroke()
    }
  }

  /** A town's plan (streets and building footprints), drawn once into its own canvas. */
  private plan(place: Place): TownPlan | null {
    const ready = this.plans.get(place.spec.id)
    if (ready) return ready
    const size = Math.ceil((place.spec.radius * 2.2) / TOWN_MPP)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const x0 = place.spec.x - place.spec.radius * 1.1
    const z0 = place.spec.z - place.spec.radius * 1.1
    ctx.scale(1 / TOWN_MPP, 1 / TOWN_MPP)
    ctx.translate(-x0, -z0)
    ctx.save()
    ctx.beginPath()
    ctx.arc(place.spec.x, place.spec.z, place.spec.radius * 0.96, 0, Math.PI * 2)
    ctx.clip()
    ctx.lineCap = 'round'
    for (const street of place.streets) {
      ctx.strokeStyle = street.main ? '#f4f1ea' : '#e2ddd3'
      ctx.lineWidth = Math.max(street.width, TOWN_MPP * 1.2)
      ctx.beginPath()
      ctx.moveTo(street.ax, street.az)
      ctx.lineTo(street.bx, street.bz)
      ctx.stroke()
    }
    ctx.restore()
    for (const b of place.buildings) {
      const h = b.yaw * DEG
      ctx.save()
      ctx.translate(b.x, b.z)
      ctx.rotate(h)
      ctx.fillStyle = BUILDING_COLOURS[b.kind]
      ctx.fillRect(-b.depth / 2, -b.width / 2, b.depth, b.width)
      if (b.kind === 'skyscraper' || b.kind === 'tower') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
        ctx.fillRect(-b.depth / 2 + b.depth * 0.18, -b.width / 2 + b.width * 0.18, b.depth * 0.64, b.width * 0.64)
      }
      ctx.restore()
    }
    const plan = { canvas, x0, z0, size: size * TOWN_MPP }
    this.plans.set(place.spec.id, plan)
    return plan
  }

  /** Town plans (built one per draw so none stalls a frame) and soft discs for those not drawn yet, in world coordinates. */
  private drawPlaces(ctx: CanvasRenderingContext2D, mpp: number): void {
    let built = false
    for (const place of allPlaces()) {
      let plan = this.plans.get(place.spec.id) ?? null
      if (!plan && !built) {
        plan = this.plan(place)
        built = true
      }
      if (plan) {
        ctx.fillStyle = 'rgba(206, 196, 180, 0.6)'
        ctx.beginPath()
        ctx.arc(place.spec.x, place.spec.z, Math.max(place.spec.radius, 3 * mpp), 0, Math.PI * 2)
        ctx.fill()
        ctx.drawImage(plan.canvas, plan.x0, plan.z0, plan.size, plan.size)
      } else {
        ctx.fillStyle = 'rgba(214, 196, 170, 0.55)'
        ctx.beginPath()
        ctx.arc(place.spec.x, place.spec.z, Math.max(place.spec.radius, 3 * mpp), 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  /** Country roads in world coordinates: a dark casing under a pale (or, for main roads, yellow) line. */
  private drawRoads(ctx: CanvasRenderingContext2D, mpp: number): void {
    if (!this.roadPaths) {
      this.roadPaths = allRoads().map((road) => {
        const path = new Path2D()
        const p = road.points
        path.moveTo(p[0], p[1])
        for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1])
        return { path, main: road.main }
      })
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const road of this.roadPaths) {
      ctx.strokeStyle = 'rgba(60, 50, 40, 0.55)'
      ctx.lineWidth = Math.max(road.main ? 14 : 10, (road.main ? 3.6 : 2.6) * mpp)
      ctx.stroke(road.path)
    }
    for (const road of this.roadPaths) {
      ctx.strokeStyle = road.main ? '#f6d778' : '#fbf7ee'
      ctx.lineWidth = Math.max(road.main ? 9 : 7, (road.main ? 2.2 : 1.4) * mpp)
      ctx.stroke(road.path)
    }
  }

  private drawBig(): void {
    const ctx = this.bigContext
    if (!ctx) return
    const width = this.big.clientWidth
    const height = this.big.clientHeight
    if (width === 0 || height === 0) return
    this.bigWidth = width
    this.bigHeight = height
    const ratio = this.fit(this.big, width, height)
    const a = this.aircraft
    if (this.follow) {
      this.centreX = a.x
      this.centreZ = a.z
    }
    const mpp = this.scale
    const cx = this.centreX
    const cz = this.centreZ
    const sx = (x: number) => width / 2 + (x - cx) / mpp
    const sy = (z: number) => height / 2 + (z - cz) / mpp
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.fillStyle = '#2f4a63'
    ctx.fillRect(0, 0, width, height)
    ctx.save()
    ctx.translate(width / 2, height / 2)
    ctx.scale(1 / mpp, 1 / mpp)
    ctx.translate(-cx, -cz)
    if (this.shade) {
      ctx.imageSmoothingEnabled = mpp > 120
      ctx.drawImage(this.shade, -REGION_HALF, -REGION_HALF, REGION_HALF * 2, REGION_HALF * 2)
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.lineWidth = 2 * mpp
    ctx.strokeRect(-REGION_HALF, -REGION_HALF, REGION_HALF * 2, REGION_HALF * 2)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.lineWidth = mpp
    ctx.beginPath()
    for (let g = -REGION_HALF; g <= REGION_HALF; g += 10000) {
      ctx.moveTo(g, -REGION_HALF)
      ctx.lineTo(g, REGION_HALF)
      ctx.moveTo(-REGION_HALF, g)
      ctx.lineTo(REGION_HALF, g)
    }
    ctx.stroke()
    this.drawRoads(ctx, mpp)
    this.drawPlaces(ctx, mpp)
    this.drawRunways(ctx, mpp)
    ctx.restore()
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.textAlign = 'center'
    ctx.font = 'italic 600 12px Inter, system-ui, sans-serif'
    ctx.lineJoin = 'round'
    for (const place of PLACES) {
      if (mpp > 150) break
      const x = sx(place.x)
      const y = sy(place.z) + Math.max(3, place.radius / mpp) + 13
      if (x < -60 || y < -20 || x > width + 60 || y > height + 20) continue
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.strokeText(place.name, x, y)
      ctx.fillStyle = '#f3e3c8'
      ctx.fillText(place.name, x, y)
    }
    if (mpp < 40) {
      ctx.font = '700 11px Inter, system-ui, sans-serif'
      for (const r of this.runways) {
        const length = Math.sqrt((r.bx - r.ax) * (r.bx - r.ax) + (r.bz - r.az) * (r.bz - r.az)) || 1
        const ux = (r.bx - r.ax) / length
        const uz = (r.bz - r.az) / length
        const reach = 14 * mpp
        for (const [x, z, name] of [[r.ax - ux * reach, r.az - uz * reach, r.ends[0]], [r.bx + ux * reach, r.bz + uz * reach, r.ends[1]]] as const) {
          ctx.lineWidth = 3
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
          ctx.strokeText(name, sx(x), sy(z) + 4)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(name, sx(x), sy(z) + 4)
        }
      }
    }
    for (const airport of AIRPORTS) {
      const x = sx(airport.x)
      const y = sy(airport.z)
      if (x < -120 || y < -40 || x > width + 120 || y > height + 40) continue
      const target = airport === this.destination
      ctx.strokeStyle = target ? '#5cc8ff' : 'rgba(255, 255, 255, 0.85)'
      ctx.lineWidth = target ? 3 : 2
      ctx.beginPath()
      ctx.arc(x, y, Math.max(9, 2200 / mpp), 0, Math.PI * 2)
      ctx.stroke()
      const labelY = y - Math.max(9, 2200 / mpp) - (mpp > 150 ? -5 : 8)
      ctx.font = '700 13px Inter, system-ui, sans-serif'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
      ctx.strokeText(airport.name, x, labelY - 13)
      ctx.fillStyle = target ? '#5cc8ff' : '#ffffff'
      ctx.fillText(airport.name, x, labelY - 13)
      if (mpp > 150) continue
      ctx.font = '600 11px Inter, system-ui, sans-serif'
      const sub = this.subtitles.get(airport) ?? airport.icao
      ctx.strokeText(sub, x, labelY)
      ctx.fillStyle = '#c9d4de'
      ctx.fillText(sub, x, labelY)
    }
    ctx.fillStyle = '#ffd34d'
    for (let i = 0; i < this.trafficCount; i++) {
      const t = this.traffic[i]
      ctx.beginPath()
      ctx.arc(sx(t.x), sy(t.z), 3, 0, Math.PI * 2)
      ctx.fill()
    }
    const target = this.destination
    const px = sx(a.x)
    const py = sy(a.z)
    if (target) {
      ctx.setLineDash([8, 6])
      ctx.strokeStyle = 'rgba(92, 200, 255, 0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(sx(target.x), sy(target.z))
      ctx.stroke()
      ctx.setLineDash([])
    }
    this.drawPlane(ctx, px, py, a.heading * DEG, 1.4)
    const barKm = mpp * 120 > 5000 ? Math.round((mpp * 120) / 5000) * 5 : Math.max(1, Math.round((mpp * 120) / 1000))
    const barPx = (barKm * 1000) / mpp
    ctx.fillStyle = 'rgba(11, 14, 18, 0.7)'
    ctx.fillRect(12, height - 34, barPx + 70, 24)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(20, height - 20, barPx, 3)
    ctx.textAlign = 'left'
    ctx.font = '600 11px Inter, system-ui, sans-serif'
    ctx.fillText(`${barKm} km`, 26 + barPx, height - 15)
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(11, 14, 18, 0.7)'
    ctx.beginPath()
    ctx.arc(width - 30, height - 30, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ff8a80'
    ctx.font = '700 13px Inter, system-ui, sans-serif'
    ctx.fillText('N', width - 30, height - 25)
  }

  dispose(): void {
    for (const off of this.teardown) off()
    this.teardown.length = 0
    this.worker?.terminate()
    this.worker = null
    this.mini.remove()
    this.overlay.remove()
  }
}
