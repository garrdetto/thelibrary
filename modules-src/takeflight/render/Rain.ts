/**
 * Rain around the camera: thin-instanced streaks in a 60 m box that falls at 9 m/s and drifts with the wind and against the
 * aircraft's motion, wrapping inside the box so the drops never run out. Intensity 0..1 picks how many of the instances draw.
 * Unlit, translucent, matte. One buffer update per frame; nothing allocated after construction.
 */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { QualityTier } from './Quality'

const BOX = 60
const FALL = 9
const HALF = BOX / 2
const wrap = (value: number) => ((value % BOX) + BOX) % BOX - HALF
const MAX_DROPS: Record<QualityTier, number> = { low: 700, medium: 1200, high: 1800, ultra: 2400 }

export class Rain {
  private readonly mesh: Mesh
  private readonly material: StandardMaterial
  private readonly offsets: Float32Array
  private readonly matrices: Float32Array
  private readonly capacity: number
  private max: number
  private phaseX = 0
  private phaseY = 0
  private phaseZ = 0

  constructor(scene: Scene, tier: QualityTier) {
    this.capacity = MAX_DROPS.ultra
    this.max = MAX_DROPS[tier]
    this.mesh = CreatePlane('takeflight-rain', { width: 0.03, height: 1.1 }, scene)
    this.material = new StandardMaterial('takeflight-rain', scene)
    this.material.disableLighting = true
    this.material.emissiveColor = new Color3(0.7, 0.74, 0.8)
    this.material.diffuseColor = Color3.Black()
    this.material.specularColor = Color3.Black()
    this.material.alpha = 0.28
    this.material.backFaceCulling = false
    this.mesh.material = this.material
    this.mesh.isPickable = false
    this.mesh.alwaysSelectAsActiveMesh = true
    this.mesh.applyFog = false
    this.offsets = new Float32Array(this.capacity * 3)
    let seed = 12345
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let i = 0; i < this.offsets.length; i++) this.offsets[i] = next() * BOX
    this.matrices = new Float32Array(this.capacity * 16)
    for (let i = 0; i < this.capacity; i++) {
      const o = i * 16
      this.matrices[o] = 1
      this.matrices[o + 5] = 1
      this.matrices[o + 10] = 1
      this.matrices[o + 15] = 1
    }
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false)
    this.mesh.thinInstanceCount = 0
    this.mesh.isVisible = false
  }

  setQuality(tier: QualityTier): void {
    this.max = MAX_DROPS[tier]
  }

  /** `intensity` 0..1; the eye in scene coordinates; air velocity relative to the camera (wind minus aircraft), m/s. */
  update(intensity: number, eyeX: number, eyeY: number, eyeZ: number, airX: number, airZ: number, dt: number): void {
    const count = Math.round(this.max * Math.max(0, Math.min(1, intensity)))
    this.mesh.isVisible = count > 0
    if (count === 0) return
    this.phaseX = (this.phaseX + airX * dt) % BOX
    this.phaseY = (this.phaseY - FALL * dt) % BOX
    this.phaseZ = (this.phaseZ + airZ * dt) % BOX
    const speed = Math.sqrt(airX * airX + airZ * airZ + FALL * FALL)
    const lean = Math.min(1.2, Math.sqrt(airX * airX + airZ * airZ) / FALL)
    const stretch = Math.min(4, speed / FALL)
    const ux = speed > 0 ? airX / speed : 0
    const uy = speed > 0 ? -FALL / speed : -1
    const uz = speed > 0 ? airZ / speed : 0
    for (let i = 0; i < count; i++) {
      const o = i * 3
      const m = i * 16
      this.matrices[m + 4] = ux * stretch
      this.matrices[m + 5] = uy * stretch
      this.matrices[m + 6] = uz * stretch
      this.matrices[m + 12] = eyeX + wrap(this.offsets[o] + this.phaseX)
      this.matrices[m + 13] = eyeY + wrap(this.offsets[o + 1] + this.phaseY)
      this.matrices[m + 14] = eyeZ + wrap(this.offsets[o + 2] + this.phaseZ)
    }
    this.material.alpha = 0.26 + 0.2 * intensity * (1 - lean * 0.3)
    this.mesh.thinInstanceCount = count
    this.mesh.thinInstanceBufferUpdated('matrix')
  }

  dispose(): void {
    this.mesh.dispose()
    this.material.dispose()
  }
}
