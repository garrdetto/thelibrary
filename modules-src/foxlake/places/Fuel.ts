/**
 * Fuel for your Fox Lake vehicles, kept like classic Fox Plains: the shared
 * world holds each tank (Account.fuel); the page burns it as you drive
 * (fp Vehicle.setFuel), reports what was burned every few seconds (the
 * authority only lets levels go down), and fills up at a pump: Gas & Go in
 * Fox Plains, or Kwik Trip, Mobil and the BP in Montello. A car that runs dry
 * can be towed to the nearest pump.
 */
import type { Account } from '../../maplestreet/shared/Economy'
import { FUEL_PRICE, FUEL_SCALE, VEHICLES } from '../../maplestreet/shared/Economy'
import type { ClientMsg, VehicleKind } from '../../maplestreet/shared/Protocol'
import { GAS_STATION, PUMP_RADIUS } from '../../maplestreet/shared/WorldLayout'
import { MONTELLO_PUMPS, MONTELLO_SHOPS } from '../../maplestreet/shared/MontelloPlaces'
import type { Car, Cars } from '../town/Cars'

const REPORT_EVERY = 5
const LOW_SHARE = 0.15

export interface Pump {
  x: number
  z: number
  station: string
  /** Which side of the pump island a car parks on (town frame). */
  side: number
}

/** Every pump in Fox Lake's shared world, in the town frame. */
export const PUMPS: readonly Pump[] = (() => {
  const out: Pump[] = GAS_STATION.pumps.map((p) => ({ x: p.x, z: p.z, station: GAS_STATION.name, side: Math.sign(p.x - GAS_STATION.canopy.x) || 1 }))
  const groups: { x: number; z: number; pumps: { x: number; z: number }[] }[] = []
  for (const p of MONTELLO_PUMPS) {
    const g = groups.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 40)
    if (g) g.pumps.push(p)
    else groups.push({ x: p.x, z: p.z, pumps: [p] })
  }
  for (const g of groups) {
    const cx = g.pumps.reduce((s, p) => s + p.x, 0) / g.pumps.length
    const station = MONTELLO_SHOPS.filter((s) => s.kind === 'gas').sort((a, b) => Math.hypot(a.x - cx, a.z - g.z) - Math.hypot(b.x - cx, b.z - g.z))[0]?.name ?? 'the station'
    for (const p of g.pumps) out.push({ x: p.x, z: p.z, station, side: Math.sign(p.x - cx) || 1 })
  }
  return out
})()

export interface FuelHooks {
  cars: Cars
  send(m: ClientMsg): void
  account(): Account | null
  toast(text: string, kind?: '' | 'warn'): void
}

export class Fuel {
  private readonly server: Partial<Record<string, number>> = {}
  private readonly reported: Partial<Record<string, number>> = {}
  private reportIn = REPORT_EVERY
  private lowWarned = false
  private emptyWarned = false
  private readonly chip: HTMLElement
  private readonly chipAmount: HTMLElement
  private lastChip = ''

  constructor(private readonly hooks: FuelHooks) {
    this.chip = document.createElement('div')
    this.chip.className = 'chip'
    this.chip.id = 'town-fuel'
    this.chip.hidden = true
    const label = document.createElement('span')
    label.className = 'dim'
    label.textContent = 'Fuel'
    this.chipAmount = document.createElement('b')
    this.chip.append(label, ' ', this.chipAmount)
    document.getElementById('hud-tl')?.append(this.chip)
  }

  /** The account's tanks: the first time each car is filled from them; later a jump up is a fill-up. */
  onAccount(acc: Account): void {
    for (const [kind, car] of this.hooks.cars.list) {
      const srv = acc.fuel[kind as VehicleKind]
      if (typeof srv !== 'number' || !this.fuelled(kind)) continue
      const last = this.server[kind]
      if (last === undefined || !Number.isFinite(car.fp.fuel)) this.fill(car, srv)
      else if (srv > last + 0.05) car.fp.fuel = srv
      this.server[kind] = srv
    }
  }

