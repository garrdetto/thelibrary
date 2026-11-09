/** Procedural board textures drawn on canvas at regulation proportions: the colour face (alternating black/cream singles, red/green doubles and trebles, both bulls, sisal fibre, the wire spider and the number ring), a packed roughness/metal map (G = roughness, B = metalness) so wires and numbers shine while the sisal stays matte, and a normal map that raises the wires. */
import * as THREE from 'three/webgpu'
import { RADII, SECTORS, SECTOR_DEGREES } from '../shared/Board'
import { createRng } from '../shared/Rng'

export const BOARD_COLORS = {
  black: '#161514',
  cream: '#eadcb8',
  red: '#c41e2c',
  green: '#11804a',
  sisal: '#1a1816',
  wire: '#d8dbe0',
  number: '#f2efe6',
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
  const ctx = canvas.getContext('2d')
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

const WIRE_RADII = [RADII.innerBull, RADII.outerBull, RADII.tripleInner, RADII.tripleOuter, RADII.doubleInner, RADII.doubleOuter] as const
const WIRE_MM = 1.15

/** Draws the spider: six ring wires and twenty radial wires from the outer bull to the double ring, in `style` (colour on the face, white on the masks). */
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

/** The number ring: each number upright at its wedge's angle, plus the thin outer retaining wire. */
function numbers(p: Painter, style: string): void {
  const { ctx, cx, cy, scale } = p
  const radius = (RADII.doubleOuter + RADII.numberRing) / 2 + 2
  ctx.fillStyle = style
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.round(19 * scale)}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`
  SECTORS.forEach((value, i) => {
    const deg = i * SECTOR_DEGREES
    const a = canvasAngle(deg)
    ctx.save()
    ctx.translate(cx + Math.cos(a) * radius * scale, cy + Math.sin(a) * radius * scale)
    ctx.rotate(((deg > 90 && deg < 270 ? deg - 180 : deg) * Math.PI) / 180)
    ctx.fillText(String(value), 0, 0)
    ctx.restore()
  })
  ctx.strokeStyle = style
  ctx.lineWidth = 1.4 * scale
  ctx.beginPath()
  ctx.arc(cx, cy, RADII.numberRing * scale, 0, Math.PI * 2)
  ctx.stroke()
}

/** Sisal: compressed fibre ends seen face-on, as fine speckle plus short radial streaks, varied per bed so each colour reads as real fibre. */
function sisal(p: Painter, seed: number): void {
  const { ctx, size } = p
  const image = ctx.getImageData(0, 0, size, size)
  const data = image.data
  const rng = createRng(seed)
  for (let i = 0; i < data.length; i += 4) {
    const n = (rng() - 0.5) * 26 + (rng() < 0.04 ? 22 : 0)
    data[i] = Math.max(0, Math.min(255, data[i] + n))
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n * 0.95))
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n * 0.85))
  }
  ctx.putImageData(image, 0, 0)
  ctx.globalAlpha = 0.08
  ctx.strokeStyle = '#000'
  ctx.lineWidth = Math.max(1, p.scale * 0.35)
  for (let i = 0; i < size * 6; i++) {
    const angle = rng() * Math.PI * 2
    const r = rng() * RADII.numberRing * p.scale
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

function drawFace(size: number): HTMLCanvasElement {
  const p = painter(size)
  p.ctx.fillStyle = BOARD_COLORS.sisal
  p.ctx.fillRect(0, 0, size, size)
  disc(p, RADII.board, BOARD_COLORS.black)
  for (let i = 0; i < SECTORS.length; i++) {
    const from = i * SECTOR_DEGREES - SECTOR_DEGREES / 2
    const to = from + SECTOR_DEGREES
    const even = i % 2 === 0
    const single = even ? BOARD_COLORS.black : BOARD_COLORS.cream
    const ring = even ? BOARD_COLORS.red : BOARD_COLORS.green
    wedge(p, RADII.outerBull, RADII.tripleInner, from, to, single)
    wedge(p, RADII.tripleInner, RADII.tripleOuter, from, to, ring)
    wedge(p, RADII.tripleOuter, RADII.doubleInner, from, to, single)
    wedge(p, RADII.doubleInner, RADII.doubleOuter, from, to, ring)
  }
  disc(p, RADII.outerBull, BOARD_COLORS.green)
  disc(p, RADII.innerBull, BOARD_COLORS.red)
  sisal(p, 1907)
  p.ctx.shadowColor = 'rgba(0,0,0,0.55)'
  p.ctx.shadowBlur = p.scale * 0.8
  p.ctx.shadowOffsetY = p.scale * 0.4
  spider(p, BOARD_COLORS.wire)
  numbers(p, BOARD_COLORS.number)
  p.ctx.shadowColor = 'transparent'
  return p.canvas
}

/** Packed material map: R = 1 (no baked occlusion), G = roughness, B = metalness. */
function drawRoughnessMetal(size: number): HTMLCanvasElement {
  const p = painter(size)
  p.ctx.fillStyle = 'rgb(255, 238, 0)'
  p.ctx.fillRect(0, 0, size, size)
  spider(p, 'rgb(255, 64, 255)', WIRE_MM * 0.9)
  numbers(p, 'rgb(255, 90, 230)')
  return p.canvas
}

function drawHeight(size: number): HTMLCanvasElement {
  const p = painter(size)
  p.ctx.fillStyle = '#000'
  p.ctx.fillRect(0, 0, size, size)
  const rng = createRng(77)
  const image = p.ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < image.data.length; i += 4) {
    const v = rng() * 34
    image.data[i] = v
    image.data[i + 1] = v
    image.data[i + 2] = v
  }
  p.ctx.putImageData(image, 0, 0)
  p.ctx.filter = `blur(${Math.max(1, p.scale * 0.6)}px)`
  spider(p, '#fff', WIRE_MM * 1.2)
  numbers(p, '#fff')
  p.ctx.filter = 'none'
  return p.canvas
}

/** Sobel normal map from a height canvas. */
function normalFromHeight(source: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const size = source.width
  const src = source.getContext('2d')
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
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

/** Builds the three board maps at `size` pixels square (the normal map at half size, which is plenty for raised wires). */
export function createBoardTextures(size: number, anisotropy = 8): BoardTextures {
  const color = texture(drawFace(size), true, anisotropy)
  const roughnessMetal = texture(drawRoughnessMetal(size), false, anisotropy)
  const normal = texture(normalFromHeight(drawHeight(Math.max(512, size / 2)), 2.2), false, anisotropy)
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
