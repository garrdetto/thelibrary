/** Darts for both boards: Meshy-made steel-tip and soft-tip models (`/models/darts/dart-steel.glb`, `dart-soft.glb`, fitted by `tools/fit-dart.py`) whose `flight` material takes the thrower's colour (the soft-tip point is straightened and drawn in black plastic by `SoftTip.ts`), with a lathe-built steel-tip dart until they load (or with `?dartModels=0`). The tip sits at the origin and the dart points along −z, so orienting it to a velocity is one quaternion. */
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { BoardStyle } from './BoardTexture'
import { applySoftTip, createSoftTipMaterial } from './SoftTip'

export interface DartKit {
  create(color: string): THREE.Group
  /** Picks the steel-tip or soft-tip set to match the board. */
  setStyle(style: BoardStyle): void
  /** Loads the Meshy models; resolves once they are in use (or failed, keeping the built-in dart). */
  loadModels(): Promise<void>
  /** Changes whenever `create` would build a different dart. */
  readonly version: number
  dispose(): void
}

const MODEL_URLS: Record<BoardStyle, string> = {
  steel: '/models/darts/dart-steel.glb',
  spider: '/models/darts/dart-soft.glb',
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

  const models = new Map<BoardStyle, THREE.Object3D>()
  const modelFlights = new Map<string, THREE.Material>()
  let style: BoardStyle = 'steel'
  let version = 0

  const fromModel = (template: THREE.Object3D, color: string): THREE.Group => {
    const group = new THREE.Group()
    group.name = 'dart'
    const body = template.clone(true)
    body.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = false
      const swap = (material: THREE.Material) => {
        if (material.name !== 'flight') return material
        const key = `${material.uuid}:${color}`
        let tinted = modelFlights.get(key)
        if (!tinted) {
          tinted = material.clone()
          ;(tinted as THREE.MeshStandardMaterial).color?.set(color)
          tinted.side = THREE.DoubleSide
          modelFlights.set(key, tinted)
        }
        return tinted
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
    })
    group.add(body)
    return group
  }

  return {
    get version() {
      return version
    },
    setStyle(next) {
      if (next === style) return
      style = next
      version++
    },
    async loadModels() {
      if (new URLSearchParams(location.search).get('dartModels') === '0') return
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
      await Promise.all(
        (Object.keys(MODEL_URLS) as BoardStyle[]).map(async (key) => {
          try {
            const gltf = await loader.loadAsync(MODEL_URLS[key])
            if (key === 'spider') applySoftTip(gltf.scene, createSoftTipMaterial())
            models.set(key, gltf.scene)
            version++
          } catch (error) {
            console.warn(`Darts: ${key} dart model unavailable, using the built-in dart`, error)
          }
        }),
      )
    },
    create(color) {
      const model = models.get(style)
      if (model) return fromModel(model, color)
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
      for (const material of modelFlights.values()) material.dispose()
      const seen = new Set<object>()
      for (const model of models.values()) {
        model.traverse((node) => {
          const mesh = node as THREE.Mesh
          if (!mesh.isMesh) return
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const item of [mesh.geometry, ...materials]) {
            if (seen.has(item)) continue
            seen.add(item)
            if (item instanceof THREE.Material) {
              for (const value of Object.values(item)) if (value instanceof THREE.Texture) value.dispose()
            }
            item.dispose()
          }
        })
      }
      models.clear()
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
