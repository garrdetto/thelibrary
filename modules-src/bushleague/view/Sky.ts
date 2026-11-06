/** Gradient sky dome for the gray-box phase (Phase 2 replaces it with a physical sky and per-park HDRI). */
import * as THREE from 'three/webgpu'

export function createSky(top: string, horizon: string, ground: string): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(700, 32, 16)
  const colors: number[] = []
  const high = new THREE.Color(top)
  const mid = new THREE.Color(horizon)
  const low = new THREE.Color(ground)
  const color = new THREE.Color()
  const position = geometry.getAttribute('position')
  for (let index = 0; index < position.count; index++) {
    const y = position.getY(index) / 700
    if (y >= 0) color.copy(mid).lerp(high, Math.pow(y, 0.6))
    else color.copy(mid).lerp(low, Math.min(1, -y * 4))
    colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const sky = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
  sky.name = 'sky'
  sky.renderOrder = -1
  return sky
}
