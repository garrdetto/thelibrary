import type { Dyn } from './dynamics'
import type { TrackPos } from './track'

export type Zone = 'f' | 'r' | 'l' | 'rt'
export type Damage = Record<Zone, number>
export type Controls = { thr: boolean | number; brk: boolean | number; steer: number }
export type SideMode = 'hard' | 'room' | null

/** Everything the classic `Car` carried that the simulation reads or writes. Field names are kept for the port. */
export type SimCar = {
  id: string
  local: boolean
  ai: boolean
  isPace: boolean
  isPlayer: boolean
  auto: boolean
  /** True for the Super Late Model and custom cars (`m.car` in the classic module), false for the truck. */
  stockCar: boolean
  x: number; z: number; h: number; vx: number; vz: number; vf: number; av: number
  steer: number; steerV: number; thr: number; brk: number; slip: number
  dmg: Damage
  cross: number; sp: number
  lapStart: number | null; lastLap: number | null; bestLap: number | null; lapDirty: boolean
  fin: boolean; stopT: number; stuckT: number; cautioned: boolean; vis: boolean
  lane: number; passOff: number; aiDecel: number; fileLane: number; laneT: number; skill: number
  boost: number; boostRate: number; boostTgt: number; pitting: boolean
  tp: TrackPos
  ck: number; cf: number
  gripB: number; powB: number; gripB0: number; powB0: number
  passD: number; laneCD: number; aggr: number; lapTgt: number; paceK: number; paceCk: [number | null, number | null] | null
  sideId: string | null; sideMode: SideMode; sideT: number
  gridRow: number | null; startFile: number; startHoldT: number
  relLane: number | null; evadeLane: number; evadeT: number; looseT: number
  bumpT: number; bumpCD: number; bumpOn: string | null; heldT: number
  aiTurn: boolean; brkTight: boolean; brkAt: number
  /** State of the Phase 4 vehicle model (`World.model === 'next'`). */
  dyn?: Dyn
}

export function createCar(id: string, o: { local?: boolean; ai?: boolean; pace?: boolean; player?: boolean; stockCar?: boolean } = {}): SimCar {
  return {
    id, local: !!o.local, ai: !!o.ai, isPace: !!o.pace, isPlayer: !!o.player, auto: false, stockCar: !!o.stockCar,
    x: 0, z: 0, h: 0, vx: 0, vz: 0, vf: 0, av: 0, steer: 0, steerV: 0, thr: 0, brk: 0, slip: 0,
    dmg: { f: 0, r: 0, l: 0, rt: 0 }, cross: 0, sp: 0, lapStart: null, lastLap: null, bestLap: null, lapDirty: false,
    fin: false, stopT: 0, stuckT: 0, cautioned: false, vis: true,
    lane: -3.6, passOff: 0, aiDecel: 0, fileLane: -3.6, laneT: 0, skill: 0.97,
    boost: 1, boostRate: 0, boostTgt: 1, pitting: false,
    tp: { s: 0, lat: 0 }, ck: 0, cf: 1,
    gripB: 1, powB: 1, gripB0: 1, powB0: 1, passD: 20, laneCD: 3, aggr: 0.5, lapTgt: 0, paceK: 1, paceCk: null,
    sideId: null, sideMode: null, sideT: 0, gridRow: null, startFile: 0, startHoldT: 0,
    relLane: null, evadeLane: 0, evadeT: 0, looseT: 0, bumpT: 0, bumpCD: 0, bumpOn: null, heldT: 0,
    aiTurn: false, brkTight: false, brkAt: 0,
  }
}

export const speedOf = (c: SimCar): number => Math.hypot(c.vx, c.vz)
