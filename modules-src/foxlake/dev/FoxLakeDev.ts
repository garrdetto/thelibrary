/**
 * Fox Lake's developer tools on the client: the F8 panel (DevPanel.ts), the
 * spawned vehicles anyone can drive (SharedCars.ts), the teleports and the
 * Trace windows tool (WindowTrace.ts). Town
 * (town/FoxLakeTown.ts) hands it the shared world's messages and a few hooks.
 *
 * The world says who may use the panel (`welcome.dev`: an administrator's
 * session, or solo play on this device) and checks every spawn and cash
 * request again itself. Teleports only move this player, the way H does.
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { GameHost } from '../../rackreel/game/Game'
import type { ControlRow } from '../../rackreel/ui/Controls'
import type { Physics } from '../fp/physics/Physics'
import { Parking } from '../fp/physics/Parking'
import type { VehicleModels } from '../fp/physics/VehicleModels'
import { customVehicleRecord } from '../../maplestreet/shared/CustomVehicles'
import { SPAWN_REACH } from '../../maplestreet/shared/DevTools'
import { VEHICLES } from '../../maplestreet/shared/Economy'
import type { ClientMsg, PlayerSnap, ServerMsg, VehicleKind } from '../../maplestreet/shared/Protocol'
import { TUNING, isBuiltinVehicleKind } from '../../maplestreet/shared/Vehicles'
import { TOWN_OFFSET, sceneToTown, townToScene } from '../region'
import { DevPanel, type DevActions, type Outcome, type PlayerChoice, type VehicleChoice } from './DevPanel'
import { FOX_LAKE_PLACES, type Place } from './Places'
import { restingPose, spotsAround, yawFromHeading, yawFromTownYaw } from './Placement'
import { SharedCars, type SpawnedRow } from './SharedCars'
import { WindowTrace } from './WindowTrace'

export interface DevHooks {
  host: GameHost
  physics: Physics
  models: VehicleModels
  send(m: ClientMsg): void
  /** This player's session id in the shared world. */
  self(): string | null
  /** Stops drawing a neighbor's copy of a vehicle at once. */
  dropRemote(id: string): void
  /** Where H takes the player: their lot's front, or the town's arrival spot. */
  home(): { at: Vector3; facing: number } | null
}

const DRY = 0.25
/** How far away (m) a vehicle can be for Trace windows. */
const TRACE_REACH = 25
const GROUPS = ['Built-in', 'Bundled', 'Published', 'Retired']
const isNpc = (id: string) => id.startsWith('npc-')

export class FoxLakeDev implements DevActions {
  readonly cars: SharedCars
  private readonly panel: DevPanel
  private readonly parking: Parking
  private readonly trace: WindowTrace
  private snaps: PlayerSnap[] = []
  private dev = false
  private offline = false

  constructor(private readonly hooks: DevHooks) {
    this.cars = new SharedCars(hooks)
    this.parking = new Parking(hooks.physics)
    this.panel = new DevPanel(this, hooks.host.ctx.engine.getRenderingCanvas(), () => this.dev && hooks.host.playing && !hooks.host.hud.modalOpen)
    this.trace = new WindowTrace(hooks.host, (text) => {
      hooks.host.hud.toast(text)
      hooks.host.ctx.engine.getRenderingCanvas()?.focus()
    })
  }

  // ------------------------------------------------------------ town hooks

  /** Every message from the shared world. `solo`: the town runs on this device. */
  onServer(m: ServerMsg, solo: boolean): void {
    switch (m.t) {
      case 'welcome':
        this.dev = m.dev === true
        this.offline = solo
        this.snaps = []
        this.cars.reset()
        if (!this.dev) this.panel.revoke()
        break
      case 'snap':
        this.snaps = m.players
        this.cars.onSnap(m.vehicles)
        break
      case 'shared':
        this.cars.setList(m.vehicles)
        break
      case 'dev':
        this.panel.answer(m.ok, m.text)
        break
    }
  }

  stamp(state: Extract<ClientMsg, { t: 'state' }>): void {
    this.cars.stamp(state)
  }

  update(dt: number, night: number): void {
    this.cars.update(dt, night)
    this.trace.update()
    this.panel.update()
  }

  prompt(): string {
    return this.cars.prompt()
  }

  interact(): boolean {
    return this.cars.interact()
  }

  controls(): ControlRow[] {
    return this.dev ? [{ keys: ['F8'], text: 'Developer panel: spawn vehicles, teleport, give cash' }] : []
  }

