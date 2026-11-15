import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyBuild, type LotState } from '../shared/BuildRules'
import { LAKE_RIDE_ITEMS, shopItems, type LakeRide } from '../shared/Economy'
import type { ServerMsg } from '../shared/Protocol'
import { NeighborhoodLogic } from '../shared/RoomLogic'
import { MONTELLO_DEALER, MONTELLO_LOTS, MONTELLO_SHOPS } from '../shared/MontelloPlaces'
import { FOX_LAKE_GENERATION, WORLD_GENERATION, WorldServer, type WorldStorage } from '../shared/WorldServer'
import { makeLots } from '../shared/WorldLayout'

function memoryStorage(): WorldStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    async get<T>(key: string) { return data.get(key) as T | undefined },
    async put(entries) { for (const [k, v] of Object.entries(entries)) data.set(k, structuredClone(v)) },
    async list<T>(prefix: string) { return new Map([...data].filter(([k]) => k.startsWith(prefix)) as [string, T][]) },
  }
}

function oldFoxPlainsSave(storage: ReturnType<typeof memoryStorage>) {
  const [mine] = makeLots()
  const lot = (owner: string): LotState => ({ ...mine, owner, ownerName: 'Someone' })
  storage.data.set(`${WORLD_GENERATION}meta`, { version: 3, epochDay: 20000, coverage: {} })
  storage.data.set(`${WORLD_GENERATION}lot:${mine.id}`, { lot: lot('p1'), build: { ...emptyBuild(), walls: { '0,0,0,n': 'brick' } } })
  storage.data.set(`${WORLD_GENERATION}acct:k1`, { id: 'p1', key: 'k1', name: 'Someone', money: 100 })
  return mine
}

test('Fox Lake\'s world is Montello alone: only its parcels, no Fox Plains lots, and the old Fox Plains-town saves are never read', async () => {
  const storage = memoryStorage()
  const mine = oldFoxPlainsSave(storage)
  await new WorldServer(storage, { devTools: true, foxLake: true }).ready()
  const lots = [...storage.data.keys()].filter((k) => k.startsWith(`${FOX_LAKE_GENERATION}lot:`)).map((k) => k.slice(`${FOX_LAKE_GENERATION}lot:`.length))
  assert.equal(lots.length, MONTELLO_LOTS.length)
  assert.ok(!lots.includes(mine.id), 'no Fox Plains lot')
  assert.ok(MONTELLO_LOTS.some((l) => l.id.startsWith('V')), 'vacant parcels across the map')
  for (const l of MONTELLO_LOTS) assert.equal((storage.data.get(`${FOX_LAKE_GENERATION}lot:${l.id}`) as { lot: LotState }).lot.owner, null, `${l.id} is for sale`)
  assert.equal((storage.data.get(`${WORLD_GENERATION}lot:${mine.id}`) as { lot: LotState }).lot.owner, 'p1', 'classic Fox Plains\' save is untouched')
  assert.equal(storage.data.get(`${FOX_LAKE_GENERATION}acct:k1`), undefined, 'and nobody\'s old account is carried over')
})

test('classic Fox Plains keeps its lots and has no Montello lots', async () => {
  const storage = memoryStorage()
  const mine = oldFoxPlainsSave(storage)
  await new WorldServer(storage).ready()
  assert.equal((storage.data.get(`${WORLD_GENERATION}lot:${mine.id}`) as { lot: LotState }).lot.owner, 'p1')
  assert.equal(storage.data.get(`${WORLD_GENERATION}lot:${MONTELLO_LOTS[0].id}`), undefined)
})

test('Montello\'s parcels lie on its map, are big enough to build on and do not overlap', () => {
  assert.ok(MONTELLO_LOTS.length >= 60)
  for (const l of MONTELLO_LOTS) {
    assert.ok(Math.abs(l.x) < 7300 && Math.abs(l.z) < 7600, `${l.id} is on Montello's map`)
    assert.ok(typeof l.y === 'number' && l.y > -12 && l.y < 80, `${l.id} has its ground level`)
    assert.ok(l.w >= 14 && l.d >= 14)
    if (l.id.startsWith('M')) assert.equal(typeof l.scan, 'number', `${l.id} replaces a scanned house`)
    else assert.equal(l.scan, undefined)
  }
  for (let i = 0; i < MONTELLO_LOTS.length; i++) for (let j = i + 1; j < MONTELLO_LOTS.length; j++) {
    const a = MONTELLO_LOTS[i], b = MONTELLO_LOTS[j]
    assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d), `${a.id} and ${b.id} overlap`)
  }
})

function foxLakeTown(money = 100_000) {
  const sent: ServerMsg[] = []
  const logic = new NeighborhoodLogic({ send: (_id, msg) => { sent.push(msg) }, broadcast: (msg) => { sent.push(msg) } }, null, { extraLots: MONTELLO_LOTS, foxLake: true })
  logic.join('s1', { key: 'k', name: 'Visitor', color: '#3a7bd5' })
  const account = () => logic.accounts.k
  account().money = money
  const place = (x: number, z: number) => logic.message('s1', { t: 'state', p: { id: 's1', name: 'Visitor', color: '#3a7bd5', x, y: 0, z, yaw: 0, speed: 0, vehicleId: null }, v: [] })
  const note = () => [...sent].reverse().find((m): m is Extract<ServerMsg, { t: 'account' }> => m.t === 'account' && !!m.note)?.note ?? ''
  return { logic, account, place, note }
}

test('Fox Lake\'s world has no Fox Plains lots, neighbors or shops', () => {
  const { logic } = foxLakeTown()
  assert.equal(Object.keys(logic.world.lots).length, MONTELLO_LOTS.length)
  assert.ok(!Object.values(logic.world.lots).some((l) => l.owner?.startsWith('npc-')), 'no seeded neighbors')
  const { place, logic: l2, account, note } = foxLakeTown(500)
  place(0, 0)
  l2.message('s1', { t: 'buy', shop: 'maple-diner', item: 'burger' })
  assert.equal(account().money, 500)
  void note
})

test('the dealership sells the UTV, the quad and the boat once each, at its door, and the account keeps them', () => {
  assert.ok(MONTELLO_DEALER)
  const dealer = MONTELLO_SHOPS.find((s) => s.kind === 'dealer')!
  assert.deepEqual(shopItems('dealer', true).filter((i) => i.ride).map((i) => i.ride), ['utv', 'quad', 'boat'] satisfies LakeRide[])
  assert.equal(shopItems('dealer', false).filter((i) => i.ride).length, 0, 'classic Fox Plains\' dealership does not sell them')
  const { logic, account, place, note } = foxLakeTown(60_000)
  assert.deepEqual(account().rides, [])
  place(0, 0)
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'ride-utv' })
  assert.match(note(), /Walk up/)
  assert.deepEqual(account().rides, [])
  place(dealer.x + 1, dealer.z + 1)
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'ride-utv' })
  const utv = LAKE_RIDE_ITEMS.find((i) => i.ride === 'utv')!
  assert.deepEqual(account().rides, ['utv'])
  assert.equal(account().money, 60_000 - utv.price)
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'ride-utv' })
  assert.match(note(), /already own/)
  assert.equal(account().money, 60_000 - utv.price, 'charged once')
  account().money = 10
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'ride-boat' })
  assert.match(note(), /Not enough money/)
  assert.deepEqual(account().rides, ['utv'])
})
