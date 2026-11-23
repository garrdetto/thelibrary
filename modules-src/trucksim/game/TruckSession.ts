/**
 * The heart of Truck Simulator, independent of where it runs: the player's active truck and trailer as Rapier rigs with their
 * visuals, the rest of the fleet parked at the lot, driving controls from a key set, fifth-wheel coupling with air lines and
 * landing gear, the dump bed, the job runner and its procedures, the AI loaders at the quarry, the lowboy's excavator, fuel,
 * repairs and the dealer. It talks to the world only through a `TruckHost`, so Life Sim can host it as well as the standalone
 * page. Each frame: `frame(dt, stepPhysics)` (the host's physics calls back into `step(h)` once per fixed step).
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { buildExcavator } from '../render/models/MachineVisual'
import type { ExcavatorVisual } from '../render/models/MachineVisual'
import { buildTrailerVisual } from '../render/models/TrailerVisual'
import type { TrailerVisual } from '../render/models/TrailerVisual'
import { buildTruckVisual } from '../render/models/TruckVisual'
import type { TruckVisual } from '../render/models/TruckVisual'
import { createDirtLayer } from '../render/models/DirtLayer'
import type { DirtLayer } from '../render/models/DirtLayer'
import type { WorkZoneActivity } from '../render/work/WorkZones'
import { CARGO_BY_ID, CLEAN_DIRT_LIMIT, DIRT_PER_KM, FUEL_PRICE_PER_L, OWN_WASH_WATER, PUBLIC_WASH_PRICE, REPAIR_COST_PER_POINT, TRAILER_BY_ID, TRUCK_BY_ID, WASHER_REACH_M, haulFor } from '../shared/Catalog'
import type { TrailerModel, TruckLook, TruckModel } from '../shared/Catalog'
import { FUEL_STATION_MARKUP, REPAIR_LABOUR_MARKUP } from '../shared/Economy'
import type { OwnedTruck, Profile } from '../shared/Economy'
import { hasService, itemFootprint, washSpots } from '../shared/Lots'
import { route } from '../shared/RoadGraph'
import { getTerrain } from '../shared/Terrain'
import { SITE_BY_ID, SITES, headingDelta, inRect, inZone, lotSpawn } from '../shared/WorldLayout'
import type { LotSpec, Zone } from '../shared/WorldLayout'
import { COUPLING_MESSAGES, attachNeck, checkCouple, couple, detachNeck, uncouple } from '../sim/Coupling'
import { ExcavatorRig } from '../sim/ExcavatorRig'
import { LoaderAI } from '../sim/LoaderAI'
import { TrailerRig } from '../sim/TrailerRig'
import { TruckRig } from '../sim/TruckRig'
import { emptyInput, emptyMachineInput, headingOf, toWorld } from '../sim/types'
import type { DriveInput, ExcavatorPose, LoaderPose, MachineInput, Vec3 } from '../sim/types'
import { BINDINGS } from '../systems/Keys'
import type { KeyAction } from '../systems/Keys'
import type { GaugeValues, JobView } from '../ui/Hud'
import { driverEye } from './Cameras'
import type { FollowSubject } from './Cameras'
import { JobRunner } from './JobRunner'
import type { RigFit } from './JobRunner'
import { strapCount } from './Procedures'
import type { KeyState, MachineView, ProcKey, ProcedureContext, ProcedureStatus, TrailerView, TruckView } from './Procedures'
import type { TruckHost } from './TruckHost'

export interface SessionEvents {
  openDealer(): void
  jobDone(message: string, pay: number): void
  horn(on: boolean): void
  airBrake(): void
  startWash(place: WashPlace): void
}

/** Where a wash happens: the travel center's lane or your own wash bay. */
export type WashPlace = 'own' | 'public'

/** A map waypoint counts as reached within this many metres. */
export const WAYPOINT_ARRIVE_M = 30

/** Where on your own lot the truck can be washed: inside a wash bay, or within hose reach of a pressure washer (its reel position). */
export type OwnWash = { kind: 'bay' } | { kind: 'washer'; reel: { x: number; y: number; z: number } }

export interface SessionView {
  gauges: GaugeValues
  job: JobView | null
  steps: ProcedureStatus | null
  prompt: string | null
  place: string
  route: [number, number][] | null
  target: { x: number; z: number; label: string } | null
  controlling: 'truck' | 'machine'
  engineLoad: number
  reversing: boolean
  hydraulic: number
}

interface ParkedVisual {
  uid: string
  visual: TruckVisual | TrailerVisual
}

const CODES = new Map<KeyAction, readonly string[]>(BINDINGS.map((b) => [b.action, b.codes]))
const PROC_KEYS: Record<ProcKey, KeyAction> = { interact: 'interact', fifth: 'coupler', gear: 'landingGear', raise: 'dumpRaise', lower: 'dumpLower' }
const ODOMETER_SECONDS = 45
const MACHINE_REACH = 90
const PARKED_SHOW = 650
const PARKED_HIDE = 850

function keyOf(hint: string): KeyAction | null {
  const h = hint.toUpperCase()
  if (h.endsWith(' E') || h === 'E') return 'interact'
  if (h.endsWith(' T') || h === 'T') return 'coupler'
  if (h.endsWith(' G') || h === 'G') return 'landingGear'
  return null
}

/** One frame's procedure view of the rig, rewritten in place each frame. */
class RigContext implements ProcedureContext {
  zone!: Zone
  job!: JobRunner['job']
  readonly truck: TruckView = { x: 0, z: 0, heading: 0, speed: 0, parkingBrake: true, fifthWheel: { x: 0, z: 0 }, dump: null }
  trailer: TrailerView | null = null
  machine: MachineView | null = null
  private readonly trailerView: TrailerView = {
    kind: 'flatbed', center: { x: 0, z: 0 }, heading: 0, rear: { x: 0, z: 0 }, hopper: { x: 0, z: 0 }, coupled: false, neckAttached: true,
    gear: 0, doors: 0, payloadKg: 0, capacityKg: 0, deckFront: { x: 0, z: 0 },
  }
  private readonly machineView: MachineView = { x: 0, z: 0, speed: 0, onDeck: false, secured: false, controlled: false }
  private readonly dumpView = { loadKg: 0, capacityKg: 0, angle: 0 }
  private readonly scratch: Vec3 = { x: 0, y: 0, z: 0 }

  constructor(private readonly session: TruckSession) {}

