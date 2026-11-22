/**
 * Follows one accepted job from the pickup zone to the drop zone: drive to the pickup, run the loading procedure, drive to the
 * drop, run the unloading procedure, then report done so the session can post `complete-job`. Cargo damage builds up from
 * hard impacts while loaded, scaled by how fragile the cargo is. Renderer-free; the session feeds it rig views each frame.
 */
import { CARGO_BY_ID } from '../shared/Catalog'
import type { HaulKind } from '../shared/Catalog'
import type { HaulWorld } from '../shared/HaulWorld'
import type { Job } from '../shared/Jobs'
import type { Zone } from '../shared/WorldLayout'
import { createProcedure } from './Procedures'
import type { Procedure, ProcedureContext, ProcedureStatus, ZoneActivity } from './Procedures'

export type JobStage = 'toPickup' | 'loading' | 'toDrop' | 'unloading' | 'complete'

/** Within this many metres of a zone the procedure takes over from the GPS. */
export const ARRIVE_RADIUS = 70
/** Velocity changes (m/s) above this in one step damage loaded cargo. */
export const IMPACT_THRESHOLD = 3

export interface JobFrame {
  stage: JobStage
  target: Zone
  distanceM: number
  status: ProcedureStatus | null
  /** Why the job can't go on with the rig as it is (wrong trailer, bed not empty), or ''. */
  blocker: string
}

/** What the rig can carry right now, for the blocker check. */
export interface RigFit {
  haul: HaulKind | null
  capacityKg: number
  loadedKg: number
}

export class JobRunner {
  stage: JobStage = 'toPickup'
  damage = 0
  procedure: Procedure | null = null
  readonly pickup: Zone
  readonly drop: Zone
  private readonly fragile: number

  constructor(readonly job: Job, readonly acceptedAt: number, world: HaulWorld) {
    const pickup = world.zone(job.from)
    const drop = world.zone(job.to)
    if (!pickup || !drop) throw new Error(`Job ${job.id} names an unknown zone`)
    this.pickup = pickup
    this.drop = drop
    this.fragile = CARGO_BY_ID[job.cargo]?.fragile ?? 0.3
  }

  get loaded(): boolean {
    return this.stage === 'toDrop' || this.stage === 'unloading'
  }

  /** A hard knock: loaded cargo takes damage in proportion to the excess speed change and its fragility. */
  impact(dv: number): void {
    if (!this.loaded || dv <= IMPACT_THRESHOLD) return
    this.damage = Math.min(1, this.damage + (dv - IMPACT_THRESHOLD) * 0.025 * (0.4 + this.fragile))
  }

  target(): Zone {
    return this.stage === 'toPickup' || this.stage === 'loading' ? this.pickup : this.drop
  }

  private blocker(fit: RigFit): string {
    if (fit.haul !== this.job.haul) return blockerText(this.job.haul)
    if (this.stage === 'toPickup' && fit.loadedKg > 1 && this.job.haul !== 'lowboy') return 'Empty the rig before loading'
    return ''
  }

  update(ctx: ProcedureContext | null, rig: { x: number; z: number }, fit: RigFit, dt: number): JobFrame {
    const target = this.target()
    const distanceM = Math.hypot(rig.x - target.x, rig.z - target.z)
    const blocker = this.stage === 'complete' ? '' : this.blocker(fit)
    if (this.stage === 'toPickup' && !blocker && distanceM < ARRIVE_RADIUS) {
      this.stage = 'loading'
      this.procedure = createProcedure(this.job, 'load', this.pickup)
    } else if (this.stage === 'toDrop' && !blocker && distanceM < ARRIVE_RADIUS) {
      this.stage = 'unloading'
      this.procedure = createProcedure(this.job, 'unload', this.drop)
    }
    let status: ProcedureStatus | null = null
    if (this.procedure && ctx && (this.stage === 'loading' || this.stage === 'unloading')) {
      status = this.procedure.update(ctx, dt)
      if (status.done) {
        this.stage = this.stage === 'loading' ? 'toDrop' : 'complete'
        this.procedure = null
      }
    }
    return { stage: this.stage, target: this.target(), distanceM, status, blocker }
  }

  activity(): ZoneActivity | null {
    return this.procedure ? this.procedure.activity() : null
  }
}

export function blockerText(haul: HaulKind): string {
  switch (haul) {
    case 'dump': return 'This job needs a dump truck'
    case 'tanker': return 'Couple a fuel tanker to take this job'
    case 'flatbed': return 'Couple a flatbed to take this job'
    case 'grain': return 'Couple a grain hopper to take this job'
    case 'reefer': return 'Couple a reefer to take this job'
    case 'lowboy': return 'Couple the lowboy to take this job'
  }
}
