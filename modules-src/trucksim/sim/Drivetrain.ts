/**
 * A truck's engine and gearbox as plain numbers, no Rapier: a diesel torque curve (peak torque from 1,100 to 1,500 rpm, power
 * limited above, governed at `maxRpm`), a 10- or 13-speed automated manual with a shift time and a launch clutch, reverse,
 * engine drag and the jake brake, a road-speed governor at `topSpeedKph`, and fuel burned from the power the engine makes plus
 * idle, scaled to the model's `fuelLPer100Km`. `update` returns the force the drive axles push the truck with (N, + forward).
 */
import type { TruckModel } from '../shared/Catalog'

/** Share of engine torque that reaches the wheels through the gearbox and axles. */
export const DRIVELINE_EFFICIENCY = 0.88
/** Torque interruption while the automated manual changes gear, s. */
export const SHIFT_SECONDS = 0.6
/** Engine speeds between which the engine makes its peak torque. */
export const PEAK_TORQUE_FROM_RPM = 1100
/** Engine speed above which torque is limited by rated power. */
export const PEAK_TORQUE_TO_RPM = 1500
/** Clutch-slip engine speed when pulling away. */
export const LAUNCH_RPM = 1150
/** Litres per hour at idle. */
export const IDLE_FUEL_LPH = 2.6
/** Jake brake retarding power at governed speed as a share of rated power. */
export const JAKE_SHARE = 0.8
/** Engine friction and pumping drag (no jake) as a share of peak torque. */
export const DRAG_SHARE = 0.07
/** Upshift engine speed at light throttle. */
export const UPSHIFT_RPM_LIGHT = 1300
/** Upshift engine speed at full throttle. */
export const UPSHIFT_RPM_FULL = 1850
/** Downshift engine speed at light throttle (rises 200 rpm by full throttle). */
export const DOWNSHIFT_RPM = 950
/** Downshift point while the jake brake holds the truck back, to keep the engine in its braking range. */
export const JAKE_DOWNSHIFT_RPM = 1350
/** Engine, flywheel and clutch rotating inertia, kg·m²; reflected through the gearbox it is tonnes of extra mass in low gears. */
export const ENGINE_INERTIA = 3
/** Litres of diesel per joule of engine work (about 200 g/kWh). */
const LITRES_PER_JOULE = 0.235 / 3.6e6
const RPM_TO_RAD = Math.PI / 30
const GRAVITY = 9.81

/** What the drivetrain needs each step: pedal and switches from the driver, speed, mass and grade from the rig. */
export interface DrivetrainInput {
  /** 0 … 1 */
  throttle: number
  engineBrake: boolean
  /** Edge-triggered gear requests (they also override the automatic for two seconds); at a stop, down selects reverse and up drive. */
  shiftUp: boolean
  shiftDown: boolean
  /** Road speed along the truck's forward axis, m/s (+ forward). */
  speed: number
  /** Everything the engine pulls: truck, payload and any trailer, kg. */
  massKg: number
  /** Sine of the uphill grade ahead (+ uphill). */
  grade: number
}

/** One truck's engine, automated manual gearbox, jake brake and fuel tank. */
export class Drivetrain {
  readonly model: TruckModel
  readonly wheelRadius: number
  /** −1 reverse, 0 neutral, 1 … `gearCount` forward. */
  gear = 1
  rpm: number
  /** Automated manual shifts by itself when true; manual requests still work and hold off the automatic for 2 s. */
  automatic = true
  fuelL: number
  fuelUsedL = 0
  /** 0 … 1 how hard the engine is working (exhaust smoke, engine sound). */
  load = 0
  /** True while the jake brake is retarding. */
  retarding = false
  /** Seconds left in a gear change (no drive while shifting). */
  shiftTimer = 0
  /** Last wheel force returned by `update`, N. */
  force = 0
  private targetGear = 1
  private holdOff = 0
  private readonly peakTorque: number
  private readonly powerW: number

  constructor(model: TruckModel) {
    this.model = model
    this.wheelRadius = model.wheelRadius
    this.rpm = model.idleRpm
    this.fuelL = model.fuelTankL
    this.peakTorque = model.torqueNm
    this.powerW = model.powerKw * 1000
  }

  get gearCount(): number {
    return this.model.gears.length
  }

  get running(): boolean {
    return this.fuelL > 0
  }

  get shifting(): boolean {
    return this.shiftTimer > 0
  }

  /** Gear the gearbox is in or changing to. */
  get selectedGear(): number {
    return this.shiftTimer > 0 ? this.targetGear : this.gear
  }

