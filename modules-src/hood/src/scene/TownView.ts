/** Draws the working town in either scene: buildings, every vehicle and worker from the town simulation, fires, hoses and mowers. */
import * as THREE from 'three/webgpu'
import { JOBS, type JobId } from '../../shared/Jobs'
import { PLACES, type PlaceId } from '../../shared/Town'
import { townAt, type PlayerWorker, type TownRequest, type TownState, type VehicleKind, type WorkerRole } from '../../shared/TownSim'
import { box, detach } from '../models/Kit'
import { createSimFigure, type Dress, type SimFigure } from '../models/SimFigure'
import { buildTownBuildings, type TownBuildings } from '../models/TownBuildings'
import { buildBag, buildFire, buildMower, buildSpray, type FireFx, type SprayFx } from '../models/TownFx'
import { buildVehicle, buildWreck, type VehicleModel } from '../models/Vehicles'
import { el } from '../ui/Ui'
import type { Stage } from './Stage'

const DRESS: Record<WorkerRole, Dress | null> = {
  ...(Object.fromEntries(Object.entries(JOBS).map(([id, def]) => [id, def.uniform])) as Record<JobId, Dress>),
  inmate: { top: '#f07c1e', bottom: '#f07c1e', hat: 'none' },
  patient: { top: '#bcd6e6', bottom: '#bcd6e6', hat: 'none' },
  suspect: null,
  guest: null,
  driver: { top: '#3b5f8a', bottom: '#2c2f33', hat: 'cap', hatColor: '#3b5f8a' },
}

interface VehicleEntry {
  model: VehicleModel
  kind: VehicleKind
  label: HTMLElement
}

interface WorkerEntry {
  figure: SimFigure
  key: string
  label: HTMLElement | null
  last: THREE.Vector2
}

export interface TownViewOptions {
  street: number
  houses: boolean[]
  poll: boolean
}

export interface TownPick {
  title: string
  text: string
  x: number
  z: number
}

function requestKey(r: TownRequest): string {
  return `${r.lot}|${r.kind}|${r.at}`
}

export class TownView {
  readonly root = new THREE.Group()
  state: TownState | null = null
  private readonly buildings: TownBuildings
  private readonly vehicles = new Map<string, VehicleEntry>()
  private readonly workers = new Map<string, WorkerEntry>()
  private readonly fires: FireFx[] = []
  private readonly sprays: SprayFx[] = []
  private readonly mowers: THREE.Group[] = []
  private readonly wrecks: THREE.Group[] = []
  private readonly bags: THREE.Mesh[] = []
  private readonly fx = new THREE.Group()
  private polled: TownRequest[] = []
  private pushed: TownRequest[] = []
  private requests: TownRequest[] = []
  private remotePlayers: PlayerWorker[] = []
  private localPlayers: PlayerWorker[] = []
  private skew = 0
  private timer = 0
  private time = 0
  private disposed = false
  private readonly listeners = new Set<(state: TownState) => void>()
  private lastNotify = 0
  private night = 0

  constructor(private readonly stage: Stage, private readonly options: TownViewOptions) {
    this.buildings = buildTownBuildings()
    this.root.add(this.buildings.group, this.fx)
    for (let i = 0; i < 2; i++) { const f = buildFire(); f.group.visible = false; this.fires.push(f); this.fx.add(f.group) }
    stage.app.graph.add('props', this.root)
    if (options.poll) {
      void this.poll()
      this.timer = window.setInterval(() => void this.poll(), 15_000)
    }
  }

