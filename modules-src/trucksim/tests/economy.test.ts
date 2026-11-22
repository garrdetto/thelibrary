import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultProfile, level, normalizeProfile } from '../shared/Economy'
import type { Profile } from '../shared/Economy'
import { applyAction } from '../shared/Actions'
import type { TruckAction } from '../shared/Actions'
import { COUNTY } from '../shared/RoadGraph'
import { generateJobs, jobSlot, minimumMs } from '../shared/Jobs'
import { FUEL_PRICE_PER_L, REPAIR_COST_PER_POINT, RESALE_SHARE, STARTER_TRUCK, STARTING_CASH, TRAILER_BY_ID, TRUCK_BY_ID, defaultLook, lookCost } from '../shared/Catalog'
import type { TruckLook } from '../shared/Catalog'

const NOW = 100 * 60 * 60 * 1000
const ctx = { now: NOW, world: COUNTY }
const rich = (): Profile => ({ ...defaultProfile(), cash: 1_000_000, lot: 2 })
const run = (profile: Profile, action: TruckAction, extra: Partial<typeof ctx> = {}) => applyAction(profile, action, { ...ctx, ...extra })

function withShop(profile: Profile): Profile {
  return { ...profile, build: [{ id: 'shop', def: 'shop-steel', x: 0, z: 0, w: 16, d: 24, rot: 0, color: '#8d969e' }] }
}

test('defaultProfile gives the starter truck and cash', () => {
  const profile = defaultProfile()
  assert.equal(profile.version, 1)
  assert.equal(profile.cash, STARTING_CASH)
  assert.equal(profile.cash, 3000)
  assert.equal(profile.trucks.length, 1)
  const [truck] = profile.trucks
  assert.equal(truck.model, STARTER_TRUCK)
  assert.equal(truck.fuelL, TRUCK_BY_ID[STARTER_TRUCK].fuelTankL)
  assert.equal(truck.damage, 0)
  assert.equal(truck.odometerKm, 0)
  assert.deepEqual(truck.look, defaultLook(TRUCK_BY_ID[STARTER_TRUCK]))
  assert.equal(profile.activeTruck, truck.uid)
  assert.equal(profile.activeTrailer, null)
  assert.equal(profile.lot, null)
  assert.deepEqual(profile.build, [])
  assert.equal(profile.job, null)
  assert.deepEqual(profile.stats, { jobs: 0, earned: 0, km: 0, tonnes: 0 })
  assert.equal(profile.xp, 0)
  assert.equal(typeof profile.company, 'string')
  assert.notEqual(defaultProfile().trucks[0], defaultProfile().trucks[0])
})

test('level grows with xp', () => {
  assert.equal(level(0), 1)
  assert.equal(level(-50), 1)
  assert.equal(level(NaN), 1)
  assert.ok(level(100000) > level(1000))
  assert.ok(level(1000) >= level(100))
})

test('normalizeProfile survives garbage', () => {
  for (const raw of [null, undefined, 'text', 42, [], {}, { trucks: 'x' }, { cash: 'lots', trucks: [null, 3, 'a'], trailers: {}, build: 7, stats: 'x' }]) {
    const profile = normalizeProfile(raw)
    assert.equal(profile.version, 1)
    assert.ok(Number.isFinite(profile.cash))
    assert.ok(profile.trucks.length >= 1)
    assert.ok(profile.trucks.some((truck) => truck.uid === profile.activeTruck))
  }
  assert.deepEqual(normalizeProfile(null), defaultProfile())
})

