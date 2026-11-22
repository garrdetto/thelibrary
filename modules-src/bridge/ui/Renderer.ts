import { CELL, MATERIALS } from '../shared/Materials'
import type { Material } from '../shared/Materials'
import { key, pointProblem } from '../shared/Design'
import type { Beam, Level } from '../shared/Design'
import type { Sim, SimVehicle } from '../shared/Sim'
import { VEHICLES } from '../shared/Vehicles'
import type { Placement } from './Editor'

type Theme = {
  skyTop: string; skyBottom: string; far: string; near: string
  grass: string; rock: string; rockDark: string; water: string; waterTop: string
  sun: string; night: boolean; snow: boolean
}

const THEMES: Theme[] = [
  { skyTop: '#7cc6ff', skyBottom: '#dff3ff', far: '#9ccf9b', near: '#6fb46c', grass: '#64b356', rock: '#8a6d4f', rockDark: '#5e4733', water: '#3e8fd0', waterTop: '#8fd0ff', sun: '#fff3b0', night: false, snow: false },
  { skyTop: '#67b5ef', skyBottom: '#e9f6ff', far: '#8fb7a0', near: '#5d9a72', grass: '#4fa35a', rock: '#7d7366', rockDark: '#545048', water: '#2f7fb8', waterTop: '#7cc4f0', sun: '#fff6c4', night: false, snow: false },
  { skyTop: '#f2a65a', skyBottom: '#ffe2b8', far: '#d98b5f', near: '#b8603f', grass: '#c9824a', rock: '#a9502e', rockDark: '#6e2f1b', water: '#3a7b8c', waterTop: '#77b9c4', sun: '#fff1c9', night: false, snow: false },
  { skyTop: '#5aa9e6', skyBottom: '#d6efff', far: '#9db4c8', near: '#7590a8', grass: '#9aa7a0', rock: '#6f7a83', rockDark: '#47515a', water: '#1f6aa5', waterTop: '#5fb0e8', sun: '#ffffff', night: false, snow: false },
  { skyTop: '#9ec9ef', skyBottom: '#f4f9ff', far: '#c9d8e6', near: '#a8bcd0', grass: '#f4f8fb', rock: '#6c7680', rockDark: '#454c54', water: '#4f8fb8', waterTop: '#bfe3f7', sun: '#ffffff', night: false, snow: true },
  { skyTop: '#e7c27d', skyBottom: '#fff1d1', far: '#d8b48a', near: '#c29a6c', grass: '#d4b483', rock: '#a88a6a', rockDark: '#7a6047', water: '#5f8f8a', waterTop: '#9cc7bf', sun: '#fff7da', night: false, snow: false },
  { skyTop: '#3d3a78', skyBottom: '#ff9a5a', far: '#7a4b6e', near: '#4e3352', grass: '#5c6b3a', rock: '#5a4038', rockDark: '#36251f', water: '#3b4f86', waterTop: '#f2a067', sun: '#ffcf70', night: false, snow: false },
  { skyTop: '#8fc8e8', skyBottom: '#e8f6ee', far: '#5f9a6a', near: '#3d7a4a', grass: '#3f8f45', rock: '#6b5a48', rockDark: '#463a2e', water: '#2f6f8f', waterTop: '#7cbfd6', sun: '#fff6c4', night: false, snow: false },
  { skyTop: '#8a9aa8', skyBottom: '#d9dee2', far: '#7c858d', near: '#5c646c', grass: '#7b7f74', rock: '#5c5752', rockDark: '#3b3835', water: '#3e5f73', waterTop: '#8aa7b8', sun: '#f6f1df', night: false, snow: false },
  { skyTop: '#0d1636', skyBottom: '#2c3f7a', far: '#1d2a52', near: '#131c3a', grass: '#2d4a3a', rock: '#3a3d4a', rockDark: '#22242e', water: '#13284f', waterTop: '#4f6fb5', sun: '#f3f1ff', night: true, snow: false },
]

