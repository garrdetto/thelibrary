import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { commandSteps, hostReport, openPulse, readHostSettings, syncHost } from './host-link.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDirectory = join(root, 'data')
const statePath = join(dataDirectory, 'watchdog.json')
const logPath = join(dataDirectory, 'watchdog.log')
const lockPath = join(dataDirectory, 'watchdog.lock')

export const trackerName = 'axiom-worker'
export const strikesBeforeRestart = 2
export const settleMs = 90_000
/** How long each run stays to take commands from the site; Windows starts the next run two minutes after the last. */
export const listenMs = 100_000
const listenEveryMs = 5_000
const reportEveryMs = 30_000

/**
 * Decides what the guard does with what PM2 reports. Nothing running at all: bring back the saved list. Tracker missing:
 * start it. Tracker crashed out: restart it. Tracker running but its local port silent on two checks in a row: restart it.
 * A tracker someone stopped on purpose is left alone.
 * @param {{ apps: Array<{ name: string, status: string, uptimeMs: number }>, probeAnswered: boolean, strikes: number }} input
 * @returns {{ action: 'none' | 'resurrect' | 'start-tracker' | 'restart-tracker', strikes: number, reason: string }}
 */
export function planAction({ apps, probeAnswered, strikes }) {
  if (!apps.length) return { action: 'resurrect', strikes: 0, reason: 'PM2 has nothing running' }
  const tracker = apps.find(app => app.name === trackerName)
  if (!tracker) return { action: 'start-tracker', strikes: 0, reason: 'The tracker is not in PM2' }
  if (tracker.status === 'errored') return { action: 'restart-tracker', strikes: 0, reason: 'The tracker crashed too many times and PM2 gave up' }
  if (tracker.status !== 'online' || tracker.uptimeMs < settleMs || probeAnswered) return { action: 'none', strikes: 0, reason: tracker.status === 'online' ? 'The tracker is running' : `The tracker is ${tracker.status}` }
  const next = strikes + 1
  if (next >= strikesBeforeRestart) return { action: 'restart-tracker', strikes: 0, reason: 'The tracker stopped answering' }
  return { action: 'none', strikes: next, reason: 'The tracker did not answer; checking again next time' }
}

