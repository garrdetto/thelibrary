import { FLAT_RIDES, WAVE_SETTINGS } from './catalog.mjs'

const round1 = value => Math.round(value * 100) / 100

export function flatRideSize(def, size) {
  if (!def.resize || !Array.isArray(size)) return def.size
  const [minW, minH] = def.resize.min, [maxW, maxH] = def.resize.max
  const w = Math.round(size[0]), h = Math.round(size[1])
  if (!Number.isFinite(w) || !Number.isFinite(h)) return def.size
  return [Math.min(maxW, Math.max(minW, w)), Math.min(maxH, Math.max(minH, h))]
}

export function validFlatSize(def, w, h) {
  if (!def.resize) return w === undefined && h === undefined
  const [minW, minH] = def.resize.min, [maxW, maxH] = def.resize.max
  return Number.isInteger(w) && Number.isInteger(h) && w >= minW && w <= maxW && h >= minH && h <= maxH
}

export function flatSpec(rideId, size, wave) {
  const def = FLAT_RIDES[rideId]
  if (!def) return null
  if (!def.resize) return { size: def.size, cost: def.cost, upkeep: def.upkeep, capacity: def.capacity, rideTime: def.rideTime, loadTime: def.loadTime, height: def.height, stats: { ...def.stats } }
  const r = def.resize
  const [w, h] = flatRideSize(def, size)
  const tiles = w * h, baseTiles = def.size[0] * def.size[1]
  const sizeBonus = Math.max(-r.maxSizeBonus, Math.min(r.maxSizeBonus, (tiles - baseTiles) * r.excitementPerTile))
  const setting = def.waves ? WAVE_SETTINGS[wave] ?? WAVE_SETTINGS[def.waves] : null
  const stats = {
    e: round1(Math.max(0.5, def.stats.e + sizeBonus + (setting?.e ?? 0))),
    i: round1(Math.max(0.1, def.stats.i + (setting?.i ?? 0))),
    n: round1(Math.max(0, def.stats.n + (setting?.n ?? 0))),
  }
  return {
    size: [w, h],
    cost: Math.round(r.costBase + r.costPerTile * tiles),
    upkeep: Math.round(r.upkeepBase + r.upkeepPerTile * tiles),
    capacity: Math.max(4, Math.round(r.capacityPerTile * tiles)),
    rideTime: def.rideTime, loadTime: def.loadTime, height: def.height, stats,
  }
}

export function rideFlatSpec(ride) {
  return flatSpec(ride.ride, ride.size, ride.wave)
}
