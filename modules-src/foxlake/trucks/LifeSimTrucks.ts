/**
 * Truck Simulator inside Life Sim: a `TruckHost` owned by `FoxLakeTown` (Rack & Reel takes one extension, so this is a component
 * of the town, like `Cars`). It runs Truck Simulator's `TruckSession` on Montello (`MONTELLO` haul world, `/api/trucksim?world=montello`
 * career): the rig is built under the town root (Life Sim's right-handed town frame, the same frame the session uses), its rigs
 * live in the town's Rapier world, and the player's Haulers Lane lot and the work-zone equipment are drawn there too.
 *
 * Getting in and out is Life Sim's own: the cab is registered with Rack & Reel's `VehicleController` through an unmirrored stand-in
 * node in scene space (like `Cars`), so the player walks up, presses E, is seated in the cab, and E gets them out at the driver's
 * door. Driving keys reach the session only while the player is in the cab; Rack & Reel's input is ignored (the session reads the
 * key set itself), and a chase camera sized for a rig replaces Rack & Reel's 7 m one. When a truck prompt is showing (fuel, wash,
 * dealer, a job step), E belongs to the truck instead of getting out (`claimsInteract`).
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { GameHost } from '../../rackreel/game/Game'
import type { DriveInput, ExternalDriver, Vehicle as RrVehicle } from '../../rackreel/systems/VehicleController'
import { driverEye } from '../../trucksim/game/Cameras'
import { TruckSession } from '../../trucksim/game/TruckSession'
import type { SessionView } from '../../trucksim/game/TruckSession'
import type { ToastKind, TruckHost } from '../../trucksim/game/TruckHost'
import { Progress } from '../../trucksim/net/Progress'
import { MaterialLibrary } from '../../trucksim/render/Materials'
import { LotRenderer } from '../../trucksim/render/Lots'
import { createWorkZones } from '../../trucksim/render/work/WorkZones'
import type { WorkZones } from '../../trucksim/render/work/WorkZones'
import { MONTELLO, MONTELLO_LOTS, MONTELLO_SPAWN } from '../../trucksim/shared/montello/MontelloWorld'
import { TRUCK_BY_ID } from '../../trucksim/shared/Catalog'
import { lotExtent } from '../../trucksim/shared/WorldLayout'
import type { LotSpec } from '../../trucksim/shared/WorldLayout'
import type { Terrain } from '../../trucksim/shared/Terrain'
import { DEFAULT_GROUPS } from '../../trucksim/sim/PhysicsHost'
import type { PhysicsHost } from '../../trucksim/sim/PhysicsHost'
import { sceneToTown, townToScene } from '../region'
import { Traffic, buildLanes } from '../../trucksim/sim/Traffic'
import type { Obstacle } from '../../trucksim/sim/Traffic'
import { TrafficVisuals } from '../../trucksim/render/TrafficVisuals'
import { MONTELLO_ROAD_DATA } from '../../trucksim/shared/montello/MontelloRoads'
import type { Road } from '../../trucksim/shared/WorldLayout'

/** The town's physics as Truck Simulator needs it. */
export interface TownPhysics {
  readonly R: typeof RAPIER
  readonly world: RAPIER.World
  onPreStep(fn: (dt: number) => void): () => void
}

/** Chase camera behind the rig: distance grows with the rig's length. */
const CHASE_BACK = 11
const CHASE_UP = 4.2
const CAMERA_EASE = 6
const HIP_ABOVE_SEAT = 0.1
/** Background vehicles on Montello's highways and county roads (downtown streets are Life Sim's own). */
const MONTELLO_TRAFFIC = 14
const ROAD_KINDS: Road['kind'][] = ['highway', 'road', 'street', 'gravel']

/** Montello's highways and county roads as traffic roads (town frame). */
function trafficRoads(): Road[] {
  return MONTELLO_ROAD_DATA.filter((entry) => entry[0] <= 1).map((entry, i) => {
    const points: [number, number][] = []
    for (let k = 2; k + 1 < entry.length; k += 2) points.push([entry[k], entry[k + 1]])
    return { id: `montello-${i}`, name: '', kind: ROAD_KINDS[entry[0]], width: entry[1], points }
  })
}

function headingOf(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x))
}

export class LifeSimTrucks implements TruckHost, ExternalDriver {
  readonly scene: Scene
  readonly physics: PhysicsHost
  readonly world = MONTELLO
  readonly mats: MaterialLibrary
  progress!: Progress
  session: TruckSession | null = null
  private lots: LotRenderer | null = null
  private zones: WorkZones | null = null
  private standIn: TransformNode | null = null
  private vehicle: RrVehicle | null = null
  private readonly lotBoxes: unknown[] = []
  private view: SessionView | null = null
  private readonly eye = new Vector3()
  private readonly target = new Vector3()
  private cameraSet = false
  private cameraReady = false
  private traffic: Traffic | null = null
  private trafficVisuals: TrafficVisuals | null = null
  private readonly rigObstacle: Obstacle[] = [{ x: 0, z: 0, vx: 0, vz: 0, half: 4 }]
  private readonly townPoint = { x: 0, y: 0, z: 0 }

