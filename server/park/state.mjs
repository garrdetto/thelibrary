import { SCENARIOS, FLAT_RIDES, COASTER_STYLES, STALLS, SCENERY, PARK_COLORS } from './catalog.mjs'
import { DIRS, encodeRle, decodeRle, hashString } from './util.mjs'
import { generateMap, tileIndex, inMap } from './terrain.mjs'
import { rebuildTrackCells, buildTrackPath } from './track.mjs'

export const ENGINE_VERSION = 3
export const MAX_GUESTS = 1600
export const START_MONTH = 0

export function footprint(entity) {
  if (entity.type === 'ride' && entity.kind === 'flat') {
    const [w, h] = FLAT_RIDES[entity.ride].size
    const swap = entity.rot % 2 === 1
    return { x: entity.x, y: entity.y, w: swap ? h : w, h: swap ? w : h }
  }
  return { x: entity.x, y: entity.y, w: 1, h: 1 }
}

export function footprintTiles(entity) {
  const f = footprint(entity), tiles = []
  for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) tiles.push([x, y])
  return tiles
}

export function parkName(index, mode) {
  const names = ['Sunfield', 'Bluewater', 'Greenhollow', 'Goldcrest']
  return mode === 'versus' ? `${names[index]} Park` : 'Thrill Park'
}

export function createPark(scenarioId, options = {}) {
  const scenario = SCENARIOS[scenarioId] ?? SCENARIOS.meadowbrook
  const mode = options.mode ?? (scenario.versus ? 'versus' : 'solo')
  const players = Math.max(1, Math.min(4, options.players ?? 1))
  const { map, scenery, entrances } = generateMap(scenario, players)
  const parkCount = scenario.versus ? entrances.length : 1
  const state = {
    v: ENGINE_VERSION,
    scenario: scenarioId in SCENARIOS ? scenarioId : 'meadowbrook',
    mode,
    seed: scenario.seed,
    rng: scenario.seed >>> 0,
    map,
    entities: {},
    nextId: 1,
    staffSeq: 1,
    guestSeq: 1,
    pathVersion: 1,
    structVersion: 1,
    parks: [],
    guests: [],
    staff: [],
    time: { tick: 0, seconds: 0, day: 0, month: START_MONTH, year: 1, dayFraction: 0.3 },
    weather: { kind: 'sunny', temp: 22, next: 40 },
    speed: 1,
    news: [],
    newsSeq: 1,
    ended: null,
    trackCells: new Map(),
    fields: new Map(),
  }
  for (let p = 0; p < parkCount; p++) {
    state.parks.push({
      id: p,
      name: options.parkNames?.[p] ?? parkName(p, mode),
      color: PARK_COLORS[p],
      cash: scenario.cash,
      loan: scenario.loan,
      maxLoan: scenario.maxLoan,
      entryFee: scenario.versus ? 10 : 15,
      rating: 300,
      value: 0,
      guestsIn: 0,
      totalGuests: 0,
      open: true,
      marketing: [],
      month: emptyLedger(),
      history: [],
      thoughts: [],
      objective: scenario.objective,
      status: 'playing',
      spawnDebt: 0,
      awards: [],
    })
  }
  for (const entrance of entrances) {
    const id = state.nextId++
    state.entities[id] = { id, type: 'parkEntrance', park: entrance.park, x: entrance.x, y: entrance.y, dir: entrance.dir }
    state.map.obj[tileIndex(map, entrance.x, entrance.y)] = id
  }
  for (const item of scenery) {
    const ti = tileIndex(map, item.x, item.y)
    if (map.obj[ti] || map.path[ti] || map.water[ti] >= 0) continue
    const id = state.nextId++
    state.entities[id] = { id, type: 'scenery', kind: item.kind, x: item.x, y: item.y, rot: (item.x * 7 + item.y * 3) % 4, park: map.owner[ti] }
    map.obj[ti] = id
  }
  addNews(state, -1, scenario.versus ? 'Welcome, tycoons! The company with the highest value at the end of year two wins.' : `Welcome to ${scenario.name}. ${objectiveText(scenario.objective)}`, 'info')
  return state
}

export function emptyLedger() {
  return { rides: 0, shops: 0, entry: 0, construction: 0, upkeep: 0, wages: 0, marketing: 0, interest: 0, landscaping: 0 }
}

