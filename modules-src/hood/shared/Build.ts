import { BUILD_COSTS, FLOOR_MATERIALS, objectDef } from './Catalog'
import { D, LotGrid, W, edgeKey, featureEdges, footprintTiles, inLot, lineWalls, rectangleWalls, tileIndex, validEdge, type Edge, type LotState } from './Lot'
import { CLADDING_COST, FEATURE_COSTS, featureStyles, PAINTS, sanitizeStyle, type Feature, type FeatureKind, type HouseStyle } from './Style'

export type BuildOp =
  | { op: 'wall'; x0: number; z0: number; x1: number; z1: number }
  | { op: 'room'; x0: number; z0: number; x1: number; z1: number; floor: number }
  | { op: 'unwall'; x0: number; z0: number; x1: number; z1: number }
  | { op: 'door'; x: number; z: number; v: 0 | 1 }
  | { op: 'window'; x: number; z: number; v: 0 | 1 }
  | { op: 'unopen'; x: number; z: number; v: 0 | 1 }
  | { op: 'floor'; x0: number; z0: number; x1: number; z1: number; floor: number }
  | { op: 'buy'; def: string; x: number; z: number; r: number }
  | { op: 'move'; id: number; x: number; z: number; r: number }
  | { op: 'sell'; id: number }
  | { op: 'style'; patch: Partial<HouseStyle> }
  | { op: 'feature'; kind: FeatureKind; x: number; z: number; v?: 0 | 1; x2?: number; z2?: number; style: string; color: number; width?: number }
  | { op: 'unfeature'; id: number }

export interface BuildResult {
  ok: boolean
  error?: string
  cost: number
  /** Tiles the change touches, so the room can keep it away from visitors. */
  tiles: number[]
}

const fail = (error: string): BuildResult => ({ ok: false, error, cost: 0, tiles: [] })

function edgeTiles([x, z, v]: Edge): number[] {
  const tiles: [number, number][] = v === 0 ? [[x, z - 1], [x, z]] : [[x - 1, z], [x, z]]
  return tiles.filter(([tx, tz]) => inLot(tx, tz)).map(([tx, tz]) => tileIndex(tx, tz))
}

function rectTiles(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const out: [number, number][] = []
  const ax = Math.max(0, Math.min(x0, x1)), bx = Math.min(W, Math.max(x0, x1))
  const az = Math.max(0, Math.min(z0, z1)), bz = Math.min(D, Math.max(z0, z1))
  for (let x = ax; x < bx; x++) for (let z = az; z < bz; z++) out.push([x, z])
  return out
}

function pointsOk(...values: number[]): boolean {
  return values.every(v => Number.isInteger(v)) && values.length % 2 === 0
    && values.every((v, i) => (i % 2 === 0 ? v >= 0 && v <= W : v >= 0 && v <= D))
}

/** An edge that would cut through a single object's footprint. */
function splitsObject(grid: LotGrid, [x, z, v]: Edge): boolean {
  const a: [number, number] = v === 0 ? [x, z - 1] : [x - 1, z]
  if (!inLot(...a) || !inLot(x, z)) return false
  const left = grid.occupied[tileIndex(...a)]
  return left !== -1 && left === grid.occupied[tileIndex(x, z)]
}

