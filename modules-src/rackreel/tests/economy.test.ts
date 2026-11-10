import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACTIVE_TASKS, CARP_BOUNTY, FISH_COOLDOWN_MS, ITEMS, applyEvent, defaultProfile, equip, eventCooldown, gearEffects, normalizeProfile, purchase } from '../shared/Economy'

test('a new profile starts with cash, starter gear and three tasks', () => {
  const p = defaultProfile()
  assert.ok(p.cash > 0)
  assert.equal(p.tasks.length, ACTIVE_TASKS)
  for (const item of ITEMS.filter((i) => i.price === 0)) assert.ok(p.owned.includes(item.id))
})

test('catches pay more for bigger and trophy fish, and cooldowns stop spam', () => {
  const p = defaultProfile()
  const small = applyEvent(p, { type: 'fish', species: 'walleye', trophy: false, boat: false, legendary: false }, 0.1, 1_000_000)
  const again = applyEvent(p, { type: 'fish', species: 'walleye', trophy: false, boat: false, legendary: false }, 0.9, 1_000_000 + FISH_COOLDOWN_MS - 1)
  const big = applyEvent(p, { type: 'fish', species: 'walleye', trophy: true, boat: false, legendary: false }, 0.9, 1_000_000 + FISH_COOLDOWN_MS + 1)
  assert.ok(small.paid > 0)
  assert.equal(again.paid, 0)
  assert.ok(big.paid > small.paid * 2)
})

test('every carp pays the flat bounty with no cooldown, whatever its size', () => {
  const p = defaultProfile()
  const cash = p.cash
  const first = applyEvent(p, { type: 'fish', species: 'carp', trophy: false, boat: true, legendary: false }, 0.1, 2_000_000)
  const second = applyEvent(p, { type: 'fish', species: 'carp', trophy: true, boat: true, legendary: true }, 1.4, 2_000_500)
  assert.equal(first.paid, CARP_BOUNTY)
  assert.equal(second.paid, CARP_BOUNTY)
  assert.equal(p.cash, cash + CARP_BOUNTY * 2)
  assert.equal(eventCooldown('fish', 'carp'), 0)
  assert.equal(eventCooldown('fish', 'walleye'), FISH_COOLDOWN_MS)
})

test('finishing a task pays its reward and a new task replaces it', () => {
  const p = defaultProfile()
  p.tasks = [{ id: 'buck1', progress: 0 }, { id: 'perch5', progress: 0 }, { id: 'pike2', progress: 0 }]
  const r = applyEvent(p, { type: 'game', species: 'whitetail', doe: false, stand: true, trophy: false, legendary: false }, 0.5, 5_000_000)
  assert.equal(r.completed.length, 1)
  assert.equal(r.completed[0].id, 'buck1')
  assert.equal(p.tasks.length, ACTIVE_TASKS)
  assert.ok(!p.tasks.some((t) => t.id === 'buck1'))
})

test('buying needs the cash, equips the item, and survives normalizing', () => {
  const p = defaultProfile()
  p.cash = 100
  assert.match(purchase(p, 'reel-pro') ?? '', /more/)
  p.cash = 1000
  assert.equal(purchase(p, 'reel-pro'), null)
  assert.equal(p.loadout.reel, 'reel-pro')
  assert.equal(equip(p, 'reel', 'reel-spin'), null)
  assert.equal(equip(p, 'reel', 'reel-baitcast'), 'Buy it first.')
  const copy = normalizeProfile(JSON.parse(JSON.stringify(p)))
  assert.ok(copy.owned.includes('reel-pro'))
  assert.equal(copy.loadout.reel, 'reel-spin')
  assert.equal(normalizeProfile({ cash: -5, owned: ['nope'], loadout: { reel: 'reel-pro' } }).loadout.reel, 'reel-spin')
})

test('upgrades change how the outing plays', () => {
  const base = gearEffects(defaultProfile().loadout)
  const p = defaultProfile()
  p.loadout = { ...p.loadout, reel: 'reel-pro', bait: 'bait-bucktail', pants: 'pants-waders', scent: 'scent-killer', motor: 'motor-250' }
  const fx = gearEffects(p.loadout)
  assert.ok(fx.reelSpeed > base.reelSpeed && fx.surge < base.surge)
  assert.ok(fx.baitBias.muskie > base.baitBias.muskie)
  assert.ok(fx.wadeDepth > base.wadeDepth && fx.detection < base.detection && fx.boatPower > base.boatPower)
})