  refresh(zone: Zone, job: JobRunner['job']): void {
    this.zone = zone
    this.job = job
    const s = this.session
    const truck = s.truck
    if (!truck) return
    const pose = truck.pose()
    const t = this.truck
    t.x = pose.position.x
    t.z = pose.position.z
    t.heading = headingOf(pose.rotation)
    t.speed = truck.speed
    t.parkingBrake = s.parkingBrake
    const fifth = truck.fifthWheelWorld()
    t.fifthWheel.x = fifth.x
    t.fifthWheel.z = fifth.z
    if (truck.dump) {
      this.dumpView.loadKg = truck.dump.loadKg
      this.dumpView.capacityKg = truck.model.dump?.capacityKg ?? 0
      this.dumpView.angle = truck.dump.angle
      t.dump = this.dumpView
    } else t.dump = null
    const trailer = s.coupledTrailer
    if (trailer) {
      const tv = this.trailerView
      const tp = trailer.pose()
      const m = trailer.model
      tv.kind = m.kind
      tv.heading = headingOf(tp.rotation)
      const at = (z: number, out: { x: number; z: number }) => {
        this.scratch.x = 0
        this.scratch.y = 0
        this.scratch.z = z
        const w = toWorld(tp, this.scratch, this.scratch)
        out.x = w.x
        out.z = w.z
      }
      at((m.frontZ + m.rearZ) / 2, tv.center)
      at(m.rearZ, tv.rear)
      at((m.frontZ + m.rearZ) / 2 - 0.4, tv.hopper)
      at(m.rgn ? m.rgn.wellFrontZ : m.frontZ, tv.deckFront)
      tv.coupled = trailer.coupling === 'locked'
      tv.neckAttached = trailer.neckAttached
      tv.gear = m.kind === 'lowboy' ? s.deckHydraulic : trailer.gear
      tv.doors = trailer.doors
      tv.payloadKg = trailer.payloadKg
      tv.capacityKg = m.maxPayloadKg
      this.trailer = tv
    } else this.trailer = null
    const machine = s.excavator
    if (machine) {
      const mp = machine.pose()
      const mv = this.machineView
      mv.x = mp.position.x
      mv.z = mp.position.z
      mv.speed = machine.speed
      mv.secured = machine.secured !== null
      const check = s.trailer ? machine.checkSecure(s.trailer) : null
      mv.onDeck = mv.secured || Boolean(check && (check.ok || check.reason === 'moving'))
      mv.controlled = s.controlling === 'machine'
      this.machine = mv
    } else this.machine = null
  }

  key(key: ProcKey): KeyState {
    return this.session.keyState(PROC_KEYS[key])
  }

  addDump(kg: number, material: string): number {
    const dump = this.session.truck?.dump
    return dump ? dump.add(kg, material) : 0
  }

  setTrailerPayload(kg: number, cargo: string | null): void {
    const trailer = this.session.trailer
    if (!trailer) return
    trailer.setPayload(kg)
    this.session.trailerCargo = cargo
  }

  setDoors(target: 0 | 1): void {
    if (this.session.trailer) this.session.trailer.doorsTarget = target
  }

  setDeck(target: 0 | 1): void {
    this.session.deckTarget = target
  }

  detachNeck(): string | null {
    const s = this.session
    if (!s.truck || !s.trailer) return 'couple the lowboy first'
    const result = detachNeck(s.truck, s.trailer)
    return result.ok ? null : COUPLING_MESSAGES[result.reason ?? 'busy']
  }

  attachNeck(): string | null {
    const s = this.session
    if (!s.truck || !s.trailer) return 'couple the lowboy first'
    const result = attachNeck(s.truck, s.trailer)
    return result.ok ? null : result.reason ? COUPLING_MESSAGES[result.reason] : `${result.distance.toFixed(1)} m and ${Math.round(result.angleDeg)}° off`
  }

  spawnMachine(): void {
    this.session.ensureExcavator(this.zone)
  }

  secureMachine(): string | null {
    const s = this.session
    if (!s.excavator || !s.trailer) return 'no machine on the deck'
    const check = s.excavator.secureTo(s.trailer)
    return check.ok ? null : check.reason === 'off-deck' ? 'the machine is not on the deck' : check.reason === 'moving' ? 'stop the machine first' : null
  }

  releaseMachine(): void {
    this.session.excavator?.release()
  }

  takeMachine(): string | null {
    const s = this.session
    const machine = s.excavator
    const truck = s.truck
    if (!machine || !truck) return 'there is no machine here'
    const mp = machine.pose().position
    const tp = truck.pose().position
    if (Math.hypot(mp.x - tp.x, mp.z - tp.z) > MACHINE_REACH) return 'park closer to the excavator'
    s.controlling = 'machine'
    return null
  }

  leaveMachine(): void {
    this.session.controlling = 'truck'
  }

  loaderStep(dt: number, ready: boolean, wantKg: number): number {
    return this.session.runLoader(this.zone.id, dt, ready, wantKg)
  }
}

export class TruckSession {
  truck: TruckRig | null = null
  trailer: TrailerRig | null = null
  excavator: ExcavatorRig | null = null
  controlling: 'truck' | 'machine' = 'truck'
  parkingBrake = true
  engineBrake = true
  trailerCargo: string | null = null
  deckHydraulic = 0
  deckTarget: 0 | 1 = 0
  runner: JobRunner | null = null

  private truckModel: TruckModel | null = null
  private trailerModel: TrailerModel | null = null
  private ownedTruck: OwnedTruck | null = null
  private truckVisual: TruckVisual | null = null
  private dirt: DirtLayer | null = null
  private dirtTimer = 0
  private washing = false
  private washReadyAt = 0
  private trailerVisual: TrailerVisual | null = null
  private machineVisual: ExcavatorVisual | null = null
  private readonly casters: AbstractMesh[] = []
  private readonly parked: ParkedVisual[] = []
  private parkedShown = false
  private readonly loaders = new Map<string, { ai: LoaderAI; zone: Zone; ran: boolean }>()
  private readonly activity = new Map<string, WorkZoneActivity>()
  private readonly input: DriveInput = emptyInput()
  private readonly machineInput: MachineInput = emptyMachineInput()
  private readonly ctx: RigContext
  private readonly down = new Set<KeyAction>()
  private readonly previous = new Set<KeyAction>()
  private firstStep = true
  private reverseHold = 0
  private uncoupling = false
  private odometerTimer = 0
  private sentOdometerM = 0
  private sentFuelL = 0
  private routeTimer = 0
  private picked: { x: number; z: number } | null = null
  private placeTimer = 0
  private routePoints: [number, number][] | null = null
  private routeLength = 0
  private place = ''
  private completing = false
  private lastJobId: string | null = null
  private outOfFuel = 0
  private disposed = false
  private readonly unsubscribe: () => void
  private readonly view: SessionView
  private readonly terrain = getTerrain()
  private lastPayloadShown = -1
  private lastDumpShown = -1

  constructor(private readonly host: TruckHost, private readonly events: SessionEvents) {
    this.ctx = new RigContext(this)
    this.view = {
      gauges: { speedKph: 0, rpm: 0, gear: 0, automatic: true, fuelL: 0, fuelMaxL: 1, damage: 0, parkingBrake: true, engineBrake: true },
      job: null, steps: null, prompt: null, place: '', route: null, target: null, controlling: 'truck', engineLoad: 0, reversing: false, hydraulic: 0,
    }
    for (const zone of host.world.zonesOfKind('dumpLoad')) {
      const kind = zone.label.toLowerCase().includes('loader') ? 'loader' : 'excavator'
      this.loaders.set(zone.id, { ai: new LoaderAI({ kind, bucketKg: kind === 'loader' ? 3600 : 2400, side: 1 }), zone, ran: false })
    }
    this.unsubscribe = host.progress.onChange((profile) => this.sync(profile))
    this.sync(host.progress.profile, true)
  }

  get coupledTrailer(): TrailerRig | null {
    return this.trailer && this.trailer.tractor === this.truck && this.trailer.coupling === 'locked' ? this.trailer : null
  }

