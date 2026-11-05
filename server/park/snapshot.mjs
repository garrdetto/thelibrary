import { encodeRle, decodeRle } from './util.mjs'

const STATES = ['walk', 'queue', 'ride', 'sit', 'buy', 'amenity']

export function encodeGuests(guests) {
  const out = new Int32Array(guests.length * 3)
  let k = 0
  for (const g of guests) {
    const state = Math.max(0, STATES.indexOf(g.state))
    const info = state | (g.hidden ? 8 : 0) | (g.items.includes('umbrella') ? 16 : 0) | (g.items.includes('balloon') ? 32 : 0) | (g.kid ? 64 : 0) | ((g.shirt & 15) << 7) | ((g.park & 3) << 11) | ((Math.round(g.happy) & 255) << 13)
    out[k++] = g.id
    out[k++] = (Math.round(g.x * 256) & 0xffff) | ((Math.round(g.y * 256) & 0x7fff) << 16)
    out[k++] = info
  }
  return out
}

export function decodeGuests(buffer, previous = []) {
  const data = buffer instanceof Int32Array ? buffer : new Int32Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
  const known = new Map(previous.map(g => [g.id, g]))
  const guests = []
  for (let k = 0; k + 2 < data.length; k += 3) {
    const id = data[k], pos = data[k + 1], info = data[k + 2]
    const g = known.get(id) ?? { id, items: [], thoughts: [] }
    g.x = (pos & 0xffff) / 256; g.y = ((pos >>> 16) & 0x7fff) / 256
    g.state = STATES[info & 7] ?? 'walk'; g.hidden = Boolean(info & 8)
    g.items = [info & 16 ? 'umbrella' : null, info & 32 ? 'balloon' : null].filter(Boolean)
    g.kid = Boolean(info & 64); g.shirt = (info >> 7) & 15; g.park = (info >> 11) & 3; g.happy = (info >> 13) & 255
    g.tx = Math.floor(g.x); g.ty = Math.floor(g.y)
    guests.push(g)
  }
  return guests
}

export function encodeDynamic(state, sinceNews = 0) {
  const rides = {}, stalls = {}, hotels = {}
  for (const e of Object.values(state.entities)) {
    if (e.type === 'ride') {
      const activeRiders = e.trains?.reduce((total, train) => total + train.riders.length, 0) ?? e.riders.length
      const trains = e.trains?.map(train => ({ s: train.s, v: train.v, ph: train.phase, n: train.riders.length })) ?? []
      rides[e.id] = { st: e.status, q: e.queue.length, r: activeRiders, c: e.cycle, rel: Math.round(e.reliability), rev: Math.round(e.revenue * 10) / 10, tr: e.totalRiders, mr: e.monthRiders, p: e.price, n: e.name, col: e.color, tc: e.trackColor, sc: e.supportColor, trc: e.trainColor, cs: e.colors ?? null, sch: e.scheme ?? null, m: e.mechanic, ...(trains.length ? { t: trains } : {}) }
    } else if (e.type === 'stall') stalls[e.id] = { s: e.sales, r: Math.round(e.revenue * 10) / 10, p: e.price, o: e.open }
    else if (e.type === 'hotel') hotels[e.id] = { o: e.occupancy, r: Math.round(e.revenue ?? 0), l: Math.round(e.lastNight ?? 0), d: Boolean(e.district), p: Math.round(e.profit ?? 0), c: e.condition ?? 100, iv: Math.round(e.invested ?? 0), n: e.night ?? null, h: e.nights ?? [], u: e.using ?? {}, td: e.today ?? null, yd: e.yesterday ?? null, vt: Math.round(e.visitTakings ?? 0), pr: e.prices ?? {} }
  }
  return {
    time: state.time, weather: state.weather, speed: state.speed, ended: state.ended, parks: state.parks,
    staff: state.staff.map(s => ({ id: s.id, role: s.role, park: s.park, name: s.name, x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100, tx: s.tx, ty: s.ty, state: s.state, swept: s.swept, fixed: s.fixed, target: s.target })),
    rides, stalls, hotels, litter: encodeRle(state.map.litter), nextId: state.nextId, structVersion: state.structVersion,
    news: state.news.filter(n => n.id > sinceNews),
  }
}

export function applyDynamic(state, dyn) {
  state.time = dyn.time; state.weather = dyn.weather; state.speed = dyn.speed; state.ended = dyn.ended
  state.parks = dyn.parks
  state.staff = dyn.staff
  for (const [id, r] of Object.entries(dyn.rides ?? {})) {
    const e = state.entities[id]
    if (!e || e.type !== 'ride') continue
    e.status = r.st; e.queueLength = r.q; e.ridersCount = r.r; e.cycle = r.c; e.reliability = r.rel; e.revenue = r.rev; e.totalRiders = r.tr; e.monthRiders = r.mr; e.price = r.p; e.name = r.n; e.color = r.col; e.trackColor = r.tc; e.supportColor = r.sc; e.trainColor = r.trc; e.colors = r.cs ?? null; e.scheme = r.sch ?? null; e.mechanic = r.m
    if (r.t && e.trains) {
      const trains = Array.isArray(r.t) ? r.t : [r.t]
      for (const [index, remote] of trains.entries()) {
        const train = e.trains[index] ?? (e.trains[index] = { s: 0, v: 0, phase: 'loading', timer: 0, riders: [], lap: 0, stalled: 0 })
        train.s = remote.s; train.v = remote.v; train.phase = remote.ph; train.ridersCount = remote.n
      }
    }
  }
  for (const [id, s] of Object.entries(dyn.stalls ?? {})) {
    const e = state.entities[id]
    if (!e || e.type !== 'stall') continue
    e.sales = s.s; e.revenue = s.r; e.price = s.p; e.open = s.o
  }
  for (const [id, h] of Object.entries(dyn.hotels ?? {})) {
    const e = state.entities[id]
    if (!e || e.type !== 'hotel') continue
    e.occupancy = h.o; e.revenue = h.r; e.lastNight = h.l; e.district = h.d
    if (h.p !== undefined) { e.profit = h.p; e.condition = h.c; e.invested = h.iv; e.night = h.n; e.nights = h.h }
    if (h.u !== undefined) { e.using = h.u; e.today = h.td; e.yesterday = h.yd; e.visitTakings = h.vt; e.prices = h.pr }
  }
  state.map.litter = decodeRle(dyn.litter, state.map.w * state.map.h, 0)
  const seen = new Set(state.news.map(n => n.id))
  for (const n of dyn.news ?? []) if (!seen.has(n.id)) state.news.push(n)
  if (state.news.length > 60) state.news.splice(0, state.news.length - 60)
  state.newsSeq = Math.max(state.newsSeq, ...state.news.map(n => n.id + 1))
}

export function guestDetail(state, id) {
  const g = state.guests.find(guest => guest.id === id)
  if (!g) return null
  return { id: g.id, park: g.park, happy: Math.round(g.happy), energy: Math.round(g.energy), hunger: Math.round(g.hunger), thirst: Math.round(g.thirst), toilet: Math.round(g.toilet), nausea: Math.round(g.nausea), cash: Math.round(g.cash * 100) / 100, spent: Math.round(g.spent * 100) / 100, rides: g.rides, items: g.items, thoughts: g.thoughts, state: g.state, kid: g.kid, inPark: Math.round(g.inPark), minI: g.minI, maxI: g.maxI, tolerance: g.tolerance, ride: g.ride, type: g.type ?? (g.kid ? 'kid' : 'casual'), warm: Math.round((g.warm ?? 0) * 10) / 10, hotel: g.hotel ?? 0, visit: g.visit ?? null }
}