  onUpdate(listener: (state: TownState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The server's clock, so every page draws the town at the same moment. */
  syncClock(serverNow: number): void {
    const skew = serverNow - Date.now()
    if (Math.abs(skew - this.skew) > 1500) this.skew = skew
  }

  now(): number {
    return Date.now() + this.skew
  }

  setRequests(list: TownRequest[]): void {
    this.pushed = list
    this.mergeRequests()
  }

  setLocalPlayers(list: PlayerWorker[]): void {
    this.localPlayers = list
  }

  setHouses(houses: boolean[]): void {
    this.options.houses = houses
  }

  private mergeRequests(): void {
    const map = new Map<string, TownRequest>()
    for (const r of [...this.polled, ...this.pushed]) map.set(requestKey(r), r)
    this.requests = [...map.values()].sort((a, b) => a.at - b.at || a.lot - b.lot)
  }

  private async poll(): Promise<void> {
    try {
      const response = await fetch(`/api/hood?street=${this.options.street}&town=1`, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok || this.disposed) return
      const body = await response.json() as { now: number; requests: TownRequest[]; workers: PlayerWorker[] }
      this.syncClock(body.now)
      this.polled = Array.isArray(body.requests) ? body.requests : []
      this.remotePlayers = Array.isArray(body.workers) ? body.workers : []
      this.mergeRequests()
    } catch { /* keep the last picture of the town */ }
  }

  setNight(amount: number): void {
    this.night = amount
    this.buildings.setNight(amount)
  }

  focusPoint(place: PlaceId): THREE.Vector3 {
    const p = PLACES[place]
    return new THREE.Vector3((p.x0 + p.x1) / 2, 0, p.side * (7 + Math.min(p.depth, 30) / 2))
  }

  private vehicle(id: string, kind: VehicleKind): VehicleEntry {
    let entry = this.vehicles.get(id)
    if (!entry) {
      const model = buildVehicle(kind)
      model.group.userData.town = { vehicle: id }
      model.group.traverse(node => { node.userData.town = { vehicle: id } })
      this.root.add(model.group)
      const label = el('div', { class: 'label townlabel' })
      label.style.display = 'none'
      this.stage.labels.append(label)
      entry = { model, kind, label }
      this.vehicles.set(id, entry)
    }
    return entry
  }

  private worker(id: string, key: string, make: () => SimFigure, labelled: boolean): WorkerEntry {
    let entry = this.workers.get(id)
    if (entry && entry.key !== key) {
      detach(entry.figure.root)
      entry.label?.remove()
      this.workers.delete(id)
      entry = undefined
    }
    if (!entry) {
      const figure = make()
      figure.root.traverse(node => { node.userData.town = { worker: id } })
      this.root.add(figure.root)
      const label = labelled ? el('div', { class: 'label townlabel player' }) : null
      if (label) this.stage.labels.append(label)
      entry = { figure, key, label, last: new THREE.Vector2(NaN, NaN) }
      this.workers.set(id, entry)
    }
    return entry
  }

  private pool<T extends THREE.Object3D>(list: T[], count: number, make: () => T): T[] {
    while (list.length < count) { const o = make(); list.push(o); this.fx.add(o) }
    list.forEach((o, i) => { o.visible = i < count })
    return list
  }

  update(dt: number): void {
    this.time += dt
    const players = [...this.remotePlayers.filter(p => !this.localPlayers.some(l => l.lot === p.lot && l.name === p.name)), ...this.localPlayers]
    const state = townAt(this.options.street, this.now(), this.requests, players, this.options.houses)
    this.state = state
    const camera = this.stage.rig.target
    const near = (x: number, z: number, r: number) => Math.hypot(x - camera.x, z - camera.z) < r

    const seenV = new Set<string>()
    for (const v of state.vehicles) {
      seenV.add(v.id)
      const entry = this.vehicle(v.id, v.kind)
      const g = entry.model.group
      g.visible = near(v.x, v.z, 260)
      g.position.set(v.x, 0, v.z)
      g.rotation.y = v.yaw
      if (g.visible) entry.model.update(v, dt, this.time, this.night)
      const show = v.lights && g.visible
      entry.label.style.display = show ? '' : 'none'
      if (show) {
        const at = this.stage.projectXYZ(v.x, v.kind === 'engine' || v.kind === 'bus' ? 4.2 : 3.2, v.z)
        if (at) {
          const text = `${v.label}: ${v.act}`
          if (entry.label.textContent !== text) entry.label.textContent = text
          entry.label.style.left = `${at.x}px`
          entry.label.style.top = `${at.y}px`
        } else entry.label.style.display = 'none'
      }
    }
    for (const [id, entry] of this.vehicles) if (!seenV.has(id)) { entry.model.group.visible = false; entry.label.style.display = 'none' }

    const seenW = new Set<string>()
    for (const w of state.workers) {
      seenW.add(w.id)
      const dress = DRESS[w.role]
      const key = `${w.role}|${JSON.stringify(w.look)}`
      const entry = this.worker(w.id, key, () => createSimFigure(w.look, dress ?? undefined), !!w.player)
      const root = entry.figure.root
      const visible = near(w.x, w.z, 105)
      root.visible = visible
      const shadow = near(w.x, w.z, 45)
      if (entry.figure.root.userData.shadow !== shadow) {
        entry.figure.root.userData.shadow = shadow
        entry.figure.root.traverse(node => { (node as THREE.Mesh).castShadow = shadow && (node as THREE.Mesh).isMesh })
      }
      if (!visible) { if (entry.label) entry.label.style.display = 'none'; continue }
      let walking = w.walking
      if (!Number.isNaN(entry.last.x) && dt > 0) {
        const speed = Math.hypot(w.x - entry.last.x, w.z - entry.last.y) / dt
        if (speed > 6) walking = 0
      }
      entry.last.set(w.x, w.z)
      root.position.set(w.x, w.y, w.z)
      if (w.pose === 'lie' && w.role !== 'guest' && !root.userData.gurney) {
        const gurney = new THREE.Group()
        gurney.add(box(0.62, 0.08, 2.0, '#e9ecef', 0, -0.06, 0.25), box(0.66, 0.05, 2.04, '#9aa0a8', 0, -0.32, 0.25))
        for (const [gx, gz] of [[-0.26, -0.6], [0.26, -0.6], [-0.26, 1.1], [0.26, 1.1]]) gurney.add(box(0.04, 0.5, 0.04, '#9aa0a8', gx, -0.36, gz))
        root.add(gurney)
        root.userData.gurney = gurney
      }
      if (root.userData.gurney) (root.userData.gurney as THREE.Object3D).visible = w.pose === 'lie' && w.role !== 'guest'
      root.rotation.y = w.yaw
      entry.figure.setTool(w.tool)
      entry.figure.setPose(w.pose, walking, this.time + w.x * 0.1, w.tool !== 'none' && !walking)
      if (entry.label) {
        const at = this.stage.projectXYZ(w.x, 2.2, w.z)
        entry.label.style.display = at ? '' : 'none'
        if (at) {
          const text = `${w.name}|${w.act}`
          if (entry.label.dataset.text !== text) {
            entry.label.dataset.text = text
            entry.label.replaceChildren(el('b', {}, w.name), el('span', { class: 'act' }, w.act))
          }
          entry.label.style.left = `${at.x}px`
          entry.label.style.top = `${at.y}px`
        }
      }
    }
    for (const [id, entry] of this.workers) {
      if (seenW.has(id)) continue
      detach(entry.figure.root)
      entry.label?.remove()
      this.workers.delete(id)
    }

    this.fires.forEach((f, i) => {
      const fire = state.fires[i]
      if (!fire) { f.group.visible = false; f.update(0, 0, this.time); return }
      f.group.position.set(fire.x, 0, fire.z)
      f.update(fire.size, fire.smoke, this.time)
    })
    while (this.sprays.length < state.sprays.length) { const s = buildSpray(); this.sprays.push(s); this.fx.add(s.group) }
    this.sprays.forEach((s, i) => {
      const sp = state.sprays[i]
      s.group.visible = !!sp
      if (sp) s.update(sp.x, sp.z, sp.tx, sp.tz, this.time)
    })
    this.pool(this.mowers, state.mowers.length, buildMower).forEach((m, i) => {
      const mw = state.mowers[i]
      if (mw) { m.position.set(mw.x, 0, mw.z); m.rotation.y = mw.yaw }
    })
    this.pool(this.wrecks, state.wrecks.length, () => buildWreck(this.wrecks.length)).forEach((m, i) => {
      const w = state.wrecks[i]
      if (w) { m.position.set(w.x, 0, w.z); m.rotation.y = w.yaw }
    })
    this.pool(this.bags, state.bags.length, buildBag).forEach((m, i) => {
      const b = state.bags[i]
      if (b) m.position.set(b.x, 0.24, b.z)
    })

    const now = performance.now()
    if (now - this.lastNotify > 400) {
      this.lastNotify = now
      for (const listener of this.listeners) listener(state)
    }
  }

  /** What a click on the town hit: a vehicle or a worker, with what they are doing. */
  pick(ndc: THREE.Vector2): TownPick | null {
    const hit = this.stage.pick(ndc, [this.root])
    const tag = hit?.object.userData.town as { vehicle?: string; worker?: string } | undefined
    if (!tag || !this.state) return null
    if (tag.vehicle) {
      const v = this.state.vehicles.find(x => x.id === tag.vehicle)
      return v ? { title: v.label, text: v.act, x: v.x, z: v.z } : null
    }
    if (tag.worker) {
      const w = this.state.workers.find(x => x.id === tag.worker)
      if (!w) return null
      const role = w.role in JOBS ? JOBS[w.role as JobId].title : w.role === 'inmate' ? 'Inmate' : w.role === 'patient' ? 'Patient' : w.role === 'guest' ? 'Resort guest' : w.role === 'driver' ? 'Tanker driver' : 'Neighbor'
      return { title: w.name, text: `${role}${w.player ? ' (a neighbor on shift)' : ''}: ${w.act}`, x: w.x, z: w.z }
    }
    return null
  }

  dispose(): void {
    this.disposed = true
    clearInterval(this.timer)
    this.listeners.clear()
    for (const entry of this.vehicles.values()) entry.label.remove()
    for (const entry of this.workers.values()) entry.label?.remove()
    this.vehicles.clear()
    this.workers.clear()
    detach(this.root)
  }
}
