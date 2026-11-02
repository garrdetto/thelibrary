import { STALLS, FLAT_RIDES, COASTER_STYLES } from './catalog.mjs'
import { DIRS, clamp, stateRandom } from './util.mjs'
import { tileIndex, inMap, isWalkPath, pathsConnect } from './terrain.mjs'
import { frontTile, stallFrontTile, addNews } from './state.mjs'
import { rideFlatSpec } from './flatspec.mjs'
import { guestProfile, intensityLimit, warmUp, lovesRepeats } from './thrill.mjs'
import { recordComment, rideComment } from './comments.mjs'

const WALK_SPEED = 1.05
const STALL_GROUPS = { food: ['burger', 'pizza', 'fries', 'icecream'], drink: ['drinks', 'coffee'], toilet: ['toilet'], gift: ['balloon', 'umbrella', 'info', 'souvenir'] }

export function rideCapacity(ride) {
  if (ride.kind === 'flat') return rideFlatSpec(ride)?.capacity ?? 1
  const style = COASTER_STYLES[ride.style]
  return (ride.cars ?? 3) * style.seats * (style.trackType ? 1 : Math.max(1, ride.trains?.length ?? 2))
}

export function rideCycleSeconds(ride) {
  if (ride.kind === 'flat') { const def = FLAT_RIDES[ride.ride]; return def ? def.rideTime + def.loadTime + 2 : 30 }
  return (ride.stats?.rideTime ?? 40) + 9
}

export function rideValue(ride) {
  const s = ride.stats
  if (!s?.valid) return 0
  const bonus = ride.kind === 'coaster' && COASTER_STYLES[ride.style]?.category !== 'other' ? 1 : 0
  return Math.max(0.5, s.e * 1.15 + s.i * 0.25 - s.n * 0.15 + bonus)
}

function entranceTiles(state) {
  if (state.entranceCache?.v === state.pathVersion) return state.entranceCache
  const tiles = new Set(), exits = [], inside = []
  for (const e of Object.values(state.entities)) {
    if (e.type !== 'parkEntrance') continue
    tiles.add(tileIndex(state.map, e.x, e.y))
    const [ox, oy] = DIRS[(e.dir + 2) % 4]
    let x = e.x + ox, y = e.y + oy, last = null
    while (inMap(state.map, x, y) && state.map.path[tileIndex(state.map, x, y)]) { last = { x, y }; x += ox; y += oy }
    exits[e.park] = last ?? { x: e.x, y: e.y }
    const [ix, iy] = DIRS[e.dir]
    inside[e.park] = { x: e.x + ix, y: e.y + iy }
  }
  state.entranceCache = { v: state.pathVersion, tiles, exits, inside }
  return state.entranceCache
}

export function parkGateways(state) { return entranceTiles(state) }

function passable(state, i, allowQueue = false) {
  return isWalkPath(state.map.path[i]) || (allowQueue && state.map.path[i] === 2) || entranceTiles(state).tiles.has(i)
}

export function queueLine(state, ride) {
  const cache = state.queueCache ?? (state.queueCache = new Map())
  const key = `${state.pathVersion}:${ride.entrance}`
  const hit = cache.get(ride.id)
  if (hit && hit.key === key) return hit
  const gate = state.entities[ride.entrance]
  let result = { key, tiles: [], entry: null }
  if (gate) {
    const map = state.map
    const start = frontTile(gate)
    if (inMap(map, start.x, start.y)) {
      const si = tileIndex(map, start.x, start.y)
      if (isWalkPath(map.path[si])) result = { key, tiles: [[start.x, start.y]], entry: [start.x, start.y] }
      else if (map.path[si] === 2) {
        const tiles = [[start.x, start.y]], seen = new Set([si])
        let cur = [start.x, start.y], entry = null
        for (let guard = 0; guard < 400; guard++) {
          let next = null
          for (const [dx, dy] of DIRS) {
            const x = cur[0] + dx, y = cur[1] + dy
            if (!inMap(map, x, y)) continue
            const i = tileIndex(map, x, y)
            if (!pathsConnect(map, cur[0], cur[1], x, y)) continue
            if (isWalkPath(map.path[i]) && !entry) entry = [cur[0], cur[1]]
            if (map.path[i] === 2 && !seen.has(i) && !next) next = [x, y]
          }
          if (!next) break
          seen.add(tileIndex(map, next[0], next[1])); tiles.push(next); cur = next
        }
        const last = tiles[tiles.length - 1]
        let joins = false
        for (const [dx, dy] of DIRS) {
          const x = last[0] + dx, y = last[1] + dy
          if (inMap(map, x, y) && isWalkPath(map.path[tileIndex(map, x, y)]) && pathsConnect(map, last[0], last[1], x, y)) joins = true
        }
        result = { key, tiles, entry: joins ? last : entry ? tiles[tiles.findIndex(t => t[0] === entry[0] && t[1] === entry[1])] ?? last : null }
        if (joins) result.entry = last
      }
    }
  }
  cache.set(ride.id, result)
  return result
}

