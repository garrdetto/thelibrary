import { CATALOG, FLOOR_MATERIALS, objectDef, type ObjectDef } from './Catalog'
import { FEATURE_KINDS, PAINTS, defaultStyle, featureStyles, sanitizeStyle, type Feature, type HouseStyle } from './Style'
import { defaultLook, sanitizeLook, sanitizeSimName, type Look } from './Look'
import { fullNeeds, sanitizeNeeds, type Needs } from './Needs'
import { LOT_D, LOT_W, isLotIndex, isStreetIndex } from './Street'

export const W = LOT_W
export const D = LOT_D
export const STARTING_FUNDS = 20000
export const MAX_SIMS = 4

/** A wall edge on the tile grid: `v = 0` runs along x from (x, z) to (x + 1, z); `v = 1` runs along z from (x, z) to (x, z + 1). */
export type Edge = [number, number, 0 | 1]

export interface PlacedObject {
  id: number
  def: string
  x: number
  z: number
  r: number
}

export interface SimRecord {
  id: string
  name: string
  look: Look
  needs: Needs
  x: number
  z: number
  /** Set while this Sim is visiting another lot. */
  away?: { street: number; lot: number } | null
}

export interface Household {
  name: string
  funds: number
  sims: SimRecord[]
}

export interface Person {
  key: string
  name: string
}

export interface LotSettings {
  yardOpen: boolean
  guestsUseFridgeBeds: boolean
  alwaysLetIn: Person[]
  blocked: Person[]
}


export interface LotState {
  v: 1
  street: number
  lot: number
  ownerId: string
  ownerName: string
  walls: Edge[]
  doors: Edge[]
  windows: Edge[]
  floors: [number, number][]
  style: HouseStyle
  objects: PlacedObject[]
  nextObjectId: number
  features: Feature[]
  nextFeatureId: number
  household: Household
  /** Household clock in sim minutes since move-in day began at 8:00. */
  clock: number
  settings: LotSettings
  friendships: Record<string, number>
}

/** What anyone on the street may see: the outside of the house and the yard. */
export interface LotShell {
  walls: Edge[]
  doors: Edge[]
  windows: Edge[]
  style: HouseStyle
  floors: [number, number][]
  objects: PlacedObject[]
  features: Feature[]
}

export const FRONTS: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]

export function edgeKey(x: number, z: number, v: number): string {
  return `${x},${z},${v}`
}

export function tileIndex(x: number, z: number): number {
  return x + z * W
}

export function inLot(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < W && z < D
}

export function validEdge(x: number, z: number, v: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(z)) return false
  if (v === 0) return x >= 0 && x < W && z >= 0 && z <= D
  if (v === 1) return x >= 0 && x <= W && z >= 0 && z < D
  return false
}

export function footprintSize(def: ObjectDef, r: number): [number, number] {
  return r % 2 === 0 ? [def.w, def.d] : [def.d, def.w]
}

export function footprintTiles(def: ObjectDef, x: number, z: number, r: number): [number, number][] {
  const [fw, fd] = footprintSize(def, r)
  const tiles: [number, number][] = []
  for (let i = 0; i < fw; i++) for (let j = 0; j < fd; j++) tiles.push([x + i, z + j])
  return tiles
}

/** The edge between two orthogonally adjacent tiles. */
export function edgeBetween(ax: number, az: number, bx: number, bz: number): Edge {
  if (ax === bx) return [ax, Math.max(az, bz), 0]
  return [Math.max(ax, bx), az, 1]
}

/** Tiles from which a Sim can use an object: the front row first, then the sides, then the back. */
export function accessCandidates(def: ObjectDef, x: number, z: number, r: number): { tile: [number, number]; from: [number, number] }[] {
  const [fw, fd] = footprintSize(def, r)
  const [fx, fz] = FRONTS[((r % 4) + 4) % 4]
  const out: { tile: [number, number]; from: [number, number] }[] = []
  const front: typeof out = [], sides: typeof out = [], back: typeof out = []
  for (let i = 0; i < fw; i++) {
    for (let j = 0; j < fd; j++) {
      const tx = x + i, tz = z + j
      for (const [dx, dz] of FRONTS) {
        const nx = tx + dx, nz = tz + dz
        if (nx >= x && nx < x + fw && nz >= z && nz < z + fd) continue
        const entry = { tile: [nx, nz] as [number, number], from: [tx, tz] as [number, number] }
        if (dx === fx && dz === fz) front.push(entry)
        else if (dx === -fx && dz === -fz) back.push(entry)
        else sides.push(entry)
      }
    }
  }
  out.push(...front, ...sides, ...back)
  return out
}

