/**
 * The Fox Lake Freight fleet: the long-nose tractor, the tandem dump truck and the four semi-trailers, parked at the
 * yard as company rigs anyone can drive (they are not in the player's garage). T couples or drops a trailer: the
 * tractor's fifth wheel takes the nearest semi-trailer kingpin within reach (the pickup takes the utility trailer the
 * same way); B raises or lowers the dump body, which tips on its rear hinge at about 10 degrees a second. A load
 * shows on the trailer (lumber, steel, pallets, logs) or heaped in the dump body, and adds its weight.
 */
import type { Cars, Car } from '../town/Cars'
import type { Vehicle } from '../fp/physics/Vehicle'
import { TUNING } from '../../maplestreet/shared/Vehicles'
import { isSemiTrailer } from '../../maplestreet/shared/FleetVehicles'
import { YARD, type FreightCargo, type FreightJob } from '../../maplestreet/shared/Freight'
import type { CargoKind } from '../fp/physics/TrailerModels'

/** Where the fleet parks in the yard (town coordinates, yaw 0 faces +x, east toward the gate). */
const PARKING: { kind: string; x: number; z: number; yaw: number }[] = [
  { kind: 'semi', x: 44, z: 594, yaw: 0 },
  { kind: 'dumptruck', x: 26, z: 606, yaw: 0 },
  { kind: 'dryvan', x: 18, z: 584, yaw: 0 },
  { kind: 'flatbed', x: 19, z: 589.5, yaw: 0 },
  { kind: 'logger', x: 21, z: 595, yaw: 0 },
  { kind: 'tanker', x: 21, z: 600.5, yaw: 0 },
]

const COUPLE_REACH = 9
const DUMP_RATE = 0.18

const CARGO_VIEW: Partial<Record<FreightCargo, CargoKind>> = { lumber: 'lumber', steel: 'steel', pallets: 'pallets', logs: 'logs', gravel: 'gravel' }

export class Fleet {
  private dumpTarget = 0
  private dumpNow = 0
  private loaded: { car: Car; cargo: FreightCargo } | null = null

  constructor(private readonly cars: Cars, private readonly toast: (text: string) => void) {}

  get dump(): number {
    return this.dumpNow
  }

  spawn(): void {
    for (const p of PARKING) {
      if (this.cars.list.has(p.kind)) continue
      const car = this.cars.add(p.kind, p.x, p.z, p.yaw, null)
      this.cars.parkVehicle(car.fp, p.x, p.z, p.yaw)
      this.cars.sync(car)
    }
  }

  /** The fleet's own vehicles never go home with the player's cars. */
  static isFleet(kind: string): boolean {
    return PARKING.some(p => p.kind === kind)
  }

  /** T: couple the nearest trailer to the truck you're driving, or drop the one you have. */
  toggleHitch(): void {
    const car = this.cars.driving()
    const v = car?.fp
    if (!v || !v.preset.hitch) return
    if (v.trailer) {
      if (Math.abs(v.speed) > 1.5) return this.toast('Stop before you drop the trailer.')
      const name = TUNING[v.trailer.kind]?.label ?? 'trailer'
      v.unhitch()
      this.toast(`${name} dropped. Its landing gear is down and its brakes are set.`)
      return
    }
    const semi = (v.kind as string) === 'semi'
    let best: Vehicle | null = null
    let bd = semi ? COUPLE_REACH : 3.5
    const hitch = v.localToWorld(v.preset.hitch.x, v.preset.hitch.y, 0)
    for (const c of this.cars.list.values()) {
      const t = c.fp
      if (t === v || !t.preset.tongue || t.towedBy) continue
      if (semi !== isSemiTrailer(t.kind)) continue
      const pin = t.localToWorld(t.preset.tongue.x, t.preset.tongue.y, 0)
      const d = Math.hypot(pin.x - hitch.x, pin.z - hitch.z)
      if (d < bd) {
        bd = d
        best = t
      }
    }
    if (!best) return this.toast(semi ? 'Back the fifth wheel under a trailer\'s kingpin, then press T.' : 'Back the hitch up to a trailer tongue, then press T.')
    v.hitch(best)
    this.toast(`${TUNING[best.kind]?.label ?? 'Trailer'} coupled. Landing gear up, air lines on.`)
  }

  /** B: raise or lower the dump body (the dump truck only). */
  toggleDump(): void {
    const car = this.cars.driving()
    if (car?.kind !== 'dumptruck') return
    this.dumpTarget = this.dumpTarget > 0.5 ? 0 : 1
    this.toast(this.dumpTarget ? 'Raising the body…' : 'Lowering the body…')
  }

  /** What you're driving can carry `job` right now: the dump truck, or the tractor with the job's trailer coupled. */
  rigFor(job: FreightJob): Car | null {
    const car = this.cars.driving()
    if (!car) return null
    if (job.rig === 'dumptruck') return car.kind === 'dumptruck' ? car : null
    if (car.kind !== 'semi' || (car.fp.trailer?.kind as string | undefined) !== job.rig) return null
    return this.cars.list.get(job.rig) ?? null
  }

  /** Puts a job's load on (or takes it off) the truck or trailer carrying it: the visible load and its weight. */
  setLoad(job: FreightJob | null): void {
    if (this.loaded) {
      this.loaded.car.fp.view.setCargo?.(null)
      this.loaded.car.fp.setLoad(0)
      this.loaded = null
    }
    if (!job || job.stage !== 'toDrop') return
    const car = this.cars.list.get(job.rig === 'dumptruck' ? 'dumptruck' : job.rig)
    if (!car) return
    car.fp.view.setCargo?.(CARGO_VIEW[job.cargo] ?? null)
    car.fp.setLoad(job.mass)
    this.loaded = { car, cargo: job.cargo }
  }

  update(dt: number): void {
    const step = DUMP_RATE * dt
    this.dumpNow += Math.max(-step * 1.4, Math.min(step, this.dumpTarget - this.dumpNow))
    const truck = this.cars.list.get('dumptruck')
    truck?.fp.view.setDump?.(this.dumpNow)
  }

  /** The body is lowered again (after a dump, or if you drive off). */
  lowerDump(): void {
    this.dumpTarget = 0
  }

  /** Sends every fleet vehicle that has wandered (not driven, not coupled) back to its bay. */
  returnToYard(): void {
    const driving = this.cars.driving()
    for (const p of PARKING) {
      const car = this.cars.list.get(p.kind)
      if (!car || car === driving || car.fp.towedBy === driving?.fp || car.fp.trailer) continue
      const pos = car.fp.position
      if (pos.x > YARD.x0 && pos.x < YARD.x1 && pos.z > YARD.z0 && pos.z < YARD.z1) continue
      this.cars.parkVehicle(car.fp, p.x, p.z, p.yaw)
      this.cars.sync(car)
    }
  }
}
