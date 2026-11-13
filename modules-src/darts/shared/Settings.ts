/** The administrator's Darts settings (admin console → Module settings → Darts, stored by `/api/darts-settings`): the throw meter's timing and zones, whether the classic one-stage meter is offered, the page's setup defaults, and the colours of both boards and the darts. Renderer-free and deterministic: the page and the `DartsRoom` Durable Object both read it, and `applyMeterSettings` retunes `METER` the same way in each, so online throws land where the page's meter said. Every default reproduces the module exactly as it was before the settings existed. */
import { METER, type MeterTuning } from './Physics'
import type { CpuLevel } from './interfaces'

/** The classic one-stage meter: not offered (`off`), offered with the cross meter as the default (`option`), offered as the default (`default`), or the only meter (`only`). */
export type ClassicMeterMode = 'off' | 'option' | 'default' | 'only'
export const CLASSIC_METER_MODES: readonly ClassicMeterMode[] = ['off', 'option', 'default', 'only']

export type DartFinish = 'stock' | 'polished' | 'satin' | 'matte'
export const DART_FINISHES: readonly DartFinish[] = ['stock', 'polished', 'satin', 'matte']
/** Roughness for each finish; `stock` keeps the model's own surface. */
export const FINISH_ROUGHNESS: Record<Exclude<DartFinish, 'stock'>, number> = { polished: 0.12, satin: 0.34, matte: 0.68 }

export type BoardKindSetting = 'steel' | 'spider'
const CPU_LEVELS: readonly CpuLevel[] = ['pub', 'league', 'county', 'pro']

export interface MeterSettings {
  /** Seconds for the height meter to swing empty → full → empty (the side meter sweeps at the same pace). */
  chargeSeconds: number
  /** Launch speed at the bottom and top of the height meter, as fractions of the ideal speed. */
  chargeLow: number
  chargeHigh: number
  /** Half-width of the Perfect window between the two white lines, as a fraction of the ideal speed. */
  perfectWindow: number
  /** Half-width of the solid green. */
  green: number
  /** Where the green has faded fully to yellow. */
  fade: number
  /** Half-width of the yellow; past it the meter is red. */
  band: number
  /** Miss distances in soft-tip holes (3.4 mm): the floor at the edge of the green, the reach at the green's edge and at the band's edge. */
  greenEdgeHoles: number
  greenHoles: number
  yellowHoles: number
  /** The side meter's half-width, as a fraction of the ideal speed. */
  sideRange: number
  /** Extra miss per 5 % into the red on the side meter, in holes. */
  sideRedHoles: number
  /** How strongly speed past the band drops (soft) or lifts (hard) the dart (1 as built). */
  redScale: number
  classic: ClassicMeterMode
}

export interface SetupDefaults {
  /** The board a visitor sees until they pick one (their pick is kept per device). */
  board: BoardKindSetting
  cpuLevel: CpuLevel
  doubleOutSteel: boolean
  doubleOutSoft: boolean
  doubleBull: boolean
}

export interface SteelColors {
  black: string
  cream: string
  red: string
  green: string
  wire: string
  number: string
  numberEdge: string
}

export interface SpiderColors {
  black: string
  red: string
  catch: string
  spider: string
  number: string
  trim: string
  housing: string
  housingTrim: string
}

export interface DartLook {
  /** Flight colour per player (or team), in seat order. */
  flightColors: string[]
  /** Steel-tip dart: a tint over the barrel and shaft texture (white keeps it as modelled) and the metal finish. */
  steelTint: string
  steelFinish: DartFinish
  /** Soft-tip dart parts. */
  softBarrel: string
  softShaft: string
  softTip: string
  softFlight: string
  softFinish: DartFinish
  /** Soft-tip flights take each player's colour instead of staying one colour. */
  softPlayerFlights: boolean
}

export interface DartsSettings {
  meter: MeterSettings
  defaults: SetupDefaults
  steel: SteelColors
  spider: SpiderColors
  darts: DartLook
}

/** The meter as built, captured before anything retunes it. */
const BASE_METER: MeterTuning = { ...METER, levelScale: { ...METER.levelScale } }

