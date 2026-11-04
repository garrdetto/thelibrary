import { tileIndex, inMap, isWalkPath } from './terrain.mjs'
import { FLAT_RIDES } from './catalog.mjs'

// Every style can be built at any footprint between `min` and `max` (either way round) and any floor count in `floors`.
// Build cost scales with squares × floors, and towers above HIGH_RISE_FLOORS pay a structural premium per extra floor.
export const HOTELS = {
  motorInn: { name: 'Roadside Motor Inn', min: [2, 2], max: [24, 8], floors: [1, 3], base: 25000, perTileFloor: 1700, density: 0.9, rate: 29, upkeep: 5, luxury: 0, roofs: ['flat', 'gable'], colors: { primary: 0xf1e3c6, secondary: 0x3a8f87, trim: 0xd8432f }, description: 'A long, low strip of rooms with doors onto a shaded walkway. Cheap to build.' },
  skylineTower: { name: 'Skyline Tower', min: [3, 3], max: [16, 16], floors: [4, 32], base: 150000, perTileFloor: 520, density: 0.9, rate: 10, upkeep: 1.7, luxury: 0.6, roofs: ['flat', 'crown', 'spire'], colors: { primary: 0x9fb8cf, secondary: 0x2d3b55, trim: 0xf3f1ea }, description: 'A glass tower that packs hundreds of rooms onto a small lot.' },
  palmCove: { name: 'Palm Cove Bungalows', min: [3, 3], max: [24, 24], floors: [1, 2], base: 60000, perTileFloor: 2600, density: 0.35, rate: 130, upkeep: 23, luxury: 1, roofs: ['thatch'], colors: { primary: 0xf6ead0, secondary: 0xc79a5a, trim: 0x2e9f8f }, description: 'Private thatched bungalows among palms. Few rooms, very high rates.' },
  timberLodge: { name: 'Timber Lodge', min: [3, 3], max: [18, 14], floors: [1, 6], base: 50000, perTileFloor: 1500, density: 0.6, rate: 42, upkeep: 7, luxury: 0.4, roofs: ['gable', 'hip'], colors: { primary: 0x8a5a36, secondary: 0x3b5e3a, trim: 0xefe3c4 }, description: 'Log walls, a stone chimney and a steep roof. Cozy and well loved.' },
  castleKeep: { name: 'Castle Keep Hotel', min: [4, 4], max: [20, 20], floors: [2, 12], base: 120000, perTileFloor: 1300, density: 0.55, rate: 41, upkeep: 7, luxury: 0.7, roofs: ['battlement', 'cone'], colors: { primary: 0xc9c3b5, secondary: 0x5c4b8a, trim: 0xd8b24a }, description: 'Stone walls, corner towers and banners. Sleep like royalty.' },
  canopyTreehouses: { name: 'Canopy Treehouses', min: [3, 3], max: [18, 18], floors: [1, 4], base: 70000, perTileFloor: 2400, density: 0.3, rate: 134, upkeep: 23, luxury: 1, roofs: ['thatch', 'gable'], colors: { primary: 0x9a6b43, secondary: 0x4f8f3a, trim: 0xefe3c4 }, description: 'Cabins high in giant trees, joined by rope bridges.' },
  lagoonVillas: { name: 'Lagoon Water Villas', min: [3, 3], max: [24, 24], floors: [1, 2], base: 90000, perTileFloor: 3200, density: 0.3, rate: 197, upkeep: 35, luxury: 1, roofs: ['thatch'], colors: { primary: 0xf3f1ea, secondary: 0xb88a55, trim: 0x2f8fd0 }, description: 'Villas on stilts over a private lagoon. The most exclusive stay in the park.' },
  neonNights: { name: 'Neon Nights Retro', min: [2, 2], max: [16, 12], floors: [1, 10], base: 45000, perTileFloor: 1100, density: 0.75, rate: 25, upkeep: 4.4, luxury: 0.2, roofs: ['flat', 'sign'], colors: { primary: 0x2a2440, secondary: 0xe85d9b, trim: 0x39d0e0 }, description: 'Chrome, pastel and buzzing neon stripes that glow after dark.' },
}

