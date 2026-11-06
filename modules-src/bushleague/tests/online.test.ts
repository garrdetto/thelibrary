import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Contest, Rng, replay, type InputRecord } from '../sim'
import { MatchCore, ONLINE_PACE, ONLINE_WINDUP, PITCH_SECONDS, digestOf, distinctTeam, elo, isRoomCode, onlineSetup, roomCode, sameDigest, type ClientMessage } from '../shared/Online'

const options = { innings: 3 as const, dh: true, autoRunner: true, mercy: false }

function applyRecord(contest: Contest, record: InputRecord): void {
  if (record.kind === 'pre') contest.prePitch(record.intent)
  else if (record.kind === 'pitch') contest.preparePitch(record.intent)
  else contest.resolveSwing(record.intent)
}

/** A scripted human: aims at the zone with some noise, swings with sloppy timing about half the time, and sometimes runs. */
function humanMove(core: MatchCore, rng: Rng): ClientMessage {
  const contest = core.contest
  if (contest.phase === 'pre') return { t: 'pre', steal: rng.chance(0.15) ? [1] : [] }
  if (contest.phase === 'pitch') {
    const repertoire = contest.pitcher.pitching!.repertoire
    return { t: 'pitch', intent: { type: repertoire[rng.int(0, repertoire.length - 1)].type, targetX: rng.int(-300, 300), targetY: rng.int(450, 1100), effort: rng.int(60, 100), accuracy: rng.int(-40, 40) } }
  }
  if (rng.chance(0.45)) return { t: 'swing', intent: { action: 'take', type: 'contact', timing: 0, aimX: 0, aimY: 0 } }
  const pitch = contest.lastPitch!
  return { t: 'swing', intent: { action: 'swing', type: rng.chance(0.2) ? 'power' : 'contact', timing: rng.int(-60, 60), aimX: Math.round(pitch.plateX * 1000) + rng.int(-60, 60), aimY: Math.round(pitch.plateY * 1000) + rng.int(-60, 60) } }
}

function playMatch(seed: number) {
  const setup = onlineSetup(seed, 'ura', 'sal', options)
  let now = 1_000_000
  const core = new MatchCore(setup, now)
  const pages = [new Contest(setup), new Contest(setup)]
  const rngs = [new Rng(seed ^ 0x55), new Rng(seed ^ 0xaa)]
  let guard = 0
  while (!core.final && guard++ < 5000) {
    now += 3000
    const side = core.owner
    const record = core.apply(side, humanMove(core, rngs[side]), now)
    assert.ok(record, `owner ${side} could not play during ${core.contest.phase}`)
    for (const page of pages) {
      applyRecord(page, record)
      assert.ok(sameDigest(digestOf(page), digestOf(core.contest)), `page drifted at record ${core.contest.log.length - 1}`)
    }
  }
  return { core, pages, setup }
}

test('two pages replaying the server records stay pitch-for-pitch identical to the authority', () => {
  for (const seed of [11, 42, 2027]) {
    const { core, pages, setup } = playMatch(seed)
    assert.ok(core.final, 'the contest reached a final')
    assert.notEqual(core.winner, null)
    for (const page of pages) {
      assert.equal(page.phase, 'final')
      assert.deepEqual(page.score, core.contest.score)
      assert.equal(page.winner, core.winner)
    }
    assert.deepEqual(replay(setup, core.contest.log).score, core.contest.score)
  }
})

