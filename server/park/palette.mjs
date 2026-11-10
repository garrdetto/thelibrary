import { FLAT_RIDES, COASTER_STYLES } from './catalog.mjs'

// Ride colors are "slots": slot 0 is the ride's main color (the legacy `color`
// field) and slots 1 and 2 are always the chase lights and the glow lights, so
// every ride carries neon. Extra slots follow per ride. Each slot has a role
// that presets and park color schemes fill: a scheme is just one color per role.

export const ROLES = ['primary', 'secondary', 'accent', 'trim', 'lights', 'glow']
export const ROLE_NAMES = { primary: 'Main', secondary: 'Second', accent: 'Accent', trim: 'Trim', lights: 'Lights', glow: 'Glow' }
export const SCHEME_COUNT = 3
export const HEX = /^#[0-9a-f]{6}$/i

const slot = (key, name, role, def) => ({ key, name, role, def })
const LIGHTS = (def = '#ffd34d') => slot('lights', 'Chase lights', 'lights', def)
const GLOW = (def = '#ff6fc8') => slot('glow', 'Glow lights', 'glow', def)

export const RIDE_SLOTS = {
  carousel: [slot('main', 'Canopy', 'primary', '#d8432f'), LIGHTS(), GLOW('#ff8ad8'), slot('alt', 'Canopy stripes', 'secondary', '#f3f1ea'), slot('platform', 'Platform', 'accent', '#b9824f'), slot('horses', 'Horses & poles', 'trim', '#d8b24a')],
  teacups: [slot('main', 'Cups', 'primary', '#e48bb0'), LIGHTS(), GLOW('#7ad7f0'), slot('alt', 'Second cups', 'secondary', '#f3f1ea'), slot('plate', 'Turntable', 'accent', '#7fb9d8'), slot('trim', 'Trim', 'trim', '#d8b24a')],
  ferris: [slot('main', 'Wheel', 'primary', '#3a77d0'), LIGHTS(), GLOW('#ff5c5c'), slot('cabins', 'Cabins', 'secondary', '#f0f0f0'), slot('legs', 'Legs', 'accent', '#f3f1ea'), slot('hub', 'Hub', 'trim', '#d8b24a')],
  swings: [slot('main', 'Crown', 'primary', '#3fae5c'), LIGHTS(), GLOW('#ff8ad8'), slot('roof', 'Roof cone', 'secondary', '#d8432f'), slot('seatsA', 'Seats', 'accent', '#3a77d0'), slot('seatsB', 'Second seats', 'trim', '#d8b24a')],
  bumper: [slot('main', 'Roof', 'primary', '#c2483a'), LIGHTS(), GLOW('#4df0ff'), slot('posts', 'Posts', 'secondary', '#f3f1ea'), slot('floor', 'Floor', 'accent', '#33363c'), slot('rail', 'Rail', 'trim', '#d8b24a')],
  ship: [slot('main', 'Sails', 'primary', '#f3f1ea'), LIGHTS(), GLOW('#ff7a3d'), slot('hull', 'Hull', 'secondary', '#7a4a2c'), slot('frame', 'Frame', 'accent', '#33363c'), slot('deck', 'Deck', 'trim', '#b98a5c')],
  dropTower: [slot('main', 'Tower', 'primary', '#7b51c9'), LIGHTS(), GLOW('#4df0ff'), slot('seats', 'Seats', 'secondary', '#d8b24a'), slot('cap', 'Cap', 'accent', '#d8432f'), slot('carriage', 'Carriage', 'trim', '#33363c')],
  topSpin: [slot('main', 'Gondola', 'primary', '#e0782a'), LIGHTS(), GLOW('#ff3df2'), slot('arms', 'Arms', 'secondary', '#d8432f'), slot('towers', 'Towers', 'accent', '#f3f1ea'), slot('trim', 'Trim', 'trim', '#d8b24a')],
  karts: [slot('main', 'Pit building', 'primary', '#d8432f'), LIGHTS(), GLOW('#4df0ff'), slot('track', 'Track', 'secondary', '#3b3e44'), slot('infield', 'Infield', 'accent', '#5f9f45'), slot('kerbs', 'Kerbs', 'trim', '#f3f1ea')],
  pool: [slot('main', 'Parasols', 'primary', '#3a77d0'), LIGHTS(), GLOW('#4df0ff'), slot('deck', 'Deck', 'secondary', '#efe3c4'), slot('water', 'Water', 'accent', '#36a3e0'), slot('trim', 'Trim', 'trim', '#f3f1ea')],
  waterslide: [slot('main', 'Tubes', 'primary', '#1fb5b0'), LIGHTS(), GLOW('#4df0ff'), slot('tower', 'Tower', 'secondary', '#f3f1ea'), slot('deck', 'Deck', 'accent', '#efe3c4'), slot('trim', 'Trim', 'trim', '#f2c94c')],
  zipper: [slot('main', 'Pods', 'primary', '#e2513d'), LIGHTS(), GLOW('#4df0ff'), slot('boom', 'Boom', 'secondary', '#f3f1ea'), slot('frame', 'Frame', 'accent', '#9aa3ad'), slot('trim', 'Trim', 'trim', '#d8b24a')],
  gravitron: [slot('main', 'Saucer', 'primary', '#c24a2e'), LIGHTS('#ffc23a'), GLOW('#3b7bff'), slot('band', 'Saucer band', 'secondary', '#e0a63a'), slot('arch', 'Arch', 'accent', '#2f7fb4'), slot('chevrons', 'Chevrons', 'trim', '#f2a52a'), slot('sign', 'Name letters', 'lights', '#ffd34d'), slot('marqueeA', 'Marquee A', 'glow', '#ff3b3b'), slot('marqueeB', 'Marquee B', 'accent', '#37e05a')],
  demoDerby: [slot('main', 'Grandstand roof', 'primary', '#c92f2a'), LIGHTS('#ffd34d'), GLOW('#ff7a3d'), slot('stands', 'Bleachers', 'secondary', '#2f6ea8'), slot('stripes', 'Barrier stripes', 'accent', '#f0a21a'), slot('towers', 'Light towers', 'trim', '#c9ccd1'), slot('sign', 'Sign letters', 'lights', '#ffd34d')],
}

