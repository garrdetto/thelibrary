import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BELOW_AVERAGE_SHARE, LootTableManager, RARITY, RECORD_BOOK_SEED, SPECIES, SPECIES_BY_ID, classify, fishLengthIn, formatValue, measure, mulberry32, nearRecordAt } from '../systems/LootTableManager'

test('record book seeds a sorted top three for every species', () => {
  for (const s of SPECIES) {
    const book = RECORD_BOOK_SEED[s.id]
    assert.equal(book.length, 3)
    assert.ok(book[0].value > book[1].value && book[1].value > book[2].value, s.id)
    assert.ok(nearRecordAt(s.id) > s.trophyAt && s.avg > s.min && s.avg < s.trophyAt, `${s.id} classes are ordered`)
  }
})

test('rarity: 0.01% records, 0.05% near-records, 2% trophies, the rest everyday', () => {
  const loot = new LootTableManager(mulberry32(42))
  const runs = 1_000_000
  const counts: Record<string, number> = {}
  for (let i = 0; i < runs; i++) {
    const species = SPECIES[i % SPECIES.length]
    const s = loot.createSpecimen(species.id)
    const c = s.sizeClass
    counts[c] = (counts[c] ?? 0) + 1
    if (c === 'record') assert.ok(s.value > RECORD_BOOK_SEED[species.id][0].value && s.value <= RECORD_BOOK_SEED[species.id][0].value * 1.05, `${species.id} record ${s.value}`)
    if (c === 'near-record') assert.ok(s.value >= nearRecordAt(species.id) && s.value <= RECORD_BOOK_SEED[species.id][0].value)
    assert.equal(s.legendary, c === 'record' || c === 'near-record')
    assert.ok(s.value >= species.min - 1e-6, `${species.id} ${s.value} under min`)
  }
  const rate = (c: string) => (counts[c] ?? 0) / runs
  assert.ok(rate('record') > RARITY.record * 0.5 && rate('record') < RARITY.record * 1.6, `record ${rate('record')}`)
  assert.ok(Math.abs(rate('near-record') - RARITY.nearRecord) < RARITY.nearRecord * 0.25, `near ${rate('near-record')}`)
  assert.ok(Math.abs(rate('trophy') - RARITY.trophy) < 0.002, `trophy ${rate('trophy')}`)
  assert.ok(rate('average') > 0.5, `average ${rate('average')} is the most common`)
})

test('everyday sizes peak at the average with more slightly-smaller than bigger', () => {
  const loot = new LootTableManager(mulberry32(7))
  for (const t of SPECIES) {
    const values = Array.from({ length: 20000 }, () => loot.baselineValue(t))
    const below = values.filter((v) => v <= t.avg).length / values.length
    assert.ok(Math.abs(below - BELOW_AVERAGE_SHARE) < 0.02, `${t.id} below-average share ${below}`)
    assert.ok(values.every((v) => v >= t.min - 1e-9 && v < t.trophyAt), `${t.id} stays under the trophy line`)
    const bins = [0, 0, 0, 0]
    const step = (t.trophyAt - t.avg) / 4
    for (const v of values) if (v > t.avg) bins[Math.min(3, Math.floor((v - t.avg) / step))]++
    assert.ok(bins[0] > bins[1] && bins[1] > bins[2] && bins[2] > bins[3], `${t.id} bigger is rarer ${bins}`)
    const near = values.filter((v) => Math.abs(v - t.avg) < (t.avg - t.min) * 0.25).length
    const far = values.filter((v) => v < t.min + (t.avg - t.min) * 0.25).length
    assert.ok(near > far * 2, `${t.id} average beats small`)
  }
})

test('trophies thin out exponentially: smaller big bucks are commoner', () => {
  const loot = new LootTableManager(mulberry32(17))
  const t = SPECIES_BY_ID.whitetail
  const values = Array.from({ length: 20000 }, () => loot.trophyValue(t))
  const mid = (t.trophyAt + nearRecordAt('whitetail')) / 2
  const low = values.filter((v) => v < mid).length
  assert.ok(low > values.length * 0.8, `low half ${low}`)
  assert.ok(values.every((v) => v >= t.trophyAt && v < nearRecordAt('whitetail')))
})

test('bait can raise the trophy odds but never the record odds', () => {
  const runs = 400_000
  const count = (odds: number) => {
    const loot = new LootTableManager(mulberry32(5))
    const c: Record<string, number> = {}
    for (let i = 0; i < runs; i++) {
      const k = loot.rollClass(odds)
      c[k] = (c[k] ?? 0) + 1
    }
    return c
  }
  const plain = count(1)
  const bucktail = count(1.75)
  assert.ok(bucktail.trophy > plain.trophy * 1.6)
  assert.equal(bucktail.record, plain.record)
  assert.equal(bucktail['near-record'], plain['near-record'])
})

test('measurements are the same for everyone and look like real animals', () => {
  assert.deepEqual(measure('whitetail', 152.3), measure('whitetail', 152.3))
  const avg = measure('whitetail', 115)
  assert.ok(avg.points! >= 5 && avg.points! <= 10, `points ${avg.points}`)
  assert.ok(avg.spread! > 12 && avg.spread! < 18, `spread ${avg.spread}`)
  const big = measure('whitetail', 206)
  assert.ok(big.points! >= 10 && big.spread! > 18, `record rack ${JSON.stringify(big)}`)
  const muskie = measure('muskie', 69.7)
  assert.ok(muskie.length! > 58 && muskie.length! < 66, `muskie ${muskie.length}`)
  const bear = measure('blackbear', 790)
  assert.ok(bear.skull! > 22 && bear.skull! < 24, `skull ${bear.skull}`)
  assert.equal(classify('whitetail', 115), 'average')
  assert.equal(classify('whitetail', 165), 'trophy')
  assert.equal(classify('whitetail', 200), 'near-record')
  assert.equal(classify('whitetail', 207), 'record')
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
  assert.ok(fishLengthIn('walleye', 2) > 15)
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
