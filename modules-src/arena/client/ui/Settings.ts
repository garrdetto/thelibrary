const SENSITIVITY_KEY = 'tl-arena-sensitivity'
const GRAPHICS_KEY = 'tl-arena-graphics'

export type ArenaGraphics = 'low' | 'high'

/** The Graphics setting: low (the default) renders at one pixel per CSS pixel with no shadows; high is the full picture. */
export function loadGraphics(): ArenaGraphics {
  try {
    const asked = new URLSearchParams(location.search).get('quality')
    if (asked === 'low' || asked === 'high') return asked
    return localStorage.getItem(GRAPHICS_KEY) === 'high' ? 'high' : 'low'
  } catch {
    return 'low'
  }
}

export function saveGraphics(value: ArenaGraphics): void {
  try {
    localStorage.setItem(GRAPHICS_KEY, value)
  } catch {
    return
  }
}
export const SENSITIVITY_MIN = 0.2
export const SENSITIVITY_MAX = 3

export function clampSensitivity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, value))
}

export function loadSensitivity(): number {
  try {
    const saved = localStorage.getItem(SENSITIVITY_KEY)
    return saved === null ? 1 : clampSensitivity(Number(saved))
  } catch {
    return 1
  }
}

export function saveSensitivity(value: number): void {
  try {
    localStorage.setItem(SENSITIVITY_KEY, String(clampSensitivity(value)))
  } catch {
    return
  }
}
