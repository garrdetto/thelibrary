import type { Config, TrackDef } from './config'
import type { SimCar, Zone } from './car'
import type { Track } from './track'

export type Phase = 'idle' | 'attack' | 'pace' | 'green' | 'caution' | 'checkered' | 'done'
export type RaceMode = 'time-attack' | 'race' | 'multiplayer'

export type RaceState = {
  ph: Phase
  mode: RaceMode
  laps: number
  fo: string[]
  gn: boolean
  gnCross: number
  cT: number
  greenT: number
  ckT: number
  white: boolean
  formP: number | null
}

/** Things the simulation reports for the renderer, the sound and the network to act on. */
export type SimEvent =
  | { t: 'sparks'; x: number; y: number; z: number; n: number; vx: number; vz: number; nx: number; nz: number; k: 'wall' | 'car' }
  | { t: 'impact'; id: string; x: number; y: number; z: number; v: number; vx: number; vz: number; nx: number; nz: number; k: 'wall' | 'car' }
  | { t: 'damage'; id: string; lp: [number, number, number]; dir: [number, number, number]; amt: number; zone: Zone }
  | { t: 'lap'; id: string; ms: number }
  | { t: 'reset'; id: string }

/** 'classic': the original kinematic model (golden-tested); 'next': the Phase 4 tire and suspension model. */
export type VehicleModel = 'classic' | 'next'

export type World = {
  model: VehicleModel
  def: TrackDef
  cfg: Config
  track: Track
  cars: Map<string, SimCar>
  race: RaceState
  /** Seeded generator for every random decision the simulation makes. */
  rand: () => number
  /** Simulation clock in seconds. */
  now: () => number
  events: SimEvent[]
}

export function newRaceState(): RaceState {
  return { ph: 'idle', mode: 'race', laps: 25, fo: [], gn: false, gnCross: 0, cT: 0, greenT: 0, ckT: 0, white: false, formP: null }
}
