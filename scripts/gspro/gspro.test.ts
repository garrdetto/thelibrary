import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateFlight, traceFlight } from '../../src/lib/gspro/flight'
import { normalizeClub } from '../../src/lib/gspro/clubs'
import { importCsv } from '../../src/lib/gspro/csv'
import { enrichShot, summarizeByClub } from '../../src/lib/gspro/stats'
import { allTips } from '../../src/lib/gspro/tips'
import { shotFromOpenConnect } from '../../src/server/gspro'
import type { GsproShot } from '../../src/lib/gspro/types'

const near = (actual: number, expected: number, tolerance: number, label: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual.toFixed(1)} not within ${tolerance} of ${expected}`)

test('flight estimate stays within 6% of tour carry averages', () => {
  const cases: [number, number, number, number][] = [[167, 10.9, 2686, 275], [158, 9.3, 3655, 243], [132, 12.1, 5361, 194], [120, 16.3, 7097, 172], [102, 24.2, 9304, 136]]
  for (const [ballSpeed, launch, totalSpin, carry] of cases) {
    const flight = estimateFlight({ ballSpeed, launch, direction: 0, totalSpin, spinAxis: 0 })
    assert.ok(flight)
    near(flight.carry, carry, carry * 0.06, `${ballSpeed} mph carry`)
    near(flight.offline, 0, 0.01, 'straight shot offline')
  }
})

test('positive spin axis and start line finish right', () => {
  const fade = estimateFlight({ ballSpeed: 150, launch: 12, direction: 0, totalSpin: 2800, spinAxis: 8 })!
  const draw = estimateFlight({ ballSpeed: 150, launch: 12, direction: 0, totalSpin: 2800, spinAxis: -8 })!
  assert.ok(fade.offline > 5)
  assert.ok(draw.offline < -5)
  const push = estimateFlight({ ballSpeed: 150, launch: 12, direction: 3, totalSpin: 2800, spinAxis: 0 })!
  near(push.offline, Math.sin((3 * Math.PI) / 180) * push.carry, 1.5, 'push offline')
})

test('club names normalize to GSPro codes', () => {
  assert.equal(normalizeClub('Driver'), 'DR')
  assert.equal(normalizeClub('7 Iron'), '7I')
  assert.equal(normalizeClub('7i'), '7I')
  assert.equal(normalizeClub('3 Wood'), '3W')
  assert.equal(normalizeClub('Hybrid 4'), '4H')
  assert.equal(normalizeClub('56°'), 'SW')
  assert.equal(normalizeClub('PW'), 'PW')
  assert.equal(normalizeClub(''), null)
})

test('Open Connect JSON becomes a stored shot', () => {
  const shot = shotFromOpenConnect({
    Units: 'Yards',
    BallData: { Speed: 148.2, VLA: 12.6, HLA: 1.3, BackSpin: 2643, SideSpin: 189 },
    ClubData: { Speed: 102.4, AngleOfAttack: 1.8, FaceToTarget: 1.2, Path: -0.9, Loft: 14.1 },
  }, { ref: 'abc12345', at: 1_700_000_000_000, club: 'DR', handed: 'RH' })
  assert.ok(shot)
  near(shot.totalSpin, 2650, 1, 'total spin from components')
  near(shot.spinAxis, 4.09, 0.05, 'spin axis from components')
  assert.equal(shot.carry, null)
  assert.equal(shot.clubSpeed, 102.4)
  const metric = shotFromOpenConnect({ Units: 'Meters', BallData: { Speed: 60, VLA: 14, TotalSpin: 3000, SpinAxis: -2, CarryDistance: 200 } }, { ref: 'abc12346', at: 1, club: null, handed: 'LH' })!
  near(metric.ballSpeed, 134.2, 0.2, 'm/s to mph')
  near(metric.carry!, 218.7, 0.2, 'metres to yards')
  assert.equal(shotFromOpenConnect({ BallData: { Speed: 0, VLA: 0 } }, { ref: 'abc12347', at: 1, club: null, handed: 'RH' }), null)
})

test('CSV import maps common headers and units', () => {
  const csv = 'Date,Club,Ball Speed (mph),Launch Angle,Launch Direction,Back Spin,Side Spin,Carry (yds),Club Speed (mph),Club Path\n2026-11-01 10:00,7 Iron,120.5,16.1,1.2 R,6800,-400,170,88.1,2.0 L\n,,,,,,,,,\n2026-11-01 10:01,Driver,150,12,0,2600,100,240,104,0'
  const result = importCsv(csv)
  assert.equal(result.shots.length, 2)
  const [iron, driver] = result.shots
  assert.equal(iron.club, '7I')
  assert.equal(iron.direction, 1.2)
  assert.equal(iron.path, -2)
  near(iron.totalSpin, 6811.8, 0.5, 'total spin')
  assert.ok(iron.spinAxis < 0)
  assert.equal(driver.club, 'DR')
  assert.equal(driver.carry, 240)
  const metric = importCsv('Ball Speed (m/s);VLA;Spin;Carry (m)\n60;14;3000;200')
  near(metric.shots[0].ballSpeed, 134.2, 0.2, 'metric ball speed')
  near(metric.shots[0].carry!, 218.7, 0.2, 'metric carry')
})

test('summaries and tips flag a slicing, high-spin driver', () => {
  const shots: GsproShot[] = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1, sessionId: 'gs_0000000000000000', createdAt: index, source: 'test', club: 'DR', handed: 'RH',
    ballSpeed: 140 + (index % 3), launch: 9, direction: 2, totalSpin: 3600, spinAxis: 12, carry: null,
    clubSpeed: 104, attackAngle: -3, path: -4, face: 2, dynamicLoft: 12, lie: null, impactH: null, impactV: null, excluded: index === 7,
  }))
  const summaries = summarizeByClub(shots.map(enrichShot))
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].shots, 7)
  const ids = allTips(summaries).map(tip => tip.id)
  assert.ok(ids.includes('DR:window'))
  assert.ok(ids.includes('DR:aoa'))
  assert.ok(ids.includes('DR:f2p'))
  assert.ok(ids.includes('DR:smash'))
})

test('the replay trace matches the estimate and ends at the total', () => {
  const input = { ballSpeed: 150, launch: 12, direction: 1, totalSpin: 2700, spinAxis: 6 }
  const estimate = estimateFlight(input)!
  const trace = traceFlight(input)!
  const landing = trace.air[trace.air.length - 1]
  near(landing.x, estimate.carry, 0.01, 'landing x')
  near(landing.z, estimate.offline, 0.01, 'landing z')
  near(Math.max(...trace.air.map(point => point.y)), estimate.apex, 0.5, 'apex')
  const rest = trace.ground[trace.ground.length - 1]
  near(Math.hypot(rest.x - landing.x, rest.z - landing.z), estimate.total - estimate.carry, 0.01, 'roll length')
  assert.ok([...trace.air, ...trace.ground].every((point, index, all) => index === 0 || point.t >= all[index - 1].t))
})
