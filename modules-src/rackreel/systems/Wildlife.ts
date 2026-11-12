import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { EngineContext } from '../core/EngineSetup'
import { disposeRig, instantiate } from '../core/ModelLibrary'
import type { ModelName, ModelRig, ModelTemplate } from '../core/ModelLibrary'
import { PLAY_LIMIT, forestDensity } from '../world/Terrain'
import type { Terrain } from '../world/Terrain'
import { ALARM_RADIUS, BEAR_SHARE, BUCK_SHARE, ABANDONED_DOWN_SECONDS, HERD_DESPAWN, HERD_SIZE, HERD_SPAWN_MAX, HERD_SPAWN_MIN, HERD_TURNOVER_SECONDS, LEAVE_GONE, LEAVE_SECONDS, SAFE_DISTANCE, coverMatters, fleeSpeed, react } from './Herd'
import type { DeerMood, Senses } from './Herd'
import { SPECIES_BY_ID, classify, measure } from './LootTableManager'
import type { LootTableManager, SpeciesTemplate, Specimen } from './LootTableManager'

export type AnimalState = DeerMood

export interface Animal {
  id: number
  template: SpeciesTemplate
  specimen: Specimen
  rig: ModelRig
  antlers: ModelRig | null
  doe: boolean
  position: Vector3
  heading: number
  desired: number
  speed: number
  state: AnimalState
  stateTime: number
  fleeTime: number
  gait: number
  scale: number
  wounds: number
  goal: Vector3
  tagged: boolean
  /** Seconds since the herd turned over and this animal started running off; -1 while it stays. */
  leaving: number
  downTime: number
  lastDistance: number
  alarm: number
  scan: number
  scanYaw: number
  stomp: number
}

export interface NetAnimal {
  id: number
  sp: string
  doe: boolean
  x: number
  z: number
  h: number
  v: number
  st: AnimalState
  val: number
  wt: number
  leg: boolean
  tp: number
  sd?: number
  dt: number
}

export interface ShotResult {
  animal: Animal | null
  vital: boolean
  distance: number
}

const VITALS: Record<string, { y: number; z: number; r: number }> = { whitetail: { y: 1.05, z: 0.32, r: 0.24 }, blackbear: { y: 0.95, z: 0.3, r: 0.3 } }
const ANTLER_BASE = new Vector3(0, 1.66, 0.73)
const BODY: Record<string, { y: number; z: number; r: number }[]> = {
  whitetail: [{ y: 1.0, z: 0.0, r: 0.42 }, { y: 1.0, z: -0.45, r: 0.36 }, { y: 1.5, z: 0.95, r: 0.22 }],
  blackbear: [{ y: 0.9, z: 0.0, r: 0.55 }, { y: 0.92, z: -0.45, r: 0.5 }, { y: 1.0, z: 0.95, r: 0.3 }],
}
const WALK_PHASE: Record<string, number> = { legBL: 0, legFL: 0.25, legBR: 0.5, legFR: 0.75 }
const WALK_LEGS = Object.keys(WALK_PHASE)
const FRONT_LEGS = ['legFL', 'legFR']
const BACK_LEGS = ['legBL', 'legBR']

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

export class Wildlife {
  readonly animals: Animal[] = []
  private readonly herdScratch: (Animal | null)[] = []
  private readonly senses: Senses = { distance: 0, noise: 0, approaching: false, cover: 0, hearing: 0 }
  private nextId = 1
  private herdTimer = 0
  detection = 1
  vitalScale = 1
  remote = false
  private targets = new Map<number, NetAnimal>()
  onLegendSpawn: ((animal: Animal) => void) | null = null
  onLost: ((animal: Animal) => void) | null = null
  onTurnover: (() => void) | null = null
  /** Counts down to the next herd turnover (`HERD_TURNOVER_SECONDS`). */
  turnoverTimer = HERD_TURNOVER_SECONDS

  constructor(private readonly ctx: EngineContext, private readonly scene: Scene, private readonly terrain: Terrain, private readonly loot: LootTableManager, private readonly models: Map<ModelName, ModelTemplate>, private readonly rng: () => number = Math.random) {}

