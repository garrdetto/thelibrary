/**
 * How a hunter looks apart from clothes, renderer-free and shared with the Worker: which face, hair and facial hair
 * (each taken from one of the painted heads), five face-shape sliders and three body sliders. Sliders run -1..1 in
 * steps of 0.1 with 0 as the model's own shape.
 */

export interface HeadOption {
  id: string
  name: string
}

/** Painted heads a face can come from. The id is the head texture's name. */
export const FACES: HeadOption[] = [
  { id: 'base', name: 'Weathered' },
  { id: 'soft', name: 'Easygoing' },
  { id: 'brow', name: 'Heavy brow' },
  { id: 'stern', name: 'Stern' },
  { id: 'young', name: 'Young' },
  { id: 'blond', name: 'Square' },
  { id: 'ginger', name: 'Freckled' },
  { id: 'sandy', name: 'Bright-eyed' },
  { id: 'elder', name: 'Old-timer' },
  { id: 'silver', name: 'Grizzled' },
]

export const HAIR: HeadOption[] = [
  { id: 'base', name: 'Dark brown' },
  { id: 'young', name: 'Black' },
  { id: 'sandy', name: 'Sandy' },
  { id: 'blond', name: 'Blond' },
  { id: 'ginger', name: 'Ginger' },
  { id: 'silver', name: 'Silver' },
  { id: 'elder', name: 'Balding white' },
]

export const BEARDS: HeadOption[] = [
  { id: 'base', name: 'Trimmed beard' },
  { id: 'young', name: 'Clean-shaven' },
  { id: 'blond', name: 'Stubble' },
  { id: 'auburn', name: 'Full auburn' },
  { id: 'black', name: 'Full black' },
  { id: 'ginger', name: 'Full ginger' },
  { id: 'salt', name: 'Salt and pepper' },
  { id: 'sandy', name: 'Short grey' },
  { id: 'elder', name: 'White goatee' },
  { id: 'silver', name: 'Long white' },
]

export const SHAPE_SLIDERS = ['jaw', 'chin', 'nose', 'brow', 'cheeks'] as const
export const BODY_SLIDERS = ['height', 'build', 'shoulders'] as const
export type ShapeSlider = typeof SHAPE_SLIDERS[number]
export type BodySlider = typeof BODY_SLIDERS[number]

export const SLIDER_LABEL: Record<ShapeSlider | BodySlider, { name: string; low: string; high: string }> = {
  jaw: { name: 'Jaw', low: 'Narrow', high: 'Wide' },
  chin: { name: 'Chin', low: 'Short', high: 'Long' },
  nose: { name: 'Nose', low: 'Small', high: 'Large' },
  brow: { name: 'Brow', low: 'Flat', high: 'Heavy' },
  cheeks: { name: 'Cheeks', low: 'Lean', high: 'Full' },
  height: { name: 'Height', low: 'Shorter', high: 'Taller' },
  build: { name: 'Build', low: 'Slim', high: 'Stocky' },
  shoulders: { name: 'Shoulders', low: 'Narrow', high: 'Broad' },
}

export interface Appearance extends Record<ShapeSlider | BodySlider, number> {
  face: string
  hair: string
  beard: string
}

/**
 * Bumped whenever the options change enough that everyone deserves one more look in the mirror: a profile whose
 * `fitted` is lower is offered the character screen once.
 */
export const APPEARANCE_VERSION = 1

export const DEFAULT_APPEARANCE: Appearance = { face: 'base', hair: 'base', beard: 'base', jaw: 0, chin: 0, nose: 0, brow: 0, cheeks: 0, height: 0, build: 0, shoulders: 0 }

const SLIDERS: (ShapeSlider | BodySlider)[] = [...SHAPE_SLIDERS, ...BODY_SLIDERS]
const has = (list: HeadOption[], id: unknown): id is string => typeof id === 'string' && list.some((o) => o.id === id)
const step = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(-1, Math.min(1, v)) * 10) / 10 : 0)

/** A complete, in-range appearance from anything: unknown picks fall back to the default head, sliders are clamped. */
export function normalizeAppearance(raw: unknown): Appearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Appearance = { ...DEFAULT_APPEARANCE }
  if (has(FACES, r.face)) out.face = r.face
  if (has(HAIR, r.hair)) out.hair = r.hair
  if (has(BEARDS, r.beard)) out.beard = r.beard
  for (const key of SLIDERS) out[key] = step(r[key]) + 0
  return out
}

export function sameAppearance(a: Appearance, b: Appearance): boolean {
  return a.face === b.face && a.hair === b.hair && a.beard === b.beard && SLIDERS.every((key) => a[key] === b[key])
}

/** A short string for the wire: the three picks, then the eight sliders as tenths. */
export function packAppearance(a: Appearance): string {
  return [a.face, a.hair, a.beard, ...SLIDERS.map((key) => Math.round(a[key] * 10))].join('.')
}

export function unpackAppearance(packed: unknown): Appearance {
  if (typeof packed !== 'string' || packed.length > 80) return { ...DEFAULT_APPEARANCE }
  const parts = packed.split('.')
  const raw: Record<string, unknown> = { face: parts[0], hair: parts[1], beard: parts[2] }
  SLIDERS.forEach((key, i) => {
    raw[key] = Number(parts[3 + i]) / 10
  })
  return normalizeAppearance(raw)
}

/** Body proportions for the sliders: overall scale, girth of the trunk and limbs, and shoulder width, each a multiplier. */
export function bodyScale(a: Appearance): { height: number; build: number; shoulders: number } {
  return { height: 1 + a.height * 0.06, build: 1 + a.build * 0.1, shoulders: 1 + a.shoulders * 0.07 }
}
