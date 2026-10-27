import { FLAT_RIDES, COASTER_STYLES, COASTER_PRESETS, STALLS, SCENERY, STAFF, COSTS, PATH_ADDITIONS } from './catalog.mjs'
import { autoComplete } from './autotrack.mjs'
import { DIRS, clamp } from './util.mjs'
import { terrainEdit, tilesTouchingCorners, tileIndex, inMap, tileSlope, tileMin, tileMax, tileCorners } from './terrain.mjs'
import { validatePiece, addRideCells, removeRideCells, makeTrain, rideStatsFromRun, trackPoses, pieceLengthTiles } from './track.mjs'
import { footprintTiles, addNews, entityCost, ridePath, frontTile } from './state.mjs'

const MAX_RECT = 32
const ok = (extra = {}) => ({ ok: true, ...extra })
const fail = error => ({ ok: false, error })

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

export function terrainPlan(state, park, r, op) {
  const map = state.map
  const changes = terrainEdit(map, r.x0, r.y0, r.x1, r.y1, op)
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
    const pose = poses[index], [dx, dy] = DIRS[pose.dir]
    tiles.push([Math.floor(pose.x + dx * 0.5), Math.floor(pose.y + dy * 0.5), pose.dir])
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
    ride.pieces.push({ ...piece, k: result.cost })
    checked.push(result)
    total += result.cost
  }
  ride.pieces.length -= checked.length
  if (!canAfford(state, park, total)) return { error: `You need $${total.toLocaleString('en-US')} to build that much track.` }
  pieces.forEach((piece, i) => ride.pieces.push({ ...piece, k: checked[i].cost }))
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
  ride.cars = clamp(stationLength + 1, 2, 7)
  const path = ridePath(state, ride)
  const stats = path ? rideStatsFromRun(path, style, ride.cars) : { valid: false }
  ride.stats = stats
  ride.trains = [makeTrain()]
  if (path) ride.trains[0].s = Math.max(0.5, path.stationEnd - 0.6)
  addNews(state, ride.park, stats.valid ? `${ride.name} passed its test run. Excitement ${stats.e.toFixed(2)}, intensity ${stats.i.toFixed(2)}, nausea ${stats.n.toFixed(2)}.` : `${ride.name} failed its test run: the train could not make it around the circuit. Make sure the chain lift reaches the top of each climb, and build a big drop before loops so the train has the speed to get round.`, stats.valid ? 'ride' : 'warning', ride.id)
}

export function applyCommand(state, cmd, park = 0) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string') return fail('Unknown action.')
  if (!state.parks[park]) return fail('You are not managing a park.')
  if (state.ended && !['speed', 'rideSet', 'stallSet', 'park'].includes(cmd.t)) return fail('This match has ended.')
  const handler = HANDLERS[cmd.t]
  if (!handler) return fail('Unknown action.')
  return handler(state, cmd, park)
}

