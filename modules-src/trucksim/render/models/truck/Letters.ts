/**
 * Raised block lettering for brand badges: a 3 × 5 cell font drawn as a few rectangles per letter, built as thin boxes facing
 * +Z and centred on the origin, so a badge is placed with one transform. No textures and no logos: just the brand's plain name.
 */

import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { boxAt } from './Geometry'

type Stroke = [number, number, number, number]

const GLYPHS: Record<string, Stroke[]> = {
  A: [[0, 0, 1, 5], [2, 0, 1, 5], [1, 4, 1, 1], [1, 2, 1, 1]],
  B: [[0, 0, 1, 5], [1, 4, 1, 1], [1, 2, 1, 1], [1, 0, 1, 1], [2, 3, 1, 1], [2, 1, 1, 1]],
  C: [[0, 0, 1, 5], [1, 4, 2, 1], [1, 0, 2, 1]],
  D: [[0, 0, 1, 5], [1, 4, 1, 1], [1, 0, 1, 1], [2, 1, 1, 3]],
  E: [[0, 0, 1, 5], [1, 4, 2, 1], [1, 2, 1, 1], [1, 0, 2, 1]],
  G: [[0, 0, 1, 5], [1, 4, 2, 1], [1, 0, 2, 1], [2, 1, 1, 2]],
  H: [[0, 0, 1, 5], [2, 0, 1, 5], [1, 2, 1, 1]],
  I: [[0, 4, 3, 1], [0, 0, 3, 1], [1, 1, 1, 3]],
  K: [[0, 0, 1, 5], [1, 2, 1, 1], [2, 3, 1, 1], [3, 4, 1, 1], [2, 1, 1, 1], [3, 0, 1, 1]],
  L: [[0, 0, 1, 5], [1, 0, 2, 1]],
  N: [[0, 0, 1, 5], [3, 0, 1, 5], [1, 3, 1, 1], [2, 2, 1, 1]],
  O: [[0, 0, 1, 5], [2, 0, 1, 5], [1, 4, 1, 1], [1, 0, 1, 1]],
  P: [[0, 0, 1, 5], [1, 4, 1, 1], [1, 2, 1, 1], [2, 3, 1, 1]],
  R: [[0, 0, 1, 5], [1, 4, 1, 1], [1, 2, 1, 1], [2, 3, 1, 1], [2, 0, 1, 2]],
  S: [[0, 4, 3, 1], [0, 3, 1, 1], [0, 2, 3, 1], [2, 1, 1, 1], [0, 0, 3, 1]],
  T: [[0, 4, 3, 1], [1, 0, 1, 4]],
  U: [[0, 0, 1, 5], [2, 0, 1, 5], [1, 0, 1, 1]],
  V: [[0, 1, 1, 4], [2, 1, 1, 4], [1, 0, 1, 1]],
  W: [[0, 0, 1, 5], [4, 0, 1, 5], [1, 1, 1, 1], [3, 1, 1, 1], [2, 2, 1, 1]],
  X: [[0, 0, 1, 2], [0, 3, 1, 2], [2, 0, 1, 2], [2, 3, 1, 2], [1, 2, 1, 1]],
  Y: [[0, 3, 1, 2], [2, 3, 1, 2], [1, 0, 1, 3]],
  M: [[0, 0, 1, 5], [4, 0, 1, 5], [1, 3, 1, 1], [3, 3, 1, 1], [2, 2, 1, 1]],
  F: [[0, 0, 1, 5], [1, 4, 2, 1], [1, 2, 1, 1]],
  J: [[2, 1, 1, 4], [0, 0, 3, 1], [0, 1, 1, 1]],
  Q: [[0, 1, 1, 4], [2, 1, 1, 4], [1, 4, 1, 1], [0, 0, 2, 1], [2, 0, 1, 1]],
  Z: [[0, 4, 3, 1], [2, 3, 1, 1], [1, 2, 1, 1], [0, 1, 1, 1], [0, 0, 3, 1]],
}

const WIDE: Record<string, number> = { K: 4, N: 4, M: 5, W: 5 }

function glyphWidth(ch: string): number {
  return WIDE[ch] ?? 3
}

/** Width of a word in cells (each letter's width plus one cell between letters). */
export function wordCells(word: string): number {
  const text = word.toUpperCase().replace(/[^A-Z ]/g, '')
  let cells = 0
  for (const ch of text) cells += glyphWidth(ch) + 1
  return Math.max(0, cells - 1)
}

/**
 * The word as raised blocks: `cell` is the size of one font cell, `depth` how far the letters stand off the plate. Centred
 * on the origin in X and Y, standing from z = 0 to z = depth.
 */
export function blockLetters(word: string, cell: number, depth: number): VertexData[] {
  const text = word.toUpperCase().replace(/[^A-Z ]/g, '')
  const total = wordCells(text) * cell
  const parts: VertexData[] = []
  let x = -total / 2
  for (const ch of text) {
    const strokes = GLYPHS[ch]
    if (strokes) {
      for (const [cx, cy, cw, ch2] of strokes) {
        const x0 = x + cx * cell
        const y0 = (cy - 2.5) * cell
        parts.push(boxAt(x0, x0 + cw * cell, y0, y0 + ch2 * cell, 0, depth))
      }
    }
    x += (glyphWidth(ch) + 1) * cell
  }
  return parts
}
