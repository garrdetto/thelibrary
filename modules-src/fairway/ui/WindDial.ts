/** Wind compass on a small canvas: a ringed dial turned to the camera view with an arrow for the wind (pointing where it blows, longer and warmer the stronger it is). */
import type { WindDialLook } from '../config'

export interface WindDial {
  readonly element: HTMLCanvasElement
  /** angle: radians relative to the view, 0 blowing straight away from the viewer; strength: 0–1 of the strongest wind. */
  draw(angle: number, strength: number): void
}

export function createWindDial(look: WindDialLook): WindDial {
  const canvas = document.createElement('canvas')
  canvas.className = 'fw-wind-dial'
  canvas.setAttribute('aria-hidden', 'true')
  const context = canvas.getContext('2d')
  const size = look.size
  const ratio = Math.min(2, devicePixelRatio || 1)
  canvas.width = Math.round(size * ratio)
  canvas.height = Math.round(size * ratio)
  canvas.style.width = `${size}px`
  canvas.style.height = `${size}px`
  context?.setTransform(ratio, 0, 0, ratio, 0, 0)
  let lastKey = ''

  return {
    element: canvas,
    draw(angle, strength) {
      if (!context) return
      const key = `${angle.toFixed(2)}|${strength.toFixed(2)}`
      if (key === lastKey) return
      lastKey = key
      const c = size / 2
      const r = c - 3
      context.clearRect(0, 0, size, size)
      const face = context.createRadialGradient(c, c - r * 0.3, r * 0.1, c, c, r)
      face.addColorStop(0, 'rgba(255,255,255,0.16)')
      face.addColorStop(1, 'rgba(0,0,0,0.28)')
      context.fillStyle = face
      context.beginPath()
      context.arc(c, c, r, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = 'rgba(255,255,255,0.35)'
      context.lineWidth = 1.2
      context.stroke()
      for (let tick = 0; tick < 16; tick++) {
        const a = (tick / 16) * Math.PI * 2
        const major = tick % 4 === 0
        context.strokeStyle = major ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)'
        context.lineWidth = major ? 1.6 : 1
        context.beginPath()
        context.moveTo(c + Math.sin(a) * (r - (major ? 6 : 4)), c - Math.cos(a) * (r - (major ? 6 : 4)))
        context.lineTo(c + Math.sin(a) * (r - 1), c - Math.cos(a) * (r - 1))
        context.stroke()
      }
      context.fillStyle = look.aim
      context.beginPath()
      context.moveTo(c, 4)
      context.lineTo(c - 3.5, 10)
      context.lineTo(c + 3.5, 10)
      context.closePath()
      context.fill()
      const s = Math.max(0, Math.min(1, strength))
      const color = s < 0.35 ? look.calm : s < 0.7 ? look.breeze : look.strong
      const length = r * (0.35 + 0.5 * s)
      const dx = Math.sin(angle)
      const dy = -Math.cos(angle)
      const tailX = c - dx * length
      const tailY = c - dy * length
      const tipX = c + dx * length
      const tipY = c + dy * length
      context.strokeStyle = color
      context.fillStyle = color
      context.lineWidth = 3 + s * 2
      context.lineCap = 'round'
      context.shadowColor = color
      context.shadowBlur = 5
      context.beginPath()
      context.moveTo(tailX, tailY)
      context.lineTo(tipX - dx * 6, tipY - dy * 6)
      context.stroke()
      context.shadowBlur = 0
      const px = -dy
      const py = dx
      context.beginPath()
      context.moveTo(tipX + dx * 2, tipY + dy * 2)
      context.lineTo(tipX - dx * 9 + px * 6, tipY - dy * 9 + py * 6)
      context.lineTo(tipX - dx * 9 - px * 6, tipY - dy * 9 - py * 6)
      context.closePath()
      context.fill()
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.arc(c, c, 2.5, 0, Math.PI * 2)
      context.fill()
    },
  }
}
