import { CAR_BRAND_PATTERN, CAR_LIMITS, STOCK_CAR, STOCK_LENGTH, carGarage } from '../../../../modules-src/shorttrack/shared/CustomCars'
import type { CarAxle, CarGarage, CarNumbers, CarPaint, CustomCarRecord, CustomCarSpec, Point3 } from '../../../../modules-src/shorttrack/shared/CustomCars'
import { turnedCenter, turnedSize } from '../../maplestreet/vehicle/draft'
import type { Size3 } from '../../maplestreet/vehicle/draft'

export { turnedSize }
export type { Size3 }
export type Center = { x: number; z: number; minY: number }
export type CarMarker = 'front' | 'rear' | 'door' | 'roof' | 'tail' | 'light'

export type CarDraft = {
  name: string
  blurb: string
  /** Model placement: uniform scale, nose rotation in quarter turns, shift along the length, and lift off the road. */
  scale: number
  yaw: number
  shiftX: number
  lift: number
  axles: [CarAxle, CarAxle]
  removeWheels: boolean
  paint: CarPaint
  /** What drivers may change on this car in the Garage (the main colour always). */
  garage: CarGarage
  numbers: CarNumbers
  tail: Point3 | null
  maxTriangles: number
  maxTexture: number
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

/** Fresh draft fitted to a model of raw size `raw`: stretched to the stock car's length with its wheels, numbers and lights scaled to match. */
export function newCarDraft(raw: Size3 | null, previous?: Partial<CarDraft>): CarDraft {
  const yaw = previous?.yaw ?? 0
  const size = raw ? turnedSize(raw, yaw) : null
  const scale = previous?.scale ?? (size?.x ? r3(STOCK_LENGTH / size.x) : 1)
  const length = size ? size.x * scale : STOCK_LENGTH
  const width = size ? size.z * scale : STOCK_CAR.width
  const height = size ? size.y * scale : STOCK_CAR.height
  const k = length / STOCK_LENGTH, kh = height / STOCK_CAR.height
  const axle = (a: CarAxle): CarAxle => ({ x: r3(a.x * k), radius: a.radius, width: a.width, halfTrack: r3(Math.min(width / 2 - a.width / 2, a.halfTrack * (width / STOCK_CAR.width))) })
  const n = STOCK_CAR.numbers
  return {
    name: previous?.name ?? '',
    blurb: previous?.blurb ?? '',
    scale,
    yaw,
    shiftX: previous?.shiftX ?? 0,
    lift: previous?.lift ?? 0,
    axles: [axle(STOCK_CAR.axles[0]), axle(STOCK_CAR.axles[1])],
    removeWheels: previous?.removeWheels ?? true,
    paint: previous?.paint ?? { mode: 'body', material: '', key: '#ffffff', tolerance: 0.18, color: '#d7263d' },
    garage: carGarage({ garage: previous?.garage }),
    numbers: {
      door: { x: r3(n.door!.x * k), y: r3(n.door!.y * kh), h: n.door!.h },
      roof: { x: r3(n.roof!.x * k), h: n.roof!.h },
      tail: { y: r3(n.tail!.y * kh), h: n.tail!.h },
    },
    tail: { x: r3(-length / 2 + 0.04), y: r3(STOCK_CAR.tail.y * kh), z: r3(Math.min(width / 2 - 0.1, STOCK_CAR.tail.z * (width / STOCK_CAR.width))) },
    maxTriangles: previous?.maxTriangles ?? 60000,
    maxTexture: previous?.maxTexture ?? 2048,
  }
}

/** The model-to-car placement: the lowest point of the model sits on the road (plus lift), centred across and along. */
export function placement(d: Pick<CarDraft, 'scale' | 'yaw' | 'shiftX' | 'lift'>, center: Center): CustomCarSpec['model'] {
  const turned = turnedCenter(center, d.yaw)
  return { scale: d.scale, yaw: d.yaw * 90, x: r3(-turned.x * d.scale + d.shiftX), y: r3(d.lift - center.minY * d.scale), z: r3(-turned.z * d.scale) }
}

export function carSpec(d: CarDraft, center: Center): CustomCarSpec {
  return {
    blurb: d.blurb.trim(),
    model: placement(d, center),
    axles: [{ ...d.axles[0] }, { ...d.axles[1] }],
    wheelsRemoved: d.removeWheels,
    paint: d.paint,
    garage: { ...d.garage },
    numbers: d.numbers,
    lights: { tail: d.tail },
  }
}

/** The draft that would save as this record again, once its model's bounds are known (the inverse of `carSpec`). */
export function draftFromCar(v: CustomCarRecord, center: Center): CarDraft {
  const yaw = ((Math.round(v.model.yaw / 90) % 4) + 4) % 4
  const turned = turnedCenter(center, yaw)
  return {
    name: v.name,
    blurb: v.blurb,
    scale: v.model.scale,
    yaw,
    shiftX: r3(v.model.x + turned.x * v.model.scale),
    lift: r3(v.model.y + center.minY * v.model.scale),
    axles: [{ ...v.axles[0] }, { ...v.axles[1] }],
    removeWheels: v.wheelsRemoved,
    paint: { ...v.paint, mode: v.paint.mode === 'none' ? 'body' : v.paint.mode },
    garage: carGarage(v),
    numbers: { door: v.numbers.door && { ...v.numbers.door }, roof: v.numbers.roof && { ...v.numbers.roof }, tail: v.numbers.tail && { ...v.numbers.tail } },
    tail: v.lights.tail && { ...v.lights.tail },
    maxTriangles: 60000,
    maxTexture: 2048,
  }
}

/** Problems that block saving (first) and softer notes about how far the car is from the stock car. */
export function carProblems(d: CarDraft, length: number, width: number) {
  const blocking: string[] = [], notes: string[] = []
  if (length < CAR_LIMITS.lengthMin || length > CAR_LIMITS.lengthMax) blocking.push(`At ${length.toFixed(2)} m long the car can’t race; keep it between ${CAR_LIMITS.lengthMin} and ${CAR_LIMITS.lengthMax} m.`)
  if (d.axles[0].x <= d.axles[1].x + 1) blocking.push('The front axle must sit at least a metre ahead of the rear axle.')
  if (CAR_BRAND_PATTERN.test(d.name) || CAR_BRAND_PATTERN.test(d.blurb)) blocking.push('Leave real makes, models and racing series out of the name and description.')
  if (Math.abs(length / STOCK_LENGTH - 1) > 0.15) notes.push(`It races with the stock car’s ${STOCK_LENGTH.toFixed(2)} m footprint, so at ${length.toFixed(2)} m it will ${length > STOCK_LENGTH ? 'overlap other cars before touching' : 'touch other cars before the bodies meet'}.`)
  if (width > STOCK_CAR.width * 1.15) notes.push(`At ${width.toFixed(2)} m wide it is much wider than the stock car (${STOCK_CAR.width} m).`)
  return { blocking, notes }
}

export const fmtLen = (m: number) => `${m.toFixed(2)} m · ${(m * 3.28084).toFixed(1)} ft`
