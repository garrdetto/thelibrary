/** Shared sim types. Distances are metres, speeds metres per second, angles degrees, times seconds. Sim frame: x toward first base, y up, z toward center field, home plate's back point at the origin. */

export type Hand = 'L' | 'R'
export type BatSide = Hand | 'S'
export type FieldPosition = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF'
export type LineupPosition = FieldPosition | 'DH'
export type BodyType = 'lean' | 'stocky' | 'belly' | 'tall' | 'short'
export type PitchType = 'FF' | 'SI' | 'FC' | 'SL' | 'SW' | 'CU' | 'CH' | 'FS' | 'KN'
export type SwingType = 'contact' | 'power' | 'bunt'
export type Half = 'top' | 'bottom'
export type Side = 0 | 1

export const FIELD_POSITIONS: readonly FieldPosition[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Ratings {
  contact: number
  power: number
  eye: number
  speed: number
  arm: number
  fielding: number
}

export interface PitchGrade {
  type: PitchType
  grade: number
}

export interface PitchingRatings {
  velocity: number
  control: number
  stamina: number
  stuff: number
  repertoire: PitchGrade[]
  role: 'SP' | 'RP'
}

export interface Player {
  id: string
  first: string
  last: string
  nickname: string
  number: number
  bats: BatSide
  throws: Hand
  position: LineupPosition
  body: BodyType
  height: number
  ratings: Ratings
  pitching: PitchingRatings | null
}

export interface TeamColors {
  primary: string
  secondary: string
  accent: string
}

export interface Team {
  id: string
  city: string
  name: string
  abbr: string
  league: 'Lowbrow' | 'Gutter'
  division: string
  colors: TeamColors
  park: string
  parkName: string
}

export interface Roster {
  team: Team
  hitters: Player[]
  pitchers: Player[]
}

export interface Wind {
  speed: number
  toward: number
}

export interface Park {
  id: string
  name: string
  fence: readonly number[]
  height: readonly number[]
  backstop: number
  foulSide: number
  altitude: number
  gravity: number
  dome: boolean
  wind: Wind
}

export interface Sample {
  t: number
  x: number
  y: number
  z: number
}
