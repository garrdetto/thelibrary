/**
 * AI-designed Short Track Showdown paint schemes. The AI paint designer (`/api/shorttrack-paint`) returns
 * one of these; the Garage keeps it in the livery as `custom`, and the same side, hood and logo painters
 * that draw the AI field's iconic schemes (`iconic-schemes.js`) draw it on the truck, the stock car and
 * every custom car. Everything is sanitised here, on the Worker and again in every page that receives a
 * livery, so a scheme can never carry more than plain shapes, colours and short text.
 *
 * Side art uses the iconic frame: t runs 0 (front bumper) → 1 (rear bumper), s runs 0 (rocker) → 1
 * (beltline), up to 1.15 for the window line. Sizes are metres on a 5.3 m long car.
 */

export type Hex = string
export type SchemeLogoKind = 'box' | 'oval' | 'script' | 'shield' | 'star'
export type SchemeLogo = { kind: SchemeLogoKind; text: string; sub?: string; bg: Hex; fg: Hex; sfg?: Hex; edge: Hex; star?: Hex }

export type SideOp =
  | { type: 'band'; s0: number; s1: number; color: Hex; t0: number; t1: number }
  | { type: 'poly'; points: [number, number][]; color: Hex }
  | { type: 'streak'; t0: number; s0: number; t1: number; s1: number; w0: number; w1: number; color: Hex }
  | { type: 'dot'; t: number; s: number; r: number; color: Hex }
  | { type: 'text'; t: number; s: number; h: number; text: string; fill: Hex; outline: Hex | null; italic: boolean }
  | { type: 'logo'; t: number; s: number; w: number; logo: string }

export type CustomScheme = {
  name: string
  primary: Hex
  secondary: Hex
  accent: Hex
  side: SideOp[]
  hood: { color: Hex; nose: [Hex, number] | null; stripes: [number, Hex][]; logo: [string, number, number] | null }
  roof: Hex | null
  deck: Hex | null
  logos: Record<string, SchemeLogo>
  num: { fill: Hex; outline: Hex; accent: Hex; slant: boolean }
}

export const SCHEME_LIMITS = { sideOps: 40, polyPoints: 16, logos: 4, stripes: 4, text: 16, logoText: 14, logoSub: 18, name: 32, prompt: 400 } as const

/** Real makes, sponsors and series stay out of painted text: designs are original. */
export const SCHEME_BRAND_PATTERN = /\b(ford|chevy|chevrolet|gmc|dodge|ram|jeep|chrysler|cadillac|buick|pontiac|toyota|lexus|honda|acura|nissan|mazda|subaru|hyundai|kia|volkswagen|vw|audi|porsche|bmw|mercedes|volvo|ferrari|lamborghini|maserati|bugatti|bentley|mclaren|corvette|mustang|camaro|camry|nascar|arca|indycar|formula ?1|f1|mobil ?1|pennzoil|valvoline|quaker ?state|castrol|shell|exxon|sunoco|goodyear|firestone|bridgestone|michelin|stp|monster energy|red ?bull|coca[- ]?cola|coke|pepsi|mountain dew|budweiser|bud light|miller|coors|busch|jack daniels?|mcdonald'?s|wendy'?s|burger king|home depot|lowe'?s|dewalt|fedex|ups|dupont|axalta|gm goodwrench|goodwrench|interstate|napa|m&m'?s|mars|snickers|skittles|kellogg'?s|tide|target|walmart|amazon|google|apple|nike|adidas|wrangler)\b/i

const HEX = /^#[0-9a-f]{6}$/i
const PLAIN = /^[\p{L}\p{N} .,'!?&#+\-/]*$/u

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000))
}
const hex = (v: unknown, fallback: Hex | null): Hex | null => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback)
const color = (v: unknown, fallback: Hex): Hex => hex(v, fallback) as Hex
const words = (v: unknown, max: number) => {
  if (typeof v !== 'string') return ''
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max)
  return PLAIN.test(t) && !SCHEME_BRAND_PATTERN.test(t) ? t : ''
}
const KINDS: SchemeLogoKind[] = ['box', 'oval', 'script', 'shield', 'star']
const LOGO_KEY = /^[a-z][a-z0-9]{0,15}$/

