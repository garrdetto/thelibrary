import type { SymbolId } from '../../foxlake/casino/math/reels'

export const TILE = 240
export const DISPLAY_FONT = '"Bungee", "Arial Black", Impact, sans-serif'
export const BODY_FONT = '"Nunito", ui-sans-serif, system-ui, sans-serif'

type Ctx = CanvasRenderingContext2D
type Stops = readonly [number, string][]

export interface SymbolInfo {
  id: SymbolId
  name: string
  kind: 'low' | 'high' | 'wild' | 'scatter' | 'collector' | 'cash'
}

export const SYMBOLS: readonly SymbolInfo[] = [
  { id: 'h1', name: 'Supercar', kind: 'high' },
  { id: 'h2', name: 'Diamond Ring', kind: 'high' },
  { id: 'h3', name: 'Gold Watch', kind: 'high' },
  { id: 'h4', name: 'Champagne', kind: 'high' },
  { id: 'h5', name: 'Gold Shades', kind: 'high' },
  { id: 'A', name: 'A', kind: 'low' },
  { id: 'K', name: 'K', kind: 'low' },
  { id: 'Q', name: 'Q', kind: 'low' },
  { id: 'J', name: 'J', kind: 'low' },
  { id: 'W', name: 'Gold Bar Wild', kind: 'wild' },
  { id: 'S', name: 'Vault Scatter', kind: 'scatter' },
  { id: 'M', name: 'Big Bag', kind: 'collector' },
  { id: 'N', name: 'Cash Bill', kind: 'cash' },
]

export function ensureFonts(): Promise<void> {
  if (!('fonts' in document)) return Promise.resolve()
  const loads = [`700 48px ${DISPLAY_FONT}`, `800 24px ${BODY_FONT}`].map((font) => document.fonts.load(font).catch(() => []))
  return Promise.race([Promise.all(loads).then(() => undefined), new Promise<void>((resolve) => window.setTimeout(resolve, 2500))])
}

function surface(size = TILE): [HTMLCanvasElement, Ctx] {
  const element = document.createElement('canvas')
  element.width = size
  element.height = size
  const ctx = element.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available on this device.')
  return [element, ctx]
}

function linear(g: Ctx, x0: number, y0: number, x1: number, y1: number, stops: Stops): CanvasGradient {
  const gradient = g.createLinearGradient(x0, y0, x1, y1)
  for (const [at, color] of stops) gradient.addColorStop(at, color)
  return gradient
}

function radial(g: Ctx, x: number, y: number, r: number, stops: Stops): CanvasGradient {
  const gradient = g.createRadialGradient(x, y, 0, x, y, r)
  for (const [at, color] of stops) gradient.addColorStop(at, color)
  return gradient
}

export function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + radius, y)
  g.arcTo(x + w, y, x + w, y + h, radius)
  g.arcTo(x + w, y + h, x, y + h, radius)
  g.arcTo(x, y + h, x, y, radius)
  g.arcTo(x, y, x + w, y, radius)
  g.closePath()
}

export const GOLD: Stops = [[0, '#fff7cf'], [0.28, '#ffd65a'], [0.55, '#c98a12'], [0.78, '#ffe28a'], [1, '#7a4a08']]
const CASH_GREEN: Stops = [[0, '#c9f7b8'], [0.45, '#5fc15a'], [1, '#1d6a2a']]

function withShadow(g: Ctx, blur: number, color: string, draw: () => void): void {
  g.save()
  g.shadowBlur = blur
  g.shadowColor = color
  g.shadowOffsetY = blur * 0.25
  draw()
  g.restore()
}

function tileBack(g: Ctx, base: string, glow: string): void {
  const s = TILE
  roundRect(g, 8, 8, s - 16, s - 16, 34)
  g.fillStyle = radial(g, s / 2, s * 0.42, s * 0.7, [[0, glow], [0.6, base], [1, '#05110a']])
  g.fill()
  g.lineWidth = 6
  g.strokeStyle = linear(g, 0, 8, 0, s - 8, GOLD)
  g.stroke()
}

