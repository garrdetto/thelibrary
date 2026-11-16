/**
 * The Foxtails Lounge & Casino: Fox Lake's walk-in casino inside Foxtails Gentlemen's Club's own building on 16th Road,
 * north of State Highway 23. The building keeps its real footprint (an L: a 10.6 m wide hall running north, a wider wing
 * across its north end and a small bay off the back); `SITE.outline` is that footprint in the casino's own frame, where
 * local +z runs up the building (north) and local +x away from the front that faces 16th Road, so the hall's front wall is
 * about x 103.2 and its south wall z 66 (scripts/montello-places.mjs). `localToTown`, `townToLocal` and `siteYaw` carry
 * points and yaws across. Inside: slot machines down both long walls, the blackjack table mid-floor, a pole stage at the
 * hall's north end and the bar across the north wing.
 */
import { MONTELLO_CASINO } from '../../maplestreet/shared/MontelloPlaces'

export interface Seat {
  /** Hip position of whoever sits there (x, y, z, town coordinates). */
  x: number
  y: number
  z: number
  /** Which way the sitter faces (town yaw: forward is (sin yaw, cos yaw)). */
  yaw: number
}

export interface MachineSpot {
  /** Index into the machine list (`casino/machines.ts`). */
  index: number
  /** Centre of the cabinet's footprint on the floor. */
  x: number
  z: number
  yaw: number
  seat: Seat
  /** The casino floor's height in the town when the spot is placed there (`placeSpot`); 0 in the casino's own frame. */
  y0?: number
}

export interface Room { x0: number; x1: number; z0: number; z1: number }

/** The casino frame's origin (scripts/montello-places.mjs `CASINO_ORIGIN`): `SITE.x`, `SITE.z` is this point in the town. */
export const LOCAL_ORIGIN = { x: 100, z: 66 }

/** The footprint when the map has no casino site (tests, offline): the hall alone. */
const FALLBACK_OUTLINE = [103.2, 66, 113.8, 66, 113.8, 95.2, 103.2, 95.2]

/** Where the casino's frame stands in Montello's town frame: its origin, the way it is turned, its floor height and its footprint. */
export const SITE: { x: number; z: number; yaw: number; y: number; name: string; building: number; outline: number[] } = MONTELLO_CASINO ?? { ...LOCAL_ORIGIN, yaw: 0, y: 0, name: 'Foxtails Lounge & Casino', building: -1, outline: FALLBACK_OUTLINE }

/**
 * The footprint with every wall made exactly square to the casino's frame (the survey is off by a few centimetres):
 * each edge runs along x or z, and every corner takes the shared coordinate of its two walls.
 */
export const FOOTPRINT: { x: number; z: number }[] = (() => {
  const o = SITE.outline
  const n = o.length / 2
  const pt = (i: number) => {
    const k = ((i % n) + n) % n
    return { x: o[2 * k], z: o[2 * k + 1] }
  }
  const runsZ = (i: number) => Math.abs(pt(i + 1).x - pt(i).x) < Math.abs(pt(i + 1).z - pt(i).z)
  const out: { x: number; z: number }[] = []
  for (let i = 0; i < n; i++) {
    const zEdge = runsZ(i) ? i : i - 1
    const xEdge = runsZ(i) ? i - 1 : i
    const x = (pt(zEdge).x + pt(zEdge + 1).x) / 2
    const z = (pt(xEdge).z + pt(xEdge + 1).z) / 2
    out.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 })
  }
  return out
})()

const xs = FOOTPRINT.map((p) => p.x)
const zs = FOOTPRINT.map((p) => p.z)

/** The footprint as rectangles (strips between the corners' z values, merged where they line up), for the floor, ceiling and roof. */
export const ROOMS: Room[] = (() => {
  const levels = [...new Set(zs)].sort((a, b) => a - b)
  const out: Room[] = []
  for (let k = 0; k + 1 < levels.length; k++) {
    const z0 = levels[k]
    const z1 = levels[k + 1]
    const mid = (z0 + z1) / 2
    const cross: number[] = []
    for (let i = 0; i < FOOTPRINT.length; i++) {
      const a = FOOTPRINT[i]
      const b = FOOTPRINT[(i + 1) % FOOTPRINT.length]
      if (a.x === b.x && (a.z - mid) * (b.z - mid) < 0) cross.push(a.x)
    }
    cross.sort((a, b) => a - b)
    for (let j = 0; j + 1 < cross.length; j += 2) {
      const prev = out.find((r) => r.x0 === cross[j] && r.x1 === cross[j + 1] && r.z1 === z0)
      if (prev) prev.z1 = z1
      else out.push({ x0: cross[j], x1: cross[j + 1], z0, z1 })
    }
  }
  return out
})()