  /** Gearbox ratio times final drive for a gear (reverse included), 0 in neutral. */
  ratio(gear: number): number {
    if (gear === 0) return 0
    const box = gear < 0 ? this.model.reverseRatio : this.model.gears[Math.min(gear, this.gearCount) - 1]
    return box * this.model.finalDrive
  }

  /** Full-throttle engine torque at an engine speed, Nm. */
  torqueAt(rpm: number): number {
    const { idleRpm, maxRpm } = this.model
    let torque: number
    if (rpm < PEAK_TORQUE_FROM_RPM) {
      const t = Math.max(0, (rpm - idleRpm) / (PEAK_TORQUE_FROM_RPM - idleRpm))
      torque = this.peakTorque * (0.62 + 0.38 * t)
    } else if (rpm <= PEAK_TORQUE_TO_RPM) {
      torque = this.peakTorque
    } else {
      torque = Math.min(this.peakTorque, this.powerW / (rpm * RPM_TO_RAD))
    }
    const governor = 1 - Math.min(1, Math.max(0, (rpm - (maxRpm - 120)) / 150))
    return torque * governor
  }

  /** Retarding torque at an engine speed with the throttle closed, Nm (engine drag plus the jake when `jake`). */
  dragAt(rpm: number, jake: boolean): number {
    const drag = DRAG_SHARE * this.peakTorque * Math.min(1, rpm / this.model.maxRpm)
    if (!jake) return drag
    const share = Math.min(1, Math.max(0, (rpm - 900) / (this.model.maxRpm - 200 - 900)))
    return drag + (JAKE_SHARE * this.powerW * share) / Math.max(1, rpm * RPM_TO_RAD)
  }

  /** The highest of the first gears that still pulls `massKg` away at a brisk 1.4 m/s² up `grade`. */
  startGear(massKg: number, grade: number): number {
    let best = 1
    const top = Math.min(this.gearCount, this.gearCount > 10 ? 4 : 3)
    for (let gear = 1; gear <= top; gear++) {
      const force = (this.peakTorque * this.ratio(gear) * DRIVELINE_EFFICIENCY) / this.wheelRadius
      const accel = force / Math.max(1, massKg) - GRAVITY * Math.max(0, grade) - 0.1
      if (accel >= 1.4) best = gear
    }
    return best
  }

  /** Selects reverse when the truck is (nearly) stopped; false otherwise. */
  selectReverse(speed: number): boolean {
    if (Math.abs(speed) > 1) return false
    this.gear = -1
    this.targetGear = -1
    this.shiftTimer = 0
    return true
  }

  /** Selects the first forward gear the automatic would start in when stopped; false otherwise. */
  selectDrive(speed: number, massKg: number, grade = 0): boolean {
    if (Math.abs(speed) > 1 && this.gear < 0) return false
    const start = this.startGear(massKg, grade)
    this.gear = start
    this.targetGear = start
    this.shiftTimer = 0
    return true
  }

  /** Puts fuel in (litres), up to the tank size; returns the litres taken. */
  refuel(litres: number): number {
    const taken = Math.max(0, Math.min(litres, this.model.fuelTankL - this.fuelL))
    this.fuelL += taken
    return taken
  }

  private beginShift(gear: number): void {
    this.targetGear = gear
    this.shiftTimer = SHIFT_SECONDS
  }

  private manualShifts(input: DrivetrainInput): void {
    const speed = input.speed
    if (input.shiftUp) {
      if (this.gear <= 0 && !this.shifting) {
        if (this.gear < 0 && Math.abs(speed) > 1) return
        this.selectDrive(speed, input.massKg, input.grade)
      } else if (this.selectedGear < this.gearCount) {
        this.beginShift(this.selectedGear + 1)
      }
      this.holdOff = 2
    }
    if (input.shiftDown) {
      const current = this.selectedGear
      if (current >= 1 && Math.abs(speed) < 0.5 && (this.automatic || current === 1)) {
        this.selectReverse(speed)
      } else if (current <= 1) {
        if (Math.abs(speed) <= 1) this.selectReverse(speed)
      } else {
        const lower = current - 1
        const rpm = (Math.abs(speed) / this.wheelRadius) * this.ratio(lower) / RPM_TO_RAD
        if (rpm < this.model.maxRpm - 50) this.beginShift(lower)
      }
      this.holdOff = 2
    }
  }

