/** Regulation board geometry and polar scoring: radial thresholds in millimetres, the clockwise number ring from 20 at the top, and the score of any point on the face. */
import type { BoardKind, DartThrow, Multiplier, Ring, Vec3 } from './interfaces'

/** Clockwise from straight up. */
export const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const
export const SECTOR_DEGREES = 360 / SECTORS.length

/** Radii in millimetres measured from the centre of the bull to the inside of each wire (regulation board). */
export const RADII = {
  innerBull: 6.35,
  outerBull: 15.9,
  tripleInner: 99,
  tripleOuter: 107,
  doubleInner: 162,
  doubleOuter: 170,
  numberRing: 196,
  board: 225.5,
} as const

export type BoardRadii = { readonly [K in keyof typeof RADII]: number }

/** The soft-tip board's beds: its doubles and triples are moulded 10 mm deep (a quarter deeper than the steel board's 8 mm) so three rows of full-size tip holes fit, with the double ring keeping its outer edge. */
export const SOFT_RADII: BoardRadii = { ...RADII, tripleInner: 98, tripleOuter: 108, doubleInner: 160, doubleOuter: 170 }

export function radiiFor(board: BoardKind = 'steel'): BoardRadii {
  return board === 'spider' ? SOFT_RADII : RADII
}

/** Centre-to-centre distance between neighbouring tip holes on the soft-tip board, in millimetres. */
export const HOLE_PITCH_MM = 3.4

/** Height of the bull above the floor and the throwing distance from the face to the oche, in metres. */
export const BULL_HEIGHT = 1.73
export const OCHE_DISTANCE = 2.37

const RAD_TO_DEG = 180 / Math.PI

/** Polar form of a board-space point given in millimetres: radius from the bull and angle in degrees clockwise from straight up, in [0, 360). */
export function toPolar(xMm: number, yMm: number): { radius: number; angle: number } {
  const radius = Math.hypot(xMm, yMm)
  let angle = Math.atan2(xMm, yMm) * RAD_TO_DEG
  if (angle < 0) angle += 360
  if (angle >= 360) angle -= 360
  return { radius, angle }
}

/** The wedge under an angle: each number owns 18° centred on its own axis, so 20 spans 351°–9°. */
export function sectorAt(angle: number): number {
  const shifted = (((angle + SECTOR_DEGREES / 2) % 360) + 360) % 360
  return SECTORS[Math.floor(shifted / SECTOR_DEGREES) % SECTORS.length]
}

export function ringAt(radius: number, board: BoardKind = 'steel'): Ring {
  const RADII = radiiFor(board)
  if (radius <= RADII.innerBull) return 'innerBull'
  if (radius <= RADII.outerBull) return 'outerBull'
  if (radius < RADII.tripleInner) return 'singleInner'
  if (radius <= RADII.tripleOuter) return 'triple'
  if (radius < RADII.doubleInner) return 'singleOuter'
  if (radius <= RADII.doubleOuter) return 'double'
  return 'miss'
}

/** Scores a point on the face. `x`/`y` are metres from the bull in board space; `z` is kept so the dart can be drawn where it stuck. */
export function scoreAt(x: number, y: number, z = 0, board: BoardKind = 'steel'): DartThrow {
  const { radius, angle } = toPolar(x * 1000, y * 1000)
  const ring = ringAt(radius, board)
  const wedge = sectorAt(angle)
  let sector: number = wedge
  let multiplier: Multiplier = 1
  let scoreValue = wedge
  switch (ring) {
    case 'innerBull':
      sector = 25
      multiplier = 2
      scoreValue = 50
      break
    case 'outerBull':
      sector = 25
      multiplier = 1
      scoreValue = 25
      break
    case 'triple':
      multiplier = 3
      scoreValue = wedge * 3
      break
    case 'double':
      multiplier = 2
      scoreValue = wedge * 2
      break
    case 'miss':
      sector = 0
      multiplier = 0
      scoreValue = 0
      break
    default:
      break
  }
  const coordinates: Vec3 = [x, y, z]
  return { coordinates, sector, multiplier, ring, scoreValue, angle: round(angle, 3), radius: round(radius, 3) }
}

/** The board-space centre (metres) of a named bed, used by the computer opponent and the checkout hints. */
export function targetPoint(sector: number, multiplier: Multiplier, board: BoardKind = 'steel'): { x: number; y: number } {
  const RADII = radiiFor(board)
  if (sector === 25) return { x: 0, y: multiplier === 2 ? 0 : (RADII.innerBull + RADII.outerBull) / 2000 }
  const index = SECTORS.indexOf(sector as (typeof SECTORS)[number])
  if (index < 0) return { x: 0, y: 0 }
  const radiusMm =
    multiplier === 3 ? (RADII.tripleInner + RADII.tripleOuter) / 2
    : multiplier === 2 ? (RADII.doubleInner + RADII.doubleOuter) / 2
    : (RADII.tripleOuter + RADII.doubleInner) / 2
  const angle = (index * SECTOR_DEGREES) / RAD_TO_DEG
  return { x: (Math.sin(angle) * radiusMm) / 1000, y: (Math.cos(angle) * radiusMm) / 1000 }
}

export function label(dart: Pick<DartThrow, 'sector' | 'multiplier'>): string {
  if (dart.multiplier === 0) return 'Miss'
  if (dart.sector === 25) return dart.multiplier === 2 ? 'Bull' : '25'
  return `${dart.multiplier === 3 ? 'T' : dart.multiplier === 2 ? 'D' : 'S'}${dart.sector}`
}

export function spokenLabel(dart: Pick<DartThrow, 'sector' | 'multiplier'>): string {
  if (dart.multiplier === 0) return 'Missed the board'
  if (dart.sector === 25) return dart.multiplier === 2 ? 'Bullseye!' : 'Outer bull'
  if (dart.multiplier === 3) return `Triple ${dart.sector}!`
  if (dart.multiplier === 2) return `Double ${dart.sector}`
  return `${dart.sector}`
}

function round(value: number, places: number): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}