function seedsFor(state, key) {
  const [kind, raw] = key.split(':'), arg = Number(raw)
  const seeds = []
  if (kind === 'ride') {
    const ride = state.entities[arg]
    if (ride) { const line = queueLine(state, ride); if (line.entry) seeds.push(line.entry) }
  } else if (kind in STALL_GROUPS) {
    for (const e of Object.values(state.entities)) if (e.type === 'stall' && e.park === arg && STALL_GROUPS[kind].includes(e.kind)) { const f = stallFrontTile(e); seeds.push([f.x, f.y]) }
  } else if (kind === 'stall') {
    const e = state.entities[arg]
    if (e) { const f = stallFrontTile(e); seeds.push([f.x, f.y]) }
  } else if (kind === 'bench') {
    for (let i = 0; i < state.map.pathAdd.length; i++) if (state.map.pathAdd[i] === 1 && state.map.owner[i] === arg) seeds.push([i % state.map.w, Math.floor(i / state.map.w)])
  } else if (kind === 'exit') {
    const t = entranceTiles(state).exits[arg]; if (t) seeds.push([t.x, t.y])
  } else if (kind === 'enter') {
    const t = entranceTiles(state).inside[arg]; if (t) seeds.push([t.x, t.y])
  } else if (kind === 'fix') {
    const ride = state.entities[arg]
    for (const gateId of [ride?.exit, ride?.entrance]) { const gate = state.entities[gateId]; if (gate) { const f = frontTile(gate); seeds.push([f.x, f.y]) } }
  }
  return seeds
}

export function field(state, key) {
  const hit = state.fields.get(key)
  if (hit) return hit
  const map = state.map, n = map.w * map.h
  const allowQueue = key.startsWith('fix:')
  const dist = new Int16Array(n).fill(-1)
  const queue = new Int32Array(n)
  let head = 0, tail = 0
  for (const [x, y] of seedsFor(state, key)) {
    if (!inMap(map, x, y)) continue
    const i = tileIndex(map, x, y)
    if (dist[i] === 0) continue
    dist[i] = 0; queue[tail++] = i
  }
  while (head < tail) {
    const i = queue[head++], x = i % map.w, y = (i - x) / map.w, d = dist[i] + 1
    if (x > 0) { const j = i - 1; if (dist[j] < 0 && passable(state, j, allowQueue) && pathsConnect(map, x, y, x - 1, y)) { dist[j] = d; queue[tail++] = j } }
    if (x < map.w - 1) { const j = i + 1; if (dist[j] < 0 && passable(state, j, allowQueue) && pathsConnect(map, x, y, x + 1, y)) { dist[j] = d; queue[tail++] = j } }
    if (y > 0) { const j = i - map.w; if (dist[j] < 0 && passable(state, j, allowQueue) && pathsConnect(map, x, y, x, y - 1)) { dist[j] = d; queue[tail++] = j } }
    if (y < map.h - 1) { const j = i + map.w; if (dist[j] < 0 && passable(state, j, allowQueue) && pathsConnect(map, x, y, x, y + 1)) { dist[j] = d; queue[tail++] = j } }
  }
  if (state.fields.size > 400) state.fields.clear()
  state.fields.set(key, dist)
  return dist
}

