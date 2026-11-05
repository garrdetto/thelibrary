import { DRIVE_TEMPLATES, VEHICLE_LIMITS, BRAND_PATTERN } from '../../../../modules-src/maplestreet/shared/CustomVehicles'
import type { CustomVehicleRecord, CustomVehicleSpec, DriveTemplate, Point3, TrafficRoute, VehicleParts, PartBox } from '../../../../modules-src/maplestreet/shared/CustomVehicles'
import type { LampShapes } from '../../../../modules-src/maplestreet/shared/Shapes'
import { ECONOMY_TEMPLATES } from './templates'
import { accelTargetMph, MPH_TO_MS, predictDrive, solveDrive } from '../../../../modules-src/maplestreet/shared/VehicleDrive'
import { BODY_EXTENTS, BUILTIN_TUNING, rideHeight } from '../../../../modules-src/maplestreet/shared/Vehicles'
import type { BuiltinVehicleKind, VehicleTuning } from '../../../../modules-src/maplestreet/shared/Vehicles'

export { DRIVE_TEMPLATES }
export type { DriveTemplate, TrafficRoute }

export type Size3 = { x: number; y: number; z: number }
export type ReferenceKind = Exclude<BuiltinVehicleKind, 'trailer'>
export const REFERENCE_KINDS = Object.keys(BODY_EXTENTS) as ReferenceKind[]

export const TEMPLATE_LABEL: Record<DriveTemplate, string> = { sedan: 'Sedan', truck: 'Pickup', coupe: 'Muscle coupe', hdtruck: 'Heavy-duty crew cab', golfcart: 'Golf cart', atv: 'Four-wheeler' }
export const REFERENCE_LABEL: Record<ReferenceKind, string> = { truck: 'Pickup', sedan: 'Sedan', coupe: 'Muscle coupe', hdtruck: 'Heavy-duty crew cab', golfcart: 'Golf cart', atv: 'Four-wheeler', mower: 'Riding mower', zeroturn: 'Zero-turn mower' }
export const ROUTE_LABEL: Record<TrafficRoute, string> = { ringA: 'Main Street loop (south ring)', ringB: 'North ring', downtown: 'Downtown loop' }

/** Real top speed and acceleration of each template, from the same model the physics follows. */
export function templatePerformance(template: DriveTemplate) {
  const t = BUILTIN_TUNING[template]
  const top = predictDrive(t, 0).topMph
  const to = accelTargetMph(top)
  return { topSpeedMph: Math.round(top), zeroToMph: to, zeroToSeconds: Math.round((predictDrive(t, to).time ?? 10) * 10) / 10 }
}

export type MarkerId = 'front' | 'rear' | 'seat' | 'head' | 'tail' | 'hitch'

export type Draft = {
  name: string
  template: DriveTemplate
  /** Model placement: uniform scale, nose rotation in quarter turns, shift along the length, and lift off the road. */
  scale: number
  yaw: number
  shiftX: number
  lift: number
  axles: { x: number; radius: number; width: number; halfTrack: number; steer: boolean; drive: boolean }[]
  seat: Point3
  head: Point3
  tail: Point3
  hitch: { x: number; y: number } | null
  mass: number
  frictionSlip: number
  maxSteerDeg: number
  stiffness: number
  topSpeedMph: number
  zeroToSeconds: number
  paint: CustomVehicleSpec['paint']
  dealer: CustomVehicleSpec['dealer']
  traffic: CustomVehicleSpec['traffic']
  removeWheels: boolean
  /** Opening doors (right side, mirrored), hood and trunk, as boxes in chassis space. */
  parts: VehicleParts
  /** Custom headlight and taillight outlines (mirrored to both sides). */
  lampShapes: LampShapes
  maxTriangles: number
  maxTexture: number
}

const r2 = (v: number) => Math.round(v * 1000) / 1000

/** Raw model bounds turned by the nose rotation (quarter turns about Y). */
export function turnedSize(raw: Size3, yaw: number): Size3 {
  return yaw % 2 === 1 ? { x: raw.z, y: raw.y, z: raw.x } : raw
}

/** Scale ratio of a draft against its template, used to size suspension and body defaults. */
function templateRatio(template: DriveTemplate, length: number) {
  const ext = BODY_EXTENTS[template]
  return length / (ext.front - ext.rear)
}

export function suspensionFor(d: Draft, length: number) {
  const base = BUILTIN_TUNING[d.template]
  const k = Math.min(2, Math.max(0.4, templateRatio(d.template, length)))
  return { wheelY: r2(base.wheelY * k), rest: r2(base.suspension.rest * k), travel: r2(base.suspension.travel * k), k }
}

