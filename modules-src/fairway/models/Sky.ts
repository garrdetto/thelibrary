/** Sky model factory: an inward-facing gradient dome shaded by a TSL colorNode (no HDR downloads). */
import * as THREE from 'three/webgpu'

const { float, max, mix, normalize, positionLocal, pow, vec3 } = THREE.TSL

function rgb(hex: string): THREE.Node<'vec3'> {
  const value = new THREE.Color(hex)
  return vec3(value.r, value.g, value.b)
}

export interface SkySpec {
  top: string
  horizon: string
  radius: number
  exponent: number
  widthSegments: number
  heightSegments: number
}

export function createSky(spec: SkySpec): THREE.Mesh {
  const height = max(normalize(positionLocal).y, float(0))
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false })
  material.colorNode = mix(rgb(spec.horizon), rgb(spec.top), pow(height, spec.exponent))
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(spec.radius, spec.widthSegments, spec.heightSegments), material)
  mesh.name = 'sky'
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  return mesh
}
