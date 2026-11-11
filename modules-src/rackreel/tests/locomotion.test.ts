import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addClip, createGaitMix, createPose, finishPose, gaitMix, gaitSet, resetPose, stepPhase } from '../systems/Locomotion'
import type { Clip } from '../systems/Locomotion'

const JOINTS = 3

/** A clip whose joints turn about y by `turn(frame)` radians, with the hips at `height(frame)`. */
function clip(name: string, frames: number, seconds: number, speed: number, turn: (f: number) => number, height: (f: number) => number): Clip {
  const rot = new Int16Array(frames * JOINTS * 4)
  const hips = new Float32Array(frames * 3)
  for (let f = 0; f < frames; f++) {
    const a = turn(f) / 2
    for (let j = 0; j < JOINTS; j++) {
      rot[(f * JOINTS + j) * 4 + 1] = Math.round(Math.sin(a) * 32767)
      rot[(f * JOINTS + j) * 4 + 3] = Math.round(Math.cos(a) * 32767)
    }
    hips[f * 3 + 1] = height(f)
  }
  return { name, seconds, frames, loop: true, speed, hips, rot }
}

const angleOf = (pose: { rot: Float32Array }, joint: number) => 2 * Math.atan2(pose.rot[joint * 4 + 1], pose.rot[joint * 4 + 3])

const clips = new Map<string, Clip>([
  ['walk', clip('walk', 30, 1, 1.4, (f) => Math.sin((f / 30) * Math.PI * 2) * 0.4, () => 0.95)],
  ['run', clip('run', 20, 0.64, 4.5, (f) => Math.sin((f / 20) * Math.PI * 2) * 0.9, () => 0.9)],
  ['crouchWalk', clip('crouchWalk', 34, 1.13, 1.1, () => 0.2, () => 0.78)],
  ['walkBack', clip('walkBack', 26, 0.87, -1.2, () => -0.2, () => 0.93)],
  ['idle', clip('idle', 56, 1.9, 0, () => 0, () => 0.94)],
])
const set = gaitSet(clips)

test('a clip is sampled between frames and wraps round its loop', () => {
  const walk = clips.get('walk')!
  const pose = createPose(JOINTS)
  addClip(pose, walk, 0.25, 1)
  assert.ok(finishPose(pose))
  assert.ok(Math.abs(angleOf(pose, 1) - 0.4) < 0.01, `quarter cycle ${angleOf(pose, 1)}`)
  resetPose(pose)
  addClip(pose, walk, 1.25, 1)
  finishPose(pose)
  assert.ok(Math.abs(angleOf(pose, 2) - 0.4) < 0.01, 'a phase past 1 wraps')
  resetPose(pose)
  addClip(pose, walk, 29.5 / 30, 1)
  finishPose(pose)
  const last = Math.sin((29 / 30) * Math.PI * 2) * 0.4
  assert.ok(Math.abs(angleOf(pose, 0) - last / 2) < 0.01, 'the last frame blends back into the first')
  for (let j = 0; j < JOINTS; j++) {
    const k = j * 4
    assert.ok(Math.abs(Math.hypot(pose.rot[k], pose.rot[k + 1], pose.rot[k + 2], pose.rot[k + 3]) - 1) < 1e-6)
  }
})

test('mixing clips weights their turns and their hip heights', () => {
  const pose = createPose(JOINTS)
  addClip(pose, clips.get('idle')!, 0, 0.5)
  addClip(pose, clips.get('crouchWalk')!, 0, 0.5)
  assert.ok(finishPose(pose))
  assert.ok(Math.abs(angleOf(pose, 0) - 0.1) < 0.01)
  assert.ok(Math.abs(pose.hips[1] - 0.86) < 1e-4)
  resetPose(pose)
  assert.equal(finishPose(pose), false)
})

test('the mix always adds up to one and follows the speed', () => {
  const mix = createGaitMix()
  for (const speed of [0, 0.3, 0.9, 1.4, 2.5, 4.5, 5.2]) {
    for (const crouch of [0, 0.4, 1]) {
      for (const back of [0, 1]) {
        gaitMix(speed, crouch, back, set, mix)
        assert.ok(Math.abs(mix.idle + mix.walk + mix.run + mix.crouchWalk + mix.walkBack - 1) < 1e-9, `sum at ${speed}/${crouch}/${back}`)
      }
    }
  }
  assert.equal(gaitMix(0, 0, 0, set, mix).idle, 1)
  assert.equal(gaitMix(0, 0, 0, set, mix).cadence, 0)
  assert.ok(gaitMix(1.4, 0, 0, set, mix).walk > 0.99, 'a walk at walking speed')
  assert.ok(gaitMix(5.2, 0, 0, set, mix).run > 0.99, 'a run at a sprint')
  const jog = gaitMix(2.5, 0, 0, set, mix)
  assert.ok(jog.walk > 0.2 && jog.run > 0.1, `a jog mixes both: ${jog.walk} / ${jog.run}`)
  assert.equal(gaitMix(2.5, 1, 0, set, mix).crouchWalk, 1)
  assert.ok(gaitMix(1.2, 0, 1, set, mix).walkBack > 0.9)
})

test('the stride covers the ground walked, so a planted foot does not slide', () => {
  const mix = createGaitMix()
  const walk = gaitMix(set.walk.speed, 0, 0, set, mix)
  assert.ok(Math.abs(walk.cadence - 1 / clips.get('walk')!.seconds) < 0.01, 'walking pace plays the clip at its own tempo')
  const run = gaitMix(set.run.speed, 0, 0, set, mix)
  assert.ok(Math.abs(run.cadence - 1 / clips.get('run')!.seconds) < 0.02, 'running pace plays the run at its own tempo')
  const slow = gaitMix(0.7, 0, 0, set, mix)
  assert.ok(slow.cadence > 0.5 && slow.cadence < 1, `slow steps shorten instead of dragging: ${slow.cadence}`)
})

test('the phase runs with the cadence and settles on a planted stance when stopped', () => {
  const mix = createGaitMix()
  gaitMix(set.walk.speed, 0, 0, set, mix)
  let phase = 0
  for (let i = 0; i < 30; i++) phase = stepPhase(phase, mix, 1 / 60)
  assert.ok(Math.abs(phase - 0.5) < 0.02, `half a second of walking is half a cycle: ${phase}`)
  gaitMix(0, 1, 0, set, mix)
  phase = 0.62
  for (let i = 0; i < 120; i++) phase = stepPhase(phase, mix, 1 / 60)
  assert.ok(Math.abs(phase - 0.5) < 0.01, 'stopped mid-step, the feet come to rest')
  phase = 0.9
  for (let i = 0; i < 120; i++) phase = stepPhase(phase, mix, 1 / 60)
  assert.ok(phase < 0.01 || phase > 0.99)
})
