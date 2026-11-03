export type WheelGuess = { x: number; radius: number; width: number; halfTrack: number }
export type AxleGuess = { front: WheelGuess; rear: WheelGuess }
export type ViewName = 'side' | 'top' | 'front' | 'rear'
export type ViewFrame = { view: ViewName; left: number; right: number; top: number; bottom: number }
export type ScreenPoint = { x: number; y: number } | null
export type PartPoints = { seat: { side: ScreenPoint; top: ScreenPoint }; head: { side: ScreenPoint; front: ScreenPoint }; tail: { side: ScreenPoint; rear: ScreenPoint }; hitch: { side: ScreenPoint } }
export type GroundPart = { x: number; y: number; z: number }
export type PartGuess = { seat: GroundPart | null; head: GroundPart | null; tail: GroundPart | null; hitch: { x: number; y: number } | null }

const r3 = (v: number) => Math.round(v * 1000) / 1000
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Points spread over every triangle (9 floats each), about `spacing` metres apart, so sparse low-poly meshes still fill in. */
export function surfaceSamples(tris: Float32Array, spacing = 0.02, maxPerTriangle = 600): Float32Array {
  const out: number[] = []
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2]
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5]
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8]
    const edge = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz))
    const n = Math.max(1, Math.min(Math.ceil(edge / spacing), Math.floor(Math.sqrt(maxPerTriangle * 2))))
    for (let a = 0; a <= n; a++) {
      for (let b = 0; a + b <= n; b++) {
        const u = a / n, v = b / n, w = 1 - u - v
        out.push(ax * w + bx * u + cx * v, ay * w + by * u + cy * v, az * w + bz * u + cz * v)
      }
    }
  }
  return new Float32Array(out)
}

function clusters(values: number[], gap: number) {
  const sorted = [...values].sort((a, b) => a - b)
  const groups: number[][] = []
  for (const v of sorted) {
    const last = groups[groups.length - 1]
    if (last && v - last[last.length - 1] <= gap) last.push(v)
    else groups.push([v])
  }
  return groups
}

const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0 }

class Occupancy {
  private readonly cells = new Set<number>()
  constructor(private readonly cell: number) {}
  private key(i: number, j: number) { return (i + 50000) * 100000 + (j + 50000) }
  add(x: number, y: number) { this.cells.add(this.key(Math.floor(x / this.cell), Math.floor(y / this.cell))) }
  has(x: number, y: number) {
    const i = Math.floor(x / this.cell - 0.5), j = Math.floor(y / this.cell - 0.5)
    return this.cells.has(this.key(i, j)) || this.cells.has(this.key(i + 1, j)) || this.cells.has(this.key(i, j + 1)) || this.cells.has(this.key(i + 1, j + 1))
  }
}

/** Fraction of the tire's lower arcs (both sides of the contact patch) that land on the model's surface. */
function arcCover(grid: Occupancy, cx: number, ground: number, r: number) {
  let hit = 0, total = 0
  for (let deg = 195; deg <= 345; deg += 6) {
    if (deg > 245 && deg < 295) continue
    const a = (deg * Math.PI) / 180
    total++
    if (grid.has(cx + r * Math.cos(a), ground + r + r * Math.sin(a))) hit++
  }
  return hit / total
}

function wheelAt(points: Float32Array, cx: number, ground: number, band: number, length: number): WheelGuess | null {
  const reach = Math.max(0.2, length * 0.05)
  const pos: number[] = [], neg: number[] = []
  for (let i = 0; i < points.length; i += 3) {
    if (points[i + 1] > ground + band || Math.abs(points[i] - cx) > reach) continue
    const z = points[i + 2]
    if (z >= 0) pos.push(z); else neg.push(-z)
  }
  const side = (pos.length >= neg.length ? pos : neg).sort((a, b) => a - b)
  if (side.length < 10) return null
  const inner = side[Math.floor(side.length * 0.02)], outer = side[Math.floor(side.length * 0.98)]
  const width = clamp((outer - inner) * 1.02, 0.1, 0.5)
  const halfTrack = Math.max(0.15, (outer + inner) / 2)
  const zLo = halfTrack - width / 2 - 0.01, zHi = halfTrack + width / 2 + 0.01

  const grid = new Occupancy(0.015)
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = Math.abs(points[i + 2])
    if (Math.abs(x - cx) < 1 && y < ground + 2 && z >= zLo && z <= zHi) grid.add(x, y)
  }
  let radius = 0, peak = 0
  for (let r = 0.1; r <= 0.95; r += 0.005) {
    const cover = arcCover(grid, cx, ground, r)
    if (cover >= 0.6) { radius = r; peak = Math.max(peak, cover) }
    else if (radius && cover < 0.3) break
  }
  if (!radius || peak < 0.6) return null
  return { x: r3(cx), radius: r3(Math.max(0.1, radius - 0.03)), width: r3(width), halfTrack: r3(halfTrack) }
}

