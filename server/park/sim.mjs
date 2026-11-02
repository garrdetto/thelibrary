import { FLAT_RIDES, COASTER_STYLES, STALLS } from './catalog.mjs'
import { clamp, stateRandom, MONTHS, DAY_SECONDS, SIM_STEP } from './util.mjs'
import { CAR_GAP, stepTrain } from './track.mjs'
import { addNews, emptyLedger, entityCost, electricityTiles, ridePath, objectiveText } from './state.mjs'
import { updateGuests, updateStaff, updateQueuePositions, spawnGuest, finishRide, rideCapacity, mechanicJobDistance } from './guests.mjs'
import { ejectRide } from './commands.mjs'
import { rideFlatSpec } from './flatspec.mjs'
import { MAX_GUESTS, ensureGuestIndex } from './state.mjs'
import { ownedTileCount } from './land.mjs'

export const GUESTS_PER_OWNED_TILE = 0.7
export const BUILD_CAP_MULTIPLIER = 4
export const RIDE_SCORE_SPAWN_CEILING = 320

export const DAYS_PER_MONTH = 10
export const STAFF_WAGE_PER_DAY = 50
export const ELECTRICITY_COST_PER_TILE_PER_DAY = 1

export function dailyOperatingCosts(state, park) {
  const staffCount = state.staff.filter(member => member.park === park).length
  const poweredTiles = electricityTiles(state, park)
  return { wages: staffCount * STAFF_WAGE_PER_DAY, electricity: poweredTiles * ELECTRICITY_COST_PER_TILE_PER_DAY, poweredTiles }
}

function board(state, ride, list, capacity) {
  if (ride.status !== 'open' || !ride.queue.length || list.length >= capacity) return
  const id = ride.queue.shift()
  const g = state.guestIndex.get(id)
  if (!g || g.state !== 'queue') return
  if (g.cash < ride.price) { g.state = 'walk'; g.ride = 0; g.thoughts.push('I cannot afford the ride now.'); g.thoughtAt = g.inPark; return }
  g.cash -= ride.price; g.spent += ride.price
  const p = state.parks[ride.park]
  p.cash += ride.price; p.month.rides += ride.price
  ride.revenue += ride.price
  g.state = 'ride'; g.hidden = true
  list.push(id)
}

function unload(state, ride, list) {
  for (const id of list) { const g = state.guestIndex.get(id); if (g) finishRide(state, ride, g) }
  ride.totalRiders += list.length; ride.monthRiders += list.length
  list.length = 0
}

function maybeBreak(state, ride) {
  ride.cycles++
  ride.reliability = Math.max(35, ride.reliability - 0.35)
  const chance = (100 - ride.reliability) / 100 * 0.06 + 0.002
  if (stateRandom(state) >= chance) return
  ride.wasOpen = ride.status === 'open'
  ride.status = 'broken'; ride.brokenAt = state.time.seconds; ride.mechanic = 0
  for (const id of ride.queue) { const g = state.guestIndex.get(id); if (g) { g.state = 'walk'; g.ride = 0; g.happy -= 10; g.thoughts.push(`${ride.name} broke down!`) } }
  ride.queue = []
  const mechanics = state.staff.filter(s => s.role === 'mechanic' && s.park === ride.park)
  const routeAvailable = mechanics.some(s => mechanicJobDistance(state, s, ride) >= 0)
  const repairNote = routeAvailable ? ' A mechanic is on the way.' : mechanics.length ? ' No mechanic has a connected footpath route.' : ' Hire a mechanic to fix it.'
  addNews(state, ride.park, `${ride.name} has broken down.${repairNote}`, 'warning', ride.id)
}

function updateFlat(state, ride, dt) {
  const c = ride.cycle
  if (ride.status === 'broken') return
  const def = ride.size ? rideFlatSpec(ride) : FLAT_RIDES[ride.ride]
  c.timer += dt
  if (c.phase === 'loading') {
    c.board = (c.board ?? 0) + dt
    while (c.board > 0.25) { c.board -= 0.25; board(state, ride, ride.riders, def.capacity) }
    if (ride.riders.length && (c.timer >= def.loadTime || (ride.riders.length >= def.capacity && c.timer >= 2))) { c.phase = 'running'; c.timer = 0 }
    if (!ride.riders.length) c.timer = Math.min(c.timer, def.loadTime - 2)
  } else if (c.phase === 'running') {
    if (c.timer >= def.rideTime) { c.phase = 'unloading'; c.timer = 0 }
  } else if (c.phase === 'unloading') {
    if (c.timer >= 1.5) { unload(state, ride, ride.riders); c.phase = 'loading'; c.timer = 0; maybeBreak(state, ride) }
  }
  c.spin = ((c.spin ?? 0) + dt * (c.phase === 'running' ? 1 : 0)) % 10000
}