function sideOp(o: Record<string, unknown>, logos: Record<string, SchemeLogo>): SideOp | null {
  switch (o.type) {
    case 'band': {
      const s0 = num(o.s0, 0, 1.2, 0), s1 = num(o.s1, 0, 1.2, 0.1)
      return s1 > s0 ? { type: 'band', s0, s1, color: color(o.color, '#ffffff'), t0: num(o.t0, 0, 1, 0), t1: num(o.t1, 0, 1, 1) } : null
    }
    case 'poly': {
      const pts = Array.isArray(o.points) ? o.points.slice(0, SCHEME_LIMITS.polyPoints) : []
      const points = pts.filter(Array.isArray).map(p => [num(p[0], 0, 1, 0), num(p[1], 0, 1.2, 0)] as [number, number])
      return points.length >= 3 ? { type: 'poly', points, color: color(o.color, '#ffffff') } : null
    }
    case 'streak':
      return { type: 'streak', t0: num(o.t0, 0, 1, 0), s0: num(o.s0, 0, 1.2, 0.5), t1: num(o.t1, 0, 1, 1), s1: num(o.s1, 0, 1.2, 0.5), w0: num(o.w0, 0, 0.6, 0.05), w1: num(o.w1, 0, 0.6, 0.05), color: color(o.color, '#ffffff') }
    case 'dot':
      return { type: 'dot', t: num(o.t, 0, 1, 0.5), s: num(o.s, 0, 1.2, 0.5), r: num(o.r, 0.02, 0.6, 0.15), color: color(o.color, '#ffffff') }
    case 'text': {
      const text = words(o.text, SCHEME_LIMITS.text)
      return text ? { type: 'text', t: num(o.t, 0, 1, 0.5), s: num(o.s, 0, 1.2, 0.5), h: num(o.h, 0.05, 0.4, 0.14), text, fill: color(o.fill, '#ffffff'), outline: hex(o.outline, null), italic: o.italic !== false } : null
    }
    case 'logo': {
      const logo = typeof o.logo === 'string' ? o.logo : ''
      return logos[logo] ? { type: 'logo', t: num(o.t, 0, 1, 0.8), s: num(o.s, 0, 1.2, 0.6), w: num(o.w, 0.2, 1.4, 0.8), logo } : null
    }
    default:
      return null
  }
}

/** A clean scheme, or null when there is nothing usable. Accepts the designer's output or a stored copy. */
export function sanitizeScheme(raw: unknown): CustomScheme | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const primary = hex(r.primary, null)
  if (!primary) return null
  const secondary = color(r.secondary, '#ffffff'), accent = color(r.accent, '#111111')
  const logos: Record<string, SchemeLogo> = {}
  const rawLogos = r.logos && typeof r.logos === 'object' ? Object.entries(r.logos as Record<string, unknown>) : []
  for (const [key, value] of rawLogos.slice(0, SCHEME_LIMITS.logos)) {
    if (!LOGO_KEY.test(key) || !value || typeof value !== 'object') continue
    const l = value as Record<string, unknown>, text = words(l.text, SCHEME_LIMITS.logoText)
    if (!text) continue
    const sub = words(l.sub, SCHEME_LIMITS.logoSub)
    logos[key] = {
      kind: KINDS.includes(l.kind as SchemeLogoKind) ? (l.kind as SchemeLogoKind) : 'box', text, ...(sub ? { sub } : {}),
      bg: color(l.bg, '#111111'), fg: color(l.fg, '#ffffff'), sfg: color(l.sfg, color(l.fg, '#ffffff')), edge: color(l.edge, '#ffffff'), star: color(l.star, accent),
    }
  }
  const side = (Array.isArray(r.side) ? r.side : []).slice(0, SCHEME_LIMITS.sideOps)
    .map(o => (o && typeof o === 'object' ? sideOp(o as Record<string, unknown>, logos) : null)).filter((o): o is SideOp => !!o)
  const h = (r.hood && typeof r.hood === 'object' ? r.hood : {}) as Record<string, unknown>
  const nose = Array.isArray(h.nose) && hex(h.nose[0], null) ? [hex(h.nose[0], null) as Hex, num(h.nose[1], 0.05, 1.2, 0.35)] as [Hex, number] : null
  const stripes = (Array.isArray(h.stripes) ? h.stripes : []).slice(0, SCHEME_LIMITS.stripes)
    .filter(Array.isArray).map(s => [num(s[0], 0.01, 0.8, 0.1), color(s[1], secondary)] as [number, Hex])
  const hl = Array.isArray(h.logo) && typeof h.logo[0] === 'string' && logos[h.logo[0]] ? [h.logo[0], num(h.logo[1], 0.3, 1.4, 0.9), num(h.logo[2], 1.1, 2.4, 1.75)] as [string, number, number] : null
  const n = (r.num && typeof r.num === 'object' ? r.num : {}) as Record<string, unknown>
  return {
    name: words(r.name, SCHEME_LIMITS.name) || 'AI design',
    primary, secondary, accent, side,
    hood: { color: color(h.color, primary), nose, stripes, logo: hl },
    roof: hex(r.roof, null), deck: hex(r.deck, null), logos,
    num: { fill: color(n.fill, '#ffffff'), outline: color(n.outline, '#111111'), accent: color(n.accent, accent), slant: n.slant === true },
  }
}

/** The scheme in the painters' format (`iconic-schemes.js`: array side ops, logo definitions in `logos`). */
export function schemeForPainters(s: CustomScheme) {
  return {
    primary: s.primary, secondary: s.secondary, accent: s.accent, logos: s.logos,
    roof: s.roof ?? undefined, deck: s.deck ?? undefined,
    hood: { color: s.hood.color, ...(s.hood.nose ? { nose: s.hood.nose } : {}), stripes: s.hood.stripes, ...(s.hood.logo ? { logo: s.hood.logo } : {}) },
    side: s.side.map(o => {
      switch (o.type) {
        case 'band': return ['band', o.s0, o.s1, o.color, o.t0, o.t1]
        case 'poly': return ['poly', o.points, o.color]
        case 'streak': return ['streak', o.t0, o.s0, o.t1, o.s1, o.w0, o.w1, o.color]
        case 'dot': return ['dot', o.t, o.s, o.r, o.color]
        case 'text': return ['text', o.t, o.s, o.h, o.text, o.fill, o.outline, o.italic]
        case 'logo': return ['logo', o.t, o.s, o.w, o.logo]
      }
    }),
  }
}
