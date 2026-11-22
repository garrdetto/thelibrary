/**
 * Truck Simulator's four graphics tiers and what each one turns on: the render-line cap the page's resolution control applies,
 * sun shadows (none, one fitted map, or cascades with soft contact-hardening edges on ultra), how far the world streams and how
 * dense its trees are, anti-aliasing (FXAA or 4× MSAA, the most WebGPU allows), bloom, sharpening and SSAO. `resolveTier` picks a
 * tier from `?quality=` or, without it, from the backend and the device. Renderer-free.
 */
import type { Backend } from '../../rackreel/core/Backend'

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra'

export const QUALITY_TIERS: readonly QualityTier[] = ['low', 'medium', 'high', 'ultra']

export type ShadowMode = 'off' | 'single' | 'cascaded'

/** Everything one tier sets. Distances are metres, radii are 256 m chunks. */
export interface QualitySettings {
  tier: QualityTier
  /** Most lines the frame is rendered at (pass to the page's `Resolution.setCap`). */
  renderLines: number
  shadows: ShadowMode
  /** Shadow map size in texels (each cascade on the cascaded tiers). */
  shadowMapSize: number
  /** Number of cascades (1 for the single fitted map, 0 without shadows). */
  shadowCascades: number
  /** How far from the camera sun shadows reach. */
  shadowDistance: number
  /** Percentage-closer soft shadows with contact hardening (ultra). */
  softShadows: boolean
  /** Streaming radius in chunks; chunks farther than this plus one ring are unloaded. */
  streamRadius: number
  /** MSAA samples on the HDR target (1 or 4: WebGPU supports no other counts). */
  msaa: number
  fxaa: boolean
  bloom: boolean
  /** Sharpen post-process edge amount (0 turns it off). */
  sharpen: number
  ssao: boolean
  /** Share of the full tree and prop placement kept (lower tiers keep a subset of the same spots). */
  propDensity: number
  /** Trees use their detailed model while their chunk is this close, their simple one out to `treeFar`. */
  treeNear: number
  treeFar: number
  /** Power-line wires are drawn while their chunk is this close. */
  wireRange: number
  /** Texels per face of the sky environment cube the PBR materials reflect. */
  environmentSize: number
  /** Ceiling for the thin-instance gauge reported to the MemoryGuard. */
  instanceBudget: number
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    tier: 'low', renderLines: 720, shadows: 'off', shadowMapSize: 1024, shadowCascades: 0, shadowDistance: 0, softShadows: false,
    streamRadius: 3, msaa: 1, fxaa: true, bloom: false, sharpen: 0, ssao: false, propDensity: 0.45, treeNear: 120, treeFar: 560,
    wireRange: 160, environmentSize: 16, instanceBudget: 60000,
  },
  medium: {
    tier: 'medium', renderLines: 1080, shadows: 'single', shadowMapSize: 2048, shadowCascades: 1, shadowDistance: 150, softShadows: false,
    streamRadius: 4, msaa: 1, fxaa: true, bloom: true, sharpen: 0.22, ssao: false, propDensity: 0.75, treeNear: 170, treeFar: 760,
    wireRange: 220, environmentSize: 32, instanceBudget: 110000,
  },
  high: {
    tier: 'high', renderLines: 1440, shadows: 'cascaded', shadowMapSize: 2048, shadowCascades: 3, shadowDistance: 420, softShadows: false,
    streamRadius: 5, msaa: 4, fxaa: false, bloom: true, sharpen: 0.15, ssao: true, propDensity: 1, treeNear: 220, treeFar: 1000,
    wireRange: 280, environmentSize: 32, instanceBudget: 170000,
  },
  ultra: {
    tier: 'ultra', renderLines: 2160, shadows: 'cascaded', shadowMapSize: 4096, shadowCascades: 4, shadowDistance: 640, softShadows: true,
    streamRadius: 6, msaa: 4, fxaa: true, bloom: true, sharpen: 0.12, ssao: true, propDensity: 1, treeNear: 300, treeFar: 1300,
    wireRange: 340, environmentSize: 64, instanceBudget: 230000,
  },
}

/** What the page knows about the device; every field is optional. */
export interface DeviceHints {
  mobile?: boolean
  /** `navigator.deviceMemory` in gigabytes. */
  memoryGb?: number
  /** `navigator.hardwareConcurrency`. */
  cores?: number
}

/** Reads `navigator` when there is one (empty hints in Node). */
export function deviceHints(): DeviceHints {
  if (typeof navigator === 'undefined') return {}
  const info = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } }
  const mobile = info.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(info.userAgent ?? '')
  return { mobile, memoryGb: info.deviceMemory, cores: info.hardwareConcurrency }
}

function parseTier(value: string | null): QualityTier | null {
  if (!value) return null
  const lower = value.trim().toLowerCase()
  if (lower === 'med') return 'medium'
  if (lower === 'max') return 'ultra'
  return (QUALITY_TIERS as readonly string[]).includes(lower) ? (lower as QualityTier) : null
}

/**
 * `?quality=low|medium|high|ultra` (also `med`, `max`) wins. Otherwise WebGPU starts on high and WebGL2 on medium, phones and
 * devices reporting under 4 GB or 4 cores go one tier lower, and 16 GB with 12+ cores on WebGPU goes to ultra.
 */
export function resolveTier(search: string, backend: Backend, hints: DeviceHints = deviceHints()): QualityTier {
  const asked = parseTier(new URLSearchParams(search).get('quality'))
  if (asked) return asked
  let tier: QualityTier = backend === 'webgpu' ? 'high' : 'medium'
  const weak = hints.mobile === true || (hints.memoryGb !== undefined && hints.memoryGb < 4) || (hints.cores !== undefined && hints.cores < 4)
  if (weak) return lowerTier(tier)
  if (backend === 'webgpu' && (hints.memoryGb ?? 0) >= 16 && (hints.cores ?? 0) >= 12) tier = 'ultra'
  return tier
}

/** A tier's settings (a fresh copy, safe to adjust). */
export function qualitySettings(tier: QualityTier): QualitySettings {
  return { ...QUALITY[tier] }
}

/** The next tier down, or low. */
export function lowerTier(tier: QualityTier): QualityTier {
  const index = QUALITY_TIERS.indexOf(tier)
  return QUALITY_TIERS[Math.max(0, index - 1)]
}

/** The next tier up, or ultra. */
export function higherTier(tier: QualityTier): QualityTier {
  const index = QUALITY_TIERS.indexOf(tier)
  return QUALITY_TIERS[Math.min(QUALITY_TIERS.length - 1, index + 1)]
}