test('only the side that owns a decision can make it, and malformed pitches are refused', () => {
  const setup = onlineSetup(5, 'ura', 'sal', options)
  const core = new MatchCore(setup, 0)
  assert.equal(core.contest.phase, 'pre')
  assert.equal(core.owner, 0, 'the visitors bat first, so they own the pre-pitch call')
  assert.equal(core.apply(1, { t: 'pre', steal: [] }, 10), null)
  assert.ok(core.apply(0, { t: 'pre', steal: [] }, 10))
  assert.equal(core.owner, 1, 'the home club pitches')
  assert.equal(core.apply(0, { t: 'pitch', intent: { type: 'FF', targetX: 0, targetY: 800, effort: 80, accuracy: 0 } }, 20), null)
  const repertoire = core.contest.pitcher.pitching!.repertoire.map((item) => item.type)
  const missing = (['KN', 'SW', 'FS', 'CU'] as const).find((type) => !repertoire.includes(type))
  if (missing) assert.equal(core.apply(1, { t: 'pitch', intent: { type: missing, targetX: 0, targetY: 800, effort: 80, accuracy: 0 } }, 20), null)
  assert.ok(core.apply(1, { t: 'pitch', intent: { type: repertoire[0], targetX: 99999, targetY: -99999, effort: 500, accuracy: -500 } }, 20))
  const logged = core.contest.log.at(-1)!
  assert.equal(logged.kind, 'pitch')
  if (logged.kind === 'pitch') assert.deepEqual([logged.intent.targetX, logged.intent.targetY, logged.intent.effort, logged.intent.accuracy], [1500, -200, 100, -100])
})

test('a swing that arrives before the pitch could reach the plate on screen is held until it could have', () => {
  const core = new MatchCore(onlineSetup(9, 'ura', 'sal', options), 0)
  core.apply(0, { t: 'pre', steal: [] }, 0)
  const thrownAt = 1000
  core.apply(1, { t: 'pitch', intent: { type: core.contest.pitcher.pitching!.repertoire[0].type, targetX: 0, targetY: 800, effort: 80, accuracy: 0 } }, thrownAt)
  const swing: ClientMessage = { t: 'swing', intent: { action: 'swing', type: 'power', timing: 12, aimX: 30, aimY: 800 } }
  assert.equal(core.apply(0, swing, thrownAt + 200), null)
  assert.equal(core.tick(thrownAt + 300), null, 'still too early')
  const onScreen = (ONLINE_WINDUP + core.contest.lastPitch!.flightTime * ONLINE_PACE) * 1000
  const record = core.tick(thrownAt + onScreen)
  assert.equal(record?.kind, 'swing')
  if (record?.kind === 'swing') assert.deepEqual(record.intent, { action: 'swing', type: 'power', timing: 12, aimX: 30, aimY: 800 })
})

test('a silent owner gets the safe default at the deadline, unless they are disconnected', () => {
  const core = new MatchCore(onlineSetup(3, 'ura', 'sal', options), 0)
  core.apply(0, { t: 'pre', steal: [] }, 0)
  assert.equal(core.contest.phase, 'pitch')
  core.pause(1)
  assert.equal(core.tick(PITCH_SECONDS * 1000 + 1), null, 'a disconnected pitcher is waited for')
  core.resume(1, PITCH_SECONDS * 1000 + 1)
  assert.equal(core.tick(PITCH_SECONDS * 1000 + 2), null, 'resuming restarts the clock')
  const record = core.tick(PITCH_SECONDS * 2000 + 10)
  assert.equal(record?.kind, 'pitch')
  const swing = core.tick(PITCH_SECONDS * 4000)
  assert.equal(swing?.kind, 'swing')
  if (swing?.kind === 'swing') assert.equal(swing.intent.action, 'take')
})

test('Elo moves ratings by the expected amounts and room codes are well formed', () => {
  assert.deepEqual(elo(1200, 1200, 1), [1216, 1184])
  assert.deepEqual(elo(1200, 1200, 0), [1184, 1216])
  const [upset] = elo(1000, 1400, 1)
  assert.ok(upset - 1000 > 28, 'beating a much stronger player pays more')
  const [favourite] = elo(1400, 1000, 1)
  assert.ok(favourite - 1400 < 4, 'beating a much weaker player pays little')
  const rng = new Rng(4)
  for (let index = 0; index < 50; index++) assert.ok(isRoomCode(roomCode(() => rng.next())))
  assert.ok(!isRoomCode('ABC1O0'), 'ambiguous letters are not used')
  assert.notEqual(distinctTeam('sal', 'sal'), 'sal')
  assert.equal(onlineSetup(1, 'sal', 'sal', options).home !== 'sal', true)
})
