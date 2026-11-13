import type { Scene } from '@babylonjs/core/scene'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { fbm, hash2 } from './Noise'

export const TEXTURE_SIZE = 512

export type SurfacePattern = 'deck' | 'plates' | 'ribs' | 'crate' | 'brushed' | 'grass'

export interface SurfaceSpec {
  pattern: SurfacePattern
  base: [number, number, number]
  accent?: [number, number, number]
  grime: number
  seed: number
  bump: number
}

export interface SurfaceTextures {
  albedo: Texture
  normal: Texture
}

type Layer = { height: Float32Array; tint: Float32Array }

function groove(height: Float32Array, size: number, x0: number, y0: number, x1: number, y1: number, depth: number, width: number): void {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - width))
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + width))
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - width))
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + width))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = x0 === x1 ? Math.abs(x - x0) : Math.abs(y - y0)
      if (d > width) continue
      const index = y * size + x
      height[index] = Math.min(height[index], -depth * (1 - d / (width + 0.5)))
    }
  }
}

function raise(layer: Layer, size: number, x0: number, y0: number, x1: number, y1: number, amount: number, bevel: number, tint = 0): void {
  for (let y = Math.max(0, y0); y < Math.min(size, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) {
      const edge = Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y)
      const t = Math.min(1, edge / bevel)
      const index = y * size + x
      layer.height[index] += amount * t
      layer.tint[index] += tint * t
    }
  }
}

function bolt(height: Float32Array, size: number, cx: number, cy: number, radius: number): void {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d > radius || x < 0 || y < 0 || x >= size || y >= size) continue
      height[y * size + x] += 0.6 * Math.sqrt(1 - (d / radius) ** 2)
    }
  }
}

function drawPattern(spec: SurfaceSpec, layer: Layer, size: number): void {
  const { height, tint } = layer
  const s = size
  switch (spec.pattern) {
    case 'deck': {
      for (const at of [0, s / 2]) {
        groove(height, s, at, 0, at, s, 1, 2.5)
        groove(height, s, 0, at, s, at, 1, 2.5)
      }
      for (const cx of [s / 4, (3 * s) / 4]) {
        for (const cy of [s / 4, (3 * s) / 4]) {
          for (let ring = 0; ring < 5; ring++) groove(height, s, cx - 60, cy - 40 + ring * 20, cx + 60, cy - 40 + ring * 20, 0.35, 1.2)
        }
      }
      for (const px of [0, s / 2]) {
        for (const py of [0, s / 2]) {
          for (const [ox, oy] of [[14, 14], [s / 2 - 14, 14], [14, s / 2 - 14], [s / 2 - 14, s / 2 - 14]]) bolt(height, s, px + ox, py + oy, 4)
        }
      }
      break
    }
    case 'plates': {
      groove(height, s, 0, 0, s, 0, 1, 2.5)
      groove(height, s, 0, 0, 0, s, 1, 2.5)
      groove(height, s, 0, s * 0.38, s, s * 0.38, 1, 2)
      groove(height, s, s * 0.55, 0, s * 0.55, s * 0.38, 1, 2)
      groove(height, s, s * 0.3, s * 0.38, s * 0.3, s, 1, 2)
      raise(layer, s, Math.round(s * 0.38), Math.round(s * 0.5), Math.round(s * 0.92), Math.round(s * 0.88), 0.7, 10, 0.06)
      raise(layer, s, Math.round(s * 0.08), Math.round(s * 0.06), Math.round(s * 0.48), Math.round(s * 0.3), 0.5, 8, -0.05)
      for (let i = 0; i < 6; i++) groove(height, s, s * 0.62, s * (0.08 + i * 0.045), s * 0.94, s * (0.08 + i * 0.045), 0.4, 1.4)
      break
    }
    case 'ribs': {
      for (let i = 0; i < 8; i++) {
        const x = (i * s) / 8
        groove(height, s, x, 0, x, s, 1, 2)
        raise(layer, s, Math.round(x + 10), 0, Math.round(x + s / 8 - 10), s, 0.4, 6, 0.04)
      }
      groove(height, s, 0, s * 0.5, s, s * 0.5, 0.8, 2)
      break
    }
    case 'crate': {
      raise(layer, s, 0, 0, s, s, 0.6, 26, 0)
      raise(layer, s, 40, 40, s - 40, s - 40, -0.5, 10, -0.04)
      for (let t = 40; t < s - 40; t++) {
        for (let w = -9; w <= 9; w++) {
          for (const [x, y] of [[t + w, t], [t + w, s - 1 - t]]) {
            if (x < 40 || x >= s - 40) continue
            const index = y * s + x
            height[index] = Math.max(height[index], 0.1 + 0.5 * (1 - Math.abs(w) / 10))
          }
        }
      }
      groove(height, s, 0, 0, s, 0, 1, 2)
      groove(height, s, 0, 0, 0, s, 1, 2)
      for (const [x, y] of [[18, 18], [s - 18, 18], [18, s - 18], [s - 18, s - 18]]) bolt(height, s, x, y, 6)
      for (let y = s - 34; y < s - 22; y++) {
        for (let x = 60; x < 180; x++) tint[y * s + x] += ((x + y) >> 4) % 2 ? 0.35 : -0.25
      }
      break
    }
    case 'brushed': {
      for (let y = 0; y < s; y++) {
        const streak = (hash2(0, y >> 1, spec.seed) - 0.5) * 0.08
        for (let x = 0; x < s; x++) height[y * s + x] += streak
      }
      groove(height, s, 0, 0, s, 0, 0.8, 2)
      break
    }
    case 'grass': {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const blade = hash2(x, y, spec.seed)
          height[y * s + x] += blade * 0.5
          tint[y * s + x] += (blade - 0.5) * 0.16
        }
      }
      break
    }
  }
}

