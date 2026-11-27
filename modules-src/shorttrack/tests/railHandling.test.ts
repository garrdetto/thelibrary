import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Lab } from '../../railsetup/sim/lab'
import { handlingDelta, railHandling, railVehicle } from '../../railsetup/sim/vehicle'
import type { RailVehicle } from '../next/sim/railCar'
import { handlingTrim } from '../next/sim/railDynamics'
import type { RailNote } from '../next/sim/railDriver'
import { runRail } from './railRun'

const BASE = railVehicle(new Lab(), 'base')
const withHandling = (h: number): RailVehicle => ({ ...BASE, handling: { entry: h, center: h, exit: h } })

test('setup changes read as tighter or looser per corner phase against the baseline', () => {
  const base = railHandling(new Lab())
  const soft = new Lab()
  soft.inputs.bar = 1.25
  soft.update()
  const d = handlingDelta(railHandling(soft), base)
  assert.ok(d.center < -1, `a softer front bar frees the car up mid-turn (${d.center})`)
  const same = handlingDelta(base, base)
  assert.deepEqual(same, { entry: 0, center: 0, exit: 0 })
  const brake = new Lab()
  brake.inputs.bb = 70
  brake.update()
  assert.ok(handlingDelta(railHandling(brake), base).entry > 3, 'more front brake makes the entry tighter')
})

test('tight takes grip off the fronts, loose off the rears, only while cornering and by phase', () => {
  const tight = { entry: 0, center: 8, exit: 0 }
  assert.deepEqual(handlingTrim(tight, 0, 0, 0), handlingTrim(undefined, 0, 0, 0), 'no trim on the straight')
  const mid = handlingTrim(tight, 0.15, 0, 9)
  assert.ok(mid.f < 0.9 && mid.r === 1, 'center tight: fronts lose grip')
  assert.equal(handlingTrim(tight, 0, 0.8, 9).f, 1, 'entry phase is even')
  const loose = handlingTrim({ entry: 0, center: 0, exit: -6 }, 1, 0, 9)
  assert.ok(loose.r < 0.9 && loose.f === 1, 'exit loose: rears lose grip')
})

test('the test driver drives around a tight or loose car the way a racer does', () => {
  const notes = (veh: RailVehicle) => {
    const seen = new Map<RailNote, number>()
    let maxLat = -Infinity, minThrExit = 1
    const r = runRail(veh, undefined, 3, undefined, (w, c, d) => {
      if (d.note) seen.set(d.note, (seen.get(d.note) ?? 0) + 1)
      maxLat = Math.max(maxLat, c.tp.lat)
    })
    return { seen, r, maxLat, minThrExit }
  }
  const base = notes(BASE)
  const tight = notes(withHandling(8))
  const loose = notes(withHandling(-8))
  assert.ok(!tight.r.nan && !loose.r.nan)
  assert.ok((tight.seen.get('push') ?? 0) + (tight.seen.get('tight-exit') ?? 0) > (base.seen.get('push') ?? 0) + (base.seen.get('tight-exit') ?? 0), 'tight: pushes and waits on the throttle more than the baseline')
  assert.ok((loose.seen.get('loose') ?? 0) + (loose.seen.get('catch') ?? 0) > (base.seen.get('loose') ?? 0) + (base.seen.get('catch') ?? 0), 'loose: catches the car more than the baseline')
  assert.ok(tight.r.turn.under > base.r.turn.under, `tight shows as understeer mid-turn (${tight.r.turn.under.toFixed(2)} vs ${base.r.turn.under.toFixed(2)})`)
})
