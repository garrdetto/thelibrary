/**
 * The haul map for the corner minimap and the full map panel: roads, sites, fields and lots of a haul world drawn once into an
 * offscreen canvas, then each frame a heading-up (minimap) or north-up (map) view of it with the rig, the job target and the
 * GPS route on top. A `MapSource` says what to draw and how its frame turns into the picture (the county's +X is west and +Z
 * north; Montello's town frame has x east and z south). Nothing is allocated per draw except what canvas calls need.
 */
import { FIELDS, LOTS, ROADS, SITES, WORLD_HALF, lotExtent } from '../shared/WorldLayout'
import type { LotSpec, RoadKind, Site, SiteKind } from '../shared/WorldLayout'

export const MAP_PIXELS = 1024

export const SITE_COLORS: Record<SiteKind, string> = {
  dealership: '#f2a33a', truckStop: '#e0a12b', fuelStation: '#e0a12b', quarry: '#a39582', construction: '#c98a3a', equipmentYard: '#d2b14a',
  refinery: '#b85c4b', farm: '#7fae5a', elevator: '#c9b27a', coldStorage: '#7fb6d8', distribution: '#7fb6d8', steelMill: '#8f969d',
  lumberYard: '#a6794a', buildingSupply: '#c4a06a', town: '#6b7380', lotDistrict: '#4a5560',
}

export interface MapMarkers {
  rig: { x: number; z: number; heading: number }
  target?: { x: number; z: number; label: string } | null
  /** A destination the driver picked on the map (drawn as a flag). */
  waypoint?: { x: number; z: number } | null
  route?: readonly [number, number][] | null
  ownLot?: number | null
  ownLand?: number
  others?: readonly { x: number; z: number }[]
}

export interface MapRoad {
  kind: RoadKind
  width: number
  points: readonly (readonly [number, number])[]
  loop?: boolean
}

/** What a haul map draws and the square of the world it covers. */
export interface MapSource {
  /** The square drawn: its smallest x and z and its side in metres. */
  readonly x0: number
  readonly z0: number
  readonly size: number
  /** True when the world's +x points west (canvas left); false when it points east. */
  readonly xWest: boolean
  /** True when the world's +z points north (canvas up); false when it points south. */
  readonly zNorth: boolean
  readonly pixels: number
  readonly background: string
  readonly roads: readonly MapRoad[]
  readonly sites: readonly Site[]
  readonly lots: readonly LotSpec[]
  readonly fields?: readonly { x: number; z: number; w: number; d: number; crop: 'corn' | 'soybeans' | 'wheat' }[]
  /** Sites drawn as a faint wash with no label (Millbrook, the lot districts). */
  readonly faint?: (site: Site) => boolean
  /** Smallest road width in pixels, so lanes stay visible on a big map. */
  readonly minRoadPx?: number
}

/** The county square of `shared/WorldLayout.ts`. */
export const COUNTY_MAP: MapSource = {
  x0: -WORLD_HALF, z0: -WORLD_HALF, size: WORLD_HALF * 2, xWest: true, zNorth: true, pixels: MAP_PIXELS, background: '#2f3b2b',
  roads: ROADS, sites: SITES, lots: LOTS, fields: FIELDS,
  faint: (site) => site.kind === 'town' || site.kind === 'lotDistrict',
}

export class HaulMap {
  private readonly base: HTMLCanvasElement | OffscreenCanvas
  private readonly scale: number
  readonly pixels: number

  constructor(private readonly source: MapSource = COUNTY_MAP) {
    this.pixels = source.pixels
    this.scale = source.pixels / source.size
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(this.pixels, this.pixels) : Object.assign(document.createElement('canvas'), { width: this.pixels, height: this.pixels })
    this.base = canvas
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
    if (ctx) this.paint(ctx)
  }

  /** Canvas x of world x. */
  px(x: number): number {
    const s = this.source
    return (s.xWest ? s.x0 + s.size - x : x - s.x0) * this.scale
  }

  /** Canvas y of world z (north up). */
  py(z: number): number {
    const s = this.source
    return (s.zNorth ? s.z0 + s.size - z : z - s.z0) * this.scale
  }

