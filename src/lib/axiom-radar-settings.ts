export type RadarRequirement = { enabled: boolean; value: number }

export type RadarThemeColors = { background: string; panel: string; text: string; muted: string; border: string; accent: string; up: string; down: string }
export type RadarThemePreset = 'site' | 'ocean' | 'neon' | 'mono' | 'custom'
export type RadarTheme = { preset: RadarThemePreset; custom: RadarThemeColors }

export const radarThemeColorInfo: Array<{ key: keyof RadarThemeColors; label: string }> = [
  { key: 'background', label: 'Background' },
  { key: 'panel', label: 'Panels and cards' },
  { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Secondary text' },
  { key: 'border', label: 'Borders' },
  { key: 'accent', label: 'Accent and buttons' },
  { key: 'up', label: 'Gains' },
  { key: 'down', label: 'Losses' },
]

export const radarThemePresets: Array<{ id: Exclude<RadarThemePreset, 'site' | 'custom'>; label: string; colors: RadarThemeColors }> = [
  { id: 'ocean', label: 'Dark blue & light blue', colors: { background: '#0a1628', panel: '#11213d', text: '#e8f1ff', muted: '#8ea6c9', border: '#22395f', accent: '#6cc4ff', up: '#3ddc97', down: '#ff6b7a' } },
  { id: 'neon', label: 'Dark blue & neon green', colors: { background: '#060d1f', panel: '#0d1830', text: '#eafff0', muted: '#8296b8', border: '#1b2c50', accent: '#39ff14', up: '#39ff14', down: '#ff4d6d' } },
  { id: 'mono', label: 'Black & light grey', colors: { background: '#050505', panel: '#131313', text: '#ececec', muted: '#9b9b9b', border: '#2b2b2b', accent: '#d6d6d6', up: '#4ade80', down: '#f87171' } },
]

/** The colours a theme resolves to, or null when the radar follows the site theme. */
export function radarThemeColors(theme: RadarTheme): RadarThemeColors | null {
  if (theme.preset === 'site') return null
  if (theme.preset === 'custom') return theme.custom
  return radarThemePresets.find(preset => preset.id === theme.preset)?.colors ?? null
}

export type RadarSettings = {
  maxAgeHours: RadarRequirement
  minViewers: RadarRequirement
  minVolume5m: RadarRequirement
  minTxns5m: RadarRequirement
  minLiquidity: RadarRequirement
  minBuyPercent: RadarRequirement
  safeOnly: boolean
  pulseBypassesMarket: boolean
  maxCoins: number
  buy: { minScore: number; minGain1mPercent: number; minGain5mPercent: number; minViewers: number; requireSafe: boolean }
  watch: { minScore: number; minGain5mPercent: number }
  surgeSensitivity: 1 | 2 | 3
  wallets: { minRunnerHits: number }
  pinned: string[]
  theme: RadarTheme
  updatedAt: number | null
}

export const defaultRadarSettings: RadarSettings = {
  maxAgeHours: { enabled: false, value: 24 },
  minViewers: { enabled: false, value: 10 },
  minVolume5m: { enabled: true, value: 3_000 },
  minTxns5m: { enabled: true, value: 40 },
  minLiquidity: { enabled: true, value: 3_000 },
  minBuyPercent: { enabled: true, value: 40 },
  safeOnly: false,
  pulseBypassesMarket: true,
  maxCoins: 60,
  buy: { minScore: 70, minGain1mPercent: 2, minGain5mPercent: 5, minViewers: 50, requireSafe: true },
  watch: { minScore: 55, minGain5mPercent: 10 },
  surgeSensitivity: 2,
  wallets: { minRunnerHits: 2 },
  pinned: [],
  theme: { preset: 'site', custom: { background: '#0a1628', panel: '#11213d', text: '#e8f1ff', muted: '#8ea6c9', border: '#22395f', accent: '#6cc4ff', up: '#3ddc97', down: '#ff6b7a' } },
  updatedAt: null,
}

export type RadarRequirementKey = 'maxAgeHours' | 'minViewers' | 'minVolume5m' | 'minTxns5m' | 'minLiquidity' | 'minBuyPercent'

export const radarRequirementInfo: Array<{ key: RadarRequirementKey; label: string; unit: string; step: number; max: number }> = [
  { key: 'maxAgeHours', label: 'Maximum coin age', unit: 'hours', step: 1, max: 10_000 },
  { key: 'minViewers', label: 'Minimum Axiom viewers', unit: 'viewers', step: 5, max: 100_000 },
  { key: 'minVolume5m', label: 'Minimum 5-minute volume', unit: 'USD', step: 500, max: 100_000_000 },
  { key: 'minTxns5m', label: 'Minimum 5-minute trades', unit: 'trades', step: 10, max: 1_000_000 },
  { key: 'minLiquidity', label: 'Minimum liquidity', unit: 'USD', step: 500, max: 1_000_000_000 },
  { key: 'minBuyPercent', label: 'Minimum share of buys (5 min)', unit: '%', step: 1, max: 100 },
]

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, number))
}

