/**
 * The Foxtails Lounge & Casino: Fox Lake's walk-in casino, the old Northwoods Lodge moved inside Foxtails Gentlemen's
 * Club east of Montello on State Highway 23. Everything below is laid out in the casino's own frame (a 32 by 24 m floor
 * with the doorway in the low-z wall, `yaw` 0 faces +z); `SITE` says where that frame stands in Montello's town frame
 * (scripts/montello-places.mjs finds it), and `localToTown`, `townToLocal` and `siteYaw` carry points and yaws across.
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

export const CASINO = {
  x0: 100,
  x1: 132,
  z0: 66,
  z1: 90,
  height: 5.6,
  wall: 0.3,
  floorY: 0.06,
  /** The doorway in the south wall, facing South St. */
  door: { x: 116, width: 3.4, height: 3.0 },
  /** Keep the town's woods off the building, its apron and its sign. */
  clear: { x0: 93, x1: 139, z0: 58, z1: 97 },
} as const

const CHAIR_HIP = 0.66
const STOOL_HIP = 0.86

const LOCAL_CENTER = { x: (CASINO.x0 + CASINO.x1) / 2, z: (CASINO.z0 + CASINO.z1) / 2 }

/** Where the casino's floor stands in Montello's town frame: its middle, the way it is turned (0 or pi) and its floor height. */
export const SITE: { x: number; z: number; yaw: number; y: number; name: string; building: number } = MONTELLO_CASINO ?? { ...LOCAL_CENTER, yaw: 0, y: 0, name: 'Foxtails Lounge & Casino', building: -1 }

/** A point of the casino's frame in the town frame. */
export function localToTown(x: number, z: number, out = { x: 0, z: 0 }): { x: number; z: number } {
  const dx = x - LOCAL_CENTER.x
  const dz = z - LOCAL_CENTER.z
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
  out.x = LOCAL_CENTER.x + dx * c - dz * s
  out.z = LOCAL_CENTER.z + dx * s + dz * c
  return out
}

/** A yaw in the casino's frame as a town yaw. */
export const siteYaw = (yaw: number): number => yaw + SITE.yaw

/** Ten machines: five along the west wall facing east, five along the east wall facing west. */
export const MACHINE_SPOTS: MachineSpot[] = (() => {
  const out: MachineSpot[] = []
  const rows = [70.2, 73.2, 76.2, 79.2, 82.2]
  rows.forEach((z, i) => {
    const x = CASINO.x0 + CASINO.wall + 0.45
    out.push({ index: i, x, z, yaw: Math.PI / 2, seat: { x: x + 1.05, y: CASINO.floorY + CHAIR_HIP, z, yaw: -Math.PI / 2 } })
  })
  rows.forEach((z, i) => {
    const x = CASINO.x1 - CASINO.wall - 0.45
    out.push({ index: 5 + i, x, z, yaw: -Math.PI / 2, seat: { x: x - 1.05, y: CASINO.floorY + CHAIR_HIP, z, yaw: Math.PI / 2 } })
  })
  return out
})()

/** The bar along the north wall: counter, back bar and eight stools. */
export const BAR = {
  counter: { x0: 104, x1: 126, z0: 86.0, z1: 86.9, top: 1.1 },
  backBar: { x0: 104, x1: 128, z0: 89.1, z1: CASINO.z1 - CASINO.wall },
  bartender: { x: 115, z: 88.2, yaw: Math.PI },
  stools: Array.from({ length: 8 }, (_, i): Seat => ({ x: 105.5 + i * 2.6, y: CASINO.floorY + STOOL_HIP, z: 85.1, yaw: 0 })),
  /** What a beer costs (the wallet pays it). */
  beerPrice: 5,
} as const

/** The blackjack table: a half-round table, dealer on the north side, five player spots on the arc. */
export const BLACKJACK = {
  x: 116,
  z: 78.6,
  radius: 1.9,
  top: 0.82,
  dealer: { x: 116, z: 79.9, yaw: Math.PI },
  seats: [-0.9, -0.45, 0, 0.45, 0.9].map((a): Seat => ({ x: 116 + Math.sin(a) * 2.55, y: CASINO.floorY + CHAIR_HIP, z: 78.6 - Math.cos(a) * 2.55, yaw: -a })),
} as const

/** Slot bets per spin: the house limit is $5. */
export const BET_STEPS = [0.4, 0.8, 1.2, 2, 3, 4, 5] as const
/** Blackjack opening bets: the table limit is $200 (doubling or splitting can put more on the felt). */
export const BLACKJACK_BETS = [5, 10, 25, 50, 100, 200] as const

export function insideCasino(x: number, z: number, margin = 0): boolean {
  return x > CASINO.x0 - margin && x < CASINO.x1 + margin && z > CASINO.z0 - margin && z < CASINO.z1 + margin
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
