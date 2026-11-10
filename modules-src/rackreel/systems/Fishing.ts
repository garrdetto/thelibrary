import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { EngineContext } from '../core/EngineSetup'
import { disposeRig, instantiate } from '../core/ModelLibrary'
import type { ModelName, ModelRig, ModelTemplate } from '../core/ModelLibrary'
import { lakeCoord, marshWeight } from '../world/Terrain'
import type { Terrain } from '../world/Terrain'
import { BiteMarker, Bobber, WaterFx } from './FishingFx'
import { bobberScale, crankSpeed, effectScale, jumpPose, landingLift, planNibble, plungeDepth, rodBend, shouldJump, twitchDip } from './FishingMotion'
import type { NibblePlan } from './FishingMotion'
import { bufferedSine } from './Waves'
import type { Habitat, LootTableManager, Specimen } from './LootTableManager'
import { SPECIES_BY_ID } from './LootTableManager'
import type { ReelSnapshot, SkillCheckManager } from './SkillCheckManager'
import type { BaitStyle } from '../shared/Economy'

export type FishingState = 'idle' | 'charging' | 'flying' | 'waiting' | 'nibble' | 'bite' | 'reeling' | 'landing' | 'retrieving'

export type FishingEvent =
  | { type: 'cast'; distance: number }
  | { type: 'splash'; inWater: boolean; habitat: Habitat | null }
  | { type: 'nibble' }
  | { type: 'bite'; lure: boolean }
  | { type: 'missed'; pulled?: boolean }
  | { type: 'hooked'; specimen: Specimen }
  | { type: 'jump'; specimen: Specimen }
  | { type: 'landed'; specimen: Specimen }
  | { type: 'flop'; wet: boolean }
  | { type: 'lost'; reason: 'snapped' | 'thrown' }
  | { type: 'reeled-in' }

const LINE_POINTS = 16
/** Metres of line a held reel brings in per second before the reel upgrade. */
export const RETRIEVE_SPEED = 3.25
/** The cast is home once the float or lure is this close to the rod tip. */
const RETRIEVE_HOME = 2.2
const LAND_TIME = 1.15
/** Seconds the landed fish flops on the deck, dock or bank (or in the shallows) before it is in hand. */
export const FLOP_TIME = 2.4
/** Fish models are about 1.12 units nose to tail; the mouth sits at +0.5 on the model's z axis. */
const FISH_MODEL_LENGTH = 1.12
const FISH_MOUTH = 0.5

interface FlopHop {
  t: number
  length: number
  height: number
  rollFrom: number
  rollTo: number
  spin: number
  dx: number
  dz: number
}

export class Fishing {
  state: FishingState = 'idle'
  power = 0
  habitat: Habitat | null = null
  hooked: Specimen | null = null
  reel: ReelSnapshot | null = null
  private readonly bobber: Bobber
  private readonly fx: WaterFx
  private readonly marker: BiteMarker
  private line: LinesMesh
  private leader: LinesMesh
  private readonly linePoints: Vector3[] = []
  private readonly leaderPoints = [new Vector3(), new Vector3()]
  private readonly scratchSplash = new Vector3()
  private readonly from = new Vector3()
  private readonly target = new Vector3()
  private readonly landing = new Vector3()
  private readonly end = new Vector3()
  private flight = 0
  private flightTime = 0.9
  private biteTime = 0
  private biteClock = 0
  private readonly drift = new Vector3()
  private clock = 0
  private chargeDir = 1
  private nibble: NibblePlan = { duration: 0, twitches: [] }
  private nibbleClock = 0
  private nextTwitch = 0
  private ringTimer = 0
  private splashTimer = 0
  private fish: ModelRig | null = null
  private fishScale = 0.3
  private fight = 0.5
  private readonly fishPos = new Vector3()
  private readonly fishVel = new Vector3()
  private fishHeading = 0
  private fishPitch = 0
  private jumpClock = -1
  private jumpTime = 0.8
  private jumpPeak = 0.5
  private jumpCooldown = 0
  private lastSurge = 0
  private landClock = 0
  private readonly landFrom = new Vector3()
  private readonly flopFrom = new Vector3()
  private dripTimer = 0
  private flopClock = -1
  private dropping = false
  private hop: FlopHop = { t: 0, length: 0.3, height: 0.1, rollFrom: 0, rollTo: 0, spin: 0, dx: 0, dz: 0 }
  private fishRoll = 0
  private thrash = 0
  private thrashSplash = 0
  private readonly flopAt = new Vector3()
  private flopFloor = 0
  private flopWet = false
  private lostBobber = false
  private holding = false
  private lureDepth = 0
  private wakeTimer = 0
  castRange = 1
  reelSpeed = 1
  bias: Record<string, number> = {}
  bait: BaitStyle = { kind: 'live', nibbleScale: 1, hookWindow: 1.7, rate: 1, trophyOdds: 1, hint: '' }
  /** True while the angler is reeling an unhooked line back in. */
  retrieving = false
  /** Where the angler stands, so a landed fish is swung in to flop at their feet. */
  readonly anglerAt = new Vector3()
  /** Height of whatever the landed fish drops onto at x, z: dock planks, boat deck or ground (water counts as 0). */
  floorAt: (x: number, z: number) => number = (x, z) => Math.max(0, this.terrain.heightAt(x, z))
  onEvent: ((event: FishingEvent) => void) | null = null

