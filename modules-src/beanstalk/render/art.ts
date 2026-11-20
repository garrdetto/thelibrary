import { Sym } from '../engine/paytable'

export const TILE = 256
export const DISPLAY_FONT = '"Luckiest Guy", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif'

type Ctx = CanvasRenderingContext2D

function canvas(size = TILE): [HTMLCanvasElement, Ctx] {
  const element = document.createElement('canvas')
  element.width = size
  element.height = size
  const ctx = element.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available.')
  return [element, ctx]
}

function linear(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: readonly [number, string][]): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1)
  for (const [at, color] of stops) gradient.addColorStop(at, color)
  return gradient
}

function radial(ctx: Ctx, x: number, y: number, r: number, stops: readonly [number, string][]): CanvasGradient {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
  for (const [at, color] of stops) gradient.addColorStop(at, color)
  return gradient
}

const GOLD: readonly [number, string][] = [[0, '#fff6c8'], [0.3, '#ffd65a'], [0.6, '#d8951c'], [0.8, '#ffe08a'], [1, '#8a5410']]

function shadow(ctx: Ctx, blur: number, color: string, draw: () => void): void {
  ctx.save()
  ctx.shadowBlur = blur
  ctx.shadowColor = color
  ctx.shadowOffsetY = blur / 4
  draw()
  ctx.restore()
}

export function leaf(ctx: Ctx, x: number, y: number, length: number, angle: number, light = '#9cf06a', dark = '#2f8a2c'): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(length * 0.5, -length * 0.42, length, 0)
  ctx.quadraticCurveTo(length * 0.5, length * 0.42, 0, 0)
  ctx.fillStyle = linear(ctx, 0, -length * 0.4, 0, length * 0.4, [[0, light], [1, dark]])
  ctx.fill()
  ctx.strokeStyle = 'rgba(20,70,20,0.55)'
  ctx.lineWidth = Math.max(1, length * 0.05)
  ctx.beginPath()
  ctx.moveTo(length * 0.08, 0)
  ctx.lineTo(length * 0.85, 0)
  ctx.stroke()
  ctx.restore()
}

const LOW: Record<number, { text: string; light: string; dark: string; rim: string }> = {
  [Sym.Ten]: { text: '10', light: '#ffb0a0', dark: '#c0392b', rim: '#5c1308' },
  [Sym.Jack]: { text: 'J', light: '#a9dcff', dark: '#2a78d6', rim: '#0d2c5a' },
  [Sym.Queen]: { text: 'Q', light: '#e2b8ff', dark: '#8e44c9', rim: '#371053' },
  [Sym.King]: { text: 'K', light: '#ffd79a', dark: '#e07a12', rim: '#5a2b02' },
  [Sym.Ace]: { text: 'A', light: '#c4ffa8', dark: '#34a83a', rim: '#0f3d12' },
}

