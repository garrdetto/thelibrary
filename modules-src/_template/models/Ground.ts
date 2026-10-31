/** Ground slab model factory: a flat box that receives shadows. */
import * as THREE from 'three/webgpu'

export interface GroundSpec {
  size: number
  thickness: number
  color: string
  roughness: number
  metalness: number
}

export function createGround(spec: GroundSpec): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(spec.size, spec.thickness, spec.size),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color), roughness: spec.roughness, metalness: spec.metalness }),
  )
  mesh.name = 'ground'
  mesh.position.y = -spec.thickness / 2
  mesh.receiveShadow = true
  return mesh
}