  constructor(private readonly ctx: EngineContext, private readonly scene: Scene, private readonly terrain: Terrain, private readonly loot: LootTableManager, private readonly skill: SkillCheckManager, private readonly fishModel: (name: ModelName) => ModelTemplate | undefined, private readonly rand: () => number = Math.random) {
    this.bobber = new Bobber(ctx, scene)
    this.fx = new WaterFx(ctx, scene, (x, z) => (this.terrain.depthAt(x, z) > 0.04 ? 0 : null), (x, y, z) => {
      const cam = ctx.camera.globalPosition
      return effectScale(Math.hypot(x - cam.x, y - cam.y, z - cam.z), ctx.camera.fov)
    })
    this.marker = new BiteMarker(ctx, scene)
    for (let i = 0; i < LINE_POINTS; i++) this.linePoints.push(new Vector3())
    this.line = CreateLines('line', { points: this.linePoints, updatable: true }, scene)
    this.line.color = new Color3(0.9, 0.93, 0.86)
    this.line.alpha = 0.85
    this.line.isPickable = false
    this.line.setEnabled(false)
    this.line.alwaysSelectAsActiveMesh = true
    ctx.registerDynamic(this.line)
    this.leader = CreateLines('leader', { points: this.leaderPoints, updatable: true }, scene)
    this.leader.color = new Color3(0.8, 0.85, 0.8)
    this.leader.alpha = 0.6
    this.leader.isPickable = false
    this.leader.setEnabled(false)
    this.leader.alwaysSelectAsActiveMesh = true
    ctx.registerDynamic(this.leader)
  }

  /** Compile the float and bite marker shaders up front so the first cast doesn't stall. */
  async prewarm(): Promise<void> {
    await Promise.all([...this.bobber.meshes, this.marker.mesh].map((m) => m.material?.forceCompilationAsync(m)))
  }

  get lineInWater(): boolean {
    return this.state === 'waiting' || this.state === 'nibble' || this.state === 'bite'
  }

  get busy(): boolean {
    return this.state !== 'idle'
  }

  /** Fighting or lifting a fish: the angler can't walk and the hands stay on the reel. */
  get fighting(): boolean {
    return this.state === 'reeling' || this.state === 'landing'
  }

  /** Where the line leaves the rod's pull: the float, or the fish once it's hooked. */
  get lineEnd(): Vector3 {
    if (this.fish && this.fighting) return this.fishPos
    return this.end
  }

  get lineTaut(): boolean {
    return this.state === 'bite' || this.state === 'reeling' || this.state === 'landing'
  }

  /** Rod bend 0..1 for the current moment of the fight. */
  get rodBend(): number {
    const tension = this.reel?.tension ?? 0
    const surge = this.reel?.surge ?? 0
    let bend = rodBend(this.state, tension, surge, this.clock)
    if (this.state === 'nibble') bend += this.twitchAmount() * 0.12
    if (this.state === 'landing') bend *= 0.6 + Math.min(1, this.fishScale * 1.4) * 0.6
    return Math.min(1, bend)
  }

  /** Reel crank speed in radians per second (negative while the drag gives line). */
  get crankSpeed(): number {
    return crankSpeed(this.state, this.holding, this.reel?.tension ?? 0, this.reel?.surge ?? 0)
  }

  /** True while a run is peeling line off against the drag. */
  get dragging(): boolean {
    return this.crankSpeed < 0
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
    const distance = (7 + this.power * 33) * this.castRange
    this.from.copyFrom(rodTip)
    this.target.set(rodTip.x + flat.x * distance, 0, rodTip.z + flat.z * distance)
    this.target.y = Math.max(0, this.terrain.heightAt(this.target.x, this.target.z))
    this.flightTime = 0.55 + this.power * 0.6
    this.flight = 0
    this.state = 'flying'
    this.lureDepth = 0
    this.lostBobber = false
    this.bobber.setEnabled(true)
    this.line.setEnabled(true)
    this.onEvent?.({ type: 'cast', distance })
  }

