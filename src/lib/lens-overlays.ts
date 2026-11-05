import { distance, eyeCenters, faceFrame, landmarks, midpoint, toFaceSpace } from '@/lib/lens-geometry'
import type { FaceFrame, Point } from '@/lib/lens-geometry'
import type { HairStyle, LensSettings } from '@/lib/lens-types'

type Ctx = CanvasRenderingContext2D
type HairShape = { back: Path2D[]; front: Path2D[]; top: number; bottom: number; texture: 'strands' | 'curls' | 'stubble'; backAlpha?: number }

function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = state + 0x6d2b79f5 >>> 0
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

function shade(hex: string, amount: number, alpha = 1) {
  const value = Number.parseInt(hex.slice(1), 16)
  const channel = (shift: number) => {
    const base = value >> shift & 255
    return Math.round(amount >= 0 ? base + (255 - base) * amount : base * (1 + amount))
  }
  return `rgba(${channel(16)}, ${channel(8)}, ${channel(0)}, ${alpha})`
}

function polygon(points: Point[], indices: readonly number[], path = new Path2D()) {
  indices.forEach((index, order) => order ? path.lineTo(points[index].x, points[index].y) : path.moveTo(points[index].x, points[index].y))
  path.closePath()
  return path
}

function polyline(ctx: Ctx, points: Point[], indices: readonly number[]) {
  ctx.beginPath()
  indices.forEach((index, order) => order ? ctx.lineTo(points[index].x, points[index].y) : ctx.moveTo(points[index].x, points[index].y))
}

function enterFace(ctx: Ctx, frame: FaceFrame) {
  ctx.transform(frame.across.x * frame.width, frame.across.y * frame.width, frame.down.x * frame.width, frame.down.y * frame.width, frame.origin.x, frame.origin.y)
}

function circles(list: [number, number, number][]) {
  const path = new Path2D()
  for (const [x, y, radius] of list) { path.moveTo(x + radius, y); path.arc(x, y, radius, 0, Math.PI * 2) }
  return path
}

const capPath = 'M -0.58 0.3 C -0.68 -0.25 -0.4 -0.56 0 -0.56 C 0.4 -0.56 0.68 -0.25 0.58 0.3 L 0.3 0.4 L -0.3 0.4 Z'
const buzzPath = 'M -0.53 0.3 C -0.62 -0.2 -0.36 -0.5 0 -0.5 C 0.36 -0.5 0.62 -0.2 0.53 0.3 L 0.47 0.32 C 0.47 0.06 0.3 -0.02 0 0 C -0.3 -0.02 -0.47 0.06 -0.47 0.32 Z'

