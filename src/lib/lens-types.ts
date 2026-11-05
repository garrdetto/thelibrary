import { z } from 'zod'

export const hairStyles = [
  { id: 'none', label: 'Natural' },
  { id: 'long', label: 'Long waves' },
  { id: 'bob', label: 'Bob + bangs' },
  { id: 'curly', label: 'Big curls' },
  { id: 'buzz', label: 'Buzz cut' },
  { id: 'mohawk', label: 'Mohawk' },
  { id: 'buns', label: 'Space buns' },
  { id: 'braids', label: 'Braids' },
  { id: 'pompadour', label: 'Pompadour' },
] as const

export const eyewearOptions = [
  { id: 'none', label: 'None' },
  { id: 'shades', label: 'Shades' },
  { id: 'hearts', label: 'Heart glasses' },
  { id: 'round', label: 'Round frames' },
  { id: 'star', label: 'Star glasses' },
] as const

export const headwearOptions = [
  { id: 'none', label: 'None' },
  { id: 'crown', label: 'Crown' },
  { id: 'flowers', label: 'Flower crown' },
  { id: 'halo', label: 'Halo' },
  { id: 'horns', label: 'Devil horns' },
  { id: 'dog', label: 'Puppy ears' },
  { id: 'cat', label: 'Cat ears' },
  { id: 'bunny', label: 'Bunny ears' },
] as const

export const effectOptions = [
  { id: 'dogNose', label: 'Puppy nose + tongue' },
  { id: 'whiskers', label: 'Cat whiskers' },
  { id: 'freckles', label: 'Freckles' },
  { id: 'sparkles', label: 'Sparkles' },
  { id: 'hearts', label: 'Floating hearts' },
  { id: 'tears', label: 'Glitter tears' },
] as const

export const filterOptions = [
  { id: 'none', label: 'Original' },
  { id: 'warm', label: 'Golden' },
  { id: 'cool', label: 'Frost' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'mono', label: 'Mono' },
  { id: 'noir', label: 'Noir' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'dream', label: 'Dreamy' },
  { id: 'alien', label: 'Alien' },
] as const

export type HairStyle = typeof hairStyles[number]['id']
export type Eyewear = typeof eyewearOptions[number]['id']
export type Headwear = typeof headwearOptions[number]['id']
export type Effect = typeof effectOptions[number]['id']
export type FilterId = typeof filterOptions[number]['id']