  get lot(): LotSpec | null {
    return this.host.lotFor(this.host.progress.profile.lot)
  }

  keyState(action: KeyAction): KeyState {
    if (!this.down.has(action)) return 'up'
    return this.previous.has(action) ? 'held' : 'pressed'
  }

  private pressed(action: KeyAction): boolean {
    return this.down.has(action) && !this.previous.has(action)
  }

  private spawnPoint(): { x: number; z: number; heading: number } {
    const lot = this.lot
    return lot ? lotSpawn(lot) : this.host.spawnPoint()
  }

  /** Builds or swaps the physical rig and the parked fleet to match the profile. */
  private sync(profile: Profile, first = false): void {
    if (this.disposed) return
    const owned = profile.trucks.find((t) => t.uid === profile.activeTruck) ?? profile.trucks[0]
    if (owned && (!this.ownedTruck || this.ownedTruck.uid !== owned.uid || first)) this.spawnTruck(owned)
    else if (owned && this.ownedTruck && this.truckVisual && JSON.stringify(owned.look) !== JSON.stringify(this.ownedTruck.look)) this.applyLook(owned.look)
    if (owned) this.ownedTruck = owned
    const trailerOwned = profile.activeTrailer ? profile.trailers.find((t) => t.uid === profile.activeTrailer) ?? null : null
    const currentTrailerUid = this.trailer ? (this.trailer as TrailerRig & { uid?: string }).uid : null
    if ((trailerOwned?.uid ?? null) !== (currentTrailerUid ?? null) || first) this.spawnTrailer(trailerOwned ? { uid: trailerOwned.uid, model: trailerOwned.model, color: trailerOwned.color } : null)
    const jobId = profile.job?.job.id ?? null
    if (jobId !== this.lastJobId) {
      this.lastJobId = jobId
      if (profile.job) this.runner = new JobRunner(profile.job.job, profile.job.acceptedAt, this.host.world)
      else {
        if (this.runner && this.runner.stage !== 'complete') this.clearCargo()
        this.runner = null
        this.despawnExcavator()
      }
    }
    this.rebuildParked()
  }

  private clearCargo(): void {
    if (this.truck?.dump) {
      this.truck.dump.clear()
      this.truck.setPayload(0)
    }
    if (this.trailer && !this.excavator?.secured) this.trailer.setPayload(0)
    this.trailerCargo = null
  }

  private trackCasters(meshes: readonly AbstractMesh[]): void {
    for (const mesh of meshes) {
      this.host.addCaster(mesh)
      this.casters.push(mesh)
    }
  }

  private untrackCasters(meshes: readonly AbstractMesh[]): void {
    for (const mesh of meshes) {
      const i = this.casters.indexOf(mesh)
      if (i >= 0) {
        this.casters.splice(i, 1)
        this.host.removeCaster(mesh)
      }
    }
  }

  private spawnTruck(owned: OwnedTruck): void {
    const model = TRUCK_BY_ID[owned.model]
    if (!model) return
    const coupled = this.coupledTrailer
    if (coupled && this.truck) uncouple(this.truck, coupled)
    this.dirt?.dispose()
    this.dirt = null
    if (this.truckVisual) {
      this.untrackCasters(this.truckVisual.meshes)
      this.truckVisual.dispose()
    }
    this.truck?.dispose()
    const spawn = this.spawnPoint()
    const truck = new TruckRig(this.host.physics, model, spawn)
    truck.fuelL = owned.fuelL
    truck.onImpact = (dv) => this.runner?.impact(dv)
    this.truck = truck
    this.truckModel = model
    this.sentOdometerM = 0
    this.sentFuelL = truck.fuelUsedL
    this.parkingBrake = true
    this.truckVisual = buildTruckVisual(this.host.scene, this.host.frameRoot, model, owned.look, this.host.mats)
    this.trackCasters(this.truckVisual.meshes)
    this.dirt = createDirtLayer(this.host.scene, this.truckVisual.root, this.truckVisual.layout)
    this.dirt.setDirt(owned.dirt)
    this.lastDumpShown = -1
    if (this.trailer && this.trailerModel) this.parkTrailerBehind()
  }

  private spawnTrailer(owned: { uid: string; model: string; color: string } | null): void {
    if (this.trailer && this.truck && this.trailer.tractor === this.truck) uncouple(this.truck, this.trailer)
    if (this.trailerVisual) {
      this.untrackCasters(this.trailerVisual.meshes)
      this.trailerVisual.dispose()
      this.trailerVisual = null
    }
    if (this.excavator?.secured) this.excavator.release()
    this.trailer?.dispose()
    this.trailer = null
    this.trailerModel = null
    this.trailerCargo = null
    this.uncoupling = false
    if (!owned || !this.truck || this.truckModel?.fifthWheelZ === undefined) return
    const model = TRAILER_BY_ID[owned.model]
    if (!model) return
    this.trailerModel = model
    const spawn = this.trailerSpawn(model)
    const trailer = new TrailerRig(this.host.physics, model, spawn)
    ;(trailer as TrailerRig & { uid?: string }).uid = owned.uid
    trailer.onImpact = (dv) => this.runner?.impact(dv)
    this.trailer = trailer
    this.trailerVisual = buildTrailerVisual(this.host.scene, this.host.frameRoot, model, owned.color, this.host.mats)
    this.trackCasters(this.trailerVisual.meshes)
    this.lastPayloadShown = -1
  }

  private trailerSpawn(model: TrailerModel): { x: number; z: number; heading: number } {
    const truck = this.truck!
    const pose = truck.pose()
    const heading = headingOf(pose.rotation)
    const fifth = truck.fifthWheelWorld()
    const gap = 2.6 + Math.max(0, model.frontZ)
    return { x: fifth.x - Math.sin(heading) * gap, z: fifth.z - Math.cos(heading) * gap, heading }
  }

  private parkTrailerBehind(): void {
    if (!this.trailer || !this.trailerModel) return
    const spawn = this.trailerSpawn(this.trailerModel)
    this.trailer.teleport(spawn.x, spawn.z, spawn.heading)
    this.trailer.gearTarget = 1
  }

  ensureExcavator(zone: Zone): void {
    if (this.excavator) return
    const at = zone.equipment ?? { x: zone.x + 20, z: zone.z, heading: zone.heading }
    this.excavator = new ExcavatorRig(this.host.physics, { x: at.x, z: at.z, heading: at.heading })
    this.machineVisual = buildExcavator(this.host.scene, this.host.frameRoot, this.host.mats)
    this.trackCasters(this.machineVisual.meshes)
  }

  private despawnExcavator(): void {
    if (this.machineVisual) {
      this.untrackCasters(this.machineVisual.meshes)
      this.machineVisual.dispose()
      this.machineVisual = null
    }
    this.excavator?.dispose()
    this.excavator = null
    this.controlling = 'truck'
  }

  /** Parked trucks and trailers at the lot, drawn only while the player is near it. */
  private rebuildParked(): void {
    for (const p of this.parked) {
      this.untrackCasters(p.visual.meshes)
      p.visual.dispose()
    }
    this.parked.length = 0
    this.parkedShown = false
  }

