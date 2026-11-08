import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEGENDARY_CHANCE, LootTableManager, RECORD_BOOK_SEED, SPECIES, SPECIES_BY_ID, fishLengthIn, formatValue, mulberry32 } from '../systems/LootTableManager'

test('record book seeds a sorted top three for every species', () => {
  for (const s of SPECIES) {
    const book = RECORD_BOOK_SEED[s.id]
    assert.equal(book.length, 3)
    assert.ok(book[0].value > book[1].value && book[1].value > book[2].value, s.id)
    assert.ok(book[2].value > s.max, `${s.id} records sit above the everyday range`)
  }
})

test('about 8% of new animals are record-class and land inside the top three', () => {
  const loot = new LootTableManager(mulberry32(42))
  const runs = 40_000
  let legends = 0
  for (let i = 0; i < runs; i++) {
    const species = SPECIES[i % SPECIES.length]
    const s = loot.createSpecimen(species.id)
    if (s.legendary) {
      legends++
      assert.ok(s.value >= RECORD_BOOK_SEED[species.id][2].value - 0.05, `${species.id} legend ${s.value} reaches the book`)
      assert.ok(s.recordTier >= 1 && s.recordTier <= 3)
    } else {
      assert.ok(s.value >= species.min - 1e-6 && s.value <= species.max * 1.05, `${species.id} baseline ${s.value}`)
      assert.equal(s.recordTier, 0)
    }
  }
  const rate = legends / runs
  assert.ok(Math.abs(rate - LEGENDARY_CHANCE) < 0.008, `legendary rate ${rate}`)
})

test('baseline sizes are skewed toward small fish, like a real lake', () => {
  const loot = new LootTableManager(mulberry32(7))
  const t = SPECIES_BY_ID.walleye
  const values = Array.from({ length: 5000 }, () => loot.baselineValue(t)).sort((a, b) => a - b)
  const median = values[2500]
  assert.ok(median < (t.min + t.max) / 2, `median ${median} below the midpoint`)
})

test('claiming a record shifts the book down and keeps three entries', () => {
  const loot = new LootTableManager(mulberry32(1))
  const specimen = { ...loot.createSpecimen('muskie'), value: 68.2 }
  const tier = loot.claim(specimen, 'You', 'Bear Paw Lake', 2026)
  assert.equal(tier, 2)
  const book = loot.records.muskie
  assert.equal(book.length, 3)
  assert.equal(book[1].holder, 'You')
  assert.equal(book[2].value, RECORD_BOOK_SEED.muskie[1].value)
})

test('trophy points reach 1,000 at the record and lengths follow weight', () => {
  const loot = new LootTableManager(mulberry32(3))
  assert.equal(loot.trophyPoints('pike', RECORD_BOOK_SEED.pike[0].value), 1000)
  assert.ok(loot.trophyPoints('pike', 5) < 100)
  const muskie30 = fishLengthIn('muskie', 30)
  assert.ok(muskie30 > 44 && muskie30 < 50, `30 lb muskie ${muskie30} in`)
  assert.equal(formatValue('walleye', 4.5), '4 lb 8 oz')
  assert.equal(formatValue('whitetail', 152.25), '152.3″')
})

test('habitat steers species choice', () => {
  const loot = new LootTableManager(mulberry32(9))
  const counts: Record<string, number> = {}
  for (let i = 0; i < 6000; i++) {
    const s = loot.pickSpecies('fish', 'rocks')
    counts[s.id] = (counts[s.id] ?? 0) + 1
  }
  assert.ok((counts.smallmouth ?? 0) > (counts.pike ?? 0), 'rocks favor smallmouth over pike')
  for (let i = 0; i < 200; i++) assert.equal(loot.pickSpecies('game', 'forest').kind, 'game')
})