  private landAt(x: number, z: number): boolean {
    if (Math.abs(x) > PLAY_LIMIT - 20 || Math.abs(z) > PLAY_LIMIT - 20) return false
    const g = this.terrain.groundAt(x, z)
    return g !== 'water' && g !== 'rock' && this.terrain.heightAt(x, z) > 0.9
  }

  private spawnSpot(player: Vector3, facing: number | null, min: number, max: number): Vector3 | null {
    for (let attempt = 0; attempt < 40; attempt++) {
      const dist = min + this.rng() * (max - min)
      const ang = facing === null ? this.rng() * Math.PI * 2 : facing + (this.rng() - 0.5) * Math.PI * 1.6
      const x = player.x + Math.sin(ang) * dist
      const z = player.z + Math.cos(ang) * dist
      if (this.landAt(x, z)) return new Vector3(x, this.terrain.heightAt(x, z), z)
    }
    return null
  }

  spawnNear(player: Vector3, facing: number): Animal | null {
    const at = this.spawnSpot(player, facing, 75, 145)
    return at ? this.spawn(SPECIES_BY_ID.whitetail, at, false) : null
  }

  /** A spot anywhere on the property, out of sight of every player but close enough to stay loaded. */
  private randomSpot(players: Vector3[]): Vector3 | null {
    const lim = PLAY_LIMIT - 30
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = (this.rng() * 2 - 1) * lim
      const z = (this.rng() * 2 - 1) * lim
      if (!this.landAt(x, z)) continue
      const p = new Vector3(x, this.terrain.heightAt(x, z), z)
      const d = players.map((q) => Vector3.Distance(p, q))
      if (d.some((v) => v < HERD_SPAWN_MIN) || d.every((v) => v > HERD_DESPAWN - 40)) continue
      return p
    }
    return null
  }

  /** Every `HERD_TURNOVER_SECONDS` the deer on the property run off and a new batch walks in at random spots. */
  private turnover(players: Vector3[]): void {
    for (const a of this.animals) {
      if (a.state === 'down' || a.wounds > 0 || a.leaving >= 0 || a.template.id !== 'whitetail') continue
      let from = players[0]
      for (const q of players) if (Vector3.Distance(a.position, q) < Vector3.Distance(a.position, from)) from = q
      a.leaving = 0
      a.alarm = 0
      this.flee(a, from)
      a.stateTime = LEAVE_SECONDS
    }
    let room = HERD_SIZE - this.living()
    for (let tries = 0; room > 0 && tries < HERD_SIZE * 2; tries++) {
      const at = this.randomSpot(players)
      if (at) room -= this.spawnGroup(at, room)
    }
    this.onTurnover?.()
  }

  private living(): number {
    return this.animals.filter((a) => a.state !== 'down' && a.leaving < 0).length
  }

  /** Puts a buck, a bear or a few does at `at`; returns how many animals it added. */
  private spawnGroup(at: Vector3, room: number): number {
    if (this.rng() < BEAR_SHARE && !this.animals.some((a) => a.template.id === 'blackbear')) {
      this.spawn(SPECIES_BY_ID.blackbear, at, false)
      return 1
    }
    if (this.rng() < BUCK_SHARE) {
      this.spawn(SPECIES_BY_ID.whitetail, at, false)
      return 1
    }
    const group = Math.min(room, 1 + Math.floor(this.rng() * 3))
    const heading = this.rng() * Math.PI * 2
    let added = 0
    for (let i = 0; i < group; i++) {
      const p = at.add(new Vector3((this.rng() - 0.5) * 12, 0, (this.rng() - 0.5) * 12))
      if (!this.landAt(p.x, p.z)) continue
      p.y = this.terrain.heightAt(p.x, p.z)
      const doe = this.spawn(SPECIES_BY_ID.whitetail, p, true)
      doe.heading = doe.desired = heading + (this.rng() - 0.5) * 0.8
      added++
    }
    return Math.max(1, added)
  }

  maintain(dt: number, players: Vector3 | Vector3[]): void {
    if (this.remote) return
    const list = Array.isArray(players) ? players : [players]
    const player = list[0]
    this.turnoverTimer -= dt
    if (this.turnoverTimer <= 0) {
      this.turnoverTimer = HERD_TURNOVER_SECONDS
      this.turnover(list)
    }
    this.herdTimer -= dt
    if (this.herdTimer > 0) return
    this.herdTimer = 2
    for (const a of [...this.animals]) {
      if (a.state === 'down' ? a.downTime < ABANDONED_DOWN_SECONDS : a.wounds > 0) continue
      if (list.every((q) => Vector3.Distance(a.position, q) > HERD_DESPAWN)) this.remove(a)
    }
    const living = this.living()
    if (living >= HERD_SIZE) return
    const at = this.spawnSpot(player, null, HERD_SPAWN_MIN, HERD_SPAWN_MAX)
    if (!at) return
    this.spawnGroup(at, HERD_SIZE - living)
  }

  spawn(template: SpeciesTemplate, position: Vector3, doe: boolean, given?: Specimen, id?: number): Animal {
    const specimen = given ?? this.loot.createSpecimen(template.id)
    if (doe && !given) {
      specimen.legendary = false
      specimen.recordTier = 0
      specimen.value = 0
      specimen.trophyPoints = 0
      specimen.weightLb = Math.round(95 + this.rng() * 50)
      specimen.sizeClass = 'average'
      specimen.measures = {}
    }
    const model = this.models.get(template.model as ModelName)!
    const rig = instantiate(model, null, this.scene, (m) => this.ctx.registerDynamic(m))
    rig.root.rotationQuaternion = new Quaternion()
    let antlers: ModelRig | null = null
    let scale = 1
    if (template.id === 'whitetail') {
      scale = doe ? 0.84 + this.rng() * 0.06 : 0.92 + Math.min(0.2, (specimen.weightLb - 130) / 600)
      if (!doe) {
        const head = rig.joints.get('head')!
        antlers = instantiate(this.models.get('antlers')!, head, this.scene, (m) => this.ctx.registerDynamic(m))
        const headPivot = model.parts.get('head')!.pivot
        const s = 0.62 + Math.max(0, specimen.value - 85) / 125 * 0.62
        antlers.root.scaling.setAll(s)
        antlers.root.position.copyFrom(ANTLER_BASE.scale(1 - s).subtract(headPivot))
      }
    } else {
      scale = Math.cbrt(specimen.weightLb / 300) * 1.05
    }
    rig.root.scaling.setAll(scale)
    const heading = this.rng() * Math.PI * 2
    const animal: Animal = {
      id: id ?? this.nextId++, template, specimen, rig, antlers, doe, position, heading, desired: heading, speed: 0, state: 'graze', stateTime: 2 + this.rng() * 5, fleeTime: 0,
      gait: this.rng() * 10, scale, wounds: 0, goal: position.clone(), tagged: false, leaving: -1, downTime: 0, lastDistance: Infinity, alarm: 0, scan: 2 + this.rng() * 4, scanYaw: 0, stomp: 0,
    }
    this.animals.push(animal)
    if (specimen.legendary) this.onLegendSpawn?.(animal)
    return animal
  }

  casters(): AbstractMesh[] {
    return this.collectCasters([])
  }

  /** Appends animal meshes to `out` without allocating: all of them, or only those within `reach` metres of `focus`. */
  collectCasters(out: AbstractMesh[], focus?: Vector3, reach = Infinity): AbstractMesh[] {
    for (const a of this.animals) {
      if (focus && (Math.abs(a.position.x - focus.x) > reach || Math.abs(a.position.z - focus.z) > reach)) continue
      for (const mesh of a.rig.meshes) out.push(mesh)
      if (a.antlers) for (const mesh of a.antlers.meshes) out.push(mesh)
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

  lure(player: Vector3): Animal | null {
    let best: Animal | null = null
    let bestD = Infinity
    for (const a of this.animals) {
      if (a.state !== 'graze' && a.state !== 'walk') continue
      if (a.template.id !== 'whitetail') continue
      const d = Vector3.Distance(a.position, player)
      if (d < bestD) {
        bestD = d
        best = a
      }
    }
    if (!best) return null
    const away = best.position.subtract(player)
    away.y = 0
    best.goal = player.add(away.normalize().scale(55 + this.rng() * 25))
    best.state = 'walk'
    best.stateTime = 25
    return best
  }

  private flee(a: Animal, from: Vector3): void {
    if (a.state !== 'flee' && a.state !== 'wounded') a.fleeTime = 0
    a.state = a.wounds > 0 ? 'wounded' : 'flee'
    a.stateTime = 6 + this.rng() * 4
    const away = a.position.subtract(from)
    away.y = 0
    a.desired = Math.atan2(away.x, away.z) + (this.rng() - 0.5) * 0.7
    for (const b of this.animals) {
      if (b === a || b.state === 'down' || b.state === 'flee' || b.state === 'wounded') continue
      if (Vector3.Distance(a.position, b.position) < ALARM_RADIUS) b.alarm = 0.3 + this.rng() * 0.6
    }
  }

  shoot(origin: Vector3, direction: Vector3, maxDistance: number): ShotResult {
    let best: ShotResult = { animal: null, vital: false, distance: maxDistance }
    for (const a of this.animals) {
      if (a.state === 'down') continue
      const c = Math.cos(a.heading)
      const s = Math.sin(a.heading)
      const test = (y: number, z: number, r: number): number | null => {
        const center = new Vector3(a.position.x + z * s * a.scale, a.rig.root.position.y + y * a.scale, a.position.z + z * c * a.scale)
        const oc = origin.subtract(center)
        const b = Vector3.Dot(oc, direction)
        const disc = b * b - (oc.lengthSquared() - (r * a.scale) ** 2)
        if (disc < 0) return null
        const t = -b - Math.sqrt(disc)
        return t > 0 ? t : null
      }
      const v = VITALS[a.template.id]
      const tv = test(v.y, v.z, v.r * this.vitalScale)
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

  private cover(a: Animal, player: Vector3): number {
    const midX = (a.position.x + player.x) * 0.5
    const midZ = (a.position.z + player.z) * 0.5
    return Math.min(1, forestDensity(midX, midZ) * 0.8 + forestDensity(a.position.x, a.position.z) * 0.3)
  }

  snapshot(): NetAnimal[] {
    return this.animals.filter((a) => !a.tagged).map((a) => ({
      id: a.id, sp: a.template.id, doe: a.doe, x: Math.round(a.position.x * 100) / 100, z: Math.round(a.position.z * 100) / 100, h: Math.round(a.heading * 1000) / 1000,
      v: Math.round(a.speed * 100) / 100, st: a.state, val: a.specimen.value, wt: a.specimen.weightLb, leg: a.specimen.legendary, tp: a.specimen.trophyPoints, sd: a.specimen.seed, dt: Math.round(a.downTime * 10) / 10,
    }))
  }

  applySnapshot(list: NetAnimal[]): void {
    const seen = new Set<number>()
    for (const n of list) {
      seen.add(n.id)
      this.targets.set(n.id, n)
      if (this.animals.some((a) => a.id === n.id)) continue
      const template = SPECIES_BY_ID[n.sp as keyof typeof SPECIES_BY_ID]
      if (!template) continue
      const specimen: Specimen = { species: template.id, value: n.val, weightLb: n.wt, lengthIn: 0, legendary: n.leg, recordTier: this.loot.placement(template.id, n.val), trophyPoints: n.tp, serial: n.id + 100000, sizeClass: n.doe ? 'average' : classify(template.id, n.val), measures: n.doe ? {} : measure(template.id, n.val, n.sd ?? 0), seed: n.sd ?? 0 }
      const a = this.spawn(template, new Vector3(n.x, this.terrain.heightAt(n.x, n.z), n.z), n.doe, specimen, n.id)
      a.heading = n.h
    }
    for (const a of [...this.animals]) if (!seen.has(a.id)) {
      this.targets.delete(a.id)
      this.remove(a)
    }
  }

  clearAll(): void {
    for (const a of [...this.animals]) this.remove(a)
    this.targets.clear()
  }

  private followRemote(dt: number): void {
    for (const a of this.animals) {
      const n = this.targets.get(a.id)
      if (!n) continue
      if (n.st === 'down' && a.state !== 'down') a.downTime = n.dt
      a.state = n.st
      a.speed = n.v
      const k = Math.min(1, dt * 6)
      a.position.x += (n.x + Math.sin(n.h) * n.v * 0.12 - a.position.x) * k
      a.position.z += (n.z + Math.cos(n.h) * n.v * 0.12 - a.position.z) * k
      a.position.y = this.terrain.heightAt(a.position.x, a.position.z)
      a.heading += wrapAngle(n.h - a.heading) * k
      if (a.state === 'down') a.downTime += dt
      this.pose(a, dt, a.state === 'down' ? 0 : a.speed)
    }
  }

  update(dt: number, players: Vector3 | { p: Vector3; noise: number }[], soloNoise = 0): void {
    const listeners = Array.isArray(players) ? players : [{ p: players, noise: soloNoise }]
    if (this.remote) {
      this.followRemote(dt)
      return
    }
    const herd = this.herdScratch
    const count = this.animals.length
    for (let i = 0; i < count; i++) herd[i] = this.animals[i]
    for (let index = 0; index < count; index++) {
      const a = herd[index]!
      herd[index] = null
      a.stateTime -= dt
      let nearest = listeners[0]
      for (let i = 1; i < listeners.length; i++) if (Vector3.Distance(a.position, listeners[i].p) < Vector3.Distance(a.position, nearest.p)) nearest = listeners[i]
      const player = nearest.p
      const noise = nearest.noise
      const toPlayer = Vector3.Distance(a.position, player)
      if (a.state === 'down') {
        a.downTime += dt
        this.pose(a, dt, 0)
        if (a.tagged && a.downTime > 2) this.remove(a)
        continue
      }
      if (a.leaving >= 0) {
        a.leaving += dt
        if (a.leaving > LEAVE_SECONDS || (a.leaving > 4 && toPlayer > LEAVE_GONE)) {
          this.remove(a)
          continue
        }
        if (a.state !== 'flee') this.flee(a, player)
        a.stateTime = Math.max(a.stateTime, 1)
      }
      if (a.alarm > 0 && a.leaving < 0) {
        a.alarm -= dt
        if (a.alarm <= 0) this.flee(a, player)
      }
      const approaching = toPlayer < a.lastDistance - 0.04
      a.lastDistance = toPlayer
      const hearing = (a.template.id === 'whitetail' ? 1 : 0.75) * this.detection
      let decision: ReturnType<typeof react> = 'keep'
      if (a.leaving < 0) {
        const senses = this.senses
        senses.distance = toPlayer
        senses.noise = noise
        senses.approaching = approaching
        senses.hearing = hearing
        senses.cover = 0
        if (coverMatters(a.state, senses)) senses.cover = this.cover(a, player)
        decision = react(a.state, senses, a.stateTime)
      }
      if (decision === 'flee') this.flee(a, player)
      else if (decision === 'alert') {
        a.state = 'alert'
        a.stateTime = 2 + this.rng() * 3
        const d = player.subtract(a.position)
        a.desired = Math.atan2(d.x, d.z)
        a.stomp = this.rng() < 0.6 ? 1.2 : 0
      } else if (decision === 'calm') {
        if (a.state === 'flee') {
          a.state = 'alert'
          a.stateTime = 2.5
          const d = player.subtract(a.position)
          a.desired = Math.atan2(d.x, d.z)
        } else {
          a.state = 'graze'
          a.stateTime = 3 + this.rng() * 4
        }
      }
      if (a.state === 'graze' && a.stateTime <= 0) {
        a.state = 'walk'
        a.stateTime = 5 + this.rng() * 8
        a.goal = a.position.add(new Vector3((this.rng() - 0.5) * 50, 0, (this.rng() - 0.5) * 50))
      } else if (a.state === 'walk') {
        const d = a.goal.subtract(a.position)
        if (d.length() < 2 || a.stateTime <= 0) {
          a.state = 'graze'
          a.stateTime = 5 + this.rng() * 10
        } else a.desired = Math.atan2(d.x, d.z)
      }
      const running = a.state === 'flee' || a.state === 'wounded'
      if (running) {
        a.fleeTime += dt
        if (a.stateTime <= 0 && toPlayer > SAFE_DISTANCE + 80 && a.state === 'wounded') {
          this.onLost?.(a)
          this.remove(a)
          continue
        }
        if (a.stateTime <= 0) {
          const away = a.position.subtract(player)
          a.desired = Math.atan2(away.x, away.z) + (this.rng() - 0.5) * 0.5
          a.stateTime = 3
        }
      }
      const buck = !a.doe && a.template.id === 'whitetail'
      const target = running ? (a.template.id === 'whitetail' ? fleeSpeed(a.fleeTime, buck) : 8) * (a.state === 'wounded' ? 0.75 : 1) : a.state === 'walk' ? 1.25 : 0
      a.speed += (target - a.speed) * Math.min(1, dt * (running ? 4 : 1.5))
      const turnRate = running ? 3.2 : a.state === 'alert' ? 2.2 : 1.2
      const dh = wrapAngle(a.desired - a.heading)
      a.heading += Math.sign(dh) * Math.min(Math.abs(dh), turnRate * dt)
      if (a.speed > 0.05) {
        const fx = Math.sin(a.heading)
        const fz = Math.cos(a.heading)
        const nx = a.position.x + fx * a.speed * dt
        const nz = a.position.z + fz * a.speed * dt
        const look = 2 + a.speed * 0.35
        const lookX = nx + fx * look
        const lookZ = nz + fz * look
        let blocked = this.terrain.heightAt(lookX, lookZ) < 0.4 || Math.abs(lookX) > PLAY_LIMIT - 10 || Math.abs(lookZ) > PLAY_LIMIT - 10
        const trunks = this.ctx.queryTrunks(lookX, lookZ, 1)
        for (let i = 0; i < trunks.length; i++) {
          const t = trunks[i]
          if ((t.x - lookX) ** 2 + (t.z - lookZ) ** 2 < (t.r + 0.8) ** 2) blocked = true
        }
        if (blocked) {
          a.desired = a.heading + (wrapAngle(a.desired - a.heading) >= 0 ? 1 : -1) * 1.2
          a.heading += (wrapAngle(a.desired - a.heading) >= 0 ? 1 : -1) * Math.min(1, dt * 4)
          if (!running) a.speed *= 0.9
        } else {
          a.position.x = nx
          a.position.z = nz
        }
      }
      a.position.y = this.terrain.heightAt(a.position.x, a.position.z)
      this.pose(a, dt, a.speed)
    }
  }

  private pose(a: Animal, dt: number, speed: number): void {
    const root = a.rig.root
    root.position.copyFrom(a.position)
    const slope = this.terrain.heightAt(a.position.x + Math.sin(a.heading), a.position.z + Math.cos(a.heading)) - a.position.y
    let pitch = a.state === 'down' ? 0 : -Math.atan(slope) * 0.8
    const roll = a.state === 'down' ? Math.min(Math.PI / 2, a.downTime * 3.5) : 0
    if (a.state === 'down') {
      Quaternion.FromEulerAnglesToRef(pitch, a.heading, roll, root.rotationQuaternion!)
      root.position.y += 0.35 * a.scale * Math.min(1, a.downTime * 3.5)
      return
    }
    const deer = a.template.id === 'whitetail'
    const bounding = deer && speed > 6.5
    const trot = Math.min(1, Math.max(0, (speed - 2) / 4))
    if (bounding) {
      a.gait += dt * (2.6 + speed * 0.12) * Math.PI * 2 / 2
      const p = a.gait % (Math.PI * 2)
      const air = Math.max(0, Math.sin(p))
      root.position.y += air * 0.55 * a.scale
      pitch += Math.cos(p) * 0.22
      const reach = Math.sin(p - 0.4)
      for (let i = 0; i < FRONT_LEGS.length; i++) {
        const j = a.rig.joints.get(FRONT_LEGS[i])
        if (j) j.rotation.x = -0.75 * reach + (FRONT_LEGS[i] === 'legFR' ? 0.08 : 0)
      }
      for (let i = 0; i < BACK_LEGS.length; i++) {
        const j = a.rig.joints.get(BACK_LEGS[i])
        if (j) j.rotation.x = 0.85 * reach + (BACK_LEGS[i] === 'legBR' ? 0.08 : 0)
      }
    } else {
      const cadence = speed < 0.05 ? 0 : speed < 2 ? speed * 0.95 : 1.9 + speed * 0.35
      a.gait += dt * cadence * Math.PI * 2
      const amp = speed < 0.05 ? 0 : 0.32 + trot * 0.25
      for (let i = 0; i < WALK_LEGS.length; i++) {
        const name = WALK_LEGS[i]
        const phase = WALK_PHASE[name]
        const j = a.rig.joints.get(name)
        if (!j) continue
        const ph = trot > 0.5 ? (name === 'legFL' || name === 'legBR' ? 0 : 0.5) : phase
        let target = Math.sin(a.gait + ph * Math.PI * 2) * amp
        if (a.stomp > 0 && name === 'legFL') target = -Math.max(0, Math.sin(a.stomp * 9)) * 0.55
        j.rotation.x += (target - j.rotation.x) * Math.min(1, dt * 14)
      }
      root.position.y += Math.abs(Math.sin(a.gait * 2)) * 0.025 * Math.min(1, speed)
    }
    a.stomp = Math.max(0, a.stomp - dt)
    Quaternion.FromEulerAnglesToRef(pitch, a.heading, 0, root.rotationQuaternion!)
    const head = a.rig.joints.get('head')
    if (head) {
      a.scan -= dt
      if (a.state === 'graze' && a.scan <= 0) {
        a.scan = a.scan < -2.5 ? 3 + this.rng() * 6 : a.scan
        if (a.scan > 0) a.scanYaw = (this.rng() - 0.5) * 1.1
      }
      const lookingUp = a.state === 'graze' && a.scan < 0
      const grazing = a.state === 'graze' && speed < 0.2 && !lookingUp
      const targetX = grazing ? 0.95 + Math.sin(a.gait * 0.3) * 0.05 : a.state === 'alert' || lookingUp ? -0.32 : bounding ? 0.1 : a.state === 'walk' ? 0.12 + Math.sin(a.gait * 2) * 0.05 : 0.15
      let targetY = lookingUp ? a.scanYaw : 0
      if (a.state === 'alert') targetY = 0
      if (grazing) a.gait += dt * 0.6
      head.rotation.x += (targetX - head.rotation.x) * Math.min(1, dt * (a.state === 'alert' ? 6 : 2.5))
      head.rotation.y += (targetY - head.rotation.y) * Math.min(1, dt * 3)
      const eyes = a.rig.joints.get('headEyes')
      if (eyes) {
        eyes.rotation.x = head.rotation.x
        eyes.rotation.y = head.rotation.y
      }
    }
    const body = a.rig.joints.get('body')
    if (body) body.position.y = bounding ? 0 : Math.abs(Math.sin(a.gait)) * 0.05 * trot
  }

  nearestDown(point: Vector3, range: number): Animal | null {
    for (const a of this.animals) if (a.state === 'down' && !a.tagged && Vector3.Distance(a.position, point) < range) return a
    return null
  }

  legendNearby(): Animal | null {
    return this.animals.find((a) => a.specimen.legendary && a.state !== 'down') ?? null
  }
}
