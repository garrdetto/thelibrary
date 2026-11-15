import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseApps, planAction, settleMs, strikesBeforeRestart, trackerName } from './watchdog.mjs'

const running = { name: trackerName, status: 'online', uptimeMs: settleMs + 1 }
const bot = { name: 'axiom-paper-bot', status: 'online', uptimeMs: settleMs + 1 }

test('nothing in PM2 brings back the saved list', () => {
  assert.equal(planAction({ apps: [], probeAnswered: false, strikes: 0 }).action, 'resurrect')
})

test('a missing tracker is started even when the bot is running', () => {
  assert.equal(planAction({ apps: [bot], probeAnswered: false, strikes: 0 }).action, 'start-tracker')
})

test('a tracker PM2 gave up on is restarted', () => {
  assert.equal(planAction({ apps: [{ ...running, status: 'errored' }], probeAnswered: false, strikes: 0 }).action, 'restart-tracker')
})

test('a tracker stopped on purpose is left alone', () => {
  assert.equal(planAction({ apps: [{ ...running, status: 'stopped' }], probeAnswered: false, strikes: 1 }).action, 'none')
})

test('a healthy tracker clears its strikes', () => {
  assert.deepEqual(planAction({ apps: [running, bot], probeAnswered: true, strikes: 1 }), { action: 'none', strikes: 0, reason: 'The tracker is running' })
})

test('a silent tracker is restarted only after two checks in a row', () => {
  const first = planAction({ apps: [running], probeAnswered: false, strikes: 0 })
  assert.deepEqual([first.action, first.strikes], ['none', 1])
  const second = planAction({ apps: [running], probeAnswered: false, strikes: first.strikes })
  assert.deepEqual([second.action, second.strikes], ['restart-tracker', 0])
  assert.equal(strikesBeforeRestart, 2)
})

test('a tracker that only just started is given time to open its port', () => {
  assert.deepEqual(planAction({ apps: [{ ...running, uptimeMs: 20_000 }], probeAnswered: false, strikes: 1 }).action, 'none')
})

test('reads the PM2 list past its own notices', () => {
  const now = 1_800_000_000_000
  const output = `[PM2] Spawning PM2 daemon with pm2_home=C:\\Users\\someone\\.pm2\n[PM2] PM2 Successfully daemonized\n${JSON.stringify([{ name: trackerName, pm2_env: { status: 'online', pm_uptime: now - 5_000 } }])}`
  assert.deepEqual(parseApps(output, now), [{ name: trackerName, status: 'online', uptimeMs: 5_000 }])
  assert.deepEqual(parseApps('[PM2] Spawning PM2 daemon\n[]', now), [])
  assert.deepEqual(parseApps('not a list', now), [])
})
