/**
 * Builds the vertex data of one terrain tile: a 33 × 33 grid over `size` metres from `shared/Terrain` heights with normals from
 * central differences, ground colours, detail UVs, a skirt hanging below the edge to hide cracks, and for geomorphing the height
 * each vertex would have on its parent's twice-as-coarse grid (odd vertices take the mean of their even neighbours). Pure, so the
 * terrain worker runs it off the main thread and the page runs it directly while loading. Shares one index list for every tile.
 */
import { WATER_LEVEL, fieldShade, forestDensity, naturalHeight, terrainHeight } from '../shared/Terrain'

export const GRID = 32
export const MORPH_ATTRIBUTE = 'tfMorph'

export interface TileData {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  uvs: Float32Array
  morph: Float32Array
  minY: number
  maxY: number
}

export type Rgb = [number, number, number]

const GRASS_A: Rgb = [0.25, 0.34, 0.12]
const GRASS_B: Rgb = [0.36, 0.40, 0.17]
const CROP: Rgb = [0.52, 0.47, 0.25]
const PLOUGH: Rgb = [0.33, 0.25, 0.17]
const FOREST: Rgb = [0.10, 0.17, 0.07]
const ROCK: Rgb = [0.38, 0.36, 0.33]
const SNOW: Rgb = [0.86, 0.88, 0.9]
const SHORE: Rgb = [0.5, 0.46, 0.34]
const AIRFIELD: Rgb = [0.27, 0.36, 0.14]

function mix(a: Rgb, b: Rgb, t: number, out: Rgb): Rgb {
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
  return out
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const fieldColour: Rgb = [0, 0, 0]
const colour: Rgb = [0, 0, 0]

/** Ground colour (linear) for a point with height `h` and slope `steep` (1 - normal.y). */
export function groundColour(x: number, z: number, h: number, steep: number, out: Rgb): Rgb {
  const shade = fieldShade(x, z)
  const natural = naturalHeight(x, z)
  if (shade < 0.45) mix(GRASS_A, GRASS_B, shade / 0.45, fieldColour)
  else if (shade < 0.7) mix(GRASS_B, CROP, (shade - 0.45) / 0.25, fieldColour)
  else if (shade < 0.85) mix(CROP, PLOUGH, (shade - 0.7) / 0.15, fieldColour)
  else mix(PLOUGH, GRASS_A, (shade - 0.85) / 0.15, fieldColour)
  mix(fieldColour, AIRFIELD, clamp01(Math.abs(h - natural) / 6), out)
  const forest = forestDensity(x, z)
  if (forest > 0) mix(out, FOREST, forest, out)
  const rockiness = clamp01((steep - 0.12) / 0.14) + clamp01((h - 900) / 500) * 0.6
  if (rockiness > 0) mix(out, ROCK, clamp01(rockiness), out)
  const snow = clamp01((h - 1300 - (fieldShade(x * 3, z * 3) - 0.5) * 160) / 160) * (1 - clamp01((steep - 0.3) / 0.2))
  if (snow > 0) mix(out, SNOW, snow, out)
  const shore = clamp01(1 - (h - WATER_LEVEL) / 4)
  if (shore > 0) mix(out, SHORE, shore, out)
  return out
}

const VERTS = (GRID + 1) * (GRID + 1)
const SKIRT = GRID * 4
const EDGE: number[] = []
for (let i = 0; i < GRID; i++) EDGE.push(i)
for (let j = 0; j < GRID; j++) EDGE.push(j * (GRID + 1) + GRID)
for (let i = GRID; i > 0; i--) EDGE.push(GRID * (GRID + 1) + i)
for (let j = GRID; j > 0; j--) EDGE.push(j * (GRID + 1))

function buildIndices(): Uint32Array {
  const indices: number[] = []
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * (GRID + 1) + i
      const b = a + 1
      const c = a + GRID + 1
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }
  for (let k = 0; k < EDGE.length; k++) {
    const a = EDGE[k]
    const b = EDGE[(k + 1) % EDGE.length]
    const sa = VERTS + k
    const sb = VERTS + ((k + 1) % EDGE.length)
    indices.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb)
  }
  return new Uint32Array(indices)
}

/** Triangles of every tile (grid and skirt). */
export const TILE_INDICES = buildIndices()

const STRIDE = GRID + 3
const heights = new Float32Array(STRIDE * STRIDE)

export function buildTileData(x0: number, z0: number, size: number): TileData {
  const step = size / GRID
  for (let j = 0; j < STRIDE; j++) {
    for (let i = 0; i < STRIDE; i++) heights[j * STRIDE + i] = terrainHeight(x0 + (i - 1) * step, z0 + (j - 1) * step)
  }
  const total = VERTS + SKIRT
  const positions = new Float32Array(total * 3)
  const normals = new Float32Array(total * 3)
  const colors = new Float32Array(total * 4)
  const uvs = new Float32Array(total * 2)
  const morph = new Float32Array(total)
  const at = (i: number, j: number) => heights[(j + 1) * STRIDE + i + 1]
  let minY = Infinity
  let maxY = -Infinity
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const index = j * (GRID + 1) + i
      const h = at(i, j)
      const hx = at(i + 1, j) - at(i - 1, j)
      const hz = at(i, j + 1) - at(i, j - 1)
      let nx = -hx
      let ny = 2 * step
      let nz = -hz
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
      nx /= length
      ny /= length
      nz /= length
      const wx = x0 + i * step
      const wz = z0 + j * step
      positions[index * 3] = i * step
      positions[index * 3 + 1] = h
      positions[index * 3 + 2] = j * step
      normals[index * 3] = nx
      normals[index * 3 + 1] = ny
      normals[index * 3 + 2] = nz
      groundColour(wx, wz, h, 1 - ny, colour)
      colors[index * 4] = colour[0]
      colors[index * 4 + 1] = colour[1]
      colors[index * 4 + 2] = colour[2]
      colors[index * 4 + 3] = 1
      uvs[index * 2] = wx / 40
      uvs[index * 2 + 1] = wz / 40
      const oddI = i % 2 === 1
      const oddJ = j % 2 === 1
      morph[index] = oddI && oddJ ? (at(i - 1, j - 1) + at(i + 1, j + 1)) * 0.5 : oddI ? (at(i - 1, j) + at(i + 1, j)) * 0.5 : oddJ ? (at(i, j - 1) + at(i, j + 1)) * 0.5 : h
      if (h < minY) minY = h
      if (h > maxY) maxY = h
    }
  }
  const depth = Math.max(4, size * 0.02)
  for (let k = 0; k < EDGE.length; k++) {
    const src = EDGE[k]
    const dst = VERTS + k
    positions[dst * 3] = positions[src * 3]
    positions[dst * 3 + 1] = positions[src * 3 + 1] - depth
    positions[dst * 3 + 2] = positions[src * 3 + 2]
    normals[dst * 3] = normals[src * 3]
    normals[dst * 3 + 1] = normals[src * 3 + 1]
    normals[dst * 3 + 2] = normals[src * 3 + 2]
    colors[dst * 4] = colors[src * 4]
    colors[dst * 4 + 1] = colors[src * 4 + 1]
    colors[dst * 4 + 2] = colors[src * 4 + 2]
    colors[dst * 4 + 3] = 1
    uvs[dst * 2] = uvs[src * 2]
    uvs[dst * 2 + 1] = uvs[src * 2 + 1]
    morph[dst] = morph[src] - depth
  }
  return { positions, normals, colors, uvs, morph, minY, maxY }
}