export const DEFAULT_SETTINGS: DartsSettings = {
  meter: {
    chargeSeconds: 1.76,
    chargeLow: 0.7,
    chargeHigh: 1.2,
    perfectWindow: BASE_METER.exact * BASE_METER.perfect,
    green: BASE_METER.perfect,
    fade: BASE_METER.fade,
    band: BASE_METER.band,
    greenEdgeHoles: BASE_METER.greenEdgeHoles,
    greenHoles: BASE_METER.greenHoles,
    yellowHoles: BASE_METER.yellowHoles,
    sideRange: BASE_METER.sideRange,
    sideRedHoles: BASE_METER.sideRedHoles,
    redScale: BASE_METER.redScale,
    classic: 'off',
  },
  defaults: { board: 'spider', cpuLevel: 'league', doubleOutSteel: true, doubleOutSoft: false, doubleBull: true },
  steel: { black: '#141312', cream: '#f1e4c2', red: '#d01f30', green: '#0f8a4f', wire: '#e6e9ee', number: '#ffffff', numberEdge: '#050505' },
  spider: { black: '#141416', red: '#d0162a', catch: '#0c0c0e', spider: '#eef0f2', number: '#ffffff', trim: '#e3192f', housing: '#121214', housingTrim: '#d0162a' },
  darts: {
    flightColors: ['#ff4d5e', '#39d0ff', '#ffcf4a', '#7cdc6a'],
    steelTint: '#ffffff',
    steelFinish: 'stock',
    softBarrel: '#c5c7cb',
    softShaft: '#272729',
    softTip: '#1d1d1d',
    softFlight: '#f6f6f3',
    softFinish: 'stock',
    softPlayerFlights: false,
  },
}

type NumberKey = Exclude<keyof MeterSettings, 'classic'>

export interface MeterField {
  key: NumberKey
  label: string
  help: string
  min: number
  max: number
  /** `percent`: shown ×100 as a percentage of the ideal speed; `holes`: soft-tip holes; `seconds`; `times` (a multiplier). */
  unit: 'percent' | 'holes' | 'seconds' | 'times'
  group: 'timing' | 'zones' | 'misses'
}

/** Every number the admin can set, with its range; the sanitizer and the console both read this list. */
export const METER_FIELDS: readonly MeterField[] = [
  { key: 'chargeSeconds', group: 'timing', unit: 'seconds', min: 0.6, max: 4, label: 'Swing time', help: 'Seconds for the height meter to run empty → full → empty. The side meter sweeps at the same pace. Lower is faster.' },
  { key: 'chargeLow', group: 'timing', unit: 'percent', min: 0.4, max: 0.9, label: 'Bottom of the meter', help: 'Launch speed at the very bottom of the height meter, as a share of the ideal speed.' },
  { key: 'chargeHigh', group: 'timing', unit: 'percent', min: 1.1, max: 1.8, label: 'Top of the meter', help: 'Launch speed at the very top of the height meter, as a share of the ideal speed.' },
  { key: 'perfectWindow', group: 'zones', unit: 'percent', min: 0.0005, max: 0.05, label: 'Perfect window (white lines)', help: 'Half-width of the Perfect window. A stop between the white lines lands exactly on the aim point.' },
  { key: 'green', group: 'zones', unit: 'percent', min: 0.001, max: 0.08, label: 'Solid green', help: 'Half-width of the solid green. Always at least the Perfect window.' },
  { key: 'fade', group: 'zones', unit: 'percent', min: 0.002, max: 0.12, label: 'Green fades to yellow at', help: 'Where the green has faded fully to yellow. Always past the solid green.' },
  { key: 'band', group: 'zones', unit: 'percent', min: 0.005, max: 0.2, label: 'Yellow ends (red starts) at', help: 'Half-width of the yellow. Past it the meter is red and the dart also drops (too soft) or rides high (too hard).' },
  { key: 'sideRange', group: 'zones', unit: 'percent', min: 0.03, max: 0.3, label: 'Side meter reach', help: 'How far the side meter runs either way. Always past the yellow.' },
  { key: 'greenEdgeHoles', group: 'misses', unit: 'holes', min: 0, max: 20, label: 'Least miss at the green edge', help: 'Outside the white lines every dart misses by at least this much, growing to it at the edge of the green.' },
  { key: 'greenHoles', group: 'misses', unit: 'holes', min: 0, max: 40, label: 'Furthest miss in the green', help: 'Classic meter: the furthest a dart can stray at the edge of the green.' },
  { key: 'yellowHoles', group: 'misses', unit: 'holes', min: 0, max: 60, label: 'Furthest miss in the yellow', help: 'The miss at the edge of the yellow (the cross meter uses the typical miss there, a bit under this).' },
  { key: 'sideRedHoles', group: 'misses', unit: 'holes', min: 0, max: 60, label: 'Side red miss per 5 %', help: 'Cross meter: extra left or right miss for every 5 % the side meter stops into the red.' },
  { key: 'redScale', group: 'misses', unit: 'times', min: 0, max: 3, label: 'Red drop or lift', help: 'How strongly a stop in the red drops (too soft) or lifts (too hard) the dart. 1 is as built, 0 turns it off.' },
]

