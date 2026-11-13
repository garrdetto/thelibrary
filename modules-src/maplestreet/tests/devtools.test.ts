import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CASH_LIMIT, CLAIM_REACH, SHARED_OWNER, SHARED_VEHICLE_LIMIT, SHARED_VEHICLE_TTL_MS, SPAWN_REACH, isSharedVehicleId } from '../shared/DevTools'
import { START_MONEY, STARTER_GARAGE } from '../shared/Economy'
import type { Account } from '../shared/Economy'
import type { ClientMsg, ServerMsg, SharedVehicleInfo, SpawnPose, VehicleSnap } from '../shared/Protocol'
import { NeighborhoodLogic, type Identity, type LogicOptions } from '../shared/RoomLogic'
import { WorldServer, type WorldStorage } from '../shared/WorldServer'

type Sent = { to: string; msg: ServerMsg }

/** A world with whoever is asked for standing at the given spots, and everything it sent recorded. */
function world(opts: LogicOptions, people: Record<string, { identity?: Identity; x: number; z: number }>) {
  const sent: Sent[] = []
  const logic = new NeighborhoodLogic({ send: (to, msg) => { sent.push({ to, msg }) }, broadcast: (msg) => { sent.push({ to: '*', msg }) } }, null, opts)
  for (const [id, who] of Object.entries(people)) {
    logic.join(id, { key: `local-${id}`, name: who.identity?.name ?? id, color: '#336699' }, who.identity)
    stand(logic, id, who.x, who.z)
  }
  const last = <T extends ServerMsg['t']>(t: T, to?: string) => {
    for (let i = sent.length - 1; i >= 0; i--) if (sent[i].msg.t === t && (!to || sent[i].to === to)) return sent[i].msg as Extract<ServerMsg, { t: T }>
    return null
  }
  const snapshot = () => {
    logic.tick(0.1)
    const snap = last('snap')
    assert.ok(snap, 'the world broadcasts a snapshot')
    return snap
  }
  const spawned = (): SharedVehicleInfo[] => last('shared')?.vehicles ?? []
  const shared = () => snapshot().vehicles.filter((v) => isSharedVehicleId(v.id))
  return { logic, sent, last, snapshot, spawned, shared }
}

function stand(logic: NeighborhoodLogic, id: string, x: number, z: number, vehicleId: string | null = null, s?: VehicleSnap) {
  logic.message(id, { t: 'state', p: { id, name: id, color: '#336699', x, y: 0, z, yaw: 0, speed: 0, vehicleId }, v: [], ...(s ? { s } : {}) })
}

const at = (x: number, z: number): SpawnPose => ({ x, y: 0.7, z, qx: 0, qy: 0, qz: 0, qw: 1 })
const admin: Identity = { key: 'member:admin', name: 'stoegbauer', member: true, admin: true }
const member: Identity = { key: 'member:u1', name: 'pat', member: true }
const guest: Identity = { key: 'guest:abcdefabcdef1234', name: 'Guest-abcde', member: false }
const money = (logic: NeighborhoodLogic, key: string) => logic.accounts[key].money

test('only a host-verified administrator gets the developer tools; anyone else is refused whatever they send', () => {
  const w = world({ devTools: 'admin' }, { a: { identity: admin, x: 0, z: 0 }, b: { identity: member, x: 4, z: 0 }, g: { identity: guest, x: 8, z: 0 } })
  const welcome = (to: string) => w.sent.find((s) => s.to === to && s.msg.t === 'welcome')?.msg as Extract<ServerMsg, { t: 'welcome' }>
  assert.equal(welcome('a').dev, true, 'the administrator is told the panel is theirs')
  assert.equal(welcome('b').dev, undefined)
  assert.equal(welcome('g').dev, undefined)

  for (const id of ['b', 'g']) {
    const before = money(w.logic, id === 'b' ? member.key : guest.key)
    w.logic.message(id, { t: 'dev', op: 'spawn', kind: 'sedan', to: 'me', at: at(4, 3) })
    w.logic.message(id, { t: 'dev', op: 'cash', to: 'me', amount: 5000 })
    w.logic.message(id, { ...({ t: 'dev', op: 'cash', to: 'me', amount: 5000 } satisfies ClientMsg), admin: true, dev: true } as ClientMsg)
    const reply = w.last('dev', id)
    assert.equal(reply?.ok, false, 'the request is answered with a refusal')
    assert.match(reply?.text ?? '', /administrator/)
    assert.equal(money(w.logic, id === 'b' ? member.key : guest.key), before, 'no money moved')
  }
  assert.deepEqual(w.shared(), [], 'nothing was spawned')

  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'sedan', to: 'me', at: at(0, 3) })
  assert.equal(w.last('dev', 'a')?.ok, true)
  const id = w.shared()[0].id
  w.logic.message('b', { t: 'dev', op: 'remove', id })
  assert.equal(w.last('dev', 'b')?.ok, false)
  assert.equal(w.shared().length, 1, 'a neighbor cannot remove it either')
})

