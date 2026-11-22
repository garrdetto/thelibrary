/**
 * The machine that loads dump trucks at a loading zone, as a timed cycle with no physics: an excavator (dig, swing the house
 * to the truck, dump, swing back) or a wheel loader (scoop, drive to the truck, dump over the side, back away). Phases run
 * idle → waiting → dig → swing → dump → return → done; a bucket is only emptied over a truck that is ready (parked with the
 * brake set), each bucket never more than the truck still wants. `armPose()` gives the renderer the joint angles.
 */
/** An excavator swings its house to the truck; a wheel loader drives to it. */
export type LoaderKind = 'excavator' | 'loader'
/** Where the machine is in its cycle (`swing` is the drive to the truck for a wheel loader). */
export type LoaderPhase = 'idle' | 'waiting' | 'dig' | 'swing' | 'dump' | 'return' | 'done'

/** Seconds per phase of the cycle. */
export interface LoaderTiming {
  dig: number
  swing: number
  dump: number
  return: number
}

/** Seconds per phase: a 20 t excavator's cycle is about 15 s, a wheel loader's V-pattern about 20 s. */
export const LOADER_TIMING: Record<LoaderKind, LoaderTiming> = {
  excavator: { dig: 5, swing: 3.5, dump: 2.5, return: 3.5 },
  loader: { dig: 4, swing: 6, dump: 3, return: 6 },
}

/** What machine, how big its bucket and which side the truck stands. */
export interface LoaderOptions {
  kind: LoaderKind
  /** Kilograms in a full bucket. */
  bucketKg: number
  /** Which side of the machine the truck stands: 1 its left, −1 its right (excavator swing direction). */
  side?: 1 | -1
  timing?: Partial<LoaderTiming>
}

/**
 * Joint angles for the renderer. Excavator: house `swing` (rad, + left), `boom` (rad above horizontal), `stick` (rad of curl
 * from the boom line) and `bucket` (rad of curl). Wheel loader: lift `arm` (rad above horizontal), `bucket` (rad of roll-back)
 * and `travel` (0 at the pile, 1 at the truck). `fill` is how full the bucket is (0 … 1).
 */
export interface ArmPose {
  swing: number
  boom: number
  stick: number
  bucket: number
  arm: number
  travel: number
  fill: number
  phase: LoaderPhase
  /** 0 … 1 through the current phase. */
  progress: number
}

interface Joints {
  swing: number
  boom: number
  stick: number
  bucket: number
  arm: number
  travel: number
}

const REST: Joints = { swing: 0, boom: 0.35, stick: 1.9, bucket: 1.6, arm: 0.05, travel: 0 }
const DIG_START: Joints = { swing: 0, boom: -0.3, stick: 0.8, bucket: 0.2, arm: -0.12, travel: 0 }
const DIG_END: Joints = { swing: 0, boom: -0.05, stick: 2.0, bucket: 2.2, arm: -0.05, travel: 0 }
const CARRY: Joints = { swing: 1.55, boom: 0.6, stick: 1.5, bucket: 2.2, arm: 0.95, travel: 1 }
const DUMPED: Joints = { swing: 1.55, boom: 0.65, stick: 1.1, bucket: -0.5, arm: 1.0, travel: 1 }

const ease = (t: number): number => t * t * (3 - 2 * t)

/** One loading machine at a loading zone. */
export class LoaderAI {
  readonly kind: LoaderKind
  readonly bucketKg: number
  readonly side: 1 | -1
  readonly timing: LoaderTiming
  phase: LoaderPhase = 'idle'
  /** Kilograms delivered to the current truck. */
  delivered = 0
  /** Kilograms in the bucket now. */
  bucketLoad = 0
  private clock = 0
  private bucketStart = 0
  private readonly from: Joints = { ...REST }
  private readonly joints: Joints = { ...REST }
  private readonly out: ArmPose = { swing: 0, boom: REST.boom, stick: REST.stick, bucket: REST.bucket, arm: REST.arm, travel: 0, fill: 0, phase: 'idle', progress: 0 }

  constructor(options: LoaderOptions) {
    this.kind = options.kind
    this.bucketKg = options.bucketKg
    this.side = options.side ?? 1
    this.timing = { ...LOADER_TIMING[options.kind], ...options.timing }
  }

