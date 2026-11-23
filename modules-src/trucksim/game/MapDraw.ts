/**
 * The county map for the corner minimap and the full map panel: roads, sites, fields, lots and Millbrook drawn once into an
 * offscreen canvas, then each frame a heading-up (minimap) or north-up (map) view of it with the rig, the job target and the
 * GPS route on top. Nothing is allocated per draw except what canvas calls need.
 */
import { FIELDS, LOTS, ROADS, SITES, WORLD_HALF, WORLD_SIZE, lotExtent } from '../shared/WorldLayout'
import type { SiteKind } from '../shared/WorldLayout'

export const MAP_PIXELS = 1024
const SCALE = MAP_PIXELS / WORLD_SIZE

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

/** In the right-handed frame +X is on a viewer's left when facing +Z (north), so it maps to the canvas's left. */
function px(world: number): number {
  return (WORLD_HALF - world) * SCALE
}

/** World z grows north; the canvas y grows down, so north is up. */
function py(world: number): number {
  return (WORLD_HALF - world) * SCALE
}

/**
 * The world point under (`x`, `y`) on a full map drawn by `drawFull` into a `width` × `height` canvas, or null outside the
 * county square.
 */
export function fullMapToWorld(x: number, y: number, width: number, height: number): { x: number; z: number } | null {
  const fit = Math.min(width, height) / MAP_PIXELS
  const mx = (x - (width - MAP_PIXELS * fit) / 2) / fit
  const my = (y - (height - MAP_PIXELS * fit) / 2) / fit
  if (mx < 0 || my < 0 || mx > MAP_PIXELS || my > MAP_PIXELS) return null
  return { x: WORLD_HALF - mx / SCALE, z: WORLD_HALF - my / SCALE }
}

export class CountyMap {
  private readonly base: HTMLCanvasElement | OffscreenCanvas

  constructor() {
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(MAP_PIXELS, MAP_PIXELS) : Object.assign(document.createElement('canvas'), { width: MAP_PIXELS, height: MAP_PIXELS })
    this.base = canvas
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
    if (ctx) this.paint(ctx)
  }

  private paint(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#2f3b2b'
    ctx.fillRect(0, 0, MAP_PIXELS, MAP_PIXELS)
    for (const field of FIELDS) {
      ctx.fillStyle = field.crop === 'wheat' ? '#7d6b3c' : field.crop === 'corn' ? '#556b32' : '#3f5a30'
      ctx.fillRect(px(field.x + field.w / 2), py(field.z + field.d / 2), field.w * SCALE, field.d * SCALE)
    }
    for (const site of SITES) {
      ctx.fillStyle = SITE_COLORS[site.kind]
      ctx.globalAlpha = site.kind === 'town' || site.kind === 'lotDistrict' ? 0.25 : 0.55
      ctx.fillRect(px(site.x + site.w / 2), py(site.z + site.d / 2), site.w * SCALE, site.d * SCALE)
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    for (const lot of LOTS) ctx.strokeRect(px(lot.x + lot.w), py(lot.z + lot.d), lot.w * SCALE, lot.d * SCALE)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const pass of [0, 1]) {
      for (const road of ROADS) {
        const width = Math.max(1.4, road.width * SCALE * (road.kind === 'highway' ? 1.6 : 1.3))
        ctx.strokeStyle = pass === 0 ? '#15181c' : road.kind === 'highway' ? '#e8c46a' : road.kind === 'gravel' ? '#a89a82' : '#d9dce0'
        ctx.lineWidth = pass === 0 ? width + 2 : width
        ctx.beginPath()
        road.points.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(px(x), py(z)) : ctx.lineTo(px(x), py(z))))
        if (road.loop) ctx.closePath()
        ctx.stroke()
      }
    }
    ctx.fillStyle = '#eef0f2'
    ctx.font = "600 9px 'TL Fox Dollar', Inter, system-ui, sans-serif"
    ctx.textAlign = 'center'
    for (const site of SITES) {
      if (site.kind === 'lotDistrict') continue
      ctx.fillText(site.name, px(site.x), py(site.z) + 3)
    }
  }

  private overlay(ctx: CanvasRenderingContext2D, markers: MapMarkers, unit: number): void {
    if (markers.ownLot !== undefined && markers.ownLot !== null) {
      const spec = LOTS[markers.ownLot]
      const lot = spec ? lotExtent(spec, markers.ownLand ?? 0) : null
      if (lot) {
        ctx.strokeStyle = '#f2a33a'
        ctx.lineWidth = 2 * unit
        ctx.strokeRect(px(lot.x + lot.w), py(lot.z + lot.d), lot.w * SCALE, lot.d * SCALE)
      }
    }
    const route = markers.route
    if (route && route.length > 1) {
      ctx.strokeStyle = '#4fb4ff'
      ctx.lineWidth = 3 * unit
      ctx.beginPath()
      route.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(px(x), py(z)) : ctx.lineTo(px(x), py(z))))
      ctx.stroke()
    }
    if (markers.others) {
      ctx.fillStyle = '#c9ccd1'
      for (const other of markers.others) {
        ctx.beginPath()
        ctx.arc(px(other.x), py(other.z), 3 * unit, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (markers.waypoint) {
      const wx = px(markers.waypoint.x)
      const wy = py(markers.waypoint.z)
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
      ctx.arc(px(markers.target.x), py(markers.target.z), 5 * unit, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    const { x, z, heading } = markers.rig
    ctx.save()
    ctx.translate(px(x), py(z))
    ctx.rotate(-heading)
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
    const zoom = size / (metres * SCALE)
    ctx.save()
    ctx.clearRect(0, 0, size, size)
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.translate(size / 2, size / 2)
    ctx.rotate(markers.rig.heading)
    ctx.scale(zoom, zoom)
    ctx.translate(-px(markers.rig.x), -py(markers.rig.z))
    ctx.drawImage(this.base as CanvasImageSource, 0, 0)
    this.overlay(ctx, markers, 1 / zoom)
    ctx.restore()
  }

  /** The full north-up map fitted into the canvas. */
  drawFull(ctx: CanvasRenderingContext2D, width: number, height: number, markers: MapMarkers): void {
    const fit = Math.min(width, height) / MAP_PIXELS
    ctx.save()
    ctx.fillStyle = '#14161a'
    ctx.fillRect(0, 0, width, height)
    ctx.translate((width - MAP_PIXELS * fit) / 2, (height - MAP_PIXELS * fit) / 2)
    ctx.scale(fit, fit)
    ctx.drawImage(this.base as CanvasImageSource, 0, 0)
    this.overlay(ctx, markers, 1.4)
    ctx.restore()
  }
}
