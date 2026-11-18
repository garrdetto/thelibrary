import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Ray } from '@babylonjs/core/Culling/ray'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { ARENA_MAX_HEALTH } from '../../../../server/arena/protocol.mjs'
import type { WeaponId } from '../../../../server/arena/weapons.mjs'
import { Scores } from '../../../../engine/net/Scores'
import type { TrackerContact } from '../net/RemotePlayers'
import type { HitPart, LocalTarget } from '../weapons/WeaponSystem'
import { clock } from '../ui/Banner'
import { loadBest, personalBest, saveBest } from './bests'
import type { ActiveMode, ModeContext } from './types'

const BOARD = 'arena-range'
const RUN_SECONDS = 60
const TARGET_HEALTH = 21
const MAX_UP = 3
const RISE = 0.22

const SPOTS: Vector3[] = []
for (const x of [-26, -18, -10, -4, 4, 10, 18, 26]) for (const z of [-24, -10, 6, 20, 30]) SPOTS.push(new Vector3(x, 0, z))
for (const x of [-8, 0, 8]) SPOTS.push(new Vector3(x, 4, 45))
for (const x of [-30.5, 30.5]) for (const z of [20, 32, 44]) SPOTS.push(new Vector3(x, 4, z))
for (const x of [-10, 10]) SPOTS.push(new Vector3(x, 2, 18), new Vector3(x, 2, -18))
SPOTS.push(new Vector3(0, 2, 3), new Vector3(-22, 4.4, 8), new Vector3(22, 4.4, 8))

type TargetState = 'idle' | 'rising' | 'up' | 'falling'

class PopTarget implements LocalTarget {
  readonly root: TransformNode
  readonly hinge: TransformNode
  readonly meshes: Mesh[]
  state: TargetState = 'idle'
  health = TARGET_HEALTH
  age = 0
  life = 3
  slide = 0
  origin = new Vector3()
  headshot = false
  spawnedAt = 0

  constructor(private readonly range: RangeMode, index: number, scene: ModeContext['scene'], body: PBRMaterial, ring: PBRMaterial, post: PBRMaterial) {
    this.root = new TransformNode(`range-target-${index}`, scene)
    this.hinge = new TransformNode(`range-target-${index}-hinge`, scene)
    this.hinge.parent = this.root
    const stand = MeshBuilder.CreateBox(`range-target-${index}-base`, { width: 0.7, height: 0.08, depth: 0.4 }, scene)
    stand.parent = this.root
    stand.position.y = 0.04
    stand.material = post
    stand.isPickable = false
    const pole = MeshBuilder.CreateCylinder(`range-target-${index}-pole`, { diameter: 0.06, height: 0.75 }, scene)
    pole.parent = this.hinge
    pole.position.y = 0.42
    pole.material = post
    const torso = MeshBuilder.CreateBox(`range-target-${index}-torso`, { width: 0.56, height: 0.78, depth: 0.05 }, scene)
    torso.parent = this.hinge
    torso.position.y = 1.15
    torso.material = body
    const head = MeshBuilder.CreateCylinder(`range-target-${index}-head`, { diameter: 0.3, height: 0.05, tessellation: 24 }, scene)
    head.parent = this.hinge
    head.rotation.x = Math.PI / 2
    head.position.y = 1.72
    head.material = ring
    pole.isPickable = false
    for (const [mesh, part] of [[torso, 'body'], [head, 'head']] as const) {
      mesh.isPickable = true
      mesh.metadata = { localTarget: this, part }
    }
    this.meshes = [stand, pole, torso, head]
    this.root.setEnabled(false)
  }

  get alive(): boolean {
    return this.state === 'rising' || this.state === 'up'
  }

  raise(at: Vector3, facing: Vector3, life: number, slide: number, now: number): void {
    this.origin.copyFrom(at)
    this.root.position.copyFrom(at)
    this.root.rotation.y = Math.atan2(facing.x - at.x, facing.z - at.z)
    this.hinge.rotation.x = -Math.PI / 2
    this.health = TARGET_HEALTH
    this.age = 0
    this.life = life
    this.slide = slide
    this.state = 'rising'
    this.headshot = false
    this.spawnedAt = now
    this.root.setEnabled(true)
  }

  shot(part: HitPart, damage: number, _point: Vector3, _weapon: WeaponId): { killed: boolean } {
    if (!this.alive) return { killed: false }
    this.health -= damage
    if (part === 'head') this.headshot = true
    this.range.hitTarget(part)
    if (this.health > 0) return { killed: false }
    this.state = 'falling'
    this.age = 0
    this.range.dropped(this)
    return { killed: true }
  }

