/** Character looks: face, hair, hats and outfits, with the colour palette every piece draws from. Shared by the page and the Worker (validation). */

export const PALETTE = {
  white: '#f2f0ea',
  cream: '#e8dcc0',
  sand: '#c9b48a',
  khaki: '#8f8461',
  olive: '#5b6338',
  forest: '#2f4a32',
  sage: '#8fa58a',
  teal: '#2f8f8a',
  sky: '#7fb6e0',
  royal: '#2f55b8',
  navy: '#1f2a44',
  denim: '#3e5a82',
  darkDenim: '#26334d',
  lightDenim: '#7d98ba',
  charcoal: '#3a3c40',
  heather: '#8c8d91',
  black: '#1b1c1e',
  red: '#b8322c',
  maroon: '#6d1f2a',
  orange: '#e27a2a',
  blaze: '#ff6a13',
  yellow: '#e6c33a',
  pink: '#e48aa8',
  purple: '#6a4c9c',
  brown: '#6b4a2f',
  tan: '#b08a5a',
  camo: '#6f6a45',
} as const

export type PaletteColor = keyof typeof PALETTE
export const paletteColors = Object.keys(PALETTE) as PaletteColor[]

export const SKIN_TONES = ['#f3d5c0', '#e8b896', '#d29a73', '#b37850', '#8d5a3b', '#5e3a26'] as const
export const HAIR_COLORS = ['#1c1714', '#3b2a1e', '#6a4a2e', '#a8794a', '#d4b27a', '#8e8a86', '#d8d6d2', '#8c3a1f'] as const

export const facialHairStyles = ['full', 'short', 'goatee', 'mustache', 'stubble', 'clean'] as const
export const hatStyles = ['beanie', 'cap', 'bucket', 'none'] as const
export const topStyles = ['parka', 'hoodie', 'flannel', 'fishing', 'tee', 'jersey', 'tank'] as const
export const bottomStyles = ['cargo', 'jeans', 'sweatpants', 'joggers', 'shorts', 'boardshorts', 'athletic'] as const
export const shoeStyles = ['boots', 'hikers', 'sneakers', 'deck'] as const

export type FacialHair = (typeof facialHairStyles)[number]
export type HatStyle = (typeof hatStyles)[number]
export type TopStyle = (typeof topStyles)[number]
export type BottomStyle = (typeof bottomStyles)[number]
export type ShoeStyle = (typeof shoeStyles)[number]

export interface Look {
  skin: number
  hair: number
  facialHair: FacialHair
  hat: HatStyle
  hatColor: PaletteColor
  sunglasses: boolean
  top: TopStyle
  topColor: PaletteColor
  topAccent: PaletteColor
  bottom: BottomStyle
  bottomColor: PaletteColor
  shoes: ShoeStyle
  shoeColor: PaletteColor
  gloves: boolean
}

export const DEFAULT_LOOK: Look = {
  skin: 1,
  hair: 2,
  facialHair: 'full',
  hat: 'beanie',
  hatColor: 'blaze',
  sunglasses: false,
  top: 'parka',
  topColor: 'olive',
  topAccent: 'charcoal',
  bottom: 'cargo',
  bottomColor: 'khaki',
  shoes: 'boots',
  shoeColor: 'charcoal',
  gloves: true,
}

export const STYLE_LABELS: Record<string, string> = {
  full: 'Full beard', short: 'Trimmed beard', goatee: 'Goatee', mustache: 'Mustache', stubble: 'Stubble', clean: 'Clean shaven',
  beanie: 'Knit beanie', cap: 'Ball cap', bucket: 'Bucket hat', none: 'No hat',
  parka: 'Fishing parka', hoodie: 'Hoodie', flannel: 'Flannel shirt', fishing: 'Vented fishing shirt', tee: 'T-shirt', jersey: 'Sport tee', tank: 'Tank top',
  cargo: 'Cargo pants', jeans: 'Jeans', sweatpants: 'Sweatpants', joggers: 'Track joggers', shorts: 'Casual shorts', boardshorts: 'Board shorts', athletic: 'Athletic shorts',
  boots: 'Rubber boots', hikers: 'Hiking boots', sneakers: 'Sneakers', deck: 'Deck shoes',
}

export const STYLE_GROUPS: Record<string, string> = {
  parka: 'Cold weather', hoodie: 'Casual', flannel: 'Casual', fishing: 'Summer', tee: 'Summer', jersey: 'Sporty', tank: 'Summer',
  cargo: 'Outdoor', jeans: 'Casual', sweatpants: 'Casual', joggers: 'Sporty', shorts: 'Summer', boardshorts: 'Summer', athletic: 'Sporty',
}

export function normalizeLook(input: unknown): Look {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback)
  const color = (value: unknown, fallback: PaletteColor): PaletteColor => (typeof value === 'string' && value in PALETTE ? (value as PaletteColor) : fallback)
  const index = (value: unknown, max: number, fallback: number) => (Number.isInteger(value) && (value as number) >= 0 && (value as number) < max ? (value as number) : fallback)
  return {
    skin: index(source.skin, SKIN_TONES.length, DEFAULT_LOOK.skin),
    hair: index(source.hair, HAIR_COLORS.length, DEFAULT_LOOK.hair),
    facialHair: pick(facialHairStyles, source.facialHair, DEFAULT_LOOK.facialHair),
    hat: pick(hatStyles, source.hat, DEFAULT_LOOK.hat),
    hatColor: color(source.hatColor, DEFAULT_LOOK.hatColor),
    sunglasses: source.sunglasses === true,
    top: pick(topStyles, source.top, DEFAULT_LOOK.top),
    topColor: color(source.topColor, DEFAULT_LOOK.topColor),
    topAccent: color(source.topAccent, DEFAULT_LOOK.topAccent),
    bottom: pick(bottomStyles, source.bottom, DEFAULT_LOOK.bottom),
    bottomColor: color(source.bottomColor, DEFAULT_LOOK.bottomColor),
    shoes: pick(shoeStyles, source.shoes, DEFAULT_LOOK.shoes),
    shoeColor: color(source.shoeColor, DEFAULT_LOOK.shoeColor),
    gloves: source.gloves === undefined ? DEFAULT_LOOK.gloves : source.gloves === true,
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