  /** Canvas rotation that turns an arrow drawn pointing up so it points along heading `h` (which faces `(sin h, cos h)`). */
  arrowAngle(heading: number): number {
    const dx = (this.source.xWest ? -1 : 1) * Math.sin(heading)
    const dy = (this.source.zNorth ? -1 : 1) * Math.cos(heading)
    return Math.atan2(dx, -dy)
  }

  /** The world point under (`x`, `y`) on a full map drawn by `drawFull` into a `width` × `height` canvas, or null outside it. */
  toWorld(x: number, y: number, width: number, height: number): { x: number; z: number } | null {
    const fit = Math.min(width, height) / this.pixels
    const mx = (x - (width - this.pixels * fit) / 2) / fit
    const my = (y - (height - this.pixels * fit) / 2) / fit
    if (mx < 0 || my < 0 || mx > this.pixels || my > this.pixels) return null
    const s = this.source
    const wx = mx / this.scale
    const wz = my / this.scale
    return { x: s.xWest ? s.x0 + s.size - wx : s.x0 + wx, z: s.zNorth ? s.z0 + s.size - wz : s.z0 + wz }
  }

  /** Canvas rectangle of a world rectangle (x, z its smallest corner). */
  private rect(ctx: CanvasRenderingContext2D, x: number, z: number, w: number, d: number, stroke: boolean): void {
    const ax = this.px(x), bx = this.px(x + w)
    const ay = this.py(z), by = this.py(z + d)
    const l = Math.min(ax, bx), t = Math.min(ay, by)
    if (stroke) ctx.strokeRect(l, t, Math.abs(bx - ax), Math.abs(by - ay))
    else ctx.fillRect(l, t, Math.abs(bx - ax), Math.abs(by - ay))
  }

