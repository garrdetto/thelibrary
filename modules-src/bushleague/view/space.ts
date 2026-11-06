/** Sim-to-scene conversion. The sim's z runs out to center field; three.js looks down −z, so z flips and first base stays on the right from behind the plate. */
import * as THREE from 'three/webgpu'
import type { Vec3 } from '../sim'

export function toWorld(point: Vec3 | { x: number; y: number; z: number }, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(point.x, point.y, -point.z)
}

export function worldXYZ(x: number, y: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(x, y, -z)
}

export function fromWorld(point: THREE.Vector3): Vec3 {
  return { x: point.x, y: point.y, z: -point.z }
}
