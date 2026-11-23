/**
 * The named flight conditions offered on the start screen and used by checkrides: wind presets and start times of day. Shared
 * so the Worker can check that a submitted record was flown in the conditions its header names.
 */
import type { TimeKind, WindKind } from './Career'
import { CALM } from '../sim/Wind'
import type { WindSpec } from '../sim/Wind'

export const WINDS: Record<WindKind, WindSpec> = {
  calm: CALM,
  light: { direction: 90, speed: 3.1, gust: 0, turbulence: 0.12 },
  crosswind: { direction: 180, speed: 6.2, gust: 1.2, turbulence: 0.25 },
  gusty: { direction: 240, speed: 7.2, gust: 5.1, turbulence: 0.5 },
}

export const HOURS: Record<TimeKind, number> = { morning: 8.2, noon: 12.5, evening: 18.9, night: 22.5 }

/** The preset a wind spec came from, or null when it matches none exactly. */
export function windKindOf(wind: WindSpec): WindKind | null {
  for (const kind of Object.keys(WINDS) as WindKind[]) {
    const w = WINDS[kind]
    if (w.direction === wind.direction && w.speed === wind.speed && w.gust === wind.gust && w.turbulence === wind.turbulence) return kind
  }
  return null
}
