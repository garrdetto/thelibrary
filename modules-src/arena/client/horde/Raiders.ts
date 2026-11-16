import type { Scene } from '@babylonjs/core/scene'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Node } from '@babylonjs/core/node'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial'
import type { Material } from '@babylonjs/core/Materials/material'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { HORDE } from '../../../../server/arena/horde.mjs'
import type { WeaponId } from '../../../../server/arena/weapons.mjs'
import { loadModel, type LoadedModel } from '../assets/ModelLoader'
import type { HitPart, LocalTarget } from '../weapons/WeaponSystem'
import { nextWaypoint } from './Routes'

const MODEL_URL = '/models/arena/raider.glb'
const HIDDEN_Y = -400
const RADIUS = 0.42
const HALF_HEIGHT = 0.7
const WHEEL_RADIUS = 0.3
const SEPARATION = 1.15
const MELT_TIME = 1.8
const PUDDLE_LIFE = 6
const STUCK_CHECK = 0.45
const GRAVITY = -20
const SWING_FROM = -0.35
const SWING_TO = 1.75

type Phase = 'roll' | 'windup' | 'swing' | 'recover'

export interface RaiderHooks {
  playerFeet(): Vector3
  playerAlive(): boolean
  hitPlayer(damage: number, from: Vector3): void
  killed(headshot: boolean, position: Vector3): void
  damaged(part: HitPart): void
}

class Raider implements LocalTarget {
  readonly mover: Mesh
  readonly hitBody: Mesh
  readonly hitHead: Mesh
  visual: TransformNode | null = null
  shoulder: TransformNode | null = null
  wheels: TransformNode[] = []
  health = HORDE.raiderHealth
  alive = false
  speedScale = 1
  velocity = new Vector3()
  verticalSpeed = 0
  grounded = false
  phase: Phase = 'roll'
  phaseTime = 0
  struck = false
  yaw = 0
  stuckClock = 0
  stuckFrom = new Vector3()
  sidestep = 0
  sideSign = 1
  lastHeadshot = false

  constructor(scene: Scene, index: number, private readonly owner: Raiders) {
    this.mover = MeshBuilder.CreateBox(`raider-${index}`, { size: 0.2 }, scene)
    this.mover.isVisible = false
    this.mover.isPickable = false
    this.mover.checkCollisions = false
    this.mover.ellipsoid = new Vector3(RADIUS, HALF_HEIGHT, RADIUS)
    this.mover.ellipsoidOffset = new Vector3(0, HALF_HEIGHT, 0)
    this.hitBody = MeshBuilder.CreateBox(`raider-${index}-body`, { width: 0.62, height: 1.05, depth: 0.78 }, scene)
    this.hitBody.parent = this.mover
    this.hitBody.position.set(0, 0.62, 0.02)
    this.hitHead = MeshBuilder.CreateSphere(`raider-${index}-head`, { diameter: 0.34, segments: 8 }, scene)
    this.hitHead.parent = this.mover
    this.hitHead.position.set(0, 1.27, 0.06)
    for (const [mesh, part] of [[this.hitBody, 'body'], [this.hitHead, 'head']] as const) {
      mesh.visibility = 0
      mesh.isPickable = true
      mesh.metadata = { localTarget: this, part }
      mesh.setEnabled(false)
    }
    this.mover.setEnabled(false)
  }

  shot(part: HitPart, damage: number, point: Vector3, _weapon: WeaponId): { killed: boolean } {
    if (!this.alive) return { killed: false }
    this.health -= damage
    this.lastHeadshot = part === 'head'
    this.owner.hooks.damaged(part)
    if (this.health > 0) return { killed: false }
    this.owner.kill(this, point)
    return { killed: true }
  }
}

interface Melt {
  root: TransformNode
  puddle: AbstractMesh
  age: number
  spin: number
}

function findNode(root: Node, name: string): TransformNode | null {
  const all = [root, ...root.getDescendants(false)]
  return (all.find(node => node.name === name || node.name.endsWith(`.${name}`) || node.name.endsWith(` ${name}`) || node.name.endsWith(name)) as TransformNode | undefined) ?? null
}

