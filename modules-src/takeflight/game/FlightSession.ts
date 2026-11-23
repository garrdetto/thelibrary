/**
 * One flight's bookkeeping around the simulation: the flight recorder, a full-state snapshot every five seconds (touchdown replays
 * start from the nearest one), streaming the record to the compression worker a minute at a time, touchdown notices for the HUD,
 * spotting the end of a flight (stopped on the ground after a landing) and the final score.
 */
import { RecordWriter } from '../shared/FlightRecord'
import type { RecordFooter, RecordHeader } from '../shared/FlightRecord'
import type { CrashReason, FlightModel } from '../sim/FlightModel'
import { LANDING_AIRBORNE, scoreFlight } from '../sim/Scoring'
import type { EndReason, FlightScore } from '../sim/Scoring'
import type { SimSnapshot, Simulation } from '../sim/Simulation'
import { SIM_HZ } from '../sim/Simulation'
import { startsAirborne } from '../sim/Starts'
import { FlightRecorder } from '../sim/Telemetry'
import type { RecordChunk, TouchdownEvent } from '../sim/Telemetry'
import type { RecordReply, RecordRequest } from './record.worker'

const SNAPSHOT_TICKS = SIM_HZ * 5
const STOP_SECONDS = 2.5
const STOP_SPEED = 0.5
const TOUCHDOWN_SETTLE = SIM_HZ / 2

export interface FinishedRecord {
  bytes: Uint8Array
  raw: number
}

export class FlightSession {
  readonly recorder = new FlightRecorder()
  readonly snapshots: SimSnapshot[] = []
  header: RecordHeader | null = null
  score: FlightScore | null = null
  private worker: Worker | null = null
  private fallback: RecordWriter | null = null
  private finishId = 0
  private readonly pending = new Map<number, (record: FinishedRecord | null) => void>()
  private seenTouchdowns = 0
  private landingArmed = false
  private stoppedFor = 0
  private readonly offTick: () => void

  constructor(private readonly sim: Simulation) {
    this.recorder.attach(sim)
    this.offTick = sim.onTick((tick) => {
      if (tick % SNAPSHOT_TICKS === 0) this.snapshots.push(sim.saveState())
    })
    try {
      this.worker = new Worker(new URL('./record.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<RecordReply>) => this.onReply(event.data)
      this.worker.onerror = () => {
        this.worker?.terminate()
        this.worker = null
      }
    } catch {
      this.worker = null
    }
  }

  private post(message: RecordRequest, transfer: Transferable[] = []): boolean {
    if (!this.worker) return false
    this.worker.postMessage(message, transfer)
    return true
  }

  private onReply(reply: RecordReply): void {
    const resolve = this.pending.get(reply.id)
    if (!resolve) return
    this.pending.delete(reply.id)
    resolve(reply.type === 'done' ? { bytes: reply.bytes, raw: reply.raw } : null)
  }

  private openWriter(): void {
    if (!this.header) return
    if (!this.post({ type: 'begin', header: this.header })) {
      void this.fallback?.abort()
      try {
        this.fallback = new RecordWriter(this.header)
      } catch {
        this.fallback = null
      }
    }
  }

  private send(chunk: RecordChunk): void {
    if (this.post({ type: 'chunk', inputs: chunk.inputs, telemetry: chunk.telemetry }, [chunk.inputs.buffer, chunk.telemetry.buffer])) return
    this.fallback?.addInputs(chunk.inputs)
    this.fallback?.addTelemetry(chunk.telemetry)
  }

  /** Starts recording a flight; call after the aircraft is placed and settled, before its first tick. */
  begin(header: RecordHeader): void {
    this.header = header
    this.score = null
    this.recorder.reset(startsAirborne(header.start))
    this.snapshots.length = 0
    this.snapshots.push(this.sim.saveState())
    this.seenTouchdowns = 0
    this.landingArmed = false
    this.stoppedFor = 0
    this.openWriter()
  }

  /** Picks the flight up again after a debrief: the record restarts with everything flown so far. */
  resume(): void {
    this.score = null
    this.landingArmed = false
    this.stoppedFor = 0
    this.recorder.resend()
    this.openWriter()
  }

  /** Per frame while flying: streams finished minutes to the worker. */
  pump(): void {
    for (const chunk of this.recorder.takeFull()) this.send(chunk)
  }

  /** The next touchdown not yet reported, once its half-second G window has closed. */
  takeTouchdown(): TouchdownEvent | null {
    const list = this.recorder.touchdowns
    if (this.seenTouchdowns >= list.length) return null
    const event = list[this.seenTouchdowns]
    if (this.sim.aircraft.tick - event.tick < TOUCHDOWN_SETTLE && !this.sim.aircraft.crashed) return null
    this.seenTouchdowns++
    if (event.airborne >= LANDING_AIRBORNE) this.landingArmed = true
    return event
  }

  /** True once the aircraft has stood still on its wheels for a moment after a landing. */
  stoppedAfterLanding(aircraft: FlightModel, dt: number): boolean {
    if (!this.landingArmed) return false
    if (aircraft.wheelLoad > 0 && aircraft.groundSpeed < STOP_SPEED) this.stoppedFor += dt
    else this.stoppedFor = 0
    if (this.stoppedFor < STOP_SECONDS) return false
    this.landingArmed = false
    this.stoppedFor = 0
    return true
  }

  /** Ends the flight: scores it and finishes the compressed record (resolves to null if compression is unavailable). */
  finish(ended: EndReason, crashed: CrashReason | null, spec: FlightModel['spec']): { score: FlightScore; record: Promise<FinishedRecord | null> } {
    const r = this.recorder
    const score = scoreFlight({ spec, assists: this.header?.assists ?? { autoTrim: false, stallProtection: false, landingGuidance: false }, telemetry: r.telemetryLog(), samples: r.samples, touchdowns: r.touchdowns, crashed, ended })
    this.score = score
    this.pump()
    this.send(r.takeTail())
    const footer: RecordFooter = { ticks: r.ticks, samples: r.samples, touchdowns: r.touchdowns.map((t) => ({ ...t })), crashed, ended, score: score.total }
    const id = ++this.finishId
    let record: Promise<FinishedRecord | null>
    if (this.post({ type: 'finish', id, footer })) {
      record = new Promise((resolve) => this.pending.set(id, resolve))
    } else if (this.fallback) {
      const writer = this.fallback
      this.fallback = null
      const raw = writer.rawBytes
      record = writer.finish(footer).then((bytes) => ({ bytes, raw }), () => null)
    } else record = Promise.resolve(null)
    return { score, record }
  }

  /** Drops the record of a flight abandoned without a debrief. */
  abandon(): void {
    this.post({ type: 'abort' })
    void this.fallback?.abort()
    this.fallback = null
  }

  dispose(): void {
    this.offTick()
    this.recorder.dispose()
    this.abandon()
    this.worker?.terminate()
    this.worker = null
    for (const resolve of this.pending.values()) resolve(null)
    this.pending.clear()
  }
}
