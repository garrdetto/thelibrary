/** The fishing loop while anchored: cast, wait for the authority's bite, hook-set, fight, land or lose, show the catch and release it. Drives the angler's pose, the rod, line, bobber, fish, ripples and splashes. Runs on its own so it works in a background tab, and the player can take over with Reel In: hold to power up a cast and tap to jig while waiting, set the hook on a bite, crank the fish in, ease off when it runs, let go when it jumps, and tap to net it at the boat. The authority still decides what bites and whether it is landed. */
import * as pc from 'playcanvas'
import type { World } from './World'
import type { Authority, BiteResult, Progress, TickResult } from './Authority'
import { Bobber, Ripples, Rod, Splashes, drawLine } from '../scene/Tackle'
import { FishModel } from '../scene/FishModel'
import { fishingPose, holdPose } from '../systems/Poses'
import type { FishingPhase } from '../systems/Poses'
import { PRESENTATIONS, RODS } from '../shared/Gear'
import type { Rig } from '../shared/Gear'
import { SPECIES } from '../shared/Species'
import { clamp, smoothstep } from '../shared/Random'

type Phase = FishingPhase | 'snap' | 'release' | 'off'

export interface FishingEvents {
  onBite(result: BiteResult): void
  onLanded(result: BiteResult): void
  onLost(result: BiteResult): void
  onMissed(result: BiteResult): void
  onTick(t: TickResult): void
  onError(message: string): void
  progress(): Progress
  crowd(): number
  onHookSet?(clean: boolean): void
  onRun?(): void
  onSlip?(): void
  onJig?(): void
  onJump?(): void
  onBow?(): void
  onNetReady?(): void
  onNetMiss?(final: boolean): void
}

export type FightGrade = 'Clean' | 'Steady' | 'Rough' | 'Auto'

const HEARTBEAT_MS = 40_000
/** Seconds the player has to set the hook once the bobber goes down. */
const HOOK_WINDOW = 1.3

export class Fishing {
  phase: Phase = 'off'
  private t = 0
  private time = 0
  private rod: Rod | null = null
  private readonly bobber: Bobber
  readonly ripples: Ripples
  private fish: FishModel | null = null
  private lure = new pc.Vec3()
  private lureTarget = new pc.Vec3()
  private castFrom = new pc.Vec3()
  private result: BiteResult | null = null
  private queued: BiteResult | null = null
  nextBiteAt = 0
  private lastCall = 0
  private inFlight = false
  private rig: Rig | null = null
  private load = 0
  private pull = 0
  private jumpAt = -1
  private reelKey = ''
  active = false
  private startToken = 0
  /** Held by the player (Reel In button or F): sets the hook, cranks during a fight, retrieves and recasts while waiting. */
  reeling = false
  private wasReeling = false
  /** 0 slack to 1 breaking point; past 1 the drag slips and the fish takes line. */
  tension = 0
  /** 0 with the fish out at the cast to 1 at the boat. */
  progress = 0
  private fightTime = 0
  private run = 0
  private nextRun = 0
  private slipTime = 0
  private slipNoticeAt = -10
  private touched = false
  private cleanHook = false
  private reeledFight = false
  private snapAt = 1
  grade: FightGrade = 'Auto'
  /** 0–1 while Reel In is held to power up a cast, otherwise -1. */
  castCharge = -1
  private castPower = -1
  private holdTime = 0
  private jig = 0
  /** The hooked fish is in the air: let go of Reel In (bow to it) or the tension spikes. */
  jumping = false
  private jumpReeled = false
  bows = 0
  /** The fish is beside the boat waiting for a tap of Reel In to net it. */
  netReady = false
  private netWindow = 0
  private netTries = 0
  netClean = false
  readonly splashes: Splashes

  constructor(private world: World, private authority: Authority, private events: FishingEvents) {
    this.bobber = new Bobber(world.app)
    this.bobber.entity.enabled = false
    world.root.addChild(this.bobber.entity)
    this.ripples = new Ripples(world.app)
    world.root.addChild(this.ripples.root)
    this.splashes = new Splashes(world.app)
    world.root.addChild(this.splashes.root)
  }

  private splash(x: number, z: number, drops: number, power: number, ring = power): void {
    this.ripples.spawn(x, z, 0.4 + ring * 0.8, 1.2 + ring * 0.4)
    this.splashes.spawn(x, z, drops, power)
  }

  setAuthority(authority: Authority): void {
    this.authority = authority
  }

