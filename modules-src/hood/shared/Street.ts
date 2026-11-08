export const LOT_W = 20
export const LOT_D = 24
export const LOTS_PER_STREET = 12
export const LOTS_PER_SIDE = LOTS_PER_STREET / 2
export const STREET_HALF = 7
export const MAX_STREETS = 64
export const STREET_LENGTH = LOTS_PER_SIDE * LOT_W

const STREET_NAMES = [
  'Juniper Court', 'Alder Lane', 'Bramble Way', 'Cedar Hollow', 'Dogwood Drive', 'Elmhurst Row', 'Foxglove Path', 'Garnet Street',
  'Hazel Bend', 'Ironwood Circle', 'Jasper Walk', 'Kettle Creek Road', 'Linden Terrace', 'Marigold Lane', 'Nettle Grove', 'Orchard Rise',
]

export function streetName(street: number): string {
  const base = STREET_NAMES[street % STREET_NAMES.length]
  const round = Math.floor(street / STREET_NAMES.length)
  return round ? `${base} ${round + 1}` : base
}

export function houseNumber(lot: number): number {
  const north = lot < LOTS_PER_SIDE
  const slot = north ? lot : lot - LOTS_PER_SIDE
  return 100 + slot * 4 + (north ? 1 : 2)
}

export function lotAddress(street: number, lot: number): string {
  return `${houseNumber(lot)} ${streetName(street)}`
}

export function isLotIndex(lot: number): boolean {
  return Number.isInteger(lot) && lot >= 0 && lot < LOTS_PER_STREET
}

export function isStreetIndex(street: number): boolean {
  return Number.isInteger(street) && street >= 0 && street < MAX_STREETS
}

export interface LotPlacement {
  /** World position of the lot's local origin (tile 0,0 corner). */
  x: number
  z: number
  /** Rotation about Y that turns lot-local axes into world axes. */
  yaw: number
}

/** North-side lots (0–5) face the street with local z running north; south-side lots (6–11) are turned half a circle. */
export function lotPlacement(lot: number): LotPlacement {
  const north = lot < LOTS_PER_SIDE
  const slot = north ? lot : lot - LOTS_PER_SIDE
  const left = -STREET_LENGTH / 2 + slot * LOT_W
  if (north) return { x: left, z: STREET_HALF, yaw: 0 }
  return { x: left + LOT_W, z: -STREET_HALF, yaw: Math.PI }
}

export function lotToWorld(lot: number, lx: number, lz: number): [number, number] {
  const p = lotPlacement(lot)
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw)
  return [p.x + lx * c + lz * s, p.z - lx * s + lz * c]
}
