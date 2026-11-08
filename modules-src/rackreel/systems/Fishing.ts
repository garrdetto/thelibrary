import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { EngineContext } from '../core/EngineSetup'
import type { ModelTemplate } from '../core/ModelLibrary'
import { lakeCoord, marshWeight } from '../world/Terrain'
import type { Terrain } from '../world/Terrain'
import { bufferedSine } from './Waves'
import type { Habitat, LootTableManager, Specimen } from './LootTableManager'
import { SPECIES_BY_ID } from './LootTableManager'
import type { ReelSnapshot, SkillCheckManager } from './SkillCheckManager'

export type FishingState = 'idle' | 'charging' | 'flying' | 'waiting' | 'bite' | 'reeling' | 'retrieving'

export type FishingEvent =
  | { type: 'cast'; distance: number }
  | { type: 'splash'; inWater: boolean; habitat: Habitat | null }
  | { type: 'bite' }
  | { type: 'missed' }
  | { type: 'hooked'; specimen: Specimen }
  | { type: 'landed'; specimen: Specimen }
  | { type: 'lost'; reason: 'snapped' | 'thrown' }
  | { type: 'reeled-in' }

const LINE_POINTS = 16
const BITE_WINDOW = 1.7

export class Fishing {
  state: FishingState = 'idle'
  power = 0
  habitat: Habitat | null = null
  hooked: Specimen | null = null
  reel: ReelSnapshot | null = null
  private bobber: InstancedMesh
  private line: LinesMesh
  private linePoints: Vector3[] = []
  private from = new Vector3()
  private target = new Vector3()
  private landing = new Vector3()
  private flight = 0
  private flightTime = 0.9
  private biteTime = 0
  private clock = 0
  private chargeDir = 1
  onEvent: ((event: FishingEvent) => void) | null = null

  constructor(ctx: EngineContext, scene: Scene, private readonly terrain: Terrain, private readonly loot: LootTableManager, private readonly skill: SkillCheckManager, bobberModel: ModelTemplate) {
    const src = bobberModel.parts.get('bobber')!.mesh
    src.setEnabled(true)
    src.isVisible = false
    this.bobber = src.createInstance('bobber')
    this.bobber.isPickable = false
    this.bobber.setEnabled(false)
    ctx.registerDynamic(this.bobber)
    for (let i = 0; i < LINE_POINTS; i++) this.linePoints.push(new Vector3())
    this.line = CreateLines('line', { points: this.linePoints, updatable: true }, scene)
    this.line.color = new Color3(0.85, 0.88, 0.8)
    this.line.alpha = 0.75
    this.line.isPickable = false
    this.line.setEnabled(false)
    this.line.alwaysSelectAsActiveMesh = true
    ctx.registerDynamic(this.line)
  }

  get lineInWater(): boolean {
    return this.state === 'waiting' || this.state === 'bite'
  }

  get busy(): boolean {
    return this.state !== 'idle'
  }

  startCharge(): void {
    if (this.state !== 'idle') return
    this.state = 'charging'
    this.power = 0.15
    this.chargeDir = 1
  }

  release(rodTip: Vector3, direction: Vector3): void {
    if (this.state !== 'charging') return
    const flat = new Vector3(direction.x, 0, direction.z)
    if (flat.lengthSquared() < 1e-4) flat.set(0, 0, 1)
    flat.normalize()
    const distance = 7 + this.power * 33
    this.from.copyFrom(rodTip)
    this.target.set(rodTip.x + flat.x * distance, 0, rodTip.z + flat.z * distance)
    this.target.y = Math.max(0, this.terrain.heightAt(this.target.x, this.target.z))
    this.flightTime = 0.55 + this.power * 0.6
    this.flight = 0
    this.state = 'flying'
    this.bobber.setEnabled(true)
    this.line.setEnabled(true)
    this.onEvent?.({ type: 'cast', distance })
  }

  cancel(): void {
    if (this.state === 'waiting' || this.state === 'bite' || this.state === 'flying') {
      this.state = 'retrieving'
      this.flight = 0
      this.landing.copyFrom(this.bobber.position)
    } else if (this.state === 'charging') {
      this.state = 'idle'
    }
  }

  habitatAt(x: number, z: number): Habitat {
    const depth = this.terrain.depthAt(x, z)
    const { s, angle } = lakeCoord(x, z)
    if (marshWeight(angle) > 0.35 && s > 0.8) return 'marsh'
    if (this.terrain.slopeAt(x, z) > 0.18 && depth < 8) return 'rocks'
    if (depth > 6.5) return 'deep'
    return 'weeds'
  }

  bite(): boolean {
    if (this.state !== 'waiting') return false
    this.state = 'bite'
    this.biteTime = BITE_WINDOW
    this.onEvent?.({ type: 'bite' })
    return true
  }

