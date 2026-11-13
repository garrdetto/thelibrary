/**
 * The map of all of Fox Lake, shared by the full map (Ctrl) and the corner
 * minimap. A raster base, 2 m to the pixel and painted a slice at a time after
 * loading, carries the land: hill shading and 2 m contours, depth-shaded water
 * with a lit shoreline, meadow, stippled woods, marsh, bare rock and the town's
 * lawns, with the woods beyond the edge of the world dimmed. On top, vectors
 * drawn at any zoom: every road with its casing and centre line (town streets,
 * the curved lanes, the county road, the Lake Road, the interstate and its
 * bridge, the trail around the lake), lots, buildings, the roadside places and
 * labels for streets, areas and places. Scene coordinates throughout (+x east,
 * +z north).
 */
import { HALF, HIGHWAY, LAKE_CENTER, PLAY_LIMIT, WATER_LEVEL, fbm, forestDensity, lakeCoord, lakeRadius, marshWeight, type Terrain } from '../../rackreel/world/Terrain'
import type { MapMarker } from '../../rackreel/ui/Minimap'
import { BUILDINGS, CIVIC, CURVES, DEPOT, GAS_STATION, ROADS, ROAD_NAMES, SHOP_DOORS, makeLots, type LotDef } from '../../maplestreet/shared/WorldLayout'
import { CASINO } from '../casino/CasinoLayout'
import { BUILT_UP, TOWN_SQUARE, connectorPath, inTownSquare, outsideHeight, sceneToTown, townToScene } from '../region'
import { LAKE_ROAD_APRON, highwayAt, HIGHWAY_END_T, lakeRoadPath } from '../country/Roads'
import { ROADSIDE, doorSpot, lotRect, placeFrame, type RoadsideKind } from '../roadside/RoadsideLayout'
import { woodsAt } from './TownGround'
import { CASINO_NAME } from '../casino/CasinoHost'

export const ATLAS = { x0: -1000, x1: 524, z0: -520, z1: 1796, m: 2 } as const
const COLS = Math.round((ATLAS.x1 - ATLAS.x0) / ATLAS.m)
const ROWS = Math.round((ATLAS.z1 - ATLAS.z0) / ATLAS.m)

export type PoiKind = 'outfitters' | 'dock' | 'camp' | 'stand' | 'blind' | 'shop' | 'casino' | 'gas' | 'motel' | 'bar' | 'cabin' | 'civic' | 'depot' | 'home' | 'landmark' | 'hotel'

export interface Poi {
  id: string
  name: string
  kind: PoiKind
  x: number
  z: number
  /** Where a route to it ends (a door or the road in front), scene coordinates. */
  to: { x: number; z: number }
  /** 1: labelled at every zoom; 2: from town zoom; 3: close up only. */
  tier: 1 | 2 | 3
  group: 'Town' | 'County Road' | 'Lake country'
  note?: string
}

export interface View {
  cx: number
  cz: number
  /** Pixels per metre. */
  s: number
  /** Canvas rotation (radians); the minimap turns with the camera. */
  rot: number
  W: number
  H: number
}

export interface RouteLine {
  points: { x: number; z: number }[]
  goal: { x: number; z: number }
}

interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

interface Building {
  pts: { x: number; z: number }[]
  fill: string
  name?: string
}

interface Street {
  name: string
  pts: { x: number; z: number }[]
  width: number
  kind: 'street' | 'county' | 'lake' | 'interstate' | 'trail'
}

const ICON: Record<PoiKind, { color: string; glyph: string }> = {
  outfitters: { color: '#c4561c', glyph: 'F' },
  dock: { color: '#8a6a43', glyph: '⚓' },
  camp: { color: '#a8361d', glyph: 'W' },
  stand: { color: '#e8701f', glyph: '▲' },
  blind: { color: '#c99b5a', glyph: '■' },
  shop: { color: '#3b5d8a', glyph: '$' },
  casino: { color: '#7b2c5d', glyph: '♠' },
  gas: { color: '#c23b2a', glyph: '⛽' },
  motel: { color: '#2f6b4a', glyph: 'M' },
  bar: { color: '#8a4a1c', glyph: '🍺' },
  cabin: { color: '#7a5232', glyph: '⌂' },
  civic: { color: '#4a5a78', glyph: '★' },
  depot: { color: '#6e665c', glyph: 'D' },
  home: { color: '#ffd34d', glyph: '⌂' },
  landmark: { color: '#3c5a3a', glyph: '◆' },
  hotel: { color: '#6a4a8a', glyph: 'H' },
}

const SHOP_NAMES: Record<string, string> = { dealer: 'Car dealer', diner: 'Diner', bank: 'Bank', clothing: 'Clothing: try on outfits', cafe: 'Café', grocery: 'Grocery', hardware: 'Hardware store', gas: 'Gas station' }

function scene(tx: number, tz: number): { x: number; z: number } {
  const p = townToScene(tx, 0, tz)
  return { x: p.x, z: p.z }
}