test('a hello that claims to be an administrator changes nothing: the identity comes from the host', () => {
  const sent: Sent[] = []
  const logic = new NeighborhoodLogic({ send: (to, msg) => { sent.push({ to, msg }) }, broadcast: () => {} }, null, { devTools: 'admin' })
  logic.join('x', { key: 'k', name: 'stoegbauer', color: '#336699', admin: true } as never, { key: 'member:u9', name: 'sneak', member: true })
  logic.join('y', { key: 'k2', name: 'stoegbauer', color: '#336699' })
  assert.equal(sent.some((s) => s.msg.t === 'welcome' && s.msg.dev), false)
  stand(logic, 'x', 0, 0)
  logic.message('x', { t: 'dev', op: 'cash', to: 'me', amount: 100 })
  assert.equal(sent.map((s) => s.msg).find((m): m is Extract<ServerMsg, { t: 'dev' }> => m.t === 'dev')?.ok, false)
  assert.equal(money(logic, 'member:u9'), START_MONEY)
})

test('classic Fox Plains has no developer tools, even for an administrator', () => {
  const w = world({}, { a: { identity: admin, x: 0, z: 0 } })
  assert.equal(w.sent.some((s) => s.msg.t === 'welcome' && s.msg.dev), false)
  assert.equal(w.sent.some((s) => s.msg.t === 'shared'), false, 'no spawned-vehicle list is ever sent')
  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'sedan', to: 'me', at: at(0, 3) })
  w.logic.message('a', { t: 'dev', op: 'cash', to: 'me', amount: 100 })
  w.logic.message('a', { t: 'shared', op: 'claim', id: 'shared:1' })
  assert.equal(w.last('dev'), null, 'the messages are ignored')
  assert.equal(money(w.logic, admin.key), START_MONEY)
  assert.deepEqual(w.shared(), [])
})

test('a vehicle spawned beside another player belongs to nobody and shows up for everyone', () => {
  const w = world({ devTools: 'admin' }, { a: { identity: admin, x: 0, z: 0 }, b: { identity: member, x: 200, z: 50 } })
  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'coupe', to: 'b', at: at(203, 50) })
  assert.equal(w.last('dev', 'a')?.ok, true)
  assert.match(w.last('dev', 'a')?.text ?? '', /beside pat/)
  assert.match(w.last('toast', 'b')?.text ?? '', /Anyone can drive it/)
  const [car] = w.shared()
  assert.equal(car.kind, 'coupe')
  assert.equal(car.owner, SHARED_OWNER)
  assert.deepEqual([car.x, car.z], [203, 50])
  assert.deepEqual(w.spawned().map((v) => [v.kind, v.driver]), [['coupe', null]])
  assert.ok(w.spawned()[0].left > SHARED_VEHICLE_TTL_MS - 1000 && w.spawned()[0].left <= SHARED_VEHICLE_TTL_MS, 'with five minutes on its clock')
  for (const key of [admin.key, member.key]) assert.deepEqual((w.logic.accounts[key] as Account).garage, STARTER_GARAGE, 'it is in nobody\'s garage')

  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'coupe', to: 'b', at: at(203 + SPAWN_REACH, 50) })
  assert.equal(w.last('dev', 'a')?.ok, false, 'a spot far from the player is refused')
  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'rocketship' as never, to: 'b', at: at(203, 50) })
  assert.equal(w.last('dev', 'a')?.ok, false, 'an unregistered vehicle is refused')
  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'coupe', to: 'nobody', at: at(203, 50) })
  assert.equal(w.last('dev', 'a')?.ok, false, 'a player who is not here is refused')
  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'coupe', to: 'b', at: { x: 203, y: Number.NaN, z: 50, qx: 0, qy: 0, qz: 0, qw: 1 } })
  assert.equal(w.last('dev', 'a')?.ok, false, 'a spot that is not numbers is refused')
  assert.equal(w.shared().length, 1)

  for (let i = 1; i < SHARED_VEHICLE_LIMIT; i++) w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'sedan', to: 'me', at: at(i, 4) })
  assert.equal(w.shared().length, SHARED_VEHICLE_LIMIT)
  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'sedan', to: 'me', at: at(0, 8) })
  assert.equal(w.last('dev', 'a')?.ok, false, 'there is a cap on how many are out at once')
  assert.equal(w.shared().length, SHARED_VEHICLE_LIMIT)
})

