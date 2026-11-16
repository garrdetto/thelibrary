import { Sym } from '../engine/paytable'

export const ATLAS_SIZE = 2048
export const CELL_PX = 256
export const ATLAS_GRID = ATLAS_SIZE / CELL_PX
export const ATLAS_MIP_LEVELS = 4

export const AtlasCell = {
  CoinMini: 14,
  CoinMinor: 15,
  CoinMajor: 16,
  Blank: 17,
  Spark: 18,
  Dust: 19,
  SmallCoin: 20,
  White: 21,
  Glow: 22,
  ScarabSpark: 23,
  Ring: 24,
  Star: 25,
  CoinGrand: 26,
} as const

export const GLYPH_CHARS = '0123456789.$K,M+x×'
export const GLYPH_W = 64
export const GLYPH_H = 128
const GLYPH_Y = 1024
const BAND_Y = 1160
const BAND_H = 96
const BAR_Y = 1272
const BAR_H = 64

export type UvRect = readonly [number, number, number, number]

export const SHIMMER_CELLS: readonly number[] = [Sym.Wild, Sym.Scatter, Sym.Coin, Sym.Sphinx, AtlasCell.CoinMini, AtlasCell.CoinMinor, AtlasCell.CoinMajor, AtlasCell.CoinGrand]

export function cellUv(cell: number): UvRect {
  const col = cell % ATLAS_GRID
  const row = Math.floor(cell / ATLAS_GRID)
  return [col / ATLAS_GRID, row / ATLAS_GRID, (col + 1) / ATLAS_GRID, (row + 1) / ATLAS_GRID]
}

export function glyphUv(char: string): UvRect | null {
  const index = GLYPH_CHARS.indexOf(char)
  if (index < 0) return null
  const x = index * GLYPH_W
  return [x / ATLAS_SIZE, GLYPH_Y / ATLAS_SIZE, (x + GLYPH_W) / ATLAS_SIZE, (GLYPH_Y + GLYPH_H) / ATLAS_SIZE]
}

export const BAND_UV: UvRect = [0, BAND_Y / ATLAS_SIZE, 1, (BAND_Y + BAND_H) / ATLAS_SIZE]
export const BAND_ASPECT = ATLAS_SIZE / BAND_H
export const BAR_UV: UvRect = [0, BAR_Y / ATLAS_SIZE, 1, (BAR_Y + BAR_H) / ATLAS_SIZE]

export const DISPLAY_FONT = '"Cinzel", "Trajan Pro", "Palatino Linotype", Georgia, serif'

type Ctx = CanvasRenderingContext2D

const GOLD_STOPS: readonly [number, string][] = [[0, '#fff7cf'], [0.22, '#ffd86a'], [0.48, '#c38a1d'], [0.62, '#ffe596'], [0.85, '#a8701a'], [1, '#5e3a0a']]

function gold(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops = GOLD_STOPS): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1)
  for (const [at, color] of stops) gradient.addColorStop(at, color)
  return gradient
}

function radial(ctx: Ctx, x: number, y: number, r: number, stops: readonly [number, string][]): CanvasGradient {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
  for (const [at, color] of stops) gradient.addColorStop(at, color)
  return gradient
}

function withCell(ctx: Ctx, cell: number, draw: (ctx: Ctx) => void): void {
  const col = cell % ATLAS_GRID
  const row = Math.floor(cell / ATLAS_GRID)
  ctx.save()
  ctx.beginPath()
  ctx.rect(col * CELL_PX + 2, row * CELL_PX + 2, CELL_PX - 4, CELL_PX - 4)
  ctx.clip()
  ctx.translate(col * CELL_PX, row * CELL_PX)
  draw(ctx)
  ctx.restore()
}

function shadowed(ctx: Ctx, blur: number, color: string, draw: () => void): void {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  ctx.shadowOffsetY = blur * 0.25
  draw()
  ctx.restore()
}

function gem(ctx: Ctx, x: number, y: number, r: number, light: string, mid: string, dark: string): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, x - r * 0.35, y - r * 0.4, r * 1.4, [[0, light], [0.45, mid], [1, dark]])
  ctx.fill()
  ctx.lineWidth = Math.max(2, r * 0.18)
  ctx.strokeStyle = gold(ctx, x - r, y - r, x + r, y + r)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.32, r * 0.18, -0.6, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fill()
}

function hieroglyphs(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, seed: number): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(1.5, h * 0.07)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const step = h * 1.05
  let index = seed
  for (let cx = x + step / 2; cx < x + w - step / 3; cx += step) {
    const cy = y + h / 2
    const s = h * 0.38
    switch (index++ % 6) {
      case 0:
        ctx.beginPath()
        ctx.ellipse(cx, cy, s, s * 0.45, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(cx - s * 0.2, cy + s * 0.45)
        ctx.quadraticCurveTo(cx - s * 0.1, cy + s, cx - s * 0.7, cy + s * 0.9)
        ctx.stroke()
        break
      case 1:
        ctx.beginPath()
        ctx.ellipse(cx, cy - s * 0.55, s * 0.32, s * 0.4, 0, 0, Math.PI * 2)
        ctx.moveTo(cx, cy - s * 0.15)
        ctx.lineTo(cx, cy + s)
        ctx.moveTo(cx - s * 0.5, cy)
        ctx.lineTo(cx + s * 0.5, cy)
        ctx.stroke()
        break
      case 2:
        ctx.beginPath()
        for (let k = 0; k < 3; k++) {
          const yy = cy - s * 0.5 + k * s * 0.5
          ctx.moveTo(cx - s, yy)
          for (let t = 0; t <= 4; t++) ctx.lineTo(cx - s + t * s * 0.5, yy + (t % 2 === 0 ? -s * 0.15 : s * 0.15))
        }
        ctx.stroke()
        break
      case 3:
        ctx.beginPath()
        ctx.moveTo(cx - s * 0.7, cy + s)
        ctx.quadraticCurveTo(cx - s * 0.9, cy - s * 0.2, cx - s * 0.1, cy - s * 0.4)
        ctx.quadraticCurveTo(cx + s * 0.3, cy - s * 1.1, cx + s * 0.7, cy - s * 0.6)
        ctx.lineTo(cx + s * 0.3, cy - s * 0.35)
        ctx.quadraticCurveTo(cx + s * 0.4, cy + s * 0.4, cx - s * 0.2, cy + s * 0.5)
        ctx.lineTo(cx + s * 0.1, cy + s)
        ctx.stroke()
        break
      case 4:
        ctx.beginPath()
        ctx.moveTo(cx, cy + s)
        ctx.lineTo(cx, cy - s)
        for (let k = 0; k < 3; k++) {
          ctx.moveTo(cx, cy - s * 0.6 + k * s * 0.45)
          ctx.lineTo(cx + s * 0.55, cy - s * 0.85 + k * s * 0.45)
        }
        ctx.stroke()
        break
      default:
        ctx.beginPath()
        ctx.arc(cx, cy, s * 0.55, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2)
        ctx.fill()
        break
    }
  }
  ctx.restore()
}