/** Chassis-frame tuning for the draft (no engine solve), so ride height and placement agree with the game. */
export function draftTuning(d: Draft, length: number, width: number, height: number): VehicleTuning {
  const base = BUILTIN_TUNING[d.template]
  const s = suspensionFor(d, length)
  return {
    ...base,
    kind: 'custom:draft',
    label: d.name,
    chassis: { hx: r2(length / 2), hy: r2(Math.min(height * 0.3, base.chassis.hy * s.k)), hz: r2(width / 2) },
    mass: d.mass,
    comY: r2(base.comY * s.k),
    axles: d.axles.map(a => ({ ...a })),
    wheelY: s.wheelY,
    suspension: { ...base.suspension, rest: s.rest, travel: s.travel, stiffness: d.stiffness },
    frictionSlip: d.frictionSlip,
    maxSteer: (d.maxSteerDeg * Math.PI) / 180,
  }
}

export function draftRideHeight(d: Draft, length: number) {
  const s = suspensionFor(d, length)
  return d.axles[0].radius - (s.wheelY - s.rest * 0.8)
}

/** Fresh draft for a template, fitted to a model of `size` (turned, unscaled) at `scale`. */
export function newDraft(template: DriveTemplate, raw: Size3 | null, previous?: Partial<Draft>): Draft {
  const base = BUILTIN_TUNING[template]
  const ext = BODY_EXTENTS[template]
  const refLength = ext.front - ext.rear
  const yaw = previous?.yaw ?? 0
  const size = raw ? turnedSize(raw, yaw) : null
  const scale = previous?.scale ?? (size?.x ? r2(refLength / size.x) : 1)
  const length = size ? size.x * scale : refLength
  const width = size ? size.z * scale : ext.width
  const k = length / refLength
  const perf = templatePerformance(template)
  const economy = ECONOMY_TEMPLATES[template]
  return {
    name: previous?.name ?? '',
    template,
    scale,
    yaw,
    shiftX: previous?.shiftX ?? 0,
    lift: previous?.lift ?? 0,
    axles: base.axles.map(a => ({ x: r2(a.x * k), radius: r2(a.radius * Math.min(1.5, Math.max(0.6, k))), width: a.width, halfTrack: r2(Math.min(width / 2 - a.width / 2, a.halfTrack * (width / ext.width))), steer: a.steer, drive: a.drive })),
    seat: { x: r2(base.seat.x * k), y: r2(base.seat.y * k), z: r2(base.seat.z * (width / ext.width)) },
    head: { x: r2(length / 2 - 0.08), y: r2(0.15 * k), z: r2(width * 0.34) },
    tail: { x: r2(-length / 2 + 0.06), y: r2(0.25 * k), z: r2(width * 0.36) },
    hitch: base.hitch ? { x: r2(-length / 2 - 0.15), y: r2(base.hitch.y * k) } : null,
    mass: Math.round(base.mass * Math.max(0.3, k * k * (width / ext.width))),
    frictionSlip: base.frictionSlip,
    maxSteerDeg: Math.round((base.maxSteer * 180) / Math.PI),
    stiffness: base.suspension.stiffness,
    topSpeedMph: perf.topSpeedMph,
    zeroToSeconds: perf.zeroToSeconds,
    paint: previous?.paint ?? { mode: 'none', material: '', key: '#ffffff', tolerance: 0.18, color: `#${base.paint.toString(16).padStart(6, '0')}` },
    dealer: previous?.dealer ?? { forSale: true, price: economy.price, fuel: economy.fuel, tank: economy.tank, mpg: economy.mpg },
    traffic: previous?.traffic ?? { enabled: false, driver: '', route: 'ringA', mph: template === 'golfcart' ? 13 : 24 },
    removeWheels: previous?.removeWheels ?? true,
    parts: previous?.parts ?? { doors: [], hood: null, trunk: null },
    lampShapes: previous?.lampShapes ?? {},
    maxTriangles: previous?.maxTriangles ?? 120000,
    maxTexture: previous?.maxTexture ?? 2048,
  }
}