test('normalizeProfile drops unknown models, clamps numbers and keeps valid data', () => {
  const base = defaultProfile()
  const raw = {
    ...base,
    cash: -50,
    xp: 1e12,
    company: '   ',
    trucks: [
      { ...base.trucks[0], damage: 400, fuelL: 99999, odometerKm: -5 },
      { uid: 'x1', model: 'made-up', look: base.trucks[0].look, odometerKm: 0, damage: 0, fuelL: 10 },
      { uid: 'x2', model: 'kestrel-cx-day', look: 'broken', odometerKm: 12.5, damage: 'a', fuelL: null },
    ],
    trailers: [{ uid: 'tr1', model: 'flatbed-48', color: 'nope', damage: -3 }, { uid: 'tr2', model: 'bogus', color: '#ffffff', damage: 0 }],
    activeTruck: 'x1',
    activeTrailer: 'ghost',
    lot: 99,
    build: [{ id: 'a', def: 'nope' }, { id: 'b', def: 'pave-gravel', x: 0, z: 0, w: 10, d: 10, rot: 0, color: '#8a847a' }],
    job: { job: { id: 'bad' }, acceptedAt: 'x', truck: 'x1', trailer: null },
    stats: { jobs: -2, earned: 'x', km: 5, tonnes: Infinity },
  }
  const profile = normalizeProfile(JSON.parse(JSON.stringify(raw)))
  assert.equal(profile.cash, 0)
  assert.ok(profile.xp < 1e12)
  assert.ok(profile.company.length > 0)
  assert.deepEqual(profile.trucks.map((truck) => truck.model), [STARTER_TRUCK, 'kestrel-cx-day'])
  assert.equal(profile.trucks[0].damage, 100)
  assert.equal(profile.trucks[0].fuelL, TRUCK_BY_ID[STARTER_TRUCK].fuelTankL)
  assert.equal(profile.trucks[0].odometerKm, 0)
  assert.equal(profile.trucks[1].odometerKm, 12.5)
  assert.deepEqual(profile.trucks[1].look, defaultLook(TRUCK_BY_ID['kestrel-cx-day']))
  assert.equal(profile.trucks[1].damage, 0)
  assert.equal(profile.trailers.length, 1)
  assert.equal(profile.trailers[0].color, TRAILER_BY_ID['flatbed-48'].defaultColor)
  assert.equal(profile.trailers[0].damage, 0)
  assert.equal(profile.activeTruck, profile.trucks[0].uid)
  assert.equal(profile.activeTrailer, null)
  assert.equal(profile.lot, null)
  assert.deepEqual(profile.build.map((entry) => entry.id), ['b'])
  assert.equal(profile.job, null)
  assert.deepEqual(profile.stats, { jobs: 0, earned: 0, km: 5, tonnes: 0 })
})

test('normalizeProfile is idempotent on a played profile', () => {
  const played = run(rich(), { action: 'buy-trailer', model: 'flatbed-48' }).profile
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(played))), played)
})

test('a refused action leaves the profile unchanged with a plain message', () => {
  const profile = defaultProfile()
  const snapshot = JSON.parse(JSON.stringify(profile))
  const result = run(profile, { action: 'buy-truck', model: 'bedrock-quad' })
  assert.equal(result.ok, false)
  assert.equal(result.delta, 0)
  assert.ok(result.message.length > 0)
  assert.deepEqual(result.profile, snapshot)
  assert.equal(run(profile, { action: 'buy-truck', model: 'nope' }).ok, false)
})

test('buying a truck charges the price plus the look and does not mutate the input', () => {
  const profile = rich()
  const snapshot = JSON.parse(JSON.stringify(profile))
  const model = TRUCK_BY_ID['kestrel-cx-day']
  const look: TruckLook = { ...defaultLook(model), visor: true, paint: { ...model.defaultPaint, primary: '#112233' } }
  const result = run(profile, { action: 'buy-truck', model: model.id, look })
  assert.equal(result.ok, true)
  assert.equal(result.delta, -(model.price + lookCost(defaultLook(model), look)))
  assert.equal(result.profile.cash, profile.cash + result.delta)
  const bought = result.profile.trucks[1]
  assert.equal(bought.model, model.id)
  assert.equal(bought.fuelL, model.fuelTankL)
  assert.deepEqual(bought.look, look)
  assert.notEqual(bought.uid, profile.trucks[0].uid)
  assert.deepEqual(profile, snapshot)
  const plain = run(profile, { action: 'buy-truck', model: model.id })
  assert.equal(plain.delta, -model.price)
})

