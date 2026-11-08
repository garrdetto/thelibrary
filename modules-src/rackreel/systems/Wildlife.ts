import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'
import type { EngineContext } from '../core/EngineSetup'
import { disposeRig, instantiate } from '../core/ModelLibrary'
import type { ModelName, ModelRig, ModelTemplate } from '../core/ModelLibrary'
import { PLAY_LIMIT } from '../world/Terrain'
import type { Terrain } from '../world/Terrain'
import type { LootTableManager, SpeciesTemplate, Specimen } from './LootTableManager'

export type AnimalState = 'graze' | 'walk' | 'alert' | 'flee' | 'wounded' | 'down'

export interface Animal {
  id: number
  template: SpeciesTemplate
  specimen: Specimen
  rig: ModelRig
  antlers: ModelRig | null
  position: Vector3
  heading: number
  speed: number
  state: AnimalState
  stateTime: number
  gait: number
  scale: number
  wounds: number
  goal: Vector3
  tagged: boolean
  downTime: number
}

export interface ShotResult {
  animal: Animal | null
  vital: boolean
  distance: number
}

const VITALS: Record<string, { y: number; z: number; r: number }> = { whitetail: { y: 1.05, z: 0.32, r: 0.24 }, blackbear: { y: 0.95, z: 0.3, r: 0.3 } }
const ANTLER_BASE = new Vector3(0, 1.6, 0.84)
const BODY: Record<string, { y: number; z: number; r: number }[]> = {
  whitetail: [{ y: 1.0, z: 0.0, r: 0.42 }, { y: 1.0, z: -0.45, r: 0.36 }, { y: 1.5, z: 0.95, r: 0.22 }],
  blackbear: [{ y: 0.9, z: 0.0, r: 0.55 }, { y: 0.92, z: -0.45, r: 0.5 }, { y: 1.0, z: 0.95, r: 0.3 }],
}

export class Wildlife {
  readonly animals: Animal[] = []
  private nextId = 1
  onLegendSpawn: ((animal: Animal) => void) | null = null
  onLost: ((animal: Animal) => void) | null = null

  constructor(private readonly ctx: EngineContext, private readonly scene: Scene, private readonly terrain: Terrain, private readonly loot: LootTableManager, private readonly models: Map<ModelName, ModelTemplate>, private readonly rng: () => number = Math.random) {}

  spawnNear(player: Vector3, facing: number): Animal | null {
    const template = this.loot.pickSpecies('game', this.terrain.groundAt(player.x, player.z) === 'marsh' ? 'marsh' : 'forest')
    for (let attempt = 0; attempt < 40; attempt++) {
      const dist = 75 + this.rng() * 70
      const ang = facing + (this.rng() - 0.5) * Math.PI * 1.6
      const x = player.x + Math.sin(ang) * dist
      const z = player.z + Math.cos(ang) * dist
      if (Math.abs(x) > PLAY_LIMIT - 20 || Math.abs(z) > PLAY_LIMIT - 20) continue
      const g = this.terrain.groundAt(x, z)
      if (g === 'water' || g === 'rock' || this.terrain.heightAt(x, z) < 0.9) continue
      return this.spawn(template, new Vector3(x, this.terrain.heightAt(x, z), z))
    }
    return null
  }

  spawn(template: SpeciesTemplate, position: Vector3): Animal {
    const specimen = this.loot.createSpecimen(template.id)
    const model = this.models.get(template.model as ModelName)!
    const rig = instantiate(model, null, this.scene, (m) => this.ctx.registerDynamic(m))
    rig.root.rotationQuaternion = new Quaternion()
    let antlers: ModelRig | null = null
    let scale = 1
    if (template.id === 'whitetail') {
      scale = 0.92 + Math.min(0.2, (specimen.weightLb - 130) / 600)
      const head = rig.joints.get('head')!
      antlers = instantiate(this.models.get('antlers')!, head, this.scene, (m) => this.ctx.registerDynamic(m))
      const headPivot = model.parts.get('head')!.pivot
      const s = 0.62 + Math.max(0, specimen.value - 85) / 125 * 0.62
      antlers.root.scaling.setAll(s)
      antlers.root.position.copyFrom(ANTLER_BASE.scale(1 - s).subtract(headPivot))
    } else {
      scale = Math.cbrt(specimen.weightLb / 300) * 1.05
    }
    rig.root.scaling.setAll(scale)
    const animal: Animal = {
      id: this.nextId++, template, specimen, rig, antlers, position, heading: this.rng() * Math.PI * 2, speed: 0, state: 'graze', stateTime: 2 + this.rng() * 5,
      gait: 0, scale, wounds: 0, goal: position.clone(), tagged: false, downTime: 0,
    }
    this.animals.push(animal)
    if (specimen.legendary) this.onLegendSpawn?.(animal)
    return animal
  }