function drawLow(ctx: Ctx, sym: Sym): void {
  const style = LOW[sym]
  const size = style.text.length > 1 ? 132 : 158
  ctx.font = `${size}px ${DISPLAY_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const y = 142
  shadow(ctx, 14, 'rgba(0,0,0,0.55)', () => {
    ctx.lineJoin = 'round'
    ctx.lineWidth = 18
    ctx.strokeStyle = style.rim
    ctx.strokeText(style.text, 128, y)
  })
  ctx.fillStyle = linear(ctx, 0, y - size / 2, 0, y + size / 2, [[0, style.light], [0.55, style.dark], [1, style.rim]])
  ctx.fillText(style.text, 128, y)
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = 'rgba(255,255,255,0.32)'
  ctx.fillRect(0, y - size / 2, TILE, size * 0.3)
  ctx.restore()
  leaf(ctx, 190, 62, 46, -0.6)
  leaf(ctx, 192, 64, 34, 0.5, '#c8ff8c', '#3b9b33')
}

function drawBeans(ctx: Ctx): void {
  shadow(ctx, 16, 'rgba(0,0,0,0.5)', () => {
    ctx.beginPath()
    ctx.ellipse(128, 150, 96, 54, -0.25, 0, Math.PI * 2)
    ctx.fillStyle = linear(ctx, 0, 100, 0, 210, [[0, '#9be86b'], [1, '#2c7a26']])
    ctx.fill()
  })
  ctx.beginPath()
  ctx.ellipse(128, 142, 80, 36, -0.25, 0, Math.PI * 2)
  ctx.fillStyle = '#1d4d1a'
  ctx.fill()
  const beans: [number, number, string, string][] = [[80, 156, '#e9a8ff', '#7a1fb0'], [128, 142, '#9ee7ff', '#1f6fc0'], [176, 128, '#ffd36b', '#c26b0a']]
  for (const [x, y, light, dark] of beans) {
    ctx.beginPath()
    ctx.ellipse(x, y, 30, 22, -0.25, 0, Math.PI * 2)
    ctx.fillStyle = radial(ctx, x - 8, y - 8, 34, [[0, '#ffffff'], [0.25, light], [1, dark]])
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.beginPath()
    ctx.ellipse(x - 9, y - 8, 8, 4, -0.5, 0, Math.PI * 2)
    ctx.fill()
  }
  star(ctx, 60, 84, 14, '#fff6b0')
  star(ctx, 200, 196, 10, '#fff6b0')
  leaf(ctx, 196, 92, 50, -0.9)
}

export function star(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  for (let point = 0; point < 8; point++) {
    const radius = point % 2 === 0 ? r : r * 0.32
    const angle = (point / 8) * Math.PI * 2 - Math.PI / 2
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

function drawAxe(ctx: Ctx): void {
  ctx.save()
  ctx.translate(128, 130)
  ctx.rotate(-0.55)
  shadow(ctx, 14, 'rgba(0,0,0,0.5)', () => {
    ctx.fillStyle = linear(ctx, -12, 0, 12, 0, [[0, '#7a4416'], [0.45, '#c98a4a'], [1, '#5a2e0c']])
    ctx.beginPath()
    ctx.roundRect(-12, -96, 24, 200, 12)
    ctx.fill()
  })
  ctx.strokeStyle = 'rgba(60,30,8,0.5)'
  ctx.lineWidth = 2
  for (let y = -80; y < 100; y += 22) {
    ctx.beginPath()
    ctx.moveTo(-10, y)
    ctx.quadraticCurveTo(0, y + 6, 10, y)
    ctx.stroke()
  }
  shadow(ctx, 10, 'rgba(0,0,0,0.5)', () => {
    ctx.beginPath()
    ctx.moveTo(-6, -92)
    ctx.lineTo(62, -110)
    ctx.quadraticCurveTo(96, -60, 66, -6)
    ctx.lineTo(-6, -30)
    ctx.closePath()
    ctx.fillStyle = linear(ctx, 0, -110, 0, -6, [[0, '#f4f8ff'], [0.4, '#a9b7c9'], [0.7, '#e6eef8'], [1, '#56657a']])
    ctx.fill()
  })
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(64, -104)
  ctx.quadraticCurveTo(90, -60, 66, -12)
  ctx.stroke()
  ctx.fillStyle = '#d23b2a'
  ctx.fillRect(-14, 60, 28, 14)
  ctx.restore()
}

function drawHarp(ctx: Ctx): void {
  ctx.save()
  shadow(ctx, 16, 'rgba(0,0,0,0.5)', () => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = linear(ctx, 50, 30, 210, 230, GOLD)
    ctx.lineWidth = 22
    ctx.beginPath()
    ctx.moveTo(70, 220)
    ctx.lineTo(70, 54)
    ctx.quadraticCurveTo(120, 18, 150, 60)
    ctx.quadraticCurveTo(180, 100, 214, 96)
    ctx.lineTo(96, 220)
    ctx.closePath()
    ctx.stroke()
  })
  ctx.strokeStyle = 'rgba(255,250,220,0.95)'
  ctx.lineWidth = 3
  for (let index = 0; index < 6; index++) {
    const x = 88 + index * 18
    const top = index < 3 ? 52 + index * 6 : 74 + (index - 3) * 8
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, 214 - index * 14)
    ctx.stroke()
  }
  ctx.fillStyle = radial(ctx, 70, 54, 22, [[0, '#ffffff'], [0.4, '#ffd65a'], [1, '#a8650e']])
  ctx.beginPath()
  ctx.arc(70, 50, 18, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffb3c8'
  ctx.beginPath()
  ctx.arc(64, 48, 4, 0, Math.PI * 2)
  ctx.arc(77, 48, 4, 0, Math.PI * 2)
  ctx.fill()
  star(ctx, 196, 44, 13, '#fff6b0')
  ctx.restore()
}

function drawHen(ctx: Ctx): void {
  shadow(ctx, 18, 'rgba(0,0,0,0.5)', () => {
    ctx.beginPath()
    ctx.ellipse(136, 206, 46, 30, 0, 0, Math.PI * 2)
    ctx.fillStyle = radial(ctx, 120, 192, 60, [[0, '#ffffff'], [0.3, '#ffe58a'], [1, '#b8770f']])
    ctx.fill()
  })
  ctx.beginPath()
  ctx.ellipse(124, 140, 78, 58, 0.15, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, 100, 110, 110, [[0, '#fff3c0'], [0.4, '#ffcf45'], [1, '#a5640c']])
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(46, 120)
  ctx.quadraticCurveTo(14, 70, 54, 60)
  ctx.quadraticCurveTo(60, 96, 76, 112)
  ctx.closePath()
  ctx.fillStyle = '#e8a81e'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(176, 88, 34, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, 168, 78, 40, [[0, '#fff6d0'], [0.5, '#ffd24a'], [1, '#b8770f']])
  ctx.fill()
  ctx.fillStyle = '#e8302a'
  for (const [x, y, r] of [[166, 54, 11], [180, 50, 12], [194, 56, 10]] as const) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.beginPath()
  ctx.moveTo(206, 88)
  ctx.lineTo(234, 96)
  ctx.lineTo(206, 104)
  ctx.closePath()
  ctx.fillStyle = '#ff9a1a'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(196, 108)
  ctx.quadraticCurveTo(202, 128, 190, 132)
  ctx.quadraticCurveTo(184, 118, 192, 108)
  ctx.fillStyle = '#e8302a'
  ctx.fill()
  ctx.fillStyle = '#2a1606'
  ctx.beginPath()
  ctx.arc(186, 84, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(188, 82, 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(140,80,10,0.6)'
  ctx.lineWidth = 4
  for (let index = 0; index < 3; index++) {
    ctx.beginPath()
    ctx.arc(116, 150 + index * 4, 34 - index * 8, 0.2, Math.PI - 0.4)
    ctx.stroke()
  }
  star(ctx, 40, 196, 12, '#fff6b0')
}

function drawGiant(ctx: Ctx): void {
  shadow(ctx, 18, 'rgba(0,0,0,0.45)', () => {
    ctx.fillStyle = radial(ctx, 128, 128, 130, [[0, '#ffffff'], [0.7, '#e4f1ff'], [1, '#a9c6e8']])
    for (const [x, y, r] of [[60, 150, 52], [196, 150, 52], [128, 96, 70], [90, 196, 46], [166, 196, 46]] as const) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  })
  ctx.beginPath()
  ctx.ellipse(128, 120, 58, 66, 0, 0, Math.PI * 2)
  ctx.fillStyle = radial(ctx, 112, 100, 80, [[0, '#ffe2c4'], [0.6, '#f0a878'], [1, '#b8653a']])
  ctx.fill()
  ctx.fillStyle = linear(ctx, 0, 140, 0, 230, [[0, '#ffffff'], [1, '#c9d6e6']])
  ctx.beginPath()
  ctx.moveTo(70, 132)
  ctx.quadraticCurveTo(80, 236, 128, 238)
  ctx.quadraticCurveTo(176, 236, 186, 132)
  ctx.quadraticCurveTo(164, 160, 128, 156)
  ctx.quadraticCurveTo(92, 160, 70, 132)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(108, 152, 24, 11, 0.3, 0, Math.PI * 2)
  ctx.ellipse(148, 152, 24, 11, -0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(104, 102, 15, 12, 0, 0, Math.PI * 2)
  ctx.ellipse(152, 102, 15, 12, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1f5fbf'
  ctx.beginPath()
  ctx.arc(106, 104, 7, 0, Math.PI * 2)
  ctx.arc(150, 104, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(108, 101, 2.5, 0, Math.PI * 2)
  ctx.arc(152, 101, 2.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#f2f6ff'
  ctx.lineWidth = 9
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(86, 82)
  ctx.quadraticCurveTo(104, 70, 120, 84)
  ctx.moveTo(136, 84)
  ctx.quadraticCurveTo(152, 70, 170, 82)
  ctx.stroke()
  ctx.fillStyle = '#e48a64'
  ctx.beginPath()
  ctx.ellipse(128, 128, 13, 16, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = linear(ctx, 0, 30, 0, 64, GOLD)
  ctx.beginPath()
  ctx.moveTo(84, 66)
  ctx.lineTo(90, 30)
  ctx.lineTo(108, 50)
  ctx.lineTo(128, 22)
  ctx.lineTo(148, 50)
  ctx.lineTo(166, 30)
  ctx.lineTo(172, 66)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#e8302a'
  ctx.beginPath()
  ctx.arc(128, 52, 6, 0, Math.PI * 2)
  ctx.fill()
}

function wildBanner(ctx: Ctx, y: number, fill: readonly [number, string][]): void {
  ctx.font = `64px ${DISPLAY_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  shadow(ctx, 10, 'rgba(0,0,0,0.6)', () => {
    ctx.lineWidth = 12
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#173d10'
    ctx.strokeText('WILD', 128, y)
  })
  ctx.fillStyle = linear(ctx, 0, y - 30, 0, y + 30, fill)
  ctx.fillText('WILD', 128, y)
}

function drawSeed(ctx: Ctx): void {
  ctx.fillStyle = radial(ctx, 128, 140, 120, [[0, 'rgba(255,255,170,0.85)'], [0.5, 'rgba(160,255,120,0.35)'], [1, 'rgba(160,255,120,0)']])
  ctx.fillRect(0, 0, TILE, TILE)
  ctx.strokeStyle = linear(ctx, 0, 40, 0, 200, [[0, '#9cf06a'], [1, '#2f7a24']])
  ctx.lineWidth = 12
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(128, 176)
  ctx.bezierCurveTo(118, 140, 142, 110, 128, 64)
  ctx.stroke()
  leaf(ctx, 128, 92, 70, -2.5)
  leaf(ctx, 128, 92, 70, -0.65)
  leaf(ctx, 126, 132, 44, 0.3, '#c8ff8c', '#3b9b33')
  shadow(ctx, 16, 'rgba(0,0,0,0.5)', () => {
    ctx.beginPath()
    ctx.ellipse(128, 182, 50, 36, 0, 0, Math.PI * 2)
    ctx.fillStyle = radial(ctx, 112, 166, 60, [[0, '#ffffff'], [0.25, '#d6a2ff'], [0.7, '#7a2cc0'], [1, '#3d0f6a']])
    ctx.fill()
  })
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.ellipse(108, 168, 14, 7, -0.5, 0, Math.PI * 2)
  ctx.fill()
  wildBanner(ctx, 222, [[0, '#fffbd0'], [0.5, '#ffd84a'], [1, '#e08a10']])
  star(ctx, 54, 54, 14, '#ffffff')
  star(ctx, 206, 150, 10, '#fff6b0')
}

function drawVine(ctx: Ctx): void {
  ctx.fillStyle = radial(ctx, 128, 128, 140, [[0, 'rgba(190,255,150,0.55)'], [1, 'rgba(60,160,60,0.15)']])
  ctx.fillRect(0, 0, TILE, TILE)
  for (const [offset, width, light, dark] of [[-20, 30, '#7dd957', '#256b1e'], [22, 22, '#a6ef74', '#33852a']] as const) {
    ctx.strokeStyle = linear(ctx, 90 + offset, 0, 166 + offset, 0, [[0, dark], [0.5, light], [1, dark]])
    ctx.lineWidth = width
    ctx.lineCap = 'butt'
    ctx.beginPath()
    ctx.moveTo(128 + offset, TILE + 4)
    ctx.bezierCurveTo(60 + offset * 2, 180, 196 - offset * 2, 80, 128 + offset, -4)
    ctx.stroke()
  }
  for (const [x, y, length, angle] of [[90, 200, 60, 2.6], [168, 158, 58, -0.4], [86, 96, 56, 3.4], [170, 52, 50, -0.8], [120, 236, 44, 0.5]] as const) leaf(ctx, x, y, length, angle)
  ctx.strokeStyle = '#5bbf3a'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(196, 210, 16, Math.PI, Math.PI * 2.6)
  ctx.stroke()
  wildBanner(ctx, 128, [[0, '#f0ffd0'], [0.5, '#9ef06a'], [1, '#2f9a2a']])
}

function drawCastle(ctx: Ctx): void {
  shadow(ctx, 16, 'rgba(0,0,0,0.35)', () => {
    ctx.fillStyle = radial(ctx, 128, 200, 130, [[0, '#ffffff'], [0.7, '#eaf4ff'], [1, '#b3cdea']])
    for (const [x, y, r] of [[56, 206, 40], [104, 194, 50], [160, 196, 48], [206, 208, 38], [128, 222, 46]] as const) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  })
  const stone = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = linear(ctx, x, 0, x + w, 0, [[0, '#9b8bd6'], [0.5, '#e4dcff'], [1, '#7363b8']])
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = linear(ctx, x, 0, x + w, 0, [[0, '#9b8bd6'], [0.5, '#e4dcff'], [1, '#7363b8']])
    for (let notch = x; notch < x + w; notch += w / 3) ctx.fillRect(notch, y - 12, w / 6, 12)
  }
  stone(70, 110, 116, 80)
  stone(52, 70, 38, 120)
  stone(166, 70, 38, 120)
  stone(108, 44, 40, 70)
  ctx.fillStyle = linear(ctx, 0, 6, 0, 50, GOLD)
  for (const [x, y, w] of [[52, 58, 38], [166, 58, 38], [108, 32, 40]] as const) {
    ctx.beginPath()
    ctx.moveTo(x - 4, y + 12)
    ctx.lineTo(x + w / 2, y - 34)
    ctx.lineTo(x + w + 4, y + 12)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = '#3b2a6e'
  ctx.beginPath()
  ctx.moveTo(110, 190)
  ctx.lineTo(110, 156)
  ctx.arc(128, 156, 18, Math.PI, 0)
  ctx.lineTo(146, 190)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ffe680'
  for (const [x, y] of [[71, 100], [185, 100], [128, 70], [96, 136], [160, 136]] as const) {
    ctx.beginPath()
    ctx.roundRect(x - 6, y - 10, 12, 20, 6)
    ctx.fill()
  }
  ctx.fillStyle = '#ff5a6a'
  ctx.beginPath()
  ctx.moveTo(128, -2)
  ctx.lineTo(128, 14)
  ctx.lineTo(150, 6)
  ctx.closePath()
  ctx.fill()
  ctx.font = `40px ${DISPLAY_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 9
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#3b1f7a'
  ctx.strokeText('BONUS', 128, 226)
  ctx.fillStyle = linear(ctx, 0, 206, 0, 246, GOLD)
  ctx.fillText('BONUS', 128, 226)
}

const DRAW: Record<number, (ctx: Ctx) => void> = {
  [Sym.Bean]: drawBeans,
  [Sym.Axe]: drawAxe,
  [Sym.Harp]: drawHarp,
  [Sym.Hen]: drawHen,
  [Sym.Giant]: drawGiant,
  [Sym.Seed]: drawSeed,
  [Sym.Vine]: drawVine,
  [Sym.Castle]: drawCastle,
}

export function buildSymbols(): HTMLCanvasElement[] {
  const tiles: HTMLCanvasElement[] = []
  for (let symbol = 0; symbol <= Sym.Castle; symbol++) {
    const [element, ctx] = canvas()
    ctx.save()
    ctx.translate(TILE / 2, TILE / 2)
    ctx.scale(0.86, 0.86)
    ctx.translate(-TILE / 2, -TILE / 2)
    if (symbol <= Sym.Ace) drawLow(ctx, symbol as Sym)
    else DRAW[symbol](ctx)
    ctx.restore()
    tiles.push(element)
  }
  return tiles
}

export function buildBlurred(tiles: readonly HTMLCanvasElement[]): HTMLCanvasElement[] {
  return tiles.map((tile) => {
    const [element, ctx] = canvas()
    for (let step = -3; step <= 3; step++) {
      ctx.globalAlpha = 0.22
      ctx.drawImage(tile, 0, step * 14)
    }
    return element
  })
}

export async function ensureFonts(timeoutMs = 2500): Promise<void> {
  if (!('fonts' in document)) return
  await Promise.race([document.fonts.load(`64px ${DISPLAY_FONT}`).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, timeoutMs))])
}
