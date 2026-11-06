import { TAU, clamp, lerp, mod, smooth, type Vec3 } from './math'

export type TrackDef = {
  name: string
  miles: string
  rec: string
  L: number
  R: number
  W: number
  APRON: number
  turnBank: number
  straightBank: number
  bankIn: number
  bankOut: number
  grooveHigh: number
  grooveLow: number
  steer?: number
  smooth?: number
  grip?: number
  apronGrip?: number
  gripUp?: number
  minLap: number
  theme?: 'prison'
  surface?: 'dirt'
  bareInfield?: boolean
}

export const TRACKS: Record<string, TrackDef> = {
  prison: {
    name: 'Prison Speedway', miles: '0.29 mi', rec: 'prison',
    L: 131, R: 33, W: 16, APRON: 6,
    turnBank: 21, straightBank: 10, bankIn: 55, bankOut: 42,
    grooveHigh: 4.5, grooveLow: -4.7,
    steer: 0.97, smooth: 1.63,
    grip: 1.17, apronGrip: 0.92, gripUp: 1.15,
    minLap: 7500,
    theme: 'prison',
  },
  bullring: {
    name: 'Madison International Raceway', miles: '0.5 mi', rec: 'shorttrack',
    L: 150, R: 35, W: 16, APRON: 7,
    turnBank: 24, straightBank: 10, bankIn: 55, bankOut: 40,
    grooveHigh: 5.0, grooveLow: -5.2,
    steer: 0.9, smooth: 1.5,
    gripUp: 1.05,
    minLap: 12000,
  },
  dells: {
    name: 'Fox Speedway', miles: '0.3 mi', rec: 'dells',
    L: 122, R: 35, W: 16, APRON: 6,
    turnBank: 21, straightBank: 11, bankIn: 50, bankOut: 45,
    grooveHigh: 4.0, grooveLow: -4.3,
    steer: 0.85, smooth: 1.65,
    gripUp: 1.1,
    minLap: 8000,
  },
  dellswide: {
    name: 'Dells Raceway Park', miles: '0.27 mi', rec: 'dellswide',
    L: 122, R: 30, W: 16, APRON: 6,
    turnBank: 19, straightBank: 10, bankIn: 60, bankOut: 40,
    grooveHigh: 4.4, grooveLow: -4.7,
    steer: 1.15, smooth: 1.75,
    gripUp: 1.2,
    minLap: 7000,
    bareInfield: true,
  },
  dirt: {
    name: 'Beaver Dam Raceway', miles: '0.3 mi', rec: 'dirt',
    L: 109, R: 50, W: 15, APRON: 6,
    turnBank: 20, straightBank: 10, bankIn: 65, bankOut: 35,
    grooveHigh: 4.8, grooveLow: -5.2,
    steer: 1.6, smooth: 1.04,
    grip: 0.72, apronGrip: 0.6, gripUp: 1.4,
    minLap: 8000,
    surface: 'dirt',
  },
}

export const DEFAULT_TRACK = 'prison'

export function trackIdFrom(search: string): string {
  const t = new URLSearchParams(search).get('track')
  return t && Object.prototype.hasOwnProperty.call(TRACKS, t) ? t : DEFAULT_TRACK
}

export type TrackCfg = {
  L: number
  R: number
  W: number
  APRON: number
  turnBank: number
  straightBank: number
  bankIn: number
  bankOut: number
  g: number
  grip: number
  apronGrip: number
  aiGrip?: number
  scrub: number
  slideScrub: number
  steerLow: number
  steerRampIn: number
  steerRampOut: number
  steerDamp?: number
}

export function applyTrackConfig(cfg: TrackCfg, track: TrackDef): boolean {
  for (const k of ['L', 'R', 'W', 'APRON', 'turnBank', 'straightBank', 'bankIn', 'bankOut'] as const) cfg[k] = track[k]
  const dirt = track.surface === 'dirt'
  if (track.grip) cfg.grip = track.grip
  if (track.apronGrip) cfg.apronGrip = track.apronGrip
  cfg.aiGrip = cfg.grip
  cfg.grip *= track.gripUp || 1
  cfg.apronGrip *= track.gripUp || 1
  if (dirt) {
    cfg.scrub *= 0.55
    cfg.slideScrub = 0.22
  }
  cfg.steerLow *= track.steer || 1
  cfg.steerRampIn /= track.smooth || 1
  cfg.steerRampOut /= track.smooth || 1
  cfg.steerDamp = 14 / (track.smooth || 1)
  return dirt
}

