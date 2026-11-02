/**
 * Character looks: body, hair, eyes, skin and the clothing catalog. Shared by
 * the authority (ownership checks, purchases at Maple Threads) and the client
 * (wardrobe UI and the avatar shader). Starter pieces are free; everything else
 * is bought downtown and then kept in the account's wardrobe for good.
 */
export type Body = 'male' | 'female';
export type Slot = 'top' | 'pants' | 'shoes' | 'hat';

/**
 * Shader patterns, painted in the model's rest-pose space so stripes run level
 * and plaid stays square on every scan:
 * solid, stripes, plaid, camo, two-tone sleeves, denim, checker, shorts (bare shins), high-top (shoe climbs over the ankle).
 */
export const PATTERNS = ['solid', 'stripes', 'plaid', 'camo', 'sleeves', 'denim', 'checker', 'shorts', 'hightop'] as const;
export type Pattern = (typeof PATTERNS)[number];

export interface WardrobeItem {
  id: string;
  slot: Slot;
  name: string;
  price: number;
  blurb: string;
  pattern: Pattern;
  /** Default primary and accent colors, used until the player recolors the piece. */
  colors: [string, string];
  /** Hats: which mesh to build. */
  hat?: 'beanie' | 'cap' | 'bucket';
}

export const WARDROBE: WardrobeItem[] = [
  { id: 'zip-jacket', slot: 'top', name: 'Zip Hoodie Jacket', price: 0, blurb: 'The everyday jacket over a crew tee', pattern: 'solid', colors: ['#2b2b2c', '#50504b'] },
  { id: 'varsity', slot: 'top', name: 'Varsity Jacket', price: 85, blurb: 'Body and sleeves in two colors', pattern: 'sleeves', colors: ['#1f3f78', '#e9e4d6'] },
  { id: 'flannel', slot: 'top', name: 'Plaid Flannel Jacket', price: 65, blurb: 'Brushed-cotton check, two colors', pattern: 'plaid', colors: ['#a3262a', '#1d1d22'] },
  { id: 'rugby', slot: 'top', name: 'Rugby Stripe Jacket', price: 55, blurb: 'Bold horizontal hoops', pattern: 'stripes', colors: ['#1d4d3a', '#e8c547'] },
  { id: 'field-camo', slot: 'top', name: 'Field Camo Jacket', price: 95, blurb: 'Woodland camouflage, any two tones', pattern: 'camo', colors: ['#4a5a33', '#2b2a20'] },

  { id: 'cargo', slot: 'pants', name: 'Cargo Joggers', price: 0, blurb: 'Pockets for everything', pattern: 'solid', colors: ['#4d4940', '#2a2a2a'] },
  { id: 'denim', slot: 'pants', name: 'Denim Jeans', price: 60, blurb: 'Twill-weave denim', pattern: 'denim', colors: ['#2f4a73', '#dfe6ef'] },
  { id: 'camo-cargo', slot: 'pants', name: 'Camo Cargos', price: 70, blurb: 'Woodland camouflage cargos', pattern: 'camo', colors: ['#5d6440', '#2c2b22'] },
  { id: 'cargo-shorts', slot: 'pants', name: 'Cargo Shorts', price: 45, blurb: 'Knee-length, for mowing season', pattern: 'shorts', colors: ['#8b7a58', '#2a2a2a'] },
  { id: 'plaid-trousers', slot: 'pants', name: 'Check Trousers', price: 75, blurb: 'A sharp windowpane check', pattern: 'plaid', colors: ['#5b5f66', '#2a2c31'] },

  { id: 'runners', slot: 'shoes', name: 'Trail Runners', price: 0, blurb: 'Light and grippy', pattern: 'solid', colors: ['#787474', '#d2d1d0'] },
  { id: 'high-tops', slot: 'shoes', name: 'Court High-Tops', price: 90, blurb: 'Laced up past the ankle', pattern: 'hightop', colors: ['#c3262b', '#f4f1ea'] },
  { id: 'slip-ons', slot: 'shoes', name: 'Checkerboard Slip-Ons', price: 55, blurb: 'Two-color checker canvas', pattern: 'checker', colors: ['#111111', '#f1f1f1'] },
  { id: 'work-boots', slot: 'shoes', name: 'Work Boots', price: 110, blurb: 'Oiled leather, built for the yard', pattern: 'hightop', colors: ['#7a4b26', '#2a1d14'] },

  { id: 'no-hat', slot: 'hat', name: 'No hat', price: 0, blurb: 'Let the hair breathe', pattern: 'solid', colors: ['#333333', '#333333'] },
  { id: 'beanie', slot: 'hat', name: 'Knit Beanie', price: 25, blurb: 'Ribbed cuff, warm all season', pattern: 'solid', colors: ['#b5462f', '#b5462f'], hat: 'beanie' },
  { id: 'ball-cap', slot: 'hat', name: 'Ball Cap', price: 30, blurb: 'Curved brim, two colors', pattern: 'solid', colors: ['#1f3f78', '#f2f2f2'], hat: 'cap' },
  { id: 'bucket-hat', slot: 'hat', name: 'Bucket Hat', price: 35, blurb: 'Soft brim all the way around', pattern: 'solid', colors: ['#c9b78f', '#c9b78f'], hat: 'bucket' },
];
export const WARDROBE_BY_ID: Record<string, WardrobeItem> = Object.fromEntries(WARDROBE.map(i => [i.id, i]));
export const STARTER_WARDROBE = WARDROBE.filter(i => i.price === 0).map(i => i.id);