  debug(): Record<string, unknown> {
    return { allowed: this.dev, solo: this.offline, open: this.panel.open, tracing: this.trace.active, ...this.cars.debug() }
  }

  // ------------------------------------------------------------ panel data

  allowed(): boolean {
    return this.dev
  }

  solo(): boolean {
    return this.offline
  }

  /** Everything that can be driven: built-in kinds first, then bundled, published and retired ones. */
  vehicles(): VehicleChoice[] {
    const out: VehicleChoice[] = []
    for (const kind of Object.keys(VEHICLES)) {
      const tuning = TUNING[kind]
      if (!tuning || tuning.tongue || tuning.engineForce <= 0) continue
      const record = customVehicleRecord(kind)
      const group = isBuiltinVehicleKind(kind) ? 0 : record && !record.active ? 3 : kind.startsWith('custom:bundled-') ? 1 : 2
      out.push({ kind, name: VEHICLES[kind].name, group: GROUPS[group] })
    }
    return out.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.name.localeCompare(b.name))
  }

  private others(): PlayerSnap[] {
    const me = this.hooks.self()
    return this.snaps.filter((p) => p.id !== me && !isNpc(p.id))
  }

  players(): PlayerChoice[] {
    return this.others().map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))
  }

  playerName(id: string): string | null {
    if (id === this.hooks.self()) return 'You'
    return this.snaps.find((p) => p.id === id)?.name ?? null
  }

  spawned(): SpawnedRow[] {
    return this.cars.rows()
  }

  places(): Place[] {
    return FOX_LAKE_PLACES
  }

  // ------------------------------------------------------------ requests

  /** Works out a clear, dry spot (ahead of the administrator, or beside the player it is for) and asks the world to put the vehicle there. */
  spawn(kind: string, to: string): Outcome {
    const tuning = TUNING[kind]
    if (!tuning || !VEHICLES[kind]) return { state: 'refused', text: 'That vehicle is not loaded on this device. Reload the page.' }
    const who = to === 'me' ? this.me() : this.whereIs(to)
    if (!who) return { state: 'refused', text: 'That player is not in the world right now.' }
    const height = tuning.chassis.hy * 2 + tuning.suspension.rest
    const reach = Math.max(tuning.chassis.hx, tuning.chassis.hz)
    for (const spot of spotsAround(who.x, who.z, who.yaw, tuning, to === 'me' ? 'ahead' : 'beside')) {
      if (!this.clear(spot.x, spot.z, reach)) continue
      const found = this.parking.find({ x: spot.x, z: spot.z, yaw: who.yaw, hx: tuning.chassis.hx, hz: tuning.chassis.hz }, height)
      if (!this.clear(found.x, found.z, reach) || Math.hypot(found.x - who.x, found.z - who.z) > SPAWN_REACH - 2) continue
      void this.hooks.models.preload(kind).catch(() => null)
      this.hooks.send({ t: 'dev', op: 'spawn', kind: kind as VehicleKind, to, at: restingPose((x, z) => this.ground(x, z), found.x, found.z, found.yaw, tuning) })
      return { state: 'sent' }
    }
    return { state: 'refused', text: `There is no clear, dry ground ${to === 'me' ? 'around you' : 'beside them'} for that. Try somewhere more open.` }
  }

  remove(id: string): Outcome {
    this.hooks.send({ t: 'dev', op: 'remove', id })
    return { state: 'sent' }
  }

  cash(to: string, amount: number): Outcome {
    if (!Number.isFinite(amount) || amount < 1 || Math.floor(amount) !== amount) return { state: 'refused', text: 'Enter a whole dollar amount of at least $1.' }
    this.hooks.send({ t: 'dev', op: 'cash', to, amount })
    return { state: 'sent' }
  }

  goToPlace(id: string): Outcome {
    const place = FOX_LAKE_PLACES.find((p) => p.id === id)
    return place ? this.goTo(place.x, place.z, this.hooks.host.facing, place.label) : { state: 'refused', text: 'That place is not on the list any more.' }
  }

  goHome(): Outcome {
    const home = this.hooks.home()
    return home ? this.goTo(home.at.x, home.at.z, home.facing, 'home') : { state: 'refused', text: 'There is no home to go to yet.' }
  }

  goToPlayer(id: string): Outcome {
    const p = this.others().find((x) => x.id === id)
    if (!p) return { state: 'refused', text: 'That player is not in the world right now.' }
    const at = townToScene(p.x, p.y, p.z)
    const side = { x: at.x + 2.2 * Math.cos(p.yaw), z: at.z + 2.2 * Math.sin(p.yaw) }
    return this.goTo(side.x, side.z, Math.atan2(at.x - side.x, at.z - side.z), p.name)
  }

  /** Trace windows on the vehicle the administrator is in, or the nearest drawn one within TRACE_REACH. */
  traceWindows(): Outcome {
    const { host, models } = this.hooks
    const at = host.driving ? host.driving.position : host.player
    let best: { view: ReturnType<VehicleModels['views']>[number]; d: number } | null = null
    for (const view of models.views()) {
      if (!view.root.isEnabled()) continue
      const d = Vector3.Distance(view.root.getAbsolutePosition(), at)
      if (d <= TRACE_REACH && (!best || d < best.d)) best = { view, d }
    }
    if (!best) return { state: 'refused', text: `There is no vehicle within ${TRACE_REACH} m. Walk up to one (or spawn one) and try again.` }
    const why = this.trace.start(best.view)
    return why ? { state: 'refused', text: why } : { state: 'done', text: 'Tracing windows.', close: 'free' }
  }

  // ------------------------------------------------------------ the ground

  /** This player (or the vehicle they are in) in town coordinates, with the chassis yaw of where they look. */
  private me(): { x: number; z: number; yaw: number } {
    const { host } = this.hooks
    const v = host.driving
    const at = v ? v.position : host.player
    const t = sceneToTown(at.x, at.y, at.z)
    return { x: t.x, z: t.z, yaw: yawFromHeading(v ? v.heading : host.ctx.camera.rotation.y) }
  }

  private whereIs(id: string): { x: number; z: number; yaw: number } | null {
    const p = this.others().find((x) => x.id === id)
    return p ? { x: p.x, z: p.z, yaw: yawFromTownYaw(p.yaw) } : null
  }

  /** Ground height under a town point, in town coordinates (the lake country's terrain, or the town's flat ground). */
  private ground(x: number, z: number): number {
    const s = townToScene(x, 0, z)
    return this.hooks.host.terrain.heightAt(s.x, s.z) - TOWN_OFFSET.y
  }

  /** Dry land inside the world with no tree trunk in the way, around a town point. */
  private clear(x: number, z: number, radius: number): boolean {
    const s = townToScene(x, 0, z)
    return this.dry(s.x, s.z) && !this.trunk(s.x, s.z, radius)
  }

  private dry(x: number, z: number): boolean {
    const { terrain } = this.hooks.host
    return terrain.inBounds(x, z, 3) && terrain.heightAt(x, z) > DRY
  }

  private trunk(x: number, z: number, radius: number): boolean {
    for (const t of this.hooks.host.ctx.queryTrunks(x, z, radius)) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + radius) ** 2) return true
    return false
  }

  /** Somewhere a person can stand at or near a scene point: dry, inside the world, outside every building and tree. */
  private standable(x: number, z: number): boolean {
    if (!this.dry(x, z) || this.trunk(x, z, 0.5)) return false
    const t = sceneToTown(x, TOWN_OFFSET.y, z)
    return !this.hooks.physics.blocked(t.x, t.z, 0, 0.6)
  }

  private safeSpot(x: number, z: number): { x: number; z: number } | null {
    if (this.standable(x, z)) return { x, z }
    for (let r = 2; r <= 16; r += 2) {
      for (let a = 0; a < 12; a++) {
        const px = x + Math.cos((a / 12) * Math.PI * 2) * r
        const pz = z + Math.sin((a / 12) * Math.PI * 2) * r
        if (this.standable(px, pz)) return { x: px, z: pz }
      }
    }
    return null
  }

  /** Puts the player on foot at safe ground at or near a scene point, the way H (go home) does. */
  private goTo(x: number, z: number, facing: number, label: string): Outcome {
    const { host } = this.hooks
    if (host.mode === 'bowfish' || host.mode === 'crew') return { state: 'refused', text: 'Finish the boat ride first.' }
    const spot = this.safeSpot(x, z)
    if (!spot) return { state: 'refused', text: `There is no safe ground to stand on near ${label}.` }
    host.teleport(new Vector3(spot.x, 0, spot.z), facing)
    host.hud.toast(`Teleported to ${label}.`)
    return { state: 'done', text: `Teleported to ${label}.`, close: true }
  }
}
