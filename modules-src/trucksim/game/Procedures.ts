/**
 * The realistic loading and unloading steps for every haul, as data plus checks. A procedure reads the rig through a
 * `ProcedureContext` (plain views of the truck, trailer and machine, key states and a few actions) so it runs the same in the
 * standalone page, inside Life Sim, and in tests with a fake context. The session implements the context over the real rigs.
 */
import { CARGO_BY_ID } from '../shared/Catalog'
import type { HaulKind, TrailerKind } from '../shared/Catalog'
import type { Job } from '../shared/Jobs'
import { headingDelta, inZone } from '../shared/WorldLayout'
import type { Zone } from '../shared/WorldLayout'

export type ProcKey = 'interact' | 'fifth' | 'gear' | 'raise' | 'lower'
export type KeyState = 'up' | 'pressed' | 'held'

export interface Point2 {
  x: number
  z: number
}

export interface TruckView {
  x: number
  z: number
  heading: number
  /** Signed forward speed, m/s. */
  speed: number
  parkingBrake: boolean
  fifthWheel: Point2
  dump: { loadKg: number; capacityKg: number; angle: number } | null
}

export interface TrailerView {
  kind: TrailerKind
  center: Point2
  heading: number
  rear: Point2
  hopper: Point2
  coupled: boolean
  neckAttached: boolean
  /** Landing gear or, on the lowboy, the deck hydraulics: 0 up … 1 down. */
  gear: number
  doors: number
  payloadKg: number
  capacityKg: number
  deckFront: Point2
}

export interface MachineView {
  x: number
  z: number
  speed: number
  onDeck: boolean
  secured: boolean
  controlled: boolean
}

export interface ProcedureContext {
  readonly zone: Zone
  readonly job: Job
  readonly truck: TruckView
  readonly trailer: TrailerView | null
  readonly machine: MachineView | null
  key(key: ProcKey): KeyState
  /** Adds material to the dump bed; returns the kilograms that fitted. */
  addDump(kg: number, material: string): number
  setTrailerPayload(kg: number, cargo: string | null): void
  setDoors(target: 0 | 1): void
  setDeck(target: 0 | 1): void
  detachNeck(): string | null
  attachNeck(): string | null
  spawnMachine(): void
  secureMachine(): string | null
  releaseMachine(): void
  takeMachine(): string | null
  leaveMachine(): void
  /** Runs the zone's loader for `dt`; returns kilograms dumped into the bed this step. */
  loaderStep(dt: number, ready: boolean, wantKg: number): number
}

export interface StepView {
  id: string
  label: string
  hint: string
  progress: number
  done: boolean
}

export interface ProcedureStatus {
  title: string
  steps: StepView[]
  active: number
  message: string
  done: boolean
}

/** What the zone's equipment is doing, for the renderer (`render/work/WorkZones.ts`). */
export interface ZoneActivity {
  phase: string
  progress: number
  arm?: number
  flow?: number
}

interface Memory {
  start: number
  count: number
  held: number
  steady: number
  [key: string]: number
}

interface StepDef {
  id: string
  hint: string
  label(ctx: ProcedureContext, mem: Memory): string
  /** Progress 0 … 1; 1 completes the step. */
  tick(ctx: ProcedureContext, dt: number, mem: Memory): number
  /** False for steps the truck must move during (pulling away from the deck, driving the machine). */
  parked?: boolean
  phase?: string
}

export const TANK_RATE_KG_S = 700
export const GRAIN_RATE_KG_S = 620
export const FORKLIFT_SECONDS = 24
export const CRANE_SECONDS = 26
export const HOLD_SECONDS = 0.8
export const CHAIN_SECONDS = 1.1
export const DOCK_TOLERANCE_M = 1.0
export const DOCK_TOLERANCE_DEG = 6
export const SPOUT_TOLERANCE_M = 1.5
export const PULL_AWAY_M = 6.5
export const PAD_TOLERANCE_M = 4.5
export const CHAIN_POINTS = 4

const DEG = Math.PI / 180

export function strapCount(massKg: number): number {
  return Math.max(4, Math.min(8, Math.round(massKg / 3000)))
}

