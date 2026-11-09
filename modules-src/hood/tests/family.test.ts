import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CATALOG, objectDef } from '../shared/Catalog'
import { ADULT_AGE, LIFE_STAGES, canDoAction, socialBlock, stageOf, type SocialParty } from '../shared/Family'
import { MAX_SIMS, newLotState, sanitizeLotState } from '../shared/Lot'
import { defaultLook } from '../shared/Look'
import type { ServerMessage } from '../shared/Protocol'
import { Room, type JoinInfo } from '../shared/Room'

function owner() {
  const inbox: ServerMessage[] = []
  const info: JoinInfo = { key: 'member:owner-1', name: 'maple', send: m => inbox.push(m), close: () => undefined }
  return { info, inbox, notices: () => inbox.filter((m): m is Extract<ServerMessage, { t: 'notice' }> => m.t === 'notice').map(m => m.text) }
}

function family(stages: ('adult' | 'teen' | 'child')[] = ['adult', 'adult']) {
  return newLotState(0, 3, 'owner-1', 'maple', 'The Maples', stages.map((stage, i) => ({ name: `Res${i + 1}`, look: defaultLook(), stage })))
}

function run(room: Room, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) room.tick(0.1)
}

function join(room: Room, who = owner()): string {
  const result = room.join(who.info)
  assert.ok('id' in result)
  return result.id
}

test('life stages follow age in sim days', () => {
  assert.deepEqual([0, 0.5, 1, 2.9, 3, 6, 8.99, 9, 40].map(stageOf), ['baby', 'baby', 'toddler', 'toddler', 'child', 'teen', 'teen', 'adult', 'adult'])
  const state = family(['adult', 'teen', 'child'])
  assert.deepEqual(state.household.sims.map(s => stageOf(s.age)), ['adult', 'teen', 'child'])
})

test('households move in close and older saves become grown-ups', () => {
  const state = family()
  assert.equal(state.friendships['h:s1|h:s2'], 30)
  const old = JSON.parse(JSON.stringify(state)) as Record<string, any>
  for (const sim of old.household.sims) delete sim.age
  old.friendships = {}
  const clean = sanitizeLotState(old, 0, 3)!
  assert.ok(clean.household.sims.every(s => s.age === ADULT_AGE))
  assert.equal(clean.friendships['h:s1|h:s2'], 30)
})

test('up to eight residents, and new adults can move in later', () => {
  assert.equal(MAX_SIMS, 8)
  const room = new Room(family(['adult']))
  const me = owner()
  const id = join(room, me)
  for (let i = 0; i < 9; i++) room.command(id, { t: 'addSim', name: `New${i}`, look: defaultLook(), stage: 'adult' })
  assert.equal(room.state.household.sims.length, MAX_SIMS)
  assert.ok(me.notices().some(n => n.includes('up to 8')))
  assert.equal(new Set(room.state.household.sims.map(s => s.id)).size, MAX_SIMS)
  assert.ok(room.sims.has(`h-${room.state.household.sims[7].id}`))
})

test('children grow up with household time and are told about it', () => {
  const state = family(['adult', 'child'])
  state.household.sims[1].age = 5.995
  const room = new Room(state)
  const me = owner()
  join(room, me)
  run(room, 15)
  assert.equal(stageOf(room.state.household.sims[1].age), 'teen')
  assert.ok(me.notices().some(n => n.includes('teenager')))
})

test('only adults can work, and age limits who uses what', () => {
  const state = family(['adult', 'child'])
  const room = new Room(state)
  const me = owner()
  const id = join(room, me)
  room.command(id, { t: 'job', sim: 's2', job: 'police' })
  assert.equal(room.state.household.sims[1].career, null)
  room.command(id, { t: 'job', sim: 's1', job: 'police' })
  assert.equal(room.state.household.sims[0].career?.job, 'police')
  const stove = objectDef('stove')!.actions[0]
  const crib = objectDef('crib')!.actions[0]
  assert.equal(canDoAction('child', stove), false)
  assert.equal(canDoAction('teen', stove), true)
  assert.equal(canDoAction('baby', crib), true)
  assert.equal(canDoAction('adult', crib), false)
})

