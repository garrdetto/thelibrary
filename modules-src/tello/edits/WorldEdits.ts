/**
 * Life Sim's world edits: an ordered list of changes the administrator makes in the World Editor (admin panel), replayed
 * on top of Montello's baked map at load (`applyWorldEdits`), after Tello's own street fixes and before anything is
 * built. Renderer-free and deterministic, so the editor, the game and the tests all get the same world.
 *
 * Coordinates are Tello's map frame: x east, z north, metres. Heights are map metres (above `frame.base`, before Fox
 * Lake moves Lake Montello's surface to 0). `Flat` is x, z pairs.
 *
 * Features the map already has are named by id: `r<index>` roads, `b<index>` buildings and `l<index>` lots, numbered
 * after Tello's fixes. Features an edit adds are named after the edit (`<op id>`, a road's sidewalks `<op id>:L` and
 * `<op id>:R`, extra lot pieces `<op id>:<n>`).
 */
import type { BuildingKind, RoadKind } from '../data/MapData'

export const WORLD_EDITS_VERSION = 1
export const WORLD_ID = 'lifesim'

export type Flat = number[]

/** A path with a radius round it (a brush stroke, a single dab when it has one point), or a closed area. */
export type Shape = { k: 'path'; pts: Flat; r: number } | { k: 'area'; ring: Flat }

/** How a plotted line becomes a curve: `arcs` rounds each corner with the given radius (it passes inside the corner points); `spline` runs a smooth curve through every point. */
export type CurveFit = 'arcs' | 'spline'

interface OpBase {
  id: string
  /** When it was made (ms). */
  ts: number
  /** `false` leaves the edit out without deleting it. */
  on?: boolean
  /** The administrator's own label. */
  note?: string
}

export type TerrainMode = 'raise' | 'lower' | 'flatten' | 'smooth' | 'grade' | 'noise'

export interface TerrainOp extends OpBase {
  type: 'terrain'
  mode: TerrainMode
  shape: Shape
  /** Metres beyond the shape over which the change fades out. */
  falloff: number
  /** raise / lower: metres; noise: amplitude in metres. */
  amount?: number
  /** flatten: the target height. */
  height?: number
  /** grade: the height at each of the path's points (the ground is set to the line through them). */
  heights?: number[]
  /** 0..1, how much of the change to apply (flatten, smooth, grade, noise). Default 1. */
  strength?: number
  /** smooth: the blur radius in metres (default 12); noise: the feature size in metres (default 40). */
  size?: number
  /** Buildings, lots, bridges and water move with the ground. Default true. */
  carry?: boolean
}

export type WaterMode = 'fill' | 'level' | 'paint' | 'drain'

export interface WaterOp extends OpBase {
  type: 'water'
  /**
   * fill: flood the low ground connected to `at` up to `level`. level: set the water body at `at` to `level`, spreading
   * over low ground when it rises and drying out when it falls. paint: water at `level` wherever the shape's ground is
   * below it. drain: no water in the shape.
   */
  mode: WaterMode
  at?: [number, number]
  level?: number
  /** paint / drain, and an optional limit for fill and level. */
  shape?: Shape
  /** paint: also dig the bed to at least this many metres under the level (0 leaves the ground). */
  dig?: number
  /** drain: raise the bed to dry ground just over the old surface (default true); off leaves a dry hole. */
  fill?: boolean
}

export interface RiverOp extends OpBase {
  type: 'river'
  /** Centreline control points (smoothed like a road). */
  pts: Flat
  curve: number
  fit?: CurveFit
  /** Water width. */
  w: number
  depth: number
  /** Width of the sloped bank on each side. */
  bank: number
  /** Water surface at the first and last point (map metres); it falls evenly along the length. */
  levels: [number, number]
}

export interface Sidewalks {
  left: boolean
  right: boolean
  /** Walk width. */
  w: number
  /** Gap between the road's edge and the walk (a grass strip). */
  gap: number
}

export interface Grading {
  /** Extra width levelled each side of the pavement. */
  shoulder: number
  /** Metres beyond the shoulder over which it blends back into the land. */
  falloff: number
  /** Length (metres) the road's height is averaged over: longer is smoother. */
  smooth: number
}

export interface RoadOp extends OpBase {
  type: 'road'
  /** Centre points as plotted; the road runs through them with rounded corners. */
  pts: Flat
  /** Corner radius in metres (0 = sharp corners). */
  curve: number
  fit?: CurveFit
  w: number
  k: RoadKind
  n: string
  walk?: Sidewalks | null
  /** Level the ground under it, smooth along and flat across. */
  grade?: Grading | null
  /** Roads this one replaces (redraw a road: the old one goes, this one is put in its place). */
  replaces?: string[]
}

export interface RoadRemoveOp extends OpBase { type: 'roadRemove'; ids: string[] }

