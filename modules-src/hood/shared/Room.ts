import { applyBuild, type BuildOp } from './Build'
import { actionDef, objectDef, type ActionDef, type Pose } from './Catalog'
import { lookFromKey } from './Look'
import { LotGrid, footprintSize, inLot, tileIndex, type LotState, type PlacedObject, type SimRecord } from './Lot'
import { NEEDS, clampNeed, decayNeeds, fullNeeds, mood, urgency, type Needs } from './Needs'
import { findPath, nearestWalkable, walkable, type PathRules } from './Path'
import { LOT_CAPACITY, type Command, type LotView, type MemberView, type ServerMessage, type SettingsView, type SimView, type Speed } from './Protocol'
import { lotAddress } from './Street'
import { RESORT_MS, beginTask, finishShift, newCareer, settleTask, startShift, tripReturn } from './Careers'
import { JOBS, SERVICES, SERVICE_COOLDOWN, jobDef, jobTitle, perfLabel, xpForNext, type JobId } from './Jobs'
import { REQUEST_WINDOW_MS, callsAt, serviceEta, type TownCall, type TownRequest } from './TownSim'
import { PLACES } from './Town'
import type { AwayView, CareerView, OrderView, WorkView } from './Protocol'

export interface JoinInfo {
  key: string
  name: string
  /** The visiting Sim, lent by the visitor's home lot; guests and people without a home get a stand-in. */
  sim?: SimRecord | null
  send(message: ServerMessage): void
  close(): void
}

export interface RoomHooks {
  /** Something worth saving changed. */
  dirty?(): void
  /** Who is here changed: whether the owner is home and how many visitors there are. */
  presence?(home: boolean, visitors: number): void
  /** A visitor left; their Sim's needs and the sim minutes it spent here go back to its home lot. */
  visitorLeft?(key: string, sim: SimRecord, minutes: number): void
  /** The real clock in milliseconds; tests pass their own. */
  now?(): number
  /** A household called a service; the host keeps the street's list of calls. */
  requested?(request: TownRequest): void
  /** Something the rest of the street should see soon (a shift, a call). */
  important?(): void
}

type Task =
  | { kind: 'go'; x: number; z: number; auto?: boolean }
  | { kind: 'use'; obj: number; act: string; auto?: boolean }
  | { kind: 'chat'; target: string; auto?: boolean }
  | { kind: 'knock' }

interface Activity {
  task: Task
  stage: 'walk' | 'do' | 'wait'
  minutes: number
  label: string
  obj?: number
  seat?: number
  partner?: string
  action?: ActionDef
}

interface SimRt {
  id: string
  rec: SimRecord
  hh: boolean
  controller: string
  x: number
  z: number
  tile: [number, number]
  path: [number, number][]
  facing: number
  pose: Pose
  queue: Task[]
  act: Activity | null
  rest: number
  bubble: string
  bubbleFor: number
  visitMinutes: number
}

interface Member {
  id: string
  key: string
  name: string
  role: 'owner' | 'visitor'
  guest: boolean
  speed: Speed
  sims: string[]
  send(message: ServerMessage): void
  close(): void
}

const WALK_TILES_PER_SECOND = 2.2
const CHAT_MINUTES = 25
/** How long a knock waits for the owner, in real seconds, whatever the game speed. */
export const KNOCK_SECONDS = 45
const MAX_QUEUE = 6
const PEER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function ownerKey(state: LotState): string {
  return `member:${state.ownerId}`
}

