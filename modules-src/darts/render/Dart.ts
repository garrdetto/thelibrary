/** A steel-tip dart modelled from lathe profiles: polished point, knurled tungsten barrel, anodised shaft and four printed flights in the thrower's colour. The tip sits at the origin and the dart points along −z, so orienting it to a velocity is one quaternion. */
import * as THREE from 'three/webgpu'

export interface DartKit {
  create(color: string): THREE.Group
  dispose(): void
}

const AXIS = new THREE.Vector3(0, 0, -1)

/** Lathe a radius profile (pairs of [distance from the tip, radius] in metres) into a mesh along +z. */
function lathe(profile: [number, number][], segments: number): THREE.BufferGeometry {
  const points = profile.map(([along, radius]) => new THREE.Vector2(radius, along))
  const geometry = new THREE.LatheGeometry(points, segments)
  geometry.rotateX(Math.PI / 2)
  return geometry
}

function barrelProfile(): [number, number][] {
  const profile: [number, number][] = [[0.03, 0.0011], [0.033, 0.0026], [0.036, 0.0032]]
  const start = 0.038
  const grooves = 14
  for (let i = 0; i < grooves; i++) {
    const at = start + i * 0.0026
    profile.push([at, 0.0034], [at + 0.0013, 0.0034], [at + 0.0016, 0.0029], [at + 0.0023, 0.0029])
  }
  const end = start + grooves * 0.0026
  profile.push([end + 0.001, 0.0033], [end + 0.004, 0.0028], [end + 0.006, 0.0017])
  return profile
}

function flightShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.0017)
  shape.lineTo(0.0, 0.0045)
  shape.quadraticCurveTo(0.012, 0.0175, 0.033, 0.0185)
  shape.lineTo(0.036, 0.0172)
  shape.lineTo(0.036, 0.0017)
  shape.lineTo(0, 0.0017)
  return shape
}

export function createDartKit(): DartKit {
  const pointGeometry = lathe([[0, 0], [0.002, 0.0006], [0.012, 0.00095], [0.028, 0.0011], [0.0305, 0.0011]], 12)
  const barrelGeometry = lathe(barrelProfile(), 28)
  const shaftGeometry = lathe([[0.0755, 0.0016], [0.078, 0.0018], [0.12, 0.0018], [0.123, 0.0021], [0.126, 0.0016]], 16)
  const finGeometry = new THREE.ShapeGeometry(flightShape(), 6)
  finGeometry.rotateY(-Math.PI / 2)
  finGeometry.translate(0, 0, 0.119)
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9ced6'), metalness: 1, roughness: 0.18 })
  const tungsten = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8b9097'), metalness: 1, roughness: 0.32 })
  const shaft = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1f26'), metalness: 0.6, roughness: 0.3 })
  const flightMaterials = new Map<string, THREE.MeshStandardMaterial>()
  const flightMaterial = (color: string) => {
    let material = flightMaterials.get(color)
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0, roughness: 0.42, side: THREE.DoubleSide })
      flightMaterials.set(color, material)
    }
    return material
  }

  return {
    create(color) {
      const group = new THREE.Group()
      group.name = 'dart'
      const parts = [new THREE.Mesh(pointGeometry, steel), new THREE.Mesh(barrelGeometry, tungsten), new THREE.Mesh(shaftGeometry, shaft)]
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(finGeometry, flightMaterial(color))
        fin.rotation.z = (i * Math.PI) / 2 + Math.PI / 4
        parts.push(fin)
      }
      for (const part of parts) {
        part.castShadow = true
        part.receiveShadow = false
        group.add(part)
      }
      return group
    },
    dispose() {
      pointGeometry.dispose()
      barrelGeometry.dispose()
      shaftGeometry.dispose()
      finGeometry.dispose()
      steel.dispose()
      tungsten.dispose()
      shaft.dispose()
      for (const material of flightMaterials.values()) material.dispose()
    },
  }
}

const scratch = new THREE.Vector3()

/** Points a dart (tip at origin, nose along −z) along a direction. */
export function aimDart(dart: THREE.Object3D, direction: THREE.Vector3 | readonly [number, number, number]): void {
  if (direction instanceof THREE.Vector3) scratch.copy(direction)
  else scratch.set(direction[0], direction[1], direction[2])
  if (scratch.lengthSq() < 1e-9) return
  dart.quaternion.setFromUnitVectors(AXIS, scratch.normalize())
}