function hairShape(style: HairStyle): HairShape | null {
  switch (style) {
    case 'long': return {
      back: [new Path2D('M -0.62 0.3 C -0.72 -0.25 -0.4 -0.6 0 -0.6 C 0.4 -0.6 0.72 -0.25 0.62 0.3 C 0.7 0.8 0.62 1.2 0.76 1.6 C 0.84 1.85 0.72 1.95 0.66 2 L 0.6 1.9 L 0.54 2.02 L 0.48 1.88 L 0.42 1.98 L 0.36 1.85 C 0.42 1.4 0.36 0.85 0.28 0.45 L -0.28 0.45 C -0.36 0.85 -0.42 1.4 -0.36 1.85 L -0.42 1.98 L -0.48 1.88 L -0.54 2.02 L -0.6 1.9 L -0.66 2 C -0.72 1.95 -0.84 1.85 -0.76 1.6 C -0.62 1.2 -0.7 0.8 -0.62 0.3 Z')],
      front: [new Path2D('M -0.5 0.05 C -0.48 -0.3 -0.1 -0.42 0.3 -0.36 C 0.48 -0.32 0.56 -0.18 0.55 0 C 0.42 -0.14 0.2 -0.18 0.02 -0.12 C -0.18 -0.06 -0.36 0 -0.5 0.05 Z')],
      top: -0.6, bottom: 2.05, texture: 'strands',
    }
    case 'bob': return {
      back: [new Path2D('M -0.6 0.3 C -0.7 -0.25 -0.4 -0.57 0 -0.57 C 0.4 -0.57 0.7 -0.25 0.6 0.3 L 0.64 1.02 Q 0.5 1.1 0.34 1.02 L 0.3 0.45 L -0.3 0.45 L -0.34 1.02 Q -0.5 1.1 -0.64 1.02 Z')],
      front: [new Path2D('M -0.54 0.08 C -0.56 -0.42 0.56 -0.42 0.54 0.08 L 0.42 0.2 L 0.3 0.15 L 0.18 0.22 L 0.06 0.16 L -0.06 0.22 L -0.18 0.16 L -0.3 0.22 L -0.42 0.15 Z')],
      top: -0.6, bottom: 1.1, texture: 'strands',
    }
    case 'curly': {
      const ring: [number, number, number][] = [[0, 0.08, 0.72]]
      for (let index = 0; index < 22; index++) {
        const angle = index / 22 * Math.PI * 2
        ring.push([Math.cos(angle) * 0.68, 0.12 + Math.sin(angle) * (Math.sin(angle) < 0 ? 0.68 : 0.62), 0.22 + (index % 3) * 0.025])
      }
      const fringe: [number, number, number][] = []
      for (let x = -0.42; x <= 0.43; x += 0.12) fringe.push([x, -0.02 + Math.abs(x) * 0.12, 0.075])
      return { back: [circles(ring)], front: [circles(fringe)], top: -0.85, bottom: 1.0, texture: 'curls' }
    }
    case 'buzz': return { back: [new Path2D(buzzPath)], front: [], top: -0.52, bottom: 0.35, texture: 'stubble', backAlpha: 0.82 }
    case 'mohawk': return {
      back: [new Path2D(buzzPath)],
      front: [new Path2D('M -0.14 0.02 L -0.22 -0.52 L -0.11 -0.48 L -0.14 -0.86 L -0.03 -0.62 L 0 -1.02 L 0.04 -0.62 L 0.14 -0.86 L 0.11 -0.48 L 0.22 -0.52 L 0.14 0.02 Z')],
      top: -1.05, bottom: 0.35, texture: 'strands', backAlpha: 0.3,
    }
    case 'buns': return { back: [new Path2D(capPath), circles([[-0.42, -0.52, 0.22], [0.42, -0.52, 0.22]])], front: [], top: -0.75, bottom: 0.4, texture: 'strands' }
    case 'braids': {
      const links: [number, number, number][] = []
      for (let step = 0; step < 13; step++) {
        const y = 0.35 + step * 0.115
        const sway = step % 2 ? 0.03 : -0.03
        links.push([-0.62 + step * 0.006 + sway, y, 0.1 - step * 0.002], [0.62 - step * 0.006 - sway, y, 0.1 - step * 0.002])
      }
      return { back: [new Path2D(capPath), circles(links)], front: [new Path2D('M -0.5 0.05 C -0.45 -0.3 -0.05 -0.4 -0.02 -0.05 C -0.15 -0.15 -0.35 -0.08 -0.5 0.05 Z M 0.5 0.05 C 0.45 -0.3 0.05 -0.4 0.02 -0.05 C 0.15 -0.15 0.35 -0.08 0.5 0.05 Z')], top: -0.6, bottom: 1.9, texture: 'strands' }
    }
    case 'pompadour': return {
      back: [new Path2D('M -0.55 0.3 C -0.62 -0.15 -0.36 -0.48 0 -0.5 C 0.36 -0.48 0.62 -0.15 0.55 0.3 L 0.3 0.4 L -0.3 0.4 Z')],
      front: [new Path2D('M -0.48 0.04 C -0.62 -0.45 -0.1 -0.86 0.38 -0.7 C 0.62 -0.6 0.62 -0.3 0.5 -0.06 C 0.42 0.02 0.3 -0.12 0.1 -0.08 C -0.12 -0.06 -0.3 -0.04 -0.48 0.04 Z')],
      top: -0.85, bottom: 0.4, texture: 'strands',
    }
    default: return null
  }
}

