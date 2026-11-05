/** The running lake: PlayCanvas app, sky, lake scene, the player's boat and angler, the camera and the per-frame update. */
import { now } from '../shared/Clock'
import * as pc from 'playcanvas'
import { Boat, loadBassAssets } from '../scene/Boat'
import type { BassAssets } from '../scene/Boat'
import { Character, loadCharacterAssets } from '../scene/Character'
import type { CharacterAssets, Pose } from '../scene/Character'
import { LakeScene, seasonFor } from '../scene/LakeScene'
import { Sky } from '../scene/Sky'
import { PostFx } from '../scene/PostFx'
import { Wake } from '../scene/Wake'
import { BoatPhysics, newBoatState } from '../systems/BoatPhysics'
import type { BoatControls } from '../systems/BoatPhysics'
import { CameraRig } from '../systems/CameraRig'
import { drivePose, sitPose, standPose } from '../systems/Poses'
import { LAKES, landingOf } from '../shared/Lakes'
import type { LakeDef, LakeId } from '../shared/Lakes'
import { weatherAt } from '../shared/Weather'
import type { Weather } from '../shared/Weather'
import { centralTime } from '../shared/Astro'
import { BOATS, DEFAULT_PAINT } from '../shared/Boats'
import type { BoatKind, BoatPaint, Seat } from '../shared/Boats'
import { DEFAULT_LOOK } from '../shared/Wardrobe'
import type { Look } from '../shared/Wardrobe'
import { config } from '../config'
import type { QualityTier } from '../config'

export interface Rider {
  character: Character
  seat: number
  /** Overrides the seat pose (fishing). Returns a pose in character space. */
  pose?: (time: number) => Pose
  station?: Seat
}

/** A boat the player is riding as crew: another angler's boat, moved by the shared lake. */
export interface Carrier {
  boat: Boat
  state: { x: number; z: number; heading: number; speed: number; anchored: boolean }
}

export class World {
  readonly app: pc.Application
  readonly quality: QualityTier
  sky!: Sky
  post: PostFx | null = null
  lake: LakeDef | null = null
  scene: LakeScene | null = null
  boat: Boat | null = null
  physics: BoatPhysics | null = null
  camera!: CameraRig
  player: Rider | null = null
  weather: Weather | null = null
  characterAssets!: CharacterAssets
  bassAssets: BassAssets | null = null
  private remoteBass: Promise<BassAssets | null> | null = null
  carrier: Carrier | null = null
  wake: Wake | null = null
  time = 0
  anchored = false
  autopilot: { x: number; z: number } | null = null
  background = false
  private backgroundTimer = 0
  private lastBackgroundTick = 0
  private focusPlayer = false
  private skyTimer = 0
  private weatherTimer = 0
  private readonly frameHandlers: ((dt: number) => void)[] = []
  readonly root: pc.Entity