test('buying a trailer uses its colour or the default', () => {
  const result = run(rich(), { action: 'buy-trailer', model: 'reefer-53', color: '#336699' })
  assert.equal(result.ok, true)
  assert.equal(result.delta, -TRAILER_BY_ID['reefer-53'].price)
  assert.equal(result.profile.trailers[0].color, '#336699')
  assert.equal(run(rich(), { action: 'buy-trailer', model: 'reefer-53' }).profile.trailers[0].color, TRAILER_BY_ID['reefer-53'].defaultColor)
  assert.equal(run(defaultProfile(), { action: 'buy-trailer', model: 'reefer-53' }).ok, false)
})

test('selling pays the resale share but never the active or last truck', () => {
  const bought = run(rich(), { action: 'buy-truck', model: 'kestrel-cx-day' }).profile
  const second = bought.trucks[1]
  const sold = run(bought, { action: 'sell-truck', uid: second.uid })
  assert.equal(sold.ok, true)
  assert.equal(sold.delta, Math.floor(TRUCK_BY_ID['kestrel-cx-day'].price * RESALE_SHARE))
  assert.equal(sold.profile.trucks.length, 1)
  assert.equal(run(bought, { action: 'sell-truck', uid: bought.activeTruck }).ok, false)
  assert.equal(run(defaultProfile(), { action: 'sell-truck', uid: defaultProfile().activeTruck }).ok, false)
  assert.equal(run(bought, { action: 'sell-truck', uid: 'ghost' }).ok, false)
  const damaged = { ...bought, trucks: [bought.trucks[0], { ...second, damage: 100 }] }
  assert.ok(run(damaged, { action: 'sell-truck', uid: second.uid }).delta < sold.delta)
})

test('selling a trailer works unless it is the active one', () => {
  const owned = run(rich(), { action: 'buy-trailer', model: 'flatbed-48' }).profile
  const [trailer] = owned.trailers
  const sold = run(owned, { action: 'sell-trailer', uid: trailer.uid })
  assert.equal(sold.ok, true)
  assert.equal(sold.delta, Math.floor(TRAILER_BY_ID['flatbed-48'].price * RESALE_SHARE))
  assert.equal(sold.profile.trailers.length, 0)
  const selected = run(owned, { action: 'select', truck: owned.activeTruck, trailer: trailer.uid }).profile
  assert.equal(run(selected, { action: 'sell-trailer', uid: trailer.uid }).ok, false)
})

test('customizing charges lookCost', () => {
  const profile = rich()
  const truck = profile.trucks[0]
  const look: TruckLook = { ...truck.look, lights: 'full', wheels: 'polished' }
  const result = run(profile, { action: 'customize', uid: truck.uid, look })
  assert.equal(result.ok, true)
  assert.equal(result.delta, -lookCost(truck.look, look))
  assert.deepEqual(result.profile.trucks[0].look, look)
  const free = run(profile, { action: 'customize', uid: truck.uid, look: truck.look })
  assert.equal(free.ok, true)
  assert.equal(free.delta, 0)
  assert.equal(run({ ...profile, cash: 10 }, { action: 'customize', uid: truck.uid, look }).ok, false)
  assert.equal(run(profile, { action: 'customize', uid: 'ghost', look }).ok, false)
})

test('select changes the active rig', () => {
  const bought = run(run(rich(), { action: 'buy-truck', model: 'kestrel-cx-day' }).profile, { action: 'buy-trailer', model: 'flatbed-48' }).profile
  const result = run(bought, { action: 'select', truck: bought.trucks[1].uid, trailer: bought.trailers[0].uid })
  assert.equal(result.ok, true)
  assert.equal(result.profile.activeTruck, bought.trucks[1].uid)
  assert.equal(result.profile.activeTrailer, bought.trailers[0].uid)
  assert.equal(run(bought, { action: 'select', truck: 'ghost', trailer: null }).ok, false)
  assert.equal(run(bought, { action: 'select', truck: bought.activeTruck, trailer: 'ghost' }).ok, false)
})