export function objectiveText(objective) {
  if (!objective || objective.type === 'none') return 'No objective. Build freely.'
  if (objective.type === 'guests') return `Have ${objective.guests} guests in the park with a park rating of at least ${objective.rating} by the end of October, year ${objective.year}.`
  if (objective.type === 'value') return `Reach a park value of $${objective.value.toLocaleString('en-US')} by the end of October, year ${objective.year}.`
  if (objective.type === 'coasters') return `Build ${objective.count} roller coasters, each with an excitement rating of at least ${objective.excitement.toFixed(1)}, by the end of October, year ${objective.year}.`
  if (objective.type === 'versus') return 'Finish year two with the highest company value.'
  return ''
}

export function addNews(state, park, text, kind = 'info', ref = null) {
  state.news.push({ id: state.newsSeq++, t: state.time.seconds, park, text, kind, ref, date: `${state.time.month}:${state.time.year}` })
  if (state.news.length > 60) state.news.splice(0, state.news.length - 60)
}

export function entityCost(entity) {
  if (entity.type === 'stall') return STALLS[entity.kind].cost
  if (entity.type === 'scenery') return SCENERY[entity.kind].cost
  if (entity.type === 'ride' && entity.kind === 'flat') return FLAT_RIDES[entity.ride].cost
  if (entity.type === 'ride' && entity.kind === 'coaster') return entity.spent ?? COASTER_STYLES[entity.style].cost
  return 0
}

export function ridePath(state, ride) {
  if (!ride.complete) return null
  const cache = state.pathCache ?? (state.pathCache = new Map())
  const key = `${ride.id}:${ride.pieces.length}:${ride.rev ?? 0}`
  let entry = cache.get(ride.id)
  if (!entry || entry.key !== key) { entry = { key, path: buildTrackPath(ride) }; cache.set(ride.id, entry) }
  return entry.path
}

export function frontTile(gate) {
  const [dx, dy] = DIRS[gate.dir]
  return { x: gate.x + dx, y: gate.y + dy }
}

export function rideEntityTiles(state, ride) {
  if (ride.kind === 'flat') return footprintTiles(ride)
  const tiles = []
  for (let i = 0; i < state.map.obj.length; i++) if (state.map.obj[i] === ride.id) tiles.push([i % state.map.w, Math.floor(i / state.map.w)])
  return tiles
}

const STRUCT_KEYS = ['corners', 'surface', 'water', 'path', 'pathAdd', 'obj', 'owner', 'litter']

export function serializePark(state, includeGuests = true) {
  const map = { w: state.map.w, h: state.map.h }
  for (const key of STRUCT_KEYS) map[key] = encodeRle(state.map[key].map(v => v + 1))
  const entities = {}
  for (const [id, entity] of Object.entries(state.entities)) {
    const copy = { ...entity }
    if (copy.type === 'ride') { copy.queue = includeGuests ? [...(copy.queue ?? [])] : []; copy.riders = includeGuests ? [...(copy.riders ?? [])] : []; if (copy.trains) copy.trains = copy.trains.map(t => ({ ...t, riders: includeGuests ? [...t.riders] : [] })) }
    entities[id] = copy
  }
  return {
    v: state.v, scenario: state.scenario, mode: state.mode, seed: state.seed, rng: state.rng, map, entities,
    nextId: state.nextId, staffSeq: state.staffSeq, guestSeq: state.guestSeq, pathVersion: state.pathVersion, structVersion: state.structVersion,
    parks: state.parks, guests: includeGuests ? state.guests : [], staff: state.staff, time: state.time, weather: state.weather, speed: state.speed,
    news: state.news, newsSeq: state.newsSeq, ended: state.ended,
  }
}

const num = (value, fallback = 0, min = -1e12, max = 1e12) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

