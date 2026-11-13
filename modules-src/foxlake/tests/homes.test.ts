import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NeighborhoodLogic } from '../../maplestreet/shared/RoomLogic'
import type { ServerMsg } from '../../maplestreet/shared/Protocol'
import { makeLots, drivewayRect } from '../../maplestreet/shared/WorldLayout'
import { HOME_D, HOME_W, applyHomeOp, gridToTown, homeFrame, sanitizeHome, starterHome, townToGrid } from '../../maplestreet/shared/HoodHomes'
import { normalizeBuild } from '../../maplestreet/shared/BuildRules'
import { LotGrid } from '../../hood/shared/Lot'
import { buildRoof } from '../homes/HoodRoof'

test('The Hood\'s grid fits every Fox Lake lot beside the driveway, front to the street, never mirrored', () => {
  for (const lot of makeLots()) {
    const f = homeFrame(lot)
    const corners = [gridToTown(f, 0, 0), gridToTown(f, HOME_W, 0), gridToTown(f, 0, HOME_D), gridToTown(f, HOME_W, HOME_D)]
    for (const c of corners) {
      assert.ok(c.x >= lot.x - 1e-9 && c.x <= lot.x + lot.w + 1e-9 && c.z >= lot.z - 1e-9 && c.z <= lot.z + lot.d + 1e-9, `${lot.id} grid on the lot`)
    }
    const drive = drivewayRect(lot)
    const minX = Math.min(...corners.map((c) => c.x))
    assert.ok(minX >= drive.cx + drive.sx / 2 - 1e-9, `${lot.id} clear of the driveway`)
    const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z
    const front = gridToTown(f, HOME_W / 2, 0), back = gridToTown(f, HOME_W / 2, HOME_D)
    assert.ok(Math.abs(front.z - frontZ) < Math.abs(back.z - frontZ), `${lot.id} front faces the street`)
    assert.equal(f.sx * f.sz, 1, `${lot.id} turned, not mirrored`)
    const g = townToGrid(f, corners[3].x, corners[3].z)
    assert.ok(Math.abs(g.gx - HOME_W) < 1e-9 && Math.abs(g.gz - HOME_D) < 1e-9)
  }
})

test('a home runs The Hood\'s rules: costs, refunds, placement and sanitizing', () => {
  const home = starterHome()
  const walls = home.walls.length
  const room = applyHomeOp(home, { op: 'room', x0: 1, z0: 16, x1: 5, z1: 20, floor: 0 }, 100000)
  assert.ok(room.ok && room.cost > 0)
  assert.ok(home.walls.length > walls)
  assert.equal(applyHomeOp(home, { op: 'room', x0: 1, z0: 16, x1: 5, z1: 20, floor: 0 }, 100000).ok, false, 'already built')
  assert.equal(applyHomeOp(home, { op: 'door', x: 2, z: 16, v: 0 }, 10).ok, false, 'too poor')
  assert.ok(applyHomeOp(home, { op: 'door', x: 2, z: 16, v: 0 }, 100000).ok)
  const sell = applyHomeOp(home, { op: 'sell', id: home.objects[0].id }, 0)
  assert.ok(sell.ok && sell.cost < 0, 'selling refunds')
  assert.equal(applyHomeOp(home, { op: 'feature', kind: 'hottub' as never, x: 1, z: 1, style: 'x', color: 0 }, 1e9).ok, false)
  assert.equal(applyHomeOp(home, { op: 'nuke' } as never, 1e9).ok, false)
  const style = applyHomeOp(home, { op: 'style', patch: { roofStyle: 'gable', upper: 'brick' } }, 1e9)
  assert.ok(style.ok && home.style.roofStyle === 'gable' && home.style.upper === 'brick')
  const clean = sanitizeHome(JSON.parse(JSON.stringify({ ...home, walls: [...home.walls, [999, 0, 0], 'x'], objects: [...home.objects, { id: 900, def: 'no-such', x: 1, z: 1, r: 0 }] })))!
  assert.equal(clean.walls.length, home.walls.length)
  assert.ok(!clean.objects.some((o) => o.def === 'no-such'))
  assert.ok(clean.nextObjectId > Math.max(...clean.objects.map((o) => o.id)))
  const b = normalizeBuild({ walls: {}, floors: {}, objects: {}, roofs: {}, pools: {}, hood: 'junk' as never })
  assert.equal(b.hood, undefined)
})

