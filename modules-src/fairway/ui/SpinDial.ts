/** Spin widget on a small canvas: a dimpled ball seen side-on (flying right) with a curved arrow around it whose direction and sweep show backspin or topspin and how much, and a vertical spin meter beside it that can be clicked or dragged to set the spin. */
import type { SpinDialLook } from '../config'

export interface SpinDial {
  readonly element: HTMLCanvasElement
  draw(spin: number, enabled: boolean, time: number): void
  dispose(): void
}

const TAU = Math.PI * 2

export function createSpinDial(look: SpinDialLook, step: number, onChange: (spin: number) => void): SpinDial {
  const canvas = document.createElement('canvas')
  canvas.className = 'fw-spin-dial'
  canvas.setAttribute('aria-hidden', 'true')
  const context = canvas.getContext('2d')
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const { width, height } = look
  const ratio = Math.min(2, devicePixelRatio || 1)
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  context?.setTransform(ratio, 0, 0, ratio, 0, 0)

  const ballX = look.ballRadius + look.arrowGap + 8
  const ballY = height / 2 - 4
  const meterX = width - look.meterWidth - 10
  const meterTop = 10
  const meterBottom = height - 10
  const meterMid = (meterTop + meterBottom) / 2
  const meterHalf = (meterBottom - meterTop) / 2
  let enabledNow = true
  let dragging = false
  let lastSpin = Number.NaN
  let lastEnabled = true
  let lastAngle = Number.NaN
  let angle = 0
  let lastTime = 0

  const valueAt = (clientY: number) => {
    const rect = canvas.getBoundingClientRect()
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * height
    const raw = Math.max(-1, Math.min(1, (meterMid - y) / meterHalf))
    return Math.round(raw / step) * step
  }
  const inMeter = (clientX: number) => {
    const rect = canvas.getBoundingClientRect()
    return ((clientX - rect.left) / Math.max(1, rect.width)) * width >= meterX - 12
  }
  const onDown = (event: PointerEvent) => {
    if (!enabledNow || !inMeter(event.clientX)) return
    dragging = true
    canvas.setPointerCapture(event.pointerId)
    onChange(valueAt(event.clientY))
  }
  const onMove = (event: PointerEvent) => {
    if (dragging && enabledNow) onChange(valueAt(event.clientY))
  }
  const onUp = (event: PointerEvent) => {
    dragging = false
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  const drawBall = (ctx: CanvasRenderingContext2D, spin: number) => {
    const r = look.ballRadius
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.beginPath()
    ctx.ellipse(ballX, ballY + r + 7, r * 0.8, 3.5, 0, 0, TAU)
    ctx.fill()
    const body = ctx.createRadialGradient(ballX - r * 0.35, ballY - r * 0.4, r * 0.1, ballX, ballY, r)
    body.addColorStop(0, '#ffffff')
    body.addColorStop(0.7, '#e9ecef')
    body.addColorStop(1, '#b7bec7')
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(ballX, ballY, r, 0, TAU)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(ballX, ballY, r, 0, TAU)
    ctx.clip()
    for (let ring = 0; ring < 4; ring++) {
      const radius = r * (0.18 + ring * 0.25)
      const count = 6 + ring * 6
      const size = r * (0.085 - ring * 0.012)
      for (let index = 0; index < count; index++) {
        const a = angle + (index / count) * TAU + ring * 0.4
        const x = ballX + Math.cos(a) * radius
        const y = ballY + Math.sin(a) * radius
        ctx.fillStyle = `rgba(120,130,145,${0.32 - ring * 0.05})`
        ctx.beginPath()
        ctx.ellipse(x, y, size, size * (1 - ring * 0.12), a, 0, TAU)
        ctx.fill()
      }
    }
    if (Math.abs(spin) > 0) {
      ctx.strokeStyle = spin > 0 ? look.back : look.top
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(ballX + Math.cos(angle) * r, ballY + Math.sin(angle) * r)
      ctx.lineTo(ballX - Math.cos(angle) * r, ballY - Math.sin(angle) * r)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    ctx.restore()
    ctx.strokeStyle = 'rgba(16,22,31,0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(ballX, ballY, r, 0, TAU)
    ctx.stroke()
  }

  /** Backspin turns the ball counter-clockwise as it flies right (its top moves back toward the player); topspin turns it clockwise. */
  const drawArrow = (ctx: CanvasRenderingContext2D, spin: number) => {
    const radius = look.ballRadius + look.arrowGap
    if (spin === 0) {
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = look.neutral
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(ballX, ballY, radius, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
      return
    }
    const back = spin > 0
    const sweep = (0.45 + 1.15 * Math.abs(spin)) * Math.PI
    const middle = -Math.PI / 2
    const start = back ? middle + sweep / 2 : middle - sweep / 2
    const end = back ? middle - sweep / 2 : middle + sweep / 2
    const color = back ? look.back : look.top
    const width = 3 + Math.abs(spin) * 2.5
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.shadowColor = color
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.arc(ballX, ballY, radius, start, end, back)
    ctx.stroke()
    ctx.shadowBlur = 0
    const tipX = ballX + Math.cos(end) * radius
    const tipY = ballY + Math.sin(end) * radius
    const tangent = end + (back ? -Math.PI / 2 : Math.PI / 2)
    const head = 7 + Math.abs(spin) * 3
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(tipX + Math.cos(tangent) * head, tipY + Math.sin(tangent) * head)
    ctx.lineTo(tipX + Math.cos(tangent + 2.4) * head * 0.75, tipY + Math.sin(tangent + 2.4) * head * 0.75)
    ctx.lineTo(tipX + Math.cos(tangent - 2.4) * head * 0.75, tipY + Math.sin(tangent - 2.4) * head * 0.75)
    ctx.closePath()
    ctx.fill()
  }

  const drawFlight = (ctx: CanvasRenderingContext2D) => {
    const y = height - 7
    const from = ballX - look.ballRadius
    const to = ballX + look.ballRadius + 4
    ctx.strokeStyle = look.neutral
    ctx.fillStyle = look.neutral
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(from, y)
    ctx.lineTo(to, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(to + 5, y)
    ctx.lineTo(to - 1, y - 3.5)
    ctx.lineTo(to - 1, y + 3.5)
    ctx.closePath()
    ctx.fill()
  }

  const drawMeter = (ctx: CanvasRenderingContext2D, spin: number) => {
    const w = look.meterWidth
    const gradient = ctx.createLinearGradient(0, meterTop, 0, meterBottom)
    gradient.addColorStop(0, look.back)
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.18)')
    gradient.addColorStop(1, look.top)
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.roundRect(meterX - 2, meterTop - 2, w + 4, meterBottom - meterTop + 4, 7)
    ctx.fill()
    ctx.fillStyle = gradient
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.roundRect(meterX, meterTop, w, meterBottom - meterTop, 5)
    ctx.fill()
    ctx.globalAlpha = 1
    const y = meterMid - spin * meterHalf
    ctx.fillStyle = spin > 0 ? look.back : spin < 0 ? look.top : 'rgba(255,255,255,0.5)'
    ctx.globalAlpha = 0.55
    ctx.fillRect(meterX + 3, Math.min(y, meterMid), w - 6, Math.abs(y - meterMid))
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    for (let value = -1; value <= 1 + 1e-6; value += step) {
      const tickY = meterMid - value * meterHalf
      const major = Math.abs(value) < 1e-6 || Math.abs(Math.abs(value) - 1) < 1e-6
      ctx.lineWidth = major ? 1.6 : 1
      ctx.beginPath()
      ctx.moveTo(meterX - (major ? 5 : 3), tickY)
      ctx.lineTo(meterX, tickY)
      ctx.stroke()
    }
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = 'rgba(16,22,31,0.8)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(meterX - 9, y - 6)
    ctx.lineTo(meterX - 1, y)
    ctx.lineTo(meterX - 9, y + 6)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.roundRect(meterX - 2, y - 3, w + 4, 6, 3)
    ctx.fill()
    ctx.stroke()
    ctx.font = look.labelFont
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = look.back
    ctx.fillText(look.backLabel, meterX + w / 2, meterTop + 7)
    ctx.fillStyle = look.top
    ctx.fillText(look.topLabel, meterX + w / 2, meterBottom - 7)
  }

  return {
    element: canvas,
    draw(spin, enabled, time) {
      enabledNow = enabled
      const dt = Math.max(0, Math.min(0.1, time - lastTime))
      lastTime = time
      if (!motion.matches && spin !== 0) angle = (angle - spin * look.turnsPerSecond * TAU * dt) % TAU
      if (!context) return
      if (spin === lastSpin && enabled === lastEnabled && angle === lastAngle) return
      lastSpin = spin
      lastEnabled = enabled
      lastAngle = angle
      context.clearRect(0, 0, width, height)
      context.globalAlpha = enabled ? 1 : 0.55
      drawArrow(context, spin)
      drawBall(context, spin)
      drawFlight(context)
      drawMeter(context, spin)
      context.globalAlpha = 1
      canvas.style.cursor = enabled ? 'ns-resize' : 'default'
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    },
  }
}
