/**
 * Paid work in Fox Lake, run by the shared world (RoomLogic issueJob /
 * progressJob): Fox Plains deliveries from the freight depot, Montello
 * deliveries from Kwik Trip, and Montello fire calls from the fire station.
 * The page shows the job on a HUD chip and a beacon you can see from far off,
 * routes you there on the map (County Road F first when the job is in Montello
 * and you are still south of it), tells the authority when you arrive, and
 * for a fire sets the house burning until you hold the hose on it (hold E).
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { GameHost } from '../../rackreel/game/Game'
import type { ClientMsg, Job } from '../../maplestreet/shared/Protocol'
import { FIRE_HOSE_SECONDS } from '../../maplestreet/shared/Economy'
import { vehicleRole } from '../../maplestreet/shared/Vehicles'
import type { TelloLand } from '../../tello/region'
import type { TelloMap } from '../../tello/town/TelloMap'
import type { Cars } from '../town/Cars'
import type { WorldMap } from '../town/WorldMap'
import { NORTH_ROAD, sceneToTown, townToScene } from '../region'
import { FireFx, type Blaze } from './FireFx'

/** How close the page goes before telling the authority (a little inside the authority's own reach). */
const DELIVERY_REACH = { foxplains: 7, montello: 12 }
const FIRE_STATION_REACH = 26
const FIRE_SCENE_REACH = 32
const HOSE_REACH = 30
const BEACON_HEIGHT = 90

export interface JobHooks {
  host: GameHost
  cars: Cars
  send(m: ClientMsg): void
  land: TelloLand | null
  map: () => WorldMap | null
  northMap: () => TelloMap | null
  inNorth(): boolean
}

type Routed = 'none' | 'south' | 'north'

export class Jobs {
  job: Job | null = null
  private readonly beacon: Mesh
  private readonly beaconMat: StandardMaterial
  private readonly fire: FireFx
  private readonly chip: HTMLElement
  private readonly chipText: HTMLElement
  private readonly chipSub: HTMLElement
  private ping = 0
  private tick = 0
  private sprayed = 0
  private lastFrame = 0
  private routed: Routed = 'none'
  private routedKey = ''
  private readonly _t = { x: 0, y: 0, z: 0 }
  private readonly hoseFrom = new Vector3()
  private readonly hoseTo = new Vector3()

  constructor(private readonly hooks: JobHooks) {
    const scene = hooks.host.ctx.scene
    this.beacon = CreateCylinder('fl-job-beacon', { height: BEACON_HEIGHT, diameterTop: 3.6, diameterBottom: 5, tessellation: 24, cap: 0 }, scene)
    this.beaconMat = new StandardMaterial('fl-job-beacon-mat', scene)
    this.beaconMat.disableLighting = true
    this.beaconMat.specularColor = Color3.Black()
    this.beaconMat.backFaceCulling = false
    this.beaconMat.alpha = 0.3
    this.beaconMat.disableDepthWrite = true
    this.beacon.material = this.beaconMat
    this.beacon.isPickable = false
    this.beacon.setEnabled(false)
    hooks.host.ctx.registerDynamic(this.beacon)
    this.fire = new FireFx(hooks.host.ctx, scene)
    this.chip = document.createElement('div')
    this.chip.className = 'chip fl-job'
    this.chip.hidden = true
    this.chip.setAttribute('aria-live', 'polite')
    this.chipText = document.createElement('b')
    this.chipSub = document.createElement('span')
    this.chipSub.className = 'dim'
    this.chip.append(this.chipText, this.chipSub)
    document.getElementById('hud-tl')?.append(this.chip)
  }

  /** A job from the authority (or null when it is done or cancelled), with its note for the toast. */
  onJob(job: Job | null, note?: string): void {
    const before = this.job
    this.job = job
    if (note) this.hooks.host.hud.toast(note, job?.kind === 'fire' ? 'big' : '')
    if (!job) {
      if (before?.kind === 'fire') this.fire.setBlaze(null)
      this.fire.hose = null
      this.beacon.setEnabled(false)
      this.chip.hidden = true
      this.clearRoute()
      return
    }
    if (job.kind === 'fire' && job.stage !== 'toPickup' && !this.fire.burning) this.fire.setBlaze(this.blazeAt(job.drop.x, job.drop.z))
    if (job.stage !== 'onScene') this.sprayed = 0
    const target = this.target(job)
    const s = townToScene(target.x, 0, target.z, this._t)
    this.beacon.position.set(s.x, this.hooks.host.terrain.heightAt(s.x, s.z) + BEACON_HEIGHT / 2 - 2, s.z)
    this.beacon.setEnabled(job.stage !== 'onScene')
    this.beaconMat.emissiveColor = job.kind === 'fire' ? new Color3(1, 0.32, 0.12) : job.stage === 'toPickup' ? new Color3(1, 0.8, 0.2) : new Color3(0.35, 1, 0.45)
    this.beaconMat.diffuseColor = this.beaconMat.emissiveColor
    this.chip.hidden = false
    this.routedKey = ''
    this.ping = 0
    this.tick = 0
    this.update(0)
  }

