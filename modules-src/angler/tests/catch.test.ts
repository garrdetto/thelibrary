import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAKES, spotsOf } from '../shared/Lakes'
import type { LakeId } from '../shared/Lakes'
import { activity, conditionsAt, creditsFor, rollCatch, speciesChances } from '../shared/Catch'
import { SPECIES, speciesIds, tierOf, weightAtPercentile } from '../shared/Species'
import type { Presentation } from '../shared/Species'
import type { RodId } from '../shared/Gear'
import { mulberry32 } from '../shared/Random'
import { defaultProfile, normalizeProfile } from '../shared/Profile'
import { evaluateAchievements } from '../shared/Achievements'
import { catalog, equip, purchase } from '../shared/Shop'

test('size curves make big fish rare: tiers follow the percentiles', () => {
  const lake = LAKES['silver-birch']
  const spot = spotsOf(lake)[0]
  const rand = mulberry32(7)
  const counts: Record<string, number> = {}
  const n = 20000
  for (let i = 0; i < n; i++) {
    const r = rollCatch({ lake, x: spot.x, z: spot.z, date: new Date('2026-05-10T00:30:00Z'), rig: { rod: 'walleye', presentation: 'jig' }, settled: 60, crowd: 0 }, rand)
    counts[r.tier] = (counts[r.tier] ?? 0) + 1
    const s = SPECIES[r.species]
    assert.ok(r.weight >= s.min && r.weight <= s.cap)
  }
  assert.ok(counts.Common / n > 0.5 && counts.Common / n < 0.7, `common share ${counts.Common / n}`)
  assert.ok((counts.Trophy ?? 0) / n < 0.04)
  assert.ok((counts.Legendary ?? 0) / n < 0.008)
})

test('every species is catchable somewhere and activity stays in range', () => {
  const seen = new Set<string>()
  const rigs: [RodId, Presentation][] = [['panfish', 'bobber'], ['walleye', 'jig'], ['baitcaster', 'crank'], ['musky', 'bucktail'], ['catfish', 'cutbait'], ['sturgeon', 'crawler']]
  for (const id of Object.keys(LAKES) as LakeId[]) {
    const lake = LAKES[id]
    for (const spot of spotsOf(lake)) for (const [rod, presentation] of rigs) for (const month of [4, 7, 9]) {
      const ctx = { lake, x: spot.x, z: spot.z, date: new Date(Date.UTC(2026, month, 12, 1)), rig: { rod, presentation }, settled: 60, crowd: 0 }
      for (const c of speciesChances(ctx)) if (c.weight > 0.001) seen.add(c.id)
      const a = activity(ctx, conditionsAt(ctx))
      assert.ok(a >= 0.15 && a <= 3)
    }
  }
  assert.deepEqual([...seen].sort(), [...speciesIds].sort())
  for (const id of speciesIds) assert.ok(weightAtPercentile(SPECIES[id], 0.6) < weightAtPercentile(SPECIES[id], 0.98))
  assert.equal(tierOf(0.999), 'Legendary')
  assert.ok(creditsFor(40, 'Trophy') > creditsFor(1, 'Common'))
})

test('shop, equip and achievements stay inside the rules', () => {
  const p = defaultProfile()
  assert.equal(purchase(p, 'rod:musky').ok, false)
  p.tc = 10000
  assert.equal(purchase(p, 'rod:musky').ok, true)
  assert.equal(p.tc, 4000)
  assert.equal(purchase(p, 'reel:2').ok, false)
  assert.equal(equip(p, { look: { ...p.look, top: 'tank' } }).ok, false)
  assert.equal(purchase(p, 'top:tank').ok, true)
  assert.equal(equip(p, { look: { ...p.look, top: 'tank' } }).ok, true)
  assert.ok(catalog().every(i => i.price > 0))
  p.stats.landed = 12
  assert.ok(evaluateAchievements(p).some(u => u.id === 'catches'))
  assert.equal(evaluateAchievements(p).length, 0)
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p))), p)
})
