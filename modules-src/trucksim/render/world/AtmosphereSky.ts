/**
 * The county's sky as plain numbers: where the sun and moon stand at a clock hour (a late-August day at 42° north, solar noon at
 * 13:00 daylight time, north +Z and east −X in the right-handed world), the colour and strength of sunlight, skylight and fill,
 * the fog and horizon colour, an exposure tweak, how dark it is (`night`), and the sky's radiance in any direction. The sky dome's
 * vertex colours, the environment cube and the lights all read this, so the horizon, the fog and the reflections always agree.
 * Renderer-free and allocation-free once a `SkyState` exists.
 */

export type Rgb = [number, number, number]

const DEG = Math.PI / 180
const LATITUDE = 42 * DEG
const DECLINATION = 9 * DEG
const MOON_DECLINATION = -6 * DEG
const SOLAR_NOON = 13
/** Sunlight intensity with the sun high in a clear sky (Babylon light units, StandardMaterial and PBR alike). */
export const SUN_PEAK = 2.45
export const MOON_PEAK = 0.17
export const HEMI_DAY = 0.85
export const HEMI_NIGHT = 0.21

export interface SkyState {
  hours: number
  /** Unit vector toward the sun. */
  sun: Rgb
  /** Unit vector toward the moon. */
  moon: Rgb
  sunElevation: number
  moonElevation: number
  /** 0 by day, 1 at full dark; crosses 0.5 with the sun about a degree below the horizon. */
  night: number
  dayWeight: number
  twilightWeight: number
  nightWeight: number
  sunColor: Rgb
  sunIntensity: number
  moonColor: Rgb
  moonIntensity: number
  /** Unit vector toward whichever of sun and moon lights the ground now, and that light's colour and intensity. */
  keyDirection: Rgb
  keyColor: Rgb
  keyIntensity: number
  hemiSky: Rgb
  hemiGround: Rgb
  hemiIntensity: number
  zenith: Rgb
  horizon: Rgb
  /** Fog and clear colour: the horizon band all round, a little warmer at sunrise and sunset. */
  fog: Rgb
  /** Below-horizon colour of the environment cube (the lit ground seen in reflections). */
  ground: Rgb
  /** Warm low-sun band colour along the horizon toward the sun. */
  warm: Rgb
  /** 0 with the sun high, 1 when it is near the horizon (strength of the warm band). */
  lowSun: number
  /** Multiplier for the image-processing exposure (1 by day, brighter at dusk and night). */
  exposure: number
  /** Sun disc brightness (0 when it is below the horizon). */
  sunDisc: number
  /** Moon disc brightness (0 when it is below the horizon or the sky is light). */
  moonDisc: number
}

/** sRGB hex (0xRRGGBB) to linear-light RGB. */
export function linearFromHex(hex: number): Rgb {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return [channel((hex >> 16) & 255), channel((hex >> 8) & 255), channel(hex & 255)]
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function mix(out: Rgb, a: Rgb, b: Rgb, t: number): Rgb {
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
  return out
}

function blend3(out: Rgb, a: Rgb, wa: number, b: Rgb, wb: number, c: Rgb, wc: number): Rgb {
  out[0] = a[0] * wa + b[0] * wb + c[0] * wc
  out[1] = a[1] * wa + b[1] * wb + c[1] * wc
  out[2] = a[2] * wa + b[2] * wb + c[2] * wc
  return out
}

/** Writes the unit vector toward a body at hour angle `hourAngle` and declination `declination`; returns its elevation (radians). */
function bodyDirection(out: Rgb, hourAngle: number, declination: number): number {
  const sinElevation = Math.sin(LATITUDE) * Math.sin(declination) + Math.cos(LATITUDE) * Math.cos(declination) * Math.cos(hourAngle)
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)))
  const cosElevation = Math.cos(elevation)
  let cosAzimuth = cosElevation > 1e-6 ? (Math.sin(declination) - sinElevation * Math.sin(LATITUDE)) / (cosElevation * Math.cos(LATITUDE)) : 1
  cosAzimuth = Math.max(-1, Math.min(1, cosAzimuth))
  let azimuth = Math.acos(cosAzimuth)
  if (Math.sin(hourAngle) > 0) azimuth = Math.PI * 2 - azimuth
  out[0] = -Math.sin(azimuth) * cosElevation
  out[1] = sinElevation
  out[2] = Math.cos(azimuth) * cosElevation
  return elevation
}

const SUN_RAMP: [number, number, number, number][] = [
  [-4, 1.0, 0.32, 0.1],
  [0, 1.0, 0.42, 0.16],
  [3, 1.0, 0.55, 0.28],
  [8, 1.0, 0.7, 0.46],
  [15, 1.0, 0.82, 0.63],
  [25, 1.0, 0.91, 0.8],
  [40, 1.0, 0.96, 0.9],
  [90, 1.0, 0.97, 0.93],
]

