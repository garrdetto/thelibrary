/**
 * Your Fox Plains vehicles in Fox Lake: the same Rapier raycast cars as Fox
 * Plains (fp/physics/Vehicle.ts, same numbers, so they handle identically),
 * driven through Rack & Reel's vehicle controller as host-world vehicles.
 * Rack & Reel seats the hunter, follows with its camera and runs the HUD; a
 * stand-in node (unmirrored, in scene coordinates) follows each car so the
 * hunter sits upright in it.
 */
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { DriveInput, ExternalDriver, Vehicle as RrVehicle, VehicleController } from '../../rackreel/systems/VehicleController'
import { Vehicle } from '../fp/physics/Vehicle'
import type { Physics } from '../fp/physics/Physics'
import type { VehicleModels } from '../fp/physics/VehicleModels'
import { Parking, type Footprint } from '../fp/physics/Parking'
import { STARTER_TRUCK, VEHICLES } from '../../maplestreet/shared/Economy'
import { TUNING } from '../../maplestreet/shared/Vehicles'
import type { Account } from '../../maplestreet/shared/Economy'
import type { LotDef } from '../../maplestreet/shared/WorldLayout'
import type { VehicleKind, VehicleSnap } from '../../maplestreet/shared/Protocol'

export interface Car {
  kind: string
  fp: Vehicle
  rr: RrVehicle
  seat: TransformNode
}

const _f = new Vector3()

export class Cars implements ExternalDriver {
  readonly list = new Map<string, Car>()
  private readonly byRr = new Map<RrVehicle, Car>()
  private readonly parking: Parking
  onImpact: ((kind: string, dv: number, at: { x: number; y: number; z: number }) => void) | null = null

  constructor(private readonly scene: Scene, private readonly physics: Physics, private readonly models: VehicleModels, private readonly controller: VehicleController) {
    this.parking = new Parking(physics)
  }

  /** The car the player is driving, if it is one of these. */
  driving(): Car | null {
    const active = this.controller.active
    if (!active || active.kind !== 'CAR') return null
    for (const c of this.list.values()) if (c.rr === active) return c
    return null
  }

  add(kind: string, x: number, z: number, yaw: number, account: Account | null): Car {
    const owned = account?.garage.includes(kind as VehicleKind) ? account.cars[kind as VehicleKind] ?? null : null
    const fp = new Vehicle(this.physics, this.models, kind, kind, { x, y: 0, z }, yaw, owned)
    fp.setCar(owned)
    fp.onImpact = (dv, at) => this.onImpact?.(kind, dv, at)
    const seat = new TransformNode(`car-seat-${kind}`, this.scene)
    seat.rotationQuaternion = new Quaternion()
    const P = TUNING[kind] ?? TUNING.sedan
    const s = P.seat ?? { x: 0, y: 0.4, z: -0.4 }
    const label = VEHICLES[kind]?.name ?? P.label ?? 'car'
    const rr = this.controller.addExternal(seat, this, new Vector3(), 0, new Vector3(s.z, s.y + 0.1, s.x), new Vector3(-(P.chassis.hz + 0.9), 0, 0), label)
    const car: Car = { kind, fp, rr, seat }
    this.list.set(kind, car)
    this.byRr.set(rr, car)
    this.sync(car)
    return car
  }

  remove(kind: string): void {
    const car = this.list.get(kind)
    if (!car) return
    this.controller.remove(car.rr)
    this.byRr.delete(car.rr)
    car.fp.dispose()
    car.seat.dispose()
    this.list.delete(kind)
  }

  clear(): void {
    for (const kind of [...this.list.keys()]) this.remove(kind)
  }

  /** Rack & Reel's controller drives a car for one frame: input goes to the car (its pose was synced after this frame's physics). */
  step(_dt: number, input: DriveInput, v: RrVehicle): void {
    if (!v.occupied) return
    const car = this.byRr.get(v)
    if (car) car.fp.input = { throttle: input.throttle, steer: -input.steer, brake: 0, handbrake: input.brake }
  }

