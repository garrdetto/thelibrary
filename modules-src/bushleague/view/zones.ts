/** Which surface is under a sim (x, z) point: the same shapes Field.ts draws, so grass blades and scuffs land on the right ground. */
import { BASES, MOUND_DISTANCE, fenceDistance, horizontalDistance, isFairAngle, sprayAngle, type Park } from '../sim'

function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}

export function isDirt(x: number, z: number, park: Park): boolean {
  if (Math.hypot(x, z) < 3.96) return true
  if (Math.hypot(x, z - MOUND_DISTANCE) < 2.74) return true
  for (let base = 1; base <= 3; base++) if (Math.hypot(x - BASES[base].x, z - BASES[base].z) < 1.8) return true
  for (let base = 0; base < 4; base++) {
    const a = BASES[base]
    const b = BASES[(base + 1) % 4]
    if (segmentDistance(x, z, a.x, a.z, b.x, b.z) < 1.8) return true
  }
  const u = (x + z) * Math.SQRT1_2
  const v = (z - x) * Math.SQRT1_2
  const insideSquare = u > 1.8 && u < 25.6 && v > 1.8 && v < 25.6
  if (!insideSquare && Math.hypot(x, z - MOUND_DISTANCE) < 29 && z > 0 && Math.abs(sprayAngle({ x, z })) < 50) return true
  if (isFairAngle({ x, z }) && horizontalDistance({ x, z }) > fenceDistance(park, sprayAngle({ x, z })) - 4.6) return true
  return false
}

export function insidePark(x: number, z: number, park: Park): boolean {
  if (z < -park.backstop + 1) return false
  const lineDistance = Math.abs(Math.abs(x) - z) * Math.SQRT1_2
  if (!isFairAngle({ x, z })) return lineDistance < park.foulSide - 1
  return horizontalDistance({ x, z }) < fenceDistance(park, sprayAngle({ x, z }))
}