// `cost` is paid once. Amenities earn `share` of the room rate from each booked room a night (more in luxury styles and
// with better service) and cost `upkeep` a day plus a per-room running cost, so they pay off in big, full, upmarket hotels.
export const HOTEL_ADDONS = {
  pool: { name: 'Rooftop pool', cost: 30000, occupancy: 0.06 },
  sign: { name: 'Sign', cost: 4000, occupancy: 0.02 },
  balconies: { name: 'Balconies', cost: 8000, occupancy: 0.03 },
  canopy: { name: 'Entrance canopy', cost: 3000, occupancy: 0.01 },
  restaurant: { name: 'Restaurant', cost: 40000, occupancy: 0.03, share: 0.08, upkeep: 220, amenity: true },
  spa: { name: 'Spa', cost: 65000, occupancy: 0.04, share: 0.1, upkeep: 380, amenity: true },
  conference: { name: 'Conference hall', cost: 90000, occupancy: 0.05, share: 0.07, upkeep: 450, amenity: true },
  giftShop: { name: 'Gift shop', cost: 12000, occupancy: 0, share: 0.03, upkeep: 60, amenity: true },
  kidsClub: { name: 'Kids club', cost: 22000, occupancy: 0.04, share: 0.03, upkeep: 140, amenity: true },
}

// Staffing levels: wage multiplier, occupancy change, daily wear on the building, and amenity spend multiplier.
export const HOTEL_SERVICE = {
  budget: { name: 'Budget', staff: 0.65, occupancy: -0.06, wear: 0.6, spend: 0.8 },
  standard: { name: 'Standard', staff: 1, occupancy: 0, wear: 0.35, spend: 1 },
  premium: { name: 'Premium', staff: 1.6, occupancy: 0.07, wear: 0.2, spend: 1.25 },
}

export const HOTEL_SIZE_LIMIT = 24
export const HOTEL_FLOOR_LIMIT = 40
export const HIGH_RISE_FLOORS = 8
export const HIGH_RISE_PREMIUM = 0.02
export const HOTEL_RATE_RANGE = [0.5, 2.5]
export const RESIZE_PREMIUM = 0.15
export const SHRINK_REFUND = 0.5
export const REFURBISH_SHARE = 0.25
export const HOTEL_HISTORY_NIGHTS = 30
export const AMENITY_RUNNING_SHARE = 0.4
export const AMENITY_FIT_OUT_NIGHTS = 30

// Amenities are fitted out per room, so a spa in a 400-room resort costs far more than one in a small lodge.
export function addonCost(id, kind, rooms) {
  const addon = HOTEL_ADDONS[id], def = HOTELS[kind]
  if (!addon || !def) return 0
  return Math.round(addon.cost + (addon.amenity ? rooms * addon.share * def.rate * AMENITY_FIT_OUT_NIGHTS : 0))
}

// One amenity's takings and running cost for a night. `occupied` is booked rooms; `rate` the room rate it keys off.
export function amenityBooks(addon, def, rooms, occupied, rate, service = HOTEL_SERVICE.standard) {
  if (!addon?.amenity) return { income: 0, cost: 0 }
  const perGuest = addon.share * rate * (0.6 + def.luxury) * service.spend
  return { income: occupied * perGuest, cost: addon.upkeep + rooms * addon.share * def.rate * AMENITY_RUNNING_SHARE, perGuest }
}

export const FLOOR_HEIGHT = 3.2
export const HOTEL_GUESTS_PER_ROOM = 0.5
export const RESORT_RADIUS = 10
export const NOISE_RADIUS = 6

export function hotelOrientedFits(def, w, h) {
  const fits = (a, b) => a >= def.min[0] && a <= def.max[0] && b >= def.min[1] && b <= def.max[1]
  return fits(w, h) || fits(h, w)
}

