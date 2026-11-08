/** The town around every street: workplaces at both ends of the road, where their vehicles park and how they drive between places. */
import { LOTS_PER_SIDE, LOTS_PER_STREET, STREET_HALF, STREET_LENGTH, lotPlacement, lotToWorld } from './Street'

export const ROAD_END = 240
export const LANE = 2.3
export const APRON = STREET_HALF - 0.6
export const ROAD_SPEED = 11
export const YARD_SPEED = 3.6

export type PlaceId = 'police' | 'fire' | 'hospital' | 'cityworks' | 'lawn' | 'prison' | 'gas' | 'diner' | 'resort'

export interface Spot {
  x: number
  z: number
  yaw: number
}

export interface Place {
  id: PlaceId
  name: string
  side: 1 | -1
  x0: number
  x1: number
  depth: number
  door: Spot
  bays: Record<string, Spot>
  posts: Record<string, Spot>
}

const N = Math.PI
const S = 0

function spot(x: number, z: number, yaw: number): Spot {
  return { x, z, yaw }
}

export const PLACES: Record<PlaceId, Place> = {
  police: {
    id: 'police', name: 'Hood Police Department', side: 1, x0: 66, x1: 92, depth: 30,
    door: spot(79, 16.4, N),
    bays: { p1: spot(72.5, 11.5, N), p2: spot(78.5, 11.5, N), p3: spot(84.5, 11.5, N) },
    posts: { desk: spot(79, 17.6, N), steps: spot(76.5, 15.6, N), lot: spot(88, 12.5, -Math.PI / 2) },
  },
  fire: {
    id: 'fire', name: 'Fire Station 7', side: 1, x0: 98, x1: 124, depth: 30,
    door: spot(121, 15.8, N),
    bays: { e1: spot(104.5, 15.5, N), e2: spot(113.5, 15.5, N) },
    posts: { apron1: spot(102, 11.5, Math.PI / 2), apron2: spot(108, 11, -Math.PI / 2), bench: spot(121.5, 14.2, N), apron3: spot(116, 10.5, N) },
  },
  hospital: {
    id: 'hospital', name: 'Hood General Hospital', side: 1, x0: 130, x1: 178, depth: 38,
    door: spot(156, 17.4, N),
    bays: { a1: spot(134, 15, N), a2: spot(139.5, 15, N) },
    posts: { entrance: spot(156, 15.6, N), bay: spot(136.8, 18.6, N), triage: spot(136.8, 20.2, N), garden: spot(166, 12.5, N), window: spot(147, 15.4, N) },
  },
  cityworks: {
    id: 'cityworks', name: 'City Works Yard', side: -1, x0: 66, x1: 96, depth: 30,
    door: spot(81, -21.5, S),
    bays: { g: spot(72, -13, S), u: spot(80.5, -13, S), c: spot(89, -13, S) },
    posts: { shed: spot(91.5, -20, S), cones: spot(75, -19.5, S), gate: spot(68.5, -9.5, S) },
  },
  lawn: {
    id: 'lawn', name: 'Greenline Lawn Co.', side: -1, x0: 102, x1: 124, depth: 26,
    door: spot(119, -18, S),
    bays: { l1: spot(106.5, -12.5, S), l2: spot(113.5, -12.5, S) },
    posts: { bench: spot(119, -15.5, S), mowers: spot(110, -20, S), fuel: spot(122.5, -12, S) },
  },
  prison: {
    id: 'prison', name: 'Kettle Ridge Correctional', side: -1, x0: 130, x1: 198, depth: 62,
    door: spot(150, -18.5, S),
    bays: { bus: spot(140, -10.6, Math.PI / 2), port: spot(150, -16, S) },
    posts: { gate: spot(155.5, -12.5, S), intake: spot(150, -21, S), yard: spot(170, -38, S), tower: spot(135.5, -16.5, S), tower2: spot(192.5, -16.5, S), block: spot(158, -48, S) },
  },
  gas: {
    id: 'gas', name: 'Hood Fuel & Go', side: 1, x0: -94, x1: -66, depth: 30,
    door: spot(-80, 19.6, N),
    bays: { pump1: spot(-84, 12.8, Math.PI / 2), pump2: spot(-76, 12.8, Math.PI / 2), pump3: spot(-84, 16.2, Math.PI / 2), pump4: spot(-76, 16.2, Math.PI / 2), tank: spot(-70, 22, N) },
    posts: { register: spot(-80, 21.2, N), island: spot(-80, 14.5, -Math.PI / 2), ice: spot(-73.5, 19.4, N) },
  },
  diner: {
    id: 'diner', name: 'Sunny Side Burgers', side: 1, x0: -124, x1: -98, depth: 28,
    door: spot(-112, 15.6, N),
    bays: { d1: spot(-119.5, 11.6, N), d2: spot(-115.5, 11.6, N), window: spot(-100.5, 19.5, N) },
    posts: { grill: spot(-108.5, 21.5, N), window: spot(-102.2, 19.5, Math.PI / 2), counter: spot(-112, 18, N), patio: spot(-106, 13.2, N) },
  },
  resort: {
    id: 'resort', name: 'Hood Springs Resort', side: -1, x0: -196, x1: -66, depth: 64,
    door: spot(-133, -19.5, S),
    bays: { s1: spot(-127, -12.4, S), s2: spot(-121, -12.4, S) },
    posts: { pool: spot(-100, -16.5, S), desk: spot(-133, -21, S), cabana: spot(-91, -34, S), dock: spot(-170, -30, -Math.PI / 2), lawn: spot(-150, -14, S) },
  },
}

