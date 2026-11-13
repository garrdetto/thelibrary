import type { TrackerContact } from '../net/RemotePlayers'

const RANGE = 25
const INTERVAL = 1 / 15

export class Tracker {
  private readonly context: CanvasRenderingContext2D | null
  private size = 0
  private elapsed = INTERVAL

  constructor(private readonly canvas: HTMLCanvasElement | null) {
    this.context = canvas?.getContext('2d') ?? null
  }

  private resize(): void {
    if (!this.canvas) return
    const css = this.canvas.clientWidth || 150
    const size = Math.round(css * Math.min(window.devicePixelRatio || 1, 2))
    if (size === this.size) return
    this.size = size
    this.canvas.width = this.canvas.height = size
  }

  update(dt: number, contacts: TrackerContact[], x: number, z: number, yaw: number, team: 0 | 1 | null): void {
    this.elapsed += dt
    if (!this.context || this.elapsed < INTERVAL) return
    this.elapsed = 0
    this.resize()
    const context = this.context
    const size = this.size
    const center = size / 2
    const radius = center - 2
    context.clearRect(0, 0, size, size)

    context.fillStyle = 'rgba(8, 18, 30, 0.55)'
    context.beginPath()
    context.arc(center, center, radius, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = 'rgba(150, 200, 255, 0.55)'
    context.lineWidth = Math.max(1, size / 110)
    context.stroke()
    context.strokeStyle = 'rgba(150, 200, 255, 0.22)'
    for (const share of [1 / 3, 2 / 3]) {
      context.beginPath()
      context.arc(center, center, radius * share, 0, Math.PI * 2)
      context.stroke()
    }
    context.beginPath()
    context.moveTo(center, center - radius)
    context.lineTo(center, center + radius)
    context.moveTo(center - radius, center)
    context.lineTo(center + radius, center)
    context.stroke()

    const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw)
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw)
    const scale = radius / RANGE
    for (const contact of contacts) {
      const ally = team !== null && contact.team === team
      if (!ally && !contact.noisy) continue
      const dx = contact.x - x, dz = contact.z - z
      const sx = (dx * rightX + dz * rightZ) * scale
      const sy = -(dx * forwardX + dz * forwardZ) * scale
      const distance = Math.hypot(sx, sy)
      const clamp = distance > radius - 4 ? (radius - 4) / distance : 1
      context.fillStyle = ally ? 'rgba(255, 224, 120, 0.95)' : 'rgba(255, 80, 70, 0.95)'
      context.beginPath()
      context.arc(center + sx * clamp, center + sy * clamp, size / (clamp < 1 ? 42 : 28), 0, Math.PI * 2)
      context.fill()
    }

    context.fillStyle = 'rgba(220, 238, 255, 0.95)'
    context.beginPath()
    context.moveTo(center, center - size / 22)
    context.lineTo(center - size / 36, center + size / 36)
    context.lineTo(center + size / 36, center + size / 36)
    context.closePath()
    context.fill()
  }
}
