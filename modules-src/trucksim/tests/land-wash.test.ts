import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyAction, moveToLot } from '../shared/Actions'
import type { ActionContext } from '../shared/Actions'
import { defaultProfile, normalizeProfile } from '../shared/Economy'
import type { Profile } from '../shared/Economy'
import type { BuildItem } from '../shared/Lots'
import { COUNTY } from '../shared/RoadGraph'
import { CLEAN_BONUS, CLEAN_DIRT_LIMIT, DIRT_PER_KM, OWN_WASH_WATER, PUBLIC_WASH_PRICE, landStripPrice } from '../shared/Catalog'
import { LAND_STRIP_M, LOTS, MAX_LAND_STRIPS, lotExtent } from '../shared/WorldLayout'
import { findJob, jobSlot, minimumMs } from '../shared/Jobs'

const ctx: ActionContext = { now: 0, world: COUNTY }
const WEST = 0
const EAST = 1

function owner(lot: number | null, cash = 1_000_000): Profile {
  return { ...defaultProfile(), cash, lot }
}

function pave(id: string, x: number, z: number, w: number, d: number): BuildItem {
  return { id, def: 'pave-gravel', x, z, w, d, rot: 0, color: '#8a847a' }
}

function buy(profile: Profile) {
  const result = applyAction(profile, { action: 'buy-land' }, ctx)
  assert.equal(result.ok, true, result.message)
  return result
}

test('buy-land charges the escalating price and stops at the cap', () => {
  let profile = owner(EAST)
  for (let owned = 0; owned < MAX_LAND_STRIPS; owned++) {
    const before = profile.cash
    const result = buy(profile)
    assert.equal(result.delta, -landStripPrice(owned))
    assert.equal(result.profile.cash, before - landStripPrice(owned))
    assert.equal(result.profile.land, owned + 1)
    profile = result.profile
  }
  const capped = applyAction(profile, { action: 'buy-land' }, ctx)
  assert.equal(capped.ok, false)
  assert.equal(capped.profile.land, MAX_LAND_STRIPS)
})

test('buy-land needs a lot and enough cash', () => {
  assert.equal(applyAction(owner(null), { action: 'buy-land' }, ctx).ok, false)
  const poor = applyAction(owner(EAST, landStripPrice(0) - 1), { action: 'buy-land' }, ctx)
  assert.equal(poor.ok, false)
  assert.equal(poor.profile.land, 0)
  assert.equal(poor.delta, 0)
})

test('a west lot shifts its items so nothing moves in the world', () => {
  const lot = LOTS[WEST]
  assert.equal(lot.side, 'west')
  let profile = owner(WEST)
  profile.build = [pave('a', 10, 5, 20, 20)]
  const worldX = (p: Profile) => lotExtent(lot, p.land).x + p.build[0].x
  const before = worldX(profile)
  profile = buy(profile).profile
  assert.equal(profile.build[0].x, 10 + LAND_STRIP_M)
  assert.equal(worldX(profile), before)
  assert.equal(profile.build[0].z, 5)
})

test('an east lot keeps its items where they are', () => {
  let profile = owner(EAST)
  profile.build = [pave('a', 10, 5, 20, 20)]
  profile = buy(profile).profile
  assert.equal(profile.build[0].x, 10)
})

test('building in the new strip works only after buying it', () => {
  const profile = owner(EAST)
  const strip = pave('far', 130, 10, 20, 20)
  assert.equal(applyAction(profile, { action: 'build', items: [strip] }, ctx).ok, false)
  const grown = buy(profile).profile
  assert.equal(applyAction(grown, { action: 'build', items: [strip] }, ctx).ok, true)
  const tooFar = pave('far2', 140, 10, 20, 20)
  assert.equal(applyAction(grown, { action: 'build', items: [tooFar] }, ctx).ok, false)
})

test('bought land moves with the driver to a new lot, and the build follows the side it grows on', () => {
  const grown = buy(owner(EAST)).profile
  const moved = applyAction(grown, { action: 'claim-lot', index: 5 }, ctx)
  assert.equal(moved.ok, true)
  assert.equal(moved.profile.land, 1)
  const westGrown = buy(owner(WEST)).profile
  const built = applyAction(westGrown, { action: 'build', items: [pave('p1', 40, 10, 10, 10)] }, ctx).profile
  assert.equal(built.build[0].x, 40)
  const toEast = moveToLot(built, EAST)
  assert.equal(toEast.lot, EAST)
  assert.equal(toEast.build[0].x, 40 - LAND_STRIP_M)
  assert.equal(moveToLot(toEast, WEST).build[0].x, 40)
})

test('odometer adds dirt and caps it at 100', () => {
  const profile = owner(EAST)
  const once = applyAction(profile, { action: 'odometer', uid: 't1', km: 10, fuelUsedL: 1 }, ctx).profile
  assert.ok(Math.abs(once.trucks[0].dirt - 10 * DIRT_PER_KM) < 1e-9)
  let dirty = once
  for (let i = 0; i < 5; i++) dirty = applyAction(dirty, { action: 'odometer', uid: 't1', km: 100, fuelUsedL: 1 }, ctx).profile
  assert.equal(dirty.trucks[0].dirt, 100)
})

