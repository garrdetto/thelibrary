/** Lake map: a shaded depth chart drawn once per lake from the shared bathymetry, with contour lines, named spots, the landing, a pin and the boats. */
import { depthFeetAt, heightAt, landingOf, spotsOf } from '../shared/Lakes'
import type { LakeDef } from '../shared/Lakes'

export class LakeMap {
  private base: HTMLCanvasElement | null = null
  private lake: LakeDef | null = null
  private span = 1
  pin: { x: number; z: number } | null = null

  setLake(lake: LakeDef): void {
    this.lake = lake
    this.span = lake.radius * Math.max(lake.stretch[0], lake.stretch[1]) * 1.25
    this.base = null
  }

  private render(size: number): HTMLCanvasElement {
    const lake = this.lake!
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(size, size)
    const depths = new Float32Array(size * size)
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size * 2 - 1) * this.span, z = ((py + 0.5) / size * 2 - 1) * this.span
      const h = heightAt(lake, x, z)
      const d = h < 0 ? depthFeetAt(lake, x, z) : -1
      depths[py * size + px] = d
      const i = (py * size + px) * 4
      if (d < 0) {
        const g = Math.min(1, h / 30)
        image.data[i] = 120 + g * 40; image.data[i + 1] = 132 + g * 20; image.data[i + 2] = 96; image.data[i + 3] = 255
      } else {
        const t = Math.min(1, d / lake.maxDepth)
        image.data[i] = Math.round(178 - t * 150); image.data[i + 1] = Math.round(214 - t * 150); image.data[i + 2] = Math.round(232 - t * 120); image.data[i + 3] = 255
      }
    }
    for (let py = 1; py < size - 1; py++) for (let px = 1; px < size - 1; px++) {
      const d = depths[py * size + px]
      if (d < 0) continue
      const step = lake.maxDepth > 60 ? 20 : 10
      const band = Math.floor(d / step)
      const right = depths[py * size + px + 1], down = depths[(py + 1) * size + px]
      if ((right >= 0 && Math.floor(right / step) !== band) || (down >= 0 && Math.floor(down / step) !== band)) {
        const i = (py * size + px) * 4
        image.data[i] *= 0.72; image.data[i + 1] *= 0.72; image.data[i + 2] *= 0.8
      }
      if (right < 0 || down < 0) {
        const i = (py * size + px) * 4
        image.data[i] = 60; image.data[i + 1] = 66; image.data[i + 2] = 52
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  toCanvas(x: number, z: number, size: number): [number, number] {
    return [((x / this.span) + 1) / 2 * size, ((z / this.span) + 1) / 2 * size]
  }

  toWorld(px: number, py: number, size: number): [number, number] {
    return [((px / size) * 2 - 1) * this.span, ((py / size) * 2 - 1) * this.span]
  }

  draw(canvas: HTMLCanvasElement, boats: { x: number; z: number; heading: number; you?: boolean; label?: string }[], labels = true): void {
    if (!this.lake) return
    const size = canvas.width
    if (!this.base || this.base.width !== Math.min(size, 360)) this.base = this.render(Math.min(size, 360))
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.base, 0, 0, size, size)
    const font = Math.max(10, Math.round(size / 34))
    ctx.font = `600 ${font}px Inter, system-ui, sans-serif`
    ctx.textAlign = 'center'
    if (labels) {
      for (const spot of spotsOf(this.lake)) {
        const [x, y] = this.toCanvas(spot.x, spot.z, size)
        ctx.fillStyle = 'rgba(10,30,40,.85)'
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(8,20,28,.9)'
        ctx.fillText(spot.name, x, y - 6)
      }
      const L = landingOf(this.lake)
      const [lx, ly] = this.toCanvas(L.shoreX, L.shoreZ, size)
      ctx.fillStyle = '#f2d36b'
      ctx.fillRect(lx - 4, ly - 4, 8, 8)
      ctx.fillStyle = 'rgba(8,20,28,.9)'
      ctx.fillText('Landing', lx, ly + font + 4)
    }
    if (this.pin) {
      const [x, y] = this.toCanvas(this.pin.x, this.pin.z, size)
      ctx.fillStyle = '#ff5a36'
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y - 12); ctx.lineTo(x + 5, y - 12); ctx.closePath(); ctx.fill()
    }
    for (const b of boats) {
      const [x, y] = this.toCanvas(b.x, b.z, size)
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(-b.heading)
      ctx.fillStyle = b.you ? '#ffffff' : '#ffcf4a'
      ctx.strokeStyle = 'rgba(0,0,0,.6)'
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.restore()
      if (b.label) { ctx.fillStyle = '#fff'; ctx.fillText(b.label, x, y + 16) }
    }
  }
}