function requirement(value: unknown, fallback: RadarRequirement, max: number): RadarRequirement {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<RadarRequirement>
  return { enabled: typeof input.enabled === 'boolean' ? input.enabled : fallback.enabled, value: clampNumber(input.value, fallback.value, 0, max) }
}

export function normalizeRadarSettings(value: unknown): RadarSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<RadarSettings>
  const defaults = defaultRadarSettings
  const buy = (input.buy ?? {}) as Partial<RadarSettings['buy']>
  const watch = (input.watch ?? {}) as Partial<RadarSettings['watch']>
  const wallets = (input.wallets ?? {}) as Partial<RadarSettings['wallets']>
  const settings = { ...defaults } as RadarSettings
  for (const info of radarRequirementInfo) settings[info.key] = requirement(input[info.key], defaults[info.key], info.max)
  settings.safeOnly = typeof input.safeOnly === 'boolean' ? input.safeOnly : defaults.safeOnly
  settings.pulseBypassesMarket = typeof input.pulseBypassesMarket === 'boolean' ? input.pulseBypassesMarket : defaults.pulseBypassesMarket
  settings.maxCoins = Math.round(clampNumber(input.maxCoins, defaults.maxCoins, 5, 150))
  settings.buy = {
    minScore: clampNumber(buy.minScore, defaults.buy.minScore, 0, 100),
    minGain1mPercent: clampNumber(buy.minGain1mPercent, defaults.buy.minGain1mPercent, -100, 10_000),
    minGain5mPercent: clampNumber(buy.minGain5mPercent, defaults.buy.minGain5mPercent, -100, 10_000),
    minViewers: clampNumber(buy.minViewers, defaults.buy.minViewers, 0, 100_000),
    requireSafe: typeof buy.requireSafe === 'boolean' ? buy.requireSafe : defaults.buy.requireSafe,
  }
  settings.watch = {
    minScore: clampNumber(watch.minScore, defaults.watch.minScore, 0, 100),
    minGain5mPercent: clampNumber(watch.minGain5mPercent, defaults.watch.minGain5mPercent, -100, 10_000),
  }
  settings.surgeSensitivity = input.surgeSensitivity === 1 || input.surgeSensitivity === 3 ? input.surgeSensitivity : 2
  settings.wallets = { minRunnerHits: Math.round(clampNumber(wallets.minRunnerHits, defaults.wallets.minRunnerHits, 1, 20)) }
  settings.pinned = Array.isArray(input.pinned) ? [...new Set(input.pinned.filter((mint): mint is string => typeof mint === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)))].slice(0, 50) : []
  const theme = (input.theme && typeof input.theme === 'object' ? input.theme : {}) as Partial<RadarTheme>
  const custom = (theme.custom && typeof theme.custom === 'object' ? theme.custom : {}) as Partial<RadarThemeColors>
  const hex = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback
  settings.theme = {
    preset: theme.preset === 'ocean' || theme.preset === 'neon' || theme.preset === 'mono' || theme.preset === 'custom' ? theme.preset : 'site',
    custom: Object.fromEntries(radarThemeColorInfo.map(({ key }) => [key, hex(custom[key], defaults.theme.custom[key])])) as RadarThemeColors,
  }
  settings.updatedAt = typeof input.updatedAt === 'number' ? input.updatedAt : null
  return settings
}
