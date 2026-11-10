import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEG_LENGTH, legPose, walkGait } from '../systems/Gait'

test('strides lengthen with speed and stay long at a walk', () => {
  const walk = walkGait(2.5)
  const run = walkGait(5.2)
  assert.ok(walk.stride >= 2, `walk stride ${walk.stride}`)
  assert.ok(run.stride > walk.stride)
  assert.ok(walkGait(1.7).stride / 2 >= 0.85, 'a deck walk still takes steps of most of a metre')
  assert.equal(walkGait(0).amp, 0)
})

test('the knee folds through the swing and is nearly straight at heel strike', () => {
  const g = walkGait(2.5)
  let peak = 0
  let peakAt = 0
  for (let i = 0; i < 360; i++) {
    const phase = -Math.PI + (i / 360) * Math.PI * 2
    const k = legPose(phase, g).knee
    if (k > peak) {
      peak = k
      peakAt = phase
    }
  }
  assert.ok(peak > 1, `swing knee bend ${peak}`)
  assert.ok(peakAt > -Math.PI / 2 && peakAt < Math.PI / 2, 'peak bend happens while the leg swings forward')
  assert.ok(legPose(Math.PI / 2, g).knee < 0.15, 'leg reaches out straight to plant the heel')
  assert.ok(legPose(Math.PI, g).knee > 0.15, 'knee gives a little under the weight')
})

test('the thigh swing covers the step and the hips drop to keep both feet down', () => {
  const g = walkGait(2.5)
  const front = legPose(Math.PI / 2, g).thigh
  const back = legPose(-Math.PI / 2, g).thigh
  assert.ok(front < -0.45 && back > 0.3 && back - front > 0.9, `thigh ${front} / ${back}`)
  assert.ok(g.drop > 0.03 && g.drop < LEG_LENGTH * 0.15)
})
