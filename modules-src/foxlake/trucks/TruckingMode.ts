/**
 * Truck Simulator on Montello: the Truck Simulator page boots Life Sim's Montello in trucking mode, and this component turns
 * Life Sim's truck host (`LifeSimTrucks`) into the whole module. You start in your rig's cab at your Haulers Lane lot (or on
 * the lane by the highway without one), Truck Simulator's dash, job card, procedure steps and a Montello minimap show while you
 * drive, and its panels open over Life Sim: J job board, O fleet and garage, Tab the Montello map with a waypoint, Y the lot
 * builder (through `TownBuildView`), F9 brings the rig back to your lot. The dealer desk at Eastside Truck Sales opens the
 * dealer. Engine, jake brake, horn and air brakes are Truck Simulator's synthesised sound. Panels are marked `data-host-modal`,
 * so Rack & Reel lets go of the mouse and keys while one is open. Out of the cab you walk Montello as Life Sim's person.
 */
import type { GameHost } from '../../rackreel/game/Game'
import { BuildMode } from '../../trucksim/game/BuildMode'
import { HaulMap } from '../../trucksim/game/MapDraw'
import type { MapMarkers } from '../../trucksim/game/MapDraw'
import { montelloMapSource } from '../../trucksim/game/MontelloMap'
import { TruckPanels } from '../../trucksim/game/TruckPanels'
import type { SessionEvents } from '../../trucksim/game/TruckSession'
import type { ToastKind } from '../../trucksim/game/TruckHost'
import { level } from '../../trucksim/shared/Economy'
import { MONTELLO } from '../../trucksim/shared/montello/MontelloWorld'
import { TruckAudio } from '../../trucksim/systems/Audio'
import { Hud } from '../../trucksim/ui/Hud'
import { openMap } from '../../trucksim/ui/Panels'
import type { PanelHandle } from '../../trucksim/ui/Panels'
import '../../trucksim/ui/styles.css'
import './trucking.css'
import type { LifeSimTrucks } from './LifeSimTrucks'
import { TownBuildView } from './TownBuildView'

/** Seconds of play before the driver is seated in the cab (Rack & Reel's own spawn settles first). */
const SEAT_DELAY = 0.6
const MINIMAP_METRES = 1100
const VOLUME = 0.7
const LOTS_REFRESH_S = 120

export class TruckingMode {
  readonly trucks: LifeSimTrucks
  private hud: Hud | null = null
  private panels: TruckPanels | null = null
  private readonly hudRoot: HTMLElement
  private readonly panelRoot: HTMLElement
  private readonly observer: MutationObserver
  private readonly map = new HaulMap(montelloMapSource())
  private readonly markers: MapMarkers = { rig: { x: 0, z: 0, heading: 0 }, target: null, route: null, ownLot: null }
  private readonly audio = new TruckAudio()
  private panel: PanelHandle | null = null
  private building: BuildMode | null = null
  private ready = false
  private seated = false
  private playingFor = 0
  private lastCash = -1
  private lotsTimer = LOTS_REFRESH_S
  private wasDriving = false
  private readonly onKey = (e: KeyboardEvent) => this.key(e)
  private readonly onGesture = () => {
    if (this.audio.started) return
    this.audio.start()
    this.audio.setVolume(0)
  }

  constructor(private readonly host: GameHost, makeTrucks: (events: Partial<SessionEvents>) => LifeSimTrucks, private readonly heightAt: (x: number, z: number) => number) {
    this.trucks = makeTrucks({
      openDealer: () => this.panels?.dealer(),
      horn: (on) => this.audio.setHorn(on ? this.hornKind() : null),
      airBrake: () => this.audio.airBrake(),
      jobDone: (message, pay) => {
        this.trucks.toast(`${message}${pay > 0 ? ` · +$${Math.round(pay).toLocaleString()}` : ''}`, 'good')
        this.audio.airBrake(0.6)
      },
    })
    document.body.classList.add('trucking')
    this.hudRoot = document.createElement('div')
    this.hudRoot.id = 'truck-hud'
    this.panelRoot = document.createElement('div')
    this.panelRoot.id = 'truck-panels'
    this.panelRoot.setAttribute('data-host-modal', '')
    this.panelRoot.hidden = true
    document.body.append(this.hudRoot, this.panelRoot)
    this.observer = new MutationObserver(() => {
      const open = this.panelRoot.querySelector('.ts-overlay, .ts-builder') !== null
      if (this.panelRoot.hidden === open) this.panelRoot.hidden = !open
      if (open && document.pointerLockElement) document.exitPointerLock()
    })
    this.observer.observe(this.panelRoot, { childList: true })
  }

  /** Loads the Montello career and builds the rig, then the dash and the panels. */
  async start(): Promise<void> {
    await this.trucks.start()
    const trucks = this.trucks
    this.hud = new Hud(this.hudRoot)
    this.hud.setVisible(false)
    this.hud.setMinimap((ctx, size) => this.map.drawMinimap(ctx, size, MINIMAP_METRES, this.markers))
    const host = this
    this.panels = new TruckPanels({
      uiRoot: this.panelRoot,
      get progress() {
        return host.trucks.progress
      },
      world: MONTELLO,
      session: () => trucks.session!,
      toast: (text, kind) => this.toast(text, kind),
      open: (make) => this.open(make),
      closed: () => this.closed(),
      lotFor: (index) => trucks.lotFor(index),
    })
    addEventListener('keydown', this.onKey)
    addEventListener('pointerdown', this.onGesture)
    addEventListener('keydown', this.onGesture)
    this.ready = true
  }

  private toast(text: string, kind: ToastKind = 'info'): void {
    this.trucks.toast(text, kind)
  }

