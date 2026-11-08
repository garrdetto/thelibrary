import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LotGrid, newLotState, shellOf, tileIndex } from '../shared/Lot'
import { findPath } from '../shared/Path'
import type { ServerMessage } from '../shared/Protocol'
import { Room, type JoinInfo } from '../shared/Room'
import { lotToWorld, lotPlacement } from '../shared/Street'
import { defaultLook, lookFromKey, sanitizeLook } from '../shared/Look'

function lot() {
  return newLotState(0, 2, 'owner-1', 'maple', 'The Maples', [{ name: 'Ada', look: defaultLook() }, { name: 'Ben', look: defaultLook() }])
}

function client(key: string, name: string) {
  const inbox: ServerMessage[] = []
  const info: JoinInfo = { key, name, send: m => inbox.push(m), close: () => undefined }
  return { info, inbox, last<T extends ServerMessage['t']>(t: T) { return [...inbox].reverse().find(m => m.t === t) as Extract<ServerMessage, { t: T }> | undefined } }
}

function run(room: Room, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) room.tick(0.1)
}

function joined(result: { id: string } | { error: string }): string {
  assert.ok('id' in result, 'error' in result ? result.error : '')
  return result.id
}

test('the starter house is closed in and every item can be reached', () => {
  const state = lot()
  const grid = new LotGrid(state)
  assert.equal(grid.isInside(8, 7), true)
  assert.equal(grid.isInside(8, 5), false)
  assert.equal(grid.isInside(13, 12), true)
  const doors = grid.exteriorDoors()
  assert.equal(doors.length, 1)
  assert.deepEqual(doors[0].outside, [8, 5])
  for (const object of state.objects) assert.ok(grid.accessTiles(object).length > 0, `${object.def} at ${object.x},${object.z}`)
})

test('a visitor cannot walk inside without being let in', () => {
  const grid = new LotGrid(lot())
  assert.equal(findPath(grid, [8, 2], [[8, 8]], { inside: false }), null)
  assert.ok(findPath(grid, [8, 2], [[8, 8]], { inside: true }))
})

test('the street shell never carries the inside of the house', () => {
  const state = lot()
  const shell = shellOf(state)
  assert.ok(!shell.objects.some(o => o.def === 'fridge'))
  assert.ok(shell.objects.some(o => o.def === 'grill'))
  assert.ok(!shell.floors.some(([i]) => i === tileIndex(8, 8)))
})

test('knocking: nobody home, then the owner lets the visitor in, then leaves', () => {
  const room = new Room(lot())
  const visitor = client('member:v1', 'birch')
  const vid = joined(room.join(visitor.info))
  const simId = `v-${vid}`
  assert.equal(visitor.last('welcome')?.lot.objects.some(o => o.def === 'fridge'), false)

  room.command(vid, { t: 'knock', sim: simId })
  run(room, 12)
  assert.match(visitor.last('notice')?.text ?? '', /Nobody is home/)

  const owner = client('member:owner-1', 'maple')
  const oid = joined(room.join(owner.info))
  assert.equal(owner.last('welcome')?.role, 'owner')
  room.broadcastState()
  assert.ok(!visitor.last('state')?.sims.some(s => s.hh && s.name === 'Ada'), 'household inside is hidden from the yard')

  room.command(vid, { t: 'knock', sim: simId })
  run(room, 12)
  const knock = owner.last('knock')
  assert.ok(knock)
  assert.equal(knock.id, vid)
  room.command(oid, { t: 'answer', id: vid, allow: true })
  assert.equal(visitor.last('guest')?.guest, true)
  assert.equal(visitor.last('lot')?.lot.entitled, true)
  run(room, 8)
  const sim = room.sims.get(simId)!
  assert.equal(room.grid.isInside(sim.tile[0], sim.tile[1]), true, 'guest walked in')

  room.leave(oid)
  assert.equal(visitor.last('guest')?.guest, false)
  assert.equal(room.grid.isInside(sim.tile[0], sim.tile[1]), false, 'guest walked back out to the yard')
})