function updateCoaster(state, ride, dt) {
  if (!ride.complete || ride.status === 'broken') return
  const path = ridePath(state, ride)
  if (!path) return
  const rest = Math.max(0.5, path.stationEnd - 0.6)
  if (!ride.trains.length) ride.trains = [{ s: rest, v: 0, phase: 'loading', timer: 0, riders: [], lap: 0, stalled: 0 }, { s: rest, v: 0, phase: 'waiting', timer: 0, riders: [], lap: 0, stalled: 0, waitS: rest }]
  const trains = ride.trains
  const trainLength = (ride.cars - 1) * CAR_GAP
  const first = trains[0]
  if (trains[1]?.phase === 'waiting' && trains[1].waitS === 0) {
    trains[1].waitS = rest - trainLength - CAR_GAP
    trains[1].s = trains[1].waitS
  }
  if (trains[1]?.phase === 'waiting' && first.phase === 'running' && first.s - trainLength > path.stationEnd + 0.5) {
    trains[1].phase = 'loading'
    trains[1].s = rest
    trains[1].timer = 0
    trains[1].waitS = rest
  }
  const capacity = ride.cars * COASTER_STYLES[ride.style].seats
  let stalled = false
  for (const train of trains) {
    if (train.phase === 'waiting') continue
    const stationBusy = trains.some(other => other !== train && ['loading', 'departing', 'arriving', 'unloading'].includes(other.phase))
    if (train.phase === 'holding') {
      if (stationBusy) continue
      train.phase = 'running'
      train.v = 0
    } else if (train.phase === 'running' && train.s >= path.length - trainLength - CAR_GAP && stationBusy) {
      train.phase = 'holding'
      train.waitS = path.length - trainLength - CAR_GAP
      train.s = train.waitS
      train.v = 0
      continue
    }
    if (train.phase === 'loading') {
      train.timer += dt
      train.board = (train.board ?? 0) + dt
      while (train.board > 0.2) { train.board -= 0.2; board(state, ride, train.riders, capacity) }
      if (train.riders.length && (train.timer >= 8 || (train.riders.length >= capacity && train.timer >= 2.5))) { train.phase = 'departing'; train.timer = 0; train.lap = 0 }
      if (!train.riders.length) train.timer = Math.min(train.timer, 5)
      train.v = 0
      continue
    }
    if (train.phase === 'unloading') {
      train.timer += dt
      if (train.timer >= 2.5) { unload(state, ride, train.riders); train.phase = 'loading'; train.timer = 0; maybeBreak(state, ride) }
      continue
    }
    let result = null
    for (let k = 0; k < 2; k++) {
      result = stepTrain(path, train, ride.cars, dt / 2, { stallLimit: 20, style: COASTER_STYLES[ride.style] })
      if (result) break
    }
    if (result === 'arrived') { train.timer = 0; continue }
    if (result === 'stalled') { stalled = true; break }
  }
  ride.riders = trains.flatMap(train => train.riders)
  if (stalled) {
    for (const id of ride.riders) {
      const g = state.guestIndex.get(id)
      if (g) { finishRide(state, ride, g); g.happy -= 40; g.thoughts.push(`I was stuck on ${ride.name}!`) }
    }
    ride.wasOpen = ride.status === 'open'; ride.status = 'broken'; ride.brokenAt = state.time.seconds
    ejectRide(state, ride)
    addNews(state, ride.park, `${ride.name}'s train stalled on the track and had to be winched back.`, 'warning', ride.id)
  }
}

