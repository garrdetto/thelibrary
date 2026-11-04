/** Car model factory: a procedural 1970s full-size wagon or sedan body (one deformable vertex-coloured mesh), bumpers, dark window openings, wheels and the spray-painted number decals, all in the chassis frame (forward is -Z). */
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { paintById, type BodySpec } from '../config'
import type { CarLook } from '../systems/Look'
import { paintNumber } from '../systems/Numbers'

export interface CarModel {
  root: THREE.Group
  body: THREE.Mesh
  decals: THREE.Mesh[]
  wheels: THREE.Mesh[]
  paint: THREE.MeshStandardMaterial
  /** Pushes the body in around a point in the chassis frame along a direction, by a strength of 0–1. */
  dent(point: THREE.Vector3, direction: THREE.Vector3, strength: number, spec: DentSpec): void
  dispose(): void
}

export interface DentSpec {
  radius: number
  depth: number
  maxDepth: number
  darken: number
}

interface Deformable {
  geometry: THREE.BufferGeometry
  original: Float32Array
  colors: Float32Array | null
}

const scratch = new THREE.Vector3()

function hashNoise(x: number, y: number, z: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  return value - Math.floor(value)
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped * clamped * (3 - 2 * clamped)
}

/** Lower body: a segmented box with the hood and trunk surfaces dropped and the nose and tail corners rounded in. */
function lowerBody(spec: BodySpec): THREE.BufferGeometry {
  const { length, width, bodyHeight, segmentsPerMetre } = spec
  const geometry = new THREE.BoxGeometry(width, bodyHeight, length, Math.ceil(width * segmentsPerMetre), Math.ceil(bodyHeight * segmentsPerMetre), Math.ceil(length * segmentsPerMetre))
  geometry.translate(0, spec.beltHeight - bodyHeight / 2, 0)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const top = spec.beltHeight
  const cabinStart = -length / 2 + spec.cabin[0] * length
  const cabinEnd = -length / 2 + spec.cabin[1] * length
  for (let i = 0; i < position.count; i++) {
    let x = position.getX(i)
    let y = position.getY(i)
    const z = position.getZ(i)
    const nose = (z + length / 2) / length
    if (y > top - 0.01) {
      if (z < cabinStart) y -= spec.hoodDrop * smoothstep((cabinStart - z) / (cabinStart + length / 2))
      else if (z > cabinEnd) y -= spec.trunkDrop * smoothstep((z - cabinEnd) / (length / 2 - cabinEnd))
    }
    const endTaper = nose < 0.08 ? 1 - nose / 0.08 : nose > 0.94 ? (nose - 0.94) / 0.06 : 0
    x *= 1 - endTaper * 0.06
    const sillTuck = y < spec.beltHeight - bodyHeight + 0.14 ? 0.05 : 0
    x *= 1 - sillTuck
    position.setXYZ(i, x, y, z)
  }
  return geometry
}

/** Greenhouse: a narrower box over the cabin with a raked windshield and backlight. */
function greenhouse(spec: BodySpec): THREE.BufferGeometry {
  const { length, width, roofHeight, segmentsPerMetre } = spec
  const start = -length / 2 + spec.cabin[0] * length
  const end = -length / 2 + spec.roofEnd * length
  const span = end - start
  const w = width - 0.26
  const geometry = new THREE.BoxGeometry(w, roofHeight, span, Math.ceil(w * segmentsPerMetre), 3, Math.ceil(span * segmentsPerMetre))
  geometry.translate(0, spec.beltHeight + roofHeight / 2, (start + end) / 2)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const rearRake = spec.id === 'wagon' ? 0.12 : 0.55
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    let z = position.getZ(i)
    const lift = (y - spec.beltHeight) / roofHeight
    if (z < start + 0.05) z += 0.62 * lift
    else if (z > end - 0.05) z -= rearRake * lift
    position.setXYZ(i, x * (1 - lift * 0.05), y, z)
  }
  return geometry
}

function bumper(spec: BodySpec, front: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(spec.width * 0.98, 0.18, 0.16)
  geometry.translate(0, spec.beltHeight - spec.bodyHeight + 0.16, (front ? -1 : 1) * (spec.length / 2 + 0.03))
  return geometry
}

