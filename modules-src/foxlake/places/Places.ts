/**
 * Fox Lake's working places, all Montello's (MontelloPlaces.ts, baked from
 * OpenStreetMap): the gas stations (Kwik Trip, BP, Mobil), Freitag's grocery
 * and its freight depot, the bars, the dealership, Maple Threads, the body
 * shops (Montello Body & Wheel and Napralla Tire), the bank, the outfitter's counter, the sheriff's office, the fire
 * station, the fuel pumps and the tow for a car that ran dry. FoxLakeTown asks
 * it for the on-foot prompt and hands it E; the shared world (RoomLogic) is the
 * authority for every purchase, loan, fill-up, repair and job. The casino is
 * inside Foxtails (casino/CasinoHost.ts), not a counter.
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { GameHost } from '../../rackreel/game/Game'
import type { Account } from '../../maplestreet/shared/Economy'
import { VEHICLES } from '../../maplestreet/shared/Economy'
import type { ClientMsg, Job } from '../../maplestreet/shared/Protocol'
import { SHOP_RADIUS } from '../../maplestreet/shared/WorldLayout'
import { MONTELLO_DEPOT, MONTELLO_FIRE_STATION, MONTELLO_SHOPS } from '../../maplestreet/shared/MontelloPlaces'
import type { VehicleKind } from '../../maplestreet/shared/Protocol'
import { BODY_SHOP_REACH } from '../../maplestreet/shared/RoomLogic'
import type { TelloLand } from '../../tello/region'
import type { TelloMap } from '../../tello/town/TelloMap'
import type { Cars } from '../town/Cars'
import { sceneToTown, townToScene } from '../region'
import { Fuel } from './Fuel'
import { Jobs } from './Jobs'
import { PlacePanel, type Place } from './PlacePanel'

/** How far from a desk the work counters answer (the fire station's door is set back from its apron). */
const DESK_RADIUS = 9

/** Every counter in Fox Lake's shared world, in the town frame. */
export const PLACES: readonly Place[] = (() => {
  const out: Place[] = []
  if (MONTELLO_DEPOT) out.push({ id: 'mt-depot', kind: 'depot', name: MONTELLO_DEPOT.name, x: MONTELLO_DEPOT.x, z: MONTELLO_DEPOT.z, area: 'montello', work: 'montello' })
  for (const s of MONTELLO_SHOPS) out.push({ id: s.id, kind: s.kind, name: s.name, x: s.x, z: s.z, area: 'montello', street: s.street || undefined })
  if (MONTELLO_FIRE_STATION) out.push({ id: 'mt-fire', kind: 'fire', name: MONTELLO_FIRE_STATION.name, x: MONTELLO_FIRE_STATION.x, z: MONTELLO_FIRE_STATION.z, area: 'montello', work: 'fire' })
  return out
})()

const PROMPT: Partial<Record<Place['kind'], string>> = {
  bar: 'have a drink and a bite',
  diner: 'order something to eat',
  cafe: 'treats and coffee',
  grocery: 'shop',
  hardware: 'upgrades',
  bank: 'loans and repayments',
  gas: 'snacks and drinks',
  depot: 'delivery work',
  fire: 'answer fire calls',
  dealer: 'vehicles, the UTV, quad and fishing boat',
  bodyshop: 'repairs, paint and upgrades',
  outfitter: 'gear rack, wardrobe and catalog',
  police: "the sheriff's office",
}

/** Fox Outfitters' counters: what E opens at the outfitter (Rack & Reel's gear, wardrobe and catalog). */
export interface OutfitterHooks {
  atRack(here: boolean): void
  open(tab: 'rack' | 'wardrobe' | 'desk'): void
}

export interface PlacesHooks {
  host: GameHost
  cars: Cars
  send(m: ClientMsg): void
  account(): Account | null
  land: TelloLand | null
  northMap: () => TelloMap | null
  gear: OutfitterHooks
}

export class Places {
  readonly fuel: Fuel
  readonly jobs: Jobs
  private readonly panel: PlacePanel
  private readonly _t = { x: 0, y: 0, z: 0 }
  private atOutfitter = false

  constructor(private readonly hooks: PlacesHooks) {
    const toast = (text: string, kind: '' | 'warn' = '') => hooks.host.hud.toast(text, kind)
    this.fuel = new Fuel({ cars: hooks.cars, send: hooks.send, account: hooks.account, toast })
    this.jobs = new Jobs({ host: hooks.host, cars: hooks.cars, send: hooks.send, land: hooks.land, northMap: hooks.northMap })
    this.panel = new PlacePanel({
      send: hooks.send,
      account: hooks.account,
      job: () => this.jobs.job,
      signedIn: () => hooks.host.progress.signedIn,
      onClose: () => undefined,
      parkedAtShop: () => this.parkedAtShop(),
      openGear: (tab) => hooks.gear.open(tab),
    })
  }