function sunColorAt(out: Rgb, elevationDeg: number): Rgb {
  if (elevationDeg <= SUN_RAMP[0][0]) {
    out[0] = SUN_RAMP[0][1]
    out[1] = SUN_RAMP[0][2]
    out[2] = SUN_RAMP[0][3]
    return out
  }
  for (let index = 1; index < SUN_RAMP.length; index++) {
    const high = SUN_RAMP[index]
    if (elevationDeg > high[0]) continue
    const low = SUN_RAMP[index - 1]
    const t = (elevationDeg - low[0]) / (high[0] - low[0])
    out[0] = low[1] + (high[1] - low[1]) * t
    out[1] = low[2] + (high[2] - low[2]) * t
    out[2] = low[3] + (high[3] - low[3]) * t
    return out
  }
  const last = SUN_RAMP[SUN_RAMP.length - 1]
  out[0] = last[1]
  out[1] = last[2]
  out[2] = last[3]
  return out
}

const ZENITH_DAY: Rgb = [0.06, 0.18, 0.52]
const ZENITH_TWILIGHT: Rgb = [0.028, 0.045, 0.13]
const ZENITH_NIGHT: Rgb = [0.0022, 0.0032, 0.0085]
const HORIZON_DAY: Rgb = [0.54, 0.63, 0.73]
const HORIZON_TWILIGHT: Rgb = [0.26, 0.23, 0.29]
const HORIZON_NIGHT: Rgb = [0.009, 0.012, 0.021]
const HEMI_SKY_DAY: Rgb = [0.62, 0.73, 0.92]
const HEMI_SKY_TWILIGHT: Rgb = [0.6, 0.5, 0.58]
const HEMI_SKY_NIGHT: Rgb = [0.3, 0.38, 0.62]
const HEMI_GROUND_DAY: Rgb = [0.36, 0.34, 0.24]
const HEMI_GROUND_NIGHT: Rgb = [0.08, 0.09, 0.1]
const WARM: Rgb = [1.0, 0.42, 0.15]
const MOON_LIGHT: Rgb = [0.6, 0.7, 0.95]
const GROUND_ALBEDO: Rgb = [0.11, 0.13, 0.075]

export function createSkyState(): SkyState {
  return {
    hours: Number.NaN,
    sun: [0, 1, 0],
    moon: [0, -1, 0],
    sunElevation: 0,
    moonElevation: 0,
    night: 0,
    dayWeight: 1,
    twilightWeight: 0,
    nightWeight: 0,
    sunColor: [1, 1, 1],
    sunIntensity: 0,
    moonColor: [MOON_LIGHT[0], MOON_LIGHT[1], MOON_LIGHT[2]],
    moonIntensity: 0,
    keyDirection: [0, 1, 0],
    keyColor: [1, 1, 1],
    keyIntensity: 0,
    hemiSky: [1, 1, 1],
    hemiGround: [0, 0, 0],
    hemiIntensity: 0,
    zenith: [0, 0, 0],
    horizon: [0, 0, 0],
    fog: [0, 0, 0],
    ground: [0, 0, 0],
    warm: [WARM[0], WARM[1], WARM[2]],
    lowSun: 0,
    exposure: 1,
    sunDisc: 0,
    moonDisc: 0,
  }
}

/** Wraps any hour value into [0, 24). */
export function wrapHours(hours: number): number {
  const wrapped = hours % 24
  return wrapped < 0 ? wrapped + 24 : wrapped
}

