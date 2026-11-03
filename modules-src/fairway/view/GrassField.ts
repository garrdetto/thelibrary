/** Plants instanced grass blades around the ball: a world-anchored jittered grid (so blades stay put when the patch moves), sized by surface and faded at the patch edge. */
import type { QualityTier } from '../../../engine'
import type { GrassFieldLook } from '../config'
import { createGrass, type GrassBlade, type GrassModel } from '../models/Grass'
import type { Course } from '../systems/Course'

export interface GrassField {
  model: GrassModel
  /** Re-plants when the focus has moved far enough from the last patch centre. */
  follow(x: number, z: number): void
  setCourse(course: Course): void
}

function cellHash(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(salt, 83492791)
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

export function createGrassField(look: GrassFieldLook, tier: QualityTier): GrassField {
  const capacity = look.capacity[tier]
  const model = createGrass({ ...look.blade, capacity: Math.max(1, capacity) })
  model.mesh.visible = capacity > 0
  const spacing = Math.sqrt((Math.PI * look.radius * look.radius) / Math.max(1, capacity))
  let course: Course | null = null
  let centerX = Number.NaN
  let centerZ = Number.NaN

  const plant = (x: number, z: number) => {
    if (!course || capacity <= 0) return
    centerX = x
    centerZ = z
    const blades: GrassBlade[] = []
    const reach = Math.ceil(look.radius / spacing)
    const ci = Math.floor(x / spacing)
    const cj = Math.floor(z / spacing)
    for (let i = ci - reach; i <= ci + reach && blades.length < capacity; i++) {
      for (let j = cj - reach; j <= cj + reach && blades.length < capacity; j++) {
        const bx = (i + cellHash(i, j, 1)) * spacing
        const bz = (j + cellHash(i, j, 2)) * spacing
        const distance = Math.hypot(bx - x, bz - z)
        if (distance > look.radius) continue
        const surface = course.surfaceAt(bx, bz)
        const height = look.heights[surface]
        if (!height) continue
        const fade = Math.min(1, (look.radius - distance) / (look.radius * look.edgeFade))
        const variety = cellHash(i, j, 3)
        blades.push({
          x: bx,
          y: course.heightAt(bx, bz),
          z: bz,
          yaw: cellHash(i, j, 4) * Math.PI * 2,
          height: height * fade * (1 - look.heightVariation / 2 + variety * look.heightVariation),
          width: 1 - look.widthVariation / 2 + cellHash(i, j, 5) * look.widthVariation,
          lean: (cellHash(i, j, 6) - 0.5) * look.maxLean,
          tint: look.tints[surface] * (1 - look.tintVariation / 2 + cellHash(i, j, 7) * look.tintVariation),
        })
      }
    }
    model.plant(blades)
  }

  return {
    model,
    follow(x, z) {
      if (Number.isNaN(centerX) || Math.hypot(x - centerX, z - centerZ) > look.replantDistance) plant(x, z)
    },
    setCourse(next) {
      course = next
      centerX = Number.NaN
      centerZ = Number.NaN
    },
  }
}
