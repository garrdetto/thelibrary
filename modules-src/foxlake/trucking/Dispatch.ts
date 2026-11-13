/**
 * Fox Lake Freight's dispatch: the board on the office porch (E on foot) lists the loads on offer
 * (shared/Freight.ts `boardAt`: the same for everyone, new every ten minutes) with the rig, cargo, pickup, drop,
 * distance and pay. Taking one routes you (the full map's directions and the minimap) to the pickup; there, in the
 * right rig, L loads it (a few seconds at the dock, rack, pit or deck), then you're routed to the drop and L
 * delivers it. The dump truck dumps instead: raise the body (B) at the drop and the load slides out into a pile. The
 * authority checks every step and pays on delivery; the job chip shows where you are with it.
 */
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { BOARD_MINUTES, RIG_LABEL, STOP_RADIUS, boardAt, siteOf, type FreightJob, type Load } from '../../maplestreet/shared/Freight'
import type { ClientMsg } from '../../maplestreet/shared/Protocol'
import { townToScene } from '../region'
import type { Fleet } from './Fleet'

/** Where you stand to read the board (town coordinates). */
export const BOARD_SPOT = { x: 40, z: 559 } as const
const BOARD_REACH = 3.2
const LOAD_SECONDS = 4
const MAX_PILES = 6

export interface DispatchHost {
  send(m: ClientMsg): void
  toast(text: string): void
  /** Routes the player (map and minimap) to a scene point, named. */
  routeTo(x: number, z: number, name: string): void
  clearRoute(): void
  /** The player's (or their vehicle's) town position. */
  where(): { x: number; z: number }
  driving(): boolean
  scene: Scene
  groundAt(x: number, z: number): number
}

export class Dispatch {
  private job: FreightJob | null = null
  private readonly panel: HTMLDivElement
  private readonly list: HTMLDivElement
  private readonly current: HTMLDivElement
  private readonly chip: HTMLDivElement
  private loading = 0
  private dumped = false
  private readonly piles: Mesh[] = []
  private pileMat: PBRMaterial | null = null
  private slot = -1

  constructor(private readonly host: DispatchHost, private readonly fleet: Fleet) {
    this.panel = document.createElement('div')
    this.panel.className = 'fl-board'
    this.panel.hidden = true
    this.panel.dataset.hostModal = ''
    this.panel.setAttribute('role', 'dialog')
    this.panel.setAttribute('aria-modal', 'true')
    this.panel.setAttribute('aria-label', 'Dispatch board')
    const head = document.createElement('div')
    head.className = 'fl-board-head'
    const title = document.createElement('h2')
    title.textContent = 'Fox Lake Freight — dispatch'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'rr-btn primary'
    close.textContent = 'Close (Esc)'
    close.addEventListener('click', () => this.close())
    head.append(title, close)
    const note = document.createElement('p')
    note.className = 'fl-board-note'
    note.textContent = `New loads every ${BOARD_MINUTES} minutes. Tractors and trailers park in the yard: back the tractor's fifth wheel under a trailer and press T to couple it. In the right rig, press L at the pickup and again at the drop; the dump truck dumps with B.`
    this.current = document.createElement('div')
    this.current.className = 'fl-board-current'
    this.list = document.createElement('div')
    this.list.className = 'fl-board-list'
    this.panel.append(head, note, this.current, this.list)
    document.body.append(this.panel)
    addEventListener('keydown', (e) => {
      if (this.panel.hidden) return
      if (e.code === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        this.close()
      }
    }, true)
    this.chip = document.createElement('div')
    this.chip.className = 'fl-job'
    this.chip.hidden = true
    this.chip.setAttribute('role', 'status')
    this.chip.setAttribute('aria-live', 'polite')
    document.body.append(this.chip)
  }

  get open(): boolean {
    return !this.panel.hidden
  }

  nearBoard(): boolean {
    const p = this.host.where()
    return !this.host.driving() && Math.hypot(p.x - BOARD_SPOT.x, p.z - BOARD_SPOT.z) < BOARD_REACH
  }

  show(): void {
    this.render()
    this.panel.hidden = false
    if (document.pointerLockElement) document.exitPointerLock()
  }

  close(): void {
    this.panel.hidden = true
  }

  /** The authority's word on the current job (null: none), with a note and, on delivery, the pay. */
  onJob(job: FreightJob | null, note?: string, paid?: number): void {
    const before = this.job
    this.job = job
    if (note) this.host.toast(note)
    if (paid && before?.rig === 'dumptruck') this.fleet.lowerDump()
    this.fleet.setLoad(job)
    this.dumped = false
    this.loading = 0
    if (job) {
      const stop = siteOf(job.stage === 'toPickup' ? job.from : job.to)
      if (stop && (!before || before.id !== job.id || before.stage !== job.stage)) {
        const s = townToScene(stop.x, 0, stop.z)
        this.host.routeTo(s.x, s.z, stop.name)
      }
    } else if (before) this.host.clearRoute()
    if (!this.panel.hidden) this.render()
    this.renderChip()
  }

  private take(load: Load): void {
    this.host.send({ t: 'freight', a: 'take', load: load.id })
  }