function placementError(state: LotState, grid: LotGrid, defId: string, x: number, z: number, r: number, ignoreId = -1): string | null {
  const def = objectDef(defId)
  if (!def) return 'That item is not in the catalog.'
  if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(r)) return 'Pick a spot on the lot.'
  const tiles = footprintTiles(def, x, z, ((r % 4) + 4) % 4)
  if (tiles.some(([tx, tz]) => !inLot(tx, tz))) return 'That does not fit on the lot.'
  for (const [tx, tz] of tiles) {
    const inside = grid.isInside(tx, tz)
    if (def.place === 'indoor' && !inside) return `${def.name} belongs indoors.`
    if (def.place === 'outdoor' && inside) return `${def.name} belongs in the yard.`
    if (def.flat) continue
    const holder = grid.occupied[tileIndex(tx, tz)]
    if (holder !== -1 && holder !== ignoreId) return 'Something is already there.'
  }
  const keys = new Set(tiles.map(([tx, tz]) => `${tx},${tz}`))
  for (const [tx, tz] of tiles) {
    if (keys.has(`${tx + 1},${tz}`) && grid.isWall(tx + 1, tz, 1)) return 'A wall runs through that spot.'
    if (keys.has(`${tx},${tz + 1}`) && grid.isWall(tx, tz + 1, 0)) return 'A wall runs through that spot.'
  }
  if (def.actions.length && !def.flat) {
    const probe = new LotGrid({ ...state, objects: [...state.objects.filter(o => o.id !== ignoreId), { id: -2, def: defId, x, z, r }] })
    if (!probe.accessTiles({ id: -2, def: defId, x, z, r }).length) return 'Leave room in front so a Sim can use it.'
  }
  return null
}

