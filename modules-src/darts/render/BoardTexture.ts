/** Procedural board textures drawn on canvas at regulation proportions, in two styles. Steel-tip bristle: alternating black/cream singles, red/green doubles and trebles, both bulls, sisal fibre, the wire spider and a bold, outlined number ring. Spider 360 3000 soft-tip: red and black moulded segments perforated with tip holes, a raised plastic spider, a wide black catch ring with white numbers and a red trim. Each style gets a colour face, a packed roughness/metal map (G = roughness, B = metalness) and a normal map that raises the spider and numbers (and sinks the soft-tip holes). */
import * as THREE from 'three/webgpu'
import { RADII, SECTORS, SECTOR_DEGREES } from '../shared/Board'
import { createRng } from '../shared/Rng'

export type BoardStyle = 'steel' | 'spider'

export const BOARD_STYLES: readonly { id: BoardStyle; label: string }[] = [
  { id: 'steel', label: 'Steel Tip' },
  { id: 'spider', label: 'Soft Tip' },
]

export function isBoardStyle(value: unknown): value is BoardStyle {
  return value === 'steel' || value === 'spider'
}

export const BOARD_COLORS = {
  black: '#141312',
  cream: '#f1e4c2',
  red: '#d01f30',
  green: '#0f8a4f',
  sisal: '#1a1816',
  wire: '#e6e9ee',
  number: '#ffffff',
  numberEdge: '#050505',
} as const

export const SPIDER_COLORS = {
  black: '#141416',
  red: '#d0162a',
  catch: '#0c0c0e',
  spider: '#3c3d42',
  number: '#ffffff',
  trim: '#e3192f',
} as const

export interface BoardTextures {
  color: THREE.CanvasTexture
  roughnessMetal: THREE.CanvasTexture
  normal: THREE.CanvasTexture
  dispose(): void
}

interface Painter {
  ctx: CanvasRenderingContext2D
  canvas: HTMLCanvasElement
  size: number
  /** Pixels per millimetre. */
  scale: number
  cx: number
  cy: number
}

function painter(size: number): Painter {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is not available')
  return { ctx, canvas, size, scale: size / (RADII.board * 2), cx: size / 2, cy: size / 2 }
}

/** Board angle (degrees clockwise from straight up) to a canvas angle (radians clockwise from +x, since canvas y points down). */
function canvasAngle(degrees: number): number {
  return ((degrees - 90) * Math.PI) / 180
}

function wedge(p: Painter, inner: number, outer: number, fromDeg: number, toDeg: number, fill: string): void {
  const { ctx, cx, cy, scale } = p
  ctx.beginPath()
  ctx.arc(cx, cy, outer * scale, canvasAngle(fromDeg), canvasAngle(toDeg), false)
  ctx.arc(cx, cy, inner * scale, canvasAngle(toDeg), canvasAngle(fromDeg), true)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

function disc(p: Painter, radius: number, fill: string): void {
  p.ctx.beginPath()
  p.ctx.arc(p.cx, p.cy, radius * p.scale, 0, Math.PI * 2)
  p.ctx.fillStyle = fill
  p.ctx.fill()
}

function ring(p: Painter, radius: number, widthMm: number, style: string): void {
  p.ctx.beginPath()
  p.ctx.arc(p.cx, p.cy, radius * p.scale, 0, Math.PI * 2)
  p.ctx.strokeStyle = style
  p.ctx.lineWidth = widthMm * p.scale
  p.ctx.stroke()
}

const WIRE_RADII = [RADII.innerBull, RADII.outerBull, RADII.tripleInner, RADII.tripleOuter, RADII.doubleInner, RADII.doubleOuter] as const
const WIRE_MM = 1.15
const SPIDER_MM = 2.2

/** Draws the spider: six rings and twenty radial dividers from the outer bull to the double ring, in `style` (colour on the face, white on the masks). */
function spider(p: Painter, style: string, widthMm = WIRE_MM): void {
  const { ctx, cx, cy, scale } = p
  ctx.strokeStyle = style
  ctx.lineWidth = widthMm * scale
  ctx.lineCap = 'round'
  for (const radius of WIRE_RADII) {
    ctx.beginPath()
    ctx.arc(cx, cy, radius * scale, 0, Math.PI * 2)
    ctx.stroke()
  }
  for (let i = 0; i < SECTORS.length; i++) {
    const a = canvasAngle(i * SECTOR_DEGREES + SECTOR_DEGREES / 2)
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * RADII.outerBull * scale, cy + Math.sin(a) * RADII.outerBull * scale)
    ctx.lineTo(cx + Math.cos(a) * RADII.doubleOuter * scale, cy + Math.sin(a) * RADII.doubleOuter * scale)
    ctx.stroke()
  }
}

