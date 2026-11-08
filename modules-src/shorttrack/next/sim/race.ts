import { AI_LEVELS, STEP, makeConfig } from './config'
import type { Difficulty, TrackDef } from './config'
import { createCar, speedOf } from './car'
import type { Controls, SimCar } from './car'
import { clamp, mod, rng } from './math'
import { aiCtl } from './ai'
import { collidePair, place, stepCar } from './physics'
import { Track } from './track'
import { newRaceState } from './world'
import type { Phase, VehicleModel, World } from './world'

export function createWorld(def: TrackDef, rand: () => number, now: () => number, model: VehicleModel = 'classic'): World {
  const cfg = makeConfig(def)
  return { model, def, cfg, track: new Track(def, cfg), cars: new Map(), race: newRaceState(), rand, now, events: [] }
}

/** Rolling-start grid geometry: rows two wide, a car length apart, starting half a lap back. */
export function gridGeometry(w: World): { GRID_S: number; GRID_ROW: number; PACE_LEAD: number } {
  const GRID_ROW = 2 * 4.7 * w.cfg.carScale
  return { GRID_S: w.track.S_LINE - w.track.P / 2, GRID_ROW, PACE_LEAD: GRID_ROW * 1.6 }
}

const formCache = new WeakMap<World, number>()

/**
 * The formation moves as one rigid block, so its speed is the slowest one both files can hold through the turns
 * (measured on the centerline); the outside file runs proportionally faster there to stay door to door.
 */
export function formV(w: World): number {
  let v = formCache.get(w)
  if (v === undefined) {
    const T = w.track, R = T.R
    v = w.cfg.aiPaceSpeed
    for (const lat of [-3.6, 0.6]) for (let i = 0; i <= 8; i++) {
      const s = T.T1 + (T.TURN * i) / 8
      v = Math.min(v, ((0.9 * Math.sqrt(T.aMaxAt(s, lat, w.cfg.aiGrip) * (R + lat))) * R) / (R + lat))
    }
    formCache.set(w, v)
  }
  return v
}

/** + = behind the slot. */
function slotErr(w: World, c: SimCar): number {
  const { GRID_ROW, PACE_LEAD } = gridGeometry(w), P = w.track.P
  const off = c.isPace ? PACE_LEAD : -(c.gridRow || 0) * GRID_ROW
  let e = mod(w.track.S_LINE + (w.race.formP ?? 0) + off - c.tp.s, P)
  if (e > P / 2) e -= P
  return e
}

export function formSpeed(w: World, c: SimCar): number {
  const T = w.track, R = T.R, s = c.tp.s, lat = c.tp.lat, inTurn = (s >= T.T1 && s < T.T1 + T.TURN) || s >= T.T2, k = inTurn ? (R + lat) / R : 1
  let v = (formV(w) + clamp(slotErr(w, c) * 0.5, -5, 5)) * k
  if (inTurn) v = Math.min(v, 0.95 * Math.sqrt(T.aMaxAt(s, lat, w.cfg.aiGrip) * (R + lat)))
  return v
}

export function rollAt(w: World, c: SimCar, v: number): void {
  const T = w.track, R = T.R, s = c.tp.s, lat = c.tp.lat, inTurn = (s >= T.T1 && s < T.T1 + T.TURN) || s >= T.T2
  const vMax = inTurn ? Math.sqrt(T.aMaxAt(s, lat, w.cfg.aiGrip) * (R + lat)) * 0.9 : v, sp = Math.min(v, vMax)
  c.vx = Math.sin(c.h) * sp
  c.vz = Math.cos(c.h) * sp
  c.vf = sp
}

export function capFor(w: World, c: SimCar): number | null {
  const race = w.race, CFG = w.cfg
  if (c.isPace) return null
  if (race.ph === 'pace') {
    if (race.formP == null) return c.ai ? CFG.aiPaceSpeed : CFG.paceSpeed
    return c.ai ? null : formSpeed(w, c) + 0.6
  }
  if (race.ph === 'caution') return CFG.cautionSpeed
  if (c.fin) return 24
  return null
}

const progOf = (w: World, c: SimCar): number => (c.cross - 2) * w.track.P + c.sp

export function standings(w: World): SimCar[] {
  const arr: SimCar[] = []
  w.cars.forEach((c) => {
    if (!c.isPace && (c.vis || c.fin)) arr.push(c)
  })
  const fo = w.race.fo
  arr.sort((a, b) => {
    const fa = fo.indexOf(a.id), fb = fo.indexOf(b.id)
    if (fa >= 0 || fb >= 0) {
      if (fa < 0) return 1
      if (fb < 0) return -1
      return fa - fb
    }
    return progOf(w, b) - progOf(w, a)
  })
  return arr
}

