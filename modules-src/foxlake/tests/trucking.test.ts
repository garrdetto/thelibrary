import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Terrain } from '../../rackreel/world/Terrain'
import { TUNING, rideHeight } from '../../maplestreet/shared/Vehicles'
import { COUPLING_HEIGHT, FLEET_KINDS, SEMI_TRAILERS } from '../../maplestreet/shared/FleetVehicles'
import { BOARD_MINUTES, BOARD_SIZE, FREIGHT_SITES, LANDING, LOAD_TYPES, MILL, YARD, boardAt, findLoad, payFor, siteOf } from '../../maplestreet/shared/Freight'
import { NeighborhoodLogic } from '../../maplestreet/shared/RoomLogic'
import type { ServerMsg } from '../../maplestreet/shared/Protocol'
import { FREIGHT_GROUNDS, FREIGHT_ROADS } from '../country/Roads'
import { FOX_LAKE_SHAPE, TOWN_Y, connectorDistance, roadClear, sceneToTown, townToScene } from '../region'

const foxLake = new Terrain(FOX_LAKE_SHAPE)

test('every fleet rig is registered, and the tractor and trailers meet at the fifth wheel height', () => {
  for (const k of FLEET_KINDS) assert.ok(TUNING[k], k)
  const semi = TUNING.semi
  assert.ok(Math.abs(rideHeight(semi) + semi.hitch!.y - COUPLING_HEIGHT) < 1e-6, 'fifth wheel top')
  for (const k of SEMI_TRAILERS) {
    const t = TUNING[k]
    assert.ok(Math.abs(rideHeight(t) + t.tongue!.y - COUPLING_HEIGHT) < 1e-6, `${k} kingpin`)
    const legs = t.axles.find((a) => a.leg)!
    const tire = t.axles.find((a) => !a.leg)!
    assert.ok(legs.x > 0 && tire.x < 0, `${k}: legs up front, tandem at the back`)
    assert.ok(tire.radius - legs.radius > 0.3, `${k}: the legs clear the road while coupled`)
  }
  const dump = TUNING.dumptruck
  assert.ok(dump.dump && dump.dump.maxAngle > 0.6 && dump.dump.maxAngle < 1.1, 'the body tips 35 to 60 degrees')
})

test('the board is the same for everyone in a slot, offers every rig, and pays more for longer runs', () => {
  const now = Date.UTC(2026, 10, 13, 15, 3)
  const a = boardAt(now)
  const b = boardAt(now + 60_000)
  assert.deepEqual(a, b)
  assert.equal(a.length, BOARD_SIZE)
  for (const rig of ['dumptruck', 'dryvan', 'flatbed', 'logger', 'tanker'] as const) assert.ok(a.some((l) => l.rig === rig), rig)
  assert.notDeepEqual(boardAt(now + BOARD_MINUTES * 60_000), a)
  assert.ok(findLoad(a[0].id, now + BOARD_MINUTES * 60_000), 'a load taken as the board turns over still counts')
  assert.equal(findLoad(a[0].id, now + 3 * BOARD_MINUTES * 60_000), null)
  assert.ok(payFor('dryvan', 2000) > payFor('dryvan', 500))
  for (const t of LOAD_TYPES) for (const id of [...t.from, ...t.to]) assert.ok(siteOf(id), id)
})

test('every freight stop is on a road, a lot or a freight ground, reachable from the road network', () => {
  for (const s of FREIGHT_SITES) {
    const p = townToScene(s.x, 0, s.z)
    const country = p.z < 512
    if (country) assert.ok(roadClear(p.x, p.z) < 2, `${s.name} is on the Lake Road, Pine Ridge Rd or the landing`)
    assert.ok(foxLake.heightAt(p.x, p.z) > 0.6, `${s.name} is dry`)
  }
  const yardGate = townToScene(YARD.gate.x, 0, YARD.gate.z)
  const road = FREIGHT_ROADS[0].pts
  assert.ok(Math.hypot(road[0].x - yardGate.x, road[0].z - yardGate.z) < 6, 'Freight Rd starts at the yard gate')
  assert.ok(connectorDistance(road[road.length - 1].x, road[road.length - 1].z) < 1, 'and ends on the county road')
  const mill = townToScene(MILL.x0, 0, 0)
  const main = FREIGHT_ROADS[1].pts
  assert.ok(main[main.length - 1].x > mill.x, 'Main St runs into the sawmill')
  const landing = townToScene(LANDING.x, 0, LANDING.z)
  const pine = FREIGHT_ROADS[2].pts
  assert.ok(Math.hypot(pine[pine.length - 1].x - landing.x, pine[pine.length - 1].z - landing.z) < LANDING.r, 'Pine Ridge Rd reaches the landing')
  assert.ok(roadClear(pine[0].x, pine[0].z) < 0, 'and leaves from the Lake Road')
  const g = FREIGHT_GROUNDS.yard
  assert.equal(foxLake.heightAt((g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2), TOWN_Y, 'the yard is level')
  const t = sceneToTown((g.x0 + g.x1) / 2, 0, (g.z0 + g.z1) / 2)
  assert.ok(t.x > YARD.x0 && t.x < YARD.x1 && t.z > YARD.z0 && t.z < YARD.z1, 'the yard ground matches the yard')
})

test('the authority runs a load end to end: take, load in the right rig at the pickup, deliver and pay', () => {
  const sent: ServerMsg[] = []
  const logic = new NeighborhoodLogic({ send: (_id, msg) => { sent.push(msg) }, broadcast: () => {} }, null)
  logic.join('s1', { key: 'k1', name: 'Trucker', color: '#3a7bd5' })
  const last = () => [...sent].reverse().find((m) => m.t === 'freight') as Extract<ServerMsg, { t: 'freight' }>
  const load = boardAt(Date.now()).find((l) => l.rig === 'dryvan')!
  logic.message('s1', { t: 'freight', a: 'take', load: load.id })
  assert.equal(last().job?.id, load.id)
  const from = siteOf(load.from)!, to = siteOf(load.to)!
  const snap = (x: number, z: number, hitched: boolean) => logic.message('s1', {
    t: 'state',
    p: { id: 's1', name: 'Trucker', color: '#3a7bd5', x, y: 0, z, yaw: 0, speed: 0, vehicleId: 's1:semi' },
    v: [
      { id: 's1:semi', owner: 's1', kind: 'semi', x, y: 1.8, z, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, speed: 0, hitchedTo: null },
      { id: 's1:dryvan', owner: 's1', kind: 'dryvan', x: x - 9, y: 2.6, z, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, speed: 0, hitchedTo: hitched ? 's1:semi' : null },
    ],
  })
  snap(from.x + 300, from.z, true)
  logic.message('s1', { t: 'freight', a: 'load' })
  assert.equal(last().job?.stage, 'toPickup', 'too far from the dock')
  snap(from.x, from.z, false)
  logic.message('s1', { t: 'freight', a: 'load' })
  assert.equal(last().job?.stage, 'toPickup', 'no trailer coupled')
  snap(from.x, from.z, true)
  logic.message('s1', { t: 'freight', a: 'load' })
  assert.equal(last().job?.stage, 'toDrop')
  const before = (logic as unknown as { accounts: Record<string, { money: number }> }).accounts
  const money = Object.values(before)[0].money
  snap(to.x, to.z, true)
  logic.message('s1', { t: 'freight', a: 'deliver' })
  assert.equal(last().job, null)
  assert.equal(last().paid, load.pay)
  assert.equal(Object.values(before)[0].money, money + load.pay)
})