function letter(g: Ctx, text: string, stops: Stops, rim: string): void {
  const s = TILE
  g.font = `400 ${s * 0.62}px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  withShadow(g, 14, 'rgba(0,0,0,0.65)', () => {
    g.lineWidth = s * 0.07
    g.strokeStyle = rim
    g.strokeText(text, s / 2, s * 0.54)
  })
  g.fillStyle = linear(g, 0, s * 0.22, 0, s * 0.82, stops)
  g.fillText(text, s / 2, s * 0.54)
  g.lineWidth = 3
  g.strokeStyle = 'rgba(255,255,255,0.55)'
  g.strokeText(text, s / 2, s * 0.53)
}

function emojiArt(g: Ctx, glyph: string, scale = 0.6): void {
  const s = TILE
  g.font = `${s * scale}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  withShadow(g, 18, 'rgba(0,0,0,0.6)', () => g.fillText(glyph, s / 2, s * 0.5))
}

function caption(g: Ctx, text: string, color = '#fff3c4', y = TILE * 0.86): void {
  const s = TILE
  g.font = `400 ${s * 0.13}px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 7
  g.lineJoin = 'round'
  g.strokeStyle = 'rgba(10,6,0,0.9)'
  g.strokeText(text, s / 2, y)
  g.fillStyle = color
  g.fillText(text, s / 2, y)
}

function drawCar(g: Ctx): void {
  const s = TILE
  g.save()
  g.translate(s / 2, s * 0.56)
  g.beginPath()
  g.moveTo(-s * 0.38, s * 0.06)
  g.quadraticCurveTo(-s * 0.4, -s * 0.06, -s * 0.28, -s * 0.08)
  g.quadraticCurveTo(-s * 0.12, -s * 0.24, s * 0.08, -s * 0.2)
  g.quadraticCurveTo(s * 0.24, -s * 0.16, s * 0.34, -s * 0.06)
  g.quadraticCurveTo(s * 0.42, -s * 0.02, s * 0.4, s * 0.07)
  g.closePath()
  g.fillStyle = linear(g, 0, -s * 0.22, 0, s * 0.08, [[0, '#ff8a7a'], [0.4, '#e01a1a'], [1, '#6a0606']])
  withShadow(g, 12, 'rgba(0,0,0,0.6)', () => g.fill())
  g.lineWidth = 4
  g.strokeStyle = '#3a0202'
  g.stroke()
  g.beginPath()
  g.moveTo(-s * 0.16, -s * 0.09)
  g.quadraticCurveTo(-s * 0.06, -s * 0.2, s * 0.08, -s * 0.17)
  g.lineTo(s * 0.18, -s * 0.08)
  g.closePath()
  g.fillStyle = linear(g, 0, -s * 0.2, 0, -s * 0.08, [[0, '#d8f4ff'], [1, '#3a6a8a']])
  g.fill()
  for (const x of [-s * 0.23, s * 0.24]) {
    g.beginPath()
    g.arc(x, s * 0.07, s * 0.075, 0, Math.PI * 2)
    g.fillStyle = '#141414'
    g.fill()
    g.beginPath()
    g.arc(x, s * 0.07, s * 0.04, 0, Math.PI * 2)
    g.fillStyle = linear(g, 0, 0, 0, s * 0.1, GOLD)
    g.fill()
  }
  g.fillStyle = 'rgba(255,255,255,0.55)'
  g.fillRect(-s * 0.3, -s * 0.03, s * 0.5, 3)
  g.restore()
}

function drawRing(g: Ctx): void {
  const s = TILE
  g.save()
  g.translate(s / 2, s * 0.6)
  g.beginPath()
  g.ellipse(0, s * 0.02, s * 0.2, s * 0.18, 0, 0, Math.PI * 2)
  g.lineWidth = s * 0.06
  g.strokeStyle = linear(g, -s * 0.2, 0, s * 0.2, 0, GOLD)
  withShadow(g, 10, 'rgba(0,0,0,0.6)', () => g.stroke())
  g.beginPath()
  g.moveTo(0, -s * 0.36)
  g.lineTo(s * 0.15, -s * 0.24)
  g.lineTo(0, -s * 0.12)
  g.lineTo(-s * 0.15, -s * 0.24)
  g.closePath()
  g.fillStyle = linear(g, 0, -s * 0.36, 0, -s * 0.12, [[0, '#ffffff'], [0.4, '#9fe8ff'], [1, '#2a7ac8']])
  withShadow(g, 18, 'rgba(140,220,255,0.9)', () => g.fill())
  g.lineWidth = 2.5
  g.strokeStyle = '#e8fbff'
  g.stroke()
  g.beginPath()
  g.moveTo(-s * 0.15, -s * 0.24)
  g.lineTo(s * 0.15, -s * 0.24)
  g.moveTo(0, -s * 0.36)
  g.lineTo(0, -s * 0.12)
  g.stroke()
  g.restore()
}

function drawWatch(g: Ctx): void {
  const s = TILE
  g.save()
  g.translate(s / 2, s * 0.5)
  g.fillStyle = linear(g, 0, -s * 0.4, 0, s * 0.4, GOLD)
  g.fillRect(-s * 0.09, -s * 0.38, s * 0.18, s * 0.76)
  g.beginPath()
  g.arc(0, 0, s * 0.2, 0, Math.PI * 2)
  g.fillStyle = linear(g, 0, -s * 0.2, 0, s * 0.2, GOLD)
  withShadow(g, 12, 'rgba(0,0,0,0.6)', () => g.fill())
  g.beginPath()
  g.arc(0, 0, s * 0.155, 0, Math.PI * 2)
  g.fillStyle = radial(g, -s * 0.05, -s * 0.05, s * 0.2, [[0, '#2a3a52'], [1, '#081018']])
  g.fill()
  g.strokeStyle = '#ffe9a0'
  g.lineCap = 'round'
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    g.lineWidth = i % 3 === 0 ? 4 : 2
    g.beginPath()
    g.moveTo(Math.cos(a) * s * 0.12, Math.sin(a) * s * 0.12)
    g.lineTo(Math.cos(a) * s * 0.145, Math.sin(a) * s * 0.145)
    g.stroke()
  }
  g.lineWidth = 5
  g.beginPath()
  g.moveTo(0, 0)
  g.lineTo(s * 0.07, -s * 0.06)
  g.moveTo(0, 0)
  g.lineTo(-s * 0.02, -s * 0.11)
  g.stroke()
  g.fillStyle = 'rgba(255,255,255,0.22)'
  g.beginPath()
  g.ellipse(-s * 0.05, -s * 0.07, s * 0.08, s * 0.04, -0.6, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

function drawChampagne(g: Ctx): void {
  const s = TILE
  g.save()
  g.translate(s / 2, s * 0.52)
  g.beginPath()
  g.moveTo(-s * 0.08, -s * 0.38)
  g.lineTo(s * 0.08, -s * 0.38)
  g.lineTo(s * 0.08, -s * 0.2)
  g.quadraticCurveTo(s * 0.17, -s * 0.12, s * 0.17, s * 0.02)
  g.lineTo(s * 0.17, s * 0.34)
  g.quadraticCurveTo(0, s * 0.4, -s * 0.17, s * 0.34)
  g.lineTo(-s * 0.17, s * 0.02)
  g.quadraticCurveTo(-s * 0.17, -s * 0.12, -s * 0.08, -s * 0.2)
  g.closePath()
  g.fillStyle = linear(g, -s * 0.17, 0, s * 0.17, 0, [[0, '#0a3a1a'], [0.45, '#2a8a4a'], [1, '#062210']])
  withShadow(g, 12, 'rgba(0,0,0,0.6)', () => g.fill())
  g.fillStyle = linear(g, 0, -s * 0.4, 0, -s * 0.18, GOLD)
  g.fillRect(-s * 0.085, -s * 0.4, s * 0.17, s * 0.2)
  g.fillStyle = '#f6efd8'
  roundRect(g, -s * 0.13, s * 0.02, s * 0.26, s * 0.18, 8)
  g.fill()
  g.fillStyle = '#7a1a2a'
  g.font = `400 ${s * 0.1}px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('$$', 0, s * 0.115)
  g.fillStyle = 'rgba(255,255,255,0.35)'
  g.fillRect(-s * 0.13, -s * 0.12, s * 0.04, s * 0.42)
  for (let i = 0; i < 9; i++) {
    g.beginPath()
    g.arc(Math.sin(i * 2.3) * s * 0.12, -s * 0.44 - (i % 4) * s * 0.03, 3 + (i % 3), 0, Math.PI * 2)
    g.fillStyle = 'rgba(255,240,180,0.85)'
    g.fill()
  }
  g.restore()
}