  /** Back to idle with an empty bucket, ready for the next truck. */
  reset(): void {
    this.enter('idle')
    this.delivered = 0
    this.bucketLoad = 0
  }

  private enter(phase: LoaderPhase): void {
    this.from.swing = this.joints.swing
    this.from.boom = this.joints.boom
    this.from.stick = this.joints.stick
    this.from.bucket = this.joints.bucket
    this.from.arm = this.joints.arm
    this.from.travel = this.joints.travel
    this.phase = phase
    this.clock = 0
  }

  private duration(): number {
    switch (this.phase) {
      case 'dig': return this.timing.dig
      case 'swing': return this.timing.swing
      case 'dump': return this.timing.dump
      case 'return': return this.timing.return
      default: return 1
    }
  }

  /**
   * Steps the cycle. `truckReady` is true while a truck stands in the zone ready to be loaded, `wantKg` how much more it can
   * take. Returns the kilograms poured into the truck this step.
   */
  update(dt: number, truckReady: boolean, wantKg: number): number {
    const want = Math.max(0, wantKg)
    let poured = 0
    this.clock += dt
    switch (this.phase) {
      case 'idle':
        if (want > 0.5) {
          this.delivered = 0
          this.enter('waiting')
        }
        break
      case 'waiting':
        if (truckReady && want > 0.5) this.enter('dig')
        break
      case 'dig':
        if (this.clock >= this.timing.dig) {
          this.bucketLoad = Math.min(this.bucketKg, want)
          this.bucketStart = this.bucketLoad
          this.enter('swing')
        }
        break
      case 'swing':
        if (this.clock >= this.timing.swing && truckReady) this.enter('dump')
        break
      case 'dump': {
        const share = Math.min(1, dt / this.timing.dump)
        poured = Math.min(this.bucketLoad, want, this.clock >= this.timing.dump ? this.bucketLoad : this.bucketStart * share)
        this.bucketLoad -= poured
        this.delivered += poured
        if (this.clock >= this.timing.dump) {
          this.bucketLoad = 0
          this.enter('return')
        }
        break
      }
      case 'return':
        if (this.clock >= this.timing.return) {
          if (want - poured <= 0.5) this.enter('done')
          else if (truckReady) this.enter('dig')
          else this.enter('waiting')
        }
        break
      case 'done':
        if (want > 0.5) {
          this.delivered = 0
          this.enter('waiting')
        }
        break
    }
    this.pose()
    return poured
  }

  private blend(a: Joints, b: Joints, t: number): void {
    const j = this.joints
    j.swing = a.swing + (b.swing - a.swing) * t
    j.boom = a.boom + (b.boom - a.boom) * t
    j.stick = a.stick + (b.stick - a.stick) * t
    j.bucket = a.bucket + (b.bucket - a.bucket) * t
    j.arm = a.arm + (b.arm - a.arm) * t
    j.travel = a.travel + (b.travel - a.travel) * t
  }

  private pose(): void {
    const t = Math.min(1, this.clock / this.duration())
    switch (this.phase) {
      case 'dig':
        if (t < 0.35) this.blend(this.from, DIG_START, ease(t / 0.35))
        else this.blend(DIG_START, DIG_END, ease((t - 0.35) / 0.65))
        break
      case 'swing':
        this.blend(this.from, CARRY, ease(t))
        break
      case 'dump':
        this.blend(this.from, DUMPED, ease(t))
        break
      case 'return':
        this.blend(this.from, REST, ease(t))
        break
      default:
        this.blend(this.from, REST, ease(Math.min(1, this.clock / 2)))
        break
    }
  }

  /** The machine's joint angles now (one reused object). */
  armPose(): ArmPose {
    const j = this.joints
    const o = this.out
    o.swing = j.swing * this.side
    o.boom = j.boom
    o.stick = j.stick
    o.bucket = j.bucket
    o.arm = j.arm
    o.travel = j.travel
    o.fill = this.bucketKg > 0 ? this.bucketLoad / this.bucketKg : 0
    o.phase = this.phase
    o.progress = Math.min(1, this.clock / this.duration())
    return o
  }
}
