/**
 * The fixed-timestep driver: the flight model runs at exactly 120 Hz whatever the frame rate, the renderer reads a state
 * interpolated between the last two ticks, and every tick's quantised input goes to an optional recorder (telemetry and replays).
 * The same class re-flies a recorded input log on the Worker.
 */
import type { AircraftSpec } from '../shared/AircraftSpec'
import type { Ground } from '../shared/Terrain'
import { applyAssists } from './Assists'
import type { AssistSettings } from './Assists'
import { copyInput, createInput, quantizeInput } from './Controls'
import type { ControlInput } from './Controls'
import { FlightModel } from './FlightModel'
import type { FlightEnvironment, FlightSnapshot } from './FlightModel'
import { WindField } from './Wind'
import type { WindSpec } from './Wind'
import { createWeatherState, weatherAt, weatherWind } from '../shared/Weather'
import type { WeatherKind, WeatherState } from '../shared/Weather'

export const SIM_HZ = 120
export const SIM_DT = 1 / SIM_HZ
/** Most ticks run in one frame; a longer stall (tab in the background) is dropped rather than replayed in a burst. */
const MAX_TICKS_PER_FRAME = 12

export interface FlightSetup {
  aircraft: AircraftSpec
  ground: Ground
  wind: WindSpec
  seed: number
  temperatureOffset: number
  seaLevelPressure: number
  assists: AssistSettings
  /** Weather over the base `wind` (default clear). */
  weather?: WeatherKind
  /** Payload in kg (default: the aircraft's default payload). */
  payload?: number | null
  /** An engine that fails once the aircraft has climbed through `agl` metres after take-off (multi-engine checkride). */
  failure?: { engine: number; agl: number } | null
}

export interface TickListener {
  (tick: number, input: Readonly<ControlInput>, aircraft: FlightModel): void
}

export interface SimSnapshot {
  aircraft: FlightSnapshot
  wind: number[]
}

export interface InterpolatedState {
  x: number
  y: number
  z: number
  qx: number
  qy: number
  qz: number
  qw: number
}

export class Simulation {
  aircraft: FlightModel
  previous: FlightModel
  readonly env: FlightEnvironment
  readonly setup: FlightSetup
  /** Raw pilot input; the sim copies, assists and quantises it each tick. */
  readonly pilot: ControlInput = createInput()
  readonly applied: ControlInput = createInput()
  paused = false
  /** The weather now (changes during the flight for changing weather; read by the renderer). */
  readonly weather: WeatherState = createWeatherState()
  private accumulator = 0
  private readonly listeners: TickListener[] = []

  constructor(setup: FlightSetup) {
    this.setup = setup
    this.aircraft = new FlightModel(setup.aircraft)
    this.previous = new FlightModel(setup.aircraft)
    this.env = { ground: setup.ground, wind: new WindField(setup.wind, setup.seed), temperatureOffset: setup.temperatureOffset, seaLevelPressure: setup.seaLevelPressure }
    this.applyWeather(0)
  }

  /** Sets the weather and the wind it stirs for `tick` (updated once a second of sim time). */
  private applyWeather(tick: number): void {
    const kind = this.setup.weather ?? 'clear'
    weatherAt(kind, this.setup.seed, Math.floor(tick / SIM_HZ), this.weather)
    weatherWind(this.setup.wind, this.weather, this.env.wind.spec)
  }

  private stepFailure(): void {
    const failure = this.setup.failure
    const a = this.aircraft
    if (failure && a.failedEngine < 0 && a.wheelLoad <= 0 && a.agl > failure.agl && a.vy > 0) a.failedEngine = failure.engine
  }

  private stepWeather(): void {
    if (this.setup.weather === 'changing' && this.aircraft.tick % SIM_HZ === 0) this.applyWeather(this.aircraft.tick)
  }

  /** Changes the aircraft type (between flights); the caller resets and places it afterwards. */
  setAircraft(spec: AircraftSpec): void {
    if (spec === this.setup.aircraft) return
    this.setup.aircraft = spec
    this.aircraft = new FlightModel(spec)
    this.previous = new FlightModel(spec)
  }