export const STEEL_COLOR_FIELDS: readonly { key: keyof SteelColors; label: string }[] = [
  { key: 'black', label: 'Dark singles' },
  { key: 'cream', label: 'Light singles' },
  { key: 'red', label: 'Red doubles, trebles and bull' },
  { key: 'green', label: 'Green doubles, trebles and outer bull' },
  { key: 'wire', label: 'Wire spider' },
  { key: 'number', label: 'Numbers' },
  { key: 'numberEdge', label: 'Number outline' },
]

export const SPIDER_COLOR_FIELDS: readonly { key: keyof SpiderColors; label: string }[] = [
  { key: 'black', label: 'Dark segments and bull' },
  { key: 'red', label: 'Red segments and outer bull' },
  { key: 'catch', label: 'Catch ring' },
  { key: 'spider', label: 'Plastic spider' },
  { key: 'number', label: 'Numbers' },
  { key: 'trim', label: 'Face trim rings' },
  { key: 'housing', label: 'Housing' },
  { key: 'housingTrim', label: 'Housing trim and buttons' },
]

export const DART_COLOR_FIELDS: readonly { key: 'steelTint' | 'softBarrel' | 'softShaft' | 'softTip' | 'softFlight'; label: string }[] = [
  { key: 'steelTint', label: 'Steel-tip barrel and shaft tint (white keeps the model)' },
  { key: 'softBarrel', label: 'Soft-tip barrel' },
  { key: 'softShaft', label: 'Soft-tip shaft' },
  { key: 'softTip', label: 'Soft-tip point' },
  { key: 'softFlight', label: 'Soft-tip flights' },
]

