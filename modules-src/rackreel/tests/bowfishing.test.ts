import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ArrowShot, BOW, CARP, CarpFight, CarpSchool, arrowSpeed, holdShake } from '../systems/BowfishingMotion'
import type { Carp, Water } from '../systems/BowfishingMotion'
import { LootTableManager, mulberry32 } from '../systems/LootTableManager'
import { Terrain } from '../world/Terrain'

const flat = (depth: number): Water => ({ depthAt: () => depth, heightAt: () => -depth })

test('a full-draw arrow flies about 200 fps and dies within 1.2–4 m of water', () => {
  assert.ok(Math.abs(arrowSpeed(1) * 3.281 - 203) < 3)
  assert.equal(arrowSpeed(0.25), BOW.speed * 0.625)
  const shot = new ArrowShot({ x: 0, y: 2.2, z: 0 }, { x: 0, y: -0.3, z: 1 }, arrowSpeed(1), flat(30))
  let entered = false
  let diedAt = -1
  for (let i = 0; i < 400 && diedAt < 0; i++) {
    const e = shot.step(1 / 60, { x: 0, y: 1.6, z: 0 })
    if (e.entered) entered = true
    if (e.died) diedAt = shot.waterRun
  }
  assert.ok(entered)
  assert.ok(diedAt >= 1.2 && diedAt <= 4, `died after ${diedAt} m of water`)
})

test('an arrow sticks in the bottom', () => {
  const shot = new ArrowShot({ x: 0, y: 2.2, z: 0 }, { x: 0, y: -1, z: 1.2 }, arrowSpeed(1), flat(0.5))
  let stuck = false
  for (let i = 0; i < 120 && !stuck; i++) stuck = !!shot.step(1 / 60, { x: 0, y: 1.6, z: 0 }).stuck
  assert.ok(stuck)
  assert.equal(shot.state, 'stuck')
  assert.ok(Math.abs(shot.pos.y + 0.5) < 0.05)
})

test('an arrow stops dead at the end of 26 m of line, and an empty arrow reels back', () => {
  const reel = { x: 0, y: 1.6, z: 0 }
  const shot = new ArrowShot({ x: 0, y: 1.8, z: 0 }, { x: 0, y: 0.25, z: 1 }, arrowSpeed(1), flat(40))
  let ended = false
  for (let i = 0; i < 240; i++) {
    const e = shot.step(1 / 60, reel)
    if (e.lineEnd) ended = true
    const out = Math.hypot(shot.pos.x - reel.x, shot.pos.y - reel.y, shot.pos.z - reel.z)
    assert.ok(out <= BOW.line + 1e-6, `line out ${out}`)
  }
  assert.ok(ended)
  let home = false
  let t = 0
  for (; t < 20 && !home; t += 1 / 30) home = shot.reelIn(1 / 30, reel)
  assert.ok(home)
  assert.ok(t > (BOW.line - 2) / BOW.emptyReel - 1 && t < BOW.line / BOW.emptyReel + 1, `reeled in ${t} s`)
})

test('holding at full draw past 3.5 s starts to shake', () => {
  assert.equal(holdShake(3), 0)
  assert.ok(Math.abs(holdShake(5.5) - 0.024) < 1e-9)
})

function fish(x: number, y: number, z: number, length = 0.6): Carp {
  return { id: 1, x, y, z, heading: Math.PI / 2, pitch: 0, speed: 0, mode: 'cruise', timer: 5, wander: 0, lengthM: length, weightLb: 8, tail: 0, hooked: false, data: null }
}

test('a shot through the shoulder hits; one over the back misses', () => {
  const school = new CarpSchool<null>(flat(1), mulberry32(3), () => ({ weightLb: 8, lengthM: 0.6, data: null }))
  school.carp.push(fish(0, -0.6, 4))
  const shoulder = school.hit({ x: 0.15, y: 0.2, z: 3 }, { x: 0.15, y: -1, z: 4.6 })
  assert.ok(shoulder, 'shoulder shot connects')
  const over = school.hit({ x: 0, y: 0.2, z: 3 }, { x: 0, y: -0.6, z: 5 })
  assert.equal(over, null)
  const coach = school.nearMiss({ x: 0, y: 0.2, z: 3 }, { x: 0, y: -0.6, z: 5 })
  assert.ok(coach && coach.over, 'Wild Man calls it over the back')
  const under = school.nearMiss({ x: 0, y: -0.85, z: 3 }, { x: 0, y: -1.1, z: 5 })
  assert.ok(under && !under.over, 'and under the belly')
})

