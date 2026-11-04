/** Synthetic but believable hourly weather per lake, seeded by the clock so every angler on a lake sees the same sky. */
import { centralTime } from './Astro'
import { clamp, fbm, smoothstep } from './Random'
import type { LakeDef } from './Lakes'

export interface Weather {
  /** 0 clear to 1 overcast. */
  cloud: number
  rain: number
  fog: number
  windMph: number
  /** Direction the wind blows toward, radians (0 = toward north, -Z). */
  windDir: number
  airTempF: number
  /** Barometer in inches of mercury and its 3-hour change. */
  pressure: number
  pressureTrend: number
  label: string
}

const normalHigh = [24, 29, 41, 56, 68, 77, 81, 79, 71, 58, 42, 28]
const normalLow = [6, 10, 21, 33, 44, 54, 58, 56, 47, 36, 25, 12]

function sample(lake: LakeDef, hours: number) {
  const seed = lake.seed * 7 + 3
  const front = fbm(hours / 30, 0.5, seed, 3)
  const cloud = clamp((fbm(hours / 9, 3.1, seed + 1, 3) - 0.38) * 1.9 + (front - 0.5) * 0.8, 0, 1)
  const rainDrive = fbm(hours / 5, 7.7, seed + 2, 2)
  const rain = cloud > 0.7 ? clamp((rainDrive - 0.55) * 4, 0, 1) * smoothstep(0.7, 0.95, cloud) : 0
  const windMph = 2 + fbm(hours / 7, 9.2, seed + 4, 3) * 16 + cloud * 4
  const windDir = (fbm(hours / 40, 1.3, seed + 5, 2) * 4 - 1) * Math.PI
  const pressure = 30.0 + (0.5 - front) * 0.7
  return { cloud, rain, windMph, windDir, pressure }
}

export function weatherAt(lake: LakeDef, date: Date): Weather {
  const hours = date.getTime() / 3600000
  const now = sample(lake, hours)
  const before = sample(lake, hours - 3)
  const ct = centralTime(date)
  const dayT = Math.sin(((ct.hour + ct.minute / 60 - 9) / 24) * Math.PI * 2) * 0.5 + 0.5
  const airTempF = normalLow[ct.month] + (normalHigh[ct.month] - normalLow[ct.month]) * dayT - now.cloud * 4 + (fbm(hours / 50, 4.4, lake.seed, 2) - 0.5) * 14
  const fog = ct.hour >= 4 && ct.hour <= 8 && now.windMph < 6 ? clamp((8 - now.windMph) / 6, 0, 1) * 0.6 : now.rain * 0.4
  const pressureTrend = now.pressure - before.pressure
  let label = now.cloud < 0.2 ? 'Clear' : now.cloud < 0.5 ? 'Partly cloudy' : now.cloud < 0.8 ? 'Mostly cloudy' : 'Overcast'
  if (now.rain > 0.1) label = airTempF < 33 ? 'Snow showers' : now.rain > 0.6 ? 'Steady rain' : 'Light rain'
  if (fog > 0.35 && now.rain < 0.1) label = 'Morning fog'
  return { ...now, fog, airTempF: Math.round(airTempF), pressure: Math.round(now.pressure * 100) / 100, pressureTrend: Math.round(pressureTrend * 100) / 100, label }
}

export function windCompass(dir: number): string {
  const from = (dir + Math.PI) % (Math.PI * 2)
  const deg = ((from * 180) / Math.PI + 360) % 360
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]
}
