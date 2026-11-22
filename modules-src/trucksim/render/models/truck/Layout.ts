/**
 * Derives every visual dimension of a truck from its catalog numbers: where the bumper, grille, cab, sleeper, steps, tanks,
 * deck and dump bed sit along the frame, the cab's floor, beltline and roof heights, its width, windshield rake and side
 * tumblehome, the hood's shape and the frame height. All values are in the vehicle frame (metres, origin on the ground under
 * the front axle, +Z forward, +X the driver's left), so part builders never re-derive proportions on their own.
 */

import type { AxleSpec, TruckModel, TruckStyle } from '../../../shared/Catalog'
import { FIFTH_WHEEL_HEIGHT } from '../../../shared/Catalog'

/** Front-end family: the hood, grille, fender and headlight treatment. */
export type FrontKind = 'classic' | 'square' | 'aero' | 'sloped' | 'cabover'

/** Dump body placement (vehicle frame). */
export interface BedLayout {
  frontZ: number
  rearZ: number
  hingeZ: number
  hingeY: number
  floorY: number
  topY: number
  halfWidth: number
  sideHeight: number
  maxAngle: number
  /** Front-mount telescopic hoist between cab and bed, or a cylinder under the bed. */
  hoist: 'front' | 'under'
  canopyY: number
  canopyFrontZ: number
}

/** Everything the part builders need. */
export interface TruckLayout {
  model: TruckModel
  style: TruckStyle
  front: FrontKind
  name: string
  bumperZ: number
  noseZ: number
  cabFrontZ: number
  cabBackZ: number
  sleeperBackZ: number
  doorFrontZ: number
  doorBackZ: number
  cabFloorY: number
  beltY: number
  roofY: number
  sleeperTopY: number
  lowerBand: number
  hw: number
  tumble: number
  rake: number
  hoodHalfWidth: number
  hoodTopRear: number
  hoodTopFront: number
  hoodBottom: number
  fenderX: number
  wheelR: number
  archR: number
  track: number
  frameTop: number
  railH: number
  railX: number
  frameFrontZ: number
  frameRearZ: number
  rearAxles: AxleSpec[]
  firstRearZ: number
  lastRearZ: number
  stepsFrontZ: number
  stepsBackZ: number
  stepTopY: number
  tankR: number
  tankY: number
  tankLength: number
  tankCount: number
  tankFrontZ: number
  fifthWheelZ: number | null
  bed: BedLayout | null
  semi: boolean
  sleeper: boolean
  raised: boolean
}

