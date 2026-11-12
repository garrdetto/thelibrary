/**
 * Draws slot symbols the way video slots present them: card ranks as bevelled,
 * outlined, gradient letters; picture symbols as a large glyph on a jewel tile
 * with a metallic rim, inner shadow and gloss; wilds and scatters on banners;
 * coins as embossed gold discs with their value. Everything is drawn on a 2D
 * canvas (no images to load), at any cell size.
 */
export interface SymbolStyle {
  /** What the symbol shows: a rank ("A", "K", "Q", "J", "10", "9") or a glyph (an emoji or a short word). */
  glyph: string
  kind: 'rank' | 'picture' | 'wild' | 'scatter' | 'coin' | 'mystery' | 'special'
  /** Main colour, highlight colour. */
  color: string
  light: string
  /** Optional caption under the glyph (WILD, BONUS). */
  caption?: string
}

export type Ctx = CanvasRenderingContext2D

function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'
const RANK_FONT = '900 {S}px "Georgia","Times New Roman",serif'

/** Draws one symbol in the cell at (x, y), size w x h. */
export function drawSymbol(g: Ctx, s: SymbolStyle, x: number, y: number, w: number, h: number, value?: string): void {
  const cx = x + w / 2
  const cy = y + h / 2
  const m = Math.min(w, h)
  g.save()
  if (s.kind === 'rank') {
    const size = Math.round(m * (s.glyph.length > 1 ? 0.5 : 0.62))
    g.font = RANK_FONT.replace('{S}', String(size))
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const grad = g.createLinearGradient(0, cy - size / 2, 0, cy + size / 2)
    grad.addColorStop(0, s.light)
    grad.addColorStop(0.45, s.color)
    grad.addColorStop(0.5, shade(s.color, -0.25))
    grad.addColorStop(1, shade(s.color, -0.45))
    g.lineJoin = 'round'
    g.lineWidth = m * 0.07
    g.strokeStyle = '#1a1208'
    g.shadowColor = 'rgba(0,0,0,0.6)'
    g.shadowBlur = m * 0.06
    g.shadowOffsetY = m * 0.03
    g.strokeText(s.glyph, cx, cy + m * 0.02)
    g.shadowColor = 'transparent'
    g.lineWidth = m * 0.03
    g.strokeStyle = '#f7e7b0'
    g.strokeText(s.glyph, cx, cy + m * 0.02)
    g.fillStyle = grad
    g.fillText(s.glyph, cx, cy + m * 0.02)
    g.globalCompositeOperation = 'source-atop'
    const gloss = g.createLinearGradient(0, cy - size / 2, 0, cy)
    gloss.addColorStop(0, 'rgba(255,255,255,0.55)')
    gloss.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gloss
    g.fillRect(x, cy - size / 2, w, size / 2)
    g.restore()
    return
  }
  if (s.kind === 'coin') {
    const r = m * 0.42
    const disc = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r)
    disc.addColorStop(0, '#fff6c8')
    disc.addColorStop(0.35, s.light)
    disc.addColorStop(0.8, s.color)
    disc.addColorStop(1, shade(s.color, -0.5))
    g.shadowColor = s.light
    g.shadowBlur = m * 0.12
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.fillStyle = disc
    g.fill()
    g.shadowBlur = 0
    g.lineWidth = m * 0.035
    g.strokeStyle = shade(s.color, -0.55)
    g.stroke()
    g.beginPath()
    g.arc(cx, cy, r * 0.8, 0, Math.PI * 2)
    g.lineWidth = m * 0.02
    g.strokeStyle = 'rgba(255,250,220,0.7)'
    g.stroke()
    const label = value ?? s.glyph
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `900 ${Math.round(m * (label.length > 4 ? 0.16 : label.length > 2 ? 0.2 : 0.26))}px "Arial Black","Impact",sans-serif`
    g.lineWidth = m * 0.04
    g.strokeStyle = '#3a1e00'
    g.strokeText(label, cx, cy)
    g.fillStyle = '#fffbe8'
    g.fillText(label, cx, cy)
    g.restore()
    return
  }
  const pad = m * 0.06
  const tile = g.createLinearGradient(x, y, x, y + h)
  tile.addColorStop(0, shade(s.color, 0.25))
  tile.addColorStop(0.5, s.color)
  tile.addColorStop(1, shade(s.color, -0.45))
  roundRect(g, x + pad, y + pad, w - pad * 2, h - pad * 2, m * 0.14)
  g.shadowColor = 'rgba(0,0,0,0.55)'
  g.shadowBlur = m * 0.08
  g.shadowOffsetY = m * 0.03
  g.fillStyle = tile
  g.fill()
  g.shadowColor = 'transparent'
  const rim = g.createLinearGradient(x, y, x + w, y + h)
  rim.addColorStop(0, '#fff3c4')
  rim.addColorStop(0.3, '#d4a53a')
  rim.addColorStop(0.6, '#7a5412')
  rim.addColorStop(1, '#f2d27a')
  g.lineWidth = m * 0.045
  g.strokeStyle = s.kind === 'wild' || s.kind === 'scatter' ? rim : shade(s.light, -0.1)
  g.stroke()
  g.save()
  roundRect(g, x + pad * 1.6, y + pad * 1.6, w - pad * 3.2, h - pad * 3.2, m * 0.11)
  g.clip()
  const glow = g.createRadialGradient(cx, cy - m * 0.08, m * 0.05, cx, cy, m * 0.55)
  glow.addColorStop(0, hexA(s.light, 0.55))
  glow.addColorStop(1, hexA(s.light, 0))
  g.fillStyle = glow
  g.fillRect(x, y, w, h)
  g.restore()
  const hasCaption = Boolean(s.caption)
  const glyphY = hasCaption ? cy - m * 0.08 : cy
  const emoji = /\p{Extended_Pictographic}/u.test(s.glyph)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  if (emoji) {
    g.font = `${Math.round(m * (hasCaption ? 0.5 : 0.62))}px ${EMOJI_FONT}`
    g.shadowColor = 'rgba(0,0,0,0.5)'
    g.shadowBlur = m * 0.05
    g.shadowOffsetY = m * 0.025
    g.fillText(s.glyph, cx, glyphY + m * 0.03)
    g.shadowColor = 'transparent'
  } else {
    g.font = `900 ${Math.round(m * (s.glyph.length > 3 ? 0.2 : 0.34))}px "Arial Black","Impact",sans-serif`
    g.lineWidth = m * 0.05
    g.strokeStyle = '#140a02'
    g.strokeText(s.glyph, cx, glyphY)
    const fill = g.createLinearGradient(0, glyphY - m * 0.15, 0, glyphY + m * 0.15)
    fill.addColorStop(0, '#fffbe8')
    fill.addColorStop(1, s.light)
    g.fillStyle = fill
    g.fillText(s.glyph, cx, glyphY)
  }
  if (hasCaption) {
    const by = cy + m * 0.27
    const bh = m * 0.17
    const banner = g.createLinearGradient(0, by - bh / 2, 0, by + bh / 2)
    banner.addColorStop(0, '#ffe58a')
    banner.addColorStop(0.5, '#c8901e')
    banner.addColorStop(1, '#7c5208')
    roundRect(g, x + w * 0.12, by - bh / 2, w * 0.76, bh, bh * 0.35)
    g.fillStyle = banner
    g.fill()
    g.lineWidth = m * 0.015
    g.strokeStyle = '#3c2402'
    g.stroke()
    g.font = `900 ${Math.round(bh * 0.72)}px "Arial Black","Impact",sans-serif`
    g.fillStyle = '#3a1300'
    g.fillText(s.caption!, cx, by + bh * 0.04)
  }
  const gloss = g.createLinearGradient(0, y + pad, 0, cy)
  gloss.addColorStop(0, 'rgba(255,255,255,0.32)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  roundRect(g, x + pad * 1.4, y + pad * 1.4, w - pad * 2.8, (h - pad * 2.8) * 0.45, m * 0.1)
  g.fillStyle = gloss
  g.fill()
  g.restore()
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))))
  const r = f((n >> 16) & 255)
  const gg = f((n >> 8) & 255)
  const b = f(n & 255)
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0')}`
}

export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export { roundRect }
