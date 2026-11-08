import { ICONIC_FIELD } from '../iconic-schemes.js'
import { AI_LEVELS, TRACKS } from '../next/sim/config'
import type { Difficulty, TrackId } from '../next/sim/config'
import { rng } from '../next/sim/math'
import { beginRace, buildGrid, createWorld, simCarFactory, tick } from '../next/sim/race'
import type { VehicleModel } from '../next/sim/world'

const FIELD = ICONIC_FIELD.map((f: { number: string }) => String(f.number ?? '').replace(/\D/g, '').slice(0, 3))

/** The live Time Attack baselines frozen with the Phase 0 fixtures (scripts/shorttrack-reference.mjs). */
export const BASELINES: Record<TrackId, number> = { prison: 11.666, bullring: 13.708, dells: 12.812, dellswide: 12.317, dirt: 15.138 }

export type RunResult = {
  laps: number[]
  meanLap: number
  ticks: number
  done: boolean
  nan: number
  /** Car corners found beyond the outer wall or the inner apron edge after a step, in metres (worst). */
  tunnel: number
  /** Cars stopped for more than 5 s under green. */
  stuck: string[]
  /** Physics time per tick (all cars), ms. */
  msPerTick: number
}

/** An all-AI race like the Phase 0 recorder's: the host car driven by the AI at the level's mid settings. */
export function runRace(track: TrackId, diff: Difficulty, laps: number, model: VehicleModel, seed = 20261105, maxSeconds = 0): RunResult {
  let clock = 1000
  const rand = rng(seed)
  const w = createWorld(TRACKS[track], rand, () => clock, model)
  const base = BASELINES[track]
  const grid = buildGrid(rand, [{ id: 'host', number: '7' }], FIELD, { ai: 19, diff }, base, w.cfg.maxCars)
  beginRace(w, grid, { attack: false, laps, mode: 'race', myId: 'host', host: true, make: simCarFactory(() => false) })
  const A = AI_LEVELS[diff], host = w.cars.get('host')!
  Object.assign(host, { isPlayer: false, ai: true, skill: A.sk[0] + A.sk[1] / 2, aiDecel: A.dc, passD: A.pass, gripB: A.gb, powB: A.pb, gripB0: A.gb, powB0: A.pb, laneCD: A.lc, aggr: A.ag, lapTgt: base * A.pace })
  const cross = new Map<string, number>(), lapList: number[] = [], stopped = new Map<string, number>(), stuck = new Set<string>()
  w.cars.forEach((c) => cross.set(c.id, c.cross))
  const T = w.track, max = maxSeconds ? maxSeconds * 120 : 120 * 60 * Math.max(4, laps * 2)
  let n = 0, nan = 0, tunnel = 0, spent = 0
  while (w.race.ph !== 'done' && n < max) {
    clock += 1 / 120
    const t0 = performance.now()
    tick(w, () => null, true)
    spent += performance.now() - t0
    w.events.length = 0
    n++
    w.cars.forEach((c) => {
      if (![c.x, c.z, c.vx, c.vz, c.h].every(Number.isFinite)) nan++
      if (c.cross !== cross.get(c.id)) {
        if (c.cross > 2 && c.lastLap != null) lapList.push(c.lastLap)
        cross.set(c.id, c.cross)
      }
      const outer = c.tp.lat - (T.HW + 0.1), inner = -T.HW - T.AP + 0.1 - c.tp.lat
      tunnel = Math.max(tunnel, outer - 3.2, inner - 3.2)
      if (w.race.ph === 'green' && !c.fin) {
        const st = Math.hypot(c.vx, c.vz) < 1 ? (stopped.get(c.id) ?? 0) + 1 / 120 : 0
        stopped.set(c.id, st)
        if (st > 5) stuck.add(c.id)
      }
    })
  }
  const mean = lapList.reduce((a, b) => a + b, 0) / Math.max(1, lapList.length)
  return { laps: lapList, meanLap: mean, ticks: n, done: w.race.ph === 'done', nan, tunnel: Math.max(0, tunnel), stuck: [...stuck], msPerTick: spent / Math.max(1, n) }
}
