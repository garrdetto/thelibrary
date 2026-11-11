/**
 * Face-shape sliders, renderer-free: moves the head's vertices by small, smooth amounts in regions measured from the
 * model's own landmarks (chin, crown, nose tip). The neck is never touched, so the collar seam stays closed, and every
 * slider at 0 leaves the positions exactly as they were.
 */

export interface HeadFrame {
  /** Height of the crown and of the chin's point, metres. */
  top: number
  chin: number
  /** Tip of the nose (x, y, z). */
  nose: [number, number, number]
  /** The head's vertical axis (x, z). */
  centre: [number, number]
  /** Half the head's width. */
  half: number
}

export interface FaceShape {
  jaw: number
  chin: number
  nose: number
  brow: number
  cheeks: number
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
/** 0 outside a..d, 1 between b and c, eased in between. */
const band = (a: number, b: number, c: number, d: number, x: number) => smooth(a, b, x) * (1 - smooth(c, d, x))

/** Most a slider moves any vertex, metres: the reach of each feature at full deflection. */
export const SHAPE_REACH = { jaw: 0.012, chin: 0.012, nose: 0.011, brow: 0.007, cheeks: 0.008 }

export function isNeutral(s: FaceShape): boolean {
  return s.jaw === 0 && s.chin === 0 && s.nose === 0 && s.brow === 0 && s.cheeks === 0
}

/** Writes the shaped positions (x, y, z per vertex, y up, z forward) into `out` and returns it. */
export function shapeFace(base: Float32Array, frame: HeadFrame, s: FaceShape, out: Float32Array): Float32Array {
  const span = frame.top - frame.chin
  const depth = frame.nose[2] - frame.centre[1]
  const [nx, ny, nz] = frame.nose
  const rootY = ny + 0.004
  const rootZ = nz - 0.03
  for (let i = 0; i < base.length; i += 3) {
    const x = base[i]
    const y = base[i + 1]
    const z = base[i + 2]
    const h = (y - frame.chin) / span
    const fwd = (z - frame.centre[1]) / depth
    const side = (x - frame.centre[0]) / frame.half
    const wide = Math.abs(side)
    let dx = 0
    let dy = 0
    let dz = 0
    if (s.jaw !== 0) {
      const w = band(-0.14, -0.02, 0.12, 0.32, h) * smooth(-0.1, 0.35, fwd) * smooth(0.1, 0.5, wide)
      dx += Math.sign(side) * SHAPE_REACH.jaw * s.jaw * w
    }
    if (s.chin !== 0) {
      const w = band(-0.1, -0.03, 0.04, 0.16, h) * smooth(0.45, 0.75, fwd) * (1 - smooth(0.3, 0.6, wide))
      dy -= SHAPE_REACH.chin * 0.8 * s.chin * w
      dz += SHAPE_REACH.chin * 0.6 * s.chin * w
    }
    if (s.nose !== 0) {
      const d2 = (x - nx) ** 2 + (y - ny) ** 2 + (z - nz) ** 2
      const w = Math.exp(-d2 / (0.03 * 0.03)) * smooth(0.6, 0.8, fwd)
      const k = 0.34 * s.nose * w
      dx += (x - nx) * k
      dy += (y - rootY) * k * 0.6
      dz += (z - rootZ) * k
    }
    if (s.brow !== 0) {
      const w = band(0.47, 0.53, 0.59, 0.66, h) * smooth(0.55, 0.8, fwd)
      dz += SHAPE_REACH.brow * s.brow * w
    }
    if (s.cheeks !== 0) {
      const w = band(0.14, 0.24, 0.42, 0.52, h) * band(0.2, 0.4, 0.8, 0.98, wide) * smooth(0.15, 0.45, fwd)
      dx += Math.sign(side) * SHAPE_REACH.cheeks * s.cheeks * w
      dz += SHAPE_REACH.cheeks * 0.5 * s.cheeks * w
    }
    out[i] = x + dx
    out[i + 1] = y + dy
    out[i + 2] = z + dz
  }
  return out
}
