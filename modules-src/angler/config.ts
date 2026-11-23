/** Northwoods Angler constants: asset paths, quality tiers and tuning that is not part of the shared rules. */
export const config = {
  title: 'Northwoods Angler',
  accent: '#3fb8a8',
  assets: '/modules/angler',
  skyRefreshSeconds: 90,
  weatherRefreshSeconds: 60,
}

export type QualityTier = 'low' | 'medium' | 'high'

const QUALITY_KEY = 'angler/quality'
const isTier = (value: string | null): value is QualityTier => value === 'low' || value === 'medium' || value === 'high'

export function pickQuality(): QualityTier {
  const forced = new URLSearchParams(location.search).get('quality')
  if (isTier(forced)) return forced
  try {
    const saved = localStorage.getItem(QUALITY_KEY)
    if (isTier(saved)) return saved
  } catch {}
  return 'low'
}

export function saveQuality(tier: QualityTier): void {
  try {
    localStorage.setItem(QUALITY_KEY, tier)
  } catch {}
}
