/** Procedural textures drawn once at start: tiling ground grain, water ripple normals and a soft particle dot. */
import * as pc from 'playcanvas'
import { fbm, valueNoise } from '../shared/Random'

function tilingNoise(x: number, y: number, size: number, period: number, seed: number): number {
  const u = x / size, v = y / size
  const a = valueNoise(u * period, v * period, seed)
  const b = valueNoise((u - 1) * period, v * period, seed)
  const c = valueNoise(u * period, (v - 1) * period, seed)
  const d = valueNoise((u - 1) * period, (v - 1) * period, seed)
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
}

function texture(device: pc.GraphicsDevice, size: number, fill: (data: Uint8ClampedArray) => void, srgb: boolean, name: string): pc.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  fill(image.data)
  ctx.putImageData(image, 0, 0)
  const tex = new pc.Texture(device, { name, width: size, height: size, format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8, mipmaps: true, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR, anisotropy: 4 })
  tex.setSource(canvas)
  return tex
}

export function groundGrain(device: pc.GraphicsDevice): pc.Texture {
  const size = 256
  return texture(device, size, data => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const n = tilingNoise(x, y, size, 32, 3) * 0.5 + tilingNoise(x, y, size, 8, 4) * 0.3 + tilingNoise(x, y, size, 64, 5) * 0.2
      const v = Math.round((0.72 + n * 0.5) * 255 * 0.85)
      const i = (y * size + x) * 4
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }, true, 'ground-grain')
}

export function rippleNormals(device: pc.GraphicsDevice, period: number, seed: number): pc.Texture {
  const size = 256
  const h = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 1, p = period
    for (let o = 0; o < 4; o++) { v += tilingNoise(x, y, size, p, seed + o) * amp; amp *= 0.5; p *= 2 }
    h[y * size + x] = v
  }
  return texture(device, size, data => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x + size - 1) % size)], r = h[y * size + ((x + 1) % size)]
      const u = h[((y + size - 1) % size) * size + x], d = h[((y + 1) % size) * size + x]
      let nx = (l - r) * 2.2, ny = (u - d) * 2.2, nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len; ny /= len; nz /= len
      const i = (y * size + x) * 4
      data[i] = Math.round((nx * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }, false, 'ripples')
}

export function softDot(device: pc.GraphicsDevice): pc.Texture {
  const size = 64
  return texture(device, size, data => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2)
      const a = Math.max(0, 1 - d)
      const i = (y * size + x) * 4
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(a * a * 255)
    }
  }, false, 'dot')
}

export { fbm }
