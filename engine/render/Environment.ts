/** Background, fog and image-based lighting for a scene. `bakeEnvironment` prefilters any scene (a sky dome, a park HDRI stand-in) into a PMREM so physically based materials reflect it. */
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

export interface BakedEnvironment {
  readonly texture: THREE.Texture | null
  dispose(): void
}

/** Prefilters `source` into a PMREM and installs it as `scene.environment` at `intensity`. Returns a no-op handle if the backend cannot bake. */
export function bakeEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene, source: THREE.Scene, intensity = 1): BakedEnvironment {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer)
    const target = pmrem.fromScene(source, 0, 0.1, 1000)
    scene.environment = target.texture
    ;(scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = intensity
    return {
      texture: target.texture,
      dispose() {
        if (scene.environment === target.texture) scene.environment = null
        target.dispose()
        pmrem.dispose()
      },
    }
  } catch (error) {
    console.warn('[engine] environment bake failed', error)
    return { texture: null, dispose() {} }
  }
}