  cancel(): void {
    if (this.state === 'waiting' || this.state === 'nibble' || this.state === 'bite' || this.state === 'flying') {
      this.marker.show(false)
      this.state = 'retrieving'
      this.flight = 0
      this.landing.copyFrom(this.bobber.position)
      this.landing.y = Math.max(0, this.landing.y)
      if (this.terrain.depthAt(this.landing.x, this.landing.z) > 0.04) this.fx.ring(this.landing.x, this.landing.z, 0.35, 0.6, 1)
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

  /** A fish has found the bait. It mouths it for a moment (nibble), then takes the float under (bite). */
  bite(): boolean {
    if (this.state !== 'waiting') return false
    if (this.bait.kind === 'lure') {
      this.strike()
      return true
    }
    this.state = 'nibble'
    this.nibble = planNibble(this.rand)
    this.nibble = { duration: this.nibble.duration * this.bait.nibbleScale, twitches: this.nibble.twitches.map((t) => t * this.bait.nibbleScale) }
    this.nibbleClock = 0
    this.nextTwitch = 0
    this.onEvent?.({ type: 'nibble' })
    return true
  }

  setHook(): boolean {
    if (this.state !== 'bite') return false
    const at = this.bobber.position
    const habitat = this.habitatAt(at.x, at.z)
    const species = this.loot.pickSpecies('fish', habitat, this.bias)
    const specimen = this.loot.createSpecimen(species.id, this.bait.trophyOdds)
    const template = SPECIES_BY_ID[species.id]
    const sizeFactor = (specimen.value - template.min) / Math.max(1e-6, template.max - template.min)
    const fight = template.fight * (0.65 + Math.min(1.4, sizeFactor) * 0.55) * (specimen.legendary ? 1.25 : 1)
    this.hooked = specimen
    this.fight = fight
    this.skill.beginReel(fight)
    this.landing.set(at.x, 0, at.z)
    this.marker.show(false)
    this.spawnFish(specimen, template.model as ModelName)
    this.fx.splash(new Vector3(at.x, 0, at.z), 0.5 + Math.min(1, fight) * 0.5, this.rand)
    this.jumpCooldown = 1.2
    this.lastSurge = 0
    this.state = 'reeling'
    this.onEvent?.({ type: 'hooked', specimen })
    return true
  }

  update(dt: number, rodTip: Vector3, holdingReel: boolean): void {
    this.clock += dt
    this.holding = holdingReel && this.state === 'reeling'
    this.retrieving = false
    if (holdingReel && (this.state === 'waiting' || this.state === 'nibble')) {
      if (this.reelLine(dt, rodTip)) return
    } else if (this.state === 'waiting' && this.bait.kind === 'lure') {
      this.sinkLure(dt)
    }
    switch (this.state) {
      case 'charging': this.updateCharge(dt); break
      case 'flying': this.updateFlight(dt); break
      case 'waiting': this.updateFloat(dt, this.lureDepth, 0); break
      case 'nibble': this.updateNibble(dt); break
      case 'bite': this.updateBite(dt); break
      case 'reeling': this.updateFight(dt, rodTip, holdingReel); break
      case 'landing': this.updateLanding(dt, rodTip); break
      case 'retrieving': this.updateRetrieve(dt, rodTip); break
      default: break
    }
    const camera = this.ctx.camera
    if (this.bobber.isEnabled()) {
      const dist = Vector3.Distance(camera.globalPosition, this.bobber.position)
      this.bobber.root.scaling.setAll(bobberScale(dist, camera.fov))
    }
    this.marker.update(dt, this.bobber.position, camera)
    this.fx.update(dt, camera)
    if (this.line.isEnabled()) this.updateLine(rodTip)
  }

  private updateCharge(dt: number): void {
    this.power += this.chargeDir * dt * 0.85
    if (this.power >= 1) {
      this.power = 1
      this.chargeDir = -1
    } else if (this.power <= 0.15) {
      this.power = 0.15
      this.chargeDir = 1
    }
  }

  private updateFlight(dt: number): void {
    this.flight += dt
    const t = Math.min(1, this.flight / this.flightTime)
    const p = Vector3.Lerp(this.from, this.target, t)
    p.y += Math.sin(t * Math.PI) * (2.5 + this.power * 5)
    this.bobber.position.copyFrom(p)
    this.bobber.root.rotation.set(t * 5, 0, t * 2)
    this.end.copyFrom(p)
    if (t < 1) return
    const inWater = this.terrain.depthAt(this.target.x, this.target.z) > 0.6
    this.habitat = inWater ? this.habitatAt(this.target.x, this.target.z) : null
    this.onEvent?.({ type: 'splash', inWater, habitat: this.habitat })
    this.landing.copyFrom(this.target)
    this.bobber.root.rotation.set(0, 0, 0)
    if (inWater) {
      this.landing.y = 0
      this.fx.splash(this.landing, 0.25 + this.power * 0.2, this.rand)
      this.ringTimer = 1.5
      this.state = 'waiting'
    } else {
      this.state = 'retrieving'
      this.flight = 0
    }
  }

  /** The float at rest on the lake: a gentle bob, a slow lean with the chop and the odd idle ring. */
  private updateFloat(dt: number, dip: number, lean: number): void {
    const bob = bufferedSine(this.clock * 2.1) * 0.012 + bufferedSine(this.clock * 3.7 + 1) * 0.005
    this.bobber.position.set(this.landing.x, bob - dip, this.landing.z)
    this.bobber.root.rotation.set(bufferedSine(this.clock * 1.3) * 0.08 + lean, 0, bufferedSine(this.clock * 1.7 + 2) * 0.08)
    this.end.copyFrom(this.bobber.position)
    this.ringTimer -= dt
    if (this.ringTimer <= 0) {
      this.ringTimer = 2.2 + this.rand() * 1.6
      this.fx.ring(this.landing.x, this.landing.z, 0.28, 0.35, 1.8)
    }
  }

  private twitchAmount(): number {
    let dip = 0
    for (const at of this.nibble.twitches) dip = Math.max(dip, twitchDip(this.nibbleClock - at))
    return dip
  }

  private updateNibble(dt: number): void {
    this.nibbleClock += dt
    while (this.nextTwitch < this.nibble.twitches.length && this.nibbleClock >= this.nibble.twitches[this.nextTwitch]) {
      this.nextTwitch++
      this.fx.ring(this.landing.x, this.landing.z, 0.32, 0.75, 1.1)
    }
    const dip = this.twitchAmount()
    this.updateFloat(dt, dip * 0.045, dip * 0.35)
    if (this.nibbleClock < this.nibble.duration) return
    this.strike()
  }

  /** The fish takes it: the float goes under, or a lure gets hammered. */
  private strike(): void {
    this.state = 'bite'
    this.biteTime = this.bait.hookWindow
    this.biteClock = 0
    this.lureDepth = 0
    const a = this.rand() * Math.PI * 2
    this.drift.set(Math.cos(a), 0, Math.sin(a))
    this.fx.splash(this.landing, 0.55, this.rand)
    this.fx.ring(this.landing.x, this.landing.z, 0.9, 1, 1.4, 1)
    this.marker.show(true)
    this.ringTimer = 0
    this.onEvent?.({ type: 'bite', lure: this.bait.kind === 'lure' })
  }

  /**
   * Holding the reel with no fish on brings the line in a little at a time: let go and it stops
   * where it is. Live bait moved during a nibble pulls it away from the fish.
   */
  private reelLine(dt: number, rodTip: Vector3): boolean {
    if (this.state === 'nibble') {
      this.state = 'waiting'
      this.nextTwitch = 0
      this.fx.ring(this.landing.x, this.landing.z, 0.4, 0.7, 1.2)
      this.onEvent?.({ type: 'missed', pulled: true })
    }
    this.retrieving = true
    const home = new Vector3(rodTip.x, 0, rodTip.z)
    const toward = home.subtract(new Vector3(this.landing.x, 0, this.landing.z))
    const dist = toward.length()
    const step = RETRIEVE_SPEED * this.reelSpeed * dt
    if (dist <= RETRIEVE_HOME + step) {
      this.finish()
      this.onEvent?.({ type: 'reeled-in' })
      return true
    }
    toward.scaleInPlace(step / dist)
    const nx = this.landing.x + toward.x
    const nz = this.landing.z + toward.z
    if (this.terrain.depthAt(nx, nz) < 0.15) {
      // Ran up on the shore or the weeds: lift it out the rest of the way.
      this.cancel()
      return false
    }
    this.landing.x = nx
    this.landing.z = nz
    if (this.bait.kind === 'lure') {
      this.lureDepth = Math.min(0.08, this.lureDepth + dt * 0.3)
      this.wakeTimer -= dt
      if (this.wakeTimer <= 0) {
        this.wakeTimer = 0.25
        this.fx.ring(this.landing.x, this.landing.z, 0.22, 0.4, 0.9, 0.4)
      }
    }
    return false
  }

  /** A lure that stops sinks back toward the bottom and loses its action. */
  private sinkLure(dt: number): void {
    this.lureDepth = Math.max(0, this.lureDepth - dt * 0.05)
  }

  private updateBite(dt: number): void {
    this.biteTime -= dt
    this.biteClock += dt
    const step = this.drift.scale(dt * (0.55 + Math.sin(this.biteClock * 7) * 0.2))
    const nx = this.landing.x + step.x
    const nz = this.landing.z + step.z
    if (this.terrain.depthAt(nx, nz) > 0.6) {
      this.landing.x = nx
      this.landing.z = nz
    } else {
      this.drift.scaleInPlace(-1)
    }
    const y = plungeDepth(this.biteClock) + Math.sin(this.biteClock * 13) * 0.015
    this.bobber.position.set(this.landing.x, y, this.landing.z)
    this.bobber.root.rotation.set(0.6 * this.drift.z, 0, -0.6 * this.drift.x)
    this.end.copyFrom(this.bobber.position)
    this.ringTimer -= dt
    if (this.ringTimer <= 0) {
      this.ringTimer = 0.16
      this.fx.ring(this.landing.x, this.landing.z, 0.45, 0.8, 1.1, 0.6)
    }
    this.splashTimer -= dt
    if (this.splashTimer <= 0) {
      this.splashTimer = 0.45 + this.rand() * 0.3
      this.fx.splash(new Vector3(this.landing.x, 0, this.landing.z), 0.15, this.rand)
    }
    if (this.biteTime > 0) return
    this.state = 'waiting'
    this.marker.show(false)
    this.fx.splash(new Vector3(this.landing.x, 0, this.landing.z), 0.2, this.rand)
    this.fx.ring(this.landing.x, this.landing.z, 0.6, 0.9, 1.4)
    this.landing.y = 0
    this.ringTimer = 1.5
    this.onEvent?.({ type: 'missed' })
  }

  private spawnFish(specimen: Specimen, model: ModelName): void {
    this.disposeFish()
    const template = this.fishModel(model)
    const length = specimen.lengthIn * 0.0254
    this.fishScale = length / FISH_MODEL_LENGTH
    this.fishPos.set(this.landing.x, -0.3, this.landing.z)
    this.fishVel.setAll(0)
    this.fishPitch = 0
    this.jumpClock = -1
    if (!template) return
    this.fish = instantiate(template, null, this.scene, (m) => {
      m.sourceMesh.renderingGroupId = 0
      m.sourceMesh.applyFog = true
      m.alwaysSelectAsActiveMesh = true
      this.ctx.registerDynamic(m)
    })
    this.fish.root.scaling.setAll(length)
    this.placeFish()
  }

  private disposeFish(): void {
    this.flopClock = -1
    this.dropping = false
    this.thrash = 0
    this.fishRoll = 0
    if (!this.fish) return
    disposeRig(this.fish, (m) => this.ctx.unregisterDynamic(m))
    this.fish = null
  }

  private placeFish(): void {
    if (!this.fish) return
    const root = this.fish.root
    root.position.copyFrom(this.fishPos)
    const flopping = this.flopClock >= 0
    const th = this.thrash
    root.rotation.set(-this.fishPitch, this.fishHeading, flopping ? this.fishRoll : Math.sin(this.clock * (5 + th * 11)) * (0.12 + th * 0.5))
    const tail = this.fish.joints.get('tail')
    const tension = this.reel?.tension ?? 50
    if (tail) {
      if (flopping) tail.rotation.y = Math.sin(this.clock * 31) * 0.75 * (1 - this.flopClock / FLOP_TIME * 0.5)
      else tail.rotation.y = Math.sin(this.clock * (9 + tension * 0.08 + th * 10)) * (0.35 + th * 0.3 + (this.jumpClock >= 0 ? 0.3 : 0))
    }
  }

  private mouth(out: Vector3): Vector3 {
    const len = this.fishScale * FISH_MODEL_LENGTH
    const c = Math.cos(this.fishPitch)
    out.set(Math.sin(this.fishHeading) * c, Math.sin(this.fishPitch), Math.cos(this.fishHeading) * c)
    return out.scaleInPlace(FISH_MOUTH * len).addInPlace(this.fishPos)
  }

  private updateFight(dt: number, rodTip: Vector3, holdingReel: boolean): void {
    this.skill.setHolding(holdingReel)
    const snap = this.skill.updateReel(dt)
    this.reel = snap
    const len = this.fishScale * FISH_MODEL_LENGTH
    const near = new Vector3(rodTip.x, 0, rodTip.z)
    const toNear = near.subtract(this.landing)
    const along = Vector3.Lerp(this.landing, near, Math.min(0.92, snap.progress / 100))
    const side = new Vector3(-toNear.z, 0, toNear.x).normalize()
    const swim = bufferedSine(this.clock * 0.9) * 2.4 * (1 - snap.progress / 110)
    along.addInPlace(side.scale(swim))
    if (this.terrain.depthAt(along.x, along.z) < 0.25) along.set(this.fishPos.x, 0, this.fishPos.z)
    const prev = this.fishPos.clone()
    const k = Math.min(1, dt * 3.5)
    this.fishPos.x += (along.x - this.fishPos.x) * k
    this.fishPos.z += (along.z - this.fishPos.z) * k
    const surfaceK = Math.min(1, Math.max(0, (snap.progress - 55) / 35))
    let y = -0.42 + surfaceK * 0.36 + bufferedSine(this.clock * 6) * 0.03 - (snap.tension / 100) * 0.06 * (1 - surfaceK)
    this.jumpCooldown -= dt
    if (this.jumpClock < 0 && shouldJump(snap.surge, this.lastSurge, snap.progress, this.jumpCooldown, this.fight)) {
      this.jumpClock = 0
      this.jumpTime = 0.7 + Math.min(1, this.fight) * 0.3
      this.jumpPeak = 0.25 + Math.min(1, this.fight) * 0.45 + len * 0.35
      this.fx.splash(new Vector3(this.fishPos.x, 0, this.fishPos.z), 0.6 + Math.min(1, this.fight) * 0.4, this.rand)
      this.onEvent?.({ type: 'jump', specimen: this.hooked! })
    }
    this.lastSurge = snap.surge
    if (this.jumpClock >= 0) {
      this.jumpClock += dt
      const pose = jumpPose(this.jumpClock, this.jumpTime, this.jumpPeak)
      y = pose.height - 0.05
      this.fishPitch = pose.pitch
      if (pose.t >= 1) {
        this.jumpClock = -1
        this.jumpCooldown = 3 + this.rand() * 3
        this.fishPitch = 0
        this.fx.splash(new Vector3(this.fishPos.x, 0, this.fishPos.z), 0.75 + Math.min(1, this.fight) * 0.35, this.rand)
      }
    } else {
      this.fishPitch += (0 - this.fishPitch) * Math.min(1, dt * 6)
    }
    const floor = this.terrain.heightAt(this.fishPos.x, this.fishPos.z) + 0.06
    this.fishPos.y = Math.max(y, floor)
    this.fishVel.copyFrom(this.fishPos.subtract(prev).scaleInPlace(1 / Math.max(1e-3, dt)))
    const speed = Math.hypot(this.fishVel.x, this.fishVel.z)
    const awayHeading = Math.atan2(-toNear.x, -toNear.z)
    const want = speed > 0.25 ? Math.atan2(this.fishVel.x, this.fishVel.z) : awayHeading
    let delta = want - this.fishHeading
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    this.fishHeading += delta * Math.min(1, dt * 4)
    this.placeFish()

    const mouth = this.mouth(new Vector3())
    const toRod = rodTip.subtract(mouth)
    toRod.y = 0
    const flat = toRod.length() || 1
    toRod.scaleInPlace(1 / flat)
    const bx = mouth.x + toRod.x * (0.35 + len * 0.4)
    const bz = mouth.z + toRod.z * (0.35 + len * 0.4)
    const under = this.jumpClock >= 0 ? 0 : Math.max(0, (snap.tension - 72) / 28) * 0.09
    this.bobber.position.set(bx, bufferedSine(this.clock * 8) * 0.01 - under, bz)
    const lean = 0.25 + (snap.tension / 100) * 0.55
    this.bobber.root.rotation.set(-lean * toRod.z, 0, lean * toRod.x)
    this.end.copyFrom(this.bobber.position)

    this.ringTimer -= dt * (0.6 + speed * 1.2)
    if (this.ringTimer <= 0) {
      this.ringTimer = 0.22
      this.fx.ring(bx, bz, 0.3 + speed * 0.12, 0.55, 1.0, 0.4)
      if (surfaceK > 0.3) this.fx.ring(this.fishPos.x, this.fishPos.z, 0.35 + len * 0.6, 0.45 * surfaceK, 1.2, 1)
    }
    const thrashWant = this.jumpClock >= 0 ? 0 : surfaceK * Math.min(1, 0.45 + snap.surge / 30 + (snap.progress > 85 ? 0.35 : 0))
    this.thrash += (thrashWant - this.thrash) * Math.min(1, dt * 4)
    this.thrashSplash -= dt
    if (this.thrash > 0.45 && this.thrashSplash <= 0) {
      this.thrashSplash = 0.16 + this.rand() * 0.22
      const side = (this.rand() - 0.5) * len * 0.6
      this.fx.splash(this.scratchSplash.set(this.fishPos.x + Math.cos(this.fishHeading) * side, 0, this.fishPos.z - Math.sin(this.fishHeading) * side), 0.12 + this.thrash * 0.22, this.rand)
      if (this.rand() < 0.5) this.fx.ring(this.fishPos.x, this.fishPos.z, 0.25 + len * 0.5, 0.6 * this.thrash, 0.9, 1)
    }
    this.splashTimer -= dt
    if (surfaceK > 0.4 && this.jumpClock < 0 && this.splashTimer <= 0 && (snap.surge > 8 || this.rand() < 0.25)) {
      this.splashTimer = 0.28 + this.rand() * 0.35
      this.fx.splash(new Vector3(this.fishPos.x, 0, this.fishPos.z), 0.18 + surfaceK * 0.25 + Math.min(0.3, snap.surge / 100), this.rand)
    }

    this.leaderPoints[0].copyFrom(this.bobber.position)
    this.leaderPoints[1].copyFrom(mouth)
    this.leader.setEnabled(true)
    this.leader = CreateLines('leader', { points: this.leaderPoints, instance: this.leader })

    if (snap.outcome === 'landed') {
      this.state = 'landing'
      this.landClock = 0
      this.dripTimer = 0
      this.landFrom.copyFrom(this.fishPos)
      this.fx.splash(new Vector3(this.fishPos.x, 0, this.fishPos.z), 0.7 + Math.min(1, this.fight) * 0.3, this.rand)
    } else if (snap.outcome === 'snapped' || snap.outcome === 'thrown') {
      const reason = snap.outcome
      this.fx.splash(new Vector3(this.fishPos.x, 0, this.fishPos.z), reason === 'snapped' ? 0.8 : 0.5, this.rand)
      this.fx.ring(this.fishPos.x, this.fishPos.z, 1.1, 0.9, 1.6, 1)
      this.lostBobber = reason === 'snapped'
      this.disposeFish()
      this.leader.setEnabled(false)
      this.hooked = null
      this.reel = null
      this.skill.reset()
      this.state = 'retrieving'
      this.flight = 0
      this.landing.copyFrom(this.bobber.position)
      if (this.lostBobber) this.bobber.setEnabled(false)
      this.onEvent?.({ type: 'lost', reason })
    }
  }

  /** Swinging the fish out of the water and up to the rod tip. */
  private updateLanding(dt: number, rodTip: Vector3): void {
    if (this.flopClock >= 0) {
      this.updateFlop(dt, rodTip)
      return
    }
    this.thrash = 0
    this.landClock += dt
    const t = Math.min(1, this.landClock / LAND_TIME)
    const lift = landingLift(t)
    const len = this.fishScale * FISH_MODEL_LENGTH
    const hang = rodTip.subtract(new Vector3(0, 0.3 + len * 0.55, 0))
    Vector3.LerpToRef(this.landFrom, hang, lift, this.fishPos)
    this.fishPos.y += Math.sin(t * Math.PI) * 0.45
    this.fishPitch = (Math.PI / 2 - 0.15) * lift
    this.fishHeading += Math.sin(this.clock * 3) * dt * 0.8
    this.placeFish()
    if (this.fish) this.fish.root.rotation.z = Math.sin(this.clock * 14) * 0.25 * (1 - t * 0.5)
    this.dripTimer -= dt
    if (this.dripTimer <= 0 && this.fishPos.y > 0.05) {
      this.dripTimer = 0.04
      this.fx.drip(this.fishPos.add(new Vector3((this.rand() - 0.5) * len * 0.3, -len * 0.3, (this.rand() - 0.5) * len * 0.3)), this.rand)
    }
    const mouth = this.mouth(new Vector3())
    Vector3.LerpToRef(mouth, rodTip, 0.35, this.bobber.position)
    this.bobber.root.rotation.set(0, 0, 0)
    this.end.copyFrom(this.bobber.position)
    this.leaderPoints[0].copyFrom(this.bobber.position)
    this.leaderPoints[1].copyFrom(mouth)
    this.leader = CreateLines('leader', { points: this.leaderPoints, instance: this.leader })
    if (t < 1) return
    this.startFlop()
  }

  /** The fish comes off the rod tip and drops between the rod and the angler's feet. */
  private startFlop(): void {
    const k = 0.6
    const x = this.fishPos.x + (this.anglerAt.x - this.fishPos.x) * k
    const z = this.fishPos.z + (this.anglerAt.z - this.fishPos.z) * k
    const floor = this.floorAt(x, z)
    this.flopWet = floor < 0.02 && this.terrain.depthAt(x, z) > 0.03
    this.flopFloor = this.flopWet ? 0 : floor
    this.flopAt.set(x, this.flopFloor, z)
    this.flopClock = 0
    this.flopFrom.copyFrom(this.fishPos)
    this.dropping = true
    this.fishPitch = 0
    this.fishRoll = Math.PI / 2
    this.nextHop(true)
  }

  private nextHop(first: boolean): void {
    const energy = 1 - Math.min(1, this.flopClock / FLOP_TIME)
    const h = this.hop
    h.t = 0
    h.length = first ? 0.42 : 0.2 + this.rand() * 0.2
    h.height = first ? 0 : (0.05 + this.rand() * 0.16) * (0.35 + energy * 0.65)
    h.rollFrom = this.fishRoll
    const flip = this.rand() < 0.45 ? Math.PI : 0
    h.rollTo = (this.rand() < 0.5 ? 1 : -1) * Math.PI / 2 + flip + (this.rand() - 0.5) * 0.35
    h.spin = (this.rand() - 0.5) * 1.6 * energy
    h.dx = (this.rand() - 0.5) * 0.14 * energy
    h.dz = (this.rand() - 0.5) * 0.14 * energy
  }

  /** Flops on the floor (or thrashes in the shallows): short hops, rolling side to side, tail slapping, throwing water. */
  private updateFlop(dt: number, rodTip: Vector3): void {
    this.flopClock += dt
    const len = this.fishScale * FISH_MODEL_LENGTH
    const rest = this.flopFloor + (this.flopWet ? -len * 0.03 : len * 0.07)
    const h = this.hop
    h.t += dt
    const u = Math.min(1, h.t / h.length)
    if (this.dropping) {
      Vector3.LerpToRef(this.flopFrom, this.flopAt, u, this.fishPos)
      this.fishPos.y = this.flopFrom.y + (rest - this.flopFrom.y) * u * u
    } else {
      this.flopAt.x += h.dx * dt / h.length
      this.flopAt.z += h.dz * dt / h.length
      this.fishPos.set(this.flopAt.x, rest + 4 * h.height * u * (1 - u), this.flopAt.z)
    }
    this.fishRoll = h.rollFrom + (h.rollTo - h.rollFrom) * (u * u * (3 - 2 * u))
    this.fishHeading += h.spin * dt / h.length
    this.fishPitch = Math.sin(this.clock * 23) * 0.18 * (1 - u)
    this.placeFish()
    if (u >= 1) {
      this.dropping = false
      this.slap(len)
      this.nextHop(false)
    }
    this.dripTimer -= dt
    if (!this.flopWet && this.dripTimer <= 0) {
      this.dripTimer = 0.09
      this.fx.drip(this.scratchSplash.set(this.fishPos.x + (this.rand() - 0.5) * len * 0.4, this.fishPos.y + len * 0.05, this.fishPos.z + (this.rand() - 0.5) * len * 0.4), this.rand)
    }
    const mouth = this.mouth(this.scratchSplash)
    Vector3.LerpToRef(mouth, rodTip, 0.35, this.bobber.position)
    this.end.copyFrom(this.bobber.position)
    this.leaderPoints[0].copyFrom(this.bobber.position)
    this.leaderPoints[1].copyFrom(mouth)
    this.leader = CreateLines('leader', { points: this.leaderPoints, instance: this.leader })
    if (this.flopClock < FLOP_TIME) return
    this.flopClock = -1
    this.fishRoll = 0
    const specimen = this.hooked!
    this.finish()
    this.onEvent?.({ type: 'landed', specimen })
  }

  /** A hop lands: a splash and rings in the shallows, a spray of drops off the wet fish on a deck or bank. */
  private slap(len: number): void {
    const at = this.scratchSplash.set(this.fishPos.x, this.flopWet ? 0 : this.fishPos.y, this.fishPos.z)
    if (this.flopWet) {
      this.fx.splash(at, 0.22 + len * 0.5, this.rand)
      this.fx.ring(at.x, at.z, 0.3 + len * 0.6, 0.8, 1.1, 1)
    } else {
      for (let i = 0; i < 5; i++) this.fx.drip(this.scratchSplash.set(this.fishPos.x + (this.rand() - 0.5) * len * 0.7, this.fishPos.y + 0.02, this.fishPos.z + (this.rand() - 0.5) * len * 0.7), this.rand)
    }
    this.onEvent?.({ type: 'flop', wet: this.flopWet })
  }

  private updateRetrieve(dt: number, rodTip: Vector3): void {
    this.flight += dt
    const t = Math.min(1, this.flight / (this.lostBobber ? 0.35 : 0.7))
    const p = Vector3.Lerp(this.landing, rodTip, t)
    p.y += Math.sin(t * Math.PI) * (this.lostBobber ? 2.2 : 1.2)
    this.bobber.position.copyFrom(p)
    this.bobber.root.rotation.set(t * 4, 0, 0)
    this.end.copyFrom(p)
    if (t < 1) return
    this.finish()
    this.onEvent?.({ type: 'reeled-in' })
  }

  private finish(): void {
    this.state = 'idle'
    this.hooked = null
    this.reel = null
    this.lostBobber = false
    this.skill.reset()
    this.disposeFish()
    this.marker.show(false)
    this.bobber.setEnabled(false)
    this.bobber.root.rotation.set(0, 0, 0)
    this.line.setEnabled(false)
    this.leader.setEnabled(false)
  }

  private updateLine(rodTip: Vector3): void {
    const end = this.end
    const tension = this.state === 'reeling' ? 0.35 + ((this.reel?.tension ?? 50) / 100) * 0.65
      : this.state === 'landing' ? 1
        : this.state === 'bite' ? 0.85
          : this.state === 'flying' ? 0.6
            : this.lostBobber ? 0
              : this.state === 'nibble' ? 0.25 + this.twitchAmount() * 0.5
                : 0.15
    const sag = (1 - tension) * Math.min(3, Vector3.Distance(rodTip, end) * 0.08)
    const slackWave = this.reel?.slack ? Math.sin(this.clock * 3) * 0.15 : 0
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / (LINE_POINTS - 1)
      const p = this.linePoints[i]
      Vector3.LerpToRef(rodTip, end, t, p)
      p.y -= Math.sin(t * Math.PI) * (sag + slackWave)
      const wet = this.terrain.depthAt(p.x, p.z) > 0.04
      const floor = wet ? (t > 0.9 ? Math.min(0.006, end.y) : 0.006) : this.terrain.heightAt(p.x, p.z) + 0.02
      if (p.y < floor) p.y = floor
    }
    this.line = CreateLines('line', { points: this.linePoints, instance: this.line })
  }
}
