import { radarThemeColors, type RadarTheme } from '@/lib/axiom-radar-settings'

const themeVariables = ['--rt-bg', '--rt-surface', '--rt-text', '--rt-muted', '--rt-border', '--rt-accent', '--rt-up', '--rt-down', '--rt-on-accent', '--rt-on-up'] as const

function luminance(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255
}

const readableOn = (hex: string) => luminance(hex) > 0.55 ? '#0b0b0b' : '#ffffff'

/** Applies a radar colour theme to the standalone page, or clears it so the page follows the site theme. Returns a cleanup. */
export function applyRadarTheme(theme: RadarTheme) {
  const root = document.querySelector<HTMLElement>('.radar-page')
  if (!root) return () => undefined
  const clear = () => {
    delete root.dataset.radarTheme
    for (const name of themeVariables) root.style.removeProperty(name)
    root.style.removeProperty('color-scheme')
    document.body.style.removeProperty('background')
  }
  const colors = radarThemeColors(theme)
  if (!colors) {
    clear()
    return () => undefined
  }
  root.dataset.radarTheme = theme.preset
  const values: Record<(typeof themeVariables)[number], string> = {
    '--rt-bg': colors.background,
    '--rt-surface': colors.panel,
    '--rt-text': colors.text,
    '--rt-muted': colors.muted,
    '--rt-border': colors.border,
    '--rt-accent': colors.accent,
    '--rt-up': colors.up,
    '--rt-down': colors.down,
    '--rt-on-accent': readableOn(colors.accent),
    '--rt-on-up': readableOn(colors.up),
  }
  for (const name of themeVariables) root.style.setProperty(name, values[name])
  root.style.setProperty('color-scheme', luminance(colors.background) < 0.45 ? 'dark' : 'light')
  document.body.style.background = colors.background
  return clear
}
