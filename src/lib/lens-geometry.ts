import type { LensSettings } from '@/lib/lens-types'

export type Point = { x: number; y: number }

export type FaceWarp = { x: number; y: number; radius: number; strength: number; shiftX: number; shiftY: number }

export type FaceFrame = { origin: Point; across: Point; down: Point; width: number }

export const maxWarps = 10

export const landmarks = {
  foreheadTop: 10,
  chin: 152,
  leftEdge: 234,
  rightEdge: 454,
  noseTip: 1,
  noseBridge: 168,
  upperLip: 13,
  lowerLip: 14,
  mouthLeft: 61,
  mouthRight: 291,
  leftJaw: 172,
  rightJaw: 397,
  leftCheek: 50,
  rightCheek: 280,
  leftIris: 468,
  rightIris: 473,
  faceOval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
  lipsOuter: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146],
  lipsInner: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
  leftEye: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  rightEye: [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382],
  leftUpperLid: [33, 246, 161, 160, 159, 158, 157, 173, 133],
  rightUpperLid: [362, 398, 384, 385, 386, 387, 388, 466, 263],
  leftBrow: [46, 53, 52, 65, 55, 70, 63, 105, 66, 107],
  rightBrow: [276, 283, 282, 295, 285, 300, 293, 334, 296, 336],
  leftBrowLine: [70, 63, 105, 66, 107],
  rightBrowLine: [300, 293, 334, 296, 336],
  leftIrisRing: [469, 470, 471, 472],
  rightIrisRing: [474, 475, 476, 477],
} as const

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function eyeCenters(points: Point[]) {
  return { left: midpoint(points[33], points[133]), right: midpoint(points[362], points[263]) }
}

export function faceFrame(points: Point[]): FaceFrame {
  const eyes = eyeCenters(points)
  const span = distance(eyes.left, eyes.right) || 1
  const across = { x: (eyes.right.x - eyes.left.x) / span, y: (eyes.right.y - eyes.left.y) / span }
  return { origin: points[landmarks.foreheadTop], across, down: { x: -across.y, y: across.x }, width: distance(points[landmarks.leftEdge], points[landmarks.rightEdge]) || 1 }
}

export function toFaceSpace(frame: FaceFrame, point: Point): Point {
  const dx = point.x - frame.origin.x
  const dy = point.y - frame.origin.y
  return { x: (dx * frame.across.x + dy * frame.across.y) / frame.width, y: (dx * frame.down.x + dy * frame.down.y) / frame.width }
}

export function buildWarps(points: Point[], face: LensSettings['face']): FaceWarp[] {
  const frame = faceFrame(points)
  const width = frame.width
  const eyes = eyeCenters(points)
  const nose = points[landmarks.noseTip]
  const mouth = midpoint(points[landmarks.upperLip], points[landmarks.lowerLip])
  const warps: FaceWarp[] = []
  const bulge = (center: Point, radius: number, strength: number) => { if (strength) warps.push({ x: center.x, y: center.y, radius, strength, shiftX: 0, shiftY: 0 }) }
  const shift = (center: Point, radius: number, x: number, y: number) => { if (x || y) warps.push({ x: center.x, y: center.y, radius, strength: 0, shiftX: x, shiftY: y }) }
  bulge(nose, width * 1.05, face.head * 0.24)
  bulge(eyes.left, width * 0.21, face.eyes * 0.34)
  bulge(eyes.right, width * 0.21, face.eyes * 0.34)
  bulge(points[4], width * 0.17, face.nose * 0.32)
  bulge(mouth, width * 0.26, face.mouth * 0.28)
  const slimAmount = face.slim * width * 0.075
  shift(points[landmarks.leftJaw], width * 0.36, frame.across.x * slimAmount, frame.across.y * slimAmount)
  shift(points[landmarks.rightJaw], width * 0.36, -frame.across.x * slimAmount, -frame.across.y * slimAmount)
  const chinAmount = face.chin * width * 0.09
  shift(points[landmarks.chin], width * 0.3, frame.down.x * chinAmount, frame.down.y * chinAmount)
  const smileAmount = -face.smile * width * 0.035
  shift(points[landmarks.mouthLeft], width * 0.12, frame.down.x * smileAmount - frame.across.x * smileAmount * 0.4, frame.down.y * smileAmount - frame.across.y * smileAmount * 0.4)
  shift(points[landmarks.mouthRight], width * 0.12, frame.down.x * smileAmount + frame.across.x * smileAmount * 0.4, frame.down.y * smileAmount + frame.across.y * smileAmount * 0.4)
  return warps.slice(0, maxWarps)
}

function sampleSource(point: Point, warps: FaceWarp[]): Point {
  let x = point.x
  let y = point.y
  for (const warp of warps) {
    const dx = point.x - warp.x
    const dy = point.y - warp.y
    const ratio = Math.hypot(dx, dy) / warp.radius
    if (ratio >= 1) continue
    const falloff = (1 - ratio * ratio) ** 2
    x -= dx * warp.strength * falloff + warp.shiftX * falloff
    y -= dy * warp.strength * falloff + warp.shiftY * falloff
  }
  return { x, y }
}

export function warpPoints(points: Point[], warps: FaceWarp[]): Point[] {
  if (!warps.length) return points
  return points.map(source => {
    let shown = { ...source }
    for (let step = 0; step < 5; step++) {
      const sampled = sampleSource(shown, warps)
      shown = { x: shown.x + (source.x - sampled.x), y: shown.y + (source.y - sampled.y) }
    }
    return shown
  })
}
