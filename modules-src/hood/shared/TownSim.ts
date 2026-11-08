/**
 * The working town as a pure function of the clock: every vehicle, worker, call and fire follows from the street number, the time and
 * the service calls households made. Nothing ticks on a server, so the town keeps working with nobody watching, and every page agrees.
 */
import { JOBS, SERVICES, type JobId, type ServiceKind } from './Jobs'
import type { Look } from './Look'
import { LOTS_PER_STREET, lotAddress, streetName } from './Street'
import { alongPath, route, type Path } from './Drive'
import { PLACES, STREET_ORDER, frontYard, lampSpot, stopSpot, type PlaceId, type Spot, type Stop } from './Town'

export const SLOT_SECONDS = 240
export const REQUEST_WINDOW_MS = 60 * 60 * 1000

export type VehicleKind = 'cruiser' | 'engine' | 'ambulance' | 'lawntruck' | 'garbage' | 'utility' | 'pickup' | 'delivery' | 'shuttle' | 'tanker' | 'bus'
export type WorkerRole = JobId | 'inmate' | 'patient' | 'guest' | 'suspect' | 'driver'
export type Tool = 'hose' | 'clipboard' | 'trimmer' | 'bag' | 'wrench' | 'tray' | 'cone' | 'shovel' | 'none'
export type Pose = 'stand' | 'sit' | 'lie'

export interface TownRequest {
  lot: number
  kind: ServiceKind
  at: number
  by?: string
}

export interface PlayerWorker {
  name: string
  look: Look
  job: JobId
  level: number
  lot: number
  call?: string | null
}

export interface VehicleView {
  id: string
  kind: VehicleKind
  label: string
  x: number
  z: number
  yaw: number
  lights: boolean
  moving: boolean
  act: string
  bucket: number
  /** Signed speed in m/s (negative while reversing), acceleration along the body and to its right, front wheel angle and trailer angle. */
  speed: number
  accel: number
  lat: number
  steer: number
  trailer: number
}

export interface WorkerView {
  id: string
  role: WorkerRole
  name: string
  x: number
  z: number
  yaw: number
  walking: number
  pose: Pose
  /** Height of whatever the worker sits or lies on. */
  y: number
  act: string
  tool: Tool
  look: Look
  player?: boolean
}

export interface TownCall {
  id: string
  jobs: JobId[]
  label: string
  start: number
  end: number
  x: number
  z: number
}

export interface FeedItem {
  at: number
  text: string
  kind: 'fire' | 'medical' | 'crime' | 'crash' | 'routine' | 'service'
}

export interface TownState {
  now: number
  vehicles: VehicleView[]
  workers: WorkerView[]
  fires: { lot: number; x: number; z: number; size: number; smoke: number }[]
  sprays: { x: number; z: number; tx: number; tz: number }[]
  mowers: { x: number; z: number; yaw: number }[]
  wrecks: { x: number; z: number; yaw: number; color: number }[]
  bags: { x: number; z: number }[]
  lawns: number[]
  calls: TownCall[]
  feed: FeedItem[]
  status: Record<PlaceId, string>
}

export function hash(...values: number[]): number {
  let h = 2166136261
  for (const v of values) {
    h = Math.imul(h ^ (Math.floor(v) | 0), 16777619)
    h ^= h >>> 13
    h = Math.imul(h, 0x5bd1e995)
  }
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

const LAST = ['Reyes', 'Okafor', 'Lindqvist', 'Patel', 'Brooks', 'Nakamura', 'Ellis', 'Moreau', 'Haddad', 'Kowalski', 'Santos', 'Fitzgerald', 'Abebe', 'Larsen', 'Duarte', 'Whitfield', 'Chen', 'Rourke', 'Adeyemi', 'Vance', 'Ortega', 'Sato', 'Bianchi', 'McCall', 'Novak', 'Hargrove', 'Quinn', 'Delgado', 'Ivanova', 'Tran']
const FIRST = ['Maya', 'Theo', 'Rosa', 'Dev', 'Hana', 'Owen', 'Lena', 'Marcus', 'Iris', 'Caleb', 'Nia', 'Felix', 'Ana', 'Jonah', 'Priya', 'Sam', 'Wren', 'Luis', 'June', 'Malik']
const PREFIX: Record<WorkerRole, string> = {
  police: 'Officer', firefighter: 'FF', lawn: '', guard: 'C.O.', resort: '', city: '', gas: '', food: '', ems: 'Medic', nurse: 'Nurse',
  inmate: 'Inmate', patient: '', guest: '', suspect: '', driver: '',
}
const STYLES = ['short', 'long', 'bun', 'curly', 'bald'] as const

function npcLook(street: number, salt: number): Look {
  const r = (n: number) => hash(street, salt, n)
  return {
    skin: Math.floor(r(1) * 6), hair: Math.floor(r(2) * 8), hairStyle: STYLES[Math.floor(r(3) * 5)], top: Math.floor(r(4) * 10), bottom: Math.floor(r(5) * 10),
    build: (['slim', 'average', 'broad'] as const)[Math.floor(r(6) * 3)], height: 0.93 + r(7) * 0.15,
    body: r(8) < 0.5 ? 'masculine' : 'feminine',
  }
}

function npcName(street: number, role: WorkerRole, salt: number): string {
  const last = LAST[Math.floor(hash(street, salt, 11) * LAST.length)]
  const first = FIRST[Math.floor(hash(street, salt, 12) * FIRST.length)]
  if (role === 'inmate') return `#${4000 + Math.floor(hash(street, salt, 13) * 5000)}`
  const prefix = PREFIX[role]
  return prefix ? `${prefix} ${last}` : `${first} ${last}`
}

interface Person {
  id: string
  role: WorkerRole
  name: string
  look: Look
}

function person(street: number, id: string, role: WorkerRole, salt: number): Person {
  return { id, role, name: npcName(street, role, salt), look: npcLook(street, salt) }
}

interface Slot {
  who: Person
  x: number
  z: number
  yaw: number
  walking?: number
  pose?: Pose
  y?: number
  act: string
  tool?: Tool
}

type CrewFn = (u: number, d: number, at: Spot) => Slot[]

interface Effects {
  fire?: { lot: number; size: number; smoke: number }
  sprays?: { x: number; z: number; tx: number; tz: number }[]
  mower?: { x: number; z: number; yaw: number }
  wrecks?: { x: number; z: number; yaw: number; color: number }[]
  bags?: { x: number; z: number }[]
}

type Leg = { t0: number; t1: number; label: string; lights: boolean } & (
  | { kind: 'drive'; path: Path }
  | { kind: 'stay'; at: Spot; park: Spot; crew?: CrewFn; fx?: (u: number, d: number) => Effects; hidden?: boolean; bucket?: boolean; idle?: boolean }
)

class Plan {
  readonly legs: Leg[] = []
  t: number
  stop: Stop
  arrivals: number[] = []
  readonly kind: VehicleKind
  /** Where the vehicle is and which way it faces, which can differ from the stop's own heading after pulling in from the other direction. */
  pose: Spot

  constructor(start: number, stop: Stop, kind: VehicleKind) {
    this.t = start
    this.stop = stop
    this.kind = kind
    this.pose = stopSpot(stop)
  }

  drive(to: Stop, label: string, lights = false): this {
    const path = route(this.stop, to, lights, this.kind, this.pose)
    this.legs.push({ kind: 'drive', t0: this.t, t1: this.t + path.duration, label, lights, path })
    this.t += path.duration
    this.stop = to
    this.pose = path.end
    this.arrivals.push(this.t)
    return this
  }

  stay(seconds: number, label: string, extra: Partial<Extract<Leg, { kind: 'stay' }>> = {}): this {
    this.legs.push({ kind: 'stay', t0: this.t, t1: this.t + seconds, label, lights: false, at: stopSpot(this.stop), park: this.pose, ...extra })
    this.t += seconds
    return this
  }

  until(time: number, label: string, extra: Partial<Extract<Leg, { kind: 'stay' }>> = {}): this {
    if (time > this.t) this.stay(time - this.t, label, extra)
    return this
  }

  find(t: number): Leg | null {
    for (const leg of this.legs) if (t >= leg.t0 && t < leg.t1) return leg
    return null
  }

  get end(): number {
    return this.t
  }
}

function rel(at: Spot, right: number, forward: number): [number, number] {
  return [at.x - Math.cos(at.yaw) * right + Math.sin(at.yaw) * forward, at.z + Math.sin(at.yaw) * right + Math.cos(at.yaw) * forward]
}

function face(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z)
}

/** Walks out to a spot at the start of a stay and back at the end. */
function walkTo(who: Person, from: [number, number], to: [number, number], yaw: number, u: number, d: number, act: string, tool: Tool = 'none', pose: Pose = 'stand'): Slot {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1])
  const w = Math.min(dist / 1.6, d / 3)
  if (w > 0.05 && u < w) {
    const f = u / w
    return { who, x: from[0] + (to[0] - from[0]) * f, z: from[1] + (to[1] - from[1]) * f, yaw: face(from[0], from[1], to[0], to[1]), walking: 1, act, tool: tool === 'hose' ? 'none' : tool }
  }
  if (w > 0.05 && u > d - w) {
    const f = (d - u) / w
    return { who, x: from[0] + (to[0] - from[0]) * f, z: from[1] + (to[1] - from[1]) * f, yaw: face(to[0], to[1], from[0], from[1]), walking: 1, act, tool: tool === 'hose' ? 'none' : tool }
  }
  return { who, x: to[0], z: to[1], yaw, act, tool, pose }
}