/** Bottom of the square hoods (m). */
export const HOOD_BOTTOM = 1.06
/** Height of the square hoods' two-tone band, matched by the cab's lower band (m). */
export const HOOD_BAND = 0.32

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Works out the visual layout of a catalog truck. */
export function truckLayout(model: TruckModel): TruckLayout {
  const style = model.style
  const R = model.wheelRadius
  const archR = R + 0.11
  const front: FrontKind = style === 'cabover' ? 'cabover' : style === 'aero' ? 'aero' : style === 'longnose' ? 'classic'
    : model.frontZ > 2 ? 'sloped' : model.brand === 'Bedrock' ? 'classic' : 'square'
  const rearAxles = model.axles.filter((axle) => !axle.steer)
  const firstRearZ = Math.max(...rearAxles.map((axle) => axle.z))
  const lastRearZ = Math.min(...rearAxles.map((axle) => axle.z))
  const semi = model.fifthWheelZ !== undefined
  const sleeper = model.sleeperLength > 0
  const raised = model.cab === 'raised'

  let noseZ: number
  let cabFrontZ: number
  let cabBackZ: number
  let cabFloorY: number
  let beltY: number
  let hw: number
  let tumble: number
  let rake: number
  let lowerBand = 0.24
  if (style === 'cabover') {
    noseZ = model.frontZ - 0.26
    cabFrontZ = noseZ
    cabBackZ = cabFrontZ - (2.05 + model.sleeperLength)
    cabFloorY = 1.22
    beltY = 2.02
    hw = 1.2
    tumble = 0.05
    rake = 0.12
    lowerBand = 0.3
  } else if (style === 'aero') {
    noseZ = model.frontZ - 0.3
    cabFrontZ = noseZ - model.hoodLength
    cabBackZ = cabFrontZ - 1.9
    cabFloorY = 0.98
    beltY = 2.04
    hw = 1.17
    tumble = 0.13
    rake = 0.62
  } else if (style === 'longnose') {
    noseZ = model.frontZ - 0.36
    cabFrontZ = noseZ - model.hoodLength
    cabBackZ = cabFrontZ - 1.85
    cabFloorY = 1.02
    beltY = 2.12
    hw = 1.12
    tumble = 0.07
    rake = 0.32
  } else {
    const dump = model.dump
    noseZ = model.frontZ - 0.32
    cabFrontZ = noseZ - model.hoodLength
    const limit = dump ? cabFrontZ - (dump.bedFrontZ + 0.1) : 1.75
    cabBackZ = cabFrontZ - clamp(limit, 1.3, 1.75)
    cabFloorY = 1.05
    beltY = 2.12
    hw = 1.12
    tumble = 0.07
    rake = front === 'sloped' ? 0.4 : 0.28
  }
  if (style !== 'cabover' && cabFrontZ > -(R + 0.02)) cabFloorY = Math.max(cabFloorY, 2 * R + 0.1)
  if (front === 'classic' || front === 'square') lowerBand = HOOD_BOTTOM + HOOD_BAND - cabFloorY
  const roofY = model.cabHeight
  const sleeperTopY = style === 'cabover' ? roofY : raised ? model.roofHeight : roofY + 0.04
  const sleeperBackZ = style === 'cabover' ? cabBackZ : cabBackZ - model.sleeperLength
  const doorFrontZ = cabFrontZ - (style === 'cabover' ? 0.16 : 0.1)
  const doorBackZ = style === 'cabover' ? cabFrontZ - 1.12 : sleeper ? cabBackZ + 0.08 : cabBackZ + 0.34

  const frameTop = model.dump ? model.dump.bedFloorY - 0.3 : FIFTH_WHEEL_HEIGHT - 0.2
  const railH = 0.27
  const frameFrontZ = style === 'cabover' ? model.frontZ - 0.3 : noseZ - 0.04
  const frameRearZ = model.rearZ + 0.03

  let stepsFrontZ: number
  let stepsBackZ: number
  let tankFrontZ: number
  if (style === 'cabover') {
    stepsFrontZ = noseZ - 0.06
    stepsBackZ = archR + 0.04
    tankFrontZ = -archR - 0.1
  } else {
    stepsFrontZ = Math.min(cabFrontZ - 0.05, -archR - 0.04)
    stepsBackZ = stepsFrontZ - 0.4
    tankFrontZ = stepsBackZ - 0.05
  }
  const tankR = 0.31
  const tankCount = semi ? 2 : 1
  const volume = model.fuelTankL / 1000 / tankCount
  const room = tankFrontZ - (firstRearZ + R + 0.2)
  const tankLength = clamp(Math.min(volume / (Math.PI * tankR * tankR), room), 0.6, 1.6)

  let bed: BedLayout | null = null
  if (model.dump) {
    const d = model.dump
    const gap = cabBackZ - d.bedFrontZ
    bed = {
      frontZ: d.bedFrontZ,
      rearZ: d.bedRearZ,
      hingeZ: d.hingeZ,
      hingeY: frameTop + 0.06,
      floorY: d.bedFloorY,
      topY: d.bedFloorY + d.sideHeight,
      halfWidth: Math.min(1.22, model.width / 2 - 0.04),
      sideHeight: d.sideHeight,
      maxAngle: (d.maxAngleDeg * Math.PI) / 180,
      hoist: gap > 0.55 ? 'front' : 'under',
      canopyY: roofY + 0.09,
      canopyFrontZ: cabBackZ + 0.5,
    }
  }

  return {
    model,
    style,
    front,
    name: model.id,
    bumperZ: model.frontZ,
    noseZ,
    cabFrontZ,
    cabBackZ,
    sleeperBackZ,
    doorFrontZ,
    doorBackZ,
    cabFloorY,
    beltY,
    roofY,
    sleeperTopY,
    lowerBand,
    hw,
    tumble,
    rake,
    hoodHalfWidth: front === 'classic' ? 0.6 : 0.66,
    hoodTopRear: front === 'classic' ? 2.04 : front === 'square' ? 1.94 : front === 'sloped' ? 1.98 : 1.92,
    hoodTopFront: front === 'classic' ? 1.97 : front === 'square' ? 1.88 : front === 'sloped' ? 1.56 : 1.36,
    hoodBottom: HOOD_BOTTOM,
    fenderX: Math.min(1.25, model.width / 2 - 0.02),
    wheelR: R,
    archR,
    track: model.track,
    frameTop,
    railH,
    railX: 0.43,
    frameFrontZ,
    frameRearZ,
    rearAxles,
    firstRearZ,
    lastRearZ,
    stepsFrontZ,
    stepsBackZ,
    stepTopY: cabFloorY,
    tankR,
    tankY: Math.min(Math.max(tankR + 0.36, frameTop - railH + 0.02), cabFloorY - tankR - 0.03),
    tankLength,
    tankCount,
    tankFrontZ,
    fifthWheelZ: model.fifthWheelZ ?? null,
    bed,
    semi,
    sleeper,
    raised,
  }
}
