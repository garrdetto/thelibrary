/**
 * Tello's map files, as baked from Montello, Wisconsin by `tools/bake_map.py`:
 * `montello.bin` (grids 4 m apart, the pavement distance field 2 m apart, the
 * trees) and `montello.json` (roads, bridges, buildings, lots, places).
 * Renderer-free, so the tests read the same files the page does.
 *
 * Map coordinates: x east and z north, metres from the origin near City Hall
 * (UTM zone 16N), y metres above `frame.base`.
 */
import type { WorldExtras } from '../edits/WorldEdits'

export interface Frame {
  lon: number
  lat: number
  utmZone: number
  utmE: number
  utmN: number
  x0: number
  z0: number
  size: number
  cell: number
  fine: number
  base: number
  /** Trees' positions in the grid file are in 1/`treeUnits` metres from the frame's south-west corner (decimetres, 10, in files baked before the three-mile frame). */
  treeUnits?: number
}

/** 0 highway (lined), 1 street, 2 lane (driveways, aisles), 3 gravel, 4 walk (concrete), 5 trail (dirt). */
export type RoadKind = 0 | 1 | 2 | 3 | 4 | 5
/** `id`: set at load for the World Editor's edits (`r<index>`, or the edit that added it). */
export interface RoadData { k: RoadKind; w: number; n: string; c: string; p: number[]; id?: string }
/** `y` the deck height; `m` set when it was measured in the lidar point cloud; `s` a town bridge with stone parapets (set at load). */
export interface BridgeData { r: number; k: RoadKind; w: number; y: number; p: number[]; m?: 1; s?: 1 }
export type BuildingKind = 'house' | 'garage' | 'shed' | 'store' | 'industrial' | 'civic' | 'church' | 'canopy'
/**
 * `p` the footprint ring; `f` floor height; `l` lowest ground at the walls; `h` the main block's eave above the floor;
 * `m` set when the roof was measured in the lidar point cloud. `r` the rectangles the footprint is covered with, for
 * roofs and colliders: centre x, centre z, half size along its first axis, half size along its second, yaw of the
 * first axis, roof type (see `ROOF`), eave and ridge in metres above the floor.
 */
/** `x`: removed at load (`REMOVED_BUILDINGS`): nothing stands there, so it is never built, solid or in a road's way. */
export interface BuildingData { k: BuildingKind; h: number; f: number; l: number; s: number; p: number[]; r: number[][]; n?: string; m?: 1; rc?: string; x?: 1; id?: string }
/** Roof types: a gable's ridge runs along the rectangle's first or second axis; a shed's high side is toward the named axis. */
export const ROOF = { unmeasured: -1, flat: 0, gableFirst: 1, gableSecond: 2, hip: 3, shedPlusSecond: 4, shedMinusSecond: 5, shedPlusFirst: 6, shedMinusFirst: 7 } as const
/** `ns`: no stalls painted (a World Editor choice). */
export interface LotData { f: number; p: number[]; n?: string; ns?: 1; id?: string }
export interface Poi { n: string; k: string; /** The place's own OpenStreetMap type: its amenity, shop or man-made value. */ t?: string; x: number; z: number; /** The street its door faces. */ s?: string; /** Fuel pumps: x, z pairs under the canopy. */ pumps?: [number, number][]; /** The front door: x, z and the way it faces. */ d?: [number, number, number] }
/** A road leaving the playable area: where it crosses the edge and the way out (heading, 0 = north). */
export interface RoadExit { x: number; z: number; h: number; w: number }
/**
 * Only the City of Montello is built. `city` is its boundary, `play` the area you may walk and drive (the limits
 * widened by `pad`, three miles), and the
 * ground, water and woods are drawn `seen` metres past that.
 */
export interface Limits { city: number[]; play: number[]; exits: RoadExit[]; link: number[]; pad: number; seen: number }

export interface MapDoc {
  version: number
  name: string
  frame: Frame
  roads: RoadData[]
  bridges: BridgeData[]
  buildings: BuildingData[]
  lots: LotData[]
  pois: Poi[]
  /** Ball diamonds, fields and courts mapped in OpenStreetMap: sport, name and outline (x, z pairs). */
  pitches?: { s: string; n: string; p: number[] }[]
  /** Boat launches. */
  slipways?: { n: string; x: number; z: number }[]
  /** Golf courses laid out hole by hole (`tools/bake_golf.py`). */
  golf?: GolfCourseData[]
  limits: Limits
  sources: string[]
  stats: Record<string, unknown>
  /** Rails, lights and walls the World Editor's edits add, and the automatic ones they take down (set by `applyWorldEdits`). */
  extras?: WorldExtras
  /**
   * Set on a map baked ahead for a host (Fox Lake's `lake/MapPack.ts`): `streets` when the street fixes (`fixStreets`) already
   * ran on it.
   */
  prepared?: { streets: 1 }
}

