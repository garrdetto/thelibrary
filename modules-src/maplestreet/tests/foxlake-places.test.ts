import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerCustomVehicles } from '../shared/CustomVehicles'
import { SHOP_ITEMS, STARTER_TRUCK } from '../shared/Economy'
import { MONTELLO_LOTS, MONTELLO_SHOPS } from '../shared/MontelloPlaces'
import type { ServerMsg, VehicleSnap } from '../shared/Protocol'
import { NeighborhoodLogic } from '../shared/RoomLogic'

registerCustomVehicles([])

function foxLakeTown(money = 100_000) {
  const sent: ServerMsg[] = []
  const logic = new NeighborhoodLogic({ send: (_id, msg) => { sent.push(msg) }, broadcast: (msg) => { sent.push(msg) } }, null, { extraLots: MONTELLO_LOTS, foxLake: true })
  logic.join('s1', { key: 'k', name: 'Visitor', color: '#3a7bd5' })
  const account = () => logic.accounts.k
  account().money = money
  const place = (x: number, z: number, carX = x, carZ = z) => logic.message('s1', {
    t: 'state',
    p: { id: 's1', name: 'Visitor', color: '#3a7bd5', x, y: 0, z, yaw: 0, speed: 0, vehicleId: null },
    v: [{ id: 's1:truck', owner: 's1', kind: STARTER_TRUCK, x: carX, y: 0, z: carZ, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, speed: 0, hitchedTo: null }] as VehicleSnap[],
  })
  const note = () => [...sent].reverse().find((m): m is Extract<ServerMsg, { t: 'account' }> => m.t === 'account' && !!m.note)?.note ?? ''
  return { logic, account, place, note }
}

const shop = (kind: string) => MONTELLO_SHOPS.find((s) => s.kind === kind)!
const named = (name: string) => MONTELLO_SHOPS.find((s) => s.name === name)!

test('every Fox Plains place has a Montello counter: Freitag\'s groceries, three gas stations, bars, clothing, the body shop, the bank and the outfitter', () => {
  assert.equal(named("Freitag's Food Center").kind, 'grocery')
  assert.ok(SHOP_ITEMS.grocery.some((i) => i.groceries), 'the grocery sells a week of meals')
  assert.equal(MONTELLO_SHOPS.filter((s) => s.kind === 'gas').map((s) => s.name).sort().join('|'), 'BP|Kwik Trip|Mobil', 'only the three real stations sell fuel')
  for (const n of ['Rivers Edge Saloon & Eatery', 'Tambears', 'Yahooz Sports Bar & Grill', "Weezie's Town Pump", "Drew's Lakeside Bar & Grill"]) assert.equal(named(n).kind, 'bar', n)
  for (const kind of ['clothing', 'bodyshop', 'bank', 'dealer', 'outfitter', 'police', 'hardware']) assert.ok(shop(kind), `a ${kind} counter`)
  assert.match(shop('police').name, /Sheriff/)
  assert.equal(new Set(MONTELLO_SHOPS.map((s) => s.id)).size, MONTELLO_SHOPS.length)
  for (const kind of ['clothing', 'hardware', 'bar', 'grocery', 'gas']) assert.ok((SHOP_ITEMS[kind] ?? []).length > 0, `${kind} sells something`)
})

test('Freitag\'s sells groceries at its door ', () => {
  const { logic, account, place, note } = foxLakeTown(1_000)
  const grocery = named("Freitag's Food Center")
  place(0, 0)
  logic.message('s1', { t: 'buy', shop: grocery.id, item: 'groceries' })
  assert.match(note(), /Walk up/)
  const before = account().groceries
  place(grocery.x + 1, grocery.z + 1)
  logic.message('s1', { t: 'buy', shop: grocery.id, item: 'groceries' })
  assert.equal(account().groceries, before + 5)
  assert.equal(account().money, 940)
})

test('Maple Threads sells clothes at its door', () => {
  const { logic, account, place } = foxLakeTown(5_000)
  const threads = shop('clothing')
  const item = SHOP_ITEMS.clothing[0]
  place(threads.x + 1, threads.z)
  logic.message('s1', { t: 'buy', shop: threads.id, item: item.id })
  assert.equal(account().wardrobe.includes(item.clothing!), true)
  assert.equal(account().money, 5_000 - item.price)
})

test('the body shop does work only for a car parked at its lot, and charges the quote', () => {
  const { logic, account, place, note } = foxLakeTown(5_000)
  const body = shop('bodyshop')
  const order = { color: '#b3171d', finish: 'gloss' as const }
  place(0, 0)
  logic.message('s1', { t: 'service', kind: STARTER_TRUCK, order })
  assert.match(note(), /Walk up to Montello Body & Wheel/)
  place(body.x + 1, body.z + 1, body.x + 300, body.z)
  logic.message('s1', { t: 'service', kind: STARTER_TRUCK, order })
  assert.match(note(), /Park your/)
  assert.equal(account().money, 5_000)
  place(body.x + 1, body.z + 1, body.x + 6, body.z + 4)
  logic.message('s1', { t: 'service', kind: STARTER_TRUCK, order })
  assert.match(note(), /finished your/)
  assert.equal(account().cars[STARTER_TRUCK]!.color, '#b3171d')
  assert.ok(account().money < 5_000)
})
