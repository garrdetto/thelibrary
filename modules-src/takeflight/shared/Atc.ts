/**
 * ATIS and the words of basic ATC: the runway in use from the wind (the landing end with the most headwind, Crag Notch always
 * 06), the ATIS broadcast (information letter, wind, visibility, cloud, temperature, altimeter, runway) and the phrases a
 * controller uses for each phase of a flight. Pure: the page drives the phases (`game/Radio.ts`) and only displays the text.
 */
import { AIRPORTS, landingEnds } from './Airports'
import type { AirportSpec, RunwaySpec } from './Airports'
import type { WeatherState } from './Weather'
import { DEG, cos } from '../sim/SimMath'

export const PHONETIC = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu']

const KT = 1.943844
const FT = 3.28084

export interface RunwayInUse {
  runway: RunwaySpec
  end: 0 | 1
  name: string
  /** Landing direction, degrees true. */
  heading: number
  headwind: number
  crosswind: number
}

/** The landing end with the most headwind (ties to the first runway's low end), from the wind direction (from, degrees) and speed. */
export function runwayInUse(airport: AirportSpec, windFrom: number, windSpeed: number): RunwayInUse {
  let best: RunwayInUse | null = null
  for (const runway of airport.runways) {
    for (const end of landingEnds(airport, runway)) {
      const heading = end === 0 ? runway.heading : (runway.heading + 180) % 360
      const angle = (windFrom - heading) * DEG
      const headwind = windSpeed * cos(angle)
      const crosswind = windSpeed * Math.abs(cos(angle - Math.PI / 2))
      if (!best || headwind > best.headwind + 1e-6) best = { runway, end, name: runway.ends[end], heading, headwind, crosswind }
    }
  }
  return best as RunwayInUse
}

/** ATIS letters change every hour of the day, offset per airport so neighbours differ. */
export function atisLetter(airport: AirportSpec, hourOfDay: number): string {
  const index = AIRPORTS.indexOf(airport)
  return PHONETIC[(Math.max(0, index) * 5 + Math.floor(hourOfDay)) % PHONETIC.length]
}

export interface AtisConditions {
  hourOfDay: number
  windFrom: number
  /** Steady wind, m/s, and gust amplitude, m/s. */
  windSpeed: number
  gust: number
  weather: WeatherState
  /** Field temperature, °C, and sea-level pressure, Pa. */
  temperature: number
  pressure: number
}

function three(value: number): string {
  const v = ((Math.round(value / 10) * 10) % 360 + 360) % 360
  return String(v === 0 ? 360 : v).padStart(3, '0')
}

function hundreds(feet: number): number {
  return Math.max(100, Math.round(feet / 100) * 100)
}

export function windPhrase(windFrom: number, windSpeed: number, gust: number): string {
  const kt = Math.round(windSpeed * KT)
  if (kt < 3) return 'wind calm'
  const gustKt = Math.round((windSpeed + gust) * KT)
  return `wind ${three(windFrom)} at ${kt}${gustKt >= kt + 5 ? ` gusting ${gustKt}` : ''}`
}

export function cloudPhrase(weather: WeatherState): string {
  const base = hundreds(weather.base * FT)
  if (weather.base < 60) return 'fog'
  const cover = weather.cover
  const kind = cover < 0.1 ? null : cover < 0.3 ? 'few' : cover < 0.55 ? 'scattered' : cover < 0.9 ? 'broken' : 'overcast'
  return kind ? `${kind} ${base.toLocaleString('en-US')}` : 'sky clear'
}

export function visibilityPhrase(metres: number): string {
  return metres >= 10000 ? 'visibility 10 kilometres or more' : metres >= 1000 ? `visibility ${Math.floor(metres / 1000)} kilometres` : `visibility ${Math.round(metres / 100) * 100} metres`
}

export function altimeterPhrase(pressure: number): string {
  return `altimeter ${(pressure / 3386.389).toFixed(2)}`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The full ATIS broadcast. */
export function atisText(airport: AirportSpec, c: AtisConditions): { letter: string; runway: RunwayInUse; text: string } {
  const letter = atisLetter(airport, c.hourOfDay)
  const runway = runwayInUse(airport, c.windFrom, c.windSpeed)
  const hh = String(Math.floor(c.hourOfDay) % 24).padStart(2, '0')
  const mm = String(Math.floor((c.hourOfDay % 1) * 60 / 10) * 10).padStart(2, '0')
  const approach = runway.runway.ils[runway.end] ? `ILS approach runway ${runway.name}` : `visual approach runway ${runway.name}`
  const rain = c.weather.rain > 0.8 ? ', heavy rain' : c.weather.rain > 0.2 ? ', rain' : ''
  const text = `${airport.name} information ${letter}, time ${hh}${mm}. ${capitalize(windPhrase(c.windFrom, c.windSpeed, c.gust))}, ${visibilityPhrase(c.weather.visibility)}${rain}, ${cloudPhrase(c.weather)}, temperature ${Math.round(c.temperature)}, ${altimeterPhrase(c.pressure)}. Expect ${approach}. Landing and departing runway ${runway.name}. Advise on initial contact you have information ${letter}.`
  return { letter, runway, text }
}

export type AtcEvent = 'taxi' | 'lineup' | 'takeoff' | 'departure' | 'inbound' | 'final' | 'landing' | 'vacate' | 'goaround'

/** What the controller says for an event. */
export function atcPhrase(event: AtcEvent, call: string, airport: AirportSpec, runway: RunwayInUse, extra: { wind?: string; letter?: string; taxiway?: string; stand?: string } = {}): string {
  const wind = extra.wind ? `, ${extra.wind}` : ''
  switch (event) {
    case 'taxi': return `${call}, ${airport.name} ground, information ${extra.letter ?? 'current'}, runway ${runway.name}, taxi via ${extra.taxiway ?? 'A'}, hold short runway ${runway.name}.`
    case 'lineup': return `${call}, ${airport.name} tower, line up and wait runway ${runway.name}.`
    case 'takeoff': return `${call}${wind}, runway ${runway.name}, cleared for take-off.`
    case 'departure': return `${call}, contact departure, good day.`
    case 'inbound': return `${call}, ${airport.name} approach, information ${extra.letter ?? 'current'}, expect ${runway.runway.ils[runway.end] ? 'the ILS' : 'a visual approach'} runway ${runway.name}, report on final.`
    case 'final': return `${call}, ${airport.name} tower${wind}, runway ${runway.name}, cleared to land.`
    case 'landing': return `${call}, welcome to ${airport.name}, vacate when able.`
    case 'vacate': return `${call}, taxi to ${extra.stand ?? 'the apron'} via ${extra.taxiway ?? 'A'}.`
    case 'goaround': return `${call}, go around, climb runway heading to 2,000 feet.`
  }
}
