/** Background, fog and (from Phase 3) image-based lighting for a scene; the signature is final, the body is a stub. */
import * as THREE from 'three/webgpu'
import type { EnvironmentConfig } from '../config'

export interface EnvironmentHandle {
  setBackground(color: string): void
  dispose(): void
}

export function applyEnvironment(scene: THREE.Scene, config: EnvironmentConfig): EnvironmentHandle {
  scene.background = new THREE.Color(config.background)
  scene.fog = new THREE.Fog(new THREE.Color(config.fogColor), config.fogNear, config.fogFar)
  return {
    setBackground(color) {
      scene.background = new THREE.Color(color)
    },
    dispose() {
      scene.background = null
      scene.environment = null
      scene.fog = null
    },
  }
}