  private render(): void {
    const job = this.job
    this.current.replaceChildren()
    if (job) {
      const card = document.createElement('div')
      card.className = 'fl-load current'
      card.append(this.describe(job, job.stage === 'toPickup' ? 'Your load: head to the pickup' : 'Your load: on board, head to the drop'))
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.className = 'rr-btn'
      cancel.textContent = 'Cancel this load'
      cancel.addEventListener('click', () => this.host.send({ t: 'freight', a: 'cancel' }))
      card.append(cancel)
      this.current.append(card)
    }
    this.list.replaceChildren()
    for (const load of boardAt(Date.now())) {
      const row = document.createElement('div')
      row.className = 'fl-load'
      row.append(this.describe(load))
      const take = document.createElement('button')
      take.type = 'button'
      take.className = 'rr-btn primary'
      take.textContent = `Take · $${load.pay.toLocaleString()}`
      take.disabled = !!job
      take.addEventListener('click', () => this.take(load))
      row.append(take)
      this.list.append(row)
    }
  }

  private describe(load: Load, heading?: string): HTMLElement {
    const box = document.createElement('div')
    box.className = 'fl-load-text'
    if (heading) {
      const h = document.createElement('em')
      h.textContent = heading
      box.append(h)
    }
    const title = document.createElement('strong')
    title.textContent = `${load.label} · ${RIG_LABEL[load.rig]}`
    const route = document.createElement('span')
    route.textContent = `${siteOf(load.from)?.name ?? load.from} → ${siteOf(load.to)?.name ?? load.to} · ${(load.distance / 1000).toFixed(1)} km · ${(load.mass / 1000).toFixed(0)} t`
    box.append(title, route)
    return box
  }

  private renderChip(): void {
    const job = this.job
    this.chip.hidden = !job
    if (!job) return
    const stop = siteOf(job.stage === 'toPickup' ? job.from : job.to)
    this.chip.textContent = `${job.label} · $${job.pay.toLocaleString()} · ${job.stage === 'toPickup' ? 'Pick up at' : 'Deliver to'} ${stop?.name ?? ''}`
  }

  private atStop(): boolean {
    const job = this.job
    if (!job) return false
    const stop = siteOf(job.stage === 'toPickup' ? job.from : job.to)
    const p = this.host.where()
    return !!stop && Math.hypot(p.x - stop.x, p.z - stop.z) < STOP_RADIUS
  }

  /** L while driving: load or deliver at the stop. */
  press(): void {
    const job = this.job
    if (!job || this.loading > 0) return
    if (!this.atStop()) return this.host.toast(`Drive to ${siteOf(job.stage === 'toPickup' ? job.from : job.to)?.name ?? 'the stop'} first.`)
    if (!this.fleet.rigFor(job)) return this.host.toast(job.rig === 'dumptruck' ? 'This load needs the dump truck.' : `This load needs the tractor with the ${RIG_LABEL[job.rig].replace('Tractor + ', '')} coupled.`)
    if (job.stage === 'toDrop' && job.rig === 'dumptruck') return this.host.toast('Raise the body with B to dump the gravel.')
    this.loading = LOAD_SECONDS
    this.host.toast(job.stage === 'toPickup' ? 'Loading…' : 'Unloading…')
  }

  /** The prompt while driving (Rack & Reel's drive prompt). */
  prompt(): string {
    const job = this.job
    if (!job || !this.fleet.rigFor(job)) return ''
    if (this.loading > 0) return job.stage === 'toPickup' ? 'Loading…' : 'Unloading…'
    if (!this.atStop()) return ''
    if (job.stage === 'toPickup') return `L — Load ${job.label.toLowerCase()}`
    return job.rig === 'dumptruck' ? 'B — Raise the body to dump the gravel' : `L — Unload ${job.label.toLowerCase()}`
  }

  update(dt: number): void {
    const slot = Math.floor(Date.now() / (BOARD_MINUTES * 60_000))
    if (slot !== this.slot) {
      this.slot = slot
      if (!this.panel.hidden) this.render()
    }
    const job = this.job
    if (!job) return
    if (this.loading > 0) {
      if (!this.fleet.rigFor(job) || !this.atStop()) {
        this.loading = 0
        this.host.toast('Stopped loading: stay at the stop in the rig.')
        return
      }
      this.loading -= dt
      if (this.loading <= 0) this.host.send({ t: 'freight', a: job.stage === 'toPickup' ? 'load' : 'deliver' })
    }
    if (job.rig === 'dumptruck' && job.stage === 'toDrop' && !this.dumped && this.fleet.dump > 0.8 && this.atStop() && this.fleet.rigFor(job)) {
      this.dumped = true
      this.leavePile()
      this.host.send({ t: 'freight', a: 'deliver' })
    }
  }

  /** The gravel left behind a dump: a pile on the ground behind the truck (the last few stay). */
  private leavePile(): void {
    const p = this.host.where()
    const s = townToScene(p.x, 0, p.z)
    const pile = CreateCylinder('gravel-pile', { diameterTop: 0.6, diameterBottom: 6.5, height: 1.9, tessellation: 24 }, this.host.scene)
    this.pileMat ??= (() => {
      const m = new PBRMaterial('gravel-pile', this.host.scene)
      m.albedoColor = new Color3(0.2, 0.18, 0.15)
      m.metallic = 0
      m.roughness = 0.95
      return m
    })()
    pile.material = this.pileMat
    pile.position.set(s.x, this.host.groundAt(s.x, s.z) + 0.9, s.z)
    pile.isPickable = false
    pile.receiveShadows = true
    this.piles.push(pile)
    while (this.piles.length > MAX_PILES) this.piles.shift()?.dispose()
  }
}