export function mechanicJobDistance(state, mechanic, ride) {
  if (mechanic.role !== 'mechanic' || mechanic.park !== ride.park || ride.status !== 'broken') return -1
  const x = Number.isInteger(mechanic.tx) ? mechanic.tx : Math.floor(mechanic.x)
  const y = Number.isInteger(mechanic.ty) ? mechanic.ty : Math.floor(mechanic.y)
  if (!inMap(state.map, x, y)) return -1
  return field(state, `fix:${ride.id}`)[tileIndex(state.map, x, y)]
}

export function beautyMap(state) {
  if (state.beauty?.v === state.structVersion) return state.beauty.values
  const map = state.map, values = new Float32Array(map.w * map.h)
  const weights = { fountain: 3, statue: 2.2, topiary: 1.4, flowers: 1.2, oak: 0.8, pine: 0.7, birch: 0.8, palm: 0.9, bush: 0.5, hedge: 0.5, rock: 0.3 }
  for (const e of Object.values(state.entities)) {
    if (e.type !== 'scenery' && e.type !== 'ride') continue
    const w = e.type === 'scenery' ? weights[e.kind] ?? 0.4 : 0.6
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = e.x + dx, y = e.y + dy
      if (!inMap(map, x, y)) continue
      values[tileIndex(map, x, y)] += w / (1 + Math.abs(dx) + Math.abs(dy))
    }
  }
  for (let i = 0; i < values.length; i++) if (map.water[i] >= 0) for (const j of [i - 1, i + 1, i - map.w, i + map.w]) if (j >= 0 && j < values.length) values[j] += 0.15
  state.beauty = { v: state.structVersion, values }
  return values
}

function think(guest, text) {
  guest.thoughtAt = guest.inPark
  if (guest.thoughts[guest.thoughts.length - 1] === text) return
  guest.thoughts.push(text)
  if (guest.thoughts.length > 5) guest.thoughts.shift()
}

export function spawnGuest(state, park) {
  const gw = entranceTiles(state)
  const at = gw.exits[park]
  if (!at) return null
  const rnd = () => stateRandom(state)
  const kid = rnd() < 0.3
  const profile = guestProfile(rnd, kid)
  const guest = {
    id: state.guestSeq++, park, x: at.x + 0.5, y: at.y + 0.5, tx: at.x, ty: at.y, nx: -1, ny: -1, lane: (rnd() - 0.5) * 0.6,
    state: 'walk', target: { key: `enter:${park}` }, timer: 0, happy: 150 + rnd() * 60, energy: 180 + rnd() * 70, hunger: 20 + rnd() * 90, thirst: 20 + rnd() * 90, toilet: rnd() * 60, nausea: 0,
    cash: Math.round(kid ? 20 + rnd() * 30 : 40 + rnd() * 80), spent: 0, type: profile.type, minI: profile.minI, maxI: profile.maxI, tolerance: profile.tolerance, warm: 0, shirt: Math.floor(rnd() * 16),
    items: [], eating: 0, rides: 0, ridden: [], thoughts: [], inPark: 0, stay: 300 + rnd() * 600, patience: 60 + rnd() * 120, queueTime: 0, ride: 0, stuck: 0, lastDecide: 0, kid, paid: false,
  }
  state.guests.push(guest)
  return guest
}

function neighbors(state, guest, allowOutside) {
  const map = state.map, out = []
  for (const [dx, dy] of DIRS) {
    const x = guest.tx + dx, y = guest.ty + dy
    if (!inMap(map, x, y)) continue
    const i = tileIndex(map, x, y)
    if (!isWalkPath(map.path[i]) || !pathsConnect(map, guest.tx, guest.ty, x, y)) continue
    if (!allowOutside && map.owner[i] !== guest.park) continue
    out.push([x, y])
  }
  return out
}