/** Small seeded generator so the same lot plays the same way in the page and on the server. */
export class Rng {
  constructor(private seed: number) {}
  next(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The authority for one lot. The lot's Durable Object runs it for everyone on the lot, and the page runs it alone for the practice lot.
 * The yard is open to the whole street; the inside of the house is for the household and for visitors the owner let in at the door,
 * and only while the owner is home.
 */
export class Room {
  grid: LotGrid
  readonly members = new Map<string, Member>()
  readonly sims = new Map<string, SimRt>()
  private readonly rng: Rng
  private pendingKnocks = new Map<string, number>()
  private lotVersion = 0
  private views: { version: number; entitled?: LotView; outside?: LotView } = { version: -1 }
  requests: TownRequest[] = []
  private requestKey = '[]'

  constructor(readonly state: LotState, private readonly hooks: RoomHooks = {}, private readonly ownerKeyValue = ownerKey(state), seed = 1) {
    this.grid = new LotGrid(state)
    this.rng = new Rng(seed)
  }

  get owner(): Member | undefined {
    for (const m of this.members.values()) if (m.role === 'owner') return m
    return undefined
  }

  get ownerHome(): boolean {
    return !!this.owner
  }

  visitorCount(): number {
    let n = 0
    for (const m of this.members.values()) if (m.role === 'visitor') n++
    return n
  }

  private newId(): string {
    let id = ''
    do {
      id = ''
      for (let i = 0; i < 5; i++) id += PEER_ALPHABET[Math.floor(this.rng.next() * PEER_ALPHABET.length)]
    } while (this.members.has(id))
    return id
  }

  join(info: JoinInfo): { id: string } | { error: string } {
    const role: Member['role'] = info.key === this.ownerKeyValue ? 'owner' : 'visitor'
    if (role === 'visitor') {
      if (this.state.settings.blocked.some(p => p.key === info.key)) return { error: 'The owner asked you not to visit this lot.' }
      if (!this.state.settings.yardOpen) return { error: 'This household is keeping the yard to themselves right now.' }
    }
    for (const m of [...this.members.values()]) {
      if (m.key !== info.key) continue
      m.send({ t: 'bye', text: 'You opened this lot in another tab, so this one stepped away.' })
      this.leave(m.id)
      m.close()
    }
    if (this.members.size >= LOT_CAPACITY) return { error: 'This lot is full right now. Try again in a little while.' }

    const member: Member = { id: this.newId(), key: info.key, name: info.name, role, guest: false, speed: 1, sims: [], send: info.send, close: info.close }
    this.members.set(member.id, member)
    if (role === 'owner') {
      for (const rec of this.state.household.sims) {
        rec.away = null
        if (rec.work || rec.trip) continue
        this.spawn(rec, true, member.id)
        member.sims.push(`h-${rec.id}`)
      }
    } else {
      const rec: SimRecord = info.sim
        ? { ...info.sim, needs: { ...info.sim.needs }, away: null }
        : { id: 'guest', name: info.name, look: lookFromKey(info.key), needs: fullNeeds(), x: 10, z: 0, away: null }
      const spot = nearestWalkable(this.grid, 10, 0, { inside: false }) ?? [10, 0]
      rec.x = spot[0]
      rec.z = spot[1]
      const sim = this.spawn(rec, false, member.id, `v-${member.id}`)
      sim.facing = 0
      member.sims.push(sim.id)
      this.say(sim, 'Hi, neighbors!')
    }
    member.send({ t: 'welcome', id: member.id, role, lot: this.lotView(member), settings: role === 'owner' ? this.settingsView() : undefined })
    member.send({ t: 'town', requests: this.requests })
    this.broadcastPeople()
    if (role === 'visitor') this.owner?.send({ t: 'notice', text: `${member.name} is in your yard.` })
    else for (const m of this.members.values()) if (m !== member) m.send({ t: 'notice', text: `${member.name} is home.` })
    this.hooks.presence?.(this.ownerHome, this.visitorCount())
    this.hooks.dirty?.()
    return { id: member.id }
  }

  leave(id: string): void {
    const member = this.members.get(id)
    if (!member) return
    this.members.delete(id)
    for (const simId of member.sims) {
      const sim = this.sims.get(simId)
      if (!sim) continue
      this.dropSim(sim)
      if (!sim.hh) this.hooks.visitorLeft?.(member.key, { ...sim.rec, needs: { ...sim.rec.needs } }, Math.round(sim.visitMinutes))
    }
    this.closeKnock(id)
    if (member.role === 'owner') {
      for (const m of this.members.values()) {
        m.send({ t: 'notice', text: `${member.name} left, so the house is closed until they are back.` })
        if (m.guest) this.setGuest(m, false, null)
      }
    }
    this.broadcastPeople()
    this.hooks.presence?.(this.ownerHome, this.visitorCount())
    this.hooks.dirty?.()
  }

  /** Lends a household Sim to another lot. Returns null when nobody is free to go. */
  depart(simId?: string): SimRecord | null {
    const sims = this.state.household.sims
    const free = (s: SimRecord) => !s.away && !s.work && !s.trip
    const rec = sims.find(s => s.id === simId && free(s)) ?? sims.find(free)
    if (!rec) return null
    const live = this.sims.get(`h-${rec.id}`)
    if (live) {
      this.dropSim(live)
      for (const m of this.members.values()) m.sims = m.sims.filter(id => id !== live.id)
    }
    rec.away = { street: -1, lot: -1 }
    this.hooks.dirty?.()
    return { ...rec, needs: { ...rec.needs } }
  }

  /** A household Sim is back from a visit: its needs come home, and the rest of the household caught up on their own. */
  homecoming(simId: string, needs: Needs, minutes: number): boolean {
    const rec = this.state.household.sims.find(s => s.id === simId)
    if (!rec?.away) return false
    rec.away = null
    rec.needs = { ...needs }
    const elapsed = Math.max(0, Math.min(minutes, 24 * 60))
    if (!this.ownerHome) {
      this.state.clock += elapsed
      for (const other of this.state.household.sims) if (other !== rec && !other.away) decayNeeds(other.needs, elapsed, 35)
    } else {
      const owner = this.owner!
      this.spawn(rec, true, owner.id)
      owner.sims.push(`h-${rec.id}`)
    }
    this.hooks.dirty?.()
    return true
  }

  private spawn(rec: SimRecord, hh: boolean, controller: string, id = `h-${rec.id}`): SimRt {
    const rules: PathRules = { inside: true }
    const tile = nearestWalkable(this.grid, rec.x, rec.z, hh ? rules : { inside: false }) ?? [Math.round(rec.x), Math.round(rec.z)]
    const sim: SimRt = {
      id, rec, hh, controller, x: tile[0], z: tile[1], tile: [tile[0], tile[1]], path: [], facing: 0, pose: 'stand',
      queue: [], act: null, rest: 2 + this.rng.next() * 6, bubble: '', bubbleFor: 0, visitMinutes: 0,
    }
    this.sims.set(id, sim)
    return sim
  }

  private dropSim(sim: SimRt): void {
    sim.rec.x = sim.tile[0]
    sim.rec.z = sim.tile[1]
    this.endActivity(sim, true)
    this.sims.delete(sim.id)
    for (const other of this.sims.values()) {
      if (other.act?.partner === sim.id) this.endActivity(other, true)
      other.queue = other.queue.filter(t => !(t.kind === 'chat' && t.target === sim.id))
    }
  }

  private canEnter(sim: SimRt): boolean {
    if (sim.hh) return true
    return !!this.members.get(sim.controller)?.guest
  }

  private rules(sim: SimRt): PathRules {
    return { inside: this.canEnter(sim) }
  }

  private memberEntitled(member: Member): boolean {
    return member.role === 'owner' || member.guest
  }

  private canUse(sim: SimRt, object: PlacedObject, action: ActionDef): string | null {
    if (this.grid.objectInside(object) && !this.canEnter(sim)) return 'That is inside the house.'
    if (sim.hh) return null
    if (action.guest === 'no') return 'That is just for the household.'
    if (action.guest === 'ask' && !this.state.settings.guestsUseFridgeBeds) return 'The owner keeps that for the household.'
    return null
  }

  private effectiveSpeed(): Speed {
    if (!this.ownerHome) return 1
    let min: Speed = 3
    for (const m of this.members.values()) if (m.speed < min) min = m.speed
    if (this.members.size > 1 && min === 0) return 1
    return min
  }

  command(memberId: string, cmd: Command): void {
    const member = this.members.get(memberId)
    if (!member) return
    const mine = (simId: string) => {
      const sim = this.sims.get(simId)
      return sim && sim.controller === member.id ? sim : null
    }
    switch (cmd.t) {
      case 'go': {
        const sim = mine(cmd.sim)
        if (!sim || !inLot(cmd.x, cmd.z)) return
        if (!this.canEnter(sim) && this.grid.isInside(cmd.x, cmd.z)) return this.say(sim, 'I need to knock first.')
        return this.enqueue(sim, { kind: 'go', x: cmd.x, z: cmd.z })
      }
      case 'use': {
        const sim = mine(cmd.sim)
        const object = this.grid.objects.get(cmd.obj)
        if (!sim || !object) return
        const def = objectDef(object.def)
        const action = def && actionDef(def, cmd.act)
        if (!action) return
        const blocked = this.canUse(sim, object, action)
        if (blocked) return this.say(sim, blocked)
        return this.enqueue(sim, { kind: 'use', obj: cmd.obj, act: cmd.act })
      }
      case 'chat': {
        const sim = mine(cmd.sim)
        if (!sim || !this.sims.has(cmd.target) || cmd.target === sim.id) return
        return this.enqueue(sim, { kind: 'chat', target: cmd.target })
      }
      case 'cancel': {
        const sim = mine(cmd.sim)
        if (!sim) return
        sim.queue = []
        this.endActivity(sim, true)
        return
      }
      case 'knock': {
        const sim = mine(cmd.sim)
        if (!sim || sim.hh) return
        if (member.guest) return this.say(sim, 'I am already welcome inside.')
        return this.enqueue(sim, { kind: 'knock' })
      }
      case 'answer': {
        if (member.role !== 'owner') return
        const visitor = this.members.get(cmd.id)
        if (!visitor || !this.pendingKnocks.has(cmd.id)) return
        this.closeKnock(cmd.id)
        if (cmd.allow && cmd.always && !this.state.settings.alwaysLetIn.some(p => p.key === visitor.key)) {
          this.state.settings.alwaysLetIn.push({ key: visitor.key, name: visitor.name })
          member.send({ t: 'lot', lot: this.lotView(member), settings: this.settingsView() })
          this.hooks.dirty?.()
        }
        this.answerKnock(visitor, cmd.allow)
        return
      }
      case 'askLeave': {
        if (member.role !== 'owner') return
        const visitor = this.members.get(cmd.id)
        if (!visitor || !visitor.guest) return
        this.setGuest(visitor, false, `${member.name} asked you to head back out to the yard.`)
        return
      }
      case 'sendHome': {
        if (member.role !== 'owner') return
        const visitor = this.members.get(cmd.id)
        if (!visitor || visitor.role !== 'visitor') return
        if (cmd.block && !this.state.settings.blocked.some(p => p.key === visitor.key)) {
          this.state.settings.blocked.push({ key: visitor.key, name: visitor.name })
          this.state.settings.alwaysLetIn = this.state.settings.alwaysLetIn.filter(p => p.key !== visitor.key)
        }
        visitor.send({ t: 'bye', text: `${member.name} asked you to leave the lot.` })
        this.leave(visitor.id)
        visitor.close()
        member.send({ t: 'lot', lot: this.lotView(member), settings: this.settingsView() })
        this.hooks.dirty?.()
        return
      }
      case 'forget': {
        if (member.role !== 'owner') return
        const list = this.state.settings[cmd.list]
        if (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index >= list.length) return
        list.splice(cmd.index, 1)
        member.send({ t: 'lot', lot: this.lotView(member), settings: this.settingsView() })
        this.hooks.dirty?.()
        return
      }
      case 'speed': {
        if (![0, 1, 2, 3].includes(cmd.speed)) return
        member.speed = cmd.speed
        if (cmd.speed === 0 && this.members.size > 1) member.send({ t: 'notice', text: 'Time keeps running while someone else is on the lot.' })
        return
      }
      case 'settings': {
        if (member.role !== 'owner') return
        if (typeof cmd.yardOpen === 'boolean') this.state.settings.yardOpen = cmd.yardOpen
        if (typeof cmd.guestsUseFridgeBeds === 'boolean') this.state.settings.guestsUseFridgeBeds = cmd.guestsUseFridgeBeds
        member.send({ t: 'lot', lot: this.lotView(member), settings: this.settingsView() })
        this.hooks.dirty?.()
        return
      }
      case 'build': return this.build(member, cmd.op)
      case 'job': return this.setJob(member, cmd.sim, cmd.job)
      case 'work': return this.goToWork(member, cmd.sim)
      case 'task': return this.startTask(member, cmd.sim, cmd.task)
      case 'clockOut': {
        if (member.role !== 'owner') return
        const rec = this.recOf(cmd.sim)
        if (rec?.work) this.endShift(rec, true)
        return
      }
      case 'order': return this.order(member, cmd.kind, cmd.sim)
    }
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now()
  }

  /** The host hands over the street's recent service calls; everyone here gets them for the town view. */
  setRequests(list: TownRequest[]): void {
    const now = this.now()
    const next = list.filter(r => now - r.at < REQUEST_WINDOW_MS).sort((a, b) => a.at - b.at || a.lot - b.lot).slice(-80)
    const key = JSON.stringify(next)
    if (key === this.requestKey) return
    this.requests = next
    this.requestKey = key
    for (const m of this.members.values()) m.send({ t: 'town', requests: this.requests })
  }

  private recOf(id: string): SimRecord | undefined {
    return this.state.household.sims.find(s => s.id === id || `h-${s.id}` === id)
  }

  private callsFor(job: JobId, cache?: Map<JobId, TownCall[]>): TownCall[] {
    const hit = cache?.get(job)
    if (hit) return hit
    const calls = callsAt(this.state.street, this.now(), this.requests).filter(c => c.jobs.includes(job))
    cache?.set(job, calls)
    return calls
  }

  private setJob(member: Member, simId: string, job: JobId | null): void {
    if (member.role !== 'owner') return
    const rec = this.recOf(simId)
    if (!rec) return
    if (rec.work) return member.send({ t: 'notice', text: `${rec.name} is on a shift. Change jobs after it ends.` })
    if (job === null) {
      if (rec.career) member.send({ t: 'notice', text: `${rec.name} left the ${JOBS[rec.career.job].title.toLowerCase()} job.` })
      rec.career = null
    } else {
      const def = jobDef(job)
      if (!def || rec.career?.job === job) return
      rec.career = newCareer(job)
      member.send({ t: 'notice', text: `${rec.name} joined ${PLACES[def.place].name} as a ${jobTitle(job, 1)}.` })
    }
    this.hooks.dirty?.()
  }

  private goToWork(member: Member, simId: string): void {
    if (member.role !== 'owner') return
    const rec = this.recOf(simId)
    if (!rec?.career || rec.work || rec.trip || rec.away) return
    const live = this.sims.get(`h-${rec.id}`)
    if (!live) return
    if (rec.needs.energy < 15 || rec.needs.hunger < 12) return this.say(live, 'I need to eat and rest before a shift.')
    this.dropSim(live)
    for (const m of this.members.values()) m.sims = m.sims.filter(id => id !== live.id)
    rec.work = startShift(rec.career.job, this.now())
    member.send({ t: 'notice', text: `${rec.name} headed to ${PLACES[JOBS[rec.career.job].place].name} for a shift.` })
    this.hooks.dirty?.()
    this.hooks.important?.()
  }

  private startTask(member: Member, simId: string, taskId: string): void {
    if (member.role !== 'owner') return
    const rec = this.recOf(simId)
    const work = rec?.work
    if (!rec || !work) return
    const now = this.now()
    settleTask(work, now)
    const result = beginTask(work, taskId, now, this.callsFor(work.job))
    if (typeof result === 'string') return member.send({ t: 'notice', text: result })
    work.task = result
    this.hooks.dirty?.()
    if (result.call) this.hooks.important?.()
  }

  private endShift(rec: SimRecord, early: boolean): void {
    const work = rec.work
    if (!work) return
    const now = this.now()
    if (work.task && !early) settleTask(work, Math.max(now, work.task.ends))
    work.task = null
    const career = rec.career && rec.career.job === work.job ? rec.career : newCareer(work.job)
    const result = finishShift(career, work, rec.needs, now)
    rec.career = career
    rec.work = null
    this.state.household.funds += result.pay
    this.bringHome(rec)
    const text = `${rec.name} is home from ${early ? 'a short shift' : 'work'}: earned $${result.pay} (${perfLabel(result.perf).toLowerCase()} shift).${result.promoted ? ` Promoted to ${result.promoted}!` : ''}`
    this.owner?.send({ t: 'notice', text })
    this.hooks.dirty?.()
    this.hooks.important?.()
  }

  private bringHome(rec: SimRecord): void {
    const door = this.grid.exteriorDoors()[0]
    if (door) { rec.x = door.outside[0]; rec.z = door.outside[1] }
    const owner = this.owner
    if (owner && !this.sims.has(`h-${rec.id}`)) {
      const sim = this.spawn(rec, true, owner.id)
      owner.sims.push(sim.id)
      if (door) this.enqueue(sim, { kind: 'go', x: door.inside[0], z: door.inside[1] })
    }
  }

  private order(member: Member, kind: keyof typeof SERVICES, simId?: string): void {
    if (member.role !== 'owner') return
    const def = SERVICES[kind]
    if (!def) return
    const now = this.now()
    const orders = this.state.household.orders
    const say = (text: string) => member.send({ t: 'notice', text })
    if (orders.some(o => o.kind === kind && !o.done)) return say(`${def.label} is already on the way.`)
    if (def.cost === 0 && orders.some(o => o.kind === kind && now - o.at < SERVICE_COOLDOWN)) return say(`You called ${def.label} a few minutes ago. Try again a little later.`)
    if (def.cost > this.state.household.funds) return say('The household cannot afford that right now.')
    let sim: string | null = null
    if (def.needsSim) {
      const rec = simId ? this.recOf(simId) : undefined
      if (!rec || rec.work || rec.trip || rec.away || !this.sims.has(`h-${rec.id}`)) return say('Pick a resident who is at home.')
      sim = rec.id
    }
    const request: TownRequest = { lot: this.state.lot, kind, at: now, by: this.state.household.name }
    const eta = serviceEta(this.state.street, this.requests, request)
    this.setRequests([...this.requests, request])
    this.hooks.requested?.(request)
    orders.push({ kind, at: now, eta, sim, done: false })
    if (orders.length > 20) orders.splice(0, orders.length - 20)
    this.state.household.funds = Math.max(0, this.state.household.funds - def.cost)
    say(`${def.label} is on the way, about ${Math.max(5, Math.round((eta - now) / 1000))} seconds out.`)
    this.hooks.dirty?.()
    this.hooks.important?.()
  }

  private deliver(kind: keyof typeof SERVICES, simId: string | null, now: number): void {
    const home = this.state.household.sims.filter(s => !s.work && !s.trip && !s.away)
    const owner = this.owner
    const live = (rec: SimRecord) => this.sims.get(`h-${rec.id}`)
    switch (kind) {
      case 'food':
        for (const rec of home) {
          rec.needs.hunger = Math.min(100, rec.needs.hunger + 55)
          rec.needs.fun = Math.min(100, rec.needs.fun + 5)
          const sim = live(rec)
          if (sim) this.say(sim, 'Burgers are here!')
        }
        owner?.send({ t: 'notice', text: 'Sunny Side Burgers delivered dinner. Everyone at home ate.' })
        return
      case 'ems':
        for (const rec of home) for (const need of NEEDS) if (rec.needs[need] < 25) rec.needs[need] = 45
        owner?.send({ t: 'notice', text: 'Medic 2 checked everyone over. Anyone running on empty is back on their feet.' })
        return
      case 'resort': {
        const rec = simId ? this.recOf(simId) : undefined
        if (!rec || rec.work || rec.trip || rec.away) { owner?.send({ t: 'notice', text: 'The resort van came by, but nobody was free to go.' }); return }
        const sim = live(rec)
        if (sim) {
          this.dropSim(sim)
          for (const m of this.members.values()) m.sims = m.sims.filter(id => id !== sim.id)
        }
        rec.trip = { kind: 'resort', until: now + RESORT_MS }
        owner?.send({ t: 'notice', text: `${rec.name} hopped on the resort van to Hood Springs.` })
        return
      }
      case 'police': owner?.send({ t: 'notice', text: 'Car 3 checked the house. All quiet on the block.' }); return
      case 'fire': owner?.send({ t: 'notice', text: 'Engine 2 tested the smoke alarms. All good.' }); return
      case 'mow': owner?.send({ t: 'notice', text: 'Greenline 2 is mowing the front yard.' }); return
      case 'city': owner?.send({ t: 'notice', text: 'A City Works crew is patching the road out front.' }); return
    }
  }

  /** Shifts, resort days and service calls run on the real clock, whatever the household speed. */
  private realTime(): void {
    const now = this.now()
    const owner = this.owner
    for (const rec of this.state.household.sims) {
      if (rec.work) {
        const text = settleTask(rec.work, now)
        if (text) { owner?.send({ t: 'notice', text: `${rec.name}: ${text}` }); this.hooks.dirty?.() }
        if (now >= rec.work.until) this.endShift(rec, false)
      }
      if (rec.trip && now >= rec.trip.until) {
        rec.trip = null
        tripReturn(rec.needs)
        this.bringHome(rec)
        owner?.send({ t: 'notice', text: `${rec.name} is back from Hood Springs, rested and happy.` })
        this.hooks.dirty?.()
      }
    }
    const orders = this.state.household.orders
    for (const order of orders) {
      if (order.done || now < order.eta) continue
      order.done = true
      this.deliver(order.kind, order.sim, now)
      this.hooks.dirty?.()
    }
    const keep = orders.filter(o => !o.done || now - o.at < 2 * 60 * 60 * 1000)
    if (keep.length !== orders.length) this.state.household.orders = keep
  }

  private careerView(rec: SimRecord): CareerView | null {
    const c = rec.career
    if (!c) return null
    return { job: c.job, level: c.level, title: jobTitle(c.job, c.level), xp: c.xp, next: xpForNext(c.level), shifts: c.shifts, last: c.last }
  }

  private workViews(cache: Map<JobId, TownCall[]>): { work: WorkView[]; away: AwayView[]; orders: OrderView[] } {
    const work: WorkView[] = []
    const away: AwayView[] = []
    for (const rec of this.state.household.sims) {
      const w = rec.work
      if (w) {
        const career = this.careerView(rec) ?? { job: w.job, level: 1, title: jobTitle(w.job, 1), xp: 0, next: xpForNext(1), shifts: 0, last: null }
        work.push({
          id: rec.id, name: rec.name, look: rec.look, career, start: w.start, until: w.until, perf: Math.round(w.perf), earned: w.earned,
          task: w.task ? { id: w.task.id, label: w.task.label, starts: w.task.starts, ends: w.task.ends } : null,
          counts: w.counts,
          calls: this.callsFor(w.job, cache).filter(c => !w.calls.includes(c.id)).map(c => ({ id: c.id, label: c.label })),
        })
      }
      if (rec.trip) away.push({ id: rec.id, name: rec.name, until: rec.trip.until, where: 'Hood Springs Resort' })
    }
    const orders = this.state.household.orders.filter(o => !o.done).map(o => ({ kind: o.kind, eta: o.eta, sim: o.sim }))
    return { work, away, orders }
  }

  private build(member: Member, op: BuildOp): void {
    if (member.role !== 'owner') return member.send({ t: 'notice', text: 'Only the household can build here.' })
    const draft: LotState = JSON.parse(JSON.stringify(this.state))
    const result = applyBuild(draft, this.grid, op, this.state.household.funds)
    if (!result.ok) return member.send({ t: 'notice', text: result.error ?? 'That cannot be built there.' })
    const after = new LotGrid(draft)
    const touched = new Set(result.tiles)
    const touchesInside = [...touched].some(t => this.grid.inside[t] === 1 || after.inside[t] === 1)
    const touchesOutside = [...touched].some(t => this.grid.inside[t] === 0 || after.inside[t] === 0)
    for (const sim of this.sims.values()) {
      if (sim.hh) continue
      const insideNow = this.grid.isInside(sim.tile[0], sim.tile[1])
      if (insideNow && touchesInside) return member.send({ t: 'notice', text: 'Wait until your guests step outside before changing the inside.' })
      if (!insideNow && touchesOutside) return member.send({ t: 'notice', text: 'Wait until the yard is clear of visitors before changing it.' })
    }
    this.state.walls = draft.walls
    this.state.doors = draft.doors
    this.state.windows = draft.windows
    this.state.floors = draft.floors
    this.state.objects = draft.objects
    this.state.nextObjectId = draft.nextObjectId
    this.state.style = draft.style
    this.state.features = draft.features
    this.state.nextFeatureId = draft.nextFeatureId
    this.state.household.funds = Math.max(0, this.state.household.funds - result.cost)
    this.grid = after
    this.lotVersion++
    for (const sim of this.sims.values()) {
      const usedGone = sim.act?.obj !== undefined && !this.grid.objects.has(sim.act.obj)
      if (usedGone || (sim.act?.obj !== undefined && touched.has(tileIndex(sim.tile[0], sim.tile[1])))) this.endActivity(sim, true)
      sim.queue = sim.queue.filter(t => t.kind !== 'use' || this.grid.objects.has(t.obj))
      if (!walkable(this.grid, sim.tile[0], sim.tile[1], this.rules(sim))) {
        const spot = nearestWalkable(this.grid, sim.tile[0], sim.tile[1], this.rules(sim))
        if (spot) this.place(sim, spot)
      }
      if (sim.path.length) {
        sim.path = []
        if (sim.act?.stage === 'walk') this.endActivity(sim, false)
      }
    }
    this.broadcastLot()
    this.hooks.dirty?.()
  }

  private place(sim: SimRt, tile: [number, number]): void {
    sim.tile = [tile[0], tile[1]]
    sim.x = tile[0]
    sim.z = tile[1]
    sim.path = []
  }

  private enqueue(sim: SimRt, task: Task): void {
    if (sim.act && (('auto' in sim.act.task && sim.act.task.auto) || sim.act.task.kind === 'go')) this.endActivity(sim, true)
    if (sim.queue.length >= MAX_QUEUE) sim.queue.shift()
    sim.queue.push(task)
  }

  private say(sim: SimRt, text: string): void {
    sim.bubble = text
    sim.bubbleFor = 4
  }

  private answerKnock(visitor: Member, allow: boolean): void {
    const sim = this.sims.get(visitor.sims[0] ?? '')
    if (sim?.act?.task.kind === 'knock') this.endActivity(sim, false)
    if (!allow) {
      visitor.send({ t: 'notice', text: 'Nobody came to the door. Maybe another time.' })
      return
    }
    this.setGuest(visitor, true, `${this.owner?.name ?? 'The owner'} opened the door. Come on in!`)
    if (sim) {
      const door = this.nearestDoor(sim)
      if (door) this.enqueue(sim, { kind: 'go', x: door.inside[0], z: door.inside[1] })
    }
  }

  /** Drops a waiting knock and takes the prompt off the owner's screen. */
  private closeKnock(memberId: string): void {
    if (!this.pendingKnocks.delete(memberId)) return
    this.owner?.send({ t: 'knockEnd', id: memberId })
  }

  private setGuest(member: Member, guest: boolean, notice: string | null): void {
    member.guest = guest
    if (!guest) {
      for (const simId of member.sims) {
        const sim = this.sims.get(simId)
        if (!sim) continue
        sim.queue = sim.queue.filter(t => {
          if (t.kind === 'go') return !this.grid.isInside(t.x, t.z)
          if (t.kind === 'use') { const o = this.grid.objects.get(t.obj); return !!o && !this.grid.objectInside(o) }
          return t.kind !== 'chat'
        })
        const used = sim.act?.obj !== undefined ? this.grid.objects.get(sim.act.obj) : undefined
        const actInside = !!used && this.grid.objectInside(used)
        if (actInside || this.grid.isInside(sim.tile[0], sim.tile[1]) || sim.path.some(([x, z]) => this.grid.isInside(x, z))) this.endActivity(sim, true)
        if (this.grid.isInside(sim.tile[0], sim.tile[1])) {
          const door = this.nearestDoor(sim)
          const spot = door ? door.outside : nearestWalkable(this.grid, 10, 0, { inside: false })
          if (spot) this.place(sim, spot)
          this.say(sim, 'See you soon!')
        }
      }
    }
    member.send({ t: 'guest', guest })
    member.send({ t: 'lot', lot: this.lotView(member) })
    if (notice) member.send({ t: 'notice', text: notice })
    this.broadcastPeople()
  }

  private nearestDoor(sim: SimRt) {
    let best: ReturnType<LotGrid['exteriorDoors']>[number] | null = null
    let bestD = Infinity
    for (const door of this.grid.exteriorDoors()) {
      const d = Math.hypot(door.outside[0] - sim.x, door.outside[1] - sim.z)
      if (d < bestD) { bestD = d; best = door }
    }
    return best
  }

  private seatsTaken(objId: number, except: SimRt): number[] {
    const taken: number[] = []
    for (const other of this.sims.values()) if (other !== except && other.act?.obj === objId && other.act.seat !== undefined) taken.push(other.act.seat)
    return taken
  }

  private start(sim: SimRt, task: Task): boolean {
    const rules = this.rules(sim)
    switch (task.kind) {
      case 'go': {
        const path = findPath(this.grid, sim.tile, [[task.x, task.z]], rules)
        if (!path) { if (!task.auto) this.say(sim, 'I can\'t get there.'); return false }
        sim.path = path
        sim.act = { task, stage: 'walk', minutes: 0, label: task.auto ? 'Wandering' : 'Walking' }
        return true
      }
      case 'use': {
        const object = this.grid.objects.get(task.obj)
        const def = object && objectDef(object.def)
        const action = def && actionDef(def, task.act)
        if (!object || !def || !action) return false
        const blocked = this.canUse(sim, object, action)
        if (blocked) { if (!task.auto) this.say(sim, blocked); return false }
        const seats = def.seats ?? 1
        const taken = this.seatsTaken(object.id, sim)
        if (taken.length >= seats) { if (!task.auto) this.say(sim, 'Someone is using that.'); return false }
        let seat = 0
        while (taken.includes(seat)) seat++
        const busy = new Set<number>()
        for (const other of this.sims.values()) if (other !== sim && other.act?.obj !== undefined && other.act.stage === 'do' && other.pose === 'stand') busy.add(tileIndex(other.tile[0], other.tile[1]))
        const access = this.grid.accessTiles(object)
        const path = findPath(this.grid, sim.tile, access, { ...rules, blocked: busy })
        if (!path) { if (!task.auto) this.say(sim, 'I can\'t reach that.'); return false }
        sim.path = path
        sim.act = { task, stage: 'walk', minutes: action.minutes, label: action.label, obj: object.id, seat, action }
        return true
      }
      case 'chat': {
        const target = this.sims.get(task.target)
        if (!target) return false
        const goals: [number, number][] = []
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) goals.push([target.tile[0] + dx, target.tile[1] + dz])
        const path = findPath(this.grid, sim.tile, goals, rules)
        if (!path) { if (!task.auto) this.say(sim, 'I can\'t reach them.'); return false }
        sim.path = path
        sim.act = { task, stage: 'walk', minutes: CHAT_MINUTES, label: `Chat with ${target.rec.name}`, partner: target.id }
        return true
      }
      case 'knock': {
        const doors = this.grid.exteriorDoors()
        if (!doors.length) { this.say(sim, 'There is no front door to knock on.'); return false }
        const path = findPath(this.grid, sim.tile, doors.map(d => d.outside), rules)
        if (!path) { this.say(sim, 'I can\'t reach the door.'); return false }
        sim.path = path
        sim.act = { task, stage: 'walk', minutes: 20, label: 'Knock on the door' }
        return true
      }
    }
  }

  private arrive(sim: SimRt): void {
    const act = sim.act
    if (!act) return
    const task = act.task
    if (task.kind === 'go') { this.endActivity(sim, false); return }
    if (task.kind === 'use') {
      const object = this.grid.objects.get(task.obj)
      if (!object) { this.endActivity(sim, false); return }
      const def = objectDef(object.def)!
      act.stage = 'do'
      sim.pose = act.action?.pose ?? 'stand'
      const [fw, fd] = footprintSize(def, object.r)
      sim.facing = Math.atan2(object.x + fw / 2 - 0.5 - sim.tile[0], object.z + fd / 2 - 0.5 - sim.tile[1])
      return
    }
    if (task.kind === 'chat') {
      const target = this.sims.get(task.target)
      if (!target || Math.hypot(target.x - sim.x, target.z - sim.z) > 1.8) { this.endActivity(sim, false); return }
      const targetBusy = target.act && !(('auto' in target.act.task && target.act.task.auto) || target.act.task.kind === 'go') && target.act.partner !== sim.id
      if (targetBusy) { this.say(sim, `${target.rec.name} is busy.`); this.endActivity(sim, false); return }
      if (target.act) this.endActivity(target, true)
      target.path = []
      act.stage = 'do'
      target.act = { task: { kind: 'chat', target: sim.id, auto: true }, stage: 'do', minutes: CHAT_MINUTES, label: `Chat with ${sim.rec.name}`, partner: sim.id }
      sim.facing = Math.atan2(target.x - sim.x, target.z - sim.z)
      target.facing = Math.atan2(sim.x - target.x, sim.z - target.z)
      this.say(sim, this.rng.next() < 0.5 ? 'How have you been?' : 'Nice to see you!')
      return
    }
    if (task.kind === 'knock') {
      act.stage = 'wait'
      this.say(sim, 'Knock knock!')
      const member = this.members.get(sim.controller)
      const owner = this.owner
      if (!member) return
      if (!owner) {
        member.send({ t: 'notice', text: 'Nobody is home to answer the door.' })
        this.endActivity(sim, false)
        return
      }
      if (this.state.settings.alwaysLetIn.some(p => p.key === member.key)) {
        this.answerKnock(member, true)
        return
      }
      this.pendingKnocks.set(member.id, KNOCK_SECONDS)
      owner.send({ t: 'knock', id: member.id, name: member.name })
    }
  }

  private endActivity(sim: SimRt, interrupted: boolean): void {
    const act = sim.act
    sim.act = null
    sim.pose = 'stand'
    if (interrupted) sim.path = []
    if (!act) return
    if (act.partner) {
      const partner = this.sims.get(act.partner)
      if (partner?.act?.partner === sim.id) { partner.act = null; partner.pose = 'stand' }
    }
    if (act.task.kind === 'knock') this.closeKnock(sim.controller)
    sim.rest = 1 + this.rng.next() * 3
  }

  tick(seconds: number): void {
    const speed = this.effectiveSpeed()
    const minutes = seconds * speed
    if (this.ownerHome) this.state.clock += minutes
    const funds = { value: this.state.household.funds }
    for (const sim of this.sims.values()) {
      sim.bubbleFor = Math.max(0, sim.bubbleFor - seconds)
      if (!sim.bubbleFor) sim.bubble = ''
      if (speed === 0) continue
      if (!sim.hh) sim.visitMinutes += minutes
      this.move(sim, seconds * Math.min(speed, 2))
      this.live(sim, minutes, funds)
    }
    if (this.ownerHome) this.state.household.funds = Math.max(0, Math.round(funds.value * 100) / 100)
    this.realTime()
    for (const [id, left] of [...this.pendingKnocks]) {
      const next = left - seconds
      if (next > 0) { this.pendingKnocks.set(id, next); continue }
      this.closeKnock(id)
      const member = this.members.get(id)
      if (member) this.answerKnock(member, false)
    }
  }

  private move(sim: SimRt, seconds: number): void {
    let budget = WALK_TILES_PER_SECOND * seconds
    while (budget > 0 && sim.path.length) {
      const [tx, tz] = sim.path[0]
      const dx = tx - sim.x, dz = tz - sim.z
      const dist = Math.hypot(dx, dz)
      if (dist > 0.001) sim.facing = Math.atan2(dx, dz)
      if (dist <= budget) {
        sim.x = tx
        sim.z = tz
        sim.tile = [tx, tz]
        sim.path.shift()
        budget -= dist
      } else {
        sim.x += (dx / dist) * budget
        sim.z += (dz / dist) * budget
        budget = 0
      }
    }
    if (!sim.path.length && sim.act?.stage === 'walk') this.arrive(sim)
  }

  private live(sim: SimRt, minutes: number, funds: { value: number }): void {
    const needs = sim.rec.needs
    decayNeeds(needs, minutes)
    const act = sim.act
    if (act?.stage === 'do') {
      const action = act.action
      const gains = action?.gains ?? (act.partner ? { social: 0.9, fun: 0.2 } : {})
      for (const need of NEEDS) {
        const gain = gains[need]
        if (gain) needs[need] = clampNeed(needs[need] + gain * minutes)
      }
      if (act.partner) {
        const partner = this.sims.get(act.partner)
        if (partner && sim.id < partner.id) {
          const key = [this.friendKey(sim), this.friendKey(partner)].sort().join('|')
          this.state.friendships[key] = Math.min(100, (this.state.friendships[key] ?? 0) + 0.12 * minutes)
        }
      }
      if (action?.money && sim.hh) {
        if (action.money < 0 && funds.value <= 0) { this.say(sim, 'We can\'t afford that.'); this.endActivity(sim, false); return }
        funds.value += action.money * minutes
      }
      act.minutes -= minutes
      const feeding = Object.entries(gains).filter(([, g]) => (g ?? 0) > 0).map(([n]) => n as keyof Needs)
      const full = feeding.length > 0 && feeding.every(n => needs[n] >= 99.5) && !action?.money
      if (act.minutes <= 0 || full) this.endActivity(sim, false)
    }
    if (needs.bladder <= 0) {
      needs.bladder = 45
      needs.hygiene = Math.max(0, needs.hygiene - 40)
      this.say(sim, 'Oh no... that was embarrassing.')
    }
    if (needs.energy <= 0 && sim.act?.label !== 'Passed out') {
      this.endActivity(sim, true)
      sim.act = { task: { kind: 'go', x: sim.tile[0], z: sim.tile[1], auto: true }, stage: 'do', minutes: 60, label: 'Passed out', action: { id: 'faint', label: 'Passed out', minutes: 60, gains: { energy: 0.6 }, pose: 'lie', guest: 'yes' } }
      sim.pose = 'lie'
      this.say(sim, 'Zzz...')
    }
    if (sim.act) return
    if (sim.queue.length) {
      const task = sim.queue.shift()!
      if (!this.start(sim, task)) sim.rest = 0.5
      return
    }
    sim.rest -= minutes
    if (sim.rest > 0) return
    this.autonomy(sim)
  }

  private friendKey(sim: SimRt): string {
    if (sim.hh) return `h:${sim.rec.id}`
    const member = this.members.get(sim.controller)
    return `v:${member?.name ?? sim.rec.name}`
  }

  private autonomy(sim: SimRt): void {
    const needs = sim.rec.needs
    const options: { task: Task; score: number }[] = []
    for (const object of this.grid.objects.values()) {
      const def = objectDef(object.def)
      if (!def) continue
      const dist = Math.hypot(object.x - sim.x, object.z - sim.z)
      for (const action of def.actions) {
        if (action.money) continue
        if (this.canUse(sim, object, action)) continue
        let score = 0
        for (const need of NEEDS) {
          const gain = action.gains[need] ?? 0
          if (gain > 0) score += Math.min(gain, 2.5) * urgency(needs[need])
        }
        if (action.id === 'sleep') score *= needs.energy < 35 || this.isNight() ? 1.6 : 0.4
        score -= dist * 0.012
        if (score > 0.12) options.push({ task: { kind: 'use', obj: object.id, act: action.id, auto: true }, score })
      }
    }
    for (const other of this.sims.values()) {
      if (other === sim) continue
      if (!this.canEnter(sim) && this.grid.isInside(other.tile[0], other.tile[1])) continue
      const dist = Math.hypot(other.x - sim.x, other.z - sim.z)
      const busy = other.act && !(('auto' in other.act.task && other.act.task.auto) || other.act.task.kind === 'go')
      if (busy) continue
      const score = 1.1 * urgency(needs.social) + 0.15 - dist * 0.015
      if (score > 0.12) options.push({ task: { kind: 'chat', target: other.id, auto: true }, score })
    }
    options.sort((a, b) => b.score - a.score)
    const top = options.slice(0, 3)
    if (!top.length || this.rng.next() < 0.15) {
      sim.rest = 15 + this.rng.next() * 30
      if (this.rng.next() < 0.5) {
        const rules = this.rules(sim)
        for (let tries = 0; tries < 6; tries++) {
          const x = Math.max(0, Math.min(19, sim.tile[0] + Math.round((this.rng.next() - 0.5) * 8)))
          const z = Math.max(0, Math.min(23, sim.tile[1] + Math.round((this.rng.next() - 0.5) * 8)))
          if (walkable(this.grid, x, z, rules)) { this.start(sim, { kind: 'go', x, z, auto: true }); break }
        }
      }
      return
    }
    const total = top.reduce((sum, o) => sum + o.score, 0)
    let roll = this.rng.next() * total
    for (const option of top) {
      roll -= option.score
      if (roll <= 0) {
        if (!this.start(sim, option.task)) sim.rest = 5
        return
      }
    }
  }

  isNight(): boolean {
    const hour = (Math.floor(this.state.clock / 60) + 8) % 24
    return hour >= 22 || hour < 6
  }

  private settingsView(): SettingsView {
    const s = this.state.settings
    return { yardOpen: s.yardOpen, guestsUseFridgeBeds: s.guestsUseFridgeBeds, alwaysLetIn: s.alwaysLetIn.map(p => p.name), blocked: s.blocked.map(p => p.name) }
  }

  lotView(member: { role: string; guest: boolean }): LotView {
    const entitled = member.role === 'owner' || member.guest
    if (this.views.version !== this.lotVersion) this.views = { version: this.lotVersion }
    const cached = entitled ? this.views.entitled : this.views.outside
    if (cached) return cached
    const s = this.state
    const view: LotView = {
      street: s.street, lot: s.lot, address: lotAddress(s.street, s.lot), ownerName: s.ownerName, householdName: s.household.name,
      walls: s.walls, doors: s.doors, windows: s.windows, style: s.style, features: s.features,
      floors: entitled ? s.floors : s.floors.filter(([i]) => !this.grid.inside[i]),
      objects: entitled ? s.objects : s.objects.filter(o => !this.grid.objectInside(o)),
      entitled,
    }
    if (entitled) this.views.entitled = view
    else this.views.outside = view
    return view
  }

  private broadcastLot(): void {
    for (const m of this.members.values()) m.send({ t: 'lot', lot: this.lotView(m), settings: m.role === 'owner' ? this.settingsView() : undefined })
  }

  private broadcastPeople(): void {
    const list = [...this.members.values()]
    for (const m of list) m.send({ t: 'people', people: list.map<MemberView>(p => ({ id: p.id, name: p.name, role: p.role, guest: p.guest, me: p === m })) })
  }

  private simView(sim: SimRt, viewer: Member): SimView {
    const member = this.members.get(sim.controller)
    const mineSim = sim.controller === viewer.id
    const view: SimView = {
      id: sim.id, name: sim.rec.name, look: sim.rec.look, x: Math.round(sim.x * 100) / 100, z: Math.round(sim.z * 100) / 100,
      facing: Math.round(sim.facing * 100) / 100, pose: sim.pose, hh: sim.hh, owner: member?.name ?? '', mine: mineSim,
    }
    if (sim.act) {
      view.act = sim.act.label
      if (sim.act.stage === 'do' && sim.act.obj !== undefined) { view.obj = sim.act.obj; view.seat = sim.act.seat }
    }
    if (sim.bubble) view.bubble = sim.bubble
    if (mineSim) {
      view.needs = { ...sim.rec.needs }
      for (const need of NEEDS) view.needs[need] = Math.round(view.needs[need])
      view.queue = sim.queue.map(t => this.taskLabel(t))
      const friends: { name: string; value: number }[] = []
      for (const other of this.sims.values()) {
        if (other === sim) continue
        const key = [this.friendKey(sim), this.friendKey(other)].sort().join('|')
        const value = this.state.friendships[key]
        if (value) friends.push({ name: other.rec.name, value: Math.round(value) })
      }
      view.friends = friends
      if (sim.hh) view.career = this.careerView(sim.rec)
    }
    return view
  }

  private taskLabel(task: Task): string {
    switch (task.kind) {
      case 'go': return 'Walk here'
      case 'knock': return 'Knock on the door'
      case 'chat': return `Chat with ${this.sims.get(task.target)?.rec.name ?? 'someone'}`
      case 'use': {
        const object = this.grid.objects.get(task.obj)
        const def = object && objectDef(object.def)
        return (def && actionDef(def, task.act)?.label) ?? 'Use'
      }
    }
  }

  /** Sends each person the Sims they may see: someone still in the yard never sees who is inside. */
  broadcastState(): void {
    const speed = this.effectiveSpeed()
    const now = this.now()
    const owner = this.owner
    const extra = owner ? this.workViews(new Map()) : null
    for (const m of this.members.values()) {
      const entitled = this.memberEntitled(m)
      const sims: SimView[] = []
      for (const sim of this.sims.values()) {
        if (!entitled && sim.controller !== m.id && this.grid.isInside(sim.tile[0], sim.tile[1])) continue
        sims.push(this.simView(sim, m))
      }
      const mine = m.role === 'owner' && extra
      m.send({ t: 'state', clock: Math.floor(this.state.clock), speed, funds: m.role === 'owner' ? Math.floor(this.state.household.funds) : undefined, home: this.ownerHome, sims, now, ...(mine ? extra : {}) })
    }
  }

  moodOf(simId: string): number {
    const sim = this.sims.get(simId)
    return sim ? mood(sim.rec.needs) : 0
  }
}
