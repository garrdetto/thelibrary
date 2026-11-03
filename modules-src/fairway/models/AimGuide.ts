/** Aim guide model factory: a row of flat instanced discs laid along the ground in the aim direction. */
import * as THREE from 'three/webgpu'

export interface AimGuideSpec {
  color: string
  dots: number
  radius: number
  opacity: number
  segments: number
}

export interface AimGuideModel {
  mesh: THREE.InstancedMesh
  /** Places one disc per point (x, y, z), oriented flat; extra discs are hidden. */
  place(points: readonly (readonly [number, number, number])[]): void
}

export function createAimGuide(spec: AimGuideSpec): AimGuideModel {
  const geometry = new THREE.CircleGeometry(spec.radius, spec.segments)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.color), transparent: true, opacity: spec.opacity, depthWrite: false })
  const mesh = new THREE.InstancedMesh(geometry, material, spec.dots)
  mesh.name = 'aim-guide'
  mesh.frustumCulled = false
  const matrix = new THREE.Matrix4()
  return {
    mesh,
    place(points) {
      const visible = Math.min(points.length, spec.dots)
      for (let index = 0; index < visible; index++) {
        const [x, y, z] = points[index]
        matrix.makeTranslation(x, y, z)
        mesh.setMatrixAt(index, matrix)
      }
      mesh.count = visible
      mesh.instanceMatrix.needsUpdate = true
    },
  }
}