function blobMesh(scene: Scene): Mesh {
  const rim = 40
  const positions: number[] = [0, 0.01, 0]
  const normals: number[] = [0, 1, 0]
  const indices: number[] = []
  for (let ring = 1; ring <= 2; ring++) {
    for (let i = 0; i < rim; i++) {
      const angle = (i / rim) * Math.PI * 2
      const wobble = 1 + Math.sin(angle * 3 + 0.7) * 0.16 + Math.sin(angle * 7 + 2.1) * 0.09 + Math.sin(angle * 13) * 0.04
      const radius = ring === 1 ? wobble * 0.62 : wobble
      positions.push(Math.cos(angle) * radius, ring === 1 ? 0.008 : 0, Math.sin(angle) * radius)
      normals.push(0, 1, 0)
    }
  }
  for (let i = 0; i < rim; i++) {
    const next = (i + 1) % rim
    indices.push(0, 1 + next, 1 + i)
    indices.push(1 + i, 1 + next, 1 + rim + i)
    indices.push(1 + next, 1 + rim + next, 1 + rim + i)
  }
  const mesh = new Mesh('raider-puddle', scene)
  const data = new VertexData()
  data.positions = positions
  data.normals = normals
  data.indices = indices
  data.applyToMesh(mesh)
  return mesh
}

function moltenMaterial(source: Material, scene: Scene, cache: Map<Material, Material>): Material {
  const hit = cache.get(source)
  if (hit) return hit
  let result: Material
  if (source instanceof MultiMaterial) {
    const multi = new MultiMaterial(`${source.name}-molten`, scene)
    multi.subMaterials = source.subMaterials.map(sub => (sub ? moltenMaterial(sub, scene, cache) : null))
    result = multi
  } else if (source instanceof PBRMaterial) {
    const clone = source.clone(`${source.name}-molten`) as PBRMaterial
    clone.albedoColor = clone.albedoColor.multiply(new Color3(0.55, 0.16, 0.08))
    clone.emissiveColor = new Color3(0.42, 0.07, 0.01)
    clone.emissiveTexture = clone.albedoTexture
    clone.emissiveIntensity = 0.55
    clone.metallic = 0
    clone.roughness = 0.18
    result = clone
  } else {
    result = source
  }
  cache.set(source, result)
  return result
}

export class Raiders {
  private template: LoadedModel | null = null
  private molten: TransformNode | null = null
  private puddleSource: Mesh | null = null
  private readonly pool: Raider[] = []
  private readonly live: Raider[] = []
  private readonly melts: Melt[] = []
  private readonly toPlayer = new Vector3()
  private readonly step = new Vector3()
  private clock = 0
  private count = 0
  ready = false

  constructor(private readonly scene: Scene, readonly hooks: RaiderHooks, private readonly shadows: ShadowGenerator) {}

  async load(): Promise<void> {
    if (this.template) return
    const model = await loadModel(this.scene, MODEL_URL, 'raider-template')
    model.root.position.y = HIDDEN_Y
    for (const mesh of model.meshes) {
      mesh.isPickable = false
      mesh.receiveShadows = true
      mesh.alwaysSelectAsActiveMesh = false
    }
    this.template = model
    const cache = new Map<Material, Material>()
    const molten = model.root.instantiateHierarchy(null, { doNotInstantiate: true }) as TransformNode
    molten.name = 'raider-molten'
    molten.position.y = HIDDEN_Y
    for (const node of molten.getChildMeshes(false)) {
      node.isPickable = false
      if (node.material) node.material = moltenMaterial(node.material, this.scene, cache)
    }
    this.molten = molten
    const puddle = blobMesh(this.scene)
    const goo = new PBRMaterial('raider-goo', this.scene)
    goo.albedoColor = new Color3(0.07, 0.012, 0.01)
    goo.emissiveColor = new Color3(0.05, 0.006, 0)
    goo.metallic = 0
    goo.roughness = 0.1
    goo.environmentIntensity = 0.35
    goo.zOffset = -2
    goo.backFaceCulling = false
    puddle.material = goo
    puddle.isPickable = false
    puddle.receiveShadows = true
    puddle.position.y = HIDDEN_Y
    this.puddleSource = puddle
    this.ready = true
  }

