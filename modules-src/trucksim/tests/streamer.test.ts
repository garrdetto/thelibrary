import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChunkStreamer } from '../systems/Streamer'

function makeStreamer(options: { radius?: number; maxLoaded?: number; budgetMs?: number; loadCostMs?: number } = {}) {
  const clock = { now: 0 }
  const loads: string[] = []
  const unloads: string[] = []
  const streamer = new ChunkStreamer<string>({
    chunkSize: 100,
    radius: options.radius ?? 2,
    maxLoaded: options.maxLoaded ?? 100,
    budgetMs: options.budgetMs ?? 1000,
    clock: () => clock.now,
    load: (cx, cz) => {
      clock.now += options.loadCostMs ?? 0
      loads.push(`${cx},${cz}`)
      return `${cx},${cz}`
    },
    unload: (item) => { unloads.push(item) },
  })
  return { streamer, clock, loads, unloads }
}

test('loads the nearest chunks first', () => {
  const { streamer, loads } = makeStreamer({ radius: 2 })
  streamer.update(50, 50, 0)
  assert.equal(loads[0], '0,0')
  const distances = loads.map((key) => {
    const [cx, cz] = key.split(',').map(Number)
    return Math.hypot(cx, cz)
  })
  for (let i = 1; i < distances.length; i++) assert.ok(distances[i] >= distances[i - 1])
  assert.ok(loads.every((key) => {
    const [cx, cz] = key.split(',').map(Number)
    return Math.hypot(cx, cz) <= 2
  }))
})

test('maxLoaded is never exceeded', () => {
  const { streamer } = makeStreamer({ radius: 4, maxLoaded: 7 })
  for (let step = 0; step < 20; step++) {
    streamer.update(step * 60, 0, step)
    assert.ok(streamer.loaded <= 7)
  }
  assert.equal(streamer.loaded, 7)
})

test('chunks beyond radius + 1 are unloaded', () => {
  const { streamer, unloads } = makeStreamer({ radius: 1 })
  streamer.update(50, 50, 0)
  assert.ok(streamer.loaded > 0)
  streamer.update(50 + 100 * 10, 50, 1)
  assert.ok(unloads.includes('0,0'))
  let farthest = 0
  streamer.forEach((_item, cx, cz) => { farthest = Math.max(farthest, Math.hypot(cx - 10, cz)) })
  assert.ok(farthest <= 2)
})

test('clear unloads everything', () => {
  const { streamer, unloads } = makeStreamer({ radius: 2 })
  streamer.update(0, 0, 0)
  const count = streamer.loaded
  assert.ok(count > 0)
  streamer.clear()
  assert.equal(streamer.loaded, 0)
  assert.equal(unloads.length, count)
})

test('the time budget limits loads per update but always makes progress', () => {
  const { streamer, loads, clock } = makeStreamer({ radius: 3, budgetMs: 2, loadCostMs: 1 })
  streamer.update(0, 0, clock.now)
  assert.ok(loads.length >= 1 && loads.length <= 3)
  const before = loads.length
  streamer.update(0, 0, clock.now)
  assert.ok(loads.length > before)
  for (let i = 0; i < 100; i++) streamer.update(0, 0, clock.now)
  assert.ok(streamer.loaded > 10)
})

test('setRadius shrinks the loaded set on the next update', () => {
  const { streamer } = makeStreamer({ radius: 3 })
  streamer.update(0, 0, 0)
  const wide = streamer.loaded
  streamer.setRadius(1)
  streamer.update(0, 0, 1)
  assert.ok(streamer.loaded < wide)
})
