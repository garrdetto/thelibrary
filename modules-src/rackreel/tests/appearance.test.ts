import assert from 'node:assert/strict'
import { test } from 'node:test'
import { APPEARANCE_VERSION, BEARDS, DEFAULT_APPEARANCE, FACES, HAIR, bodyScale, normalizeAppearance, packAppearance, sameAppearance, unpackAppearance } from '../shared/Appearance'
import type { Appearance } from '../shared/Appearance'
import { createCharacter, defaultProfile, lookOf, makeover, normalizeProfile, owedMakeover } from '../shared/Economy'
import { SHAPE_REACH, isNeutral, shapeFace } from '../systems/FaceShape'
import type { HeadFrame } from '../systems/FaceShape'

const LOOK: Appearance = { face: 'young', hair: 'ginger', beard: 'silver', jaw: 0.5, chin: -0.3, nose: 1, brow: -1, cheeks: 0.2, height: 0.4, build: -0.6, shoulders: 0.9 }

test('an appearance is always complete and in range', () => {
  assert.deepEqual(normalizeAppearance(undefined), DEFAULT_APPEARANCE)
  assert.deepEqual(normalizeAppearance({ face: 'nobody', hair: 7, beard: null, jaw: 'wide', nose: Number.NaN }), DEFAULT_APPEARANCE)
  const wild = normalizeAppearance({ ...LOOK, jaw: 9, chin: -9, height: 0.449 })
  assert.equal(wild.jaw, 1)
  assert.equal(wild.chin, -1)
  assert.equal(wild.height, 0.4)
  assert.equal(wild.face, 'young')
  for (const list of [FACES, HAIR, BEARDS]) assert.equal(new Set(list.map((o) => o.id)).size, list.length, 'ids are unique')
  for (const list of [FACES, HAIR, BEARDS]) assert.equal(list[0].id, 'base', 'the default head leads each list')
})

test('an appearance survives the trip to other players', () => {
  const packed = packAppearance(LOOK)
  assert.ok(packed.length < 60, packed)
  assert.ok(sameAppearance(unpackAppearance(packed), LOOK))
  assert.ok(sameAppearance(unpackAppearance(packAppearance(DEFAULT_APPEARANCE)), DEFAULT_APPEARANCE))
  assert.deepEqual(unpackAppearance(undefined), DEFAULT_APPEARANCE)
  assert.deepEqual(unpackAppearance('x'.repeat(200)), DEFAULT_APPEARANCE)
  assert.deepEqual(unpackAppearance('young.nope.silver.99.x'), { ...DEFAULT_APPEARANCE, face: 'young', beard: 'silver', jaw: 1 })
})

test('body sliders stay within believable proportions', () => {
  const mid = bodyScale(DEFAULT_APPEARANCE)
  assert.deepEqual(mid, { height: 1, build: 1, shoulders: 1 })
  const big = bodyScale({ ...DEFAULT_APPEARANCE, height: 1, build: 1, shoulders: 1 })
  const small = bodyScale({ ...DEFAULT_APPEARANCE, height: -1, build: -1, shoulders: -1 })
  assert.ok(big.height <= 1.08 && small.height >= 0.92)
  assert.ok(big.build <= 1.12 && small.build >= 0.88)
  assert.ok(big.shoulders > 1 && small.shoulders < 1)
})

test('a new character keeps its look and is owed no change', () => {
  const p = defaultProfile()
  assert.equal(owedMakeover(p), false, 'not until the character is made')
  assert.equal(createCharacter(p, lookOf(p), LOOK), null)
  assert.ok(p.verified)
  assert.ok(sameAppearance(p.appearance, LOOK))
  assert.equal(p.fitted, APPEARANCE_VERSION)
  assert.equal(owedMakeover(p), false)
  assert.equal(typeof makeover(p, DEFAULT_APPEARANCE), 'string', 'no second change')
  assert.ok(sameAppearance(p.appearance, LOOK))
})