export function setPhase(w: World, ph: Phase): void {
  const race = w.race, wasPace = race.ph === 'pace'
  race.ph = ph
  const n = w.now()
  if (ph === 'green') {
    race.greenT = n
    race.gn = false
    if (wasPace) w.cars.forEach((c) => {
      if (c.ai && c.local && !c.isPace && c.gridRow != null) {
        c.passOff = 0
        c.relLane = null
        c.startFile = c.fileLane > -1 ? 1 : 0
        c.startHoldT = 4.5 + c.gridRow * 0.3
        c.laneT = c.startHoldT + w.rand() * 1.5
      }
    })
    race.formP = null
  }
  if (ph === 'caution') race.cT = n
  if (ph === 'checkered') race.ckT = n
}

/** Cautions are switched off in the classic module (`startCaution` returns at once); kept that way. */
function startCaution(): void {}

export function raceControl(w: World, dt: number): void {
  const race = w.race, T = w.track, n = w.now(), st = standings(w), lead = st[0]
  if (!lead) return
  const pace = w.cars.get('pace')
  for (const c of st) if (c.fin && !race.fo.includes(c.id)) race.fo.push(c.id)
  if (pace && pace.vis) {
    if ((race.ph === 'pace' && lead.cross >= 1 && lead.sp > mod(T.T2 - T.S_LINE, T.P) + T.TURN * 0.35) || (race.ph === 'caution' && race.gn && lead.sp > T.P * 0.5)) pace.pitting = true
    if (race.ph === 'green' && n - race.greenT > 5) {
      pace.vis = false
      pace.pitting = false
    }
  }
  switch (race.ph) {
    case 'pace':
      if (lead.cross >= 2) setPhase(w, 'green')
      break
    case 'green':
      if (race.fo.length) {
        setPhase(w, 'checkered')
        break
      }
      for (const c of st) {
        if (c.fin) continue
        if (speedOf(c) < 3) c.stopT += dt
        else {
          c.stopT = 0
          c.cautioned = false
        }
        if (c.stopT > 2.5 && !c.cautioned && n - race.greenT > 8) {
          c.cautioned = true
          startCaution()
          break
        }
      }
      break
    case 'caution':
      if (race.fo.length) {
        setPhase(w, 'checkered')
        break
      }
      if (!race.gn && n - race.cT > w.cfg.cautionTime) {
        race.gn = true
        race.gnCross = lead.cross
      }
      if (race.gn && lead.cross > race.gnCross) setPhase(w, 'green')
      break
    case 'checkered':
      if (st.every((c) => c.fin) || n - race.ckT > 40) setPhase(w, 'done')
      break
  }
}

/** Pack boost: +packBoost top speed per position behind the leader, tapering over 2 s after a pass. */
export function updateBoosts(w: World, dt: number): void {
  const race = w.race, on = race.ph === 'green' || race.ph === 'checkered'
  standings(w).forEach((c, i) => {
    if (!c.local) return
    const tgt = on && !c.fin ? 1 + w.cfg.packBoost * i : 1
    if (tgt >= c.boost) {
      c.boost = tgt
      c.boostRate = 0
    } else {
      if (tgt !== c.boostTgt) c.boostRate = (c.boost - tgt) / 2
      c.boost = Math.max(tgt, c.boost - c.boostRate * dt)
    }
    c.boostTgt = tgt
  })
}

/** One physics step for every visible car, then the pairwise contacts. `input` drives the human-controlled car. */
export function simulate(w: World, dt: number, input: (c: SimCar) => Controls | null): void {
  const race = w.race
  if (race.ph === 'pace' && race.formP != null) race.formP += formV(w) * dt
  const arr: SimCar[] = []
  w.cars.forEach((c) => {
    if (c.vis) arr.push(c)
  })
  const formation = race.ph === 'pace' && race.formP != null
  for (const c of arr) {
    if (!c.local) continue
    c.auto = c.isPlayer && formation
    const human = c.isPlayer && !c.auto ? input(c) : null
    const ctl = human ?? aiCtl(w, c, dt)
    stepCar(w, c, dt, ctl, capFor(w, c))
  }
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) collidePair(w, arr[i], arr[j])
}

/**
 * The reference tick: one physics step, the forward-speed refresh the classic render pass did every frame,
 * race control and the pack boost. Equal to the classic loop running at exactly 120 fps.
 */
