export const SKIN_TONES = ['#f6d7c3', '#eac0a0', '#d9a37e', '#b97a56', '#8d5a3b', '#5e3b26'] as const
export const HAIR_COLORS = ['#1f1a17', '#4a3020', '#7b5434', '#b88a4f', '#d9c08a', '#a8432f', '#8a8d91', '#e7e3dc'] as const
export const OUTFIT_COLORS = ['#3a6fa8', '#c44e3f', '#4f8a3f', '#d8a23c', '#7a5aa8', '#2f3136', '#e8e1d3', '#e86f9a', '#3fb8a8', '#8a5d38'] as const
export const HAIR_STYLES = ['short', 'long', 'bun', 'curly', 'bald'] as const
export const BUILDS = ['slim', 'average', 'broad'] as const
/** Body shape of the resident model (the Feminine morph target); clothes, hair and build stay free choices. */
export const BODIES = ['masculine', 'feminine'] as const

export type HairStyle = (typeof HAIR_STYLES)[number]
export type Build = (typeof BUILDS)[number]
export type Body = (typeof BODIES)[number]

export interface Look {
  skin: number
  hair: number
  hairStyle: HairStyle
  top: number
  bottom: number
  build: Build
  body: Body
  /** Height scale, 0.9 to 1.1. */
  height: number
}

export function defaultLook(): Look {
  return { skin: 1, hair: 1, hairStyle: 'short', top: 0, bottom: 5, build: 'average', body: 'masculine', height: 1 }
}

function pick(length: number, value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n < length ? n : fallback
}

export function sanitizeLook(input: unknown): Look {
  const base = defaultLook()
  if (!input || typeof input !== 'object') return base
  const v = input as Record<string, unknown>
  const height = Number(v.height)
  const hairStyle = (HAIR_STYLES as readonly string[]).includes(String(v.hairStyle)) ? (v.hairStyle as HairStyle) : base.hairStyle
  return {
    skin: pick(SKIN_TONES.length, v.skin, base.skin),
    hair: pick(HAIR_COLORS.length, v.hair, base.hair),
    hairStyle,
    top: pick(OUTFIT_COLORS.length, v.top, base.top),
    bottom: pick(OUTFIT_COLORS.length, v.bottom, base.bottom),
    build: (BUILDS as readonly string[]).includes(String(v.build)) ? (v.build as Build) : base.build,
    // Sims saved before bodies existed keep the look their hair suggested.
    body: (BODIES as readonly string[]).includes(String(v.body)) ? (v.body as Body) : hairStyle === 'long' || hairStyle === 'bun' ? 'feminine' : 'masculine',
    height: Number.isFinite(height) ? Math.max(0.9, Math.min(1.1, Math.round(height * 100) / 100)) : 1,
  }
}

/** A stable look for guests, chosen from their key so they look the same every visit. */
export function lookFromKey(key: string): Look {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0
  const at = (n: number) => { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return h % n }
  const look = {
    skin: at(SKIN_TONES.length),
    hair: at(HAIR_COLORS.length),
    hairStyle: HAIR_STYLES[at(HAIR_STYLES.length - 1)],
    top: at(OUTFIT_COLORS.length),
    bottom: at(OUTFIT_COLORS.length),
    build: BUILDS[at(BUILDS.length)],
    height: 0.94 + at(13) / 100,
  }
  return { ...look, body: BODIES[at(BODIES.length)] }
}

export function sanitizeSimName(input: unknown, fallback: string): string {
  const name = String(input ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24)
  return name || fallback
}
