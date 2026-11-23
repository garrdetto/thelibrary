/**
 * Re-flies a recorded flight: a fresh `Simulation` with the record's conditions, the same deterministic start, then the input
 * log fed tick by tick through `stepWith`. Used for the touchdown replay (stepped in slices so the page never stalls) and for
 * re-scoring, which must reproduce the live flight's telemetry and score exactly.
 */
import type { AircraftSpec } from '../shared/AircraftSpec'
import { airportById } from '../shared/Airports'
import type { AirportSpec } from '../shared/Airports'
import type { RecordHeader } from '../shared/FlightRecord'
import type { Ground } from '../shared/Terrain'
import { INPUT_BYTES, createInput, decodeInput } from './Controls'
import { Simulation } from './Simulation'
import type { SimSnapshot } from './Simulation'
import { placeStart, startsAirborne } from './Starts'
import { FlightRecorder } from './Telemetry'

export class Reflight {
  readonly sim: Simulation
  readonly recorder: FlightRecorder | null
  private next = 0
  private readonly airport: AirportSpec
  private readonly input = createInput()

  constructor(spec: AircraftSpec, private readonly ground: Ground, private readonly header: RecordHeader, private inputs: Uint8Array, record = false) {
    const airport = airportById(header.airport)
    if (!airport) throw new Error(`Unknown airport ${header.airport}`)
    this.airport = airport
    this.sim = new Simulation({ aircraft: spec, ground, wind: header.wind, seed: header.seed, temperatureOffset: header.temperatureOffset, seaLevelPressure: header.seaLevelPressure, assists: { ...header.assists }, weather: header.weather, failure: header.failure ?? null, payload: header.payload ?? null })
    this.recorder = record ? new FlightRecorder() : null
    this.recorder?.attach(this.sim)
    this.restart()
  }

  /** Total ticks in the log. */
  get ticks(): number {
    return Math.floor(this.inputs.length / INPUT_BYTES)
  }

  /** Ticks already flown. */
  get flown(): number {
    return this.next
  }

  /** Replaces the log (a longer one of the same flight) without restarting. */
  setInputs(inputs: Uint8Array): void {
    this.inputs = inputs
  }

  restart(): void {
    const h = this.header
    this.sim.reset({ wind: h.wind, seed: h.seed, temperatureOffset: h.temperatureOffset, seaLevelPressure: h.seaLevelPressure, assists: { ...h.assists }, weather: h.weather, failure: h.failure ?? null, payload: h.payload ?? null })
    placeStart(this.sim.aircraft, this.sim.pilot, this.airport, this.ground, h.start)
    this.sim.settle()
    this.recorder?.reset(startsAirborne(h.start))
    this.next = 0
  }

  /** Continues from a snapshot of the same flight taken after `snapshot.aircraft.values[0]` ticks (no recording). */
  seek(snapshot: SimSnapshot): void {
    this.sim.loadState(snapshot)
    this.next = snapshot.aircraft.values[0]
  }

  /** Flies up to `count` more ticks; returns how many ran. */
  step(count: number): number {
    const end = Math.min(this.ticks, this.next + count)
    const ran = end - this.next
    while (this.next < end) {
      decodeInput(this.inputs, this.next * INPUT_BYTES, this.input)
      this.sim.stepWith(this.input)
      this.next++
    }
    return ran
  }

  dispose(): void {
    this.recorder?.dispose()
  }
}