function updateKarts(state, ride, dt) {
  if (!ride.complete || ride.status === 'broken') return
  const path = ridePath(state, ride)
  if (!path) return
  if (ride.trains.length !== ride.cars) {
    const rest = Math.max(0.5, path.stationEnd - 0.6)
    ride.trains = Array.from({ length: ride.cars }, (_, index) => ({
      s: Math.max(0.5, rest - index * CAR_GAP), v: 0, phase: 'loading', timer: 0, riders: [], lap: 0, stalled: 0, pace: 0.94 + (index % 7) * 0.02,
    }))
  }
  let stalled = false
  for (const [index, kart] of ride.trains.entries()) {
    if (kart.phase === 'loading') {
      kart.timer += dt
      kart.board = (kart.board ?? 0) + dt
      while (kart.board > 0.2) { kart.board -= 0.2; board(state, ride, kart.riders, 2) }
      if (kart.riders.length && (kart.timer >= 8 || kart.riders.length === 2 && kart.timer >= 2.5)) {
        kart.phase = 'departing'; kart.timer = 0
      }
      if (!kart.riders.length) kart.timer = Math.min(kart.timer, 5)
      kart.v = 0
      continue
    }
    const pace = kart.pace ?? 1
    const style = COASTER_STYLES[ride.style]
    const result = stepTrain(path, kart, 1, dt, {
      stallLimit: 20,
      style: { ...style, drive: (style.drive ?? 0) * pace, maxSpeed: (style.maxSpeed ?? 20) * pace },
    })
    if (result === 'arrived') {
      unload(state, ride, kart.riders)
      kart.phase = 'loading'; kart.timer = 0; kart.v = 0; kart.lap = 0; kart.stalled = 0
      kart.s = Math.max(0.5, path.stationEnd - 0.6 - index * CAR_GAP)
      maybeBreak(state, ride)
    } else if (result === 'stalled') { stalled = true; break }
  }
  ride.riders = ride.trains.flatMap(kart => kart.riders)
  if (stalled) {
    for (const id of ride.riders) {
      const guest = state.guestIndex.get(id)
      if (guest) { finishRide(state, ride, guest); guest.happy -= 40; guest.thoughts.push(`I was stuck on ${ride.name}!`) }
    }
    ride.wasOpen = ride.status === 'open'; ride.status = 'broken'; ride.brokenAt = state.time.seconds
    ejectRide(state, ride)
    addNews(state, ride.park, `${ride.name}'s kart stalled on the track and had to be pushed back.`, 'warning', ride.id)
  }
}

function assignMechanics(state) {
  for (const ride of Object.values(state.entities)) {
    if (ride.type !== 'ride' || ride.status !== 'broken' || ride.mechanic) continue
    let best = null, bestD = Infinity
    for (const s of state.staff) {
      if (s.role !== 'mechanic' || s.park !== ride.park || s.target || s.state !== 'walk') continue
      const d = mechanicJobDistance(state, s, ride)
      if (d < 0) continue
      if (d < bestD) { bestD = d; best = s }
    }
    if (best) { best.target = { ride: ride.id }; ride.mechanic = best.id }
  }
}

export function spawnRate(state, p) {
  let rideScore = 0, openRides = 0, stalls = 0
  for (const e of Object.values(state.entities)) {
    if (e.park !== p.id) continue
    if (e.type === 'ride' && e.status === 'open' && e.stats?.valid) { rideScore += e.stats.e + (e.kind === 'coaster' && COASTER_STYLES[e.style]?.category !== 'other' ? 1.5 : 0); openRides++ }
    if (e.type === 'stall' && e.open) stalls++
  }
  const buildCap = Math.round(BUILD_CAP_MULTIPLIER * (30 + rideScore * 26 + stalls * 8))
  const landCap = Math.round(ownedTileCount(state, p.id) * GUESTS_PER_OWNED_TILE)
  const cap = Math.min(MAX_GUESTS, buildCap, landCap)
  const limit = cap === MAX_GUESTS ? 'max' : cap === landCap ? 'land' : 'rides'
  if (!p.open) return { rate: 0, cap: 0, buildCap, landCap, limit: 'closed' }
  if (!openRides) return { rate: 0.03, cap, buildCap, landCap, limit }
  const base = 0.22 + Math.min(rideScore, RIDE_SCORE_SPAWN_CEILING) * 0.055
  const ratingF = 0.35 + p.rating / 1000 * 1.2
  const feeF = clamp(1.15 - p.entryFee / (22 + rideScore * 3), 0.12, 1.15)
  const seasonF = [0.7, 0.85, 1, 1.15, 1.2, 1.1, 0.85, 0.7][state.time.month] ?? 1
  const weatherF = state.weather.kind === 'rain' ? 0.45 : state.weather.kind === 'cloudy' ? 0.85 : 1
  const nightF = state.time.dayFraction > 0.86 || state.time.dayFraction < 0.18 ? 0.25 : 1
  const marketF = p.marketing.reduce((m, c) => m * c.boost, 1)
  let rate = base * ratingF * feeF * seasonF * weatherF * nightF * marketF
  if (p.guestsIn >= cap) rate *= 0.04
  return { rate, cap, buildCap, landCap, limit }
}