function drawShades(g: Ctx): void {
  const s = TILE
  g.save()
  g.translate(s / 2, s * 0.52)
  g.lineWidth = s * 0.03
  g.strokeStyle = linear(g, -s * 0.4, 0, s * 0.4, 0, GOLD)
  g.beginPath()
  g.moveTo(-s * 0.38, -s * 0.08)
  g.lineTo(s * 0.38, -s * 0.08)
  g.stroke()
  for (const side of [-1, 1]) {
    g.beginPath()
    g.moveTo(side * s * 0.03, -s * 0.09)
    g.lineTo(side * s * 0.33, -s * 0.09)
    g.quadraticCurveTo(side * s * 0.33, s * 0.16, side * s * 0.18, s * 0.16)
    g.quadraticCurveTo(side * s * 0.03, s * 0.16, side * s * 0.03, -s * 0.09)
    g.closePath()
    g.fillStyle = linear(g, 0, -s * 0.1, 0, s * 0.16, [[0, '#3a2a10'], [0.5, '#0a0a0a'], [1, '#2a1a40']])
    withShadow(g, 10, 'rgba(0,0,0,0.6)', () => g.fill())
    g.lineWidth = 4
    g.strokeStyle = linear(g, 0, -s * 0.1, 0, s * 0.16, GOLD)
    g.stroke()
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.beginPath()
    g.ellipse(side * s * 0.16, -s * 0.02, s * 0.07, s * 0.025, -0.4 * side, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
}

function drawGoldBar(g: Ctx): void {
  const s = TILE
  g.save()
  g.translate(s / 2, s * 0.46)
  g.beginPath()
  g.moveTo(-s * 0.32, s * 0.14)
  g.lineTo(-s * 0.22, -s * 0.12)
  g.lineTo(s * 0.22, -s * 0.12)
  g.lineTo(s * 0.32, s * 0.14)
  g.closePath()
  g.fillStyle = linear(g, 0, -s * 0.12, 0, s * 0.14, GOLD)
  withShadow(g, 22, 'rgba(255,200,40,0.85)', () => g.fill())
  g.lineWidth = 4
  g.strokeStyle = '#6a3a00'
  g.stroke()
  g.beginPath()
  g.moveTo(-s * 0.22, -s * 0.12)
  g.lineTo(-s * 0.18, -s * 0.02)
  g.lineTo(s * 0.18, -s * 0.02)
  g.lineTo(s * 0.22, -s * 0.12)
  g.fillStyle = 'rgba(255,255,255,0.35)'
  g.fill()
  g.font = `400 ${s * 0.13}px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#6a3a00'
  g.fillText('$', 0, s * 0.07)
  g.restore()
  g.font = `400 ${s * 0.2}px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 9
  g.lineJoin = 'round'
  g.strokeStyle = '#2a1200'
  g.strokeText('WILD', s / 2, s * 0.78)
  g.fillStyle = linear(g, 0, s * 0.68, 0, s * 0.88, GOLD)
  g.fillText('WILD', s / 2, s * 0.78)
}

function drawVault(g: Ctx): void {
  const s = TILE
  g.save()
  g.translate(s / 2, s * 0.44)
  g.beginPath()
  g.arc(0, 0, s * 0.31, 0, Math.PI * 2)
  g.fillStyle = linear(g, 0, -s * 0.31, 0, s * 0.31, [[0, '#f2f5f8'], [0.45, '#8c98a6'], [1, '#2c3440']])
  withShadow(g, 16, 'rgba(0,0,0,0.7)', () => g.fill())
  g.lineWidth = 6
  g.strokeStyle = linear(g, 0, -s * 0.31, 0, s * 0.31, GOLD)
  g.stroke()
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    g.beginPath()
    g.arc(Math.cos(a) * s * 0.265, Math.sin(a) * s * 0.265, 4, 0, Math.PI * 2)
    g.fillStyle = '#d8dde4'
    g.fill()
  }
  g.beginPath()
  g.arc(0, 0, s * 0.19, 0, Math.PI * 2)
  g.fillStyle = linear(g, 0, -s * 0.19, 0, s * 0.19, [[0, '#4a5462'], [1, '#c8d0da']])
  g.fill()
  g.strokeStyle = linear(g, -s * 0.2, 0, s * 0.2, 0, GOLD)
  g.lineWidth = s * 0.03
  g.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3
    g.beginPath()
    g.moveTo(Math.cos(a) * s * 0.05, Math.sin(a) * s * 0.05)
    g.lineTo(Math.cos(a) * s * 0.17, Math.sin(a) * s * 0.17)
    g.stroke()
  }
  g.beginPath()
  g.arc(0, 0, s * 0.055, 0, Math.PI * 2)
  g.fillStyle = linear(g, 0, -s * 0.06, 0, s * 0.06, GOLD)
  g.fill()
  g.restore()
  roundRect(g, s * 0.1, s * 0.74, s * 0.8, s * 0.17, 14)
  g.fillStyle = linear(g, 0, s * 0.74, 0, s * 0.91, [[0, '#ff5ac8'], [1, '#8a1270']])
  g.fill()
  g.lineWidth = 3
  g.strokeStyle = '#ffd6f2'
  g.stroke()
  g.font = `400 ${s * 0.1}px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#ffffff'
  g.fillText('FREE GAMES', s / 2, s * 0.83)
}

export function drawBag(g: Ctx, x: number, y: number, size: number, sway = 0): void {
  const s = size
  g.save()
  g.translate(x + s / 2, y + s * 0.55)
  g.rotate(sway)
  g.beginPath()
  g.moveTo(-s * 0.12, -s * 0.3)
  g.quadraticCurveTo(-s * 0.4, -s * 0.12, -s * 0.38, s * 0.14)
  g.quadraticCurveTo(-s * 0.36, s * 0.36, 0, s * 0.37)
  g.quadraticCurveTo(s * 0.36, s * 0.36, s * 0.38, s * 0.14)
  g.quadraticCurveTo(s * 0.4, -s * 0.12, s * 0.12, -s * 0.3)
  g.closePath()
  g.fillStyle = linear(g, -s * 0.38, 0, s * 0.38, 0, [[0, '#7a6a3a'], [0.35, '#d8c27a'], [0.7, '#b39a52'], [1, '#5a4a22']])
  withShadow(g, s * 0.06, 'rgba(0,0,0,0.6)', () => g.fill())
  g.lineWidth = Math.max(2, s * 0.018)
  g.strokeStyle = '#3a2c0a'
  g.stroke()
  g.beginPath()
  g.moveTo(-s * 0.12, -s * 0.3)
  g.lineTo(-s * 0.2, -s * 0.44)
  g.lineTo(-s * 0.04, -s * 0.38)
  g.lineTo(0, -s * 0.47)
  g.lineTo(s * 0.06, -s * 0.38)
  g.lineTo(s * 0.21, -s * 0.44)
  g.lineTo(s * 0.12, -s * 0.3)
  g.fillStyle = '#b39a52'
  g.fill()
  g.stroke()
  g.fillStyle = linear(g, 0, -s * 0.34, 0, -s * 0.27, GOLD)
  roundRect(g, -s * 0.16, -s * 0.34, s * 0.32, s * 0.07, s * 0.03)
  g.fill()
  for (const side of [-1, 1]) {
    g.beginPath()
    g.moveTo(side * s * 0.02, -s * 0.12)
    g.lineTo(side * s * 0.26, -s * 0.12)
    g.quadraticCurveTo(side * s * 0.26, s * 0.0, side * s * 0.15, s * 0.0)
    g.quadraticCurveTo(side * s * 0.03, s * 0.0, side * s * 0.02, -s * 0.12)
    g.closePath()
    g.fillStyle = '#0d0d0d'
    g.fill()
    g.lineWidth = Math.max(1.5, s * 0.012)
    g.strokeStyle = linear(g, 0, -s * 0.12, 0, 0, GOLD)
    g.stroke()
    g.fillStyle = 'rgba(255,255,255,0.4)'
    g.beginPath()
    g.ellipse(side * s * 0.13, -s * 0.08, s * 0.05, s * 0.015, -0.3 * side, 0, Math.PI * 2)
    g.fill()
  }
  g.beginPath()
  g.moveTo(-s * 0.1, s * 0.06)
  g.quadraticCurveTo(0, s * 0.13, s * 0.11, s * 0.05)
  g.lineWidth = Math.max(2, s * 0.022)
  g.strokeStyle = '#3a2c0a'
  g.lineCap = 'round'
  g.stroke()
  g.beginPath()
  g.moveTo(-s * 0.3, s * 0.12)
  g.quadraticCurveTo(0, s * 0.3, s * 0.3, s * 0.12)
  g.lineWidth = Math.max(2, s * 0.03)
  g.strokeStyle = linear(g, -s * 0.3, 0, s * 0.3, 0, GOLD)
  g.stroke()
  g.beginPath()
  g.arc(0, s * 0.23, s * 0.07, 0, Math.PI * 2)
  g.fillStyle = linear(g, 0, s * 0.16, 0, s * 0.3, GOLD)
  g.fill()
  g.font = `400 ${s * 0.09}px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#6a3a00'
  g.fillText('$', 0, s * 0.235)
  g.restore()
}