  private showParked(): void {
    const lot = this.lot
    if (!lot || this.parkedShown) return
    this.parkedShown = true
    const profile = this.host.progress.profile
    const inward = lot.side === 'west' ? -1 : 1
    const heading = lot.side === 'west' ? Math.PI / 2 : -Math.PI / 2
    const baseX = lot.gate.x + inward * 92
    let slot = 0
    for (const owned of profile.trucks) {
      if (owned.uid === this.ownedTruck?.uid) continue
      const model = TRUCK_BY_ID[owned.model]
      if (!model) continue
      const z = lot.z + 8 + slot * 6.5
      slot += 1
      if (z > lot.z + lot.d - 6) break
      const visual = buildTruckVisual(this.host.scene, this.host.frameRoot, model, owned.look, this.host.mats)
      const y = this.terrain.heightAt(baseX, z)
      visual.update(this.staticTruckPose(model, baseX, y, z, heading))
      this.parked.push({ uid: owned.uid, visual })
      this.trackCasters(visual.meshes)
    }
    let tslot = 0
    for (const owned of profile.trailers) {
      if (owned.uid === profile.activeTrailer) continue
      const model = TRAILER_BY_ID[owned.model]
      if (!model) continue
      const x = lot.gate.x + inward * 60
      const z = lot.z + 8 + tslot * 5
      tslot += 1
      if (z > lot.z + lot.d - 6) break
      const visual = buildTrailerVisual(this.host.scene, this.host.frameRoot, model, owned.color, this.host.mats)
      visual.update(this.staticTrailerPose(model, x, this.terrain.heightAt(x, z), z, heading))
      this.parked.push({ uid: owned.uid, visual })
      this.trackCasters(visual.meshes)
    }
  }

