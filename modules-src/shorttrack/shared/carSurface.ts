import { Box3, Matrix4, Quaternion, Raycaster, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { CarNumbers, ModelTransform } from './CustomCars'

/** Where each race number sits on the body, in the car frame (+x forward, +y up, +z the driver's right, road at y = 0). */
export type NumberAnchors = {
  door: { x: number; y: number; right: number; left: number } | null
  roof: { x: number; y: number } | null
  tail: { x: number; y: number } | null
}

const LIFT = 0.012

/** The model-to-car matrix for a placement (position, quarter-turn yaw in degrees, uniform scale). */
export function placementMatrix(t: ModelTransform) {
  return new Matrix4().compose(new Vector3(t.x, t.y, t.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (t.yaw * Math.PI) / 180), new Vector3(t.scale, t.scale, t.scale))
}

/**
 * Casts in from outside the body to find the painted surface under each number spot.
 * `root` must already be in the car frame (its world matrix is the placement).
 */
export function numberAnchors(root: Object3D, numbers: CarNumbers): NumberAnchors {
  root.updateMatrixWorld(true)
  const box = new Box3().setFromObject(root)
  if (box.isEmpty()) return { door: null, roof: null, tail: null }
  const ray = new Raycaster()
  const reach = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) + 2
  const cast = (origin: Vector3, dir: Vector3) => {
    ray.set(origin, dir)
    ray.far = reach * 2
    return ray.intersectObject(root, true)[0]?.point ?? null
  }
  const door = numbers.door && (() => {
    const { x, y } = numbers.door
    const right = cast(new Vector3(x, y, box.max.z + 1), new Vector3(0, 0, -1))
    const left = cast(new Vector3(x, y, box.min.z - 1), new Vector3(0, 0, 1))
    return { x, y, right: (right?.z ?? box.max.z) + LIFT, left: (left?.z ?? box.min.z) - LIFT }
  })()
  const roof = numbers.roof && (() => {
    const hit = cast(new Vector3(numbers.roof.x, box.max.y + 1, 0), new Vector3(0, -1, 0))
    return { x: numbers.roof.x, y: (hit?.y ?? box.max.y) + LIFT }
  })()
  const tail = numbers.tail && (() => {
    const hit = cast(new Vector3(box.min.x - 1, numbers.tail.y, 0), new Vector3(1, 0, 0))
    return { x: (hit?.x ?? box.min.x) - LIFT, y: numbers.tail.y }
  })()
  return { door, roof, tail }
}

export type NumberPlane = { spot: 'door' | 'roof' | 'tail'; position: [number, number, number]; rotation: [number, number, number] }

/** One plane per placement: readable from each side, from above when standing on the car's right, and from behind. */
export function numberPlanes(anchors: NumberAnchors): NumberPlane[] {
  const out: NumberPlane[] = []
  if (anchors.door) {
    out.push({ spot: 'door', position: [anchors.door.x, anchors.door.y, anchors.door.right], rotation: [0, 0, 0] })
    out.push({ spot: 'door', position: [anchors.door.x, anchors.door.y, anchors.door.left], rotation: [0, Math.PI, 0] })
  }
  if (anchors.roof) out.push({ spot: 'roof', position: [anchors.roof.x, anchors.roof.y, 0], rotation: [-Math.PI / 2, 0, 0] })
  if (anchors.tail) out.push({ spot: 'tail', position: [anchors.tail.x, anchors.tail.y, 0], rotation: [0, -Math.PI / 2, 0] })
  return out
}
