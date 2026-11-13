import type { Scene } from '@babylonjs/core/scene'
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

export const VIEW_LAYER = 1
const TRACER_POOL = 24
const TRACER_LIFE = 0.06
const FLASH_LIFE = 0.05

interface Tracer {
  mesh: Mesh
  life: number
}

function glowTexture(scene: Scene, name: string, inner: string, outer: string): DynamicTexture {
  const texture = new DynamicTexture(name, { width: 64, height: 64 }, scene, false)
  const context = texture.getContext() as CanvasRenderingContext2D
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, inner)
  gradient.addColorStop(0.35, outer)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  texture.hasAlpha = true
  texture.update()
  return texture
}

export class WeaponEffects {
  private readonly flash: ParticleSystem
  private readonly sparks: ParticleSystem
  private readonly light: PointLight
  private readonly tracers: Tracer[] = []
  private readonly flashOrigin = new Vector3()
  private readonly sparkOrigin = new Vector3()
  private nextTracer = 0
  private lightLife = 0

  constructor(scene: Scene) {
    const flashTexture = glowTexture(scene, 'muzzle-flash', 'rgba(255,255,240,1)', 'rgba(255,170,60,0.85)')
    this.flash = new ParticleSystem('muzzle-flash', 40, scene)
    this.flash.particleTexture = flashTexture
    this.flash.emitter = this.flashOrigin
    this.flash.minEmitBox = new Vector3(-0.01, -0.01, -0.01)
    this.flash.maxEmitBox = new Vector3(0.01, 0.01, 0.01)
    this.flash.color1 = new Color4(1, 0.95, 0.8, 1)
    this.flash.color2 = new Color4(1, 0.65, 0.25, 1)
    this.flash.colorDead = new Color4(1, 0.3, 0, 0)
    this.flash.minSize = 0.06
    this.flash.maxSize = 0.2
    this.flash.minLifeTime = 0.03
    this.flash.maxLifeTime = FLASH_LIFE
    this.flash.minEmitPower = 0.4
    this.flash.maxEmitPower = 2.2
    this.flash.updateSpeed = 0.016
    this.flash.emitRate = 0
    this.flash.blendMode = ParticleSystem.BLENDMODE_ADD
    this.flash.renderingGroupId = VIEW_LAYER
    this.flash.start()

    const sparkTexture = glowTexture(scene, 'impact-spark', 'rgba(255,255,255,1)', 'rgba(255,200,120,0.8)')
    this.sparks = new ParticleSystem('impact-sparks', 160, scene)
    this.sparks.particleTexture = sparkTexture
    this.sparks.emitter = this.sparkOrigin
    this.sparks.color1 = new Color4(1, 0.9, 0.6, 1)
    this.sparks.color2 = new Color4(1, 0.85, 0.5, 1)
    this.sparks.colorDead = new Color4(0.6, 0.3, 0.1, 0)
    this.sparks.minSize = 0.03
    this.sparks.maxSize = 0.09
    this.sparks.minLifeTime = 0.12
    this.sparks.maxLifeTime = 0.35
    this.sparks.minEmitPower = 2
    this.sparks.maxEmitPower = 6
    this.sparks.gravity = new Vector3(0, -12, 0)
    this.sparks.updateSpeed = 0.016
    this.sparks.emitRate = 0
    this.sparks.blendMode = ParticleSystem.BLENDMODE_ADD
    this.sparks.start()

    this.light = new PointLight('muzzle-light', Vector3.Zero(), scene)
    this.light.diffuse = new Color3(1, 0.7, 0.35)
    this.light.specular = new Color3(1, 0.7, 0.35)
    this.light.range = 7
    this.light.intensity = 0

    const tracerMaterial = new StandardMaterial('tracer', scene)
    tracerMaterial.disableLighting = true
    tracerMaterial.emissiveColor = new Color3(1, 0.85, 0.45)
    tracerMaterial.alpha = 0.75
    for (let index = 0; index < TRACER_POOL; index++) {
      const mesh = MeshBuilder.CreateBox(`tracer-${index}`, { width: 0.012, height: 0.012, depth: 1 }, scene)
      mesh.material = tracerMaterial
      mesh.isPickable = false
      mesh.setEnabled(false)
      this.tracers.push({ mesh, life: 0 })
    }
  }

  muzzle(position: Vector3, direction: Vector3): void {
    this.flashOrigin.copyFrom(position)
    this.flash.direction1 = direction.scale(0.6).addInPlaceFromFloats(-0.25, -0.25, -0.25)
    this.flash.direction2 = direction.scale(1).addInPlaceFromFloats(0.25, 0.25, 0.25)
    this.flash.manualEmitCount = 10
    this.light.position.copyFrom(position)
    this.light.intensity = 1.6
    this.lightLife = FLASH_LIFE
  }

  impact(position: Vector3, normal: Vector3 | null, player: boolean): void {
    this.sparkOrigin.copyFrom(position)
    const n = normal ?? Vector3.Up()
    this.sparks.direction1 = n.add(new Vector3(-0.6, -0.2, -0.6))
    this.sparks.direction2 = n.add(new Vector3(0.6, 0.8, 0.6))
    this.sparks.color1 = player ? new Color4(1, 0.35, 0.3, 1) : new Color4(1, 0.9, 0.6, 1)
    this.sparks.manualEmitCount = player ? 18 : 10
  }

  tracer(from: Vector3, to: Vector3): void {
    const length = Vector3.Distance(from, to)
    if (length < 0.5) return
    const tracer = this.tracers[this.nextTracer]
    this.nextTracer = (this.nextTracer + 1) % this.tracers.length
    tracer.mesh.setEnabled(true)
    tracer.mesh.position.copyFrom(from).addInPlace(to).scaleInPlace(0.5)
    tracer.mesh.scaling.set(1, 1, length)
    tracer.mesh.lookAt(to)
    tracer.life = TRACER_LIFE
  }

  update(dt: number): void {
    if (this.lightLife > 0) {
      this.lightLife -= dt
      this.light.intensity = this.lightLife > 0 ? 1.6 * (this.lightLife / FLASH_LIFE) : 0
    }
    for (const tracer of this.tracers) {
      if (tracer.life <= 0) continue
      tracer.life -= dt
      if (tracer.life <= 0) tracer.mesh.setEnabled(false)
    }
  }
}
