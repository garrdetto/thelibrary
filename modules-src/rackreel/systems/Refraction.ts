/** Where a fish appears from above the water, renderer-free. Light from a fish at depth `d` and horizontal distance `D` bends at the surface toward an eye `h` above the water; the eye sees the fish along the straight continuation of the air ray, so it looks shallower than it is. */

export const WATER_INDEX = 1.333

/** Horizontal distance from the eye to the point where the sight line crosses the surface (Snell: sin θair = n · sin θwater). */
export function surfaceCrossing(h: number, d: number, D: number, n = WATER_INDEX): number {
  if (D <= 1e-6) return 0
  if (d <= 1e-6) return D
  if (h <= 1e-6) return 0
  let lo = 0
  let hi = D
  for (let i = 0; i < 60; i++) {
    const x = (lo + hi) / 2
    const far = D - x
    const sinAir = x / Math.sqrt(x * x + h * h)
    const sinWater = far / Math.sqrt(far * far + d * d)
    if (sinAir - n * sinWater > 0) hi = x
    else lo = x
  }
  return (lo + hi) / 2
}

/** Depth at which the fish appears, straight above the real fish. */
export function apparentDepth(h: number, d: number, D: number, n = WATER_INDEX): number {
  if (d <= 0) return d
  if (D <= 1e-4 || h <= 1e-6) return d / n
  const x = surfaceCrossing(h, d, D, n)
  if (x <= 1e-9) return d / n
  return Math.min(d, ((D - x) * h) / x)
}

/** How far below the fish you see to aim (metres): the real depth minus the apparent one. */
export function aimLow(h: number, d: number, D: number, n = WATER_INDEX): number {
  return d - apparentDepth(h, d, D, n)
}

/** Maps a real point below the water to where it is drawn for an eye at (ex, ey, ez); points above the water are unchanged. Writes into `out` as [x, y, z]. */
export function apparentPoint(ex: number, ey: number, ez: number, x: number, y: number, z: number, out: number[] = [0, 0, 0]): number[] {
  out[0] = x
  out[2] = z
  if (y >= 0 || ey <= 0) {
    out[1] = y
    return out
  }
  out[1] = -apparentDepth(ey, -y, Math.hypot(x - ex, z - ez))
  return out
}

export const FEET = 0.3048
export const INCH = 0.0254
