import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { courseShotsFromRound, parseBag, roundKeyOf } from '../../public/gspro/gspro-bridge.mjs'
import { analyzeShot, courseName, holePins, roundPlayers, roundReport, type CourseShot } from '../../src/lib/gspro/course'
import { clubFromGsproIndex } from '../../src/lib/gspro/clubs'

const rows = JSON.parse(readFileSync(new URL('./fixtures/round-sample.json', import.meta.url), 'utf8'))
const shots: CourseShot[] = courseShotsFromRound(rows, 1_700_000_000_000).map((shot: Omit<CourseShot, 'id' | 'roundId'>, index: number) => ({ ...shot, id: index + 1, roundId: 'gr_test' }))

test('bridge turns GSPro round rows into course shots', () => {
  assert.equal(shots.length, 22)
  assert.equal(roundKeyOf(rows), shots[0].round)
  const tee = shots[0]
  assert.equal(tee.hole, 0)
  assert.equal(tee.par, 4)
  assert.equal(tee.clubIndex, 0)
  assert.ok(tee.flight.length > 50)
  assert.ok(tee.roll.length <= 31)
  assert.ok(Math.abs(tee.ball.speed - 168.34) < 0.01)
  assert.equal(courseName(tee.course), 'Mammoth Dunes')
})

test('club indexes follow GSPro order', () => {
  assert.equal(clubFromGsproIndex(0), 'DR')
  assert.equal(clubFromGsproIndex(8), '3H')
  assert.equal(clubFromGsproIndex(18), '7I')
  assert.equal(clubFromGsproIndex(25), 'LW')
  assert.equal(clubFromGsproIndex(26), 'PT')
})

test('pins come from the holed final shots and match GSPro distances', () => {
  const pins = holePins(shots)
  assert.equal(pins.size, 3)
  for (const shot of shots.filter(item => !item.final)) {
    const after = analyzeShot(shot, pins.get(shot.hole)!).after!
    assert.ok(Math.abs(after - shot.toPin) < 0.2, `hole ${shot.hole} shot ${shot.holeShot}: ${after} vs ${shot.toPin}`)
  }
})

test('replay frame: left start with draw spin finishes left, right start with fade finishes right', () => {
  const pins = holePins(shots)
  const drawLeft = shots.find(shot => shot.holeShot === 1 && shot.ball.direction < -3 && shot.ball.spinAxis < 0)!
  const fadeRight = shots.find(shot => shot.holeShot === 1 && shot.ball.direction > 1 && shot.ball.spinAxis > 5)!
  const left = analyzeShot(drawLeft, pins.get(drawLeft.hole)!)
  const right = analyzeShot(fadeRight, pins.get(fadeRight.hole)!)
  assert.ok(left.offline < -10, `left ${left.offline}`)
  assert.ok(right.offline > 10, `right ${right.offline}`)
  assert.ok(left.path[0].x === 0 && left.path[0].t === 0)
  assert.ok(Math.abs(left.carry - left.path[left.landingIndex].x) < 3)
  assert.ok(left.apex > 60 && left.apex < 120, `apex ${left.apex}`)
})

test('round report scores holes and counts putts, fairways and greens', () => {
  const [first] = roundPlayers(shots)
  const report = roundReport(shots, first)
  assert.deepEqual(report.holes.map(hole => hole.score), [3, 3, 5])
  assert.equal(report.par, 13)
  assert.equal(report.score, 11)
  assert.deepEqual(report.holes.map(hole => hole.putts), [1, 1, 2])
  assert.equal(report.greens.hit, 3)
  assert.equal(report.fairways.chances, 3)
  assert.ok(report.drive! > 200)
  assert.ok(report.approach.length > 0)
  assert.ok(report.putting.reduce((sum, band) => sum + band.holes, 0) === 3)
})

test('ProTee bag lofts are read from the ClubProfiles line', () => {
  const text = 'Version=2\nClubProfiles=[{"Name":"x","Clubs":[{"Name":"7 iron","StaticLoft":34.5},{"Name":"Driver","StaticLoft":10.5}]}]\n'
  assert.deepEqual(parseBag(text), [{ name: '7 iron', loft: 34.5 }, { name: 'Driver', loft: 10.5 }])
  assert.deepEqual(parseBag('nothing here'), [])
})