function windowOpening(spec: BodySpec, side: 'left' | 'right' | 'front' | 'back'): THREE.BufferGeometry {
  const { length, width, roofHeight } = spec
  const start = -length / 2 + spec.cabin[0] * length
  const end = -length / 2 + spec.roofEnd * length
  const y = spec.beltHeight + roofHeight * 0.55
  if (side === 'left' || side === 'right') {
    const geometry = new THREE.BoxGeometry(0.06, roofHeight * 0.74, (end - start) * 0.92)
    geometry.translate((side === 'left' ? -1 : 1) * (width / 2 - 0.145), y, (start + end) / 2 + 0.1)
    return geometry
  }
  const geometry = new THREE.BoxGeometry(width - 0.5, roofHeight * 0.74, 0.06)
  const z = side === 'front' ? start + 0.3 : end - (spec.id === 'wagon' ? 0.06 : 0.3)
  geometry.translate(0, y + 0.02, z)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const rake = side === 'front' ? 0.62 : spec.id === 'wagon' ? 0.12 : 0.55
  for (let i = 0; i < position.count; i++) {
    const lift = (position.getY(i) - spec.beltHeight) / roofHeight
    position.setZ(i, position.getZ(i) + (side === 'front' ? 1 : -1) * rake * lift)
  }
  return geometry
}

function decalPlane(width: number, height: number): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(width, height, 12, 6)
}

function weatherColors(geometry: THREE.BufferGeometry, seed: number, sillLine: number): Float32Array {
  const position = geometry.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const grime = 0.86 + 0.14 * hashNoise(position.getX(i) * 3 + seed, position.getY(i) * 5, position.getZ(i) * 2)
    const low = position.getY(i) < sillLine ? 0.9 : 1
    const value = grime * low
    colors[i * 3] = value
    colors[i * 3 + 1] = value
    colors[i * 3 + 2] = value
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return colors
}

