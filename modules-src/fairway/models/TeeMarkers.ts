/** Tee marker model factory: a pair of rounded posts either side of the teeing spot, square to the line of play. */
import * as THREE from 'three/webgpu'

export interface TeeMarkerSpec {
  colors: readonly [string, string]
  radius: number
  height: number
  spread: number
  segments: number
  roughness: number
}

export function createTeeMarkers(spec: TeeMarkerSpec): THREE.Group {
  const root = new THREE.Group()
  root.name = 'tee-markers'
  const geometry = new THREE.CapsuleGeometry(spec.radius, spec.height, Math.max(2, Math.round(spec.segments / 2)), spec.segments)
  ;[-1, 1].forEach((side, index) => {
    const marker = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.colors[index]), roughness: spec.roughness, metalness: 0 }))
    marker.position.set((side * spec.spread) / 2, spec.height / 2 + spec.radius, 0)
    marker.castShadow = true
    root.add(marker)
  })
  return root
}