export function deserializePark(data) {
  if (!data || typeof data !== 'object' || !data.map || typeof data.map !== 'object') throw new Error('Invalid park file.')
  const w = Math.round(num(data.map.w, 0, 8, 128)), h = Math.round(num(data.map.h, 0, 8, 128))
  if (!w || !h) throw new Error('Invalid park size.')
  const sizes = { corners: (w + 1) * (h + 1), surface: w * h, water: w * h, path: w * h, pathAdd: w * h, obj: w * h, owner: w * h, litter: w * h }
  const map = { w, h }
  for (const key of STRUCT_KEYS) map[key] = decodeRle(data.map[key], sizes[key], key === 'water' ? 0 : key === 'owner' ? 256 : 1).map(v => v - 1)
  const scenario = SCENARIOS[data.scenario] ? data.scenario : 'sandbox'
  const state = {
    v: ENGINE_VERSION, scenario, mode: ['solo', 'coop', 'versus'].includes(data.mode) ? data.mode : 'solo', seed: num(data.seed, 1) >>> 0, rng: num(data.rng, 1) >>> 0,
    map, entities: {}, nextId: Math.round(num(data.nextId, 1, 1)), staffSeq: Math.round(num(data.staffSeq, 1, 1)), guestSeq: Math.round(num(data.guestSeq, 1, 1)),
    pathVersion: 1, structVersion: Math.round(num(data.structVersion, 1, 1)), parks: [], guests: [], staff: [],
    time: { tick: Math.round(num(data.time?.tick)), seconds: num(data.time?.seconds), day: Math.round(num(data.time?.day, 0, 0, 30)), month: Math.round(num(data.time?.month, 0, 0, 7)), year: Math.round(num(data.time?.year, 1, 1, 999)), dayFraction: num(data.time?.dayFraction, 0.3, 0, 1) },
    weather: { kind: ['sunny', 'cloudy', 'rain'].includes(data.weather?.kind) ? data.weather.kind : 'sunny', temp: num(data.weather?.temp, 20, -10, 40), next: num(data.weather?.next, 40, 0, 200) },
    speed: [0, 1, 2, 4].includes(data.speed) ? data.speed : 1,
    news: Array.isArray(data.news) ? data.news.slice(-60).filter(n => n && typeof n.text === 'string').map(n => ({ id: num(n.id), t: num(n.t), park: num(n.park, -1), text: n.text.slice(0, 240), kind: String(n.kind ?? 'info').slice(0, 20), ref: n.ref ?? null })) : [],
    newsSeq: Math.round(num(data.newsSeq, 1, 1)), ended: data.ended && typeof data.ended === 'object' ? { text: String(data.ended.text ?? '').slice(0, 240), winner: num(data.ended.winner, -1) } : null,
    trackCells: new Map(), fields: new Map(),
  }
  const parks = Array.isArray(data.parks) ? data.parks.slice(0, 4) : []
  if (!parks.length) throw new Error('This park file has no parks.')
  state.parks = parks.map((p, i) => ({
    id: i, name: String(p?.name ?? parkName(i, state.mode)).slice(0, 40), color: PARK_COLORS[i], cash: num(p?.cash), loan: num(p?.loan, 0, 0), maxLoan: num(p?.maxLoan, 0, 0),
    entryFee: num(p?.entryFee, 10, 0, 100), rating: num(p?.rating, 300, 0, 999), value: num(p?.value), guestsIn: 0, totalGuests: Math.round(num(p?.totalGuests, 0, 0)), open: p?.open !== false,
    marketing: Array.isArray(p?.marketing) ? p.marketing.slice(0, 4).map(m => ({ kind: String(m?.kind ?? 'flyers').slice(0, 12), until: num(m?.until), boost: num(m?.boost, 1, 1, 3) })) : [],
    month: { ...emptyLedger(), ...Object.fromEntries(Object.entries(p?.month ?? {}).map(([k, v]) => [k, num(v)])) },
    history: Array.isArray(p?.history) ? p.history.slice(-24).map(row => Object.fromEntries(Object.entries(row ?? {}).slice(0, 16).map(([k, v]) => [k.slice(0, 16), typeof v === 'number' ? num(v) : String(v).slice(0, 30)]))) : [],
    thoughts: [], objective: SCENARIOS[scenario].objective, status: ['playing', 'won', 'lost'].includes(p?.status) ? p.status : 'playing', spawnDebt: 0, awards: [],
  }))
  const entities = data.entities && typeof data.entities === 'object' ? Object.values(data.entities).slice(0, 20000) : []
  for (const raw of entities) {
    const entity = sanitizeEntity(raw, state)
    if (entity) state.entities[entity.id] = entity
  }
  for (const entity of Object.values(state.entities)) if (entity.id >= state.nextId) state.nextId = entity.id + 1
  for (let i = 0; i < map.obj.length; i++) if (map.obj[i] && !state.entities[map.obj[i]]) map.obj[i] = 0
  const guests = Array.isArray(data.guests) ? data.guests.slice(0, MAX_GUESTS * state.parks.length) : []
  const known = new Set()
  for (const g of guests) {
    if (!g || typeof g !== 'object') continue
    const id = Math.round(num(g.id, 0, 1))
    if (!id || known.has(id)) continue
    known.add(id)
    const guest = sanitizeGuest(g, state)
    if (guest) state.guests.push(guest)
  }
  for (const g of state.guests) if (g.id >= state.guestSeq) state.guestSeq = g.id + 1
  const guestIds = new Set(state.guests.map(g => g.id))
  for (const entity of Object.values(state.entities)) if (entity.type === 'ride') {
    entity.queue = (entity.queue ?? []).filter(id => guestIds.has(id))
    entity.riders = (entity.riders ?? []).filter(id => guestIds.has(id))
    if (entity.trains) for (const t of entity.trains) t.riders = (t.riders ?? []).filter(id => guestIds.has(id))
  }
  state.staff = (Array.isArray(data.staff) ? data.staff.slice(0, 400) : []).map(s => sanitizeStaff(s, state)).filter(Boolean)
  for (const s of state.staff) if (s.id >= state.staffSeq) state.staffSeq = s.id + 1
  rebuildTrackCells(state)
  return state
}

