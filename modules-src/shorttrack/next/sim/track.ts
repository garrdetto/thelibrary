import type { Config, TrackDef } from './config'
import { TAU, clamp, lerp, mod, smooth } from './math'

export type CenterPoint = { x: number; z: number; tx: number; tz: number; nx: number; nz: number }
export type TrackPos = { s: number; lat: number }
export type Vec3 = { x: number; y: number; z: number }

/**
 * Counter-clockwise oval. `s` is distance along the centerline, `lat` the offset from it (+ = outside, toward
 * the wall). Ported line for line from the classic module so results match to the last bit.
 */
export class Track {
  readonly L: number
  readonly R: number
  readonly W: number
  readonly AP: number
  readonly HW: number
  readonly TURN: number
  readonly P: number
  readonly S_LINE: number
  readonly T1: number
  readonly T2: number
  readonly GROOVE_HIGH: number
  readonly GROOVE_LOW: number
  readonly GROOVE_SPAN: number
  readonly LINE_MIN: number
  readonly LINE_MAX: number
  readonly dirt: boolean

  constructor(readonly def: TrackDef, readonly cfg: Config) {
    this.L = cfg.L
    this.R = cfg.R
    this.W = cfg.W
    this.AP = cfg.APRON
    this.HW = this.W / 2
    this.TURN = Math.PI * this.R
    this.P = 2 * this.L + 2 * this.TURN
    this.S_LINE = this.L / 2
    this.T1 = this.L
    this.T2 = 2 * this.L + this.TURN
    this.GROOVE_HIGH = def.grooveHigh
    this.GROOVE_LOW = def.grooveLow
    this.GROOVE_SPAN = 0.8 * (this.L / 2 + this.TURN / 2)
    this.LINE_MIN = -this.HW + 1.6
    this.LINE_MAX = this.HW - 2.2
    this.dirt = def.surface === 'dirt'
  }

  center(s: number): CenterPoint {
    const { L, R, TURN, P } = this
    s = mod(s, P)
    if (s < L) return { x: -L / 2 + s, z: R, tx: 1, tz: 0, nx: 0, nz: 1 }
    s -= L
    if (s < TURN) {
      const a = Math.PI / 2 - s / R, c = Math.cos(a), n = Math.sin(a)
      return { x: L / 2 + R * c, z: R * n, tx: n, tz: -c, nx: c, nz: n }
    }
    s -= TURN
    if (s < L) return { x: L / 2 - s, z: -R, tx: -1, tz: 0, nx: 0, nz: -1 }
    s -= L
    const a = -Math.PI / 2 - s / R, c = Math.cos(a), n = Math.sin(a)
    return { x: -L / 2 + R * c, z: R * n, tx: n, tz: -c, nx: c, nz: n }
  }

  toTrack(x: number, z: number): TrackPos {
    const { L, R, TURN } = this
    if (x >= -L / 2 && x <= L / 2) return z >= 0 ? { s: x + L / 2, lat: z - R } : { s: L + TURN + (L / 2 - x), lat: -z - R }
    if (x > L / 2) {
      const dx = x - L / 2, a = Math.atan2(z, dx)
      return { s: L + (Math.PI / 2 - a) * R, lat: Math.hypot(dx, z) - R }
    }
    const dx = x + L / 2
    let a = Math.atan2(z, dx)
    if (a > 0) a -= TAU
    return { s: 2 * L + TURN + (-Math.PI / 2 - a) * R, lat: Math.hypot(dx, z) - R }
  }

  /** Banking in radians: ramps up over `bankIn` metres of straight and `bankOut` metres into the turn. */
  bankAt(s: number): number {
    const { L, TURN, P, T2, cfg } = this
    s = mod(s, P)
    let x: number
    if (s < L) x = -Math.min(s, L - s)
    else if (s < L + TURN) x = Math.min(s - L, L + TURN - s)
    else if (s < 2 * L + TURN) x = -Math.min(s - L - TURN, 2 * L + TURN - s)
    else x = Math.min(s - T2, P - s)
    const k = smooth(clamp((x + cfg.bankIn) / (cfg.bankIn + cfg.bankOut), 0, 1))
    return ((cfg.straightBank + (cfg.turnBank - cfg.straightBank) * k) * Math.PI) / 180
  }

  grooveLat(s: number): number {
    const { T1, T2, TURN, P } = this
    const d1 = Math.abs(mod(s - (T1 + TURN / 2) + P / 2, P) - P / 2), d2 = Math.abs(mod(s - (T2 + TURN / 2) + P / 2, P) - P / 2), d = Math.min(d1, d2)
    const w = 0.5 + 0.5 * Math.cos(Math.PI * clamp(d / this.GROOVE_SPAN, 0, 1))
    return lerp(this.GROOVE_HIGH, this.GROOVE_LOW, w)
  }

  heightAt(s: number, lat: number): number {
    const HW = this.HW
    if (lat < -HW) return 0
    return (Math.min(lat, HW) + HW) * Math.tan(this.bankAt(s))
  }

  /** True surface normal from the height field, normalised the way three.js `Vector3.normalize` does. */
  normalAt(s: number, lat: number, out: Vec3): Vec3 {
    const c0 = this.center(s), c1 = this.center(s + 1), c2 = this.center(s - 1), l1 = lat + 0.5, l2 = lat - 0.5
    const ax = c1.x + c1.nx * lat - (c2.x + c2.nx * lat), ay = this.heightAt(s + 1, lat) - this.heightAt(s - 1, lat), az = c1.z + c1.nz * lat - (c2.z + c2.nz * lat)
    const bx = c0.nx, by = this.heightAt(s, l1) - this.heightAt(s, l2), bz = c0.nz
    let x = by * az - bz * ay, y = bz * ax - bx * az, z = bx * ay - by * ax
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1)
    x *= inv
    y *= inv
    z *= inv
    if (y < 0) {
      x = -x
      y = -y
      z = -z
    }
    out.x = x
    out.y = y
    out.z = z
    return out
  }

  aMaxAt(s: number, lat: number, mu: number): number {
    const t = lat < -this.HW ? 0 : Math.tan(this.bankAt(s))
    return (this.cfg.g * (mu + t)) / (1 - mu * t)
  }
}