export function hotelSpec(kind, size, floors, addons = {}) {
  const def = HOTELS[kind]
  if (!def) return null
  const [w, h] = size
  const tileFloors = w * h * floors
  const rooms = Math.max(4, Math.round(tileFloors * def.density))
  const highRise = 1 + Math.max(0, floors - HIGH_RISE_FLOORS) * HIGH_RISE_PREMIUM
  const building = Math.round(def.base + def.perTileFloor * tileFloors * highRise)
  const extras = Object.keys(HOTEL_ADDONS).reduce((total, id) => total + (addons?.[id] ? addonCost(id, kind, rooms) : 0), 0)
  return { rooms, building, cost: building + extras, upkeep: Math.round(rooms * def.upkeep), rate: def.rate, guestBonus: Math.round(rooms * HOTEL_GUESTS_PER_ROOM) }
}

export function hotelRateLimits(kind) {
  const def = HOTELS[kind]
  return def ? [Math.max(1, Math.round(def.rate * HOTEL_RATE_RANGE[0])), Math.round(def.rate * HOTEL_RATE_RANGE[1])] : [1, 1]
}

// What changing a hotel's footprint or floors costs (building and per-room amenity fit-out): growing pays the
// difference plus RESIZE_PREMIUM, shrinking refunds SHRINK_REFUND of it. Negative means a refund.
export function hotelResizeCost(hotel, size, floors) {
  const before = hotelSpec(hotel.kind, hotel.size, hotel.floors, hotel.addons)?.cost ?? 0
  const after = hotelSpec(hotel.kind, size, floors, hotel.addons)?.cost ?? 0
  const diff = after - before
  return diff >= 0 ? Math.round(diff * (1 + RESIZE_PREMIUM)) : -Math.round(-diff * SHRINK_REFUND)
}

export function hotelRefurbishCost(hotel) {
  const building = hotelSpec(hotel.kind, hotel.size, hotel.floors)?.building ?? 0
  return Math.round(building * REFURBISH_SHARE * (100 - (hotel.condition ?? 100)) / 100)
}

export function hotelHeight(hotel) {
  return (hotel.floors ?? 1) * FLOOR_HEIGHT + 3
}

export function hotelEntranceFor(state, park, x, y, w, h) {
  const map = state.map, around = []
  for (let k = 0; k < w; k++) around.push([x + k, y + h], [x + k, y - 1])
  for (let k = 0; k < h; k++) around.push([x + w, y + k], [x - 1, y + k])
  for (const [tx, ty] of around) {
    if (!inMap(map, tx, ty)) continue
    const i = tileIndex(map, tx, ty)
    if (map.owner[i] === park && isWalkPath(map.path[i])) return { x: tx, y: ty }
  }
  return null
}

function hotelsOf(state, park) {
  return Object.values(state.entities).filter(e => e.type === 'hotel' && e.park === park)
}

const center = e => ({ x: e.x + (e.size?.[0] ?? 1) / 2, y: e.y + (e.size?.[1] ?? 1) / 2 })
const near = (a, b, r) => Math.abs(a.x - b.x) <= r && Math.abs(a.y - b.y) <= r

function poolsOf(state, park) {
  return Object.values(state.entities).filter(e => e.type === 'ride' && e.park === park && e.kind === 'flat' && (e.ride === 'pool' || e.ride === 'wavePool'))
}

export function resortHotels(state, park) {
  const hotels = hotelsOf(state, park), pools = poolsOf(state, park)
  const inDistrict = new Set()
  for (const hotel of hotels) {
    const c = center(hotel)
    const neighbour = hotels.some(other => other !== hotel && near(c, center(other), RESORT_RADIUS))
    const pool = pools.some(p => near(c, center(p), RESORT_RADIUS))
    if (neighbour && pool) inDistrict.add(hotel.id)
  }
  return inDistrict
}