function parked(ctx: ProcedureContext): boolean {
  return ctx.truck.parkingBrake && Math.abs(ctx.truck.speed) < 0.3
}

function aligned(heading: number, zone: Zone, toleranceDeg: number, eitherWay: boolean): boolean {
  const d = Math.abs(headingDelta(heading, zone.heading))
  return d <= toleranceDeg * DEG || (eitherWay && Math.PI - d <= toleranceDeg * DEG)
}

function distance(a: Point2, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function rigPoint(ctx: ProcedureContext): Point2 {
  return ctx.trailer ? ctx.trailer.center : { x: ctx.truck.x, z: ctx.truck.z }
}

function rigHeading(ctx: ProcedureContext): number {
  return ctx.trailer ? ctx.trailer.heading : ctx.truck.heading
}

function positionStep(id: string, label: string, toleranceDeg: number, eitherWay: boolean): StepDef {
  return {
    id, hint: 'Drive', parked: false, phase: 'arriving',
    label: (ctx) => {
      const p = rigPoint(ctx)
      const d = distance(p, ctx.zone)
      return d > 12 ? `${label} — ${Math.round(d)} m away` : label
    },
    tick: (ctx) => {
      const p = rigPoint(ctx)
      if (!inZone(ctx.zone, p.x, p.z, 1.5)) return 0
      return aligned(rigHeading(ctx), ctx.zone, toleranceDeg, eitherWay) ? 1 : 0.5
    },
  }
}

const parkStep: StepDef = {
  id: 'park', hint: 'Space', parked: false, phase: 'arriving',
  label: () => 'Stop and set the parking brake',
  tick: (ctx) => (parked(ctx) ? 1 : 0),
}

function pressStep(id: string, hint: string, key: ProcKey, label: string, act: (ctx: ProcedureContext, mem: Memory) => string | null | boolean, extra: Partial<StepDef> = {}): StepDef {
  return {
    id, hint, label: (_ctx, mem) => (mem.error ? `${label} (${ERRORS[mem.error] ?? ''})`.replace(' ()', '') : label),
    tick: (ctx, _dt, mem) => {
      if (ctx.key(key) !== 'pressed') return 0
      const result = act(ctx, mem)
      if (typeof result === 'string') {
        mem.error = rememberError(result)
        return 0
      }
      mem.error = 0
      return result === false ? 0 : 1
    },
    ...extra,
  }
}

const ERRORS: Record<number, string> = {}
let errorSerial = 0
function rememberError(message: string): number {
  for (const [k, v] of Object.entries(ERRORS)) if (v === message) return Number(k)
  errorSerial += 1
  ERRORS[errorSerial] = message
  return errorSerial
}

function holdSteps(id: string, hint: string, key: ProcKey, total: (ctx: ProcedureContext) => number, label: (done: number, total: number) => string, seconds: number, guard: (ctx: ProcedureContext) => boolean, finish?: (ctx: ProcedureContext, mem: Memory) => string | null): StepDef {
  return {
    id, hint,
    label: (ctx, mem) => label(mem.count, total(ctx)) + (mem.error ? ` (${ERRORS[mem.error]})` : ''),
    tick: (ctx, dt, mem) => {
      const n = total(ctx)
      if (mem.count >= n) {
        if (!finish) return 1
        const error = finish(ctx, mem)
        if (error) {
          mem.error = rememberError(error)
          mem.count = n - 1
          return (n - 1) / n
        }
        return 1
      }
      if (guard(ctx) && ctx.key(key) === 'held') mem.held += dt
      else mem.held = Math.max(0, mem.held - dt * 2)
      if (mem.held >= seconds) {
        mem.held = 0
        mem.count += 1
      }
      return Math.min(0.999, (mem.count + mem.held / seconds) / n)
    },
  }
}

function hydraulicStep(id: string, label: string, target: 0 | 1): StepDef {
  return {
    id, hint: 'Hold G', label: () => label,
    tick: (ctx) => {
      const trailer = ctx.trailer
      if (!trailer) return 0
      if (ctx.key('gear') === 'held') ctx.setDeck(target)
      const progress = target === 1 ? trailer.gear : 1 - trailer.gear
      return progress >= 0.99 ? 1 : Math.min(0.99, progress)
    },
  }
}

function waitStep(id: string, label: string, phase: string, seconds: number, onDone: (ctx: ProcedureContext) => void): StepDef {
  return {
    id, hint: 'Wait', phase, label: () => label,
    tick: (ctx, dt, mem) => {
      mem.held += dt
      const progress = Math.min(1, mem.held / seconds)
      if (progress >= 1 && !mem.finished) {
        mem.finished = 1
        onDone(ctx)
      }
      return progress
    },
  }
}

function flowStep(id: string, label: string, phase: string, rate: number, direction: 1 | -1): StepDef {
  return {
    id, hint: 'Wait', phase, label: () => label,
    tick: (ctx, dt, mem) => {
      const trailer = ctx.trailer
      if (!trailer) return 0
      const target = direction > 0 ? Math.min(ctx.job.massKg, trailer.capacityKg) : 0
      if (!mem.started) {
        mem.started = 1
        mem.start = trailer.payloadKg
      }
      const next = direction > 0 ? Math.min(target, trailer.payloadKg + rate * dt) : Math.max(0, trailer.payloadKg - rate * dt)
      ctx.setTrailerPayload(next, next > 0 ? ctx.job.cargo : null)
      const span = Math.max(1, Math.abs(target - mem.start))
      return Math.min(1, Math.abs(next - mem.start) / span)
    },
  }
}

function pullAwayStep(): StepDef {
  return {
    id: 'pull-away', hint: 'Drive', parked: false, label: () => 'Pull the tractor forward off the deck',
    tick: (ctx) => {
      const trailer = ctx.trailer
      if (!trailer) return 0
      return Math.min(1, distance(ctx.truck.fifthWheel, trailer.deckFront) / PULL_AWAY_M)
    },
  }
}

function takeMachineStep(): StepDef {
  return pressStep('take-machine', 'E', 'interact', 'Climb into the excavator', (ctx) => (parked(ctx) ? ctx.takeMachine() : 'set the parking brake first'))
}

function leaveMachineStep(): StepDef {
  return pressStep('leave-machine', 'E', 'interact', 'Park the excavator and climb down', (ctx) => {
    const machine = ctx.machine
    if (machine && Math.abs(machine.speed) > 0.3) return 'stop the machine first'
    ctx.leaveMachine()
    return null
  }, { parked: false })
}

function reconnectStep(): StepDef {
  return pressStep('reconnect', 'T', 'fifth', 'Back the gooseneck into the deck and connect', (ctx) => ctx.attachNeck(), { parked: false })
}

function stepsFor(haul: HaulKind, phase: 'load' | 'unload', zone: Zone, job: Job): StepDef[] {
  const cargo = CARGO_BY_ID[job.cargo]
  const name = cargo?.name.toLowerCase() ?? 'the load'
  const machineWord = zone.kind === 'dumpLoad' && zone.label.toLowerCase().includes('loader') ? 'wheel loader' : 'excavator'
  switch (haul) {
    case 'dump':
      if (phase === 'load') {
        return [
          positionStep('position', `Drive into the ${zone.label.toLowerCase()}`, 30, true),
          parkStep,
          {
            id: 'loading', hint: 'Wait', phase: 'loading', label: () => `Wait while the ${machineWord} loads ${name}`,
            tick: (ctx, dt) => {
              const dump = ctx.truck.dump
              if (!dump) return 0
              const want = Math.min(job.massKg, dump.capacityKg)
              const kg = ctx.loaderStep(dt, parked(ctx), Math.max(0, want - dump.loadKg))
              if (kg > 0) ctx.addDump(kg, job.cargo)
              return dump.loadKg >= want - 1 ? 1 : Math.min(0.99, dump.loadKg / want)
            },
          },
        ]
      }
      return [
        positionStep('position', `Drive into the ${zone.label.toLowerCase()}`, 180, true),
        parkStep,
        {
          id: 'raise', hint: 'Hold R', phase: 'dumping', label: () => 'Raise the bed until it is empty',
          tick: (ctx, _dt, mem) => {
            const dump = ctx.truck.dump
            if (!dump) return 0
            if (!mem.started) {
              mem.started = 1
              mem.start = Math.max(1, dump.loadKg)
            }
            return dump.loadKg <= 1 ? 1 : Math.min(0.99, 1 - dump.loadKg / mem.start)
          },
        },
        { id: 'lower', hint: 'Hold F', label: () => 'Lower the bed', tick: (ctx) => (ctx.truck.dump && ctx.truck.dump.angle < 0.03 ? 1 : 0.5) },
      ]
    case 'tanker': {
      const what = phase === 'load' ? 'loading arm' : 'delivery hose'
      return [
        positionStep('position', phase === 'load' ? `Pull into ${zone.label.toLowerCase()}` : `Pull up to the ${zone.label.toLowerCase()}`, 15, phase === 'unload'),
        parkStep,
        pressStep('connect', 'E', 'interact', `Connect the ${what}`, () => null),
        flowStep('flow', phase === 'load' ? `Filling with ${name}` : `Draining ${name} into the tank`, phase === 'load' ? 'filling' : 'draining', TANK_RATE_KG_S, phase === 'load' ? 1 : -1),
        pressStep('disconnect', 'E', 'interact', `Disconnect the ${what}`, () => null),
      ]
    }
    case 'flatbed': {
      const crane = zone.site === 'steel'
      const total = () => strapCount(job.massKg)
      const load: StepDef[] = [
        positionStep('position', `Pull into the ${zone.label.toLowerCase()}`, 12, true),
        parkStep,
        waitStep('loading', crane ? `Wait while the crane sets the ${name} on the deck` : `Wait while the forklift loads the ${name}`, 'loading', crane ? CRANE_SECONDS : FORKLIFT_SECONDS, (ctx) => ctx.setTrailerPayload(Math.min(job.massKg, ctx.trailer?.capacityKg ?? job.massKg), job.cargo)),
        holdSteps('straps', 'Hold E', 'interact', total, (done, n) => `Strap the load down at every tie point (${done}/${n})`, HOLD_SECONDS, parked),
      ]
      const unload: StepDef[] = [
        positionStep('position', `Pull into the ${zone.label.toLowerCase()}`, 12, true),
        parkStep,
        holdSteps('straps', 'Hold E', 'interact', total, (done, n) => `Release the straps (${done}/${n})`, HOLD_SECONDS, parked),
        waitStep('unloading', `Wait while the forklift takes the ${name} off`, 'unloading', FORKLIFT_SECONDS, (ctx) => ctx.setTrailerPayload(0, null)),
      ]
      return phase === 'load' ? load : unload
    }
    case 'grain': {
      const spout = zone.equipment ?? { x: zone.x, z: zone.z }
      const lineUp: StepDef = {
        id: 'line-up', hint: 'Drive', parked: false, phase: 'arriving',
        label: (ctx) => {
          const d = ctx.trailer ? distance(ctx.trailer.hopper, spout) : 99
          const where = phase === 'load' ? 'under the spout' : 'over the pit grate'
          return d < 12 ? `Line the hoppers up ${where} — ${d.toFixed(1)} m` : `Drive to the ${zone.label.toLowerCase()}`
        },
        tick: (ctx) => {
          const trailer = ctx.trailer
          if (!trailer) return 0
          const d = distance(trailer.hopper, spout)
          if (d > SPOUT_TOLERANCE_M) return Math.max(0, Math.min(0.9, 1 - d / 15))
          return aligned(trailer.heading, zone, 10, true) ? 1 : 0.9
        },
      }
      const holdOnSpout = (step: StepDef): StepDef => ({
        ...step,
        tick: (ctx, dt, mem) => {
          const trailer = ctx.trailer
          if (!trailer || distance(trailer.hopper, spout) > SPOUT_TOLERANCE_M) return mem.last ?? 0
          mem.last = step.tick(ctx, dt, mem)
          return mem.last
        },
      })
      if (phase === 'load') {
        return [
          lineUp, parkStep,
          pressStep('tarp-open', 'E', 'interact', 'Roll the tarp open', (ctx) => { ctx.setDoors(1); return null }),
          holdOnSpout(flowStep('flow', `Filling with ${name}`, 'filling', GRAIN_RATE_KG_S, 1)),
          pressStep('tarp-close', 'E', 'interact', 'Roll the tarp closed', (ctx) => { ctx.setDoors(0); return null }),
        ]
      }
      return [
        lineUp, parkStep,
        pressStep('gates-open', 'E', 'interact', 'Open the hopper gates', (ctx) => { ctx.setDoors(1); return null }),
        holdOnSpout(flowStep('flow', `Draining ${name} into the pit`, 'draining', GRAIN_RATE_KG_S, -1)),
        pressStep('gates-close', 'E', 'interact', 'Close the hopper gates', (ctx) => { ctx.setDoors(0); return null }),
      ]
    }
    case 'reefer': {
      const dock = zone.dock ?? { x: zone.x, z: zone.z }
      const backIn: StepDef = {
        id: 'dock', hint: 'Reverse', parked: false, phase: 'arriving',
        label: (ctx) => {
          const d = ctx.trailer ? distance(ctx.trailer.rear, dock) : 99
          return d < 25 ? `Back square into ${zone.label.toLowerCase()} — ${d.toFixed(1)} m` : `Drive to ${zone.label.toLowerCase()} and back in`
        },
        tick: (ctx) => {
          const trailer = ctx.trailer
          if (!trailer) return 0
          const d = distance(trailer.rear, dock)
          if (d > DOCK_TOLERANCE_M) return Math.max(0, Math.min(0.9, 1 - d / 30))
          return Math.abs(headingDelta(trailer.heading, zone.heading)) <= DOCK_TOLERANCE_DEG * DEG ? 1 : 0.92
        },
      }
      const count = Math.max(10, Math.round(job.massKg / 900))
      return [
        backIn, parkStep,
        pressStep('doors-open', 'E', 'interact', 'Open the trailer doors', (ctx) => { ctx.setDoors(1); return null }),
        waitStep(phase === 'load' ? 'loading' : 'unloading', phase === 'load' ? `Wait while the forklift loads ${count} pallets of ${name}` : `Wait while the forklift unloads ${count} pallets`, phase === 'load' ? 'loading' : 'unloading', FORKLIFT_SECONDS, (ctx) => ctx.setTrailerPayload(phase === 'load' ? Math.min(job.massKg, ctx.trailer?.capacityKg ?? job.massKg) : 0, phase === 'load' ? job.cargo : null)),
        pressStep('doors-close', 'E', 'interact', 'Close and latch the doors', (ctx) => { ctx.setDoors(0); return null }),
      ]
    }
    case 'lowboy': {
      const pad = zone.equipment ?? { x: zone.x, z: zone.z, heading: zone.heading }
      const machineOnDeck: StepDef = {
        id: 'drive-on', hint: 'Drive', parked: false, phase: 'loading',
        label: () => 'Drive the excavator up over the front and onto the deck',
        tick: (ctx, dt, mem) => {
          const machine = ctx.machine
          if (!machine?.onDeck) {
            mem.steady = 0
            return 0
          }
          mem.steady = Math.abs(machine.speed) < 0.2 ? mem.steady + dt : 0
          return Math.min(1, 0.6 + mem.steady / 3)
        },
      }
      const machineToPad: StepDef = {
        id: 'drive-off', hint: 'Drive', parked: false, phase: 'unloading',
        label: (ctx) => {
          const machine = ctx.machine
          const d = machine ? distance(machine, pad) : 99
          return `Drive the excavator off and park it on the marked pad — ${Math.round(d)} m`
        },
        tick: (ctx, dt, mem) => {
          const machine = ctx.machine
          if (!machine) return 0
          const d = distance(machine, pad)
          if (d > PAD_TOLERANCE_M) {
            mem.steady = 0
            return Math.max(0, Math.min(0.6, 1 - d / 40))
          }
          mem.steady = Math.abs(machine.speed) < 0.2 ? mem.steady + dt : 0
          return Math.min(1, 0.7 + mem.steady / 3)
        },
      }
      const chainsOn = holdSteps('chains', 'Hold E', 'interact', () => CHAIN_POINTS, (done, n) => `Chain the excavator down at each corner (${done}/${n})`, CHAIN_SECONDS, (ctx) => Boolean(ctx.machine?.onDeck) && !ctx.machine?.controlled, (ctx) => ctx.secureMachine())
      const chainsOff = holdSteps('chains', 'Hold E', 'interact', () => CHAIN_POINTS, (done, n) => `Release the chains (${done}/${n})`, CHAIN_SECONDS, parked, (ctx) => { ctx.releaseMachine(); return null })
      const detach = pressStep('detach', 'T', 'fifth', 'Detach the gooseneck from the deck', (ctx) => ctx.detachNeck())
      if (phase === 'load') {
        return [
          { ...positionStep('position', 'Park the lowboy straight in the staging lane', 12, false), tick: (ctx, dt, mem) => { ctx.spawnMachine(); return positionStep('position', '', 12, false).tick(ctx, dt, mem) } },
          parkStep,
          hydraulicStep('lower', 'Lower the deck to the ground', 1),
          detach,
          pullAwayStep(),
          takeMachineStep(),
          machineOnDeck,
          leaveMachineStep(),
          chainsOn,
          reconnectStep(),
          hydraulicStep('raise', 'Raise the deck for travel', 0),
        ]
      }
      return [
        positionStep('position', 'Park the lowboy straight in the staging lane', 12, false),
        parkStep,
        hydraulicStep('lower', 'Lower the deck to the ground', 1),
        chainsOff,
        detach,
        pullAwayStep(),
        takeMachineStep(),
        machineToPad,
        leaveMachineStep(),
        reconnectStep(),
        hydraulicStep('raise', 'Raise the deck for travel', 0),
      ]
    }
  }
}

function freshMemory(): Memory {
  return { start: 0, count: 0, held: 0, steady: 0 }
}

/** One run through a haul's loading or unloading steps at one zone. */
export class Procedure {
  private index = 0
  private readonly memory: Memory[]
  private readonly progress: number[]
  private message = ''
  private finished = false
  readonly title: string

  constructor(readonly job: Job, readonly phase: 'load' | 'unload', readonly zone: Zone, private readonly defs: StepDef[]) {
    this.memory = defs.map(freshMemory)
    this.progress = defs.map(() => 0)
    const site = zone.label
    this.title = phase === 'load' ? `Loading at ${site}` : `Unloading at ${site}`
  }

  get done(): boolean {
    return this.finished
  }

  get activeStep(): string {
    return this.defs[this.index]?.id ?? 'done'
  }

  /** Advances the active step. Steps that need the rig parked pause (with a message) while it isn't. */
  update(ctx: ProcedureContext, dt: number): ProcedureStatus {
    if (!this.finished) {
      const def = this.defs[this.index]
      const needsPark = def.parked !== false && this.index > 0
      if (needsPark && !parked(ctx) && !ctx.machine?.controlled) {
        this.message = 'Set the parking brake to carry on'
      } else {
        this.message = ''
        const value = def.tick(ctx, dt, this.memory[this.index])
        this.progress[this.index] = Math.max(0, Math.min(1, value))
        if (value >= 1) {
          this.index += 1
          if (this.index >= this.defs.length) this.finished = true
        }
      }
    }
    return this.status(ctx)
  }

  status(ctx: ProcedureContext): ProcedureStatus {
    return {
      title: this.title,
      steps: this.defs.map((def, i) => ({ id: def.id, label: def.label(ctx, this.memory[i]), hint: def.hint, progress: i < this.index ? 1 : this.progress[i], done: i < this.index })),
      active: this.index,
      message: this.message,
      done: this.finished,
    }
  }

  activity(): ZoneActivity {
    const def = this.defs[this.index]
    return { phase: this.finished ? 'done' : def?.phase ?? 'idle', progress: this.finished ? 1 : this.progress[this.index] ?? 0 }
  }
}

export function createProcedure(job: Job, phase: 'load' | 'unload', zone: Zone): Procedure {
  return new Procedure(job, phase, zone, stepsFor(job.haul, phase, zone, job))
}
