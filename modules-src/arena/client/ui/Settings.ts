const SENSITIVITY_KEY = 'tl-arena-sensitivity'
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
