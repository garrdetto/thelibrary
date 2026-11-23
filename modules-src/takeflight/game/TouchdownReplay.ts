/**
 * The touchdown replay: re-flies the end of the approach from the live flight's nearest snapshot and its input log, so what plays
 * back is the simulation itself, not a recording of poses. It plays from ten seconds before the landing touchdown to six seconds
 * after, at half or full speed, and loops. The page renders `sim`'s aircraft instead of the live one while it runs.
 */
import type { AircraftSpec } from '../shared/AircraftSpec'
import type { RecordHeader } from '../shared/FlightRecord'
import type { Ground } from '../shared/Terrain'
import { Reflight } from '../sim/Reflight'
import type { SimSnapshot, Simulation } from '../sim/Simulation'
import { SIM_DT, SIM_HZ } from '../sim/Simulation'

const BEFORE = 10 * SIM_HZ
const AFTER = 6 * SIM_HZ
const HOLD = 1.2

export class TouchdownReplay {
  speed = 0.5
  private reflight: Reflight | null = null
  private snapshot: SimSnapshot | null = null
  private from = 0
  private to = 0
  private accumulator = 0
  private hold = 0

  constructor(private readonly spec: AircraftSpec, private readonly ground: Ground) {}

  get sim(): Simulation | null {
    return this.reflight?.sim ?? null
  }

  /** Share of the clip played, 0..1. */
  get progress(): number {
    if (!this.reflight || this.to <= this.from) return 0
    return Math.min(1, Math.max(0, (this.reflight.flown - this.from) / (this.to - this.from)))
  }

  /** Seconds from the touchdown (negative before it). */
  get clock(): number {
    return this.reflight ? (this.reflight.flown - (this.from + BEFORE)) / SIM_HZ : 0
  }

  start(header: RecordHeader, inputs: Uint8Array, snapshots: readonly SimSnapshot[], touchdownTick: number): void {
    this.reflight?.dispose()
    this.reflight = new Reflight(this.spec, this.ground, header, inputs)
    const ticks = this.reflight.ticks
    this.from = Math.max(0, touchdownTick - BEFORE)
    this.to = Math.min(ticks, touchdownTick + AFTER)
    let chosen = snapshots[0] ?? null
    for (const snapshot of snapshots) if (snapshot.aircraft.values[0] <= this.from) chosen = snapshot
    this.snapshot = chosen
    this.rewind()
  }

  private rewind(): void {
    const reflight = this.reflight
    if (!reflight) return
    if (this.snapshot) reflight.seek(this.snapshot)
    else reflight.restart()
    reflight.step(this.from - reflight.flown)
    reflight.sim.settle()
    this.accumulator = 0
    this.hold = 0
  }

  /** Advances by real time; returns the interpolation share between the replay's last two ticks. */
  update(dt: number): number {
    const reflight = this.reflight
    if (!reflight) return 1
    if (reflight.flown >= this.to) {
      this.hold += dt
      if (this.hold >= HOLD) this.rewind()
      return 1
    }
    this.accumulator += dt * this.speed
    let ticks = 0
    while (this.accumulator >= SIM_DT && ticks < 12) {
      if (reflight.step(1) === 0) break
      this.accumulator -= SIM_DT
      ticks++
    }
    return Math.min(1, this.accumulator / SIM_DT)
  }

  stop(): void {
    this.reflight?.dispose()
    this.reflight = null
    this.snapshot = null
  }
}
