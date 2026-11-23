/**
 * The flight recorder. Attached to a `Simulation`, it keeps every tick's quantised input (12 bytes, the replay and re-simulation
 * log), a 10 Hz telemetry sample of the aircraft (24 Float32 channels: means and peaks over each 12-tick window) and the exact
 * 120 Hz touchdown events scoring needs. Storage grows a minute at a time, so a tick costs a few writes and no allocation.
 * The same recorder runs on a re-flown log, so a re-simulated flight produces bit-identical telemetry and the same score.
 */
import { INPUT_BYTES, encodeInput } from './Controls'
import type { ControlInput } from './Controls'
import type { FlightModel } from './FlightModel'
import type { Simulation } from './Simulation'
import { SIM_HZ } from './Simulation'

export const TELEMETRY_HZ = 10
export const TICKS_PER_SAMPLE = SIM_HZ / TELEMETRY_HZ

/** Telemetry channel indices. */
export const CH = {
  tick: 0,
  x: 1,
  y: 2,
  z: 3,
  ias: 4,
  groundSpeed: 5,
  verticalSpeed: 6,
  agl: 7,
  pitch: 8,
  bank: 9,
  heading: 10,
  track: 11,
  g: 12,
  gMax: 13,
  gMin: 14,
  lateralG: 15,
  alpha: 16,
  stall: 17,
  throttle: 18,
  flap: 19,
  gear: 20,
  onGround: 21,
  strikes: 22,
  fuel: 23,
} as const

export const CHANNELS = 24
const SAMPLES_PER_CHUNK = TELEMETRY_HZ * 60
const TICKS_PER_CHUNK = SIM_HZ * 60
/** A touchdown counts when the wheels were off the ground for at least this many ticks. */
const MIN_AIRBORNE_TICKS = 24
const TOUCHDOWN_WINDOW = 60
/** Touchdown G is read through a 0.1 s low-pass, like a cockpit accelerometer, not the gear spring's 120 Hz spikes. */
const G_FILTER = 1 / 12

export interface TouchdownEvent {
  tick: number
  /** Sink rate at first wheel contact, m/s (positive down). */
  sinkRate: number
  /** Peak filtered normal load factor within half a second of contact. */
  g: number
  x: number
  z: number
  heading: number
  track: number
  bank: number
  pitch: number
  /** Indicated airspeed, m/s. */
  ias: number
  /** Seconds the wheels were off the ground before this contact. */
  airborne: number
}

export interface RecordChunk {
  inputs: Uint8Array
  telemetry: Float32Array
}

const NONE: readonly RecordChunk[] = []

export class FlightRecorder {
  ticks = 0
  samples = 0
  readonly touchdowns: TouchdownEvent[] = []
  private readonly inputChunks: Uint8Array[] = []
  private readonly sampleChunks: Float32Array[] = []
  private inputs = new Uint8Array(INPUT_BYTES * TICKS_PER_CHUNK)
  private telemetry = new Float32Array(CHANNELS * SAMPLES_PER_CHUNK)
  private sentInputs = 0
  private sentSamples = 0
  private windowTicks = 0
  private sumG = 0
  private maxG = -Infinity
  private minG = Infinity
  private airborneTicks = 0
  private filteredG = 1
  private open: TouchdownEvent | null = null
  private openTicks = 0
  private detach: (() => void) | null = null

  /** Records every tick `sim` runs from now on. */
  attach(sim: Simulation): void {
    this.detach?.()
    this.detach = sim.onTick((_tick, input, aircraft) => this.record(input, aircraft))
  }

  /** Clears everything for a new flight; `airborne` says whether it starts in the air. */
  reset(airborne: boolean): void {
    this.ticks = 0
    this.samples = 0
    this.touchdowns.length = 0
    this.inputChunks.length = 0
    this.sampleChunks.length = 0
    this.sentInputs = 0
    this.sentSamples = 0
    this.windowTicks = 0
    this.sumG = 0
    this.maxG = -Infinity
    this.minG = Infinity
    this.airborneTicks = airborne ? SIM_HZ * 60 : 0
    this.filteredG = 1
    this.open = null
    this.openTicks = 0
  }