export function drawBill(g: Ctx, x: number, y: number, w: number, h: number, label: string, jackpot = false): void {
  g.save()
  const bw = w * 0.86
  const bh = h * 0.58
  const bx = x + (w - bw) / 2
  const by = y + (h - bh) / 2 - h * 0.04
  roundRect(g, bx, by, bw, bh, h * 0.05)
  g.fillStyle = linear(g, bx, by, bx, by + bh, jackpot ? [[0, '#ffe6a8'], [0.5, '#e8a42a'], [1, '#7a4a08']] : CASH_GREEN)
  withShadow(g, h * 0.06, 'rgba(0,0,0,0.6)', () => g.fill())
  g.lineWidth = Math.max(2, h * 0.02)
  g.strokeStyle = jackpot ? '#4a2a00' : '#0e3a14'
  g.stroke()
  roundRect(g, bx + bw * 0.06, by + bh * 0.1, bw * 0.88, bh * 0.8, h * 0.03)
  g.strokeStyle = jackpot ? 'rgba(90,50,0,0.6)' : 'rgba(14,58,20,0.55)'
  g.stroke()
  g.beginPath()
  g.ellipse(bx + bw / 2, by + bh / 2, bw * 0.17, bh * 0.36, 0, 0, Math.PI * 2)
  g.fillStyle = jackpot ? 'rgba(255,240,190,0.7)' : 'rgba(220,255,210,0.6)'
  g.fill()
  for (const cx of [bx + bw * 0.14, bx + bw * 0.86]) {
    g.beginPath()
    g.arc(cx, by + bh / 2, bh * 0.16, 0, Math.PI * 2)
    g.fillStyle = jackpot ? 'rgba(120,70,0,0.35)' : 'rgba(14,58,20,0.35)'
    g.fill()
  }
  const size = label.length > 6 ? 0.2 : label.length > 4 ? 0.24 : 0.28
  g.font = `400 ${h * size}px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = Math.max(3, h * 0.05)
  g.strokeStyle = jackpot ? '#3a1a00' : '#062a0c'
  g.strokeText(label, x + w / 2, by + bh / 2)
  g.fillStyle = jackpot ? '#fff6c8' : '#ffffff'
  g.fillText(label, x + w / 2, by + bh / 2)
  g.restore()
}

export function drawCoin(g: Ctx, x: number, y: number, w: number, h: number, label: string, dim = false): void {
  g.save()
  g.globalAlpha = dim ? 0.38 : 1
  const r = Math.min(w, h) * 0.36
  const cx = x + w / 2
  const cy = y + h / 2
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fillStyle = radial(g, cx - r * 0.35, cy - r * 0.35, r * 1.4, [[0, '#fff6c0'], [0.45, '#ffc21f'], [1, '#8a4c00']])
  withShadow(g, r * 0.3, dim ? 'rgba(0,0,0,0.4)' : 'rgba(255,190,40,0.8)', () => g.fill())
  g.lineWidth = Math.max(2, r * 0.12)
  g.strokeStyle = '#6a3a00'
  g.stroke()
  g.beginPath()
  g.arc(cx, cy, r * 0.78, 0, Math.PI * 2)
  g.lineWidth = Math.max(1, r * 0.05)
  g.strokeStyle = 'rgba(106,58,0,0.55)'
  g.stroke()
  const size = label.length > 6 ? 0.42 : label.length > 4 ? 0.5 : 0.6
  g.font = `400 ${r * size}px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = Math.max(2, r * 0.1)
  g.strokeStyle = '#4a2600'
  g.strokeText(label, cx, cy + r * 0.03)
  g.fillStyle = '#fffbe6'
  g.fillText(label, cx, cy + r * 0.03)
  g.restore()
}