/** Checks and applies one build or buy step to the lot. Money is checked against `funds`; the caller deducts `cost`. */
export function applyBuild(state: LotState, grid: LotGrid, op: BuildOp, funds: number): BuildResult {
  switch (op.op) {
    case 'wall':
    case 'room': {
      if (!pointsOk(op.x0, op.z0, op.x1, op.z1)) return fail('Pick points on the lot.')
      if (op.op === 'room' && (op.x0 === op.x1 || op.z0 === op.z1)) return fail('Drag out a room at least one tile wide.')
      if (op.op === 'wall' && op.x0 !== op.x1 && op.z0 !== op.z1) return fail('Walls run straight along the grid.')
      const edges = op.op === 'room' ? rectangleWalls(op.x0, op.z0, op.x1, op.z1) : lineWalls(op.x0, op.z0, op.x1, op.z1)
      const fresh = edges.filter(([x, z, v]) => validEdge(x, z, v) && !grid.isWall(x, z, v))
      if (fresh.some(e => splitsObject(grid, e))) return fail('That wall would cut through furniture.')
      const floorTiles = op.op === 'room' ? rectTiles(op.x0, op.z0, op.x1, op.z1).filter(([x, z]) => grid.floors[tileIndex(x, z)] !== op.floor) : []
      if (op.op === 'room' && !(op.floor >= 0 && op.floor < FLOOR_MATERIALS.length)) return fail('Pick a floor.')
      if (!fresh.length && !floorTiles.length) return fail('There is already a wall there.')
      const cost = fresh.length * BUILD_COSTS.wall + floorTiles.length * BUILD_COSTS.floor
      if (cost > funds) return fail('Not enough money for that.')
      state.walls.push(...fresh)
      if (op.op === 'room') {
        const floors = new Map(state.floors)
        for (const [x, z] of floorTiles) floors.set(tileIndex(x, z), op.floor)
        state.floors = [...floors]
      }
      const tiles = [...fresh.flatMap(edgeTiles), ...floorTiles.map(([x, z]) => tileIndex(x, z))]
      return { ok: true, cost, tiles }
    }
    case 'unwall': {
      if (!pointsOk(op.x0, op.z0, op.x1, op.z1)) return fail('Pick points on the lot.')
      const edges = (op.x0 === op.x1 || op.z0 === op.z1 ? lineWalls(op.x0, op.z0, op.x1, op.z1) : []).filter(([x, z, v]) => grid.isWall(x, z, v))
      if (!edges.length) return fail('There is no wall there.')
      const gone = new Set(edges.map(([x, z, v]) => edgeKey(x, z, v)))
      const keep = (list: Edge[]) => list.filter(([x, z, v]) => !gone.has(edgeKey(x, z, v)))
      state.walls = keep(state.walls)
      state.doors = keep(state.doors)
      state.windows = keep(state.windows)
      return { ok: true, cost: -Math.floor(edges.length * BUILD_COSTS.wall * BUILD_COSTS.refund), tiles: edges.flatMap(edgeTiles) }
    }
    case 'door':
    case 'window': {
      if (!validEdge(op.x, op.z, op.v) || !grid.isWall(op.x, op.z, op.v)) return fail('Place it on a wall.')
      const key = edgeKey(op.x, op.z, op.v)
      if (grid.doors.has(key) || grid.windows.has(key)) return fail('That wall already has an opening.')
      const cost = op.op === 'door' ? BUILD_COSTS.door : BUILD_COSTS.window
      if (cost > funds) return fail('Not enough money for that.')
      ;(op.op === 'door' ? state.doors : state.windows).push([op.x, op.z, op.v])
      return { ok: true, cost, tiles: edgeTiles([op.x, op.z, op.v]) }
    }
    case 'unopen': {
      const key = edgeKey(op.x, op.z, op.v)
      if (!grid.doors.has(key) && !grid.windows.has(key)) return fail('There is no door or window there.')
      const isDoor = grid.doors.has(key)
      state.doors = state.doors.filter(([x, z, v]) => edgeKey(x, z, v) !== key)
      state.windows = state.windows.filter(([x, z, v]) => edgeKey(x, z, v) !== key)
      return { ok: true, cost: -Math.floor((isDoor ? BUILD_COSTS.door : BUILD_COSTS.window) * BUILD_COSTS.refund), tiles: edgeTiles([op.x, op.z, op.v]) }
    }
    case 'floor': {
      if (!pointsOk(op.x0, op.z0, op.x1, op.z1)) return fail('Pick points on the lot.')
      if (!(op.floor === -1 || (Number.isInteger(op.floor) && op.floor >= 0 && op.floor < FLOOR_MATERIALS.length))) return fail('Pick a floor.')
      const tiles = rectTiles(op.x0, op.z0, op.x1, op.z1).filter(([x, z]) => grid.floors[tileIndex(x, z)] !== op.floor)
      if (!tiles.length) return fail('That floor is already there.')
      const cost = op.floor === -1 ? 0 : tiles.length * BUILD_COSTS.floor
      if (cost > funds) return fail('Not enough money for that.')
      const floors = new Map(state.floors)
      for (const [x, z] of tiles) {
        if (op.floor === -1) floors.delete(tileIndex(x, z))
        else floors.set(tileIndex(x, z), op.floor)
      }
      state.floors = [...floors]
      return { ok: true, cost, tiles: tiles.map(([x, z]) => tileIndex(x, z)) }
    }
    case 'buy': {
      const def = objectDef(op.def)
      if (!def) return fail('That item is not in the catalog.')
      const error = placementError(state, grid, op.def, op.x, op.z, op.r)
      if (error) return fail(error)
      if (def.price > funds) return fail('Not enough money for that.')
      const r = ((op.r % 4) + 4) % 4
      state.objects.push({ id: state.nextObjectId++, def: op.def, x: op.x, z: op.z, r })
      return { ok: true, cost: def.price, tiles: footprintTiles(def, op.x, op.z, r).map(([x, z]) => tileIndex(x, z)) }
    }
    case 'move': {
      const object = grid.objects.get(op.id)
      if (!object) return fail('That item is gone.')
      const def = objectDef(object.def)!
      const error = placementError(state, grid, object.def, op.x, op.z, op.r, object.id)
      if (error) return fail(error)
      const before = footprintTiles(def, object.x, object.z, object.r)
      const r = ((op.r % 4) + 4) % 4
      state.objects = state.objects.map(o => (o.id === op.id ? { ...o, x: op.x, z: op.z, r } : o))
      return { ok: true, cost: 0, tiles: [...before, ...footprintTiles(def, op.x, op.z, r)].map(([x, z]) => tileIndex(x, z)) }
    }
    case 'sell': {
      const object = grid.objects.get(op.id)
      if (!object) return fail('That item is gone.')
      const def = objectDef(object.def)!
      state.objects = state.objects.filter(o => o.id !== op.id)
      return { ok: true, cost: -Math.floor(def.price * BUILD_COSTS.refund), tiles: footprintTiles(def, object.x, object.z, object.r).map(([x, z]) => tileIndex(x, z)) }
    }
    case 'style': {
      const next = sanitizeStyle({ ...state.style, ...op.patch }, state.style)
      let faces = 0
      for (const [x, z, v] of state.walls) for (const side of [-1, 1] as const) {
        const tile: [number, number] = v === 0 ? (side < 0 ? [x, z - 1] : [x, z]) : (side < 0 ? [x - 1, z] : [x, z])
        if (!inLot(...tile) || !grid.isInside(...tile)) faces++
      }
      let cost = 0
      if (next.upper !== state.style.upper) cost += faces * CLADDING_COST[next.upper]
      if (next.lower !== state.style.lower || (next.wainscot !== state.style.wainscot && next.wainscot > 0)) cost += Math.ceil(faces * CLADDING_COST[next.lower] * 0.5)
      if (cost > funds) return fail('Not enough money for that.')
      state.style = next
      return { ok: true, cost, tiles: [] }
    }
    case 'feature': return addFeature(state, grid, op, funds)
    case 'unfeature': {
      const feature = state.features.find(f => f.id === op.id)
      if (!feature) return fail('That is already gone.')
      state.features = state.features.filter(f => f.id !== op.id)
      return { ok: true, cost: -Math.floor(featureCost(feature) * BUILD_COSTS.refund), tiles: featureTiles(feature) }
    }
  }
}