  setHook(): boolean {
    if (this.state !== 'bite') return false
    const habitat = this.habitatAt(this.bobber.position.x, this.bobber.position.z)
    const species = this.loot.pickSpecies('fish', habitat)
    const specimen = this.loot.createSpecimen(species.id)
    const template = SPECIES_BY_ID[species.id]
    const sizeFactor = (specimen.value - template.min) / Math.max(1e-6, template.max - template.min)
    const fight = template.fight * (0.65 + Math.min(1.4, sizeFactor) * 0.55) * (specimen.legendary ? 1.25 : 1)
    this.hooked = specimen
    this.skill.beginReel(fight)
    this.landing.copyFrom(this.bobber.position)
    this.state = 'reeling'
    this.onEvent?.({ type: 'hooked', specimen })
    return true
  }

  update(dt: number, rodTip: Vector3, holdingReel: boolean): void {
    this.clock += dt
    if (this.state === 'charging') {
      this.power += this.chargeDir * dt * 0.85
      if (this.power >= 1) {
        this.power = 1
        this.chargeDir = -1
      } else if (this.power <= 0.15) {
        this.power = 0.15
        this.chargeDir = 1
      }
    } else if (this.state === 'flying') {
      this.flight += dt
      const t = Math.min(1, this.flight / this.flightTime)
      const p = Vector3.Lerp(this.from, this.target, t)
      p.y += Math.sin(t * Math.PI) * (2.5 + this.power * 5)
      this.bobber.position.copyFrom(p)
      if (t >= 1) {
        const inWater = this.terrain.depthAt(this.target.x, this.target.z) > 0.6
        this.habitat = inWater ? this.habitatAt(this.target.x, this.target.z) : null
        this.onEvent?.({ type: 'splash', inWater, habitat: this.habitat })
        this.landing.copyFrom(this.target)
        if (inWater) this.state = 'waiting'
        else {
          this.state = 'retrieving'
          this.flight = 0
        }
      }
    } else if (this.state === 'waiting' || this.state === 'bite') {
      const bob = bufferedSine(this.clock * 2.1) * 0.02
      let dip = 0
      if (this.state === 'bite') {
        this.biteTime -= dt
        dip = -0.08 - Math.abs(bufferedSine(this.clock * 13)) * 0.09
        if (this.biteTime <= 0) {
          this.state = 'waiting'
          this.onEvent?.({ type: 'missed' })
        }
      }
      this.bobber.position.set(this.landing.x, bob + dip, this.landing.z)
    } else if (this.state === 'reeling') {
      this.skill.setHolding(holdingReel)
      const snap = this.skill.updateReel(dt)
      this.reel = snap
      const near = new Vector3(rodTip.x, 0, rodTip.z)
      const toNear = near.subtract(this.landing)
      const along = Vector3.Lerp(this.landing, near, Math.min(0.92, snap.progress / 100))
      const side = new Vector3(-toNear.z, 0, toNear.x).normalize()
      const swim = bufferedSine(this.clock * 0.9) * 2.4 * (1 - snap.progress / 110)
      along.addInPlace(side.scale(swim))
      along.y = -0.05 + bufferedSine(this.clock * 6) * 0.04 - (snap.tension / 100) * 0.12
      if (this.terrain.depthAt(along.x, along.z) < 0.15) along.y = Math.max(along.y, this.terrain.heightAt(along.x, along.z))
      this.bobber.position.copyFrom(along)
      if (snap.outcome === 'landed') {
        const specimen = this.hooked!
        this.finish()
        this.onEvent?.({ type: 'landed', specimen })
      } else if (snap.outcome === 'snapped' || snap.outcome === 'thrown') {
        this.finish()
        this.onEvent?.({ type: 'lost', reason: snap.outcome })
      }
    } else if (this.state === 'retrieving') {
      this.flight += dt
      const t = Math.min(1, this.flight / 0.7)
      const p = Vector3.Lerp(this.landing, rodTip, t)
      p.y += Math.sin(t * Math.PI) * 1.2
      this.bobber.position.copyFrom(p)
      if (t >= 1) {
        this.finish()
        this.onEvent?.({ type: 'reeled-in' })
      }
    }
    if (this.line.isEnabled()) this.updateLine(rodTip)
  }

  private finish(): void {
    this.state = 'idle'
    this.hooked = null
    this.reel = null
    this.skill.reset()
    this.bobber.setEnabled(false)
    this.line.setEnabled(false)
  }

  private updateLine(rodTip: Vector3): void {
    const end = this.bobber.position
    const tension = this.state === 'reeling' ? (this.reel?.tension ?? 50) / 100 : this.state === 'flying' ? 0.6 : 0.15
    const sag = (1 - tension) * Math.min(4, Vector3.Distance(rodTip, end) * 0.12)
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / (LINE_POINTS - 1)
      const p = this.linePoints[i]
      Vector3.LerpToRef(rodTip, end, t, p)
      p.y -= Math.sin(t * Math.PI) * sag
      if (p.y < end.y && t > 0.5) p.y = Math.max(p.y, end.y - 0.02)
    }
    this.line = CreateLines('line', { points: this.linePoints, instance: this.line })
  }
}
