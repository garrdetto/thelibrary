import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JOB_SLOT_MS, findJob, generateJobs, jobPayout, jobSlot, minimumMs } from '../shared/Jobs'
import { COUNTY } from '../shared/RoadGraph'
import { CARGO_BY_ID } from '../shared/Catalog'
import type { HaulKind } from '../shared/Catalog'
import type { ZoneKind } from '../shared/WorldLayout'

const KINDS: Record<HaulKind, [ZoneKind[], ZoneKind[]]> = {
  dump: [['dumpLoad'], ['dumpUnload']],
  tanker: [['tankLoad'], ['tankUnload']],
  flatbed: [['flatLoad'], ['flatUnload']],
  grain: [['grainLoad'], ['grainUnload']],
  reefer: [['reeferDock'], ['reeferDock']],
  lowboy: [['equipPickup', 'equipDrop'], ['equipPickup', 'equipDrop']],
}

test('jobSlot groups time into half hours', () => {
  assert.equal(JOB_SLOT_MS, 30 * 60 * 1000)
  assert.equal(jobSlot(0), 0)
  assert.equal(jobSlot(JOB_SLOT_MS - 1), 0)
  assert.equal(jobSlot(JOB_SLOT_MS), 1)
})

test('generateJobs is deterministic and slot dependent', () => {
  const first = generateJobs(COUNTY, 5)
  assert.equal(first.length, 16)
  assert.deepEqual(generateJobs(COUNTY, 5), first)
  assert.notDeepEqual(generateJobs(COUNTY, 6).map((job) => [job.from, job.to, job.massKg]), first.map((job) => [job.from, job.to, job.massKg]))
  assert.equal(generateJobs(COUNTY, 5, 4).length, 4)
  assert.deepEqual(generateJobs(COUNTY, 5, 4), first.slice(0, 4))
})

test('every slot offers every haul kind with ids in the documented form', () => {
  for (let slot = 0; slot < 20; slot++) {
    const jobs = generateJobs(COUNTY, slot)
    const hauls = new Set(jobs.map((job) => job.haul))
    for (const haul of Object.keys(KINDS)) assert.ok(hauls.has(haul as HaulKind), `slot ${slot} lacks ${haul}`)
    jobs.forEach((job, n) => assert.equal(job.id, `county-${slot}-${n}`))
  }
})

test('jobs use zones of the right kinds and sensible numbers', () => {
  for (let slot = 0; slot < 20; slot++) {
    for (const job of generateJobs(COUNTY, slot)) {
      const from = COUNTY.zone(job.from)
      const to = COUNTY.zone(job.to)
      assert.ok(from && to, job.id)
      const [fromKinds, toKinds] = KINDS[job.haul]
      if (job.haul === 'lowboy') {
        assert.ok((from.kind === 'equipPickup' && to.kind === 'equipDrop') || (from.kind === 'equipDrop' && to.kind === 'equipPickup'), job.id)
      } else {
        assert.ok(fromKinds.includes(from.kind) && toKinds.includes(to.kind), `${job.id} ${from.kind}->${to.kind}`)
      }
      if (job.haul === 'reefer') assert.notEqual(from.site, to.site)
      const cargo = CARGO_BY_ID[job.cargo]
      assert.equal(cargo.haul, job.haul)
      assert.ok(job.massKg >= cargo.minKg && job.massKg <= cargo.maxKg)
      assert.equal(job.world, 'county')
      assert.ok(job.distanceM > 0 && Number.isFinite(job.distanceM))
      assert.ok(job.minutes >= 5)
      assert.equal(job.pay % 10, 0)
      const expected = cargo.baseFee + cargo.ratePerTonKm * (job.massKg / 1000) * (job.distanceM / 1000)
      assert.ok(Math.abs(job.pay - expected) <= 5.01, job.id)
    }
  }
})

test('findJob regenerates the same job from its id', () => {
  for (const job of generateJobs(COUNTY, 77)) assert.deepEqual(findJob(COUNTY, job.id), job)
  assert.equal(findJob(COUNTY, 'county-77-9999'), null)
  assert.equal(findJob(COUNTY, 'other-77-1'), null)
  assert.equal(findJob(COUNTY, 'garbage'), null)
  assert.equal(findJob(COUNTY, 'county-x-1'), null)
})

test('minimumMs is the distance at 90 km/h', () => {
  const job = generateJobs(COUNTY, 1)[0]
  assert.ok(Math.abs(minimumMs(job) - (job.distanceM / 25) * 1000) < 1)
})

test('jobPayout applies damage and on-time rules', () => {
  const gravel = generateJobs(COUNTY, 3).find((job) => job.cargo === 'gravel') ?? generateJobs(COUNTY, 3).find((job) => job.haul === 'dump')
  const fragile = generateJobs(COUNTY, 3).find((job) => job.haul === 'reefer')
  assert.ok(gravel && fragile)
  const onTime = gravel.minutes * 60_000
  const clean = jobPayout(gravel, { damage: 0, elapsedMs: onTime })
  assert.equal(clean.penalty, 0)
  assert.equal(clean.bonus, Math.round(gravel.pay * 0.15))
  assert.equal(clean.pay, gravel.pay + clean.bonus)
  const late = jobPayout(gravel, { damage: 0, elapsedMs: onTime + 1 })
  assert.deepEqual(late, { pay: gravel.pay, bonus: 0, penalty: 0 })
  const wrecked = jobPayout(fragile, { damage: 1, elapsedMs: Infinity })
  assert.ok(wrecked.penalty > 0 && wrecked.penalty <= fragile.pay * 0.4)
  assert.equal(wrecked.pay, fragile.pay - wrecked.penalty)
  const scuffed = jobPayout(fragile, { damage: 0.2, elapsedMs: Infinity })
  assert.ok(scuffed.penalty < wrecked.penalty)
  const tough = jobPayout(gravel, { damage: 1, elapsedMs: Infinity })
  assert.ok(tough.penalty < wrecked.penalty)
  assert.ok(jobPayout(fragile, { damage: 7, elapsedMs: Infinity }).penalty <= fragile.pay * 0.4 + 1)
  assert.equal(jobPayout(fragile, { damage: -3, elapsedMs: Infinity }).penalty, 0)
})