  get alive(): number {
    return this.live.length
  }

  positions(): Vector3[] {
    return this.live.map(raider => raider.mover.position)
  }

  private take(): Raider {
    const raider = this.pool.pop() ?? new Raider(this.scene, this.count++, this)
    if (!raider.visual && this.template) {
      const nodes = new Map<string, TransformNode>()
      const visual = this.template.root.instantiateHierarchy(raider.mover, undefined, (source, clone) => {
        nodes.set(source.name, clone as TransformNode)
        if ((clone as AbstractMesh).isPickable !== undefined) (clone as AbstractMesh).isPickable = false
      }) as TransformNode
      visual.position.set(0, 0, 0)
      raider.visual = visual
      raider.shoulder = nodes.get('Prop_Shoulder') ?? findNode(visual, 'Prop_Shoulder')
      raider.wheels = ['Wheel_L', 'Wheel_R'].map(name => nodes.get(name) ?? findNode(visual, name)).filter((node): node is TransformNode => Boolean(node))
      for (const node of [raider.shoulder, ...raider.wheels]) {
        if (!node) continue
        node.rotationQuaternion = null
      }
      for (const mesh of visual.getChildMeshes(false)) this.shadows.addShadowCaster(mesh, false)
    }
    return raider
  }

  spawn(position: Vector3, speedScale: number): void {
    if (!this.ready) return
    const raider = this.take()
    raider.mover.position.copyFrom(position)
    raider.mover.setEnabled(true)
    raider.hitBody.setEnabled(true)
    raider.hitHead.setEnabled(true)
    raider.health = HORDE.raiderHealth
    raider.alive = true
    raider.speedScale = speedScale
    raider.velocity.setAll(0)
    raider.verticalSpeed = 0
    raider.phase = 'roll'
    raider.phaseTime = 0
    raider.stuckClock = 0
    raider.sidestep = 0
    raider.stuckFrom.copyFrom(position)
    const feet = this.hooks.playerFeet()
    raider.yaw = Math.atan2(feet.x - position.x, feet.z - position.z)
    raider.mover.rotation.y = raider.yaw
    if (raider.shoulder) raider.shoulder.rotation.x = SWING_FROM
    this.live.push(raider)
  }

  kill(raider: Raider, point: Vector3): void {
    raider.alive = false
    const index = this.live.indexOf(raider)
    if (index >= 0) this.live.splice(index, 1)
    raider.hitBody.setEnabled(false)
    raider.hitHead.setEnabled(false)
    raider.mover.setEnabled(false)
    this.hooks.killed(raider.lastHeadshot, raider.mover.position.clone())
    this.melt(raider)
    this.pool.push(raider)
    void point
  }

  private melt(raider: Raider): void {
    if (!this.molten || !this.puddleSource) return
    const root = this.molten.instantiateHierarchy(null) as TransformNode
    root.position.copyFrom(raider.mover.position)
    root.rotation.y = raider.yaw
    const shoulder = findNode(root, 'Prop_Shoulder')
    if (shoulder) {
      shoulder.rotationQuaternion = null
      shoulder.rotation.x = raider.shoulder?.rotation.x ?? SWING_FROM
    }
    const puddle = this.puddleSource.createInstance(`raider-puddle-${this.clock.toFixed(2)}`)
    puddle.position.set(raider.mover.position.x, raider.mover.position.y + 0.012, raider.mover.position.z)
    puddle.scaling.setAll(0.01)
    puddle.rotation.y = Math.random() * Math.PI
    this.melts.push({ root, puddle, age: 0, spin: (Math.random() - 0.5) * 0.6 })
  }

  private route(raider: Raider, feet: Vector3): Vector3 {
    return nextWaypoint(raider.mover.position, feet)
  }

  update(dt: number, elapsed: number, speed: number): void {
    this.clock += dt
    const feet = this.hooks.playerFeet()
    const playerAlive = this.hooks.playerAlive()
    for (const raider of this.live) this.steer(raider, dt, feet, speed, playerAlive)
    this.separate(dt)
    this.updateMelts(dt)
    void elapsed
  }