const HANDLERS = {
  terrain(state, cmd, park) {
    const r = rect(cmd, state.map)
    if (!r || !['raise', 'lower', 'level'].includes(cmd.op)) return fail('Choose an area of land to reshape.')
    const plan = terrainPlan(state, park, r, cmd.op)
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
    const kind = cmd.kind === 2 ? 2 : 1
    if (!r) return fail('Choose where to lay the path.')
    const map = state.map, tiles = []
    let blocked = null
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = tileIndex(map, x, y)
      if (map.path[i] === kind) continue
      if (map.owner[i] !== park) { blocked = 'You can only build on land your park owns.'; continue }
      if (isWater(map, i, x, y)) { blocked = 'Footpaths cannot be built on water.'; continue }
      if (map.obj[i]) { const entity = state.entities[map.obj[i]]; blocked = entity?.type === 'scenery' ? 'Scenery is in the way. Use Clear Scenery first.' : 'Something is built here.'; continue }
      if (tileSlope(map, x, y).dir === -2) { blocked = 'The land is too steep for a footpath. Smooth it first.'; continue }
      if (lowTrack(state, i, 2.6)) { blocked = 'Coaster track is too low over this tile.'; continue }
      tiles.push(i)
    }
    if (!tiles.length) return fail(blocked ?? 'There is already a path here.')
    const cost = tiles.length * (kind === 2 ? COSTS.queue : COSTS.path)
    if (!canAfford(state, park, cost)) return fail(`You need $${cost} to build that.`)
    for (const i of tiles) { map.path[i] = kind; if (kind === 2) map.pathAdd[i] = 0 }
    spend(state, park, cost, 'construction')
    pathsChanged(state)
    return ok({ cost, warning: blocked })
  },

  unpath(state, cmd, park) {
    const r = rect(cmd, state.map)
    if (!r) return fail('Choose a path to remove.')
    const map = state.map
    let count = 0
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = tileIndex(map, x, y)
      if (!map.path[i] || map.owner[i] !== park) continue
      map.path[i] = 0; map.pathAdd[i] = 0; map.litter[i] = 0; count++
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
    const i = tileIndex(state.map, x, y)
    if (state.map.owner[i] !== park) return fail('You can only build on land your park owns.')
    if (state.map.obj[i] || state.map.path[i]) return fail('This tile is occupied.')
    if (isWater(state.map, i, x, y)) return fail('Stalls cannot be built on water.')
    if (tileSlope(state.map, x, y).dir === -2) return fail('The land is too uneven here.')
    if (lowTrack(state, i, 4)) return fail('Coaster track is in the way.')
    if (!canAfford(state, park, def.cost)) return fail(`You need $${def.cost}.`)
    const id = state.nextId++
    state.entities[id] = { id, type: 'stall', kind: cmd.kind, x, y, rot: cmd.rot, park, price: def.price, open: true, sales: 0, revenue: 0, name: def.name, built: state.time.seconds }
    state.map.obj[i] = id
    spend(state, park, def.cost, 'construction')
    pathsChanged(state)
    const front = frontTile({ x, y, dir: cmd.rot })
    const facesPath = inMap(state.map, front.x, front.y) && state.map.path[tileIndex(state.map, front.x, front.y)] === 1
    return ok({ id, cost: def.cost, warning: facesPath ? null : 'The counter is not facing a footpath yet. Guests can only buy from the front.' })
  },

  flat(state, cmd, park) {
    const def = FLAT_RIDES[cmd.ride]
    if (!def || !isInt(cmd.x, 0, state.map.w - 1) || !isInt(cmd.y, 0, state.map.h - 1) || !isInt(cmd.rot, 0, 3)) return fail('Choose a ride and where to place it.')
    const probe = { type: 'ride', kind: 'flat', ride: cmd.ride, x: cmd.x, y: cmd.y, rot: cmd.rot }
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
    const cost = def.cost + (plan?.cost ?? 0)
    if (!canAfford(state, park, cost)) return fail(`You need $${cost} to build this ride.`)
    if (plan) applyTerrainPlan(state, park, plan)
    const id = state.nextId++
    const ride = {
      id, type: 'ride', kind: 'flat', ride: cmd.ride, x: cmd.x, y: cmd.y, rot: cmd.rot, park, name: nextName(state, def.name), price: def.price, status: 'closed',
      entrance: 0, exit: 0, queue: [], riders: [], cycle: { phase: 'loading', timer: 0 }, reliability: 100, downtime: 0, revenue: 0, totalRiders: 0, monthRiders: 0,
      built: state.time.seconds, color: null, stats: { valid: true, e: def.stats.e, i: def.stats.i, n: def.stats.n }, brokenAt: 0, mechanic: 0, cycles: 0,
    }
    state.entities[id] = ride
    for (const [x, y] of tiles) map.obj[tileIndex(map, x, y)] = id
    spend(state, park, def.cost, 'construction')
    pathsChanged(state)
    return ok({ id, cost })
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
    const connected = inMap(map, front.x, front.y) && map.path[tileIndex(map, front.x, front.y)] > 0
    return ok({ id, cost, warning: connected ? null : `Connect the ${role} to a ${role === 'entrance' ? 'queue line or footpath' : 'footpath'}.` })
  },

  coaster(state, cmd, park) {
    const style = COASTER_STYLES[cmd.style]
    if (!style || !isInt(cmd.x, 0, state.map.w - 1) || !isInt(cmd.y, 0, state.map.h - 1) || !isInt(cmd.dir, 0, 3)) return fail('Choose a coaster type and a starting tile.')
    const stationLength = isInt(cmd.length, 2, 6) ? cmd.length : 3
    const map = state.map
    const [dx, dy] = DIRS[cmd.dir]
    let ground = 0
    for (let k = 0; k < stationLength; k++) {
      const x = cmd.x + dx * k, y = cmd.y + dy * k
      if (!inMap(map, x, y)) return fail('The station would leave the map.')
      const i = tileIndex(map, x, y)
      if (map.owner[i] !== park) return fail('You can only build on land your park owns.')
      if (map.path[i]) return fail('A footpath is in the way of the station.')
      if (map.obj[i]) return fail(state.entities[map.obj[i]]?.type === 'scenery' ? 'Scenery is in the way. Use Clear Scenery first.' : 'Something is in the way of the station.')
      if (isWater(map, i, x, y)) return fail('Stations cannot be built on water.')
      ground = Math.max(ground, tileMax(map, x, y))
    }
    const cost = style.cost
    if (!canAfford(state, park, cost)) return fail(`You need $${cost} to start this coaster.`)
    const id = state.nextId++
    const ride = {
      id, type: 'ride', kind: 'coaster', style: cmd.style, x: cmd.x, y: cmd.y, park, name: nextName(state, style.name), price: 2.5, status: 'closed',
      start: { x: cmd.x, y: cmd.y, dir: cmd.dir, h: Math.round(ground / 0.5) + 1 }, pieces: [], complete: false, trains: [], cars: 3, spent: 0, rev: 0,
      entrance: 0, exit: 0, queue: [], riders: [], cycle: { phase: 'loading', timer: 0 }, reliability: 100, downtime: 0, revenue: 0, totalRiders: 0, monthRiders: 0,
      built: state.time.seconds, color: null, stats: null, brokenAt: 0, mechanic: 0, cycles: 0,
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
    if (!ride || ride.kind !== 'coaster' || ride.park !== park) return fail('Choose one of your coasters.')
    const piece = { c: cmd.c | 0, s: cmd.s | 0 }
    if (['chain', 'brakes', 'booster', 'loop', 'station'].includes(cmd.sp)) piece.sp = cmd.sp
    const result = addPieces(state, ride, park, [piece])
    if (result.error) return fail(result.error)
    return ok({ cost: result.cost, complete: ride.complete })
  },

  unpiece(state, cmd, park) {
    const ride = state.entities[cmd.ride]
    if (!ride || ride.kind !== 'coaster' || ride.park !== park) return fail('Choose one of your coasters.')
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
    if (!ride || ride.kind !== 'coaster' || ride.park !== park) return fail('Choose one of your coasters.')
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
    const body = addPieces(state, ride, park, design.pieces)
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
    if (typeof cmd.color === 'string' && /^#[0-9a-f]{6}$/i.test(cmd.color)) ride.color = cmd.color
    if (cmd.status === 'open') {
      if (ride.status === 'broken') return fail('A mechanic has to fix this ride first.')
      if (ride.kind === 'coaster' && !ride.complete) return fail('Finish the track circuit before opening.')
      if (ride.kind === 'coaster' && !ride.stats?.valid) return fail('This coaster failed its test run. Adjust the track first.')
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
    if (cmd.price !== undefined) {
      if (typeof cmd.price !== 'number' || !Number.isFinite(cmd.price) || cmd.price < 0 || cmd.price > 20) return fail('Prices run from free to $20.')
      stall.price = Math.round(cmd.price * 10) / 10
    }
    if (typeof cmd.open === 'boolean') stall.open = cmd.open
    return ok()
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
    const names = { handyman: ['Al', 'Bea', 'Cal', 'Dot', 'Ed', 'Flo', 'Gil', 'Hal'], mechanic: ['Ike', 'Jo', 'Kip', 'Lou', 'Mo', 'Ned', 'Ola', 'Pat'], entertainer: ['Pip', 'Ziggy', 'Bubbles', 'Sparky', 'Twirl', 'Jingles', 'Doodle', 'Wobble'] }[cmd.role]
    const id = state.staffSeq++
    state.staff.push({ id, role: cmd.role, park, name: `${def.name} ${names[id % names.length]}`, x: x + 0.5, y: y + 0.5, tx: x, ty: y, nx: -1, ny: -1, lane: 0, state: 'walk', target: null, timer: 0, swept: 0, fixed: 0, hired: state.time.seconds })
    spend(state, park, def.wage, 'wages')
    return ok({ id })
  },

  fire(state, cmd, park) {
    const index = state.staff.findIndex(s => s.id === cmd.id && s.park === park)
    if (index < 0) return fail('Choose one of your staff members.')
    const [member] = state.staff.splice(index, 1)
    if (member.target?.ride) { const ride = state.entities[member.target.ride]; if (ride?.mechanic === member.id) ride.mechanic = 0 }
    return ok()
  },

  park(state, cmd, park) {
    const p = state.parks[park]
    if (cmd.entryFee !== undefined) {
      if (typeof cmd.entryFee !== 'number' || !Number.isFinite(cmd.entryFee) || cmd.entryFee < 0 || cmd.entryFee > 100) return fail('Entry fees run from free to $100.')
      p.entryFee = Math.round(cmd.entryFee)
    }
    if (typeof cmd.open === 'boolean') { p.open = cmd.open; addNews(state, park, `${p.name} is now ${cmd.open ? 'open' : 'closed'} to new guests.`, 'info') }
    if (typeof cmd.name === 'string' && cmd.name.trim().length >= 2) p.name = cmd.name.trim().slice(0, 32)
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
  return result.ok ? { ok: true, cost: result.cost, closes: result.closes, length: pieceLengthTiles(piece) } : result
}
