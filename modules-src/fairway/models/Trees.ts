/** Tree model factory: three original species (broadleaf oak, layered conifer, slender birch) built from bent, branching trunks, noise-sculpted foliage clumps and alpha-cut leaf cards, all drawn as InstancedMeshes with a TSL wind sway. */
import * as THREE from 'three/webgpu'

const { attribute, float, fract, instanceIndex, length, mix, positionLocal, sin, smoothstep, time, uv, vec2, vec3 } = THREE.TSL

export interface TreeInstance {
  x: number
  y: number
  z: number
  scale: number
  variant: number
  yaw: number
}

export interface SpeciesSpec {
  barkColor: string
  barkDark: string
  leafLight: string
  leafDark: string
  trunkHeight: number
  trunkRadius: number
  trunkBend: number
  branches: number
  branchLength: number
  branchRise: number
  clumps: number
  clumpRadius: number
  crownRadius: number
  crownHeight: number
  crownBase: number
  roughness: number
  cards: number
  cardSize: number
  /** Conifers stack drooping tiers instead of clumps. */
  tiers: number
}

export interface TreesSpec {
  species: readonly [SpeciesSpec, SpeciesSpec, SpeciesSpec]
  sphereDetail: number
  radialSegments: number
  heightSegments: number
  displacement: number
  noiseFrequency: number
  tierDroop: number
  tierJag: number
  swayAmplitude: number
  swaySpeed: number
  tintVariation: number
  /** Upward bias added to foliage normals so crowns light like soft masses of leaves. */
  normalLift: number
  instances: readonly TreeInstance[]
}

/** Small deterministic generator so every tree shape is the same on every load. */
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smooth 3D value noise in [−1, 1] (trilinear blend of hashed lattice values), used to sculpt clump silhouettes. */
function valueNoise(x: number, y: number, z: number): number {
  const hash = (i: number, j: number, k: number) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295
  }
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const fade = (t: number) => t * t * (3 - 2 * t)
  const u = fade(x - xi)
  const v = fade(y - yi)
  const w = fade(z - zi)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const x00 = lerp(hash(xi, yi, zi), hash(xi + 1, yi, zi), u)
  const x10 = lerp(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u)
  const x01 = lerp(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u)
  const x11 = lerp(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u)
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1
}

interface Part {
  geometry: THREE.BufferGeometry
  shade: (position: THREE.Vector3) => number
}

/** Merges non-indexed parts into one geometry with a per-vertex "shade" attribute (0 = deep inside/below, 1 = sunlit tip). */
function merge(parts: Part[], withUv: boolean): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const shades: number[] = []
  const point = new THREE.Vector3()
  for (const part of parts) {
    if (!part.geometry.attributes.normal || part.geometry.index) part.geometry.computeVertexNormals()
    const flat = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry
    const position = flat.attributes.position
    const normal = flat.attributes.normal
    const texture = flat.attributes.uv
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index)
      positions.push(point.x, point.y, point.z)
      normals.push(normal.getX(index), normal.getY(index), normal.getZ(index))
      if (withUv) uvs.push(texture ? texture.getX(index) : 0, texture ? texture.getY(index) : 0)
      shades.push(part.shade(point))
    }
    if (flat !== part.geometry) flat.dispose()
    part.geometry.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  if (withUv) merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  merged.setAttribute('shade', new THREE.Float32BufferAttribute(shades, 1))
  merged.computeBoundingSphere()
  return merged
}

/** A tapered limb from a base point along a direction, slightly bent, closed at the tip. */
function limb(base: THREE.Vector3, direction: THREE.Vector3, lengthValue: number, radius: number, tipRatio: number, bend: number, spec: TreesSpec): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius * tipRatio, radius, lengthValue, spec.radialSegments, spec.heightSegments, false)
  const position = geometry.attributes.position
  for (let index = 0; index < position.count; index++) {
    const y = position.getY(index) + lengthValue / 2
    const t = y / lengthValue
    position.setX(index, position.getX(index) + Math.sin(t * Math.PI) * bend * lengthValue)
    position.setY(index, y)
  }
  const orient = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
  geometry.applyQuaternion(orient)
  geometry.translate(base.x, base.y, base.z)
  return geometry
}

