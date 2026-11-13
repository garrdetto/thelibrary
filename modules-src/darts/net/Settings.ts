/** Loads the administrator's Darts settings from `/api/darts-settings` before the page builds the board, darts and meter. Falls back to the defaults (the module as built) when the request fails or takes longer than `timeoutMs`. */
import { DEFAULT_SETTINGS, sanitizeSettings, type DartsSettings } from '../shared/Settings'

export async function loadDartsSettings(timeoutMs = 2500): Promise<DartsSettings> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('/api/darts-settings', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
    if (!response.ok) return DEFAULT_SETTINGS
    const data = (await response.json()) as { settings?: unknown }
    return sanitizeSettings(data.settings)
  } catch {
    return DEFAULT_SETTINGS
  } finally {
    clearTimeout(timer)
  }
}
