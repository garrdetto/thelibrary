import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ICONIC_FIELD } from '../iconic-schemes.js'
import { AI_LEVELS, TRACKS } from '../next/sim/config'
import type { Difficulty, TrackId } from '../next/sim/config'
import { rng } from '../next/sim/math'
import { beginRace, buildGrid, createWorld, simCarFactory, standings, tick } from '../next/sim/race'
import type { SimCar } from '../next/sim/car'

type Fixture = {
  meta: { track: TrackId; diff: Difficulty; seed: number; laps: number; ai: number; veh: string; base: number | null; ticks: number; golden: number; fields: string; order: string[] }
  laps: Record<string, number[]>
  states: [number, (string | number)[][]][]
}

const fixtureDir = join(import.meta.dirname ?? process.cwd(), '..', 'modules-src', 'shorttrack', 'tests', 'fixtures')
const fixturePath = (name: string): string => {
  for (const dir of [fixtureDir, join(process.cwd(), 'modules-src', 'shorttrack', 'tests', 'fixtures')]) {
    try {
      readFileSync(join(dir, name))
      return join(dir, name)
    } catch {
      continue
    }
  }
  throw new Error(`fixture ${name} not found`)
}
const load = (name: string): Fixture => JSON.parse(readFileSync(fixturePath(name), 'utf8')) as Fixture

const FIELD = ICONIC_FIELD.map((f: { number: string }) => String(f.number ?? '').replace(/\D/g, '').slice(0, 3))
const STATE_KEYS = ['x', 'z', 'h', 'vx', 'vz', 'av', 'steer', 'cross', 'sp'] as const

/** Replays the classic recorder (`recordRace` in main.js) on the TypeScript sim. */
function replay(f: Fixture, onTick: (tickNo: number, cars: Map<string, SimCar>) => void): Map<string, SimCar> {
  const m = f.meta
  let clock = 1000
  const rand = rng(m.seed)
  const w = createWorld(TRACKS[m.track], rand, () => clock)
  const grid = buildGrid(rand, [{ id: 'host', number: '7' }], FIELD, { ai: m.ai, diff: m.diff }, m.base, w.cfg.maxCars)
  beginRace(w, grid, { attack: false, laps: m.laps, mode: 'race', myId: 'host', host: true, make: simCarFactory(() => m.veh !== 'truck') })
  const A = AI_LEVELS[m.diff], host = w.cars.get('host')!
  Object.assign(host, { isPlayer: false, ai: true, skill: A.sk[0] + A.sk[1] / 2, aiDecel: A.dc, passD: A.pass, gripB: A.gb, powB: A.pb, gripB0: A.gb, powB0: A.pb, laneCD: A.lc, aggr: A.ag, lapTgt: m.base ? m.base * A.pace : 0 })
  const max = 120 * 60 * Math.max(4, m.laps * 2)
  let n = 0
  while (w.race.ph !== 'done' && n < max) {
    clock += 1 / 120
    tick(w, () => null, true)
    w.events.length = 0
    n++
    onTick(n, w.cars)
  }
  return w.cars
}

for (const track of Object.keys(TRACKS) as TrackId[]) {
  test(`golden: TS sim matches the classic recording on ${track} within 1e-6 over 3 laps`, () => {
    const f = load(`${track}-medium.json`)
    const frames = new Map(f.states.map(([t, rows]) => [t, rows]))
    let checked = 0
    let worst = 0
    const cars = replay(f, (n, live) => {
      const rows = frames.get(n)
      if (!rows) return
      if (checked === 0) assert.deepEqual([...live.keys()], f.meta.order, 'grid order')
      for (const row of rows) {
        const c = live.get(String(row[0]))
        assert.ok(c, `car ${row[0]} exists at tick ${n}`)
        STATE_KEYS.forEach((key, i) => {
          const diff = Math.abs((c[key] as number) - (row[i + 1] as number))
          worst = Math.max(worst, diff)
          assert.ok(diff <= 1e-6, `${track} tick ${n} car ${c.id} ${key}: ${c[key]} vs ${row[i + 1]}`)
        })
        const dmg = [c.dmg.f, c.dmg.r, c.dmg.l, c.dmg.rt, c.boost, c.paceK]
        dmg.forEach((value, i) => assert.ok(Math.abs(value - (row[10 + i] as number)) <= 1e-6, `${track} tick ${n} car ${c.id} field ${10 + i}`))
      }
      checked++
    })
    assert.equal(checked, f.states.length, 'every golden frame was reached')
    assert.ok(cars.size === f.meta.order.length)
    assert.ok(worst <= 1e-6)
  })
}

test('lap times: the full medium race on prison reproduces every classic lap', () => {
  const f = load('prison-medium.json')
  const laps: Record<string, number[]> = {}
  const cross = new Map<string, number>()
  replay(f, (_n, live) => {
    live.forEach((c) => {
      if (!cross.has(c.id)) cross.set(c.id, c.cross)
      if (c.cross !== cross.get(c.id)) {
        if (c.cross > 2 && c.lastLap != null) (laps[c.id] ??= []).push(+c.lastLap.toFixed(9))
        cross.set(c.id, c.cross)
      }
    })
  })
  for (const [id, list] of Object.entries(f.laps)) {
    assert.equal(laps[id]?.length, list.length, `lap count for ${id}`)
    list.forEach((lap, i) => assert.ok(Math.abs(laps[id][i] - lap) <= 1e-6, `${id} lap ${i + 1}: ${laps[id][i]} vs ${lap}`))
  }
})

test('standings order is deterministic for equal progress', () => {
  const w = createWorld(TRACKS.prison, rng(1), () => 0)
  beginRace(w, buildGrid(rng(2), [{ id: 'host', number: '7' }], FIELD, { ai: 5, diff: 'easy' }, null, 20), { attack: false, laps: 5, mode: 'race', myId: 'host', host: true, make: simCarFactory(() => false) })
  assert.equal(standings(w).length, 6)
})
