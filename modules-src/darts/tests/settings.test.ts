import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDEAL_SPEED, METER, crossMiss, launch, meterReach, meterZone } from '../shared/Physics'
import { createRng } from '../shared/Rng'
import { DEFAULT_SETTINGS, applyMeterSettings, changedSettings, meterChoice, sameSettings, sanitizeSettings } from '../shared/Settings'

const BUILT = JSON.parse(JSON.stringify(METER))

const speeds = Array.from({ length: 61 }, (_, i) => IDEAL_SPEED * (0.7 + i * 0.5 / 60))

test('settings: the defaults are the module as built', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(sanitizeSettings({}), DEFAULT_SETTINGS)
  assert.deepEqual(changedSettings(DEFAULT_SETTINGS), [])
  assert.equal(DEFAULT_SETTINGS.meter.classic, 'off')
  assert.equal(DEFAULT_SETTINGS.meter.chargeSeconds, 1.76)
  assert.equal(DEFAULT_SETTINGS.meter.chargeLow, 0.7)
  assert.equal(DEFAULT_SETTINGS.meter.chargeHigh, 1.2)
  assert.deepEqual(DEFAULT_SETTINGS.darts.flightColors, ['#ff4d5e', '#39d0ff', '#ffcf4a', '#7cdc6a'])
  assert.ok(Math.abs(DEFAULT_SETTINGS.meter.perfectWindow - 0.0024) < 0.00005, 'the Perfect window is ±0.24 %')
})

test('settings: applying the defaults leaves the meter bit for bit as built', () => {
  const reach = speeds.map((speed) => meterReach(speed, 'normal'))
  const zones = speeds.map((speed) => meterZone(speed))
  const cross = speeds.map((speed) => crossMiss(speed, (speed / IDEAL_SPEED - 1) * 0.8, 'normal'))
  const flights = speeds.map((speed, i) => launch({ aimX: 0.01, aimY: 0.1, speed, yaw: 0, wobble: 0.12 }, 'normal', createRng(1000 + i)))
  applyMeterSettings(sanitizeSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS))).meter)
  assert.deepEqual(JSON.parse(JSON.stringify(METER)), BUILT)
  assert.deepEqual(speeds.map((speed) => meterReach(speed, 'normal')), reach)
  assert.deepEqual(speeds.map((speed) => meterZone(speed)), zones)
  assert.deepEqual(speeds.map((speed) => crossMiss(speed, (speed / IDEAL_SPEED - 1) * 0.8, 'normal')), cross)
  assert.deepEqual(speeds.map((speed, i) => launch({ aimX: 0.01, aimY: 0.1, speed, yaw: 0, wobble: 0.12 }, 'normal', createRng(1000 + i))), flights)
})

test('settings: the sanitizer clamps, drops junk and keeps the zones in order', () => {
  const messy = sanitizeSettings({
    meter: { chargeSeconds: 99, chargeLow: 'fast', perfectWindow: 0.02, green: 0.01, fade: 0.005, band: 0.004, sideRange: 0.01, classic: 'sometimes', extra: 1 },
    defaults: { board: 'cork', cpuLevel: 'pro', doubleBull: 'yes' },
    steel: { red: '#ABCDEF', cream: 'red', wire: '#12345' },
    spider: { housing: '#000000' },
    darts: { flightColors: ['#000000', 42], steelFinish: 'chrome', softFinish: 'matte', softPlayerFlights: true },
  })
  assert.equal(messy.meter.chargeSeconds, 4)
  assert.equal(messy.meter.chargeLow, DEFAULT_SETTINGS.meter.chargeLow)
  assert.equal(messy.meter.classic, 'off')
  assert.ok(messy.meter.green >= messy.meter.perfectWindow)
  assert.ok(messy.meter.fade > messy.meter.green)
  assert.ok(messy.meter.band > messy.meter.fade)
  assert.ok(messy.meter.sideRange > messy.meter.band)
  assert.ok(messy.meter.chargeLow < 1 - messy.meter.band)
  assert.ok(messy.meter.chargeHigh > 1 + messy.meter.band)
  assert.equal(messy.defaults.board, 'spider')
  assert.equal(messy.defaults.cpuLevel, 'pro')
  assert.equal(messy.defaults.doubleBull, true)
  assert.equal(messy.steel.red, '#abcdef')
  assert.equal(messy.steel.cream, DEFAULT_SETTINGS.steel.cream)
  assert.equal(messy.steel.wire, DEFAULT_SETTINGS.steel.wire)
  assert.equal(messy.spider.housing, '#000000')
  assert.deepEqual(messy.darts.flightColors, ['#000000', '#39d0ff', '#ffcf4a', '#7cdc6a'])
  assert.equal(messy.darts.steelFinish, 'stock')
  assert.equal(messy.darts.softFinish, 'matte')
  assert.equal(messy.darts.softPlayerFlights, true)
  assert.ok(!('extra' in messy.meter))
  assert.ok(sameSettings(sanitizeSettings(messy), messy), 'sanitizing is idempotent')
  assert.ok(changedSettings(messy).includes('steel.red'))
})

test('settings: a wider Perfect window and green change the meter, and the defaults put it back', () => {
  const wide = sanitizeSettings({ meter: { perfectWindow: 0.01, green: 0.02, fade: 0.04, band: 0.1, redScale: 0 } }).meter
  applyMeterSettings(wide)
  assert.equal(METER.perfect, 0.02)
  assert.ok(Math.abs(METER.exact * METER.perfect - 0.01) < 1e-12)
  assert.equal(meterZone(IDEAL_SPEED * 1.009), 'perfect')
  assert.equal(meterReach(IDEAL_SPEED * 1.009, 'normal'), 0)
  const hard = launch({ aimX: 0, aimY: 0, speed: IDEAL_SPEED * 1.18, yaw: 0, wobble: 0, cross: 0 }, 'normal', createRng(3))
  assert.ok(Math.abs(Math.hypot(...hard.velocity) - IDEAL_SPEED) < 1e-9, 'red drop or lift off: the dart flies at the ideal speed')
  applyMeterSettings(DEFAULT_SETTINGS.meter)
  assert.deepEqual(JSON.parse(JSON.stringify(METER)), BUILT)
})

test('settings: the classic meter modes', () => {
  assert.deepEqual(meterChoice('off'), { offered: false, fallback: 'cross' })
  assert.deepEqual(meterChoice('option'), { offered: true, fallback: 'cross' })
  assert.deepEqual(meterChoice('default'), { offered: true, fallback: 'classic' })
  assert.deepEqual(meterChoice('only'), { offered: false, fallback: 'classic' })
})