test('who can do what together', () => {
  const adult = (id: string, extra: Partial<SocialParty> = {}): SocialParty => ({ id, stage: 'adult', hh: true, rec: id, ...extra })
  const ctx = { friendship: 50, room: true }
  assert.equal(socialBlock('baby', adult('a'), adult('b'), ctx), null)
  assert.match(socialBlock('baby', adult('a'), adult('b'), { friendship: 10, room: true }) ?? '', /closer/)
  assert.match(socialBlock('baby', adult('a'), adult('b'), { friendship: 90, room: false }) ?? '', /full/)
  assert.match(socialBlock('baby', adult('a'), adult('b', { expecting: true }), ctx) ?? '', /already/)
  assert.match(socialBlock('flirt', adult('a'), adult('kid', { parents: ['a'] }), ctx) ?? '', /family/)
  assert.match(socialBlock('flirt', adult('x', { parents: ['p'] }), adult('y', { parents: ['p', 'q'] }), ctx) ?? '', /family/)
  assert.ok(socialBlock('flirt', { id: 'c', stage: 'child', hh: true, rec: 'c' }, adult('b'), ctx))
  assert.equal(socialBlock('feed', adult('a'), { id: 'z', stage: 'baby', hh: true, rec: 'z' }, ctx), null)
  assert.ok(socialBlock('feed', { id: 'g', stage: 'adult', hh: false }, { id: 'z', stage: 'baby', hh: true, rec: 'z' }, ctx))
  assert.ok(socialBlock('chat', { id: 'z', stage: 'baby', hh: true, rec: 'z' }, adult('a'), ctx))
})

test('two close adults can have a baby who is born, grows and takes after them', () => {
  const state = family(['adult', 'adult'])
  state.friendships['h:s1|h:s2'] = 80
  state.household.sims[0].look = { ...defaultLook(), skin: 4 }
  state.household.sims[1].look = { ...defaultLook(), skin: 4 }
  const room = new Room(state, {}, undefined, 7)
  const me = owner()
  const id = join(room, me)
  for (let attempt = 0; attempt < 12 && !room.state.household.sims.some(s => s.expecting); attempt++) {
    room.command(id, { t: 'social', sim: 'h-s1', target: 'h-s2', kind: 'baby' })
    run(room, 60)
  }
  const parent = room.state.household.sims.find(s => s.expecting)
  assert.ok(parent, me.notices().join(' | '))
  assert.ok(me.notices().some(n => n.includes('expecting')))
  parent.expecting!.left = 1
  run(room, 3)
  const baby = room.state.household.sims.find(s => s.parents?.length)
  assert.ok(baby)
  assert.equal(stageOf(baby.age), 'baby')
  assert.deepEqual([...baby.parents!].sort(), ['s1', 's2'])
  assert.equal(baby.look.skin, 4)
  assert.ok(room.sims.has(`h-${baby.id}`))
  assert.ok(me.notices().some(n => n.startsWith('Welcome home')))
  // Brothers and sisters and parents never flirt with their own.
  room.command(id, { t: 'social', sim: 'h-s1', target: `h-${baby.id}`, kind: 'flirt' })
  assert.equal(room.sims.get('h-s1')!.queue.length, 0)
  // Babies are looked after: a grown-up can feed them.
  baby.needs.hunger = 20
  room.command(id, { t: 'social', sim: 'h-s1', target: `h-${baby.id}`, kind: 'feed' })
  run(room, 40)
  assert.ok(baby.needs.hunger > 40, `hunger ${baby.needs.hunger}`)
  // And grow up.
  baby.age = 0.999
  run(room, 5)
  assert.equal(stageOf(baby.age), 'toddler')
})

test('moving out keeps a grown-up at home and never sends the little ones', () => {
  const state = family(['adult', 'child'])
  const room = new Room(state)
  const me = owner()
  const id = join(room, me)
  room.command(id, { t: 'moveOut', sim: 's1' })
  assert.equal(room.state.household.sims.length, 2)
  room.command(id, { t: 'moveOut', sim: 's2' })
  assert.deepEqual(room.state.household.sims.map(s => s.id), ['s1'])
  assert.ok(!Object.keys(room.state.friendships).some(k => k.includes('h:s2')))
  assert.ok(!room.sims.has('h-s2'))
})

test('the catalog is big, unique, and every age range makes sense', () => {
  assert.ok(CATALOG.length >= 130)
  assert.equal(new Set(CATALOG.map(d => d.id)).size, CATALOG.length)
  for (const def of CATALOG) {
    assert.ok(def.price > 0 && def.w >= 1 && def.d >= 1, def.id)
    for (const action of def.actions) {
      if (!action.ages) continue
      assert.ok(LIFE_STAGES.indexOf(action.ages[0]) <= LIFE_STAGES.indexOf(action.ages[1]), `${def.id}.${action.id}`)
    }
  }
  for (const id of ['crib', 'high-chair', 'swing-set', 'pool', 'piano', 'hot-tub', 'bunk-bed']) assert.ok(objectDef(id), id)
})