  park(v: RrVehicle): void {
    const car = this.byRr.get(v)
    if (car) car.fp.input = { throttle: 0, steer: 0, brake: 1, handbrake: true }
  }

  /** Copies the car's interpolated pose into its Rack & Reel record and seat stand-in. */
  sync(car: Car): void {
    const root = car.fp.root
    root.computeWorldMatrix(true)
    const p = root.getAbsolutePosition()
    const f = car.fp.forward(_f)
    const fx = f.x
    const fz = -f.z
    const heading = Math.atan2(fx, fz)
    const pitch = -Math.asin(Math.max(-1, Math.min(1, f.y)))
    const v = car.rr
    v.position.copyFrom(p)
    v.heading = heading
    v.pitch = pitch
    v.roll = 0
    v.speed = car.fp.speed
    car.seat.position.copyFrom(p)
    Quaternion.FromEulerAnglesToRef(pitch, heading, 0, car.seat.rotationQuaternion!)
  }

  /** After each render-interpolation: keep every car's record and stand-in on its body. */
  syncAll(): void {
    for (const c of this.list.values()) this.sync(c)
  }

  visuals(night: number): void {
    const d = this.driving()
    for (const c of this.list.values()) c.fp.updateVisuals(night, c === d && (c.fp.input.handbrake || (c.fp.input.throttle < 0 && c.fp.speed > 0.5)))
  }

  /** Parks the starter truck and trailer at a lot's driveway and the rest of the garage beside them. */
  parkAtHome(lot: LotDef): void {
    const dir = lot.front === '+z' ? 1 : -1
    const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z
    const yaw = dir > 0 ? -Math.PI / 2 : Math.PI / 2
    const reserved: Footprint[] = []
    let slot = 0
    for (const [kind, car] of this.list) {
      if (car === this.driving()) continue
      if (kind === STARTER_TRUCK) this.parkVehicle(car.fp, lot.x + 4, frontZ - dir * 4.5, yaw, reserved)
      else if (kind !== 'trailer') this.parkVehicle(car.fp, lot.x + 8.6 + slot++ * 3.4, frontZ - dir * 5.5, yaw, reserved)
    }
    const trailer = this.list.get('trailer')
    if (trailer) this.parkVehicle(trailer.fp, lot.x + 4, frontZ - dir * 12, yaw, reserved)
    this.syncAll()
  }

  parkVehicle(v: Vehicle, x: number, z: number, yaw: number, reserved: Footprint[] = []): void {
    v.towedBy?.unhitch()
    v.unhitch()
    const c = v.preset.chassis
    const spot = this.parking.find({ x, z, yaw, hx: c.hx, hz: c.hz }, c.hy * 2 + v.preset.suspension.rest, [v.body], reserved)
    v.place(spot.x, spot.z, spot.yaw)
    reserved.push(spot)
  }

  /** The vehicle snapshots the shared world relays (your cars as everyone else sees them). */
  snapshots(me: string): VehicleSnap[] {
    const out: VehicleSnap[] = []
    for (const c of this.list.values()) out.push({ ...c.fp.snapshot(me), id: `${me}:${c.fp.id}`, hitchedTo: c.fp.towedBy ? `${me}:${c.fp.towedBy.id}` : null })
    return out.slice(0, 3)
  }

  /** Paint and condition from the account (after a body-shop visit or a purchase). */
  restyle(account: Account): void {
    for (const [kind, c] of this.list) {
      const car = account.garage.includes(kind as VehicleKind) ? account.cars[kind as VehicleKind] ?? null : null
      c.fp.restyle(car)
      c.fp.setCar(car)
    }
  }

  focusPoints(out: { x: number; z: number }[]): void {
    for (const c of this.list.values()) {
      const p = c.fp.position
      out.push({ x: p.x, z: p.z })
    }
  }

  dispose(): void {
    this.clear()
  }
}
