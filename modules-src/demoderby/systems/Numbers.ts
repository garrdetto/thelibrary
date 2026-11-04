/** Spray-painted race numbers: draws a number in one of the font styles onto a canvas with overspray, stencil bridges, drips and a wobbly outline, and returns it as a texture. */
import * as THREE from 'three/webgpu'
import { fontById, numberColorById, type FontOption } from '../config'
import type { CarLook } from './Look'

export interface NumberArt {
  texture: THREE.CanvasTexture
  aspect: number
}

interface Rng {
  (): number
}

function rng(seed: number): Rng {
  let state = (seed * 747796405 + 2891336453) >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function hashText(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return hash >>> 0
}

function fontString(font: FontOption, size: number): string {
  return `${font.italic ? 'italic ' : ''}${font.weight} ${size}px ${font.family}`
}

function overspray(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, random: Rng, count: number): void {
  ctx.fillStyle = color
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2
    const distance = radius * (0.6 + random() * 0.6) * Math.sqrt(random())
    const size = 0.6 + random() * 2.2
    ctx.globalAlpha = 0.08 + random() * 0.22
    ctx.beginPath()
    ctx.arc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance * 0.7, size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drips(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, color: string, random: Rng, count: number, scale: number): void {
  ctx.fillStyle = color
  for (let i = 0; i < count; i++) {
    const x = x0 + random() * (x1 - x0)
    const length = scale * (0.25 + random() * 1.1)
    const width = scale * (0.05 + random() * 0.06)
    ctx.globalAlpha = 0.75
    ctx.beginPath()
    ctx.roundRect(x - width / 2, y - scale * 0.08, width, length, width / 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y + length, width * 0.8, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function stencilBridges(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, size: number, random: Rng): void {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  const gap = Math.max(3, size * 0.045)
  const rows = [y - size * 0.22, y + size * 0.08, y + size * 0.32]
  for (const row of rows) {
    ctx.fillRect(x - width / 2 - 6, row + (random() - 0.5) * size * 0.04, width + 12, gap)
  }
  ctx.restore()
}

/** Paints the car number on a wide canvas (side numbers) or a square one (roof); the texture has a transparent background so the paint shows through. */
export function paintNumber(look: CarLook, orientation: 'side' | 'roof'): NumberArt {
  const width = orientation === 'side' ? 768 : 512
  const height = orientation === 'side' ? 384 : 512
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  const font = fontById(look.font)
  const color = numberColorById(look.numberColor).hex
  const random = rng(hashText(`${look.number}:${look.font}:${orientation}`))
  const text = look.number
  const outlineColor = look.outline ? (look.numberColor === 'black' ? '#f2efe6' : '#111111') : null

  let size = orientation === 'side' ? Math.min(300, 560 / Math.max(1, text.length * 0.78)) : Math.min(380, 460 / Math.max(1, text.length * 0.78))
  ctx.font = fontString(font, size)
  ctx.letterSpacing = `${Math.round(size * font.tracking)}px`
  let measured = ctx.measureText(text).width
  const maxWidth = width * 0.86
  if (measured > maxWidth) {
    size *= maxWidth / measured
    ctx.font = fontString(font, size)
    ctx.letterSpacing = `${Math.round(size * font.tracking)}px`
    measured = ctx.measureText(text).width
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'

  const x = width / 2
  const y = height / 2 + size * 0.04
  const tilt = font.rough ? (random() - 0.5) * 0.16 : (random() - 0.5) * 0.03
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  ctx.translate(-x, -y)

  overspray(ctx, x, y, Math.max(measured, size) * 0.7, color, random, 160)
  if (outlineColor) {
    ctx.strokeStyle = outlineColor
    ctx.lineWidth = size * (font.hollow ? 0.16 : 0.1)
    ctx.globalAlpha = 0.9
    ctx.strokeText(text, x + size * 0.01, y + size * 0.015)
    ctx.globalAlpha = 1
  }
  if (font.hollow) {
    ctx.strokeStyle = color
    ctx.lineWidth = size * 0.085
    ctx.strokeText(text, x, y)
  } else {
    ctx.fillStyle = color
    ctx.fillText(text, x, y)
    ctx.globalAlpha = 0.35
    ctx.fillText(text, x + size * 0.012, y + size * 0.01)
    ctx.globalAlpha = 1
  }
  if (font.stencil) stencilBridges(ctx, x, y, measured, size, random)
  if (font.rough || random() < 0.5) drips(ctx, x - measured / 2, x + measured / 2, y + size * 0.42, color, random, font.rough ? 5 : 2, size * 0.5)
  ctx.restore()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return { texture, aspect: width / height }
}
