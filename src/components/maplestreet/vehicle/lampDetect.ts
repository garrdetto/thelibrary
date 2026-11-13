import type { ViewFrame } from './suggest'
import type { Pt } from './lampTrace'

/**
 * Finds a lamp on a straight-on, unlit picture of the model (its texture
 * colours only): the bright white or yellow patch of a headlight on the front
 * view, the saturated red patch of a taillight on the rear view. Pure, so it
 * can be tested without a renderer.
 */

/** RGBA pixels, 8 bits per channel, row 0 at the top. Alpha 0 is empty space around the model. */
export type LampImage = { data: ArrayLike<number>; width: number; height: number }

export type LampFindOptions = {
  /** Most corners the outline may have. */
  maxCorners: number
  /** A blob this close to the hint (metres) is preferred. */
  hintReach: number
  /** Plausible lamp sizes in metres. */
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  minArea: number
}

export const LAMP_FIND_DEFAULTS: LampFindOptions = { maxCorners: 16, hintReach: 0.35, minWidth: 0.05, maxWidth: 0.95, minHeight: 0.03, maxHeight: 0.6, minArea: 0.002 }

type Blob = { pixels: number[]; minX: number; maxX: number; minY: number; maxY: number }

function headTexel(r: number, g: number, b: number, floor: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (luminance < floor) return false
  const saturation = max > 0 ? (max - min) / max : 0
  return saturation <= 0.3 || (saturation <= 0.6 && r >= b + 0.08 && g >= b + 0.04)
}

function tailTexel(r: number, g: number, b: number) {
  return r >= 0.3 && g <= r * 0.55 && b <= r * 0.6
}

function distanceToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Douglas–Peucker on a closed outline, split at its two farthest-apart points. */
function simplify(loop: Pt[], tolerance: number): Pt[] {
  if (loop.length <= 3) return loop
  let far = 0, best = -1
  for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i].x - loop[0].x, loop[i].y - loop[0].y); if (d > best) { best = d; far = i } }
  const reduce = (points: Pt[]): Pt[] => {
    if (points.length <= 2) return points
    let index = 0, worst = 0
    for (let i = 1; i < points.length - 1; i++) { const d = distanceToSegment(points[i], points[0], points[points.length - 1]); if (d > worst) { worst = d; index = i } }
    if (worst <= tolerance) return [points[0], points[points.length - 1]]
    return [...reduce(points.slice(0, index + 1)).slice(0, -1), ...reduce(points.slice(index))]
  }
  const first = reduce(loop.slice(0, far + 1)), second = reduce([...loop.slice(far), loop[0]])
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}

/**
 * The outer boundary of a blob as a loop of pixel corners. The walk follows
 * the cracks between pixels with the blob on its right-hand side, turning
 * left wherever a diagonal neighbour continues the blob.
 */
function boundary(mask: Uint8Array, width: number, height: number, blob: Blob): Pt[] {
  for (const p of blob.pixels) mask[p] = 2
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 2
  let first = blob.pixels[0]
  for (const p of blob.pixels) if (p < first) first = p
  const startX = first % width, startY = (first - startX) / width
  const loop: Pt[] = []
  let x = startX, y = startY, dx = 1, dy = 0
  const limit = blob.pixels.length * 4 + 16
  for (let step = 0; step < limit; step++) {
    loop.push({ x, y })
    x += dx
    y += dy
    const leftX = dx === 1 || dy === 1 ? x : x - 1, leftY = dx === 1 || dy === -1 ? y - 1 : y
    const rightX = dx === 1 || dy === -1 ? x : x - 1, rightY = dx === 1 || dy === 1 ? y : y - 1
    if (inside(leftX, leftY)) { const t = dx; dx = dy; dy = -t } else if (!inside(rightX, rightY)) { const t = dx; dx = -dy; dy = t }
    if (x === startX && y === startY && dx === 1 && dy === 0) break
  }
  for (const p of blob.pixels) mask[p] = 1
  return loop
}

/**
 * The outline of the most likely lamp, in the view's metres (x across, y
 * down, matching the hand tracer), or null when nothing plausible is found.
 * Only the side of the picture that shows the vehicle's right-hand lamp is
 * searched; the other side is its mirror image.
 */