type GridSource = Pick<LotState, 'walls' | 'doors' | 'windows' | 'floors' | 'objects'> & { features?: Feature[] }

/** Every unit edge along a straight run between two grid points. */
export function featureEdges(feature: Pick<Feature, 'x' | 'z' | 'x2' | 'z2'>): Edge[] {
  return lineWalls(feature.x, feature.z, feature.x2 ?? feature.x, feature.z2 ?? feature.z)
}

export class LotGrid {
  readonly fences = new Set<string>()
  readonly walls = new Set<string>()
  readonly doors = new Set<string>()
  readonly windows = new Set<string>()
  readonly floors = new Int8Array(W * D).fill(-1)
  readonly occupied = new Int32Array(W * D).fill(-1)
  readonly inside = new Uint8Array(W * D)
  readonly objects = new Map<number, PlacedObject>()

  constructor(state: GridSource) {
    this.rebuild(state)
  }

  rebuild(state: GridSource): void {
    this.fences.clear()
    for (const feature of state.features ?? []) {
      if (feature.kind !== 'fence' || feature.style === 'gate') continue
      for (const [x, z, v] of featureEdges(feature)) this.fences.add(edgeKey(x, z, v))
    }
    this.walls.clear()
    this.doors.clear()
    this.windows.clear()
    this.floors.fill(-1)
    this.occupied.fill(-1)
    this.objects.clear()
    for (const [x, z, v] of state.walls) this.walls.add(edgeKey(x, z, v))
    for (const [x, z, v] of state.doors) if (this.walls.has(edgeKey(x, z, v))) this.doors.add(edgeKey(x, z, v))
    for (const [x, z, v] of state.windows) if (this.walls.has(edgeKey(x, z, v)) && !this.doors.has(edgeKey(x, z, v))) this.windows.add(edgeKey(x, z, v))
    for (const [index, mat] of state.floors) if (index >= 0 && index < W * D) this.floors[index] = mat
    for (const object of state.objects) {
      this.objects.set(object.id, object)
      const def = objectDef(object.def)
      if (!def || def.flat) continue
      for (const [tx, tz] of footprintTiles(def, object.x, object.z, object.r)) if (inLot(tx, tz)) this.occupied[tileIndex(tx, tz)] = object.id
    }
    this.computeInside()
  }

  isWall(x: number, z: number, v: number): boolean {
    return this.walls.has(edgeKey(x, z, v))
  }

  isDoor(x: number, z: number, v: number): boolean {
    return this.doors.has(edgeKey(x, z, v))
  }

  isInside(x: number, z: number): boolean {
    return inLot(x, z) && this.inside[tileIndex(x, z)] === 1
  }

  /** Can a Sim step between two orthogonal neighbours? Doors open only for Sims allowed inside. */
  canStep(ax: number, az: number, bx: number, bz: number, doors: boolean): boolean {
    const [x, z, v] = edgeBetween(ax, az, bx, bz)
    const key = edgeKey(x, z, v)
    if (this.fences.has(key)) return false
    if (!this.walls.has(key)) return true
    return doors && this.doors.has(key)
  }

  /** Inside is every tile the outdoors cannot reach without crossing a wall; doors count as wall here. */
  private computeInside(): void {
    const reached = new Uint8Array(W * D)
    const queue: number[] = []
    const seed = (x: number, z: number, edge: Edge) => {
      const index = tileIndex(x, z)
      if (reached[index] || this.isWall(...edge)) return
      reached[index] = 1
      queue.push(index)
    }
    for (let x = 0; x < W; x++) {
      seed(x, 0, [x, 0, 0])
      seed(x, D - 1, [x, D, 0])
    }
    for (let z = 0; z < D; z++) {
      seed(0, z, [0, z, 1])
      seed(W - 1, z, [W, z, 1])
    }
    while (queue.length) {
      const index = queue.pop()!
      const x = index % W, z = Math.floor(index / W)
      for (const [dx, dz] of FRONTS) {
        const nx = x + dx, nz = z + dz
        if (!inLot(nx, nz)) continue
        const next = tileIndex(nx, nz)
        if (reached[next]) continue
        const [ex, ez, ev] = edgeBetween(x, z, nx, nz)
        if (this.isWall(ex, ez, ev)) continue
        reached[next] = 1
        queue.push(next)
      }
    }
    for (let i = 0; i < W * D; i++) this.inside[i] = reached[i] ? 0 : 1
  }