export interface RoadSetOp extends OpBase {
  type: 'roadSet'
  /** The road changed. */
  ref: string
  w?: number
  k?: RoadKind
  n?: string
}

export interface BuildingRemoveOp extends OpBase { type: 'buildingRemove'; ids: string[] }

export interface BuildingSetOp extends OpBase {
  type: 'buildingSet'
  /** The building changed. */
  ref: string
  k?: BuildingKind
  /** Eave height above the floor. */
  h?: number
  /** Ridge height above the eave (0 for flat). */
  ridge?: number
  /** Roof type (`ROOF`). */
  roof?: number
  /** Roof colour, #rrggbb. */
  rc?: string
  n?: string
  /** Move by this much. */
  dx?: number
  dz?: number
  /** Turn by this many radians about the footprint's centre. */
  yaw?: number
  /** Floor height (map metres). */
  f?: number
}

export interface BuildingOp extends OpBase {
  type: 'building'
  x: number
  z: number
  /** Width along the yaw axis and depth across it. */
  w: number
  d: number
  yaw: number
  k: BuildingKind
  h: number
  ridge: number
  roof: number
  rc?: string
  n?: string
  /** Level the ground under it (and a metre and a half round it) to its floor. */
  level?: boolean
}

export interface LotOp extends OpBase {
  type: 'lot'
  ring: Flat
  n?: string
  /** Paint stalls (default true). */
  stripes?: boolean
  /** Slab height (map metres); left out, the highest ground under its corners. */
  f?: number
}

export interface LotRemoveOp extends OpBase { type: 'lotRemove'; ids: string[] }

export interface LotSetOp extends OpBase {
  type: 'lotSet'
  /** The lot changed. */
  ref: string
  ring?: Flat
  f?: number
  n?: string
  stripes?: boolean
}

/** Trims parking lots back off the roads that run over them (`ids` or every lot), `margin` metres clear of the pavement. */
export interface LotClipOp extends OpBase {
  type: 'lotClip'
  ids: string[] | 'all'
  margin: number
}

export interface TreesOp extends OpBase {
  type: 'trees'
  mode: 'add' | 'remove'
  shape: Shape
  /** add: trees per hectare. */
  density?: number
  /** add: weights of pine, hardwood and birch. */
  mix?: [number, number, number]
  /** add: height range in metres. */
  height?: [number, number]
  seed?: number
  /** add: woods on the ground under them. */
  floor?: boolean
}

export interface RailOp extends OpBase {
  type: 'rail'
  pts: Flat
  /** Which side of the line (walking from the first point, -1 left, 1 right) the beam faces. */
  side: -1 | 1
}

/** Takes down the automatic guardrails (and rails added before it) inside the shape. */
export interface RailCutOp extends OpBase { type: 'railCut'; shape: Shape }

export type LightStyle = 'acorn' | 'cobra' | 'lot' | 'double'

export interface LightsOp extends OpBase {
  type: 'lights'
  style: LightStyle
  /** Pole positions. */
  pts: Flat
  /** Heading of each pole's arm (radians from east, counter-clockwise, map frame). */
  yaw: number[]
  /** Pole height in metres. */
  h: number
}

/** Takes down street lamps, lot lights and lights added before it inside the shape. */
export interface LightCutOp extends OpBase { type: 'lightCut'; shape: Shape }

export type WallStyle = 'brick' | 'stone' | 'block' | 'wood' | 'iron'

export interface WallOp extends OpBase {
  type: 'wall'
  pts: Flat
  /** Height above the ground. */
  h: number
  /** Thickness. */
  th: number
  style: WallStyle
  /** Pillars every this many metres (0: only at the ends and corners). */
  posts: number
  /** A cap course along the top. */
  cap: boolean
  closed?: boolean
}

export type EditOp =
  | TerrainOp | WaterOp | RiverOp
  | RoadOp | RoadRemoveOp | RoadSetOp
  | BuildingOp | BuildingRemoveOp | BuildingSetOp
  | LotOp | LotRemoveOp | LotSetOp | LotClipOp
  | TreesOp | RailOp | RailCutOp | LightsOp | LightCutOp | WallOp

export type EditType = EditOp['type']

/** What the edits leave for the builders (on `MapDoc.extras`): rails, lights and walls to put up and the cuts to make in the automatic ones. */
export interface WorldExtras {
  rails: { side: -1 | 1; pts: Flat }[]
  railCuts: Shape[]
  lights: { style: LightStyle; x: number; z: number; yaw: number; h: number }[]
  lightCuts: Shape[]
  walls: { pts: Flat; h: number; th: number; style: WallStyle; posts: number; cap: boolean; closed: boolean }[]
}

export function emptyExtras(): WorldExtras {
  return { rails: [], railCuts: [], lights: [], lightCuts: [], walls: [] }
}