test('guests may not raid the fridge unless the owner allows it', () => {
  const room = new Room(lot())
  const owner = client('member:owner-1', 'maple')
  const oid = joined(room.join(owner.info))
  const visitor = client('member:v1', 'birch')
  const vid = joined(room.join(visitor.info))
  room.command(vid, { t: 'knock', sim: `v-${vid}` })
  run(room, 12)
  room.command(oid, { t: 'answer', id: vid, allow: true })
  const fridge = room.state.objects.find(o => o.def === 'fridge')!
  room.command(vid, { t: 'use', sim: `v-${vid}`, obj: fridge.id, act: 'snack' })
  assert.equal(room.sims.get(`v-${vid}`)!.queue.filter(t => t.kind === 'use').length, 0)
  room.command(oid, { t: 'settings', guestsUseFridgeBeds: true })
  room.command(vid, { t: 'use', sim: `v-${vid}`, obj: fridge.id, act: 'snack' })
  assert.equal(room.sims.get(`v-${vid}`)!.queue.filter(t => t.kind === 'use').length, 1)
})

test('building waits for visitors to clear the area it changes', () => {
  const room = new Room(lot())
  const owner = client('member:owner-1', 'maple')
  const oid = joined(room.join(owner.info))
  const funds = room.state.household.funds
  room.command(oid, { t: 'build', op: { op: 'buy', def: 'armchair', x: 9, z: 12, r: 0 } })
  assert.equal(room.state.household.funds, funds - 380)
  const visitor = client('member:v1', 'birch')
  joined(room.join(visitor.info))
  room.command(oid, { t: 'build', op: { op: 'wall', x0: 0, z0: 20, x1: 4, z1: 20 } })
  assert.match(owner.last('notice')?.text ?? '', /yard is clear/)
  room.command(oid, { t: 'build', op: { op: 'buy', def: 'plant', x: 9, z: 13, r: 0 } })
  assert.ok(room.state.objects.some(o => o.def === 'plant' && o.x === 9 && o.z === 13), 'inside changes go ahead while the visitor is in the yard')
})

test('blocked people and closed yards keep visitors out', () => {
  const room = new Room(lot())
  const owner = client('member:owner-1', 'maple')
  const oid = joined(room.join(owner.info))
  const visitor = client('member:v1', 'birch')
  const vid = joined(room.join(visitor.info))
  room.command(oid, { t: 'sendHome', id: vid, block: true })
  assert.equal(visitor.last('bye')?.t, 'bye')
  assert.ok('error' in room.join(client('member:v1', 'birch').info))
  room.command(oid, { t: 'settings', yardOpen: false })
  assert.ok('error' in room.join(client('member:v2', 'cedar').info))
})

test('a hungry Sim feeds itself', () => {
  const state = lot()
  state.household.sims[0].needs.hunger = 8
  const room = new Room(state)
  joined(room.join(client('member:owner-1', 'maple').info))
  run(room, 180)
  assert.ok(state.household.sims[0].needs.hunger > 40, `hunger ${state.household.sims[0].needs.hunger}`)
})

test('a lent Sim comes home with the time it spent away', () => {
  const state = lot()
  const room = new Room(state)
  const sim = room.depart('s1')!
  assert.equal(sim.name, 'Ada')
  assert.ok(state.household.sims[0].away)
  const clock = state.clock
  assert.ok(room.homecoming('s1', { ...sim.needs, fun: 100 }, 90))
  assert.equal(state.household.sims[0].needs.fun, 100)
  assert.equal(state.clock, clock + 90)
  assert.equal(room.homecoming('s1', sim.needs, 90), false)
})

test('street placement mirrors the south side', () => {
  assert.deepEqual(lotToWorld(0, 0, 0), [lotPlacement(0).x, 7])
  const [x, z] = lotToWorld(6, 0, 0)
  assert.equal(z, -7)
  assert.equal(x, lotPlacement(6).x)
})

