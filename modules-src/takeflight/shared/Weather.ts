/**
 * Weather for a flight: cloud cover, cloud base and depth (metres above the departure field), visibility, rain, and how much it
 * stirs the wind (gust and turbulence scale, and for changing weather a slow veer and strengthening). Presets are fixed; changing
 * weather drifts through fair, overcast, rain and back over a 36-minute cycle whose phase comes from the flight's seed. Pure and
 * exact (`SimMath` only), because the wind changes it makes are part of the simulation the Worker re-flies.
 */
import { clamp, cos, lerp, TWO_PI } from '../sim/SimMath'
import type { WindSpec } from '../sim/Wind'

export type WeatherKind = 'clear' | 'fair' | 'overcast' | 'rain' | 'storm' | 'fog' | 'changing'

export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'fair', 'overcast', 'rain', 'storm', 'fog', 'changing']

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: 'Clear',
  fair: 'Fair, scattered cloud',
  overcast: 'Overcast',
  rain: 'Rain, low cloud',
  storm: 'Storm',
  fog: 'Fog',
  changing: 'Changing',
}

export interface WeatherState {
  /** Cloud cover 0..1. */
  cover: number
  /** Cloud base and layer depth, metres above the departure field. */
  base: number
  depth: number
  /** Visibility in metres. */
  visibility: number
  /** Rain 0..1. */
  rain: number
  /** Multiplier on gusts and extra turbulence intensity (0..1 scale). */
  gust: number
  turbulence: number
  /** Wind veer in degrees and speed multiplier (changing weather). */
  veer: number
  windScale: number
}

const PRESETS: Record<Exclude<WeatherKind, 'changing'>, WeatherState> = {
  clear: { cover: 0.04, base: 1600, depth: 250, visibility: 60000, rain: 0, gust: 1, turbulence: 0, veer: 0, windScale: 1 },
  fair: { cover: 0.38, base: 1050, depth: 650, visibility: 40000, rain: 0, gust: 1, turbulence: 0.05, veer: 0, windScale: 1 },
  overcast: { cover: 0.92, base: 650, depth: 900, visibility: 18000, rain: 0, gust: 1.15, turbulence: 0.08, veer: 0, windScale: 1 },
  rain: { cover: 0.97, base: 380, depth: 1400, visibility: 5000, rain: 0.65, gust: 1.4, turbulence: 0.18, veer: 0, windScale: 1.1 },
  storm: { cover: 1, base: 300, depth: 2600, visibility: 2800, rain: 1, gust: 2.1, turbulence: 0.45, veer: 0, windScale: 1.3 },
  fog: { cover: 0.85, base: 1, depth: 230, visibility: 900, rain: 0, gust: 0.6, turbulence: 0, veer: 0, windScale: 0.7 },
}

const CYCLE = 36 * 60
const CYCLE_STEPS: Exclude<WeatherKind, 'changing'>[] = ['fair', 'overcast', 'rain', 'overcast']

export function createWeatherState(): WeatherState {
  return { ...PRESETS.clear }
}

function blend(a: WeatherState, b: WeatherState, t: number, out: WeatherState): WeatherState {
  out.cover = lerp(a.cover, b.cover, t)
  out.base = lerp(a.base, b.base, t)
  out.depth = lerp(a.depth, b.depth, t)
  out.visibility = lerp(a.visibility, b.visibility, t)
  out.rain = lerp(a.rain, b.rain, t)
  out.gust = lerp(a.gust, b.gust, t)
  out.turbulence = lerp(a.turbulence, b.turbulence, t)
  out.veer = lerp(a.veer, b.veer, t)
  out.windScale = lerp(a.windScale, b.windScale, t)
  return out
}

/** The weather `seconds` into a flight. */
export function weatherAt(kind: WeatherKind, seed: number, seconds: number, out: WeatherState): WeatherState {
  if (kind !== 'changing') return blend(PRESETS[kind], PRESETS[kind], 0, out)
  const phase = ((seed >>> 0) % 1000) / 1000
  const position = ((seconds / CYCLE + phase) % 1) * CYCLE_STEPS.length
  const index = Math.floor(position)
  const t = position - index
  const smooth = t * t * (3 - 2 * t)
  blend(PRESETS[CYCLE_STEPS[index]], PRESETS[CYCLE_STEPS[(index + 1) % CYCLE_STEPS.length]], smooth, out)
  const swing = cos((seconds / CYCLE + phase) * TWO_PI)
  out.veer = 25 * (1 - swing)
  out.windScale = 1 + 0.35 * (1 - swing) * 0.5
  return out
}

/** Writes the wind for `state` over the flight's chosen base wind into `out` (the spec the wind field uses). */
export function weatherWind(base: WindSpec, state: WeatherState, out: WindSpec): WindSpec {
  let direction = (base.direction + state.veer) % 360
  if (direction < 0) direction += 360
  out.direction = direction
  out.speed = base.speed * state.windScale
  out.gust = base.gust * state.gust + (state.gust > 1 ? (state.gust - 1) * 1.5 : 0)
  out.turbulence = clamp(base.turbulence + state.turbulence, 0, 1)
  return out
}

/** Extra XP for flying in harder weather. */
export const WEATHER_XP: Record<WeatherKind, number> = { clear: 1, fair: 1, overcast: 1.05, rain: 1.2, storm: 1.4, fog: 1.3, changing: 1.15 }
