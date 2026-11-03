/** Terrain model factory: a heightfield grid whose per-vertex zone weights drive a TSL grass shader with two-octave noise and mow stripes. */
import * as THREE from 'three/webgpu'

const { attribute, cos, dot, float, fract, mix, mx_noise_float, positionWorld, sin, smoothstep, uniform, vec2, vec3 } = THREE.TSL

type Vec3Node = THREE.Node<'vec3'>
type FloatNode = THREE.Node<'float'>

function rgb(hex: string): Vec3Node {
  const value = new THREE.Color(hex)
  return vec3(value.r, value.g, value.b)
}

export interface TerrainPaletteSpec {
  rough: string
  roughDark: string
  fairway: string
  fairwayStripe: string
  green: string
  greenStripe: string
  bunker: string
  tee: string
  path: string
  waterBed: string
}

export interface TerrainSpec {
  columns: number
  rows: number
  cellSize: number
  originX: number
  originZ: number
  /** Height per vertex, row-major: index = row · columns + column, row along +z, column along +x. */
  heights: Float32Array
  /** Four weights per vertex: fairway, green, bunker, water bed. */
  zonesA: Float32Array
  /** Two weights per vertex: tee box, cart path. */
  zonesB: Float32Array
  palette: TerrainPaletteSpec
  stripeWidth: number
  greenStripeWidth: number
  /** Band edges in stripe space: light→dark blend start/end and dark→light blend start/end. */
  stripeEdges: readonly [number, number, number, number]
  stripeYaw: number
  noiseScales: readonly [number, number]
  noiseWeights: readonly [number, number]
  noiseStrength: number
  roughness: number
}

function buildGeometry(spec: TerrainSpec): THREE.BufferGeometry {
  const { columns, rows, cellSize, originX, originZ, heights } = spec
  const positions = new Float32Array(columns * rows * 3)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column
      positions[index * 3] = originX + column * cellSize
      positions[index * 3 + 1] = heights[index]
      positions[index * 3 + 2] = originZ + row * cellSize
    }
  }
  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6)
  let cursor = 0
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column
      const b = a + 1
      const c = a + columns
      const d = c + 1
      indices.set([a, c, b, b, c, d], cursor)
      cursor += 6
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('zoneA', new THREE.BufferAttribute(spec.zonesA, 4))
  geometry.setAttribute('zoneB', new THREE.BufferAttribute(spec.zonesB, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function createTerrain(spec: TerrainSpec): THREE.Mesh {
  const palette = spec.palette
  const color = rgb
  const zoneA = attribute('zoneA', 'vec4')
  const zoneB = attribute('zoneB', 'vec2')
  const ground = positionWorld.xz
  const octave = (scale: number): FloatNode => mx_noise_float(vec3(ground.x.mul(scale), float(0), ground.y.mul(scale)))
  const noise: FloatNode = octave(spec.noiseScales[0]).mul(spec.noiseWeights[0]).add(octave(spec.noiseScales[1]).mul(spec.noiseWeights[1]))
  const shade = noise.mul(spec.noiseStrength).add(1)
  const stripeDirection = uniform(new THREE.Vector2(Math.sin(spec.stripeYaw), Math.cos(spec.stripeYaw)))
  const across = vec2(stripeDirection.y, stripeDirection.x.negate())
  const [riseStart, riseEnd, fallStart, fallEnd] = spec.stripeEdges
  const banding = (coordinate: FloatNode): FloatNode => smoothstep(riseStart, riseEnd, coordinate).sub(smoothstep(fallStart, fallEnd, coordinate))
  const stripe = banding(fract(dot(ground, across).div(spec.stripeWidth)))
  const rough: Vec3Node = mix(color(palette.roughDark), color(palette.rough), noise.mul(0.5).add(0.5))
  const fairway = mix(color(palette.fairway), color(palette.fairwayStripe), stripe)
  const greenStripe = banding(fract(dot(ground, vec2(cos(float(spec.stripeYaw)), sin(float(spec.stripeYaw)))).div(spec.greenStripeWidth)))
  const green = mix(color(palette.green), color(palette.greenStripe), greenStripe)
  let surface: Vec3Node = rough
  surface = mix(surface, fairway, zoneA.x)
  surface = mix(surface, green, zoneA.y)
  surface = mix(surface, color(palette.bunker), zoneA.z)
  surface = mix(surface, color(palette.waterBed), zoneA.w)
  surface = mix(surface, color(palette.tee), zoneB.x)
  surface = mix(surface, color(palette.path), zoneB.y)

  const material = new THREE.MeshStandardNodeMaterial({ roughness: spec.roughness, metalness: 0 })
  material.colorNode = surface.mul(shade)
  const mesh = new THREE.Mesh(buildGeometry(spec), material)
  mesh.name = 'terrain'
  mesh.receiveShadow = true
  return mesh
}