const SOUTH: Room = ROOMS.reduce((a, b) => (b.z0 < a.z0 ? b : a))
const ZMAX = Math.max(...zs)
const frontWing = FOOTPRINT.filter((p) => p.x < SOUTH.x0 - 0.5).map((p) => p.z)
/** The hall: the long room the door opens into, from the south wall to where the north wing starts. */
const HALL: Room = { x0: SOUTH.x0, x1: SOUTH.x1, z0: SOUTH.z0, z1: frontWing.length ? Math.min(...frontWing) : ZMAX }
/** The north wing across the hall's end (the bar), or the hall's north end when the footprint has none. */
const WING: Room = frontWing.length ? { x0: Math.min(...xs), x1: ROOMS.filter((r) => r.z1 === ZMAX).reduce((a, r) => Math.max(a, r.x1), HALL.x1), z0: HALL.z1, z1: ZMAX } : { ...HALL, z0: HALL.z1 - 9 }
const backBay = FOOTPRINT.filter((p) => p.x > SOUTH.x1 + 0.5)

export const CASINO = {
  x0: Math.min(...xs),
  x1: Math.max(...xs),
  z0: Math.min(...zs),
  z1: Math.max(...zs),
  hall: HALL,
  wing: WING,
  /** Eave height: one storey, as the photos from 16th Road show. */
  height: 3.1,
  wall: 0.3,
  floorY: 0.06,
  /** The main doorway in the hall's front wall (x = `hall.x0`), facing 16th Road, under its little gabled vestibule. */
  door: { x: HALL.x0, z: HALL.z0 + 13.6, width: 1.8, height: 2.3 },
  /** The second door, between brick pillars where the north wing steps forward. */
  sideDoor: { x: HALL.x0, z: HALL.z1 - 1.5, width: 1.4, height: 2.3 },
} as const

const CHAIR_HIP = 0.66
const STOOL_HIP = 0.86
const W = CASINO.wall

/** A point of the casino's frame in the town frame. */
export function localToTown(x: number, z: number, out = { x: 0, z: 0 }): { x: number; z: number } {
  const dx = x - LOCAL_ORIGIN.x
  const dz = z - LOCAL_ORIGIN.z
  const c = Math.cos(SITE.yaw)
  const s = Math.sin(SITE.yaw)
  out.x = SITE.x + dx * c + dz * s
  out.z = SITE.z - dx * s + dz * c
  return out
}

/** A town-frame point in the casino's frame. */
export function townToLocal(x: number, z: number, out = { x: 0, z: 0 }): { x: number; z: number } {
  const dx = x - SITE.x
  const dz = z - SITE.z
  const c = Math.cos(SITE.yaw)
  const s = Math.sin(SITE.yaw)
  out.x = LOCAL_ORIGIN.x + dx * c - dz * s
  out.z = LOCAL_ORIGIN.z + dx * s + dz * c
  return out
}

/** A yaw in the casino's frame as a town yaw. */
export const siteYaw = (yaw: number): number => yaw + SITE.yaw

/** Ten machines: five down the front wall either side of the main door, five down the back wall, facing across the hall. */
export const MACHINE_SPOTS: MachineSpot[] = (() => {
  const out: MachineSpot[] = []
  const d = CASINO.door
  const front = [HALL.z0 + 1.6, HALL.z0 + 4.4, HALL.z0 + 7.2, d.z + 4.2, d.z + 7.2]
  const back = [HALL.z0 + 2.4, HALL.z0 + 5.4, HALL.z0 + 8.4, HALL.z0 + 11.4, HALL.z0 + 14.4]
  front.forEach((z, i) => {
    const x = HALL.x0 + W + 0.45
    out.push({ index: i, x, z, yaw: Math.PI / 2, seat: { x: x + 1.05, y: CASINO.floorY + CHAIR_HIP, z, yaw: -Math.PI / 2 } })
  })
  back.forEach((z, i) => {
    const x = HALL.x1 - W - 0.45
    out.push({ index: 5 + i, x, z, yaw: -Math.PI / 2, seat: { x: x - 1.05, y: CASINO.floorY + CHAIR_HIP, z, yaw: Math.PI / 2 } })
  })
  return out
})()

