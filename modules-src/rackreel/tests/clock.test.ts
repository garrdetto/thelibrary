import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Clock, FULL_DARK_HOUR, HOUR_SECONDS, START_HOUR, formatClock, hourFromSearch, hoursUntilDark, skyAt } from '../systems/TimeOfDay'

test('the sun rises in the east, crosses the south at noon and sets in the west', () => {
  const morning = skyAt(9)
  assert.ok(morning.sun.x > 0.3 && morning.sunElevation > 5, `morning sun east and up: ${JSON.stringify(morning.sun)}`)
  const noon = skyAt(13.1)
  assert.ok(Math.abs(noon.sun.x) < 0.05, `noon sun on the meridian: ${noon.sun.x}`)
  assert.ok(noon.sun.z < -0.5, 'noon sun due south')
  assert.ok(noon.sunElevation > 35 && noon.sunElevation < 40, `October noon at 46° N: ${noon.sunElevation}`)
  const evening = skyAt(17)
  assert.ok(evening.sun.x < -0.3 && evening.sunElevation > 0, 'evening sun in the west')
})

test('sunset is about 6:45 PM and it is fully dark by 7:30 PM and at 9 PM', () => {
  let sunset = 0
  for (let h = 17; h < 20; h += 1 / 120) {
    if (skyAt(h).sunElevation < -0.833) {
      sunset = h
      break
    }
  }
  assert.ok(Math.abs(sunset - 18.75) < 0.12, `sunset ${formatClock(sunset)}`)
  assert.ok(skyAt(FULL_DARK_HOUR).night > 0.97, 'dark at 7:30 PM')
  assert.equal(skyAt(21).night, 1)
  assert.equal(skyAt(16).night, 0)
  assert.ok(skyAt(18.6).night > 0 && skyAt(18.6).night < 0.6, 'dusk is in between')
})

test('the full moon is opposite the sun and high at midnight', () => {
  const midnight = skyAt(0.1)
  assert.ok(midnight.moonElevation > 45, `moon ${midnight.moonElevation}`)
  assert.ok(midnight.moon.z < 0, 'it rides in the southern sky')
  assert.ok(skyAt(13).moonElevation < -30, 'and is down at midday')
})

test('the clock runs 75 s an hour from 4 PM and formats like a watch', () => {
  const clock = new Clock()
  assert.equal(clock.hour, START_HOUR)
  assert.equal(clock.label, '4:00 PM')
  clock.advance(HOUR_SECONDS * 2.5)
  assert.equal(clock.label, '6:30 PM')
  clock.advance(HOUR_SECONDS * 6)
  assert.equal(clock.label, '12:30 AM')
  assert.equal(clock.day, 1)
  assert.equal(formatClock(0), '12:00 AM')
  assert.equal(formatClock(12), '12:00 PM')
  assert.equal(formatClock(21.25), '9:15 PM')
  assert.equal(formatClock(23.9999), '11:59 PM')
})

test('?hour= sets the clock for testing and waiting skips to dark', () => {
  assert.equal(hourFromSearch('?hour=21'), 21)
  assert.equal(hourFromSearch('?hour=18.6'), 18.6)
  assert.equal(hourFromSearch('?hour=x'), null)
  assert.equal(hourFromSearch(''), null)
  assert.equal(hoursUntilDark(22), 0)
  const wait = hoursUntilDark(16)
  assert.ok(skyAt(16 + wait).night > 0.98, `after waiting ${wait} h it is dark`)
})
