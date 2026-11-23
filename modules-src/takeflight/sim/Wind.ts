/**
 * Wind for one flight: a steady wind given at 10 m above the ground that strengthens with height (log profile up to 600 m),
 * slow gusts and faster turbulence from first-order filtered noise driven by the flight's seeded generator. `step` advances the
 * gust state once per sim tick; `sample` reads the wind vector at a height without changing anything.
 */
import { DEG, SimRandom, clamp, cos, ln, sin } from './SimMath'

export interface WindSpec {
  /** Direction the wind blows from, degrees true. */
  direction: number
  /** Steady speed at 10 m, m/s. */
  speed: number
  /** Gust amplitude, m/s. */
  gust: number
  /** Turbulence intensity 0..1 (0 smooth, 1 severe). */
  turbulence: number
}

export const CALM: WindSpec = { direction: 270, speed: 0, gust: 0, turbulence: 0 }

const ROUGHNESS = 0.05
const PROFILE_TOP = 600
const GUST_TIME = 4
const TURBULENCE_TIME = 0.6
const UNIT_VARIANCE = 1.7320508075688772

export class WindField {
  spec: WindSpec
  private readonly random: SimRandom
  private gustX = 0
  private gustZ = 0
  private gustS = 0
  private turbX = 0
  private turbY = 0
  private turbZ = 0

  constructor(spec: WindSpec, seed: number) {
    this.spec = { ...spec }
    this.random = new SimRandom(seed)
  }

  /** Generator state, for snapshots. */
  get state(): number[] {
    return [this.random.seed, this.gustX, this.gustZ, this.gustS, this.turbX, this.turbY, this.turbZ]
  }

  set state(values: number[]) {
    this.random.seed = values[0]
    this.gustX = values[1]
    this.gustZ = values[2]
    this.gustS = values[3]
    this.turbX = values[4]
    this.turbY = values[5]
    this.turbZ = values[6]
  }

  step(dt: number): void {
    const gustBlend = dt / GUST_TIME
    const gustDrive = Math.sqrt((2 * dt) / GUST_TIME) * UNIT_VARIANCE
    this.gustS += -this.gustS * gustBlend + gustDrive * this.random.signed()
    this.gustX += -this.gustX * gustBlend + gustDrive * this.random.signed() * 0.4
    this.gustZ += -this.gustZ * gustBlend + gustDrive * this.random.signed() * 0.4
    const turbBlend = dt / TURBULENCE_TIME
    const turbDrive = Math.sqrt((2 * dt) / TURBULENCE_TIME) * UNIT_VARIANCE
    this.turbX += -this.turbX * turbBlend + turbDrive * this.random.signed()
    this.turbY += -this.turbY * turbBlend + turbDrive * this.random.signed()
    this.turbZ += -this.turbZ * turbBlend + turbDrive * this.random.signed()
  }

  /** Writes the air's velocity (m/s, world axes) at `agl` metres above the ground into `out`. */
  sample(agl: number, out: { x: number; y: number; z: number }): void {
    const spec = this.spec
    const h = clamp(agl, ROUGHNESS * 2, PROFILE_TOP)
    const profile = clamp(ln(h / ROUGHNESS) / ln(10 / ROUGHNESS), 0, 2)
    const near = clamp(agl / 30, 0, 1)
    const steady = spec.speed * profile
    const gusting = steady + spec.gust * (this.gustS > 0 ? this.gustS : this.gustS * 0.3)
    const from = spec.direction * DEG
    const towardX = -sin(from)
    const towardZ = cos(from)
    const sigma = spec.turbulence * (1 + spec.speed * 0.12) * (0.35 + 0.65 * near)
    out.x = towardX * gusting + spec.gust * 0.5 * this.gustX + sigma * this.turbX
    out.y = sigma * 0.6 * this.turbY * near
    out.z = towardZ * gusting + spec.gust * 0.5 * this.gustZ + sigma * this.turbZ
  }
}