/** Fills `state` for clock time `hours` (0–24, wrapped). */
export function computeSkyState(state: SkyState, hours: number): SkyState {
  const time = wrapHours(hours)
  state.hours = time
  const hourAngle = ((time - SOLAR_NOON) * 15) * DEG
  state.sunElevation = bodyDirection(state.sun, hourAngle, DECLINATION)
  state.moonElevation = bodyDirection(state.moon, hourAngle + Math.PI, MOON_DECLINATION)
  const elevation = state.sunElevation / DEG
  const moonElevation = state.moonElevation / DEG

  const day = smoothstep(-3, 10, elevation)
  const dark = 1 - smoothstep(-13, -2.5, elevation)
  const twilight = Math.max(0, 1 - day - dark)
  const total = day + dark + twilight
  state.dayWeight = day / total
  state.twilightWeight = twilight / total
  state.nightWeight = dark / total
  state.night = 1 - smoothstep(-6, 4, elevation)

  sunColorAt(state.sunColor, elevation)
  state.sunIntensity = SUN_PEAK * smoothstep(-1.5, 9, elevation) * (0.55 + 0.45 * smoothstep(6, 40, elevation))
  const moonUp = smoothstep(-1, 8, moonElevation)
  state.moonIntensity = MOON_PEAK * moonUp * state.nightWeight
  if (state.sunIntensity >= state.moonIntensity) {
    state.keyDirection[0] = state.sun[0]
    state.keyDirection[1] = state.sun[1]
    state.keyDirection[2] = state.sun[2]
    state.keyColor[0] = state.sunColor[0]
    state.keyColor[1] = state.sunColor[1]
    state.keyColor[2] = state.sunColor[2]
    state.keyIntensity = state.sunIntensity
  } else {
    state.keyDirection[0] = state.moon[0]
    state.keyDirection[1] = state.moon[1]
    state.keyDirection[2] = state.moon[2]
    state.keyColor[0] = state.moonColor[0]
    state.keyColor[1] = state.moonColor[1]
    state.keyColor[2] = state.moonColor[2]
    state.keyIntensity = state.moonIntensity
  }

  const dw = state.dayWeight
  const tw = state.twilightWeight
  const nw = state.nightWeight
  blend3(state.zenith, ZENITH_DAY, dw, ZENITH_TWILIGHT, tw, ZENITH_NIGHT, nw)
  blend3(state.horizon, HORIZON_DAY, dw, HORIZON_TWILIGHT, tw, HORIZON_NIGHT, nw)
  blend3(state.hemiSky, HEMI_SKY_DAY, dw, HEMI_SKY_TWILIGHT, tw, HEMI_SKY_NIGHT, nw)
  mix(state.hemiGround, HEMI_GROUND_NIGHT, HEMI_GROUND_DAY, smoothstep(-6, 12, elevation))
  state.hemiIntensity = HEMI_NIGHT + (HEMI_DAY - HEMI_NIGHT) * smoothstep(-9, 14, elevation)

  state.lowSun = smoothstep(-9, 0.5, elevation) * (1 - smoothstep(5, 20, elevation))
  const warmShare = state.lowSun * 0.16
  state.fog[0] = state.horizon[0] + WARM[0] * warmShare * (0.35 + 0.65 * dw + tw)
  state.fog[1] = state.horizon[1] + WARM[1] * warmShare * (0.35 + 0.65 * dw + tw)
  state.fog[2] = state.horizon[2] + WARM[2] * warmShare * (0.35 + 0.65 * dw + tw)

  const groundLight = state.sunIntensity * Math.max(0, state.sun[1]) + state.moonIntensity * Math.max(0, state.moon[1]) + state.hemiIntensity * 0.7
  state.ground[0] = GROUND_ALBEDO[0] * groundLight * (0.6 + 0.4 * state.sunColor[0])
  state.ground[1] = GROUND_ALBEDO[1] * groundLight * (0.6 + 0.4 * state.sunColor[1])
  state.ground[2] = GROUND_ALBEDO[2] * groundLight * (0.6 + 0.4 * state.sunColor[2])

  state.exposure = 1.0 * dw + 1.3 * tw + 1.75 * nw
  state.sunDisc = smoothstep(-1.2, 0.6, elevation)
  state.moonDisc = smoothstep(-1, 3, moonElevation) * (0.15 + 0.85 * nw)
  return state
}

/**
 * Linear-light sky radiance toward the unit direction (dx, dy, dz): the zenith-to-horizon gradient, a broad glow round the sun,
 * the warm band along the horizon at sunrise and sunset, and the fog colour below the horizon (the land past the streamed chunks).
 */
export function skyRadiance(state: SkyState, dx: number, dy: number, dz: number, out: Rgb): Rgb {
  const sun = state.sun
  const up = dy > 0 ? dy : 0
  const lift = Math.pow(up, 0.42)
  let r = state.horizon[0] + (state.zenith[0] - state.horizon[0]) * lift
  let g = state.horizon[1] + (state.zenith[1] - state.horizon[1]) * lift
  let b = state.horizon[2] + (state.zenith[2] - state.horizon[2]) * lift

  const cosSun = dx * sun[0] + dy * sun[1] + dz * sun[2]
  const facing = cosSun > 0 ? cosSun : 0
  const sunUp = smoothstep(-0.12, 0.04, sun[1])
  const broad = Math.pow(facing, 5) * (0.12 * state.dayWeight + 0.32 * state.twilightWeight) * sunUp
  const tight = Math.pow(facing, 28) * (0.3 * state.dayWeight + 0.4 * state.twilightWeight) * sunUp
  r += state.sunColor[0] * (broad + tight)
  g += state.sunColor[1] * (broad + tight)
  b += state.sunColor[2] * (broad + tight)

  if (state.lowSun > 0) {
    const horizontalSun = Math.hypot(sun[0], sun[2]) || 1
    const horizontalDir = Math.hypot(dx, dz) || 1
    const across = (dx * sun[0] + dz * sun[2]) / (horizontalSun * horizontalDir)
    const toward = across > 0 ? across : 0
    const band = Math.exp(-Math.abs(dy) * 7) * state.lowSun
    const warm = band * (0.18 + 0.82 * toward * toward) * (0.5 * state.dayWeight + 0.75 * state.twilightWeight + 0.08)
    r += state.warm[0] * warm
    g += state.warm[1] * warm
    b += state.warm[2] * warm
  }

  if (dy < 0) {
    const below = smoothstep(0, -0.06, dy)
    r += (state.fog[0] - r) * below
    g += (state.fog[1] - g) * below
    b += (state.fog[2] - b) * below
  }
  out[0] = r
  out[1] = g
  out[2] = b
  return out
}
