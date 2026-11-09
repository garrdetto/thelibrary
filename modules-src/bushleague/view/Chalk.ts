/** Regulation field markings and the packing-clay wear under them, painted in sim metres onto any 2D context whose transform maps metres to pixels: foul lines that start where they leave the batter's boxes, the batter's boxes, an open catcher's box, the runner's lane along the first-base line, on-deck circles (plus the coaches' boxes as segments for meshes) and the darker clay around the plate, the mound table and the outfield grass edge. */
import { BASES, BASE_PATH, MOUND_DISTANCE, PLATE_HALF_WIDTH } from '../sim'

type Context = CanvasRenderingContext2D

const FT = 0.3048
/** Batter's box: 4 ft by 6 ft, 6 in off the plate, centred on the plate's middle. */
export const BOX = { inner: PLATE_HALF_WIDTH + 0.5 * FT, outer: PLATE_HALF_WIDTH + 4.5 * FT, back: 0.2159 - 3 * FT, front: 0.2159 + 3 * FT }
/** Catcher's box: 43 in wide, 8 ft deep behind the batter's boxes. */
const CATCHER = { half: (43 / 12 / 2) * FT, back: BOX.back - 8 * FT }
export const ON_DECK = [{ x: -10.6, z: -2.6 }, { x: 10.6, z: -2.6 }] as const
export const ON_DECK_RADIUS = 2.5 * FT
const DIAG = Math.SQRT1_2
const CHALK = 'rgba(246,243,233,0.97)'

/** A point `along` metres down the foul line on `side` (1 = first base), pushed `out` metres into foul ground. */
function onLine(side: 1 | -1, along: number, out = 0): [number, number] {
  return [side * (along + out) * DIAG, (along - out) * DIAG]
}

function soft(ctx: Context, x: number, z: number, rx: number, rz: number, rgba: [number, number, number, number], angle = 0): void {
  ctx.save()
  ctx.translate(x, z)
  ctx.rotate(angle)
  ctx.scale(rx, rz)
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  const [r, g, b, a] = rgba
  gradient.addColorStop(0, `rgba(${r},${g},${b},${a})`)
  gradient.addColorStop(0.6, `rgba(${r},${g},${b},${a * 0.6})`)
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(0, 0, 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Darker, damper clay where play packs it down: batter's boxes with the digs players leave, the catcher's box, the mound table and landing area, the base cutouts, and a faint lip along the outfield grass. */
export function paintClay(ctx: Context): void {
  const clay: [number, number, number, number] = [92, 50, 28, 0.34]
  const dig: [number, number, number, number] = [58, 31, 17, 0.5]
  for (const side of [-1, 1]) {
    const mid = (BOX.inner + BOX.outer) / 2
    soft(ctx, side * mid, (BOX.back + BOX.front) / 2, 1.0, 1.35, clay)
    soft(ctx, side * (BOX.inner + 0.42), -0.25, 0.26, 0.2, dig)
    soft(ctx, side * (BOX.inner + 0.36), 0.6, 0.22, 0.18, [58, 31, 17, 0.32])
  }
  soft(ctx, 0, (BOX.back + CATCHER.back) / 2, 0.9, 1.5, [92, 50, 28, 0.26])
  soft(ctx, 0, -1.6, 0.35, 0.3, dig)
  soft(ctx, 0, MOUND_DISTANCE, 1.5, 1.2, clay)
  soft(ctx, 0, MOUND_DISTANCE - 0.25, 0.42, 0.22, dig)
  soft(ctx, -0.2, MOUND_DISTANCE - 1.65, 0.28, 0.42, dig)
  soft(ctx, 0.25, MOUND_DISTANCE - 1.8, 0.24, 0.36, [58, 31, 17, 0.36])
  for (const base of [1, 2, 3]) soft(ctx, BASES[base].x, BASES[base].z, 1.1, 1.1, [92, 50, 28, 0.2])
  ctx.strokeStyle = 'rgba(64,36,20,0.12)'
  ctx.lineWidth = 0.22
  ctx.beginPath()
  ctx.arc(0, MOUND_DISTANCE, 29 - 0.14, Math.PI * 0.2, Math.PI * 0.8)
  ctx.stroke()
}

/** Every chalk line, drawn so none crosses another or the plate. */
export function paintMarkings(ctx: Context): void {
  ctx.strokeStyle = CHALK
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  ctx.lineWidth = 0.076
  for (const side of [-1, 1] as const) {
    ctx.strokeRect(side > 0 ? BOX.inner : -BOX.outer, BOX.back, BOX.outer - BOX.inner, BOX.front - BOX.back)
  }
  ctx.beginPath()
  ctx.moveTo(-CATCHER.half, BOX.back)
  ctx.lineTo(-CATCHER.half, CATCHER.back)
  ctx.lineTo(CATCHER.half, CATCHER.back)
  ctx.lineTo(CATCHER.half, BOX.back)
  ctx.stroke()

  ctx.lineWidth = 0.1
  const start = BOX.front * Math.SQRT2
  for (const side of [-1, 1] as const) {
    ctx.beginPath()
    ctx.moveTo(...onLine(side, start))
    ctx.lineTo(...onLine(side, 30 * Math.SQRT2))
    ctx.stroke()
  }

  ctx.lineWidth = 0.076
  const lane = 3 * FT
  const half = 45 * FT
  ctx.beginPath()
  ctx.moveTo(...onLine(1, half, 0.05))
  ctx.lineTo(...onLine(1, half, lane))
  ctx.lineTo(...onLine(1, BASE_PATH + 0.2, lane))
  ctx.stroke()

  for (const spot of ON_DECK) {
    ctx.beginPath()
    ctx.arc(spot.x, spot.z, ON_DECK_RADIUS - 0.05, 0, Math.PI * 2)
    ctx.stroke()
  }
}

/** The coaches' boxes on the grass (20 ft by 10 ft, 15 ft off each foul line, open toward the stands) as chalk segments in sim (x, z); the grass doesn't read the paint layers, so these are drawn as meshes. */
export function coachBoxSegments(): Array<[[number, number], [number, number]]> {
  const segments: Array<[[number, number], [number, number]]> = []
  for (const side of [-1, 1] as const) {
    const near = BASE_PATH - 7.4
    const far = near + 20 * FT
    const inner = 15 * FT
    const outer = inner + 10 * FT
    const corners = [onLine(side, near, outer), onLine(side, near, inner), onLine(side, far, inner), onLine(side, far, outer)]
    for (let index = 1; index < corners.length; index++) segments.push([corners[index - 1], corners[index]])
  }
  return segments
}

/** Breaks chalk and clay up a little so lines read as powdered lime rather than paint. Works in pixels on the whole canvas. */
export function weather(ctx: Context, size: number, seed = 1): void {
  let state = seed >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'destination-out'
  const dots = Math.round(size * size * 0.035)
  for (let index = 0; index < dots; index++) {
    ctx.fillStyle = `rgba(0,0,0,${0.15 + random() * 0.35})`
    const s = 0.6 + random() * 1.4
    ctx.fillRect(random() * size, random() * size, s, s)
  }
  ctx.restore()
}