function townRect(cx: number, cz: number, sx: number, sz: number): { x: number; z: number }[] {
  const a = scene(cx - sx / 2, cz - sz / 2)
  const b = scene(cx + sx / 2, cz + sz / 2)
  return [{ x: a.x, z: a.z }, { x: b.x, z: a.z }, { x: b.x, z: b.z }, { x: a.x, z: b.z }]
}

function mix(a: number[], b: number[], t: number): number[] {
  const k = Math.min(1, Math.max(0, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

function hash(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const PAL = {
  meadow: [176, 188, 128],
  dry: [196, 186, 136],
  forest: [74, 112, 70],
  forestDark: [52, 86, 54],
  marsh: [142, 152, 104],
  rock: [156, 150, 140],
  shore: [212, 196, 150],
  lawn: [150, 186, 112],
  town: [190, 196, 168],
  water0: [138, 186, 206],
  water1: [40, 92, 138],
  beyond: [58, 78, 58],
}

export class Atlas {
  readonly base: HTMLCanvasElement
  readonly pois: Poi[] = []
  readonly streets: Street[] = []
  private readonly buildings: Building[] = []
  private readonly lots: { id: string; pts: { x: number; z: number }[]; lot: LotDef }[] = []
  private readonly roadsideLots: { pts: { x: number; z: number }[]; surface: 'gravel' | 'asphalt' }[] = []
  private readonly areaLabels: { name: string; x: number; z: number; size: number; color: string; halo: string; minS: number; maxS: number }[] = []
  private progress = 0
  private readonly ready: Promise<void>

  constructor(private readonly terrain: Terrain, markers: MapMarker[], dock: { x: number; z: number } | null) {
    this.base = document.createElement('canvas')
    this.base.width = COLS
    this.base.height = ROWS
    const g = this.base.getContext('2d')!
    g.fillStyle = `rgb(${PAL.beyond.join(',')})`
    g.fillRect(0, 0, COLS, ROWS)
    this.collect(markers, dock)
    this.ready = this.paint()
  }

  /** Resolves once the raster is fully painted (it is painted a slice per frame after loading). */
  whenReady(): Promise<void> {
    return this.ready
  }

  get painted(): number {
    return this.progress
  }

  // ------------------------------------------------------------ data

  private collect(markers: MapMarker[], dock: { x: number; z: number } | null): void {
    ROADS.forEach((r, i) => {
      const a = scene(r.cx - r.sx / 2, r.cz - r.sz / 2)
      const b = scene(r.cx + r.sx / 2, r.cz + r.sz / 2)
      const along = r.sx > r.sz
      this.streets.push({ name: ROAD_NAMES[i] ?? '', width: along ? r.sz : r.sx, kind: 'street', pts: along ? [{ x: a.x, z: (a.z + b.z) / 2 }, { x: b.x, z: (a.z + b.z) / 2 }] : [{ x: (a.x + b.x) / 2, z: a.z }, { x: (a.x + b.x) / 2, z: b.z }] })
    })
    for (const c of CURVES) this.streets.push({ name: c.name, width: c.width, kind: 'street', pts: c.pts.filter((_, i) => i % 3 === 0 || i === c.pts.length - 1).map((p) => scene(p.x, p.z)) })
    this.streets.push({ name: 'County Road', width: 10, kind: 'county', pts: connectorPath(6) })
    this.streets.push({ name: 'Lake Road', width: 8, kind: 'lake', pts: [highwayAt(-250, 0), ...lakeRoadPath(6)] })
    const hw: { x: number; z: number }[] = []
    for (let t = HIGHWAY_END_T; t <= HIGHWAY.reach; t += 8) {
      const p = highwayAt(t, 0)
      if (Math.abs(p.x) > HALF - 6 || Math.abs(p.z) > HALF - 6) continue
      hw.push(p)
    }
    this.streets.push({ name: 'Interstate 39', width: HIGHWAY.halfWidth * 2, kind: 'interstate', pts: hw })
    const trail: { x: number; z: number }[] = []
    for (let a = 0; a <= 360; a += 2) {
      const ang = (a * Math.PI) / 180
      const r = lakeRadius(ang) * 1.42
      trail.push({ x: LAKE_CENTER.x + Math.cos(ang) * r, z: LAKE_CENTER.z + Math.sin(ang) * r })
    }
    this.streets.push({ name: 'Lakeshore trail', width: 3, kind: 'trail', pts: trail })

    for (const b of [...BUILDINGS, ...CIVIC]) this.buildings.push({ pts: townRect(b.x, b.z, b.w, b.d), fill: b.color, name: b.name })
    this.buildings.push({ pts: townRect(GAS_STATION.canopy.x, GAS_STATION.canopy.z, GAS_STATION.canopy.w, GAS_STATION.canopy.d), fill: '#e8e2d2' })
    this.buildings.push({ pts: townRect(GAS_STATION.store.x, GAS_STATION.store.z, GAS_STATION.store.w, GAS_STATION.store.d), fill: '#cfc7b4', name: GAS_STATION.name })
    this.buildings.push({ pts: townRect(DEPOT.x, DEPOT.z, DEPOT.w, DEPOT.d), fill: '#8b8378', name: 'Freight depot' })
    this.buildings.push({ pts: townRect((CASINO.x0 + CASINO.x1) / 2, (CASINO.z0 + CASINO.z1) / 2, CASINO.x1 - CASINO.x0, CASINO.z1 - CASINO.z0), fill: '#7b2c5d', name: CASINO_NAME })
    for (const l of makeLots()) this.lots.push({ id: l.id, lot: l, pts: townRect(l.x + l.w / 2, l.z + l.d / 2, l.w - 0.8, l.d - 0.8) })

    for (const p of ROADSIDE) {
      const r = lotRect(p)
      this.roadsideLots.push({ pts: townRect(r.cx, r.cz, r.sx, r.sz), surface: p.surface })
      const f = placeFrame(p)
      const c = Math.cos(f.yaw)
      const s = Math.sin(f.yaw)
      const corner = (lx: number, lz: number) => scene(f.x + lx * c + lz * s, f.z - lx * s + lz * c)
      const hw2 = p.w / 2
      const hd = p.d / 2
      this.buildings.push({ pts: [corner(-hw2, -hd), corner(hw2, -hd), corner(hw2, hd), corner(-hw2, hd)], fill: `#${p.color.toString(16).padStart(6, '0')}`, name: p.name })
      if (p.kind === 'gas') this.buildings.push({ pts: [corner(-9, hd + 5), corner(9, hd + 5), corner(9, hd + 17), corner(-9, hd + 17)], fill: '#e8e2d2' })
      const door = scene(doorSpot(p).x, doorSpot(p).z)
      const kind: PoiKind = ROADSIDE_KIND[p.kind]
      this.pois.push({ id: p.id, name: p.name, kind, x: door.x, z: door.z, to: door, tier: p.kind === 'cabin' ? 2 : 1, group: 'County Road', note: p.blurb })
    }

    for (const d of SHOP_DOORS) {
      const p = scene(d.x, d.z)
      const kind: PoiKind = d.kind === 'gas' ? 'gas' : 'shop'
      this.pois.push({ id: `shop-${d.id}`, name: d.name, kind, x: p.x, z: p.z, to: p, tier: 2, group: 'Town', note: SHOP_NAMES[d.kind] })
    }
    const casinoDoor = scene(CASINO.door.x, CASINO.z0 - 3)
    this.pois.push({ id: 'casino', name: CASINO_NAME, kind: 'casino', x: casinoDoor.x, z: casinoDoor.z, to: casinoDoor, tier: 1, group: 'Town', note: 'Slots, blackjack and the lodge bar.' })
    for (const b of BUILDINGS) {
      if (b.kind !== 'townhall' && b.kind !== 'library' && b.kind !== 'hotel' && b.kind !== 'cinema') continue
      const p = scene(b.x, b.z)
      this.pois.push({ id: `bld-${b.id}`, name: b.name, kind: b.kind === 'hotel' ? 'hotel' : 'civic', x: p.x, z: p.z, to: p, tier: 2, group: 'Town' })
    }
    for (const b of CIVIC) {
      const p = scene(b.x, b.z)
      this.pois.push({ id: `civic-${b.name}`, name: b.name, kind: 'civic', x: p.x, z: p.z, to: p, tier: 3, group: 'Town' })
    }
    const depot = scene(DEPOT.padX, DEPOT.padZ)
    this.pois.push({ id: 'depot', name: 'Freight depot', kind: 'depot', x: depot.x, z: depot.z, to: depot, tier: 3, group: 'Town' })

    let stand = 0
    let blind = 0
    for (const m of markers) {
      if (m.kind === 'cabin') this.pois.push({ id: 'outfitters', name: 'Fox Outfitters', kind: 'outfitters', x: m.x, z: m.z, to: { x: LAKE_ROAD_APRON.x, z: LAKE_ROAD_APRON.z }, tier: 1, group: 'Lake country', note: 'Gear rack, wardrobe, the catalog and the side-by-side.' })
      else if (m.kind === 'stand') this.pois.push({ id: `stand-${++stand}`, name: `Ladder stand ${stand}`, kind: 'stand', x: m.x, z: m.z, to: { x: m.x, z: m.z }, tier: 3, group: 'Lake country', note: 'Deer $50, bear $100.' })
      else if (m.kind === 'blind') this.pois.push({ id: `blind-${++blind}`, name: `Box blind ${blind}`, kind: 'blind', x: m.x, z: m.z, to: { x: m.x, z: m.z }, tier: 3, group: 'Lake country', note: 'Deer $50, bear $100.' })
      else if (m.kind === 'wildman') this.pois.push({ id: 'wildman', name: m.label ?? "Wild Man's camp", kind: 'camp', x: m.x, z: m.z, to: { x: m.x, z: m.z }, tier: 2, group: 'Lake country', note: 'Carp bowfishing at any hour. Carp pay $10.' })
    }
    if (dock) this.pois.push({ id: 'dock', name: 'Dock and boat', kind: 'dock', x: dock.x, z: dock.z, to: dock, tier: 2, group: 'Lake country', note: 'The boat is moored at the end of the dock.' })
    const bridge = highwayAt(0, 0)
    this.pois.push({ id: 'bridge', name: 'Interstate bridge', kind: 'landmark', x: bridge.x, z: bridge.z, to: bridge, tier: 3, group: 'Lake country', note: 'High enough to take the boat under to the back bay.' })

    const tc = { x: (BUILT_UP.x0 + BUILT_UP.x1) / 2, z: (BUILT_UP.z0 + BUILT_UP.z1) / 2 }
    this.areaLabels.push({ name: 'FOX PLAINS', x: tc.x - 120, z: BUILT_UP.z1 + 40, size: 26, color: '#1d2a1c', halo: 'rgba(235,240,215,.88)', minS: 0, maxS: 1.4 })
    this.areaLabels.push({ name: 'Bear Paw Lake', x: LAKE_CENTER.x, z: LAKE_CENTER.z, size: 22, color: '#123a52', halo: 'rgba(210,232,240,.85)', minS: 0, maxS: 99 })
    this.areaLabels.push({ name: 'Cattail Marsh', x: -122, z: 254, size: 15, color: '#2b3a1f', halo: 'rgba(235,240,220,.8)', minS: 0.25, maxS: 99 })
    this.areaLabels.push({ name: 'Pine Ridge', x: 262, z: -414, size: 15, color: '#1f3420', halo: 'rgba(235,240,220,.8)', minS: 0.25, maxS: 99 })
    this.areaLabels.push({ name: 'Oak Opening', x: -30, z: -422, size: 15, color: '#2b3a1f', halo: 'rgba(235,240,220,.8)', minS: 0.25, maxS: 99 })
    this.areaLabels.push({ name: 'Granite Bluff', x: 440, z: 314, size: 15, color: '#3a3a36', halo: 'rgba(235,240,220,.8)', minS: 0.25, maxS: 99 })
    this.areaLabels.push({ name: 'Back Bay', x: 205, z: 262, size: 14, color: '#123a52', halo: 'rgba(210,232,240,.85)', minS: 0.4, maxS: 99 })
    this.areaLabels.push({ name: 'Fox Lake Woods', x: -760, z: 700, size: 16, color: '#e8eedb', halo: 'rgba(20,34,22,.7)', minS: 0.2, maxS: 99 })
    this.areaLabels.push({ name: 'Downtown', x: scene(300, 0).x + 30, z: scene(300, 0).z + 70, size: 15, color: '#3a2a1a', halo: 'rgba(245,238,220,.85)', minS: 0.45, maxS: 99 })
  }

  // ------------------------------------------------------------ raster

  private heightAt(x: number, z: number): number {
    if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) return this.terrain.heightAt(x, z)
    return outsideHeight(x, z)
  }

  private async paint(): Promise<void> {
    const g = this.base.getContext('2d')!
    const heights = new Float32Array(COLS * ROWS)
    const slice = 48
    for (let j0 = 0; j0 < ROWS; j0 += slice) {
      for (let j = j0; j < Math.min(ROWS, j0 + slice); j++) {
        const z = ATLAS.z1 - (j + 0.5) * ATLAS.m
        for (let i = 0; i < COLS; i++) heights[j * COLS + i] = this.heightAt(ATLAS.x0 + (i + 0.5) * ATLAS.m, z)
      }
      this.progress = (j0 / ROWS) * 0.3
      await frame()
    }
    for (let j0 = 0; j0 < ROWS; j0 += slice / 2) {
      const rows = Math.min(slice / 2, ROWS - j0)
      const img = g.createImageData(COLS, rows)
      for (let r = 0; r < rows; r++) {
        const j = j0 + r
        const z = ATLAS.z1 - (j + 0.5) * ATLAS.m
        for (let i = 0; i < COLS; i++) {
          const x = ATLAS.x0 + (i + 0.5) * ATLAS.m
          const c = this.pixel(heights, i, j, x, z)
          const o = (r * COLS + i) * 4
          img.data[o] = c[0]
          img.data[o + 1] = c[1]
          img.data[o + 2] = c[2]
          img.data[o + 3] = 255
        }
      }
      g.putImageData(img, 0, j0)
      this.progress = 0.3 + (j0 / ROWS) * 0.7
      await frame()
    }
    this.progress = 1
  }

  private pixel(heights: Float32Array, i: number, j: number, x: number, z: number): number[] {
    const k = j * COLS + i
    const h = heights[k]
    const hl = heights[j * COLS + Math.max(0, i - 1)]
    const hr = heights[j * COLS + Math.min(COLS - 1, i + 1)]
    const hu = heights[Math.max(0, j - 1) * COLS + i]
    const hd = heights[Math.min(ROWS - 1, j + 1) * COLS + i]
    const inSquare = Math.abs(x) <= HALF && Math.abs(z) <= HALF
    const inTown = inTownSquare(x, z, -24) || (z > HALF - 2 && z < TOWN_SQUARE.z0 + 2 && Math.abs(x) < PLAY_LIMIT)
    const playable = (inSquare && Math.abs(x) < PLAY_LIMIT + 8 && Math.abs(z) < PLAY_LIMIT + 8) || inTown || (z > HALF - 40 && z <= HALF && Math.abs(x) < PLAY_LIMIT)
    let c: number[]
    if (inSquare && h < WATER_LEVEL - 0.35) {
      const d = Math.min(1, (WATER_LEVEL - h) / 9)
      c = mix(PAL.water0, PAL.water1, Math.pow(d, 0.8))
      const ripple = fbm(x * 0.08, z * 0.08, 2, 7) * 6
      c = [c[0] + ripple, c[1] + ripple, c[2] + ripple]
      if (Math.min(hl, hr, hu, hd) >= WATER_LEVEL - 0.35 || Math.max(hl, hr, hu, hd) >= WATER_LEVEL - 0.35) c = mix(c, [226, 240, 246], 0.5)
      return c
    }
    let woods = 0
    if (inSquare) {
      const f = forestDensity(x, z)
      woods = f
      const { s, angle } = lakeCoord(x, z)
      c = mix(PAL.meadow, PAL.dry, fbm(x * 0.012, z * 0.012, 3, 41) + 0.4)
      c = mix(c, PAL.forest, Math.min(1, f * 1.4))
      c = mix(c, PAL.marsh, marshWeight(angle) * (s < 1.9 ? 1 : 0) * (h < 1.4 ? 1 : 0))
      if (h < 0.9) c = mix(c, PAL.shore, 0.55)
      const slope = Math.hypot(hr - hl, hd - hu) / (4 * ATLAS.m)
      c = mix(c, PAL.rock, Math.min(1, Math.max(0, (slope - 0.45) * 3)))
    } else {
      const t = sceneToTown(x, 0, z)
      const tw = woodsAt(t.x, t.z)
      const built = x > BUILT_UP.x0 && x < BUILT_UP.x1 && z > BUILT_UP.z0 && z < BUILT_UP.z1
      woods = built ? 0 : tw * (0.55 + 0.6 * (fbm(x * 0.0065 + 11, z * 0.0065 - 4, 3, 21) * 0.5 + 0.5))
      c = built ? PAL.lawn : mix(PAL.meadow, PAL.dry, fbm(x * 0.012, z * 0.012, 3, 41) + 0.4)
      c = mix(c, PAL.forest, Math.min(1, woods * 1.3))
    }
    if (woods > 0.35) {
      const n = hash(Math.floor(x / 4), Math.floor(z / 4))
      const dx = (x / 4) % 1
      const dz = (z / 4) % 1
      if (n > 0.35 && Math.hypot((dx < 0 ? dx + 1 : dx) - 0.5, (dz < 0 ? dz + 1 : dz) - 0.5) < 0.38) c = mix(c, PAL.forestDark, 0.55)
    }
    const shade = 1 + ((hl - hr) * 0.55 + (hu - hd) * 0.55) * 0.22
    c = c.map((v) => v * Math.max(0.68, Math.min(1.28, shade)))
    const level = (v: number) => Math.floor((v + 1) / 2)
    const major = (v: number) => Math.floor((v + 1) / 10)
    if (level(hr) !== level(h) || level(hd) !== level(h)) c = c.map((v) => v * (major(hr) !== major(h) || major(hd) !== major(h) ? 0.78 : 0.9))
    if (!playable) c = mix(c, PAL.beyond, 0.55)
    return c
  }

  // ------------------------------------------------------------ drawing

  /** Draws the map for `view` into `g` (which is `view.W` x `view.H` device pixels). `mini` thins out labels. */
  draw(g: CanvasRenderingContext2D, view: View, opts: { mini?: boolean; route?: RouteLine | null; lots?: (lot: LotDef) => 'mine' | 'owned' | 'sale' | null; dpr?: number; hover?: Poi | null; markers?: MapMarker[] } = {}): void {
    const { W, H, s } = view
    const dpr = opts.dpr ?? 1
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = `rgb(${PAL.beyond.join(',')})`
    g.fillRect(0, 0, W, H)
    g.translate(W / 2, H / 2)
    g.rotate(view.rot)
    g.scale(s, s)
    g.translate(-view.cx, view.cz)
    const reach = Math.hypot(W, H) / 2 / s + 20
    const vis: Rect = { x0: view.cx - reach, x1: view.cx + reach, z0: view.cz - reach, z1: view.cz + reach }
    this.drawBase(g, vis)
    const px = 1 / s
    this.drawLots(g, vis, px, opts.lots)
    this.drawStreets(g, vis, px, s)
    this.drawBuildings(g, vis, px)
    if (opts.route) this.drawRoute(g, opts.route, px)
    g.restore()
    const P = (x: number, z: number) => screen(view, x, z)
    this.drawLabels(g, view, P, dpr, !!opts.mini)
    this.drawPois(g, view, P, dpr, !!opts.mini, opts.hover ?? null)
    if (opts.markers) this.drawMarkers(g, view, P, dpr, opts.markers)
    if (opts.route) {
      const [gx, gy] = P(opts.route.goal.x, opts.route.goal.z)
      const pad = 12 * dpr
      const cx = Math.min(W - pad, Math.max(pad, gx))
      const cy = Math.min(H - pad, Math.max(pad, gy))
      g.fillStyle = '#ff5a4f'
      g.strokeStyle = '#fff'
      g.lineWidth = 2 * dpr
      g.beginPath()
      g.arc(cx, cy, 6.5 * dpr, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    }
  }

  private drawBase(g: CanvasRenderingContext2D, vis: Rect): void {
    const x0 = Math.max(ATLAS.x0, vis.x0)
    const x1 = Math.min(ATLAS.x1, vis.x1)
    const z0 = Math.max(ATLAS.z0, vis.z0)
    const z1 = Math.min(ATLAS.z1, vis.z1)
    if (x1 <= x0 || z1 <= z0) return
    const sx = (x0 - ATLAS.x0) / ATLAS.m
    const sy = (ATLAS.z1 - z1) / ATLAS.m
    const sw = (x1 - x0) / ATLAS.m
    const sh = (z1 - z0) / ATLAS.m
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(this.base, sx, sy, sw, sh, x0, -z1, x1 - x0, z1 - z0)
  }

  private poly(g: CanvasRenderingContext2D, pts: { x: number; z: number }[], close: boolean): void {
    g.beginPath()
    for (let i = 0; i < pts.length; i++) {
      if (i) g.lineTo(pts[i].x, -pts[i].z)
      else g.moveTo(pts[i].x, -pts[i].z)
    }
    if (close) g.closePath()
  }

  private drawLots(g: CanvasRenderingContext2D, vis: Rect, px: number, owner?: (lot: LotDef) => 'mine' | 'owned' | 'sale' | null): void {
    for (const l of this.roadsideLots) {
      if (!within(l.pts, vis)) continue
      this.poly(g, l.pts, true)
      g.fillStyle = l.surface === 'gravel' ? '#b9ab90' : '#6b6d70'
      g.fill()
    }
    if (px > 2.2) return
    for (const l of this.lots) {
      if (!within(l.pts, vis)) continue
      const state = owner?.(l.lot) ?? null
      this.poly(g, l.pts, true)
      g.fillStyle = state === 'mine' ? 'rgba(255,211,77,.55)' : state === 'owned' ? 'rgba(190,170,140,.55)' : 'rgba(170,205,130,.5)'
      g.fill()
      g.lineWidth = px
      g.strokeStyle = 'rgba(60,80,40,.55)'
      g.stroke()
      if (state === 'mine' || state === 'owned') {
        const c = centroid(l.pts)
        g.fillStyle = state === 'mine' ? '#c99a1d' : '#9b8466'
        g.fillRect(c.x - 5, -c.z - 4, 10, 8)
      }
    }
  }

  private drawStreets(g: CanvasRenderingContext2D, vis: Rect, px: number, s: number): void {
    g.lineCap = 'round'
    g.lineJoin = 'round'
    const order: Street['kind'][] = ['trail', 'interstate', 'county', 'lake', 'street']
    for (const kind of order) {
      for (const st of this.streets) {
        if (st.kind !== kind || !within(st.pts, vis)) continue
        if (kind === 'trail') {
          this.poly(g, st.pts, false)
          g.setLineDash([6 * px, 5 * px])
          g.strokeStyle = 'rgba(150,104,60,.9)'
          g.lineWidth = Math.max(2.2 * px, st.width)
          g.stroke()
          g.setLineDash([])
          continue
        }
        const casing = kind === 'interstate' ? '#2a2c30' : '#3c3a36'
        const fill = kind === 'interstate' ? '#5a5d63' : kind === 'street' ? '#77787c' : '#66686d'
        this.poly(g, st.pts, false)
        g.strokeStyle = casing
        g.lineWidth = Math.max(4 * px, st.width + 2.2 * px)
        g.stroke()
        this.poly(g, st.pts, false)
        g.strokeStyle = fill
        g.lineWidth = Math.max(2.6 * px, st.width)
        g.stroke()
        if (s > 0.55) {
          this.poly(g, st.pts, false)
          g.strokeStyle = kind === 'interstate' ? 'rgba(220,214,190,.85)' : 'rgba(232,198,90,.85)'
          g.lineWidth = Math.max(0.5 * px, kind === 'interstate' ? 0.6 : 0.3)
          if (kind !== 'interstate') g.setLineDash([3, 3])
          g.stroke()
          g.setLineDash([])
        }
      }
    }
    const a = LAKE_ROAD_APRON
    g.beginPath()
    g.arc(a.x, -a.z, a.r, 0, Math.PI * 2)
    g.fillStyle = '#66686d'
    g.fill()
    const b0 = highwayAt(-HIGHWAY.span / 2, 0)
    const b1 = highwayAt(HIGHWAY.span / 2, 0)
    g.beginPath()
    g.moveTo(b0.x, -b0.z)
    g.lineTo(b1.x, -b1.z)
    g.lineCap = 'butt'
    g.strokeStyle = '#d7d2c6'
    g.lineWidth = HIGHWAY.halfWidth * 2 + 5
    g.stroke()
    g.strokeStyle = '#5a5d63'
    g.lineWidth = HIGHWAY.halfWidth * 2
    g.stroke()
    const e0 = highwayAt(HIGHWAY_END_T, -HIGHWAY.halfWidth - 1)
    const e1 = highwayAt(HIGHWAY_END_T, HIGHWAY.halfWidth + 1)
    g.beginPath()
    g.moveTo(e0.x, -e0.z)
    g.lineTo(e1.x, -e1.z)
    g.strokeStyle = '#f26a1b'
    g.lineWidth = Math.max(2 * px, 2)
    g.stroke()
  }

  private drawBuildings(g: CanvasRenderingContext2D, vis: Rect, px: number): void {
    for (const b of this.buildings) {
      if (!within(b.pts, vis)) continue
      this.poly(g, b.pts, true)
      g.fillStyle = 'rgba(0,0,0,.25)'
      g.save()
      g.translate(1.2, 1.2)
      g.fill()
      g.restore()
      this.poly(g, b.pts, true)
      g.fillStyle = b.fill
      g.fill()
      g.lineWidth = px
      g.strokeStyle = 'rgba(25,20,15,.7)'
      g.stroke()
    }
  }

  private drawRoute(g: CanvasRenderingContext2D, route: RouteLine, px: number): void {
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const [w, color] of [[8, 'rgba(10,30,60,.75)'], [4.6, '#3fa9ff']] as const) {
      this.poly(g, route.points, false)
      g.strokeStyle = color
      g.lineWidth = w * px
      g.stroke()
    }
  }

  private label(g: CanvasRenderingContext2D, text: string, x: number, y: number, o: { size: number; weight?: number; color?: string; halo?: string; italic?: boolean; rot?: number; align?: CanvasTextAlign }): void {
    g.save()
    g.translate(x, y)
    if (o.rot) g.rotate(o.rot)
    g.font = `${o.italic ? 'italic ' : ''}${o.weight ?? 700} ${Math.round(o.size)}px Inter, system-ui, sans-serif`
    g.textAlign = o.align ?? 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.lineWidth = Math.max(2.5, o.size * 0.26)
    g.strokeStyle = o.halo ?? 'rgba(250,248,238,.92)'
    g.strokeText(text, 0, 0)
    g.fillStyle = o.color ?? '#1d2721'
    g.fillText(text, 0, 0)
    g.restore()
  }

  private drawLabels(g: CanvasRenderingContext2D, view: View, P: (x: number, z: number) => [number, number], dpr: number, mini: boolean): void {
    const { s, W, H } = view
    for (const a of this.areaLabels) {
      if (s < a.minS || s > a.maxS) continue
      const [x, y] = P(a.x, a.z)
      if (x < -200 || y < -50 || x > W + 200 || y > H + 50) continue
      const size = (mini ? a.size * 0.62 : a.size * Math.min(1.35, Math.max(0.75, Math.sqrt(s * 1.6)))) * dpr
      this.label(g, a.name, x, y, { size, color: a.color, halo: a.halo, italic: a.name !== 'FOX PLAINS' && a.name !== 'Downtown' })
    }
    if (s < (mini ? 0.9 : 0.42)) return
    const seen = new Set<string>()
    for (const st of this.streets) {
      if (!st.name || seen.has(st.name) || st.kind === 'trail') continue
      const pts = st.pts
      let best = -1
      let bestD = Infinity
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = P(pts[i].x, pts[i].z)
        const [bx, by] = P(pts[i + 1].x, pts[i + 1].z)
        const mx = (ax + bx) / 2
        const my = (ay + by) / 2
        if (mx < 30 || my < 20 || mx > W - 30 || my > H - 20) continue
        const d = Math.hypot(mx - W / 2, my - H / 2)
        if (d < bestD && Math.hypot(bx - ax, by - ay) > 2) {
          bestD = d
          best = i
        }
      }
      if (best < 0) continue
      const [ax, ay] = P(pts[best].x, pts[best].z)
      const [bx, by] = P(pts[best + 1].x, pts[best + 1].z)
      let rot = Math.atan2(by - ay, bx - ax)
      if (rot > Math.PI / 2) rot -= Math.PI
      if (rot < -Math.PI / 2) rot += Math.PI
      seen.add(st.name)
      const size = (mini ? 10 : st.kind === 'interstate' ? 13 : 11.5) * dpr
      this.label(g, st.kind === 'street' ? st.name : st.name.toUpperCase(), (ax + bx) / 2, (ay + by) / 2, { size, weight: 700, rot, color: '#f6f3e8', halo: 'rgba(32,34,38,.88)' })
    }
  }

  private drawPois(g: CanvasRenderingContext2D, view: View, P: (x: number, z: number) => [number, number], dpr: number, mini: boolean, hover: Poi | null): void {
    const { s, W, H } = view
    const tier = mini ? (s > 2.4 ? 3 : s > 1.1 ? 2 : 1) : s > 2.2 ? 3 : s > 0.5 ? 2 : 1
    for (const p of this.pois) {
      if (p.tier > tier + (mini ? 0 : 1)) continue
      const [x, y] = P(p.x, p.z)
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue
      const r = (mini ? 7 : p.tier === 1 ? 10 : 8) * dpr
      const icon = ICON[p.kind]
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fillStyle = icon.color
      g.fill()
      g.lineWidth = (hover === p ? 3 : 2) * dpr
      g.strokeStyle = hover === p ? '#ffd34d' : '#fbfaf3'
      g.stroke()
      g.fillStyle = '#ffffff'
      g.font = `700 ${Math.round(r * 1.1)}px Inter, system-ui, "Segoe UI Emoji", sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(icon.glyph, x, y + 0.5 * dpr)
      if (p.tier <= tier) this.label(g, p.name, x + r + 4 * dpr, y, { size: (mini ? 10 : p.tier === 1 ? 13.5 : 12) * dpr, weight: 700, align: 'left', color: '#20180f' })
    }
  }

  private drawMarkers(g: CanvasRenderingContext2D, view: View, P: (x: number, z: number) => [number, number], dpr: number, markers: MapMarker[]): void {
    const { W, H } = view
    for (const m of markers) {
      if (m.kind === 'cabin' || m.kind === 'stand' || m.kind === 'blind' || m.kind === 'wildman') continue
      const [x, y] = P(m.x, m.z)
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue
      g.lineWidth = 2 * dpr
      g.strokeStyle = 'rgba(10,10,8,.85)'
      if (m.kind === 'friend') {
        g.fillStyle = '#7fd0ff'
        g.beginPath()
        g.arc(x, y, 6 * dpr, 0, Math.PI * 2)
        g.stroke()
        g.fill()
        if (m.label) this.label(g, m.label, x + 9 * dpr, y, { size: 11 * dpr, align: 'left', color: '#e9f6ff', halo: 'rgba(10,20,30,.85)' })
      } else if (m.kind === 'down') {
        g.strokeStyle = '#ffd36b'
        g.lineWidth = 3 * dpr
        g.beginPath()
        g.moveTo(x - 6 * dpr, y - 6 * dpr)
        g.lineTo(x + 6 * dpr, y + 6 * dpr)
        g.moveTo(x + 6 * dpr, y - 6 * dpr)
        g.lineTo(x - 6 * dpr, y + 6 * dpr)
        g.stroke()
      } else {
        g.fillStyle = m.kind === 'boat' ? '#d9473a' : m.kind === 'dock' ? '#a07a50' : '#8fc46a'
        g.beginPath()
        g.rect(x - 5 * dpr, y - 5 * dpr, 10 * dpr, 10 * dpr)
        g.stroke()
        g.fill()
      }
    }
  }

  /** The place under a screen point (within 14 px), for clicks and hover. */
  poiAt(view: View, px: number, py: number, dpr: number): Poi | null {
    let best: Poi | null = null
    let bd = 14 * dpr
    for (const p of this.pois) {
      const [x, y] = screen(view, p.x, p.z)
      const d = Math.hypot(x - px, y - py)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }
}

const ROADSIDE_KIND: Record<RoadsideKind, PoiKind> = { cabin: 'cabin', gas: 'gas', motel: 'motel', bar: 'bar' }

/** Scene point to canvas pixels for `view`. */
export function screen(view: View, x: number, z: number): [number, number] {
  const dx = (x - view.cx) * view.s
  const dy = -(z - view.cz) * view.s
  const c = Math.cos(view.rot)
  const sn = Math.sin(view.rot)
  return [view.W / 2 + dx * c - dy * sn, view.H / 2 + dx * sn + dy * c]
}

/** Canvas pixels to a scene point for `view`. */
export function unscreen(view: View, px: number, py: number): { x: number; z: number } {
  const dx = px - view.W / 2
  const dy = py - view.H / 2
  const c = Math.cos(-view.rot)
  const sn = Math.sin(-view.rot)
  const rx = dx * c - dy * sn
  const ry = dx * sn + dy * c
  return { x: view.cx + rx / view.s, z: view.cz - ry / view.s }
}

function within(pts: { x: number; z: number }[], r: Rect): boolean {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.x > x1) x1 = p.x
    if (p.z < z0) z0 = p.z
    if (p.z > z1) z1 = p.z
  }
  return x1 >= r.x0 && x0 <= r.x1 && z1 >= r.z0 && z0 <= r.z1
}

function centroid(pts: { x: number; z: number }[]): { x: number; z: number } {
  let x = 0
  let z = 0
  for (const p of pts) {
    x += p.x
    z += p.z
  }
  return { x: x / pts.length, z: z / pts.length }
}

function frame(): Promise<void> {
  return new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)))
}
