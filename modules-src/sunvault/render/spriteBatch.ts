import { AtlasCell, BAND_ASPECT, BAND_UV, GLYPH_H, GLYPH_W, cellUv, glyphUv, type UvRect } from './atlas'

export const SPRITE_FLOATS = 16

export interface SpriteStyle {
  rotation?: number
  additive?: number
  shimmer?: number
  color?: readonly [number, number, number, number]
}

const WHITE: readonly [number, number, number, number] = [1, 1, 1, 1]
const WHITE_UV = cellUv(AtlasCell.White)
const SOLID_UV: UvRect = [WHITE_UV[0] + 0.02, WHITE_UV[1] + 0.02, WHITE_UV[2] - 0.02, WHITE_UV[3] - 0.02]

export class SpriteBatch {
  data: Float32Array
  count = 0

  constructor(capacity = 1024) {
    this.data = new Float32Array(capacity * SPRITE_FLOATS)
  }

  clear(): void {
    this.count = 0
  }

  private reserve(): number {
    if ((this.count + 1) * SPRITE_FLOATS > this.data.length) {
      const grown = new Float32Array(this.data.length * 2)
      grown.set(this.data)
      this.data = grown
    }
    return this.count++ * SPRITE_FLOATS
  }

  quad(cx: number, cy: number, halfW: number, halfH: number, uv: UvRect, style: SpriteStyle = {}): void {
    const o = this.reserve()
    const d = this.data
    const color = style.color ?? WHITE
    d[o] = cx
    d[o + 1] = cy
    d[o + 2] = halfW
    d[o + 3] = halfH
    d[o + 4] = style.rotation ?? 0
    d[o + 5] = style.additive ?? 0
    d[o + 6] = style.shimmer ?? 0
    d[o + 7] = 0
    d[o + 8] = uv[0]
    d[o + 9] = uv[1]
    d[o + 10] = uv[2]
    d[o + 11] = uv[3]
    d[o + 12] = color[0]
    d[o + 13] = color[1]
    d[o + 14] = color[2]
    d[o + 15] = color[3]
  }

  cell(cell: number, cx: number, cy: number, size: number, style: SpriteStyle = {}): void {
    this.quad(cx, cy, size / 2, size / 2, cellUv(cell), style)
  }

  rect(x: number, y: number, w: number, h: number, color: readonly [number, number, number, number], additive = 0): void {
    this.quad(x + w / 2, y + h / 2, w / 2, h / 2, SOLID_UV, { color, additive })
  }

  frame(x: number, y: number, w: number, h: number, thickness: number, color: readonly [number, number, number, number], additive = 0): void {
    this.rect(x - thickness, y - thickness, w + thickness * 2, thickness, color, additive)
    this.rect(x - thickness, y + h, w + thickness * 2, thickness, color, additive)
    this.rect(x - thickness, y, thickness, h, color, additive)
    this.rect(x + w, y, thickness, h, color, additive)
  }

  glowFrame(x: number, y: number, w: number, h: number, thickness: number, color: readonly [number, number, number, number]): void {
    const soft: [number, number, number, number] = [color[0], color[1], color[2], color[3] * 0.35]
    this.frame(x - thickness, y - thickness, w + thickness * 2, h + thickness * 2, thickness * 2, soft, 1)
    this.frame(x, y, w, h, thickness, color, 1)
  }

  line(x0: number, y0: number, x1: number, y1: number, thickness: number, color: readonly [number, number, number, number], additive = 0): void {
    const dx = x1 - x0
    const dy = y1 - y0
    const length = Math.hypot(dx, dy)
    if (length < 0.5) return
    this.quad((x0 + x1) / 2, (y0 + y1) / 2, length / 2 + thickness / 2, thickness / 2, SOLID_UV, { rotation: Math.atan2(dy, dx), color, additive })
  }

  band(x: number, y: number, w: number, h: number, color: readonly [number, number, number, number] = WHITE): void {
    const tileW = h * BAND_ASPECT * 0.5
    let cursor = x
    while (cursor < x + w - 0.5) {
      const span = Math.min(tileW, x + w - cursor)
      const fraction = span / tileW
      const uv: UvRect = [BAND_UV[0], BAND_UV[1], BAND_UV[0] + (BAND_UV[2] - BAND_UV[0]) * 0.5 * fraction, BAND_UV[3]]
      this.quad(cursor + span / 2, y + h / 2, span / 2, h / 2, uv, { color })
      cursor += span
    }
  }

  textWidth(text: string, height: number): number {
    return [...text].length * height * (GLYPH_W / GLYPH_H) * 0.8
  }

  text(text: string, cx: number, cy: number, height: number, style: SpriteStyle = {}, maxWidth = Infinity): void {
    const natural = this.textWidth(text, height)
    const scale = natural > maxWidth ? maxWidth / natural : 1
    const h = height * scale
    const glyphW = h * (GLYPH_W / GLYPH_H)
    const advance = glyphW * 0.8
    let x = cx - (natural * scale) / 2 + advance / 2
    for (const char of text) {
      const uv = glyphUv(char)
      if (uv) this.quad(x, cy, glyphW / 2, h / 2, uv, style)
      x += advance
    }
  }
}