function paintHair(ctx: Ctx, path: Path2D, shape: HairShape, hair: LensSettings['hair'], seed: number, alpha = 1) {
  const gradient = ctx.createLinearGradient(0, shape.top, 0, shape.bottom)
  gradient.addColorStop(0, shade(hair.color, 0.18, alpha))
  gradient.addColorStop(0.45, shade(hair.color, 0, alpha))
  gradient.addColorStop(1, hair.ombre ? shade(hair.tipColor, 0, alpha) : shade(hair.color, -0.25, alpha))
  ctx.fillStyle = gradient
  ctx.fill(path)
  ctx.save()
  ctx.clip(path)
  const random = seeded(seed)
  if (shape.texture === 'curls') {
    for (let index = 0; index < 140; index++) {
      const x = -0.95 + random() * 1.9
      const y = shape.top + random() * (shape.bottom - shape.top)
      ctx.strokeStyle = random() > 0.5 ? shade(hair.color, -0.45, 0.45 * alpha) : shade(hair.color, 0.35, 0.35 * alpha)
      ctx.lineWidth = 0.012
      ctx.beginPath()
      ctx.arc(x, y, 0.025 + random() * 0.035, random() * 6, random() * 6 + 4)
      ctx.stroke()
    }
  } else if (shape.texture === 'stubble') {
    for (let index = 0; index < 900; index++) {
      ctx.fillStyle = shade(hair.color, random() > 0.5 ? -0.5 : 0.2, 0.5 * alpha)
      ctx.fillRect(-0.7 + random() * 1.4, shape.top + random() * (shape.bottom - shape.top), 0.008, 0.008)
    }
  } else {
    for (let index = 0; index < 110; index++) {
      const x = -0.9 + random() * 1.8
      const bend = (random() - 0.5) * 0.35
      ctx.strokeStyle = random() > 0.45 ? shade(hair.color, -0.4, 0.35 * alpha) : shade(hair.ombre ? hair.tipColor : hair.color, 0.4, 0.28 * alpha)
      ctx.lineWidth = 0.005 + random() * 0.008
      const span = shape.bottom - shape.top
      const wave = 0.03 + random() * 0.04
      ctx.beginPath()
      ctx.moveTo(x * 0.6, shape.top)
      ctx.bezierCurveTo(x + bend - wave, shape.top + span * 0.35, x + bend + wave, shape.top + span * 0.65, x + bend * 0.4, shape.bottom)
      ctx.stroke()
    }
  }
  const sheen = ctx.createRadialGradient(-0.15, shape.top + 0.25, 0, -0.15, shape.top + 0.25, 0.5)
  sheen.addColorStop(0, `rgba(255,255,255,${0.22 * alpha})`)
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fill(path)
  ctx.restore()
  ctx.strokeStyle = shade(hair.color, -0.55, 0.35 * alpha)
  ctx.lineWidth = 0.008
  ctx.stroke(path)
}

export function drawHair(ctx: Ctx, layer: HTMLCanvasElement, points: Point[], hair: LensSettings['hair']) {
  const shape = hairShape(hair.style)
  if (!shape) return
  const frame = faceFrame(points)
  if (layer.width !== ctx.canvas.width || layer.height !== ctx.canvas.height) { layer.width = ctx.canvas.width; layer.height = ctx.canvas.height }
  const hairCtx = layer.getContext('2d')
  if (!hairCtx) return
  hairCtx.setTransform(1, 0, 0, 1, 0, 0)
  hairCtx.clearRect(0, 0, layer.width, layer.height)
  hairCtx.save()
  enterFace(hairCtx, frame)
  shape.back.forEach((path, index) => paintHair(hairCtx, path, shape, hair, 11 + index, shape.backAlpha))
  hairCtx.restore()
  hairCtx.save()
  hairCtx.globalCompositeOperation = 'destination-out'
  hairCtx.filter = `blur(${Math.max(1, frame.width * 0.012)}px)`
  hairCtx.fill(polygon(points, landmarks.faceOval))
  hairCtx.restore()
  hairCtx.save()
  enterFace(hairCtx, frame)
  shape.front.forEach((path, index) => paintHair(hairCtx, path, shape, hair, 41 + index))
  hairCtx.restore()
  ctx.drawImage(layer, 0, 0)
}