test('refuel charges fuel and is cheaper with a service building', () => {
  const profile = rich()
  profile.trucks[0].fuelL = 100
  const plain = run(profile, { action: 'refuel', uid: profile.trucks[0].uid, litres: 50 })
  const served = run(withShop(profile), { action: 'refuel', uid: profile.trucks[0].uid, litres: 50 })
  assert.equal(plain.ok && served.ok, true)
  assert.equal(served.delta, -Math.round(50 * FUEL_PRICE_PER_L))
  assert.ok(plain.delta < served.delta)
  assert.equal(plain.profile.trucks[0].fuelL, 150)
  const capped = run(profile, { action: 'refuel', uid: profile.trucks[0].uid, litres: 99999 })
  assert.equal(capped.profile.trucks[0].fuelL, TRUCK_BY_ID[STARTER_TRUCK].fuelTankL)
  const full = defaultProfile()
  assert.equal(run(full, { action: 'refuel', uid: full.trucks[0].uid, litres: 10 }).ok, false)
  assert.equal(run({ ...profile, cash: 1 }, { action: 'refuel', uid: profile.trucks[0].uid, litres: 50 }).ok, false)
  assert.equal(run(profile, { action: 'refuel', uid: profile.trucks[0].uid, litres: -5 }).ok, false)
})

test('repair charges per point and is cheaper with a service building', () => {
  const profile = rich()
  profile.trucks[0].damage = 10
  const plain = run(profile, { action: 'repair', uid: profile.trucks[0].uid })
  const served = run(withShop(profile), { action: 'repair', uid: profile.trucks[0].uid })
  assert.equal(served.delta, -10 * REPAIR_COST_PER_POINT)
  assert.ok(plain.delta < served.delta)
  assert.equal(plain.profile.trucks[0].damage, 0)
  assert.equal(run(defaultProfile(), { action: 'repair', uid: defaultProfile().trucks[0].uid }).ok, false)
  assert.equal(run({ ...profile, cash: 5 }, { action: 'repair', uid: profile.trucks[0].uid }).ok, false)
  const withTrailer = run(profile, { action: 'buy-trailer', model: 'flatbed-48' }).profile
  withTrailer.trailers[0].damage = 4
  assert.equal(run(withShop(withTrailer), { action: 'repair', uid: withTrailer.trailers[0].uid }).delta, -4 * REPAIR_COST_PER_POINT)
})

test('odometer adds distance and burns fuel within sane limits', () => {
  const profile = defaultProfile()
  const uid = profile.trucks[0].uid
  const result = run(profile, { action: 'odometer', uid, km: 12.5, fuelUsedL: 5 })
  assert.equal(result.ok, true)
  assert.equal(result.delta, 0)
  assert.equal(result.profile.trucks[0].odometerKm, 12.5)
  assert.equal(result.profile.trucks[0].fuelL, profile.trucks[0].fuelL - 5)
  const clamped = run(profile, { action: 'odometer', uid, km: 99999, fuelUsedL: 99999 })
  assert.ok(clamped.profile.trucks[0].odometerKm < 1000)
  assert.ok(clamped.profile.trucks[0].fuelL >= 0)
  assert.equal(run(profile, { action: 'odometer', uid: 'ghost', km: 1, fuelUsedL: 1 }).ok, false)
})

test('rename trims and bounds the company name', () => {
  assert.equal(run(defaultProfile(), { action: 'rename', company: '  Blue Ridge Haulage  ' }).profile.company, 'Blue Ridge Haulage')
  assert.equal(run(defaultProfile(), { action: 'rename', company: '   ' }).ok, false)
  assert.ok(run(defaultProfile(), { action: 'rename', company: 'x'.repeat(100) }).profile.company.length <= 32)
})

function dumpJob() {
  const job = generateJobs(COUNTY, jobSlot(NOW), 48).find((entry) => entry.haul === 'dump' && entry.massKg <= 14000)
  assert.ok(job)
  return job
}