  /** The fish being held up, for the shared lake. */
  get heldFish(): { species: string; length: number } | undefined {
    return this.result && ['land', 'show', 'release'].includes(this.phase) ? { species: this.result.species, length: Math.round(this.result.length * 10) / 10 } : undefined
  }

  get waitingForBite(): boolean {
    return this.phase === 'wait'
  }

  async begin(rig: Rig): Promise<void> {
    const w = this.world
    if (!w.player || !w.lake || !w.physics || !w.boat) return
    this.active = true
    this.rig = rig
    const token = ++this.startToken
    w.player.station = w.riderSpec().stations[w.player.seat] ?? w.riderSpec().stations[0]
    this.ensureRod(rig)
    this.startCast()
    try {
      const s = w.physics.state
      this.nextBiteAt = await this.authority.start(w.lake.id, s.x, s.z, rig, this.events.crowd(), this.events.progress())
      this.lastCall = Date.now()
    } catch (error) {
      if (token === this.startToken) {
        this.events.onError(error instanceof Error ? error.message : 'Could not start fishing.')
        this.end()
      }
    }
  }

  end(): void {
    if (!this.active) return
    this.active = false
    this.startToken++
    void this.authority.stop(this.events.progress()).catch(() => undefined)
    this.phase = 'off'
    this.result = null
    this.queued = null
    this.tension = 0
    this.progress = 0
    this.castCharge = -1
    this.jumping = false
    this.netReady = false
    this.bobber.entity.enabled = false
    if (this.rod) this.rod.visible = false
    this.fish?.destroy()
    this.fish = null
    const p = this.world.player
    if (p) { p.station = undefined; p.pose = undefined }
  }

  private ensureRod(rig: Rig): void {
    const key = rig.rod
    if (this.rod && this.reelKey === key) { this.rod.visible = true; return }
    this.rod?.destroy()
    const def = RODS[rig.rod]
    this.rod = new Rod(this.world.app, def.length, def.color)
    this.world.root.addChild(this.rod.entity)
    this.reelKey = key
  }

  private startCast(): void {
    const w = this.world
    if (!w.player) return
    this.phase = 'cast'
    this.t = 0
    this.fish?.destroy()
    this.fish = null
    const e = w.player.character.entity
    const pos = e.getPosition()
    const fwd = e.forward.clone()
    fwd.y = 0
    fwd.normalize()
    const right = new pc.Vec3().cross(fwd, pc.Vec3.UP)
    const aimed = this.castPower >= 0
    const dist = aimed ? 7 + this.castPower * 24 : 11 + Math.random() * 10
    const side = (Math.random() - 0.5) * (aimed ? 3 : 8)
    this.castPower = -1
    this.castCharge = -1
    this.lureTarget.set(pos.x + fwd.x * dist + right.x * side, 0, pos.z + fwd.z * dist + right.z * side)
    this.bobber.entity.enabled = false
    if (w.player) w.player.pose = time => this.pose(time)
  }

  private pose(time: number) {
    const w = this.world
    const seat = w.player?.station
    const seated = seat?.pose !== 'stand'
    const phase = this.phase
    if (phase === 'show' || phase === 'land' || phase === 'release') return holdPose(time, phase, this.t, seated, seat?.seat ?? 0.45, this.result?.length ?? 14)
    const p = fishingPose(time, { phase: phase === 'snap' ? 'idle' : phase === 'off' ? 'idle' : phase, t: this.t, load: this.load, pull: this.pull, seated, seatHeight: seat?.seat ?? 0.45 })
    this.rodPitch = p.rodPitch + this.jig * 16 + Math.max(0, this.castCharge) * 22
    this.rodYaw = p.rodYaw
    return p.pose
  }

  private rodPitch = 24
  private rodYaw = 6

