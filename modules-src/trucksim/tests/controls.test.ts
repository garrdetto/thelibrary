import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEY_YAW_RATE, stepKeyLook } from '../game/Cameras'
import type { LookState } from '../game/Cameras'
import { MAP_PIXELS, fullMapToWorld } from '../game/MapDraw'
import { BINDINGS } from '../systems/Keys'
import { applyAction, starterDriveway, withStarterDriveway } from '../shared/Actions'
import { defaultProfile } from '../shared/Economy'
import { STARTER_DRIVEWAY_ID, itemFootprint, validateItem } from '../shared/Lots'
import { COUNTY } from '../shared/RoadGraph'
import { LOTS, WORLD_HALF, lotSpawn } from '../shared/WorldLayout'
import { TRUCKS } from '../shared/Catalog'
import { Progress } from '../net/Progress'
import { FADED, SeeThrough } from '../render/SeeThrough'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'

test('arrow keys only look around, Escape opens the map and P pauses', () => {
  const codes = (action: string) => BINDINGS.find((binding) => binding.action === action)?.codes ?? []
  for (const action of ['throttle', 'brake', 'steerLeft', 'steerRight']) {
    assert.ok(!codes(action).some((code) => code.startsWith('Arrow')), `${action} has no arrow key`)
  }
  assert.deepEqual(codes('lookLeft'), ['ArrowLeft'])
  assert.deepEqual(codes('lookRight'), ['ArrowRight'])
  assert.ok(codes('map').includes('Escape'))
  assert.deepEqual(codes('pause'), ['KeyP'])
  const all = BINDINGS.flatMap((binding) => binding.codes)
  assert.equal(new Set(all).size, all.length, 'no key does two things')
})

test('holding an arrow turns the view and letting go swings it straight back', () => {
  const state: LookState = { yawOffset: 0, pitch: 0.32, returning: false }
  for (let i = 0; i < 30; i++) assert.equal(stepKeyLook(state, { yaw: 1, pitch: 0 }, 1 / 60, 0.32, 0.05), true)
  assert.ok(Math.abs(state.yawOffset - KEY_YAW_RATE * 0.5) < 1e-9, `turned ${state.yawOffset}`)
  for (let i = 0; i < 30; i++) stepKeyLook(state, { yaw: 0, pitch: 1 }, 1 / 60, 0.32, 0.05)
  assert.ok(state.pitch > 0.32)
  let frames = 0
  while (stepKeyLook(state, { yaw: 0, pitch: 0 }, 1 / 60, 0.32, 0.05)) {
    frames++
    assert.ok(frames < 120, 'back within two seconds')
  }
  assert.equal(state.yawOffset, 0)
  assert.equal(state.pitch, 0.32)
  assert.equal(state.returning, false)
  assert.equal(stepKeyLook(state, { yaw: 0, pitch: 0 }, 1 / 60, 0.32, 0.05), false, 'idle keys leave the view to the mouse')
  for (let i = 0; i < 400; i++) stepKeyLook(state, { yaw: -1, pitch: -1 }, 1 / 60, 0.32, 0.05)
  assert.ok(Math.abs(state.yawOffset) <= Math.PI + 1e-9)
  assert.equal(state.pitch, 0.05)
})

test('a click on the full map lands on the world point drawn there', () => {
  const width = 900
  const height = 600
  const fit = height / MAP_PIXELS
  const left = (width - MAP_PIXELS * fit) / 2
  const centre = fullMapToWorld(width / 2, height / 2, width, height)!
  assert.ok(Math.abs(centre.x) < 1e-6 && Math.abs(centre.z) < 1e-6)
  const corner = fullMapToWorld(left, 0, width, height)!
  assert.ok(Math.abs(corner.x - WORLD_HALF) < 1e-6 && Math.abs(corner.z - WORLD_HALF) < 1e-6, 'top-left is +x, +z')
  assert.equal(fullMapToWorld(left - 5, 10, width, height), null)
})

test('a new driver starts with a free gravel driveway at the gate, under the spawn point', () => {
  for (const lot of LOTS) {
    const driveway = starterDriveway(lot.index)!
    assert.equal(driveway.id, STARTER_DRIVEWAY_ID)
    assert.equal(validateItem(driveway, [], { w: lot.w, d: lot.d }), null, `lot ${lot.index}`)
    const f = itemFootprint(driveway)
    const spawn = lotSpawn(lot)
    assert.ok(spawn.x >= lot.x + f.x && spawn.x <= lot.x + f.x + f.w && spawn.z >= lot.z + f.z && spawn.z <= lot.z + f.z + f.d, `lot ${lot.index} spawn on the gravel`)
  }
  const fresh = withStarterDriveway({ ...defaultProfile(), lot: 3 })
  assert.deepEqual(fresh.build.map((item) => item.id), [STARTER_DRIVEWAY_ID])
  assert.equal(withStarterDriveway(fresh), fresh, 'only once')
  const driven = { ...defaultProfile(), lot: 3, stats: { jobs: 0, earned: 0, km: 12, tonnes: 0 } }
  assert.equal(withStarterDriveway(driven), driven, 'existing drivers keep their lot as it is')
  const noLot = { ...defaultProfile() }
  assert.equal(withStarterDriveway(noLot), noLot)
  const demolished = applyAction({ ...fresh, cash: 100 }, { action: 'demolish', ids: [STARTER_DRIVEWAY_ID] }, { now: 0, world: COUNTY })
  assert.equal(demolished.ok, true)
  assert.equal(demolished.delta, 0, 'the free driveway refunds nothing')
})

test('the sandbox is for administrators only and never posts to the server', async () => {
  const posts: string[] = []
  const realFetch = globalThis.fetch
  const reply = (admin: boolean) => async (_url: unknown, init?: { method?: string }) => {
    if (init?.method === 'POST') posts.push('post')
    return new Response(JSON.stringify({ signedIn: true, username: 'tester', admin, profile: { ...defaultProfile(), lot: 2 }, lots: [] }), { status: 200 })
  }
  try {
    globalThis.fetch = reply(false) as typeof fetch
    const driver = await Progress.load(COUNTY)
    assert.equal(driver.admin, false)
    assert.equal(driver.enterSandbox(), false)
    globalThis.fetch = reply(true) as typeof fetch
    const admin = await Progress.load(COUNTY)
    assert.equal(admin.admin, true)
    assert.equal(admin.enterSandbox(), true)
    assert.equal(admin.sandboxed, true)
    assert.equal(admin.profile.cash, 5_000_000)
    const bought = await admin.act({ action: 'buy-truck', model: TRUCKS[TRUCKS.length - 1].id })
    assert.equal(bought.ok, true)
    admin.sandboxEdit((p) => { p.trucks[0].dirt = 100 })
    assert.equal(admin.profile.trucks[0].dirt, 100)
    assert.deepEqual(posts, [], 'nothing reached the server')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('overheads fade while the truck is under them and come back after', () => {
  const see = new SeeThrough()
  const mesh = { visibility: 1, isDisposed: () => false } as unknown as AbstractMesh
  const remove = see.add({ x0: 0, z0: 0, x1: 10, z1: 10 }, [mesh])
  for (let i = 0; i < 60; i++) see.update([{ x: 5, z: 5 }], 1 / 60)
  assert.equal(mesh.visibility, FADED)
  for (let i = 0; i < 60; i++) see.update([{ x: 40, z: 40 }], 1 / 60)
  assert.equal(mesh.visibility, 1)
  remove()
  assert.equal(see.size, 0)
})