  /** Your cars standing in the lot of the repair shop you are at (Montello Body & Wheel or Napralla Tire; a car you are driving counts), the nearest first. */
  private parkedAtShop(): VehicleKind[] {
    const me = this.here()
    const shop = PLACES.filter((p) => p.kind === 'bodyshop').sort((a, b) => Math.hypot(me.x - a.x, me.z - a.z) - Math.hypot(me.x - b.x, me.z - b.z))[0]
    const acc = this.hooks.account()
    if (!shop || !acc) return []
    const found: { kind: VehicleKind; d: number }[] = []
    for (const [kind, car] of this.hooks.cars.list) {
      if (!acc.garage.includes(kind as VehicleKind) || kind === 'trailer') continue
      const p = car.fp.root.position
      const d = Math.hypot(p.x - shop.x, p.z - shop.z)
      if (d <= BODY_SHOP_REACH + 12) found.push({ kind: kind as VehicleKind, d })
    }
    return found.sort((a, b) => a.d - b.d).map((f) => f.kind)
  }

  onAccount(acc: Account): void {
    this.fuel.onAccount(acc)
    this.panel.refresh()
  }

  onJob(job: Job | null, note?: string): void {
    this.jobs.onJob(job, note)
    this.panel.refresh()
  }

  update(dt: number): void {
    this.fuel.update(dt)
    this.jobs.update(dt)
    const outfitter = this.nearest()?.kind === 'outfitter'
    if (outfitter !== this.atOutfitter) {
      this.atOutfitter = outfitter
      this.hooks.gear.atRack(outfitter)
    }
  }

  /** The prompt on foot: the hose at a fire, a pump, a car that ran dry, then the nearest counter. */
  prompt(): string {
    const hose = this.jobs.prompt()
    if (hose) return hose
    const t = this.here()
    const stranded = this.fuel.strandedNear(t.x, t.z)
    if (stranded) return `E — Call a tow for the ${VEHICLES[stranded.kind]?.name ?? 'car'} to ${this.fuel.nearestPump(stranded).station}`
    const pump = this.fuel.atPump(t.x, t.z)
    if (pump) {
      const name = VEHICLES[pump.car.kind]?.name ?? 'car'
      return pump.gallons < 0.05 ? `The ${name} has a full tank` : `E — Fill up the ${name}: ${pump.gallons.toFixed(1)} gal, about $${Math.ceil(pump.cost)}`
    }
    const place = this.nearest()
    if (!place) return ''
    if (place.kind === 'clothing') return `E — ${place.name}: clothes and outfits`
    const what = PROMPT[place.kind]
    return `E — ${place.name}${what ? `: ${what}` : ''}`
  }

  interact(): boolean {
    if (this.jobs.interact()) return true
    const t = this.here()
    const stranded = this.fuel.strandedNear(t.x, t.z)
    if (stranded) {
      this.tow(stranded)
      return true
    }
    const pump = this.fuel.atPump(t.x, t.z)
    if (pump) {
      this.fuel.fillUp(pump)
      return true
    }
    const place = this.nearest()
    if (!place) return false
    this.panel.show(place)
    return true
  }

  /** The counter you are standing at, on foot. */
  nearest(): Place | null {
    if (this.hooks.host.driving) return null
    const t = this.here()
    let best: Place | null = null
    let bd = Infinity
    for (const p of PLACES) {
      const reach = p.work ? Math.max(SHOP_RADIUS, DESK_RADIUS) : SHOP_RADIUS
      const d = Math.hypot(t.x - p.x, t.z - p.z)
      if (d < reach && d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }

  /** Tows a car that ran dry to the nearest pump and walks you over to it. */
  private tow(car: import('../town/Cars').Car): void {
    const pump = this.fuel.nearestPump(car)
    this.hooks.cars.parkVehicle(car.fp, pump.x + pump.side * 2.6, pump.z, 0)
    this.hooks.cars.sync(car)
    const s = townToScene(pump.x + pump.side * 5.2, 0, pump.z, this._t)
    this.hooks.host.teleport(new Vector3(s.x, this.hooks.host.terrain.heightAt(s.x, s.z), s.z), Math.PI)
    this.hooks.host.hud.toast(`A tow truck dropped the ${VEHICLES[car.kind]?.name ?? 'car'} at ${pump.station}. Press E at the pump to fill up.`)
  }

  private here(): { x: number; z: number } {
    const p = this.hooks.host.player
    const t = sceneToTown(p.x, p.y, p.z, this._t)
    return { x: t.x, z: t.z }
  }
}
