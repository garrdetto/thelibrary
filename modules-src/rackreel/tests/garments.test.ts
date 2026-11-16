import assert from 'node:assert/strict'
import { test } from 'node:test'
import { garments } from '../game/Garments'
import type { BodyFrame, BodyPoint, Glyphs, RGB } from '../game/Garments'
import { ITEMS, offered, setTailoredClothes } from '../shared/Economy'
import { HAIRSTYLES, normalizeAppearance, packAppearance, unpackAppearance, DEFAULT_APPEARANCE } from '../shared/Appearance'

const FRAME: BodyFrame = {
  shoulderY: 1.45, shoulderX: 0.19, collarY: 1.51, neckR: 0.055, neckX: 0, neckZ: 0, hemY: 1.0, arm: 0.5, elbow: 0.27, leg: 0.75, knee: 0.38, ankleY: 0.14, skin: [0.8, 0.6, 0.5],
}
const NO_GLYPHS = (): Glyphs => ({ size: 1, alpha: new Uint8Array(1) })
const point = (p: Partial<BodyPoint>): BodyPoint => ({ x: 0, y: 1.2, z: 0.12, armT: -1, legT: 0, wArm: 0, wHand: 0, wFoot: 0, armD: 0.3, ...p })
const HAND: RGB = [0.1, 0.9, 0.1]

function colour(wear: string[], p: BodyPoint): RGB {
  const out: RGB = [0, 0, 0]
  garments(wear, NO_GLYPHS).top(p, FRAME, out, HAND, HAND)
  return out
}

const near = (a: RGB, b: RGB, tolerance = 0.12) => a.every((v, i) => Math.abs(v - b[i]) < tolerance)

test('a tee covers the upper arm and leaves the forearm bare', () => {
  const tee = ['jacket-tee-black', 'vest-none', 'pants-jeans']
  assert.ok(colour(tee, point({ x: 0.25, y: 1.38, armT: 0.1, wArm: 1, armD: 0.03 }))[0] < 0.2, 'the sleeve is black')
  assert.ok(near(colour(tee, point({ x: 0.35, y: 1.2, armT: 0.35, wArm: 1, armD: 0.03 })), FRAME.skin, 0.15), 'the forearm is skin')
  assert.ok(colour(tee, point({}))[0] < 0.2, 'the chest is black')
})

test('a basketball jersey is sleeveless and the shorts stop above the knee with socks below', () => {
  const kit = ['jacket-jersey-red', 'vest-none', 'pants-bball-red']
  assert.ok(near(colour(kit, point({ x: 0.25, y: 1.38, armT: 0.1, wArm: 1, armD: 0.03 })), FRAME.skin, 0.15), 'bare shoulder')
  const chest = colour(kit, point({ x: 0.05, y: 1.15 }))
  assert.ok(chest[0] > chest[1] * 1.8, 'red chest')
  const out: RGB = [0, 0, 0]
  const shade = garments(kit, NO_GLYPHS).bottom
  shade(point({ x: 0.1, y: 0.6, z: 0.05, legT: 0.3 }), FRAME, out, HAND, HAND)
  assert.ok(out[0] > out[1] * 1.8, 'red shorts on the thigh')
  shade(point({ x: 0.1, y: 0.4, z: 0.05, legT: 0.5 }), FRAME, out, HAND, HAND)
  assert.ok(near(out, FRAME.skin, 0.15), 'bare shin')
  shade(point({ x: 0.1, y: 0.22, z: 0.05, legT: 0.66 }), FRAME, out, HAND, HAND)
  assert.ok(out[0] > 0.8 && out[1] > 0.8, 'white crew sock')
})

test('the scanned hands are kept and the neck above the neckline is skin', () => {
  assert.deepEqual(colour(['jacket-flannel'], point({ x: 0.5, y: 1.0, armT: 0.56, wArm: 0.1, wHand: 1, armD: 0.02 })), HAND)
  assert.ok(near(colour(['jacket-hoodie-grey'], point({ x: 0.02, y: 1.53, z: 0.05 })), FRAME.skin, 0.15))
})

test('tops and vests share textures by what is worn, and the trousers key both garments', () => {
  const a = garments(['jacket-tee-white', 'vest-none', 'pants-jeans'], NO_GLYPHS)
  const b = garments(['jacket-tee-white', 'vest-blaze', 'pants-jeans'], NO_GLYPHS)
  const c = garments(['jacket-blaze', 'vest-blaze', 'pants-jeans'], NO_GLYPHS)
  assert.notEqual(a.topKey, b.topKey)
  assert.equal(c.topKey, 'jacket-blaze|pants-jeans', 'a vest over the blaze parka adds nothing')
})

test('tailored-only clothes are offered only where the body is tailored', () => {
  const jersey = ITEMS.find((i) => i.id === 'jacket-jersey-red')!
  assert.ok(jersey.tailored)
  setTailoredClothes(false)
  assert.equal(offered(jersey.id), false)
  assert.equal(offered('jacket-flannel'), true)
  setTailoredClothes(true)
  assert.equal(offered(jersey.id), true)
  setTailoredClothes(false)
})

test('a hairstyle survives the trip to other players and older strings keep the natural hair', () => {
  for (const style of HAIRSTYLES) assert.equal(unpackAppearance(packAppearance({ ...DEFAULT_APPEARANCE, style: style.id })).style, style.id)
  assert.equal(unpackAppearance('young.base.base.0.0.0.0.0.0.0.0').style, 'painted')
  assert.equal(normalizeAppearance({ style: 'beehive' }).style, 'painted')
})
