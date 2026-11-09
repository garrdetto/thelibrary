import { HALF, WORLD_SIZE, forestDensity, trailOffset } from '../world/Terrain'
import type { Terrain } from '../world/Terrain'

export interface MapMarker {
  x: number
  z: number
  kind: 'cabin' | 'stand' | 'blind' | 'boat' | 'utv' | 'quad' | 'friend' | 'down' | 'dock'
  heading?: number
  label?: string
}

const SIZE = 512
const RANGES = [140, 320, WORLD_SIZE / 2]

export class Minimap {
  private readonly base: HTMLCanvasElement
  private readonly canvas: HTMLCanvasElement
  private readonly g: CanvasRenderingContext2D
  private zoom = 0
  private timer = 0

  constructor(terrain: Terrain, host: HTMLElement) {
    this.base = document.createElement('canvas')
    this.base.width = SIZE
    this.base.height = SIZE
    const bg = this.base.getContext('2d')!
    const img = bg.createImageData(SIZE, SIZE)
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const x = (i + 0.5) / SIZE * WORLD_SIZE - HALF
        const z = HALF - (j + 0.5) / SIZE * WORLD_SIZE
        const h = terrain.heightAt(x, z)
        let r: number, gg: number, b: number
        if (h < 0) {
          const d = Math.min(1, -h / 14)
          r = 70 - d * 45
          gg = 112 - d * 55
          b = 128 - d * 40
        } else if (trailOffset(x, z) < 2.2 && h > 1) {
          r = 150; gg = 128; b = 92
        } else {
          const ground = terrain.groundAt(x, z)
          const f = forestDensity(x, z)
          if (ground === 'marsh' || ground === 'shore') { r = 112; gg = 116; b = 70 }
          else if (ground === 'rock') { r = 120; gg = 118; b = 110 }
          else { r = 108 - f * 70; gg = 128 - f * 58; b = 70 - f * 36 }
          const shade = Math.max(0.75, Math.min(1.15, 1 + (terrain.heightAt(x + 2, z + 2) - h) * 0.25))
          r *= shade; gg *= shade; b *= shade
        }
        const k = (j * SIZE + i) * 4
        img.data[k] = r
        img.data[k + 1] = gg
        img.data[k + 2] = b
        img.data[k + 3] = 255
      }
    }
    bg.putImageData(img, 0, 0)
    this.canvas = document.createElement('canvas')
    this.canvas.width = 360
    this.canvas.height = 360
    this.canvas.setAttribute('role', 'img')
    this.canvas.setAttribute('aria-label', 'Minimap')
    this.g = this.canvas.getContext('2d')!
    host.append(this.canvas)
  }

  cycleZoom(): string {
    this.zoom = (this.zoom + 1) % RANGES.length
    return this.zoom === 2 ? 'Map: whole property' : `Map: ${Math.round(RANGES[this.zoom] * 1.094)} yd`
  }

  draw(dt: number, x: number, z: number, yaw: number, facing: number, markers: MapMarker[]): void {
    this.timer -= dt
    if (this.timer > 0) return
    this.timer = 0.1
    const g = this.g
    const W = this.canvas.width
    const range = RANGES[this.zoom]
    const scale = W / 2 / range
    g.save()
    g.clearRect(0, 0, W, W)
    g.translate(W / 2, W / 2)
    g.rotate(-yaw)
    const pxPerM = SIZE / WORLD_SIZE
    const sx = (x + HALF) * pxPerM
    const sy = (HALF - z) * pxPerM
    g.imageSmoothingEnabled = true
    g.drawImage(this.base, sx - range * pxPerM, sy - range * pxPerM, range * 2 * pxPerM, range * 2 * pxPerM, -W / 2, -W / 2, W, W)
    g.rotate(yaw)
    const icon = (mx: number, mz: number): [number, number] => {
      const dx = (mx - x) * scale
      const dz = (mz - z) * scale
      const c = Math.cos(-yaw)
      const s = Math.sin(-yaw)
      return [dx * c + dz * s, -(-dx * s + dz * c)]
    }
    for (const m of markers) {
      let [px, py] = icon(m.x, m.z)
      const edge = W / 2 - 12
      const d = Math.hypot(px, py)
      if (d > edge) {
        if (m.kind !== 'friend' && m.kind !== 'cabin') continue
        px *= edge / d
        py *= edge / d
      }
      g.lineWidth = 3
      g.strokeStyle = 'rgba(10,10,8,.85)'
      if (m.kind === 'cabin') {
        g.fillStyle = '#e9dcc0'
        g.beginPath(); g.moveTo(px, py - 11); g.lineTo(px + 10, py - 2); g.lineTo(px + 7, py - 2); g.lineTo(px + 7, py + 8); g.lineTo(px - 7, py + 8); g.lineTo(px - 7, py - 2); g.lineTo(px - 10, py - 2); g.closePath()
        g.stroke(); g.fill()
      } else if (m.kind === 'stand' || m.kind === 'blind') {
        g.fillStyle = m.kind === 'blind' ? '#c99b5a' : '#e8762b'
        g.beginPath(); g.moveTo(px, py - 9); g.lineTo(px + 8, py + 7); g.lineTo(px - 8, py + 7); g.closePath(); g.stroke(); g.fill()
      } else if (m.kind === 'friend') {
        g.fillStyle = '#7fd0ff'
        g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.stroke(); g.fill()
        if (m.label) {
          g.font = '700 18px Inter, system-ui, sans-serif'
          g.fillStyle = '#e9f6ff'
          g.strokeText(m.label, px + 10, py + 6)
          g.fillText(m.label, px + 10, py + 6)
        }
      } else if (m.kind === 'down') {
        g.strokeStyle = '#ffd36b'
        g.lineWidth = 4
        g.beginPath(); g.moveTo(px - 7, py - 7); g.lineTo(px + 7, py + 7); g.moveTo(px + 7, py - 7); g.lineTo(px - 7, py + 7); g.stroke()
      } else {
        g.fillStyle = m.kind === 'boat' ? '#d9473a' : m.kind === 'dock' ? '#a07a50' : '#8fc46a'
        g.beginPath(); g.rect(px - 6, py - 6, 12, 12); g.stroke(); g.fill()
      }
    }
    g.rotate(facing - yaw)
    g.fillStyle = '#ffffff'
    g.strokeStyle = 'rgba(10,10,8,.9)'
    g.lineWidth = 3
    g.beginPath(); g.moveTo(0, -13); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.stroke(); g.fill()
    g.restore()
    g.save()
    g.translate(W / 2, W / 2)
    g.rotate(-yaw)
    g.font = '800 22px Rockwell, Georgia, serif'
    g.fillStyle = '#e8762b'
    g.textAlign = 'center'
    g.fillText('N', 0, -W / 2 + 26)
    g.restore()
  }
}
