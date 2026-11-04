/** Small allocation-light vector and quaternion helpers for the character rig (plain arrays, so the solver is independent of the renderer). */

export type V3 = [number, number, number]
export type Q = [number, number, number, number]

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z]
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const length = (a: V3) => Math.hypot(a[0], a[1], a[2])
export const normalize = (a: V3): V3 => {
  const l = length(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export const qIdentity = (): Q => [0, 0, 0, 1]

export function qMul(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

export const qConj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]]

export function qRotate(q: Q, v: V3): V3 {
  const ix = q[3] * v[0] + q[1] * v[2] - q[2] * v[1]
  const iy = q[3] * v[1] + q[2] * v[0] - q[0] * v[2]
  const iz = q[3] * v[2] + q[0] * v[1] - q[1] * v[0]
  const iw = -q[0] * v[0] - q[1] * v[1] - q[2] * v[2]
  return [
    ix * q[3] + iw * -q[0] + iy * -q[2] - iz * -q[1],
    iy * q[3] + iw * -q[1] + iz * -q[0] - ix * -q[2],
    iz * q[3] + iw * -q[2] + ix * -q[1] - iy * -q[0],
  ]
}

export function qAxisAngle(axis: V3, angle: number): Q {
  const n = normalize(axis)
  const s = Math.sin(angle / 2)
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)]
}

/** Euler in degrees, applied yaw (Y), then pitch (X), then roll (Z). */
export function qEuler(pitch: number, yaw: number, roll: number): Q {
  const d = Math.PI / 180
  return qMul(qMul(qAxisAngle([0, 1, 0], yaw * d), qAxisAngle([1, 0, 0], pitch * d)), qAxisAngle([0, 0, 1], roll * d))
}

export function qSlerp(a: Q, b: Q, t: number): Q {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  let bb: Q = b
  if (cos < 0) { cos = -cos; bb = [-b[0], -b[1], -b[2], -b[3]] }
  if (cos > 0.9995) {
    const r: Q = [a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]
    const l = Math.hypot(r[0], r[1], r[2], r[3])
    return [r[0] / l, r[1] / l, r[2] / l, r[3] / l]
  }
  const angle = Math.acos(cos)
  const s = Math.sin(angle)
  const wa = Math.sin((1 - t) * angle) / s, wb = Math.sin(t * angle) / s
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb]
}

/** Rotation taking the frame (x0, y0) to the frame (x1, y1); y vectors are orthogonalised against x first. */
export function qFromFrames(x0: V3, y0: V3, x1: V3, y1: V3): Q {
  const a = frame(x0, y0), b = frame(x1, y1)
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = b[0][r] * a[0][c] + b[1][r] * a[1][c] + b[2][r] * a[2][c]
  return qFromMatrix(m)
}

function frame(x: V3, y: V3): [V3, V3, V3] {
  const nx = normalize(x)
  const ny = normalize(sub(y, mul(nx, dot(y, nx))))
  return [nx, ny, cross(nx, ny)]
}

function qFromMatrix(m: number[]): Q {
  const trace = m[0] + m[4] + m[8]
  let q: Q
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    q = [(m[7] - m[5]) * s, (m[2] - m[6]) * s, (m[3] - m[1]) * s, 0.25 / s]
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8])
    q = [0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s]
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8])
    q = [(m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s, (m[2] - m[6]) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4])
    q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s, (m[3] - m[1]) / s]
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3])
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}