  private hornKind(): 'air' | 'stock' {
    const profile = this.trucks.progress.profile
    return profile.trucks.find((t) => t.uid === profile.activeTruck)?.look.horn === 'air' ? 'air' : 'stock'
  }

  private get busy(): boolean {
    return this.panel !== null || this.building !== null
  }

  private open(make: () => PanelHandle): void {
    if (this.busy || !this.ready) return
    this.panel = make()
  }

  private closed(): void {
    this.panel = null
    this.host.ctx.engine.getRenderingCanvas()?.focus()
  }

  private key(e: KeyboardEvent): void {
    if (!this.ready || e.repeat || !this.host.playing || this.busy || this.host.hud.modalOpen) return
    const panels = this.panels!
    switch (e.code) {
      case 'KeyJ': panels.jobBoard(); break
      case 'KeyO': panels.fleet(); break
      case 'Tab':
        e.preventDefault()
        this.openMap()
        break
      case 'KeyY': this.enterBuildMode(); break
      case 'F9':
        e.preventDefault()
        this.trucks.session?.respawn()
        this.toast('Rig brought back to your lot', 'info')
        break
      default: break
    }
  }

  private openMap(): void {
    const session = this.trucks.session
    if (!session) return
    this.open(() => openMap(this.panelRoot, {
      title: 'Montello map',
      closeKeys: 'Esc',
      kindNames: { lotDistrict: 'Haulers Lane' },
      draw: (ctx, w, h) => this.map.drawFull(ctx, w, h, this.markers),
      onPick: (x, y, w, h) => {
        const point = this.map.toWorld(x, y, w, h)
        if (!point) return
        session.setWaypoint(point)
        this.markers.waypoint = point
        this.markers.route = session.route
      },
      onClearPick: () => {
        session.setWaypoint(null)
        this.markers.waypoint = null
        this.markers.route = null
      },
      onClose: () => this.closed(),
    }))
  }

  private enterBuildMode(): void {
    const progress = this.trucks.progress
    const lot = this.trucks.lotFor(progress.profile.lot)
    const lots = this.trucks.lotRenderer
    const canvas = this.host.ctx.engine.getRenderingCanvas()
    if (!lot || !lots || !canvas) {
      this.toast('You need a lot on Haulers Lane to build. Every signed-in driver gets one.', 'warn')
      return
    }
    this.trucks.holdCamera = true
    this.hud?.setVisible(false)
    this.building = new BuildMode({
      canvas, view: new TownBuildView(this.host, canvas, this.heightAt), lots, progress, uiRoot: this.panelRoot, lot,
      currentLot: () => this.trucks.lotFor(progress.profile.lot) ?? lot,
      heightAt: this.heightAt,
      toast: (text, kind) => this.toast(text, kind),
      onExit: () => {
        this.building = null
        this.trucks.holdCamera = false
        canvas.focus()
      },
    })
  }

  /** One frame after the truck host's: seat the driver once, then the dash, map markers, sound and the lot list. */
  frame(dt: number): void {
    const trucks = this.trucks
    const session = trucks.session
    if (!this.ready || !session) return
    if (this.host.playing) this.playingFor += dt
    if (!this.seated && this.playingFor >= SEAT_DELAY) {
      this.seated = trucks.enterCab()
      if (this.seated) this.toast('Your rig is at the lot. J job board · Tab map · O fleet · Y build on your lot', 'info')
    }
    const driving = trucks.driving
    if (driving !== this.wasDriving) {
      this.wasDriving = driving
      document.body.classList.toggle('ts-driving', driving)
      if (this.audio.started) this.audio.setVolume(driving ? VOLUME : 0)
    }
    const view = trucks.lastView
    const hud = this.hud
    if (!hud || !view) return
    hud.setVisible(driving && !this.building)
    session.darkness = this.host.lighting.night
    if (session.truck && this.host.lighting.night > 0.6) session.truck.headlights = true
    const profile = trucks.progress.profile
    if (profile.cash !== this.lastCash) {
      this.lastCash = profile.cash
      hud.setCash(profile.cash)
      hud.setLevel(level(profile.xp))
    }
    hud.setGauges(view.gauges)
    hud.setClock(this.host.clock.hour)
    hud.setPlace(view.place)
    hud.setJob(view.job)
    hud.setSteps(view.steps)
    hud.prompt(null)
    const p = session.rigPosition()
    this.markers.rig.x = p.x
    this.markers.rig.z = p.z
    this.markers.rig.heading = p.heading
    this.markers.target = view.target
    this.markers.route = view.route
    this.markers.waypoint = session.waypoint
    this.markers.ownLot = profile.lot
    this.markers.ownLand = profile.land
    if (driving && this.audio.started) {
      const g = view.gauges
      this.audio.setEngine(g.rpm, view.engineLoad)
      this.audio.setJakeBrake(g.engineBrake && view.engineLoad === 0 && g.rpm > 1150 && g.speedKph > 15)
      this.audio.setBackupBeeper(view.reversing && g.speedKph > 0.5)
      this.audio.setHydraulic(view.hydraulic)
    }
    this.lotsTimer -= dt
    if (this.lotsTimer <= 0) {
      this.lotsTimer = LOTS_REFRESH_S
      void trucks.progress.refreshLots().then(() => trucks.drawLots())
    }
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey)
    removeEventListener('pointerdown', this.onGesture)
    removeEventListener('keydown', this.onGesture)
    this.observer.disconnect()
    this.building?.dispose()
    this.panel?.close()
    this.hud?.dispose()
    this.audio.dispose()
    this.hudRoot.remove()
    this.panelRoot.remove()
  }
}