function rectOf(f: Pick<Feature, 'x' | 'z' | 'x2' | 'z2'>): [number, number, number, number] {
  const x2 = f.x2 ?? f.x, z2 = f.z2 ?? f.z
  return [Math.min(f.x, x2), Math.min(f.z, z2), Math.max(f.x, x2), Math.max(f.z, z2)]
}

/** Tiles a feature stands over or beside, so building waits for visitors to clear them. */
export function featureTiles(f: Feature): number[] {
  if (f.kind === 'porch' || f.kind === 'pergola') {
    const [x0, z0, x1, z1] = rectOf(f)
    const out: number[] = []
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (inLot(x, z)) out.push(tileIndex(x, z))
    return out
  }
  if (f.kind === 'fence') return featureEdges(f).flatMap(edgeTiles)
  if (f.kind === 'canopy' && f.v !== undefined) return edgeTiles([f.x, f.z, f.v])
  return inLot(f.x, f.z) ? [tileIndex(f.x, f.z)] : []
}

export function featureCost(f: Feature): number {
  switch (f.kind) {
    case 'canopy': return FEATURE_COSTS.canopyPerTile * (f.width ?? 1)
    case 'porch': case 'pergola': {
      const [x0, z0, x1, z1] = rectOf(f)
      return (x1 - x0 + 1) * (z1 - z0 + 1) * (f.kind === 'porch' ? FEATURE_COSTS.porchPerTile : FEATURE_COSTS.pergolaPerTile)
    }
    case 'fence': return f.style === 'gate' ? FEATURE_COSTS.gate : featureEdges(f).length * FEATURE_COSTS.fencePerEdge
    case 'chimney': return FEATURE_COSTS.chimney
  }
}

/** Which side of a wall edge faces the yard: -1 toward lower z/x, 1 toward higher, 0 when both sides are inside or both outside. */
export function outsideSide(grid: LotGrid, [x, z, v]: Edge): -1 | 0 | 1 {
  const a: [number, number] = v === 0 ? [x, z - 1] : [x - 1, z]
  const b: [number, number] = [x, z]
  const aIn = inLot(...a) && grid.isInside(...a)
  const bIn = inLot(...b) && grid.isInside(...b)
  if (aIn === bIn) return 0
  return aIn ? 1 : -1
}

