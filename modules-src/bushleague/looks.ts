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
    sky: { top: '#1462e0', horizon: '#8cc4ff', ground: '#2a4a22' },
    sunColor: '#fffaf0',
    sunIntensity: 3.6,
    sunDirection: [-0.45, 1, 0.3],
    hemiSky: '#cfe4ff',
    hemiGround: '#3a5a2a',
    hemiIntensity: 1.15,
    fog: '#b9cde6',
    exposure: 1.0,
    environment: 0.85,
    banks: 0,
    lampGlow: 0.4,
  },
  dusk: {
    label: 'Golden hour',
    sky: { top: '#2a3c9e', horizon: '#ff9a5a', ground: '#2e2a1a' },
    sunColor: '#ffb070',
    sunIntensity: 2.6,
    sunDirection: [-0.9, 0.22, 0.25],
    hemiSky: '#ffc59a',
    hemiGround: '#3a2a20',
    hemiIntensity: 0.9,
    fog: '#c98a6a',
    exposure: 1.1,
    environment: 0.55,
    banks: 0.45,
    lampGlow: 2.5,
  },
  night: {
    label: 'Night',
    sky: { top: '#040a1f', horizon: '#1d3263', ground: '#06080c' },
    sunColor: '#c8d6ff',
    sunIntensity: 0.12,
    sunDirection: [0.3, 1, -0.4],
    hemiSky: '#3d4f7a',
    hemiGround: '#141a10',
    hemiIntensity: 0.45,
    fog: '#0c1222',
    exposure: 1.3,
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

const BLOOM = { strength: 0.1, radius: 0.2, threshold: 1.2 }

export const TIER_BUDGETS: Readonly<Record<QualityTier, TierBudget>> = {
  low: { post: null, cascades: 0, grassBlades: 0, crowd: 4000, bankLights: 2, bankShadows: false, pixelRatio: 1, adaptive: true, textures: { size: 512, anisotropy: 2 } },
  medium: { post: { bloom: BLOOM }, cascades: 0, grassBlades: 12000, crowd: 12000, bankLights: 4, bankShadows: false, pixelRatio: 1.25, adaptive: true, textures: { size: 1024, anisotropy: 4 } },
  high: {
    post: { bloom: BLOOM },
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
    post: { bloom: BLOOM },
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

const BASE_THEME: ParkTheme = { mow: 'stripes', grass: ['#3fa233', '#2e8226'], dirt: '#b06a3a', fence: 'padded', fenceColor: '#1d3b2c', standsColor: '#3a4256', wallColor: '#26303f', fogTint: null, signature: null }

export const PARK_THEMES: Readonly<Record<string, ParkTheme>> = {
  sandlot: { ...BASE_THEME, mow: 'checker', grass: ['#42a52f', '#308524'], dirt: '#b46c3c', fence: 'planks', fenceColor: '#7a5532', standsColor: '#8a6a48', wallColor: '#5a4330', signature: 'sandlot' },
  outhouse: { ...BASE_THEME, mow: 'diamond', grass: ['#43a12c', '#2f8020'], dirt: '#ad683a', fence: 'planks', fenceColor: '#5d4a2c', standsColor: '#7b5a36', wallColor: '#4a3a24', fogTint: '#4f7a3a', signature: 'outhouse' },
}

export function themeFor(parkId: string): ParkTheme {
  return PARK_THEMES[parkId] ?? BASE_THEME
}