/** The apps in `pm2 jlist` output, which can carry PM2's own notices before the list. */
export function parseApps(output, now = Date.now()) {
  const start = output.search(/\[\s*(\{|\])/)
  if (start < 0) return []
  try {
    return JSON.parse(output.slice(start)).map(app => ({
      name: String(app.name),
      status: String(app.pm2_env?.status ?? 'unknown'),
      uptimeMs: Math.max(0, now - Number(app.pm2_env?.pm_uptime ?? now)),
      restarts: Number(app.pm2_env?.restart_time) || 0,
      memoryMb: Number.isFinite(app.monit?.memory) ? Math.round(app.monit.memory / 1e6) : null,
    }))
  } catch {
    return []
  }
}

function pm2Path() {
  const local = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', 'pm2', 'bin', 'pm2') : ''
  return local && existsSync(local) ? local : null
}

function pm2(args) {
  const script = pm2Path()
  return new Promise(done => {
    if (!script) return done({ ok: false, output: 'PM2 is not installed (npm install -g pm2)' })
    execFile(process.execPath, [script, ...args], { cwd: root, windowsHide: true, timeout: 90_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => done({ ok: !error, output: `${stdout}${stderr}` }))
  })
}

function trackerPort() {
  const envFile = join(root, '.env')
  const line = existsSync(envFile) ? readFileSync(envFile, 'utf8').split(/\r?\n/).find(entry => entry.startsWith('AXIOM_EXTENSION_PORT=')) : undefined
  return Number(line?.split('=')[1]) || 8791
}

async function probe() {
  try {
    await fetch(`http://127.0.0.1:${trackerPort()}/probe`, { signal: AbortSignal.timeout(6_000) })
    return true
  } catch {
    return false
  }
}

function readState() {
  try { return JSON.parse(readFileSync(statePath, 'utf8')) } catch { return {} }
}

function log(message) {
  try {
    if (existsSync(logPath) && statSync(logPath).size > 200_000) writeFileSync(logPath, readFileSync(logPath, 'utf8').slice(-80_000))
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`)
  } catch { }
}

async function perform(step) {
  if (step === 'resurrect') {
    const restored = await pm2(['resurrect'])
    const after = parseApps((await pm2(['jlist'])).output)
    const started = after.some(app => app.name === trackerName) ? restored : await pm2(['start', 'ecosystem.axiom.config.js'])
    return started.ok ? 'brought back' : `failed: ${started.output.slice(-300)}`
  }
  if (step === 'start-tracker') {
    const started = await pm2(['start', 'ecosystem.axiom.config.js'])
    return started.ok ? 'started' : `failed: ${started.output.slice(-300)}`
  }
  if (step === 'restart-tracker') {
    const restarted = await pm2(['restart', trackerName])
    return restarted.ok ? 'restarted' : `failed: ${restarted.output.slice(-300)}`
  }
  if (step === 'open-pulse') {
    const opened = await openPulse()
    return opened.ok ? 'opened Axiom Pulse' : `failed: ${opened.output}`
  }
  return ''
}

const stepNames = { 'resurrect': 'Brought back PM2', 'start-tracker': 'Started the tracker', 'restart-tracker': 'Restarted the tracker', 'open-pulse': 'Opened Axiom Pulse' }

/** Runs one command from the site, reporting it as running first so a crash part-way never repeats it. */
async function runCommand(settings, command, state) {
  state.handled = command.id
  writeFileSync(statePath, JSON.stringify(state))
  await syncHost(settings, { result: { id: command.id, status: 'running', output: null } }).catch(() => { })
  const steps = commandSteps(command, parseApps((await pm2(['jlist'])).output), trackerName)
  const lines = []
  let ok = true
  for (const step of steps) {
    const outcome = await perform(step)
    if (outcome.startsWith('failed')) ok = false
    lines.push(outcome.startsWith('failed') ? `${stepNames[step]}: ${outcome}` : stepNames[step])
  }
  const output = lines.join('; ') || 'The tracker was already running; nothing to do'
  log(`Site asked to ${command.action}: ${output}`)
  state.lastAction = { at: Date.now(), reason: `Asked from the site (${command.action})`, outcome: output.slice(0, 400) }
  writeFileSync(statePath, JSON.stringify(state))
  return { id: command.id, status: ok ? 'done' : 'failed', output }
}

/** Stays for most of the two minutes between runs, checking every few seconds for a Turn on or Restart sent from the site. */
async function listen(started, state, firstReport) {
  const settings = readHostSettings(root)
  if (!settings) return
  let report = firstReport
  let reportedAt = Date.now()
  let pending = { report }
  while (Date.now() - started < listenMs) {
    writeFileSync(lockPath, String(process.pid))
    let wait = listenEveryMs
    try {
      const command = await syncHost(settings, pending)
      pending = {}
      if (command && command.id !== state.handled) {
        const result = await runCommand(settings, command, state)
        report = hostReport({ apps: parseApps((await pm2(['jlist'])).output), probeAnswered: await probe(), lastAction: state.lastAction })
        reportedAt = Date.now()
        pending = { report, result }
        continue
      }
    } catch {
      wait = 15_000
    }
    await new Promise(done => setTimeout(done, wait))
    if (Date.now() - reportedAt >= reportEveryMs) {
      report = hostReport({ apps: parseApps((await pm2(['jlist'])).output), probeAnswered: await probe(), lastAction: state.lastAction })
      reportedAt = Date.now()
    }
    pending = { ...pending, report }
  }
  if (pending.result) await syncHost(settings, pending).catch(() => { })
}

/** A lock left by a run that is still going; a finished run writes 0 so the next one is never skipped. */
function lockHeld() {
  if (!existsSync(lockPath)) return false
  try { if (readFileSync(lockPath, 'utf8').trim() === '0') return false } catch { }
  return Date.now() - statSync(lockPath).mtimeMs < 100_000
}

async function run() {
  const started = Date.now()
  mkdirSync(dataDirectory, { recursive: true })
  if (lockHeld()) return
  writeFileSync(lockPath, String(process.pid))
  const previous = readState()
  const listed = await pm2(['jlist'])
  const apps = parseApps(listed.output)
  const probeAnswered = await probe()
  const plan = planAction({ apps, probeAnswered, strikes: Number(previous.strikes) || 0 })
  const outcome = plan.action === 'none' ? '' : await perform(plan.action)
  if (plan.action !== 'none') log(`${plan.reason}: ${outcome}`)
  const lastAction = plan.action === 'none' ? previous.lastAction ?? null : { at: Date.now(), reason: plan.reason, outcome }
  const state = { at: Date.now(), strikes: plan.strikes, reason: plan.reason, lastAction, handled: previous.handled ?? null }
  writeFileSync(statePath, JSON.stringify(state))
  const now = plan.action === 'none' ? apps : parseApps((await pm2(['jlist'])).output)
  try {
    await listen(started, state, hostReport({ apps: now, probeAnswered: plan.action === 'none' ? probeAnswered : await probe(), lastAction }))
  } finally {
    writeFileSync(lockPath, '0')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => log(`The guard itself failed: ${error instanceof Error ? error.message : error}`)).finally(() => process.exit(0))
}