function normalCanvas(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d') as CanvasRenderingContext2D
  const image = context.createImageData(size, size)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const length = Math.hypot(dx, dy, 1)
      const offset = (y * size + x) * 4
      image.data[offset] = ((-dx / length) * 0.5 + 0.5) * 255
      image.data[offset + 1] = ((dy / length) * 0.5 + 0.5) * 255
      image.data[offset + 2] = ((1 / length) * 0.5 + 0.5) * 255
      image.data[offset + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

function albedoCanvas(spec: SurfaceSpec, layer: Layer, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d') as CanvasRenderingContext2D
  const image = context.createImageData(size, size)
  const accent = spec.accent ?? spec.base
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x
      const u = x / size, v = y / size
      const large = fbm(u * 4, v * 4, spec.seed, 4, 4)
      const fine = fbm(u * 32, v * 32, spec.seed + 5, 2, 32)
      const mix = Math.max(0, Math.min(1, (large - 0.42) * 2.4))
      const recess = Math.max(0, -layer.height[index])
      const edgeWear = Math.max(0, layer.height[index] - 0.45) * 0.4
      const shade = 1 + (fine - 0.5) * 0.18 + layer.tint[index] - recess * 0.35 + edgeWear - (1 - large) * spec.grime * 0.5
      const offset = index * 4
      for (let channel = 0; channel < 3; channel++) {
        const color = spec.base[channel] * (1 - mix * 0.5) + accent[channel] * mix * 0.5
        image.data[offset + channel] = Math.max(0, Math.min(255, color * shade))
      }
      image.data[offset + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

function toTexture(scene: Scene, name: string, canvas: HTMLCanvasElement, gamma: boolean): Texture {
  const texture = new DynamicTexture(name, canvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE)
  texture.wrapU = Texture.WRAP_ADDRESSMODE
  texture.wrapV = Texture.WRAP_ADDRESSMODE
  texture.anisotropicFilteringLevel = 8
  texture.gammaSpace = gamma
  texture.update(false)
  return texture
}

export function surfaceTextures(scene: Scene, name: string, spec: SurfaceSpec, size = TEXTURE_SIZE): SurfaceTextures {
  const layer: Layer = { height: new Float32Array(size * size), tint: new Float32Array(size * size) }
  drawPattern(spec, layer, size)
  for (let index = 0; index < layer.height.length; index++) {
    const x = index % size, y = Math.floor(index / size)
    layer.height[index] += (fbm(x / size * 24, y / size * 24, spec.seed + 9, 2, 24) - 0.5) * 0.15
  }
  return {
    albedo: toTexture(scene, `${name}-albedo`, albedoCanvas(spec, layer, size), true),
    normal: toTexture(scene, `${name}-normal`, normalCanvas(layer.height, size, spec.bump), false),
  }
}
