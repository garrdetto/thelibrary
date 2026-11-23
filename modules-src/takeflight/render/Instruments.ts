/**
 * Draws a light aircraft's panel onto a 2D canvas: the six primary flight instruments (airspeed with its coloured arcs,
 * attitude, three-pointer altimeter, turn coordinator with slip ball, heading indicator, vertical speed) and the engine and
 * configuration gauges the model has (tachometer, fuel, flap position, elevator trim). Static faces are drawn once into a cached
 * layer; each refresh copies it and draws only the moving parts. Reads the flight model directly.
 */
import { FOOT, FPM, KNOT, indicatedAltitude } from '../sim/Atmosphere'
import type { FlightModel } from '../sim/FlightModel'

export const PANEL_WIDTH = 2048
export const PANEL_HEIGHT = 682

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const R = 82
const COLUMNS = [270, 450, 630]
const ROWS = [205, 395]
const FACE = '#0d0f11'
const INK = '#f2f2ee'
const ALTIMETER_SETTING = 101325

interface Gauge {
  x: number
  y: number
}

const ASI: Gauge = { x: COLUMNS[0], y: ROWS[0] }
const ATT: Gauge = { x: COLUMNS[1], y: ROWS[0] }
const ALT: Gauge = { x: COLUMNS[2], y: ROWS[0] }
const TC: Gauge = { x: COLUMNS[0], y: ROWS[1] }
const HDG: Gauge = { x: COLUMNS[1], y: ROWS[1] }
const VSI: Gauge = { x: COLUMNS[2], y: ROWS[1] }
const TACH: Gauge = { x: 800, y: ROWS[0] }
const FUEL: Gauge = { x: 800, y: ROWS[1] }
const FLAPS: Gauge = { x: 100, y: ROWS[0] }
const TRIM: Gauge = { x: 100, y: ROWS[1] }