export const HAIR_STYLES: Record<Body, { id: string; name: string }[]> = {
  male: [
    { id: 'natural', name: 'Textured crop' },
    { id: 'long', name: 'Long & loose' },
    { id: 'bun', name: 'Top knot' },
    { id: 'buzz', name: 'Buzz cut' },
  ],
  female: [
    { id: 'natural', name: 'Curly ponytail' },
    { id: 'long', name: 'Long & loose' },
    { id: 'bun', name: 'Top bun' },
  ],
};

export const HAIR_COLORS = ['#3b322b', '#2a1d16', '#4a3020', '#7b5236', '#b07a45', '#d8b16d', '#e9d3a3', '#8f2f1e', '#b8b8b8', '#1c1c1c', '#5a3b8c', '#2f6d8c', '#d0567a'];
export const EYE_COLORS = ['#443226', '#5a3a22', '#3b2416', '#7a5a2a', '#4f7a3a', '#3f7f8f', '#3f62a8', '#7d8a96', '#8c6a3a'];
export const SKIN_TONES = ['#f0cdb8', '#d4a18f', '#c48e72', '#a7806f', '#8d5a3b', '#5e3b26', '#3f281c'];
export const CLOTH_COLORS = [
  '#f2f2f2', '#bfc3c8', '#6d7178', '#23262b', '#111111', '#7a1f22', '#c3262b', '#e26a2c', '#e8c547', '#c9b78f',
  '#8b7a58', '#4c4a3a', '#4a5a33', '#1d4d3a', '#2e8b57', '#3f7f8f', '#2f4a73', '#1f3f78', '#5a3b8c', '#d0567a',
];

export interface Look {
  body: Body;
  skin: string;
  hair: string;
  hairColor: string;
  eyes: string;
  top: string; topColor: string; topColor2: string;
  tee: string;
  pants: string; pantsColor: string; pantsColor2: string;
  shoes: string; shoesColor: string; shoesColor2: string;
  hat: string; hatColor: string; hatColor2: string;
}

export function defaultLook(body: Body): Look {
  return {
    body,
    skin: body === 'male' ? '#d4a18f' : '#a7806f',
    hair: 'natural', hairColor: body === 'male' ? '#3b322b' : '#3d332d',
    eyes: body === 'male' ? '#443226' : '#4c3a32',
    top: 'zip-jacket', topColor: '#2b2b2c', topColor2: '#50504b',
    tee: '#50504b',
    pants: 'cargo', pantsColor: '#4d4940', pantsColor2: '#2a2a2a',
    shoes: 'runners', shoesColor: '#787474', shoesColor2: '#d2d1d0',
    hat: 'no-hat', hatColor: '#333333', hatColor2: '#333333',
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
export const isBody = (v: unknown): v is Body => v === 'male' || v === 'female';

/**
 * Sanitizes a look from the network: unknown pieces or pieces the player doesn't
 * own fall back to what they had (or the starter piece), colors must be hex.
 */
export function cleanLook(raw: unknown, owned: string[], prev?: Look | null): Look {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Look, unknown>>;
  const body: Body = isBody(r.body) ? r.body : prev?.body ?? 'male';
  const base = prev && prev.body === body ? prev : { ...defaultLook(body), ...(prev ? { top: prev.top, pants: prev.pants, shoes: prev.shoes, hat: prev.hat } : {}) };
  const piece = (slot: Slot, v: unknown, fallback: string) => {
    const it = typeof v === 'string' ? WARDROBE_BY_ID[v] : undefined;
    if (it && it.slot === slot && (it.price === 0 || owned.includes(it.id))) return it.id;
    const fb = WARDROBE_BY_ID[fallback];
    return fb && (fb.price === 0 || owned.includes(fb.id)) ? fallback : WARDROBE.find(i => i.slot === slot && i.price === 0)!.id;
  };
  const hair = typeof r.hair === 'string' && HAIR_STYLES[body].some(h => h.id === r.hair) ? r.hair : HAIR_STYLES[body].some(h => h.id === base.hair) ? base.hair : 'natural';
  return {
    body,
    skin: hex(r.skin, base.skin),
    hair,
    hairColor: hex(r.hairColor, base.hairColor),
    eyes: hex(r.eyes, base.eyes),
    top: piece('top', r.top, base.top), topColor: hex(r.topColor, base.topColor), topColor2: hex(r.topColor2, base.topColor2),
    tee: hex(r.tee, base.tee),
    pants: piece('pants', r.pants, base.pants), pantsColor: hex(r.pantsColor, base.pantsColor), pantsColor2: hex(r.pantsColor2, base.pantsColor2),
    shoes: piece('shoes', r.shoes, base.shoes), shoesColor: hex(r.shoesColor, base.shoesColor), shoesColor2: hex(r.shoesColor2, base.shoesColor2),
    hat: piece('hat', r.hat, base.hat), hatColor: hex(r.hatColor, base.hatColor), hatColor2: hex(r.hatColor2, base.hatColor2),
  };
}

/** A stable string for change detection on remote players. */
export const lookKey = (l: Look | null | undefined) => (l ? Object.values(l).join('|') : '');