export function findLampOutline(image: LampImage, frame: ViewFrame, kind: 'head' | 'tail', hint: Pt | null, options: Partial<LampFindOptions> = {}): Pt[] | null {
  const o = { ...LAMP_FIND_DEFAULTS, ...options }
  const { data, width, height } = image
  if (width < 8 || height < 8) return null
  const metresX = (frame.right - frame.left) / width, metresY = (frame.top - frame.bottom) / height
  const toView = (px: number, py: number): Pt => ({ x: frame.left + px * metresX, y: -frame.top + py * metresY })
  const front = kind === 'head'

  const histogram = new Uint32Array(256)
  let covered = 0, top = height, bottom = -1, left = width, right = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4
    if (data[p + 3] < 128) continue
    covered++
    histogram[Math.round(0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2])]++
    if (y < top) top = y
    if (y > bottom) bottom = y
    if (x < left) left = x
    if (x > right) right = x
  }
  if (covered < 64) return null
  let median = 0
  for (let v = 0, seen = 0; v < 256; v++) { seen += histogram[v]; if (seen >= covered / 2) { median = v / 255; break } }
  const floor = Math.max(0.7, median + 0.18)

  const centre = Math.round((0 - frame.left) / metresX)
  const from = front ? 0 : centre, to = front ? centre : width
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = Math.max(0, from); x < Math.min(width, to); x++) {
    const p = (y * width + x) * 4
    if (data[p + 3] < 128) continue
    const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255
    if (front ? headTexel(r, g, b, floor) : tailTexel(r, g, b)) mask[y * width + x] = 1
  }
  const grown = Uint8Array.from(mask)
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x
    if (!mask[i] && (mask[i - 1] || mask[i + 1] || mask[i - width] || mask[i + width])) grown[i] = 1
  }
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x
    mask[i] = grown[i] && grown[i - 1] && grown[i + 1] && grown[i - width] && grown[i + width] ? 1 : mask[i]
  }

  const bodyHeight = Math.max(1, bottom - top + 1), bodyHalf = Math.max(1, (right - left + 1) / 2)
  const seen = new Uint8Array(width * height)
  let chosen: Blob | null = null, chosenScore = 0
  const stack: number[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    const blob: Blob = { pixels: [], minX: width, maxX: -1, minY: height, maxY: -1 }
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      const x = i % width, y = (i - x) / width
      blob.pixels.push(i)
      if (x < blob.minX) blob.minX = x
      if (x > blob.maxX) blob.maxX = x
      if (y < blob.minY) blob.minY = y
      if (y > blob.maxY) blob.maxY = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const n = ny * width + nx
        if (mask[n] && !seen[n]) { seen[n] = 1; stack.push(n) }
      }
    }
    const w = (blob.maxX - blob.minX + 1) * metresX, h = (blob.maxY - blob.minY + 1) * metresY
    const area = blob.pixels.length * metresX * metresY
    if (w < o.minWidth || w > o.maxWidth || h < o.minHeight || h > o.maxHeight || area < o.minArea) continue
    if (blob.maxX - blob.minX + 1 > bodyHalf * 0.8 || blob.maxY - blob.minY + 1 > bodyHeight * 0.45) continue
    if (area < w * h * 0.25) continue
    const middle = ((blob.minY + blob.maxY) / 2 - top) / bodyHeight
    if (middle < 0.22 || middle > 0.86) continue
    const touchesCentre = front ? blob.maxX >= centre - 2 : blob.minX <= centre + 2
    let score = area * (touchesCentre ? 0.2 : 1)
    if (hint) {
      const a = toView(blob.minX, blob.minY), b = toView(blob.maxX + 1, blob.maxY + 1)
      const gapX = Math.max(0, a.x - hint.x, hint.x - b.x), gapY = Math.max(0, a.y - hint.y, hint.y - b.y)
      if (Math.hypot(gapX, gapY) <= o.hintReach) score *= 4
    }
    if (score > chosenScore) { chosen = blob; chosenScore = score }
  }
  if (!chosen) return null

  const loop = boundary(mask, width, height, chosen).map(p => toView(p.x, p.y))
  if (loop.length < 3) return null
  let tolerance = Math.max(metresX, metresY) * 0.75
  let outline = simplify(loop, tolerance)
  for (let i = 0; i < 24 && outline.length > o.maxCorners; i++) { tolerance *= 1.35; outline = simplify(loop, tolerance) }
  return outline.length >= 3 && outline.length <= o.maxCorners ? outline : null
}
