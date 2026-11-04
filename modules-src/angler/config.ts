/** Northwoods Angler constants: asset paths, quality tiers and tuning that is not part of the shared rules. */
export const config = {
  title: 'Northwoods Angler',
  accent: '#3fb8a8',
  assets: '/modules/angler',
  skyRefreshSeconds: 90,
  weatherRefreshSeconds: 60,
}

export type QualityTier = 'low' | 'medium' | 'high'

export function pickQuality(): QualityTier {
  const forced = new URLSearchParams(location.search).get('quality')
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  const cores = navigator.hardwareConcurrency || 4
  if (mobile) return 'low'
  return cores >= 8 ? 'high' : 'medium'
}