test('accept, complete and abandon a job', () => {
  const profile = defaultProfile()
  const job = dumpJob()
  const accepted = run(profile, { action: 'accept-job', job: job.id })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.delta, 0)
  assert.equal(accepted.profile.job?.job.id, job.id)
  assert.equal(accepted.profile.job?.acceptedAt, NOW)
  assert.equal(accepted.profile.job?.truck, profile.activeTruck)
  assert.equal(accepted.profile.job?.trailer, null)

  assert.equal(run(accepted.profile, { action: 'accept-job', job: job.id }).ok, false)
  assert.equal(run(accepted.profile, { action: 'select', truck: profile.activeTruck, trailer: null }).ok, true)

  const early = run(accepted.profile, { action: 'complete-job', job: job.id, damage: 0 })
  assert.equal(early.ok, false)
  assert.equal(early.delta, 0)
  assert.equal(early.profile.cash, profile.cash)

  const arrive = { now: NOW + minimumMs(job) + 1000 }
  const wrong = run(accepted.profile, { action: 'complete-job', job: 'county-1-1', damage: 0 }, arrive)
  assert.equal(wrong.ok, false)

  const done = run(accepted.profile, { action: 'complete-job', job: job.id, damage: 0 }, arrive)
  assert.equal(done.ok, true)
  assert.ok(done.delta >= job.pay)
  assert.equal(done.paid?.pay, done.delta)
  assert.equal(done.profile.cash, profile.cash + done.delta)
  assert.equal(done.profile.job, null)
  assert.equal(done.profile.stats.jobs, 1)
  assert.equal(done.profile.stats.earned, done.delta)
  assert.ok(done.profile.stats.tonnes > 0)
  assert.ok(done.profile.xp > 0)

  const hurt = run(accepted.profile, { action: 'complete-job', job: job.id, damage: 1 }, arrive)
  assert.ok(hurt.delta <= done.delta)
  assert.ok(hurt.profile.trucks[0].damage >= 0)

  const abandoned = run(accepted.profile, { action: 'abandon-job' })
  assert.equal(abandoned.ok, true)
  assert.equal(abandoned.profile.job, null)
  assert.equal(abandoned.delta, 0)
  assert.equal(run(profile, { action: 'abandon-job' }).ok, false)
  assert.equal(run(profile, { action: 'complete-job', job: job.id, damage: 0 }, arrive).ok, false)
})

test('accepting checks the rig, the load and the job list', () => {
  const profile = defaultProfile()
  const heavy = generateJobs(COUNTY, jobSlot(NOW), 48).find((entry) => entry.haul === 'dump' && entry.massKg > 14000)
  assert.ok(heavy)
  assert.equal(run(profile, { action: 'accept-job', job: heavy.id }).ok, false)
  const tanker = generateJobs(COUNTY, jobSlot(NOW)).find((entry) => entry.haul === 'tanker')
  assert.ok(tanker)
  assert.equal(run(profile, { action: 'accept-job', job: tanker.id }).ok, false)
  assert.equal(run(profile, { action: 'accept-job', job: 'county-3-1' }).ok, false)
  assert.equal(run(profile, { action: 'accept-job', job: 'nonsense' }).ok, false)

  const rig = run(run(rich(), { action: 'buy-truck', model: 'kestrel-cx-day' }).profile, { action: 'buy-trailer', model: 'tanker-9500' }).profile
  const selected = run(rig, { action: 'select', truck: rig.trucks[1].uid, trailer: rig.trailers[0].uid }).profile
  const small = generateJobs(COUNTY, jobSlot(NOW), 48).find((entry) => entry.haul === 'tanker' && entry.massKg <= 26000)
  assert.ok(small)
  const accepted = run(selected, { action: 'accept-job', job: small.id })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.profile.job?.trailer, rig.trailers[0].uid)
  assert.equal(run(accepted.profile, { action: 'sell-trailer', uid: rig.trailers[0].uid }).ok, false)
  assert.equal(run(accepted.profile, { action: 'select', truck: rig.trucks[0].uid, trailer: null }).ok, false)
})
