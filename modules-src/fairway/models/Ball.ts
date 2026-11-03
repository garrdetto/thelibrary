/** Ball model factory: a shadow-casting white sphere, drawn slightly larger than life so it reads at long range. */
import * as THREE from 'three/webgpu'

export interface BallModelSpec {
  radius: number
  visualScale: number
  segments: number
  color: string
  roughness: number
}

export function createBall(spec: BallModelSpec): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(spec.radius * spec.visualScale, spec.segments, Math.max(8, Math.round(spec.segments / 2))),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color), roughness: spec.roughness, metalness: 0 }),
  )
  mesh.name = 'ball'
  mesh.castShadow = true
  return mesh
}