function stepToward(state, walker, key) {
  const dist = field(state, key)
  const map = state.map, here = dist[tileIndex(map, walker.tx, walker.ty)]
  if (here === 0) return 'arrived'
  if (here < 0) return 'lost'
  const options = []
  for (const [dx, dy] of DIRS) {
    const x = walker.tx + dx, y = walker.ty + dy
    if (!inMap(map, x, y)) continue
    if (dist[tileIndex(map, x, y)] === here - 1 && pathsConnect(map, walker.tx, walker.ty, x, y)) options.push([x, y])
  }
  if (!options.length) return 'lost'
  const pick = options[Math.floor(stateRandom(state) * options.length)]
  walker.nx = pick[0]; walker.ny = pick[1]
  return 'moving'
}

function wander(state, walker, allowOutside = false) {
  const options = neighbors(state, walker, allowOutside)
  if (!options.length) return false
  const forward = options.filter(([x, y]) => x !== walker.px || y !== walker.py)
  const list = forward.length ? forward : options
  const pick = list[Math.floor(stateRandom(state) * list.length)]
  walker.px = walker.tx; walker.py = walker.ty
  walker.nx = pick[0]; walker.ny = pick[1]
  return true
}

function moveWalker(walker, dt, speed) {
  if (walker.nx < 0) return true
  const [dx, dy] = [walker.nx - walker.tx, walker.ny - walker.ty]
  const lx = -dy * walker.lane, ly = dx * walker.lane
  const gx = walker.nx + 0.5 + lx, gy = walker.ny + 0.5 + ly
  const ex = gx - walker.x, ey = gy - walker.y, d = Math.hypot(ex, ey), step = speed * dt
  walker.dir = Math.atan2(ey, ex)
  if (d <= step) {
    walker.x = gx; walker.y = gy; walker.px = walker.tx; walker.py = walker.ty; walker.tx = walker.nx; walker.ty = walker.ny; walker.nx = -1; walker.ny = -1
    return true
  }
  walker.x += ex / d * step; walker.y += ey / d * step
  return false
}

function relocate(state, walker) {
  const map = state.map
  for (let r = 1; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    const x = walker.tx + dx, y = walker.ty + dy
    if (inMap(map, x, y) && passable(state, tileIndex(map, x, y))) { walker.tx = x; walker.ty = y; walker.x = x + 0.5; walker.y = y + 0.5; walker.nx = -1; return true }
  }
  return false
}