export function tick(w: World, input: (c: SimCar) => Controls | null, raceHost: boolean): void {
  simulate(w, STEP, input)
  w.cars.forEach((c) => {
    c.vf = c.vx * Math.sin(c.h) + c.vz * Math.cos(c.h)
  })
  if (raceHost) raceControl(w, STEP)
  updateBoosts(w, STEP)
}

export type GridEntry = { id: string; number: string; ai: boolean; sk?: number; dc?: number; pa?: number; gb?: number; pb?: number; lc?: number; ag?: number; tl?: number }

/**
 * The host's grid, drawn exactly as the classic `hostStart` drew it: the fixed AI field shuffled, numbers a human
 * runs sitting out, per-car skill from a seeded stream, and the whole grid shuffled.
 */
export function buildGrid(rand: () => number, humans: { id: string; number: string }[], field: string[], settings: { ai: number; diff: Difficulty }, baseline: number | null, maxCars: number): GridEntry[] {
  const ents: GridEntry[] = humans.map((p) => ({ id: p.id, number: p.number, ai: false }))
  const r = rng((rand() * 1e9) | 0), used = new Set(ents.map((e) => e.number)), humanNums = new Set(used), nAI = Math.min(settings.ai, maxCars - ents.length)
  const ro = field.slice()
  for (let i = ro.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[ro[i], ro[j]] = [ro[j], ro[i]]
  }
  const roster = ro.slice(0, maxCars).filter((n) => !humanNums.has(n))
  for (let i = 0; i < Math.min(nAI, roster.length); i++) {
    const number = roster[i]
    used.add(number)
    const A = AI_LEVELS[settings.diff || 'medium']
    ents.push({ id: 'ai' + i, number, ai: true, sk: +(A.sk[0] + r() * A.sk[1]).toFixed(3), dc: A.dc, pa: A.pass, gb: A.gb, pb: A.pb, lc: A.lc, ag: A.ag, tl: baseline ? +(baseline * A.pace * (1 + (r() * 2 - 1) * A.vary)).toFixed(3) : 0 })
  }
  for (let i = ents.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[ents[i], ents[j]] = [ents[j], ents[i]]
  }
  return ents
}

/** Puts the grid on track: a two-wide rolling start, or a single car for Time Attack. */
export type CarFlags = { local: boolean; ai: boolean; player: boolean }

/**
 * Puts the grid on track: a two-wide rolling start, or a single car for Time Attack. `make` builds each car
 * (the renderer passes one that also builds the model); it must return an object with every SimCar field.
 */
export function beginRace<C extends SimCar>(w: World, grid: GridEntry[], o: { attack: boolean; laps: number; mode: 'time-attack' | 'race' | 'multiplayer'; myId: string; host: boolean; make: (e: GridEntry, flags: CarFlags) => C }): C[] {
  w.cars.clear()
  w.events.length = 0
  const { GRID_S, GRID_ROW } = gridGeometry(w), T = w.track, made: C[] = []
  Object.assign(w.race, { ph: o.attack ? 'attack' : 'pace', mode: o.mode, laps: o.attack ? 9999 : o.laps, fo: [], gn: false, gnCross: 0, cT: 0, greenT: 0, ckT: 0, white: false, formP: -T.P / 2 })
  grid.forEach((e, i) => {
    const isMe = e.id === o.myId, local = isMe || (o.host && e.ai)
    const c = o.make(e, { local, ai: e.ai, player: isMe })
    made.push(c)
    c.skill = e.sk || 0.97
    c.aiDecel = e.dc || 0
    c.passD = e.pa || 20
    c.gripB = e.gb || 1
    c.powB = e.pb || 1
    c.laneCD = e.lc || 3
    c.aggr = e.ag ?? 0.5
    c.gripB0 = c.gripB
    c.powB0 = c.powB
    c.lapTgt = +(e.tl ?? 0) || 0
    c.paceK = 1
    c.paceCk = null
    c.sideId = null
    c.sideMode = null
    c.sideT = 0
    const row = Math.floor(i / 2)
    c.gridRow = row
    c.fileLane = i % 2 ? 0.6 : -3.6
    c.lane = -3.6
    c.lapDirty = true
    if (o.attack) {
      place(w, c, T.S_LINE - 70, -2)
      c.cross = 1
    } else {
      place(w, c, GRID_S - row * GRID_ROW, c.fileLane)
      c.cross = 1
      rollAt(w, c, formV(w))
    }
    w.cars.set(e.id, c)
  })
  return made
}

/** The default car factory for headless runs: just the simulation state. */
export const simCarFactory = (stockCar: (e: GridEntry) => boolean) => (e: GridEntry, f: CarFlags): SimCar => createCar(e.id, { ...f, stockCar: stockCar(e) })
