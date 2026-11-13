export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed * 1442695041, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1103515245)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)

export function valueNoise(x: number, y: number, seed: number, period = 0): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const wrap = (value: number) => (period ? ((value % period) + period) % period : value)
  const x0 = wrap(ix), x1 = wrap(ix + 1), y0 = wrap(iy), y1 = wrap(iy + 1)
  const a = hash2(x0, y0, seed)
  const b = hash2(x1, y0, seed)
  const c = hash2(x0, y1, seed)
  const d = hash2(x1, y1, seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

export function fbm(x: number, y: number, seed: number, octaves = 4, period = 0): number {
  let total = 0
  let amplitude = 0.5
  let frequency = 1
  let norm = 0
  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 17, period ? period * frequency : 0) * amplitude
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return total / norm
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