  private paint(ctx: CanvasRenderingContext2D): void {
    const s = this.source
    ctx.fillStyle = s.background
    ctx.fillRect(0, 0, this.pixels, this.pixels)
    for (const field of s.fields ?? []) {
      ctx.fillStyle = field.crop === 'wheat' ? '#7d6b3c' : field.crop === 'corn' ? '#556b32' : '#3f5a30'
      this.rect(ctx, field.x - field.w / 2, field.z - field.d / 2, field.w, field.d, false)
    }
    for (const site of s.sites) {
      ctx.fillStyle = SITE_COLORS[site.kind]
      ctx.globalAlpha = s.faint?.(site) ? 0.25 : 0.55
      this.rect(ctx, site.x - site.w / 2, site.z - site.d / 2, site.w, site.d, false)
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    for (const lot of s.lots) this.rect(ctx, lot.x, lot.z, lot.w, lot.d, true)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const minWidth = s.minRoadPx ?? 1.4
    for (const pass of [0, 1]) {
      for (const road of s.roads) {
        const width = Math.max(minWidth * (road.kind === 'highway' ? 1.5 : 1), road.width * this.scale * (road.kind === 'highway' ? 1.6 : 1.3))
        ctx.strokeStyle = pass === 0 ? '#15181c' : road.kind === 'highway' ? '#e8c46a' : road.kind === 'gravel' ? '#a89a82' : '#d9dce0'
        ctx.lineWidth = pass === 0 ? width + 2 : width
        ctx.beginPath()
        road.points.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(this.px(x), this.py(z)) : ctx.lineTo(this.px(x), this.py(z))))
        if (road.loop) ctx.closePath()
        ctx.stroke()
      }
    }
    ctx.fillStyle = '#eef0f2'
    ctx.font = "600 9px 'TL Fox Dollar', Inter, system-ui, sans-serif"
    ctx.textAlign = 'center'
    for (const site of s.sites) {
      if (site.kind === 'lotDistrict' || (s.faint?.(site) && site.kind !== 'town')) continue
      ctx.fillText(site.name, this.px(site.x), this.py(site.z) + 3)
    }
  }

  private overlay(ctx: CanvasRenderingContext2D, markers: MapMarkers, unit: number): void {
    if (markers.ownLot !== undefined && markers.ownLot !== null) {
      const spec = this.source.lots.find((lot) => lot.index === markers.ownLot)
      const lot = spec ? lotExtent(spec, markers.ownLand ?? 0) : null
      if (lot) {
        ctx.strokeStyle = '#f2a33a'
        ctx.lineWidth = 2 * unit
        this.rect(ctx, lot.x, lot.z, lot.w, lot.d, true)
      }
    }
    const route = markers.route
    if (route && route.length > 1) {
      ctx.strokeStyle = '#4fb4ff'
      ctx.lineWidth = 3 * unit
      ctx.beginPath()
      route.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(this.px(x), this.py(z)) : ctx.lineTo(this.px(x), this.py(z))))
      ctx.stroke()
    }
    if (markers.others) {
      ctx.fillStyle = '#c9ccd1'
      for (const other of markers.others) {
        ctx.beginPath()
        ctx.arc(this.px(other.x), this.py(other.z), 3 * unit, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (markers.waypoint) {
      const wx = this.px(markers.waypoint.x)
      const wy = this.py(markers.waypoint.z)
      ctx.strokeStyle = '#14161a'
      ctx.fillStyle = '#4fb4ff'
      ctx.lineWidth = 1.5 * unit
      ctx.beginPath()
      ctx.moveTo(wx, wy)
      ctx.lineTo(wx, wy - 14 * unit)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(wx, wy - 14 * unit)
      ctx.lineTo(wx + 9 * unit, wy - 10.5 * unit)
      ctx.lineTo(wx, wy - 7 * unit)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    if (markers.target) {
      ctx.fillStyle = '#f2a33a'
      ctx.strokeStyle = '#14161a'
      ctx.lineWidth = 1.5 * unit
      ctx.beginPath()
      ctx.arc(this.px(markers.target.x), this.py(markers.target.z), 5 * unit, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    const { x, z, heading } = markers.rig
    ctx.save()
    ctx.translate(this.px(x), this.py(z))
    ctx.rotate(this.arrowAngle(heading))
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#14161a'
    ctx.lineWidth = 1.5 * unit
    ctx.beginPath()
    ctx.moveTo(0, -8 * unit)
    ctx.lineTo(5.5 * unit, 6 * unit)
    ctx.lineTo(0, 3 * unit)
    ctx.lineTo(-5.5 * unit, 6 * unit)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  /** The round heading-up corner map: `metres` across the canvas, centred on the rig. */
  drawMinimap(ctx: CanvasRenderingContext2D, size: number, metres: number, markers: MapMarkers): void {
    const zoom = size / (metres * this.scale)
    ctx.save()
    ctx.clearRect(0, 0, size, size)
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = this.source.background
    ctx.fillRect(0, 0, size, size)
    ctx.translate(size / 2, size / 2)
    ctx.rotate(-this.arrowAngle(markers.rig.heading))
    ctx.scale(zoom, zoom)
    ctx.translate(-this.px(markers.rig.x), -this.py(markers.rig.z))
    ctx.drawImage(this.base as CanvasImageSource, 0, 0)
    this.overlay(ctx, markers, 1 / zoom)
    ctx.restore()
  }

  /** The full north-up map fitted into the canvas. */
  drawFull(ctx: CanvasRenderingContext2D, width: number, height: number, markers: MapMarkers): void {
    const fit = Math.min(width, height) / this.pixels
    ctx.save()
    ctx.fillStyle = '#14161a'
    ctx.fillRect(0, 0, width, height)
    ctx.translate((width - this.pixels * fit) / 2, (height - this.pixels * fit) / 2)
    ctx.scale(fit, fit)
    ctx.drawImage(this.base as CanvasImageSource, 0, 0)
    this.overlay(ctx, markers, 1.4 * (this.pixels / MAP_PIXELS))
    ctx.restore()
  }
}

const COUNTY_FRAME = { pixels: MAP_PIXELS, scale: MAP_PIXELS / (WORLD_HALF * 2) }

/** The county point under (`x`, `y`) on the county's full map, or null outside the county square. */
export function fullMapToWorld(x: number, y: number, width: number, height: number): { x: number; z: number } | null {
  const fit = Math.min(width, height) / COUNTY_FRAME.pixels
  const mx = (x - (width - COUNTY_FRAME.pixels * fit) / 2) / fit
  const my = (y - (height - COUNTY_FRAME.pixels * fit) / 2) / fit
  if (mx < 0 || my < 0 || mx > COUNTY_FRAME.pixels || my > COUNTY_FRAME.pixels) return null
  return { x: WORLD_HALF - mx / COUNTY_FRAME.scale, z: WORLD_HALF - my / COUNTY_FRAME.scale }
}