const color = z.string().regex(/^#[0-9a-f]{6}$/i)
const unit = z.number().min(0).max(1)
const signed = z.number().min(-1).max(1)
const ids = <T extends readonly { id: string }[]>(options: T) => z.enum(options.map(option => option.id) as [T[number]['id'], ...T[number]['id'][]])

export const lensSettingsSchema = z.object({
  name: z.string().trim().min(1).max(40),
  hair: z.object({ style: ids(hairStyles), color, tipColor: color, ombre: z.boolean(), dyeReal: z.boolean(), dyeStrength: unit }),
  face: z.object({ eyes: signed, nose: signed, mouth: signed, slim: signed, chin: signed, head: signed, smile: signed, smooth: unit }),
  makeup: z.object({ lipColor: color, lip: unit, blushColor: color, blush: unit, shadowColor: color, shadow: unit, liner: unit, brows: unit, irisColor: color, iris: unit }),
  extras: z.object({ eyewear: ids(eyewearOptions), headwear: ids(headwearOptions), effects: z.array(ids(effectOptions)).max(effectOptions.length) }),
  filter: z.object({ preset: ids(filterOptions), strength: unit, vignette: unit, grain: unit }),
})

export type LensSettings = z.infer<typeof lensSettingsSchema>

export const defaultLens: LensSettings = {
  name: 'My lens',
  hair: { style: 'none', color: '#6b3e26', tipColor: '#f2c14e', ombre: false, dyeReal: false, dyeStrength: 0.7 },
  face: { eyes: 0, nose: 0, mouth: 0, slim: 0, chin: 0, head: 0, smile: 0, smooth: 0 },
  makeup: { lipColor: '#c2185b', lip: 0, blushColor: '#ff6f91', blush: 0, shadowColor: '#7e57c2', shadow: 0, liner: 0, brows: 0, irisColor: '#2e9df7', iris: 0 },
  extras: { eyewear: 'none', headwear: 'none', effects: [] },
  filter: { preset: 'none', strength: 0.8, vignette: 0, grain: 0 },
}

function lens(name: string, patch: { [K in keyof Omit<LensSettings, 'name'>]?: Partial<LensSettings[K]> }): LensSettings {
  return {
    name,
    hair: { ...defaultLens.hair, ...patch.hair },
    face: { ...defaultLens.face, ...patch.face },
    makeup: { ...defaultLens.makeup, ...patch.makeup },
    extras: { ...defaultLens.extras, ...patch.extras },
    filter: { ...defaultLens.filter, ...patch.filter },
  }
}

export const lensPresets: LensSettings[] = [
  lens('Clean', {}),
  lens('Glam', { face: { eyes: 0.25, slim: 0.35, nose: -0.3, smooth: 0.7 }, makeup: { lip: 0.7, blush: 0.45, shadow: 0.4, liner: 0.7, brows: 0.4 }, hair: { style: 'long', color: '#3b2219', tipColor: '#d9a35b', ombre: true }, filter: { preset: 'warm', strength: 0.5 }, extras: { effects: ['sparkles'] } }),
  lens('Puppy', { face: { eyes: 0.3, smooth: 0.4 }, extras: { headwear: 'dog', effects: ['dogNose', 'freckles'] }, filter: { preset: 'warm', strength: 0.4 } }),
  lens('Kitty', { face: { eyes: 0.35, slim: 0.3, smooth: 0.5 }, makeup: { liner: 0.9, lip: 0.4, lipColor: '#e0607e' }, extras: { headwear: 'cat', effects: ['whiskers'] }, filter: { preset: 'dream', strength: 0.5 } }),
  lens('Big head', { face: { head: 0.9, eyes: 0.5, mouth: 0.4, chin: -0.4 }, extras: { effects: ['sparkles'] } }),
  lens('Anime doll', { face: { eyes: 0.85, nose: -0.7, mouth: -0.4, slim: 0.6, chin: 0.3, smooth: 0.9 }, makeup: { blush: 0.7, iris: 0.6, irisColor: '#b06cff', lip: 0.35, lipColor: '#ff7aa2' }, hair: { style: 'buns', color: '#ff8fc8' }, filter: { preset: 'dream', strength: 0.7 }, extras: { effects: ['hearts'] } }),
  lens('Royal', { hair: { style: 'curly', color: '#2a1a12' }, makeup: { lip: 0.6, lipColor: '#8e1b3a', liner: 0.5 }, extras: { headwear: 'crown', effects: ['sparkles'] }, filter: { preset: 'vivid', strength: 0.6 } }),
  lens('Punk', { hair: { style: 'mohawk', color: '#39ff14', tipColor: '#00b3ff', ombre: true }, makeup: { liner: 1, shadow: 0.7, shadowColor: '#1a1a1a', lip: 0.6, lipColor: '#2b0f2e' }, extras: { headwear: 'horns', eyewear: 'star' }, filter: { preset: 'noir', strength: 0.5, grain: 0.4 } }),
  lens('Alien', { face: { eyes: 1, head: 0.6, nose: -1, mouth: -0.7, chin: 0.6, slim: 0.7 }, makeup: { iris: 1, irisColor: '#000000' }, filter: { preset: 'alien', strength: 1, vignette: 0.5 } }),
  lens('Retro', { hair: { style: 'pompadour', color: '#1c1c1c' }, extras: { eyewear: 'shades' }, filter: { preset: 'vintage', strength: 0.9, vignette: 0.6, grain: 0.5 } }),
]

export function randomLens(): LensSettings {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]
  const swing = (amount: number) => Math.round((Math.random() * 2 - 1) * amount * 100) / 100
  const hue = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`
  return lens('Surprise lens', {
    hair: { style: pick(hairStyles).id, color: hue(), tipColor: hue(), ombre: Math.random() > 0.5 },
    face: { eyes: swing(0.8), nose: swing(0.7), mouth: swing(0.6), slim: swing(0.6), chin: swing(0.5), head: swing(0.5), smile: swing(0.6), smooth: Math.random() * 0.8 },
    makeup: { lip: Math.random() * 0.8, lipColor: hue(), blush: Math.random() * 0.6, shadow: Math.random() * 0.6, shadowColor: hue(), liner: Math.random(), iris: Math.random() * 0.8, irisColor: hue() },
    extras: { eyewear: pick(eyewearOptions).id, headwear: pick(headwearOptions).id, effects: effectOptions.filter(() => Math.random() > 0.7).map(option => option.id) },
    filter: { preset: pick(filterOptions).id, strength: 0.7 },
  })
}