  casters(): import('@babylonjs/core/Meshes/abstractMesh').AbstractMesh[] {
    const out = []
    for (const a of this.animals) {
      out.push(...a.rig.meshes)
      if (a.antlers) out.push(...a.antlers.meshes)
    }
    return out
  }

  remove(animal: Animal): void {
    const i = this.animals.indexOf(animal)
    if (i >= 0) this.animals.splice(i, 1)
    if (animal.antlers) disposeRig(animal.antlers, (m) => this.ctx.unregisterDynamic(m))
    disposeRig(animal.rig, (m) => this.ctx.unregisterDynamic(m))
  }

  alertAll(origin: Vector3, radius: number): void {
    for (const a of this.animals) {
      if (a.state === 'down') continue
      if (Vector3.Distance(a.position, origin) < radius) this.flee(a, origin)
    }
  }

  private flee(a: Animal, from: Vector3): void {
    a.state = a.wounds > 0 ? 'wounded' : 'flee'
    a.stateTime = 7 + this.rng() * 5
    const away = a.position.subtract(from)
    away.y = 0
    a.heading = Math.atan2(away.x, away.z) + (this.rng() - 0.5) * 0.6
  }

  shoot(origin: Vector3, direction: Vector3, maxDistance: number): ShotResult {
    let best: ShotResult = { animal: null, vital: false, distance: maxDistance }
    for (const a of this.animals) {
      if (a.state === 'down') continue
      const c = Math.cos(a.heading)
      const s = Math.sin(a.heading)
      const test = (y: number, z: number, r: number): number | null => {
        const center = new Vector3(a.position.x + z * s * a.scale, a.position.y + y * a.scale, a.position.z + z * c * a.scale)
        const oc = origin.subtract(center)
        const b = Vector3.Dot(oc, direction)
        const disc = b * b - (oc.lengthSquared() - (r * a.scale) ** 2)
        if (disc < 0) return null
        const t = -b - Math.sqrt(disc)
        return t > 0 ? t : null
      }
      const v = VITALS[a.template.id]
      const tv = test(v.y, v.z, v.r)
      if (tv !== null && tv < best.distance) best = { animal: a, vital: true, distance: tv }
      for (const part of BODY[a.template.id]) {
        const tb = test(part.y, part.z, part.r)
        if (tb !== null && tb < best.distance - 0.05 && !(best.animal === a && best.vital)) best = { animal: a, vital: false, distance: tb }
      }
    }
    return best
  }

  hit(a: Animal, vital: boolean, from: Vector3): boolean {
    if (vital || a.wounds >= 1) {
      a.state = 'down'
      a.downTime = 0
      a.speed = 0
      return true
    }
    a.wounds++
    this.flee(a, from)
    return false
  }

