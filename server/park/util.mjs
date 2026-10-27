export const TILE = 4
export const LAND = 1
export const UNIT = 0.5
export const SIM_STEP = 0.05
export const MONTH_SECONDS = 120
export const DAY_SECONDS = 40
export const MONTHS = ['March', 'April', 'May', 'June', 'July', 'August', 'September', 'October']
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]

export const clamp = (value, min, max) => value < min ? min : value > max ? max : value
export const lerp = (a, b, t) => a + (b - a) * t

export function hash32(value) {
  let h = value | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return (h ^ (h >>> 16)) >>> 0
}

export function hashString(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

export function makeRng(seed) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, get state() { return state }, set state(value) { state = value >>> 0 } }
}

export function stateRandom(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0
  let t = state.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function encodeRle(values) {
  const parts = []
  let i = 0
  while (i < values.length) {
    const value = values[i]
    let run = 1
    while (i + run < values.length && values[i + run] === value) run++
    parts.push(run > 1 ? `${value.toString(36)}*${run.toString(36)}` : value.toString(36))
    i += run
  }
  return parts.join(',')
}

export function decodeRle(text, length, fallback = 0) {
  const out = new Array(length).fill(fallback)
  if (typeof text !== 'string' || !text) return out
  let index = 0
  for (const part of text.split(',')) {
    const [raw, count] = part.split('*')
    const value = parseInt(raw, 36)
    const run = count ? parseInt(count, 36) : 1
    if (!Number.isFinite(value) || !Number.isFinite(run) || run < 1) continue
    for (let k = 0; k < run && index < length; k++) out[index++] = value
  }
  return out
}

const firstNames = ['Ava', 'Ben', 'Cleo', 'Dev', 'Ella', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jude', 'Kai', 'Lena', 'Milo', 'Nora', 'Owen', 'Pia', 'Quinn', 'Ruby', 'Sami', 'Theo', 'Uma', 'Vince', 'Wren', 'Xavi', 'Yara', 'Zane', 'Abby', 'Cole', 'Dina', 'Eli', 'Faye', 'Gus', 'Hana', 'Ivan', 'Joy', 'Leo', 'Maya', 'Nico', 'Olive', 'Remy', 'Sara', 'Toby', 'Vera', 'Will', 'Zoe']
export function guestName(id) {
  const h = hash32(id * 7919 + 13)
  return `${firstNames[h % firstNames.length]} ${String.fromCharCode(65 + (h >>> 8) % 26)}.`
}

export function formatMoney(value) {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return `${sign}$${abs >= 1000 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(abs % 1 ? 2 : 0)}`
}
