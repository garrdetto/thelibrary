/** Where the throw meter sits on screen, worked out from the board's projected size and kept clear of the top bar and the Throw button: beside the board on the right when there is room (shortened to fit), above the board on the right in a tall phone view, and otherwise against the right edge, over the number ring as far as it can. Pure, so the tests can check every view. */
import { RADII } from '../shared/Board'

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface MeterLayoutInput {
  /** The HUD's size in CSS pixels. */
  width: number
  height: number
  /** The bull's position and the board's radius on screen, in CSS pixels. */
  bullX: number
  bullY: number
  boardRadius: number
  /** The cross meter (a side meter crossing the height meter at the green) or the classic one. */
  cross: boolean
  /** The phone layout (`max-width: 640px` in overlay.css): a 22 px meter with no label beside it. */
  narrow: boolean
  /** The side meter's width over the height meter's track height (`sideScale` in Overlay). */
  sideScale: number
  /** The Throw button's box; the meter never overlaps it. */
  avoid: Box | null
}

export interface MeterLayout {
  /** The height meter's left edge and vertical centre, its height, and half the side meter's width: the `--meter-x`, `--meter-y`, `--meter-h` and `--h-half` properties of `.d-meter-wrap`. */
  left: number
  top: number
  height: number
  half: number
  /** No room for the reading beside the meter, so it is hidden. */
  tight: boolean
  spot: 'side' | 'above' | 'edge'
}

const EDGE = 10
const GAP = 14
/** Below the Pause button and the mode chip. */
const TOP_BAR = 56
const MIN_HEIGHT = 140
const LABEL = 150
const CLEAR = 10
/** Where the double ring ends, as a share of the board's radius; outside it is only the number ring. */
const DOUBLE_EDGE = RADII.doubleOuter / RADII.board

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function meterLayout(input: MeterLayoutInput): MeterLayout {
  const { width, height, bullX, bullY, boardRadius, cross, narrow, sideScale, avoid } = input
  const bar = narrow ? 22 : 34
  const pad = narrow ? 4 : 6
  const halfFor = (meter: number) => (cross ? ((meter - 2 * pad) * sideScale + 12) / 2 : bar / 2)
  const footHalf = (meter: number) => Math.max(bar / 2, halfFor(meter))
  const tallestIn = (room: number) => (cross ? (room - 12) / sideScale + 2 * pad : room >= bar ? Infinity : 0)
  const floorFor = (left: number, right: number) => (avoid && right > avoid.left - CLEAR && left < avoid.right + CLEAR ? Math.min(height - 8, avoid.top - CLEAR) : height - 8)
  const labelClear = (center: number, half: number, top: number) => {
    const left = center + half + 10
    if (narrow || left + LABEL > width - EDGE) return false
    return !avoid || left + LABEL < avoid.left - CLEAR || top + 10 < avoid.top - CLEAR
  }
  const layout = (center: number, top: number, meter: number, tight: boolean, spot: MeterLayout['spot']): MeterLayout => ({
    left: Math.round(center - bar / 2),
    top: Math.round(top),
    height: Math.round(meter),
    half: Math.round(halfFor(meter) * 10) / 10,
    tight,
    spot,
  })
  const wanted = Math.min(height * 0.7, Math.max(MIN_HEIGHT, boardRadius * 1.6))

  const sideLeft = bullX + boardRadius + GAP
  let side = Math.min(wanted, tallestIn(width - EDGE - sideLeft))
  const sideFloor = floorFor(sideLeft, sideLeft + 2 * footHalf(side))
  side = Math.min(side, sideFloor - TOP_BAR)
  if (side >= MIN_HEIGHT) {
    const half = footHalf(side)
    const center = sideLeft + half
    const top = clamp(bullY, TOP_BAR + side / 2, sideFloor - side / 2)
    return layout(center, top, side, !labelClear(center, half, top), 'side')
  }

  const aboveTop = TOP_BAR + 4
  const aboveBottom = bullY - boardRadius - 8
  const regionLeft = width / 2
  const regionRight = width - EDGE
  const above = Math.min(wanted, aboveBottom - aboveTop, tallestIn(regionRight - regionLeft))
  if (above >= MIN_HEIGHT) {
    const half = footHalf(above)
    const roomy = !narrow && regionRight - LABEL - 10 - 2 * half >= regionLeft
    const center = roomy ? regionRight - LABEL - 10 - half : regionRight - half
    return layout(center, aboveBottom - above / 2, above, !roomy, 'above')
  }

  let edge = Math.max(MIN_HEIGHT, Math.min(wanted, tallestIn(width - EDGE - (bullX + boardRadius * DOUBLE_EDGE))))
  const edgeFloor = floorFor(width - EDGE - 2 * footHalf(edge), width - EDGE)
  edge = Math.max(Math.min(edge, edgeFloor - TOP_BAR), Math.min(MIN_HEIGHT, edgeFloor - 8))
  const half = footHalf(edge)
  const center = width - EDGE - half
  const top = clamp(bullY, Math.min(TOP_BAR, edgeFloor - edge) + edge / 2, edgeFloor - edge / 2)
  return layout(center, top, edge, true, 'edge')
}
