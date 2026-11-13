/**
 * Tello's map files, as baked from Montello, Wisconsin by `tools/bake_map.py`:
 * `montello.bin` (grids 4 m apart, the pavement distance field 2 m apart, the
 * trees) and `montello.json` (roads, bridges, buildings, lots, places).
 * Renderer-free, so the tests read the same files the page does.
 *
 * Map coordinates: x east and z north, metres from the origin near City Hall
 * (UTM zone 16N), y metres above `frame.base`.
 */
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
}

/** 0 highway (lined), 1 street, 2 lane (driveways, aisles), 3 gravel, 4 walk (concrete), 5 trail (dirt). */
export type RoadKind = 0 | 1 | 2 | 3 | 4 | 5
export interface RoadData { k: RoadKind; w: number; n: string; c: string; p: number[] }
export interface BridgeData { r: number; k: RoadKind; w: number; y: number; p: number[] }
export type BuildingKind = 'house' | 'garage' | 'shed' | 'store' | 'industrial' | 'civic' | 'church' | 'canopy'
/** `p` the footprint ring, `r` rectangles (cx, cz, half length, half width, yaw) for roofs and colliders, `f` floor height, `l` lowest ground at the walls, `h` wall height. */
export interface BuildingData { k: BuildingKind; h: number; f: number; l: number; s: number; p: number[]; r: number[][]; n?: string }
export interface LotData { f: number; p: number[] }
export interface Poi { n: string; k: string; x: number; z: number }

export interface MapDoc {
  version: number
  name: string
  frame: Frame
  roads: RoadData[]
  bridges: BridgeData[]
  buildings: BuildingData[]
  lots: LotData[]
  pois: Poi[]
  sources: string[]
  stats: Record<string, unknown>
}

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
  /** Trees: position in decimetres from the map's south-west corner, and kind (top two bits: 0 pine, 1 hardwood, 2 birch) with scale (low six bits). */
  treeX: Uint16Array
  treeZ: Uint16Array
  treeS: Uint8Array
}

interface Section { name: string; type: 'u16' | 'u8' | 'i8'; side: number; count: number; offset: number; bytes: number }

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
  const out: Record<string, Uint16Array | Uint8Array | Int8Array> = {}
  let side = 0
  let fineSide = 0
  for (const s of header.sections) {
    const raw = bytes.slice(base + s.offset, base + s.offset + s.bytes)
    out[s.name] = s.type === 'u16' ? new Uint16Array(raw.buffer, 0, s.count) : s.type === 'i8' ? new Int8Array(raw.buffer, 0, s.count) : raw
    if (s.name === 'ground') side = s.side
    if (s.name === 'clear') fineSide = s.side
  }
  for (const name of ['ground', 'water', 'cover', 'tone', 'canopy', 'clear', 'treeX', 'treeZ', 'treeS']) if (!out[name]) throw new Error(`Tello map file has no ${name}`)
  return { side, fineSide, ground: out.ground as Uint16Array, water: out.water as Uint16Array, cover: out.cover as Uint8Array, tone: out.tone as Uint8Array, canopy: out.canopy as Uint8Array, clear: out.clear as Int8Array, treeX: out.treeX as Uint16Array, treeZ: out.treeZ as Uint16Array, treeS: out.treeS as Uint8Array }
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Loads both map files from `base` (the page's `tello/` folder). A host that already unpacked the grid file is handled too. */
export async function loadMap(base: string): Promise<{ doc: MapDoc; grids: MapGrids }> {
  const [docRes, binRes] = await Promise.all([fetch(`${base}montello.json`), fetch(`${base}montello.bin`)])
  if (!docRes.ok || !binRes.ok) throw new Error('The Montello map could not be loaded')
  const doc = (await docRes.json()) as MapDoc
  let bytes: Uint8Array = new Uint8Array(await binRes.arrayBuffer())
  if (isGzip(bytes)) bytes = await gunzip(bytes)
  return { doc, grids: parseGrids(bytes) }
}