  /** Called every frame after the riders are posed. */
  update(dt: number): void {
    this.time += dt
    this.ripples.update(dt)
    this.splashes.update(dt)
    if (!this.active || !this.world.player || !this.rig) return
    this.t += dt
    const pressed = this.reeling && !this.wasReeling
    const released = !this.reeling && this.wasReeling
    this.wasReeling = this.reeling
    this.holdTime = this.reeling ? this.holdTime + dt : 0
    if (this.reeling) this.touched = true
    this.pollAuthority()
    const w = this.world
    const ch = w.player!.character
    const e = ch.entity
    const hand = ch.bone('handR').getPosition().clone()
    const rot = e.getRotation()
    const pitch = (this.rodPitch * Math.PI) / 180, yaw = (this.rodYaw * Math.PI) / 180
    const dirLocal = new pc.Vec3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    const dir = rot.transformVector(dirLocal, new pc.Vec3()).normalize()
    const grip = hand.clone().sub(dir.clone().mulScalar(0.22))
    const presentation = PRESENTATIONS[this.rig.presentation]
    const showRod = !['show', 'land', 'release'].includes(this.phase)
    if (this.rod) this.rod.visible = showRod
    switch (this.phase) {
      case 'cast': {
        const k = clamp((this.t - 0.62) / 0.7, 0, 1)
        if (this.t < 0.62) this.castFrom.copy(this.rod?.tip ?? hand)
        this.lure.lerp(this.castFrom, this.lureTarget, k)
        this.lure.y = this.castFrom.y * (1 - k) + Math.sin(k * Math.PI) * 4
        if (k >= 1 && this.t < 1.4) { this.lure.copy(this.lureTarget); this.splash(this.lure.x, this.lure.z, 6, 0.45); this.t = 1.4 }
        if (this.t > 1.6) { this.phase = 'wait'; this.t = 0 }
        this.load = 0
        break
      }
      case 'wait': {
        this.jig = Math.max(0, this.jig - dt * 2.4)
        this.lure.copy(this.lureTarget)
        this.lure.y = Math.sin(this.jig * Math.PI) * 0.14
        this.load = 0.05 + this.jig * 0.3
        if (this.queued) { this.castCharge = -1; this.startBite(this.queued) }
        else if (this.reeling && this.holdTime > 0.25) this.castCharge = Math.min(1, (this.holdTime - 0.25) / 1.1)
        else if (released && this.castCharge >= 0) { this.castPower = this.castCharge; this.startCast() }
        else if (released && this.jig < 0.3) {
          this.jig = 1
          this.splash(this.lure.x, this.lure.z, 3, 0.25, 0.2)
          this.events.onJig?.()
        }
        break
      }
      case 'bite': {
        this.load = 0.3 + smoothstep(0, 0.4, this.t) * 0.5
        const r = this.result!
        const struck = this.reeling && this.t > 0.08
        if (struck || this.t > (this.touched ? HOOK_WINDOW : 0.8)) {
          if (r.kind === 'missed') { this.events.onMissed(r); this.phase = 'snap'; this.t = 0 }
          else this.beginFight(r, struck)
        }
        break
      }
      case 'fight': {
        const r = this.result!
        const total = Math.max(3, r.fight)
        this.fightTime += dt
        if (this.reeling) this.reeledFight = true
        const strain = clamp((r.weight * SPECIES[r.species].power) / RODS[this.rig.rod].lineTest, 0.05, 1.2)
        if (this.run > 0) this.run -= dt
        else if (this.fightTime > this.nextRun && this.progress < 0.92) {
          this.run = 1 + Math.random() * (1 + strain * 2)
          this.nextRun = this.fightTime + this.run + 2.5 + Math.random() * 5
          this.splash(this.lure.x, this.lure.z, 8, 0.6 + Math.min(0.6, r.weight * 0.04))
          this.events.onRun?.()
        }
        const running = this.run > 0
        const want = this.reeling ? (running ? 1.2 + strain * 0.2 : 0.32 + strain * 0.45) : (running ? 0.5 + strain * 0.2 : 0.12)
        this.tension += (want - this.tension) * (1 - Math.exp(-dt * (this.reeling ? 2.6 : 3.5)))
        if (this.jumping && this.reeling) { this.jumpReeled = true; this.tension = Math.min(1.25, this.tension + dt * 2.4) }
        const base = 1 / total
        let rate = this.reeling ? base * 2.4 : base
        if (running) rate -= base * (this.reeling ? 1.6 : 0.8)
        if (this.tension > 1) {
          rate = -base * 1.2
          this.slipTime += dt
          if (this.time - this.slipNoticeAt > 3) { this.slipNoticeAt = this.time; this.events.onSlip?.() }
        }
        this.progress = clamp(this.progress + rate * dt, 0, 1)
        if (this.fightTime > total * 2.5) { this.progress = 1; this.netReady = false }
        else if (r.kind !== 'lost' && this.progress >= 0.94 && !this.netReady && this.netTries < 2) {
          this.netReady = true
          this.netWindow = 1.6
          this.events.onNetReady?.()
        }
        if (this.netReady) {
          this.netWindow -= dt
          this.progress = 0.94
          this.tension = Math.min(this.tension, 0.6)
          if (pressed) {
            this.netReady = false
            this.netClean = true
            this.progress = 1
          } else if (this.netWindow <= 0) {
            this.netReady = false
            this.netTries++
            this.progress = this.netTries >= 2 ? 1 : 0.8
            this.run = this.netTries >= 2 ? 0 : 1.2
            this.splash(this.lure.x, this.lure.z, 12, 0.9)
            this.events.onNetMiss?.(this.netTries >= 2)
          }
        }
        const progress = this.progress
        const surge = Math.sin(this.t * 1.3) * 0.5 + Math.sin(this.t * 3.1) * 0.25
        this.pull = clamp(Math.sin(this.t * 0.6) * (running ? 1.6 : 1) + surge * 0.3, -1, 1)
        this.load = clamp(0.3 + this.tension * 0.85 + surge * 0.08, 0.3, 1.25)
        const pos = e.getPosition()
        const away = this.lureTarget.clone().sub(pos)
        away.y = 0
        const dist = away.length()
        away.normalize()
        const side = new pc.Vec3().cross(away, pc.Vec3.UP)
        const reach = Math.max(2.4, dist * (1 - progress * 0.9))
        this.lure.set(pos.x + away.x * reach + side.x * this.pull * 3 * (1 - progress), 0, pos.z + away.z * reach + side.z * this.pull * 3 * (1 - progress))
        if (Math.random() < dt * 0.8) this.ripples.spawn(this.lure.x, this.lure.z, 0.6 + r.weight * 0.05, 1.2)
        if (this.jumpAt > 0 && this.t > this.jumpAt) this.jump(r)
        if (this.fish && this.fish.entity.enabled) this.animateJump(dt)
        if (r.kind === 'lost' && this.progress >= this.snapAt) { this.tension = 0; this.phase = 'snap'; this.t = 0; this.events.onLost(r) }
        else if (r.kind !== 'lost' && this.progress >= 1) {
          this.grade = !this.reeledFight ? 'Auto' : this.slipTime === 0 && this.cleanHook && this.netClean ? 'Clean' : this.slipTime < 2 ? 'Steady' : 'Rough'
          this.tension = 0
          this.netReady = false
          this.jumping = false
          this.phase = 'land'; this.t = 0; this.prepareHeld(r)
        }
        break
      }
      case 'snap': {
        this.load = 0
        this.lure.lerp(this.lure, this.rod?.tip ?? hand, Math.min(1, dt * 3))
        if (this.t > 1.4) this.startCast()
        break
      }
      case 'land':
      case 'show':
      case 'release': {
        this.holdFish(dt)
        if (this.phase === 'land' && this.t > 1.2) { this.phase = 'show'; this.t = 0; this.events.onLanded(this.result!) }
        else if (this.phase === 'show' && this.t > (['Trophy', 'Legendary'].includes(this.result!.tier) ? 9 : 6)) { this.phase = 'release'; this.t = 0 }
        else if (this.phase === 'release' && this.t > 0.9) {
          const p = this.fish?.entity.getPosition()
          if (p) this.splash(p.x, p.z, 10, 0.7 + Math.min(0.6, this.result!.weight * 0.03))
          this.fish?.destroy()
          this.fish = null
          this.startCast()
        }
        break
      }
    }
    if (this.rod && showRod) {
      const pullDir = this.lure.clone().sub(this.rod.tip)
      if (pullDir.lengthSq() > 0) pullDir.normalize()
      this.rod.update(grip, dir, pullDir, this.load)
    }
    const bob = presentation.float && ['wait', 'bite'].includes(this.phase)
    this.bobber.entity.enabled = bob
    if (bob) {
      const dip = this.phase === 'bite' ? -0.06 - Math.abs(Math.sin(this.t * 14)) * 0.05 : Math.sin(this.time * 2.1) * 0.008 - this.jig * 0.05
      this.bobber.entity.setPosition(this.lure.x, 0.01 + dip, this.lure.z)
    }
    if (this.rod && showRod && this.phase !== 'off') {
      const target = this.lure.clone()
      if (!presentation.float && this.phase === 'wait') target.y = -0.05
      drawLine(this.world.app, this.rod.tip, target, this.phase === 'fight' ? 1 : this.phase === 'cast' ? 0.6 : 0.2)
    }
  }

