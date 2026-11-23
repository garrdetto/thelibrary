/**
 * Math that gives bit-identical results in every JavaScript engine. `Math.sin`, `Math.exp`, `Math.pow` and friends are allowed to
 * differ between browsers in their last bits, which would make a replay flown in Safari drift from the Worker's re-simulation. These
 * functions use only IEEE-754 basic arithmetic, `Math.sqrt`, `Math.round`, `Math.floor`, `Math.abs` and `Math.imul`, which the
 * language defines exactly. Accuracy is better than 1e-9 relative over the ranges the flight model uses. Never use `**` in sim code.
 */

export const PI = 3.141592653589793
export const TWO_PI = 6.283185307179586
export const HALF_PI = 1.5707963267948966
export const DEG = PI / 180
export const RAD = 180 / PI

const TWO_PI_HI = 6.28318530717958623
const TWO_PI_LO = 2.4492935982947064e-16
const LN2 = 0.6931471805599453
const LN2_HI = 0.6931471803691238
const LN2_LO = 1.9082149292705877e-10
const TAN_PI_8 = 0.41421356237309503
const QUARTER_PI = 0.7853981633974483
const SQRT_HALF = 0.7071067811865476

function wrapPi(x: number): number {
  const k = Math.round(x / TWO_PI)
  return x - k * TWO_PI_HI - k * TWO_PI_LO
}

function sinPoly(x: number): number {
  const x2 = x * x
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
}

export function sin(x: number): number {
  let r = wrapPi(x)
  if (r > HALF_PI) r = PI - r
  else if (r < -HALF_PI) r = -PI - r
  return sinPoly(r)
}

export function cos(x: number): number {
  return sin(x + HALF_PI)
}

function atanSmall(x: number): number {
  const x2 = x * x
  let term = x
  let sum = x
  for (let n = 3; n <= 31; n += 2) {
    term *= -x2
    sum += term / n
  }
  return sum
}

export function atan(x: number): number {
  if (x !== x) return x
  const negative = x < 0
  let a = negative ? -x : x
  let offset = 0
  let flip = false
  if (a > 1) {
    a = 1 / a
    flip = true
  }
  if (a > TAN_PI_8) {
    a = (a - 1) / (a + 1)
    offset = QUARTER_PI
  }
  let r = offset + atanSmall(a)
  if (flip) r = HALF_PI - r
  return negative ? -r : r
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x)
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI
  if (y > 0) return HALF_PI
  if (y < 0) return -HALF_PI
  return 0
}

export function asin(x: number): number {
  const c = x > 1 ? 1 : x < -1 ? -1 : x
  return atan2(c, Math.sqrt(1 - c * c))
}

export function acos(x: number): number {
  return HALF_PI - asin(x)
}

function pow2(k: number): number {
  let result = 1
  let base = k >= 0 ? 2 : 0.5
  let n = k >= 0 ? k : -k
  while (n > 0) {
    if (n & 1) result *= base
    base *= base
    n >>= 1
  }
  return result
}

export function exp(x: number): number {
  if (x > 700) return Infinity
  if (x < -700) return 0
  const k = Math.round(x / LN2)
  const r = x - k * LN2_HI - k * LN2_LO
  let term = 1
  let sum = 1
  for (let n = 1; n <= 14; n++) {
    term *= r / n
    sum += term
  }
  return sum * pow2(k)
}

/** Natural logarithm; returns -Infinity for 0 and NaN for negative input. */
export function ln(x: number): number {
  if (x !== x || x < 0) return NaN
  if (x === 0) return -Infinity
  if (x === Infinity) return Infinity
  let e = 0
  let m = x
  while (m >= 2) {
    m *= 0.5
    e++
  }
  while (m < 1) {
    m *= 2
    e--
  }
  if (m > 1 / SQRT_HALF) {
    m *= 0.5
    e++
  }
  const s = (m - 1) / (m + 1)
  const s2 = s * s
  let term = s
  let sum = s
  for (let n = 3; n <= 41; n += 2) {
    term *= s2
    sum += term / n
  }
  return 2 * sum + e * LN2
}

export function pow(base: number, exponent: number): number {
  if (exponent === 0) return 1
  if (base === 0) return exponent > 0 ? 0 : Infinity
  if (base < 0) return NaN
  return exp(exponent * ln(base))
}

export function tanh(x: number): number {
  if (x > 20) return 1
  if (x < -20) return -1
  const e2 = exp(2 * x)
  return (e2 - 1) / (e2 + 1)
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Moves `current` toward `target` by at most `step`. */
export function approach(current: number, target: number, step: number): number {
  if (current < target) return current + step >= target ? target : current + step
  return current - step <= target ? target : current - step
}

/** Wraps an angle in radians into (-π, π]. */
export function wrapAngle(x: number): number {
  return wrapPi(x)
}

/** Linear interpolation in a table of ascending x values; clamps at both ends. */
export function interpolate(xs: readonly number[], ys: readonly number[], x: number): number {
  const last = xs.length - 1
  if (x <= xs[0]) return ys[0]
  if (x >= xs[last]) return ys[last]
  let low = 0
  let high = last
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (xs[mid] <= x) low = mid
    else high = mid
  }
  const t = (x - xs[low]) / (xs[high] - xs[low])
  return ys[low] + (ys[high] - ys[low]) * t
}

/** A 32-bit integer hash of two integers, the base of the terrain and turbulence noise. */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** Seeded generator (xorshift32): the only randomness the sim may use. */
export class SimRandom {
  private state: number

  constructor(seed: number) {
    this.state = (seed | 0) || 0x6d2b79f5
  }

  get seed(): number {
    return this.state
  }

  set seed(value: number) {
    this.state = (value | 0) || 0x6d2b79f5
  }

  nextUint(): number {
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x | 0
    return x >>> 0
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296
  }

  /** Uniform in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1
  }
}