function bezel(ctx: Ctx, g: Gauge, radius = R): void {
  ctx.fillStyle = '#25282c'
  ctx.beginPath()
  ctx.arc(g.x, g.y, radius + 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = FACE
  ctx.beginPath()
  ctx.arc(g.x, g.y, radius, 0, Math.PI * 2)
  ctx.fill()
}

function ticks(ctx: Ctx, g: Gauge, from: number, to: number, count: number, length: number, width: number, radius = R): void {
  ctx.strokeStyle = INK
  ctx.lineWidth = width
  for (let i = 0; i <= count; i++) {
    const a = from + ((to - from) * i) / count
    const c = Math.cos(a)
    const s = Math.sin(a)
    ctx.beginPath()
    ctx.moveTo(g.x + c * (radius - 4), g.y + s * (radius - 4))
    ctx.lineTo(g.x + c * (radius - 4 - length), g.y + s * (radius - 4 - length))
    ctx.stroke()
  }
}

function label(ctx: Ctx, text: string, x: number, y: number, size: number, color = INK): void {
  ctx.fillStyle = color
  ctx.font = `600 ${size}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

function needle(ctx: Ctx, g: Gauge, angle: number, length: number, width: number, color = INK): void {
  ctx.save()
  ctx.translate(g.x, g.y)
  ctx.rotate(angle)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(-width, 0)
  ctx.lineTo(0, -length)
  ctx.lineTo(width, 0)
  ctx.lineTo(0, width * 2.5)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function arc(ctx: Ctx, g: Gauge, from: number, to: number, radius: number, width: number, color: string): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.arc(g.x, g.y, radius, from, to)
  ctx.stroke()
}

const ASI_MAX = 200
const asiAngle = (knots: number) => -Math.PI / 2 + (Math.min(ASI_MAX, Math.max(0, knots)) / ASI_MAX) * Math.PI * 1.75 + (knots < 40 ? 0 : 0)

export class PanelPainter {
  private readonly faces: OffscreenCanvas | HTMLCanvasElement
  private readonly facesCtx: Ctx

  constructor(private readonly aircraft: FlightModel) {
    this.faces = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(PANEL_WIDTH, PANEL_HEIGHT) : Object.assign(document.createElement('canvas'), { width: PANEL_WIDTH, height: PANEL_HEIGHT })
    this.facesCtx = this.faces.getContext('2d') as Ctx
    this.drawFaces(this.facesCtx)
  }

  private drawFaces(ctx: Ctx): void {
    const v = this.aircraft.spec.vSpeeds
    ctx.fillStyle = '#16181b'
    ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT)
    ctx.fillStyle = '#1d2024'
    ctx.fillRect(20, 20, 900, PANEL_HEIGHT - 40)
    for (const g of [ASI, ATT, ALT, TC, HDG, VSI]) bezel(ctx, g)
    for (const g of [TACH, FUEL, FLAPS, TRIM]) bezel(ctx, g, 58)
    arc(ctx, ASI, asiAngle(v.vs0) - Math.PI / 2, asiAngle(v.vfe) - Math.PI / 2, R - 18, 6, '#e8e8e8')
    arc(ctx, ASI, asiAngle(v.vs1) - Math.PI / 2, asiAngle(v.vno) - Math.PI / 2, R - 10, 6, '#2fa84f')
    arc(ctx, ASI, asiAngle(v.vno) - Math.PI / 2, asiAngle(v.vne) - Math.PI / 2, R - 10, 6, '#e0b32a')
    arc(ctx, ASI, asiAngle(v.vne) - Math.PI / 2 - 0.02, asiAngle(v.vne) - Math.PI / 2 + 0.02, R - 12, 12, '#d43a2f')
    for (let k = 40; k <= ASI_MAX; k += 10) {
      const a = asiAngle(k) - Math.PI / 2
      ticks(ctx, { x: ASI.x + 0, y: ASI.y }, a, a, 0, k % 20 === 0 ? 12 : 7, 2)
      if (k % 20 === 0) label(ctx, String(k), ASI.x + Math.cos(a) * (R - 30), ASI.y + Math.sin(a) * (R - 30), 15)
    }
    label(ctx, 'KNOTS', ASI.x, ASI.y + 30, 11)
    ticks(ctx, ALT, -Math.PI / 2, Math.PI * 1.5, 50, 6, 1.5)
    ticks(ctx, ALT, -Math.PI / 2, Math.PI * 1.5, 10, 12, 3)
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2
      label(ctx, String(i), ALT.x + Math.cos(a) * (R - 26), ALT.y + Math.sin(a) * (R - 26), 18)
    }
    label(ctx, 'ALT', ALT.x, ALT.y - 34, 11)
    for (const [fpm, text] of [[0, '0'], [500, '5'], [1000, '10'], [1500, '15'], [2000, '20'], [-500, '5'], [-1000, '10'], [-1500, '15'], [-2000, '20']] as const) {
      const a = Math.PI + (fpm / 2000) * Math.PI * 0.9
      ticks(ctx, VSI, a, a, 0, 12, 2.5)
      label(ctx, text, VSI.x + Math.cos(a) * (R - 30), VSI.y + Math.sin(a) * (R - 30), 16)
    }
    label(ctx, 'VERT SPEED', VSI.x + 18, VSI.y - 22, 10)
    label(ctx, '100 FT/MIN', VSI.x + 18, VSI.y + 22, 10)
    label(ctx, 'TURN COORDINATOR', TC.x, TC.y - 48, 9)
    label(ctx, 'L', TC.x - 62, TC.y + 26, 14)
    label(ctx, 'R', TC.x + 62, TC.y + 26, 14)
    label(ctx, '2 MIN', TC.x, TC.y + 62, 10)
    for (let rpm = 0; rpm <= 3500; rpm += 500) {
      const a = Math.PI * 0.75 + (rpm / 3500) * Math.PI * 1.5
      ticks(ctx, TACH, a, a, 0, 9, 2, 58)
      label(ctx, String(rpm / 100), TACH.x + Math.cos(a) * 36, TACH.y + Math.sin(a) * 36, 12)
    }
    const [low, high] = this.aircraft.spec.engine.rpm
    arc(ctx, TACH, Math.PI * 0.75 + (low * 1.8 / 3500) * Math.PI * 1.5, Math.PI * 0.75 + (high / 3500) * Math.PI * 1.5, 50, 5, '#2fa84f')
    label(ctx, 'RPM', TACH.x, TACH.y + 26, 10)
    label(ctx, 'FUEL', FUEL.x, FUEL.y + 26, 10)
    label(ctx, 'E', FUEL.x - 38, FUEL.y + 8, 13)
    label(ctx, 'F', FUEL.x + 38, FUEL.y + 8, 13)
    arc(ctx, FUEL, Math.PI * 1.1, Math.PI * 1.9, 48, 3, INK)
    label(ctx, 'FLAPS', FLAPS.x, FLAPS.y - 38, 10)
    const detents = this.aircraft.spec.controls.flapDetents
    const maxDetent = detents[detents.length - 1] || 1
    for (const d of detents) label(ctx, `${d}°`, FLAPS.x + 30, FLAPS.y - 22 + (d / maxDetent) * 50, 11)
    label(ctx, 'TRIM', TRIM.x, TRIM.y - 38, 10)
    label(ctx, 'NOSE DN', TRIM.x + 4, TRIM.y - 22, 8)
    label(ctx, 'NOSE UP', TRIM.x + 4, TRIM.y + 36, 8)
    label(ctx, `${this.aircraft.spec.maker.toUpperCase()} ${this.aircraft.spec.name.toUpperCase()}`, 1500, PANEL_HEIGHT - 60, 22, '#8a9097')
  }

  /** Redraws the whole panel into `ctx`. */
  paint(ctx: Ctx): void {
    const a = this.aircraft
    ctx.drawImage(this.faces as CanvasImageSource, 0, 0)
    const knots = a.ias / KNOT
    needle(ctx, ASI, asiAngle(knots), R - 14, 4)
    this.attitude(ctx)
    const feet = indicatedAltitude(a.air.pressure, ALTIMETER_SETTING) / FOOT
    needle(ctx, ALT, ((feet % 1000) / 1000) * Math.PI * 2, R - 12, 3.5)
    needle(ctx, ALT, ((feet % 10000) / 10000) * Math.PI * 2, R - 38, 5.5)
    needle(ctx, ALT, ((feet % 100000) / 100000) * Math.PI * 2, R - 6, 1.5, '#c8c8c8')
    ctx.fillStyle = '#000'
    ctx.fillRect(ALT.x + 30, ALT.y - 10, 46, 20)
    label(ctx, '29.92', ALT.x + 53, ALT.y, 12)
    const fpm = Math.max(-2000, Math.min(2000, a.verticalSpeed / FPM))
    needle(ctx, VSI, Math.PI + (fpm / 2000) * Math.PI * 0.9 - Math.PI / 2 + Math.PI, R - 14, 3.5)
    this.turnCoordinator(ctx)
    this.headingCard(ctx)
    const rpmAngle = Math.PI * 0.75 + (Math.min(3500, a.rpm) / 3500) * Math.PI * 1.5
    needle(ctx, TACH, rpmAngle + Math.PI / 2, 46, 3)
    const fuelShare = a.fuel / a.spec.mass.fuelCapacity
    needle(ctx, FUEL, Math.PI * 1.1 + fuelShare * Math.PI * 0.8 + Math.PI / 2, 44, 3)
    ctx.fillStyle = INK
    ctx.fillRect(FLAPS.x - 22, FLAPS.y - 24 + a.flap * 50, 26, 5)
    ctx.fillStyle = '#e0b32a'
    ctx.fillRect(TRIM.x - 26, TRIM.y + 8 + a.trim * -26 - 2, 30, 5)
    if (a.stall > 0.6) {
      ctx.fillStyle = '#d43a2f'
      ctx.beginPath()
      ctx.arc(ASI.x - 70, ASI.y - 70, 9, 0, Math.PI * 2)
      ctx.fill()
      label(ctx, 'STALL', ASI.x - 70, ASI.y - 52, 10, '#d43a2f')
    }
  }

  private attitude(ctx: Ctx): void {
    const a = this.aircraft
    const pxPerDeg = 3.2
    ctx.save()
    ctx.beginPath()
    ctx.arc(ATT.x, ATT.y, R, 0, Math.PI * 2)
    ctx.clip()
    ctx.translate(ATT.x, ATT.y)
    ctx.rotate((-a.bank * Math.PI) / 180)
    ctx.translate(0, a.pitch * pxPerDeg)
    ctx.fillStyle = '#2f79c4'
    ctx.fillRect(-300, -600, 600, 600)
    ctx.fillStyle = '#7a4b26'
    ctx.fillRect(-300, 0, 600, 600)
    ctx.strokeStyle = INK
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-300, 0)
    ctx.lineTo(300, 0)
    ctx.stroke()
    for (let p = -30; p <= 30; p += 5) {
      if (p === 0) continue
      const w = p % 10 === 0 ? 34 : 16
      ctx.beginPath()
      ctx.moveTo(-w, -p * pxPerDeg)
      ctx.lineTo(w, -p * pxPerDeg)
      ctx.stroke()
      if (p % 10 === 0) {
        label(ctx, String(Math.abs(p)), -w - 14, -p * pxPerDeg, 11)
        label(ctx, String(Math.abs(p)), w + 14, -p * pxPerDeg, 11)
      }
    }
    ctx.restore()
    ctx.save()
    ctx.translate(ATT.x, ATT.y)
    ctx.rotate((-a.bank * Math.PI) / 180)
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.moveTo(0, -R + 4)
    ctx.lineTo(-7, -R + 16)
    ctx.lineTo(7, -R + 16)
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = INK
    ctx.lineWidth = 2
    for (const bank of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const ang = ((bank - 90) * Math.PI) / 180
      const inner = bank % 30 === 0 ? R - 16 : R - 10
      ctx.beginPath()
      ctx.moveTo(ATT.x + Math.cos(ang) * R, ATT.y + Math.sin(ang) * R)
      ctx.lineTo(ATT.x + Math.cos(ang) * inner, ATT.y + Math.sin(ang) * inner)
      ctx.stroke()
    }
    ctx.strokeStyle = '#f0a020'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(ATT.x - 44, ATT.y)
    ctx.lineTo(ATT.x - 14, ATT.y)
    ctx.lineTo(ATT.x - 6, ATT.y + 8)
    ctx.moveTo(ATT.x + 44, ATT.y)
    ctx.lineTo(ATT.x + 14, ATT.y)
    ctx.lineTo(ATT.x + 6, ATT.y + 8)
    ctx.stroke()
    ctx.fillStyle = '#f0a020'
    ctx.beginPath()
    ctx.arc(ATT.x, ATT.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  private turnCoordinator(ctx: Ctx): void {
    const a = this.aircraft
    const standard = 3
    const tilt = Math.max(-1.6, Math.min(1.6, a.turnRate / standard)) * (20 * Math.PI / 180)
    ctx.strokeStyle = INK
    ctx.lineWidth = 3
    for (const side of [-1, 1]) {
      const ang = side * (20 * Math.PI) / 180
      ctx.beginPath()
      ctx.moveTo(TC.x + Math.cos(ang) * 60 * side, TC.y + Math.sin(ang) * 60 * side + 6)
      ctx.lineTo(TC.x + Math.cos(ang) * 74 * side, TC.y + Math.sin(ang) * 74 * side + 6)
      ctx.stroke()
    }
    ctx.save()
    ctx.translate(TC.x, TC.y)
    ctx.rotate(tilt)
    ctx.fillStyle = INK
    ctx.fillRect(-56, -3, 112, 6)
    ctx.beginPath()
    ctx.arc(0, 0, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(-2, -18, 4, 14)
    ctx.restore()
    ctx.fillStyle = '#2a2d31'
    ctx.beginPath()
    ctx.ellipse(TC.x, TC.y + 38, 40, 9, 0, 0, Math.PI * 2)
    ctx.fill()
    const ball = Math.max(-1, Math.min(1, -a.lateralG / 0.12)) * 32
    ctx.fillStyle = '#050505'
    ctx.beginPath()
    ctx.arc(TC.x + ball, TC.y + 38, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(TC.x - 9, TC.y + 29)
    ctx.lineTo(TC.x - 9, TC.y + 47)
    ctx.moveTo(TC.x + 9, TC.y + 29)
    ctx.lineTo(TC.x + 9, TC.y + 47)
    ctx.stroke()
  }

  private headingCard(ctx: Ctx): void {
    const heading = this.aircraft.heading
    ctx.save()
    ctx.translate(HDG.x, HDG.y)
    ctx.rotate((-heading * Math.PI) / 180)
    ctx.strokeStyle = INK
    for (let d = 0; d < 360; d += 5) {
      const ang = ((d - 90) * Math.PI) / 180
      const long = d % 30 === 0 ? 14 : d % 10 === 0 ? 9 : 5
      ctx.lineWidth = d % 10 === 0 ? 2 : 1
      ctx.beginPath()
      ctx.moveTo(Math.cos(ang) * (R - 4), Math.sin(ang) * (R - 4))
      ctx.lineTo(Math.cos(ang) * (R - 4 - long), Math.sin(ang) * (R - 4 - long))
      ctx.stroke()
      if (d % 30 === 0) {
        ctx.save()
        ctx.rotate((d * Math.PI) / 180)
        const text = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10)
        label(ctx, text, 0, -(R - 30), 15)
        ctx.restore()
      }
    }
    ctx.restore()
    ctx.strokeStyle = '#f0a020'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(HDG.x, HDG.y - 30)
    ctx.lineTo(HDG.x, HDG.y + 28)
    ctx.moveTo(HDG.x - 24, HDG.y - 6)
    ctx.lineTo(HDG.x + 24, HDG.y - 6)
    ctx.moveTo(HDG.x - 10, HDG.y + 22)
    ctx.lineTo(HDG.x + 10, HDG.y + 22)
    ctx.stroke()
    ctx.fillStyle = '#f0a020'
    ctx.beginPath()
    ctx.moveTo(HDG.x, HDG.y - R + 2)
    ctx.lineTo(HDG.x - 6, HDG.y - R - 8)
    ctx.lineTo(HDG.x + 6, HDG.y - R - 8)
    ctx.fill()
  }
}