  private beginFight(r: BiteResult, struck: boolean): void {
    this.phase = 'fight'
    this.t = 0
    this.fightTime = 0
    this.progress = struck ? 0.08 : 0
    this.tension = struck ? 0.5 : 0.25
    this.run = 0
    this.nextRun = 1.5 + Math.random() * 2
    this.slipTime = 0
    this.cleanHook = struck
    this.reeledFight = struck
    this.snapAt = 0.45 + Math.random() * 0.45
    this.jumpAt = SPECIES[r.species].jumps ? 2 + Math.random() * Math.max(2, r.fight * 0.5) : -1
    this.jumping = false
    this.bows = 0
    this.netReady = false
    this.netTries = 0
    this.netClean = false
    if (struck) this.splash(this.lure.x, this.lure.z, 12, 0.85)
    this.events.onHookSet?.(struck)
  }

  private startBite(result: BiteResult): void {
    this.queued = null
    this.result = result
    this.phase = 'bite'
    this.t = 0
    this.splash(this.lure.x, this.lure.z, 5, 0.4, 0.15)
    this.events.onBite(result)
  }

  private pollAuthority(): void {
    if (this.inFlight) return
    const nowMs = Date.now()
    const due = this.phase === 'wait' && !this.queued && this.nextBiteAt > 0 && nowMs >= this.nextBiteAt
    if (!due && nowMs - this.lastCall < HEARTBEAT_MS) return
    this.inFlight = true
    this.lastCall = nowMs
    const token = this.startToken
    this.authority.tick(this.events.crowd(), this.events.progress()).then(tick => {
      if (token !== this.startToken) return
      if (tick.nextBiteAt) this.nextBiteAt = tick.nextBiteAt
      this.events.onTick(tick)
      if (tick.result) {
        if (this.phase === 'wait') this.startBite(tick.result)
        else this.queued = tick.result
      }
    }).catch(error => {
      this.events.onError(error instanceof Error ? error.message : 'Lost touch with the lake server.')
    }).finally(() => { this.inFlight = false })
  }

