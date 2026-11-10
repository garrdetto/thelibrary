/** Tiling procedural patterns (0..1 coordinates, wrap seamlessly) for cloth and wood. */

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise on a `px` × `py` lattice that wraps at the edges. */
export function tileNoise(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px
  const y = v * py
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const w = (i: number, j: number) => hash(((x0 + i) % px + px) % px, ((y0 + j) % py + py) % py, seed)
  const a = w(0, 0) + (w(1, 0) - w(0, 0)) * sx
  const b = w(0, 1) + (w(1, 1) - w(0, 1)) * sx
  return a + (b - a) * sy
}

/** Plain-weave cloth: alternating over-under threads with a little slub, 0..1. */
export function fabricHeight(u: number, v: number): number {
  const threads = 16
  const tu = u * threads
  const tv = v * threads
  const warp = Math.abs(Math.sin(tu * Math.PI))
  const weft = Math.abs(Math.sin(tv * Math.PI))
  const over = (Math.floor(tu) + Math.floor(tv)) % 2 === 0
  const weave = over ? 0.55 * warp + 0.25 * weft : 0.25 * warp + 0.55 * weft
  const slub = tileNoise(u, v, 32, 32, 7) * 0.2
  const crumple = tileNoise(u, v, 4, 4, 11) * 0.65 + tileNoise(u, v, 9, 9, 13) * 0.35
  return Math.max(0, Math.min(1, (weave + slub) * 0.12 + crumple * 0.88))
}

/**
 * Sawn timber with the grain running along `along`: wavy growth rings, fine fibres, a few
 * knots and weathering, as a surface height (0..1) and a colour shade around 1.
 */
export function woodSample(along: number, across: number, seed: number): { height: number; shade: number } {
  const warp = tileNoise(along, across, 3, 4, seed) * 1.6 + tileNoise(along, across, 9, 2, seed + 1) * 0.35
  const rings = across * 11 + warp
  const ring = 0.5 + 0.5 * Math.sin(rings * Math.PI * 2)
  const late = Math.pow(ring, 3.2)
  const fibre = tileNoise(along, across, 6, 140, seed + 2)
  const blotch = tileNoise(along, across, 4, 3, seed + 3)
  let knot = 0
  for (let k = 0; k < 2; k++) {
    const kx = hash(k, 1, seed) * 0.8 + 0.1
    const ky = hash(k, 2, seed) * 0.7 + 0.15
    const dx = Math.min(Math.abs(along - kx), 1 - Math.abs(along - kx)) * 3.2
    const dy = across - ky
    const d = Math.hypot(dx, dy)
    knot = Math.max(knot, Math.max(0, 1 - d / 0.07))
  }
  const height = 0.55 + (fibre - 0.5) * 0.35 - late * 0.25 - knot * 0.3
  const shade = (0.84 + blotch * 0.26) * (1 - late * 0.3) * (0.92 + fibre * 0.16) * (1 - knot * 0.45)
  return { height: Math.max(0, Math.min(1, height)), shade }
}