  private steer(raider: Raider, dt: number, feet: Vector3, speed: number, playerAlive: boolean): void {
    const position = raider.mover.position
    const goal = this.route(raider, feet)
    this.toPlayer.set(goal.x - position.x, 0, goal.z - position.z)
    const distance = this.toPlayer.length()
    const flat = Math.hypot(feet.x - position.x, feet.z - position.z)
    const rise = feet.y - position.y
    const inReach = playerAlive && flat < HORDE.reach + 0.25 && rise > -1 && rise < 2.1

    raider.phaseTime += dt
    if (raider.phase === 'roll' && inReach) {
      raider.phase = 'windup'
      raider.phaseTime = 0
      raider.struck = false
    } else if (raider.phase === 'windup' && raider.phaseTime >= HORDE.windup) {
      raider.phase = 'swing'
      raider.phaseTime = 0
    } else if (raider.phase === 'swing') {
      if (!raider.struck && raider.phaseTime >= HORDE.swing * 0.6) {
        raider.struck = true
        if (playerAlive && flat < HORDE.reach + 0.45 && rise > -1 && rise < 2.2) this.hooks.hitPlayer(HORDE.batDamage, position)
      }
      if (raider.phaseTime >= HORDE.swing) {
        raider.phase = 'recover'
        raider.phaseTime = 0
      }
    } else if (raider.phase === 'recover' && raider.phaseTime >= HORDE.recover) {
      raider.phase = 'roll'
      raider.phaseTime = 0
    }

    if (raider.shoulder) {
      const t = raider.phaseTime
      let angle = SWING_FROM
      if (raider.phase === 'windup') angle = SWING_FROM - 0.55 * Math.min(1, t / HORDE.windup)
      else if (raider.phase === 'swing') angle = SWING_FROM - 0.55 + (SWING_TO - SWING_FROM + 0.55) * Math.min(1, t / HORDE.swing)
      else if (raider.phase === 'recover') angle = SWING_TO + (SWING_FROM - SWING_TO) * Math.min(1, t / HORDE.recover)
      else angle = SWING_FROM + Math.sin(this.clock * 3 + raider.speedScale * 9) * 0.08
      raider.shoulder.rotation.x = angle
    }

    const attacking = raider.phase !== 'roll'
    const top = speed * raider.speedScale * (attacking ? 0.2 : 1)
    let wantX = distance > 0.01 ? (this.toPlayer.x / distance) * top : 0
    let wantZ = distance > 0.01 ? (this.toPlayer.z / distance) * top : 0
    if (flat < 0.9 && goal === feet) {
      wantX *= 0.1
      wantZ *= 0.1
    }
    if (raider.sidestep > 0) {
      raider.sidestep -= dt
      const sx = -wantZ * raider.sideSign
      const sz = wantX * raider.sideSign
      wantX = wantX * 0.25 + sx
      wantZ = wantZ * 0.25 + sz
    }
    const blend = Math.min(1, dt * 5)
    raider.velocity.x += (wantX - raider.velocity.x) * blend
    raider.velocity.z += (wantZ - raider.velocity.z) * blend

    raider.verticalSpeed += GRAVITY * dt
    const snap = raider.grounded && raider.verticalSpeed <= 0 ? 0.14 : 0
    const requestedY = raider.verticalSpeed * dt - snap
    this.step.set(raider.velocity.x * dt, requestedY, raider.velocity.z * dt)
    const beforeX = position.x
    const beforeY = position.y
    const beforeZ = position.z
    raider.mover.moveWithCollisions(this.step)
    const movedY = position.y - beforeY
    if (raider.verticalSpeed <= 0 && movedY > requestedY + 0.001) {
      raider.grounded = true
      raider.verticalSpeed = 0
    } else {
      raider.grounded = false
    }
    if (position.y < -20) position.set(0, 0.5, 0)

    const moved = Math.hypot(position.x - beforeX, position.z - beforeZ)
    for (const wheel of raider.wheels) wheel.rotation.x += moved / WHEEL_RADIUS
    const heading = Math.hypot(raider.velocity.x, raider.velocity.z) > 0.3 ? Math.atan2(raider.velocity.x, raider.velocity.z) : Math.atan2(feet.x - position.x, feet.z - position.z)
    let turn = heading - raider.yaw
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    raider.yaw += turn * Math.min(1, dt * (attacking ? 10 : 6))
    raider.mover.rotation.y = raider.yaw

    raider.stuckClock += dt
    if (raider.stuckClock >= STUCK_CHECK) {
      const progress = Math.hypot(position.x - raider.stuckFrom.x, position.z - raider.stuckFrom.z)
      if (!attacking && progress < top * STUCK_CHECK * 0.3 && raider.sidestep <= 0) {
        raider.sidestep = 0.6 + Math.random() * 0.5
        raider.sideSign = Math.random() < 0.5 ? -1 : 1
      }
      raider.stuckClock = 0
      raider.stuckFrom.copyFrom(position)
    }
  }