  private jumpState = { t: -1, from: new pc.Vec3() }

  private jump(r: BiteResult): void {
    this.jumpAt = this.t + 4 + Math.random() * 8
    if (this.t > r.fight - 2 || this.progress > 0.85) { this.jumpAt = -1; return }
    if (!this.fish) {
      this.fish = new FishModel(this.world.app, r.species, r.length)
      this.world.root.addChild(this.fish.entity)
    }
    this.fish.entity.enabled = true
    this.jumpState = { t: 0, from: this.lure.clone() }
    this.jumping = true
    this.jumpReeled = false
    this.splash(this.lure.x, this.lure.z, 16, 1.1)
    this.events.onJump?.()
  }

  private animateJump(dt: number): void {
    const js = this.jumpState
    if (js.t < 0 || !this.fish) return
    js.t += dt
    const k = js.t / 1.3
    if (k >= 1) {
      this.fish.entity.enabled = false
      this.splash(this.lure.x, this.lure.z, 18, 1.2)
      js.t = -1
      this.jumping = false
      if (!this.jumpReeled && this.reeledFight) { this.bows++; this.events.onBow?.() }
      return
    }
    this.fish.entity.setPosition(this.lure.x, Math.sin(k * Math.PI) * 1.15 - 0.15, this.lure.z)
    this.fish.entity.setEulerAngles(0, this.time * 40, -60 + k * 120)
    this.fish.swim(this.time, 1, 14)
  }

  private prepareHeld(r: BiteResult): void {
    if (!this.fish) {
      this.fish = new FishModel(this.world.app, r.species, r.length)
      this.world.root.addChild(this.fish.entity)
    }
    this.fish.entity.enabled = true
    this.splash(this.lure.x, this.lure.z, 16, 1)
  }

  private holdFish(dt: number): void {
    if (!this.fish || !this.world.player) return
    const ch = this.world.player.character
    const l = ch.bone('handL').getPosition(), r = ch.bone('handR').getPosition()
    const mid = new pc.Vec3().add2(l, r).mulScalar(0.5)
    const e = ch.entity
    const fwd = e.forward.clone()
    if (this.phase === 'land' && this.t < 0.6) {
      const k = this.t / 0.6
      mid.lerp(this.lure, mid, k)
    }
    if (this.phase === 'release') mid.y -= smoothstep(0.3, 0.9, this.t) * 1.2
    this.fish.entity.setPosition(mid.x + fwd.x * 0.06, mid.y - 0.02, mid.z + fwd.z * 0.06)
    const across = new pc.Vec3().sub2(r, l)
    const yaw = (Math.atan2(-across.z, across.x) * 180) / Math.PI
    this.fish.entity.setEulerAngles(0, yaw + 180, 0)
    this.fish.swim(this.time, this.phase === 'show' ? 0.25 : 0.7, 6)
    void dt
  }
}