/**
 * Finds the front and rear wheels in a model given as surface points in the ground frame
 * (metres, +x forward, +y up, z across). Each half of the model is searched on its own,
 * since small front wheels (mowers) can float above the rear ones: the lowest points of a
 * half are its tires' contact patches, which give the axle position, track and tire width;
 * the radius is the largest circle resting there whose lower arcs stay on the model's
 * surface (past the tread they cross open air).
 */
export function detectAxles(points: Float32Array, size: { length: number; width: number; height: number }): AxleGuess | null {
  if (points.length < 30) return null
  let minX = Infinity, maxX = -Infinity
  for (let i = 0; i < points.length; i += 3) { minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]) }
  const mid = (minX + maxX) / 2
  const band = Math.max(0.025, size.height * 0.025)
  const half = (front: boolean): WheelGuess | null => {
    let ground = Infinity
    for (let i = 0; i < points.length; i += 3) if ((points[i] > mid) === front) ground = Math.min(ground, points[i + 1])
    const contacts: number[] = []
    for (let i = 0; i < points.length; i += 3) if ((points[i] > mid) === front && points[i + 1] <= ground + band) contacts.push(points[i])
    const groups = clusters(contacts, Math.max(0.12, size.length * 0.05)).sort((a, b) => b.length - a.length)
    return groups.length ? wheelAt(points, median(groups[0]), ground, band, size.length) : null
  }
  const front = half(true), rear = half(false)
  if (!front || !rear || front.x - rear.x < 0.4) return null
  return { front, rear }
}

const toMetres = (frame: ViewFrame, p: { x: number; y: number }) => ({
  h: frame.left + (p.x / 1000) * (frame.right - frame.left),
  v: frame.top + (p.y / 1000) * (frame.bottom - frame.top),
})

/**
 * Turns points picked on orthographic views (0–1000 from the top-left) into ground-frame metres.
 * side: right = +x, up = +y · top: right = +x, up = −z · front: right = −z, up = +y · rear: right = +z, up = +y.
 */
export function partsFromViews(points: PartPoints, frames: Record<ViewName, ViewFrame>): PartGuess {
  const side = (p: ScreenPoint) => p ? toMetres(frames.side, p) : null
  const seatSide = side(points.seat.side), seatTop = points.seat.top ? toMetres(frames.top, points.seat.top) : null
  const headSide = side(points.head.side), headFront = points.head.front ? toMetres(frames.front, points.head.front) : null
  const tailSide = side(points.tail.side), tailRear = points.tail.rear ? toMetres(frames.rear, points.tail.rear) : null
  const hitchSide = side(points.hitch.side)
  return {
    seat: seatSide ? { x: r3(seatSide.h), y: r3(seatSide.v), z: r3(seatTop ? -seatTop.v : 0) } : null,
    head: headSide ? { x: r3(headSide.h), y: r3(headSide.v), z: r3(headFront ? Math.abs(headFront.h) : 0) } : null,
    tail: tailSide ? { x: r3(tailSide.h), y: r3(tailSide.v), z: r3(tailRear ? Math.abs(tailRear.h) : 0) } : null,
    hitch: hitchSide ? { x: r3(hitchSide.h), y: r3(hitchSide.v) } : null,
  }
}

export type ScreenBox = { x0: number; y0: number; x1: number; y1: number } | null
export type GroundBox = { front: number; back: number; bottom: number; top: number }

/** A box drawn on the side view (0–1000 from the top-left) in ground-frame metres along the length and up. */
export function boxFromSide(box: ScreenBox, side: ViewFrame): GroundBox | null {
  if (!box) return null
  const a = toMetres(side, { x: box.x0, y: box.y0 }), b = toMetres(side, { x: box.x1, y: box.y1 })
  const front = r3(Math.max(a.h, b.h)), back = r3(Math.min(a.h, b.h)), top = r3(Math.max(a.v, b.v)), bottom = r3(Math.min(a.v, b.v))
  return front - back > 0.1 && top - bottom > 0.1 ? { front, back, bottom, top } : null
}
