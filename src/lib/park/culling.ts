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