export function hotelGuestBonus(state, park) {
  let bonus = 0
  for (const hotel of hotelsOf(state, park)) bonus += hotelSpec(hotel.kind, hotel.size, hotel.floors, hotel.addons)?.guestBonus ?? 0
  return bonus
}

function trackNearby(state, hotel) {
  const map = state.map, [w, h] = hotel.size
  for (let y = hotel.y - NOISE_RADIUS; y < hotel.y + h + NOISE_RADIUS; y++) for (let x = hotel.x - NOISE_RADIUS; x < hotel.x + w + NOISE_RADIUS; x++) {
    if (!inMap(map, x, y)) continue
    const cells = state.trackCells.get(tileIndex(map, x, y))
    if (cells?.some(cell => state.entities[cell.ride]?.style && !['kart', 'waterSlide', 'lazyRiver'].includes(state.entities[cell.ride].style))) return true
  }
  return false
}

function sceneryNearby(state, hotel) {
  const map = state.map, [w, h] = hotel.size
  let count = 0
  for (let y = hotel.y - 3; y < hotel.y + h + 3; y++) for (let x = hotel.x - 3; x < hotel.x + w + 3; x++) {
    if (!inMap(map, x, y)) continue
    if (state.entities[map.obj[tileIndex(map, x, y)]]?.type === 'scenery') count++
  }
  return count
}

function waterRideNearby(state, hotel) {
  const c = center(hotel)
  return Object.values(state.entities).some(e => e.type === 'ride' && e.park === hotel.park && e.kind === 'flat' && FLAT_RIDES[e.ride]?.category === 'water' && near(c, center(e), 8))
}

// Higher room rates than the style's going rate lose bookings, lower ones win them. Luxury guests mind price less.
export function rateFactor(def, rate) {
  const r = (rate ?? def.rate) / def.rate
  return Math.exp(-(1.2 - 0.45 * def.luxury) * (r - 1))
}

export function hotelOccupancy(state, hotel, inDistrict) {
  const def = HOTELS[hotel.kind], p = state.parks[hotel.park]
  if (!def || !p) return 0
  const service = HOTEL_SERVICE[hotel.service] ?? HOTEL_SERVICE.standard
  let occ = 0.3 + (p.rating / 999) * 0.45
  occ += Math.min(0.12, sceneryNearby(state, hotel) * 0.006)
  if (waterRideNearby(state, hotel)) occ += 0.08
  if (inDistrict) occ += 0.05
  for (const [id, addon] of Object.entries(HOTEL_ADDONS)) if (hotel.addons?.[id]) occ += addon.occupancy
  occ += service.occupancy
  if (trackNearby(state, hotel)) occ -= 0.1 + def.luxury * 0.1
  const condition = hotel.condition ?? 100
  if (condition < 80) occ -= (80 - condition) / 80 * 0.25
  occ *= rateFactor(def, hotel.rate)
  if (!hotel.entrance || !isWalkPath(state.map.path[tileIndex(state.map, hotel.entrance.x, hotel.entrance.y)])) occ *= 0.3
  if (!p.open) occ *= 0.5
  return Math.max(0.05, Math.min(0.97, Math.round(occ * 100) / 100))
}

