export type Tier = 'low' | 'medium' | 'high' | 'ultra'

/** What each quality tier turns on (Phase 3 of docs/shorttrack/PLAN.md). */
export type TierSettings = {
  /** MSAA samples on the HDR target (TAA replaces MSAA on the tiers that use it). */
  msaa: number
  fxaa: boolean
  /** 'single': one fitted shadow map like classic; 'cascaded': four cascades with soft contact-hardening edges. */
  shadows: 'off' | 'single' | 'cascaded'
  shadowSize: number
  /** Off on every tier for now: with the cascaded shadows it darkens the rear-view mirror's render target (`?fx=+ssao` to test). */
  ssao: boolean
  taa: boolean
  /** Off on every tier for now: Babylon's blur misreads the three-driven camera's history (`?fx=+motionBlur` to test). */
  motionBlur: boolean
  /** Metallic flake under clear coats, tire sheen and the asphalt detail normals. */
  surfaceDetail: boolean
  /** Point lights at the night light towers (clustered on WebGPU). */
  nightLights: boolean
  crowdMotion: boolean
}

export const TIERS: Record<Tier, TierSettings> = {
  low: { msaa: 1, fxaa: true, shadows: 'off', shadowSize: 1024, ssao: false, taa: false, motionBlur: false, surfaceDetail: false, nightLights: false, crowdMotion: false },
  medium: { msaa: 4, fxaa: false, shadows: 'single', shadowSize: 2048, ssao: false, taa: false, motionBlur: false, surfaceDetail: true, nightLights: true, crowdMotion: true },
  high: { msaa: 1, fxaa: false, shadows: 'cascaded', shadowSize: 2048, ssao: false, taa: true, motionBlur: false, surfaceDetail: true, nightLights: true, crowdMotion: true },
  ultra: { msaa: 1, fxaa: false, shadows: 'cascaded', shadowSize: 4096, ssao: false, taa: true, motionBlur: false, surfaceDetail: true, nightLights: true, crowdMotion: true },
}

/** `?quality=low|medium|high|ultra` wins; otherwise the module's own Graphics quality setting (low/med/high). */
export function tierOf(search: string, classic: string): Tier {
  const q = new URLSearchParams(search).get('quality')
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') return q
  return classic === 'low' ? 'low' : classic === 'high' ? 'high' : 'medium'
}

/**
 * The tier's settings with `?fx=` switches applied: a comma list like `-ssao,-taa,+motionBlur` turns single
 * effects off or on (for comparisons and when an effect misbehaves on a GPU).
 */
export function settingsOf(tier: Tier, search: string): TierSettings {
  const s = { ...TIERS[tier] }
  for (const part of (new URLSearchParams(search).get('fx') ?? '').split(',')) {
    const key = part.slice(1) as keyof TierSettings, on = part[0] === '+'
    if ((part[0] === '+' || part[0] === '-') && typeof s[key] === 'boolean') (s as Record<string, unknown>)[key] = on
  }
  return s
}

/** Khronos PBR Neutral by default; `?tonemap=aces` gives three's look. */
export function toneMapOf(search: string): 'neutral' | 'aces' {
  return new URLSearchParams(search).get('tonemap') === 'aces' ? 'aces' : 'neutral'
}
