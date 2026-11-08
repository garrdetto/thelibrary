import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENCOUNTER_MAX_SECONDS, ENCOUNTER_MIN_SECONDS, EncounterDirector } from '../systems/EncounterDirector'
import { mulberry32 } from '../systems/LootTableManager'
import { SLACK_LIMIT, STRAIN_LIMIT, SkillCheckManager } from '../systems/SkillCheckManager'
import { bufferedSine } from '../systems/Waves'

test('holding the reel forever strains and snaps the line', () => {
  const skill = new SkillCheckManager(mulberry32(5))
  skill.beginReel(1.2)
  skill.setHolding(true)
  let snap = skill.updateReel(0)
  for (let i = 0; i < 60 * 40 && snap.outcome === 'fighting'; i++) snap = skill.updateReel(1 / 60)
  assert.equal(snap.outcome, 'snapped')
})

test('never reeling lets the slack throw the hook', () => {
  const skill = new SkillCheckManager(mulberry32(6))
  skill.beginReel(0.5)
  skill.setHolding(false)
  let snap = skill.updateReel(0)
  for (let i = 0; i < 60 * 30 && snap.outcome === 'fighting'; i++) snap = skill.updateReel(1 / 60)
  assert.equal(snap.outcome, 'thrown')
})

test('keeping tension in the band lands the fish', () => {
  const skill = new SkillCheckManager(mulberry32(8))
  skill.beginReel(0.6)
  let snap = skill.updateReel(0)
  for (let i = 0; i < 60 * 120 && snap.outcome === 'fighting'; i++) {
    skill.setHolding(snap.tension < 62)
    snap = skill.updateReel(1 / 60)
    if (snap.outcome === 'fighting') assert.ok(snap.tension >= 0 && snap.tension <= 100)
  }
  assert.equal(snap.outcome, 'landed')
  assert.ok(SLACK_LIMIT === 10 && STRAIN_LIMIT === 90)
})

test('aiming down sights shrinks the breathing sway, holding breath shrinks it more', () => {
  const run = (aim: boolean, hold: boolean) => {
    const skill = new SkillCheckManager(mulberry32(2))
    let peak = 0
    for (let i = 0; i < 60 * 3; i++) {
      const s = skill.updateSway(1 / 60, 0, aim, hold)
      peak = Math.max(peak, Math.hypot(s.x, s.y))
    }
    return peak
  }
  const hip = run(false, false)
  const ads = run(true, false)
  const held = run(true, true)
  assert.ok(ads < hip * 0.3, `ads ${ads} vs hip ${hip}`)
  assert.ok(held < ads, `held ${held} vs ads ${ads}`)
})

test('wildlife encounters arrive between one and three minutes of exploring', () => {
  for (let seed = 1; seed < 40; seed++) {
    const director = new EncounterDirector(mulberry32(seed))
    let t = 0
    let fired = false
    while (t < ENCOUNTER_MAX_SECONDS + 1) {
      t += 0.5
      if (director.update(0.5, { exploring: true, lineInWater: false, onLand: true }) === 'game') {
        fired = true
        break
      }
    }
    assert.ok(fired, `seed ${seed} fired`)
    assert.ok(t >= ENCOUNTER_MIN_SECONDS && t <= ENCOUNTER_MAX_SECONDS + 0.5, `seed ${seed} at ${t}s`)
  }
})

test('the buffered sine matches Math.sin', () => {
  for (let p = -10; p < 10; p += 0.37) assert.ok(Math.abs(bufferedSine(p) - Math.sin(p)) < 1e-4)
})