  record(input: Readonly<ControlInput>, a: FlightModel): void {
    const tickInChunk = this.ticks % TICKS_PER_CHUNK
    encodeInput(input, this.inputs, tickInChunk * INPUT_BYTES)
    this.ticks++
    if (tickInChunk === TICKS_PER_CHUNK - 1) {
      this.inputChunks.push(this.inputs)
      this.inputs = new Uint8Array(INPUT_BYTES * TICKS_PER_CHUNK)
    }
    this.trackTouchdown(a)
    const g = a.loadFactor
    this.sumG += g
    if (g > this.maxG) this.maxG = g
    if (g < this.minG) this.minG = g
    this.windowTicks++
    if (this.windowTicks < TICKS_PER_SAMPLE) return
    const base = (this.samples % SAMPLES_PER_CHUNK) * CHANNELS
    const t = this.telemetry
    t[base + CH.tick] = a.tick
    t[base + CH.x] = a.px
    t[base + CH.y] = a.py
    t[base + CH.z] = a.pz
    t[base + CH.ias] = a.ias
    t[base + CH.groundSpeed] = a.groundSpeed
    t[base + CH.verticalSpeed] = a.verticalSpeed
    t[base + CH.agl] = a.agl
    t[base + CH.pitch] = a.pitch
    t[base + CH.bank] = a.bank
    t[base + CH.heading] = a.heading
    t[base + CH.track] = a.track
    t[base + CH.g] = this.sumG / this.windowTicks
    t[base + CH.gMax] = this.maxG
    t[base + CH.gMin] = this.minG
    t[base + CH.lateralG] = a.lateralG
    t[base + CH.alpha] = a.alpha
    t[base + CH.stall] = a.stall
    t[base + CH.throttle] = input.throttle
    t[base + CH.flap] = a.flap
    t[base + CH.gear] = a.gear
    t[base + CH.onGround] = a.wheelLoad > 0 ? 1 : 0
    t[base + CH.strikes] = a.strikes
    t[base + CH.fuel] = a.fuel
    this.samples++
    this.windowTicks = 0
    this.sumG = 0
    this.maxG = -Infinity
    this.minG = Infinity
    if (this.samples % SAMPLES_PER_CHUNK === 0) {
      this.sampleChunks.push(this.telemetry)
      this.telemetry = new Float32Array(CHANNELS * SAMPLES_PER_CHUNK)
    }
  }

  private trackTouchdown(a: FlightModel): void {
    this.filteredG += (a.loadFactor - this.filteredG) * G_FILTER
    const open = this.open
    if (open) {
      if (this.filteredG > open.g) open.g = this.filteredG
      if (++this.openTicks >= TOUCHDOWN_WINDOW) this.open = null
    }
    if (a.wheelLoad <= 0) {
      this.airborneTicks++
      return
    }
    if (this.airborneTicks >= MIN_AIRBORNE_TICKS) {
      const event: TouchdownEvent = { tick: a.tick, sinkRate: -a.vy, g: this.filteredG, x: a.px, z: a.pz, heading: a.heading, track: a.track, bank: a.bank, pitch: a.pitch, ias: a.ias, airborne: this.airborneTicks / SIM_HZ }
      this.touchdowns.push(event)
      this.open = event
      this.openTicks = 0
    }
    this.airborneTicks = 0
  }

  /** Whole minutes recorded since the last call, ready to post to the compression worker (copies). */
  takeFull(): readonly RecordChunk[] {
    if (this.sentInputs >= this.inputChunks.length && this.sentSamples >= this.sampleChunks.length) return NONE
    const out: RecordChunk[] = []
    while (this.sentInputs < this.inputChunks.length || this.sentSamples < this.sampleChunks.length) {
      const inputs = this.sentInputs < this.inputChunks.length ? this.inputChunks[this.sentInputs++].slice() : new Uint8Array(0)
      const telemetry = this.sentSamples < this.sampleChunks.length ? this.sampleChunks[this.sentSamples++].slice() : new Float32Array(0)
      out.push({ inputs, telemetry })
    }
    return out
  }

  /** Marks every finished minute unsent, so the next `takeFull` returns the whole flight again. */
  resend(): void {
    this.sentInputs = 0
    this.sentSamples = 0
  }

  /** The partly filled minute at the end of the flight (copies). */
  takeTail(): RecordChunk {
    return {
      inputs: this.inputs.slice(0, (this.ticks % TICKS_PER_CHUNK) * INPUT_BYTES),
      telemetry: this.telemetry.slice(0, (this.samples % SAMPLES_PER_CHUNK) * CHANNELS),
    }
  }

  /** The whole input log as one array. */
  inputLog(): Uint8Array {
    const out = new Uint8Array(this.ticks * INPUT_BYTES)
    let offset = 0
    for (const chunk of this.inputChunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    out.set(this.inputs.subarray(0, (this.ticks % TICKS_PER_CHUNK) * INPUT_BYTES), offset)
    return out
  }

  /** All telemetry samples as one array (`samples * CHANNELS` floats). */
  telemetryLog(): Float32Array {
    const out = new Float32Array(this.samples * CHANNELS)
    let offset = 0
    for (const chunk of this.sampleChunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    out.set(this.telemetry.subarray(0, (this.samples % SAMPLES_PER_CHUNK) * CHANNELS), offset)
    return out
  }

  dispose(): void {
    this.detach?.()
    this.detach = null
  }
}