interface NumberStyle {
  fill: string
  /** Dark outline drawn under the digits so they stand off the face. */
  edge?: string
  edgeMm?: number
  sizeMm: number
  radiusMm: number
  ringWire?: boolean
}

/** The number ring: each number upright at its wedge's angle, plus (for steel boards) the thin outer retaining wire. */
function numbers(p: Painter, style: NumberStyle): void {
  const { ctx, cx, cy, scale } = p
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.font = `800 ${Math.round(style.sizeMm * scale)}px "Arial Black", "Helvetica Neue", Arial, sans-serif`
  SECTORS.forEach((value, i) => {
    const deg = i * SECTOR_DEGREES
    const a = canvasAngle(deg)
    ctx.save()
    ctx.translate(cx + Math.cos(a) * style.radiusMm * scale, cy + Math.sin(a) * style.radiusMm * scale)
    ctx.rotate(((deg > 90 && deg < 270 ? deg - 180 : deg) * Math.PI) / 180)
    if (style.edge && style.edgeMm) {
      ctx.strokeStyle = style.edge
      ctx.lineWidth = style.edgeMm * scale
      ctx.strokeText(String(value), 0, 0)
    }
    ctx.fillStyle = style.fill
    ctx.fillText(String(value), 0, 0)
    ctx.restore()
  })
  if (style.ringWire) ring(p, RADII.numberRing, 1.4, style.fill)
}

const STEEL_NUMBERS = { sizeMm: 23, radiusMm: (RADII.doubleOuter + RADII.numberRing) / 2 + 0.5, ringWire: true } as const
const SPIDER_NUMBERS = { sizeMm: 25, radiusMm: (RADII.doubleOuter + RADII.numberRing) / 2 + 2 } as const

