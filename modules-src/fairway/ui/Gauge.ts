/** Concentric swing gauge on the overlay canvas: the outer power ring with the planned-power marker, the cursor track with the path (bottom) and contact (top) marks, and the inner rhythm ring growing to its mark; a text readout narrates each step for reduced-motion and screen-reader users. */
import type { GaugeLook } from '../config'
import type { MeterSpec } from '../tuning'
import type { MeterState } from '../systems/SwingMeter'

export interface Gauge {
  draw(meter: MeterState | null, plannedPower: number): void
  dispose(): void
}

const TOP = -Math.PI / 2

export function createGauge(look: GaugeLook, spec: MeterSpec): Gauge {
  const wrap = document.getElementById('meter-wrap') as HTMLDivElement
  const canvas = document.getElementById('meter') as HTMLCanvasElement
  const readout = document.getElementById('meter-readout') as HTMLDivElement
  const context = canvas.getContext('2d')
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let lastText = ''

  const scaleCanvas = () => {
    const ratio = Math.min(2, devicePixelRatio || 1)
    canvas.width = Math.round(look.size * ratio)
    canvas.height = Math.round(look.size * ratio)
    context?.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  scaleCanvas()
  addEventListener('resize', scaleCanvas)

  const center = look.size / 2

  const ring = (radius: number, from: number, to: number, color: string, width: number, dash: number[] = []) => {
    if (!context || radius <= 0) return
    context.beginPath()
    context.setLineDash(dash)
    context.strokeStyle = color
    context.lineWidth = width
    context.lineCap = dash.length ? 'butt' : 'round'
    context.arc(center, center, radius, from, to)
    context.stroke()
    context.setLineDash([])
  }

  const tick = (radius: number, angle: number, color: string, width: number, reach: number) => {
    if (!context) return
    context.beginPath()
    context.strokeStyle = color
    context.lineWidth = width
    context.lineCap = 'round'
    context.moveTo(center + Math.cos(angle) * (radius - reach), center + Math.sin(angle) * (radius - reach))
    context.lineTo(center + Math.cos(angle) * (radius + reach), center + Math.sin(angle) * (radius + reach))
    context.stroke()
  }

  const dot = (radius: number, angle: number, size: number, color: string) => {
    if (!context) return
    context.beginPath()
    context.fillStyle = color
    context.arc(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius, size, 0, Math.PI * 2)
    context.fill()
  }

  const verdict = (miss: number, negative: string, positive: string) => (miss === 0 ? look.labels.perfect : miss < 0 ? negative : positive)

  const describe = (meter: MeterState, plannedPower: number): string => {
    const labels = look.labels
    const power = Math.round(meter.power * 100)
    switch (meter.phase) {
      case 'power':
        return labels.power(power, Math.round(plannedPower * 100))
      case 'path':
        return labels.path(power)
      case 'contact':
        return labels.contact(verdict(meter.push, labels.pull, labels.push))
      case 'rhythm':
        return labels.rhythm
      default: {
        const parts = [verdict(meter.push, labels.pull, labels.push), verdict(meter.curve, labels.hook, labels.slice)]
        const loss = Math.round(meter.rhythmLoss * 100)
        return labels.result(power, parts, loss)
      }
    }
  }

  return {
    draw(meter, plannedPower) {
      wrap.hidden = !meter
      if (!meter || !context) return
      context.clearRect(0, 0, look.size, look.size)
      const outer = look.outerRadius
      const track = look.cursorRadius
      const inner = look.innerRadius

      ring(outer, 0, Math.PI * 2, look.track, look.outerWidth)
      const power = Math.max(0, Math.min(1, meter.power))
      const over = power > plannedPower + 0.02
      if (power > 0) ring(outer, TOP, TOP + power * Math.PI * 2, over ? look.overPower : look.power, look.outerWidth * 0.72)
      tick(outer, TOP + plannedPower * Math.PI * 2, look.plan, look.markWidth, look.outerWidth * 0.85)

      ring(track, TOP, -TOP, look.track, look.cursorWidth)
      const zone = spec.perfectZone * spec.window * Math.PI
      ring(track, -TOP - zone, -TOP + zone, look.perfect, look.cursorWidth)
      ring(track, TOP - zone, TOP + zone, look.perfect, look.cursorWidth)
      tick(track, -TOP, look.mark, look.markWidth, look.cursorWidth)
      tick(track, TOP, look.mark, look.markWidth, look.cursorWidth)
      if (meter.pathError !== null) dot(track, -TOP + meter.pathError * Math.PI, look.cursorSize * 0.6, meter.push === 0 ? look.good : look.bad)
      if (meter.contactError !== null) dot(track, TOP - meter.contactError * Math.PI, look.cursorSize * 0.6, meter.curve === 0 ? look.good : look.bad)
      if (meter.phase === 'path') dot(track, TOP + meter.cursor * Math.PI, look.cursorSize, look.cursor)
      if (meter.phase === 'contact') dot(track, -TOP - meter.cursor * Math.PI, look.cursorSize, look.cursor)

      const perfectBand = spec.rhythmPerfect * spec.rhythmWindow * inner
      ring(inner, 0, Math.PI * 2, look.perfect, Math.max(2, perfectBand * 2))
      ring(inner, 0, Math.PI * 2, look.mark, 1.5, [4, 4])
      const showRing = meter.phase === 'rhythm' || meter.rhythmError !== null
      if (showRing) {
        const grown = meter.phase === 'rhythm' ? meter.ring : 1 + (meter.rhythmError ?? 0)
        ring(Math.max(1, inner * Math.min(1 + spec.rhythmOverrun, grown)), 0, Math.PI * 2, meter.phase === 'rhythm' ? look.rhythm : meter.rhythmLoss === 0 ? look.good : look.bad, look.rhythmWidth)
      }

      context.fillStyle = look.text
      context.font = look.font
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(`${Math.round(power * 100)}`, center, center)

      const text = describe(meter, plannedPower)
      if (text !== lastText) {
        readout.textContent = text
        lastText = text
      }
      readout.setAttribute('aria-live', motion.matches ? 'polite' : 'off')
    },
    dispose() {
      removeEventListener('resize', scaleCanvas)
      wrap.hidden = true
    },
  }
}