  update(dt: number, player: Vector3, noise: number): void {
    for (const a of [...this.animals]) {
      a.stateTime -= dt
      const toPlayer = Vector3.Distance(a.position, player)
      if (a.state === 'down') {
        a.downTime += dt
        this.pose(a, dt, 0)
        if (a.tagged && a.downTime > 2) this.remove(a)
        continue
      }
      const hearing = a.template.id === 'whitetail' ? 1 : 0.75
      const detect = (16 + 70 * noise) * hearing
      if ((a.state === 'graze' || a.state === 'walk') && toPlayer < detect) {
        a.state = 'alert'
        a.stateTime = 1.5 + this.rng() * 2
        const d = player.subtract(a.position)
        a.heading = Math.atan2(d.x, d.z)
      } else if (a.state === 'alert' && (toPlayer < detect * 0.7 || a.stateTime <= 0 && toPlayer < detect)) {
        this.flee(a, player)
      } else if (a.state === 'alert' && a.stateTime <= 0) {
        a.state = 'graze'
        a.stateTime = 3 + this.rng() * 4
      }
      if (a.state === 'graze' && a.stateTime <= 0) {
        a.state = 'walk'
        a.stateTime = 4 + this.rng() * 6
        a.heading += (this.rng() - 0.5) * 2
      } else if (a.state === 'walk' && a.stateTime <= 0) {
        a.state = 'graze'
        a.stateTime = 4 + this.rng() * 8
      }
      const running = a.state === 'flee' || a.state === 'wounded'
      const target = running ? (a.template.id === 'whitetail' ? 11 : 8) * (a.state === 'wounded' ? 0.7 : 1) : a.state === 'walk' ? 1.3 : 0
      a.speed += (target - a.speed) * Math.min(1, dt * (running ? 3 : 1.5))
      if (a.speed > 0.05) {
        const fx = Math.sin(a.heading)
        const fz = Math.cos(a.heading)
        const nx = a.position.x + fx * a.speed * dt
        const nz = a.position.z + fz * a.speed * dt
        const lookX = nx + fx * 3
        const lookZ = nz + fz * 3
        let blocked = this.terrain.heightAt(lookX, lookZ) < 0.4 || Math.abs(lookX) > PLAY_LIMIT || Math.abs(lookZ) > PLAY_LIMIT
        for (const t of this.ctx.queryTrunks(lookX, lookZ, 1)) if ((t.x - lookX) ** 2 + (t.z - lookZ) ** 2 < (t.r + 0.8) ** 2) blocked = true
        if (blocked) a.heading += (this.rng() < 0.5 ? -1 : 1) * (0.8 + this.rng()) * Math.min(1, dt * 6) * 3
        else {
          a.position.x = nx
          a.position.z = nz
        }
      }
      a.position.y = this.terrain.heightAt(a.position.x, a.position.z)
      if (running && a.stateTime <= 0 && toPlayer > 230) {
        this.onLost?.(a)
        this.remove(a)
        continue
      }
      if (running && a.stateTime <= 0) a.stateTime = 3
      this.pose(a, dt, a.speed)
    }
  }

  private pose(a: Animal, dt: number, speed: number): void {
    const root = a.rig.root
    root.position.copyFrom(a.position)
    const slope = this.terrain.heightAt(a.position.x + Math.sin(a.heading), a.position.z + Math.cos(a.heading)) - a.position.y
    const pitch = a.state === 'down' ? 0 : -Math.atan(slope) * 0.8
    const roll = a.state === 'down' ? Math.min(Math.PI / 2, a.downTime * 3.5) : 0
    Quaternion.FromEulerAnglesToRef(pitch, a.heading, roll, root.rotationQuaternion!)
    if (a.state === 'down') {
      root.position.y += 0.35 * a.scale * Math.min(1, a.downTime * 3.5)
      return
    }
    a.gait += dt * (speed < 2 ? speed * 4.2 : 4 + speed * 0.75)
    const run = Math.min(1, Math.max(0, (speed - 2) / 6))
    const amp = speed < 0.05 ? 0 : 0.35 + run * 0.45
    const legs: [string, number][] = [['legFL', 0], ['legBR', 0.15], ['legFR', Math.PI], ['legBL', Math.PI + 0.15]]
    for (const [name, phase] of legs) {
      const joint = a.rig.joints.get(name)
      if (!joint) continue
      const gallop = run > 0.5 ? (name.startsWith('legF') ? 0 : 1.2) + (name.endsWith('L') ? 0.25 : 0) : phase
      joint.rotation.x = Math.sin(a.gait + gallop) * amp
    }
    const head = a.rig.joints.get('head')
    if (head) {
      const grazing = a.state === 'graze' && speed < 0.2
      const target = grazing ? 0.95 + Math.sin(a.gait * 0.3) * 0.05 : a.state === 'alert' ? -0.25 : run * 0.15
      head.rotation.x += (target - head.rotation.x) * Math.min(1, dt * 2.5)
      if (a.state === 'graze') a.gait += dt * 0.6
    }
    const body = a.rig.joints.get('body')
    if (body) body.position.y = Math.abs(Math.sin(a.gait)) * 0.05 * run
  }

  nearestDown(point: Vector3, range: number): Animal | null {
    for (const a of this.animals) if (a.state === 'down' && !a.tagged && Vector3.Distance(a.position, point) < range) return a
    return null
  }

  legendNearby(): Animal | null {
    return this.animals.find((a) => a.specimen.legendary && a.state !== 'down') ?? null
  }
}
