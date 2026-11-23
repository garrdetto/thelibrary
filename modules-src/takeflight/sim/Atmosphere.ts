/**
 * International Standard Atmosphere up to 20 km with a sea-level temperature offset (hot days raise density altitude) and an
 * altimeter setting. Everything returns into a reused `AirSample`, so the 120 Hz loop allocates nothing.
 */
import { exp, pow } from './SimMath'

export const SEA_LEVEL_DENSITY = 1.225
export const SEA_LEVEL_PRESSURE = 101325
export const SEA_LEVEL_TEMPERATURE = 288.15
export const GRAVITY = 9.80665
const LAPSE_RATE = 0.0065
const GAS_CONSTANT = 287.05287
const TROPOPAUSE = 11000
const BAROMETRIC_EXPONENT = GRAVITY / (LAPSE_RATE * GAS_CONSTANT)

export interface AirSample {
  /** Kelvin. */
  temperature: number
  /** Pascal. */
  pressure: number
  /** kg/m³. */
  density: number
  /** density / sea-level standard density. */
  sigma: number
  /** m/s. */
  speedOfSound: number
}

export function createAirSample(): AirSample {
  return { temperature: SEA_LEVEL_TEMPERATURE, pressure: SEA_LEVEL_PRESSURE, density: SEA_LEVEL_DENSITY, sigma: 1, speedOfSound: 340.29 }
}

/**
 * Fills `out` for geometric altitude `altitude` (m) on a day `temperatureOffset` kelvin warmer than standard, with sea-level
 * pressure `seaLevelPressure` (Pa).
 */
export function sampleAir(altitude: number, temperatureOffset: number, seaLevelPressure: number, out: AirSample): AirSample {
  const h = altitude < -500 ? -500 : altitude > 20000 ? 20000 : altitude
  let standardTemperature: number
  let pressureRatio: number
  if (h <= TROPOPAUSE) {
    standardTemperature = SEA_LEVEL_TEMPERATURE - LAPSE_RATE * h
    pressureRatio = pow(standardTemperature / SEA_LEVEL_TEMPERATURE, BAROMETRIC_EXPONENT)
  } else {
    standardTemperature = SEA_LEVEL_TEMPERATURE - LAPSE_RATE * TROPOPAUSE
    const tropopauseRatio = pow(standardTemperature / SEA_LEVEL_TEMPERATURE, BAROMETRIC_EXPONENT)
    pressureRatio = tropopauseRatio * exp((-GRAVITY * (h - TROPOPAUSE)) / (GAS_CONSTANT * standardTemperature))
  }
  const temperature = standardTemperature + temperatureOffset
  const pressure = seaLevelPressure * pressureRatio
  const density = pressure / (GAS_CONSTANT * temperature)
  out.temperature = temperature
  out.pressure = pressure
  out.density = density
  out.sigma = density / SEA_LEVEL_DENSITY
  out.speedOfSound = Math.sqrt(1.4 * GAS_CONSTANT * temperature)
  return out
}

/** Pressure altitude (m) an altimeter set to `altimeterSetting` (Pa) reads for static pressure `pressure`. */
export function indicatedAltitude(pressure: number, altimeterSetting: number): number {
  const ratio = pressure / altimeterSetting
  return (SEA_LEVEL_TEMPERATURE / LAPSE_RATE) * (1 - pow(ratio, 1 / BAROMETRIC_EXPONENT))
}

/** Indicated (calibrated, compressibility ignored below Mach 0.4 and corrected above) airspeed from true airspeed. */
export function indicatedAirspeed(trueAirspeed: number, density: number, pressure: number, speedOfSound: number): number {
  const mach = trueAirspeed / speedOfSound
  if (mach < 0.3) return trueAirspeed * Math.sqrt(density / SEA_LEVEL_DENSITY)
  const impact = pressure * (pow(1 + 0.2 * mach * mach, 3.5) - 1)
  return 340.29 * Math.sqrt(5 * (pow(impact / SEA_LEVEL_PRESSURE + 1, 2 / 7) - 1))
}

export const KNOT = 0.514444
export const FOOT = 0.3048
export const FPM = FOOT / 60