test('a spawned vehicle has one driver at a time: first to ask, and it stays where the driver leaves it', () => {
  const w = world({ devTools: 'admin' }, { a: { identity: admin, x: 0, z: 0 }, b: { identity: member, x: 2, z: 2 }, g: { identity: guest, x: -2, z: 2 }, far: { x: CLAIM_REACH + 20, z: 0 } })
  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'sedan', to: 'me', at: at(0, 3) })
  const id = w.shared()[0].id

  w.logic.message('far', { t: 'shared', op: 'claim', id })
  assert.equal(w.spawned()[0].driver, null, 'nobody takes it from across town')
  assert.match(w.last('toast', 'far')?.text ?? '', /Walk up/)

  w.logic.message('g', { t: 'shared', op: 'claim', id })
  w.logic.message('b', { t: 'shared', op: 'claim', id })
  assert.equal(w.spawned()[0].driver, 'g', 'the first to ask drives, a guest included')
  assert.match(w.last('toast', 'b')?.text ?? '', /Someone else is driving/)
  assert.equal(w.last('shared', 'b')?.vehicles[0].driver, 'g', 'the one refused is told who has it')

  const pose = (x: number): VehicleSnap => ({ id, owner: 'whoever', kind: 'sedan', x, y: 0.7, z: 30, qx: 0, qy: 0.6, qz: 0, qw: 0.8, steer: 0.2, speed: 9, hitchedTo: null })
  stand(w.logic, 'g', 40, 30, id, pose(40))
  stand(w.logic, 'b', 2, 2, id, pose(-500))
  let snap = w.snapshot()
  let car = snap.vehicles.find((v) => v.id === id)!
  assert.deepEqual([car.owner, car.x, car.z, car.speed], ['g', 40, 30, 9], 'only the driver moves it')
  assert.equal(snap.players.find((p) => p.id === 'g')?.vehicleId, id, 'the driver is seen sitting in it')
  assert.notEqual(snap.players.find((p) => p.id === 'b')?.vehicleId, id, 'nobody else can claim the seat')

  w.logic.message('b', { t: 'shared', op: 'release', id })
  assert.equal(w.spawned()[0].driver, 'g', 'only the driver can let go of it')

  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'coupe', to: 'g', at: at(42, 30) })
  const second = w.spawned().find((v) => v.id !== id)!.id
  w.logic.message('g', { t: 'shared', op: 'claim', id: second })
  assert.equal(w.spawned().find((v) => v.id === second)?.driver, null, 'one spawned vehicle each')

  w.logic.message('g', { t: 'shared', op: 'release', id })
  car = w.snapshot().vehicles.find((v) => v.id === id)!
  assert.deepEqual([car.owner, car.x, car.z, car.speed, car.qy], [SHARED_OWNER, 40, 30, 0, 0.6], 'it is parked where it was left')

  stand(w.logic, 'b', 38, 30)
  w.logic.message('b', { t: 'shared', op: 'claim', id })
  assert.equal(w.spawned().find((v) => v.id === id)?.driver, 'b', 'then anyone else can take it')
  stand(w.logic, 'b', 60, 30, id, pose(60))
  w.logic.leave('b')
  car = w.snapshot().vehicles.find((v) => v.id === id)!
  assert.deepEqual([car.owner, car.x], [SHARED_OWNER, 60], 'a driver who leaves the world leaves it parked')
  assert.equal(w.spawned().find((v) => v.id === id)?.driver, null)
})

