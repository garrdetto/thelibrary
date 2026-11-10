/** One autumn day at 46° N in early October, renderer-free: the clock, the sun and a full moon. +x is east, +z is north, +y is up. */

export const HOUR_SECONDS = 75
export const START_HOUR = 16
export const LATITUDE_DEG = 46
export const SUN_DECLINATION_DEG = -6
export const CLOCK_OFFSET_HOURS = 1.1
export const FULL_DARK_HOUR = 19.5
export const NIGHT_BEGINS_ELEVATION = 3
export const FULL_DARK_ELEVATION = -8.5

const RAD = Math.PI / 180

export interface Direction {
  x: number
  y: number
  z: number
}

export interface SkyState {
  hour: number
  sun: Direction
  moon: Direction
  sunElevation: number
  moonElevation: number
  /** 0 in daylight, 1 once it is fully dark. */
  night: number
  /** Strength of the sunset or sunrise glow near the horizon, 0..1. */
  glow: number
}

export function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24
}

export function solarHour(clockHour: number): number {
  return wrapHour(clockHour - CLOCK_OFFSET_HOURS)
}

/** Unit vector toward a body with the given declination at the given solar hour (12 = it crosses the meridian). */
export function bodyDirection(solar: number, declinationDeg: number, latitudeDeg = LATITUDE_DEG): Direction {
  const h = (solar - 12) * 15 * RAD
  const d = declinationDeg * RAD
  const p = latitudeDeg * RAD
  const east = -Math.cos(d) * Math.sin(h)
  const north = Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.cos(h) * Math.sin(p)
  const up = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(h) * Math.cos(p)
  return { x: east, y: up, z: north }
}

export function elevationDeg(dir: Direction): number {
  return Math.asin(Math.max(-1, Math.min(1, dir.y))) / RAD
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function nightLevel(sunElevation: number): number {
  return 1 - smooth(FULL_DARK_ELEVATION, NIGHT_BEGINS_ELEVATION, sunElevation)
}

export function skyAt(clockHour: number): SkyState {
  const hour = wrapHour(clockHour)
  const solar = solarHour(hour)
  const sun = bodyDirection(solar, SUN_DECLINATION_DEG)
  const moon = bodyDirection(wrapHour(solar + 12), -SUN_DECLINATION_DEG)
  const sunElevation = elevationDeg(sun)
  const moonElevation = elevationDeg(moon)
  const glow = smooth(-9, -1, sunElevation) * (1 - smooth(4, 16, sunElevation))
  return { hour, sun, moon, sunElevation, moonElevation, night: nightLevel(sunElevation), glow }
}

export function formatClock(hour: number): string {
  const h = wrapHour(hour)
  let hh = Math.floor(h)
  let mm = Math.floor((h - hh) * 60 + 1e-6)
  if (mm >= 60) {
    hh = (hh + 1) % 24
    mm = 0
  }
  const ampm = hh < 12 ? 'AM' : 'PM'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`
}

/** Reads `?hour=` (0–24, fractions allowed) for testing. */
export function hourFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('hour')
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 24 ? wrapHour(value) : null
}

/** Hours to wait from `hour` until it is fully dark (0 when it already is). */
export function hoursUntilDark(hour: number): number {
  const h = wrapHour(hour)
  if (nightLevel(skyAt(h).sunElevation) >= 0.98) return 0
  return wrapHour(FULL_DARK_HOUR + 0.1 - h)
}

export class Clock {
  hour: number
  day = 0

  constructor(start = START_HOUR) {
    this.hour = wrapHour(start)
  }

  advance(seconds: number): void {
    this.set(this.hour + seconds / HOUR_SECONDS)
  }

  set(hour: number): void {
    if (hour >= 24) this.day += Math.floor(hour / 24)
    this.hour = wrapHour(hour)
  }

  get sky(): SkyState {
    return skyAt(this.hour)
  }

  get label(): string {
    return formatClock(this.hour)
  }
}