  /** On foot at a fire: the hose prompt. */
  prompt(): string {
    const job = this.job
    if (!job || job.kind !== 'fire' || job.stage !== 'onScene' || this.hooks.host.driving) return ''
    return this.nearFire() ? `Hold E — spray the fire (${Math.max(0, Math.ceil(FIRE_HOSE_SECONDS + 0.5 - this.sprayed))} s left)` : ''
  }

  /** E at a fire starts the hose (holding it keeps spraying); nothing else happens on that press. */
  interact(): boolean {
    const job = this.job
    return !!job && job.kind === 'fire' && job.stage === 'onScene' && !this.hooks.host.driving && this.nearFire()
  }

  update(dt: number): void {
    const now = performance.now()
    const real = this.lastFrame ? Math.min(0.5, (now - this.lastFrame) / 1000) : dt
    this.lastFrame = now
    this.fire.update(dt, this.hooks.host.ctx.camera)
    const job = this.job
    if (!job) return
    const host = this.hooks.host
    const spraying = job.kind === 'fire' && job.stage === 'onScene' && !host.driving && host.playing && !host.hud.modalOpen && host.keys.has('KeyE') && this.nearFire()
    if (spraying) {
      this.sprayed += real
      const facing = host.facing
      this.hoseFrom.set(host.player.x + Math.sin(facing) * 0.6, host.player.y + 1.25, host.player.z + Math.cos(facing) * 0.6)
      const b = this.blaze()
      if (b) this.hoseTo.set(b.x, b.y + 0.5, b.z)
      this.fire.hose = { from: this.hoseFrom, to: this.hoseTo }
      this.fire.strength = Math.max(0.05, 1 - this.sprayed / (FIRE_HOSE_SECONDS + 0.5))
    } else this.fire.hose = null
    this.ping -= dt
    this.tick -= dt
    if (this.tick > 0) return
    this.tick = 0.4
    this.route(job)
    const here = this.here()
    const target = this.target(job)
    const dist = Math.hypot(here.x - target.x, here.z - target.z)
    this.chipText.textContent = this.title(job)
    this.chipSub.textContent = ` · ${this.detail(job, dist)}`
    if (this.ping > 0 || !this.arrived(job, dist)) return
    this.ping = 1
    this.hooks.send({ t: 'jobProgress', jobId: job.id })
  }

  private arrived(job: Job, dist: number): boolean {
    if (job.kind === 'fire') {
      if (job.stage === 'toPickup') return dist < FIRE_STATION_REACH
      if (job.stage === 'toDrop') return dist < FIRE_SCENE_REACH
      return this.sprayed >= FIRE_HOSE_SECONDS + 0.5
    }
    const car = this.hooks.cars.driving()
    if (!car || vehicleRole(car.kind) !== 'hauler') return false
    return dist < (job.area === 'montello' ? DELIVERY_REACH.montello : DELIVERY_REACH.foxplains)
  }

  private title(job: Job): string {
    if (job.kind === 'fire') return job.stage === 'toPickup' ? 'Fire call: gear up' : job.stage === 'toDrop' ? 'Fire call' : 'Fire on scene'
    return job.stage === 'toPickup' ? 'Delivery: load up' : 'Delivery'
  }