const HIGH_BACK: Record<string, [string, string]> = {
  h1: ['#3a0a10', '#ff6a5a'],
  h2: ['#0a1a3a', '#6ab8ff'],
  h3: ['#2a1a04', '#ffd060'],
  h4: ['#2a0a2a', '#e078e0'],
  h5: ['#06242a', '#5ae0d0'],
}

const LOW_STYLE: Record<string, { stops: Stops; rim: string; back: [string, string] }> = {
  A: { stops: [[0, '#fff6c8'], [0.5, '#ffc93a'], [1, '#a86a08']], rim: '#3a2000', back: ['#1a1404', '#5a4a1a'] },
  K: { stops: [[0, '#ffd0c8'], [0.5, '#ff4a3a'], [1, '#8a0e06']], rim: '#2a0402', back: ['#1a0606', '#5a1a14'] },
  Q: { stops: [[0, '#f0d8ff'], [0.5, '#b45aff'], [1, '#5a1a9a']], rim: '#1a0430', back: ['#120620', '#3a1a5a'] },
  J: { stops: [[0, '#d0fff4'], [0.5, '#3ad6b4'], [1, '#0a6a5a']], rim: '#022a22', back: ['#04161a', '#124a42'] },
}

export function buildTile(sym: SymbolId): HTMLCanvasElement {
  const [element, g] = surface()
  const low = LOW_STYLE[sym]
  if (low) {
    tileBack(g, low.back[0], low.back[1])
    letter(g, sym, low.stops, low.rim)
    return element
  }
  const high = HIGH_BACK[sym]
  if (high) {
    tileBack(g, high[0], high[1])
    if (sym === 'h1') drawCar(g)
    else if (sym === 'h2') drawRing(g)
    else if (sym === 'h3') drawWatch(g)
    else if (sym === 'h4') drawChampagne(g)
    else drawShades(g)
    return element
  }
  if (sym === 'W') {
    tileBack(g, '#2a1a00', '#ffb020')
    drawGoldBar(g)
  } else if (sym === 'S') {
    tileBack(g, '#1a0618', '#c03aa8')
    drawVault(g)
  } else if (sym === 'M') {
    tileBack(g, '#0a2010', '#48c060')
    drawBag(g, TILE * 0.06, TILE * 0.0, TILE * 0.88)
    caption(g, 'COLLECT', '#eaffd8', TILE * 0.88)
  } else if (sym === 'N') {
    tileBack(g, '#06180c', '#2a8a3a')
    drawBill(g, 0, 0, TILE, TILE, '$')
  } else {
    tileBack(g, '#101010', '#404040')
    emojiArt(g, '❔')
  }
  return element
}

export function blurTile(tile: HTMLCanvasElement): HTMLCanvasElement {
  const [element, g] = surface(tile.width)
  for (let i = -3; i <= 3; i++) {
    g.globalAlpha = 0.22
    g.drawImage(tile, 0, i * tile.height * 0.05)
  }
  return element
}