const LOW_STYLES: Record<number, { text: string; light: string; mid: string; dark: string; gem: [string, string, string] }> = {
  [Sym.Ten]: { text: '10', light: '#d7f4ef', mid: '#3fb6a8', dark: '#0d4f4a', gem: ['#c9fff6', '#22c3b0', '#04403a'] },
  [Sym.Jack]: { text: 'J', light: '#e3f7cf', mid: '#62b544', dark: '#1d4d12', gem: ['#efffd8', '#58c23b', '#16410b'] },
  [Sym.Queen]: { text: 'Q', light: '#f1def9', mid: '#a45ad0', dark: '#3e1460', gem: ['#fbe6ff', '#b555e8', '#360c55'] },
  [Sym.King]: { text: 'K', light: '#fde0d6', mid: '#d4513a', dark: '#5c140b', gem: ['#ffe2d8', '#ea4a30', '#530c04'] },
  [Sym.Ace]: { text: 'A', light: '#d9e8ff', mid: '#3f7fe0', dark: '#0d2b66', gem: ['#e2eeff', '#3b86ff', '#0a2259'] },
}

function drawLow(ctx: Ctx, sym: Sym): void {
  const style = LOW_STYLES[sym]
  ctx.fillStyle = radial(ctx, 128, 128, 120, [[0, 'rgba(255,214,120,0.22)'], [1, 'rgba(255,214,120,0)']])
  ctx.fillRect(0, 0, 256, 256)
  const size = style.text.length > 1 ? 150 : 178
  ctx.font = `900 ${size}px ${DISPLAY_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const y = 134
  ctx.save()
  if (style.text.length > 1) {
    ctx.translate(128, y)
    ctx.scale(0.82, 1)
    ctx.translate(-128, -y)
  }
  shadowed(ctx, 16, 'rgba(0,0,0,0.75)', () => {
    ctx.fillStyle = '#2a1606'
    ctx.fillText(style.text, 128, y + 6)
  })
  ctx.lineWidth = 14
  ctx.strokeStyle = gold(ctx, 40, 40, 216, 220)
  ctx.lineJoin = 'round'
  ctx.strokeText(style.text, 128, y)
  ctx.fillStyle = gold(ctx, 0, 40, 0, 220, [[0, style.light], [0.45, style.mid], [0.55, style.dark], [1, style.mid]])
  ctx.fillText(style.text, 128, y)
  ctx.lineWidth = 2.5
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.strokeText(style.text, 126, y - 3)
  ctx.restore()
  gem(ctx, 128, 224, 15, ...style.gem)
  hieroglyphs(ctx, 22, 16, 212, 24, 'rgba(255,214,120,0.45)', sym)
}

function drawScarab(ctx: Ctx): void {
  ctx.save()
  ctx.translate(128, 136)
  ctx.fillStyle = radial(ctx, 0, -78, 52, [[0, '#fff6c0'], [0.5, '#ff9d1c'], [1, 'rgba(255,90,0,0)']])
  ctx.beginPath()
  ctx.arc(0, -78, 52, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, -78, 30, 0, Math.PI * 2)
  ctx.fillStyle = gold(ctx, -30, -108, 30, -48, [[0, '#fff4b0'], [0.5, '#ff8a00'], [1, '#c43d00']])
  ctx.fill()
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.scale(side, 1)
    ctx.beginPath()
    ctx.moveTo(18, -10)
    ctx.bezierCurveTo(70, -60, 118, -40, 122, -6)
    ctx.bezierCurveTo(100, 4, 96, 24, 104, 44)
    ctx.bezierCurveTo(70, 34, 40, 34, 18, 22)
    ctx.closePath()
    ctx.fillStyle = gold(ctx, 18, -50, 122, 44)
    ctx.fill()
    ctx.strokeStyle = '#5a3505'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.beginPath()
    for (let k = 0; k < 4; k++) {
      ctx.moveTo(30 + k * 6, -2 + k * 6)
      ctx.quadraticCurveTo(70 + k * 4, -24 + k * 10, 112 - k * 3, -8 + k * 12)
    }
    ctx.strokeStyle = 'rgba(28,98,160,0.9)'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(16, -40)
    ctx.lineTo(32, -62)
    ctx.lineTo(22, -72)
    ctx.moveTo(18, 50)
    ctx.lineTo(42, 76)
    ctx.moveTo(14, 64)
    ctx.lineTo(24, 96)
    ctx.strokeStyle = gold(ctx, 0, -70, 40, 90)
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.restore()
  }
  ctx.beginPath()
  ctx.ellipse(0, 26, 36, 54, 0, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, -12, 6, 70, [[0, '#9fd8ff'], [0.35, '#2468c8'], [1, '#081c4f']])
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = gold(ctx, -36, -28, 36, 80)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, -24)
  ctx.lineTo(0, 78)
  ctx.strokeStyle = '#d7a640'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(0, -34, 26, 16, 0, 0, Math.PI * 2)
  ctx.fillStyle = gold(ctx, -26, -50, 26, -18)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(-12, 6, 10, 18, -0.3, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.fill()
  ctx.restore()
}

function drawAnkh(ctx: Ctx): void {
  ctx.save()
  ctx.translate(128, 128)
  ctx.fillStyle = radial(ctx, 0, 0, 120, [[0, 'rgba(64,220,200,0.35)'], [1, 'rgba(64,220,200,0)']])
  ctx.fillRect(-128, -128, 256, 256)
  const path = new Path2D()
  path.ellipse(0, -58, 40, 54, 0, 0, Math.PI * 2)
  path.ellipse(0, -58, 20, 34, 0, 0, Math.PI * 2)
  path.moveTo(-16, -6)
  path.lineTo(16, -6)
  path.lineTo(26, 110)
  path.lineTo(-26, 110)
  path.closePath()
  path.moveTo(-96, -10)
  path.lineTo(96, -10)
  path.lineTo(102, 22)
  path.lineTo(-102, 22)
  path.closePath()
  shadowed(ctx, 18, 'rgba(0,0,0,0.7)', () => {
    ctx.fillStyle = '#3a2203'
    ctx.fill(path, 'evenodd')
  })
  ctx.fillStyle = gold(ctx, -100, -110, 100, 110)
  ctx.fill(path, 'evenodd')
  ctx.lineWidth = 4
  ctx.strokeStyle = '#6b4207'
  ctx.stroke(path)
  ctx.beginPath()
  ctx.moveTo(-4, 4)
  ctx.lineTo(4, 4)
  ctx.lineTo(10, 96)
  ctx.lineTo(-10, 96)
  ctx.closePath()
  ctx.fillStyle = 'rgba(32,170,160,0.85)'
  ctx.fill()
  gem(ctx, 0, 6, 18, '#d9fff9', '#1fc3b2', '#06423c')
  gem(ctx, -84, 6, 9, '#ffd9e8', '#e8336d', '#5a0622')
  gem(ctx, 84, 6, 9, '#ffd9e8', '#e8336d', '#5a0622')
  ctx.restore()
}

function drawMask(ctx: Ctx): void {
  ctx.save()
  ctx.translate(128, 132)
  const head = new Path2D()
  head.moveTo(0, -112)
  head.bezierCurveTo(70, -112, 96, -70, 100, -20)
  head.lineTo(112, 104)
  head.lineTo(-112, 104)
  head.lineTo(-100, -20)
  head.bezierCurveTo(-96, -70, -70, -112, 0, -112)
  shadowed(ctx, 16, 'rgba(0,0,0,0.7)', () => {
    ctx.fillStyle = '#1b2f6a'
    ctx.fill(head)
  })
  ctx.save()
  ctx.clip(head)
  for (let k = -8; k < 12; k++) {
    ctx.fillStyle = k % 2 === 0 ? gold(ctx, -110, -110, 110, 110) : '#1d3f9a'
    ctx.beginPath()
    ctx.moveTo(-140, -110 + k * 20)
    ctx.quadraticCurveTo(0, -150 + k * 20, 140, -110 + k * 20)
    ctx.lineTo(140, -98 + k * 20)
    ctx.quadraticCurveTo(0, -138 + k * 20, -140, -98 + k * 20)
    ctx.fill()
  }
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(0, -78)
  ctx.bezierCurveTo(46, -78, 56, -40, 54, 0)
  ctx.bezierCurveTo(52, 46, 30, 76, 0, 80)
  ctx.bezierCurveTo(-30, 76, -52, 46, -54, 0)
  ctx.bezierCurveTo(-56, -40, -46, -78, 0, -78)
  ctx.fillStyle = gold(ctx, -54, -78, 54, 80, [[0, '#fff2c2'], [0.4, '#f2c050'], [0.75, '#b57a16'], [1, '#6a420a']])
  ctx.fill()
  ctx.strokeStyle = '#6a420a'
  ctx.lineWidth = 3
  ctx.stroke()
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(side * 10, -20)
    ctx.quadraticCurveTo(side * 26, -32, side * 42, -18)
    ctx.quadraticCurveTo(side * 26, -10, side * 10, -20)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = 5
    ctx.strokeStyle = '#101010'
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(side * 26, -20, 6, 0, Math.PI * 2)
    ctx.fillStyle = '#101010'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(side * 42, -18)
    ctx.lineTo(side * 54, -14)
    ctx.moveTo(side * 12, -38)
    ctx.quadraticCurveTo(side * 28, -46, side * 46, -36)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(-6, -8)
  ctx.lineTo(-10, 22)
  ctx.lineTo(10, 22)
  ctx.lineTo(6, -8)
  ctx.strokeStyle = '#8a5a12'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-18, 42)
  ctx.quadraticCurveTo(0, 50, 18, 42)
  ctx.strokeStyle = '#6a2a10'
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-10, 78)
  ctx.lineTo(10, 78)
  ctx.lineTo(6, 112)
  ctx.lineTo(-6, 112)
  ctx.closePath()
  ctx.fillStyle = gold(ctx, -10, 78, 10, 112)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(0, -112)
  ctx.bezierCurveTo(12, -100, 12, -88, 0, -80)
  ctx.bezierCurveTo(-12, -88, -12, -100, 0, -112)
  ctx.fillStyle = gold(ctx, -12, -112, 12, -80)
  ctx.fill()
  gem(ctx, 0, -96, 7, '#ffe0e0', '#e02030', '#4a0508')
  ctx.restore()
}

function face(ctx: Ctx, skin: [string, string, string]): void {
  ctx.beginPath()
  ctx.ellipse(0, 0, 46, 58, 0, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, -14, -18, 80, [[0, skin[0]], [0.55, skin[1]], [1, skin[2]]])
  ctx.fill()
}

function drawSunQueen(ctx: Ctx): void {
  ctx.save()
  ctx.translate(128, 128)
  ctx.beginPath()
  ctx.arc(0, 0, 116, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, 0, -20, 130, [[0, '#7b2f8f'], [0.7, '#3a0f4a'], [1, '#1a0522']])
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = gold(ctx, -116, -116, 116, 116)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-64, -40)
  ctx.bezierCurveTo(-70, -96, 70, -96, 64, -40)
  ctx.lineTo(70, 64)
  ctx.lineTo(40, 72)
  ctx.lineTo(-40, 72)
  ctx.lineTo(-70, 64)
  ctx.closePath()
  ctx.fillStyle = '#0b0b14'
  ctx.fill()
  ctx.save()
  ctx.translate(0, 8)
  face(ctx, ['#f6cfa2', '#c98b55', '#7a4a22'])
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(-50, -36)
  ctx.bezierCurveTo(-46, -78, 46, -78, 50, -36)
  ctx.lineTo(50, -18)
  ctx.lineTo(-50, -18)
  ctx.closePath()
  ctx.fillStyle = '#0b0b14'
  ctx.fill()
  ctx.beginPath()
  ctx.rect(-54, -34, 108, 12)
  ctx.fillStyle = gold(ctx, -54, -34, 54, -22)
  ctx.fill()
  for (let k = -2; k <= 2; k++) gem(ctx, k * 20, -28, 4, '#e6fff9', '#22c3b0', '#04403a')
  ctx.beginPath()
  ctx.moveTo(0, -36)
  ctx.bezierCurveTo(14, -54, -8, -64, 4, -80)
  ctx.lineWidth = 6
  ctx.strokeStyle = gold(ctx, -10, -80, 10, -36)
  ctx.stroke()
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(side * 8, 0)
    ctx.quadraticCurveTo(side * 22, -10, side * 36, 0)
    ctx.quadraticCurveTo(side * 22, 6, side * 8, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#0b0b14'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(side * 22, -1, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#2a1608'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(side * 36, 0)
    ctx.lineTo(side * 48, -6)
    ctx.moveTo(side * 6, -14)
    ctx.quadraticCurveTo(side * 24, -24, side * 40, -12)
    ctx.strokeStyle = '#0b0b14'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(side * 8, -6)
    ctx.quadraticCurveTo(side * 24, -18, side * 40, -6)
    ctx.strokeStyle = 'rgba(40,170,200,0.9)'
    ctx.lineWidth = 4
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(-14, 34)
  ctx.quadraticCurveTo(0, 28, 14, 34)
  ctx.quadraticCurveTo(0, 44, -14, 34)
  ctx.fillStyle = '#b3203a'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-60, 70)
  ctx.quadraticCurveTo(0, 104, 60, 70)
  ctx.lineTo(70, 96)
  ctx.quadraticCurveTo(0, 130, -70, 96)
  ctx.closePath()
  ctx.fillStyle = gold(ctx, -70, 70, 70, 120)
  ctx.fill()
  for (let k = -3; k <= 3; k++) gem(ctx, k * 18, 92 + Math.abs(k) * -2, 5, '#ffe0e8', '#e02a60', '#4a0520')
  ctx.restore()
}

function drawExplorer(ctx: Ctx): void {
  ctx.save()
  ctx.translate(128, 128)
  ctx.beginPath()
  ctx.arc(0, 0, 116, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, 0, -20, 130, [[0, '#2f6d6a'], [0.7, '#123836'], [1, '#061c1b']])
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = gold(ctx, -116, -116, 116, 116)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-70, 120)
  ctx.quadraticCurveTo(-60, 62, 0, 58)
  ctx.quadraticCurveTo(60, 62, 70, 120)
  ctx.fillStyle = '#9b7b45'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-26, 58)
  ctx.lineTo(0, 94)
  ctx.lineTo(26, 58)
  ctx.fillStyle = '#c23b2a'
  ctx.fill()
  ctx.save()
  ctx.translate(0, 14)
  face(ctx, ['#f2c8a0', '#c58c5c', '#6e4424'])
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(-92, -30)
  ctx.quadraticCurveTo(0, -4, 92, -30)
  ctx.quadraticCurveTo(0, -18, -92, -30)
  ctx.fillStyle = '#d8c08a'
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(0, -30, 92, 16, 0, 0, Math.PI * 2)
  ctx.fillStyle = gold(ctx, -92, -46, 92, -14, [[0, '#f5e3b5'], [0.5, '#cfb276'], [1, '#8a6f3c']])
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-56, -30)
  ctx.bezierCurveTo(-58, -100, 58, -100, 56, -30)
  ctx.closePath()
  ctx.fillStyle = gold(ctx, -56, -96, 56, -30, [[0, '#fbefcf'], [0.5, '#d9c08a'], [1, '#9c8048']])
  ctx.fill()
  ctx.beginPath()
  ctx.rect(-56, -42, 112, 10)
  ctx.fillStyle = '#5a3a1a'
  ctx.fill()
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(side * 18, 4, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#20140a'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(side * 6, -10)
    ctx.lineTo(side * 30, -12)
    ctx.strokeStyle = '#5a3418'
    ctx.lineWidth = 5
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(0, 28)
  ctx.bezierCurveTo(16, 22, 34, 26, 40, 38)
  ctx.bezierCurveTo(26, 34, 12, 38, 0, 34)
  ctx.bezierCurveTo(-12, 38, -26, 34, -40, 38)
  ctx.bezierCurveTo(-34, 26, -16, 22, 0, 28)
  ctx.fillStyle = '#5a3418'
  ctx.fill()
  ctx.restore()
}

function drawWild(ctx: Ctx): void {
  ctx.save()
  ctx.translate(128, 128)
  ctx.save()
  for (let k = 0; k < 16; k++) {
    ctx.rotate(Math.PI / 8)
    ctx.beginPath()
    ctx.moveTo(0, -30)
    ctx.lineTo(10, -124)
    ctx.lineTo(-10, -124)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,214,110,0.32)'
    ctx.fill()
  }
  ctx.restore()
  const pyramid = new Path2D()
  pyramid.moveTo(0, -92)
  pyramid.lineTo(104, 62)
  pyramid.lineTo(-104, 62)
  pyramid.closePath()
  shadowed(ctx, 20, 'rgba(0,0,0,0.8)', () => {
    ctx.fillStyle = '#4a2c05'
    ctx.fill(pyramid)
  })
  ctx.save()
  ctx.clip(pyramid)
  ctx.fillStyle = gold(ctx, -104, -92, 60, 62)
  ctx.fillRect(-110, -100, 220, 170)
  ctx.beginPath()
  ctx.moveTo(0, -92)
  ctx.lineTo(104, 62)
  ctx.lineTo(10, 62)
  ctx.closePath()
  ctx.fillStyle = 'rgba(90,50,0,0.35)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(90,50,0,0.45)'
  ctx.lineWidth = 2
  for (let k = 1; k < 8; k++) {
    ctx.beginPath()
    ctx.moveTo(-110, -92 + k * 20)
    ctx.lineTo(110, -92 + k * 20)
    ctx.stroke()
  }
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(0, -92)
  ctx.lineTo(22, -60)
  ctx.lineTo(-22, -60)
  ctx.closePath()
  ctx.fillStyle = radial(ctx, 0, -76, 30, [[0, '#ffffff'], [0.5, '#9ff2ff'], [1, '#2aa7d6']])
  ctx.fill()
  ctx.fillStyle = radial(ctx, 0, -80, 60, [[0, 'rgba(180,250,255,0.9)'], [1, 'rgba(120,220,255,0)']])
  ctx.beginPath()
  ctx.arc(0, -80, 60, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = `900 64px ${DISPLAY_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  shadowed(ctx, 10, 'rgba(0,0,0,0.9)', () => {
    ctx.fillStyle = '#3a0d0d'
    ctx.fillText('WILD', 0, 96)
  })
  ctx.lineWidth = 8
  ctx.strokeStyle = '#3a1404'
  ctx.strokeText('WILD', 0, 92)
  ctx.fillStyle = gold(ctx, 0, 66, 0, 118, [[0, '#ffffff'], [0.4, '#ffe066'], [0.6, '#e06a00'], [1, '#ffd060']])
  ctx.fillText('WILD', 0, 92)
  ctx.restore()
}

function drawScatter(ctx: Ctx): void {
  ctx.save()
  ctx.translate(128, 128)
  ctx.fillStyle = radial(ctx, 0, -10, 128, [[0, 'rgba(160,90,255,0.65)'], [1, 'rgba(70,20,140,0)']])
  ctx.fillRect(-128, -128, 256, 256)
  ctx.beginPath()
  ctx.moveTo(-104, -34)
  ctx.lineTo(0, -96)
  ctx.lineTo(104, -34)
  ctx.closePath()
  ctx.fillStyle = gold(ctx, -104, -96, 104, -34)
  ctx.fill()
  ctx.strokeStyle = '#5a3505'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, -56, 14, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, 0, -56, 14, [[0, '#ffffff'], [0.5, '#ffcf3a'], [1, '#d25a00']])
  ctx.fill()
  ctx.fillStyle = gold(ctx, -104, -34, 104, -22)
  ctx.fillRect(-108, -34, 216, 14)
  for (let k = 0; k < 5; k++) {
    const x = -84 + k * 42
    ctx.fillStyle = gold(ctx, x - 12, 0, x + 12, 0, [[0, '#8a5a12'], [0.35, '#ffe9a8'], [0.7, '#d29a2a'], [1, '#6a420a']])
    ctx.fillRect(x - 11, -18, 22, 82)
    ctx.fillStyle = 'rgba(90,50,0,0.4)'
    for (let f = -1; f <= 1; f++) ctx.fillRect(x + f * 6 - 1, -14, 2, 74)
  }
  ctx.fillStyle = 'rgba(30,6,60,0.85)'
  for (let k = 0; k < 4; k++) ctx.fillRect(-74 + k * 42, -18, 22, 82)
  ctx.fillStyle = gold(ctx, -112, 64, 112, 76)
  ctx.fillRect(-112, 64, 224, 12)
  ctx.font = `900 30px ${DISPLAY_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 6
  ctx.strokeStyle = '#1e0538'
  ctx.strokeText('FREE SPINS', 0, 100)
  ctx.fillStyle = gold(ctx, 0, 86, 0, 114, [[0, '#ffffff'], [0.5, '#f2c4ff'], [1, '#b85cff']])
  ctx.fillText('FREE SPINS', 0, 100)
  ctx.restore()
}

function coinBase(ctx: Ctx, inner: [string, string, string]): void {
  ctx.save()
  ctx.translate(128, 128)
  shadowed(ctx, 14, 'rgba(0,0,0,0.7)', () => {
    ctx.beginPath()
    ctx.arc(0, 0, 112, 0, Math.PI * 2)
    ctx.fillStyle = '#5a3a08'
    ctx.fill()
  })
  ctx.beginPath()
  ctx.arc(0, 0, 112, 0, Math.PI * 2)
  ctx.fillStyle = gold(ctx, -112, -112, 112, 112)
  ctx.fill()
  ctx.save()
  for (let k = 0; k < 24; k++) {
    ctx.rotate(Math.PI / 12)
    ctx.beginPath()
    ctx.moveTo(-7, -110)
    ctx.lineTo(7, -110)
    ctx.lineTo(0, -92)
    ctx.closePath()
    ctx.fillStyle = 'rgba(110,64,6,0.55)'
    ctx.fill()
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(0, 0, 88, 0, Math.PI * 2)
  ctx.lineWidth = 6
  ctx.strokeStyle = gold(ctx, 88, 88, -88, -88)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, 82, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, -20, -30, 120, [[0, inner[0]], [0.55, inner[1]], [1, inner[2]]])
  ctx.fill()
  ctx.restore()
}

function drawCashCoin(ctx: Ctx): void {
  coinBase(ctx, ['#7a4a10', '#4a2a06', '#241202'])
  ctx.save()
  ctx.translate(128, 128)
  ctx.globalAlpha = 0.35
  hieroglyphs(ctx, -64, -70, 128, 26, '#ffd36a', 3)
  ctx.globalAlpha = 1
  ctx.restore()
}

function drawJackpotCoin(ctx: Ctx, label: string, inner: [string, string, string], text: [string, string]): void {
  coinBase(ctx, inner)
  ctx.save()
  ctx.translate(128, 128)
  ctx.font = `900 ${label.length > 4 ? 44 : 52}px ${DISPLAY_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 8
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'
  ctx.strokeText(label, 0, 4)
  ctx.fillStyle = gold(ctx, 0, -20, 0, 26, [[0, '#ffffff'], [0.5, text[0]], [1, text[1]]])
  ctx.fillText(label, 0, 4)
  ctx.restore()
}

function drawSphinx(ctx: Ctx): void {
  ctx.save()
  ctx.translate(128, 128)
  ctx.beginPath()
  ctx.roundRect(-118, -118, 236, 236, 26)
  ctx.fillStyle = radial(ctx, 0, -10, 150, [[0, '#2e7a3a'], [0.6, '#0f3a18'], [1, '#04160a']])
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = gold(ctx, -118, -118, 118, 118)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, -96)
  ctx.bezierCurveTo(56, -96, 76, -60, 80, -20)
  ctx.lineTo(92, 62)
  ctx.lineTo(-92, 62)
  ctx.lineTo(-80, -20)
  ctx.bezierCurveTo(-76, -60, -56, -96, 0, -96)
  ctx.save()
  ctx.clip()
  for (let k = -6; k < 10; k++) {
    ctx.fillStyle = k % 2 === 0 ? gold(ctx, -92, -96, 92, 62) : '#7a5a2a'
    ctx.fillRect(-100, -96 + k * 14, 200, 7)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(0, -66)
  ctx.bezierCurveTo(38, -66, 44, -30, 42, 0)
  ctx.bezierCurveTo(40, 34, 22, 58, 0, 60)
  ctx.bezierCurveTo(-22, 58, -40, 34, -42, 0)
  ctx.bezierCurveTo(-44, -30, -38, -66, 0, -66)
  ctx.fillStyle = gold(ctx, -42, -66, 42, 60, [[0, '#f6dca4'], [0.5, '#c9a062'], [1, '#6e4a1e']])
  ctx.fill()
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(side * 8, -16)
    ctx.quadraticCurveTo(side * 20, -26, side * 34, -14)
    ctx.quadraticCurveTo(side * 20, -8, side * 8, -16)
    ctx.fillStyle = '#7dff9a'
    ctx.fill()
    ctx.shadowColor = '#7dff9a'
    ctx.shadowBlur = 14
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.lineWidth = 3
    ctx.strokeStyle = '#1a1006'
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(-14, 32)
  ctx.lineTo(14, 32)
  ctx.strokeStyle = '#3a2208'
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.font = `900 34px ${DISPLAY_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 6
  ctx.strokeStyle = '#04160a'
  ctx.strokeText('COLLECT', 0, 92)
  ctx.fillStyle = gold(ctx, 0, 78, 0, 106, [[0, '#ffffff'], [0.5, '#b8ffb0'], [1, '#3ad15a']])
  ctx.fillText('COLLECT', 0, 92)
  ctx.restore()
}

function drawBlank(ctx: Ctx): void {
  ctx.save()
  ctx.translate(128, 128)
  ctx.globalAlpha = 0.16
  hieroglyphs(ctx, -96, -60, 192, 34, '#ffd790', 1)
  hieroglyphs(ctx, -96, 26, 192, 34, '#ffd790', 4)
  ctx.globalAlpha = 1
  ctx.restore()
}

function drawParticles(ctx: Ctx): void {
  withCell(ctx, AtlasCell.Spark, (c) => {
    c.fillStyle = radial(c, 128, 128, 120, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,240,180,1)'], [0.35, 'rgba(255,190,60,0.55)'], [1, 'rgba(255,140,0,0)']])
    c.fillRect(0, 0, 256, 256)
  })
  withCell(ctx, AtlasCell.Dust, (c) => {
    c.fillStyle = radial(c, 128, 128, 120, [[0, 'rgba(255,228,170,0.85)'], [0.5, 'rgba(230,190,120,0.35)'], [1, 'rgba(200,160,90,0)']])
    c.fillRect(0, 0, 256, 256)
  })
  withCell(ctx, AtlasCell.SmallCoin, (c) => {
    c.beginPath()
    c.ellipse(128, 128, 104, 104, 0, 0, Math.PI * 2)
    c.fillStyle = gold(c, 24, 24, 232, 232)
    c.fill()
    c.lineWidth = 12
    c.strokeStyle = '#8a5a10'
    c.stroke()
    c.beginPath()
    c.arc(128, 128, 54, 0, Math.PI * 2)
    c.lineWidth = 10
    c.strokeStyle = 'rgba(120,70,8,0.7)'
    c.stroke()
  })
  withCell(ctx, AtlasCell.White, (c) => {
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, 256, 256)
  })
  withCell(ctx, AtlasCell.Glow, (c) => {
    c.fillStyle = radial(c, 128, 128, 126, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']])
    c.fillRect(0, 0, 256, 256)
  })
  withCell(ctx, AtlasCell.ScarabSpark, (c) => {
    c.fillStyle = radial(c, 128, 128, 126, [[0, 'rgba(120,255,220,0.9)'], [1, 'rgba(0,200,160,0)']])
    c.fillRect(0, 0, 256, 256)
    c.translate(128, 128)
    c.beginPath()
    c.ellipse(0, 12, 34, 48, 0, 0, Math.PI * 2)
    c.ellipse(0, -44, 22, 14, 0, 0, Math.PI * 2)
    c.fillStyle = '#ffffff'
    c.fill()
    c.lineWidth = 8
    c.strokeStyle = '#ffffff'
    for (const side of [-1, 1]) {
      c.beginPath()
      c.moveTo(side * 30, -10)
      c.lineTo(side * 64, -36)
      c.moveTo(side * 30, 20)
      c.lineTo(side * 66, 30)
      c.moveTo(side * 26, 44)
      c.lineTo(side * 52, 78)
      c.stroke()
    }
  })
  withCell(ctx, AtlasCell.Ring, (c) => {
    c.beginPath()
    c.arc(128, 128, 100, 0, Math.PI * 2)
    c.lineWidth = 18
    c.strokeStyle = '#ffffff'
    c.shadowColor = '#ffffff'
    c.shadowBlur = 20
    c.stroke()
  })
  withCell(ctx, AtlasCell.Star, (c) => {
    c.translate(128, 128)
    c.fillStyle = radial(c, 0, 0, 120, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,240,200,0.6)'], [1, 'rgba(255,200,100,0)']])
    c.fillRect(-128, -128, 256, 256)
    c.beginPath()
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4
      const r = k % 2 === 0 ? 124 : 40
      c.lineTo(Math.cos(angle) * r, Math.sin(angle) * r)
      c.lineTo(Math.cos(angle + Math.PI / 8) * 10, Math.sin(angle + Math.PI / 8) * 10)
    }
    c.closePath()
    c.fillStyle = '#ffffff'
    c.fill()
  })
}

function drawGlyphs(ctx: Ctx): void {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ;[...GLYPH_CHARS].forEach((char, index) => {
    const x = index * GLYPH_W
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, GLYPH_Y, GLYPH_W, GLYPH_H)
    ctx.clip()
    ctx.font = `900 92px ${DISPLAY_FONT}`
    const width = ctx.measureText(char).width
    const squeeze = Math.min(1, (GLYPH_W - 12) / Math.max(1, width))
    ctx.translate(x + GLYPH_W / 2, GLYPH_Y + GLYPH_H / 2 + 4)
    ctx.scale(squeeze, 1)
    ctx.lineJoin = 'round'
    ctx.lineWidth = 12
    ctx.strokeStyle = '#1c0d02'
    ctx.strokeText(char, 0, 0)
    ctx.fillStyle = gold(ctx, 0, -40, 0, 40, [[0, '#ffffff'], [0.3, '#fff0a0'], [0.55, '#ffc53a'], [0.8, '#e08a10'], [1, '#ffe080']])
    ctx.fillText(char, 0, 0)
    ctx.restore()
  })
  ctx.restore()
}

function drawBands(ctx: Ctx): void {
  ctx.save()
  ctx.fillStyle = gold(ctx, 0, BAND_Y, 0, BAND_Y + BAND_H, [[0, '#fff2b8'], [0.12, '#e2a93c'], [0.5, '#c88c22'], [0.88, '#8a5810'], [1, '#3a2204']])
  ctx.fillRect(0, BAND_Y, ATLAS_SIZE, BAND_H)
  ctx.fillStyle = '#1a3d8a'
  ctx.fillRect(0, BAND_Y + 18, ATLAS_SIZE, BAND_H - 36)
  ctx.fillStyle = gold(ctx, 0, BAND_Y + 18, 0, BAND_Y + BAND_H - 18, [[0, '#0f2a66'], [0.5, '#2a5cc0'], [1, '#0a1c44']])
  ctx.fillRect(0, BAND_Y + 20, ATLAS_SIZE, BAND_H - 40)
  hieroglyphs(ctx, 0, BAND_Y + 24, ATLAS_SIZE, BAND_H - 48, '#ffd36a', 0)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(0, BAND_Y + 2, ATLAS_SIZE, 3)
  ctx.fillStyle = gold(ctx, 0, BAR_Y, 0, BAR_Y + BAR_H, [[0, '#fff6cc'], [0.2, '#ffd56a'], [0.5, '#b57a16'], [0.75, '#f2c860'], [1, '#4a2c05']])
  ctx.fillRect(0, BAR_Y, ATLAS_SIZE, BAR_H)
  ctx.restore()
}

function drawSymbols(ctx: Ctx): void {
  for (const sym of [Sym.Ten, Sym.Jack, Sym.Queen, Sym.King, Sym.Ace]) withCell(ctx, sym, (c) => drawLow(c, sym))
  withCell(ctx, Sym.Scarab, drawScarab)
  withCell(ctx, Sym.Ankh, drawAnkh)
  withCell(ctx, Sym.Mask, drawMask)
  withCell(ctx, Sym.Pharaoh, drawSunQueen)
  withCell(ctx, Sym.Explorer, drawExplorer)
  withCell(ctx, Sym.Wild, drawWild)
  withCell(ctx, Sym.Scatter, drawScatter)
  withCell(ctx, Sym.Coin, drawCashCoin)
  withCell(ctx, Sym.Sphinx, drawSphinx)
  withCell(ctx, AtlasCell.CoinMini, (c) => drawJackpotCoin(c, 'MINI', ['#3fc85a', '#147a2a', '#05300f'], ['#d8ffd0', '#4be06a']))
  withCell(ctx, AtlasCell.CoinMinor, (c) => drawJackpotCoin(c, 'MINOR', ['#46a6ff', '#1352b0', '#061e4a'], ['#d8efff', '#5ab4ff']))
  withCell(ctx, AtlasCell.CoinMajor, (c) => drawJackpotCoin(c, 'MAJOR', ['#c35cff', '#6a1aa8', '#28063f'], ['#f6dcff', '#cf7cff']))
  withCell(ctx, AtlasCell.CoinGrand, (c) => drawJackpotCoin(c, 'GRAND', ['#ff7a3a', '#b0280c', '#4a0a02'], ['#fff0d0', '#ff9a3a']))
  withCell(ctx, AtlasCell.Blank, drawBlank)
}

export async function ensureDisplayFont(timeoutMs = 2500): Promise<void> {
  if (!('fonts' in document)) return
  const load = Promise.all([document.fonts.load(`900 92px "Cinzel"`), document.fonts.load(`700 40px "Cinzel"`)]).then(() => undefined)
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))
  await Promise.race([load.catch(() => undefined), timeout])
}

export function buildAtlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_SIZE
  canvas.height = ATLAS_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable')
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)
  drawSymbols(ctx)
  drawParticles(ctx)
  drawGlyphs(ctx)
  drawBands(ctx)
  return canvas
}

export function buildMipChain(base: HTMLCanvasElement, levels = ATLAS_MIP_LEVELS): HTMLCanvasElement[] {
  const chain = [base]
  for (let level = 1; level < levels; level++) {
    const previous = chain[level - 1]
    const next = document.createElement('canvas')
    next.width = Math.max(1, previous.width >> 1)
    next.height = Math.max(1, previous.height >> 1)
    const ctx = next.getContext('2d')
    if (!ctx) break
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(previous, 0, 0, next.width, next.height)
    chain.push(next)
  }
  return chain
}

export function buildBackdropCanvas(size = 1024): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable')
  const s = size / 1024
  ctx.scale(s, s)
  const sky = ctx.createLinearGradient(0, 0, 0, 1024)
  sky.addColorStop(0, '#0a0620')
  sky.addColorStop(0.35, '#2a1048')
  sky.addColorStop(0.58, '#8a2e4a')
  sky.addColorStop(0.7, '#ef8a3a')
  sky.addColorStop(0.78, '#ffc76a')
  sky.addColorStop(1, '#3a1a0a')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 1024, 1024)
  let seed = 1337
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let k = 0; k < 260; k++) {
    const x = rand() * 1024
    const y = rand() * 520
    const r = rand() * 1.6 + 0.3
    ctx.fillStyle = `rgba(255,${220 + Math.floor(rand() * 35)},${200 + Math.floor(rand() * 55)},${0.3 + rand() * 0.7})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = radial(ctx, 512, 760, 420, [[0, 'rgba(255,230,160,0.95)'], [0.18, 'rgba(255,170,70,0.65)'], [0.5, 'rgba(255,110,40,0.2)'], [1, 'rgba(255,80,30,0)']])
  ctx.fillRect(0, 300, 1024, 724)
  ctx.beginPath()
  ctx.arc(512, 760, 92, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, 512, 740, 100, [[0, '#fffbe8'], [0.6, '#ffd77a'], [1, '#ff9a3a']])
  ctx.fill()
  const pyramid = (x: number, base: number, w: number, h: number, light: string, dark: string) => {
    ctx.beginPath()
    ctx.moveTo(x, base - h)
    ctx.lineTo(x + w / 2, base)
    ctx.lineTo(x - w / 2, base)
    ctx.closePath()
    ctx.fillStyle = dark
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x, base - h)
    ctx.lineTo(x - w / 2, base)
    ctx.lineTo(x - w * 0.08, base)
    ctx.closePath()
    ctx.fillStyle = light
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x, base - h)
    ctx.lineTo(x - w * 0.04, base - h + h * 0.08)
    ctx.lineTo(x + w * 0.04, base - h + h * 0.08)
    ctx.closePath()
    ctx.fillStyle = '#ffe9a0'
    ctx.fill()
  }
  pyramid(220, 830, 420, 300, '#7a3a24', '#3a160e')
  pyramid(800, 840, 520, 360, '#80402a', '#3a160e')
  pyramid(520, 850, 260, 150, '#6a3020', '#30120a')
  ctx.fillStyle = '#2a0f08'
  ctx.beginPath()
  ctx.moveTo(0, 860)
  for (let x = 0; x <= 1024; x += 32) ctx.lineTo(x, 840 + Math.sin(x * 0.012) * 18 + Math.sin(x * 0.031) * 8)
  ctx.lineTo(1024, 1024)
  ctx.lineTo(0, 1024)
  ctx.closePath()
  ctx.fill()
  const dune = ctx.createLinearGradient(0, 860, 0, 1024)
  dune.addColorStop(0, '#5a2a12')
  dune.addColorStop(1, '#1a0904')
  ctx.fillStyle = dune
  ctx.beginPath()
  ctx.moveTo(0, 900)
  for (let x = 0; x <= 1024; x += 32) ctx.lineTo(x, 900 + Math.sin(x * 0.008 + 1.3) * 26)
  ctx.lineTo(1024, 1024)
  ctx.lineTo(0, 1024)
  ctx.closePath()
  ctx.fill()
  for (const x of [70, 954]) {
    ctx.beginPath()
    ctx.moveTo(x - 26, 1024)
    ctx.lineTo(x - 16, 420)
    ctx.lineTo(x, 390)
    ctx.lineTo(x + 16, 420)
    ctx.lineTo(x + 26, 1024)
    ctx.closePath()
    ctx.fillStyle = gold(ctx, x - 26, 0, x + 26, 0, [[0, '#2a1006'], [0.4, '#7a4a20'], [0.6, '#4a240e'], [1, '#1a0804']])
    ctx.fill()
    ctx.globalAlpha = 0.5
    for (let y = 460; y < 980; y += 52) hieroglyphs(ctx, x - 12, y, 24, 22, '#ffcf70', y)
    ctx.globalAlpha = 1
  }
  const vignette = ctx.createRadialGradient(512, 512, 300, 512, 512, 760)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.65)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, 1024, 1024)
  return canvas
}
