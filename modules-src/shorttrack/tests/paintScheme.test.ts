import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEME_LIMITS, sanitizeScheme, schemeForPainters } from '../shared/PaintScheme'

const base = {
  name: 'Neon Shark', primary: '#0D1B2A', secondary: '#39ff14', accent: '#ffffff',
  logos: { chomp: { kind: 'oval', text: 'CHOMP', bg: '#39ff14', fg: '#0d1b2a', edge: '#ffffff' } },
  side: [
    { type: 'band', s0: 0, s1: 0.2, color: '#39ff14', t0: 0, t1: 1 },
    { type: 'poly', points: [[0, 0], [0.3, 0.5], [0.6, 0]], color: '#ffffff' },
    { type: 'text', t: 0.8, s: 0.3, h: 0.12, text: 'BITE', fill: '#ffffff', outline: '#000000' },
    { type: 'logo', t: 0.85, s: 0.7, w: 0.7, logo: 'chomp' },
  ],
  hood: { color: '#0d1b2a', stripes: [[0.2, '#39ff14']], logo: ['chomp', 0.9, 1.75] },
  num: { fill: '#39ff14', outline: '#0d1b2a', accent: '#ffffff', slant: true },
}

test('a designed scheme comes through clean and converts for the painters', () => {
  const s = sanitizeScheme(base)!
  assert.equal(s.primary, '#0d1b2a')
  assert.equal(s.side.length, 4)
  const p = schemeForPainters(s)
  assert.deepEqual(p.side[0], ['band', 0, 0.2, '#39ff14', 0, 1])
  assert.equal(p.side[3]![0], 'logo')
  assert.deepEqual(p.hood.logo, ['chomp', 0.9, 1.75])
  assert.equal(p.logos.chomp.text, 'CHOMP')
})

test('real brands, markup and unknown shapes never reach the car', () => {
  const s = sanitizeScheme({
    ...base,
    logos: { a: { kind: 'box', text: 'Budweiser', bg: '#ff0000', fg: '#ffffff', edge: '#ffffff' }, b: { kind: 'box', text: '<script>', bg: '#000000', fg: '#ffffff', edge: '#ffffff' } },
    side: [
      { type: 'text', t: 0.5, s: 0.5, h: 0.1, text: 'Pennzoil', fill: '#ffffff' },
      { type: 'logo', t: 0.5, s: 0.5, w: 0.5, logo: 'a' },
      { type: 'image', url: 'https://example.com/x.png' },
      { type: 'band', s0: 0.5, s1: 0.2, color: 'red' },
    ],
    hood: { color: 'javascript:alert(1)', logo: ['a', 1, 1.7] },
  })!
  assert.deepEqual(s.logos, {})
  assert.equal(s.side.length, 0)
  assert.equal(s.hood.color, s.primary)
  assert.equal(s.hood.logo, null)
})

test('sizes and counts are capped', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ type: 'dot', t: i / 200, s: 9, r: 99, color: '#ffffff' }))
  const s = sanitizeScheme({ ...base, side: many })!
  assert.equal(s.side.length, SCHEME_LIMITS.sideOps)
  const dot = s.side[0] as { s: number; r: number }
  assert.equal(dot.s, 1.2)
  assert.equal(dot.r, 0.6)
  assert.equal(sanitizeScheme({ primary: 'blue' }), null)
  assert.equal(sanitizeScheme('x'), null)
})

test('every AI field car has a research reference with its own number and a parody sponsor', async () => {
  const { FIELD_REFS } = await import('../shared/FieldRefs')
  const { ICONIC_FIELD } = await import('../iconic-schemes.js')
  const { SCHEME_BRAND_PATTERN } = await import('../shared/PaintScheme')
  assert.equal(FIELD_REFS.length, ICONIC_FIELD.length)
  for (const car of ICONIC_FIELD) {
    const ref = FIELD_REFS.find(f => f.scheme === car.scheme)
    assert.ok(ref, car.scheme)
    assert.equal(ref.number, car.number)
    assert.equal(ref.driver, car.name)
    assert.ok(!SCHEME_BRAND_PATTERN.test(ref.sponsor), ref.sponsor)
  }
})