const BAR_X0 = WING.x0 + W + 1.2
const BAR_X1 = WING.x1 - W - 2.4
const BAR_N = WING.z1 - W

/** The bar across the north wing: counter, back bar against the north wall and five stools. */
export const BAR = {
  counter: { x0: BAR_X0, x1: BAR_X1, z0: BAR_N - 3.3, z1: BAR_N - 2.4, top: 1.1 },
  backBar: { x0: BAR_X0, x1: BAR_X1 + 1.2, z0: BAR_N - 1.3, z1: BAR_N },
  bartender: { x: (BAR_X0 + BAR_X1) / 2, z: BAR_N - 1.85, yaw: Math.PI },
  stools: Array.from({ length: 5 }, (_, i): Seat => ({ x: BAR_X0 + 0.9 + (i * (BAR_X1 - BAR_X0 - 1.8)) / 4, y: CASINO.floorY + STOOL_HIP, z: BAR_N - 4.1, yaw: 0 })),
  /** What a beer costs (the wallet pays it). */
  beerPrice: 5,
} as const

const MIDX = (HALL.x0 + HALL.x1) / 2

/** The blackjack table mid-floor: a half-round table, dealer on the north side, five player spots on the arc. */
export const BLACKJACK = {
  x: MIDX,
  z: HALL.z0 + 10,
  radius: 1.9,
  top: 0.82,
  dealer: { x: MIDX, z: HALL.z0 + 11.3, yaw: Math.PI },
  seats: [-0.9, -0.45, 0, 0.45, 0.9].map((a): Seat => ({ x: MIDX + Math.sin(a) * 2.55, y: CASINO.floorY + CHAIR_HIP, z: HALL.z0 + 10 - Math.cos(a) * 2.55, yaw: -a })),
} as const

/** The pole stage at the hall's north end: a round raised deck with a brass pole, ringed with chase lights. */
export const STAGE = { x: MIDX, z: HALL.z1 - 4.2, radius: 2.3, top: 0.55 } as const

/** The DJ booth's bay off the back wall, if the footprint has one. */
export const BOOTH: Room | null = backBay.length ? { x0: SOUTH.x1, x1: Math.max(...backBay.map((p) => p.x)), z0: Math.min(...backBay.map((p) => p.z)), z1: Math.max(...backBay.map((p) => p.z)) } : null

/** Slot bets per spin: the house limit is $5. */
export const BET_STEPS = [0.4, 0.8, 1.2, 2, 3, 4, 5] as const
/** Blackjack opening bets: the table limit is $200 (doubling or splitting can put more on the felt). */
export const BLACKJACK_BETS = [5, 10, 25, 50, 100, 200] as const

export function insideCasino(x: number, z: number, margin = 0): boolean {
  return ROOMS.some((r) => x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin)
}

/** The seat nearest (x, z) within `range`, of any kind. */
export function nearestSeat(x: number, z: number, range: number): { kind: 'machine'; spot: MachineSpot } | { kind: 'stool'; index: number; seat: Seat } | { kind: 'blackjack'; index: number; seat: Seat } | null {
  let best: ReturnType<typeof nearestSeat> = null
  let bd = range
  for (const m of MACHINE_SPOTS) {
    const d = Math.hypot(m.seat.x - x, m.seat.z - z)
    if (d < bd) {
      bd = d
      best = { kind: 'machine', spot: m }
    }
  }
  BAR.stools.forEach((s, i) => {
    const d = Math.hypot(s.x - x, s.z - z)
    if (d < bd) {
      bd = d
      best = { kind: 'stool', index: i, seat: s }
    }
  })
  BLACKJACK.seats.forEach((s, i) => {
    const d = Math.hypot(s.x - x, s.z - z)
    if (d < bd) {
      bd = d
      best = { kind: 'blackjack', index: i, seat: s }
    }
  })
  return best
}