function updateRating(state) {
  const sums = state.parks.map(() => ({ happy: 0, count: 0 }))
  for (const g of state.guests) { const s = sums[g.park]; if (s) { s.happy += g.happy; s.count++ } }
  const litter = state.parks.map(() => 0)
  for (let i = 0; i < state.map.litter.length; i++) if (state.map.litter[i]) { const o = state.map.owner[i]; if (litter[o] !== undefined) litter[o] += state.map.litter[i] }
  for (const p of state.parks) {
    let open = 0, broken = 0, scenery = 0
    for (const e of Object.values(state.entities)) {
      if (e.park !== p.id) continue
      if (e.type === 'ride' && e.status === 'open') open++
      if (e.type === 'ride' && e.status === 'broken') broken++
      if (e.type === 'scenery') scenery++
    }
    const s = sums[p.id]
    p.guestsIn = s.count
    const avg = s.count ? s.happy / s.count : 140
    p.happiness = Math.round(avg / 255 * 100)
    const target = clamp(140 + (avg / 255) * 430 + Math.min(open * 20, 220) + Math.min(s.count * 0.12, 120) - Math.min(litter[p.id] * 1.5, 180) - broken * 30 + Math.min(scenery * 0.25, 80), 0, 999)
    p.rating = Math.round(p.rating + (target - p.rating) * 0.08)
    p.litter = litter[p.id]
  }
}

export function parkValue(state, park) {
  let value = 0
  for (const e of Object.values(state.entities)) if (e.park === park && (e.type === 'ride' || e.type === 'stall')) value += entityCost(e)
  return Math.round(value + state.parks[park].guestsIn * 6)
}

export function companyValue(state, park) {
  const p = state.parks[park]
  return Math.round(parkValue(state, park) + p.cash - p.loan)
}