/** Icosphere with its surface pushed in and out by value noise, so a clump reads as a mass of leaves rather than a ball. */
function clump(center: THREE.Vector3, radius: number, seed: number, spec: TreesSpec): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, spec.sphereDetail)
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const point = new THREE.Vector3()
  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index)
    const direction = point.clone().normalize()
    const f = spec.noiseFrequency / radius
    const bumps = valueNoise(point.x * f + seed, point.y * f, point.z * f) * 0.65 + valueNoise(point.x * f * 2.7, point.y * f * 2.7 + seed, point.z * f * 2.7) * 0.35
    const flatten = direction.y < 0 ? 1 + direction.y * 0.35 : 1
    const outward = direction.clone()
    point.copy(direction.multiplyScalar(radius * (1 + bumps * spec.displacement) * flatten))
    position.setXYZ(index, point.x + center.x, point.y + center.y, point.z + center.z)
    const smooth = outward.add(new THREE.Vector3(0, spec.normalLift, 0)).normalize()
    normal.setXYZ(index, smooth.x, smooth.y, smooth.z)
  }
  return geometry
}

/** A drooping conifer skirt: a cone whose rim is jagged and pulled down so each tier reads as a layer of boughs. */
function tier(baseY: number, radius: number, height: number, seed: number, spec: TreesSpec): THREE.BufferGeometry {
  const segments = spec.radialSegments * 3
  const geometry = new THREE.ConeGeometry(radius, height, segments, 3, true)
  const position = geometry.attributes.position
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const rimness = (height / 2 - y) / height
    const angle = Math.atan2(z, x)
    const jag = 1 + (Math.sin(angle * segments * 0.5 + seed) * 0.5 + valueNoise(Math.cos(angle) * 3 + seed, Math.sin(angle) * 3, seed) * 0.5) * spec.tierJag * rimness
    position.setXYZ(index, x * jag, y + baseY + height / 2 - rimness * rimness * spec.tierDroop * radius, z * jag)
  }
  return geometry
}

/** Crossed alpha-cut quads scattered over the crown surface to break up its outline. */
function leafCards(centers: readonly { center: THREE.Vector3; radius: number }[], count: number, size: number, random: () => number): THREE.BufferGeometry[] {
  const cards: THREE.BufferGeometry[] = []
  for (let card = 0; card < count; card++) {
    const host = centers[Math.floor(random() * centers.length)]
    const direction = new THREE.Vector3(random() * 2 - 1, random() * 1.6 - 0.5, random() * 2 - 1).normalize()
    const plane = new THREE.PlaneGeometry(size, size)
    const orient = new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI))
    plane.applyQuaternion(orient)
    const spot = host.center.clone().addScaledVector(direction, host.radius * (0.85 + random() * 0.3))
    plane.translate(spot.x, spot.y, spot.z)
    cards.push(plane)
  }
  return cards
}

interface SpeciesGeometry {
  wood: THREE.BufferGeometry
  foliage: THREE.BufferGeometry
  cards: THREE.BufferGeometry
}

function buildSpecies(species: SpeciesSpec, index: number, spec: TreesSpec): SpeciesGeometry {
  const random = generator(0x7ee5 + index * 977)
  const up = new THREE.Vector3(0, 1, 0)
  const crownTop = species.crownBase + species.crownHeight
  const woodShade = (point: THREE.Vector3) => Math.min(1, 0.35 + point.y / crownTop)
  const foliageShade = (point: THREE.Vector3) => {
    const height = (point.y - species.crownBase) / species.crownHeight
    const outward = Math.min(1, Math.hypot(point.x, point.z) / species.crownRadius)
    return Math.max(0, Math.min(1, height * 0.7 + outward * 0.45))
  }
  const wood: Part[] = [{ geometry: limb(new THREE.Vector3(), up.clone().add(new THREE.Vector3(species.trunkBend, 0, species.trunkBend * 0.5)), species.trunkHeight, species.trunkRadius, 0.45, species.trunkBend, spec), shade: woodShade }]
  const masses: { center: THREE.Vector3; radius: number }[] = []
  for (let branch = 0; branch < species.branches; branch++) {
    const angle = (branch / species.branches) * Math.PI * 2 + random() * 0.8
    const height = species.crownBase + (branch / Math.max(1, species.branches - 1)) * species.crownHeight * 0.45
    const direction = new THREE.Vector3(Math.cos(angle), species.branchRise + random() * 0.3, Math.sin(angle))
    const reach = species.branchLength * (0.75 + random() * 0.5)
    const base = new THREE.Vector3(species.trunkBend * height * 0.5, height, species.trunkBend * height * 0.25)
    wood.push({ geometry: limb(base, direction, reach, species.trunkRadius * 0.38, 0.35, 0.08, spec), shade: woodShade })
    masses.push({ center: base.clone().addScaledVector(direction.normalize(), reach), radius: species.clumpRadius })
  }
  const foliage: Part[] = []
  if (species.tiers > 0) {
    for (let level = 0; level < species.tiers; level++) {
      const t = level / species.tiers
      const radius = species.crownRadius * (1 - t * 0.82)
      const height = species.crownHeight / species.tiers * 1.7
      const baseY = species.crownBase + t * species.crownHeight * 0.92
      foliage.push({ geometry: tier(baseY, radius, height, level * 13 + index, spec), shade: foliageShade })
      masses.push({ center: new THREE.Vector3(0, baseY + height * 0.3, 0), radius: radius * 0.8 })
    }
  } else {
    for (let extra = 0; extra < species.clumps; extra++) {
      const angle = random() * Math.PI * 2
      const spread = Math.sqrt(random()) * (species.crownRadius - species.clumpRadius * 0.6)
      const height = species.crownBase + species.crownHeight * (0.3 + random() * 0.6)
      masses.push({ center: new THREE.Vector3(Math.cos(angle) * spread, height, Math.sin(angle) * spread), radius: species.clumpRadius * (0.7 + random() * 0.55) })
    }
    masses.push({ center: new THREE.Vector3(0, crownTop - species.clumpRadius * 0.6, 0), radius: species.clumpRadius * 1.1 })
    masses.forEach((mass, seed) => foliage.push({ geometry: clump(mass.center, mass.radius, seed * 3.1 + index, spec), shade: foliageShade }))
  }
  const cards = leafCards(masses, species.cards, species.cardSize, random).map((geometry) => ({ geometry, shade: foliageShade }))
  return { wood: merge(wood, false), foliage: merge(foliage, false), cards: merge(cards, true) }
}

