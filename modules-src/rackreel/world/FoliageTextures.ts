import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'

export type FoliageKind = 'needles' | 'leaves' | 'birchleaves'

const SIZE = 512
const CELL = SIZE / 2
const cache = new Map<string, StandardMaterial>()

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function drawNeedles(ctx: CanvasRenderingContext2D, ox: number, oy: number, r: () => number): void {
  const twig = (x0: number, y0: number, x1: number, y1: number, len: number, density: number) => {
    ctx.strokeStyle = '#4a3a26'
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    const steps = Math.floor(Math.hypot(x1 - x0, y1 - y0) / density)
    const ang = Math.atan2(y1 - y0, x1 - x0)
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      const x = x0 + (x1 - x0) * t
      const y = y0 + (y1 - y0) * t
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const a = ang + side * (0.45 + r() * 0.55)
          const l = len * (0.65 + r() * 0.5) * (1 - t * 0.35)
          const g = 70 + Math.floor(r() * 70)
          ctx.strokeStyle = `rgb(${Math.floor(g * 0.35)},${g},${Math.floor(g * 0.45)})`
          ctx.lineWidth = 1.3 + r() * 0.8
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
          ctx.stroke()
        }
      }
    }
  }
  const bx = ox + CELL / 2
  const by = oy + CELL - 6
  const tx = ox + CELL / 2 + (r() - 0.5) * 30
  const ty = oy + 10
  twig(bx, by, tx, ty, 34, 5)
  for (let i = 0; i < 5; i++) {
    const t = 0.2 + i * 0.15
    const x = bx + (tx - bx) * t
    const y = by + (ty - by) * t
    const side = i % 2 ? 1 : -1
    twig(x, y, x + side * (50 + r() * 35), y - 40 - r() * 30, 26, 5)
  }
}

function lobedLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number, shade: number, lobes: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.beginPath()
  for (let i = 0; i <= lobes * 2; i++) {
    const a = (i / (lobes * 2)) * Math.PI * 2 - Math.PI / 2
    const rr = i % 2 === 0 ? size : size * 0.48
    const px = Math.cos(a) * rr
    const py = Math.sin(a) * rr * 0.95
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  const v = Math.floor(shade * 255)
  ctx.fillStyle = `rgb(${v},${v},${Math.floor(v * 0.94)})`
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 1
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 - Math.PI / 2
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(Math.cos(a) * size * 0.85, Math.sin(a) * size * 0.85)
    ctx.stroke()
  }
  ctx.restore()
}

function ovalLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number, shade: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.beginPath()
  ctx.ellipse(0, 0, size * 0.55, size, 0, 0, Math.PI * 2)
  const v = Math.floor(shade * 255)
  ctx.fillStyle = `rgb(${v},${v},${Math.floor(v * 0.9)})`
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(0, size)
  ctx.stroke()
  ctx.restore()
}

function drawLeaves(ctx: CanvasRenderingContext2D, ox: number, oy: number, r: () => number, birch: boolean): void {
  ctx.strokeStyle = '#3d3020'
  ctx.lineWidth = 2
  const cx = ox + CELL / 2
  const cy = oy + CELL / 2
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(a) * CELL * 0.4, cy + Math.sin(a) * CELL * 0.4)
    ctx.stroke()
  }
  const count = birch ? 60 : 30
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2
    const d = Math.sqrt(r()) * CELL * 0.4
    const x = cx + Math.cos(a) * d
    const y = cy + Math.sin(a) * d
    const shade = 0.62 + r() * 0.38
    const size = birch ? 10 + r() * 7 : 17 + r() * 10
    const rot = r() * Math.PI * 2
    ctx.save()
    ctx.globalAlpha = 0.3
    ctx.shadowColor = 'rgb(190,190,180)'
    ctx.shadowBlur = 6
    if (birch) ovalLeaf(ctx, x, y, size * 1.15, rot, shade)
    else lobedLeaf(ctx, x, y, size * 1.15, rot, shade, 5)
    ctx.restore()
    if (birch) ovalLeaf(ctx, x, y, size, rot, shade)
    else lobedLeaf(ctx, x, y, size, rot, shade, 5)
  }
}

export function foliageMaterial(scene: Scene, kind: FoliageKind): StandardMaterial {
  const found = cache.get(kind)
  if (found) return found
  const tex = new DynamicTexture(`tex-${kind}`, { width: SIZE, height: SIZE }, scene, true)
  const ctx = tex.getContext() as CanvasRenderingContext2D
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.lineCap = 'round'
  const r = rng(kind === 'needles' ? 3 : kind === 'leaves' ? 7 : 11)
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      if (kind === 'needles') drawNeedles(ctx, i * CELL, j * CELL, r)
      else drawLeaves(ctx, i * CELL, j * CELL, r, kind === 'birchleaves')
    }
  }
  tex.update(true)
  tex.hasAlpha = true
  tex.anisotropicFilteringLevel = 4
  const mat = new StandardMaterial(`mat-${kind}`, scene)
  mat.diffuseTexture = tex
  mat.diffuseColor = Color3.White()
  mat.specularColor = new Color3(0.03, 0.03, 0.03)
  mat.backFaceCulling = false
  mat.twoSidedLighting = true
  mat.transparencyMode = Material.MATERIAL_ALPHATEST
  mat.alphaCutOff = 0.42
  mat.useAlphaFromDiffuseTexture = true
  cache.set(kind, mat)
  return mat
}
