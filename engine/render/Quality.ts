/** Resolves the requested quality tier ('auto' picks per backend, ?quality= overrides) into concrete render settings. */
import type { QualityConfig, QualitySettings, QualityTier, RenderBackend } from '../config'

export interface ResolvedQuality {
  tier: QualityTier
  settings: QualitySettings
}

export function resolveQuality(config: QualityConfig, backend: RenderBackend): ResolvedQuality {
  const override = new URLSearchParams(location.search).get('quality')
  const requested = override && override in config.tiers ? (override as QualityTier) : config.requested
  const tier = requested === 'auto' ? config.autoTier[backend] : requested
  return { tier, settings: config.tiers[tier] }
}
