import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JOBS, RESPOND_BONUS, SHIFT_SECONDS } from '../shared/Jobs'
import { newLotState, sanitizeLotState, shellOf } from '../shared/Lot'
import { defaultLook } from '../shared/Look'
import type { ServerMessage } from '../shared/Protocol'
import { Room } from '../shared/Room'
import { callsAt, serviceEta, serviceJobs, townAt, type TownRequest } from '../shared/TownSim'

const T0 = Date.UTC(2026, 10, 8, 18, 0, 0)

function household(clock: { now: number }) {
  const state = newLotState(0, 3, 'owner-1', 'maple', 'The Maples', [{ name: 'Ada', look: defaultLook() }, { name: 'Ben', look: defaultLook() }])
  const inbox: ServerMessage[] = []
  const requested: TownRequest[] = []
  const room = new Room(state, { now: () => clock.now, requested: r => requested.push(r) }, 'member:owner-1', 9)
  const joined = room.join({ key: 'member:owner-1', name: 'maple', send: m => inbox.push(m), close: () => undefined })
  assert.ok('id' in joined)
  const run = (seconds: number) => { for (let i = 0; i < seconds * 10; i++) { clock.now += 100; room.tick(0.1) } }
  return { state, room, id: joined.id, inbox, requested, run }
}

test('the town is the same for everyone and stays on the map', () => {
  const requests: TownRequest[] = [{ lot: 2, kind: 'food', at: T0 + 30_000 }, { lot: 9, kind: 'mow', at: T0 + 50_000 }]
  for (let i = 0; i < 1200; i++) {
    const now = T0 + i * 3000
    const a = townAt(4, now, requests)
    const b = townAt(4, now, requests.map(r => ({ ...r })))
    assert.deepEqual(a.vehicles, b.vehicles)
    const ids = new Set(a.vehicles.map(v => v.id))
    assert.equal(ids.size, a.vehicles.length)
    for (const v of a.vehicles) {
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.yaw))
      assert.ok(Math.abs(v.x) <= 245 && Math.abs(v.z) <= 70, `${v.id} at ${v.x},${v.z}`)
    }
    for (const w of a.workers) assert.ok(Number.isFinite(w.x) && Number.isFinite(w.z))
    for (const lawn of a.lawns) assert.ok(lawn >= 0 && lawn <= 1)
  }
})

test('every job has calls to answer over an afternoon', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 4000; i++) for (const call of callsAt(1, T0 + i * 4000)) for (const job of call.jobs) seen.add(job)
  for (const job of Object.keys(JOBS)) if (job !== 'lawn' || seen.has('lawn')) assert.ok(seen.has(job), `no calls for ${job}`)
})

test('a responder takes service calls one after another', () => {
  const first: TownRequest = { lot: 1, kind: 'food', at: T0 }
  const second: TownRequest = { lot: 8, kind: 'food', at: T0 + 1000 }
  const jobs = serviceJobs(0, [second, first])
  assert.equal(jobs[0].request, first)
  assert.ok(jobs[1].arrive > jobs[0].leave)
  assert.ok(serviceEta(0, [first], second) > jobs[0].leave)
})

test('a shift pays, wears the Sim out a little and counts toward promotion', () => {
  const clock = { now: T0 }
  const { state, room, id, run } = household(clock)
  room.command(id, { t: 'job', sim: 's1', job: 'police' })
  assert.equal(state.household.sims[0].career?.job, 'police')
  const funds = state.household.funds
  const energy = state.household.sims[0].needs.energy
  room.command(id, { t: 'work', sim: 'h-s1' })
  assert.ok(state.household.sims[0].work)
  assert.equal(room.sims.has('h-s1'), false)
  assert.equal(shellOf(state).workers.length, 1)
  room.command(id, { t: 'task', sim: 's1', task: 'patrol' })
  run(31)
  assert.ok(state.household.sims[0].work!.perf > 40)
  room.command(id, { t: 'task', sim: 's1', task: 'patrol' })
  run(SHIFT_SECONDS)
  const ada = state.household.sims[0]
  assert.equal(ada.work, null)
  assert.equal(ada.career?.shifts, 1)
  assert.ok(state.household.funds > funds + 200)
  assert.ok(ada.needs.energy < energy)
  assert.ok(room.sims.has('h-s1'), 'Ada walked back home')
  const saved = sanitizeLotState(JSON.parse(JSON.stringify(state)), 0, 3)!
  assert.equal(saved.household.sims[0].career?.job, 'police')
})

test('answering a live call earns a bonus', () => {
  let at = T0
  let call = null
  for (let i = 0; i < 2000 && !call; i++) {
    at = T0 + i * 2000
    call = callsAt(0, at).find(c => c.jobs.includes('firefighter') && c.end - at / 1000 > 30) ?? null
  }
  assert.ok(call, 'a firefighter call happens')
  const clock = { now: at - 1000 }
  const { state, room, id, run } = household(clock)
  room.command(id, { t: 'job', sim: 's2', job: 'firefighter' })
  room.command(id, { t: 'work', sim: 's2' })
  run(1)
  room.command(id, { t: 'task', sim: 's2', task: `call:${call.id}` })
  const work = state.household.sims[1].work!
  assert.equal(work.task?.call, call.id)
  assert.equal(shellOf(state).workers[0].call, call.id)
  run(25)
  assert.equal(work.earned, RESPOND_BONUS)
  room.command(id, { t: 'task', sim: 's2', task: `call:${call.id}` })
  assert.equal(work.task, null)
})

test('calling services: burgers feed the house, a resort day sends a Sim away and back', () => {
  const clock = { now: T0 }
  const { state, room, id, run, requested } = household(clock)
  for (const sim of state.household.sims) sim.needs.hunger = 20
  const funds = state.household.funds
  room.command(id, { t: 'order', kind: 'food' })
  assert.equal(requested.length, 1)
  assert.equal(state.household.funds, funds - 45)
  room.command(id, { t: 'order', kind: 'food' })
  assert.equal(requested.length, 1, 'one order at a time')
  run(150)
  assert.ok(state.household.sims.every(s => s.needs.hunger > 60))
  room.command(id, { t: 'order', kind: 'police' })
  run(120)
  room.command(id, { t: 'order', kind: 'police' })
  assert.equal(requested.filter(r => r.kind === 'police').length, 1, 'free services have a cooldown')
  room.command(id, { t: 'order', kind: 'resort', sim: 'h-s2' })
  run(120)
  assert.ok(state.household.sims[1].trip)
  assert.equal(room.sims.has('h-s2'), false)
  run(260)
  assert.equal(state.household.sims[1].trip, null)
  assert.ok(room.sims.has('h-s2'))
})
