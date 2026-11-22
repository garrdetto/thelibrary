/**
 * Tiling ground textures for lot paving, painted once into a `DynamicTexture` from a seeded random stream: crushed gravel (a
 * mottled bed of stones in greys and tans with dark gaps between them) and asphalt (dark binder with pale aggregate flecks and a
 * few patched seams). Both are matte, so they never shine. Slabs carry UVs in world metres, and `uScale`/`vScale` set how many
 * metres one tile covers. Where no canvas is available (node tests) `createPavingTexture` returns null and the slab stays plain.
 */

import type { Scene } from '@babylonjs/core/scene'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'

export type PavingKind = 'gravel' | 'asphalt'

/** Metres covered by one tile of each texture. */
export const PAVING_TILE_M: Record<PavingKind, number> = { gravel: 2.5, asphalt: 4 }

const SIZE = 256

function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shade(base: readonly [number, number, number], amount: number): string {
  const c = base.map((v) => Math.max(0, Math.min(255, Math.round(v * amount))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/** Draws `fn` at the point and at its wrapped copies so the tile has no seams. */
function wrapped(x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const dx of [-SIZE, 0, SIZE]) {
    for (const dy of [-SIZE, 0, SIZE]) {
      if (x + dx + r < 0 || x + dx - r > SIZE || y + dy + r < 0 || y + dy - r > SIZE) continue
      fn(x + dx, y + dy)
    }
  }
}

function paintGravel(g: CanvasRenderingContext2D): void {
  const random = rng(4127)
  g.fillStyle = '#5f5a52'
  g.fillRect(0, 0, SIZE, SIZE)
  const tones: readonly (readonly [number, number, number])[] = [[150, 144, 134], [128, 122, 113], [166, 158, 146], [118, 108, 96], [142, 132, 116], [104, 100, 96]]
  for (let i = 0; i < 2600; i++) {
    const x = random() * SIZE
    const y = random() * SIZE
    const r = 1.2 + random() * random() * 4.2
    const tone = tones[Math.floor(random() * tones.length)]
    const light = 0.82 + random() * 0.3
    const turn = random() * Math.PI
    const squash = 0.6 + random() * 0.4
    wrapped(x, y, r + 1, (px, py) => {
      g.fillStyle = 'rgba(30,28,25,0.35)'
      g.beginPath()
      g.ellipse(px + 0.7, py + 0.9, r, r * squash, turn, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = shade(tone, light)
      g.beginPath()
      g.ellipse(px, py, r, r * squash, turn, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = shade(tone, light * 1.12)
      g.beginPath()
      g.ellipse(px - r * 0.25, py - r * 0.25, r * 0.45, r * squash * 0.4, turn, 0, Math.PI * 2)
      g.fill()
    })
  }
}

function paintAsphalt(g: CanvasRenderingContext2D): void {
  const random = rng(9311)
  g.fillStyle = '#34363a'
  g.fillRect(0, 0, SIZE, SIZE)
  for (let i = 0; i < 90; i++) {
    const x = random() * SIZE
    const y = random() * SIZE
    const r = 10 + random() * 26
    const a = 0.04 + random() * 0.06
    wrapped(x, y, r, (px, py) => {
      g.fillStyle = random() < 0.5 ? `rgba(20,21,24,${a})` : `rgba(80,80,82,${a})`
      g.beginPath()
      g.arc(px, py, r, 0, Math.PI * 2)
      g.fill()
    })
  }
  for (let i = 0; i < 5200; i++) {
    const x = random() * SIZE
    const y = random() * SIZE
    const r = 0.4 + random() * random() * 1.6
    const v = 70 + Math.floor(random() * 80)
    wrapped(x, y, r, (px, py) => {
      g.fillStyle = `rgb(${v},${v},${v + 3})`
      g.fillRect(px - r, py - r, r * 2, r * 2)
    })
  }
  g.strokeStyle = 'rgba(16,17,19,0.55)'
  g.lineWidth = 1.2
  for (let i = 0; i < 3; i++) {
    let x = random() * SIZE
    let y = random() * SIZE
    g.beginPath()
    g.moveTo(x, y)
    for (let k = 0; k < 6; k++) {
      x += (random() - 0.5) * 40
      y += (random() - 0.5) * 40
      g.lineTo(x, y)
    }
    g.stroke()
  }
}

/** Paints one paving texture, or returns null where the engine has no canvas. */
export function createPavingTexture(scene: Scene, kind: PavingKind): DynamicTexture | null {
  let texture: DynamicTexture | null = null
  try {
    texture = new DynamicTexture(`trucksim-paving-${kind}`, { width: SIZE, height: SIZE }, scene, true, Texture.TRILINEAR_SAMPLINGMODE)
    const context = texture.getContext() as CanvasRenderingContext2D | null
    if (!context || typeof context.ellipse !== 'function') {
      texture.dispose()
      return null
    }
    if (kind === 'gravel') paintGravel(context)
    else paintAsphalt(context)
    texture.update(true)
    texture.wrapU = Texture.WRAP_ADDRESSMODE
    texture.wrapV = Texture.WRAP_ADDRESSMODE
    texture.uScale = 1 / PAVING_TILE_M[kind]
    texture.vScale = 1 / PAVING_TILE_M[kind]
    texture.anisotropicFilteringLevel = 8
    texture.hasAlpha = false
    return texture
  } catch {
    texture?.dispose()
    return null
  }
}
