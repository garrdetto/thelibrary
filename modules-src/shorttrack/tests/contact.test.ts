import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TRACKS, makeConfig } from '../next/sim/config'
import { createCar } from '../next/sim/car'
import type { SimCar } from '../next/sim/car'
import { contactGripLoss } from '../next/sim/dynamics'
import { rng } from '../next/sim/math'
import { HIT_GRIP_MAX, collidePair, impact, place } from '../next/sim/physics'
import { createWorld } from '../next/sim/race'
import type { VehicleModel, World } from '../next/sim/world'
import { applyHandling, handlingBase, sanitizeHandling, settingsFor } from '../shared/Handling'

/** Car `a` runs into the back of car `b` on the front stretch, closing at `closing` m/s. */
function rearHit(closing: number, model: VehicleModel = 'next', tune: (w: World) => void = () => {}): { w: World; a: SimCar; b: SimCar } {
  const w = createWorld(TRACKS.prison, rng(1), () => 0, model)
  tune(w)
  const a = createCar('a', { local: true, stockCar: true }), b = createCar('b', { local: true, stockCar: true })
  place(w, a, 40, -2)
  place(w, b, 45.2, -2)
  const cn = w.track.center(40)
  a.vx = cn.tx * (25 + closing)
  a.vz = cn.tz * (25 + closing)
  b.vx = cn.tx * 25
  b.vz = cn.tz * 25
  collidePair(w, a, b)
  return { w, a, b }
}

test('a rear hit makes the car that hits push and the car that is hit loose, by how hard it was', () => {
  const soft = rearHit(2), hard = rearHit(6)
  assert.ok(hard.a.hitGripF > hard.a.hitGripR, 'the hitter loses mostly front grip')
  assert.ok(hard.b.hitGripR > hard.b.hitGripF, 'the car hit in the tail loses mostly rear grip')
  assert.ok(hard.b.hitGripR > soft.b.hitGripR && hard.a.hitGripF > soft.a.hitGripF, 'a harder hit costs more grip')
  const wreck = rearHit(20)
  assert.ok(wreck.b.hitGripR <= HIT_GRIP_MAX.rear && wreck.a.hitGripF <= HIT_GRIP_MAX.front, 'grip loss is capped')
  assert.ok(wreck.b.hitHoldT > 0, 'the hit car is held back from spinning for a moment')
})

test('rubbing below the threshold, a zero Contact grip loss setting and the classic model cost no grip', () => {
  assert.equal(rearHit(0.3).b.hitGripT, 0)
  assert.equal(rearHit(6, 'next', (w) => { w.cfg.contactGrip = 0 }).b.hitGripT, 0)
  assert.equal(rearHit(6, 'classic').b.hitGripT, 0)
})

test('the grip comes back: it fades out, and the rear returns as soon as the tail steps out', () => {
  const { b } = rearHit(6)
  const straight = contactGripLoss({ ...b }, 25, 0, 1 / 120)
  assert.ok(straight.r > 0)
  const sliding = contactGripLoss({ ...b }, 25, 25 * Math.tan(0.2), 1 / 120)
  assert.equal(sliding.r, 0)
  const c = { ...b }
  for (let i = 0; i < 240; i++) contactGripLoss(c, 25, 0, 1 / 120)
  assert.equal(c.hitGripT, 0)
  assert.deepEqual(contactGripLoss(c, 25, 0, 1 / 120), { f: 0, r: 0 })
})

test('car-to-car contact costs less speed than the classic model', () => {
  const speed = (c: SimCar) => Math.hypot(c.vx, c.vz)
  const next = rearHit(4), classic = rearHit(4, 'classic')
  assert.ok(speed(next.a) + speed(next.b) > speed(classic.a) + speed(classic.b))
})

test('cars are 50 % stronger: the same impact does two thirds of the damage on the next model only', () => {
  const hitOnce = (model: VehicleModel) => {
    const w = createWorld(TRACKS.prison, rng(1), () => 0, model)
    const c = createCar('c', { local: true, stockCar: true })
    place(w, c, 40, -2)
    impact(w, c, c.x, c.z + 2, 0, -1, 8, 'wall')
    return c.dmg.f + c.dmg.r + c.dmg.l + c.dmg.rt
  }
  const classic = hitOnce('classic'), next = hitOnce('next')
  assert.ok(classic > 0)
  assert.ok(Math.abs(next - classic / 1.5) < 1e-9)
})

test('contact and damage settings show on every track and scale their stock numbers', () => {
  for (const key of ['strength', 'damageLook', 'contactSlow', 'contactGrip']) assert.ok(settingsFor('prison').some((s) => s.key === key) && settingsFor('dirt').some((s) => s.key === key), key)
  assert.deepEqual(sanitizeHandling({ strength: 9, contactGrip: 0 }, 'prison'), { strength: 3, contactGrip: 0 })
  const cfg = makeConfig(TRACKS.prison)
  applyHandling(cfg, handlingBase(cfg), { strength: 2, contactSlow: 0.5, damageLook: 1.5 })
  assert.equal(cfg.strength, 3)
  assert.equal(cfg.contactDrag, 0.2)
  assert.ok(Math.abs(cfg.damageLook - 2.4) < 1e-9)
  assert.equal(cfg.contactGrip, 1)
})