  private staticTruckPose(model: TruckModel, x: number, y: number, z: number, heading: number): Parameters<TruckVisual['update']>[0] {
    const wheels = model.axles.flatMap((axle) => [1, -1].map((side) => ({ x: side * model.track / 2, y: model.wheelRadius, z: axle.z, steer: 0, spin: 0, radius: model.wheelRadius, dual: axle.dual, lifted: Boolean(axle.lift) })))
    return { position: { x, y, z }, rotation: { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, wheels, dumpAngle: 0, tailgate: 0, brakeLights: false, reversing: false, headlights: false, load: 0 }
  }

  private staticTrailerPose(model: TrailerModel, x: number, y: number, z: number, heading: number): Parameters<TrailerVisual['update']>[0] {
    const wheels = model.axles.flatMap((az) => [1, -1].map((side) => ({ x: side * 1.0, y: model.wheelRadius, z: az, steer: 0, spin: 0, radius: model.wheelRadius, dual: true, lifted: false })))
    return { position: { x, y, z }, rotation: { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, wheels, landingGear: 1, gooseneck: null, doors: 0, brakeLights: false }
  }

  runLoader(zoneId: string, dt: number, ready: boolean, wantKg: number): number {
    const loader = this.loaders.get(zoneId)
    if (!loader) return 0
    loader.ran = true
    return loader.ai.update(dt, ready, wantKg)
  }

  /** Garage preview: show `look` on the active truck, or put the owned look back (null). */
  previewLook(look: TruckLook | null): void {
    if (this.truckVisual && this.ownedTruck) this.applyLook(look ?? this.ownedTruck.look)
  }

  private applyLook(look: TruckLook): void {
    const visual = this.truckVisual
    if (!visual) return
    const before = [...visual.meshes]
    visual.setLook(look)
    this.untrackCasters(before)
    this.trackCasters(visual.meshes)
    this.lastDumpShown = -1
  }

  /** Puts the rig back at the lot (stuck, flipped or lost). */
  respawn(): void {
    if (!this.truck) return
    const spawn = this.spawnPoint()
    if (this.coupledTrailer) uncouple(this.truck, this.coupledTrailer)
    this.truck.teleport(spawn.x, spawn.z, spawn.heading)
    this.parkingBrake = true
    this.controlling = 'truck'
    this.parkTrailerBehind()
  }

  /** One fixed physics step: controls into the rigs. */
  step(h: number): void {
    const truck = this.truck
    if (!truck) return
    truck.update(h, this.input)
    this.trailer?.update(h)
    this.excavator?.update(h, this.controlling === 'machine' ? this.machineInput : emptyMachineInput())
    if (this.firstStep) {
      this.firstStep = false
      this.input.shiftUp = false
      this.input.shiftDown = false
    }
  }

  private readKeys(): void {
    this.previous.clear()
    for (const a of this.down) this.previous.add(a)
    this.down.clear()
    if (this.host.paused()) return
    const keys = this.host.keys
    for (const [action, codes] of CODES) {
      for (const code of codes) {
        if (keys.has(code)) {
          this.down.add(action)
          break
        }
      }
    }
  }

  private driveControls(dt: number): void {
    const truck = this.truck!
    const input = this.input
    if (this.pressed('parkingBrake')) {
      this.parkingBrake = !this.parkingBrake
      this.events.airBrake()
    }
    if (this.pressed('engineBrake')) this.engineBrake = !this.engineBrake
    if (this.pressed('headlights')) truck.headlights = !truck.headlights
    if (this.pressed('liftAxles')) {
      truck.liftMode = truck.liftMode === 'auto' ? 'down' : truck.liftMode === 'down' ? 'up' : 'auto'
      this.host.toast(`Lift axles: ${truck.liftMode === 'auto' ? 'automatic' : truck.liftMode}`)
    }
    if (this.pressed('horn')) this.events.horn(true)
    else if (!this.down.has('horn') && this.previous.has('horn')) this.events.horn(false)
    const machine = this.controlling === 'machine'
    const w = !machine && this.down.has('throttle')
    const s = !machine && this.down.has('brake')
    const reverse = truck.gear < 0
    const slow = Math.abs(truck.speed) < 0.4
    input.throttle = reverse ? (s ? 1 : 0) : w ? 1 : 0
    input.brake = reverse ? (w ? 1 : 0) : s ? 1 : 0
    if ((reverse ? w : s) && slow) {
      this.reverseHold += dt
      if (this.reverseHold > 0.35) {
        if (reverse) truck.drivetrain.selectDrive(truck.speed, truck.massKg)
        else truck.drivetrain.selectReverse(truck.speed)
        this.reverseHold = 0
      }
    } else this.reverseHold = 0
    input.steer = machine ? 0 : (this.down.has('steerLeft') ? 1 : 0) - (this.down.has('steerRight') ? 1 : 0)
    input.parkingBrake = this.parkingBrake || machine
    input.engineBrake = this.engineBrake
    input.shiftUp = !machine && this.pressed('shiftUp')
    input.shiftDown = !machine && this.pressed('shiftDown')
    if (truck.dump) {
      const raise = this.down.has('dumpRaise') && !machine
      const lower = this.down.has('dumpLower') && !machine
      truck.dump.target = raise ? 1 : lower ? -1 : 0
    }
    const mi = this.machineInput
    if (machine) {
      const keys = this.host.keys
      mi.drive = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
      mi.turn = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0)
      mi.swing = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0)
      mi.boom = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0)
      mi.stick = (keys.has('KeyR') ? 1 : 0) - (keys.has('KeyF') ? 1 : 0)
      mi.bucket = (keys.has('KeyT') ? 1 : 0) - (keys.has('KeyG') ? 1 : 0)
    } else {
      mi.drive = mi.turn = mi.swing = mi.boom = mi.stick = mi.bucket = 0
    }
  }

  /** Coupling, air lines and landing gear outside the keys a procedure step is using. Returns the prompt, if any. */
  private couplingControls(owned: KeyAction | null): string | null {
    const truck = this.truck!
    const trailer = this.trailer
    if (!trailer || this.controlling === 'machine' || truck.model.fifthWheelZ === undefined) return null
    const parked = this.parkingBrake && Math.abs(truck.speed) < 0.3
    const holdGear = (target: 0 | 1) => {
      trailer.gearTarget = this.down.has('landingGear') && owned !== 'landingGear' ? target : trailer.gear
    }
    if (trailer.coupling === 'none') {
      this.uncoupling = false
      const fifth = truck.fifthWheelWorld()
      const kp = trailer.kingpinWorld()
      if (Math.hypot(fifth.x - kp.x, fifth.z - kp.z) > 9) return null
      const check = checkCouple(truck, trailer)
      if (this.pressed('coupler') && owned !== 'coupler') {
        const result = couple(truck, trailer)
        if (!result.ok) this.host.toast(COUPLING_MESSAGES[result.reason ?? 'too-far'], 'warn')
        else this.events.airBrake()
      }
      if (check.ok) return 'Press T to couple the fifth wheel'
      if (check.reason === 'too-far' && check.distance < 3) return `Back under the kingpin — ${check.distance.toFixed(2)} m to go`
      return check.reason ? COUPLING_MESSAGES[check.reason] : null
    }
    if (trailer.tractor !== truck || trailer.coupling !== 'locked') return null
    if (!trailer.neckAttached) return null
    if (this.uncoupling) {
      if (this.pressed('interact') && owned !== 'interact') {
        trailer.lines = true
        this.uncoupling = false
        return null
      }
      if (this.pressed('coupler') && owned !== 'coupler') {
        const result = uncouple(truck, trailer)
        if (result.ok) {
          this.uncoupling = false
          this.events.airBrake()
          this.host.toast('Trailer dropped', 'good')
        } else this.host.toast(COUPLING_MESSAGES[result.reason ?? 'busy'], 'warn')
      }
      return 'Press T to pull the fifth-wheel release · E to reconnect the lines'
    }
    if (!trailer.lines) {
      if (this.pressed('interact') && owned !== 'interact') {
        trailer.lines = true
        this.events.airBrake()
      }
      return 'Press E to connect the air lines and light cord'
    }
    if (trailer.gear > 0.01 && !parked) {
      holdGear(0)
      return trailer.gear > 0.5 ? 'Hold G to crank the landing gear up' : 'Keep holding G — landing gear still down'
    }
    if (parked) {
      if (trailer.gear < 0.99) {
        holdGear(trailer.gear > 0.01 && trailer.gearTarget < trailer.gear ? 0 : 1)
        return trailer.gear > 0.01 ? 'Hold G to wind the landing gear down to drop the trailer' : null
      }
      if (this.pressed('interact') && owned !== 'interact' && !this.zoneUnderTruck()) {
        trailer.lines = false
        this.uncoupling = true
        return null
      }
      return 'Press E to disconnect the air lines to drop the trailer'
    }
    return null
  }

  private zoneUnderTruck(): Zone | null {
    const truck = this.truck
    if (!truck) return null
    const p = truck.pose().position
    for (const zone of this.host.world.zones) {
      if ((zone.kind === 'fuel' || zone.kind === 'service' || zone.kind === 'dealer' || zone.kind === 'wash') && inZone(zone, p.x, p.z, 4)) return zone
    }
    return null
  }

  /** Fuel lanes, the service bay, the dealer desk and your own shop. */
  private zoneControls(owned: KeyAction | null): string | null {
    const truck = this.truck!
    const owner = this.ownedTruck
    if (!owner || this.controlling === 'machine' || Math.abs(truck.speed) > 1) return null
    const profile = this.host.progress.profile
    const p = truck.pose().position
    const zone = this.zoneUnderTruck()
    const lot = this.lot
    const atShop = Boolean(lot && hasService(profile.build) && p.x >= lot.x && p.x <= lot.x + lot.w && p.z >= lot.z && p.z <= lot.z + lot.d)
    const atBay = this.ownWashAt(p.x, p.z) !== null
    if (!zone && !atShop && !atBay) return null
    const press = this.pressed('interact') && owned !== 'interact'
    if (zone?.kind === 'wash' || atBay) {
      const place: WashPlace = atBay ? 'own' : 'public'
      const cost = place === 'own' ? OWN_WASH_WATER : PUBLIC_WASH_PRICE
      if (this.washing || performance.now() < this.washReadyAt) return null
      const dirt = this.dirt?.level ?? owner.dirt
      if (dirt < 3) return place === 'own' ? 'Your wash: the truck is already clean' : 'Truck wash: your truck is already clean'
      if (press) {
        if (cost > profile.cash) this.host.toast(`A wash costs $${cost.toLocaleString()}`, 'warn')
        else {
          this.washing = true
          this.events.startWash(place)
        }
      }
      return `Press E to pressure-wash the truck ($${cost.toLocaleString()} water)`
    }
    const missing = Math.max(0, truck.model.fuelTankL - truck.fuelL)
    const damage = owner.damage
    if (zone?.kind === 'dealer') {
      if (press) this.events.openDealer()
      return `Press E to step inside ${SITE_BY_ID[zone.site]?.name ?? 'the dealership'}`
    }
    if (zone?.kind === 'service' || atShop) {
      const markup = atShop ? 1 : REPAIR_LABOUR_MARKUP
      const repair = Math.round(damage * REPAIR_COST_PER_POINT * markup)
      const fuel = atShop ? Math.round(missing * FUEL_PRICE_PER_L) : 0
      if (press) void this.serviceRig(atShop)
      const washHint = atShop && (this.dirt?.level ?? owner.dirt) >= CLEAN_DIRT_LIMIT && washSpots(profile.build).length === 0 ? ' · Put a pressure washer beside your steel shop to wash the truck here' : ''
      if (repair <= 0 && fuel <= 0) return atShop ? `Your shop: the rig is fuelled and in good shape${washHint}` : 'Service bay: nothing to fix'
      return atShop ? `Press E to fuel and fix up at your shop ($${(repair + fuel).toLocaleString()})${washHint}` : `Press E for repairs ($${repair.toLocaleString()})`
    }
    if (zone?.kind === 'fuel') {
      const cost = Math.round(missing * FUEL_PRICE_PER_L * FUEL_STATION_MARKUP)
      if (press && missing > 1) void this.refuel(missing)
      return missing > 1 ? `Press E to fill up: ${Math.round(missing)} L for $${cost.toLocaleString()}` : 'Tank is full'
    }
    return null
  }

  /** The own-lot wash at truck centre (x, z): a wash bay it stands in, or the nearest pressure washer within `WASHER_REACH_M`. */
  ownWashAt(x: number, z: number): OwnWash | null {
    const lot = this.lot
    if (!lot) return null
    let washer: OwnWash | null = null
    let nearest = Infinity
    for (const item of washSpots(this.host.progress.profile.build)) {
      const f = itemFootprint(item)
      if (item.def === 'wash-bay') {
        if (x >= lot.x + f.x - 1 && x <= lot.x + f.x + f.w + 1 && z >= lot.z + f.z - 1 && z <= lot.z + f.z + f.d + 1) return { kind: 'bay' }
        continue
      }
      const cx = lot.x + f.x + f.w / 2
      const cz = lot.z + f.z + f.d / 2
      const distance = Math.hypot(x - cx, z - cz)
      if (distance <= WASHER_REACH_M && distance < nearest) {
        nearest = distance
        washer = { kind: 'washer', reel: { x: cx, y: this.terrain.heightAt(cx, cz) + 1.12, z: cz } }
      }
    }
    return washer
  }

  /** The destination picked on the map (null clears it); the minimap shows the road route to it until the rig gets there. */
  setWaypoint(point: { x: number; z: number } | null): void {
    this.picked = point ? { x: point.x, z: point.z } : null
    this.routeTimer = 2
    const p = this.truck?.pose().position
    this.routePoints = point && p ? route(p.x, p.z, point.x, point.z).points : null
    if (!point) this.routeTimer = 0
  }

  /** The GPS route the minimap shows (to the picked waypoint, else the job's next stop). */
  get route(): readonly [number, number][] | null {
    return this.routePoints
  }

  get waypoint(): { x: number; z: number } | null {
    return this.picked
  }

  /** The own-lot wash where the truck stands now, or null. */
  ownWash(): OwnWash | null {
    const p = this.truck?.pose().position
    return p ? this.ownWashAt(p.x, p.z) : null
  }

  private refreshDirt(): void {
    const owner = this.ownedTruck
    const truck = this.truck
    if (!this.dirt || !owner || !truck || this.washing) return
    const fresh = this.host.progress.profile.trucks.find((t) => t.uid === owner.uid)
    const unsent = Math.max(0, truck.odometerM - this.sentOdometerM) / 1000
    this.dirt.setDirt((fresh?.dirt ?? owner.dirt) + unsent * DIRT_PER_KM)
  }

  /** The active truck's grime, for the wash. */
  get dirtLayer(): DirtLayer | null {
    return this.dirt
  }

  /** The middle of the active truck, bumper to frame end (the wash camera's target). */
  truckCentre(): { x: number; y: number; z: number } {
    const truck = this.truck
    if (!truck) return { x: 0, y: 0, z: 0 }
    const pose = truck.pose()
    const layout = this.truckVisual?.layout
    const along = layout ? (layout.bumperZ + layout.frameRearZ) / 2 : 0
    const heading = headingOf(pose.rotation)
    return { x: pose.position.x + Math.sin(heading) * along, y: pose.position.y, z: pose.position.z + Math.cos(heading) * along }
  }

  /** Records a finished wash: syncs the trip first so the grime it adds is counted, then sends the `wash` action. */
  async finishWash(place: WashPlace, cleaned: number): Promise<void> {
    const owner = this.ownedTruck
    try {
      if (!owner || cleaned <= 0.01) {
        this.host.toast('No water used: the wash is free when nothing comes off', 'info')
        return
      }
      await this.syncOdometer()
      const result = await this.host.progress.act({ action: 'wash', uid: owner.uid, cleaned, place })
      this.host.toast(result.message || (result.ok ? 'Washed' : 'Could not wash'), result.ok ? 'good' : 'warn')
    } finally {
      this.washing = false
      this.washReadyAt = performance.now() + 1500
      this.dirt?.resetMud()
      this.refreshDirt()
    }
  }

  private async syncOdometer(): Promise<void> {
    const truck = this.truck
    const owner = this.ownedTruck
    if (!truck || !owner) return
    const km = (truck.odometerM - this.sentOdometerM) / 1000
    const fuel = truck.fuelUsedL - this.sentFuelL
    if (km < 0.02 && fuel < 0.05) return
    this.sentOdometerM = truck.odometerM
    this.sentFuelL = truck.fuelUsedL
    await this.host.progress.act({ action: 'odometer', uid: owner.uid, km: Math.min(200, km), fuelUsedL: Math.min(Math.max(0, fuel), Math.max(1, km)) })
  }

  private async refuel(litres: number): Promise<void> {
    const owner = this.ownedTruck
    if (!owner || !this.truck) return
    await this.syncOdometer()
    const fresh = this.host.progress.profile.trucks.find((t) => t.uid === owner.uid)
    const room = fresh ? Math.max(0, (TRUCK_BY_ID[fresh.model]?.fuelTankL ?? 0) - fresh.fuelL) : litres
    const amount = Math.min(litres, room)
    if (amount <= 0.5) return
    const result = await this.host.progress.act({ action: 'refuel', uid: owner.uid, litres: Math.round(amount * 10) / 10 })
    if (result.ok && this.truck) {
      const after = result.profile.trucks.find((t) => t.uid === owner.uid)
      if (after) this.truck.fuelL = after.fuelL
      this.host.toast(result.message || 'Tank filled', 'good')
    } else this.host.toast(result.message, 'warn')
  }

  private async serviceRig(atShop: boolean): Promise<void> {
    const owner = this.ownedTruck
    if (!owner || !this.truck) return
    if (owner.damage > 0) {
      const result = await this.host.progress.act({ action: 'repair', uid: owner.uid })
      this.host.toast(result.message || (result.ok ? 'Repaired' : 'Could not repair'), result.ok ? 'good' : 'warn')
    }
    if (atShop) {
      const missing = Math.max(0, this.truck.model.fuelTankL - this.truck.fuelL)
      if (missing > 1) await this.refuel(missing)
    }
  }

  private async completeJob(): Promise<void> {
    const runner = this.runner
    if (!runner || this.completing) return
    this.completing = true
    await this.syncOdometer()
    const result = await this.host.progress.act({ action: 'complete-job', job: runner.job.id, damage: runner.damage })
    this.completing = false
    if (result.ok) {
      const pay = result.paid ? result.paid.pay : result.delta
      this.events.jobDone(result.message || 'Delivered', pay)
      this.trailerCargo = null
    } else this.host.toast(result.message || 'The delivery could not be recorded. Try again in a moment.', 'warn')
  }

  private fit(): RigFit {
    const truck = this.truck
    if (!truck) return { haul: null, capacityKg: 0, loadedKg: 0 }
    const coupled = this.coupledTrailer
    const haul = haulFor(truck.model, coupled ? coupled.model : null)
    if (truck.dump) return { haul, capacityKg: truck.model.dump?.capacityKg ?? 0, loadedKg: truck.dump.loadKg }
    return { haul, capacityKg: coupled?.model.maxPayloadKg ?? 0, loadedKg: coupled?.payloadKg ?? 0 }
  }

  private updateLoaders(dt: number): void {
    for (const [id, loader] of this.loaders) {
      if (!loader.ran) loader.ai.update(dt, false, 0)
      loader.ran = false
      const arm = loader.ai.armPose()
      const zone = loader.zone
      const eq = zone.equipment ?? { x: zone.x, z: zone.z + 12, heading: zone.heading }
      const y = this.terrain.heightAt(eq.x, eq.z)
      const rotation = { x: 0, y: Math.sin(eq.heading / 2), z: 0, w: Math.cos(eq.heading / 2) }
      let machine: ExcavatorPose | LoaderPose
      if (loader.ai.kind === 'excavator') {
        machine = { position: { x: eq.x, y, z: eq.z }, rotation, swing: arm.swing, boom: arm.boom, stick: arm.stick, bucket: arm.bucket, trackL: 0, trackR: 0 }
      } else {
        const reach = 9 * arm.travel
        const fx = Math.sin(eq.heading)
        const fz = Math.cos(eq.heading)
        machine = { position: { x: eq.x + fx * reach, y, z: eq.z + fz * reach }, rotation, arm: arm.arm, bucket: arm.bucket, spin: reach / 0.8, steer: 0 }
      }
      const current = this.activity.get(id)
      const phase = arm.phase === 'idle' || arm.phase === 'waiting' ? (current?.phase ?? 'idle') : 'loading'
      this.activity.set(id, { phase, progress: arm.progress, machine, flow: arm.phase === 'dump' ? 1 : 0 })
    }
  }

  private updateVisuals(): void {
    const truck = this.truck
    if (truck && this.truckVisual) {
      this.truckVisual.update(truck.pose())
      if (truck.dump) {
        const fill = truck.dump.loadKg / Math.max(1, truck.model.dump?.capacityKg ?? 1)
        if (Math.abs(fill - this.lastDumpShown) > 0.004) {
          this.lastDumpShown = fill
          const material = truck.dump.material
          this.truckVisual.setLoad(fill, material ? CARGO_BY_ID[material]?.color ?? '#8d877d' : null)
        }
      }
    }
    const trailer = this.trailer
    if (trailer && this.trailerVisual) {
      this.trailerVisual.update(trailer.pose())
      const cargo = this.trailerCargo ? CARGO_BY_ID[this.trailerCargo] : null
      const fill = trailer.payloadKg / Math.max(1, trailer.model.maxPayloadKg)
      if (Math.abs(fill - this.lastPayloadShown) > 0.004) {
        this.lastPayloadShown = fill
        this.trailerVisual.setCargo(cargo && fill > 0 && cargo.visual !== 'excavator' ? { visual: cargo.visual, fill, color: cargo.color } : null)
      }
      const status = this.view.steps
      const active = status ? status.steps[status.active] : null
      const runner = this.runner
      if (runner && (runner.job.haul === 'flatbed' || runner.job.haul === 'lowboy')) {
        const total = runner.job.haul === 'flatbed' ? strapCount(runner.job.massKg) : 4
        let done = runner.loaded ? total : 0
        if (active && (active.id === 'straps' || active.id === 'chains')) done = runner.stage === 'loading' ? Math.floor(active.progress * total + 1e-6) : total - Math.floor(active.progress * total + 1e-6)
        if (runner.stage === 'unloading' && status && status.active > 3) done = 0
        this.trailerVisual.setStraps(done, total)
      } else this.trailerVisual.setStraps(0, 0)
    }
    if (this.excavator && this.machineVisual) this.machineVisual.update(this.excavator.pose())
  }

  private updateParked(): void {
    const lot = this.lot
    const truck = this.truck
    if (!lot || !truck) return
    const p = truck.pose().position
    const d = Math.hypot(p.x - (lot.x + lot.w / 2), p.z - (lot.z + lot.d / 2))
    if (!this.parkedShown && d < PARKED_SHOW) this.showParked()
    else if (this.parkedShown && d > PARKED_HIDE) this.rebuildParked()
  }

  private placeName(x: number, z: number): string {
    const lot = this.lot
    if (lot && x >= lot.x && x <= lot.x + lot.w && z >= lot.z && z <= lot.z + lot.d) return `${this.host.progress.profile.company} — your lot`
    for (const site of SITES) if (site.kind !== 'lotDistrict' && site.kind !== 'town' && inRect(site, x, z, 25)) return site.name
    const town = SITE_BY_ID.town
    if (town && inRect(town, x, z)) return town.name
    const road = this.terrain.roadAt(x, z)
    if (road && road.distance < road.half + 6) return road.road.name
    return 'Open country'
  }

  /** Runs everything for one rendered frame. `stepPhysics` must step the world, calling `before(h)` once per fixed step. */
  frame(dt: number, stepPhysics: (before: (h: number) => void) => void): SessionView {
    const truck = this.truck
    const view = this.view
    if (!truck || this.disposed) return view
    this.readKeys()
    this.driveControls(dt)
    this.firstStep = true
    stepPhysics(this.stepHook)
    if (this.deckHydraulic !== this.deckTarget) {
      const delta = this.deckTarget - this.deckHydraulic
      this.deckHydraulic += Math.sign(delta) * Math.min(Math.abs(delta), dt / 2.5)
    }
    const runner = this.runner
    const pose = truck.pose()
    const px = pose.position.x
    const pz = pose.position.z
    const heading = headingOf(pose.rotation)
    let owned: KeyAction | null = null
    let steps: ProcedureStatus | null = null
    let blocker = ''
    if (runner && runner.stage !== 'complete') {
      if (runner.job.haul === 'lowboy' && runner.stage === 'toPickup') {
        const d = Math.hypot(px - runner.pickup.x, pz - runner.pickup.z)
        if (d < 400) this.ensureExcavator(runner.pickup)
      }
      owned = runner.procedure ? keyOf(runner.procedure.activeHint) : null
      const target = runner.target()
      this.ctx.refresh(target, runner.job)
      const point = this.coupledTrailer ? this.ctx.trailer?.center ?? { x: px, z: pz } : { x: px, z: pz }
      const frameResult = runner.update(runner.stage === 'loading' || runner.stage === 'unloading' || Math.hypot(point.x - target.x, point.z - target.z) < 75 ? this.ctx : null, point, this.fit(), dt)
      steps = frameResult.status
      blocker = frameResult.blocker
      const act = runner.activity()
      if (act) {
        const existing = this.activity.get(target.id)
        this.activity.set(target.id, { ...existing, phase: act.phase, progress: act.progress })
      }
      if (frameResult.stage === 'complete') void this.completeJob()
    } else if (runner && runner.stage === 'complete' && this.excavator) {
      const mp = this.excavator.pose().position
      if (Math.hypot(mp.x - px, mp.z - pz) > 250) this.despawnExcavator()
    }
    this.updateLoaders(dt)
    const couplingPrompt = this.couplingControls(owned)
    const zonePrompt = this.zoneControls(owned)
    if (this.controlling === 'machine' && this.excavator) {
      const mp = this.excavator.pose().position
      if (Math.hypot(mp.x - px, mp.z - pz) > MACHINE_REACH * 2) this.controlling = 'truck'
    }
    this.updateVisuals()
    this.updateParked()
    this.dirtTimer += dt
    if (this.dirtTimer > 1) {
      this.dirtTimer = 0
      this.refreshDirt()
    }
    this.odometerTimer += dt
    if (this.odometerTimer > ODOMETER_SECONDS) {
      this.odometerTimer = 0
      void this.syncOdometer()
    }
    if (truck.fuelL <= 0.01) {
      this.outOfFuel += dt
      if (this.outOfFuel > 3) {
        this.outOfFuel = -30
        this.host.toast('Out of fuel: roadside service brought 60 L', 'warn')
        void this.refuel(60)
      }
    } else if (this.outOfFuel > 0) this.outOfFuel = 0
    this.placeTimer -= dt
    if (this.placeTimer <= 0) {
      this.placeTimer = 0.5
      this.place = this.placeName(px, pz)
    }
    this.routeTimer -= dt
    const target = runner && runner.stage !== 'complete' ? runner.target() : null
    if (this.picked && Math.hypot(this.picked.x - px, this.picked.z - pz) < WAYPOINT_ARRIVE_M) {
      this.picked = null
      this.routeTimer = 0
      this.host.toast('You have arrived', 'good')
    }
    const goal = this.picked ?? target
    if (goal && this.routeTimer <= 0) {
      this.routeTimer = 2
      const path = route(px, pz, goal.x, goal.z)
      this.routePoints = path.points
      this.routeLength = this.picked ? 0 : path.length
    } else if (!goal) {
      this.routePoints = null
      this.routeLength = 0
    }
    const g = view.gauges
    g.speedKph = Math.abs(truck.speedKph)
    g.rpm = truck.rpm
    g.gear = truck.gear
    g.automatic = truck.drivetrain.automatic
    g.fuelL = truck.fuelL
    g.fuelMaxL = truck.model.fuelTankL
    g.damage = this.ownedTruck?.damage ?? 0
    g.parkingBrake = this.parkingBrake
    g.engineBrake = this.engineBrake
    view.engineLoad = this.input.throttle
    view.reversing = truck.gear < 0
    view.hydraulic = truck.dump ? Math.abs(truck.dump.target) * (truck.dump.target !== 0 ? 1 : 0) : 0
    view.controlling = this.controlling
    view.place = this.place
    view.steps = steps
    view.route = this.routePoints
    if (runner && target) {
      const cargo = CARGO_BY_ID[runner.job.cargo]
      const bearing = Math.atan2(target.x - px, target.z - pz)
      const job = view.job ?? { cargo: '', massKg: 0, from: '', to: '', distanceKm: 0, pay: 0, arrowRad: 0 }
      job.cargo = cargo?.name ?? runner.job.cargo
      job.massKg = runner.job.massKg
      job.from = SITE_BY_ID[runner.pickup.site]?.name ?? runner.pickup.label
      job.to = SITE_BY_ID[runner.drop.site]?.name ?? runner.drop.label
      job.distanceKm = (this.routeLength || Math.hypot(target.x - px, target.z - pz)) / 1000
      job.pay = runner.job.pay
      job.arrowRad = -headingDelta(bearing, heading)
      view.job = job
      view.target = { x: target.x, z: target.z, label: target.label }
    } else {
      view.job = null
      view.target = null
    }
    let prompt: string | null = null
    if (steps?.message) prompt = steps.message
    else if (blocker && runner && Math.hypot(px - runner.pickup.x, pz - runner.pickup.z) < 120) prompt = blocker
    else prompt = couplingPrompt ?? zonePrompt
    if (!prompt && this.controlling === 'machine') prompt = 'Excavator: W/S/A/D tracks · arrows swing and boom · R/F stick · T/G bucket'
    if (!prompt && this.parkingBrake && this.input.throttle > 0 && this.controlling === 'truck') prompt = 'Release the parking brake (Space)'
    if (!prompt && this.trailer && this.coupledTrailer && this.trailer.gear > 0.2 && Math.abs(truck.speed) > 1) prompt = 'Landing gear is down! Hold G to raise it'
    view.prompt = prompt
    return view
  }

  private readonly stepHook = (h: number) => this.step(h)

  /** What the chase and cab cameras follow. */
  followSubject(out: FollowSubject): FollowSubject {
    const truck = this.truck
    if (this.controlling === 'machine' && this.excavator) {
      const p = this.excavator.pose()
      out.x = p.position.x
      out.y = p.position.y
      out.z = p.position.z
      out.heading = headingOf(p.rotation)
      out.span = 7
      out.eye.x = p.position.x
      out.eye.y = p.position.y + 2.6
      out.eye.z = p.position.z
      out.speed = this.excavator.speed
      return out
    }
    if (!truck || !this.truckModel) return out
    const pose = truck.pose()
    out.x = pose.position.x
    out.y = pose.position.y
    out.z = pose.position.z
    out.heading = headingOf(pose.rotation)
    const m = this.truckModel
    const trailer = this.coupledTrailer
    out.span = m.frontZ - m.rearZ + (trailer ? trailer.model.frontZ - trailer.model.rearZ - 2 : 0)
    if (trailer) {
      const tp = trailer.pose().position
      out.x = (out.x * 2 + tp.x) / 3
      out.z = (out.z * 2 + tp.z) / 3
    }
    const eye = toWorld(pose, driverEye(m), out.eye as Vec3)
    out.eye.x = eye.x
    out.eye.y = eye.y
    out.eye.z = eye.z
    out.speed = truck.speed
    return out
  }

  /** The work-zone equipment activity map for `WorkZones.update` and the zones to highlight. */
  zoneActivity(): ReadonlyMap<string, WorkZoneActivity> {
    return this.activity
  }

  highlightZones(out: Set<string>): Set<string> {
    out.clear()
    const runner = this.runner
    if (runner && runner.stage !== 'complete') {
      out.add(runner.pickup.id)
      out.add(runner.drop.id)
    }
    return out
  }

  rigPosition(): { x: number; z: number; heading: number } {
    const truck = this.truck
    if (!truck) return { x: 0, z: 0, heading: 0 }
    const pose = truck.pose()
    return { x: pose.position.x, z: pose.position.z, heading: headingOf(pose.rotation) }
  }

  /** Can the active rig take this job (the job board's Accept button)? */
  canTake(job: { haul: string; massKg: number }): string | null {
    const truck = this.truckModel
    if (!truck) return 'No truck'
    if (job.haul === 'dump') {
      if (!truck.dump) return 'Needs a dump truck'
      return job.massKg > (truck.dump.capacityKg ?? 0) ? 'Needs a bigger dump body' : null
    }
    if (!truck.fifthWheelZ) return 'Needs a semi-truck'
    const trailer = this.trailerModel
    if (!trailer || trailer.kind !== job.haul) return `Needs a ${job.haul === 'lowboy' ? 'lowboy' : job.haul === 'grain' ? 'grain hopper' : job.haul} trailer selected`
    if (job.massKg > trailer.maxPayloadKg) return 'Too heavy for your trailer'
    return null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    void this.syncOdometer()
    this.rebuildParked()
    this.despawnExcavator()
    if (this.trailerVisual) this.trailerVisual.dispose()
    this.dirt?.dispose()
    this.dirt = null
    if (this.truckVisual) this.truckVisual.dispose()
    for (const mesh of this.casters) this.host.removeCaster(mesh)
    this.casters.length = 0
    if (this.trailer && this.truck && this.trailer.tractor === this.truck) uncouple(this.truck, this.trailer)
    this.trailer?.dispose()
    this.truck?.dispose()
    this.trailer = null
    this.truck = null
  }
}