export function createCar(spec: BodySpec, look: CarLook, seed = 0): CarModel {
  const root = new THREE.Group()
  root.name = `car-${look.number}`
  const paintHex = paintById(look.paint).hex
  const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(paintHex), roughness: 0.94, metalness: 0.02, vertexColors: true, flatShading: false })
  const shellGeometry = mergeGeometries([lowerBody(spec), greenhouse(spec)], false)
  if (!shellGeometry) throw new Error('Could not build the car shell')
  shellGeometry.translate(0, -spec.centreHeight, 0)
  shellGeometry.computeVertexNormals()
  const shellColors = weatherColors(shellGeometry, seed, spec.beltHeight - spec.bodyHeight + 0.16 - spec.centreHeight)
  const body = new THREE.Mesh(shellGeometry, paint)
  body.name = 'shell'
  body.castShadow = true
  body.receiveShadow = true
  root.add(body)

  const trim = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8f9398'), roughness: 0.55, metalness: 0.6 })
  const bumperGeometry = mergeGeometries([bumper(spec, true), bumper(spec, false)], false) ?? bumper(spec, true)
  bumperGeometry.translate(0, -spec.centreHeight, 0)
  const bumpers = new THREE.Mesh(bumperGeometry, trim)
  bumpers.castShadow = true
  root.add(bumpers)

  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d0f12'), roughness: 0.9, metalness: 0 })
  const openings = mergeGeometries([windowOpening(spec, 'left'), windowOpening(spec, 'right'), windowOpening(spec, 'front'), windowOpening(spec, 'back')], false)
  if (openings) {
    openings.translate(0, -spec.centreHeight, 0)
    root.add(new THREE.Mesh(openings, dark))
  }

  const cageMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2d33'), roughness: 0.7, metalness: 0.3 })
  const cageLength = (spec.roofEnd - spec.cabin[0]) * spec.length * 0.75
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, cageLength, 6), cageMaterial)
  cage.rotation.x = Math.PI / 2
  cage.position.set(0, spec.beltHeight + spec.roofHeight * 0.5 - spec.centreHeight, -spec.length / 2 + (spec.cabin[0] + spec.roofEnd) / 2 * spec.length)
  root.add(cage)

  const decals: THREE.Mesh[] = []
  const deformables: Deformable[] = [{ geometry: shellGeometry, original: Float32Array.from(shellGeometry.attributes.position.array as Float32Array), colors: shellColors }]
  const sideArt = paintNumber(look, 'side')
  const roofArt = paintNumber(look, 'roof')
  const doorWidth = Math.min(2.2, (spec.cabin[1] - spec.cabin[0]) * spec.length * 0.78)
  const doorHeight = spec.bodyHeight * 0.82
  const doorZ = -spec.length / 2 + (spec.cabin[0] + 0.03) * spec.length + doorWidth / 2
  const doorY = spec.beltHeight - spec.bodyHeight / 2 + 0.02
  for (const side of [-1, 1] as const) {
    const geometry = decalPlane(doorWidth, doorHeight)
    geometry.rotateY(side < 0 ? -Math.PI / 2 : Math.PI / 2)
    geometry.translate(side * (spec.width / 2 + 0.012), doorY - spec.centreHeight, doorZ)
    const material = new THREE.MeshStandardMaterial({ map: sideArt.texture, transparent: true, roughness: 0.95, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    const decal = new THREE.Mesh(geometry, material)
    decal.name = `decal-${side < 0 ? 'left' : 'right'}`
    decal.renderOrder = 2
    root.add(decal)
    decals.push(decal)
    deformables.push({ geometry, original: Float32Array.from(geometry.attributes.position.array as Float32Array), colors: null })
  }
  const roofSize = Math.min(spec.width - 0.6, 1.4)
  const roofGeometry = decalPlane(roofSize, roofSize)
  roofGeometry.rotateX(-Math.PI / 2)
  roofGeometry.rotateY(Math.PI / 2)
  roofGeometry.translate(0, spec.beltHeight + spec.roofHeight + 0.012 - spec.centreHeight, cage.position.z)
  const roofMaterial = new THREE.MeshStandardMaterial({ map: roofArt.texture, transparent: true, roughness: 0.95, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  const roofDecal = new THREE.Mesh(roofGeometry, roofMaterial)
  roofDecal.name = 'decal-roof'
  roofDecal.renderOrder = 2
  root.add(roofDecal)
  decals.push(roofDecal)
  deformables.push({ geometry: roofGeometry, original: Float32Array.from(roofGeometry.attributes.position.array as Float32Array), colors: null })

  const tire = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a1a1a'), roughness: 0.95, metalness: 0 })
  const rim = new THREE.MeshStandardMaterial({ color: new THREE.Color(seed % 3 === 0 ? '#c8c8c8' : '#4a4a4a'), roughness: 0.6, metalness: 0.35 })
  const wheelGeometry = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, spec.wheelWidth, 20)
  wheelGeometry.rotateZ(Math.PI / 2)
  const rimGeometry = new THREE.CylinderGeometry(spec.wheelRadius * 0.58, spec.wheelRadius * 0.58, spec.wheelWidth + 0.02, 12)
  rimGeometry.rotateZ(Math.PI / 2)
  const wheels: THREE.Mesh[] = []
  for (let i = 0; i < 4; i++) {
    const wheel = new THREE.Mesh(wheelGeometry, tire)
    wheel.add(new THREE.Mesh(rimGeometry, rim))
    wheel.castShadow = true
    wheel.name = `wheel-${i}`
    root.add(wheel)
    wheels.push(wheel)
  }

  const dent = (point: THREE.Vector3, direction: THREE.Vector3, strength: number, dentSpec: DentSpec): void => {
    const radius = dentSpec.radius * (0.6 + 0.4 * strength)
    const depth = dentSpec.depth * strength
    for (const part of deformables) {
      const position = part.geometry.attributes.position as THREE.BufferAttribute
      const array = position.array as Float32Array
      for (let i = 0; i < position.count; i++) {
        const ox = part.original[i * 3]
        const oy = part.original[i * 3 + 1]
        const oz = part.original[i * 3 + 2]
        const distance = scratch.set(array[i * 3] - point.x, array[i * 3 + 1] - point.y, array[i * 3 + 2] - point.z).length()
        if (distance >= radius) continue
        const falloff = smoothstep(1 - distance / radius)
        const push = depth * falloff
        let nx = array[i * 3] + direction.x * push
        let ny = array[i * 3 + 1] + direction.y * push * 0.35
        let nz = array[i * 3 + 2] + direction.z * push
        const dx = nx - ox
        const dy = ny - oy
        const dz = nz - oz
        const moved = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (moved > dentSpec.maxDepth) {
          const scale = dentSpec.maxDepth / moved
          nx = ox + dx * scale
          ny = oy + dy * scale
          nz = oz + dz * scale
        }
        array[i * 3] = nx
        array[i * 3 + 1] = ny
        array[i * 3 + 2] = nz
        if (part.colors) {
          const shade = 1 - dentSpec.darken * falloff * strength
          const rustR = 0.55 + 0.45 * shade
          part.colors[i * 3] = Math.max(0.2, part.colors[i * 3] * rustR)
          part.colors[i * 3 + 1] = Math.max(0.15, part.colors[i * 3 + 1] * shade)
          part.colors[i * 3 + 2] = Math.max(0.12, part.colors[i * 3 + 2] * shade * 0.95)
        }
      }
      position.needsUpdate = true
      if (part.colors) (part.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
      part.geometry.computeVertexNormals()
      part.geometry.computeBoundingSphere()
    }
  }

  const dispose = (): void => {
    root.removeFromParent()
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        const map = (material as THREE.MeshStandardMaterial).map
        map?.dispose()
        material.dispose()
      }
    })
  }

  return { root, body, decals, wheels, paint, dent, dispose }
}