/** Sisal: compressed fibre ends seen face-on, as fine speckle plus short radial streaks, kept light so the beds stay crisp. */
function sisal(p: Painter, seed: number): void {
  const { ctx, size } = p
  const image = ctx.getImageData(0, 0, size, size)
  const data = image.data
  const rng = createRng(seed)
  for (let i = 0; i < data.length; i += 4) {
    const n = (rng() - 0.5) * 16 + (rng() < 0.03 ? 14 : 0)
    data[i] = Math.max(0, Math.min(255, data[i] + n))
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n * 0.95))
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n * 0.85))
  }
  ctx.putImageData(image, 0, 0)
  ctx.globalAlpha = 0.05
  ctx.strokeStyle = '#000'
  ctx.lineWidth = Math.max(1, p.scale * 0.35)
  for (let i = 0; i < size * 4; i++) {
    const angle = rng() * Math.PI * 2
    const r = rng() * RADII.doubleOuter * p.scale
    const x = p.cx + Math.cos(angle) * r
    const y = p.cy + Math.sin(angle) * r
    const len = (1 + rng() * 2.5) * p.scale
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/** Soft-tip holes: a hex grid of small round sockets over the scoring area, built as one path per layer (rims, then holes) so the whole grid fills in two draw calls. */
function holes(p: Painter, fill: string, rim: string | null): void {
  const { ctx, cx, cy, scale } = p
  const pitch = 3.4
  const radius = 1.05 * scale
  const limit = RADII.doubleOuter - 1
  const centres: number[] = []
  const rows = Math.ceil(limit / (pitch * 0.866))
  const cols = Math.ceil(limit / pitch) + 1
  for (let row = -rows; row <= rows; row++) {
    const y = row * pitch * 0.866
    const shift = row % 2 ? pitch / 2 : 0
    for (let col = -cols; col <= cols; col++) {
      const x = col * pitch + shift
      if (x * x + y * y > limit * limit) continue
      centres.push(cx + x * scale, cy + y * scale)
    }
  }
  const layer = (style: string, offsetY: number) => {
    ctx.beginPath()
    for (let i = 0; i < centres.length; i += 2) {
      ctx.moveTo(centres[i] + radius, centres[i + 1] + offsetY)
      ctx.arc(centres[i], centres[i + 1] + offsetY, radius, 0, Math.PI * 2)
    }
    ctx.fillStyle = style
    ctx.fill()
  }
  if (rim) layer(rim, radius * 0.35)
  layer(fill, 0)
}

function drawSteelFace(size: number): HTMLCanvasElement {
  const p = painter(size)
  p.ctx.fillStyle = BOARD_COLORS.sisal
  p.ctx.fillRect(0, 0, size, size)
  disc(p, RADII.board, BOARD_COLORS.black)
  for (let i = 0; i < SECTORS.length; i++) {
    const from = i * SECTOR_DEGREES - SECTOR_DEGREES / 2
    const to = from + SECTOR_DEGREES
    const even = i % 2 === 0
    const single = even ? BOARD_COLORS.black : BOARD_COLORS.cream
    const bed = even ? BOARD_COLORS.red : BOARD_COLORS.green
    wedge(p, RADII.outerBull, RADII.tripleInner, from, to, single)
    wedge(p, RADII.tripleInner, RADII.tripleOuter, from, to, bed)
    wedge(p, RADII.tripleOuter, RADII.doubleInner, from, to, single)
    wedge(p, RADII.doubleInner, RADII.doubleOuter, from, to, bed)
  }
  disc(p, RADII.outerBull, BOARD_COLORS.green)
  disc(p, RADII.innerBull, BOARD_COLORS.red)
  sisal(p, 1907)
  p.ctx.shadowColor = 'rgba(0,0,0,0.6)'
  p.ctx.shadowBlur = p.scale * 0.7
  p.ctx.shadowOffsetY = p.scale * 0.35
  spider(p, BOARD_COLORS.wire)
  p.ctx.shadowColor = 'transparent'
  numbers(p, { ...STEEL_NUMBERS, fill: BOARD_COLORS.number, edge: BOARD_COLORS.numberEdge, edgeMm: 2.6 })
  return p.canvas
}

function drawSpiderFace(size: number): HTMLCanvasElement {
  const p = painter(size)
  p.ctx.fillStyle = SPIDER_COLORS.catch
  p.ctx.fillRect(0, 0, size, size)
  disc(p, RADII.board, SPIDER_COLORS.catch)
  for (let i = 0; i < SECTORS.length; i++) {
    const from = i * SECTOR_DEGREES - SECTOR_DEGREES / 2
    const to = from + SECTOR_DEGREES
    const even = i % 2 === 0
    const single = even ? SPIDER_COLORS.black : SPIDER_COLORS.red
    const bed = even ? SPIDER_COLORS.red : SPIDER_COLORS.black
    wedge(p, RADII.outerBull, RADII.tripleInner, from, to, single)
    wedge(p, RADII.tripleInner, RADII.tripleOuter, from, to, bed)
    wedge(p, RADII.tripleOuter, RADII.doubleInner, from, to, single)
    wedge(p, RADII.doubleInner, RADII.doubleOuter, from, to, bed)
  }
  disc(p, RADII.outerBull, SPIDER_COLORS.red)
  disc(p, RADII.innerBull, SPIDER_COLORS.black)
  holes(p, 'rgba(0,0,0,0.55)', 'rgba(255,255,255,0.07)')
  p.ctx.shadowColor = 'rgba(0,0,0,0.7)'
  p.ctx.shadowBlur = p.scale * 1.2
  p.ctx.shadowOffsetY = p.scale * 0.6
  spider(p, SPIDER_COLORS.spider, SPIDER_MM)
  p.ctx.shadowColor = 'transparent'
  ring(p, RADII.doubleOuter + 2.2, 1.6, SPIDER_COLORS.spider)
  ring(p, RADII.numberRing + 4, 2.4, SPIDER_COLORS.trim)
  ring(p, RADII.board - 2.5, 4, SPIDER_COLORS.trim)
  numbers(p, { ...SPIDER_NUMBERS, fill: SPIDER_COLORS.number })
  return p.canvas
}

/** Packed material map: R = 1 (no baked occlusion), G = roughness, B = metalness. Numbers stay mostly non-metallic so they read white under the lamp instead of mirroring the dark room. */
function drawSteelRoughnessMetal(size: number): HTMLCanvasElement {
  const p = painter(size)
  p.ctx.fillStyle = 'rgb(255, 238, 0)'
  p.ctx.fillRect(0, 0, size, size)
  spider(p, 'rgb(255, 64, 255)', WIRE_MM * 0.9)
  numbers(p, { ...STEEL_NUMBERS, fill: 'rgb(255, 120, 40)' })
  return p.canvas
}

function drawSpiderRoughnessMetal(size: number): HTMLCanvasElement {
  const p = painter(size)
  p.ctx.fillStyle = 'rgb(255, 150, 0)'
  p.ctx.fillRect(0, 0, size, size)
  disc(p, RADII.doubleOuter, 'rgb(255, 105, 0)')
  holes(p, 'rgb(255, 235, 0)', null)
  spider(p, 'rgb(255, 120, 0)', SPIDER_MM)
  numbers(p, { ...SPIDER_NUMBERS, fill: 'rgb(255, 130, 0)' })
  return p.canvas
}

function noiseBase(p: Painter, amount: number, seed: number): void {
  p.ctx.fillStyle = '#000'
  p.ctx.fillRect(0, 0, p.size, p.size)
  const rng = createRng(seed)
  const image = p.ctx.getImageData(0, 0, p.size, p.size)
  for (let i = 0; i < image.data.length; i += 4) {
    const v = rng() * amount
    image.data[i] = v
    image.data[i + 1] = v
    image.data[i + 2] = v
  }
  p.ctx.putImageData(image, 0, 0)
}

function drawSteelHeight(size: number): HTMLCanvasElement {
  const p = painter(size)
  noiseBase(p, 26, 77)
  p.ctx.filter = `blur(${Math.max(1, p.scale * 0.6)}px)`
  spider(p, '#fff', WIRE_MM * 1.2)
  numbers(p, { ...STEEL_NUMBERS, fill: '#fff' })
  p.ctx.filter = 'none'
  return p.canvas
}

function drawSpiderHeight(size: number): HTMLCanvasElement {
  const p = painter(size)
  noiseBase(p, 6, 91)
  disc(p, RADII.doubleOuter, '#606060')
  p.ctx.filter = `blur(${Math.max(1, p.scale * 0.35)}px)`
  holes(p, '#000', null)
  spider(p, '#fff', SPIDER_MM * 1.1)
  ring(p, RADII.doubleOuter + 2.2, 1.8, '#fff')
  numbers(p, { ...SPIDER_NUMBERS, fill: '#9a9a9a' })
  p.ctx.filter = 'none'
  return p.canvas
}

/** Sobel normal map from a height canvas. */
function normalFromHeight(source: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const size = source.width
  const src = source.getContext('2d', { willReadFrequently: true })
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx || !src) throw new Error('Canvas 2D is not available')
  const data = src.getImageData(0, 0, size, size).data
  const height = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) height[i] = data[i * 4] / 255
  const out = ctx.createImageData(size, size)
  const at = (x: number, y: number) => height[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength
      const length = Math.sqrt(dx * dx + dy * dy + 1)
      const i = (y * size + x) * 4
      out.data[i] = ((-dx / length) * 0.5 + 0.5) * 255
      out.data[i + 1] = ((dy / length) * 0.5 + 0.5) * 255
      out.data[i + 2] = (1 / length) * 255
      out.data[i + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  return canvas
}

function texture(canvas: HTMLCanvasElement, srgb: boolean, anisotropy: number): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  map.anisotropy = anisotropy
  map.generateMipmaps = true
  map.minFilter = THREE.LinearMipmapLinearFilter
  map.magFilter = THREE.LinearFilter
  return map
}

/** Builds the three board maps for a style at `size` pixels square (the normal map at half size, which is plenty for raised wires). */
export function createBoardTextures(size: number, anisotropy = 8, style: BoardStyle = 'steel'): BoardTextures {
  const spiderStyle = style === 'spider'
  const color = texture(spiderStyle ? drawSpiderFace(size) : drawSteelFace(size), true, anisotropy)
  const roughnessMetal = texture(spiderStyle ? drawSpiderRoughnessMetal(size) : drawSteelRoughnessMetal(size), false, anisotropy)
  const heightSize = Math.max(512, size / 2)
  const normal = texture(normalFromHeight(spiderStyle ? drawSpiderHeight(heightSize) : drawSteelHeight(heightSize), spiderStyle ? 1.6 : 2.2), false, anisotropy)
  return {
    color,
    roughnessMetal,
    normal,
    dispose() {
      color.dispose()
      roughnessMetal.dispose()
      normal.dispose()
    },
  }
}
