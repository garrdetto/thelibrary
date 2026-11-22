/**
 * A dump truck's bed as plain numbers: what it holds (kg and material), the hydraulic hoist angle driven by `target`
 * (−1 lower, 0 hold, 1 raise, at 6°/s up to `maxAngleDeg`), the tailgate that swings open past 8°, and material sliding out past
 * 28° at up to 2,500 kg/s. `TruckRig` steps it and turns `loadKg` into payload mass; the renderer reads `angle`, `tailgate` and
 * `fill`.
 */
import type { DumpSpec } from '../shared/Catalog'

/** Hoist speed up and down, degrees per second. */
export const HOIST_DEG_PER_S = 6
/** Bed angle where the tailgate starts to swing open, degrees. */
export const TAILGATE_OPEN_DEG = 8
/** Degrees past `TAILGATE_OPEN_DEG` where the tailgate hangs fully open. */
export const TAILGATE_SWING_DEG = 12
/** Bed angle where the load starts to slide out, degrees. */
export const FLOW_START_DEG = 28
/** Angle where the flow reaches its full rate (or the bed's maximum, if lower). */
export const FLOW_FULL_DEG = 42
/** Fastest the load leaves the bed, kg/s. */
export const MAX_FLOW_KG_S = 2500

const DEG = Math.PI / 180

/** One dump bed's load, hoist and tailgate. */
export class DumpBody {
  readonly spec: DumpSpec
  readonly capacityKg: number
  loadKg = 0
  material: string | null = null
  /** Bed angle in radians, 0 down. */
  angle = 0
  /** Hoist control: −1 lower, 0 hold, 1 raise. */
  target: -1 | 0 | 1 = 0
  /** Tailgate swing, 0 shut … 1 open. */
  tailgate = 0
  /** Kilograms that left the bed in the last `update`. */
  lastFlowKg = 0

  constructor(spec: DumpSpec) {
    this.spec = spec
    this.capacityKg = spec.capacityKg
  }

  get angleDeg(): number {
    return this.angle / DEG
  }

  get maxAngle(): number {
    return this.spec.maxAngleDeg * DEG
  }

  /** Share of capacity loaded, 0 … 1. */
  get fill(): number {
    return this.loadKg / this.capacityKg
  }

  get empty(): boolean {
    return this.loadKg <= 0
  }

  /** True while the bed is fully down (safe to drive). */
  get lowered(): boolean {
    return this.angle <= 0.001
  }

  /** Loads up to `kg` of `material` (only into an empty bed or one holding the same material); returns the kilograms taken. */
  add(kg: number, material: string): number {
    if (kg <= 0) return 0
    if (this.material && this.material !== material && this.loadKg > 0) return 0
    const taken = Math.min(kg, this.capacityKg - this.loadKg)
    if (taken <= 0) return 0
    this.loadKg += taken
    if (this.capacityKg - this.loadKg < 1e-6) this.loadKg = this.capacityKg
    this.material = material
    return taken
  }

  /** Empties the bed at once (a reset, not dumping). */
  clear(): void {
    this.loadKg = 0
    this.material = null
  }

  /** Steps the hoist, tailgate and flow; returns the kilograms dumped this step. */
  update(dt: number): number {
    const step = HOIST_DEG_PER_S * DEG * dt
    if (this.target > 0) this.angle = Math.min(this.maxAngle, this.angle + step)
    else if (this.target < 0) this.angle = Math.max(0, this.angle - step)
    const deg = this.angleDeg
    this.tailgate = Math.min(1, Math.max(0, (deg - TAILGATE_OPEN_DEG) / TAILGATE_SWING_DEG))
    this.lastFlowKg = 0
    if (deg > FLOW_START_DEG && this.tailgate > 0.5 && this.loadKg > 0) {
      const full = Math.max(FLOW_START_DEG + 1, Math.min(FLOW_FULL_DEG, this.spec.maxAngleDeg))
      const share = Math.min(1, Math.max(0.15, (deg - FLOW_START_DEG) / (full - FLOW_START_DEG)))
      const flow = Math.min(this.loadKg, MAX_FLOW_KG_S * share * dt)
      this.loadKg -= flow
      if (this.loadKg < 1e-3) {
        this.loadKg = 0
        this.material = null
      }
      this.lastFlowKg = flow
    }
    return this.lastFlowKg
  }
}