function addFeature(state: LotState, grid: LotGrid, op: Extract<BuildOp, { op: 'feature' }>, funds: number): BuildResult {
  if (!featureStyles(op.kind).includes(op.style)) return fail('Pick a style.')
  if (!(Number.isInteger(op.color) && op.color >= 0 && op.color < PAINTS.length)) return fail('Pick a color.')
  const feature: Feature = { id: state.nextFeatureId, kind: op.kind, x: op.x, z: op.z, style: op.style, color: op.color }
  const others = state.features
  switch (op.kind) {
    case 'canopy': {
      if (op.v === undefined || !validEdge(op.x, op.z, op.v) || !grid.isWall(op.x, op.z, op.v)) return fail('Put a canopy on an outside wall.')
      const key = edgeKey(op.x, op.z, op.v)
      if (!grid.doors.has(key) && !grid.windows.has(key)) return fail('Canopies go over a door or window.')
      if (!outsideSide(grid, [op.x, op.z, op.v])) return fail('Canopies go on the outside of the house.')
      if (others.some(f => f.kind === 'canopy' && f.x === op.x && f.z === op.z && f.v === op.v)) return fail('That opening already has a canopy.')
      feature.v = op.v
      feature.width = Math.max(1, Math.min(3, Math.round(op.width ?? 1)))
      break
    }
    case 'porch':
    case 'pergola': {
      if (op.x2 === undefined || op.z2 === undefined) return fail('Drag out an area.')
      const [x0, z0, x1, z1] = rectOf({ x: op.x, z: op.z, x2: op.x2, z2: op.z2 })
      if (!inLot(x0, z0) || !inLot(x1, z1)) return fail('Keep it on the lot.')
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 80) return fail('That is too big. Keep it under 80 tiles.')
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (grid.isInside(x, z)) return fail('Porches and pergolas go outside.')
      const overlap = others.some(f => (f.kind === 'porch' || f.kind === 'pergola') && (() => { const [a, b, c, d] = rectOf(f); return a <= x1 && c >= x0 && b <= z1 && d >= z0 })())
      if (overlap) return fail('That overlaps another porch or pergola.')
      if (op.kind === 'porch') {
        let touches = false
        for (let x = x0; x <= x1 && !touches; x++) for (let z = z0; z <= z1 && !touches; z++) {
          if ((z === z0 && grid.isWall(x, z0, 0)) || (z === z1 && grid.isWall(x, z1 + 1, 0)) || (x === x0 && grid.isWall(x0, z, 1)) || (x === x1 && grid.isWall(x1 + 1, z, 1))) touches = true
        }
        if (!touches) return fail('A porch roof has to meet a wall of the house.')
      }
      feature.x = x0; feature.z = z0; feature.x2 = x1; feature.z2 = z1
      break
    }
    case 'fence': {
      if (op.x2 === undefined || op.z2 === undefined) return fail('Drag along the grid.')
      if (op.x !== op.x2 && op.z !== op.z2) return fail('Fences run straight along the grid.')
      const edges = lineWalls(op.x, op.z, op.x2, op.z2)
      if (!edges.length || edges.some(([x, z, v]) => !validEdge(x, z, v))) return fail('Keep the fence on the lot.')
      if (op.style === 'gate' && edges.length !== 1) return fail('A gate is one tile wide.')
      for (const e of edges) {
        if (grid.isWall(...e)) return fail('There is a wall there.')
        const tiles = edgeTiles(e)
        if (tiles.some(t => grid.inside[t])) return fail('Fences go in the yard.')
        if (splitsObject(grid, e)) return fail('That fence would cut through something.')
      }
      const taken = new Set(others.filter(f => f.kind === 'fence').flatMap(f => featureEdges(f).map(([x, z, v]) => edgeKey(x, z, v))))
      if (edges.some(([x, z, v]) => taken.has(edgeKey(x, z, v)))) return fail('There is already a fence there.')
      feature.x2 = op.x2; feature.z2 = op.z2
      break
    }
    case 'chimney': {
      if (!grid.isInside(op.x, op.z)) return fail('A chimney goes on a tile inside the house.')
      if (others.filter(f => f.kind === 'chimney').length >= 3) return fail('Three chimneys is plenty.')
      if (others.some(f => f.kind === 'chimney' && f.x === op.x && f.z === op.z)) return fail('There is already a chimney there.')
      break
    }
  }
  const cost = featureCost(feature)
  if (cost > funds) return fail('Not enough money for that.')
  state.features = [...others, feature]
  state.nextFeatureId++
  return { ok: true, cost, tiles: featureTiles(feature) }
}

export { placementError }