function sanitizeEntity(raw, state) {
  if (!raw || typeof raw !== 'object') return null
  const id = Math.round(num(raw.id, 0, 1, 1e9))
  const x = Math.round(num(raw.x, -1, 0, state.map.w - 1)), y = Math.round(num(raw.y, -1, 0, state.map.h - 1))
  if (!id || !inMap(state.map, x, y)) return null
  const park = Math.round(num(raw.park, 0, 0, 255))
  const base = { id, x, y, park }
  if (raw.type === 'parkEntrance') return { ...base, type: 'parkEntrance', dir: Math.round(num(raw.dir, 3, 0, 3)) }
  if (raw.type === 'scenery' && SCENERY[raw.kind]) return { ...base, type: 'scenery', kind: raw.kind, rot: Math.round(num(raw.rot, 0, 0, 3)) }
  if (raw.type === 'stall' && STALLS[raw.kind]) return { ...base, type: 'stall', kind: raw.kind, rot: Math.round(num(raw.rot, 0, 0, 3)), price: num(raw.price, STALLS[raw.kind].price, 0, 20), open: raw.open !== false, sales: Math.round(num(raw.sales, 0, 0)), revenue: num(raw.revenue, 0), name: String(raw.name ?? STALLS[raw.kind].name).slice(0, 32), built: num(raw.built) }
  if (raw.type === 'gate') return { ...base, type: 'gate', ride: Math.round(num(raw.ride, 0, 0)), role: raw.role === 'exit' ? 'exit' : 'entrance', dir: Math.round(num(raw.dir, 0, 0, 3)) }
  if (raw.type === 'ride') {
    const common = {
      ...base, type: 'ride', name: String(raw.name ?? 'Ride').slice(0, 32), price: num(raw.price, 1, 0, 20), status: ['open', 'closed', 'broken'].includes(raw.status) ? raw.status : 'closed',
      entrance: raw.entrance ? Math.round(num(raw.entrance, 0, 0)) : 0, exit: raw.exit ? Math.round(num(raw.exit, 0, 0)) : 0, queue: Array.isArray(raw.queue) ? raw.queue.slice(0, 2000).map(v => Math.round(num(v))) : [],
      riders: Array.isArray(raw.riders) ? raw.riders.slice(0, 64).map(v => Math.round(num(v))) : [], cycle: { phase: 'loading', timer: 0 }, reliability: num(raw.reliability, 95, 10, 100), downtime: num(raw.downtime, 0, 0),
      revenue: num(raw.revenue), totalRiders: Math.round(num(raw.totalRiders, 0, 0)), monthRiders: Math.round(num(raw.monthRiders, 0, 0)), built: num(raw.built), color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : null,
      stats: raw.stats && typeof raw.stats === 'object' ? Object.fromEntries(Object.entries(raw.stats).slice(0, 24).map(([k, v]) => [k, typeof v === 'boolean' ? v : num(v)])) : null, brokenAt: num(raw.brokenAt), mechanic: 0, cycles: Math.round(num(raw.cycles, 0, 0)),
    }
    if (raw.kind === 'flat' && FLAT_RIDES[raw.ride]) return { ...common, kind: 'flat', ride: raw.ride, rot: Math.round(num(raw.rot, 0, 0, 3)) }
    if (raw.kind === 'coaster' && COASTER_STYLES[raw.style]) {
      const pieces = Array.isArray(raw.pieces) ? raw.pieces.slice(0, 220).map(p => ({ c: Math.round(num(p?.c, 0, -2, 2)), s: Math.round(num(p?.s, 0, -2, 2)), ...(['station', 'chain', 'brakes', 'booster', 'loop'].includes(p?.sp) ? { sp: p.sp } : {}) })) : []
      const start = { x: Math.round(num(raw.start?.x, x, 0, state.map.w - 1)), y: Math.round(num(raw.start?.y, y, 0, state.map.h - 1)), dir: Math.round(num(raw.start?.dir, 0, 0, 3)), h: Math.round(num(raw.start?.h, 0, 0, 200)) }
      const trains = Array.isArray(raw.trains) ? raw.trains.slice(0, 1).map(t => ({ s: num(t?.s), v: num(t?.v, 0, -60, 60), phase: ['loading', 'departing', 'running', 'arriving', 'unloading', 'waiting'].includes(t?.phase) ? t.phase : 'loading', timer: num(t?.timer), riders: Array.isArray(t?.riders) ? t.riders.slice(0, 64).map(v => Math.round(num(v))) : [], lap: Math.round(num(t?.lap)), stalled: 0 })) : []
      return { ...common, kind: 'coaster', style: raw.style, start, pieces, complete: Boolean(raw.complete), trains, cars: Math.round(num(raw.cars, 3, 1, 8)), spent: num(raw.spent, 0, 0), rev: Math.round(num(raw.rev, 0, 0)) }
    }
  }
  return null
}

