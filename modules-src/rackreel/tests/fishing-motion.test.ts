import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOBBER_HEIGHT, BOBBER_MAX_SCALE, BOBBER_MIN_SCREEN, bobberScale, crankSpeed, jumpPose, landingLift, planNibble, plungeDepth, rodBend, shouldJump, twitchDip } from '../systems/FishingMotion'
import { mulberry32 } from '../systems/LootTableManager'
import { SkillCheckManager } from '../systems/SkillCheckManager'

test('the bobber is true size up close and never shrinks below its minimum screen size far out', () => {
  const fov = 0.9
  assert.equal(bobberScale(2, fov), 1)
  for (const d of [15, 25, 40]) {
    const screen = (BOBBER_HEIGHT * bobberScale(d, fov)) / (2 * Math.tan(fov / 2) * d)
    assert.ok(screen >= BOBBER_MIN_SCREEN - 1e-9, `at ${d} m the bobber covers ${screen} of the screen`)
  }
  assert.equal(bobberScale(5000, fov), BOBBER_MAX_SCALE)
  assert.ok(bobberScale(40, fov) > bobberScale(20, fov))
})

test('a nibble is two to four twitches that finish before the take', () => {
  const rand = mulberry32(11)
  for (let i = 0; i < 200; i++) {
    const plan = planNibble(rand)
    assert.ok(plan.twitches.length >= 2 && plan.twitches.length <= 4)
    for (let k = 1; k < plan.twitches.length; k++) assert.ok(plan.twitches[k] - plan.twitches[k - 1] >= 0.26)
    assert.ok(plan.duration > plan.twitches[plan.twitches.length - 1])
    assert.ok(plan.duration < 2.5)
  }
})

test('a twitch dips and recovers, and the bite pulls the float under', () => {
  assert.equal(twitchDip(-0.1), 0)
  assert.equal(twitchDip(0.06), 1)
  assert.equal(twitchDip(0.5), 0)
  assert.equal(plungeDepth(0), 0)
  assert.ok(plungeDepth(0.2) < -0.1, 'the float is under the surface once the fish takes it')
  assert.ok(plungeDepth(1.5) < -0.1)
})

test('a jump leaves and re-enters the water along a parabola', () => {
  const start = jumpPose(0, 0.8, 0.6)
  const mid = jumpPose(0.4, 0.8, 0.6)
  const end = jumpPose(0.8, 0.8, 0.6)
  assert.equal(start.height, 0)
  assert.ok(Math.abs(mid.height - 0.6) < 1e-9)
  assert.equal(end.height, 0)
  assert.equal(end.t, 1)
  assert.ok(start.pitch > 0 && end.pitch < 0, 'nose up on the way out, nose down on the way in')
})

test('jumps come on the rising edge of a hard run, mid-fight, after the cooldown', () => {
  assert.ok(shouldJump(30, 0, 50, 0, 1))
  assert.ok(!shouldJump(30, 30, 50, 0, 1), 'only once per run')
  assert.ok(!shouldJump(30, 0, 50, 1, 1), 'not during the cooldown')
  assert.ok(!shouldJump(30, 0, 5, 0, 1), 'not right after the hookset')
  assert.ok(!shouldJump(30, 0, 96, 0, 1), 'not at the boat')
  assert.ok(!shouldJump(5, 0, 50, 0, 1), 'not on a small tug')
})

test('real fights produce jumps for strong fish', () => {
  const skill = new SkillCheckManager(mulberry32(3))
  skill.beginReel(1.0)
  let last = 0
  let jumps = 0
  let cooldown = 0
  for (let i = 0; i < 1800; i++) {
    skill.setHolding(i % 50 < 30)
    const snap = skill.updateReel(1 / 60)
    cooldown -= 1 / 60
    if (shouldJump(snap.surge, last, snap.progress, cooldown, 1.0)) {
      jumps++
      cooldown = 3
    }
    last = snap.surge
    if (snap.outcome !== 'fighting') break
  }
  assert.ok(jumps >= 1, 'a muskie-class fight shows at least one jump')
})

test('the rod loads up with tension and the reel only turns while reeling or giving drag', () => {
  assert.ok(rodBend('reeling', 95, 0, 0) > rodBend('reeling', 20, 0, 0))
  assert.ok(rodBend('bite', 0, 0, 0) > rodBend('waiting', 0, 0, 0))
  assert.equal(rodBend('idle', 0, 0, 0), 0)
  for (const state of ['waiting', 'reeling', 'landing', 'bite']) {
    const b = rodBend(state, 100, 100, 1.3)
    assert.ok(b >= 0 && b <= 1, `${state} bend ${b}`)
  }
  assert.ok(crankSpeed('reeling', true, 50, 0) > 0)
  assert.equal(crankSpeed('reeling', false, 50, 0), 0)
  assert.ok(crankSpeed('reeling', false, 50, 30) < 0, 'a run peels line off the drag')
  assert.equal(crankSpeed('waiting', true, 0, 0), 0)
  assert.ok(crankSpeed('retrieving', false, 0, 0) > 0)
})

test('the landing lift eases from the water to the rod tip', () => {
  assert.equal(landingLift(0), 0)
  assert.equal(landingLift(1), 1)
  assert.ok(Math.abs(landingLift(0.5) - 0.5) < 1e-9)
  let prev = 0
  for (let t = 0.05; t <= 1; t += 0.05) {
    const v = landingLift(t)
    assert.ok(v >= prev)
    prev = v
  }
})
