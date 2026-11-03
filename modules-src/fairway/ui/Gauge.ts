/** Curved swing-meter gauge drawn on the overlay canvas from the meter state, plus a numeric readout for reduced-motion users. */
import type { GaugeLook } from '../config'
import type { MeterSpec } from '../tuning'
import type { MeterState } from '../systems/SwingMeter'

export interface Gauge {
  draw(meter: MeterState | null): void
  dispose(): void
}

export function createGauge(look: GaugeLook, meterSpec: MeterSpec, readoutText: (power: number, accuracy: string) => string): Gauge {
  const wrap = document.getElementById('meter-wrap') as HTMLDivElement
  const canvas = document.getElementById('meter') as HTMLCanvasElement
  const readout = document.getElementById('meter-readout') as HTMLDivElement
  const context = canvas.getContext('2d')
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const low = meterSpec.overshootLimit
  const high = meterSpec.climbCap
  let lastText = ''

  const scaleCanvas = () => {
    const ratio = Math.min(2, devicePixelRatio || 1)
    canvas.width = Math.round(look.size * ratio)
    canvas.height = Math.round(look.size * ratio)
    context?.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  scaleCanvas()
  addEventListener('resize', scaleCanvas)

  const angleFor = (value: number) => look.startAngle + ((Math.max(low, Math.min(high, value)) - low) / (high - low)) * look.sweep

  const arc = (from: number, to: number, color: string, width: number) => {
    if (!context) return
    const center = look.size / 2
    const radius = center - look.thickness
    context.beginPath()
    context.strokeStyle = color
    context.lineWidth = width
    context.lineCap = 'round'
    context.arc(center, center, radius, angleFor(from), angleFor(to))
    context.stroke()
  }

  const tick = (value: number, color: string, width: number, reach: number) => {
    if (!context) return
    const center = look.size / 2
    const radius = center - look.thickness
    const angle = angleFor(value)
    context.beginPath()
    context.strokeStyle = color
    context.lineWidth = width
    context.moveTo(center + Math.cos(angle) * (radius - reach), center + Math.sin(angle) * (radius - reach))
    context.lineTo(center + Math.cos(angle) * (radius + reach), center + Math.sin(angle) * (radius + reach))
    context.stroke()
  }

  return {
    draw(meter) {
      wrap.hidden = !meter
      if (!meter || !context) return
      context.clearRect(0, 0, look.size, look.size)
      arc(low, high, look.track, look.thickness)
      const zone = meterSpec.perfectZone * meterSpec.accuracyWindow
      arc(meterSpec.accuracyLine - zone, meterSpec.accuracyLine + zone, look.perfect, look.thickness)
      const filled = meter.phase === 'climbing' ? meter.needle : meter.power
      if (filled > 0) arc(0, filled, look.fill, look.thickness * look.fillWidthRatio)
      tick(meterSpec.accuracyLine, look.accuracyLine, look.lineWidth, look.thickness)
      tick(meter.needle, look.needle, look.needleWidth, look.thickness * look.needleReach)
      const labels = look.labels
      const accuracy = meter.phase === 'done' ? (meter.curve === 0 ? labels.straight : meter.curve < 0 ? labels.hook : labels.slice) : meter.phase === 'returning' ? labels.accuracy : labels.power
      const power = Math.round((meter.phase === 'climbing' ? meter.needle : meter.power) * 100)
      const text = readoutText(power, accuracy)
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
