/** Diamond geometry: bases, mound, fielder depths, fair and foul territory and each park's fence by spray angle. */
import type { FieldPosition, Park, Vec3 } from './types'

export const BASE_PATH = 27.432
export const MOUND_DISTANCE = 18.44
export const PLATE_FRONT = 0.43
export const PLATE_HALF_WIDTH = 0.2159
export const BALL_RADIUS = 0.0366
const DIAG = BASE_PATH * Math.SQRT1_2

export const DEG = Math.PI / 180

/** Bases indexed 0 = home, 1 = first, 2 = second, 3 = third. */
export const BASES: readonly Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: DIAG, y: 0, z: DIAG },
  { x: 0, y: 0, z: 2 * DIAG },
  { x: -DIAG, y: 0, z: DIAG },
]

export const MOUND: Vec3 = { x: 0, y: 0, z: MOUND_DISTANCE }

export function polar(distance: number, sprayDegrees: number): Vec3 {
  return { x: distance * Math.sin(sprayDegrees * DEG), y: 0, z: distance * Math.cos(sprayDegrees * DEG) }
}

export const FIELDER_HOME: Readonly<Record<FieldPosition, Vec3>> = {
  P: { x: 0, y: 0, z: MOUND_DISTANCE + 0.6 },
  C: { x: 0, y: 0, z: -1.1 },
  '1B': polar(33, 37),
  '2B': polar(45, 15),
  SS: polar(45, -14),
  '3B': polar(34, -36),
  LF: polar(86, -27),
  CF: polar(96, 0),
  RF: polar(86, 27),
}

export function sprayAngle(point: { x: number; z: number }): number {
  return Math.atan2(point.x, point.z) / DEG
}

export function horizontalDistance(point: { x: number; z: number }): number {
  return Math.hypot(point.x, point.z)
}

/** Inside the foul lines (the foul pole counts as fair): within 45° of center field, i.e. z ≥ |x|, widened by the pole radius. */
export function isFairAngle(point: { x: number; z: number }, poleRadius = 0.1): boolean {
  return point.z > -0.01 && point.z >= Math.abs(point.x) - poleRadius * Math.SQRT2
}

/** Beyond the bags: past first or third base along the nearer foul line, where the first landing spot decides fair or foul. */
export function isBeyondBags(point: { x: number; z: number }): boolean {
  return (Math.abs(point.x) + point.z) * Math.SQRT1_2 > BASE_PATH
}

function lerpTable(table: readonly number[], spray: number): number {
  const clamped = Math.max(-45, Math.min(45, spray))
  const position = ((clamped + 45) / 90) * (table.length - 1)
  const index = Math.min(table.length - 2, Math.floor(position))
  const t = position - index
  return table[index] * (1 - t) + table[index + 1] * t
}

export function fenceDistance(park: Park, spray: number): number {
  return lerpTable(park.fence, spray)
}

export function fenceHeight(park: Park, spray: number): number {
  return lerpTable(park.height, spray)
}

/** Foul ground boundary: the stands sit `foulSide` metres off each line and `backstop` metres behind the plate. */
export function inFoulPlayable(park: Park, point: { x: number; z: number }): boolean {
  if (point.z < -park.backstop) return false
  const lineDistance = Math.abs(point.x * Math.SQRT1_2 * Math.sign(point.x) - point.z * Math.SQRT1_2)
  const along = (Math.abs(point.x) + point.z) * Math.SQRT1_2
  return lineDistance <= park.foulSide && along <= fenceDistance(park, point.x >= 0 ? 45 : -45) + 2
}

export function strikeZone(height: number): { bottom: number; top: number } {
  return { bottom: height * 0.27, top: height * 0.56 }
}

export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function distance2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}