export function drawFaceMask(mask: HTMLCanvasElement, points: Point[] | null, width: number, height: number, active: boolean) {
  if (mask.width !== width || mask.height !== height) { mask.width = width; mask.height = height }
  const ctx = mask.getContext('2d')
  if (!ctx) return
  ctx.filter = 'none'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  if (!points || !active) return
  const faceWidth = distance(points[landmarks.leftEdge], points[landmarks.rightEdge])
  ctx.filter = `blur(${Math.max(2, faceWidth * 0.035)}px)`
  ctx.fillStyle = '#fff'
  ctx.fill(polygon(points, landmarks.faceOval))
  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'
  ctx.lineWidth = faceWidth * 0.05
  for (const feature of [landmarks.leftEye, landmarks.rightEye, landmarks.lipsOuter, landmarks.leftBrow, landmarks.rightBrow]) {
    const path = polygon(points, feature)
    ctx.fill(path)
    ctx.stroke(path)
  }
  ctx.filter = 'none'
}

function irisRadius(points: Point[], center: number, ring: readonly number[]) {
  return ring.reduce((total, index) => total + distance(points[center], points[index]), 0) / ring.length
}

export function drawMakeup(ctx: Ctx, points: Point[], makeup: LensSettings['makeup']) {
  const width = distance(points[landmarks.leftEdge], points[landmarks.rightEdge])
  ctx.save()
  if (makeup.shadow > 0) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.filter = `blur(${width * 0.02}px)`
    ctx.fillStyle = shade(makeup.shadowColor, 0, makeup.shadow * 0.55)
    const sides = [
      { lid: [...landmarks.leftUpperLid], brow: [...landmarks.leftBrowLine] },
      { lid: [...landmarks.rightUpperLid].reverse(), brow: [...landmarks.rightBrowLine] },
    ]
    for (const { lid, brow } of sides) {
      const crease = brow.map((index, order) => midpoint(points[index], points[lid[Math.round(order / (brow.length - 1) * (lid.length - 1))]]))
      const path = new Path2D()
      lid.forEach((index, order) => order ? path.lineTo(points[index].x, points[index].y) : path.moveTo(points[index].x, points[index].y))
      crease.reverse().forEach(point => path.lineTo(point.x, point.y))
      path.closePath()
      ctx.fill(path)
    }
  }
  if (makeup.blush > 0) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.filter = 'none'
    for (const cheek of [landmarks.leftCheek, landmarks.rightCheek]) {
      const point = points[cheek]
      const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, width * 0.16)
      gradient.addColorStop(0, shade(makeup.blushColor, 0, makeup.blush * 0.5))
      gradient.addColorStop(1, shade(makeup.blushColor, 0, 0))
      ctx.fillStyle = gradient
      ctx.fillRect(point.x - width * 0.2, point.y - width * 0.2, width * 0.4, width * 0.4)
    }
  }
  if (makeup.brows > 0) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.filter = `blur(${width * 0.006}px)`
    ctx.fillStyle = `rgba(45, 28, 20, ${makeup.brows * 0.55})`
    for (const brow of [landmarks.leftBrow, landmarks.rightBrow]) ctx.fill(polygon(points, [...brow.slice(0, 5), ...brow.slice(5).reverse()]))
  }
  if (makeup.iris > 0) {
    ctx.filter = 'none'
    for (const [eye, center, ring] of [[landmarks.leftEye, landmarks.leftIris, landmarks.leftIrisRing], [landmarks.rightEye, landmarks.rightIris, landmarks.rightIrisRing]] as const) {
      if (!points[center]) continue
      ctx.save()
      ctx.clip(polygon(points, eye))
      ctx.beginPath()
      ctx.arc(points[center].x, points[center].y, irisRadius(points, center, ring) * 1.05, 0, Math.PI * 2)
      ctx.globalCompositeOperation = 'color'
      ctx.fillStyle = shade(makeup.irisColor, 0, makeup.iris * 0.85)
      ctx.fill()
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = shade(makeup.irisColor, 0, makeup.iris * 0.3)
      ctx.fill()
      ctx.restore()
    }
  }
  if (makeup.liner > 0) {
    ctx.globalCompositeOperation = 'source-over'
    ctx.filter = 'none'
    ctx.strokeStyle = `rgba(14, 10, 12, ${0.35 + makeup.liner * 0.6})`
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = width * (0.006 + makeup.liner * 0.01)
    for (const lid of [landmarks.leftUpperLid, landmarks.rightUpperLid]) {
      polyline(ctx, points, lid)
      const outer = points[lid === landmarks.leftUpperLid ? lid[0] : lid[lid.length - 1]]
      const inner = points[lid === landmarks.leftUpperLid ? lid[lid.length - 1] : lid[0]]
      const span = distance(outer, inner) || 1
      const wing = makeup.liner * 0.35
      const tip = { x: outer.x + (outer.x - inner.x) / span * span * wing, y: outer.y + (outer.y - inner.y) / span * span * wing - span * wing * 0.45 }
      ctx.moveTo(outer.x, outer.y)
      ctx.lineTo(tip.x, tip.y)
      ctx.stroke()
    }
  }
  if (makeup.lip > 0) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.filter = `blur(${width * 0.004}px)`
    const lips = polygon(points, landmarks.lipsOuter)
    polygon(points, [...landmarks.lipsInner].reverse(), lips)
    ctx.fillStyle = shade(makeup.lipColor, 0, makeup.lip * 0.75)
    ctx.fill(lips, 'evenodd')
    ctx.globalCompositeOperation = 'soft-light'
    ctx.fillStyle = shade(makeup.lipColor, 0.2, makeup.lip * 0.5)
    ctx.fill(lips, 'evenodd')
  }
  ctx.restore()
}

