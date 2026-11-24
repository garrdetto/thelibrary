import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

export const pulseUrl = 'https://axiom.trade/pulse'
export const defaultSiteOrigin = 'https://thelibrary.garrdetto.workers.dev'

/** The site address and the tracker's upload token from the tracker folder's `.env`, the same ones the tracker itself uses. */
export function readHostSettings(root) {
  const file = join(root, '.env')
  let values = {}
  try { values = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {} } catch { values = {} }
  const token = String(process.env.AXIOM_RADAR_TOKEN ?? values.AXIOM_RADAR_TOKEN ?? '').trim()
  const origin = String(process.env.AXIOM_SITE_ORIGIN ?? values.AXIOM_SITE_ORIGIN ?? '').trim() || defaultSiteOrigin
  return token.length >= 24 ? { token, origin: origin.replace(/\/$/, '') } : null
}

/**
 * The steps that carry out a command sent from the site. Turn on starts whatever is not running and leaves a running tracker alone;
 * Restart always restarts it (or starts it when PM2 has lost it). Either opens an Axiom Pulse tab when the site asked for one.
 * @param {{ action: 'start' | 'restart' | 'open-pulse', openPulse: boolean }} command
 * @param {Array<{ name: string, status: string }>} apps
 * @param {string} trackerName
 * @returns {Array<'resurrect' | 'start-tracker' | 'restart-tracker' | 'open-pulse'>}
 */
export function commandSteps(command, apps, trackerName) {
  const steps = []
  if (command.action !== 'open-pulse') {
    const tracker = apps.find(app => app.name === trackerName)
    if (!apps.length) steps.push('resurrect')
    else if (!tracker) steps.push('start-tracker')
    else if (command.action === 'restart' || tracker.status !== 'online') steps.push('restart-tracker')
  }
  if (command.openPulse || command.action === 'open-pulse') steps.push('open-pulse')
  return steps
}

export function hostReport({ apps, probeAnswered, lastAction, now = Date.now() }) {
  return {
    at: now,
    host: hostname().slice(0, 80),
    daemon: apps.length > 0,
    probeAnswered,
    apps: apps.map(app => ({ name: app.name, status: app.status, uptimeMs: app.uptimeMs, restarts: app.restarts ?? 0, memoryMb: app.memoryMb ?? null })),
    lastAction: lastAction ?? null,
  }
}

/** Sends the PC's state (and a command's outcome) to the site and returns the command waiting for this PC, if any. */
export async function syncHost(settings, body) {
  const response = await fetch(`${settings.origin}/api/admin/axiom/host/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
  return result.command ?? null
}

function chromePath() {
  const places = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  return places.map(place => join(place, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(path => existsSync(path)) ?? null
}

/** Opens Axiom Pulse in the owner's Chrome, where the bridge extension reads it. A running Chrome just gets a new tab. */
export function openPulse() {
  return new Promise(done => {
    const chrome = chromePath()
    const child = chrome
      ? spawn(chrome, [pulseUrl], { detached: true, stdio: 'ignore' })
      : spawn('cmd.exe', ['/d', '/s', '/c', `start "" chrome "${pulseUrl}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, windowsHide: true })
    child.once('error', error => done({ ok: false, output: `Could not open Chrome: ${error.message}` }))
    child.once('spawn', () => { child.unref(); done({ ok: true, output: 'Opened Axiom Pulse in Chrome' }) })
  })
}