/**
 * A hole: `n` its number, `par`, `len` metres along `line` (x, z pairs from the tee to the green), `tee` (x, z and the
 * heading toward the green, 0 = north), `box` the tee box, `green` its outline, `pin` the cup, `fw` the fairway outlines.
 */
export interface GolfHoleData { n: number; par: number; len: number; line: number[]; tee: [number, number, number]; box: number[]; green: number[]; pin: [number, number]; fw: number[][] }
/** A course: `n` name, `p` outline, `c` the clubhouse, its holes in playing order and the sand bunkers' outlines. */
export interface GolfCourseData { n: string; p: number[]; c: [number, number]; holes: GolfHoleData[]; bunkers: number[][] }

/** Roads of this class are driveways the bake read off the aerial photo: never a building's street. */
export const DRIVEWAY_CLASS = 'driveway'

/** 0 meadow, 1 lawn, 2 woods, 3 marsh, 4 bare, 5 lot, 6 field, 7 water. */
export const COVER = { meadow: 0, lawn: 1, woods: 2, marsh: 3, bare: 4, lot: 5, field: 6, water: 7 } as const

export interface MapGrids {
  /** Nodes a side of the 4 m grids. */
  side: number
  /** Nodes a side of the 2 m pavement field. */
  fineSide: number
  /** Ground height, centimetres above the base (river and lake beds under water). */
  ground: Uint16Array
  /** Water surface, centimetres above the base, on and just around water; 0 elsewhere. */
  water: Uint16Array
  cover: Uint8Array
  /** 0 lush to 255 dry, from the aerial photo. */
  tone: Uint8Array
  /** Share of each node under tree crowns, 0..255. */
  canopy: Uint8Array
  /** Signed distance to pavement and walls in quarter metres (negative on them), 2 m apart. */
  clear: Int8Array
  /** Trees, one per crown in the lidar: position in decimetres from the map's south-west corner, kind (top two bits of `treeS`: 0 pine, 1 hardwood, 2 birch) and height in quarter metres. */
  treeX: Uint16Array
  treeZ: Uint16Array
  treeS: Uint8Array
  treeH: Uint8Array
  /** Signed distance to the playable area's edge in 2 m steps (positive inside), on the 4 m grid. */
  play: Int8Array
}

/**
 * `filter` (maps baked ahead only) says how the values were stored for a smaller download: `left` each value less the one
 * before it in its row, `up` less the one above it, `grad` less left + up - up-left; all wrap at the type's width.
 */
interface Section { name: string; type: 'u16' | 'i16' | 'u8' | 'i8'; side: number; count: number; offset: number; bytes: number; filter?: SectionFilter }

export type SectionFilter = 'left' | 'up' | 'grad'
type Grid = Uint16Array | Int16Array | Uint8Array | Int8Array

const MAGIC = [0x54, 0x45, 0x4c, 0x4c, 0x4f, 0x01]

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/** Reads the (already unpacked) grid file. */
export function parseGrids(bytes: Uint8Array): MapGrids {
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) throw new Error('Not a Tello map file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headLen = view.getUint32(MAGIC.length, true)
  const headAt = MAGIC.length + 4
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(headAt, headAt + headLen))) as { sections: Section[] }
  const base = headAt + headLen
  const out: Record<string, Grid> = {}
  let side = 0
  let fineSide = 0
  for (const s of header.sections) {
    const from = base + s.offset
    let grid: Grid
    if (s.type === 'u16' || s.type === 'i16') {
      const aligned = (bytes.byteOffset + from) % 2 === 0
      const buffer = aligned ? bytes.buffer : bytes.slice(from, from + s.bytes).buffer
      const at = aligned ? bytes.byteOffset + from : 0
      grid = s.type === 'u16' ? new Uint16Array(buffer, at, s.count) : new Int16Array(buffer, at, s.count)
    } else if (s.type === 'i8') grid = new Int8Array(bytes.buffer, bytes.byteOffset + from, s.count)
    else grid = bytes.subarray(from, from + s.bytes)
    if (s.filter) unfilter(grid, s.side || s.count, s.filter)
    out[s.name] = grid
    if (s.name === 'ground') side = s.side
    if (s.name === 'clear') fineSide = s.side
  }
  for (const name of ['ground', 'water', 'cover', 'tone', 'canopy', 'clear', 'treeX', 'treeZ', 'treeS', 'treeH', 'play']) if (!out[name]) throw new Error(`Tello map file has no ${name}`)
  return { side, fineSide, ground: out.ground as Uint16Array, water: out.water as Uint16Array, cover: out.cover as Uint8Array, tone: out.tone as Uint8Array, canopy: out.canopy as Uint8Array, clear: out.clear as Int8Array, treeX: out.treeX as Uint16Array, treeZ: out.treeZ as Uint16Array, treeS: out.treeS as Uint8Array, treeH: out.treeH as Uint8Array, play: out.play as Int8Array }
}