  /** Starts a new flight with new conditions on the same aircraft; the caller places it afterwards. */
  reset(conditions: Pick<FlightSetup, 'wind' | 'seed' | 'temperatureOffset' | 'seaLevelPressure' | 'assists' | 'weather' | 'failure' | 'payload'>): void {
    Object.assign(this.setup, conditions)
    this.setup.failure = conditions.failure ?? null
    this.setup.weather = conditions.weather ?? 'clear'
    this.env.wind = new WindField(conditions.wind, conditions.seed)
    this.applyWeather(0)
    this.env.temperatureOffset = conditions.temperatureOffset
    this.env.seaLevelPressure = conditions.seaLevelPressure
    this.aircraft.reset()
    this.previous.reset()
    if (conditions.payload !== undefined && conditions.payload !== null) this.aircraft.payload = conditions.payload
    this.setup.payload = conditions.payload ?? null
    this.accumulator = 0
  }

  onTick(listener: TickListener): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  /** Marks the current state as both previous and current (after a teleport or reset). */
  settle(): void {
    this.previous.copyFrom(this.aircraft)
    this.accumulator = 0
  }

  /** The aircraft and wind state after the last tick, exact enough to continue from bit for bit. */
  saveState(): SimSnapshot {
    return { aircraft: this.aircraft.saveState(), wind: this.env.wind.state }
  }

  loadState(snapshot: SimSnapshot): void {
    this.aircraft.loadState(snapshot.aircraft)
    this.env.wind.state = snapshot.wind
    this.applyWeather(this.aircraft.tick)
    this.settle()
  }

  /** Runs one tick with an explicit input (replays and tests). */
  stepWith(input: ControlInput): void {
    copyInput(input, this.applied)
    quantizeInput(this.applied)
    this.previous.copyFrom(this.aircraft)
    this.stepWeather()
    this.stepFailure()
    this.aircraft.step(this.applied, SIM_DT, this.env)
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i](this.aircraft.tick, this.applied, this.aircraft)
  }

  /** Runs one tick from the pilot input with assists applied. */
  stepPilot(): void {
    copyInput(this.pilot, this.applied)
    applyAssists(this.setup.assists, this.aircraft, this.applied)
    quantizeInput(this.applied)
    this.previous.copyFrom(this.aircraft)
    this.stepWeather()
    this.stepFailure()
    this.aircraft.step(this.applied, SIM_DT, this.env)
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i](this.aircraft.tick, this.applied, this.aircraft)
  }

  /** Advances by real time `seconds`; returns the interpolation share (0..1) between the previous and current tick. */
  advance(seconds: number): number {
    if (this.paused) return 1
    this.accumulator += seconds
    let ticks = 0
    while (this.accumulator >= SIM_DT && ticks < MAX_TICKS_PER_FRAME) {
      this.stepPilot()
      this.accumulator -= SIM_DT
      ticks++
    }
    if (ticks === MAX_TICKS_PER_FRAME && this.accumulator > SIM_DT) this.accumulator = 0
    return this.accumulator / SIM_DT
  }

  /** Interpolated position and orientation for rendering. */
  interpolate(share: number, out: InterpolatedState): InterpolatedState {
    const a = this.previous
    const b = this.aircraft
    out.x = a.px + (b.px - a.px) * share
    out.y = a.py + (b.py - a.py) * share
    out.z = a.pz + (b.pz - a.pz) * share
    let bx = b.qx
    let by = b.qy
    let bz = b.qz
    let bw = b.qw
    if (a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw < 0) {
      bx = -bx
      by = -by
      bz = -bz
      bw = -bw
    }
    const x = a.qx + (bx - a.qx) * share
    const y = a.qy + (by - a.qy) * share
    const z = a.qz + (bz - a.qz) * share
    const w = a.qw + (bw - a.qw) * share
    const length = Math.sqrt(x * x + y * y + z * z + w * w) || 1
    out.qx = x / length
    out.qy = y / length
    out.qz = z / length
    out.qw = w / length
    return out
  }
}