test('the roof covers every enclosed room, in each style', () => {
  for (const roofStyle of ['hip', 'gable', 'flat'] as const) {
    const home = starterHome()
    home.style.roofStyle = roofStyle
    const roof = buildRoof(new LotGrid(home), home.style)!
    assert.ok(roof && roof.roof.length > 0 && roof.roof.length % 9 === 0, roofStyle)
    assert.ok(roof.fascia.length > 0)
    if (roofStyle === 'gable') assert.ok(roof.gables.length > 0, 'gable ends')
    if (roofStyle === 'flat') assert.ok(roof.top < 0.2)
    else assert.ok(roof.top > 0.5)
  }
  const empty = starterHome()
  empty.walls = []
  assert.equal(buildRoof(new LotGrid(empty), empty.style), null)
})

test('the authority builds only on your own lot, starts it as The Hood\'s starter home, charges and refunds', () => {
  const sent: { to: string; msg: ServerMsg }[] = []
  const all: ServerMsg[] = []
  const logic = new NeighborhoodLogic({ send: (to, msg) => { sent.push({ to, msg }) }, broadcast: (msg) => { all.push(msg) } }, null)
  logic.join('a', { key: 'ka', name: 'Ann', color: '#3a7bd5' })
  logic.join('b', { key: 'kb', name: 'Bo', color: '#d53a3a' })
  const lots = (logic as unknown as { world: { lots: Record<string, { owner: string | null; id: string }>; builds: Record<string, { hood?: unknown; walls: object }> } }).world
  const free = Object.values(lots.lots).find((l) => !l.owner)!
  const accounts = (logic as unknown as { accounts: Record<string, { id: string; money: number }> }).accounts
  const ann = Object.values(accounts).find((a) => (a as { name?: string }).name === 'Ann')!
  logic.message('a', { t: 'build', seq: 1, op: { op: 'buyLot', lotId: free.id } })
  assert.equal(lots.lots[free.id].owner, ann.id)
  const lastHome = () => [...all].reverse().find((m) => m.t === 'home') as Extract<ServerMsg, { t: 'home' }> | undefined
  const rejectedFor = (to: string) => [...sent].reverse().find((s) => s.to === to && s.msg.t === 'homeRejected')?.msg as Extract<ServerMsg, { t: 'homeRejected' }> | undefined
  logic.message('b', { t: 'home', seq: 2, lotId: free.id, op: { op: 'start' } })
  assert.ok(rejectedFor('b'), 'not your lot')
  assert.equal(lots.builds[free.id].hood, undefined)
  logic.message('a', { t: 'home', seq: 3, lotId: free.id, op: { op: 'start' } })
  assert.ok(lastHome()?.home.walls.length, 'starter home')
  assert.deepEqual(lots.builds[free.id].walls, {}, 'the old house is gone')
  const before = ann.money
  logic.message('a', { t: 'home', seq: 4, lotId: free.id, op: { op: 'buy', def: 'sofa', x: 1, z: 20, r: 0 } })
  const placed = lastHome()!.home.objects.find((o) => o.def === 'sofa' && o.z === 20)
  assert.ok(!placed, 'a sofa belongs indoors')
  logic.message('a', { t: 'home', seq: 5, lotId: free.id, op: { op: 'buy', def: 'grill', x: 1, z: 20, r: 0 } })
  const grill = lastHome()!.home.objects.find((o) => o.def === 'grill' && o.z === 20)
  assert.ok(grill, 'the grill goes in the yard')
  assert.ok(ann.money < before, 'paid for it')
  const paid = ann.money
  logic.message('a', { t: 'home', seq: 6, lotId: free.id, op: { op: 'sell', id: grill!.id } })
  assert.ok(ann.money > paid, 'half back')
})
