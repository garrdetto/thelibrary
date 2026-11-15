import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { normalizeRadarSettings, type RadarSettings } from '../../src/lib/axiom-radar-settings.js'
import { createLogger } from './runtime.js'

const logger = createLogger('settings')
const settingsPath = resolve(process.env.AXIOM_SETTINGS_PATH ?? 'data/radar-settings.json')

function load(): RadarSettings {
  try { return normalizeRadarSettings(JSON.parse(readFileSync(settingsPath, 'utf8'))) } catch { return normalizeRadarSettings(null) }
}

let current = load()

export function radarSettings() {
  return current
}

export function applyRadarSettings(value: unknown) {
  const next = normalizeRadarSettings(value)
  if (!next.updatedAt || (current.updatedAt && next.updatedAt <= current.updatedAt)) return false
  current = next
  try {
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(current, null, 1))
  } catch { }
  logger.info('Applied new radar settings from the site', { updatedAt: current.updatedAt })
  return true
}