test('a spawned vehicle is gone for everyone five minutes after it was spawned, but never from under its driver', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 })
  const w = world({ devTools: 'admin' }, { a: { identity: admin, x: 0, z: 0 }, b: { identity: member, x: 2, z: 2 } })
  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'sedan', to: 'me', at: at(0, 3) })
  t.mock.timers.tick(60_000)
  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'coupe', to: 'b', at: at(4, 2) })
  const [empty, taken] = w.spawned().map((v) => v.id)
  assert.deepEqual(w.spawned().map((v) => v.left), [SHARED_VEHICLE_TTL_MS - 60_000, SHARED_VEHICLE_TTL_MS])
  w.logic.message('b', { t: 'shared', op: 'claim', id: taken })

  t.mock.timers.tick(SHARED_VEHICLE_TTL_MS - 60_000 - 1)
  assert.equal(w.shared().length, 2, 'both are still there a moment before the first one\'s time is up')
  t.mock.timers.tick(1)
  assert.deepEqual(w.shared().map((v) => v.id), [taken], 'the empty one disappears on time')
  assert.deepEqual(w.spawned().map((v) => v.id), [taken], 'and everyone is told')
  assert.equal(empty === taken, false)

  t.mock.timers.tick(10 * 60_000)
  assert.deepEqual(w.shared().map((v) => [v.id, v.owner]), [[taken, 'b']], 'the one being driven stays past its time')
  w.logic.message('b', { t: 'shared', op: 'release', id: taken })
  assert.deepEqual(w.spawned(), [], 'and goes the moment its driver gets out')
  assert.deepEqual(w.shared(), [])
})

test('the administrator can remove a spawned vehicle at once, driver or not', () => {
  const w = world({ devTools: 'admin' }, { a: { identity: admin, x: 0, z: 0 }, b: { identity: member, x: 2, z: 2 } })
  w.logic.message('a', { t: 'dev', op: 'spawn', kind: 'sedan', to: 'b', at: at(4, 2) })
  const id = w.shared()[0].id
  w.logic.message('b', { t: 'shared', op: 'claim', id })
  w.logic.message('a', { t: 'dev', op: 'remove', id })
  assert.equal(w.last('dev', 'a')?.ok, true)
  assert.deepEqual(w.shared(), [])
  assert.match(w.last('toast', 'b')?.text ?? '', /was removed/)
  w.logic.message('a', { t: 'dev', op: 'remove', id })
  assert.equal(w.last('dev', 'a')?.ok, false, 'removing it twice says it is already gone')
})

test('cash goes to the wallet of the player it was given to, and only that one', () => {
  const w = world({ devTools: 'admin' }, { a: { identity: admin, x: 0, z: 0 }, b: { identity: member, x: 300, z: 0 }, g: { identity: guest, x: -300, z: 0 } })
  w.sent.length = 0
  w.logic.message('a', { t: 'dev', op: 'cash', to: 'b', amount: 2500 })
  assert.equal(money(w.logic, member.key), START_MONEY + 2500)
  assert.equal(money(w.logic, admin.key), START_MONEY)
  assert.equal(money(w.logic, guest.key), START_MONEY)
  assert.equal(w.last('account', 'b')?.account.money, START_MONEY + 2500, 'their wallet chip is updated over the socket')
  assert.equal(w.last('account', 'a'), null)
  assert.match(w.last('toast', 'b')?.text ?? '', /stoegbauer gave you \$2,500/)
  assert.match(w.last('dev', 'a')?.text ?? '', /\$2,500 given to pat/)
  assert.ok(w.logic.dirty.accounts.has(member.key), 'the balance is saved')

  w.logic.message('a', { t: 'dev', op: 'cash', to: 'me', amount: 40 })
  assert.equal(money(w.logic, admin.key), START_MONEY + 40)
  assert.equal(w.last('account', 'a')?.account.money, START_MONEY + 40)

  w.logic.message('a', { t: 'dev', op: 'cash', to: 'g', amount: 75.9 })
  assert.equal(money(w.logic, guest.key), START_MONEY + 75, 'whole dollars')
  assert.match(w.last('dev', 'a')?.text ?? '', /guest/, 'the panel says what a guest got and what it could not change')
  assert.match(w.last('dev', 'a')?.text ?? '', /lake cash/)

  for (const amount of [0, -500, Number.NaN, Number.POSITIVE_INFINITY, CASH_LIMIT + 1, '900' as unknown as number]) {
    w.logic.message('a', { t: 'dev', op: 'cash', to: 'b', amount })
    assert.equal(w.last('dev', 'a')?.ok, false, `${String(amount)} is refused`)
  }
  w.logic.message('a', { t: 'dev', op: 'cash', to: 'gone', amount: 10 })
  assert.equal(w.last('dev', 'a')?.ok, false, 'a player who is not in the world gets nothing')
  assert.equal(money(w.logic, member.key), START_MONEY + 2500)
})

