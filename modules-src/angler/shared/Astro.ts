/** Sun and moon positions and the moon's phase for central Wisconsin (44.5° N, 89.5° W), from the real clock. */

const LAT = 44.5 * (Math.PI / 180)
const LON = -89.5
const rad = Math.PI / 180

export interface SkyBody {
  /** Altitude above the horizon in degrees. */
  altitude: number
  /** Azimuth in degrees, 0 = north, 90 = east. */
  azimuth: number
}

function daysSinceJ2000(date: Date): number {
  return date.getTime() / 86400000 - 10957.5
}

function horizontal(ra: number, dec: number, d: number): SkyBody {
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24
  const lst = gmst + LON / 15
  const ha = (lst * 15 * rad) - ra
  const alt = Math.asin(Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(ha))
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(LAT) - Math.sin(LAT) * Math.cos(ha))
  return { altitude: alt / rad, azimuth: ((az / rad) + 360) % 360 }
}

export function sunPosition(date: Date): SkyBody {
  const d = daysSinceJ2000(date)
  const L = (280.46 + 0.9856474 * d) * rad
  const g = (357.528 + 0.9856003 * d) * rad
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const eps = (23.439 - 0.0000004 * d) * rad
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  return horizontal(ra, dec, d)
}

export function moonPosition(date: Date): SkyBody {
  const d = daysSinceJ2000(date)
  const L = (218.316 + 13.176396 * d) * rad
  const M = (134.963 + 13.064993 * d) * rad
  const F = (93.272 + 13.22935 * d) * rad
  const lambda = L + 6.289 * rad * Math.sin(M)
  const beta = 5.128 * rad * Math.sin(F)
  const eps = 23.4397 * rad
  const ra = Math.atan2(Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lambda))
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda))
  return horizontal(ra, dec, d)
}

/** 0 = new moon, 0.5 = full moon. */
export function moonPhase(date: Date): number {
  const synodic = 29.530588853
  const knownNew = Date.UTC(2000, 0, 6, 18, 14) / 86400000
  const days = date.getTime() / 86400000 - knownNew
  return ((days % synodic) + synodic) % synodic / synodic
}

export function moonIllumination(phase: number): number {
  return (1 - Math.cos(phase * 2 * Math.PI)) / 2
}

export function moonPhaseName(phase: number): string {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent']
  return names[Math.round(phase * 8) % 8]
}

/** Unit direction toward a sky body in world space: +Y up, -Z north, +X east. */
export function bodyDirection(body: SkyBody): [number, number, number] {
  const alt = body.altitude * rad, az = body.azimuth * rad
  return [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)]
}

/** Central time for display, whatever the viewer's own time zone. */
export function centralTime(date: Date): { hour: number; minute: number; month: number; day: number; weekday: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' }).formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '0'
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return { hour: Number(get('hour')) % 24, minute: Number(get('minute')), month: Number(get('month')) - 1, day: Number(get('day')), weekday: weekdays.indexOf(get('weekday')), year: Number(get('year')) }
}