test('exterior design: cladding changes cost per face, colors are free, bad values are cleaned', () => {
  const room = new Room(lot())
  const owner = client('member:owner-1', 'maple')
  const oid = joined(room.join(owner.info))
  const funds = room.state.household.funds
  room.command(oid, { t: 'build', op: { op: 'style', patch: { upperColor: 5, trimColor: 15, roofStyle: 'gable' } } })
  assert.equal(room.state.household.funds, funds)
  assert.equal(room.state.style.roofStyle, 'gable')
  room.command(oid, { t: 'build', op: { op: 'style', patch: { upper: 'stone' } } })
  assert.ok(room.state.household.funds < funds)
  room.command(oid, { t: 'build', op: { op: 'style', patch: { roofStyle: 'pagoda' as never, wainscot: 9 } } })
  assert.equal(room.state.style.roofStyle, 'gable')
  assert.ok(room.state.style.wainscot >= 0 && room.state.style.wainscot <= 3)
})

test('features: canopies need an outside opening, porches meet the house, fences block and gates open', () => {
  const room = new Room(lot())
  const owner = client('member:owner-1', 'maple')
  const oid = joined(room.join(owner.info))
  const count = () => room.state.features.length
  const before = count()
  room.command(oid, { t: 'build', op: { op: 'feature', kind: 'canopy', x: 3, z: 3, v: 0, style: 'shed', color: 2, width: 1 } })
  assert.equal(count(), before, 'no wall there')
  room.command(oid, { t: 'build', op: { op: 'feature', kind: 'canopy', x: 6, z: 6, v: 0, style: 'awning', color: 2, width: 1 } })
  assert.equal(count(), before + 1, 'window on the front wall')
  room.command(oid, { t: 'build', op: { op: 'feature', kind: 'porch', x: 1, z: 1, x2: 3, z2: 3, style: 'round', color: 1 } })
  assert.equal(count(), before + 1, 'a porch away from the house is refused')
  room.command(oid, { t: 'build', op: { op: 'feature', kind: 'porch', x: 5, z: 3, x2: 14, z2: 5, style: 'round', color: 1 } })
  assert.equal(count(), before + 2)
  room.command(oid, { t: 'build', op: { op: 'feature', kind: 'chimney', x: 6, z: 12, style: 'standard', color: 22 } })
  assert.equal(count(), before + 3)
  room.command(oid, { t: 'build', op: { op: 'feature', kind: 'fence', x: 0, z: 16, x2: 20, z2: 16, style: 'privacy', color: 3 } })
  assert.equal(count(), before + 4)
  assert.equal(findPath(room.grid, [5, 15], [[5, 17]], { inside: false })?.some(([, z]) => z === 16 || z === 15) ?? true, true)
  assert.equal(findPath(room.grid, [5, 15], [[5, 17]], { inside: false }), null, 'a fence across the yard blocks the way')
  room.command(oid, { t: 'build', op: { op: 'unfeature', id: room.state.features.find(f => f.kind === 'fence')!.id } })
  room.command(oid, { t: 'build', op: { op: 'feature', kind: 'fence', x: 0, z: 16, x2: 5, z2: 16, style: 'picket', color: 3 } })
  room.command(oid, { t: 'build', op: { op: 'feature', kind: 'fence', x: 5, z: 16, x2: 6, z2: 16, style: 'gate', color: 3 } })
  room.command(oid, { t: 'build', op: { op: 'feature', kind: 'fence', x: 6, z: 16, x2: 20, z2: 16, style: 'picket', color: 3 } })
  assert.ok(findPath(room.grid, [5, 15], [[5, 17]], { inside: false }), 'the gate lets Sims through')
  const shell = shellOf(room.state)
  assert.equal(shell.features.length, room.state.features.length)
  assert.equal(shell.style.roofStyle, room.state.style.roofStyle)
})

test('looks keep their body shape and older saves infer one from their hair', () => {
  assert.equal(sanitizeLook({ ...defaultLook(), body: 'feminine' }).body, 'feminine')
  assert.equal(sanitizeLook({ ...defaultLook(), body: 'nonsense' }).body, 'masculine')
  const { body: _, ...old } = { ...defaultLook(), hairStyle: 'long' as const }
  assert.equal(sanitizeLook(old).body, 'feminine')
  assert.equal(sanitizeLook({ ...old, hairStyle: 'curly' }).body, 'masculine')
  assert.ok(['masculine', 'feminine'].includes(lookFromKey('guest-123').body))
})