export const PLACE_IDS = Object.keys(PLACES) as PlaceId[]

/** Where a vehicle can be: a parking bay at a workplace, the curb in front of a lot, a point on the road, or off the map. */
export type Stop =
  | { kind: 'bay'; place: PlaceId; bay: string }
  | { kind: 'curb'; lot: number; offset?: number }
  | { kind: 'road'; x: number; side: 1 | -1 }
  | { kind: 'edge'; end: 1 | -1 }
  | { kind: 'drive'; place: 'diner' }

export function placeOf(id: PlaceId): Place {
  return PLACES[id]
}

export function lotSide(lot: number): 1 | -1 {
  return lot < LOTS_PER_SIDE ? 1 : -1
}

/** The curb spot in front of a lot, on the lot's side of the street. */
export function curbSpot(lot: number, offset = 0): Spot {
  const [x, z] = lotToWorld(lot, 10 + offset, -3.4)
  return { x, z, yaw: lotSide(lot) > 0 ? Math.PI / 2 : -Math.PI / 2 }
}

/** The middle of a lot's front yard in world space. */
export function frontYard(lot: number, lx = 10, lz = 2.2): Spot {
  const [x, z] = lotToWorld(lot, lx, lz)
  return { x, z, yaw: lotPlacement(lot).yaw }
}

export function lampSpot(index: number): Spot {
  const i = index % (LOTS_PER_SIDE * 2)
  const side = i % 2 ? -1 : 1
  const slot = Math.floor(i / 2) % LOTS_PER_SIDE
  const x = -STREET_LENGTH / 2 + slot * 20 + (side > 0 ? 0 : 10)
  return { x, z: side * (STREET_HALF - 1.7), yaw: side > 0 ? 0 : Math.PI }
}

export function stopSpot(stop: Stop): Spot {
  switch (stop.kind) {
    case 'bay': return PLACES[stop.place].bays[stop.bay]
    case 'curb': return curbSpot(stop.lot, stop.offset)
    case 'road': return { x: stop.x, z: stop.side * 3.4, yaw: stop.side > 0 ? Math.PI / 2 : -Math.PI / 2 }
    case 'edge': return { x: stop.end * ROAD_END, z: stop.end > 0 ? -LANE : LANE, yaw: stop.end > 0 ? -Math.PI / 2 : Math.PI / 2 }
    case 'drive': return PLACES.diner.bays.window
  }
}