// One night's books for a hotel at a given occupancy. Pure, so the UI can preview rate and service changes.
export function hotelNight(hotel, occupancy, inDistrict = false) {
  const def = HOTELS[hotel.kind]
  const spec = hotelSpec(hotel.kind, hotel.size, hotel.floors, hotel.addons)
  if (!def || !spec) return null
  const service = HOTEL_SERVICE[hotel.service] ?? HOTEL_SERVICE.standard
  const rate = hotel.rate ?? def.rate
  const occupied = spec.rooms * occupancy
  const rooms = Math.round(occupied * rate)
  let amenities = inDistrict ? occupied * (4 + 10 * def.luxury) : 0
  let amenityCosts = 0
  for (const [id, addon] of Object.entries(HOTEL_ADDONS)) {
    if (!hotel.addons?.[id] || !addon.amenity) continue
    const books = amenityBooks(addon, def, spec.rooms, occupied, rate, service)
    amenities += books.income
    amenityCosts += books.cost
  }
  const staff = Math.round(spec.rooms * def.upkeep * service.staff)
  const utilities = Math.round(occupied * (0.6 + 0.6 * def.luxury) + Math.max(0, (hotel.floors ?? 1) - 4) * 12)
  const maintenance = Math.round(spec.building * 0.0003)
  amenities = Math.round(amenities); amenityCosts = Math.round(amenityCosts)
  const income = rooms + amenities, costs = staff + utilities + maintenance + amenityCosts
  return { occupied: Math.round(occupied), rate, rooms, amenities, staff, utilities, maintenance, amenityCosts, income, costs, profit: income - costs }
}

export function updateHotels(state) {
  for (const p of state.parks) {
    const districts = resortHotels(state, p.id)
    p.resortHotels = districts.size
    for (const hotel of hotelsOf(state, p.id)) {
      const service = HOTEL_SERVICE[hotel.service] ?? HOTEL_SERVICE.standard
      hotel.district = districts.has(hotel.id)
      hotel.occupancy = hotelOccupancy(state, hotel, hotel.district)
      const night = hotelNight(hotel, hotel.occupancy, hotel.district)
      hotel.night = night
      hotel.lastNight = night.income
      hotel.revenue = (hotel.revenue ?? 0) + night.income
      hotel.profit = (hotel.profit ?? 0) + night.profit
      hotel.nights = [...(hotel.nights ?? []), night.profit].slice(-HOTEL_HISTORY_NIGHTS)
      hotel.condition = Math.max(0, Math.round(((hotel.condition ?? 100) - service.wear * (0.5 + hotel.occupancy)) * 10) / 10)
      p.cash += night.profit
      p.month.hotels = (p.month.hotels ?? 0) + night.rooms
      p.month.hotelAmenities = (p.month.hotelAmenities ?? 0) + night.amenities
      p.month.hotelStaff = (p.month.hotelStaff ?? 0) - night.staff
      p.month.hotelUpkeep = (p.month.hotelUpkeep ?? 0) - (night.utilities + night.maintenance + night.amenityCosts)
    }
  }
}

// Portfolio totals for one park's hotels, for the Resorts window.
export function hotelPortfolio(state, park) {
  const rows = hotelsOf(state, park)
  const total = { hotels: rows.length, rooms: 0, occupied: 0, income: 0, costs: 0, profit: 0, lifetime: 0, invested: 0 }
  for (const h of rows) {
    const spec = hotelSpec(h.kind, h.size, h.floors, h.addons)
    total.rooms += spec?.rooms ?? 0
    total.occupied += h.night?.occupied ?? 0
    total.income += h.night?.income ?? 0
    total.costs += h.night?.costs ?? 0
    total.profit += h.night?.profit ?? 0
    total.lifetime += h.profit ?? 0
    total.invested += h.invested ?? spec?.cost ?? 0
  }
  return total
}

export function hotelSpawn(state, park, rnd, cap) {
  const hotels = hotelsOf(state, park).filter(h => h.entrance && isWalkPath(state.map.path[tileIndex(state.map, h.entrance.x, h.entrance.y)]))
  if (!hotels.length || cap <= 0) return null
  const share = Math.min(0.6, hotelGuestBonus(state, park) / cap)
  if (rnd() >= share) return null
  const weights = hotels.map(h => (hotelSpec(h.kind, h.size, h.floors, h.addons)?.rooms ?? 0) * Math.max(0.05, h.occupancy ?? 0.5))
  let pick = rnd() * weights.reduce((a, b) => a + b, 0)
  for (let k = 0; k < hotels.length; k++) { pick -= weights[k]; if (pick <= 0) return hotels[k] }
  return hotels[hotels.length - 1]
}
