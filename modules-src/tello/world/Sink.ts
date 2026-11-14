/**
 * Montello's builders lay their solids out in Tello's town frame (map x, height, -map z). A host world whose Rapier
 * world uses another frame (Fox Lake uses Fox Plains' town frame) hands them the physics through `shiftedPhysics`.
 */
import type { Physics, StaticBox } from '../../foxlake/fp/physics/Physics'

export interface Shift {
  x: number
  y: number
  z: number
}

/** The parts of the Rapier world Montello's builders use, with positions in Tello's town frame. */
export interface StaticSink {
  addStaticBox(b: StaticBox): unknown
  addStaticCylinder(x: number, y: number, z: number, halfH: number, r: number): unknown
  addHeightfield(n: number, size: number, heights: Float32Array, cx: number, cz: number): void
}

/** The physics world seen through Tello's town frame. */
export function shiftedPhysics(physics: Physics, s: Shift): StaticSink {
  if (!s.x && !s.y && !s.z) return physics
  return {
    addStaticBox: (b) => physics.addStaticBox({ ...b, cx: b.cx + s.x, cy: b.cy + s.y, cz: b.cz + s.z }),
    addStaticCylinder: (x, y, z, halfH, r) => physics.addStaticCylinder(x + s.x, y + s.y, z + s.z, halfH, r),
    addHeightfield: (n, size, heights, cx, cz) => {
      const lifted = s.y ? heights.map((h) => h + s.y) : heights
      physics.addHeightfield(n, size, lifted, cx + s.x, cz + s.z)
    },
  }
}