function access(stop: Stop, leaving = false): { x: number; pts: [number, number][] } {
  switch (stop.kind) {
    case 'bay': {
      const place = PLACES[stop.place]
      const s = place.bays[stop.bay]
      if (stop.place === 'prison' && stop.bay === 'bus') return { x: s.x, pts: [[s.x - 6, place.side * 4.2], [s.x, s.z]] }
      return { x: s.x, pts: [[s.x, place.side * APRON], [s.x, s.z]] }
    }
    case 'curb': {
      const s = curbSpot(stop.lot, stop.offset)
      return { x: s.x, pts: [[s.x, s.z]] }
    }
    case 'road': {
      const s = stopSpot(stop)
      return { x: s.x, pts: [[s.x, s.z]] }
    }
    case 'edge': return { x: stop.end * ROAD_END, pts: [] }
    case 'drive': return leaving ? { x: -95, pts: [[-95, APRON], [-95, 25.5], [-100.5, 24], [-100.5, 19.5]] } : { x: -98.5, pts: [[-98.5, APRON], [-100.5, 14], [-100.5, 19.5]] }
  }
}

export interface Path {
  pts: [number, number][]
  times: number[]
  duration: number
}

/** A drive from one stop to another: out to the road, along the lane for the direction of travel, and in at the other end. */
export function route(from: Stop, to: Stop, rush = false): Path {
  const a = access(from, true)
  const b = access(to)
  const dir = b.x >= a.x ? 1 : -1
  const lane = dir > 0 ? LANE : -LANE
  const pts: [number, number][] = []
  const out = [...a.pts].reverse()
  for (const p of out) pts.push(p)
  if (from.kind === 'edge') pts.push([a.x, lane])
  else pts.push([a.x + dir * 4, lane])
  if (Math.abs(b.x - a.x) > 12) pts.push([b.x - dir * 6, lane])
  if (to.kind === 'edge') pts.push([b.x, lane])
  for (const p of b.pts) pts.push(p)
  const clean: [number, number][] = []
  for (const p of pts) {
    const last = clean[clean.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) clean.push(p)
  }
  const times = [0]
  for (let i = 1; i < clean.length; i++) {
    const [x0, z0] = clean[i - 1], [x1, z1] = clean[i]
    const onRoad = Math.abs(z0) <= 4.4 && Math.abs(z1) <= 4.4
    const speed = (onRoad ? ROAD_SPEED : YARD_SPEED) * (rush ? 1.35 : 1)
    times.push(times[i - 1] + Math.hypot(x1 - x0, z1 - z0) / speed)
  }
  return { pts: clean, times, duration: times[times.length - 1] }
}

function pointAt(path: Path, t: number): [number, number] {
  const { pts, times } = path
  if (t <= 0) return pts[0]
  if (t >= path.duration) return pts[pts.length - 1]
  let i = 1
  while (i < times.length - 1 && times[i] < t) i++
  const span = times[i] - times[i - 1] || 1
  const f = (t - times[i - 1]) / span
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]
}

/** Position and heading a given number of seconds into a drive; the heading looks a little ahead so corners round off. */
export function alongPath(path: Path, t: number): Spot {
  const [x, z] = pointAt(path, t)
  const [ax, az] = pointAt(path, t + 0.45)
  const [bx, bz] = pointAt(path, t - 0.15)
  const dx = ax - bx, dz = az - bz
  if (Math.hypot(dx, dz) < 1e-4) {
    const n = path.pts.length
    const [px, pz] = path.pts[Math.max(0, n - 2)], [qx, qz] = path.pts[n - 1]
    return { x, z, yaw: Math.atan2(qx - px, qz - pz) }
  }
  return { x, z, yaw: Math.atan2(dx, dz) }
}

export function isLot(lot: number): boolean {
  return Number.isInteger(lot) && lot >= 0 && lot < LOTS_PER_STREET
}

/** The lots in the order a crew works down the street: the north side west to east, then the south side back. */
export const STREET_ORDER: number[] = [...Array.from({ length: LOTS_PER_SIDE }, (_, i) => i), ...Array.from({ length: LOTS_PER_SIDE }, (_, i) => LOTS_PER_STREET - 1 - i)]