  constructor(
    private readonly host: GameHost,
    readonly frameRoot: TransformNode,
    private readonly town: TownPhysics,
    private readonly heightAtTown: (x: number, z: number) => number,
    private readonly addStatic: (box: { x: number; y: number; z: number; hx: number; hy: number; hz: number; rotY?: number }) => unknown,
    private readonly removeStatic: (handle: never) => void,
  ) {
    this.scene = host.ctx.scene
    this.mats = new MaterialLibrary(this.scene)
    this.physics = { rapier: town.R, world: town.world, groups: DEFAULT_GROUPS, heightAt: heightAtTown, gripAt: () => 1 }
  }

  /** Loads the Montello career, draws the lots and zones, builds the rig and puts its cab on Rack & Reel's vehicle list. */
  async start(): Promise<void> {
    this.progress = await Progress.load(MONTELLO)
    const terrain = { heightAt: this.heightAtTown } as unknown as Terrain
    this.lots = new LotRenderer(this.scene, this.frameRoot, this.mats, terrain)
    this.zones = createWorkZones(this.scene, this.frameRoot, this.mats, MONTELLO.zones, this.heightAtTown)
    this.drawLots()
    this.progress.onChange(() => this.drawLots())
    this.traffic = new Traffic(buildLanes(trafficRoads()), this.heightAtTown, Math.floor(Date.now() / 60000), MONTELLO_TRAFFIC)
    this.trafficVisuals = new TrafficVisuals(this.scene, this.frameRoot, this.mats, this.physics, this.traffic)
    this.session = new TruckSession(this, {
      openDealer: () => this.toast('The dealer is in Truck Simulator for now: open it from the library to buy trucks', 'info'),
      jobDone: (message, pay) => this.toast(`${message}${pay > 0 ? ` · +$${Math.round(pay).toLocaleString()}` : ''}`, 'good'),
      horn: () => {},
      airBrake: () => {},
      startWash: (place) => void this.session?.finishWash(place, 1),
    })
    this.standIn = new TransformNode('truck-cab-seat', this.scene)
    this.standIn.rotationQuaternion = new Quaternion()
    const model = this.session.truck?.model
    const eye = model ? driverEye(model) : { x: 0.55, y: 1.9, z: 1.2 }
    const half = model ? model.width / 2 : 1.3
    const label = model ? `${model.brand} ${model.name}` : 'truck'
    this.vehicle = this.host.vehicles.addExternal(this.standIn, this, new Vector3(), 0, new Vector3(-eye.x, eye.y - 0.75 + HIP_ABOVE_SEAT, eye.z), new Vector3(-(half + 1.2), 0, eye.z), label)
    this.sync()
  }

  get keys(): ReadonlySet<string> {
    return this.host.keys
  }

  /** True while the player sits in the rig's cab. */
  get driving(): boolean {
    return this.vehicle !== null && this.host.driving === this.vehicle
  }

  lotFor(index: number | null): LotSpec | null {
    const spec = index === null ? null : MONTELLO.lot(index) ?? null
    return spec ? lotExtent(spec, this.progress?.profile.lot === index ? this.progress.profile.land : 0) : null
  }

  spawnPoint(): { x: number; z: number; heading: number } {
    return MONTELLO_SPAWN
  }

  addCaster(mesh: AbstractMesh): void {
    this.host.addCaster(mesh)
  }

  removeCaster(mesh: AbstractMesh): void {
    this.host.removeCaster(mesh)
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    this.host.hud.toast(text, kind === 'bad' || kind === 'warn' ? 'warn' : kind === 'good' ? 'big' : '')
  }

  /** The session drives only while the player is in the cab and no menu is open. */
  paused(): boolean {
    return !this.driving || this.host.hud.modalOpen
  }

  placeName(): string | null {
    return null
  }

  /** Rack & Reel's per-vehicle step: nothing to do, the session reads the keys itself. */
  step(_dt: number, _input: DriveInput, _v: RrVehicle): void {}

  controlsHint(): string | null {
    return 'W/S drive · A/D steer · Space parking brake · E get out (or use what a truck prompt offers)'
  }

  /** The truck prompt for the HUD while in the cab (fuel, wash, a job step), else null. */
  prompt(): string | null {
    return this.driving ? this.view?.prompt ?? null : null
  }

  /** True when a truck prompt wants E right now, so E is not taken as getting out. */
  claimsInteract(): boolean {
    const prompt = this.prompt()
    return prompt !== null && /\bE\b/.test(prompt)
  }

  /**
   * One rendered frame: the session reads keys and then `runPhysics` steps the town's world (its fixed loop), with the rig's
   * per-step forces hooked in front of every step; afterwards the cab's stand-in and the camera follow the rig.
   */
  frame(dt: number, runPhysics: () => void): void {
    const session = this.session
    if (!session) {
      runPhysics()
      return
    }
    this.updateTraffic(dt)
    this.view = session.frame(dt, (before) => {
      const off = this.town.onPreStep(before)
      runPhysics()
      off()
    })
    this.sync()
    this.camera(dt)
  }