export type CenterPoint = { x: number; z: number; tx: number; tz: number; nx: number; nz: number }
export type TrackPos = { s: number; lat: number }

export type TrackGeometry = ReturnType<typeof createTrackGeometry>

export function createTrackGeometry(cfg: TrackCfg, track: TrackDef) {
  const L = cfg.L, R = cfg.R, W = cfg.W, AP = cfg.APRON, HW = W / 2
  const TURN = Math.PI * R, P = 2 * L + 2 * TURN, S_LINE = L / 2, T1 = L, T2 = 2 * L + TURN
  const GROOVE_HIGH = track.grooveHigh, GROOVE_LOW = track.grooveLow
  const GROOVE_SPAN = 0.8 * (L / 2 + TURN / 2), LINE_MIN = -HW + 1.6, LINE_MAX = HW - 2.2

  function center(s: number): CenterPoint {
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

  function toTrack(x: number, z: number): TrackPos {
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

  function bankAt(s: number): number {
    s = mod(s, P)
    let x: number
    if (s < L) x = -Math.min(s, L - s)
    else if (s < L + TURN) x = Math.min(s - L, L + TURN - s)
    else if (s < 2 * L + TURN) x = -Math.min(s - L - TURN, 2 * L + TURN - s)
    else x = Math.min(s - T2, P - s)
    const k = smooth(clamp((x + cfg.bankIn) / (cfg.bankIn + cfg.bankOut), 0, 1))
    return ((cfg.straightBank + (cfg.turnBank - cfg.straightBank) * k) * Math.PI) / 180
  }

  function grooveLat(s: number): number {
    const d1 = Math.abs(mod(s - (T1 + TURN / 2) + P / 2, P) - P / 2)
    const d2 = Math.abs(mod(s - (T2 + TURN / 2) + P / 2, P) - P / 2)
    const d = Math.min(d1, d2)
    const w = 0.5 + 0.5 * Math.cos(Math.PI * clamp(d / GROOVE_SPAN, 0, 1))
    return lerp(GROOVE_HIGH, GROOVE_LOW, w)
  }

  function heightAt(s: number, lat: number): number {
    if (lat < -HW) return 0
    return (Math.min(lat, HW) + HW) * Math.tan(bankAt(s))
  }

  function normalAt(s: number, lat: number): Vec3 {
    const c0 = center(s), c1 = center(s + 1), c2 = center(s - 1), l1 = lat + 0.5, l2 = lat - 0.5
    const ax = c1.x + c1.nx * lat - (c2.x + c2.nx * lat)
    const ay = heightAt(s + 1, lat) - heightAt(s - 1, lat)
    const az = c1.z + c1.nz * lat - (c2.z + c2.nz * lat)
    const bx = c0.nx, by = heightAt(s, l1) - heightAt(s, l2), bz = c0.nz
    let x = by * az - bz * ay, y = bz * ax - bx * az, z = bx * ay - by * ax
    const k = 1 / (Math.sqrt(x * x + y * y + z * z) || 1)
    x *= k
    y *= k
    z *= k
    if (y < 0) {
      x = -x
      y = -y
      z = -z
    }
    return [x, y, z]
  }

  function aMaxAt(s: number, lat: number, mu: number): number {
    const t = lat < -HW ? 0 : Math.tan(bankAt(s))
    return (cfg.g * (mu + t)) / (1 - mu * t)
  }

  return {
    L, R, W, AP, HW, TURN, P, S_LINE, T1, T2,
    GROOVE_HIGH, GROOVE_LOW, GROOVE_SPAN, LINE_MIN, LINE_MAX,
    center, toTrack, bankAt, grooveLat, heightAt, normalAt, aMaxAt,
  }
}
