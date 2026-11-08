/** Broadcast looks: time-of-day lighting presets, per-tier render budgets and the signature park themes. Pure data; view/ applies it. */
import type { PostEffects, QualityTier } from '../../engine'
import type { TextureDetail } from './view/Textures'

export type TimeOfDay = 'day' | 'dusk' | 'night'

export interface LightPreset {
  label: string
  sky: { top: string; horizon: string; ground: string }
  sunColor: string
  sunIntensity: number
  sunDirection: readonly [number, number, number]
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  fog: string
  exposure: number
  environment: number
  /** Stadium light banks: 0 off, 1 full night output. */
  banks: number
  lampGlow: number
}

export const LIGHT_PRESETS: Readonly<Record<TimeOfDay, LightPreset>> = {
  day: {
    label: 'Day',
    sky: { top: '#2f6fc7', horizon: '#b8d4f2', ground: '#24331f' },
    sunColor: '#fff3df',
    sunIntensity: 3.2,
    sunDirection: [-0.45, 1, 0.3],
    hemiSky: '#c4dcff',
    hemiGround: '#2b3a22',
    hemiIntensity: 1.0,
    fog: '#b9cde6',
    exposure: 0.9,
    environment: 0.7,
    banks: 0,
    lampGlow: 0.4,
  },
  dusk: {
    label: 'Golden hour',
    sky: { top: '#2b2f6e', horizon: '#f2a066', ground: '#2a1f1a' },
    sunColor: '#ffb070',
    sunIntensity: 2.6,
    sunDirection: [-0.9, 0.22, 0.25],
    hemiSky: '#ffc59a',
    hemiGround: '#3a2a20',
    hemiIntensity: 0.75,
    fog: '#c98a6a',
    exposure: 1.0,
    environment: 0.55,
    banks: 0.45,
    lampGlow: 2.5,
  },
  night: {
    label: 'Night',
    sky: { top: '#03060f', horizon: '#18233f', ground: '#06080c' },
    sunColor: '#c8d6ff',
    sunIntensity: 0.12,
    sunDirection: [0.3, 1, -0.4],
    hemiSky: '#3d4f7a',
    hemiGround: '#141a10',
    hemiIntensity: 0.35,
    fog: '#0c1222',
    exposure: 1.15,
    environment: 0.3,
    banks: 1,
    lampGlow: 9,
  },
}

export interface TierBudget {
  post: PostEffects | null
  cascades: number
  grassBlades: number
  crowd: number
  bankLights: number
  bankShadows: boolean
  pixelRatio: number
  adaptive: boolean
  /** Resolution and filtering for the painted surface textures (`view/Textures.ts`). */
  textures: TextureDetail
}

const BLOOM = { strength: 0.32, radius: 0.55, threshold: 0.9 }

export const TIER_BUDGETS: Readonly<Record<QualityTier, TierBudget>> = {
  low: { post: null, cascades: 0, grassBlades: 0, crowd: 4000, bankLights: 2, bankShadows: false, pixelRatio: 1, adaptive: true, textures: { size: 512, anisotropy: 2 } },
  medium: { post: { bloom: BLOOM, vignette: 0.25 }, cascades: 0, grassBlades: 12000, crowd: 12000, bankLights: 4, bankShadows: false, pixelRatio: 1.25, adaptive: true, textures: { size: 1024, anisotropy: 4 } },
  high: {
    post: { ao: { radius: 0.6, thickness: 1.5, intensity: 0.75, resolutionScale: 0.5, samples: 12 }, taa: true, bloom: BLOOM, flare: { threshold: 0.85, ghostSamples: 4, ghostSpacing: 0.3, ghostAttenuation: 25, strength: 0.35 }, vignette: 0.3, dof: { focalLength: 6, bokehScale: 2.5 } },
    cascades: 4,
    grassBlades: 60000,
    crowd: 24000,
    bankLights: 6,
    bankShadows: false,
    pixelRatio: 1.75,
    adaptive: true,
    textures: { size: 2048, anisotropy: 8 },
  },
  ultra: {
    post: { ao: { radius: 0.7, thickness: 1.5, intensity: 0.85, resolutionScale: 1, samples: 16 }, taa: true, bloom: BLOOM, flare: { threshold: 0.8, ghostSamples: 5, ghostSpacing: 0.28, ghostAttenuation: 22, strength: 0.4 }, vignette: 0.3, grain: 0.08, dof: { focalLength: 6, bokehScale: 3 } },
    cascades: 4,
    grassBlades: 120000,
    crowd: 45000,
    bankLights: 6,
    bankShadows: true,
    pixelRatio: 2,
    adaptive: true,
    textures: { size: 2048, anisotropy: 16 },
  },
}

export type MowPattern = 'stripes' | 'checker' | 'diamond'
export type FenceStyle = 'padded' | 'planks'

export interface ParkTheme {
  mow: MowPattern
  grass: [string, string]
  dirt: string
  fence: FenceStyle
  fenceColor: string
  standsColor: string
  wallColor: string
  fogTint: string | null
  signature: 'outhouse' | 'sandlot' | null
}

const BASE_THEME: ParkTheme = { mow: 'stripes', grass: ['#2c7a26', '#1f5f1c'], dirt: '#8f5b33', fence: 'padded', fenceColor: '#1d3b2c', standsColor: '#3a4256', wallColor: '#26303f', fogTint: null, signature: null }

export const PARK_THEMES: Readonly<Record<string, ParkTheme>> = {
  sandlot: { ...BASE_THEME, mow: 'checker', grass: ['#338224', '#24621a'], dirt: '#94603a', fence: 'planks', fenceColor: '#7a5532', standsColor: '#8a6a48', wallColor: '#5a4330', signature: 'sandlot' },
  outhouse: { ...BASE_THEME, mow: 'diamond', grass: ['#367a22', '#265c18'], dirt: '#8a5a36', fence: 'planks', fenceColor: '#5d4a2c', standsColor: '#7b5a36', wallColor: '#4a3a24', fogTint: '#4f7a3a', signature: 'outhouse' },
}

export function themeFor(parkId: string): ParkTheme {
  return PARK_THEMES[parkId] ?? BASE_THEME
}
