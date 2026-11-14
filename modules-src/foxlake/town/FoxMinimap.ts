/**
 * Fox Lake's corner minimap: the same atlas as the full map, everywhere (the
 * town, the county road and the lake country are one map, with no switch at
 * the seam), turned so the camera's view is up, zoomed in close (N cycles the
 * range) and showing the route you picked on the full map, its goal, nearby
 * places, your party, vehicles and the compass. Redrawn ten times a second in
 * place of Rack & Reel's own minimap, whose canvas it hides.
 */
import type { MapMarker } from '../../rackreel/ui/Minimap'
import type { LotDef } from '../../maplestreet/shared/WorldLayout'
import type { Atlas, RouteLine } from './Atlas'

/** Map radius in metres at each zoom step; the opening one is RANGES[1]. */
const RANGES = [55, 95, 170, 320]

export class FoxMinimap {
  private readonly canvas: HTMLCanvasElement
  private readonly g: CanvasRenderingContext2D
  private zoom = 1

  get element(): HTMLCanvasElement {
    return this.canvas
  }
  private timer = 0

  constructor(private readonly atlas: Atlas, private readonly route: () => RouteLine | null, private readonly lot: (lot: LotDef) => 'mine' | 'owned' | 'sale' | null) {
    const holder = document.getElementById('minimap')
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'fl-minimap'
    this.canvas.setAttribute('role', 'img')
    this.canvas.setAttribute('aria-label', 'Minimap of Fox Lake')
    if (holder) {
      for (const c of Array.from(holder.querySelectorAll('canvas'))) c.style.display = 'none'
      holder.classList.add('fl-minimap-holder')
      holder.append(this.canvas)
    }
    this.g = this.canvas.getContext('2d')!
  }

  cycleZoom(): string {
    this.zoom = (this.zoom + 1) % RANGES.length
    return `Map: ${Math.round(RANGES[this.zoom] * 2)} m across`
  }

  draw(dt: number, x: number, z: number, cameraYaw: number, facing: number, markers: () => MapMarker[]): void {
    this.timer -= dt
    if (this.timer > 0) return
    this.timer = 0.1
    const r = this.canvas.getBoundingClientRect()
    if (!r.width) return
    const dpr = Math.min(2, devicePixelRatio || 1)
    const W = Math.round(r.width * dpr)
    if (this.canvas.width !== W || this.canvas.height !== W) {
      this.canvas.width = W
      this.canvas.height = W
    }
    const g = this.g
    const range = RANGES[this.zoom]
    const view = { cx: x, cz: z, s: W / 2 / range, rot: -cameraYaw, W, H: W }
    this.atlas.draw(g, view, { mini: true, route: this.route(), lots: this.lot, dpr, markers: markers() })
    g.save()
    g.translate(W / 2, W / 2)
    g.rotate(facing - cameraYaw)
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
    const north = -cameraYaw
    const rr = W / 2 - 11 * dpr
    const nx = W / 2 + Math.sin(-north) * -rr
    const ny = W / 2 - Math.cos(-north) * rr
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
}
