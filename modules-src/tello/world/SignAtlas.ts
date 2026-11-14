/**
 * Every sign downtown painted into one canvas texture: plain lettering on a
 * painted board, each sign at its own aspect so nothing stretches. Signs are
 * requested first (`add`), packed in shelves, then drawn once (`material`).
 */
import type { Material } from '@babylonjs/core/Materials/material'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { Mats } from '../../foxlake/fp/core/Tex'

export interface SignRequest {
  text: string
  board: number
  ink: number
  /** Width over height of the sign as built. */
  aspect: number
  /** A street banner: lettering across the top over a sun on the water. */
  banner?: boolean
}

export interface SignRect {
  u0: number
  v0: number
  u1: number
  v1: number
}

const WIDTH = 2048
const ROW = 112
const BANNER_ROW = 256
const PAD = 4

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`

export class SignAtlas {
  private readonly reqs: SignRequest[] = []
  private readonly keys = new Map<string, number>()
  private rects: SignRect[] = []
  private height = 0
  private readonly places: { x: number; y: number; w: number; h: number }[] = []

  add(r: SignRequest): number {
    const key = `${r.text}|${r.board}|${r.ink}|${r.aspect.toFixed(1)}|${r.banner ? 1 : 0}`
    const hit = this.keys.get(key)
    if (hit !== undefined) return hit
    const i = this.reqs.push(r) - 1
    this.keys.set(key, i)
    return i
  }

  /** Packs the signs into shelves; call once every sign is requested and before `rect`. */
  pack(): void {
    let x = 0
    let y = 0
    let shelf = 0
    for (const r of this.reqs) {
      const h = r.banner ? BANNER_ROW : ROW
      const w = Math.max(16, Math.min(WIDTH - PAD * 2, Math.round(h * r.aspect)))
      if (x + w + PAD > WIDTH) {
        x = 0
        y += shelf + PAD
        shelf = 0
      }
      this.places.push({ x: x + PAD, y: y + PAD, w, h })
      x += w + PAD
      shelf = Math.max(shelf, h)
    }
    const used = y + shelf + PAD * 2
    this.height = 64
    while (this.height < used) this.height *= 2
    this.rects = this.places.map((p) => ({ u0: p.x / WIDTH, u1: (p.x + p.w) / WIDTH, v0: p.y / this.height, v1: (p.y + p.h) / this.height }))
  }

  rect(i: number): SignRect {
    return this.rects[i]
  }

  get count(): number {
    return this.reqs.length
  }

  /** Paints the atlas and returns the signs' material (matte paint; the gloss rule). */
  material(mats: Mats, name: string): Material {
    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = Math.max(64, this.height)
    const g = canvas.getContext('2d')!
    this.reqs.forEach((r, i) => {
      const p = this.places[i]
      g.save()
      g.beginPath()
      g.rect(p.x, p.y, p.w, p.h)
      g.clip()
      g.fillStyle = css(r.board)
      g.fillRect(p.x, p.y, p.w, p.h)
      if (r.banner) this.banner(g, r, p)
      else {
        g.strokeStyle = css(r.ink)
        g.globalAlpha = 0.55
        g.lineWidth = Math.max(2, p.h * 0.04)
        g.strokeRect(p.x + p.h * 0.08, p.y + p.h * 0.08, p.w - p.h * 0.16, p.h - p.h * 0.16)
        g.globalAlpha = 1
        this.text(g, r.text, r.ink, p.x + p.w / 2, p.y + p.h * 0.54, p.w * 0.86, p.h * 0.6)
      }
      g.restore()
    })
    const tex = mats.canvasTexture(`${name}-atlas`, canvas)
    const m = mats.plain(name, { gloss: 0.12 }) as PBRMaterial
    m.albedoTexture = tex
    return m
  }

  private banner(g: CanvasRenderingContext2D, r: SignRequest, p: { x: number; y: number; w: number; h: number }): void {
    const sky = g.createLinearGradient(0, p.y, 0, p.y + p.h)
    sky.addColorStop(0, '#d9ecf7')
    sky.addColorStop(1, css(r.board))
    g.fillStyle = sky
    g.fillRect(p.x, p.y, p.w, p.h)
    const sunY = p.y + p.h * 0.66
    g.fillStyle = '#f2c14e'
    g.beginPath()
    g.arc(p.x + p.w / 2, sunY, p.w * 0.26, Math.PI, 0)
    g.fill()
    g.fillStyle = '#2f5e8c'
    g.fillRect(p.x, sunY, p.w, p.y + p.h - sunY)
    g.strokeStyle = '#9cc4e4'
    g.lineWidth = Math.max(2, p.h * 0.012)
    for (let k = 0; k < 3; k++) {
      const y = sunY + (k + 1) * p.h * 0.07
      g.beginPath()
      g.moveTo(p.x + p.w * 0.12, y)
      g.lineTo(p.x + p.w * 0.88, y)
      g.stroke()
    }
    this.text(g, r.text, r.ink, p.x + p.w / 2, p.y + p.h * 0.2, p.w * 0.92, p.h * 0.16)
  }

  private text(g: CanvasRenderingContext2D, text: string, ink: number, cx: number, cy: number, maxW: number, maxH: number): void {
    let size = Math.floor(maxH)
    const font = (s: number) => `700 ${s}px Georgia, 'Times New Roman', serif`
    g.font = font(size)
    const w = g.measureText(text).width
    if (w > maxW) size = Math.max(8, Math.floor((size * maxW) / w))
    g.font = font(size)
    g.fillStyle = css(ink)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, cx, cy)
  }
}
