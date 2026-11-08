/** Shared geometry and material caches so hundreds of props share a handful of GPU resources. */
import * as THREE from 'three/webgpu'

const materials = new Map<string, THREE.MeshStandardMaterial>()
const boxes = new THREE.BoxGeometry(1, 1, 1)
const cylinders = new THREE.CylinderGeometry(0.5, 0.5, 1, 18)
const spheres = new THREE.SphereGeometry(0.5, 20, 14)

export interface Finish {
  roughness?: number
  metalness?: number
  emissive?: string
  emissiveIntensity?: number
  opacity?: number
}

export function material(color: string, finish: Finish = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${finish.roughness ?? 0.7}|${finish.metalness ?? 0}|${finish.emissive ?? ''}|${finish.emissiveIntensity ?? 0}|${finish.opacity ?? 1}`
  let m = materials.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: finish.roughness ?? 0.7, metalness: finish.metalness ?? 0 })
    if (finish.emissive) {
      m.emissive = new THREE.Color(finish.emissive)
      m.emissiveIntensity = finish.emissiveIntensity ?? 1
    }
    if (finish.opacity !== undefined && finish.opacity < 1) {
      m.transparent = true
      m.opacity = finish.opacity
      m.depthWrite = false
    }
    materials.set(key, m)
  }
  return m
}

function place(mesh: THREE.Mesh, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  mesh.position.set(x, y, z)
  mesh.scale.set(sx, sy, sz)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** A box by its size and the position of its centre. */
export function box(w: number, h: number, d: number, color: string | THREE.Material, x = 0, y = h / 2, z = 0, finish?: Finish): THREE.Mesh {
  return place(new THREE.Mesh(boxes, typeof color === 'string' ? material(color, finish) : color), x, y, z, w, h, d)
}

export function cylinder(radius: number, h: number, color: string | THREE.Material, x = 0, y = h / 2, z = 0, finish?: Finish): THREE.Mesh {
  return place(new THREE.Mesh(cylinders, typeof color === 'string' ? material(color, finish) : color), x, y, z, radius * 2, h, radius * 2)
}

export function sphere(radius: number, color: string | THREE.Material, x = 0, y = radius, z = 0, finish?: Finish, squash = 1): THREE.Mesh {
  return place(new THREE.Mesh(spheres, typeof color === 'string' ? material(color, finish) : color), x, y, z, radius * 2, radius * 2 * squash, radius * 2)
}

export const unitBox = boxes

/** Frees a scene's own objects without touching the shared caches. */
export function detach(root: THREE.Object3D): void {
  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose()
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    if (geometry && geometry !== boxes && geometry !== cylinders && geometry !== spheres && !geometry.userData.shared) geometry.dispose()
    const own = node.userData.ownMaterial as THREE.Material | undefined
    own?.dispose()
  })
  root.removeFromParent()
}