const WATER_DEFAULTS = { wavePool: '#2f8fd0', bodySlides: '#e2513d', tubeSlides: '#3fae5c', familyRaft: '#f08a24', bowlSlide: '#9b51e0', funnelSlide: '#1fb5b0', halfPipe: '#e85d9b', trapdoor: '#d8432f', matRacer: '#f2c94c', aquaLoop: '#3a77d0', surfRider: '#2d3b55', splashPad: '#3a77d0', kiddieLagoon: '#f2c94c', bucketFort: '#f2c94c', lilyPads: '#3fae5c', cliffJump: '#d8432f' }
for (const [kind, def] of Object.entries(WATER_DEFAULTS)) RIDE_SLOTS[kind] = [slot('main', 'Ride color', 'primary', def), LIGHTS('#fff3c4'), GLOW('#4df0ff')]

export const COASTER_SLOTS = [slot('main', 'Trains', 'primary', null), LIGHTS(), GLOW('#4df0ff'), slot('track', 'Track', 'secondary', null), slot('support', 'Supports', 'accent', null)]

export const DEFAULT_SCHEMES = [
  { name: 'Carnival', colors: { primary: '#d8432f', secondary: '#f3f1ea', accent: '#3a77d0', trim: '#f2c230', lights: '#ffd34d', glow: '#ff5c5c' } },
  { name: 'Neon Nights', colors: { primary: '#23242c', secondary: '#3b3d4a', accent: '#9b51e0', trim: '#1fb5b0', lights: '#4df0ff', glow: '#ff3df2' } },
  { name: 'Seaside', colors: { primary: '#3a77d0', secondary: '#fbf6e8', accent: '#f08a24', trim: '#1fb5b0', lights: '#fff3c4', glow: '#7ad7f0' } },
]

