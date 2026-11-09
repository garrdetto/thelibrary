/** Re-renders shadow maps only when something that casts or receives them changed, so a camera that only turns reuses last frame's maps. */
import * as THREE from 'three/webgpu'

type ShadowLight = THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight

interface ShadowNodeHolder {
  shadowNode?: unknown
}

interface LightFlags {
  isDirectionalLight?: boolean
  isSpotLight?: boolean
  isPointLight?: boolean
}

const GROW = 1024

/**
 * Each frame the visible scene is walked once and a signature is written for
 * every shadow light (its matrices and shadow camera) and every shadow caster
 * (id, world matrix, geometry version, instance and morph state, skeleton
 * bones). When the signature matches last frame's, the lights keep their maps
 * (`shadow.autoUpdate = false`); any difference, or `invalidate()`, renders
 * them again. Lights whose shadow follows the view (cascaded shadow nodes)
 * are left on automatic updates. A caster whose vertex shader moves over time
 * (wind sway, cloth, crowds) sets `userData.shadowAnimated = true` so its
 * shadow keeps moving while it is visible.
 */
export class ShadowCache {
  enabled = true
  private current = new Float64Array(GROW)
  private previous = new Float64Array(GROW)
  private length = 0
  private previousLength = -1
  private forced = true
  private tick = 0
  private readonly lights: ShadowLight[] = []
  private readonly managed = new Set<ShadowLight>()

  constructor(private readonly scene: THREE.Scene) {}

  invalidate(): void {
    this.forced = true
  }

  update(): void {
    this.lights.length = 0
    this.length = 0
    this.tick++
    if (!this.enabled) {
      this.release()
      return
    }
    this.scene.traverseVisible(this.visit)
    if (!this.lights.length) {
      this.release()
      return
    }
    let dirty = this.forced || this.length !== this.previousLength
    if (!dirty) {
      const a = this.current
      const b = this.previous
      for (let i = 0; i < this.length; i++) {
        if (a[i] !== b[i]) {
          dirty = true
          break
        }
      }
    }
    for (const light of this.lights) {
      if (!this.managed.has(light)) {
        this.managed.add(light)
        dirty = true
      }
      light.shadow.autoUpdate = false
      if (dirty) light.shadow.needsUpdate = true
    }
    for (const light of this.managed) if (!this.lights.includes(light)) this.restore(light)
    const swap = this.previous
    this.previous = this.current
    this.current = swap
    this.previousLength = this.length
    this.forced = false
  }

  dispose(): void {
    this.release()
  }

  private release(): void {
    for (const light of this.managed) this.restore(light)
    this.previousLength = -1
    this.forced = true
  }

  private restore(light: ShadowLight): void {
    light.shadow.autoUpdate = true
    this.managed.delete(light)
  }

  private push(value: number): void {
    if (this.length === this.current.length) {
      const grown = new Float64Array(this.current.length * 2)
      grown.set(this.current)
      this.current = grown
      const grownPrevious = new Float64Array(grown.length)
      grownPrevious.set(this.previous)
      this.previous = grownPrevious
    }
    this.current[this.length++] = value
  }

  private pushMatrix(matrix: THREE.Matrix4): void {
    const e = matrix.elements
    for (let i = 0; i < 16; i++) this.push(e[i])
  }

  private readonly visit = (node: THREE.Object3D): void => {
    const light = node as ShadowLight
    const flags = node as unknown as LightFlags
    if ((flags.isDirectionalLight || flags.isSpotLight || flags.isPointLight) && light.castShadow && light.shadow) {
      if ((light.shadow as unknown as ShadowNodeHolder).shadowNode) return
      this.lights.push(light)
      this.push(-light.id)
      this.pushMatrix(light.matrixWorld)
      const target = (light as THREE.DirectionalLight).target
      if (target) this.pushMatrix(target.matrixWorld)
      const camera = light.shadow.camera as THREE.OrthographicCamera
      this.push(camera.left ?? 0)
      this.push(camera.right ?? 0)
      this.push(camera.top ?? 0)
      this.push(camera.bottom ?? 0)
      this.push(camera.near)
      this.push(camera.far)
      this.push(light.shadow.mapSize.x)
      this.push(light.shadow.bias)
      return
    }
    if ((node as THREE.Bone).isBone) {
      this.push(node.id)
      this.pushMatrix(node.matrixWorld)
      return
    }
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.castShadow) return
    this.push(mesh.id)
    if (mesh.userData.shadowAnimated) this.push(this.tick)
    this.pushMatrix(mesh.matrixWorld)
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    if (geometry) {
      this.push(geometry.id)
      const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
      this.push(position?.version ?? 0)
      this.push(geometry.drawRange.start)
      this.push(geometry.drawRange.count)
    }
    const material = mesh.material
    this.push(Array.isArray(material) ? material.length : ((material as { id?: number } | undefined)?.id ?? 0))
    const instanced = mesh as THREE.InstancedMesh
    if (instanced.isInstancedMesh) {
      this.push(instanced.count)
      this.push(instanced.instanceMatrix.version)
    }
    const influences = mesh.morphTargetInfluences
    if (influences) for (let i = 0; i < influences.length; i++) this.push(influences[i])
  }
}