  private detail(job: Job, dist: number): string {
    const far = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`
    const street = job.street ? ` on ${job.street}` : ''
    if (job.kind === 'fire') {
      if (job.stage === 'toPickup') return `report to the fire station, ${far}`
      if (job.stage === 'toDrop') return `house burning${street}, ${far}`
      return this.hooks.host.driving ? 'get out and hold E at the fire' : `hold E to spray, ${Math.max(0, Math.ceil(FIRE_HOSE_SECONDS + 0.5 - this.sprayed))} s left`
    }
    const truck = this.hooks.cars.driving()
    const need = truck && vehicleRole(truck.kind) === 'hauler' ? '' : ' (in the pickup)'
    if (job.stage === 'toPickup') return `pick up at ${job.area === 'montello' ? 'Kwik Trip' : 'the freight depot'}${need}, ${far}`
    return `deliver${street}${need}, ${far} · $${job.pay.toLocaleString()}`
  }

  /** Where the player is (their car while driving), in the town frame. */
  private here(): { x: number; z: number } {
    const v = this.hooks.host.driving
    const at = v ? v.position : this.hooks.host.player
    const t = sceneToTown(at.x, at.y, at.z, this._t)
    return { x: t.x, z: t.z }
  }

  private target(job: Job): { x: number; z: number } {
    return job.stage === 'toPickup' ? job.pickup : job.drop
  }

  private nearFire(): boolean {
    const b = this.blaze()
    if (!b) return false
    const p = this.hooks.host.player
    return Math.hypot(p.x - b.x, p.z - b.z) < HOSE_REACH
  }

  private blaze(): Blaze | null {
    return this.fire.current
  }

  /**
   * The house to set burning: the Montello house nearest the job's front step (its roof, from the lidar), or a plain
   * patch of fire over the step when Montello's map is not loaded.
   */
  private blazeAt(townX: number, townZ: number): Blaze {
    const s = townToScene(townX, 0, townZ)
    const land = this.hooks.land
    const ground = this.hooks.host.terrain.heightAt(s.x, s.z)
    if (!land) return { x: s.x, y: ground + 5, z: s.z, a: 3, b: 3, yaw: 0 }
    const mx = land.toMapX(s.x)
    const mz = land.toMapZ(s.z)
    let best: { x: number; z: number; y: number; a: number; b: number; yaw: number } | null = null
    let bd = 40
    for (const b of land.doc.buildings) {
      if (b.k !== 'house' && b.k !== 'garage') continue
      for (const r of b.r) {
        const d = Math.hypot(r[0] - mx, r[1] - mz)
        if (d >= bd) continue
        bd = d
        const top = r.length > 7 ? r[7] : b.h + 1.5
        best = { x: r[0], z: r[1], y: b.f + Math.max(top, b.h) - 0.4, a: Math.max(1.5, r[2] * 0.75), b: Math.max(1.5, r[3] * 0.75), yaw: r[4] }
      }
    }
    if (!best) return { x: s.x, y: ground + 5, z: s.z, a: 3, b: 3, yaw: 0 }
    return { x: land.toSceneX(best.x), y: best.y, z: land.toSceneZ(best.z), a: best.a, b: best.b, yaw: best.yaw }
  }

  /**
   * Directions on the map: Montello's own map once you are north of Fox Plains' square, Fox Lake's map to County Road
   * F while a Montello job is still ahead of you to the north, and Fox Lake's map for Fox Plains jobs.
   */
  private route(job: Job): void {
    const north = this.hooks.inNorth()
    const montello = job.area === 'montello'
    const key = `${job.id}:${job.stage}:${montello && north ? 'n' : 's'}`
    if (key === this.routedKey || job.stage === 'onScene') return
    this.routedKey = key
    this.clearRoute()
    const target = this.target(job)
    const s = townToScene(target.x, 0, target.z, this._t)
    const label = job.kind === 'fire' ? (job.stage === 'toPickup' ? 'the fire station' : 'the fire') : job.stage === 'toPickup' ? (montello ? 'Kwik Trip' : 'the freight depot') : 'the delivery'
    if (montello && north) {
      const map = this.hooks.northMap()
      const land = this.hooks.land
      if (map && land) {
        map.navigate({ x: land.toMapX(s.x), z: land.toMapZ(s.z), name: label })
        this.routed = 'north'
      }
      return
    }
    const map = this.hooks.map()
    if (!map) return
    if (montello) map.routeToScene(NORTH_ROAD.start.x, NORTH_ROAD.start.z, 'County Road F to Montello')
    else map.routeToScene(s.x, s.z, label)
    this.routed = 'south'
  }

  private clearRoute(): void {
    if (this.routed === 'north') this.hooks.northMap()?.navigate(null)
    else if (this.routed === 'south') this.hooks.map()?.clear()
    this.routed = 'none'
  }
}
