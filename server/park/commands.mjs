import { FLAT_RIDES, WAVE_SETTINGS, COASTER_STYLES, COASTER_PRESETS, STALLS, SCENERY, STAFF, COSTS, PATH_ADDITIONS } from './catalog.mjs'
import { autoComplete } from './autotrack.mjs'
import { DIRS, UNIT, clamp } from './util.mjs'
import { terrainEdit, tilesTouchingCorners, tileIndex, inMap, tileSlope, tileMin, tileMax, tileCorners, pathHeightAt, PATH_STEP_LIMIT, STAIR_STEP_LIMIT, SLOPE_RISE, STAIR_RISE } from './terrain.mjs'
import { isWalkPath } from './terrain.mjs'
import { nextPathOrder } from './queues.mjs'
import { validatePiece, addRideCells, removeRideCells, makeTrain, rideStatsFromRun, trackPoses, pieceLengthTiles, CAR_GAP, kartLimit, kartLanes, kartCount, kartRestS, PATH_DECK_CLEARANCE, tunnelOpenAt } from './track.mjs'
import { footprintTiles, addNews, entityCost, ridePath, frontTile, stallFrontTile, stallFootprintError, stallPlacementRotation } from './state.mjs'
import { mechanicJobDistance } from './guests.mjs'
import { LAND_SQUARE_COST, LAND_AREA_MAX, landAreaPlan, markLandChanged } from './land.mjs'
import { flatSpec, validFlatSize } from './flatspec.mjs'
import { SCHEME_COUNT, ROLES, rideSlots, rideColors, parkSchemes, sanitizeScheme } from './palette.mjs'
import { HOTELS, HOTEL_ADDONS, HOTEL_SERVICE, HOTEL_SIZE_LIMIT, HOTEL_FLOOR_LIMIT, hotelSpec, hotelOrientedFits, hotelEntranceFor, hotelHeight, hotelRateLimits, hotelResizeCost, hotelRefurbishCost, addonCost, AMENITY_VISITS, amenityPriceLimit } from './hotels.mjs'

const MAX_RECT = 32
const INVERTED_STATION_LIFT = 7
const ok = (extra = {}) => ({ ok: true, ...extra })
const fail = error => ({ ok: false, error })
const STAFF_NAMES = {
  handyman: ['Al', 'Bea', 'Cal', 'Dot', 'Ed', 'Flo', 'Gil', 'Hal'],
  mechanic: ['Ike', 'Jo', 'Kip', 'Lou', 'Mo', 'Ned', 'Ola', 'Pat'],
  entertainer: ['Pip', 'Ziggy', 'Bubbles', 'Sparky', 'Twirl', 'Jingles', 'Doodle', 'Wobble'],
  security: ['Ash', 'Blake', 'Casey', 'Drew', 'Ellis', 'Frankie', 'Gray', 'Harper'],
  supervisor: ['Alex', 'Bailey', 'Cameron', 'Devon', 'Emery', 'Finley', 'Jordan', 'Kai'],
  ems: ['Ari', 'Billie', 'Cory', 'Dana', 'Eden', 'Frankie', 'Gale', 'Hayden'],
}

export const MARKETING = {
  flyers: { name: 'Flyer handout', cost: 500, days: 7, boost: 1.35 },
  radio: { name: 'Radio spots', cost: 1600, days: 14, boost: 1.7 },
  billboard: { name: 'Billboards', cost: 3200, days: 28, boost: 1.55 },
}

function rect(cmd, map) {
  const x0 = clamp(Math.round(Math.min(cmd.x0, cmd.x1)), 0, map.w - 1), x1 = clamp(Math.round(Math.max(cmd.x0, cmd.x1)), 0, map.w - 1)
  const y0 = clamp(Math.round(Math.min(cmd.y0, cmd.y1)), 0, map.h - 1), y1 = clamp(Math.round(Math.max(cmd.y0, cmd.y1)), 0, map.h - 1)
  if (![x0, x1, y0, y1].every(Number.isFinite)) return null
  if (x1 - x0 >= MAX_RECT || y1 - y0 >= MAX_RECT) return null
  return { x0, y0, x1, y1 }
}

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max
const sandbox = state => state.scenario === 'sandbox'

export function canAfford(state, park, cost) {
  return sandbox(state) || state.parks[park].cash >= cost
}

export function spend(state, park, cost, category) {
  const p = state.parks[park]
  p.cash -= cost
  p.month[category] = (p.month[category] ?? 0) - cost
}

function owned(state, park, x, y) {
  return inMap(state.map, x, y) && state.map.owner[tileIndex(state.map, x, y)] === park
}

function isWater(map, i, x, y) {
  return map.water[i] >= 0 && map.water[i] > tileMin(map, x, y)
}

function lowTrack(state, ti, clearance) {
  const ground = tileMax(state.map, ti % state.map.w, Math.floor(ti / state.map.w))
  return (state.trackCells.get(ti) ?? []).some(cell => cell.lo < ground + clearance)
}

function structural(state) { state.structVersion++ }
function pathsChanged(state) { state.pathVersion++; state.fields.clear(); structural(state) }

function removeEntity(state, entity) {
  for (const [x, y] of footprintTiles(entity)) {
    const i = tileIndex(state.map, x, y)
    if (state.map.obj[i] === entity.id) state.map.obj[i] = 0
  }
  delete state.entities[entity.id]
}

// Height of the corner a Level land drag started from: the outer corner of the
// start tile when the drag began at an edge of the area, otherwise the tile's
// rounded average. Null when no start tile was sent (older clients).
export function levelStartHeight(map, r, sx, sy) {
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || sx < r.x0 || sx > r.x1 || sy < r.y0 || sy > r.y1) return null
  const w = map.w + 1, c = (x, y) => map.corners[y * w + x]
  const edgeX = r.x0 !== r.x1 && (sx === r.x0 || sx === r.x1), edgeY = r.y0 !== r.y1 && (sy === r.y0 || sy === r.y1)
  if (edgeX || edgeY) {
    const cx = sx === r.x1 && r.x0 !== r.x1 ? sx + 1 : sx
    const cy = sy === r.y1 && r.y0 !== r.y1 ? sy + 1 : sy
    if (edgeX && edgeY) return c(cx, cy)
    // Dragged along one axis: use the lower of the two corners on the start edge.
    return edgeX ? Math.min(c(cx, sy), c(cx, sy + 1)) : Math.min(c(sx, cy), c(sx + 1, cy))
  }
  return Math.round((c(sx, sy) + c(sx + 1, sy) + c(sx, sy + 1) + c(sx + 1, sy + 1)) / 4)
}

export function terrainPlan(state, park, r, op, levelTo = null) {
  const map = state.map
  const changes = terrainEdit(map, r.x0, r.y0, r.x1, r.y1, op, levelTo)
  if (!changes) return { error: 'The land cannot go any higher or lower here.' }
  if (!changes.size) return { error: 'The land is already level.' }
  const tiles = tilesTouchingCorners(map, changes.keys())
  const saved = new Map()
  for (const [id, value] of changes) { saved.set(id, map.corners[id]); map.corners[id] = value }
  let error = null
  const removeScenery = []
  try {
    for (const ti of tiles) {
      const x = ti % map.w, y = Math.floor(ti / map.w)
      if (map.owner[ti] !== park) { error = 'You can only reshape land your park owns.'; break }
      const objId = map.obj[ti]
      if (objId) {
        const entity = state.entities[objId]
        if (entity?.type === 'scenery') removeScenery.push(entity)
        else { error = 'Something is built here. Demolish it before reshaping the land.'; break }
      }
      if (map.path[ti] && tileSlope(map, x, y).dir === -2) { error = 'That would make a footpath too steep.'; break }
      const cells = state.trackCells.get(ti) ?? []
      const top = tileMax(map, x, y)
      if (cells.some(cell => cell.lo + 0.55 < top)) { error = 'Coaster track is in the way.'; break }
    }
  } finally {
    for (const [id, value] of saved) map.corners[id] = value
  }
  if (error) return { error }
  return { changes, tiles, removeScenery, cost: changes.size * COSTS.terrain }
}

function applyTerrainPlan(state, park, plan) {
  const map = state.map
  for (const [id, value] of plan.changes) map.corners[id] = value
  for (const entity of plan.removeScenery) removeEntity(state, entity)
  for (const ti of plan.tiles) {
    const x = ti % map.w, y = Math.floor(ti / map.w)
    if (map.water[ti] >= 0 && map.water[ti] <= tileMin(map, x, y)) map.water[ti] = -1
  }
  spend(state, park, plan.cost, 'landscaping')
  pathsChanged(state)
}