/** Undoes `filterGrid` in place; the typed array wraps each sum at its own width, as the filter did. */
function unfilter(a: Grid, side: number, filter: SectionFilter): void {
  const n = a.length
  if (filter === 'left') {
    for (let row = 0; row < n; row += side) {
      const end = Math.min(n, row + side)
      for (let i = row + 1; i < end; i++) a[i] += a[i - 1]
    }
  } else if (filter === 'up') {
    for (let i = side; i < n; i++) a[i] += a[i - side]
  } else {
    for (let i = 1; i < side && i < n; i++) a[i] += a[i - 1]
    for (let row = side; row < n; row += side) {
      a[row] += a[row - side]
      const end = Math.min(n, row + side)
      for (let i = row + 1; i < end; i++) a[i] += a[i - 1] + a[i - side] - a[i - side - 1]
    }
  }
}

/** Stores a grid as differences from its neighbours (see `Section.filter`) in a new array; `parseGrids` restores it. */
export function filterGrid<T extends Grid>(a: T, side: number, filter: SectionFilter): T {
  const o = a.slice() as T
  const n = a.length
  if (filter === 'left') {
    for (let i = 0; i < n; i++) if (i % side) o[i] = a[i] - a[i - 1]
  } else if (filter === 'up') {
    for (let i = side; i < n; i++) o[i] = a[i] - a[i - side]
  } else {
    for (let i = 1; i < side && i < n; i++) o[i] = a[i] - a[i - 1]
    for (let row = side; row < n; row += side) {
      o[row] = a[row] - a[row - side]
      const end = Math.min(n, row + side)
      for (let i = row + 1; i < end; i++) o[i] = a[i] - (a[i - 1] + a[i - side] - a[i - side - 1])
    }
  }
  return o
}

export interface GridSection { name: string; type: Section['type']; side: number; data: Grid; filter?: SectionFilter }

/** Writes a grid file `parseGrids` reads: the magic, the header's length and JSON, then every section 4-byte aligned. */
export function writeGrids(sections: GridSection[]): Uint8Array {
  const meta: Section[] = []
  let offset = 0
  for (const s of sections) {
    meta.push({ name: s.name, type: s.type, side: s.side, count: s.data.length, offset, bytes: s.data.byteLength, ...(s.filter ? { filter: s.filter } : {}) })
    offset += Math.ceil(s.data.byteLength / 4) * 4
  }
  const json = JSON.stringify({ sections: meta })
  const pad = (4 - ((MAGIC.length + 4 + json.length) % 4)) % 4
  const head = new TextEncoder().encode(json + ' '.repeat(pad))
  const base = MAGIC.length + 4 + head.length
  const out = new Uint8Array(base + offset)
  out.set(MAGIC, 0)
  new DataView(out.buffer).setUint32(MAGIC.length, head.length, true)
  out.set(head, MAGIC.length + 4)
  sections.forEach((s, k) => out.set(new Uint8Array(s.data.buffer, s.data.byteOffset, s.data.byteLength), base + meta[k].offset))
  return out
}

/**
 * Unpacks a gzip file straight into one buffer of its final size (the gzip trailer holds it), so a 200 MB map never has
 * the decompressed chunks and a joined copy of them in memory at the same time.
 */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const n = bytes.length
  const size = (bytes[n - 4] | (bytes[n - 3] << 8) | (bytes[n - 2] << 16) | (bytes[n - 1] << 24)) >>> 0
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  let out = new Uint8Array(size)
  let at = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (at + value.length > out.length) {
      const grown = new Uint8Array(Math.max(out.length * 2, at + value.length))
      grown.set(out.subarray(0, at))
      out = grown
    }
    out.set(value, at)
    at += value.length
  }
  return at === out.length ? out : out.subarray(0, at)
}

/** Loads both map files from `base` (the page's `tello/` folder), or the two named files there. A host that already unpacked the grid file is handled too. */
export async function loadMap(base: string, files = { doc: 'montello.json', grids: 'montello.bin' }): Promise<{ doc: MapDoc; grids: MapGrids }> {
  const [docRes, binRes] = await Promise.all([fetch(`${base}${files.doc}`), fetch(`${base}${files.grids}`)])
  if (!docRes.ok || !binRes.ok) throw new Error('The Montello map could not be loaded')
  const [doc, packed] = await Promise.all([docRes.json() as Promise<MapDoc>, binRes.arrayBuffer()])
  let bytes: Uint8Array = new Uint8Array(packed)
  if (isGzip(bytes)) bytes = await gunzip(bytes)
  return { doc, grids: parseGrids(bytes) }
}

/** Trees' position units per metre in the grid file (see `Frame.treeUnits`). */
export function treeUnits(frame: Frame): number {
  return frame.treeUnits ?? 10
}