test('solo play runs the tools on this device for whoever is playing, with nothing to give', () => {
  const w = world({ devTools: 'all', unlimitedMoney: true }, { me: { x: 0, z: 0 } })
  assert.equal(w.sent.some((s) => s.msg.t === 'welcome' && s.msg.dev === true), true)
  w.logic.message('me', { t: 'dev', op: 'spawn', kind: 'atv', to: 'me', at: at(0, 3) })
  assert.equal(w.last('dev')?.ok, true)
  const id = w.shared()[0].id
  w.logic.message('me', { t: 'shared', op: 'claim', id })
  assert.equal(w.spawned()[0].driver, 'me')
  w.logic.message('me', { t: 'dev', op: 'cash', to: 'me', amount: 100 })
  assert.equal(w.last('dev')?.ok, false)
  assert.match(w.last('dev')?.text ?? '', /Solo/)
})

function memoryStorage(): WorldStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    async get<T>(key: string) { return data.get(key) as T | undefined },
    async put(entries) { for (const [k, v] of Object.entries(entries)) data.set(k, structuredClone(v)) },
    async list<T>(prefix: string) { return new Map([...data].filter(([k]) => k.startsWith(prefix)) as [string, T][]) },
  }
}

test('Fox Lake\'s world takes the administrator flag from the host identity and saves a gift at once', async () => {
  const storage = memoryStorage()
  const open = async (server: WorldServer, identity: Identity) => {
    const got: ServerMsg[] = []
    const conn = await server.connect({ send: (data) => { got.push(JSON.parse(data) as ServerMsg) }, close: () => {} }, identity)
    const say = (msg: ClientMsg) => conn.onMessage(JSON.stringify(msg))
    say({ t: 'hello', opts: { key: 'x', name: identity.name, color: '#336699' } })
    const welcome = got.find((m): m is Extract<ServerMsg, { t: 'welcome' }> => m.t === 'welcome')
    assert.ok(welcome, 'the world answers the hello')
    return { got, say, welcome, close: conn.onClose }
  }
  const foxLake = new WorldServer(storage, { devTools: true })
  const a = await open(foxLake, admin)
  const b = await open(foxLake, member)
  try {
    assert.equal(a.welcome.dev, true)
    assert.equal(b.welcome.dev, undefined)
    const here = (who: typeof a, x: number) => who.say({ t: 'state', p: { id: who.welcome.you, name: '', color: '', x, y: 0, z: 0, yaw: 0, speed: 0, vehicleId: null }, v: [] })
    here(a, 0)
    here(b, 5)
    const savedMoney = () => ([...storage.data].find(([k]) => k.endsWith(`acct:${member.key}`))?.[1] as Account | undefined)?.money

    b.say({ t: 'dev', op: 'cash', to: 'me', amount: 999 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(b.got.find((m): m is Extract<ServerMsg, { t: 'dev' }> => m.t === 'dev')?.ok, false)
    assert.notEqual(savedMoney(), START_MONEY + 999, 'a member cannot pay themselves')

    a.say({ t: 'dev', op: 'cash', to: b.welcome.you, amount: 300 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(savedMoney(), START_MONEY + 300, 'the balance is in storage straight away')
    assert.equal(b.got.filter((m): m is Extract<ServerMsg, { t: 'account' }> => m.t === 'account').pop()?.account.money, START_MONEY + 300)
  } finally {
    a.close()
    b.close()
  }

  const classic = await open(new WorldServer(memoryStorage()), admin)
  try {
    assert.equal(classic.welcome.dev, undefined, 'the classic Fox Plains world never grants them')
  } finally {
    classic.close()
  }
})