export const FLIGHT_SLOTS = 4
const HEX = /^#[0-9a-f]{6}$/

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function color(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const lower = value.trim().toLowerCase()
  return HEX.test(lower) ? lower : fallback
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function colors<T extends object>(input: unknown, defaults: T): T {
  const source = record(input)
  const out = { ...defaults } as Record<string, string>
  for (const key of Object.keys(defaults)) out[key] = color(source[key], (defaults as Record<string, string>)[key])
  return out as T
}

/** Turns anything (a stored row, a request body, nothing) into complete, valid settings: unknown or broken fields take the default, numbers are clamped to their ranges, and the meter zones are kept in order (Perfect ≤ green < fade < yellow < side reach, bottom < 1 − yellow, top > 1 + yellow). */
export function sanitizeSettings(input: unknown): DartsSettings {
  const source = record(input)
  const meterIn = record(source.meter)
  const base = DEFAULT_SETTINGS.meter
  const meter = { ...base }
  for (const field of METER_FIELDS) meter[field.key] = number(meterIn[field.key], base[field.key], field.min, field.max)
  meter.classic = pick(meterIn.classic, CLASSIC_METER_MODES, base.classic)
  if (meter.green < meter.perfectWindow) meter.green = meter.perfectWindow
  if (meter.fade <= meter.green) meter.fade = Math.min(0.2, meter.green * 1.25)
  if (meter.band <= meter.fade) meter.band = meter.fade + 0.005
  if (meter.sideRange <= meter.band) meter.sideRange = meter.band + 0.02
  if (meter.chargeLow >= 1 - meter.band) meter.chargeLow = Math.max(0.3, 1 - meter.band - 0.02)
  if (meter.chargeHigh <= 1 + meter.band) meter.chargeHigh = 1 + meter.band + 0.02
  const defaultsIn = record(source.defaults)
  const setup = DEFAULT_SETTINGS.defaults
  const defaults: SetupDefaults = {
    board: pick(defaultsIn.board, ['steel', 'spider'] as const, setup.board),
    cpuLevel: pick(defaultsIn.cpuLevel, CPU_LEVELS, setup.cpuLevel),
    doubleOutSteel: bool(defaultsIn.doubleOutSteel, setup.doubleOutSteel),
    doubleOutSoft: bool(defaultsIn.doubleOutSoft, setup.doubleOutSoft),
    doubleBull: bool(defaultsIn.doubleBull, setup.doubleBull),
  }
  const dartsIn = record(source.darts)
  const look = DEFAULT_SETTINGS.darts
  const flightsIn = Array.isArray(dartsIn.flightColors) ? dartsIn.flightColors : []
  const darts: DartLook = {
    flightColors: Array.from({ length: FLIGHT_SLOTS }, (_, i) => color(flightsIn[i], look.flightColors[i])),
    steelTint: color(dartsIn.steelTint, look.steelTint),
    steelFinish: pick(dartsIn.steelFinish, DART_FINISHES, look.steelFinish),
    softBarrel: color(dartsIn.softBarrel, look.softBarrel),
    softShaft: color(dartsIn.softShaft, look.softShaft),
    softTip: color(dartsIn.softTip, look.softTip),
    softFlight: color(dartsIn.softFlight, look.softFlight),
    softFinish: pick(dartsIn.softFinish, DART_FINISHES, look.softFinish),
    softPlayerFlights: bool(dartsIn.softPlayerFlights, look.softPlayerFlights),
  }
  return { meter, defaults, steel: colors(source.steel, DEFAULT_SETTINGS.steel), spider: colors(source.spider, DEFAULT_SETTINGS.spider), darts }
}

/** The settings that differ from the defaults, as paths like `meter.band`, for the console's "changed" counts. */
export function changedSettings(settings: DartsSettings): string[] {
  const out: string[] = []
  const walk = (value: unknown, fallback: unknown, path: string) => {
    if (value && typeof value === 'object') {
      for (const key of Object.keys(fallback as object)) walk((value as Record<string, unknown>)[key], (fallback as Record<string, unknown>)[key], path ? `${path}.${key}` : key)
      return
    }
    if (value !== fallback) out.push(path)
  }
  walk(settings, DEFAULT_SETTINGS, '')
  return out
}

export function sameSettings(a: DartsSettings, b: DartsSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Retunes the shared `METER` to these settings (back to the built meter first, then only what differs, so the defaults leave every number bit for bit as built). Synchronous: the Durable Object calls it right before each launch. */
export function applyMeterSettings(meter: MeterSettings): void {
  Object.assign(METER, BASE_METER, { levelScale: { ...BASE_METER.levelScale } })
  const base = DEFAULT_SETTINGS.meter
  if (meter.green !== base.green) METER.perfect = meter.green
  if (meter.green !== base.green || meter.perfectWindow !== base.perfectWindow) METER.exact = Math.min(1, meter.perfectWindow / meter.green)
  METER.fade = meter.fade
  METER.band = meter.band
  METER.greenEdgeHoles = meter.greenEdgeHoles
  METER.greenHoles = meter.greenHoles
  METER.yellowHoles = meter.yellowHoles
  METER.sideRange = meter.sideRange
  METER.sideRedHoles = meter.sideRedHoles
  METER.redScale = meter.redScale
}

/** Whether the page offers a meter choice under this mode, and the meter used when nobody has picked one (or no choice is offered). */
export function meterChoice(mode: ClassicMeterMode): { offered: boolean; fallback: 'classic' | 'cross' } {
  if (mode === 'off') return { offered: false, fallback: 'cross' }
  if (mode === 'only') return { offered: false, fallback: 'classic' }
  return { offered: true, fallback: mode === 'default' ? 'classic' : 'cross' }
}
