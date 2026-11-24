import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TRACKS, makeConfig } from '../next/sim/config'
import { createCar } from '../next/sim/car'
import type { SimCar } from '../next/sim/car'
import { contactGripLoss } from '../next/sim/dynamics'
import { rng } from '../next/sim/math'
import { HIT_GRIP_MAX, collidePair, hitRearShare, impact, place } from '../next/sim/physics'
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

test('a rear hit loosens only the car that is hit, by how hard it was; the car that hits keeps all its grip', () => {
  const soft = rearHit(2), hard = rearHit(6)
  assert.equal(hard.a.hitGripF, 0, 'the hitter keeps its front grip')
  assert.equal(hard.a.hitGripR, 0, 'the hitter keeps its rear grip')
  assert.equal(hard.a.hitGripT, 0, 'the hitter is not unsettled at all')
  assert.equal(hard.b.hitGripF, 0, 'the car hit in the tail keeps its front grip')
  assert.ok(hard.b.hitGripR > 0, 'the car hit in the tail gets loose')
  assert.ok(hard.b.hitGripR > soft.b.hitGripR, 'a harder hit costs more grip')
  const wreck = rearHit(20)
  assert.ok(wreck.b.hitGripR <= HIT_GRIP_MAX.rear && wreck.a.hitGripF === 0, 'grip loss is capped')
  assert.ok(wreck.b.hitHoldT > 0, 'the hit car is held back from spinning for a moment')
})

test('where a car is hit decides its grip loss: full on the tail, some on a rear quarter, none from the doors forward', () => {
  assert.equal(hitRearShare(-1), 1)
  assert.equal(hitRearShare(-0.35), 1)
  const quarter = hitRearShare(-0.2)
  assert.ok(quarter > 0 && quarter < 1, 'a rear-quarter hit loosens it a little')
  assert.equal(hitRearShare(0), 0)
  assert.equal(hitRearShare(0.5), 0)
  assert.equal(hitRearShare(1), 0)
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

test('rolling start on the next model: the outside file runs up by the wall, the inside file a car length down and a car length back', async () => {
  const { beginRace, buildGrid, gridLanes, simCarFactory } = await import('../next/sim/race')
  const w = createWorld(TRACKS.prison, rng(3), () => 0, 'next')
  const grid = buildGrid(rng(4), [{ id: 'me', number: '7' }], ['1', '2', '3', '4', '5'], { ai: 5, diff: 'medium' }, null, 20)
  const cars = beginRace(w, grid, { attack: false, laps: 5, mode: 'race', myId: 'me', host: true, make: simCarFactory(() => true) })
  const L = gridLanes(w), T = w.track
  assert.ok(L.outer > T.HW - 3 && L.outer < T.HW - 2, 'outside file near the wall')
  const len = 2 * 2.35 * w.cfg.carScale
  assert.ok(Math.abs(L.outer - L.inner - len) < 1e-9 && Math.abs(L.stagger - len) < 1e-9)
  const [inside, outside] = cars
  assert.ok(Math.abs(outside.tp.lat - L.outer) < 0.05 && Math.abs(inside.tp.lat - L.inner) < 0.05)
  const back = ((outside.tp.s - inside.tp.s) % T.P + T.P) % T.P
  assert.ok(Math.abs(back - len) < 0.3, `inside car ${back.toFixed(2)} m behind`)
  const classic = createWorld(TRACKS.prison, rng(3), () => 0, 'classic')
  assert.deepEqual(gridLanes(classic), { outer: 0.6, inner: -3.6, stagger: 0 })
})