  update(dt: number): void {
    const acc = this.hooks.account()
    if (!acc) return
    for (const [kind, car] of this.hooks.cars.list) {
      if (Number.isFinite(car.fp.fuel) || !this.fuelled(kind)) continue
      const srv = acc.fuel[kind as VehicleKind]
      if (typeof srv === 'number') {
        this.fill(car, srv)
        this.server[kind] = srv
      }
    }
    this.reportIn -= dt
    if (this.reportIn <= 0) {
      this.reportIn = REPORT_EVERY
      this.report()
    }
    const driving = this.hooks.cars.driving()
    const share = driving && Number.isFinite(driving.fp.fuel) && driving.fp.tank > 0 ? driving.fp.fuel / driving.fp.tank : null
    if (share !== null && driving) {
      if (share <= 0 && !this.emptyWarned) {
        this.emptyWarned = true
        this.hooks.toast(`The ${VEHICLES[driving.kind]?.name ?? 'car'} is out of fuel. Get out and press E beside it to call a tow to the nearest pump.`, 'warn')
      } else if (share < LOW_SHARE && !this.lowWarned) {
        this.lowWarned = true
        this.hooks.toast(`Fuel is low. Fill up at ${this.nearestStationName(driving)}.`, 'warn')
      }
      if (share > LOW_SHARE + 0.05) this.lowWarned = false
      if (share > 0.01) this.emptyWarned = false
    }
    const text = share === null ? '' : `${Math.round(share * 100)}%`
    if (text !== this.lastChip) {
      this.lastChip = text
      this.chip.hidden = !text
      this.chipAmount.textContent = text
    }
  }

  /** Sends the levels burned since the last report. */
  report(): void {
    const acc = this.hooks.account()
    if (!acc) return
    const levels: Partial<Record<VehicleKind, number>> = {}
    let any = false
    for (const [kind, car] of this.hooks.cars.list) {
      if (!acc.garage.includes(kind as VehicleKind) || !Number.isFinite(car.fp.fuel)) continue
      const level = Math.round(car.fp.fuel * 1000) / 1000
      if (Math.abs((this.reported[kind] ?? Infinity) - level) < 0.005) continue
      levels[kind as VehicleKind] = level
      this.reported[kind] = level
      this.server[kind] = Math.min(this.server[kind] ?? Infinity, level)
      any = true
    }
    if (any) this.hooks.send({ t: 'fuel', levels })
  }

  /** The pump you are standing at (on foot, town frame) and the owned car beside it that needs fuel. */
  atPump(x: number, z: number): { pump: Pump; car: Car; gallons: number; cost: number } | null {
    const pump = PUMPS.find((p) => Math.hypot(p.x - x, p.z - z) < PUMP_RADIUS)
    if (!pump) return null
    const acc = this.hooks.account()
    if (!acc) return null
    let best: Car | null = null
    let bd = 12
    for (const [kind, car] of this.hooks.cars.list) {
      if (!acc.garage.includes(kind as VehicleKind) || !this.fuelled(kind) || !Number.isFinite(car.fp.fuel)) continue
      const p = car.fp.root.position
      const d = Math.hypot(p.x - pump.x, p.z - pump.z)
      if (d < bd) {
        bd = d
        best = car
      }
    }
    if (!best) return null
    const gallons = Math.max(0, best.fp.tank - best.fp.fuel)
    return { pump, car: best, gallons, cost: gallons * FUEL_PRICE }
  }

  fillUp(at: { car: Car; gallons: number }): void {
    if (at.gallons < 0.05) {
      this.hooks.toast(`The ${VEHICLES[at.car.kind]?.name ?? 'tank'} is already full.`)
      return
    }
    this.report()
    this.hooks.send({ t: 'refuel', kind: at.car.kind as VehicleKind, gallons: at.gallons })
  }

  /** An owned car within reach (town frame) that has run dry. */
  strandedNear(x: number, z: number): Car | null {
    const acc = this.hooks.account()
    for (const [kind, car] of this.hooks.cars.list) {
      if (!acc?.garage.includes(kind as VehicleKind) || !car.fp.empty) continue
      const p = car.fp.root.position
      if (Math.hypot(p.x - x, p.z - z) < 6) return car
    }
    return null
  }

  /** The pump nearest a car (town frame). */
  nearestPump(car: Car): Pump {
    const p = car.fp.root.position
    return PUMPS.reduce((a, b) => (Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? b : a))
  }

  private nearestStationName(car: Car): string {
    return this.nearestPump(car).station
  }

  private fuelled(kind: string): boolean {
    const spec = VEHICLES[kind]
    return !!spec && spec.fuel !== 'none'
  }

  private fill(car: Car, level: number): void {
    const spec = VEHICLES[car.kind]
    if (!spec || spec.fuel === 'none') return
    car.fp.setFuel(level, spec.tank, spec.mpg, FUEL_SCALE)
    this.reported[car.kind] = level
  }
}