function chooseTarget(state, guest) {
  const rnd = () => stateRandom(state)
  const park = guest.park
  const here = tileIndex(state.map, guest.tx, guest.ty)
  const reachable = key => field(state, key)[here] >= 0
  if (guest.happy < 45) { think(guest, 'I want to go home.'); return { key: `exit:${park}`, leave: true } }
  if (guest.energy < 25) { think(guest, 'I am exhausted.'); return { key: `exit:${park}`, leave: true } }
  if (guest.inPark > guest.stay) return { key: `exit:${park}`, leave: true }
  if (guest.cash < 1 && guest.hunger < 220) { think(guest, 'I have run out of money.'); return { key: `exit:${park}`, leave: true } }
  if (guest.toilet > 170) { if (reachable(`toilet:${park}`)) return { key: `toilet:${park}` }; think(guest, 'I need to find a restroom!'); guest.happy -= 4 }
  if (guest.thirst > 150 && !guest.eating) { if (reachable(`drink:${park}`)) return { key: `drink:${park}` }; think(guest, 'I am so thirsty.') }
  if (guest.hunger > 150 && !guest.eating) { if (reachable(`food:${park}`)) return { key: `food:${park}` }; think(guest, 'I am hungry, but I cannot find any food.') }
  if (guest.energy < 90 && rnd() < 0.6 && reachable(`bench:${park}`)) return { key: `bench:${park}` }
  if (rnd() < 0.8) {
    const choices = []
    let tooIntense = null, tooPricey = null
    for (const e of Object.values(state.entities)) {
      if (e.type !== 'ride' || e.park !== park || e.status !== 'open' || !e.stats?.valid) continue
      if (e.stats.i > intensityLimit(state, guest, e)) { tooIntense = e; continue }
      if (e.stats.n > guest.tolerance + (guest.nausea > 100 ? -2 : 0)) continue
      if (e.price > guest.cash) continue
      const value = rideValue(e)
      if (e.price > value * 1.6 + 0.5) { tooPricey = e; continue }
      const wait = (e.queue.length / Math.max(1, rideCapacity(e))) * rideCycleSeconds(e)
      if (wait > guest.patience * 1.3) continue
      if (!reachable(`ride:${e.id}`)) continue
      const water = e.kind === 'flat' && FLAT_RIDES[e.ride].category === 'water'
      if (water && state.weather.kind === 'rain') continue
      const recent = guest.ridden.includes(e.id) && !lovesRepeats(guest, e) ? 0.25 : 1
      const weather = water ? (state.weather.temp >= 24 ? 2.2 : state.weather.temp < 16 ? 0.35 : 1) * (state.weather.kind === 'sunny' ? 1.25 : state.weather.kind === 'cloudy' ? 0.85 : 1) : 1
      const fit = e.stats.i < guest.minI ? 0.5 : 1
      choices.push([e, (0.6 + e.stats.e) * recent * fit * weather])
    }
    if (choices.length) {
      let total = choices.reduce((sum, [, w]) => sum + w, 0), pick = rnd() * total
      for (const [e, w] of choices) { pick -= w; if (pick <= 0) return { key: `ride:${e.id}`, ride: e.id } }
      return { key: `ride:${choices[0][0].id}`, ride: choices[0][0].id }
    }
    if (tooIntense && rnd() < 0.3) { think(guest, `${tooIntense.name} looks too intense for me.`); if (rnd() < 0.25) recordComment(state, tooIntense, guest, 'tooIntense') }
    else if (tooPricey && rnd() < 0.4) { think(guest, `I am not paying that much for ${tooPricey.name}.`); if (rnd() < 0.25) recordComment(state, tooPricey, guest, 'tooPricey') }
  }
  if (rnd() < 0.12 && guest.cash > 4 && !guest.items.includes('balloon') && reachable(`gift:${park}`)) return { key: `gift:${park}` }
  if (state.weather.kind === 'rain' && !guest.items.includes('umbrella') && rnd() < 0.5 && reachable(`gift:${park}`)) return { key: `gift:${park}` }
  return null
}

function stallAt(state, guest, group) {
  for (const e of Object.values(state.entities)) {
    if (e.type !== 'stall' || e.park !== guest.park) continue
    if (group && !STALL_GROUPS[group]?.includes(e.kind)) continue
    const f = stallFrontTile(e)
    if (f.x === guest.tx && f.y === guest.ty) return e
  }
  return null
}

function buy(state, guest, stall) {
  const def = STALLS[stall.kind]
  const p = state.parks[guest.park]
  if (!stall.open) { think(guest, `${stall.name} is closed.`); return false }
  const fair = def.price * (state.weather.kind === 'rain' && def.item === 'umbrella' ? 2.2 : 1.6) + (def.item === 'drink' && state.weather.temp > 26 ? 1 : 0)
  if (stall.price > fair + 0.5) { think(guest, `${stall.name} is too expensive.`); guest.happy -= 6; return false }
  if (stall.price > guest.cash) { think(guest, 'I cannot afford that.'); return false }
  guest.cash -= stall.price; guest.spent += stall.price
  stall.sales++; stall.revenue += stall.price
  p.cash += stall.price; p.month.shops += stall.price
  if (def.kind === 'food') { guest.hunger = Math.max(0, guest.hunger + (def.hunger ?? 0)); guest.thirst = clamp(guest.thirst + (def.thirst ?? 0), 0, 255); guest.eating = 18; guest.happy += 6 }
  if (def.kind === 'drink') { guest.thirst = Math.max(0, guest.thirst + (def.thirst ?? 0)); guest.hunger = Math.max(0, guest.hunger + (def.hunger ?? 0)); guest.energy = Math.min(255, guest.energy + (def.energy ?? 0)); guest.toilet += 35; guest.eating = 10; guest.happy += 5 }
  if (def.kind === 'gift') { if (!guest.items.includes(def.item)) guest.items.push(def.item); guest.happy += def.happiness ?? 5 }
  if (def.kind === 'service') { guest.state = 'buy'; guest.timer = 5; guest.hidden = true; guest.toilet = 0; guest.happy += 4 }
  return true
}

