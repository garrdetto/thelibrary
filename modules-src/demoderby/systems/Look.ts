/** A car's look (body style, flat paint, number, font and number colour), validation and the per-device save of the player's choice. */
import { bodyById, config, fontById, numberColorById, paintById, type BodyStyle, type NumberFont } from '../config'

export interface CarLook {
  body: BodyStyle
  paint: string
  number: string
  font: NumberFont
  numberColor: string
  outline: boolean
}

export const DEFAULT_LOOK: CarLook = { body: 'wagon', paint: 'orange', number: '77', font: 'block', numberColor: 'white', outline: true }

export function cleanNumber(value: string): string {
  const cleaned = value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 3)
  return cleaned || '0'
}

export function cleanLook(value: unknown): CarLook {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const body = bodyById(String(raw.body ?? DEFAULT_LOOK.body)).id
  const paint = paintById(String(raw.paint ?? DEFAULT_LOOK.paint)).id
  const font = fontById(String(raw.font ?? DEFAULT_LOOK.font)).id
  const numberColor = numberColorById(String(raw.numberColor ?? DEFAULT_LOOK.numberColor)).id
  return {
    body,
    paint,
    number: cleanNumber(String(raw.number ?? DEFAULT_LOOK.number)),
    font,
    numberColor,
    outline: raw.outline === undefined ? DEFAULT_LOOK.outline : !!raw.outline,
  }
}

function storage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

export function loadLook(): CarLook {
  try {
    const stored = storage()?.getItem(config.storageKey)
    return stored ? cleanLook(JSON.parse(stored)) : DEFAULT_LOOK
  } catch {
    return DEFAULT_LOOK
  }
}

export function saveLook(look: CarLook): void {
  try {
    storage()?.setItem(config.storageKey, JSON.stringify(look))
  } catch {
    return
  }
}

/** A deterministic opponent look from a seed, so every car in the field is painted and numbered differently. */
export function opponentLook(seed: number, taken: ReadonlySet<string>): CarLook {
  let state = (seed * 2654435761 + 12345) >>> 0
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)]
  let number = ''
  for (let attempt = 0; attempt < 40; attempt++) {
    const style = next()
    number = style < 0.6 ? String(1 + Math.floor(next() * 99)) : style < 0.85 ? String(100 + Math.floor(next() * 899)) : `${pick(['X', 'K', 'J', 'B', 'T', 'Z'])}${1 + Math.floor(next() * 9)}`
    if (!taken.has(number)) break
  }
  const paint = pick(config.paints)
  const colors = config.numberColors.filter((color) => color.hex !== paint.hex)
  return { body: next() < 0.6 ? 'wagon' : 'sedan', paint: paint.id, number, font: pick(config.fonts).id, numberColor: pick(colors).id, outline: next() < 0.6 }
}