function aggregateThoughts(state) {
  const counts = state.parks.map(() => new Map())
  for (const g of state.guests) {
    const t = g.thoughts[g.thoughts.length - 1]
    if (!t || !counts[g.park] || g.inPark - (g.thoughtAt ?? -999) > 90) continue
    const generic = t.replace(/^I cannot find .+\.$/, 'I cannot find the ride I want.').replace(/^I have been queuing for .+$/, 'I have been queuing for ages.').replace(/^I am not paying that much for .+$/, 'That ride is too expensive.').replace(/^.+ looks too intense for me\.$/, 'That ride looks too intense for me.')
    counts[g.park].set(generic, (counts[g.park].get(generic) ?? 0) + 1)
  }
  state.parks.forEach((p, i) => { p.thoughts = [...counts[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 8) })
}

function endOfMonth(state) {
  const finished = state.time.month, year = state.time.year
  for (const p of state.parks) {
    let upkeep = 0
    for (const e of Object.values(state.entities)) {
      if (e.park !== p.id) continue
      if (e.type === 'ride') upkeep += e.kind === 'flat' ? rideFlatSpec(e).upkeep : COASTER_STYLES[e.style].upkeep + e.pieces.length * 2
      if (e.type === 'stall') upkeep += STALLS[e.kind].upkeep
      if (e.type === 'ride') e.monthRiders = 0
    }
    const interest = Math.round(p.loan * 0.012)
    p.cash -= upkeep + interest
    p.month.upkeep -= upkeep; p.month.interest -= interest
    const income = p.month.rides + p.month.shops + p.month.entry
    const expenses = p.month.construction + p.month.upkeep + p.month.wages + p.month.electricity + p.month.marketing + p.month.interest + p.month.landscaping
    p.value = parkValue(state, p.id)
    p.history.push({ label: `${MONTHS[finished].slice(0, 3)} Y${year}`, income: Math.round(income), expenses: Math.round(expenses), profit: Math.round(income + expenses), guests: p.guestsIn, rating: p.rating, value: p.value, cash: Math.round(p.cash), company: companyValue(state, p.id), ...Object.fromEntries(Object.entries(p.month).map(([k, v]) => [k, Math.round(v)])) })
    if (p.history.length > 24) p.history.shift()
    p.month = emptyLedger()
    if (p.cash < 0 && p.cash + p.maxLoan - p.loan < 0 && state.scenario !== 'sandbox') addNews(state, p.id, `${p.name} is deep in debt. Raise prices or cut costs.`, 'warning')
  }
  if (finished === MONTHS.length - 1) checkYearEnd(state, year)
  else for (const p of state.parks) if (p.status === 'playing' && objectiveMet(state, p)) declare(state, p, true)
}

function objectiveMet(state, p) {
  const o = p.objective
  if (!o || o.type === 'none' || o.type === 'versus') return false
  if (o.type === 'guests') return p.guestsIn >= o.guests && p.rating >= o.rating
  if (o.type === 'value') return parkValue(state, p.id) >= o.value
  if (o.type === 'coasters') return Object.values(state.entities).filter(e => e.type === 'ride' && e.kind === 'coaster' && COASTER_STYLES[e.style]?.category !== 'other' && e.park === p.id && e.complete && (e.stats?.e ?? 0) >= o.excitement).length >= o.count
  return false
}

function declare(state, p, won) {
  p.status = won ? 'won' : 'lost'
  addNews(state, p.id, won ? `Congratulations! ${p.name} has completed its objective: ${objectiveText(p.objective)} You can keep building.` : `Objective failed. ${objectiveText(p.objective)} You can keep playing.`, won ? 'win' : 'warning')
}

function checkYearEnd(state, year) {
  if (state.mode === 'versus') {
    if (year >= 2 && !state.ended) {
      const values = state.parks.map(p => companyValue(state, p.id))
      const best = values.indexOf(Math.max(...values))
      state.ended = { winner: best, text: `${state.parks[best].name} wins with a company value of $${values[best].toLocaleString('en-US')}.`, values }
      addNews(state, -1, state.ended.text, 'win')
      state.speed = 0
    }
    return
  }
  for (const p of state.parks) {
    if (p.status !== 'playing' || !p.objective || p.objective.type === 'none') continue
    if (objectiveMet(state, p)) declare(state, p, true)
    else if (year >= p.objective.year) declare(state, p, false)
  }
}

function newDay(state) {
  for (const park of state.parks) {
    const costs = dailyOperatingCosts(state, park.id)
    park.cash -= costs.wages + costs.electricity
    park.month.wages -= costs.wages
    park.month.electricity -= costs.electricity
  }
  const r = stateRandom(state)
  const kind = r < 0.5 ? 'sunny' : r < 0.8 ? 'cloudy' : 'rain'
  const base = [13, 17, 21, 25, 27, 26, 21, 15][state.time.month] ?? 20
  const temp = Math.round(base + (stateRandom(state) - 0.5) * 8 - (kind === 'rain' ? 3 : 0))
  if (kind !== state.weather.kind && kind === 'rain') addNews(state, -1, 'Rain is on the way. Umbrella sales should pick up.', 'weather')
  state.weather = { kind, temp, next: DAY_SECONDS }
}

export function stepPark(state, dt = SIM_STEP) {
  const t = state.time
  t.tick++
  t.seconds += dt
  t.dayFraction += dt / DAY_SECONDS
  ensureGuestIndex(state)
  if (t.dayFraction >= 1) {
    t.dayFraction -= 1
    t.day++
    newDay(state)
    if (t.day >= DAYS_PER_MONTH) {
      t.day = 0
      endOfMonth(state)
      t.month++
      if (t.month >= MONTHS.length) { t.month = 0; t.year++ }
      addNews(state, -1, `It is now ${MONTHS[t.month]}, year ${t.year}.`, 'date')
    }
  }
  const whole = t.tick % 20 === 0
  for (const p of state.parks) {
    if (whole) { p.marketing = p.marketing.filter(m => m.until > t.seconds); p.spawn = spawnRate(state, p) }
    const { rate = 0, cap = 0 } = p.spawn ?? {}
    p.spawnDebt += rate * dt
    while (p.spawnDebt >= 1) {
      p.spawnDebt -= 1
      if (p.guestsIn < cap && state.guests.length < MAX_GUESTS * state.parks.length) { const g = spawnGuest(state, p.id); if (g) { p.guestsIn++; state.guestIndex.set(g.id, g) } }
    }
  }
  for (const e of Object.values(state.entities)) {
    if (e.type !== 'ride') continue
    if (e.kind === 'flat') updateFlat(state, e, dt)
    else if (COASTER_STYLES[e.style]?.trackType === 'kart') updateKarts(state, e, dt)
    else updateCoaster(state, e, dt)
  }
  updateGuests(state, dt)
  ensureGuestIndex(state)
  for (const e of Object.values(state.entities)) if (e.type === 'ride' && e.queue.length) e.queue = e.queue.filter(id => state.guestIndex.get(id)?.state === 'queue')
  updateQueuePositions(state)
  updateStaff(state, dt)
  if (whole) { assignMechanics(state); updateRating(state) }
  if (t.tick % 100 === 0) { aggregateThoughts(state); for (const p of state.parks) p.value = parkValue(state, p.id) }
}