function arrive(state, guest) {
  const target = guest.target
  guest.target = null
  if (!target) return
  const [kind, raw] = target.key.split(':')
  if (kind === 'exit') { guest.gone = true; return }
  if (kind === 'enter') {
    const p = state.parks[guest.park]
    if (!guest.paid) { guest.paid = true; guest.cash -= Math.min(guest.cash, p.entryFee); p.cash += p.entryFee; p.month.entry += p.entryFee; p.totalGuests++ }
    return
  }
  if (kind === 'ride') {
    const ride = state.entities[Number(raw)]
    if (!ride || ride.status !== 'open') { think(guest, ride ? `${ride.name} is closed.` : 'That ride is gone!'); guest.happy -= 4; return }
    guest.state = 'queue'; guest.ride = ride.id; guest.queueTime = 0
    ride.queue.push(guest.id)
    return
  }
  if (kind === 'bench') { guest.state = 'sit'; guest.timer = 10 + stateRandom(state) * 10; return }
  if (kind in STALL_GROUPS) {
    const stall = stallAt(state, guest, kind)
    if (stall) buy(state, guest, stall)
  }
}

function dropLitter(state, guest, amount) {
  const map = state.map
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = guest.tx + dx, y = guest.ty + dy
    if (inMap(map, x, y) && map.pathAdd[tileIndex(map, x, y)] === 2 && amount === 1) return
  }
  const i = tileIndex(map, guest.tx, guest.ty)
  if (map.path[i]) map.litter[i] = Math.min(6, map.litter[i] + amount)
}