export interface WorldEdits {
  v: typeof WORLD_EDITS_VERSION
  world: typeof WORLD_ID
  /** The baked map the edits were made on (`mapStamp`), so a re-bake can be noticed. */
  base?: string
  ops: EditOp[]
}

export function emptyEdits(base?: string): WorldEdits {
  return { v: WORLD_EDITS_VERSION, world: WORLD_ID, base, ops: [] }
}

/** Bounds the editor and the server hold every document to. */
export const EDIT_LIMITS = {
  ops: 4000,
  /** Numbers in one op's point list. */
  pts: 24000,
  /** Largest brush radius, falloff or road width (metres). */
  radius: 4000,
  falloff: 2000,
  width: 80,
  /** Heights in map metres (Montello's ground is 0..60 above the base). */
  minHeight: 0,
  maxHeight: 140,
  amount: 60,
  density: 1200,
  treeHeight: 40,
  wallHeight: 8,
  lightHeight: 16,
  name: 60,
  note: 120,
  /** Whole document, characters of JSON. */
  bytes: 6_000_000,
} as const

export const ROAD_KIND_NAMES: Record<RoadKind, string> = { 0: 'Highway', 1: 'Street', 2: 'Lane / driveway', 3: 'Gravel', 4: 'Sidewalk', 5: 'Trail' }

export const BUILDING_KINDS: readonly BuildingKind[] = ['house', 'garage', 'shed', 'store', 'industrial', 'civic', 'church', 'canopy']

export const LIGHT_STYLES: readonly LightStyle[] = ['acorn', 'cobra', 'lot', 'double']
export const LIGHT_STYLE_NAMES: Record<LightStyle, string> = { acorn: 'Acorn lamp (downtown)', cobra: 'Cobra head (street)', lot: 'Lot light (single)', double: 'Lot light (double)' }

export const WALL_STYLES: readonly WallStyle[] = ['brick', 'stone', 'block', 'wood', 'iron']
export const WALL_STYLE_NAMES: Record<WallStyle, string> = { brick: 'Red brick', stone: 'Fieldstone', block: 'Concrete block', wood: 'Wood privacy fence', iron: 'Iron fence on brick piers' }

/** Default pole heights by style. */
export const LIGHT_HEIGHT: Record<LightStyle, number> = { acorn: 4.3, cobra: 9, lot: 9, double: 9 }

let counter = 0
/** A short id for a new op: time-based, unique within a session. */
export function newOpId(now = Date.now()): string {
  counter = (counter + 1) % 1296
  return `e${now.toString(36)}${counter.toString(36).padStart(2, '0')}`
}

/** True when the op takes part (not switched off). */
export function isOn(op: EditOp): boolean {
  return op.on !== false
}

/** A one-line description of an op for lists. */
export function describeOp(op: EditOp): string {
  if (op.note) return op.note
  switch (op.type) {
    case 'terrain': return `Terrain: ${op.mode}${op.mode === 'raise' || op.mode === 'lower' ? ` ${op.amount ?? 0} m` : ''}`
    case 'water': return `Water: ${op.mode}`
    case 'river': return `River ${op.w} m wide`
    case 'road': return `${op.replaces?.length ? 'Redrawn' : 'New'} ${ROAD_KIND_NAMES[op.k].toLowerCase()}${op.n ? ` (${op.n})` : ''}`
    case 'roadRemove': return `Remove ${op.ids.length} road${op.ids.length === 1 ? '' : 's'}`
    case 'roadSet': return 'Change road'
    case 'building': return `New ${op.k}`
    case 'buildingRemove': return `Remove ${op.ids.length} building${op.ids.length === 1 ? '' : 's'}`
    case 'buildingSet': return 'Change building'
    case 'lot': return 'New parking lot'
    case 'lotRemove': return `Remove ${op.ids.length} lot${op.ids.length === 1 ? '' : 's'}`
    case 'lotSet': return 'Reshape parking lot'
    case 'lotClip': return op.ids === 'all' ? 'Trim every lot off the roads' : `Trim ${op.ids.length} lot${op.ids.length === 1 ? '' : 's'} off the roads`
    case 'trees': return op.mode === 'add' ? `Plant trees (${op.density ?? 0}/ha)` : 'Clear trees'
    case 'rail': return 'Guardrail'
    case 'railCut': return 'Remove guardrails'
    case 'lights': return `${op.pts.length / 2} ${LIGHT_STYLE_NAMES[op.style].toLowerCase()}${op.pts.length === 2 ? '' : 's'}`
    case 'lightCut': return 'Remove lights'
    case 'wall': return `${WALL_STYLE_NAMES[op.style]} ${op.h} m`
  }
}

/** A short fingerprint of the baked map (its version and how many roads, buildings and lots it had). */
export function mapStamp(doc: { version: number; roads: unknown[]; buildings: unknown[]; lots: unknown[] }): string {
  return `v${doc.version}:${doc.roads.length}:${doc.buildings.length}:${doc.lots.length}`
}