  update(dt: number): boolean {
    if (this.state === 'idle') return false
    this.age += dt
    if (this.state === 'rising') {
      this.hinge.rotation.x = -Math.PI / 2 * (1 - Math.min(1, this.age / RISE))
      if (this.age >= RISE) this.state = 'up'
    } else if (this.state === 'up') {
      if (this.slide) {
        const right = new Vector3(Math.cos(this.root.rotation.y), 0, -Math.sin(this.root.rotation.y))
        this.root.position.copyFrom(this.origin.add(right.scale(Math.sin(this.age * 1.7) * this.slide)))
      }
      if (this.age >= this.life) {
        this.state = 'falling'
        this.age = 0
        return true
      }
    } else if (this.state === 'falling') {
      this.hinge.rotation.x = -Math.PI / 2 * Math.min(1, this.age / RISE)
      if (this.age >= RISE + 0.25) {
        this.state = 'idle'
        this.root.setEnabled(false)
      }
    }
    return false
  }

  dispose(): void {
    this.root.dispose(false, true)
  }
}

type Stage = 'countdown' | 'live' | 'over'

export class RangeMode implements ActiveMode {
  readonly id = 'range' as const
  private readonly targets: PopTarget[] = []
  private readonly materials: PBRMaterial[] = []
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1)
  private stage: Stage = 'countdown'
  private countdown = 3
  private left = RUN_SECONDS
  private score = 0
  private kills = 0
  private heads = 0
  private missed = 0
  private streak = 0
  private bestStreak = 0
  private fired = 0
  private hits = 0
  private nextPop = 0
  private lastProgress = 0

  constructor(private readonly ctx: ModeContext) {
    const paint = (name: string, color: Color3, glow: number) => {
      const material = new PBRMaterial(name, ctx.scene)
      material.albedoColor = color
      material.emissiveColor = color.scale(glow)
      material.metallic = 0.1
      material.roughness = 0.55
      this.materials.push(material)
      return material
    }
    const body = paint('range-body', new Color3(0.95, 0.42, 0.08), 0.35)
    const ring = paint('range-head', new Color3(0.98, 0.86, 0.2), 0.5)
    const post = paint('range-post', new Color3(0.18, 0.2, 0.22), 0)
    for (let index = 0; index < 8; index++) this.targets.push(new PopTarget(this, index, ctx.scene, body, ring, post))
    loadBest(BOARD)
    this.reset()
  }

  private reset(): void {
    const { ctx } = this
    for (const target of this.targets) {
      target.state = 'idle'
      target.root.setEnabled(false)
    }
    this.stage = 'countdown'
    this.countdown = 3
    this.left = RUN_SECONDS
    this.score = 0
    this.kills = 0
    this.heads = 0
    this.missed = 0
    this.streak = 0
    this.bestStreak = 0
    this.fired = 0
    this.hits = 0
    this.nextPop = 0
    this.lastProgress = 0
    ctx.weapons.setReserve(null)
    ctx.weapons.refill()
    ctx.weapons.select('battle')
    ctx.weapons.setHooks({
      shoot: () => {},
      team: () => null,
      hit: () => {},
      marker: (headshot, kill) => ctx.hud.hit(headshot, kill),
      fired: () => { this.fired++ },
    })
    const spawn = ctx.arena.spawn(0)
    ctx.player.respawn(spawn.position, spawn.yaw)
    ctx.player.alive = true
    ctx.weapons.setEnabled(true)
    ctx.hud.setHealth(ARENA_MAX_HEALTH)
    ctx.hud.setDead(false)
  }

  hitTarget(_part: HitPart): void {
    this.hits++
  }

  dropped(target: PopTarget): void {
    if (this.stage !== 'live') return
    const feet = this.ctx.player.body.position
    const distance = Math.hypot(target.root.position.x - feet.x, target.root.position.z - feet.z)
    const quick = Math.max(0, 1 - target.age / target.life)
    this.streak++
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    const multiplier = 1 + Math.min(this.streak - 1, 10) * 0.1
    const points = Math.round((100 + (target.headshot ? 50 : 0) + distance * 2 + quick * 60 + (target.slide ? 40 : 0)) * multiplier)
    this.score += points
    this.kills++
    if (target.headshot) this.heads++
    this.ctx.hud.announce(`+${points}${target.headshot ? ' · head' : ''}${multiplier > 1 ? ` · ×${multiplier.toFixed(1)}` : ''}`)
  }

  private visible(spot: Vector3, eye: Vector3): boolean {
    const aim = spot.add(new Vector3(0, 1.3, 0))
    const direction = aim.subtract(eye)
    const length = direction.length()
    this.ray.origin.copyFrom(eye)
    this.ray.direction.copyFrom(direction.scaleInPlace(1 / length))
    this.ray.length = length - 0.4
    const pick = this.ctx.scene.pickWithRay(this.ray, (mesh: AbstractMesh) => Boolean((mesh.metadata as { arenaSolid?: boolean } | null)?.arenaSolid) && mesh.isEnabled(), true)
    return !pick?.hit
  }

  private pop(): void {
    const idle = this.targets.find(target => target.state === 'idle')
    if (!idle) return
    const eye = this.ctx.player.camera.globalPosition
    const used = this.targets.filter(target => target.state !== 'idle').map(target => target.origin)
    const progress = 1 - this.left / RUN_SECONDS
    const options = SPOTS.filter(spot => {
      const distance = Math.hypot(spot.x - eye.x, spot.z - eye.z)
      return distance > 14 && distance < 105 && !used.some(other => Vector3.Distance(other, spot) < 4)
    })
    for (let attempt = 0; attempt < 12 && options.length; attempt++) {
      const index = Math.floor(Math.random() * options.length)
      const spot = options.splice(index, 1)[0]
      if (!this.visible(spot, eye)) continue
      const life = 3.2 - progress * 1.4
      const slide = spot.y === 0 && Math.random() < 0.25 + progress * 0.35 ? 1.5 + Math.random() * 1.5 : 0
      idle.raise(spot, this.ctx.player.body.position, life, slide, RUN_SECONDS - this.left)
      return
    }
  }

  private finish(): void {
    const { ctx } = this
    this.stage = 'over'
    ctx.weapons.setEnabled(false)
    const previous = personalBest(BOARD)
    const best = saveBest(BOARD, this.score)
    if (this.score > 0) void Scores.submit(BOARD, this.score)
    ctx.banner.message('')
    ctx.results.show({
      title: 'Training Range',
      headline: `${this.score.toLocaleString()} points`,
      lines: [
        { label: 'Targets dropped', value: String(this.kills) },
        { label: 'Headshot drops', value: String(this.heads) },
        { label: 'Targets missed', value: String(this.missed) },
        { label: 'Best streak', value: String(this.bestStreak) },
        { label: 'Accuracy', value: this.fired ? `${Math.round((this.hits / this.fired) * 100)}%` : '–' },
        { label: 'Your best', value: best.toLocaleString() },
      ],
      note: previous !== null && this.score > previous ? 'New personal best! The leaderboard is under the arena.' : 'Scores go to the leaderboard under the arena.',
      again: 'Run it again',
    }, () => this.reset(), () => ctx.openMenu())
  }

  update(dt: number): void {
    const { ctx } = this
    if (this.stage === 'countdown') {
      if (ctx.results.open) return
      this.countdown -= dt
      ctx.banner.show('Training Range', `${RUN_SECONDS} seconds · drop the pop-up targets`)
      ctx.banner.message(this.countdown > 0 ? `Range goes hot in ${Math.ceil(this.countdown)}` : '')
      if (this.countdown <= 0) this.stage = 'live'
      return
    }
    for (const target of this.targets) {
      if (target.update(dt) && this.stage === 'live') {
        this.missed++
        this.streak = 0
      }
    }
    if (this.stage !== 'live') return
    this.left -= dt
    this.nextPop -= dt
    const up = this.targets.filter(target => target.alive).length
    const progress = 1 - this.left / RUN_SECONDS
    if (this.nextPop <= 0 && up < MAX_UP) {
      this.pop()
      this.nextPop = 0.9 - progress * 0.45
    }
    if (RUN_SECONDS - this.left - this.lastProgress >= 10) {
      this.lastProgress = RUN_SECONDS - this.left
      if (this.score > 0) Scores.progress(BOARD, this.score)
    }
    ctx.banner.show('Training Range', `${this.score.toLocaleString()} points · ${clock(this.left * 1000)} left${this.streak > 1 ? ` · streak ${this.streak}` : ''}`)
    if (this.left <= 0) this.finish()
  }

  contacts(): TrackerContact[] {
    return this.targets.filter(target => target.alive).map(target => ({ x: target.root.position.x, z: target.root.position.z, team: 1, noisy: true }))
  }

  team(): 0 | 1 | null {
    return 0
  }

  dispose(): void {
    for (const target of this.targets) target.dispose()
    for (const material of this.materials) material.dispose()
    this.ctx.banner.hide()
  }
}
