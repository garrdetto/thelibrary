import type { Mat4 } from './gl'

const EDGE_MARGIN = 1.15

export function personCuller(viewProj: Mat4, groundZ: number) {
  const m = viewProj
  const z = groundZ + 0.9
  return (x: number, y: number) => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15]
    if (w <= 0.05) return false
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12]
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13]
    const limit = w * EDGE_MARGIN + 2
    return cx >= -limit && cx <= limit && cy >= -limit && cy <= limit
  }
}

/** Writes the six frustum planes of `viewProj` into `out` (a, b, c, d per plane, normalised). */
export function frustumPlanes(viewProj: Mat4, out: Float32Array) {
  const m = viewProj
  const rows = [[3, 0, 1], [3, 0, -1], [3, 1, 1], [3, 1, -1], [3, 2, 1], [3, 2, -1]] as const
  for (let p = 0; p < 6; p++) {
    const [w, axis, sign] = rows[p]
    const a = m[w] + sign * m[axis], b = m[4 + w] + sign * m[4 + axis], c = m[8 + w] + sign * m[8 + axis], d = m[12 + w] + sign * m[12 + axis]
    const l = Math.hypot(a, b, c) || 1
    out[p * 4] = a / l; out[p * 4 + 1] = b / l; out[p * 4 + 2] = c / l; out[p * 4 + 3] = d / l
  }
  return out
}

export function sphereVisible(planes: Float32Array, x: number, y: number, z: number, r: number) {
  for (let p = 0; p < 24; p += 4) if (planes[p] * x + planes[p + 1] * y + planes[p + 2] * z + planes[p + 3] < -r) return false
  return true
}
