/** Instanced 3D grass blades over the turf nearest the cameras, swaying in a TSL wind field; the count comes from the quality tier. */
import * as THREE from 'three/webgpu'
import { attribute, color, float, mix, positionLocal, sin, time, uv, vec3 } from 'three/tsl'
import { Rng, type Park } from '../sim'
import { worldXYZ } from './space'
import { isDirt, insidePark } from './zones'

export interface GrassField {
  mesh: THREE.InstancedMesh
  dispose(): void
}

export function createGrass(park: Park, count: number, light: string, dark: string, seed: number): GrassField | null {
  if (count <= 0) return null
  const geometry = new THREE.PlaneGeometry(0.028, 0.1, 1, 3)
  geometry.translate(0, 0.05, 0)
  const position = geometry.getAttribute('position')
  for (let index = 0; index < position.count; index++) position.setX(index, position.getX(index) * (1 - position.getY(index) / 0.11))
  const bases = new Float32Array(count * 2)
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, side: THREE.DoubleSide })
  const base = attribute<'vec2'>('bladeBase', 'vec2')
  const height = uv().y
  const gust = sin(time.mul(1.7).add(base.x.mul(0.21)).add(base.y.mul(0.17))).mul(0.5).add(sin(time.mul(3.1).add(base.x.mul(0.9))).mul(0.2))
  material.positionNode = positionLocal.add(vec3(gust.mul(height).mul(height).mul(0.035), float(0), gust.mul(height).mul(height).mul(0.02)))
  material.colorNode = mix(color(dark).mul(0.9), color(light).mul(1.2), height)
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.name = 'grass-blades'
  mesh.receiveShadow = true
  const rng = new Rng(seed)
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const at = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  let placed = 0
  let attempts = 0
  while (placed < count && attempts < count * 6) {
    attempts++
    const radius = 4 + Math.pow(rng.next(), 0.75) * 70
    const angle = (rng.next() * 2 - 1) * Math.PI * 0.62
    const x = Math.sin(angle) * radius
    const z = Math.cos(angle) * radius - 2
    if (!insidePark(x, z, park) || isDirt(x, z, park)) continue
    worldXYZ(x, 0, z, at)
    rotation.setFromAxisAngle(up, rng.next() * Math.PI)
    const s = 0.7 + rng.next() * 0.7
    scale.set(s, s * (0.8 + rng.next() * 0.6), s)
    matrix.compose(at, rotation, scale)
    mesh.setMatrixAt(placed, matrix)
    bases[placed * 2] = x
    bases[placed * 2 + 1] = z
    placed++
  }
  mesh.count = placed
  geometry.setAttribute('bladeBase', new THREE.InstancedBufferAttribute(bases, 2))
  mesh.instanceMatrix.needsUpdate = true
  return {
    mesh,
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