function nextName(state, base) {
  let n = 1
  const names = new Set(Object.values(state.entities).filter(e => e.type === 'ride').map(e => e.name))
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export function ejectRide(state, ride) {
  const exitGate = state.entities[ride.exit]
  const ids = new Set([...(ride.queue ?? []), ...(ride.riders ?? []), ...(ride.trains ?? []).flatMap(t => t.riders)])
  for (const guest of state.guests) {
    if (!ids.has(guest.id)) continue
    guest.state = 'walk'; guest.target = null; guest.ride = 0
    if (guest.hidden || exitGate) {
      const spot = exitGate ? frontTile(exitGate) : { x: guest.tx, y: guest.ty }
      guest.tx = spot.x; guest.ty = spot.y; guest.x = spot.x + 0.5; guest.y = spot.y + 0.5; guest.nx = -1
    }
    guest.hidden = false
  }
  ride.queue = []; ride.riders = []
  if (ride.trains) for (const t of ride.trains) t.riders = []
}

export function stationTiles(state, ride) {
  if (ride.kind !== 'coaster') return []
  const poses = trackPoses(ride), tiles = []
  ride.pieces.forEach((piece, index) => {
    if (piece.sp !== 'station') return
    const pose = poses[index], [dx, dy] = DIRS[pose.dir], x = Math.floor(pose.x + dx * 0.5), y = Math.floor(pose.y + dy * 0.5)
    tiles.push([x, y, pose.dir])
    if (COASTER_STYLES[ride.style]?.wide) { const [sx, sy] = DIRS[(pose.dir + 1) % 4]; tiles.push([x + sx, y + sy, pose.dir]) }
  })
  return tiles
}

function uniqueName(state, base, self) {
  const names = new Set(Object.values(state.entities).filter(e => e.type === 'ride' && e.id !== self).map(e => e.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

function markStations(state, ride) {
  const map = state.map
  for (let i = 0; i < map.obj.length; i++) if (map.obj[i] === ride.id) map.obj[i] = 0
  for (const [x, y] of stationTiles(state, ride)) if (inMap(map, x, y)) map.obj[tileIndex(map, x, y)] = ride.id
}

function leadingStations(ride) {
  let k = 0
  while (k < ride.pieces.length && ride.pieces[k].sp === 'station') k++
  return k
}

function addPieces(state, ride, park, pieces) {
  let total = 0
  const checked = []
  for (const piece of pieces) {
    const result = validatePiece(state, ride, piece)
    if (!result.ok) { ride.pieces.length -= checked.length; return { error: result.error } }
    ride.pieces.push({ ...result.piece, k: result.cost })
    checked.push(result)
    total += result.cost
  }
  ride.pieces.length -= checked.length
  if (!canAfford(state, park, total)) return { error: `You need $${total.toLocaleString('en-US')} to build that much track.` }
  pieces.forEach((piece, i) => ride.pieces.push({ ...checked[i].piece, k: checked[i].cost }))
  removeRideCells(state, ride.id)
  addRideCells(state, ride)
  ride.spent = (ride.spent ?? 0) + total
  spend(state, park, total, 'construction')
  markStations(state, ride)
  if (checked[checked.length - 1]?.closes) finishCoaster(state, ride)
  pathsChanged(state)
  return { cost: total }
}

function rideTiles(state, ride) {
  return ride.kind === 'flat' ? footprintTiles(ride) : stationTiles(state, ride)
}

function finishCoaster(state, ride) {
  ride.complete = true
  ride.rev = (ride.rev ?? 0) + 1
  const style = COASTER_STYLES[ride.style]
  const stationLength = ride.pieces.filter(p => p.sp === 'station').length
  ride.cars = style.trackType === 'kart' ? (ride.carsSet ? clamp(ride.cars, 1, kartLimit(ride.style)) : kartCount(stationLength, ride.style)) : ride.carsSet ? clamp(ride.cars, 1, 10) : clamp(stationLength + 1, 2, 10)
  const path = ridePath(state, ride)
  const stats = path ? rideStatsFromRun(path, style, style.trackType === 'kart' ? 1 : ride.cars) : { valid: false }
  ride.stats = stats
  ride.trains = style.trackType === 'kart'
    ? Array.from({ length: ride.cars }, (_, index) => {
      const kart = makeTrain()
      if (path) kart.s = kartRestS(path, index, kartLanes(ride.style))
      kart.pace = 0.94 + (index % 7) * 0.02
      return kart
    })
    : Array.from({ length: style.trackType ? 1 : 2 }, (_, index) => {
      const train = makeTrain()
      if (path) {
        const rest = Math.max(0.5, path.stationEnd - 0.6)
        train.s = index ? rest - (ride.cars - 1) * CAR_GAP - CAR_GAP : rest
        if (index) { train.phase = 'waiting'; train.waitS = train.s }
      }
      return train
    })
  if (path && style.trackType !== 'kart') ride.trains[0].s = Math.max(0.5, path.stationEnd - 0.6)
  const label = style.category === 'other' ? 'track ride' : 'coaster'
  addNews(state, ride.park, stats.valid ? `${ride.name} passed its test run. Excitement ${stats.e.toFixed(2)}, intensity ${stats.i.toFixed(2)}, nausea ${stats.n.toFixed(2)}.` : `${ride.name} failed its test run: the ${label} could not complete its circuit. Adjust the route and try again.`, stats.valid ? 'ride' : 'warning', ride.id)
}

export function applyCommand(state, cmd, park = 0) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string') return fail('Unknown action.')
  if (!state.parks[park]) return fail('You are not managing a park.')
  if (!state.parks[park].named && !(cmd.t === 'park' && typeof cmd.name === 'string' && cmd.name.trim().length >= 2)) return fail('Name your park before you start building.')
  if (state.ended && !['speed', 'rideSet', 'stallSet', 'park'].includes(cmd.t)) return fail('This match has ended.')
  const handler = HANDLERS[cmd.t]
  if (!handler) return fail('Unknown action.')
  return handler(state, cmd, park)
}

const HANDLERS = {
  buyLand(state, cmd, park) {
    const map = state.map, land = state.parks[park].land
    if (!land) return fail('Land purchases are unavailable in this park.')
    if (!isInt(cmd.x, 0, map.w - 1) || !isInt(cmd.y, 0, map.h - 1)) return fail('Choose a square of land to purchase.')
    const { x, y } = cmd, i = tileIndex(map, x, y), limit = land.limit
    if (x < limit.x0 || x > limit.x1 || y < limit.y0 || y > limit.y1) return fail('That square is outside the expansion area.')
    if (map.owner[i] !== 255) return fail('That square is already owned.')
    const adjacent = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .some(([nx, ny]) => inMap(map, nx, ny) && map.owner[tileIndex(map, nx, ny)] === park)
    if (!adjacent) return fail('Purchase land next to your existing park.')
    if (!canAfford(state, park, LAND_SQUARE_COST)) return fail(`You need $${LAND_SQUARE_COST} to purchase this square.`)
    const existing = state.entities[map.obj[i]]
    if (existing && existing.type !== 'scenery') return fail('Something is already built on that square.')
    if (existing) removeEntity(state, existing)
    map.owner[i] = park
    markLandChanged(state)
    spend(state, park, LAND_SQUARE_COST, 'landscaping')
    pathsChanged(state)
    return ok({ cost: LAND_SQUARE_COST })
  },

  buyLandArea(state, cmd, park) {
    const map = state.map
    if (!['x0', 'y0', 'x1', 'y1'].every(key => isInt(cmd[key], 0, Math.max(map.w, map.h) - 1))) return fail('Drag over the land you want to purchase.')
    if (Math.abs(cmd.x1 - cmd.x0) >= LAND_AREA_MAX || Math.abs(cmd.y1 - cmd.y0) >= LAND_AREA_MAX) return fail(`Buy up to ${LAND_AREA_MAX} by ${LAND_AREA_MAX} squares at a time.`)
    const plan = landAreaPlan(state, park, cmd)
    if (plan.error) return fail(plan.error)
    if (!canAfford(state, park, plan.cost)) return fail(`You need $${plan.cost.toLocaleString('en-US')} to purchase ${plan.tiles.length} squares.`)
    for (const i of plan.tiles) {
      const existing = state.entities[map.obj[i]]
      if (existing) removeEntity(state, existing)
      map.owner[i] = park
    }
    markLandChanged(state)
    spend(state, park, plan.cost, 'landscaping')
    pathsChanged(state)
    return ok({ cost: plan.cost, count: plan.tiles.length })
  },

  terrain(state, cmd, park) {
    const r = rect(cmd, state.map)
    if (!r || !['raise', 'lower', 'level'].includes(cmd.op)) return fail('Choose an area of land to reshape.')
    const levelTo = cmd.op === 'level' ? levelStartHeight(state.map, r, cmd.sx, cmd.sy) : null
    const plan = terrainPlan(state, park, r, cmd.op, levelTo)
    if (plan.error) return fail(plan.error)
    if (!canAfford(state, park, plan.cost)) return fail(`You need $${plan.cost} to do that.`)
    applyTerrainPlan(state, park, plan)
    return ok({ cost: plan.cost })
  },

  surface(state, cmd, park) {
    const r = rect(cmd, state.map)
    if (!r || !isInt(cmd.surface, 0, 4)) return fail('Choose a ground texture.')
    let count = 0
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = tileIndex(state.map, x, y)
      if (state.map.owner[i] !== park || state.map.surface[i] === cmd.surface) continue
      state.map.surface[i] = cmd.surface; count++
    }
    if (!count) return fail('Nothing to repaint on land you own.')
    spend(state, park, count * COSTS.paint, 'landscaping')
    structural(state)
    return ok()
  },

  water(state, cmd, park) {
    const r = rect(cmd, state.map)
    if (!r || !['raise', 'lower'].includes(cmd.op)) return fail('Choose an area for water.')
    const map = state.map
    let level = -1
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = tileIndex(map, x, y)
      level = Math.max(level, isWater(map, i, x, y) ? map.water[i] : tileMin(map, x, y))
    }
    const target = cmd.op === 'raise' ? level + 1 : level - 1
    if (target > 38) return fail('Water cannot rise any higher.')
    const touched = []
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = tileIndex(map, x, y)
      if (map.owner[i] !== park) continue
      const floor = tileMin(map, x, y)
      if (target > floor) {
        if (map.path[i]) return fail('Remove the footpaths before flooding this area.')
        const entity = state.entities[map.obj[i]]
        if (entity && entity.type !== 'scenery') return fail('Something is built here. Demolish it first.')
        if ((state.trackCells.get(i) ?? []).some(cell => cell.lo < target)) return fail('Coaster track is in the way.')
        touched.push([i, target])
      } else if (map.water[i] >= 0) touched.push([i, -1])
    }
    if (!touched.length) return fail('There is no water to change here.')
    const cost = touched.length * COSTS.water
    if (!canAfford(state, park, cost)) return fail(`You need $${cost} to do that.`)
    for (const [i, value] of touched) {
      map.water[i] = value
      const entity = state.entities[map.obj[i]]
      if (value >= 0 && entity?.type === 'scenery') removeEntity(state, entity)
    }
    spend(state, park, cost, 'landscaping')
    pathsChanged(state)
    return ok({ cost })
  },

  path(state, cmd, park) {
    const r = rect(cmd, state.map)
    const kind = [1, 2, 3, 4].includes(cmd.kind) ? cmd.kind : 0
    const elevation = cmd.elevation === undefined ? 0 : cmd.elevation
    if (!r || !kind || !isInt(elevation, 0, 24) || cmd.color !== undefined && !isInt(cmd.color, 0, 0xffffff)) return fail('Choose a path type, height, and where to lay it.')
    const map = state.map, tiles = []
    let blocked = null
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = tileIndex(map, x, y)
      if (map.path[i] === kind && (map.pathElevation[i] ?? 0) === elevation) continue
      if (map.owner[i] !== park) { blocked = 'You can only build on land your park owns.'; continue }
      const base = Math.max(tileMax(map, x, y), map.water[i] >= 0 ? map.water[i] + 0.1 : -Infinity)
      const pathBase = base + elevation * UNIT
      if (isWater(map, i, x, y) && kind !== 4 && elevation === 0) { blocked = 'Only boardwalks or raised paths can be built over water.'; continue }
      if (isWater(map, i, x, y) && pathBase < map.water[i] + 0.1) { blocked = 'Raise the path above the water or use a boardwalk.'; continue }
      if (kind !== 3 && elevation === 0 && kind !== 4 && tileSlope(map, x, y).dir === -2) { blocked = 'The land is too steep for this path. Use stairs or smooth it first.'; continue }
      const entity = map.obj[i] ? state.entities[map.obj[i]] : null
      if (entity) {
        const clearance = entity.type === 'scenery' ? SCENERY[entity.kind]?.height ?? 3
          : entity.type === 'ride' ? entity.kind === 'flat' ? FLAT_RIDES[entity.ride]?.height ?? 6 : 0
            : entity.type === 'hotel' ? hotelHeight(entity) : entity.type === 'stall' ? entity.kind === 'souvenir' ? 5 : entity.kind === 'toilet' ? 3.5 : 3.2
              : entity.type === 'parkEntrance' ? 7 : 2.8
        let lowestPathHeight = pathBase
        if (kind === 3 && elevation > 0) for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy
          if (!inMap(map, nx, ny) || !map.path[tileIndex(map, nx, ny)]) continue
          lowestPathHeight = Math.min(lowestPathHeight, pathHeightAt(map, (nx + 0.5) * 4, (ny + 0.5) * 4))
        }
        if (lowestPathHeight < tileMax(map, x, y) + clearance + 1.2) { blocked = entity.type === 'scenery' ? 'Scenery is too tall for the path. Clear it or raise the path.' : 'Something is too tall for the path. Raise it higher.'; continue }
      }
      if (tunnelOpenAt(state, i)) { blocked = 'A tunnel opening is here. Paths cannot cross it.'; continue }
      if ((state.trackCells.get(i) ?? []).some(cell => cell.lo < pathBase + 2.6 && cell.hi > pathBase - PATH_DECK_CLEARANCE)) { blocked = 'Track is in the way. Raise the path over it or leave 2.6m of headroom under it.'; continue }
      let disconnected = false
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy
        if (!inMap(map, nx, ny)) continue
        const ni = tileIndex(map, nx, ny)
        if (!map.path[ni]) continue
        const neighbor = pathHeightAt(map, (nx + 0.5) * 4, (ny + 0.5) * 4)
        const maxStep = kind === 3 || map.path[ni] === 3 ? STAIR_STEP_LIMIT : PATH_STEP_LIMIT
        if (Math.abs(pathBase - neighbor) > maxStep) disconnected = true
      }
      if (disconnected) { blocked = 'Connect different path heights with stairs.'; continue }
      tiles.push(i)
    }
    if (!tiles.length) return fail(blocked ?? 'There is already a path here.')
    const cost = tiles.length * ({ 1: COSTS.path, 2: COSTS.queue, 3: 18, 4: 24 }[kind])
    if (!canAfford(state, park, cost)) return fail(`You need $${cost} to build that.`)
    const startX = clamp(Math.round(cmd.x0), 0, map.w - 1), startY = clamp(Math.round(cmd.y0), 0, map.h - 1)
    const fromStart = i => Math.abs(i % map.w - startX) + Math.abs(Math.floor(i / map.w) - startY)
    tiles.sort((a, b) => fromStart(a) - fromStart(b) || a - b)
    let order = nextPathOrder(map)
    for (const i of tiles) { map.path[i] = kind; map.pathElevation[i] = elevation; map.pathColor[i] = kind === 1 ? cmd.color ?? -1 : -1; map.pathOrder[i] = order++; if (kind === 2) map.pathAdd[i] = 0 }
    spend(state, park, cost, 'construction')
    pathsChanged(state)
    return ok({ cost, warning: blocked })
  },

  // Auto-finish for the path builder: carry a raised walkway or stairway on from
  // its last tile, stepping down with stairs and gentle slopes until it reaches
  // the ground or meets an existing path. A sloped piece stores its high end and
  // ramps down to the piece after it, so turns only happen after a flat piece.
  // Searches straight ahead first, then turns, backing out of dead ends.
  // All or nothing: if no way down is found, nothing is built.
  pathFinish(state, cmd, park) {
    const map = state.map
    if (!isInt(cmd.x, 0, map.w - 1) || !isInt(cmd.y, 0, map.h - 1) || !isInt(cmd.dir, 0, 3) || ![1, 2, 4].includes(cmd.kind) || cmd.color !== undefined && !isInt(cmd.color, 0, 0xffffff)) return fail('Choose the end of a path to finish from.')
    if (cmd.exit !== undefined && (typeof cmd.exit !== 'number' || !Number.isFinite(cmd.exit))) return fail('Choose the end of a path to finish from.')
    const start = tileIndex(map, cmd.x, cmd.y)
    if (!map.path[start] || map.owner[start] !== park) return fail('Start from the end of one of your paths.')
    const edgeHeight = (x, y, d, inset = 0.02) => pathHeightAt(map, (x + 0.5 + DIRS[d][0] * (0.5 - inset)) * 4, (y + 0.5 + DIRS[d][1] * (0.5 - inset)) * 4)
    const startExit = cmd.exit ?? edgeHeight(cmd.x, cmd.y, cmd.dir)
    const nextX = cmd.x + DIRS[cmd.dir][0], nextY = cmd.y + DIRS[cmd.dir][1]
    const nextGround = inMap(map, nextX, nextY) ? tileMax(map, nextX, nextY) : -Infinity
    if (startExit <= nextGround + 0.05 && map.path[start] !== 4 && (map.pathElevation[start] ?? 0) === 0) return fail('This path is already on the ground.')
    const p = state.parks[park]
    const saved = new Map()
    const before = { cash: p.cash, construction: p.month.construction, structVersion: state.structVersion, pathVersion: state.pathVersion }
    const touch = i => { if (!saved.has(i)) saved.set(i, [map.path[i], map.pathElevation[i], map.pathColor[i], map.pathAdd[i], map.pathOrder[i]]) }
    const rollback = () => {
      for (const [i, [kind, elevation, color, add, order]] of saved) { map.path[i] = kind; map.pathElevation[i] = elevation; map.pathColor[i] = color; map.pathAdd[i] = add; map.pathOrder[i] = order }
      p.cash = before.cash; p.month.construction = before.construction
      state.structVersion = before.structVersion; state.pathVersion = before.pathVersion; state.fields.clear()
    }
    const visited = new Set([start])
    let budget = 3000, cost = 0, pieces = 0
    const place = (ni, nx, ny, kind, elevation) => {
      const was = [map.path[ni], map.pathElevation[ni], map.pathColor[ni], map.pathAdd[ni], map.pathOrder[ni]], cash = p.cash, construction = p.month.construction
      touch(ni)
      const res = HANDLERS.path(state, { t: 'path', kind, elevation, color: cmd.color, x0: nx, y0: ny, x1: nx, y1: ny }, park)
      if (!res.ok) return null
      return () => { map.path[ni] = was[0]; map.pathElevation[ni] = was[1]; map.pathColor[ni] = was[2]; map.pathAdd[ni] = was[3]; map.pathOrder[ni] = was[4]; p.cash = cash; p.month.construction = construction; state.fields.clear() }
    }
    const search = (x, y, dir, exit, sloped, depth) => {
      if (--budget < 0 || depth > 96) return false
      const turns = sloped ? [0] : [0, 1, 3]
      for (const turn of turns) {
        const d = (dir + turn) % 4, nx = x + DIRS[d][0], ny = y + DIRS[d][1]
        if (!inMap(map, nx, ny)) continue
        const ni = tileIndex(map, nx, ny)
        if (visited.has(ni) || !map.path[ni] || map.owner[ni] !== park) continue
        const back = (d + 2) % 4
        if (Math.abs(edgeHeight(nx, ny, back) - exit) <= 0.3) return true
      }
      const options = []
      for (const turn of turns) {
        const d = (dir + turn) % 4, nx = x + DIRS[d][0], ny = y + DIRS[d][1]
        if (!inMap(map, nx, ny)) continue
        const ni = tileIndex(map, nx, ny)
        if (visited.has(ni) || map.path[ni]) continue
        const base = Math.max(tileMax(map, nx, ny), map.water[ni] >= 0 ? map.water[ni] + 0.1 : -Infinity)
        const above = exit - base
        if (above < -0.05) continue
        const over = isWater(map, ni, nx, ny)
        if (above >= STAIR_RISE - 0.01) options.push({ d, nx, ny, ni, kind: 3, elevation: Math.round(above / UNIT), drop: STAIR_RISE, rank: 0 })
        if (above >= SLOPE_RISE - 0.01) options.push({ d, nx, ny, ni, kind: cmd.kind, elevation: Math.round(above / UNIT), drop: SLOPE_RISE, rank: above >= STAIR_RISE - 0.01 ? 2 : 0 })
        if (above < SLOPE_RISE - 0.01) options.push({ d, nx, ny, ni, kind: over ? 4 : cmd.kind, elevation: 0, drop: 0, rank: 0, ground: true })
        else if (!sloped || turn === 0) options.push({ d, nx, ny, ni, kind: cmd.kind, elevation: Math.round(above / UNIT), drop: 0, rank: 3 })
      }
      options.sort((a, b) => a.rank - b.rank)
      for (const o of options) {
        if (o.elevation < 0 || o.elevation > 24) continue
        const undo = place(o.ni, o.nx, o.ny, o.kind, o.elevation)
        if (!undo) continue
        visited.add(o.ni)
        if (o.ground) return true
        if (search(o.nx, o.ny, o.d, exit - o.drop, o.drop > 0, depth + 1)) return true
        visited.delete(o.ni)
        undo()
      }
      return false
    }
    if (!search(cmd.x, cmd.y, cmd.dir, startExit, Boolean(cmd.sloped), 0)) {
      rollback()
      return fail(budget < 0 ? 'The path is too high to finish automatically. Build more of it by hand first.' : 'There is no clear way down from here. Turn the path or clear the way, then try again.')
    }
    for (const [i] of saved) if (map.path[i] && visited.has(i)) pieces++
    cost = before.cash - p.cash
    pathsChanged(state)
    return ok({ cost, pieces })
  },

  pathPaint(state, cmd, park) {
    const r = rect(cmd, state.map)
    if (!r || !isInt(cmd.color, 0, 0xffffff)) return fail('Choose a footpath color and area to paint.')
    const map = state.map
    let count = 0
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = tileIndex(map, x, y)
      if (map.path[i] !== 1 || map.owner[i] !== park || map.pathColor[i] === cmd.color) continue
      map.pathColor[i] = cmd.color
      count++
    }
    if (!count) return fail('Choose ordinary footpaths in your park to recolor.')
    pathsChanged(state)
    return ok()
  },

  unpath(state, cmd, park) {
    const r = rect(cmd, state.map)
    if (!r) return fail('Choose a path to remove.')
    const map = state.map
    let count = 0
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = tileIndex(map, x, y)
      if (!map.path[i] || map.owner[i] !== park) continue
      map.path[i] = 0; map.pathElevation[i] = 0; map.pathColor[i] = -1; map.pathAdd[i] = 0; map.pathOrder[i] = 0; map.litter[i] = 0; count++
    }
    if (!count) return fail('There is no footpath of yours here.')
    pathsChanged(state)
    return ok()
  },

  pathAdd(state, cmd, park) {
    const { x, y } = cmd
    if (!isInt(x, 0, state.map.w - 1) || !isInt(y, 0, state.map.h - 1) || !PATH_ADDITIONS[cmd.add]) return fail('Choose a footpath tile.')
    const i = tileIndex(state.map, x, y)
    if (state.map.owner[i] !== park) return fail('You can only build in your own park.')
    if (state.map.path[i] !== 1) return fail('Benches, bins and lamps go on ordinary footpaths.')
    if (state.map.pathAdd[i] === cmd.add) return fail('That is already here.')
    const cost = PATH_ADDITIONS[cmd.add].cost
    if (!canAfford(state, park, cost)) return fail(`You need $${cost}.`)
    state.map.pathAdd[i] = cmd.add
    spend(state, park, cost, 'construction')
    structural(state)
    return ok({ cost })
  },

  scenery(state, cmd, park) {
    const def = SCENERY[cmd.kind]
    const { x, y } = cmd
    if (!def || !isInt(x, 0, state.map.w - 1) || !isInt(y, 0, state.map.h - 1)) return fail('Choose a scenery item and a tile.')
    const i = tileIndex(state.map, x, y)
    if (state.map.owner[i] !== park) return fail('You can only build on land your park owns.')
    if (state.map.obj[i] || state.map.path[i]) return fail('This tile is occupied.')
    if (isWater(state.map, i, x, y)) return fail('Scenery cannot go in water.')
    if (lowTrack(state, i, def.height + 0.5)) return fail('Coaster track is in the way.')
    if (!canAfford(state, park, def.cost)) return fail(`You need $${def.cost}.`)
    const id = state.nextId++
    state.entities[id] = { id, type: 'scenery', kind: cmd.kind, x, y, rot: isInt(cmd.rot, 0, 3) ? cmd.rot : 0, park }
    state.map.obj[i] = id
    spend(state, park, def.cost, 'landscaping')
    structural(state)
    return ok({ id, cost: def.cost })
  },

  clear(state, cmd, park) {
    const r = rect(cmd, state.map)
    if (!r) return fail('Choose an area to clear.')
    let count = 0
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = tileIndex(state.map, x, y)
      const entity = state.entities[state.map.obj[i]]
      if (entity?.type === 'scenery' && state.map.owner[i] === park) { removeEntity(state, entity); count++ }
    }
    if (!count) return fail('There is no scenery to clear here.')
    const cost = count * 4
    spend(state, park, cost, 'landscaping')
    structural(state)
    return ok({ cost })
  },

  stall(state, cmd, park) {
    const def = STALLS[cmd.kind]
    const { x, y } = cmd
    if (!def || !isInt(x, 0, state.map.w - 1) || !isInt(y, 0, state.map.h - 1) || !isInt(cmd.rot, 0, 3)) return fail('Choose a stall and a tile.')
    const stall = { type: 'stall', kind: cmd.kind, x, y, size: def.size ?? [1, 1] }
    const rot = stallPlacementRotation(state, park, stall, cmd.rot)
    if (rot === null) return fail(stallFootprintError(state, park, stall, cmd.rot) ?? 'The shop would not fit here.')
    if (!canAfford(state, park, def.cost)) return fail(`You need $${def.cost}.`)
    const id = state.nextId++
    const entity = state.entities[id] = { id, ...stall, rot, park, price: def.price, open: true, sales: 0, revenue: 0, name: def.name, built: state.time.seconds }
    for (const [tx, ty] of footprintTiles(entity)) state.map.obj[tileIndex(state.map, tx, ty)] = id
    spend(state, park, def.cost, 'construction')
    pathsChanged(state)
    const front = stallFrontTile(entity)
    const facesPath = inMap(state.map, front.x, front.y) && isWalkPath(state.map.path[tileIndex(state.map, front.x, front.y)])
    return ok({ id, cost: def.cost, warning: facesPath ? null : 'The counter is not facing a footpath yet. Guests can only buy from the front.' })
  },

  flat(state, cmd, park) {
    const def = FLAT_RIDES[cmd.ride]
    if (!def || !isInt(cmd.x, 0, state.map.w - 1) || !isInt(cmd.y, 0, state.map.h - 1) || !isInt(cmd.rot, 0, 3)) return fail('Choose a ride and where to place it.')
    if (def.custom?.retired) return fail(`${def.name} is no longer available to build.`)
    const sizing = def.resize && (cmd.w !== undefined || cmd.h !== undefined)
    if (sizing && !validFlatSize(def, cmd.w, cmd.h)) return fail(`${def.name} can be ${def.resize.min[0]}×${def.resize.min[1]} to ${def.resize.max[0]}×${def.resize.max[1]} squares.`)
    if (!def.resize && (cmd.w !== undefined || cmd.h !== undefined)) return fail(`${def.name} has a fixed size.`)
    if (def.waves && cmd.wave !== undefined && !WAVE_SETTINGS[cmd.wave]) return fail('Choose a wave setting.')
    const size = def.resize ? (sizing ? [cmd.w, cmd.h] : [...def.size]) : null
    const wave = def.waves ? cmd.wave ?? def.waves : null
    const spec = flatSpec(cmd.ride, size, wave)
    const probe = { type: 'ride', kind: 'flat', ride: cmd.ride, x: cmd.x, y: cmd.y, rot: cmd.rot, ...(size ? { size } : {}) }
    const tiles = footprintTiles(probe)
    const map = state.map
    for (const [x, y] of tiles) {
      if (!inMap(map, x, y)) return fail('The ride would not fit on the map.')
      const i = tileIndex(map, x, y)
      if (map.owner[i] !== park) return fail('You can only build on land your park owns.')
      if (map.path[i]) return fail('A footpath is in the way.')
      if (map.obj[i]) return fail(state.entities[map.obj[i]]?.type === 'scenery' ? 'Scenery is in the way. Use Clear Scenery first.' : 'Something is built here.')
      if (isWater(map, i, x, y)) return fail('Rides cannot be built on water.')
      if (lowTrack(state, i, def.height)) return fail('Coaster track is in the way.')
    }
    const xs = tiles.map(t => t[0]), ys = tiles.map(t => t[1])
    const r = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    let plan = null
    const heights = new Set(tiles.flatMap(([x, y]) => tileCorners(map, x, y)))
    if (heights.size > 1) {
      plan = terrainPlan(state, park, r, 'level')
      if (plan.error) return fail(`The ground must be level here. ${plan.error}`)
    }
    const cost = spec.cost + (plan?.cost ?? 0)
    if (!canAfford(state, park, cost)) return fail(`You need $${cost.toLocaleString('en-US')} to build this ride.`)
    if (plan) applyTerrainPlan(state, park, plan)
    const id = state.nextId++
    const ride = {
      id, type: 'ride', kind: 'flat', ride: cmd.ride, x: cmd.x, y: cmd.y, rot: cmd.rot, park, name: nextName(state, def.name), price: def.price, status: 'closed',
      entrance: 0, exit: 0, queue: [], riders: [], cycle: { phase: 'loading', timer: 0 }, reliability: 100, downtime: 0, revenue: 0, totalRiders: 0, monthRiders: 0,
      built: state.time.seconds, color: null, colors: null, scheme: null, stats: { valid: true, ...spec.stats }, brokenAt: 0, mechanic: 0, cycles: 0,
      ...(size ? { size } : {}), ...(wave ? { wave } : {}),
    }
    state.entities[id] = ride
    for (const [x, y] of tiles) map.obj[tileIndex(map, x, y)] = id
    spend(state, park, spec.cost, 'construction')
    pathsChanged(state)
    return ok({ id, cost })
  },

  hotel(state, cmd, park) {
    const def = HOTELS[cmd.kind]
    const map = state.map
    if (!def || !isInt(cmd.x, 0, map.w - 1) || !isInt(cmd.y, 0, map.h - 1) || !isInt(cmd.w, 1, HOTEL_SIZE_LIMIT) || !isInt(cmd.h, 1, HOTEL_SIZE_LIMIT) || !isInt(cmd.floors, 1, HOTEL_FLOOR_LIMIT)) return fail('Choose a hotel style, size and floors.')
    if (!hotelOrientedFits(def, cmd.w, cmd.h)) return fail(`${def.name} can be ${def.min.join('×')} to ${def.max.join('×')} squares.`)
    if (cmd.floors < def.floors[0] || cmd.floors > def.floors[1]) return fail(`${def.name} can have ${def.floors[0]} to ${def.floors[1]} floors.`)
    const probe = { type: 'hotel', x: cmd.x, y: cmd.y, size: [cmd.w, cmd.h], floors: cmd.floors }
    const height = hotelHeight(probe)
    const tiles = footprintTiles(probe)
    for (const [x, y] of tiles) {
      if (!inMap(map, x, y)) return fail('The hotel would not fit on the map.')
      const i = tileIndex(map, x, y)
      if (map.owner[i] !== park) return fail('You can only build on land your park owns.')
      if (map.path[i]) return fail('A footpath is in the way.')
      if (map.obj[i]) return fail(state.entities[map.obj[i]]?.type === 'scenery' ? 'Scenery is in the way. Use Clear Scenery first.' : 'Something is built here.')
      if (isWater(map, i, x, y)) return fail('Hotels cannot be built on water.')
      if (lowTrack(state, i, height)) return fail('Coaster track is in the way.')
    }
    const entrance = hotelEntranceFor(state, park, cmd.x, cmd.y, cmd.w, cmd.h)
    if (!entrance) return fail('Hotels need a footpath touching one side for their entrance.')
    const r = { x0: cmd.x, y0: cmd.y, x1: cmd.x + cmd.w - 1, y1: cmd.y + cmd.h - 1 }
    let plan = null
    const heights = new Set(tiles.flatMap(([x, y]) => tileCorners(map, x, y)))
    if (heights.size > 1) {
      plan = terrainPlan(state, park, r, 'level')
      if (plan.error) return fail(`The ground must be level here. ${plan.error}`)
    }
    const spec = hotelSpec(cmd.kind, [cmd.w, cmd.h], cmd.floors)
    const cost = spec.cost + (plan?.cost ?? 0)
    if (!canAfford(state, park, cost)) return fail(`You need $${cost.toLocaleString('en-US')} to build this hotel.`)
    if (plan) applyTerrainPlan(state, park, plan)
    const id = state.nextId++
    state.entities[id] = {
      id, type: 'hotel', kind: cmd.kind, x: cmd.x, y: cmd.y, size: [cmd.w, cmd.h], floors: cmd.floors, park, name: nextName(state, def.name),
      colors: { ...def.colors }, roof: def.roofs[0], addons: Object.fromEntries(Object.keys(HOTEL_ADDONS).map(k => [k, false])), entrance, occupancy: 0.5, revenue: 0, lastNight: 0, district: false, built: state.time.seconds,
      rate: def.rate, service: 'standard', condition: 100, profit: 0, invested: spec.cost, nights: [], night: null,
    }
    for (const [x, y] of tiles) map.obj[tileIndex(map, x, y)] = id
    spend(state, park, spec.cost, 'construction')
    pathsChanged(state)
    return ok({ id, cost })
  },

  hotelSet(state, cmd, park) {
    const hotel = state.entities[cmd.id]
    if (!hotel || hotel.type !== 'hotel' || hotel.park !== park) return fail('Choose one of your hotels.')
    const def = HOTELS[hotel.kind]
    if (typeof cmd.name === 'string') {
      const name = cmd.name.trim().slice(0, 32)
      if (name.length < 1) return fail('Give the hotel a name.')
      hotel.name = name
    }
    for (const key of ['primary', 'secondary', 'trim']) {
      if (cmd[key] === undefined) continue
      if (!isInt(cmd[key], 0, 0xffffff)) return fail('Choose a valid hotel color.')
      hotel.colors = { ...hotel.colors, [key]: cmd[key] }
    }
    if (cmd.roof !== undefined) {
      if (!def.roofs.includes(cmd.roof)) return fail('That roof does not suit this hotel.')
      hotel.roof = cmd.roof
    }
    if (cmd.addon !== undefined) {
      const addon = HOTEL_ADDONS[cmd.addon]
      if (!addon || typeof cmd.on !== 'boolean') return fail('Choose an add-on.')
      if (cmd.on && !hotel.addons[cmd.addon]) {
        const price = addonCost(cmd.addon, hotel.kind, hotelSpec(hotel.kind, hotel.size, hotel.floors).rooms)
        if (!canAfford(state, park, price)) return fail(`You need $${price.toLocaleString('en-US')} for the ${addon.name.toLowerCase()}.`)
        spend(state, park, price, 'construction')
        hotel.invested = (hotel.invested ?? 0) + price
      }
      hotel.addons = { ...hotel.addons, [cmd.addon]: cmd.on }
    }
    if (cmd.rate !== undefined) {
      const [lo, hi] = hotelRateLimits(hotel.kind)
      if (!isInt(cmd.rate, lo, hi)) return fail(`Room rates for ${def.name} run from $${lo} to $${hi} a night.`)
      hotel.rate = cmd.rate
    }
    if (cmd.priceOf !== undefined) {
      const visit = AMENITY_VISITS[cmd.priceOf]
      if (!visit) return fail('Choose an amenity.')
      const hi = amenityPriceLimit(hotel.kind, cmd.priceOf)
      if (!isInt(cmd.price, 0, hi)) return fail(`The ${visit.name.toLowerCase()} can charge $0 to $${hi} a visit.`)
      hotel.prices = { ...hotel.prices, [cmd.priceOf]: cmd.price }
    }
    if (cmd.service !== undefined) {
      if (!HOTEL_SERVICE[cmd.service]) return fail('Choose a service level.')
      hotel.service = cmd.service
    }
    if (cmd.refurbish === true) {
      const cost = hotelRefurbishCost(hotel)
      if (cost <= 0) return fail('This hotel is already in perfect condition.')
      if (!canAfford(state, park, cost)) return fail(`You need $${cost.toLocaleString('en-US')} to refurbish this hotel.`)
      spend(state, park, cost, 'construction')
      hotel.invested = (hotel.invested ?? 0) + cost
      hotel.condition = 100
      return ok({ cost })
    }
    return ok()
  },

  // Grows or shrinks a hotel in place, keeping its north-west corner. New squares must be free, owned and level with the hotel.
  hotelResize(state, cmd, park) {
    const hotel = state.entities[cmd.id]
    if (!hotel || hotel.type !== 'hotel' || hotel.park !== park) return fail('Choose one of your hotels.')
    const def = HOTELS[hotel.kind], map = state.map
    if (!isInt(cmd.w, 1, HOTEL_SIZE_LIMIT) || !isInt(cmd.h, 1, HOTEL_SIZE_LIMIT) || !isInt(cmd.floors, 1, HOTEL_FLOOR_LIMIT)) return fail('Choose a size and floors.')
    if (!hotelOrientedFits(def, cmd.w, cmd.h)) return fail(`${def.name} can be ${def.min.join('×')} to ${def.max.join('×')} squares.`)
    if (cmd.floors < def.floors[0] || cmd.floors > def.floors[1]) return fail(`${def.name} can have ${def.floors[0]} to ${def.floors[1]} floors.`)
    if (cmd.w === hotel.size[0] && cmd.h === hotel.size[1] && cmd.floors === hotel.floors) return fail('That is already this hotel\'s size.')
    const probe = { type: 'hotel', x: hotel.x, y: hotel.y, size: [cmd.w, cmd.h], floors: cmd.floors }
    const height = hotelHeight(probe)
    const base = tileCorners(map, hotel.x, hotel.y)[0]
    const tiles = footprintTiles(probe)
    for (const [x, y] of tiles) {
      if (!inMap(map, x, y)) return fail('The hotel would not fit on the map.')
      const i = tileIndex(map, x, y)
      if (lowTrack(state, i, height)) return fail('Coaster track is in the way.')
      if (map.obj[i] === hotel.id) continue
      if (map.owner[i] !== park) return fail('You can only build on land your park owns.')
      if (map.path[i]) return fail('A footpath is in the way.')
      if (map.obj[i]) return fail(state.entities[map.obj[i]]?.type === 'scenery' ? 'Scenery is in the way. Use Clear Scenery first.' : 'Something is built here.')
      if (isWater(map, i, x, y)) return fail('Hotels cannot be built on water.')
      if (tileCorners(map, x, y).some(c => c !== base)) return fail('Level the ground beside the hotel to its height first.')
    }
    const entrance = hotelEntranceFor(state, park, hotel.x, hotel.y, cmd.w, cmd.h)
    if (!entrance) return fail('The new size would leave the hotel without a footpath by its door.')
    const cost = hotelResizeCost(hotel, [cmd.w, cmd.h], cmd.floors)
    if (cost > 0 && !canAfford(state, park, cost)) return fail(`You need $${cost.toLocaleString('en-US')} for this renovation.`)
    for (const [x, y] of footprintTiles(hotel)) { const i = tileIndex(map, x, y); if (map.obj[i] === hotel.id) map.obj[i] = 0 }
    for (const [x, y] of tiles) map.obj[tileIndex(map, x, y)] = hotel.id
    hotel.size = [cmd.w, cmd.h]; hotel.floors = cmd.floors; hotel.entrance = entrance
    if (cost > 0) { spend(state, park, cost, 'construction'); hotel.invested = (hotel.invested ?? 0) + cost }
    else if (cost < 0) { state.parks[park].cash += -cost; state.parks[park].month.construction += -cost; hotel.invested = Math.max(0, (hotel.invested ?? 0) + cost) }
    pathsChanged(state)
    return cost >= 0 ? ok({ id: hotel.id, cost }) : ok({ id: hotel.id, refund: -cost })
  },

  gate(state, cmd, park) {
    const ride = state.entities[cmd.ride]
    if (!ride || ride.type !== 'ride' || ride.park !== park) return fail('Choose one of your rides.')
    if (!isInt(cmd.x, 0, state.map.w - 1) || !isInt(cmd.y, 0, state.map.h - 1)) return fail('Choose a tile next to the ride.')
    const role = cmd.role === 'exit' ? 'exit' : 'entrance'
    const map = state.map, i = tileIndex(map, cmd.x, cmd.y)
    if (map.owner[i] !== park) return fail('You can only build on land your park owns.')
    if (map.path[i]) return fail('Remove the footpath here first; the entrance needs its own tile.')
    const existing = state.entities[map.obj[i]]
    if (existing && !(existing.type === 'gate' && existing.ride === ride.id)) return fail('This tile is occupied.')
    if (isWater(map, i, cmd.x, cmd.y)) return fail('Gates cannot be built on water.')
    if (lowTrack(state, i, 3)) return fail('Coaster track is in the way.')
    if (ride.kind === 'coaster' && !ride.pieces.some(p => p.sp === 'station')) return fail('Build the station first.')
    let dir = -1
    for (const [tx, ty, stationDir] of rideTiles(state, ride)) {
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d]
        if (tx + dx !== cmd.x || ty + dy !== cmd.y) continue
        if (ride.kind === 'coaster' && d % 2 === stationDir % 2) continue
        dir = d
      }
    }
    if (dir < 0) return fail(ride.kind === 'coaster' ? 'Place it along the side of a station platform.' : 'Place it on a tile touching the ride.')
    const other = state.entities[role === 'entrance' ? ride.exit : ride.entrance]
    if (other && other.x === cmd.x && other.y === cmd.y) return fail(`The ${role === 'entrance' ? 'exit' : 'entrance'} is already here.`)
    const cost = 60
    if (!canAfford(state, park, cost)) return fail(`You need $${cost}.`)
    const old = state.entities[ride[role]]
    if (old) removeEntity(state, old)
    const id = state.nextId++
    state.entities[id] = { id, type: 'gate', ride: ride.id, role, x: cmd.x, y: cmd.y, dir, park }
    map.obj[i] = id
    ride[role] = id
    spend(state, park, cost, 'construction')
    pathsChanged(state)
    const front = frontTile(state.entities[id])
    const connected = inMap(map, front.x, front.y) && (isWalkPath(map.path[tileIndex(map, front.x, front.y)]) || map.path[tileIndex(map, front.x, front.y)] === 2)
    return ok({ id, cost, warning: connected ? null : `Connect the ${role} to a queue line or footpath.` })
  },

  coaster(state, cmd, park) {
    const style = COASTER_STYLES[cmd.style]
    if (!style || !isInt(cmd.x, 0, state.map.w - 1) || !isInt(cmd.y, 0, state.map.h - 1) || !isInt(cmd.dir, 0, 3)) return fail('Choose a track type and a starting tile.')
    const stationLength = isInt(cmd.length, 2, 13) ? cmd.length : 3
    const map = state.map
    const [dx, dy] = DIRS[cmd.dir], [sx, sy] = DIRS[(cmd.dir + 1) % 4]
    let ground = 0
    for (let k = 0; k < stationLength * (style.wide ? 2 : 1); k++) {
      const side = style.wide ? k % 2 : 0, along = style.wide ? k >> 1 : k
      const x = cmd.x + dx * along + sx * side, y = cmd.y + dy * along + sy * side
      if (!inMap(map, x, y)) return fail('The station would leave the map.')
      const i = tileIndex(map, x, y)
      if (map.owner[i] !== park) return fail('You can only build on land your park owns.')
      if (map.path[i]) return fail('A footpath is in the way of the station.')
      if (map.obj[i]) return fail(state.entities[map.obj[i]]?.type === 'scenery' ? 'Scenery is in the way. Use Clear Scenery first.' : 'Something is in the way of the station.')
      if (isWater(map, i, x, y)) return fail('Stations cannot be built on water.')
      ground = Math.max(ground, tileMax(map, x, y))
    }
    const cost = style.cost
    if (!canAfford(state, park, cost)) return fail(`You need $${cost} to start this track ride.`)
    const id = state.nextId++
    const ride = {
      id, type: 'ride', kind: 'coaster', style: cmd.style, x: cmd.x, y: cmd.y, park, name: nextName(state, style.name), price: 2.5, status: 'closed',
      start: { x: cmd.x, y: cmd.y, dir: cmd.dir, h: Math.round(ground / 0.5) + 1 + (cmd.style === 'inverted' ? INVERTED_STATION_LIFT : 0) }, pieces: [], complete: false, trains: [], cars: 3, spent: 0, rev: 0,
      entrance: 0, exit: 0, queue: [], riders: [], cycle: { phase: 'loading', timer: 0 }, reliability: 100, downtime: 0, revenue: 0, totalRiders: 0, monthRiders: 0,
      built: state.time.seconds, color: null, colors: null, scheme: null, stats: null, carsSet: false, brokenAt: 0, mechanic: 0, cycles: 0,
    }
    state.entities[id] = ride
    let total = cost
    for (let k = 0; k < stationLength; k++) {
      const piece = { c: 0, s: 0, sp: 'station' }
      const result = validatePiece(state, ride, piece)
      if (!result.ok) { delete state.entities[id]; return fail(result.error) }
      ride.pieces.push({ ...piece, k: result.cost })
      total += result.cost
    }
    addRideCells(state, ride)
    if (!canAfford(state, park, total)) { removeRideCells(state, id); delete state.entities[id]; return fail(`You need $${total} to build this station.`) }
    for (const [x, y] of stationTiles(state, ride)) map.obj[tileIndex(map, x, y)] = id
    ride.spent = total
    spend(state, park, total, 'construction')
    pathsChanged(state)
    return ok({ id, cost: total })
  },

  piece(state, cmd, park) {
    const ride = state.entities[cmd.ride]
    if (!ride || ride.kind !== 'coaster' || ride.park !== park) return fail('Choose one of your track rides.')
    const piece = { c: cmd.c | 0, s: cmd.s | 0 }
    if (['chain', 'brakes', 'booster', 'loop', 'corkscrew', 'station'].includes(cmd.sp)) piece.sp = cmd.sp
    const result = addPieces(state, ride, park, [piece])
    if (result.error) return fail(result.error)
    return ok({ cost: result.cost, complete: ride.complete })
  },

  unpiece(state, cmd, park) {
    const ride = state.entities[cmd.ride]
    if (!ride || ride.kind !== 'coaster' || ride.park !== park) return fail('Choose one of your track rides.')
    if (ride.pieces.length <= leadingStations(ride)) return fail('Only the station is left. Demolish the ride to remove it.')
    if (ride.complete) {
      ejectRide(state, ride)
      ride.complete = false; ride.trains = []; ride.status = 'closed'; ride.stats = null; ride.rev = (ride.rev ?? 0) + 1
    }
    const removed = ride.pieces.pop()
    const refund = Math.round((removed.k ?? 0) * 0.5)
    state.parks[park].cash += refund
    state.parks[park].month.construction += refund
    ride.spent = Math.max(0, (ride.spent ?? 0) - (removed.k ?? 0))
    removeRideCells(state, ride.id)
    addRideCells(state, ride)
    if (removed.sp === 'station') {
      markStations(state, ride)
      for (const role of ['entrance', 'exit']) {
        const gate = state.entities[ride[role]]
        if (gate && !stationTiles(state, ride).some(([x, y]) => Math.abs(x - gate.x) + Math.abs(y - gate.y) === 1)) { removeEntity(state, gate); ride[role] = 0 }
      }
      pathsChanged(state)
    } else structural(state)
    return ok({ refund })
  },

  finish(state, cmd, park) {
    const ride = state.entities[cmd.ride]
    if (!ride || ride.kind !== 'coaster' || ride.park !== park) return fail('Choose one of your track rides.')
    if (ride.complete) return fail('The circuit is already complete.')
    const route = autoComplete(state, ride)
    if (route.error) return fail(route.error)
    const result = addPieces(state, ride, park, route.pieces)
    if (result.error) return fail(result.error)
    return ok({ cost: result.cost, complete: ride.complete, pieces: route.pieces.length })
  },

  preset(state, cmd, park) {
    const design = COASTER_PRESETS[cmd.preset]
    if (!design) return fail('Choose a coaster design.')
    const p = state.parks[park]
    const before = { cash: p.cash, construction: p.month.construction }
    const made = HANDLERS.coaster(state, { style: design.style, x: cmd.x, y: cmd.y, dir: cmd.dir, length: design.station }, park)
    if (!made.ok) return made
    const ride = state.entities[made.id]
    ride.name = uniqueName(state, design.name, ride.id)
    const undo = error => { HANDLERS.demolish(state, { id: ride.id }, park); p.cash = before.cash; p.month.construction = before.construction; return fail(`${design.name} does not fit here: ${error}`) }
    const body = addPieces(state, ride, park, design.pieces.map(piece => ({ ...piece, g: 0 })))
    if (body.error) return undo(body.error)
    if (!ride.complete) {
      const route = autoComplete(state, ride)
      if (route.error) return undo('there is not enough clear space to bring the track back to the station.')
      const tail = addPieces(state, ride, park, route.pieces)
      if (tail.error) return undo(tail.error)
    }
    return ok({ id: ride.id, cost: Math.round(before.cash - p.cash), complete: ride.complete })
  },


  rideSet(state, cmd, park) {
    const ride = state.entities[cmd.id]
    if (!ride || ride.type !== 'ride' || ride.park !== park) return fail('Choose one of your rides.')
    if (cmd.price !== undefined) {
      if (typeof cmd.price !== 'number' || !Number.isFinite(cmd.price) || cmd.price < 0 || cmd.price > 20) return fail('Ride prices run from free to $20.')
      ride.price = Math.round(cmd.price * 10) / 10
    }
    if (typeof cmd.name === 'string') {
      const name = cmd.name.trim().slice(0, 32)
      if (name.length < 1) return fail('Give the ride a name.')
      ride.name = name
    }
    if (cmd.wave !== undefined) {
      const def = ride.kind === 'flat' ? FLAT_RIDES[ride.ride] : null
      if (!def?.waves || !WAVE_SETTINGS[cmd.wave]) return fail('Choose a wave setting.')
      ride.wave = cmd.wave
      ride.stats = { valid: true, ...flatSpec(ride.ride, ride.size, ride.wave).stats }
    }
    for (const field of ['color', 'trackColor', 'supportColor', 'trainColor']) {
      if (cmd[field] !== undefined) {
        if (typeof cmd[field] !== 'string' || !/^#[0-9a-f]{6}$/i.test(cmd[field])) return fail('Choose a valid ride color.')
        ride[field] = cmd[field]
        if (ride.colors) { const key = field === 'trackColor' ? 'track' : field === 'supportColor' ? 'support' : 'main'; delete ride.colors[key]; if (!Object.keys(ride.colors).length) ride.colors = null }
        ride.scheme = null
      }
    }
    if (cmd.scheme !== undefined) {
      if (cmd.scheme !== null && !isInt(cmd.scheme, 0, SCHEME_COUNT - 1)) return fail('Choose one of the park color schemes.')
      ride.scheme = cmd.scheme
      if (cmd.scheme !== null && cmd.colors === undefined) ride.colors = null
    }
    if (cmd.colors !== undefined) {
      if (cmd.colors === null) ride.colors = null
      else {
        if (typeof cmd.colors !== 'object' || Array.isArray(cmd.colors)) return fail('Choose valid ride colors.')
        const keys = new Set(rideSlots(ride).map(s => s.key))
        const next = { ...(ride.colors ?? {}) }
        for (const [key, value] of Object.entries(cmd.colors)) {
          if (!keys.has(key)) return fail('That part of the ride cannot be recolored.')
          if (value === null) { delete next[key]; continue }
          if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return fail('Choose a valid ride color.')
          next[key] = value.toLowerCase()
        }
        if (Number.isInteger(ride.scheme) && cmd.scheme === undefined) {
          const resolved = rideColors(ride, state.parks[park])
          rideSlots(ride).forEach((s, i) => { if (!(s.key in next) && !(cmd.colors[s.key] === null)) next[s.key] = resolved[i] })
          ride.scheme = null
        }
        ride.colors = Object.keys(next).length ? next : null
      }
    }
    if (ride.kind === 'coaster' && (cmd.colors !== undefined || cmd.scheme !== undefined)) {
      const resolved = rideColors(ride, state.parks[park]), slots = rideSlots(ride)
      ride.trainColor = resolved[slots.findIndex(s => s.key === 'main')]
      ride.trackColor = resolved[slots.findIndex(s => s.key === 'track')]
      ride.supportColor = resolved[slots.findIndex(s => s.key === 'support')]
    }
    if (cmd.cars !== undefined) {
      const style = ride.kind === 'coaster' ? COASTER_STYLES[ride.style] : null
      if (!style || style.trackType || !isInt(cmd.cars, 1, 10)) return fail('Roller coaster trains can have 1 to 10 cars.')
      const path = ride.complete ? ridePath(state, ride) : null
      const stats = path ? rideStatsFromRun(path, style, cmd.cars) : null
      ride.cars = cmd.cars
      ride.carsSet = true
      if (ride.complete) ride.stats = stats
      ride.rev = (ride.rev ?? 0) + 1
      if (ride.trains?.[1]) {
        const rest = path ? Math.max(0.5, path.stationEnd - 0.6) : 0
        ride.trains[1].waitS = rest - (ride.cars - 1) * CAR_GAP - CAR_GAP
        ride.trains[1].s = ride.trains[1].waitS
      }
    }
    if (cmd.status === 'open') {
      if (ride.status === 'broken') return fail('A mechanic has to fix this ride first.')
      if (ride.kind === 'coaster' && !ride.complete) return fail('Finish the track circuit before opening.')
      if (ride.kind === 'coaster' && !ride.stats?.valid) return fail('This track ride failed its test run. Adjust the track first.')
      if (!ride.entrance || !ride.exit) return fail('Place an entrance and an exit first.')
      ride.status = 'open'
      addNews(state, park, `${ride.name} is now open.`, 'ride', ride.id)
    } else if (cmd.status === 'closed') {
      if (ride.status !== 'broken') ride.status = 'closed'
      ride.queue.forEach(id => { const g = state.guests.find(guest => guest.id === id); if (g) { g.state = 'walk'; g.target = null } })
      ride.queue = []
    }
    return ok()
  },

  stallSet(state, cmd, park) {
    const stall = state.entities[cmd.id]
    if (!stall || stall.type !== 'stall' || stall.park !== park) return fail('Choose one of your stalls.')
    if (cmd.price !== undefined && (typeof cmd.price !== 'number' || !Number.isFinite(cmd.price) || cmd.price < 0 || cmd.price > 20)) return fail('Prices run from free to $20.')
    let warning = null
    if (cmd.rot !== undefined) {
      if (!isInt(cmd.rot, 0, 3)) return fail('Choose a valid shop direction.')
      const placementError = stallFootprintError(state, park, stall, cmd.rot, stall.id)
      if (placementError) return fail(placementError)
      for (const [x, y] of footprintTiles(stall)) {
        const i = tileIndex(state.map, x, y)
        if (state.map.obj[i] === stall.id) state.map.obj[i] = 0
      }
      stall.rot = cmd.rot
      for (const [x, y] of footprintTiles(stall)) state.map.obj[tileIndex(state.map, x, y)] = stall.id
      pathsChanged(state)
      const front = stallFrontTile(stall)
      if (!inMap(state.map, front.x, front.y) || !isWalkPath(state.map.path[tileIndex(state.map, front.x, front.y)])) warning = 'The counter is not facing a footpath yet. Guests can only buy from the front.'
    }
    if (cmd.price !== undefined) {
      stall.price = Math.round(cmd.price * 10) / 10
    }
    if (typeof cmd.open === 'boolean') stall.open = cmd.open
    return ok({ warning })
  },

  demolish(state, cmd, park) {
    const entity = state.entities[cmd.id]
    if (!entity || entity.park !== park) return fail('Choose something of yours to demolish.')
    if (entity.type === 'parkEntrance') return fail('The park entrance cannot be demolished.')
    let target = entity
    if (entity.type === 'gate') {
      const ride = state.entities[entity.ride]
      if (ride) { ride[entity.role] = 0; if (ride.status === 'open') ride.status = 'closed'; ejectRide(state, ride) }
      removeEntity(state, entity)
      pathsChanged(state)
      return ok()
    }
    const refund = Math.round(entityCost(target) * 0.5)
    if (target.type === 'ride') {
      ejectRide(state, target)
      for (const gateId of [target.entrance, target.exit]) { const gate = state.entities[gateId]; if (gate) removeEntity(state, gate) }
      if (target.kind === 'coaster') {
        removeRideCells(state, target.id)
        for (let i = 0; i < state.map.obj.length; i++) if (state.map.obj[i] === target.id) state.map.obj[i] = 0
        state.pathCache?.delete(target.id)
      }
      for (const s of state.staff) if (s.target?.ride === target.id) { s.target = null; s.state = 'walk' }
    }
    removeEntity(state, target)
    state.parks[park].cash += refund
    state.parks[park].month.construction += refund
    pathsChanged(state)
    return ok({ refund })
  },

  hire(state, cmd, park) {
    const def = STAFF[cmd.role]
    if (!def) return fail('Choose a staff role.')
    const count = state.staff.filter(s => s.park === park).length
    if (count >= 60) return fail('Your park already has 60 staff members.')
    if (!canAfford(state, park, def.wage)) return fail(`You need $${def.wage} to hire someone.`)
    const entrance = Object.values(state.entities).find(e => e.type === 'parkEntrance' && e.park === park)
    if (!entrance) return fail('This park has no entrance.')
    const [dx, dy] = DIRS[entrance.dir]
    const x = entrance.x + dx, y = entrance.y + dy
    const names = STAFF_NAMES[cmd.role]
    const id = state.staffSeq++
    state.staff.push({ id, role: cmd.role, park, name: `${def.name} ${names[id % names.length]}`, x: x + 0.5, y: y + 0.5, tx: x, ty: y, nx: -1, ny: -1, lane: 0, state: 'walk', target: null, timer: 0, swept: 0, fixed: 0, hired: state.time.seconds })
    return ok({ id })
  },

  fire(state, cmd, park) {
    const index = state.staff.findIndex(s => s.id === cmd.id && s.park === park)
    if (index < 0) return fail('Choose one of your staff members.')
    const [member] = state.staff.splice(index, 1)
    if (member.target?.ride) { const ride = state.entities[member.target.ride]; if (ride?.mechanic === member.id) ride.mechanic = 0 }
    return ok()
  },

  staffJob(state, cmd, park) {
    const member = state.staff.find(s => s.id === cmd.id && s.park === park)
    if (!member || member.role !== 'mechanic') return fail('Choose one of your mechanics.')
    if (cmd.ride === 0) {
      const assigned = state.entities[member.target?.ride]
      if (assigned?.mechanic === member.id) assigned.mechanic = 0
      member.target = null
      member.state = 'walk'
      member.timer = 0
      return ok()
    }
    if (!isInt(cmd.ride, 1, Number.MAX_SAFE_INTEGER)) return fail('Choose a broken ride.')
    const ride = state.entities[cmd.ride]
    if (!ride || ride.type !== 'ride' || ride.park !== park || ride.status !== 'broken') return fail('That ride is not available for repair.')
    if (ride.mechanic && ride.mechanic !== member.id) return fail('Another mechanic is already assigned to that ride.')
    if (mechanicJobDistance(state, member, ride) < 0) return fail('There is no connected footpath or queue-line route to that ride.')
    const previous = state.entities[member.target?.ride]
    if (previous?.mechanic === member.id) previous.mechanic = 0
    member.target = { ride: ride.id }
    member.state = 'walk'
    member.timer = 0
    ride.mechanic = member.id
    return ok()
  },

  park(state, cmd, park) {
    const p = state.parks[park]
    if (cmd.entryFee !== undefined) {
      if (typeof cmd.entryFee !== 'number' || !Number.isFinite(cmd.entryFee) || cmd.entryFee < 0 || cmd.entryFee > 100) return fail('Entry fees run from free to $100.')
      p.entryFee = Math.round(cmd.entryFee)
    }
    if (typeof cmd.open === 'boolean') { p.open = cmd.open; addNews(state, park, `${p.name} is now ${cmd.open ? 'open' : 'closed'} to new guests.`, 'info') }
    if (typeof cmd.name === 'string' && cmd.name.trim().length >= 2) {
      const wasNamed = p.named
      p.name = cmd.name.trim().slice(0, 32)
      p.named = true
      if (!wasNamed && state.speed === 0) state.speed = 1
    }
    if (cmd.scheme !== undefined) {
      const edit = cmd.scheme
      if (!edit || typeof edit !== 'object' || !isInt(edit.index, 0, SCHEME_COUNT - 1)) return fail('Choose one of the three park color schemes.')
      const schemes = parkSchemes(p), current = schemes[edit.index]
      if (edit.name !== undefined && (typeof edit.name !== 'string' || !edit.name.trim())) return fail('Give the color scheme a name.')
      if (edit.colors !== undefined) {
        if (!edit.colors || typeof edit.colors !== 'object') return fail('Choose valid scheme colors.')
        for (const [role, value] of Object.entries(edit.colors)) {
          if (!ROLES.includes(role)) return fail('That scheme color does not exist.')
          if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return fail('Choose a valid scheme color.')
        }
      }
      schemes[edit.index] = sanitizeScheme({ name: edit.name ?? current.name, colors: { ...current.colors, ...(edit.colors ?? {}) } }, current)
      p.schemes = schemes
      for (const e of Object.values(state.entities)) {
        if (e.type !== 'ride' || e.park !== park || e.kind !== 'coaster' || e.scheme !== edit.index) continue
        const resolved = rideColors(e, p), slots = rideSlots(e)
        e.trainColor = resolved[slots.findIndex(s => s.key === 'main')]
        e.trackColor = resolved[slots.findIndex(s => s.key === 'track')]
        e.supportColor = resolved[slots.findIndex(s => s.key === 'support')]
      }
    }
    return ok()
  },

  loan(state, cmd, park) {
    const p = state.parks[park]
    if (!Number.isInteger(cmd.delta) || cmd.delta === 0 || Math.abs(cmd.delta) > 100000 || cmd.delta % 1000) return fail('Change the loan in steps of $1,000.')
    const next = p.loan + cmd.delta
    if (next < 0) return fail('You do not owe that much.')
    if (next > p.maxLoan) return fail(`The bank will lend at most $${p.maxLoan.toLocaleString('en-US')}.`)
    if (cmd.delta < 0 && p.cash < -cmd.delta) return fail('You do not have enough cash to repay that.')
    p.loan = next
    p.cash += cmd.delta
    return ok()
  },

  market(state, cmd, park) {
    const def = MARKETING[cmd.kind]
    if (!def) return fail('Choose a campaign.')
    const p = state.parks[park]
    if (p.marketing.some(m => m.kind === cmd.kind)) return fail('That campaign is already running.')
    if (!canAfford(state, park, def.cost)) return fail(`You need $${def.cost}.`)
    p.marketing.push({ kind: cmd.kind, until: state.time.seconds + def.days * 40, boost: def.boost })
    spend(state, park, def.cost, 'marketing')
    addNews(state, park, `${def.name} campaign started.`, 'info')
    return ok()
  },

  speed(state, cmd) {
    if (![0, 1, 2, 4].includes(cmd.speed)) return fail('Choose a speed.')
    state.speed = cmd.speed
    return ok()
  },
}

export function pieceCostPreview(state, ride, piece) {
  const result = validatePiece(state, ride, piece)
  return result.ok ? { ok: true, cost: result.cost, closes: result.closes, length: pieceLengthTiles(result.piece), piece: result.piece, adjusted: result.adjusted } : result
}