  /** Moves Montello's traffic around the player (or the rig while driving), treating the rig as traffic. */
  private updateTraffic(dt: number): void {
    const traffic = this.traffic
    const truck = this.session?.truck
    if (!traffic || !this.trafficVisuals || this.host.hud.modalOpen) return
    let focus: { x: number; z: number }
    if (truck) {
      const pose = truck.pose()
      const yaw = headingOf(pose.rotation)
      const o = this.rigObstacle[0]
      o.x = pose.position.x
      o.z = pose.position.z
      o.vx = Math.sin(yaw) * truck.speed
      o.vz = Math.cos(yaw) * truck.speed
      o.half = (truck.model.frontZ - truck.model.rearZ) / 2
    }
    if (this.driving && truck) focus = truck.pose().position
    else {
      const p = this.host.player
      focus = sceneToTown(p.x, p.y, p.z, this.townPoint)
    }
    traffic.update(dt, focus, truck ? this.rigObstacle : [])
    this.trafficVisuals.sync(dt, this.host.lighting.night > 0.5)
  }

  /** Where the rig is in the town frame (for the town's streaming focus points). */
  focus(out: { x: number; z: number }[]): void {
    const truck = this.session?.truck
    if (!truck) return
    const p = truck.pose().position
    out.push({ x: p.x, z: p.z })
    const trailer = this.session?.trailer
    if (trailer) {
      const t = trailer.pose().position
      out.push({ x: t.x, z: t.z })
    }
  }

  private sync(): void {
    const truck = this.session?.truck
    const v = this.vehicle
    const seat = this.standIn
    if (!truck || !v || !seat) return
    const pose = truck.pose()
    const p = pose.position
    const yaw = headingOf(pose.rotation)
    const scene = townToScene(p.x, p.y, p.z)
    const heading = Math.atan2(Math.sin(yaw), -Math.cos(yaw))
    v.position.set(scene.x, scene.y, scene.z)
    v.heading = heading
    v.pitch = 0
    v.roll = 0
    v.speed = truck.speed
    seat.position.set(scene.x, scene.y, scene.z)
    Quaternion.FromEulerAnglesToRef(0, heading, 0, seat.rotationQuaternion!)
  }

  private camera(dt: number): void {
    if (!this.driving) {
      if (this.cameraSet) this.host.setCameraShot(null)
      this.cameraSet = false
      this.cameraReady = false
      return
    }
    const truck = this.session?.truck
    if (!truck) return
    const pose = truck.pose()
    const yaw = headingOf(pose.rotation)
    const length = truck.model.frontZ - truck.model.rearZ + (this.session?.trailer ? 14 : 0)
    const back = CHASE_BACK + length * 0.6
    const p = pose.position
    const ex = p.x - Math.sin(yaw) * back, ez = p.z - Math.cos(yaw) * back
    const ey = Math.max(this.heightAtTown(ex, ez) + 1.5, p.y + CHASE_UP + length * 0.08)
    const eye = townToScene(ex, ey, ez)
    const target = townToScene(p.x, p.y + 2.2, p.z)
    const k = this.cameraReady ? 1 - Math.exp(-CAMERA_EASE * dt) : 1
    this.eye.set(this.eye.x + (eye.x - this.eye.x) * k, this.eye.y + (eye.y - this.eye.y) * k, this.eye.z + (eye.z - this.eye.z) * k)
    this.target.set(target.x, target.y, target.z)
    this.cameraReady = true
    this.cameraSet = true
    this.host.setCameraShot({ eye: this.eye, target: this.target })
  }

  private drawLots(): void {
    const lots = this.lots
    if (!lots) return
    for (const handle of this.lotBoxes) this.removeStatic(handle as never)
    this.lotBoxes.length = 0
    const profile = this.progress.profile
    const others = new Map(this.progress.lots.map((lot) => [lot.index, lot]))
    for (const spec of MONTELLO_LOTS) {
      const mine = profile.lot === spec.index
      const other = others.get(spec.index)
      const owner = mine ? { name: this.progress.username ?? 'You', company: profile.company } : other ? { name: other.owner, company: other.company } : null
      lots.setLot(lotExtent(spec, mine ? profile.land : other?.land ?? 0), owner, mine ? profile.build : other?.build ?? [])
      for (const box of lots.staticBoxes(spec.index)) this.lotBoxes.push(this.addStatic(box))
    }
  }

  /** The active truck model, for labels. */
  get truckModelName(): string {
    const uid = this.progress?.profile.activeTruck
    const owned = this.progress?.profile.trucks.find((t) => t.uid === uid)
    const model = owned ? TRUCK_BY_ID[owned.model] : undefined
    return model ? `${model.brand} ${model.name}` : 'truck'
  }

  dispose(): void {
    if (this.vehicle) this.host.vehicles.remove(this.vehicle)
    this.trafficVisuals?.dispose()
    this.session?.dispose()
    this.zones?.dispose()
    this.lots?.dispose()
    this.standIn?.dispose()
    this.mats.dispose()
  }
}
