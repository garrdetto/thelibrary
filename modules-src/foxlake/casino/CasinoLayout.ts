/**
 * The Northwoods Lodge Casino & Bar: Fox Lake's walk-in casino on the north-east
 * corner of East Ave and South St, the last corner before downtown. Town
 * coordinates (the shared world's, right-handed; `yaw` 0 faces +z). Only Fox
 * Lake draws it; classic Fox Plains has woods here.
 */
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

export const BET_STEPS = [0.4, 0.8, 1.2, 2, 4, 8, 20, 40, 80] as const
export const BLACKJACK_BETS = [5, 10, 25, 50, 100, 250, 500] as const

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
