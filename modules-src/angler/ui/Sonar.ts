/** Scrolling sonar strip: depth under the hull, bottom hardness, weeds and fish arches sampled from the species that are actually active here. Better units add size hints and species names. */
import { conditionsAt, speciesChances } from '../shared/Catch'
import type { FishingContext } from '../shared/Catch'
import { SPECIES } from '../shared/Species'
import type { SpeciesId } from '../shared/Species'
import type { Bottom } from '../shared/Lakes'

interface Column { depth: number; bottom: Bottom }
interface Arch { x: number; depth: number; size: number; species: SpeciesId }

const hardness: Record<Bottom, number> = { rock: 1, gravel: 0.8, sand: 0.6, timber: 0.7, weed: 0.45, muck: 0.3 }

export class Sonar {
  private columns: Column[] = []
  private arches: Arch[] = []
  private acc = 0
  private chances: { id: SpeciesId; weight: number }[] = []
  private total = 0
  private chanceAge = 99
  level = 0

  constructor(private canvas: HTMLCanvasElement) {}

  update(dt: number, ctx: FishingContext, speed: number): void {
    this.acc += dt * (0.8 + Math.min(Math.abs(speed), 20) * 0.25)
    this.chanceAge += dt
    if (this.chanceAge > 3) {
      this.chanceAge = 0
      const c = conditionsAt(ctx)
      this.chances = speciesChances(ctx, c)
      this.total = this.chances.reduce((s, x) => s + x.weight, 0)
    }
    while (this.acc > 0.12) {
      this.acc -= 0.12
      const c = conditionsAt(ctx)
      this.columns.push({ depth: c.depth, bottom: c.bottom })
      const w = this.canvas.width
      if (this.columns.length > w / 2) this.columns.shift()
      for (const a of this.arches) a.x -= 2
      this.arches = this.arches.filter(a => a.x > -20)
      if (this.total > 0 && Math.random() < Math.min(0.35, this.total * 0.05)) {
        let pick = Math.random() * this.total
        let id = this.chances[0].id
        for (const ch of this.chances) { pick -= ch.weight; if (pick <= 0) { id = ch.id; break } }
        const s = SPECIES[id]
        const [lo, hi] = s.depth[c.season]
        const depth = Math.min(c.depth - 0.8, lo + Math.random() * Math.max(1, hi - lo))
        if (depth > 1.5) this.arches.push({ x: w, depth, size: Math.min(1, 0.25 + Math.log1p(s.median) * 0.35 + Math.random() * 0.2), species: id })
      }
    }
    this.draw()
  }

  private draw(): void {
    const g = this.canvas.getContext('2d')!
    const W = this.canvas.width, H = this.canvas.height
    const maxDepth = Math.max(12, ...this.columns.map(c => c.depth)) * 1.12
    const y = (d: number) => 6 + (d / maxDepth) * (H - 12)
    g.fillStyle = '#071c2a'
    g.fillRect(0, 0, W, H)
    const grad = g.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, 'rgba(30,90,140,.35)')
    grad.addColorStop(1, 'rgba(5,20,40,.0)')
    g.fillStyle = grad
    g.fillRect(0, 0, W, H)
    this.columns.forEach((c, i) => {
      const x = W - (this.columns.length - i) * 2
      const top = y(c.depth)
      const h = hardness[c.bottom]
      g.fillStyle = `rgb(${Math.round(120 + h * 120)},${Math.round(60 + h * 90)},${Math.round(30 + h * 30)})`
      g.fillRect(x, top, 2, 3 + h * 4)
      g.fillStyle = `rgba(${Math.round(70 + h * 60)},${Math.round(40 + h * 40)},20,.75)`
      g.fillRect(x, top + 3 + h * 4, 2, H - top)
      if (c.bottom === 'weed') { g.fillStyle = 'rgba(80,190,90,.65)'; g.fillRect(x, top - 4 - (i % 5), 2, 4 + (i % 5)) }
      if (c.bottom === 'timber' && i % 9 === 0) { g.fillStyle = 'rgba(200,170,110,.7)'; g.fillRect(x, top - 10, 2, 10) }
    })
    g.font = '600 10px Inter, system-ui, sans-serif'
    for (const a of this.arches) {
      const ay = y(a.depth)
      const r = 3 + a.size * (this.level > 0 ? 7 : 5)
      g.strokeStyle = a.size > 0.7 ? '#ffd24a' : '#ff7a3d'
      g.lineWidth = 2
      g.beginPath()
      g.arc(a.x, ay + r * 0.6, r, Math.PI * 1.15, Math.PI * 1.85)
      g.stroke()
      if (this.level > 1) { g.fillStyle = 'rgba(255,240,200,.85)'; g.fillText(SPECIES[a.species].name.split(' ').pop()!, a.x - 14, ay - r) }
    }
    const last = this.columns[this.columns.length - 1]
    if (last) {
      g.fillStyle = '#e9f6f6'
      g.font = '700 13px Rajdhani, Inter, sans-serif'
      g.fillText(`${last.depth.toFixed(1)} ft · ${last.bottom}`, 8, 16)
    }
  }
}
