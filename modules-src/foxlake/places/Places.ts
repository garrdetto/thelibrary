/**
 * Fox Lake's working places: every shop door in Fox Plains and Montello
 * (MontelloPlaces.ts, baked from OpenStreetMap), the bank counters, the
 * freight depot and Kwik Trip's delivery desk, Montello's fire station, the
 * fuel pumps and the tow for a car that ran dry. FoxLakeTown asks it for the
 * on-foot prompt and hands it E; the shared world (RoomLogic) is the authority
 * for every purchase, loan, fill-up and job.
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { GameHost } from '../../rackreel/game/Game'
import type { Account } from '../../maplestreet/shared/Economy'
import { VEHICLES } from '../../maplestreet/shared/Economy'
import type { ClientMsg, Job } from '../../maplestreet/shared/Protocol'
import { DEPOT, SHOP_DOORS, SHOP_RADIUS } from '../../maplestreet/shared/WorldLayout'
import { MONTELLO_DEPOT, MONTELLO_FIRE_STATION, MONTELLO_SHOPS } from '../../maplestreet/shared/MontelloPlaces'
import type { TelloLand } from '../../tello/region'
import type { TelloMap } from '../../tello/town/TelloMap'
import type { Cars } from '../town/Cars'
import type { WorldMap } from '../town/WorldMap'
import { sceneToTown, townToScene } from '../region'
import { Fuel } from './Fuel'
import { Jobs } from './Jobs'
import { PlacePanel, type Place } from './PlacePanel'

/** How far from a desk the work counters answer (the fire station's door is set back from its apron). */
const DESK_RADIUS = 9

/** Every counter in Fox Lake's shared world, in the town frame. */
export const PLACES: readonly Place[] = (() => {
  const out: Place[] = SHOP_DOORS.map((d) => ({ id: d.id, kind: d.kind, name: d.name, x: d.x, z: d.z, area: 'foxplains' as const }))
  out.push({ id: 'depot', kind: 'depot', name: 'Freight depot', x: DEPOT.padX, z: DEPOT.padZ, area: 'foxplains', work: 'delivery' })
  for (const s of MONTELLO_SHOPS) {
    const kwik = MONTELLO_DEPOT && s.name === MONTELLO_DEPOT.name && Math.hypot(s.x - MONTELLO_DEPOT.x, s.z - MONTELLO_DEPOT.z) < 1
    out.push({ id: s.id, kind: s.kind, name: s.name, x: s.x, z: s.z, area: 'montello', street: s.street || undefined, work: kwik ? 'montello' : undefined })
  }
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
}

export interface PlacesHooks {
  host: GameHost
  cars: Cars
  send(m: ClientMsg): void
  account(): Account | null
  land: TelloLand | null
  map: () => WorldMap | null
  northMap: () => TelloMap | null
  inNorth(): boolean
}

export class Places {
  readonly fuel: Fuel
  readonly jobs: Jobs
  private readonly panel: PlacePanel
  private readonly _t = { x: 0, y: 0, z: 0 }

  constructor(private readonly hooks: PlacesHooks) {
    const toast = (text: string, kind: '' | 'warn' = '') => hooks.host.hud.toast(text, kind)
    this.fuel = new Fuel({ cars: hooks.cars, send: hooks.send, account: hooks.account, toast })
    this.jobs = new Jobs({ host: hooks.host, cars: hooks.cars, send: hooks.send, land: hooks.land, map: hooks.map, northMap: hooks.northMap, inNorth: hooks.inNorth })
    this.panel = new PlacePanel({
      send: hooks.send,
      account: hooks.account,
      job: () => this.jobs.job,
      signedIn: () => hooks.host.progress.signedIn,
      onClose: () => undefined,
    })
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
    if (place.kind === 'clothing') return `E — ${place.name}: try on outfits`
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
    if (place.kind === 'clothing') this.hooks.host.openWardrobe()
    else if (place.kind === 'dealer') this.hooks.host.hud.toast(`${place.name} sells vehicles in classic Fox Plains; whatever you buy there shows up here (V).`)
    else this.panel.show(place)
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