/** Typical length and wheel size for a class, ±25% / ±30%. */
export function sizeWarnings(d: Draft, length: number) {
  const ext = BODY_EXTENTS[d.template]
  const base = BUILTIN_TUNING[d.template]
  const refLength = ext.front - ext.rear
  const refWheel = Math.max(...base.axles.map(a => a.radius * 2))
  const wheel = Math.max(...d.axles.map(a => a.radius * 2))
  const out: string[] = []
  if (length < refLength * 0.75 || length > refLength * 1.25) out.push(`At ${length.toFixed(2)} m long, this is well outside the ${refLength.toFixed(1)} m of a typical ${TEMPLATE_LABEL[d.template].toLowerCase()}.`)
  if (wheel < refWheel * 0.7 || wheel > refWheel * 1.3) out.push(`Wheels of ${wheel.toFixed(2)} m are far from the ${refWheel.toFixed(2)} m on a typical ${TEMPLATE_LABEL[d.template].toLowerCase()}.`)
  if (d.axles[0].x - d.axles[1].x > length * 0.9) out.push('The axles sit beyond the ends of the body.')
  if (BRAND_PATTERN.test(d.name) || BRAND_PATTERN.test(d.traffic.driver)) out.push('Leave real manufacturer and model names out: vehicles are original designs.')
  return out
}

export function solvedEngine(d: Draft) {
  const top = d.topSpeedMph
  const to = accelTargetMph(top)
  const engine = solveDrive({ mass: d.mass, axles: d.axles }, { topSpeedMph: top, zeroToMph: to, zeroToSeconds: d.zeroToSeconds })
  return { ...engine, zeroToMph: to }
}

/** The publishable spec for a draft whose turned, scaled model size is `size`. */
export function draftSpec(d: Draft, raw: Size3, center: { x: number; z: number; minY: number }): CustomVehicleSpec {
  const size = turnedSize(raw, d.yaw)
  const length = size.x * d.scale, width = size.z * d.scale, height = size.y * d.scale
  const t = draftTuning(d, length, width, height)
  const ride = rideHeight(t)
  const engine = solvedEngine(d)
  const turned = turnedCenter(center, d.yaw)
  const base = BUILTIN_TUNING[d.template]
  return {
    template: d.template,
    model: {
      scale: d.scale,
      yaw: d.yaw * 90,
      x: r2(-turned.x * d.scale + d.shiftX),
      y: r2(-ride + d.lift - center.minY * d.scale),
      z: r2(-turned.z * d.scale),
    },
    physics: {
      chassis: t.chassis,
      mass: d.mass,
      comY: t.comY,
      axles: d.axles.map(a => ({ ...a })),
      wheelY: t.wheelY,
      suspension: t.suspension,
      frictionSlip: d.frictionSlip,
      sideStiffness: base.sideStiffness,
      engineForce: engine.engineForce,
      topSpeed: engine.topSpeed,
      brake: Math.round(base.brake * (d.mass / base.mass) * 10) / 10,
      maxSteer: t.maxSteer,
      seat: { ...d.seat, ...(base.seat.straddle ? { straddle: true } : {}) },
      hitch: d.hitch,
      cam: { dist: r2(Math.max(4, base.cam.dist * (length / (BODY_EXTENTS[d.template].front - BODY_EXTENTS[d.template].rear)))), height: r2(Math.max(1.6, base.cam.height * (height / BODY_EXTENTS[d.template].height))) },
    },
    lights: { head: [d.head], tail: [d.tail] },
    paint: d.paint,
    targets: { topSpeedMph: d.topSpeedMph, zeroToMph: engine.zeroToMph, zeroToSeconds: d.zeroToSeconds },
    dealer: d.dealer,
    traffic: { ...d.traffic, driver: d.traffic.driver.trim() || d.name.trim() },
    wheelsRemoved: d.removeWheels,
    ...(d.parts.doors.length || d.parts.hood || d.parts.trunk ? { parts: d.parts } : {}),
    ...(d.lampShapes.head || d.lampShapes.tail ? { lampShapes: d.lampShapes } : {}),
  }
}

