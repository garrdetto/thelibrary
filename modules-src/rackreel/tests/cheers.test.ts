import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BLURTS, CHEERS, blurtAt, cheerPose, cheerWeight, chooseCheer } from '../systems/Cheers'
import type { CheerId } from '../systems/Cheers'

test('the right cheer for every moment', () => {
  assert.equal(chooseCheer({ kind: 'hit' }), 'stoned')
  assert.equal(chooseCheer({ kind: 'miss' }), 'miss')
  assert.equal(chooseCheer({ kind: 'tearOff' }), 'tearOff')
  assert.equal(chooseCheer({ kind: 'tubbed', lengthIn: 18, record: false, streak: 1 }), 'tubbed')
  assert.equal(chooseCheer({ kind: 'tubbed', lengthIn: 23.9, record: false, streak: 2 }), 'tubbed')
  assert.equal(chooseCheer({ kind: 'tubbed', lengthIn: 24, record: false, streak: 1 }), 'crazy')
  assert.equal(chooseCheer({ kind: 'tubbed', lengthIn: 28.5, record: false, streak: 1 }), 'meltdown')
  assert.equal(chooseCheer({ kind: 'tubbed', lengthIn: 19, record: true, streak: 1 }), 'meltdown')
  assert.equal(chooseCheer({ kind: 'tubbed', lengthIn: 19, record: false, streak: 3 }), 'hype')
  assert.equal(chooseCheer({ kind: 'tubbed', lengthIn: 26, record: false, streak: 3 }), 'crazy', 'a big fish beats the streak')
  assert.equal(chooseCheer({ kind: 'tubbed', lengthIn: 15, record: false, streak: 3, total: 5 }), 'stacking', 'five in the tub: stacking \'em up')
  assert.equal(chooseCheer({ kind: 'tubbed', lengthIn: 25, record: false, streak: 1, total: 5 }), 'crazy', 'a tank still beats the stack')
  assert.equal(CHEERS.crazy.line.startsWith('Absolute tank.'), true)
  for (const { line } of Object.values(CHEERS)) assert.ok(!/\bOpe\b/.test(line), 'no "Ope"')
  for (const line of BLURTS) assert.ok(!/\bOpe\b/.test(line), 'no "Ope"')
  assert.ok(BLURTS.includes('Put the ole sneaky on \'em.'))
  const seen = new Set<string>()
  for (let n = 0; n < BLURTS.length; n++) seen.add(blurtAt(n))
  assert.equal(seen.size, BLURTS.length, 'every blurt comes up once before any repeats')
})

test('cheers last as long as the script says and blend in and out', () => {
  const lengths: Record<CheerId, number> = { stoned: 1.2, tubbed: 1, crazy: 3.5, meltdown: 5, hype: 2, stacking: 2, miss: 1, tearOff: 1.2, sendIt: 2.6, beached: 3.4 }
  for (const [id, d] of Object.entries(lengths) as [CheerId, number][]) {
    assert.equal(CHEERS[id].duration, d)
    assert.equal(cheerWeight(id, 0), 0)
    assert.equal(cheerWeight(id, d / 2), 1)
    assert.equal(cheerWeight(id, d), 0)
    for (let t = 0; t <= d; t += 0.05) {
      const pose = cheerPose(id, t)
      for (const v of Object.values(pose.joints)) for (const a of v!) assert.ok(Number.isFinite(a))
    }
  }
  assert.ok(cheerPose('crazy', 1).onSeat > 0.9, 'up on the seat box')
  assert.ok(Math.abs(cheerPose('meltdown', 1.15).spin - Math.PI * 2) < 1e-6, 'spins all the way round')
  assert.equal(cheerPose('miss', 0.3).stand, 0, 'a miss is taken sitting down')
})
