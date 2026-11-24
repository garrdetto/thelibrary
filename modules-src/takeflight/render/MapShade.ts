/**
 * Paints the region for the maps: one RGBA pixel per cell of a `size` × `size` grid over the whole 200 km square, coloured by
 * height (water, lowland, hills, mountains, snow) with a hill shade lit from the north-west. Pure, so the map worker and the
 * tests can both run it.
 */
import { REGION_HALF, WATER_LEVEL, terrainHeight } from '../shared/Terrain'

const STOPS: [number, number, number, number][] = [
  [WATER_LEVEL, 112, 148, 92],
  [180, 128, 158, 96],
  [320, 152, 160, 104],
  [600, 150, 138, 104],
  [1000, 138, 124, 112],
  [1400, 196, 192, 188],
  [1800, 240, 240, 244],
]

function land(height: number, out: number[]): void {
  if (height <= STOPS[0][0]) {
    out[0] = STOPS[0][1]
    out[1] = STOPS[0][2]
    out[2] = STOPS[0][3]
    return
  }
  for (let i = 1; i < STOPS.length; i++) {
    const [h1, r1, g1, b1] = STOPS[i]
    if (height <= h1 || i === STOPS.length - 1) {
      const [h0, r0, g0, b0] = STOPS[i - 1]
      const t = Math.max(0, Math.min(1, (height - h0) / (h1 - h0)))
      out[0] = r0 + (r1 - r0) * t
      out[1] = g0 + (g1 - g0) * t
      out[2] = b0 + (b1 - b0) * t
      return
    }
  }
}

export function shadeMap(size: number): Uint8ClampedArray {
  const cell = (REGION_HALF * 2) / size
  const heights = new Float32Array((size + 1) * (size + 1))
  for (let j = 0; j <= size; j++) {
    const z = -REGION_HALF + j * cell
    for (let i = 0; i <= size; i++) heights[j * (size + 1) + i] = terrainHeight(-REGION_HALF + i * cell, z)
  }
  const pixels = new Uint8ClampedArray(size * size * 4)
  const colour = [0, 0, 0]
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h00 = heights[j * (size + 1) + i]
      const h10 = heights[j * (size + 1) + i + 1]
      const h01 = heights[(j + 1) * (size + 1) + i]
      const h11 = heights[(j + 1) * (size + 1) + i + 1]
      const height = (h00 + h10 + h01 + h11) / 4
      const p = (j * size + i) * 4
      if (height < WATER_LEVEL) {
        const depth = Math.min(1, (WATER_LEVEL - height) / 40)
        pixels[p] = 70 - depth * 20
        pixels[p + 1] = 128 - depth * 24
        pixels[p + 2] = 178 - depth * 10
        pixels[p + 3] = 255
        continue
      }
      land(height, colour)
      const dx = (h10 + h11 - h00 - h01) / (2 * cell)
      const dz = (h01 + h11 - h00 - h10) / (2 * cell)
      const light = Math.max(0.55, Math.min(1.35, 1 + (dx + dz) * 2.2))
      pixels[p] = colour[0] * light
      pixels[p + 1] = colour[1] * light
      pixels[p + 2] = colour[2] * light
      pixels[p + 3] = 255
    }
  }
  return pixels
}