export type View = { scale: number; ox: number; oy: number; width: number; height: number }

export type DrawState = {
  level: Level
  beams: Beam[]
  sim: Sim | null
  stressView: boolean
  placement: Placement | null
  hoverJoint: [number, number] | null
  hoverBeam: number
  deleting: boolean
  time: number
  reduced: boolean
}

export function stressColor(stress: number): string {
  const s = Math.max(0, Math.min(1, stress))
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)
  if (s < 0.5) {
    const t = s / 0.5
    return `rgb(${lerp(58, 255, t)},${lerp(209, 210, t)},${lerp(107, 59, t)})`
  }
  const t = (s - 0.5) / 0.5
  return `rgb(255,${lerp(210, 59, t)},${lerp(59, 48, t)})`
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export class Renderer {
  view: View = { scale: 20, ox: 0, oy: 0, width: 1, height: 1 }
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  fit(level: Level, width: number, height: number, top: number, bottom: number) {
    const span = level.span * CELL
    const minX = -5
    const maxX = span + 5
    const minY = level.water * CELL - 0.8
    const maxY = Math.max(level.yMax * CELL + 1.5, 6)
    const usable = Math.max(100, height - top - bottom)
    const scale = Math.min(width / (maxX - minX), usable / (maxY - minY))
    this.view = {
      scale,
      ox: width / 2 - ((minX + maxX) / 2) * scale,
      oy: top + usable / 2 + ((minY + maxY) / 2) * scale,
      width,
      height,
    }
  }

  sx(x: number) { return this.view.ox + x * this.view.scale }
  sy(y: number) { return this.view.oy - y * this.view.scale }

  toGrid(px: number, py: number): [number, number] {
    return [(px - this.view.ox) / this.view.scale / CELL, (this.view.oy - py) / this.view.scale / CELL]
  }

  draw(state: DrawState) {
    const { ctx } = this
    const { width, height } = this.view
    const theme = THEMES[state.level.theme] ?? THEMES[0]
    ctx.clearRect(0, 0, width, height)
    this.sky(theme, state.time, state.reduced)
    this.terrain(state.level, theme)
    if (!state.sim) this.grid(state)
    this.signs(state.level, theme)
    if (state.sim) this.simBeams(state.sim, state.stressView)
    else this.designBeams(state)
    if (state.sim) {
      this.debris(state.sim)
      for (const vehicle of state.sim.vehicles) this.vehicle(state.sim, vehicle)
    } else this.parkedVehicles(state.level)
    this.water(state.level, theme, state.time, state.reduced)
  }

  private sky(theme: Theme, time: number, reduced: boolean) {
    const { ctx } = this
    const { width, height } = this.view
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, theme.skyTop)
    gradient.addColorStop(1, theme.skyBottom)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
    if (theme.night) {
      ctx.fillStyle = '#ffffff'
      for (let i = 0; i < 90; i++) {
        const twinkle = reduced ? 0.7 : 0.45 + 0.55 * Math.abs(Math.sin(time * 1.3 + i))
        ctx.globalAlpha = twinkle * 0.8
        ctx.fillRect(hash(i) * width, hash(i + 50) * height * 0.55, 1.6, 1.6)
      }
      ctx.globalAlpha = 1
    }
    const sunX = width * 0.8
    const sunY = height * 0.18
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.min(width, height) * 0.22)
    glow.addColorStop(0, theme.sun)
    glow.addColorStop(0.18, theme.sun)
    glow.addColorStop(0.2, theme.night ? 'rgba(240,240,255,0.25)' : 'rgba(255,255,255,0.35)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(sunX, sunY, Math.min(width, height) * 0.22, 0, Math.PI * 2)
    ctx.fill()
    if (!theme.night) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      for (let i = 0; i < 5; i++) {
        const drift = reduced ? 0 : time * (6 + i * 2)
        const x = ((hash(i + 9) * width * 1.4 + drift) % (width * 1.4)) - width * 0.2
        const y = height * (0.08 + hash(i + 3) * 0.25)
        const r = 18 + hash(i + 17) * 26
        for (const [dx, dy, rx, ry] of [[0, 0, 1.8, 0.6], [0.8, -0.35, 1, 0.6], [-0.7, -0.2, 0.8, 0.5]]) {
          ctx.beginPath()
          ctx.ellipse(x + dx * r, y + dy * r, rx * r, ry * r, 0, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    const horizon = this.sy(1.5)
    for (const [color, amp, freq, offset, lift] of [[theme.far, 0.12, 0.004, 1.3, 0.22], [theme.near, 0.08, 0.007, 4.1, 0.1]] as const) {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(0, height)
      for (let x = 0; x <= width + 8; x += 8) {
        const y = horizon - height * lift - Math.sin(x * freq + offset) * height * amp - Math.sin(x * freq * 2.7 + offset * 2) * height * amp * 0.35
        ctx.lineTo(x, y)
      }
      ctx.lineTo(width, height)
      ctx.closePath()
      ctx.fill()
    }
  }

  private terrain(level: Level, theme: Theme) {
    const { ctx } = this
    const span = level.span * CELL
    const bottom = this.view.height + 10
    const top = this.sy(0)
    const s = this.view.scale
    const bank = (x0: number, x1: number, faceX: number, faceLeft: boolean) => {
      const gradient = ctx.createLinearGradient(0, top, 0, bottom)
      gradient.addColorStop(0, theme.rock)
      gradient.addColorStop(1, theme.rockDark)
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.moveTo(x0, top)
      ctx.lineTo(x1, top)
      ctx.lineTo(x1, bottom)
      ctx.lineTo(x0, bottom)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'
      ctx.lineWidth = Math.max(1, s * 0.06)
      for (let i = 0; i < 14; i++) {
        const y = top + (i + 1) * s * 0.9
        if (y > bottom) break
        const reach = s * (0.6 + hash(i + (faceLeft ? 3 : 7)) * 2.4)
        ctx.beginPath()
        ctx.moveTo(faceX, y)
        ctx.lineTo(faceX + (faceLeft ? -reach : reach), y + s * 0.15)
        ctx.stroke()
      }
      ctx.fillStyle = theme.grass
      ctx.fillRect(Math.min(x0, x1), top - s * 0.12, Math.abs(x1 - x0), s * 0.45)
      ctx.fillStyle = 'rgba(0,0,0,0.15)'
      ctx.fillRect(Math.min(x0, x1), top + s * 0.33, Math.abs(x1 - x0), s * 0.08)
      ctx.fillStyle = '#45484f'
      ctx.fillRect(Math.min(x0, x1), top - s * 0.18, Math.abs(x1 - x0), s * 0.18)
    }
    bank(-10, this.sx(0), this.sx(0), true)
    bank(this.sx(span), this.view.width + 10, this.sx(span), false)
    for (const pillar of level.pillars) {
      const x = this.sx(pillar.x * CELL)
      const w = s * 0.9
      const y = this.sy(pillar.top * CELL)
      const gradient = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0)
      gradient.addColorStop(0, '#9aa0a6')
      gradient.addColorStop(0.5, '#d5d8db')
      gradient.addColorStop(1, '#80868c')
      ctx.fillStyle = gradient
      ctx.fillRect(x - w / 2, y, w, bottom - y)
      ctx.fillStyle = '#6f757b'
      ctx.fillRect(x - w * 0.7, y - s * 0.05, w * 1.4, s * 0.25)
    }
  }

  private water(level: Level, theme: Theme, time: number, reduced: boolean) {
    const { ctx } = this
    const y0 = this.sy(level.water * CELL)
    const { width, height } = this.view
    const gradient = ctx.createLinearGradient(0, y0, 0, height)
    gradient.addColorStop(0, theme.waterTop)
    gradient.addColorStop(0.15, theme.water)
    gradient.addColorStop(1, theme.water)
    ctx.globalAlpha = 0.86
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(0, height)
    const phase = reduced ? 0 : time * 1.6
    for (let x = 0; x <= width; x += 6) ctx.lineTo(x, y0 + Math.sin(x * 0.03 + phase) * 2.5 + Math.sin(x * 0.011 - phase * 0.7) * 2)
    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1.5
    for (let i = 0; i < 10; i++) {
      const x = ((hash(i) * width + (reduced ? 0 : time * 12 * (i % 2 ? 1 : -1))) % width + width) % width
      const y = y0 + 10 + hash(i + 4) * Math.max(10, height - y0 - 20)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + 18, y)
      ctx.stroke()
    }
  }

  private grid(state: DrawState) {
    const { ctx } = this
    const level = state.level
    const s = this.view.scale * CELL
    for (const zone of level.zones) {
      const x1 = this.sx(zone.x1 * CELL)
      const x2 = this.sx(zone.x2 * CELL)
      const y1 = this.sy(zone.y2 * CELL)
      const y2 = this.sy(Math.max(zone.y1, level.water) * CELL)
      ctx.save()
      ctx.beginPath()
      ctx.rect(x1, y1, x2 - x1, y2 - y1)
      ctx.clip()
      ctx.fillStyle = 'rgba(255,70,70,0.12)'
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
      ctx.strokeStyle = 'rgba(255,70,70,0.35)'
      ctx.lineWidth = 2
      for (let d = -200; d < x2 - x1 + (y2 - y1); d += 14) {
        ctx.beginPath()
        ctx.moveTo(x1 + d, y1)
        ctx.lineTo(x1 + d - (y2 - y1), y2)
        ctx.stroke()
      }
      ctx.restore()
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    const r = Math.max(1.4, s * 0.045)
    for (let x = 0; x <= level.span; x++) {
      for (let y = level.yMin; y <= level.yMax; y++) {
        if (pointProblem(level, x, y)) continue
        ctx.beginPath()
        ctx.arc(this.sx(x * CELL), this.sy(y * CELL), r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  private signs(level: Level, theme: Theme) {
    const { ctx } = this
    const s = this.view.scale
    const gx = this.sx(level.span * CELL + 6)
    const gy = this.sy(0)
    ctx.strokeStyle = theme.night ? '#cfd3dc' : '#4a4a4a'
    ctx.lineWidth = Math.max(1.5, s * 0.12)
    ctx.beginPath()
    ctx.moveTo(gx, gy)
    ctx.lineTo(gx, gy - s * 3.2)
    ctx.stroke()
    const fh = s * 0.9
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff'
        ctx.fillRect(gx + c * fh * 0.5, gy - s * 3.2 + r * fh * 0.5, fh * 0.5, fh * 0.5)
      }
    }
  }

  private beamPath(material: Material, x1: number, y1: number, x2: number, y2: number, color: string | null, alpha = 1) {
    const { ctx } = this
    const s = this.view.scale
    const w = Math.max(material.tensionOnly ? 1.5 : 3, material.width * s)
    ctx.globalAlpha = alpha
    ctx.lineCap = 'round'
    ctx.strokeStyle = color ? 'rgba(0,0,0,0.45)' : material.edge
    ctx.lineWidth = w + Math.max(1.5, s * 0.06)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.strokeStyle = color ?? material.color
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    if (!color && material.road) {
      ctx.strokeStyle = material.id === 'heavy' ? '#ff7a59' : '#ffd23b'
      ctx.lineWidth = Math.max(1, w * 0.12)
      ctx.setLineDash([w * 0.6, w * 0.6])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
    } else if (!color && material.id === 'steel') {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = Math.max(1, w * 0.18)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    } else if (!color && material.id === 'wood') {
      ctx.strokeStyle = 'rgba(90,50,20,0.35)'
      ctx.lineWidth = Math.max(0.8, w * 0.12)
      ctx.setLineDash([w * 1.4, w * 0.9])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.globalAlpha = 1
  }

  private joint(x: number, y: number, anchor: boolean, highlight: boolean) {
    const { ctx } = this
    const s = this.view.scale
    if (anchor) {
      ctx.fillStyle = '#ff9f1c'
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - s * 0.35, y + s * 0.5)
      ctx.lineTo(x + s * 0.35, y + s * 0.5)
      ctx.closePath()
      ctx.fill()
    }
    const r = Math.max(3, s * (anchor ? 0.24 : 0.17))
    ctx.fillStyle = highlight ? '#ffffff' : anchor ? '#ffb347' : '#e9edf2'
    ctx.strokeStyle = anchor ? '#8a4b00' : '#2b2f36'
    ctx.lineWidth = Math.max(1.2, s * 0.05)
    ctx.beginPath()
    ctx.arc(x, y, highlight ? r * 1.4 : r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  private ordered<T extends { material: Material }>(items: T[]): T[] {
    const rank = (m: Material) => (m.road ? 2 : m.tensionOnly ? 1 : 0)
    return [...items].sort((a, b) => rank(a.material) - rank(b.material))
  }

  private designBeams(state: DrawState) {
    const items = state.beams.map((beam, index) => ({ beam, index, material: MATERIALS[beam.m] }))
    for (const { beam, index, material } of this.ordered(items)) {
      const doomed = state.deleting && index === state.hoverBeam
      this.beamPath(material, this.sx(beam.x1 * CELL), this.sy(beam.y1 * CELL), this.sx(beam.x2 * CELL), this.sy(beam.y2 * CELL), doomed ? '#ff4d4d' : null)
    }
    if (state.placement) {
      const bad = Boolean(state.placement.problem)
      for (const beam of state.placement.beams) {
        this.beamPath(MATERIALS[beam.m], this.sx(beam.x1 * CELL), this.sy(beam.y1 * CELL), this.sx(beam.x2 * CELL), this.sy(beam.y2 * CELL), bad ? '#ff4d4d' : null, 0.65)
      }
    }
    const anchors = new Set(state.level.anchors.map(([x, y]) => key(x, y)))
    const joints = new Set<string>(anchors)
    for (const beam of state.beams) {
      joints.add(key(beam.x1, beam.y1))
      joints.add(key(beam.x2, beam.y2))
    }
    for (const id of joints) {
      const [x, y] = id.split(',').map(Number)
      const hover = state.hoverJoint !== null && state.hoverJoint[0] === x && state.hoverJoint[1] === y
      this.joint(this.sx(x * CELL), this.sy(y * CELL), anchors.has(id), hover)
    }
  }

  private simBeams(sim: Sim, stressView: boolean) {
    const items = sim.beams.filter(beam => !beam.broken)
    for (const beam of this.ordered(items)) {
      const a = sim.particles[beam.i]
      const b = sim.particles[beam.j]
      this.beamPath(beam.material, this.sx(a.x), this.sy(a.y), this.sx(b.x), this.sy(b.y), stressView ? stressColor(beam.stress) : null)
    }
    sim.particles.forEach((p, index) => {
      if (!p.joint) return
      if (p.w !== 0 && !sim.connected(index)) return
      this.joint(this.sx(p.x), this.sy(p.y), p.w === 0, false)
    })
  }

  private debris(sim: Sim) {
    for (const piece of sim.debris) {
      const cx = (piece.x1 + piece.x2) / 2
      const cy = (piece.y1 + piece.y2) / 2
      const hx = (piece.x2 - piece.x1) / 2
      const hy = (piece.y2 - piece.y1) / 2
      const c = Math.cos(piece.angle)
      const s = Math.sin(piece.angle)
      const rx = hx * c - hy * s
      const ry = hx * s + hy * c
      this.beamPath(piece.material, this.sx(cx - rx), this.sy(cy - ry), this.sx(cx + rx), this.sy(cy + ry), null, Math.min(1, piece.life))
    }
  }

  private parkedVehicles(level: Level) {
    const { ctx } = this
    const s = this.view.scale
    let front = -3
    for (const id of level.vehicles) {
      const spec = VEHICLES[id]
      const centre = front - spec.length / 2
      ctx.save()
      ctx.translate(this.sx(centre), this.sy(spec.wheelRadius))
      ctx.scale(s, -s)
      drawBody(ctx, spec)
      for (const axle of spec.axles) {
        ctx.save()
        ctx.translate(axle, 0)
        drawWheel(ctx, spec.wheelRadius, spec.shape === 'monster' || spec.shape === 'tractor')
        ctx.restore()
      }
      ctx.restore()
      front -= spec.length + 5
    }
  }

  private vehicle(sim: Sim, vehicle: SimVehicle) {
    const { ctx } = this
    const frame = sim.vehicleFrame(vehicle)
    const spec = vehicle.spec
    const s = this.view.scale
    ctx.save()
    ctx.translate(this.sx(frame.x), this.sy(frame.y))
    ctx.scale(s, -s)
    ctx.rotate(frame.angle)
    drawBody(ctx, spec)
    ctx.restore()
    vehicle.wheels.forEach((index, k) => {
      const p = sim.particles[index]
      ctx.save()
      ctx.translate(this.sx(p.x), this.sy(p.y))
      ctx.scale(s, -s)
      ctx.rotate(vehicle.spin[k])
      drawWheel(ctx, spec.wheelRadius, spec.shape === 'monster' || spec.shape === 'tractor')
      ctx.restore()
    })
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
}

function drawWheel(ctx: CanvasRenderingContext2D, r: number, chunky: boolean) {
  ctx.fillStyle = '#1b1c1f'
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  if (chunky) {
    ctx.fillStyle = '#2c2d31'
    for (let i = 0; i < 12; i++) {
      ctx.save()
      ctx.rotate((i / 12) * Math.PI * 2)
      ctx.fillRect(r * 0.85, -r * 0.08, r * 0.2, r * 0.16)
      ctx.restore()
    }
  }
  ctx.fillStyle = '#c9ced6'
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#6c727b'
  ctx.lineWidth = r * 0.1
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48)
    ctx.stroke()
  }
}

function windows(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#9fd3ff'
  roundRect(ctx, x, y, w, h, 0.08)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.fillRect(x + w * 0.1, y + h * 0.15, w * 0.15, h * 0.7)
}

function drawBody(ctx: CanvasRenderingContext2D, spec: { shape: string; length: number; height: number; wheelRadius: number; body: string; trim: string; axles: number[] }) {
  const L = spec.length
  const r = spec.wheelRadius
  const ground = -r
  const base = ground + r * 0.55 + 0.12
  const top = ground + spec.height
  const half = L / 2
  ctx.lineJoin = 'round'
  ctx.lineWidth = 0.06
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  const fill = (color: string) => { ctx.fillStyle = color; ctx.fill(); ctx.stroke() }
  switch (spec.shape) {
    case 'car': {
      roundRect(ctx, -half, base, L, (top - base) * 0.5, 0.3); fill(spec.body)
      ctx.beginPath(); ctx.moveTo(-half * 0.7, base + (top - base) * 0.48); ctx.lineTo(-half * 0.5, top); ctx.lineTo(half * 0.25, top); ctx.lineTo(half * 0.6, base + (top - base) * 0.48); ctx.closePath(); fill(spec.body)
      windows(ctx, -half * 0.45, base + (top - base) * 0.55, half * 0.45, (top - base) * 0.36)
      windows(ctx, half * 0.05, base + (top - base) * 0.55, half * 0.38, (top - base) * 0.36)
      ctx.fillStyle = '#ffe9a0'; ctx.fillRect(half - 0.18, base + 0.15, 0.15, 0.15)
      break
    }
    case 'van': case 'icecream': {
      ctx.beginPath(); ctx.moveTo(-half, base); ctx.lineTo(-half, top); ctx.lineTo(half * 0.55, top); ctx.lineTo(half, base + (top - base) * 0.5); ctx.lineTo(half, base); ctx.closePath(); fill(spec.body)
      ctx.fillStyle = spec.trim; ctx.fillRect(-half, base + (top - base) * 0.32, L * 0.78, (top - base) * 0.12)
      windows(ctx, half * 0.5, base + (top - base) * 0.52, half * 0.35, (top - base) * 0.32)
      if (spec.shape === 'icecream') {
        ctx.fillStyle = '#e8b56a'; ctx.beginPath(); ctx.moveTo(-0.3, top); ctx.lineTo(0, top + 0.9); ctx.lineTo(0.3, top); ctx.closePath(); ctx.fill(); ctx.stroke()
        ctx.fillStyle = '#ff9cc9'; ctx.beginPath(); ctx.arc(0, top + 1.05, 0.38, 0, Math.PI * 2); fill('#ff9cc9')
        windows(ctx, -half * 0.6, base + (top - base) * 0.5, half * 0.7, (top - base) * 0.3)
      }
      break
    }
    case 'pickup': case 'monster': {
      const lift = spec.shape === 'monster' ? r * 0.5 : 0
      const b = base + lift
      roundRect(ctx, -half, b, L, (top - b) * 0.45, 0.15); fill(spec.body)
      ctx.beginPath(); ctx.moveTo(-half * 0.1, b + (top - b) * 0.44); ctx.lineTo(-half * 0.05, top); ctx.lineTo(half * 0.45, top); ctx.lineTo(half * 0.65, b + (top - b) * 0.44); ctx.closePath(); fill(spec.body)
      windows(ctx, half * 0.05, b + (top - b) * 0.52, half * 0.45, (top - b) * 0.36)
      ctx.fillStyle = spec.trim; ctx.fillRect(-half, b + (top - b) * 0.18, L, 0.12)
      break
    }
    case 'bus': {
      roundRect(ctx, -half, base, L, top - base, 0.35); fill(spec.body)
      ctx.fillStyle = spec.trim; ctx.fillRect(-half, base + (top - base) * 0.22, L, 0.18)
      const count = Math.max(3, Math.round(L / 1.6))
      for (let i = 0; i < count; i++) windows(ctx, -half + 0.4 + i * ((L - 0.8) / count), base + (top - base) * 0.48, (L - 0.8) / count - 0.2, (top - base) * 0.36)
      break
    }
    case 'truck': case 'dump': case 'tanker': case 'crane': case 'fire': {
      const cab = Math.min(2.6, L * 0.26)
      ctx.beginPath(); ctx.moveTo(half - cab, base); ctx.lineTo(half - cab, top - 0.1); ctx.lineTo(half - cab * 0.35, top - 0.1); ctx.lineTo(half, base + (top - base) * 0.45); ctx.lineTo(half, base); ctx.closePath(); fill(spec.shape === 'fire' ? spec.body : spec.shape === 'crane' ? spec.body : spec.trim)
      windows(ctx, half - cab * 0.6, base + (top - base) * 0.5, cab * 0.42, (top - base) * 0.35)
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(-half, base, L - cab, 0.25)
      const bx = -half
      const bw = L - cab - 0.15
      if (spec.shape === 'truck') { roundRect(ctx, bx, base + 0.25, bw, top - base - 0.25, 0.1); fill(spec.body); ctx.fillStyle = spec.trim; ctx.fillRect(bx + 0.3, base + (top - base) * 0.45, bw - 0.6, 0.35) }
      if (spec.shape === 'dump') {
        ctx.beginPath(); ctx.moveTo(bx, base + 0.25); ctx.lineTo(bx - 0.2, top); ctx.lineTo(bx + bw, top); ctx.lineTo(bx + bw, base + 0.25); ctx.closePath(); fill(spec.body)
        ctx.fillStyle = '#8c8279'
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(bx + 0.4 + i * (bw - 0.6) / 5, top + 0.1, 0.35, 0, Math.PI * 2); ctx.fill() }
      }
      if (spec.shape === 'tanker') {
        const h = top - base - 0.35
        roundRect(ctx, bx, base + 0.3, bw, h, h / 2); fill(spec.body)
        ctx.fillStyle = spec.trim; ctx.fillRect(bx + 0.4, base + 0.3 + h * 0.42, bw - 0.8, h * 0.16)
      }
      if (spec.shape === 'fire') {
        roundRect(ctx, bx, base + 0.25, bw, top - base - 0.5, 0.15); fill(spec.body)
        ctx.fillStyle = spec.trim; ctx.fillRect(bx, base + (top - base) * 0.4, bw, 0.15)
        ctx.strokeStyle = '#d9d9d9'; ctx.lineWidth = 0.08
        ctx.beginPath(); ctx.moveTo(bx + 0.2, top - 0.1); ctx.lineTo(bx + bw + cab * 0.6, top - 0.1); ctx.moveTo(bx + 0.2, top + 0.15); ctx.lineTo(bx + bw + cab * 0.6, top + 0.15)
        for (let x = bx + 0.4; x < bx + bw + cab * 0.6; x += 0.4) { ctx.moveTo(x, top - 0.1); ctx.lineTo(x, top + 0.15) }
        ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.06
        ctx.fillStyle = '#4da3ff'; ctx.fillRect(half - cab * 0.7, top - 0.1, 0.4, 0.2)
      }
      if (spec.shape === 'crane') {
        roundRect(ctx, bx, base + 0.25, bw, (top - base) * 0.4, 0.1); fill(spec.trim)
        ctx.save(); ctx.translate(bx + bw * 0.25, base + (top - base) * 0.65); ctx.rotate(0.12)
        roundRect(ctx, 0, -0.3, L * 0.85, 0.6, 0.1); fill(spec.body)
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'
        for (let x = 0.3; x < L * 0.8; x += 0.6) { ctx.beginPath(); ctx.moveTo(x, -0.3); ctx.lineTo(x + 0.3, 0.3); ctx.stroke() }
        ctx.restore()
      }
      break
    }
    case 'tractor': {
      roundRect(ctx, -half * 0.2, base, half * 1.2, (top - base) * 0.45, 0.15); fill(spec.body)
      roundRect(ctx, -half * 0.75, base + (top - base) * 0.2, half * 0.75, (top - base) * 0.8, 0.1); fill(spec.body)
      windows(ctx, -half * 0.65, base + (top - base) * 0.5, half * 0.55, (top - base) * 0.42)
      ctx.fillStyle = '#333'; ctx.fillRect(half * 0.55, base + (top - base) * 0.45, 0.12, 0.7)
      ctx.fillStyle = spec.trim; ctx.fillRect(-half * 0.2, base, half * 1.2, 0.12)
      break
    }
  }
}

export function drawVehicleIcon(ctx: CanvasRenderingContext2D, spec: { shape: string; length: number; height: number; wheelRadius: number; body: string; trim: string; axles: number[] }, width: number, height: number) {
  ctx.clearRect(0, 0, width, height)
  const total = spec.length + 0.6
  const tall = spec.height + 1.4
  const s = Math.min(width / total, height / tall)
  ctx.save()
  ctx.translate(width / 2, height - 4 - 0 * s)
  ctx.scale(s, -s)
  ctx.translate(0, spec.wheelRadius)
  drawBody(ctx, spec)
  for (const axle of spec.axles) {
    ctx.save()
    ctx.translate(axle, 0)
    drawWheel(ctx, spec.wheelRadius, spec.shape === 'monster' || spec.shape === 'tractor')
    ctx.restore()
  }
  ctx.restore()
}