/** The editor draft that would publish as this record again, once its model's raw bounds are known (the inverse of `draftSpec`). */
export function draftFromRecord(v: CustomVehicleRecord, raw: Size3, center: { x: number; z: number; minY: number }): Draft {
  const yaw = ((Math.round(v.model.yaw / 90) % 4) + 4) % 4
  const scale = v.model.scale
  const turned = turnedCenter(center, yaw)
  const length = turnedSize(raw, yaw).x * scale
  const draft: Draft = {
    name: v.name,
    template: v.template,
    scale,
    yaw,
    shiftX: r2(v.model.x + turned.x * scale),
    lift: 0,
    axles: v.physics.axles.map(a => ({ x: a.x, radius: a.radius, width: a.width, halfTrack: a.halfTrack, steer: a.steer, drive: a.drive })),
    seat: { x: v.physics.seat.x, y: v.physics.seat.y, z: v.physics.seat.z },
    head: v.lights.head[0] ?? { x: r2(length / 2 - 0.08), y: 0.15, z: 0.6 },
    tail: v.lights.tail[0] ?? { x: r2(-length / 2 + 0.06), y: 0.25, z: 0.6 },
    hitch: v.physics.hitch ? { ...v.physics.hitch } : null,
    mass: v.physics.mass,
    frictionSlip: v.physics.frictionSlip,
    maxSteerDeg: Math.round((v.physics.maxSteer * 180) / Math.PI),
    stiffness: v.physics.suspension.stiffness,
    topSpeedMph: v.targets.topSpeedMph,
    zeroToSeconds: v.targets.zeroToSeconds,
    paint: { ...v.paint },
    dealer: { ...v.dealer },
    traffic: { ...v.traffic },
    removeWheels: v.wheelsRemoved,
    parts: v.parts ? { doors: v.parts.doors.map(d => ({ ...d })), hood: v.parts.hood ? { ...v.parts.hood } : null, trunk: v.parts.trunk ? { ...v.parts.trunk } : null } : { doors: [], hood: null, trunk: null },
    lampShapes: { ...(v.lampShapes ?? {}) },
    maxTriangles: 120000,
    maxTexture: 2048,
  }
  draft.lift = r2(v.model.y + draftRideHeight(draft, length) + center.minY * scale)
  return draft
}

/** Center of the raw bounds after the quarter-turn yaw (three.js Y rotation). */
export function turnedCenter(c: { x: number; z: number }, yaw: number) {
  const a = (yaw * Math.PI) / 2, cos = Math.round(Math.cos(a)), sin = Math.round(Math.sin(a))
  return { x: c.x * cos + c.z * sin, z: -c.x * sin + c.z * cos }
}

/** A record the in-game test drive can install as-is. */
export function draftRecord(spec: CustomVehicleSpec, name: string, modelUrl: string, wheelUrl: string | null): CustomVehicleRecord {
  return { ...spec, id: 'draft-0000-test-drive', name: name.trim() || 'Draft vehicle', modelUrl, wheelUrl, active: true, updatedAt: Date.now() }
}

export const LIMITS = VEHICLE_LIMITS
export const mph = (ms: number) => ms / MPH_TO_MS
export const feet = (m: number) => m * 3.28084
export const fmtLen = (m: number) => `${m.toFixed(2)} m · ${feet(m).toFixed(1)} ft`

export type PartKey = 'frontDoor' | 'rearDoor' | 'hood' | 'trunk'
export const PART_LABEL: Record<PartKey, string> = { frontDoor: 'Front doors', rearDoor: 'Rear doors', hood: 'Hood', trunk: 'Trunk / tailgate' }

/** A starting box for a part, from the body's size (y is chassis space: the road is at −ride). */
export function defaultPart(key: PartKey, length: number, height: number, ride: number): PartBox {
  const r2 = (v: number) => Math.round(v * 1000) / 1000
  const y = (f: number) => r2(-ride + height * f)
  switch (key) {
    case 'frontDoor': return { front: r2(length * 0.17), back: r2(-length * 0.05), bottom: y(0.28), top: y(0.88) }
    case 'rearDoor': return { front: r2(-length * 0.07), back: r2(-length * 0.26), bottom: y(0.28), top: y(0.86) }
    case 'hood': return { front: r2(length * 0.5), back: r2(length * 0.2), bottom: y(0.5), top: y(0.75) }
    case 'trunk': return { front: r2(-length * 0.3), back: r2(-length * 0.5), bottom: y(0.45), top: y(0.75) }
  }
}

export const partOf = (parts: VehicleParts, key: PartKey): PartBox | null =>
  key === 'frontDoor' ? parts.doors[0] ?? null : key === 'rearDoor' ? parts.doors[1] ?? null : parts[key]

/** Sets or clears one part; a rear door needs a front door. */
export function withPart(parts: VehicleParts, key: PartKey, box: PartBox | null): VehicleParts {
  if (key === 'hood' || key === 'trunk') return { ...parts, [key]: box }
  const front = key === 'frontDoor' ? box : parts.doors[0] ?? null
  const rear = key === 'rearDoor' ? box : parts.doors[1] ?? null
  return { ...parts, doors: front ? (rear ? [front, rear] : [front]) : [] }
}