  /** Every door with an inside tile on one side and an outside tile on the other. */
  exteriorDoors(): { edge: Edge; inside: [number, number]; outside: [number, number] }[] {
    const out: { edge: Edge; inside: [number, number]; outside: [number, number] }[] = []
    for (const key of this.doors) {
      const [x, z, v] = key.split(',').map(Number) as Edge
      const a: [number, number] = v === 0 ? [x, z - 1] : [x - 1, z]
      const b: [number, number] = [x, z]
      const aIn = inLot(...a) ? this.isInside(...a) : false
      const bIn = inLot(...b) ? this.isInside(...b) : false
      if (aIn === bIn) continue
      const inside = aIn ? a : b
      const outside = aIn ? b : a
      if (!inLot(...outside)) continue
      out.push({ edge: [x, z, v], inside, outside })
    }
    return out
  }

  /** Where a Sim stands to use an object: free tiles in front (then sides, then back) not cut off by a wall. */
  accessTiles(object: PlacedObject): [number, number][] {
    const def = objectDef(object.def)
    if (!def) return []
    const out: [number, number][] = []
    for (const { tile, from } of accessCandidates(def, object.x, object.z, object.r)) {
      const [tx, tz] = tile
      if (!inLot(tx, tz)) continue
      const holder = this.occupied[tileIndex(tx, tz)]
      if (holder !== -1 && holder !== object.id) continue
      const [ex, ez, ev] = edgeBetween(from[0], from[1], tx, tz)
      if (this.isWall(ex, ez, ev)) continue
      out.push([tx, tz])
    }
    return out
  }

  objectInside(object: PlacedObject): boolean {
    const def = objectDef(object.def)
    if (!def) return false
    return footprintTiles(def, object.x, object.z, object.r).some(([x, z]) => this.isInside(x, z))
  }
}

function edge(x: number, z: number, v: 0 | 1): Edge {
  return [x, z, v]
}

export function rectangleWalls(x0: number, z0: number, x1: number, z1: number): Edge[] {
  const out: Edge[] = []
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1)
  for (let x = ax; x < bx; x++) out.push(edge(x, az, 0), edge(x, bz, 0))
  for (let z = az; z < bz; z++) out.push(edge(ax, z, 1), edge(bx, z, 1))
  return out
}

export function lineWalls(x0: number, z0: number, x1: number, z1: number): Edge[] {
  const out: Edge[] = []
  if (z0 === z1) for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x++) out.push(edge(x, z0, 0))
  else if (x0 === x1) for (let z = Math.min(z0, z1); z < Math.max(z0, z1); z++) out.push(edge(x0, z, 1))
  return out
}

function uniqueEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>()
  return edges.filter(([x, z, v]) => {
    const key = edgeKey(x, z, v)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The house every new household moves into: living room and kitchen, a bedroom, a bath and a small yard. */
export function starterLayout(): Pick<LotState, 'walls' | 'doors' | 'windows' | 'floors' | 'objects' | 'nextObjectId' | 'style' | 'features' | 'nextFeatureId'> {
  const walls = uniqueEdges([...rectangleWalls(5, 6, 15, 14), ...lineWalls(11, 6, 11, 14), ...lineWalls(11, 10, 15, 10)])
  const doors: Edge[] = [edge(8, 6, 0), edge(11, 7, 1), edge(11, 12, 1)]
  const windows: Edge[] = [edge(6, 6, 0), edge(10, 6, 0), edge(13, 6, 0), edge(7, 14, 0), edge(13, 14, 0), edge(5, 9, 1), edge(15, 8, 1)]
  const floors: [number, number][] = []
  for (let x = 5; x < 11; x++) for (let z = 6; z < 14; z++) floors.push([tileIndex(x, z), 0])
  for (let x = 11; x < 15; x++) for (let z = 6; z < 10; z++) floors.push([tileIndex(x, z), 4])
  for (let x = 11; x < 15; x++) for (let z = 10; z < 14; z++) floors.push([tileIndex(x, z), 3])
  for (let z = 0; z < 6; z++) floors.push([tileIndex(8, z), 5])
  for (const x of [7, 9]) floors.push([tileIndex(x, 5), 5])
  const items: [string, number, number, number][] = [
    ['fridge', 5, 13, 0], ['stove', 6, 13, 0], ['counter', 7, 13, 0], ['kitchen-sink', 8, 13, 0],
    ['dining-table', 7, 10, 0], ['dining-chair', 7, 9, 2], ['dining-chair', 8, 9, 2],
    ['sofa', 6, 8, 0], ['tv', 6, 6, 2], ['bookshelf', 10, 6, 2], ['lamp', 5, 6, 2], ['plant', 10, 13, 0],
    ['bed-double', 12, 8, 0], ['computer', 14, 6, 2],
    ['toilet', 14, 13, 3], ['shower', 14, 10, 3], ['bath-sink', 12, 13, 0],
    ['grill', 3, 4, 0], ['tree', 2, 18, 0], ['tree', 17, 3, 0], ['garden', 15, 18, 0], ['flowers', 6, 4, 0], ['flowers', 10, 4, 0],
  ]
  const objects = items.map(([def, x, z, r], i) => ({ id: i + 1, def, x, z, r }))
  const features: Feature[] = [{ id: 1, kind: 'canopy', x: 8, z: 6, v: 0, style: 'gable', color: 15, width: 2 }]
  return { walls, doors, windows, floors, objects, nextObjectId: objects.length + 1, style: defaultStyle(), features, nextFeatureId: 2 }
}

export interface NewSim {
  name: string
  look: Look
}

export function newLotState(street: number, lot: number, ownerId: string, ownerName: string, householdName: string, sims: NewSim[]): LotState {
  const layout = starterLayout()
  const spots: [number, number][] = [[8, 7], [9, 8], [9, 7], [8, 8]]
  return {
    v: 1, street, lot, ownerId, ownerName,
    ...layout,
    household: {
      name: sanitizeSimName(householdName, 'Newcomers'),
      funds: STARTING_FUNDS,
      sims: sims.slice(0, MAX_SIMS).map((sim, i) => ({ id: `s${i + 1}`, name: sanitizeSimName(sim.name, `Resident ${i + 1}`), look: sanitizeLook(sim.look), needs: fullNeeds(), x: spots[i][0], z: spots[i][1], away: null })),
    },
    clock: 0,
    settings: { yardOpen: true, guestsUseFridgeBeds: false, alwaysLetIn: [], blocked: [] },
    friendships: {},
  }
}

function edgeList(input: unknown): Edge[] {
  if (!Array.isArray(input)) return []
  return uniqueEdges(input.filter((e): e is Edge => Array.isArray(e) && validEdge(Number(e[0]), Number(e[1]), Number(e[2]))).map(e => [Number(e[0]), Number(e[1]), Number(e[2]) as 0 | 1]))
}

function people(input: unknown): Person[] {
  if (!Array.isArray(input)) return []
  return input.filter((p): p is Person => !!p && typeof p.key === 'string' && typeof p.name === 'string').slice(0, 64).map(p => ({ key: p.key.slice(0, 80), name: p.name.slice(0, 40) }))
}

export function sanitizeFeatures(input: unknown): Feature[] {
  if (!Array.isArray(input)) return []
  const out: Feature[] = []
  for (const raw of input.slice(0, 200)) {
    if (!raw || typeof raw !== 'object') continue
    const f = raw as Record<string, unknown>
    const kind = String(f.kind) as Feature['kind']
    if (!(FEATURE_KINDS as readonly string[]).includes(kind) || !Number.isInteger(f.id) || !Number.isInteger(f.x) || !Number.isInteger(f.z)) continue
    const styles = featureStyles(kind)
    const color = Number(f.color)
    out.push({
      id: Number(f.id), kind, x: Number(f.x), z: Number(f.z),
      ...(f.v === 0 || f.v === 1 ? { v: f.v } : {}),
      ...(Number.isInteger(f.x2) ? { x2: Number(f.x2) } : {}),
      ...(Number.isInteger(f.z2) ? { z2: Number(f.z2) } : {}),
      style: styles.includes(String(f.style)) ? String(f.style) : styles[0],
      color: Number.isInteger(color) && color >= 0 && color < PAINTS.length ? color : 1,
      ...(Number.isInteger(f.width) ? { width: Math.max(1, Math.min(3, Number(f.width))) } : {}),
    })
  }
  return out
}

/** Normalizes a stored lot so later code can trust every field. */
export function sanitizeLotState(input: unknown, street: number, lot: number): LotState | null {
  if (!input || typeof input !== 'object' || !isStreetIndex(street) || !isLotIndex(lot)) return null
  const s = input as Record<string, unknown>
  if (typeof s.ownerId !== 'string' || typeof s.ownerName !== 'string') return null
  const household = (s.household ?? {}) as Record<string, unknown>
  const sims = Array.isArray(household.sims) ? household.sims : []
  const settings = (s.settings ?? {}) as Record<string, unknown>
  const objects = (Array.isArray(s.objects) ? s.objects : [])
    .filter((o): o is PlacedObject => !!o && typeof o.def === 'string' && !!objectDef(o.def) && Number.isInteger(o.id) && Number.isInteger(o.x) && Number.isInteger(o.z))
    .map(o => ({ id: o.id, def: o.def, x: o.x, z: o.z, r: ((Number(o.r) % 4) + 4) % 4 }))
  const floors = (Array.isArray(s.floors) ? s.floors : [])
    .filter((f): f is [number, number] => Array.isArray(f) && Number.isInteger(f[0]) && f[0] >= 0 && f[0] < W * D && Number.isInteger(f[1]) && f[1] >= 0 && f[1] < FLOOR_MATERIALS.length)
  const friendships: Record<string, number> = {}
  if (s.friendships && typeof s.friendships === 'object') for (const [k, v] of Object.entries(s.friendships as Record<string, unknown>)) if (Number.isFinite(Number(v)) && k.length < 200) friendships[k] = Math.max(-100, Math.min(100, Number(v)))
  return {
    v: 1, street, lot, ownerId: s.ownerId, ownerName: s.ownerName,
    walls: edgeList(s.walls), doors: edgeList(s.doors), windows: edgeList(s.windows), floors,
    style: sanitizeStyle(s.style),
    objects,
    nextObjectId: Math.max(Number(s.nextObjectId) || 1, ...objects.map(o => o.id + 1)),
    features: sanitizeFeatures(s.features),
    nextFeatureId: Math.max(Number(s.nextFeatureId) || 1, ...sanitizeFeatures(s.features).map(f => f.id + 1)),
    household: {
      name: sanitizeSimName(household.name, 'Newcomers'),
      funds: Math.max(0, Math.floor(Number(household.funds) || 0)),
      sims: sims.slice(0, MAX_SIMS).map((raw, i) => {
        const sim = (raw ?? {}) as Record<string, unknown>
        const away = sim.away as { street?: unknown; lot?: unknown } | null | undefined
        return {
          id: typeof sim.id === 'string' ? sim.id.slice(0, 12) : `s${i + 1}`,
          name: sanitizeSimName(sim.name, `Resident ${i + 1}`),
          look: sanitizeLook(sim.look ?? defaultLook()),
          needs: sanitizeNeeds(sim.needs),
          x: Number.isFinite(Number(sim.x)) ? Math.max(0, Math.min(W - 1, Number(sim.x))) : 8,
          z: Number.isFinite(Number(sim.z)) ? Math.max(0, Math.min(D - 1, Number(sim.z))) : 7,
          away: away && Number.isInteger(away.street) && Number.isInteger(away.lot) ? { street: Number(away.street), lot: Number(away.lot) } : null,
        }
      }),
    },
    clock: Math.max(0, Number(s.clock) || 0),
    settings: { yardOpen: settings.yardOpen !== false, guestsUseFridgeBeds: settings.guestsUseFridgeBeds === true, alwaysLetIn: people(settings.alwaysLetIn), blocked: people(settings.blocked) },
    friendships,
  }
}

/** The public outside of a lot for the street view: walls, openings, yard floors and yard objects, never the interior. */
export function shellOf(state: LotState): LotShell {
  const grid = new LotGrid(state)
  return {
    walls: state.walls, doors: state.doors, windows: state.windows, style: state.style,
    floors: state.floors.filter(([index]) => !grid.inside[index]),
    objects: state.objects.filter(o => !grid.objectInside(o)),
    features: state.features,
  }
}

/** Normalizes a stored street shell (older rows may predate the exterior designer). */
export function sanitizeShell(input: unknown): LotShell {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const floors = (Array.isArray(s.floors) ? s.floors : []).filter((f): f is [number, number] => Array.isArray(f) && Number.isInteger(f[0]) && f[0] >= 0 && f[0] < W * D && Number.isInteger(f[1]) && f[1] >= 0 && f[1] < FLOOR_MATERIALS.length)
  const objects = (Array.isArray(s.objects) ? s.objects : []).filter((o): o is PlacedObject => !!o && typeof o.def === 'string' && !!objectDef(o.def) && Number.isInteger(o.id) && Number.isInteger(o.x) && Number.isInteger(o.z))
  return { walls: edgeList(s.walls), doors: edgeList(s.doors), windows: edgeList(s.windows), style: sanitizeStyle(s.style), floors, objects, features: sanitizeFeatures(s.features) }
}

export function lotValue(state: Pick<LotState, 'objects' | 'walls' | 'floors'>): number {
  let value = state.walls.length * 12 + state.floors.length * 4
  for (const object of state.objects) value += objectDef(object.def)?.price ?? 0
  return value
}

export const CATALOG_IDS = CATALOG.map(def => def.id)