export function updateGuests(state, dt) {
  const map = state.map
  const beauty = beautyMap(state)
  const entertainers = state.staff.filter(s => s.role === 'entertainer')
  const rain = state.weather.kind === 'rain'
  const guests = state.guests
  for (let gi = 0; gi < guests.length; gi++) {
    const g = guests[gi]
    if (g.gone) continue
    g.inPark += dt
    g.hunger = Math.min(255, g.hunger + 0.5 * dt)
    g.thirst = Math.min(255, g.thirst + (state.weather.temp > 26 ? 0.95 : 0.7) * dt)
    g.toilet = Math.min(255, g.toilet + 0.28 * dt)
    g.nausea = Math.max(0, g.nausea - 1.6 * dt)
    if (g.state === 'ride') continue
    if (g.state === 'buy') { g.timer -= dt; if (g.timer <= 0) { g.state = 'walk'; g.hidden = false } continue }
    if (g.state === 'sit') {
      g.energy = Math.min(255, g.energy + 7 * dt); g.timer -= dt
      if (g.timer <= 0 || g.energy > 240) { g.state = 'walk'; think(g, 'That was a nice rest.') }
      continue
    }
    g.energy = Math.max(0, g.energy - 0.22 * dt)
    const ti = tileIndex(map, g.tx, g.ty)
    let mood = (beauty[ti] - 1.1) * 0.12
    if (g.hunger > 200) mood -= 0.35
    if (g.thirst > 200) mood -= 0.45
    if (g.toilet > 220) mood -= 0.6
    if (g.energy < 50) mood -= 0.25
    if (g.nausea > 140) mood -= 0.4
    if (map.litter[ti]) { mood -= 0.12 * map.litter[ti]; if (map.litter[ti] > 2 && stateRandom(state) < 0.01) think(g, 'This path is disgusting.') }
    if (rain && !g.items.includes('umbrella')) mood -= 0.25
    if (g.state === 'queue') mood -= 0.08
    for (const s of entertainers) if (s.park === g.park && Math.abs(s.x - g.x) < 3 && Math.abs(s.y - g.y) < 3) mood += 0.6
    g.happy = clamp(g.happy + mood * dt, 0, 255)
    if (g.eating > 0) { g.eating -= dt; if (g.eating <= 0 && stateRandom(state) < 0.6) dropLitter(state, g, 1) }
    if (g.nausea > 200 && stateRandom(state) < 0.05 * dt && g.state !== 'queue') { dropLitter(state, g, 2); g.nausea = 60; g.happy -= 20; think(g, 'I feel sick.') }
    if (g.state === 'queue') {
      g.queueTime += dt
      if (g.queueTime > g.patience * 1.6) {
        const ride = state.entities[g.ride]
        if (ride) ride.queue = ride.queue.filter(id => id !== g.id)
        g.state = 'walk'; g.ride = 0; g.happy -= 20; think(g, `I have been queuing for ${ride?.name ?? 'that ride'} for ages.`)
        if (ride) recordComment(state, ride, g, 'gaveUp')
      }
      continue
    }
    const speed = WALK_SPEED * (g.kid ? 1.1 : 1) * (g.energy < 60 ? 0.75 : 1)
    if (!moveWalker(g, dt, speed)) continue
    const here = tileIndex(map, g.tx, g.ty)
    if (!passable(state, here) && map.path[here] !== 2) {
      if (!relocate(state, g)) { g.gone = true; continue }
    }
    if (g.target) {
      const res = stepToward(state, g, g.target.key)
      if (res === 'arrived') { arrive(state, g); if (!g.gone && g.state === 'walk') wander(state, g, false) }
      else if (res === 'lost') {
        if (g.target.leave) { g.stuck += 1; if (g.stuck > 6) g.gone = true; else wander(state, g, true) }
        else { if (g.target.ride) think(g, `I cannot find ${state.entities[g.target.ride]?.name ?? 'that ride'}.`); g.target = null; g.happy -= 3; wander(state, g, false) }
      }
      continue
    }
    g.lastDecide -= 1
    if (g.lastDecide <= 0) {
      g.lastDecide = 2 + Math.floor(stateRandom(state) * 3)
      g.target = chooseTarget(state, g)
      if (g.target) { const res = stepToward(state, g, g.target.key); if (res === 'arrived') arrive(state, g); else if (res === 'moving') continue }
    }
    if (!wander(state, g, false)) {
      if (!wander(state, g, true)) { g.stuck++; if (g.stuck > 30) g.target = { key: `exit:${g.park}`, leave: true } }
    }
  }
  if (guests.some(g => g.gone)) {
    const index = state.guestIndexOf === guests ? state.guestIndex : null
    state.guests = guests.filter(g => { if (!g.gone) return true; index?.delete(g.id); return false })
    if (index) state.guestIndexOf = state.guests
  }
}

export { think }

export function finishRide(state, ride, guest) {
  const s = ride.stats
  const pref = (guest.minI + guest.maxI) / 2
  const delta = 14 + s.e * 7 - Math.abs(s.i - pref) * 3.5 - (ride.price > rideValue(ride) * 1.2 ? 8 : 0)
  guest.happy = clamp(guest.happy + delta, 0, 255)
  guest.nausea = clamp(guest.nausea + s.n * 14, 0, 255)
  guest.energy = Math.max(0, guest.energy - 6)
  guest.rides++
  guest.ridden.push(ride.id); if (guest.ridden.length > 6) guest.ridden.shift()
  guest.thoughtAt = guest.inPark
  warmUp(guest, ride, delta >= 14)
  rideComment(state, ride, guest, { delta, value: rideValue(ride), loves: delta >= 14 && lovesRepeats(guest, ride) })
  if (delta >= 14 && lovesRepeats(guest, ride)) think(guest, `I want to ride ${ride.name} again!`)
  else if (s.e >= 6.5) think(guest, `${ride.name} was incredible!`)
  else if (s.e >= 4) think(guest, `${ride.name} was great fun.`)
  else if (delta < 8) think(guest, `${ride.name} was a bit dull.`)
  const exit = state.entities[ride.exit]
  const spot = exit ? frontTile(exit) : { x: ride.x, y: ride.y }
  guest.state = 'walk'; guest.ride = 0; guest.hidden = false
  guest.tx = spot.x; guest.ty = spot.y; guest.x = spot.x + 0.5; guest.y = spot.y + 0.5; guest.nx = -1; guest.lastDecide = 1
}