test('wash prices, bay requirement and dirt math', () => {
  const dirty = (p: Profile): Profile => ({ ...p, trucks: p.trucks.map((truck) => ({ ...truck, dirt: 80 })) })
  const noBay = applyAction(dirty(owner(EAST)), { action: 'wash', uid: 't1', cleaned: 1, place: 'own' }, ctx)
  assert.equal(noBay.ok, false)

  const publicWash = applyAction(dirty(owner(EAST, 1000)), { action: 'wash', uid: 't1', cleaned: 0.9, place: 'public' }, ctx)
  assert.equal(publicWash.ok, true)
  assert.equal(publicWash.delta, -PUBLIC_WASH_PRICE)
  assert.equal(publicWash.profile.trucks[0].dirt, 8)
  assert.equal(publicWash.profile.xp, 9)
  assert.match(publicWash.message, /90 %/)

  const bay = dirty({ ...owner(EAST, 1000), build: [{ id: 'w', def: 'wash-bay', x: 0, z: 0, w: 8, d: 22, rot: 0, color: '#2c6db5' }] })
  const ownWash = applyAction(bay, { action: 'wash', uid: 't1', cleaned: 0.5, place: 'own' }, ctx)
  assert.equal(ownWash.ok, true)
  assert.equal(ownWash.delta, -OWN_WASH_WATER)
  assert.equal(ownWash.profile.trucks[0].dirt, 40)

  const broke = applyAction(dirty(owner(EAST, PUBLIC_WASH_PRICE - 1)), { action: 'wash', uid: 't1', cleaned: 1, place: 'public' }, ctx)
  assert.equal(broke.ok, false)
  assert.equal(applyAction(dirty(owner(EAST)), { action: 'wash', uid: 'nope', cleaned: 1, place: 'public' }, ctx).ok, false)
  const clamped = applyAction(dirty(owner(EAST)), { action: 'wash', uid: 't1', cleaned: 7, place: 'public' }, ctx)
  assert.equal(clamped.profile.trucks[0].dirt, 0)
})

function onJob(dirt: number): { profile: Profile; jobId: string; pay: number; now: number } {
  const now = 10 * 3_600_000
  const slot = jobSlot(now)
  for (let index = 0; index < 64; index++) {
    const id = `county-${slot}-${index}`
    const job = findJob(COUNTY, id)
    if (!job || job.haul !== 'dump') continue
    const profile = owner(EAST)
    profile.trucks[0].dirt = dirt
    const accepted = applyAction(profile, { action: 'accept-job', job: id }, { now, world: COUNTY })
    if (accepted.ok) return { profile: accepted.profile, jobId: id, pay: job.pay, now }
  }
  throw new Error('no dump job found')
}

test('a clean rig earns a bonus on delivery and a dirty one does not', () => {
  for (const [dirt, expectBonus] of [[CLEAN_DIRT_LIMIT - 1, true], [CLEAN_DIRT_LIMIT, false], [90, false]] as const) {
    const { profile, jobId, pay, now } = onJob(dirt)
    const late = now + minimumMs(profile.job!.job) + 24 * 3_600_000
    const done = applyAction(profile, { action: 'complete-job', job: jobId, damage: 0 }, { now: late, world: COUNTY })
    assert.equal(done.ok, true, done.message)
    assert.equal(done.paid?.bonus, 0)
    if (expectBonus) {
      assert.equal(done.paid?.clean, Math.round(pay * CLEAN_BONUS))
      assert.equal(done.delta, pay + Math.round(pay * CLEAN_BONUS))
      assert.match(done.message, /clean rig/)
    } else {
      assert.equal(done.paid?.clean, undefined)
      assert.equal(done.delta, pay)
    }
  }
})

test('normalizeProfile fills land and dirt for old profiles and clamps bad ones', () => {
  const old = JSON.parse(JSON.stringify(defaultProfile()))
  delete old.land
  delete old.trucks[0].dirt
  old.lot = 2
  const fixed = normalizeProfile(old)
  assert.equal(fixed.land, 0)
  assert.equal(fixed.trucks[0].dirt, 0)

  const wild = normalizeProfile({ ...old, land: 99, trucks: [{ ...old.trucks[0], dirt: 500 }] })
  assert.equal(wild.land, MAX_LAND_STRIPS)
  assert.equal(wild.trucks[0].dirt, 100)
  const junk = normalizeProfile({ ...old, land: 'x', trucks: [{ ...old.trucks[0], dirt: NaN }] })
  assert.equal(junk.land, 0)
  assert.equal(junk.trucks[0].dirt, 0)
  assert.equal(normalizeProfile({ ...old, land: -3 }).land, 0)
  assert.equal(normalizeProfile(null).land, 0)
})
