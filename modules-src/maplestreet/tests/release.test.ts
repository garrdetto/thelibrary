import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyBuild, type LotState } from '../shared/BuildRules'
import { MONTELLO_LOTS } from '../shared/MontelloPlaces'
import { RELEASE_LOTS, WORLD_GENERATION, WorldServer, type WorldStorage } from '../shared/WorldServer'
import { lotPrice, makeLots } from '../shared/WorldLayout'

function memoryStorage(): WorldStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    async get<T>(key: string) { return data.get(key) as T | undefined },
    async put(entries) { for (const [k, v] of Object.entries(entries)) data.set(k, structuredClone(v)) },
    async list<T>(prefix: string) { return new Map([...data].filter(([k]) => k.startsWith(prefix)) as [string, T][]) },
  }
}

function savedWorld(storage: ReturnType<typeof memoryStorage>) {
  const [mine, npc, ...rest] = makeLots()
  const lot = (l: typeof mine, owner: string | null): LotState => ({ ...l, owner, ownerName: owner ? 'Someone' : null })
  const build = { ...emptyBuild(), walls: { '0,0,0,n': 'brick' } }
  storage.data.set(`${WORLD_GENERATION}meta`, { version: 3, epochDay: 20000, coverage: {} })
  storage.data.set(`${WORLD_GENERATION}lot:${mine.id}`, { lot: lot(mine, 'p1'), build })
  storage.data.set(`${WORLD_GENERATION}lot:${npc.id}`, { lot: lot(npc, 'npc-larsen'), build })
  for (const l of rest) storage.data.set(`${WORLD_GENERATION}lot:${l.id}`, { lot: lot(l, null), build: emptyBuild() })
  storage.data.set(`${WORLD_GENERATION}acct:k1`, { id: 'p1', key: 'k1', name: 'Someone', money: 100 })
  return { mine, npc }
}

test('Fox Lake releases every player\'s lot once, refunding its price, and offers Montello\'s house lots', async () => {
  const storage = memoryStorage()
  const { mine, npc } = savedWorld(storage)
  await new WorldServer(storage, { devTools: true, foxLake: true }).ready()
  const lotOf = (id: string) => (storage.data.get(`${WORLD_GENERATION}lot:${id}`) as { lot: LotState; build: { walls: Record<string, unknown> } })
  const money = () => (storage.data.get(`${WORLD_GENERATION}acct:k1`) as { money: number }).money
  assert.equal(lotOf(mine.id).lot.owner, null)
  assert.deepEqual(lotOf(mine.id).build.walls, {}, 'the house is cleared')
  assert.equal(money(), 100 + lotPrice(mine), 'the lot price is refunded')
  assert.equal(lotOf(npc.id).lot.owner, 'npc-larsen', 'the neighbourhood\'s own houses stay')
  assert.equal((storage.data.get(`${WORLD_GENERATION}meta`) as { released?: number }).released, RELEASE_LOTS)
  assert.ok(MONTELLO_LOTS.length > 10)
  for (const l of MONTELLO_LOTS) assert.equal(lotOf(l.id)?.lot.owner, null, `${l.id} is for sale`)

  await new WorldServer(storage, { devTools: true, foxLake: true }).ready()
  assert.equal(money(), 100 + lotPrice(mine), 'only once')
})

test('classic Fox Plains keeps its lots and has no Montello lots', async () => {
  const storage = memoryStorage()
  const { mine } = savedWorld(storage)
  await new WorldServer(storage).ready()
  assert.equal((storage.data.get(`${WORLD_GENERATION}lot:${mine.id}`) as { lot: LotState }).lot.owner, 'p1')
  assert.equal(storage.data.get(`${WORLD_GENERATION}lot:${MONTELLO_LOTS[0].id}`), undefined)
})

test('Montello\'s house lots lie in Montello, south-west of Fox Plains, at their own ground level', () => {
  for (const l of MONTELLO_LOTS) {
    assert.ok(l.x < -1700 && l.z > 0, `${l.id} is in Montello`)
    assert.ok(typeof l.y === 'number' && typeof l.scan === 'number')
    assert.ok(l.w >= 14 && l.d >= 14)
  }
})
