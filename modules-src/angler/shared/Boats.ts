/** Boats, motors and paint schemes. The bass boat is the owner's model; the jon boat and pontoon are procedural. */
import { PALETTE } from './Wardrobe'
import type { PaletteColor } from './Wardrobe'

export const boatKinds = ['bass', 'jon', 'pontoon'] as const
export type BoatKind = (typeof boatKinds)[number]

export const liveries = ['sweep', 'twotone', 'fade', 'solid', 'racing'] as const
export type Livery = (typeof liveries)[number]

export interface BoatPaint {
  livery: Livery
  primary: PaletteColor
  secondary: PaletteColor
  trim: PaletteColor
  seats: PaletteColor
  carpet: PaletteColor
  motor: PaletteColor
  flake: boolean
}

export const DEFAULT_PAINT: BoatPaint = { livery: 'sweep', primary: 'red', secondary: 'black', trim: 'white', seats: 'red', carpet: 'charcoal', motor: 'black', flake: true }

export interface Seat {
  /** Floor position under the angler's feet in boat space (metres, bow toward -Z). */
  x: number
  y: number
  z: number
  /** Cushion height above that floor for seated poses. */
  seat: number
  yaw: number
  pose: 'drive' | 'sit' | 'stand'
  label: string
}

export interface BoatSpec {
  kind: BoatKind
  name: string
  lengthFt: number
  seats: Seat[]
  /** Fishing stations in boat space used when anchored. */
  stations: Seat[]
  /** Hull draft in metres; the boat runs aground in shallower water. */
  draft: number
  /** Half length and half beam in metres, for shore checks. */
  halfLength: number
  halfBeam: number
  maxMph: number
  planeMph: number
  turnRate: number
  deck: number
  wheel?: [number, number, number]
}

export const BOATS: Record<BoatKind, BoatSpec> = {
  bass: {
    kind: 'bass', name: '20-ft bass boat', lengthFt: 20,
    seats: [
      { x: 0.6, y: 0.25, z: 0.7, seat: 0.38, yaw: 0, pose: 'drive', label: 'Helm' },
      { x: -0.6, y: 0.25, z: 0.7, seat: 0.38, yaw: 0, pose: 'sit', label: 'Console seat' },
      { x: 0.55, y: 0.46, z: -1.52, seat: 0.4, yaw: 0, pose: 'sit', label: 'Bow seat' },
      { x: 0, y: 0.5, z: 1.82, seat: 0.56, yaw: 180, pose: 'sit', label: 'Stern seat' },
    ],
    stations: [
      { x: 0.1, y: 0.47, z: -2.3, seat: 0, yaw: -20, pose: 'stand', label: 'Front deck' },
      { x: -0.45, y: 0.5, z: 1.45, seat: 0, yaw: 150, pose: 'stand', label: 'Back deck' },
      { x: -0.55, y: 0.47, z: -1.0, seat: 0, yaw: -85, pose: 'stand', label: 'Port bow' },
      { x: 0.6, y: 0.5, z: 1.45, seat: 0, yaw: 110, pose: 'stand', label: 'Starboard aft' },
    ],
    draft: 0.38, halfLength: 3.2, halfBeam: 1.15, maxMph: 62, planeMph: 17, turnRate: 1.05, deck: 0.5, wheel: [0.6, 0.73, 0.2],
  },
  jon: {
    kind: 'jon', name: '14-ft jon boat', lengthFt: 14,
    seats: [
      { x: 0.25, y: 0.13, z: 1.55, seat: 0.32, yaw: 0, pose: 'drive', label: 'Tiller' },
      { x: 0, y: 0.13, z: 0.1, seat: 0.32, yaw: 180, pose: 'sit', label: 'Middle bench' },
      { x: 0, y: 0.13, z: -1.2, seat: 0.32, yaw: 0, pose: 'sit', label: 'Bow bench' },
      { x: -0.3, y: 0.13, z: 1.55, seat: 0.32, yaw: 0, pose: 'sit', label: 'Stern bench' },
    ],
    stations: [
      { x: 0, y: 0.13, z: -1.4, seat: 0, yaw: -10, pose: 'stand', label: 'Bow' },
      { x: 0.2, y: 0.13, z: 1.2, seat: 0, yaw: 160, pose: 'stand', label: 'Stern' },
      { x: -0.3, y: 0.13, z: 0.2, seat: 0, yaw: -100, pose: 'stand', label: 'Port' },
      { x: 0.3, y: 0.13, z: -0.4, seat: 0, yaw: 95, pose: 'stand', label: 'Starboard' },
    ],
    draft: 0.18, halfLength: 2.15, halfBeam: 0.8, maxMph: 24, planeMph: 13, turnRate: 1.3, deck: 0.25,
  },
  pontoon: {
    kind: 'pontoon', name: '22-ft pontoon', lengthFt: 22,
    seats: [
      { x: 0.75, y: 0.55, z: 0.9, seat: 0.43, yaw: 0, pose: 'drive', label: 'Helm' },
      { x: -0.9, y: 0.55, z: -1.4, seat: 0.43, yaw: 90, pose: 'sit', label: 'Port lounge' },
      { x: 0.9, y: 0.55, z: -1.6, seat: 0.43, yaw: -90, pose: 'sit', label: 'Starboard lounge' },
      { x: -0.5, y: 0.55, z: 2.4, seat: 0.43, yaw: 180, pose: 'sit', label: 'Aft bench' },
    ],
    stations: [
      { x: -0.6, y: 0.55, z: -3.0, seat: 0, yaw: -15, pose: 'stand', label: 'Bow gate' },
      { x: 0.6, y: 0.55, z: -3.0, seat: 0, yaw: 15, pose: 'stand', label: 'Bow rail' },
      { x: -1.05, y: 0.55, z: 2.9, seat: 0, yaw: 160, pose: 'stand', label: 'Aft port' },
      { x: 1.05, y: 0.55, z: 2.9, seat: 0, yaw: -160, pose: 'stand', label: 'Aft starboard' },
    ],
    draft: 0.5, halfLength: 3.4, halfBeam: 1.3, maxMph: 30, planeMph: 99, turnRate: 0.8, deck: 0.62,
  },
}

export function normalizePaint(input: unknown): BoatPaint {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const color = (v: unknown, f: PaletteColor): PaletteColor => (typeof v === 'string' && v in PALETTE ? (v as PaletteColor) : f)
  return {
    livery: typeof s.livery === 'string' && (liveries as readonly string[]).includes(s.livery) ? (s.livery as Livery) : DEFAULT_PAINT.livery,
    primary: color(s.primary, DEFAULT_PAINT.primary),
    secondary: color(s.secondary, DEFAULT_PAINT.secondary),
    trim: color(s.trim, DEFAULT_PAINT.trim),
    seats: color(s.seats, DEFAULT_PAINT.seats),
    carpet: color(s.carpet, DEFAULT_PAINT.carpet),
    motor: color(s.motor, DEFAULT_PAINT.motor),
    flake: s.flake === undefined ? DEFAULT_PAINT.flake : s.flake === true,
  }
}

export const LIVERY_LABELS: Record<Livery, string> = { sweep: 'Sweep stripe', twotone: 'Two-tone', fade: 'Bow-to-stern fade', solid: 'Solid with pinstripe', racing: 'Racing stripes' }