export function updateQueuePositions(state) {
  const byId = state.guestIndex
  for (const ride of Object.values(state.entities)) {
    if (ride.type !== 'ride' || !ride.queue?.length) continue
    const line = queueLine(state, ride)
    const tiles = line.tiles.length ? line.tiles : null
    ride.queue.forEach((id, k) => {
      const g = byId.get(id)
      if (!g || !tiles) return
      const slot = Math.min(tiles.length - 1, Math.floor(k / 3))
      const [x, y] = tiles[slot]
      const along = (k % 3) / 3 - 0.33
      const prev = tiles[Math.max(0, slot - 1)], dxl = slot > 0 ? x - prev[0] : 0, dyl = slot > 0 ? y - prev[1] : 0
      const gx = x + 0.5 + dxl * along + g.lane * 0.3, gy = y + 0.5 + dyl * along
      g.x += (gx - g.x) * 0.2; g.y += (gy - g.y) * 0.2; g.tx = x; g.ty = y
    })
  }
}

export function updateStaff(state, dt) {
  const map = state.map
  for (const s of state.staff) {
    if (s.state === 'sweep') { s.timer -= dt; if (s.timer <= 0) { map.litter[tileIndex(map, s.tx, s.ty)] = 0; s.swept++; s.state = 'walk' } continue }
    if (s.state === 'fix') {
      s.timer -= dt
      if (s.timer <= 0) {
        const ride = state.entities[s.target?.ride]
        if (ride && ride.status === 'broken') { ride.status = ride.wasOpen === false ? 'closed' : 'open'; ride.reliability = Math.min(100, ride.reliability + 18); ride.mechanic = 0; s.fixed++; addNews(state, ride.park, `${s.name} fixed ${ride.name}.`, 'ride', ride.id) }
        s.state = 'walk'; s.target = null
      }
      continue
    }
    if (!moveWalker(s, dt, s.role === 'mechanic' && s.target ? 1.5 : 0.9)) continue
    const here = tileIndex(map, s.tx, s.ty)
    if (!passable(state, here, s.role === 'mechanic' && Boolean(s.target?.ride))) { relocate(state, s); continue }
    if (s.role === 'handyman' && map.litter[here]) { s.state = 'sweep'; s.timer = 1.8; continue }
    if (s.role === 'mechanic' && s.target?.ride) {
      const ride = state.entities[s.target.ride]
      if (!ride || ride.status !== 'broken') { s.target = null }
      else {
        const res = stepToward(state, s, `fix:${ride.id}`)
        if (res === 'arrived') { s.state = 'fix'; s.timer = 6; continue }
        if (res === 'moving') continue
        s.target = null; ride.mechanic = 0
      }
    }
    if (s.role === 'handyman') {
      const route = nearestLitter(state, s)
      if (route) { s.nx = route[0]; s.ny = route[1]; continue }
    }
    if (!wander(state, s, false)) wander(state, s, true)
  }
}

function nearestLitter(state, s) {
  const map = state.map, start = tileIndex(map, s.tx, s.ty)
  const seen = new Map([[start, -1]]), queue = [start]
  for (let head = 0; head < queue.length && head < 220; head++) {
    const i = queue[head]
    if (i !== start && map.litter[i]) {
      let cur = i
      while (seen.get(cur) !== start) cur = seen.get(cur)
      return [cur % map.w, Math.floor(cur / map.w)]
    }
    const x = i % map.w, y = Math.floor(i / map.w)
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy
      if (!inMap(map, nx, ny)) continue
      const j = tileIndex(map, nx, ny)
      if (seen.has(j) || !isWalkPath(map.path[j]) || map.owner[j] !== s.park || !pathsConnect(map, x, y, nx, ny)) continue
      seen.set(j, i); queue.push(j)
    }
  }
  return null
}
