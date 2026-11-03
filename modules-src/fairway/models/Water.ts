/** Water model factory: a subdivided plane over one pond with a TSL Gerstner ripple in positionNode and a fresnel colorNode. */
import * as THREE from 'three/webgpu'

const { cos, dot, float, max, mix, normalView, positionLocal, positionViewDirection, pow, sin, time, vec2, vec3 } = THREE.TSL

type Vec3Node = THREE.Node<'vec3'>

function rgb(hex: string): Vec3Node {
  const value = new THREE.Color(hex)
  return vec3(value.r, value.g, value.b)
}

export interface WaveSpec {
  direction: readonly [number, number]
  amplitude: number
  wavelength: number
  speed: number
  steepness: number
}

export interface WaterSpec {
  centerX: number
  centerZ: number
  width: number
  depth: number
  level: number
  cellSize: number
  shallow: string
  deep: string
  opacity: number
  roughness: number
  fresnelPower: number
  waves: readonly WaveSpec[]
}

export function createWater(spec: WaterSpec): THREE.Mesh {
  const widthSegments = Math.max(2, Math.ceil(spec.width / spec.cellSize))
  const depthSegments = Math.max(2, Math.ceil(spec.depth / spec.cellSize))
  const geometry = new THREE.PlaneGeometry(spec.width, spec.depth, widthSegments, depthSegments)
  geometry.rotateX(-Math.PI / 2)

  let displacement: Vec3Node = vec3(0, 0, 0)
  for (const wave of spec.waves) {
    const length = Math.hypot(wave.direction[0], wave.direction[1]) || 1
    const direction = vec2(wave.direction[0] / length, wave.direction[1] / length)
    const k = (2 * Math.PI) / wave.wavelength
    const phase = dot(direction, positionLocal.xz).sub(time.mul(wave.speed)).mul(k)
    const horizontal = cos(phase).mul(wave.steepness * wave.amplitude)
    displacement = displacement.add(vec3(horizontal.mul(direction.x), sin(phase).mul(wave.amplitude), horizontal.mul(direction.y)))
  }

  const facing = max(dot(normalView, positionViewDirection), float(0))
  const fresnel = pow(float(1).sub(facing), spec.fresnelPower)
  const material = new THREE.MeshStandardNodeMaterial({ transparent: true, opacity: spec.opacity, roughness: spec.roughness, metalness: 0 })
  material.positionNode = positionLocal.add(displacement)
  material.colorNode = mix(rgb(spec.deep), rgb(spec.shallow), fresnel)
  material.depthWrite = false

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'water'
  mesh.position.set(spec.centerX, spec.level, spec.centerZ)
  mesh.renderOrder = 1
  return mesh
}
