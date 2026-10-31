/** Scene lighting rig (hemisphere fill plus shadow-casting sun); Phase 3 replaces the body, the signature stays. */
import * as THREE from 'three/webgpu'
import type { LightingConfig, QualitySettings } from '../config'

export interface LightingRig {
  hemisphere: THREE.HemisphereLight
  sun: THREE.DirectionalLight
  root: THREE.Group
  follow(target: THREE.Vector3): void
  dispose(): void
}

export function createLighting(config: LightingConfig, quality: QualitySettings): LightingRig {
  const root = new THREE.Group()
  root.name = 'lighting'
  const hemisphere = new THREE.HemisphereLight(new THREE.Color(config.skyColor), new THREE.Color(config.groundColor), config.hemisphereIntensity)
  const sun = new THREE.DirectionalLight(new THREE.Color(config.sunColor), config.sunIntensity)
  const offset = new THREE.Vector3(...config.sunDirection).normalize().multiplyScalar(config.sunDistance)
  sun.position.copy(offset)
  sun.castShadow = quality.shadows
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
  const camera = sun.shadow.camera
  camera.left = -config.shadowExtent
  camera.right = config.shadowExtent
  camera.top = config.shadowExtent
  camera.bottom = -config.shadowExtent
  camera.far = config.sunDistance * 2
  root.add(hemisphere, sun, sun.target)
  return {
    hemisphere,
    sun,
    root,
    follow(target) {
      sun.target.position.copy(target)
      sun.position.copy(target).add(offset)
    },
    dispose() {
      sun.shadow.map?.dispose()
      sun.dispose()
      hemisphere.dispose()
      root.removeFromParent()
    },
  }
}