test('a character made earlier gets exactly one change', () => {
  const stored = JSON.parse(JSON.stringify({ ...defaultProfile(), verified: true }))
  delete stored.appearance
  delete stored.fitted
  const p = normalizeProfile(stored)
  assert.deepEqual(p.appearance, DEFAULT_APPEARANCE)
  assert.equal(p.fitted, 0)
  assert.ok(owedMakeover(p))
  const clothes = { ...p.loadout }
  assert.equal(makeover(p, { ...LOOK, face: 'nobody' }), null)
  assert.equal(p.appearance.face, 'base', 'an unknown pick falls back')
  assert.equal(p.appearance.hair, 'ginger')
  assert.deepEqual(p.loadout, clothes, 'clothes are untouched')
  assert.equal(owedMakeover(p), false)
  assert.equal(typeof makeover(p, LOOK), 'string')
  const again = normalizeProfile(JSON.parse(JSON.stringify(p)))
  assert.equal(owedMakeover(again), false, 'the change is remembered')
  assert.ok(sameAppearance(again.appearance, p.appearance))
})

test('nobody gets a change before making a character', () => {
  const p = defaultProfile()
  assert.equal(typeof makeover(p, LOOK), 'string')
  assert.deepEqual(p.appearance, DEFAULT_APPEARANCE)
})

const FRAME: HeadFrame = { top: 1.83, chin: 1.57, nose: [0, 1.665, 0.148], centre: [0, -0.004], half: 0.09 }

function headCloud(): Float32Array {
  const points: number[] = []
  for (let y = 1.5; y <= 1.83; y += 0.011) for (let a = 0; a < Math.PI * 2; a += 0.21) for (const r of [0.05, 0.09, 0.14]) points.push(Math.sin(a) * r * 0.65, y, Math.cos(a) * r)
  points.push(...FRAME.nose)
  return new Float32Array(points)
}

test('face sliders at rest leave the head exactly as modelled', () => {
  const base = headCloud()
  const out = shapeFace(base, FRAME, { jaw: 0, chin: 0, nose: 0, brow: 0, cheeks: 0 }, new Float32Array(base.length))
  assert.deepEqual(out, base)
  assert.ok(isNeutral(DEFAULT_APPEARANCE))
  assert.equal(isNeutral(LOOK), false)
})

test('face sliders move the face a little, evenly on both sides, and never the neck', () => {
  const base = headCloud()
  const reach = Math.max(...Object.values(SHAPE_REACH))
  for (const sign of [1, -1]) {
    const out = shapeFace(base, FRAME, { jaw: sign, chin: sign, nose: sign, brow: sign, cheeks: sign }, new Float32Array(base.length))
    let moved = 0
    for (let i = 0; i < base.length; i += 3) {
      const d = Math.hypot(out[i] - base[i], out[i + 1] - base[i + 1], out[i + 2] - base[i + 2])
      assert.ok(d < reach * 3, `a vertex moved ${d}`)
      if (base[i + 1] < FRAME.chin - 0.045) assert.ok(d < 1e-9, `the neck at ${base[i + 1]} moved ${d}`)
      if (d > 0.002) moved++
    }
    assert.ok(moved > 40, `only ${moved} vertices moved`)
  }
  const wide = shapeFace(base, FRAME, { jaw: 1, chin: 0, nose: 0, brow: 0, cheeks: 0 }, new Float32Array(base.length))
  let left = 0
  let right = 0
  for (let i = 0; i < base.length; i += 3) {
    const dx = wide[i] - base[i]
    if (base[i] > 0.01) right += dx
    if (base[i] < -0.01) left += dx
  }
  assert.ok(right > 0 && left < 0 && Math.abs(right + left) < right * 0.05, `jaw widens both ways: ${left} / ${right}`)
  const tip = base.length - 3
  const long = shapeFace(base, FRAME, { jaw: 0, chin: 0, nose: 1, brow: 0, cheeks: 0 }, new Float32Array(base.length))
  assert.ok(long[tip + 2] > base[tip + 2] + 0.005, 'a bigger nose reaches further forward')
})