  private separate(dt: number): void {
    const list = this.live
    const push = Math.min(1, dt * 6)
    for (let i = 0; i < list.length; i++) {
      const a = list[i].mover.position
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j].mover.position
        const dx = b.x - a.x
        const dz = b.z - a.z
        if (Math.abs(b.y - a.y) > 1.2) continue
        const d2 = dx * dx + dz * dz
        if (d2 >= SEPARATION * SEPARATION || d2 < 1e-6) continue
        const d = Math.sqrt(d2)
        const shove = ((SEPARATION - d) / d) * 0.5 * push
        list[i].velocity.x -= dx * shove * 4
        list[i].velocity.z -= dz * shove * 4
        list[j].velocity.x += dx * shove * 4
        list[j].velocity.z += dz * shove * 4
      }
    }
  }

  pushOut(feet: Vector3): Vector3 | null {
    let x = 0
    let z = 0
    for (const raider of this.live) {
      const p = raider.mover.position
      if (Math.abs(feet.y - p.y) > 1.3) continue
      const dx = feet.x - p.x
      const dz = feet.z - p.z
      const d = Math.hypot(dx, dz)
      const min = RADIUS + 0.45
      if (d >= min || d < 1e-4) continue
      x += (dx / d) * (min - d)
      z += (dz / d) * (min - d)
    }
    return x || z ? new Vector3(x, 0, z) : null
  }

  private updateMelts(dt: number): void {
    for (let i = this.melts.length - 1; i >= 0; i--) {
      const melt = this.melts[i]
      melt.age += dt
      const t = Math.min(1, melt.age / MELT_TIME)
      const ease = t * t * (3 - 2 * t)
      melt.root.scaling.set(1 + ease * 0.7, Math.max(0.02, 1 - ease * 0.98), 1 + ease * 0.7)
      melt.root.rotation.y += melt.spin * dt * (1 - t)
      const grow = Math.min(1, melt.age / (MELT_TIME * 1.2))
      const fade = melt.age > PUDDLE_LIFE - 1.5 ? Math.max(0, (PUDDLE_LIFE - melt.age) / 1.5) : 1
      const radius = (0.15 + grow * 0.95) * fade
      melt.puddle.scaling.set(radius, 1, radius * 0.85)
      if (t >= 1 && melt.root.isEnabled()) melt.root.setEnabled(false)
      if (melt.age >= PUDDLE_LIFE) {
        melt.root.dispose()
        melt.puddle.dispose()
        this.melts.splice(i, 1)
      }
    }
  }

  clear(): void {
    for (const raider of [...this.live]) {
      raider.alive = false
      raider.mover.setEnabled(false)
      raider.hitBody.setEnabled(false)
      raider.hitHead.setEnabled(false)
      this.pool.push(raider)
    }
    this.live.length = 0
    for (const melt of this.melts) {
      melt.root.dispose()
      melt.puddle.dispose()
    }
    this.melts.length = 0
  }

  dispose(): void {
    this.clear()
    for (const raider of this.pool) {
      if (raider.visual) for (const mesh of raider.visual.getChildMeshes(false)) this.shadows.removeShadowCaster(mesh, false)
      raider.mover.dispose(false, false)
    }
    this.pool.length = 0
  }
}