function rgb(hex: string): THREE.Node<'vec3'> {
  const value = new THREE.Color(hex)
  return vec3(value.r, value.g, value.b)
}

/** Wind sway shared by foliage and cards: tops move, the base stays planted; each instance gets its own phase. */
function sway(spec: TreesSpec, crownTop: number): THREE.Node<'vec3'> {
  const phase = fract(instanceIndex.toFloat().mul(0.6180339)).mul(6.2831)
  const lift = smoothstep(float(0), float(crownTop), positionLocal.y)
  const bend = sin(time.mul(spec.swaySpeed).add(phase)).mul(spec.swayAmplitude).mul(lift).mul(lift)
  return positionLocal.add(vec3(bend, float(0), bend.mul(0.6)))
}

export function createTrees(spec: TreesSpec): THREE.Group {
  const root = new THREE.Group()
  root.name = 'trees'
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const tint = new THREE.Color()
  const random = generator(spec.instances.length + 11)

  spec.species.forEach((species, index) => {
    const list = spec.instances.filter((tree) => tree.variant % spec.species.length === index)
    if (!list.length) return
    const geometry = buildSpecies(species, index, spec)
    const shade = attribute('shade', 'float')
    const crownTop = species.crownBase + species.crownHeight

    const bark = new THREE.MeshStandardNodeMaterial({ roughness: species.roughness, metalness: 0 })
    bark.colorNode = mix(rgb(species.barkDark), rgb(species.barkColor), shade)
    const leaves = new THREE.MeshStandardNodeMaterial({ roughness: species.roughness, metalness: 0 })
    leaves.colorNode = mix(rgb(species.leafDark), rgb(species.leafLight), shade)
    leaves.positionNode = sway(spec, crownTop)
    const cardMaterial = new THREE.MeshStandardNodeMaterial({ roughness: species.roughness, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false })
    const leafUv = uv().sub(vec2(0.5, 0.5))
    const lobes = length(vec2(leafUv.x.mul(1.8), leafUv.y)).add(sin(leafUv.y.mul(18)).mul(0.03))
    cardMaterial.colorNode = mix(rgb(species.leafDark), rgb(species.leafLight), shade.mul(0.8).add(0.15))
    cardMaterial.opacityNode = smoothstep(float(0.5), float(0.44), lobes)
    cardMaterial.positionNode = sway(spec, crownTop)

    const meshes = [
      new THREE.InstancedMesh(geometry.wood, bark, list.length),
      new THREE.InstancedMesh(geometry.foliage, leaves, list.length),
      new THREE.InstancedMesh(geometry.cards, cardMaterial, list.length),
    ]
    list.forEach((tree, slot) => {
      rotation.setFromAxisAngle(up, tree.yaw)
      matrix.compose(new THREE.Vector3(tree.x, tree.y, tree.z), rotation, new THREE.Vector3(tree.scale, tree.scale * (0.92 + random() * 0.16), tree.scale))
      const shift = (random() - 0.5) * spec.tintVariation
      tint.setRGB(1 + shift, 1 + shift * 0.6, 1 - shift * 0.4)
      for (const mesh of meshes) {
        mesh.setMatrixAt(slot, matrix)
        if (mesh !== meshes[0]) mesh.setColorAt(slot, tint)
      }
    })
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.castShadow = true
      mesh.receiveShadow = true
      if (mesh !== meshes[0]) mesh.userData.shadowAnimated = true
      mesh.computeBoundingSphere()
      root.add(mesh)
    }
  })
  return root
}
