/** Crate model factory: a shadow-casting cube with the module accent color. */
import * as THREE from 'three/webgpu'

export interface CrateSpec {
  size: number
  color: string
  roughness: number
  metalness: number
}

export function createCrate(spec: CrateSpec): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(spec.size, spec.size, spec.size),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color), roughness: spec.roughness, metalness: spec.metalness }),
  )
  mesh.name = 'crate'
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
