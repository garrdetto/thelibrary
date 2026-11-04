/** Grass model factory: an InstancedMesh of individual curved, tapered blades with a base-to-tip color ramp and a TSL wind sway; the caller supplies where each blade grows. */
import * as THREE from 'three/webgpu'

const { float, mix, positionLocal, positionWorld, sin, time, transformNormalToView, uv, vec3 } = THREE.TSL

export interface GrassSpec {
  capacity: number
  bladeWidth: number
  bladeHeight: number
  segments: number
  curve: number
  baseColor: string
  tipColor: string
  roughness: number
  swayAmplitude: number
  swaySpeed: number
  swayScale: number
}

export interface GrassBlade {
  x: number
  y: number
  z: number
  yaw: number
  height: number
  width: number
  lean: number
  tint: number
}

export interface GrassModel {
  mesh: THREE.InstancedMesh
  /** Replaces every blade; extra capacity is hidden. */
  plant(blades: readonly GrassBlade[]): void
}

/** One blade: a strip of quads that narrows to a point and curves forward with height (uv.y runs 0 at the root to 1 at the tip). */
function bladeGeometry(spec: GrassSpec): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let row = 0; row <= spec.segments; row++) {
    const t = row / spec.segments
    const half = (spec.bladeWidth / 2) * (1 - t * t)
    const forward = spec.curve * t * t
    positions.push(-half, t, forward, half, t, forward)
    uvs.push(0, t, 1, t)
    if (row < spec.segments) {
      const a = row * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function rgb(hex: string): THREE.Node<'vec3'> {
  const value = new THREE.Color(hex)
  return vec3(value.r, value.g, value.b)
}

export function createGrass(spec: GrassSpec): GrassModel {
  const material = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: spec.roughness, metalness: 0 })
  const height = uv().y
  material.colorNode = mix(rgb(spec.baseColor), rgb(spec.tipColor), height)
  material.normalNode = transformNormalToView(vec3(0, 1, 0))
  const gust = sin(time.mul(spec.swaySpeed).add(positionWorld.x.mul(spec.swayScale)).add(positionWorld.z.mul(spec.swayScale * 0.7)))
  const bend = gust.mul(spec.swayAmplitude).mul(height).mul(height)
  material.positionNode = positionLocal.add(vec3(bend, float(0), bend.mul(0.5)))

  const mesh = new THREE.InstancedMesh(bladeGeometry(spec), material, spec.capacity)
  mesh.name = 'grass'
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.receiveShadow = true
  const white = new THREE.Color(1, 1, 1)
  for (let index = 0; index < spec.capacity; index++) mesh.setColorAt(index, white)
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const tint = new THREE.Color()
  return {
    mesh,
    plant(blades) {
      const count = Math.min(blades.length, spec.capacity)
      for (let index = 0; index < count; index++) {
        const blade = blades[index]
        euler.set(blade.lean, blade.yaw, 0, 'YXZ')
        rotation.setFromEuler(euler)
        position.set(blade.x, blade.y, blade.z)
        scale.set(blade.width, blade.height * spec.bladeHeight, blade.width)
        matrix.compose(position, rotation, scale)
        mesh.setMatrixAt(index, matrix)
        tint.setRGB(blade.tint, blade.tint, blade.tint)
        mesh.setColorAt(index, tint)
      }
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    },
  }
}
