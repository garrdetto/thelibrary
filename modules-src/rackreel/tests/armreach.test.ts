import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ELBOW_FOLD, HUNTER_ARMS, elbowBend, rotate, rotateX, solveArm } from '../systems/ArmReach'
import type { Vec3 } from '../systems/ArmReach'
import { RIFLE_BUTT, RIFLE_CARRY, RIFLE_FOREEND, RIFLE_GRIP, RIFLE_SHOULDERED, ROD_BUTT, ROD_IN_HAND, WAIT_CRANK, reelKnob } from '../game/Grips'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const palmAt = (side: 'L' | 'R', upper: [number, number, number, number], fore: [number, number, number, number]): Vec3 => {
  const chain = HUNTER_ARMS[side]
  return rotate(upper, add(chain.elbow, rotate(fore, chain.palm)))
}
const reachOf = (side: 'L' | 'R') => len(add(HUNTER_ARMS[side].elbow, HUNTER_ARMS[side].palm))

/** Shoulder pivots of the hunter (avatar frame), from hunter.rrm. */
const SHOULDER: Record<'L' | 'R', Vec3> = { L: [0.217, 1.447, -0.061], R: [-0.213, 1.443, -0.061] }

test('the palm lands on every reachable target, elbow toward the pole', () => {
  for (const side of ['L', 'R'] as const) {
    const max = reachOf(side)
    for (let i = 0; i < 400; i++) {
      const dir: Vec3 = [Math.sin(i * 1.7), Math.cos(i * 0.9), Math.sin(i * 2.3 + 1)]
      const n = len(dir)
      const r = 0.26 + (i % 17) / 17 * (max - 0.28)
      const target: Vec3 = [(dir[0] / n) * r, (dir[1] / n) * r, (dir[2] / n) * r]
      const pole: Vec3 = side === 'L' ? [0.5, -1, -0.3] : [-0.5, -1, -0.3]
      const pose = solveArm(HUNTER_ARMS[side], target, pole)
      assert.ok(pose.miss < 0.002, `${side} missed ${target.map((v) => v.toFixed(2))} by ${pose.miss}`)
      const palm = palmAt(side, pose.upper, pose.fore)
      assert.ok(len(sub(palm, target)) < 0.002)
    }
  }
})

test('an out-of-reach target straightens the arm toward it', () => {
  const pose = solveArm(HUNTER_ARMS.L, [0, 0, 2], [0.5, -1, 0])
  const palm = palmAt('L', pose.upper, pose.fore)
  assert.ok(palm[2] > reachOf('L') * 0.99)
  assert.ok(Math.abs(palm[0]) < 0.01 && Math.abs(palm[1]) < 0.01)
})

test('the elbow only folds forward and never past its limit', () => {
  for (let r = 0; r < 1; r += 0.01) {
    const bend = elbowBend(HUNTER_ARMS.R, r)
    assert.ok(bend <= 0 && bend >= -ELBOW_FOLD)
  }
  const hand = rotateX([0, -1, 0], -1)
  assert.ok(hand[2] > 0, 'a negative bend brings the forearm forward')
})

function inAvatar(position: Vector3, q: Quaternion, local: Vector3): Vec3 {
  const out = new Vector3()
  local.rotateByQuaternionToRef(q, out)
  out.addInPlace(position)
  return [out.x, out.y, out.z]
}

test('both hands reach the rifle on the shoulder and at port arms', () => {
  for (const pitch of [-0.5, 0, 0.4]) {
    const q = Quaternion.FromEulerAngles(pitch, 0, 0)
    const c = Math.cos(pitch)
    const pos = new Vector3(RIFLE_SHOULDERED.x, RIFLE_SHOULDERED.y - Math.sin(pitch) * RIFLE_BUTT, RIFLE_SHOULDERED.z + c * RIFLE_BUTT)
    const yawL = 0.82
    const turn = (p: Vec3): Vec3 => [p[0] * Math.cos(yawL) + p[2] * Math.sin(yawL), p[1], -p[0] * Math.sin(yawL) + p[2] * Math.cos(yawL)]
    const pivot: Vec3 = [0.001, 1.115, -0.038]
    const shoulder = (side: 'L' | 'R') => add(pivot, turn(sub(SHOULDER[side], pivot)))
    const grip = len(sub(inAvatar(pos, q, RIFLE_GRIP), shoulder('L')))
    const fore = len(sub(inAvatar(pos, q, RIFLE_FOREEND), shoulder('R')))
    assert.ok(grip < reachOf('L') * 0.97, `trigger hand ${grip.toFixed(3)} m away at pitch ${pitch}`)
    assert.ok(fore < reachOf('R') * 0.97, `fore-end ${fore.toFixed(3)} m away at pitch ${pitch}`)
  }
  const q = Quaternion.FromEulerAngles(RIFLE_CARRY.pitch, RIFLE_CARRY.yaw, RIFLE_CARRY.roll)
  const grip = len(sub(inAvatar(RIFLE_CARRY.position, q, RIFLE_GRIP), SHOULDER.L))
  const fore = len(sub(inAvatar(RIFLE_CARRY.position, q, RIFLE_FOREEND), SHOULDER.R))
  assert.ok(grip < reachOf('L') * 0.97 && grip > 0.25, `carry grip ${grip}`)
  assert.ok(fore < reachOf('R') * 0.97 && fore > 0.25, `carry fore-end ${fore}`)
})

test('the left hand can reach the rod butt and the reel knob from the right hand', () => {
  const rodRoot = ROD_IN_HAND.position
  const q = Quaternion.FromEulerAngles(ROD_IN_HAND.pitch, 0, 0)
  const span = (local: Vector3) => len(sub(inAvatar(rodRoot, q, local), HUNTER_ARMS.L.palm))
  assert.ok(span(ROD_BUTT) < 0.3, 'the butt is a hand span below the grip')
  for (let a = 0; a < Math.PI * 2; a += 0.3) assert.ok(span(reelKnob(a, new Vector3())) < 0.2)
  assert.ok(span(reelKnob(WAIT_CRANK, new Vector3())) < 0.2)
})