function heart(ctx: Ctx, x: number, y: number, size: number) {
  ctx.beginPath()
  ctx.moveTo(x, y + size * 0.35)
  ctx.bezierCurveTo(x - size * 1.1, y - size * 0.35, x - size * 0.45, y - size * 1.05, x, y - size * 0.45)
  ctx.bezierCurveTo(x + size * 0.45, y - size * 1.05, x + size * 1.1, y - size * 0.35, x, y + size * 0.35)
  ctx.closePath()
}

function star(ctx: Ctx, x: number, y: number, outer: number, inner: number, spikes = 5, rotation = -Math.PI / 2) {
  ctx.beginPath()
  for (let index = 0; index < spikes * 2; index++) {
    const radius = index % 2 ? inner : outer
    const angle = rotation + index * Math.PI / spikes
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
  }
  ctx.closePath()
}

function drawEyewear(ctx: Ctx, kind: LensSettings['extras']['eyewear'], left: Point, right: Point) {
  if (kind === 'none') return
  const pairs = [left, right]
  ctx.lineJoin = 'round'
  if (kind === 'shades') {
    ctx.strokeStyle = '#0b0b0b'
    ctx.lineWidth = 0.025
    ctx.beginPath(); ctx.moveTo(left.x + 0.17, left.y - 0.04); ctx.quadraticCurveTo((left.x + right.x) / 2, left.y - 0.09, right.x - 0.17, right.y - 0.04); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(left.x - 0.19, left.y - 0.05); ctx.lineTo(-0.56, left.y - 0.06); ctx.moveTo(right.x + 0.19, right.y - 0.05); ctx.lineTo(0.56, right.y - 0.06); ctx.stroke()
    for (const eye of pairs) {
      const gradient = ctx.createLinearGradient(0, eye.y - 0.12, 0, eye.y + 0.14)
      gradient.addColorStop(0, 'rgba(20,20,24,.95)'); gradient.addColorStop(1, 'rgba(60,60,70,.92)')
      ctx.fillStyle = gradient
      ctx.beginPath(); ctx.roundRect(eye.x - 0.19, eye.y - 0.11, 0.38, 0.25, 0.08); ctx.fill(); ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 0.018
      ctx.beginPath(); ctx.moveTo(eye.x - 0.11, eye.y - 0.06); ctx.lineTo(eye.x - 0.02, eye.y - 0.06); ctx.stroke()
      ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = 0.025
    }
  } else if (kind === 'hearts') {
    for (const eye of pairs) {
      heart(ctx, eye.x, eye.y + 0.04, 0.2)
      ctx.fillStyle = 'rgba(255, 64, 129, .82)'; ctx.fill()
      ctx.strokeStyle = '#c2185b'; ctx.lineWidth = 0.025; ctx.stroke()
    }
    ctx.beginPath(); ctx.moveTo(left.x + 0.15, left.y - 0.06); ctx.lineTo(right.x - 0.15, right.y - 0.06); ctx.stroke()
  } else if (kind === 'round') {
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 0.022
    for (const eye of pairs) {
      ctx.beginPath(); ctx.arc(eye.x, eye.y, 0.16, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill(); ctx.stroke()
    }
    ctx.beginPath(); ctx.moveTo(left.x + 0.16, left.y - 0.02); ctx.quadraticCurveTo((left.x + right.x) / 2, left.y - 0.08, right.x - 0.16, right.y - 0.02)
    ctx.moveTo(left.x - 0.16, left.y); ctx.lineTo(-0.56, left.y - 0.03); ctx.moveTo(right.x + 0.16, right.y); ctx.lineTo(0.56, right.y - 0.03); ctx.stroke()
  } else if (kind === 'star') {
    for (const eye of pairs) {
      star(ctx, eye.x, eye.y + 0.01, 0.22, 0.1)
      ctx.fillStyle = 'rgba(156, 39, 176, .82)'; ctx.fill()
      ctx.strokeStyle = '#f8e71c'; ctx.lineWidth = 0.02; ctx.stroke()
    }
    ctx.beginPath(); ctx.moveTo(left.x + 0.12, left.y - 0.03); ctx.lineTo(right.x - 0.12, right.y - 0.03); ctx.stroke()
  }
}

function drawHeadwear(ctx: Ctx, kind: LensSettings['extras']['headwear'], time: number) {
  if (kind === 'none') return
  if (kind === 'crown') {
    const gradient = ctx.createLinearGradient(0, -0.9, 0, -0.42)
    gradient.addColorStop(0, '#fff2a8'); gradient.addColorStop(0.5, '#f5c518'); gradient.addColorStop(1, '#b8860b')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(-0.34, -0.42); ctx.lineTo(-0.38, -0.8); ctx.lineTo(-0.2, -0.62); ctx.lineTo(0, -0.92); ctx.lineTo(0.2, -0.62); ctx.lineTo(0.38, -0.8); ctx.lineTo(0.34, -0.42); ctx.closePath()
    ctx.fill(); ctx.strokeStyle = '#8a6508'; ctx.lineWidth = 0.012; ctx.stroke()
    for (const [x, y, gem] of [[-0.2, -0.5, '#e53935'], [0, -0.52, '#1e88e5'], [0.2, -0.5, '#43a047'], [0, -0.92, '#fff'], [-0.38, -0.8, '#fff'], [0.38, -0.8, '#fff']] as const) {
      ctx.beginPath(); ctx.arc(x, y, 0.035, 0, Math.PI * 2); ctx.fillStyle = gem; ctx.fill()
    }
  } else if (kind === 'flowers') {
    const palette = ['#ff8fab', '#ffd166', '#c77dff', '#80ed99', '#ff6b6b']
    for (let index = 0; index < 11; index++) {
      const angle = Math.PI * (1.08 + index * 0.084)
      const x = Math.cos(angle) * 0.6
      const y = 0.08 + Math.sin(angle) * 0.56
      ctx.fillStyle = palette[index % palette.length]
      for (let petal = 0; petal < 5; petal++) {
        const turn = petal / 5 * Math.PI * 2 + index
        ctx.beginPath(); ctx.arc(x + Math.cos(turn) * 0.045, y + Math.sin(turn) * 0.045, 0.042, 0, Math.PI * 2); ctx.fill()
      }
      ctx.beginPath(); ctx.arc(x, y, 0.028, 0, Math.PI * 2); ctx.fillStyle = '#fff3b0'; ctx.fill()
      if (index < 10) { ctx.fillStyle = '#5fa85f'; ctx.beginPath(); ctx.ellipse(x + 0.05, y + 0.03, 0.04, 0.018, angle, 0, Math.PI * 2); ctx.fill() }
    }
  } else if (kind === 'halo') {
    ctx.save()
    ctx.shadowColor = '#fff3a0'; ctx.shadowBlur = 25
    ctx.strokeStyle = `rgba(255, 215, 64, ${0.8 + Math.sin(time * 3) * 0.15})`; ctx.lineWidth = 0.055
    ctx.beginPath(); ctx.ellipse(0, -0.8 + Math.sin(time * 2) * 0.02, 0.36, 0.09, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  } else if (kind === 'horns') {
    for (const side of [-1, 1]) {
      const gradient = ctx.createLinearGradient(side * 0.25, -0.4, side * 0.45, -0.85)
      gradient.addColorStop(0, '#7f0000'); gradient.addColorStop(1, '#ff1744')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.moveTo(side * 0.14, -0.44)
      ctx.quadraticCurveTo(side * 0.22, -0.75, side * 0.45, -0.88)
      ctx.quadraticCurveTo(side * 0.36, -0.66, side * 0.36, -0.4)
      ctx.closePath(); ctx.fill()
    }
  } else if (kind === 'dog') {
    for (const side of [-1, 1]) {
      ctx.save()
      ctx.translate(side * 0.6, -0.22)
      ctx.rotate(side * (0.35 + Math.sin(time * 4) * 0.04))
      ctx.fillStyle = '#7b4a2a'; ctx.beginPath(); ctx.ellipse(0, 0.12, 0.19, 0.42, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#5a321b'; ctx.beginPath(); ctx.ellipse(0, 0.16, 0.11, 0.32, 0, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
  } else if (kind === 'cat' || kind === 'bunny') {
    const outer = kind === 'cat' ? '#2b2b2b' : '#f5f5f5'
    for (const side of [-1, 1]) {
      ctx.fillStyle = outer
      ctx.beginPath()
      if (kind === 'cat') { ctx.moveTo(side * 0.16, -0.48); ctx.lineTo(side * 0.36, -0.86); ctx.lineTo(side * 0.52, -0.36); ctx.closePath() }
      else ctx.ellipse(side * 0.2, -0.85, 0.11, 0.4, side * 0.12, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ff9eb5'
      ctx.beginPath()
      if (kind === 'cat') { ctx.moveTo(side * 0.24, -0.5); ctx.lineTo(side * 0.36, -0.74); ctx.lineTo(side * 0.45, -0.43); ctx.closePath() }
      else ctx.ellipse(side * 0.2, -0.85, 0.055, 0.3, side * 0.12, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawEffects(ctx: Ctx, effects: LensSettings['extras']['effects'], parts: { nose: Point; mouth: Point; left: Point; right: Point; mouthOpen: number }, time: number) {
  const { nose, mouth, left, right, mouthOpen } = parts
  if (effects.includes('freckles')) {
    const random = seeded(7)
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    for (let index = 0; index < 46; index++) {
      const x = (random() - 0.5) * 0.66
      if (Math.abs(x) < 0.07) continue
      ctx.fillStyle = `rgba(120, 70, 40, ${0.35 + random() * 0.25})`
      ctx.beginPath(); ctx.arc(x, nose.y - 0.12 + random() * 0.12 + Math.abs(x) * 0.15, 0.006 + random() * 0.007, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }
  if (effects.includes('whiskers')) {
    ctx.strokeStyle = 'rgba(20,20,20,.75)'; ctx.lineWidth = 0.008; ctx.lineCap = 'round'
    for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
      ctx.beginPath()
      ctx.moveTo(nose.x + side * 0.12, nose.y + 0.04 + row * 0.035)
      ctx.quadraticCurveTo(nose.x + side * 0.35, nose.y + row * 0.05 - 0.02, nose.x + side * 0.56, nose.y + (row - 1) * 0.09)
      ctx.stroke()
    }
    if (!effects.includes('dogNose')) {
      ctx.fillStyle = '#ff7fa0'
      ctx.beginPath(); ctx.moveTo(nose.x - 0.05, nose.y - 0.02); ctx.lineTo(nose.x + 0.05, nose.y - 0.02); ctx.lineTo(nose.x, nose.y + 0.035); ctx.closePath(); ctx.fill()
    }
  }
  if (effects.includes('dogNose')) {
    if (mouthOpen > 0.06) {
      const length = 0.12 + Math.min(mouthOpen, 0.25) * 1.2
      const wiggle = Math.sin(time * 9) * 0.015
      ctx.fillStyle = '#ff6f91'
      ctx.beginPath()
      ctx.moveTo(mouth.x - 0.09, mouth.y)
      ctx.quadraticCurveTo(mouth.x - 0.1 + wiggle, mouth.y + length, mouth.x + wiggle, mouth.y + length)
      ctx.quadraticCurveTo(mouth.x + 0.1 + wiggle, mouth.y + length, mouth.x + 0.09, mouth.y)
      ctx.closePath(); ctx.fill()
      ctx.strokeStyle = '#d94673'; ctx.lineWidth = 0.008
      ctx.beginPath(); ctx.moveTo(mouth.x, mouth.y + 0.02); ctx.lineTo(mouth.x + wiggle, mouth.y + length * 0.7); ctx.stroke()
    }
    const gradient = ctx.createRadialGradient(nose.x - 0.03, nose.y - 0.04, 0.005, nose.x, nose.y - 0.01, 0.12)
    gradient.addColorStop(0, '#666'); gradient.addColorStop(0.3, '#1a1a1a'); gradient.addColorStop(1, '#000')
    ctx.fillStyle = gradient
    ctx.beginPath(); ctx.ellipse(nose.x, nose.y - 0.015, 0.1, 0.07, 0, 0, Math.PI * 2); ctx.fill()
  }
  if (effects.includes('tears')) {
    const palette = ['#ff8fab', '#a0e7ff', '#fff3a0', '#c9b6ff']
    for (const eye of [left, right]) for (let index = 0; index < 9; index++) {
      const progress = (index / 9 + time * 0.25) % 1
      ctx.globalAlpha = Math.sin(progress * Math.PI)
      ctx.fillStyle = palette[index % palette.length]
      star(ctx, eye.x + Math.sin(progress * 6 + index) * 0.015, eye.y + 0.08 + progress * 0.4, 0.022, 0.008, 4, time * 2 + index)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  if (effects.includes('sparkles')) {
    const random = seeded(23)
    ctx.save()
    ctx.shadowColor = '#fff7c2'; ctx.shadowBlur = 12
    for (let index = 0; index < 16; index++) {
      const base = random() * Math.PI * 2
      const radius = 0.72 + random() * 0.3
      const angle = base + time * (0.2 + random() * 0.25)
      const pulse = 0.5 + Math.sin(time * 4 + index) * 0.5
      ctx.fillStyle = index % 3 ? `rgba(255,255,255,${0.5 + pulse * 0.5})` : `rgba(255,214,102,${0.5 + pulse * 0.5})`
      star(ctx, Math.cos(angle) * radius, 0.35 + Math.sin(angle) * radius * 1.05, 0.02 + pulse * 0.03, 0.007, 4, time)
      ctx.fill()
    }
    ctx.restore()
  }
  if (effects.includes('hearts')) {
    const random = seeded(31)
    for (let index = 0; index < 10; index++) {
      const lane = (random() - 0.5) * 1.9
      const offset = random()
      const progress = (time * 0.18 + offset) % 1
      ctx.globalAlpha = Math.sin(progress * Math.PI) * 0.9
      heart(ctx, lane + Math.sin(time * 2 + index) * 0.05, 1.5 - progress * 2.4, 0.05 + random() * 0.05)
      ctx.fillStyle = index % 2 ? '#ff4d8d' : '#ff8fb8'
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}

export function drawAccessories(ctx: Ctx, points: Point[], extras: LensSettings['extras'], time: number) {
  if (extras.eyewear === 'none' && extras.headwear === 'none' && !extras.effects.length) return
  const frame = faceFrame(points)
  const eyes = eyeCenters(points)
  const parts = {
    left: toFaceSpace(frame, eyes.left),
    right: toFaceSpace(frame, eyes.right),
    nose: toFaceSpace(frame, points[landmarks.noseTip]),
    mouth: toFaceSpace(frame, points[landmarks.lowerLip]),
    mouthOpen: distance(points[landmarks.upperLip], points[landmarks.lowerLip]) / frame.width,
  }
  ctx.save()
  enterFace(ctx, frame)
  drawHeadwear(ctx, extras.headwear, time)
  drawEffects(ctx, extras.effects, parts, time)
  drawEyewear(ctx, extras.eyewear, parts.left, parts.right)
  ctx.restore()
}