test('carp stay in their water band and bolt from a splash', () => {
  const terrain = new Terrain()
  const rand = mulberry32(11)
  const school = new CarpSchool<null>(terrain, rand, () => ({ weightLb: 10, lengthM: 0.7, data: null }))
  const boat = { x: -150, z: 120, heading: 0, length: 5.6 }
  for (let r = 0; r < 120; r += 2) {
    if (terrain.depthAt(boat.x + r, boat.z) > 1.1) {
      boat.x += r
      break
    }
  }
  for (let i = 0; i < 30 * 40; i++) {
    school.update(1 / 30, boat, true)
    for (const c of school.carp) {
      const d = terrain.depthAt(c.x, c.z)
      assert.ok(d > CARP.minDepth - 0.25 && d < CARP.maxDepth + 0.4, `carp in ${d} m`)
      assert.ok(c.y < 0 && -c.y < d + 0.01, 'below the surface and above the bottom')
    }
  }
  assert.ok(school.carp.length >= 8, `school of ${school.carp.length}`)
  const c = school.carp.find((f) => f.mode !== 'flee')!
  const before = Math.hypot(c.x - boat.x, c.z - boat.z)
  void before
  const sx = c.x - Math.sin(c.heading) * 0.8
  const sz = c.z - Math.cos(c.heading) * 0.8
  assert.ok(school.spook(sx, sz, CARP.splashSpook) >= 1)
  assert.equal(c.mode, 'flee')
  assert.ok(c.speed >= CARP.fleeMin && c.speed <= CARP.fleeMax)
  const d0 = Math.hypot(c.x - sx, c.z - sz)
  for (let i = 0; i < 15; i++) school.update(1 / 30, boat, false)
  assert.ok(Math.hypot(c.x - sx, c.z - sz) > d0 + 0.5, 'it swims away from the splash')
})

test('smart reeling lands a 6 lb carp; reeling through every run tears out a 30-inch, 15 lb carp', () => {
  const small = new CarpFight(6, 0.8, 14, 0, mulberry32(5))
  let t = 0
  while (small.outcome === 'fighting' && t < 120) {
    small.update(1 / 30, !small.running)
    t += 1 / 30
  }
  assert.equal(small.outcome, 'landed', `after ${t} s`)
  const big = new CarpFight(15, 0.8, 14, 0, mulberry32(5))
  t = 0
  while (big.outcome === 'fighting' && t < 120) {
    big.update(1 / 30, true)
    t += 1 / 30
  }
  assert.equal(big.outcome, 'torn')
  const patient = new CarpFight(15, 0.8, 14, 0, mulberry32(5))
  t = 0
  while (patient.outcome === 'fighting' && t < 240) {
    patient.update(1 / 30, !patient.running)
    t += 1 / 30
  }
  assert.equal(patient.outcome, 'landed', 'easing off through runs lands even a big one')
})

test('carp run 10 to 30 inches and the long ones are rare', () => {
  const loot = new LootTableManager(mulberry32(21))
  let long = 0
  let short = 0
  for (let i = 0; i < 4000; i++) {
    const s = loot.createSpecimen('carp')
    assert.ok(s.lengthIn >= 10 && s.lengthIn <= 30, `length ${s.lengthIn}`)
    assert.equal(s.value, s.lengthIn)
    assert.ok(Math.abs(s.weightLb - s.lengthIn ** 3 / 1800) < s.lengthIn ** 3 / 1800 * 0.1 + 0.11, `weight ${s.weightLb} at ${s.lengthIn} in`)
    if (s.lengthIn >= 26) long++
    if (s.lengthIn < 16) short++
  }
  assert.ok(long < 4000 * 0.12, `${long} long carp`)
  assert.ok(short > long * 2.5, `${short} short vs ${long} long`)
  assert.equal(loot.pickSpecies('fish', 'marsh').id === 'carp', false)
})