function sanitizeGuest(g, state) {
  const park = Math.round(num(g.park, 0, 0, state.parks.length - 1))
  const x = num(g.x, -1, 0, state.map.w), y = num(g.y, -1, 0, state.map.h)
  if (x < 0 || y < 0) return null
  return {
    id: Math.round(num(g.id, 1, 1)), park, x, y, tx: Math.floor(Math.min(x, state.map.w - 0.001)), ty: Math.floor(Math.min(y, state.map.h - 0.001)), nx: -1, ny: -1, lane: num(g.lane, 0, -0.35, 0.35),
    state: ['walk', 'queue', 'ride', 'leave', 'sit', 'buy', 'entering'].includes(g.state) ? g.state : 'walk', target: null, timer: num(g.timer), happy: num(g.happy, 180, 0, 255),
    energy: num(g.energy, 200, 0, 255), hunger: num(g.hunger, 60, 0, 255), thirst: num(g.thirst, 60, 0, 255), toilet: num(g.toilet, 30, 0, 255), nausea: num(g.nausea, 0, 0, 255),
    cash: num(g.cash, 40, 0, 1000), spent: num(g.spent, 0, 0), minI: num(g.minI, 2, 0, 10), maxI: num(g.maxI, 7, 0, 12), tolerance: num(g.tolerance, 5, 0, 12), shirt: Math.round(num(g.shirt, 0, 0, 15)),
    items: Array.isArray(g.items) ? g.items.filter(item => typeof item === 'string').slice(0, 6) : [], eating: num(g.eating, 0, 0, 60), rides: Math.round(num(g.rides, 0, 0)), ridden: Array.isArray(g.ridden) ? g.ridden.slice(-8).map(v => Math.round(num(v))) : [],
    thoughts: Array.isArray(g.thoughts) ? g.thoughts.slice(-5).filter(t => typeof t === 'string').map(t => t.slice(0, 80)) : [], inPark: num(g.inPark, 0, 0), stay: num(g.stay, 400, 60, 2000), patience: num(g.patience, 90, 20, 400),
    queueTime: 0, ride: Math.round(num(g.ride, 0, 0)), stuck: 0, lastDecide: 0, kid: Boolean(g.kid),
  }
}

function sanitizeStaff(s, state) {
  if (!s || typeof s !== 'object') return null
  const role = ['handyman', 'mechanic', 'entertainer'].includes(s.role) ? s.role : null
  if (!role) return null
  const x = num(s.x, -1, 0, state.map.w), y = num(s.y, -1, 0, state.map.h)
  if (x < 0 || y < 0) return null
  return { id: Math.round(num(s.id, 1, 1)), role, park: Math.round(num(s.park, 0, 0, state.parks.length - 1)), name: String(s.name ?? role).slice(0, 30), x, y, tx: Math.floor(x), ty: Math.floor(y), nx: -1, ny: -1, lane: 0, state: 'walk', target: null, timer: 0, swept: Math.round(num(s.swept, 0, 0)), fixed: Math.round(num(s.fixed, 0, 0)), hired: num(s.hired) }
}

export function checksum(state) {
  let h = state.nextId * 31 + state.structVersion
  for (const id of Object.keys(state.entities)) h = (h * 33 + hashString(id)) >>> 0
  return h >>> 0
}
