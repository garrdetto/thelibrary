/** The pitcher's mound as a turned profile: an 18 ft circle rising 10 in to a flat table around the rubber, with a gentle crown and a long slope toward the plate. `groundHeight` lets figures stand on it. */
import * as THREE from 'three/webgpu'
import { MOUND_DISTANCE } from '../sim'

/** (radius, height) in metres from the mound's centre outward. */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.254], [0.45, 0.253], [0.75, 0.246], [1.1, 0.225], [1.5, 0.18], [1.9, 0.125], [2.3, 0.065], [2.6, 0.022], [2.74, 0.004], [2.85, 0],
]

export const MOUND_RADIUS = 2.85

function profileHeight(radius: number): number {
  if (radius >= MOUND_RADIUS) return 0
  for (let index = 1; index < PROFILE.length; index++) {
    const [r1, h1] = PROFILE[index]
    if (radius <= r1) {
      const [r0, h0] = PROFILE[index - 1]
      const t = (radius - r0) / (r1 - r0)
      return h0 + (h1 - h0) * t
    }
  }
  return 0
}

/** Ground height under a world point (zero everywhere but the mound). */
export function groundHeight(x: number, worldZ: number): number {
  return profileHeight(Math.hypot(x, -worldZ - MOUND_DISTANCE))
}

/** The mound surface, centred on the rubber, in world space. */
export function moundGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector2[] = []
  for (let index = 0; index <= 28; index++) {
    const radius = (index / 28) * MOUND_RADIUS
    points.push(new THREE.Vector2(radius, profileHeight(radius)))
  }
  const geometry = new THREE.LatheGeometry(points.reverse(), 64)
  geometry.translate(0, 0, -MOUND_DISTANCE)
  geometry.computeVertexNormals()
  return geometry
}