  private autoShift(input: DrivetrainInput, throttle: number, locked: boolean): void {
    if (!this.automatic || this.holdOff > 0 || this.shifting || this.gear < 1) return
    const absSpeed = Math.abs(input.speed)
    const start = this.startGear(input.massKg, input.grade)
    if (absSpeed < 0.6) {
      if (this.gear !== start && throttle < 0.05) {
        this.gear = start
        this.targetGear = start
      }
      return
    }
    if (!locked) return
    const jakeHold = input.engineBrake && throttle < 0.05
    const up = jakeHold ? this.model.maxRpm - 100 : UPSHIFT_RPM_LIGHT + (UPSHIFT_RPM_FULL - UPSHIFT_RPM_LIGHT) * throttle
    const down = jakeHold ? JAKE_DOWNSHIFT_RPM : DOWNSHIFT_RPM + 200 * throttle
    if (this.rpm > up && this.gear < this.gearCount) {
      const next = (this.rpm * this.ratio(this.gear + 1)) / this.ratio(this.gear)
      if (next > down + 120) {
        this.beginShift(this.gear + 1)
        this.holdOff = 0.8
      }
    } else if (this.rpm < down && this.gear > (absSpeed < 5 ? start : 1)) {
      const lower = (this.rpm * this.ratio(this.gear - 1)) / this.ratio(this.gear)
      if (lower < this.model.maxRpm - 150) {
        this.beginShift(this.gear - 1)
        this.holdOff = 0.8
      }
    }
  }

  /** Steps the engine and gearbox; returns the wheel force (N, + pushes the truck forward). */
  update(dt: number, input: DrivetrainInput): number {
    const { idleRpm, maxRpm } = this.model
    this.holdOff = Math.max(0, this.holdOff - dt)
    this.manualShifts(input)
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt
      if (this.shiftTimer <= 0) {
        this.shiftTimer = 0
        this.gear = this.targetGear
      }
    }
    this.retarding = false
    if (!this.running) {
      this.rpm = Math.max(0, this.rpm - 2000 * dt)
      this.load = 0
      this.force = 0
      return 0
    }
    const speed = input.speed
    const topSpeed = this.model.topSpeedKph / 3.6
    const governor = this.gear > 0 ? Math.min(1, Math.max(0, (topSpeed - speed) / 0.6)) : 1
    const throttle = Math.min(1, Math.max(0, input.throttle)) * governor
    const ratio = this.ratio(this.gear)
    const direction = this.gear > 0 ? 1 : this.gear < 0 ? -1 : 0
    const along = speed * direction
    const lockedRpm = (Math.max(0, along) / this.wheelRadius) * ratio / RPM_TO_RAD
    const shifting = this.shiftTimer > 0
    const locked = !shifting && direction !== 0 && along > -0.2 && lockedRpm >= idleRpm + 30
    let force = 0
    let power = 0
    if (shifting || direction === 0) {
      const target = shifting ? Math.max(idleRpm, (Math.max(0, along) / this.wheelRadius) * this.ratio(this.targetGear) / RPM_TO_RAD) : idleRpm + throttle * (maxRpm - idleRpm) * 0.7
      this.rpm += Math.max(-3000 * dt, Math.min(3000 * dt, target - this.rpm))
      this.load = shifting ? 0 : throttle * 0.3
    } else if (locked) {
      this.rpm = lockedRpm
      const reflected = (ENGINE_INERTIA * ratio * ratio * DRIVELINE_EFFICIENCY) / (this.wheelRadius * this.wheelRadius)
      const inertia = input.massKg / (input.massKg + reflected)
      if (throttle > 0.01) {
        const torque = this.torqueAt(this.rpm) * throttle
        force = (direction * torque * ratio * DRIVELINE_EFFICIENCY * inertia) / this.wheelRadius
        power = torque * this.rpm * RPM_TO_RAD
        this.load = torque / this.peakTorque
      } else {
        const jake = input.engineBrake && this.rpm > 800
        const drag = this.dragAt(this.rpm, jake)
        force = (-direction * drag * ratio * inertia) / this.wheelRadius
        this.retarding = jake
        this.load = 0
      }
    } else {
      const target = idleRpm + throttle * (LAUNCH_RPM - idleRpm)
      this.rpm += Math.max(-4000 * dt, Math.min(4000 * dt, target - this.rpm))
      if (throttle > 0.01) {
        const torque = this.torqueAt(this.rpm) * throttle
        force = (direction * torque * ratio * DRIVELINE_EFFICIENCY) / this.wheelRadius
        power = torque * this.rpm * RPM_TO_RAD
        this.load = torque / this.peakTorque
      } else {
        this.load = 0
      }
    }
    this.autoShift(input, throttle, locked)
    const burn = (IDLE_FUEL_LPH / 3600 + power * LITRES_PER_JOULE * (this.model.fuelLPer100Km / 38)) * dt
    const used = Math.min(this.fuelL, burn)
    this.fuelL -= used
    this.fuelUsedL += used
    this.force = force
    return force
  }
}