/** Paces back and forth between two points. */
function pace(who: Person, a: [number, number], b: [number, number], t: number, period: number, act: string, tool: Tool = 'none', pause = 0.35): Slot {
  const phase = ((t % period) + period) % period / period
  const moving = 1 - pause
  let f: number
  let walking = 1
  if (phase < moving / 2) f = phase / (moving / 2)
  else if (phase < 0.5) { f = 1; walking = 0 }
  else if (phase < 0.5 + moving / 2) f = 1 - (phase - 0.5) / (moving / 2)
  else { f = 0; walking = 0 }
  const forward = phase < 0.5
  const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f
  const yaw = walking ? (forward ? face(a[0], a[1], b[0], b[1]) : face(b[0], b[1], a[0], a[1])) : face(x, z, (a[0] + b[0]) / 2 + 0.01, (a[1] + b[1]) / 2 + 3)
  return { who, x, z, yaw, walking, act, tool }
}

function at(spot: Spot): [number, number] {
  return [spot.x, spot.z]
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function addr(street: number, lot: number): string {
  return lotAddress(street, lot)
}

interface Unit {
  id: string
  kind: VehicleKind
  label: string
  base: Stop
  crew: Person[]
  home: (t: number) => Slot[]
}

interface Incident {
  id: string
  kind: 'fire' | 'medical' | 'crime' | 'crash' | 'spill' | 'fight' | 'pool'
  t0: number
  where: string
  plans: Map<string, Plan>
  calls: TownCall[]
  feed: FeedItem[]
  fx: (t: number) => Effects
  staff: (t: number) => Slot[]
}

const planCache = new Map<string, unknown>()

function cached<T>(key: string, make: () => T): T {
  if (planCache.has(key)) return planCache.get(key) as T
  if (planCache.size > 400) planCache.clear()
  const value = make()
  planCache.set(key, value)
  return value
}

interface Town {
  street: number
  units: Record<string, Unit>
  staff: Record<string, Person>
  inmates: Person[]
  guests: Person[]
}

function makeTown(street: number): Town {
  return cached(`town:${street}`, () => {
    let salt = 100
    const p = (id: string, role: WorkerRole) => person(street, id, role, salt++)
    const staff: Record<string, Person> = {
      desk: p('desk', 'police'), nurse1: p('nurse1', 'nurse'), nurse2: p('nurse2', 'nurse'), guard1: p('guard1', 'guard'), guard2: p('guard2', 'guard'),
      guard3: p('guard3', 'guard'), clerk: p('clerk', 'gas'), cook: p('cook', 'food'), window: p('window', 'food'), manager: p('manager', 'resort'), lifeguard: p('lifeguard', 'resort'),
    }
    const inmates = Array.from({ length: 6 }, (_, i) => p(`inmate${i}`, 'inmate'))
    const guests = Array.from({ length: 6 }, (_, i) => p(`guest${i}`, 'guest'))
    const P = PLACES
    const unit = (id: string, kind: VehicleKind, label: string, base: Stop, crew: Person[], home: (crew: Person[], t: number) => Slot[]): Unit => ({ id, kind, label, base, crew, home: t => home(crew, t) })
    const bench = (crew: Person[], spots: Spot[], act: string, t: number, seed: number) => crew.map((who, i) => {
      const s = spots[i % spots.length]
      const b = spots[(i + 1) % spots.length]
      return hash(street, seed, i) < 0.5 ? { who, x: s.x + i * 0.7, z: s.z, yaw: s.yaw, act } : pace(who, [s.x, s.z], [b.x + 0.5, b.z], t + i * 7, 26, act)
    })
    const units: Record<string, Unit> = {
      p1: unit('p1', 'cruiser', 'Car 1', { kind: 'bay', place: 'police', bay: 'p1' }, [p('p1a', 'police')], (c, t) => bench(c, [P.police.posts.steps, P.police.posts.lot], 'At the station', t, 1)),
      p2: unit('p2', 'cruiser', 'Car 2', { kind: 'bay', place: 'police', bay: 'p2' }, [p('p2a', 'police'), p('p2b', 'police')], (c, t) => bench(c, [P.police.posts.lot, P.police.posts.steps], 'At the station', t, 2)),
      p3: unit('p3', 'cruiser', 'Car 3', { kind: 'bay', place: 'police', bay: 'p3' }, [p('p3a', 'police')], (c, t) => bench(c, [P.police.posts.steps], 'Paperwork', t, 3)),
      e1: unit('e1', 'engine', 'Engine 1', { kind: 'bay', place: 'fire', bay: 'e1' }, [p('e1a', 'firefighter'), p('e1b', 'firefighter'), p('e1c', 'firefighter')], (c, t) => {
        const washing = Math.floor(t / 600) % 2 === 0
        if (washing) return c.map((who, i) => pace(who, rel(P.fire.bays.e1, 1.6, -3 + i * 2.5), rel(P.fire.bays.e1, 1.6, -1 + i * 2.5), t + i * 4, 9, 'Washing Engine 1', i === 0 ? 'hose' : 'none', 0.6))
        return bench(c, [P.fire.posts.bench, P.fire.posts.apron1], 'At the station', t, 4)
      }),
      e2: unit('e2', 'engine', 'Engine 2', { kind: 'bay', place: 'fire', bay: 'e2' }, [p('e2a', 'firefighter'), p('e2b', 'firefighter')], (c, t) => bench(c, [P.fire.posts.apron3, P.fire.posts.bench], 'Checking gear', t, 5)),
      a1: unit('a1', 'ambulance', 'Medic 1', { kind: 'bay', place: 'hospital', bay: 'a1' }, [p('a1a', 'ems'), p('a1b', 'ems')], (c, t) => bench(c, [P.hospital.posts.bay, P.hospital.posts.window], 'Restocking Medic 1', t, 6)),
      a2: unit('a2', 'ambulance', 'Medic 2', { kind: 'bay', place: 'hospital', bay: 'a2' }, [p('a2a', 'ems'), p('a2b', 'ems')], (c, t) => bench(c, [P.hospital.posts.window, P.hospital.posts.garden], 'On standby', t, 7)),
      l1: unit('l1', 'lawntruck', 'Greenline 1', { kind: 'bay', place: 'lawn', bay: 'l1' }, [p('l1a', 'lawn'), p('l1b', 'lawn')], (c, t) => bench(c, [P.lawn.posts.bench, P.lawn.posts.mowers], 'Loading the trailer', t, 8)),
      l2: unit('l2', 'lawntruck', 'Greenline 2', { kind: 'bay', place: 'lawn', bay: 'l2' }, [p('l2a', 'lawn'), p('l2b', 'lawn')], (c, t) => bench(c, [P.lawn.posts.mowers, P.lawn.posts.fuel], 'Sharpening blades', t, 9)),
      g: unit('g', 'garbage', 'Trash Truck 4', { kind: 'bay', place: 'cityworks', bay: 'g' }, [p('ga', 'city'), p('gb', 'city')], (c, t) => bench(c, [P.cityworks.posts.shed, P.cityworks.posts.gate], 'At the yard', t, 10)),
      u: unit('u', 'utility', 'Bucket Truck 2', { kind: 'bay', place: 'cityworks', bay: 'u' }, [p('ua', 'city')], (c, t) => bench(c, [P.cityworks.posts.cones], 'Sorting cones', t, 11)),
      c: unit('c', 'pickup', 'City Pickup 9', { kind: 'bay', place: 'cityworks', bay: 'c' }, [p('ca', 'city'), p('cb', 'city')], (c, t) => bench(c, [P.cityworks.posts.shed, P.cityworks.posts.cones], 'At the yard', t, 12)),
      d1: unit('d1', 'delivery', 'Sunny Side Delivery', { kind: 'bay', place: 'diner', bay: 'd1' }, [p('d1a', 'food')], (c, t) => bench(c, [P.diner.posts.patio], 'Folding boxes', t, 13)),
      d2: unit('d2', 'delivery', 'Sunny Side Delivery 2', { kind: 'bay', place: 'diner', bay: 'd2' }, [p('d2a', 'food')], (c, t) => bench(c, [P.diner.posts.counter], 'Prepping orders', t, 14)),
      s1: unit('s1', 'shuttle', 'Resort Shuttle', { kind: 'bay', place: 'resort', bay: 's1' }, [p('s1a', 'resort')], (c, t) => bench(c, [P.resort.posts.lawn], 'Waiting for guests', t, 15)),
      s2: unit('s2', 'shuttle', 'Resort Van', { kind: 'bay', place: 'resort', bay: 's2' }, [p('s2a', 'resort')], (c, t) => bench(c, [P.resort.posts.desk], 'At the front desk', t, 16)),
      t: unit('t', 'tanker', 'Fuel Tanker', { kind: 'edge', end: 1 }, [p('ta', 'driver')], () => []),
      b: unit('b', 'bus', 'Prison Bus', { kind: 'bay', place: 'prison', bay: 'bus' }, [p('ba', 'guard'), p('bb', 'city')], (c, t) => bench(c, [P.prison.posts.gate], 'At the gate', t, 17)),
    }
    return { street, units, staff, inmates, guests }
  })
}

const PLACE_STOPS: Partial<Record<PlaceId, { stop: Stop; name: string; spot: Spot }>> = {
  diner: { stop: { kind: 'road', x: -108, side: 1 }, name: 'Sunny Side Burgers', spot: PLACES.diner.posts.patio },
  gas: { stop: { kind: 'road', x: -80, side: 1 }, name: 'Hood Fuel & Go', spot: PLACES.gas.posts.island },
  resort: { stop: { kind: 'road', x: -100, side: -1 }, name: 'Hood Springs Resort', spot: PLACES.resort.posts.pool },
  prison: { stop: { kind: 'road', x: 160, side: -1 }, name: 'Kettle Ridge Correctional', spot: PLACES.prison.posts.gate },
}

function drivers(at: Spot, crew: Person[], u: number, d: number, targets: { to: [number, number]; act: string; tool?: Tool; yaw?: number; pose?: Pose }[]): Slot[] {
  return crew.map((who, i) => {
    const t = targets[i % targets.length]
    const from = rel(at, i % 2 ? -1.5 : 1.5, 0.6 - i * 0.8)
    return walkTo(who, from, t.to, t.yaw ?? face(t.to[0], t.to[1], at.x, at.z), u, d, t.act, t.tool, t.pose)
  })
}

function houseSpot(lot: number): Spot {
  return frontYard(lot, 10, 9.5)
}

function doorSpot(lot: number): Spot {
  return frontYard(lot, 8.5, 4.6)
}

function mowPattern(lot: number, u: number, d: number): { x: number; z: number; yaw: number } {
  const rows = 4
  const runs = rows * 2
  const f = Math.max(0, Math.min(0.999, (u - 6) / Math.max(1, d - 12)))
  const row = Math.floor(f * runs)
  const along = (f * runs) % 1
  const lz = 0.9 + (row % rows) * 1.25 + (row >= rows ? 0.6 : 0)
  const back = row % 2 === 1
  const lx = back ? 18.6 - along * 17.2 : 1.4 + along * 17.2
  const s = frontYard(lot, lx, Math.min(lz, 5.2))
  return { x: s.x, z: s.z, yaw: s.yaw + (back ? -Math.PI / 2 : Math.PI / 2) }
}

function mowCrew(at: Spot, crew: Person[], lot: number, u: number, d: number): Slot[] {
  const m = mowPattern(lot, u, d)
  const out: Slot[] = [{ who: crew[0], x: m.x, z: m.z, yaw: m.yaw, act: 'Mowing', pose: 'sit', y: 0.62 }]
  if (crew[1]) {
    const edge = frontYard(lot, 1 + ((u * 0.6) % 18), 0.25)
    out.push(walkTo(crew[1], rel(at, -1.5, 0), [edge.x, edge.z], edge.yaw + Math.PI, u, d, 'Edging the walk', 'trimmer'))
  }
  return out
}

function buildIncident(town: Town, k: number, houses: boolean[]): Incident | null {
  const street = town.street
  const r = (n: number) => hash(street, k, 7000 + n)
  const roll = r(1)
  const kinds: [Incident['kind'] | null, number][] = [['fire', 14], ['medical', 18], ['crime', 18], ['crash', 12], ['spill', 6], ['fight', 6], ['pool', 6], [null, 20]]
  const total = kinds.reduce((s, [, w]) => s + w, 0)
  let pick: Incident['kind'] | null = null
  let acc = 0
  for (const [kind, w] of kinds) { acc += w / total; if (roll < acc) { pick = kind; break } }
  if (!pick) return null
  const t0 = k * SLOT_SECONDS + 8 + r(2) * 28
  const lot = Math.floor(r(3) * LOTS_PER_STREET)
  const U = town.units
  const plans = new Map<string, Plan>()
  const calls: TownCall[] = []
  const feed: FeedItem[] = []
  const id = `${pick}-${k}`
  const staffSlots: ((t: number) => Slot[])[] = []
  let fx: (t: number) => Effects = () => ({})
  let where = addr(street, lot)
  const call = (suffix: string, jobs: JobId[], label: string, start: number, end: number, x: number, z: number) => calls.push({ id: `${id}:${suffix}`, jobs, label, start, end, x, z })

  const transport = (plan: Plan, medics: Person[], patient: Person, escort: Person | null, why: string) => {
    plan.drive({ kind: 'bay', place: 'hospital', bay: 'a1' }, `Taking ${why} to Hood General`, true)
    const arrive = plan.t
    const nurse = town.staff.nurse1
    plan.stay(26, 'Patient handoff to the nurses', {
      crew: (u, d, s) => {
        const bay = PLACES.hospital.posts.bay
        const slots: Slot[] = [
          walkTo(medics[0], rel(s, 0.6, -3.2), [bay.x - 0.8, bay.z + 0.4], face(bay.x, bay.z, bay.x, bay.z + 2), u, d, 'Handing off the patient'),
          { who: patient, x: bay.x, z: bay.z + 0.8, yaw: 0, pose: 'lie', act: 'Being admitted' },
          { who: nurse, x: bay.x + 0.9, z: bay.z + 1.2, yaw: face(bay.x + 0.9, bay.z + 1.2, bay.x, bay.z + 0.8), act: 'Taking the patient', tool: 'clipboard' },
        ]
        if (medics[1]) slots.push(walkTo(medics[1], rel(s, -0.6, -3.2), [bay.x + 0.6, bay.z - 0.5], 0, u, d, 'Writing the run report', 'clipboard'))
        if (escort) slots.push({ who: escort, x: bay.x - 1.4, z: bay.z + 1.6, yaw: 0, act: 'Escorting the inmate' })
        return slots
      },
    })
    const handed = plan.t
    const treatEnd = handed + 60
    staffSlots.push(t => {
      if (t < handed || t >= treatEnd) return []
      const tri = PLACES.hospital.posts.triage
      return [
        { who: patient, x: tri.x, z: tri.z + 1.2, yaw: 0, pose: 'lie', act: 'Resting in triage' },
        { who: town.staff.nurse1, x: tri.x + 0.9, z: tri.z + 1.4, yaw: face(tri.x + 0.9, tri.z + 1.4, tri.x, tri.z + 1.2), act: 'Treating a patient', tool: 'clipboard' },
      ]
    })
    call('nurse', ['nurse'], `Treat the patient from ${why === 'an inmate' ? 'Kettle Ridge' : 'Medic 1'}`, arrive, treatEnd, PLACES.hospital.posts.triage.x, PLACES.hospital.posts.triage.z)
    feed.push({ at: arrive, text: `Medic 1 arrived at Hood General with ${why}.`, kind: 'medical' })
  }

  if (pick === 'fire') {
    const house = houses[lot] !== false
    const label = house ? 'house fire' : 'brush fire'
    const target = house ? houseSpot(lot) : frontYard(lot, 10, 8)
    const engine = new Plan(t0 + 6, U.e1.base, U.e1.kind).drive({ kind: 'curb', lot }, `Responding to a ${label}`, true)
    const onScene = engine.t
    const fight = 72
    engine.stay(fight, `Fighting a ${label}`, {
      lights: true,
      crew: (u, d, s) => drivers(s, U.e1.crew, u, d, [
        { to: [target.x - 2, (s.z + target.z) / 2], act: 'On the hose line', tool: 'hose' },
        { to: [target.x + 2.2, (s.z + target.z) / 2 + (s.z > 0 ? -0.6 : 0.6)], act: 'On the hose line', tool: 'hose' },
        { to: rel(s, 1.6, -2.4), act: 'Running the pump', tool: 'wrench' },
      ]),
    }).drive(U.e1.base, 'Back to Fire Station 7')
    plans.set('e1', engine)
    const police = new Plan(t0 + 12, U.p2.base, U.p2.kind).drive({ kind: 'curb', lot, offset: -9 }, `Traffic control at the ${label}`, true)
    police.stay(58, `Traffic control at ${addr(street, lot)}`, { lights: true, crew: (u, d, s) => drivers(s, U.p2.crew, u, d, [{ to: rel(s, 3.6, -4), act: 'Directing traffic', tool: 'cone' }, { to: rel(s, 3.2, 5), act: 'Keeping neighbors back' }]) })
      .drive(U.p2.base, 'Back to the station')
    plans.set('p2', police)
    const ems = new Plan(t0 + 16, U.a1.base, U.a1.kind).drive({ kind: 'curb', lot, offset: 9 }, 'Standing by at the fire', true)
    const firefighterHurt = r(4) < 0.55
    const patient: Person = { ...U.e1.crew[2], id: `${id}-pt`, role: 'firefighter' }
    ems.stay(34, firefighterHurt ? 'Treating a firefighter' : 'Checking the residents', {
      lights: true,
      crew: (u, d, s) => {
        const spot = rel(s, 3.2, 1)
        const slots = drivers(s, U.a1.crew, u, d, [{ to: [spot[0] - 0.7, spot[1]], act: firefighterHurt ? 'Treating smoke inhalation' : 'Checking the residents', tool: 'clipboard' }, { to: [spot[0] + 0.7, spot[1]], act: 'Taking vitals' }])
        if (firefighterHurt && u > 8) slots.push({ who: patient, x: spot[0], z: spot[1] + 0.5, yaw: 0, pose: 'lie', act: 'Smoke inhalation' })
        return slots
      },
    })
    if (firefighterHurt) transport(ems, U.a1.crew, patient, null, 'a firefighter')
    else ems.drive(U.a1.base, 'Back to Hood General')
    plans.set('a1', ems)
    const out = onScene + fight - 6
    fx = t => {
      if (t < t0 || t > out + 20) return {}
      let size = t < onScene ? 0.35 + 0.65 * Math.min(1, (t - t0) / Math.max(1, onScene - t0)) : Math.max(0, 1 - (t - onScene) / (out - onScene - 10))
      if (t > out) size = 0
      const smoke = t < out ? Math.max(0.3, size) : Math.max(0, 1 - (t - out) / 20) * 0.5
      const sprays = t > onScene + 4 && t < out ? [-2, 2.2].map(dx => ({ x: target.x + dx, z: (stopSpot({ kind: 'curb', lot }).z + target.z) / 2, tx: target.x + dx * 0.4, tz: target.z })) : []
      return { fire: { lot, size, smoke }, sprays }
    }
    call('fire', ['firefighter'], `Fight the ${label} at ${addr(street, lot)}`, t0, out, target.x, target.z)
    call('traffic', ['police'], `Traffic control at the ${label}`, t0, police.end - 10, target.x, target.z)
    call('ems', ['ems'], `Stand by at the ${label}`, t0, ems.legs[1]?.t1 ?? t0 + 60, target.x, target.z)
    feed.push({ at: t0, text: `${house ? 'House fire' : 'Brush fire'} reported at ${addr(street, lot)}. Engine 1, Car 2 and Medic 1 responding.`, kind: 'fire' })
    feed.push({ at: onScene, text: `Engine 1 is on scene at ${addr(street, lot)}.`, kind: 'fire' })
    feed.push({ at: out, text: `The fire at ${addr(street, lot)} is out.`, kind: 'fire' })
  } else if (pick === 'medical' || pick === 'pool') {
    const atResort = pick === 'pool'
    const place = atResort ? PLACE_STOPS.resort! : null
    const stop: Stop = place ? place.stop : { kind: 'curb', lot, offset: 4 }
    where = place ? place.name : addr(street, lot)
    const reason = atResort ? 'a swimmer who slipped on the pool deck' : (['a resident with chest pain', 'a fall in the kitchen', 'an allergic reaction', 'a sprained ankle'] as const)[Math.floor(r(5) * 4)]
    const patient: Person = { id: `${id}-pt`, role: 'patient', name: atResort ? 'Resort guest' : 'Resident', look: npcLook(street, k * 13 + 5) }
    const ems = new Plan(t0 + 6, U.a1.base, U.a1.kind).drive(stop, `Responding to ${reason}`, true)
    const arrive = ems.t
    ems.stay(atResort ? 46 : 36, `Treating ${reason}`, {
      lights: true,
      crew: (u, d, s) => {
        const spot = place ? at(place.spot) : at(doorSpot(lot))
        const slots = drivers(s, U.a1.crew, u, d, [{ to: [spot[0] - 0.7, spot[1] + 0.4], act: 'Treating the patient', tool: 'clipboard' }, { to: [spot[0] + 0.7, spot[1] + 0.4], act: 'Readying the stretcher' }])
        slots.push({ who: patient, x: spot[0], z: spot[1] + 0.2, yaw: 0, pose: 'lie', act: reason })
        if (atResort) slots.push({ who: town.staff.manager, x: spot[0] + 1.6, z: spot[1] + 1.2, yaw: face(spot[0] + 1.6, spot[1] + 1.2, spot[0], spot[1]), act: 'Clearing the pool deck' })
        return slots
      },
    })
    transport(ems, U.a1.crew, patient, null, atResort ? 'a resort guest' : 'a patient')
    plans.set('a1', ems)
    let assistEnd = 0
    if (!atResort && r(6) < 0.4) {
      const engine = new Plan(t0 + 10, U.e1.base, U.e1.kind).drive({ kind: 'curb', lot, offset: -6 }, 'Assisting Medic 1', true)
      engine.stay(30, 'Assisting EMS', { lights: true, crew: (u, d, s) => drivers(s, U.e1.crew.slice(0, 2), u, d, [{ to: at(doorSpot(lot)).map((v, i) => v + (i ? 1.4 : -1.4)) as [number, number], act: 'Assisting EMS' }, { to: rel(s, 2, 0), act: 'Carrying the jump bag', tool: 'bag' }]) })
        .drive(U.e1.base, 'Back to Fire Station 7')
      assistEnd = engine.end
      plans.set('e1', engine)
      call('assist', ['firefighter'], `Assist Medic 1 at ${where}`, t0, assistEnd - 20, stopSpot(stop).x, stopSpot(stop).z)
    }
    call('ems', ['ems'], `Treat ${reason} at ${where}`, t0, arrive + 30, stopSpot(stop).x, stopSpot(stop).z)
    if (atResort) call('resort', ['resort'], 'Clear the pool deck for EMS', t0, arrive + 40, PLACES.resort.posts.pool.x, PLACES.resort.posts.pool.z)
    feed.push({ at: t0, text: `Medical call: ${reason} at ${where}. Medic 1 responding.`, kind: 'medical' })
  } else if (pick === 'crime' || pick === 'fight') {
    const fight = pick === 'fight'
    const options: { name: string; stop: Stop; spot: Spot; text: string }[] = [
      { name: addr(street, lot), stop: { kind: 'curb', lot, offset: -4 }, spot: doorSpot(lot), text: 'a prowler in a backyard' },
      { name: 'Sunny Side Burgers', stop: PLACE_STOPS.diner!.stop, spot: PLACES.diner.posts.patio, text: 'a dine-and-dash' },
      { name: 'Hood Fuel & Go', stop: PLACE_STOPS.gas!.stop, spot: PLACES.gas.posts.island, text: 'a drive-off at the pumps' },
      { name: 'Hood Springs Resort', stop: PLACE_STOPS.resort!.stop, spot: PLACES.resort.posts.lawn, text: 'a bike thief at the resort' },
    ]
    const o = fight ? { name: 'Kettle Ridge Correctional', stop: PLACE_STOPS.prison!.stop, spot: PLACES.prison.posts.gate, text: 'a fight in the prison yard' } : options[Math.floor(r(7) * options.length)]
    where = o.name
    const suspect: Person = fight ? town.inmates[5] : { id: `${id}-sus`, role: 'suspect', name: 'Suspect', look: npcLook(street, k * 17 + 3) }
    const police = new Plan(t0 + 6, U.p2.base, U.p2.kind).drive(o.stop, `Responding to ${o.text}`, true)
    const arrive = police.t
    police.stay(fight ? 44 : 36, fight ? 'Backing up the guards' : 'Making an arrest', {
      lights: true,
      crew: (u, d, s) => {
        const spot = at(o.spot)
        const slots = drivers(s, U.p2.crew, u, d, [{ to: [spot[0] - 0.9, spot[1]], act: fight ? 'Backing up the guards' : 'Making an arrest' }, { to: [spot[0] + 0.9, spot[1] + 0.3], act: 'Taking statements', tool: 'clipboard' }])
        slots.push({ who: suspect, x: spot[0], z: spot[1] + 0.9, yaw: face(spot[0], spot[1] + 0.9, spot[0], spot[1]), act: fight ? 'Being restrained' : 'Under arrest' })
        if (fight) slots.push({ who: town.staff.guard3, x: spot[0] + 1.6, z: spot[1] + 1.4, yaw: 0, act: 'Restraining an inmate' })
        return slots
      },
    })
    if (!fight) {
      police.drive({ kind: 'bay', place: 'prison', bay: 'port' }, 'Bringing a suspect to Kettle Ridge')
      const booking = police.t
      police.stay(32, 'Booking the suspect', {
        crew: (u, d, s) => {
          const intake = PLACES.prison.posts.intake
          return [
            ...drivers(s, U.p2.crew.slice(0, 1), u, d, [{ to: [intake.x - 1, intake.z + 1.6], act: 'Handing over the suspect', tool: 'clipboard' }]),
            { who: suspect, x: intake.x, z: intake.z + 1.2, yaw: Math.PI, act: 'Being booked' },
            { who: town.staff.guard1, x: intake.x + 1, z: intake.z + 0.6, yaw: face(intake.x + 1, intake.z + 0.6, intake.x, intake.z + 1.2), act: 'Booking the suspect', tool: 'clipboard' },
          ]
        },
      })
      const booked = police.t
      const processed = booked + 34
      staffSlots.push(t => {
        if (t < booked || t >= processed) return []
        const f = (t - booked) / 34
        const a = PLACES.prison.posts.intake, b = PLACES.prison.posts.block
        const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f
        return [{ who: suspect, x, z: z + 0.8, yaw: face(a.x, a.z, b.x, b.z), walking: 1, act: 'Going to a cell' }, { who: town.staff.guard1, x: x + 0.8, z, yaw: face(a.x, a.z, b.x, b.z), walking: 1, act: 'Escorting to a cell' }]
      })
      call('booking', ['guard'], 'Book in the suspect from Car 2', booking, processed, PLACES.prison.posts.intake.x, PLACES.prison.posts.intake.z)
      feed.push({ at: booking, text: 'Car 2 brought a suspect to Kettle Ridge for booking.', kind: 'crime' })
    } else {
      const ems = new Plan(t0 + 14, U.a1.base, U.a1.kind).drive({ kind: 'road', x: 152, side: -1 }, 'Responding to the prison', true)
      const hurt = town.inmates[4]
      ems.stay(30, 'Treating an inmate', { lights: true, crew: (u, d, s) => [...drivers(s, U.a1.crew, u, d, [{ to: rel(s, 3, 2), act: 'Treating an inmate', tool: 'clipboard' }]), { who: hurt, x: rel(s, 3, 3)[0], z: rel(s, 3, 3)[1], yaw: 0, pose: 'lie', act: 'Hurt in a fight' }, { who: town.staff.guard2, x: rel(s, 4.4, 3.4)[0], z: rel(s, 4.4, 3.4)[1], yaw: 0, act: 'Guarding the inmate' }] })
      transport(ems, U.a1.crew, hurt, town.staff.guard2, 'an inmate')
      plans.set('a1', ems)
      call('guard', ['guard'], 'Break up the fight in the yard', t0, arrive + 40, PLACES.prison.posts.yard.x, PLACES.prison.posts.yard.z)
      call('ems', ['ems'], 'Treat an inmate at Kettle Ridge', t0, ems.legs[1]?.t1 ?? t0 + 60, PLACES.prison.posts.gate.x, PLACES.prison.posts.gate.z)
    }
    police.drive(U.p2.base, 'Back to the station')
    plans.set('p2', police)
    call('police', ['police'], `Respond to ${o.text} at ${o.name}`, t0, arrive + 30, o.spot.x, o.spot.z)
    if (o.name === 'Sunny Side Burgers') call('food', ['food'], 'Give the police a statement', arrive, arrive + 34, o.spot.x, o.spot.z)
    if (o.name === 'Hood Fuel & Go') call('gas', ['gas'], 'Pull the pump camera for Car 2', arrive, arrive + 34, o.spot.x, o.spot.z)
    if (o.name === 'Hood Springs Resort') call('resortc', ['resort'], 'Help Car 2 with the bike thief', arrive, arrive + 34, o.spot.x, o.spot.z)
    feed.push({ at: t0, text: `Car 2 responding to ${o.text} at ${o.name}.`, kind: 'crime' })
  } else if (pick === 'crash') {
    const side: 1 | -1 = r(8) < 0.5 ? 1 : -1
    const x = -50 + r(9) * 100
    where = streetName(street)
    const stop: Stop = { kind: 'road', x: x - side * 9, side }
    const police = new Plan(t0 + 6, U.p2.base, U.p2.kind).drive(stop, 'Responding to a crash', true)
    const arrive = police.t
    police.stay(76, 'Working a crash', { lights: true, crew: (u, d, s) => drivers(s, U.p2.crew, u, d, [{ to: [x, side * 1.2], act: 'Directing traffic', tool: 'cone' }, { to: [x + 3, side * 4.2], act: 'Taking statements', tool: 'clipboard' }]) })
      .drive(U.p2.base, 'Back to the station')
    plans.set('p2', police)
    const ems = new Plan(t0 + 10, U.a1.base, U.a1.kind).drive({ kind: 'road', x: x + side * 9, side }, 'Responding to a crash', true)
    ems.stay(36, 'Checking the drivers', { lights: true, crew: (u, d, s) => drivers(s, U.a1.crew, u, d, [{ to: [x - 1.5, side * 3], act: 'Checking the drivers', tool: 'clipboard' }, { to: [x + 1.5, side * 3.2], act: 'Checking the drivers' }]) })
      .drive(U.a1.base, 'Back to Hood General')
    plans.set('a1', ems)
    const clear = police.legs[1].t1
    fx = t => (t >= t0 && t < clear ? { wrecks: [{ x: x - 1.8, z: side * 2.3, yaw: 0.5, color: Math.floor(r(10) * 6) }, { x: x + 2, z: side * 1.6, yaw: 2.4, color: Math.floor(r(11) * 6) }] } : {})
    call('police', ['police'], `Work the crash on ${where}`, t0, arrive + 60, x, 0)
    call('ems', ['ems'], `Check the drivers in the crash on ${where}`, t0, ems.legs[1].t1, x, 0)
    call('city', ['city'], `Sweep up after the crash on ${where}`, arrive + 20, clear, x, 0)
    feed.push({ at: t0, text: `Two-car crash on ${where}. Car 2 and Medic 1 responding.`, kind: 'crash' })
    feed.push({ at: clear, text: `The crash on ${where} is cleared.`, kind: 'crash' })
  } else if (pick === 'spill') {
    where = 'Hood Fuel & Go'
    const stop = PLACE_STOPS.gas!.stop
    const engine = new Plan(t0 + 6, U.e1.base, U.e1.kind).drive(stop, 'Responding to a fuel spill', true)
    const arrive = engine.t
    engine.stay(62, 'Cleaning up a fuel spill', {
      lights: true,
      crew: (u, d, s) => {
        const island = PLACES.gas.posts.island
        return [
          ...drivers(s, U.e1.crew, u, d, [{ to: [island.x - 2, island.z - 1], act: 'Spreading absorbent', tool: 'bag' }, { to: [island.x + 2, island.z - 1], act: 'Spreading absorbent', tool: 'shovel' }, { to: rel(s, 2, 0), act: 'Running the line', tool: 'hose' }]),
          { who: town.staff.clerk, x: island.x, z: island.z + 2.2, yaw: Math.PI, act: 'Shutting off the pumps' },
        ]
      },
    }).drive(U.e1.base, 'Back to Fire Station 7')
    plans.set('e1', engine)
    call('fire', ['firefighter'], 'Clean up the fuel spill at Hood Fuel', t0, arrive + 56, PLACES.gas.posts.island.x, PLACES.gas.posts.island.z)
    call('gas', ['gas'], 'Shut off the pumps for the fire crew', t0, arrive + 56, PLACES.gas.posts.island.x, PLACES.gas.posts.island.z)
    feed.push({ at: t0, text: 'Fuel spill at Hood Fuel & Go. Engine 1 responding.', kind: 'fire' })
  }
  if (pick === 'pool') feed.push({ at: t0 + 1, text: 'The resort pool is closed while EMS works.', kind: 'medical' })
  return { id, kind: pick, t0, where, plans, calls, feed, fx, staff: t => staffSlots.flatMap(f => f(t)) }
}

function routinePlan(town: Town, id: string, t: number): { plan: Plan; feed: FeedItem[]; lawns?: Map<number, number> } | null {
  const street = town.street
  const U = town.units
  switch (id) {
    case 'p1': {
      const P = 300, k = Math.floor(t / P), start = k * P
      return cached(`r:${street}:p1:${k}`, () => {
        const plan = new Plan(start + 4, U.p1.base, U.p1.kind)
        const feed: FeedItem[] = []
        plan.drive({ kind: 'road', x: -55 + hash(street, k, 1) * 30, side: 1 }, 'On patrol').stay(24, 'Running a speed trap', { crew: (u, d, s) => drivers(s, U.p1.crew, u, d, [{ to: rel(s, 2.6, 1), act: 'Running a speed trap', tool: 'clipboard' }]) })
        if (k % 2 === 0) {
          plan.drive({ kind: 'drive', place: 'diner' }, 'Lunch run').stay(18, 'Lunch at Sunny Side Burgers', {
            crew: (_u, _d, _s) => [{ who: town.staff.window, x: PLACES.diner.posts.window.x, z: PLACES.diner.posts.window.z, yaw: Math.PI / 2, act: 'Serving Car 1 at the window', tool: 'tray' }],
          })
          feed.push({ at: plan.t - 18, text: 'Car 1 grabbed lunch at the Sunny Side drive-thru.', kind: 'routine' })
        }
        if (k % 3 === 1) {
          plan.drive({ kind: 'bay', place: 'gas', bay: 'pump1' }, 'Heading to Hood Fuel').stay(22, 'Fueling up at Hood Fuel', { crew: (_u, _d, s) => [{ who: town.staff.clerk, x: s.x + 0.2, z: s.z + 1.6, yaw: Math.PI, act: 'Fueling Car 1', tool: 'hose' }] })
        }
        plan.drive({ kind: 'road', x: 20 + hash(street, k, 2) * 30, side: -1 }, 'On patrol').stay(18, 'Watching the street').drive(U.p1.base, 'Back to the station').until(start + P, 'Parked at the station', { idle: true })
        return { plan, feed }
      })
    }
    case 'g': {
      const P = 600, k = Math.floor(t / P), start = k * P + 30
      return cached(`r:${street}:g:${k}`, () => {
        const plan = new Plan(start, U.g.base, U.g.kind)
        plan.drive({ kind: 'curb', lot: STREET_ORDER[0] }, 'Starting the trash route')
        STREET_ORDER.forEach((lot, i) => {
          if (i > 0) plan.drive({ kind: 'curb', lot }, 'Trash route')
          plan.stay(7, `Trash pickup at ${addr(street, lot)}`, {
            crew: (u, _d, s) => U.g.crew.map((who, j) => {
              const bin = frontYard(lot, 14.5 + j, -0.6)
              const back = rel(s, j ? -0.9 : 0.9, -4.2)
              const w = u < 2.5 ? u / 2.5 : u < 4.5 ? 1 : Math.max(0, 1 - (u - 4.5) / 2.5)
              const p = [back[0] + (bin.x - back[0]) * w, back[1] + (bin.z - back[1]) * w]
              return { who, x: p[0], z: p[1], yaw: face(p[0], p[1], bin.x, bin.z), walking: u < 2.5 || u > 4.5 ? 1 : 0, act: 'Tossing trash bags', tool: u > 2.5 && u < 5.5 ? 'bag' : 'none' }
            }),
          })
        })
        if (k % 2) plan.drive({ kind: 'bay', place: 'gas', bay: 'pump2' }, 'Heading to Hood Fuel').stay(20, 'Fueling at Hood Fuel', { crew: (_u, _d, s) => [{ who: town.staff.clerk, x: s.x + 0.2, z: s.z - 1.6, yaw: 0, act: 'Fueling Trash Truck 4', tool: 'hose' }] })
        plan.drive(U.g.base, 'Back to the yard').until(k * P + P, 'At the yard', { idle: true })
        return { plan, feed: [{ at: start, text: `Trash day on ${streetName(street)}: Truck 4 is on its route.`, kind: 'routine' }] }
      })
    }
    case 'l1': {
      const P = 1440, k = Math.floor(t / P), start = k * P + 15
      return cached(`r:${street}:l1:${k}`, () => {
        const plan = new Plan(start, U.l1.base, U.l1.kind)
        const lawns = new Map<number, number>()
        const feed: FeedItem[] = []
        for (const lot of STREET_ORDER) {
          plan.drive({ kind: 'curb', lot }, 'Driving to the next yard')
          feed.push({ at: plan.t, text: `Greenline is mowing ${addr(street, lot)}.`, kind: 'routine' })
          plan.stay(88, `Mowing ${addr(street, lot)}`, { crew: (u, d, s) => mowCrew(s, U.l1.crew, lot, u, d) , fx: (u, d) => ({ mower: mowPattern(lot, u, d) }) })
          lawns.set(lot, plan.t)
        }
        if (k % 2 === 0) plan.drive({ kind: 'bay', place: 'gas', bay: 'pump3' }, 'Fueling the mowers').stay(20, 'Fueling the mowers at Hood Fuel', { crew: (_u, _d, s) => [{ who: town.staff.clerk, x: s.x + 0.2, z: s.z + 1.6, yaw: Math.PI, act: 'Fueling Greenline 1', tool: 'hose' }] })
        plan.drive(U.l1.base, 'Back to the shop').until(k * P + P, 'At the shop', { idle: true })
        return { plan, feed: feed.slice(0, 2), lawns }
      })
    }
    case 'd1': {
      const P = 180, k = Math.floor(t / P), start = k * P + 20
      return cached(`r:${street}:d1:${k}`, () => {
        const lot = Math.floor(hash(street, k, 31) * LOTS_PER_STREET)
        const plan = new Plan(start, U.d1.base, U.d1.kind).drive({ kind: 'curb', lot, offset: 3 }, 'Out on a delivery')
          .stay(16, `Delivering burgers to ${addr(street, lot)}`, { crew: (u, d, s) => drivers(s, U.d1.crew, u, d, [{ to: at(doorSpot(lot)), act: 'Delivering burgers', tool: 'tray' }]) })
          .drive(U.d1.base, 'Back to Sunny Side').until(k * P + P, 'Waiting for orders', { idle: true })
        return { plan, feed: [] }
      })
    }
    case 's1': {
      const P = 420, k = Math.floor(t / P), start = k * P + 40
      return cached(`r:${street}:s1:${k}`, () => {
        const lot = Math.floor(hash(street, k, 41) * LOTS_PER_STREET)
        const offDuty = (['fire', 'hospital', 'police', 'prison'] as const)[k % 4]
        const who = { fire: 'off-duty firefighters', hospital: 'off-duty nurses', police: 'off-duty officers', prison: 'off-duty guards' }[offDuty]
        const pickupX = { fire: 110, hospital: 150, police: 80, prison: 160 }[offDuty]
        const side: 1 | -1 = offDuty === 'prison' ? -1 : 1
        const plan = new Plan(start, U.s1.base, U.s1.kind).drive({ kind: 'curb', lot, offset: -3 }, 'Shuttle run')
          .stay(12, `Picking up guests at ${addr(street, lot)}`, { crew: (u, d, s) => drivers(s, U.s1.crew, u, d, [{ to: rel(s, 2.2, 0), act: 'Loading bags' }]) })
          .drive({ kind: 'road', x: pickupX, side }, 'Shuttle run').stay(12, `Picking up ${who}`)
          .drive(U.s1.base, 'Heading to the resort').stay(14, 'Dropping guests at the lodge', { crew: () => [{ who: town.staff.manager, x: PLACES.resort.posts.lawn.x + 2, z: PLACES.resort.posts.lawn.z - 1, yaw: 0, act: 'Greeting new guests' }] })
          .until(k * P + P, 'Waiting at the lodge', { idle: true })
        return { plan, feed: [{ at: start + 30, text: `The resort shuttle is bringing ${who} out to Hood Springs.`, kind: 'routine' }] }
      })
    }
    case 't': {
      const P = 900, k = Math.floor((t - 200) / P), start = k * P + 200
      return cached(`r:${street}:t:${k}`, () => {
        const plan = new Plan(start, U.t.base, U.t.kind).drive({ kind: 'bay', place: 'gas', bay: 'tank' }, 'Bringing a fuel delivery')
        const arrive = plan.t
        plan.stay(90, 'Filling the station tanks', {
          crew: (u, d, s) => [
            ...drivers(s, U.t.crew, u, d, [{ to: rel(s, 1.6, -3), act: 'Pumping fuel', tool: 'hose' }]),
            walkTo(town.staff.clerk, at(PLACES.gas.posts.register), rel(s, 2.6, -1), face(0, 0, -1, 0), u, d, 'Signing for the delivery', 'clipboard'),
          ],
        }).drive({ kind: 'edge', end: -1 }, 'Heading out of town')
        return { plan, feed: [{ at: arrive, text: 'A fuel tanker is filling the tanks at Hood Fuel & Go.', kind: 'routine' }] }
      })
    }
    case 'b': {
      const P = 900, k = Math.floor((t - 450) / P), start = k * P + 450
      return cached(`r:${street}:b:${k}`, () => {
        const side: 1 | -1 = k % 2 ? 1 : -1
        const x = -40 + hash(street, k, 51) * 80
        const plan = new Plan(start, U.b.base, U.b.kind).drive({ kind: 'road', x, side }, 'Taking the work crew out')
        const arrive = plan.t
        plan.stay(300, `Inmate work crew on ${streetName(street)}`, {
          crew: (u, d, s) => {
            const slots: Slot[] = []
            for (let i = 0; i < 4; i++) {
              const a: [number, number] = [x - 18 + i * 9, side * 5.6]
              const b: [number, number] = [x - 12 + i * 9, side * 5.9]
              slots.push(u < 8 ? walkTo(town.inmates[i], rel(s, 1.4, -2), a, 0, u, d, 'Picking up litter', 'bag') : pace(town.inmates[i], a, b, u + i * 5, 24, 'Picking up litter', 'bag', 0.5))
            }
            slots.push(...drivers(s, U.b.crew, u, d, [{ to: [x, side * 6.6], act: 'Watching the work crew' }, { to: [x + 6, side * 6.4], act: 'Leading the work crew', tool: 'clipboard' }]))
            return slots
          },
          fx: u => ({ bags: Array.from({ length: Math.min(6, Math.floor(u / 40)) }, (_, i) => ({ x: x - 16 + i * 6, z: side * 6.2 })) }),
        }).drive(U.b.base, 'Back to Kettle Ridge')
        return { plan, feed: [{ at: arrive, text: `A Kettle Ridge work crew is cleaning up ${streetName(street)} with City Works.`, kind: 'routine' }] }
      })
    }
    case 'u': {
      const P = 600, k = Math.floor((t - 100) / P), start = k * P + 100
      return cached(`r:${street}:u:${k}`, () => {
        const lamp = lampSpot(Math.floor(hash(street, k, 61) * 12))
        const side: 1 | -1 = lamp.z > 0 ? 1 : -1
        const plan = new Plan(start, U.u.base, U.u.kind).drive({ kind: 'road', x: lamp.x + 1, side }, 'Heading to a streetlight')
          .stay(120, 'Fixing a streetlight', { bucket: true, crew: (_u, _d, s) => [{ who: U.u.crew[0], x: s.x, z: s.z - side * 0.6, yaw: face(s.x, s.z, lamp.x, lamp.z), act: 'Fixing a streetlight', tool: 'wrench' }] })
        if (k % 2) plan.drive({ kind: 'bay', place: 'gas', bay: 'pump4' }, 'Heading to Hood Fuel').stay(20, 'Fueling at Hood Fuel', { crew: (_u, _d, s) => [{ who: town.staff.clerk, x: s.x + 0.2, z: s.z - 1.6, yaw: 0, act: 'Fueling Bucket Truck 2', tool: 'hose' }] })
        plan.drive(U.u.base, 'Back to the yard').until(k * P + 100 + P, 'At the yard', { idle: true })
        return { plan, feed: [] }
      })
    }
  }
  return null
}

const RESPONDERS: Record<ServiceKind, { unit: string; offset: number }> = {
  police: { unit: 'p3', offset: -6 }, fire: { unit: 'e2', offset: 0 }, ems: { unit: 'a2', offset: 6 }, food: { unit: 'd2', offset: 3 },
  mow: { unit: 'l2', offset: -3 }, city: { unit: 'c', offset: 8 }, resort: { unit: 's2', offset: -8 },
}

export interface ServiceJob {
  request: TownRequest
  plan: Plan
  arrive: number
  leave: number
}

function serviceStay(town: Town, kind: ServiceKind, lot: number, by: string): Partial<Extract<Leg, { kind: 'stay' }>> {
  const unit = town.units[RESPONDERS[kind].unit]
  const door = at(doorSpot(lot))
  switch (kind) {
    case 'police': return { crew: (u, d, s) => drivers(s, unit.crew, u, d, [{ to: door, act: 'Checking on the house', tool: 'clipboard' }]) }
    case 'fire': return { crew: (u, d, s) => drivers(s, unit.crew, u, d, [{ to: door, act: 'Testing the smoke alarms', tool: 'clipboard' }, { to: [door[0] + 1.2, door[1]], act: 'Testing the smoke alarms' }]) }
    case 'ems': return { crew: (u, d, s) => drivers(s, unit.crew, u, d, [{ to: door, act: `Checking on the ${by}`, tool: 'clipboard' }, { to: [door[0] + 1.2, door[1]], act: 'Taking vitals', tool: 'bag' }]) }
    case 'food': return { crew: (u, d, s) => drivers(s, unit.crew, u, d, [{ to: door, act: 'Delivering burgers', tool: 'tray' }]) }
    case 'mow': return { crew: (u, d, s) => mowCrew(s, unit.crew, lot, u, d), fx: (u, d) => ({ mower: mowPattern(lot, u, d) }) }
    case 'city': return { crew: (u, d, s) => drivers(s, unit.crew, u, d, [{ to: rel(s, -1.6, 4), act: 'Patching the road', tool: 'shovel' }, { to: rel(s, -1.2, 6), act: 'Setting cones', tool: 'cone' }]) }
    case 'resort': return { crew: (u, d, s) => drivers(s, unit.crew, u, d, [{ to: rel(s, 2.4, 0), act: 'Holding the door' }]) }
  }
}

function serviceLabel(kind: ServiceKind, street: number, lot: number): string {
  const a = addr(street, lot)
  switch (kind) {
    case 'police': return `Patrol check at ${a}`
    case 'fire': return `Smoke alarm check at ${a}`
    case 'ems': return `Wellness check at ${a}`
    case 'food': return `Delivering burgers to ${a}`
    case 'mow': return `Mowing ${a}`
    case 'city': return `Patching the road at ${a}`
    case 'resort': return `Picking up a guest at ${a}`
  }
}

/** Each responder takes the calls for its service in order, one after another. */
export function serviceJobs(street: number, requests: TownRequest[]): ServiceJob[] {
  const town = makeTown(street)
  const out: ServiceJob[] = []
  const free = new Map<string, number>()
  const sorted = [...requests].filter(r => Number.isInteger(r.lot) && r.lot >= 0 && r.lot < LOTS_PER_STREET && SERVICES[r.kind]).sort((a, b) => a.at - b.at || a.lot - b.lot)
  for (const request of sorted) {
    const { unit: unitId, offset } = RESPONDERS[request.kind]
    const unit = town.units[unitId]
    const start = Math.max(request.at / 1000 + 6, free.get(unitId) ?? 0)
    const plan = new Plan(start, unit.base, unit.kind)
    const service = SERVICES[request.kind]
    plan.drive({ kind: 'curb', lot: request.lot, offset }, serviceLabel(request.kind, street, request.lot), request.kind === 'ems')
    const arrive = plan.t
    plan.stay(service.stay, serviceLabel(request.kind, street, request.lot), serviceStay(town, request.kind, request.lot, request.by ?? 'household'))
    const leave = plan.t
    plan.drive(unit.base, request.kind === 'resort' ? 'Heading to the resort' : 'Heading back')
    free.set(unitId, plan.end + 4)
    out.push({ request, plan, arrive: arrive * 1000, leave: leave * 1000 })
  }
  return out
}

/** When the responder for a new call would reach the lot, given the calls already waiting. */
export function serviceEta(street: number, requests: TownRequest[], request: TownRequest): number {
  const job = serviceJobs(street, [...requests, request]).find(j => j.request === request)
  return job ? job.arrive : request.at + 60_000
}

function incidentsNear(town: Town, t: number, houses: boolean[], back = 2): Incident[] {
  const k = Math.floor(t / SLOT_SECONDS)
  const out: Incident[] = []
  for (let i = k - back; i <= k; i++) {
    const inc = cached(`i:${town.street}:${i}:${houses.map(h => (h ? 1 : 0)).join('')}`, () => buildIncident(town, i, houses))
    if (inc) out.push(inc)
  }
  return out
}

/** The calls a worker can answer right now: emergencies on the street plus the busy moments of the town's routines. */
export function callsAt(street: number, nowMs: number, requests: TownRequest[] = [], houses: boolean[] = []): TownCall[] {
  const t = nowMs / 1000
  const town = makeTown(street)
  const calls: TownCall[] = []
  for (const inc of incidentsNear(town, t, houses)) for (const c of inc.calls) if (t >= c.start && t < c.end) calls.push(c)
  for (const id of ['t', 'b', 'l1', 'g', 'p1', 's1'] as const) {
    const r = routinePlan(town, id, t)
    const leg = r?.plan.find(t)
    if (!leg || leg.kind !== 'stay' || leg.idle) continue
    const spot = leg.at
    const k = Math.floor(leg.t0)
    if (id === 't' && leg.label.startsWith('Filling')) calls.push({ id: `tank-${k}`, jobs: ['gas'], label: 'Sign for the fuel delivery', start: leg.t0, end: leg.t1, x: spot.x, z: spot.z })
    if (id === 'b' && leg.label.startsWith('Inmate')) calls.push({ id: `crew-${k}`, jobs: ['guard', 'city'], label: leg.label, start: leg.t0, end: leg.t1, x: spot.x, z: spot.z })
    if (id === 'l1' && leg.label.startsWith('Mowing')) calls.push({ id: `mow-${k}`, jobs: ['lawn'], label: `Help Greenline 1: ${leg.label.toLowerCase()}`, start: leg.t0, end: leg.t1, x: spot.x, z: spot.z })
    if (id === 'g' && leg.label.startsWith('Trash')) calls.push({ id: `trash-${Math.floor(t / 600)}`, jobs: ['city'], label: 'Ride along on the trash route', start: leg.t0, end: leg.t1 + 60, x: spot.x, z: spot.z })
    if (id === 'p1' && leg.label.startsWith('Lunch')) calls.push({ id: `lunch-${k}`, jobs: ['food'], label: 'Serve Car 1 at the drive-thru', start: leg.t0, end: leg.t1, x: spot.x, z: spot.z })
    if (id === 's1' && leg.label.startsWith('Dropping')) calls.push({ id: `guests-${k}`, jobs: ['resort'], label: 'Welcome the shuttle guests', start: leg.t0, end: leg.t1 + 20, x: spot.x, z: spot.z })
  }
  const jobFor: Record<ServiceKind, JobId> = { police: 'police', fire: 'firefighter', ems: 'ems', food: 'food', mow: 'lawn', city: 'city', resort: 'resort' }
  for (const job of serviceJobs(street, requests.filter(r => nowMs - r.at < REQUEST_WINDOW_MS))) {
    if (t * 1000 < job.request.at || t * 1000 >= job.leave) continue
    const s = stopSpot({ kind: 'curb', lot: job.request.lot })
    calls.push({ id: `req-${job.request.kind}-${job.request.lot}-${job.request.at}`, jobs: [jobFor[job.request.kind]], label: serviceLabel(job.request.kind, street, job.request.lot), start: job.request.at / 1000, end: job.leave / 1000, x: s.x, z: s.z })
  }
  return calls
}

const UNIT_PLACE: Record<string, PlaceId> = { p1: 'police', p2: 'police', p3: 'police', e1: 'fire', e2: 'fire', a1: 'hospital', a2: 'hospital', l1: 'lawn', l2: 'lawn', g: 'cityworks', u: 'cityworks', c: 'cityworks', d1: 'diner', d2: 'diner', s1: 'resort', s2: 'resort', b: 'prison', t: 'gas' }

const PLAYER_POSTS: Record<JobId, (t: number, i: number) => [number, number, number]> = {
  police: (_t, i) => [PLACES.police.posts.steps.x + 1.4 + i, PLACES.police.posts.steps.z, Math.PI],
  firefighter: (_t, i) => [PLACES.fire.posts.apron2.x + i, PLACES.fire.posts.apron2.z, -Math.PI / 2],
  lawn: (_t, i) => [PLACES.lawn.posts.mowers.x + i, PLACES.lawn.posts.mowers.z + 1.5, 0],
  guard: (_t, i) => [PLACES.prison.posts.yard.x - 3 + i, PLACES.prison.posts.yard.z + 3, 0],
  resort: (_t, i) => [PLACES.resort.posts.pool.x - 3 + i, PLACES.resort.posts.pool.z + 1, 0],
  city: (_t, i) => [PLACES.cityworks.posts.cones.x + 2 + i, PLACES.cityworks.posts.cones.z, 0],
  gas: (_t, i) => [PLACES.gas.posts.island.x + 2 + i, PLACES.gas.posts.island.z, -Math.PI / 2],
  food: (_t, i) => [PLACES.diner.posts.counter.x + 1.5 + i, PLACES.diner.posts.counter.z, Math.PI],
  ems: (_t, i) => [PLACES.hospital.posts.bay.x + 1.6 + i, PLACES.hospital.posts.bay.z - 1, Math.PI],
  nurse: (_t, i) => [PLACES.hospital.posts.entrance.x + 1.6 + i, PLACES.hospital.posts.entrance.z, Math.PI],
}

const PARKED = { speed: 0, accel: 0, lat: 0, steer: 0, trailer: 0 }

/** Everything happening in town at one moment. */
export function townAt(street: number, nowMs: number, requests: TownRequest[] = [], players: PlayerWorker[] = [], houses: boolean[] = []): TownState {
  const t = nowMs / 1000
  const town = makeTown(street)
  const vehicles: VehicleView[] = []
  const slots: Slot[] = []
  const claimed = new Set<string>()
  const fires: TownState['fires'] = []
  const sprays: TownState['sprays'] = []
  const mowers: TownState['mowers'] = []
  const wrecks: TownState['wrecks'] = []
  const bags: TownState['bags'] = []
  const feed: FeedItem[] = []
  const status = {} as Record<PlaceId, string>
  const busy: Record<string, string> = {}

  const incidents = incidentsNear(town, t, houses, 3)
  const assigned = new Map<string, Plan>()
  for (const inc of incidents) {
    for (const [unitId, plan] of inc.plans) if (t >= plan.legs[0].t0 && t < plan.end) assigned.set(unitId, plan)
    for (const item of inc.feed) if (item.at <= t) feed.push(item)
    const e = inc.fx(t)
    if (e.fire) { const s = houseSpot(e.fire.lot); fires.push({ lot: e.fire.lot, x: s.x, z: s.z, size: e.fire.size, smoke: e.fire.smoke }) }
    if (e.sprays) sprays.push(...e.sprays)
    if (e.wrecks) wrecks.push(...e.wrecks)
    for (const s of inc.staff(t)) slots.push(s)
  }
  const recent = requests.filter(r => nowMs - r.at < REQUEST_WINDOW_MS && r.at <= nowMs)
  for (const job of serviceJobs(street, recent)) {
    const unitId = RESPONDERS[job.request.kind].unit
    if (t >= job.plan.legs[0].t0 && t < job.plan.end) assigned.set(unitId, job.plan)
    if (job.request.at <= nowMs) feed.push({ at: job.request.at / 1000, text: `${job.request.by ? `The ${job.request.by}` : 'A household'} called ${SERVICES[job.request.kind].label}: ${lowerFirst(serviceLabel(job.request.kind, street, job.request.lot))}.`, kind: 'service' })
  }
  const lastMow = new Array<number>(LOTS_PER_STREET).fill(-Infinity)
  for (const back of [1440, 0]) {
    const r = routinePlan(town, 'l1', t - back)
    if (r?.lawns) for (const [lot, end] of r.lawns) if (end <= t) lastMow[lot] = Math.max(lastMow[lot], end)
  }
  for (const job of serviceJobs(street, recent)) if (job.request.kind === 'mow' && job.leave / 1000 <= t) lastMow[job.request.lot] = Math.max(lastMow[job.request.lot], job.leave / 1000)

  for (const unit of Object.values(town.units)) {
    let plan = assigned.get(unit.id) ?? null
    if (!plan) {
      const r = routinePlan(town, unit.id, t)
      if (r) {
        plan = r.plan
        for (const item of r.feed) if (item.at <= t && t - item.at < 900) feed.push(item)
      }
    }
    const leg = plan?.find(t) ?? null
    if (!leg || (leg.kind === 'stay' && leg.idle)) {
      if (unit.kind === 'tanker') continue
      const s = stopSpot(unit.base)
      vehicles.push({ id: unit.id, kind: unit.kind, label: unit.label, x: s.x, z: s.z, yaw: s.yaw, lights: false, moving: false, act: leg?.label ?? 'Parked', bucket: 0, ...PARKED })
      slots.push(...unit.home(t))
      continue
    }
    const u = t - leg.t0, d = leg.t1 - leg.t0
    busy[unit.id] = leg.label
    if (leg.kind === 'drive') {
      const s = alongPath(leg.path, u)
      vehicles.push({ id: unit.id, kind: unit.kind, label: unit.label, x: s.x, z: s.z, yaw: s.yaw, lights: leg.lights, moving: true, act: leg.label, bucket: 0, speed: s.speed, accel: s.accel, lat: s.lat, steer: s.steer, trailer: s.trailer })
      continue
    }
    const s = leg.at
    const bucket = leg.bucket ? Math.min(1, u / 6, (d - u) / 6) : 0
    vehicles.push({ id: unit.id, kind: unit.kind, label: unit.label, x: leg.park.x, z: leg.park.z, yaw: leg.park.yaw, lights: leg.lights, moving: false, act: leg.label, bucket: Math.max(0, bucket), ...PARKED })
    if (leg.crew) slots.push(...leg.crew(u, d, s))
    if (leg.fx) {
      const e = leg.fx(u, d)
      if (e.mower) mowers.push(e.mower)
      if (e.bags) bags.push(...e.bags)
    }
  }

  for (const s of slots) claimed.add(s.who.id)
  const ST = town.staff
  const P = PLACES
  const fixed: Slot[] = [
    pace(ST.desk, at(P.police.posts.desk), [P.police.posts.desk.x + 3, P.police.posts.desk.z], t, 30, 'Dispatching calls', 'clipboard', 0.7),
    pace(ST.nurse1, at(P.hospital.posts.entrance), at(P.hospital.posts.window), t, 34, 'Checking on patients', 'clipboard'),
    pace(ST.nurse2, at(P.hospital.posts.triage), [P.hospital.posts.triage.x + 4, P.hospital.posts.triage.z], t + 9, 28, 'Charting', 'clipboard'),
    { who: ST.guard1, x: P.prison.posts.gate.x, z: P.prison.posts.gate.z, yaw: Math.PI, act: 'Watching the gate' },
    { who: ST.guard2, x: P.prison.posts.tower.x, z: P.prison.posts.tower.z, yaw: Math.PI * 0.75, act: 'Tower watch' },
    pace(ST.guard3, [P.prison.posts.yard.x - 6, P.prison.posts.yard.z + 6], [P.prison.posts.yard.x + 6, P.prison.posts.yard.z + 6], t, 40, 'Supervising the yard'),
    pace(ST.clerk, at(P.gas.posts.register), at(P.gas.posts.ice), t, 36, 'Running the register', 'none', 0.7),
    pace(ST.cook, at(P.diner.posts.grill), [P.diner.posts.grill.x - 2.5, P.diner.posts.grill.z], t, 12, 'Working the grill', 'none', 0.4),
    { who: ST.window, x: P.diner.posts.window.x, z: P.diner.posts.window.z, yaw: Math.PI / 2, act: 'Drive-thru window' },
    pace(ST.manager, at(P.resort.posts.pool), at(P.resort.posts.cabana), t, 50, 'Walking the pool deck'),
    { who: ST.lifeguard, x: P.resort.posts.pool.x + 6, z: P.resort.posts.pool.z - 7.6, yaw: -Math.PI / 2, act: 'Lifeguard on duty', pose: 'sit', y: 1.8 },
  ]
  for (const s of fixed) if (!claimed.has(s.who.id)) slots.push(s)
  town.inmates.forEach((who, i) => {
    if (claimed.has(who.id)) return
    const y = P.prison.posts.yard
    slots.push(i % 3 === 2 ? { who, x: y.x - 8 + i * 3, z: y.z - 4, yaw: 0, act: 'Lifting weights' } : pace(who, [y.x - 10 + i * 3, y.z - 6 + (i % 2) * 8], [y.x - 4 + i * 3, y.z - 2 + (i % 2) * 6], t + i * 11, 30 + i * 3, 'Time in the yard'))
  })
  town.guests.forEach((who, i) => {
    const pool = P.resort.posts.pool
    if (i < 4) slots.push({ who, x: pool.x - 9.5 + i * 2.6, z: pool.z - 16.4, yaw: 0, act: 'Sunbathing', pose: 'lie', y: 0.45 })
    else slots.push({ who, x: P.resort.posts.dock.x - 3 - (i - 4) * 4, z: P.resort.posts.dock.z + 0.5, yaw: Math.PI, act: 'Fishing off the dock', pose: 'sit', y: 0.35 })
  })

  const calls = callsAt(street, nowMs, requests, houses)
  const workers: WorkerView[] = slots.map(s => ({
    id: s.who.id, role: s.who.role, name: s.who.name, x: s.x, z: s.z, yaw: s.yaw, walking: s.walking ?? 0, pose: s.pose ?? 'stand', y: s.y ?? (s.pose === 'lie' ? 0.62 : 0), act: s.act, tool: s.tool ?? 'none', look: s.who.look,
  }))
  const perJob = new Map<JobId, number>()
  for (const pw of players) {
    const i = perJob.get(pw.job) ?? 0
    perJob.set(pw.job, i + 1)
    const c = pw.call ? calls.find(call => call.id === pw.call) : null
    const [x, z, yaw] = c ? [c.x + 1.2 + i * 0.8, c.z + 1.1, Math.PI] : PLAYER_POSTS[pw.job](t, i)
    workers.push({ id: `player-${pw.lot}-${pw.name}`, role: pw.job, name: pw.name, x, z, yaw, walking: 0, pose: 'stand', y: 0, act: c ? c.label : `On shift: ${JOBS[pw.job].titles[Math.max(0, pw.level - 1)]}`, tool: 'none', look: pw.look, player: true })
  }

  for (const id of Object.keys(PLACES) as PlaceId[]) {
    const lines = Object.entries(busy).filter(([unitId]) => UNIT_PLACE[unitId] === id).map(([unitId, label]) => `${town.units[unitId].label}: ${label}`)
    status[id] = lines.length ? lines.join(' · ') : 'All units in quarters'
  }
  status.hospital = `${status.hospital === 'All units in quarters' ? 'Ambulances in the bay' : status.hospital}`
  status.prison = calls.some(c => c.jobs.includes('guard')) ? calls.filter(c => c.jobs.includes('guard')).map(c => c.label).join(' · ') : status.prison === 'All units in quarters' ? 'Quiet on the block' : status.prison
  status.gas = busy.t ? 'Fuel delivery at the tanks' : 'Pumps open'
  status.diner = busy.d1 || busy.d2 ? [busy.d1, busy.d2].filter(Boolean).join(' · ') : 'Grill is hot'
  status.resort = 'Pool and lake open'

  const lawns = lastMow.map(m => (Number.isFinite(m) ? Math.max(0.05, Math.min(1, (t - m) / 1440)) : 0.7))
  feed.sort((a, b) => b.at - a.at)
  const seen = new Set<string>()
  const unique = feed.filter(f => (seen.has(f.text) ? false : (seen.add(f.text), true))).slice(0, 10)
  return { now: nowMs, vehicles, workers, fires, sprays, mowers, wrecks, bags, lawns, calls, feed: unique, status }
}