  constructor(readonly canvas: HTMLCanvasElement, quality: QualityTier) {
    this.quality = quality
    this.app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: quality !== 'low', alpha: false, powerPreference: 'high-performance' } })
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW)
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO)
    this.app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1)
    this.app.scene.ambientLight = new pc.Color(0.2, 0.21, 0.23)
    this.app.scene.lighting.shadowsEnabled = true
    this.root = new pc.Entity('world')
    this.app.root.addChild(this.root)
    const resize = () => this.app.resizeCanvas()
    addEventListener('resize', resize)
    this.app.on('update', (dt: number) => this.update(Math.min(dt, 0.1)))
  }

  async load(onProgress: (text: string) => void): Promise<void> {
    onProgress('Loading the angler')
    this.characterAssets = await loadCharacterAssets(config.assets)
    onProgress('Loading the boat')
    this.bassAssets = await loadBassAssets(this.app.graphicsDevice, config.assets, this.quality === 'low' ? 1024 : 2048)
    this.sky = new Sky(this.app, this.quality)
    this.camera = new CameraRig(this.app, this.canvas.parentElement ?? this.canvas, LAKES['silver-birch'])
    this.post = new PostFx(this.app, this.camera.entity.camera!, this.quality)
    this.app.start()
  }

  /** A lighter paint map for other anglers' bass boats. */
  remoteBassAssets(): Promise<BassAssets | null> {
    this.remoteBass ??= loadBassAssets(this.app.graphicsDevice, config.assets, 512).catch(() => null)
    return this.remoteBass
  }

  /** The boat the player stands in: their own, or the one they crew on. */
  riderBoat(): Boat | null {
    return this.carrier?.boat ?? this.boat
  }

  riderSpec() {
    return (this.carrier?.boat ?? this.boat)!.spec
  }

  /** Climbs aboard another angler's boat at a crew seat; the player's own boat waits out of sight. */
  board(carrier: Carrier, seat: number): void {
    if (!this.player || !this.boat || !this.physics) return
    this.carrier = carrier
    this.autopilot = null
    this.player.character.entity.reparent(carrier.boat.hull)
    this.player.seat = seat
    this.player.station = undefined
    this.boat.root.enabled = false
    this.physics.state.speed = 0
  }

  /** Back to the player's own boat, launched at the given spot. */
  disembark(x: number, z: number, heading: number): void {
    this.carrier = null
    if (!this.player || !this.boat || !this.physics) return
    this.player.character.entity.reparent(this.boat.hull)
    this.player.seat = 0
    this.player.station = undefined
    this.boat.root.enabled = true
    Object.assign(this.physics.state, { x, z, heading, speed: 0 })
    this.anchored = false
  }

  onFrame(handler: (dt: number) => void): void {
    this.frameHandlers.push(handler)
  }

  async enterLake(id: LakeId, boatKind: BoatKind, paint: BoatPaint = DEFAULT_PAINT, look: Look = DEFAULT_LOOK): Promise<void> {
    this.leaveLake()
    const lake = LAKES[id]
    this.lake = lake
    const date = now()
    const ct = centralTime(date)
    const season = seasonFor(ct.month, ct.day)
    this.scene = new LakeScene(this.app, lake, this.quality, season)
    this.root.addChild(this.scene.root)
    this.weather = weatherAt(lake, date)
    await this.sky.refresh(date, this.weather)
    this.spawnBoat(boatKind, paint)
    const character = new Character(this.app, this.characterAssets, { name: 'player' })
    character.setLook(look)
    character.entity.tags.add('rider')
    this.player = { character, seat: 0 }
    this.boat!.hull.addChild(character.entity)
    this.anchored = false
    ;(this.camera as unknown as { lake: LakeDef }).lake = lake
    this.camera.snapBehind(this.physics!.state.heading)
  }

  spawnBoat(kind: BoatKind, paint: BoatPaint): void {
    const lake = this.lake!
    const landing = landingOf(lake)
    const previous = this.physics?.state
    const riders = this.boat ? this.boat.hull.children.filter(c => c.tags.has('rider')) : []
    for (const r of riders) this.boat!.hull.removeChild(r)
    const hidden = this.boat ? !this.boat.root.enabled : false
    this.boat?.destroy()
    this.boat = new Boat(this.app, kind, paint, this.bassAssets)
    this.boat.root.enabled = !hidden
    this.root.addChild(this.boat.root)
    if (!this.wake) { this.wake = new Wake(this.app, this.boat.spec); this.root.addChild(this.wake.entity) }
    this.wake.setSpec(this.boat.spec)
    this.physics = new BoatPhysics(lake, BOATS[kind], previous ? { ...previous, speed: 0 } : newBoatState(landing.x, landing.z, landing.heading))
    for (const r of riders) this.boat.hull.addChild(r)
    if (this.player && !this.carrier && !riders.includes(this.player.character.entity)) this.boat.hull.addChild(this.player.character.entity)
  }

  /** Swaps or repaints the player's boat in place (same position and heading). */
  setBoat(kind: BoatKind, paint: BoatPaint): void {
    if (!this.lake) return
    if (this.boat && this.boat.spec.kind === kind) { this.boat.setPaint(paint); return }
    const motor = this.physics?.motorBoost ?? 1
    if (this.player) this.player.station = undefined
    this.spawnBoat(kind, paint)
    if (this.physics) this.physics.motorBoost = motor
  }

  leaveLake(): void {
    this.carrier = null
    this.wake?.destroy()
    this.wake = null
    this.player?.character.destroy()
    this.player = null
    this.boat?.destroy()
    this.boat = null
    this.physics = null
    this.scene?.root.destroy()
    this.scene = null
    this.lake = null
  }

  controls: BoatControls = { throttle: 0, steer: 0, trolling: false, anchored: false }

  windVector(): { x: number; z: number; speed: number } {
    const w = this.weather
    if (!w) return { x: 0, z: 0, speed: 0 }
    return { x: Math.sin(w.windDir), z: -Math.cos(w.windDir), speed: w.windMph }
  }

  setBackground(hidden: boolean): void {
    if (hidden === this.background) return
    this.background = hidden
    clearInterval(this.backgroundTimer)
    if (hidden) {
      this.lastBackgroundTick = performance.now()
      this.backgroundTimer = window.setInterval(() => {
        const t = performance.now()
        const dt = Math.min(120, (t - this.lastBackgroundTick) / 1000)
        this.lastBackgroundTick = t
        this.update(dt)
      }, 1000)
    }
  }

  /** Renders the scene into the left part of the window while a side panel covers the right. */
  setViewportWidth(fraction: number): void {
    const cam = this.camera.entity.camera
    if (cam) cam.rect = new pc.Vec4(0, 0, Math.max(0.3, Math.min(1, fraction)), 1)
  }

  /** The next rendered frame copied onto a 2D canvas, for catch photos. */
  snapshot(): Promise<HTMLCanvasElement> {
    return new Promise(resolve => this.app.once('frameend', () => {
      const c = document.createElement('canvas')
      c.width = this.canvas.width
      c.height = this.canvas.height
      c.getContext('2d')?.drawImage(this.canvas, 0, 0)
      resolve(c)
    }))
  }

  focusOnPlayer(on: boolean): void {
    this.focusPlayer = on
    if (!on) this.camera.preferredYaw = null
  }

  /** Steers toward the autopilot pin; returns true when it has arrived. */
  driveAutopilot(): boolean {
    const pin = this.autopilot
    const s = this.physics?.state
    if (!pin || !s) return false
    const dx = pin.x - s.x, dz = pin.z - s.z
    const dist = Math.hypot(dx, dz)
    if (dist < 9) {
      this.controls.throttle = 0
      this.controls.steer = 0
      if (Math.abs(s.speed) < 0.8) { this.autopilot = null; return true }
      return false
    }
    const want = Math.atan2(-dx, -dz)
    let err = want - s.heading
    err = Math.atan2(Math.sin(err), Math.cos(err))
    this.controls.steer = Math.max(-1, Math.min(1, -err * 2.2))
    const slow = dist < 70 ? Math.max(0.18, dist / 70) : 1
    this.controls.throttle = Math.abs(err) > 1.2 ? 0.25 : slow * (1 - Math.min(0.6, Math.abs(err)))
    return false
  }

  private update(dt: number): void {
    this.time += dt
    if (!this.lake || !this.physics || !this.boat) {
      for (const h of this.frameHandlers) h(dt)
      return
    }
    const wind = this.windVector()
    this.controls.anchored = this.anchored
    const s = this.physics.state
    const carrier = this.carrier
    if (carrier) {
      s.x = carrier.state.x
      s.z = carrier.state.z
      s.heading = carrier.state.heading
      s.speed = carrier.state.speed
    } else {
      this.physics.step(dt, this.controls, wind)
      this.boat.root.setPosition(s.x, s.heave, s.z)
      this.boat.root.setEulerAngles(0, (s.heading * 180) / Math.PI, 0)
      this.boat.hull.setLocalEulerAngles((s.pitch * 180) / Math.PI, 0, (s.roll * 180) / Math.PI)
    }
    if (!this.background) {
      this.boat.setLightsOn(this.sky.state.day < 0.5)
      this.post?.setNight(1 - this.sky.state.day)
      this.wake?.update(dt, s.x, s.z, s.heading, carrier ? 0 : s.speed, !carrier)
      this.scene?.update(dt, wind)
      if (this.player) this.placeRider(this.player)
      const heave = carrier ? carrier.boat.root.getPosition().y : s.heave
      let target = new pc.Vec3(s.x, 1.6 + heave, s.z)
      if (this.focusPlayer && this.player) {
        const e = this.player.character.entity
        const p = e.getPosition()
        target = new pc.Vec3(p.x, p.y + 1.2, p.z)
        const f = e.forward
        this.camera.preferredYaw = (Math.atan2(f.x, f.z) * 180) / Math.PI + 35
      }
      this.camera.update(dt, target, s.heading, s.speed, !this.anchored && !(carrier?.state.anchored))
    } else if (this.player) this.placeRider(this.player)
    this.skyTimer += dt
    this.weatherTimer += dt
    if (this.weatherTimer > config.weatherRefreshSeconds) {
      this.weatherTimer = 0
      this.weather = weatherAt(this.lake, now())
      this.scene?.setWind(this.weather.windMph)
    }
    if (this.skyTimer > config.skyRefreshSeconds && this.weather) {
      this.skyTimer = 0
      void this.sky.refresh(now(), this.weather)
    }
    for (const h of this.frameHandlers) h(dt)
  }

  placeRider(rider: Rider): void {
    const boat = this.riderBoat()
    if (!boat) return
    const spec = boat.spec
    const seat = rider.station ?? spec.seats[rider.seat]
    const e = rider.character.entity
    e.setLocalPosition(seat.x, seat.y, seat.z)
    e.setLocalEulerAngles(0, seat.yaw, 0)
    let pose: Pose
    if (rider.pose) pose = rider.pose(this.time)
    else if (seat.pose === 'drive' && spec.wheel) {
      const w = spec.wheel
      pose = drivePose(this.time, [w[0] - seat.x, w[1] - seat.y, w[2] - seat.z], this.carrier ? 0 : this.controls.steer, seat.seat)
    } else if (seat.pose === 'drive' || seat.pose === 'sit') pose = sitPose(this.time, seat.seat)
    else pose = standPose(this.time)
    rider.character.applyPose(pose)
  }
}