export const PRESETS = [
  { name: 'Classic fair', colors: { primary: '#d8432f', secondary: '#f3f1ea', accent: '#3a77d0', trim: '#d8b24a', lights: '#ffd34d', glow: '#ff5c5c' } },
  { name: 'Candy pop', colors: { primary: '#e85d9b', secondary: '#fff1f7', accent: '#7ad7f0', trim: '#f2c230', lights: '#ffe066', glow: '#ff8ad8' } },
  { name: 'Midnight', colors: { primary: '#23242c', secondary: '#3b3d4a', accent: '#9b51e0', trim: '#1fb5b0', lights: '#4df0ff', glow: '#ff3df2' } },
  { name: 'Sunset boardwalk', colors: { primary: '#f08a24', secondary: '#fbe5c3', accent: '#d8432f', trim: '#2e8b8b', lights: '#ffd34d', glow: '#ff7a3d' } },
  { name: 'Evergreen', colors: { primary: '#3fae5c', secondary: '#efe3c4', accent: '#8a5a36', trim: '#f2c230', lights: '#d8ff8a', glow: '#ffd34d' } },
]

export function rideSlots(ride) {
  if (!ride) return []
  if (ride.kind === 'coaster') return COASTER_SLOTS
  return RIDE_SLOTS[ride.ride] ?? [slot('main', 'Ride color', 'primary', '#d8432f'), LIGHTS(), GLOW()]
}

export function slotDefault(ride, s) {
  if (s.def) return s.def
  const style = ride.kind === 'coaster' ? COASTER_STYLES[ride.style] : null
  if (!style) return '#d8432f'
  return s.key === 'track' ? style.track : s.key === 'support' ? style.support : style.train
}

function legacyColor(ride, s) {
  if (ride.kind === 'coaster') {
    if (s.key === 'main') return ride.trainColor
    if (s.key === 'track') return ride.trackColor ?? ride.color
    if (s.key === 'support') return ride.supportColor
    return null
  }
  return s.key === 'main' ? ride.color : null
}

export function parkSchemes(park) {
  const list = Array.isArray(park?.schemes) ? park.schemes : []
  return DEFAULT_SCHEMES.map((d, i) => sanitizeScheme(list[i], d))
}

export function sanitizeScheme(raw, fallback) {
  const colors = {}
  for (const role of ROLES) colors[role] = typeof raw?.colors?.[role] === 'string' && HEX.test(raw.colors[role]) ? raw.colors[role].toLowerCase() : fallback.colors[role]
  return { name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 24) : fallback.name, colors }
}

/** The ride's resolved colors, one hex string per slot, in slot order. */
export function rideColors(ride, park) {
  const slots = rideSlots(ride)
  const scheme = Number.isInteger(ride.scheme) ? parkSchemes(park)[ride.scheme] : null
  return slots.map(s => {
    const custom = ride.colors?.[s.key]
    if (typeof custom === 'string' && HEX.test(custom)) return custom.toLowerCase()
    if (scheme) return scheme.colors[s.role]
    const legacy = legacyColor(ride, s)
    if (typeof legacy === 'string' && HEX.test(legacy)) return legacy.toLowerCase()
    return slotDefault(ride, s)
  })
}

/** Colors for every slot from a set of role colors (a preset or a scheme). */
export function colorsFromRoles(ride, roles) {
  const out = {}
  for (const s of rideSlots(ride)) out[s.key] = roles[s.role]
  return out
}

export function sanitizeRideColors(ride, raw) {
  if (!raw || typeof raw !== 'object') return null
  const keys = new Set(rideSlots(ride).map(s => s.key))
  const out = {}
  for (const [key, value] of Object.entries(raw)) if (keys.has(key) && typeof value === 'string' && HEX.test(value)) out[key] = value.toLowerCase()
  return Object.keys(out).length ? out : null
}

export const FLAT_RIDE_KINDS = Object.keys(FLAT_RIDES)
