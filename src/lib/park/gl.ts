import { materialTable } from './materials'
export type Mat4 = Float32Array
export type Vec3 = [number, number, number]

export const mat4 = {
  identity(): Mat4 { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m },
  multiply(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
    return out
  },
  perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16)
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = 2 * far * near / (near - far)
    return m
  },
  lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2]
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx
    const m = new Float32Array(16)
    m[0] = xx; m[1] = yx; m[2] = zx; m[4] = xy; m[5] = yy; m[6] = zy; m[8] = xz; m[9] = yz; m[10] = zz
    m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]); m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]); m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]); m[15] = 1
    return m
  },
  invert(a: Mat4, m: Mat4 = new Float32Array(16)): Mat4 | null {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
    if (!det) return null
    det = 1 / det
    m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det; m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
    m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det; m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
    m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det; m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
    m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det; m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
    return m
  },
  translation(x: number, y: number, z: number): Mat4 { const m = mat4.identity(); m[12] = x; m[13] = y; m[14] = z; return m },
  scaling(x: number, y: number, z: number): Mat4 { const m = mat4.identity(); m[0] = x; m[5] = y; m[10] = z; return m },
  rotZ(a: number): Mat4 { const m = mat4.identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m },
  rotX(a: number): Mat4 { const m = mat4.identity(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m },
  rotY(a: number): Mat4 { const m = mat4.identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m },
  ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
    const m = mat4.identity()
    m[0] = 2 / (right - left); m[5] = 2 / (top - bottom); m[10] = -2 / (far - near)
    m[12] = -(right + left) / (right - left); m[13] = -(top + bottom) / (top - bottom); m[14] = -(far + near) / (far - near)
    return m
  },
  basis(origin: Vec3, xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Mat4 {
    const m = new Float32Array(16)
    m.set([...xAxis, 0, ...yAxis, 0, ...zAxis, 0, ...origin, 1])
    return m
  },
  chain(...ms: Mat4[]): Mat4 { return ms.reduce((acc, m) => mat4.multiply(acc, m), mat4.identity()) },
  transformPoint(m: Mat4, p: Vec3): Vec3 {
    const [x, y, z] = p, w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]
  },
}

export function hexColor(hex: string): Vec3 {
  const v = parseInt(hex.replace('#', ''), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

export const STRIDE = 13

type Mat3 = [number, number, number, number, number, number, number, number, number]

function normalMatrix(m: Mat4 | null): Mat3 | null {
  if (!m) return null
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10]
  const A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g)
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d
  const det = a * A + b * B + c * Cc || 1
  return [A / det, B / det, Cc / det, D / det, E / det, F / det, G / det, H / det, I / det]
}

function transformNormal(nm: Mat3 | null, n: Vec3): Vec3 {
  if (!nm) return n
  const x = nm[0] * n[0] + nm[1] * n[1] + nm[2] * n[2], y = nm[3] * n[0] + nm[4] * n[1] + nm[5] * n[2], z = nm[6] * n[0] + nm[7] * n[1] + nm[8] * n[2]
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

function dirNoise(x: number, y: number, z: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  const t = Math.sin(x * 4.1 + y * 3.3 - z * 5.7) * 0.5 + Math.sin(x * 9.3 - y * 6.1 + z * 2.9) * 0.3
  return (s - Math.floor(s)) * 0.45 + t * 0.55
}

const AO_DIRS: Vec3[] = (() => {
  const dirs: Vec3[] = []
  const n = 10
  for (let i = 0; i < n; i++) {
    const z = 0.25 + 0.75 * ((i + 0.5) / n), r = Math.sqrt(1 - z * z), a = i * 2.39996
    dirs.push([Math.cos(a) * r, Math.sin(a) * r, z])
  }
  return dirs
})()

export const AUTO = -1

export class MeshBuilder {
  static autoMaterial: (r: number, g: number, b: number, tint: number) => number = () => 0
  data: number[] = []
  lines = false
  mat: number = AUTO
  ao = 1
  sway = 0

  vertex(p: Vec3, n: Vec3, c: Vec3, tint = 0) { this.data.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], tint, this.mat < 0 ? MeshBuilder.autoMaterial(c[0], c[1], c[2], tint) : this.mat, this.ao, this.sway) }

  /** Re-tags vertices from `from` onward: `pick` returns a material id (or undefined to keep) and may set wind weight. */
  retag(pick: (r: number, g: number, b: number, tint: number, z: number, mat: number) => number | undefined, sway?: (z: number, mat: number) => number, from = 0) {
    const d = this.data
    for (let i = from; i < d.length; i += STRIDE) {
      const m = pick(d[i + 6], d[i + 7], d[i + 8], d[i + 9], d[i + 2], d[i + 10])
      if (m !== undefined) d[i + 10] = m
      if (sway) d[i + 12] = sway(d[i + 2], d[i + 10])
    }
  }

  tri(m: Mat4 | null, a: Vec3, b: Vec3, c: Vec3, color: Vec3, tint = 0) {
    const pa = m ? mat4.transformPoint(m, a) : a, pb = m ? mat4.transformPoint(m, b) : b, pc = m ? mat4.transformPoint(m, c) : c
    const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l
    const n: Vec3 = [nx, ny, nz]
    this.vertex(pa, n, color, tint); this.vertex(pb, n, color, tint); this.vertex(pc, n, color, tint)
  }

  smoothTri(m: Mat4 | null, nm: Mat3 | null, a: Vec3, b: Vec3, c: Vec3, na: Vec3, nb: Vec3, nc: Vec3, ca: Vec3, cb: Vec3, cc: Vec3, tint = 0) {
    const pa = m ? mat4.transformPoint(m, a) : a, pb = m ? mat4.transformPoint(m, b) : b, pc = m ? mat4.transformPoint(m, c) : c
    this.vertex(pa, transformNormal(nm, na), ca, tint); this.vertex(pb, transformNormal(nm, nb), cb, tint); this.vertex(pc, transformNormal(nm, nc), cc, tint)
  }

  quad(m: Mat4 | null, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Vec3, tint = 0) {
    this.tri(m, a, b, c, color, tint); this.tri(m, a, c, d, color, tint)
  }

  box(m: Mat4 | null, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Vec3, tint = 0) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz, z1 = cz + sz
    this.quad(m, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, tint)
    this.quad(m, [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], color, tint)
    this.quad(m, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, tint)
    this.quad(m, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], color, tint)
    this.quad(m, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], color, tint)
    this.quad(m, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], color, tint)
  }

  cylinder(m: Mat4 | null, cx: number, cy: number, z0: number, r0: number, r1: number, h: number, sides: number, color: Vec3, tint = 0, caps = true) {
    const segments = sides >= 10 ? Math.max(sides, Math.min(40, Math.round(Math.max(r0, r1) * 6) + 16)) : sides
    const smooth = segments >= 6, nm = normalMatrix(m)
    for (let i = 0; i < segments; i++) {
      const a0 = i / segments * Math.PI * 2, a1 = (i + 1) / segments * Math.PI * 2
      const p0: Vec3 = [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, z0], p1: Vec3 = [cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0, z0]
      const q0: Vec3 = [cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1, z0 + h], q1: Vec3 = [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, z0 + h]
      if (smooth) {
        const sn = (a: number): Vec3 => { const x = Math.cos(a) * h, y = Math.sin(a) * h, z = r0 - r1, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l] }
        const n0 = sn(a0), n1 = sn(a1)
        if (r1 > 0.0001) { this.smoothTri(m, nm, p0, p1, q1, n0, n1, n1, color, color, color, tint); this.smoothTri(m, nm, p0, q1, q0, n0, n1, n0, color, color, color, tint) }
        else { const nt = sn((a0 + a1) / 2); this.smoothTri(m, nm, p0, p1, q0, n0, n1, nt, color, color, color, tint) }
      } else if (r1 > 0.0001) this.quad(m, p0, p1, q1, q0, color, tint)
      else this.tri(m, p0, p1, q0, color, tint)
      if (caps) {
        this.tri(m, [cx, cy, z0], p1, p0, color, tint)
        if (r1 > 0.0001) this.tri(m, [cx, cy, z0 + h], q0, q1, color, tint)
      }
    }
  }

  sphere(m: Mat4 | null, cx: number, cy: number, cz: number, r: number, color: Vec3, tint = 0, rings = 8, segments = 12, squashZ = 1, rough = 0, shade?: (n: Vec3) => Vec3) {
    const nm = normalMatrix(m)
    const v = (t: number, p: number): Vec3 => {
      const dx = Math.cos(t) * Math.cos(p), dy = Math.cos(t) * Math.sin(p), dz = Math.sin(t)
      const k = rough ? 1 + (dirNoise(dx, dy, dz) - 0.5) * rough : 1
      return [cx + dx * r * k, cy + dy * r * k, cz + dz * r * squashZ * k]
    }
    const n = (t: number, p: number): Vec3 => { const x = Math.cos(t) * Math.cos(p), y = Math.cos(t) * Math.sin(p), z = Math.sin(t) / squashZ, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l] }
    const col = (nn: Vec3): Vec3 => shade ? shade(nn) : color
    for (let i = 0; i < rings; i++) {
      const t0 = i / rings * Math.PI - Math.PI / 2, t1 = (i + 1) / rings * Math.PI - Math.PI / 2
      for (let j = 0; j < segments; j++) {
        const p0 = j / segments * Math.PI * 2, p1 = (j + 1) / segments * Math.PI * 2
        const a = v(t0, p0), b = v(t0, p1), c = v(t1, p1), d = v(t1, p0)
        const na = n(t0, p0), nb = n(t0, p1), nc = n(t1, p1), nd = n(t1, p0)
        if (i !== rings - 1) this.smoothTri(m, nm, a, c, d, na, nc, nd, col(na), col(nc), col(nd), tint)
        if (i !== 0) this.smoothTri(m, nm, a, b, c, na, nb, nc, col(na), col(nb), col(nc), tint)
      }
    }
  }

  tube(points: Vec3[], radius: number, color: Vec3, segments = 6, tint = 0) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1]
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz)
      if (len < 1e-5) continue
      const t: Vec3 = [dx / len, dy / len, dz / len]
      const ref: Vec3 = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
      let ux = t[1] * ref[2] - t[2] * ref[1], uy = t[2] * ref[0] - t[0] * ref[2], uz = t[0] * ref[1] - t[1] * ref[0]
      const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul
      const vx = t[1] * uz - t[2] * uy, vy = t[2] * ux - t[0] * uz, vz = t[0] * uy - t[1] * ux
      for (let k = 0; k < segments; k++) {
        const a0 = k / segments * Math.PI * 2, a1 = (k + 1) / segments * Math.PI * 2
        const d0: Vec3 = [Math.cos(a0) * ux + Math.sin(a0) * vx, Math.cos(a0) * uy + Math.sin(a0) * vy, Math.cos(a0) * uz + Math.sin(a0) * vz]
        const d1: Vec3 = [Math.cos(a1) * ux + Math.sin(a1) * vx, Math.cos(a1) * uy + Math.sin(a1) * vy, Math.cos(a1) * uz + Math.sin(a1) * vz]
        const A: Vec3 = [a[0] + d0[0] * radius, a[1] + d0[1] * radius, a[2] + d0[2] * radius], B: Vec3 = [a[0] + d1[0] * radius, a[1] + d1[1] * radius, a[2] + d1[2] * radius]
        const Cc: Vec3 = [b[0] + d1[0] * radius, b[1] + d1[1] * radius, b[2] + d1[2] * radius], D: Vec3 = [b[0] + d0[0] * radius, b[1] + d0[1] * radius, b[2] + d0[2] * radius]
        this.smoothTri(null, null, A, B, Cc, d0, d1, d1, color, color, color, tint)
        this.smoothTri(null, null, A, Cc, D, d0, d1, d0, color, color, color, tint)
      }
    }
  }

  sweep(points: Vec3[], ups: Vec3[] | null, radius: number, color: Vec3, segments = 10, tint = 0, closed = false) {
    const n = points.length
    if (n < 2) return
    const frames: { t: Vec3; u: Vec3; v: Vec3 }[] = []
    let prevU: Vec3 | null = null
    for (let i = 0; i < n; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)]
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl
      let ref: Vec3 = ups ? ups[i] : prevU ?? (Math.abs(tz) < 0.9 ? [0, 0, 1] : [1, 0, 0])
      const d = ref[0] * tx + ref[1] * ty + ref[2] * tz
      let ux = ref[0] - tx * d, uy = ref[1] - ty * d, uz = ref[2] - tz * d
      let ul = Math.hypot(ux, uy, uz)
      if (ul < 1e-4) { ref = Math.abs(tz) < 0.9 ? [0, 0, 1] : [1, 0, 0]; const e = ref[0] * tx + ref[1] * ty + ref[2] * tz; ux = ref[0] - tx * e; uy = ref[1] - ty * e; uz = ref[2] - tz * e; ul = Math.hypot(ux, uy, uz) || 1 }
      ux /= ul; uy /= ul; uz /= ul
      prevU = [ux, uy, uz]
      frames.push({ t: [tx, ty, tz], u: [ux, uy, uz], v: [ty * uz - tz * uy, tz * ux - tx * uz, tx * uy - ty * ux] })
    }
    const ring = (i: number, k: number): [Vec3, Vec3] => {
      const f = frames[i], p = points[i], a = k / segments * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
      const d: Vec3 = [f.u[0] * c + f.v[0] * s, f.u[1] * c + f.v[1] * s, f.u[2] * c + f.v[2] * s]
      return [[p[0] + d[0] * radius, p[1] + d[1] * radius, p[2] + d[2] * radius], d]
    }
    const last = closed ? n : n - 1
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n
      for (let k = 0; k < segments; k++) {
        const [A, na] = ring(i, k), [B, nb] = ring(i, k + 1), [Cc, nc] = ring(j, k + 1), [D, nd] = ring(j, k)
        this.smoothTri(null, null, A, B, Cc, na, nb, nc, color, color, color, tint)
        this.smoothTri(null, null, A, Cc, D, na, nc, nd, color, color, color, tint)
      }
    }
  }

  limb(a: Vec3, b: Vec3, r0: number, r1: number, color: Vec3, tint = 0, segments = 10) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz)
    if (len < 1e-5) return
    const t: Vec3 = [dx / len, dy / len, dz / len]
    const ref: Vec3 = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    let ux = t[1] * ref[2] - t[2] * ref[1], uy = t[2] * ref[0] - t[0] * ref[2], uz = t[0] * ref[1] - t[1] * ref[0]
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul
    const v: Vec3 = [t[1] * uz - t[2] * uy, t[2] * ux - t[0] * uz, t[0] * uy - t[1] * ux]
    this.cylinder(mat4.basis(a, [ux, uy, uz], v, t), 0, 0, 0, r0, r1, len, segments, color, tint, false)
  }

  line(a: Vec3, b: Vec3, color: Vec3) { this.lines = true; this.vertex(a, [0, 0, 1], color); this.vertex(b, [0, 0, 1], color) }

  get count() { return this.data.length / STRIDE }

  append(other: MeshBuilder) { for (let i = 0; i < other.data.length; i++) this.data.push(other.data[i]) }

  /** Bakes ambient occlusion into the per-vertex AO channel from a coarse voxelisation of the mesh itself. */
  bakeAO(strength = 0.65, maxCells = 72, from = 0) {
    const d = this.data, count = d.length / STRIDE
    if (count - from / STRIDE < 3 || this.lines) return
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    for (let i = from; i < d.length; i += STRIDE) {
      const x = d[i], y = d[i + 1], z = d[i + 2]
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z
    }
    const span = Math.max(x1 - x0, y1 - y0, z1 - z0)
    const cell = Math.max(0.22, span / maxCells)
    const nx = Math.ceil((x1 - x0) / cell) + 3, ny = Math.ceil((y1 - y0) / cell) + 3, nz = Math.ceil((z1 - z0) / cell) + 3
    const grid = new Uint8Array(nx * ny * nz)
    const ox = x0 - cell, oy = y0 - cell, oz = z0 - cell
    const mark = (x: number, y: number, z: number) => {
      const gx = Math.floor((x - ox) / cell), gy = Math.floor((y - oy) / cell), gz = Math.floor((z - oz) / cell)
      if (gx >= 0 && gy >= 0 && gz >= 0 && gx < nx && gy < ny && gz < nz) grid[(gz * ny + gy) * nx + gx] = 1
    }
    for (let i = from; i + STRIDE * 3 <= d.length; i += STRIDE * 3) {
      const ax = d[i], ay = d[i + 1], az = d[i + 2], bx = d[i + STRIDE], by = d[i + STRIDE + 1], bz = d[i + STRIDE + 2], cx = d[i + STRIDE * 2], cy = d[i + STRIDE * 2 + 1], cz = d[i + STRIDE * 2 + 2]
      const len = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz))
      const steps = Math.min(40, Math.max(1, Math.ceil(len / (cell * 0.7))))
      for (let u = 0; u <= steps; u++) for (let v = 0; v <= steps - u; v++) {
        const s = u / steps, t = v / steps, r = 1 - s - t
        mark(ax * r + bx * s + cx * t, ay * r + by * s + cy * t, az * r + bz * s + cz * t)
      }
    }
    const occupied = (x: number, y: number, z: number) => {
      const gx = Math.floor((x - ox) / cell), gy = Math.floor((y - oy) / cell), gz = Math.floor((z - oz) / cell)
      return gx >= 0 && gy >= 0 && gz >= 0 && gx < nx && gy < ny && gz < nz && grid[(gz * ny + gy) * nx + gx] === 1
    }
    const dists = [1.6, 3, 5.5]
    for (let i = from; i < d.length; i += STRIDE) {
      const px = d[i], py = d[i + 1], pz = d[i + 2], qx = d[i + 3], qy = d[i + 4], qz = d[i + 5]
      const ref: Vec3 = Math.abs(qz) < 0.9 ? [0, 0, 1] : [1, 0, 0]
      let ux = qy * ref[2] - qz * ref[1], uy = qz * ref[0] - qx * ref[2], uz = qx * ref[1] - qy * ref[0]
      const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul
      const vx = qy * uz - qz * uy, vy = qz * ux - qx * uz, vz = qx * uy - qy * ux
      let hit = 0, total = 0
      for (const [a, b, c] of AO_DIRS) {
        const rx = ux * a + vx * b + qx * c, ry = uy * a + vy * b + qy * c, rz = uz * a + vz * b + qz * c
        for (let k = 0; k < dists.length; k++) {
          const w = 1 / (k + 1), s = dists[k] * cell
          total += w
          if (occupied(px + rx * s, py + ry * s, pz + rz * s)) { hit += w; break }
        }
      }
      const ao = 1 - strength * Math.min(1, hit / total * 1.6)
      d[i + 11] = Math.min(d[i + 11], ao)
    }
  }
}

export type GpuMesh = { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; index: WebGLBuffer; indexType: number; count: number; vertexCount: number; mode: number; instance?: WebGLBuffer; instanceCount: number; instanceCapacity: number }

export type Lighting = {
  sunDir: Vec3; sunColor: Vec3; sky: Vec3; ground: Vec3; horizon: Vec3; fog: Vec3; fogDensity: number; fogFalloff: number; sunScatter: Vec3
  skyTop: Vec3; skyBottom: Vec3; exposure: number; shadow?: number; wind: number; neon?: number
}

const BYTES = 24

function packMesh(builder: MeshBuilder) {
  const d = builder.data, n = d.length / STRIDE
  const vb = new ArrayBuffer(n * BYTES), u32 = new Uint32Array(vb)
  let size = 1
  while (size < n * 2) size <<= 1
  const table = new Int32Array(size).fill(-1)
  const indices = n > 65535 ? new Uint32Array(n) : new Uint16Array(n)
  const words = new Uint32Array(6), wf = new Float32Array(words.buffer)
  const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
  const snorm = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127))) & 255
  let unique = 0
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE
    wf[0] = d[o]; wf[1] = d[o + 1]; wf[2] = d[o + 2]
    words[3] = (snorm(d[o + 3]) | snorm(d[o + 4]) << 8 | snorm(d[o + 5]) << 16 | snorm(d[o + 11]) << 24) >>> 0
    words[4] = (clamp8(d[o + 6]) | clamp8(d[o + 7]) << 8 | clamp8(d[o + 8]) << 16 | clamp8(d[o + 9]) << 24) >>> 0
    words[5] = ((d[o + 10] & 255) | clamp8(d[o + 12]) << 8) >>> 0
    let h = 2166136261
    for (let k = 0; k < 6; k++) { h ^= words[k]; h = Math.imul(h, 16777619) }
    let slot = (h >>> 0) & (size - 1), found = -1
    while (table[slot] >= 0) {
      const j = table[slot] * 6
      if (u32[j] === words[0] && u32[j + 1] === words[1] && u32[j + 2] === words[2] && u32[j + 3] === words[3] && u32[j + 4] === words[4] && u32[j + 5] === words[5]) { found = table[slot]; break }
      slot = (slot + 1) & (size - 1)
    }
    if (found < 0) {
      found = unique++
      table[slot] = found
      u32.set(words, found * 6)
    }
    indices[i] = found
  }
  return { vertices: new Uint8Array(vb, 0, unique * BYTES), indices, unique }
}

const SHADER_COMMON = `
uniform vec3 uSunDir;
vec3 toLinear(vec3 c) { return c * (c * (c * 0.305306 + 0.682171) + 0.012523); }
`

function vertexShader(depth: boolean) {
  return `#version 300 es
${depth ? '#define DEPTH 1' : ''}
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in vec4 iPosYaw;
layout(location=4) in vec4 iColorScale;
layout(location=5) in vec4 aMat;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat4 uLightViewProj;
uniform bool uInstanced;
uniform vec3 uTint;
uniform vec3 uSlots[9];
uniform float uTime;
uniform float uWave;
uniform float uWind;
uniform float uShadowOffset;
uniform vec4 uMatA[24];
uniform vec4 uMatB[24];
${SHADER_COMMON}
#ifndef DEPTH
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
out vec4 vShadow;
out float vAo;
out float vNeon;
flat out vec4 vMatA;
flat out vec4 vMatB;
#endif
void main() {
  vec3 p = aPos; vec3 n = aNormal.xyz; vec3 tint = uTint; float phase = 0.0; float weight = aColor.a;
  if (uInstanced) {
    float c = cos(iPosYaw.w), s = sin(iPosYaw.w);
    p = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z) * iColorScale.w + iPosYaw.xyz;
    n = vec3(c * n.x - s * n.y, s * n.x + c * n.y, n.z);
    tint = iColorScale.rgb;
    weight = weight > 0.02 ? 1.0 : 0.0;
    phase = iPosYaw.x * 0.21 + iPosYaw.y * 0.17;
  } else if (weight > 0.05 && weight < 0.95) {
    tint = uSlots[clamp(int(weight * 10.0 + 0.5) - 1, 0, 8)];
    weight = 1.0;
  }
  vec4 w = uModel * vec4(p, 1.0);
  if (uWind > 0.0 && aMat.y > 0.0) {
    float k = aMat.y / 255.0 * uWind, t = uTime + phase;
    w.xy += vec2(sin(t * 1.7 + w.z * 0.45) + 0.4 * sin(t * 4.1 + w.x), cos(t * 1.31 + w.z * 0.37) + 0.4 * cos(t * 3.7 + w.y)) * k;
  }
  if (uWave > 0.0) w.z += sin(w.x * 0.35 + uTime * 1.3) * cos(w.y * 0.3 + uTime) * uWave;
#ifndef DEPTH
  vNormal = mat3(uModel) * n;
  vColor = toLinear(mix(aColor.rgb, aColor.rgb * tint, weight));
  vWorld = w.xyz;
  vAo = max(aNormal.w, 0.0);
  vNeon = aMat.y / 255.0;
  int id = int(aMat.x + 0.5);
  vMatA = uMatA[id]; vMatB = uMatB[id];
  vec3 nn = normalize(vNormal);
  float nl = dot(nn, uSunDir);
  vShadow = uLightViewProj * vec4(w.xyz + nn * uShadowOffset * (0.35 + 1.4 * sqrt(max(0.0, 1.0 - nl * nl))), 1.0);
#endif
  gl_Position = uViewProj * w;
}`
}

function fragmentShader(level: number) {
  return `#version 300 es
precision highp float;
precision highp sampler2DShadow;
precision highp sampler2DArray;
#define QUALITY ${level}
in vec3 vNormal; in vec3 vColor; in vec3 vWorld; in vec4 vShadow; in float vAo; in float vNeon;
flat in vec4 vMatA; flat in vec4 vMatB;
uniform float uNeon;
uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uGroundColor; uniform vec3 uHorizonColor; uniform vec3 uFogColor; uniform vec3 uSunScatter; uniform vec3 uCamPos;
uniform float uFogDensity; uniform float uFogFalloff; uniform float uExposure;
uniform float uAlpha; uniform float uEmissive; uniform bool uUnlit;
uniform vec4 uHighlight;
uniform float uWave; uniform float uTime; uniform float uGround; uniform float uSpecular;
uniform sampler2DArray uDetail; uniform float uDetailOn;
uniform sampler2DShadow uShadowMap; uniform float uShadowStrength; uniform float uShadowTexel; uniform float uShadowBias;
${SHADER_COMMON}
out vec4 outColor;
const float PI = 3.14159265;
float hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
#if QUALITY == 0
  return vnoise(p);
#else
  return vnoise(p) * 0.5 + vnoise(p * 2.03 + 17.1) * 0.27 + vnoise(p * 4.11 + 3.7) * 0.15 + vnoise(p * 8.3 - 9.2) * 0.08;
#endif
}
vec4 detailTri(vec3 p, vec3 n, float layer, float scale) {
  vec3 w = abs(n);
#if QUALITY == 0
  vec2 uv = w.z >= max(w.x, w.y) ? p.xy : (w.x >= w.y ? p.yz : p.xz);
  return texture(uDetail, vec3(uv * scale, layer));
#else
  w = w * w; w = w * w; w /= (w.x + w.y + w.z);
  return texture(uDetail, vec3(p.yz * scale, layer)) * w.x + texture(uDetail, vec3(p.xz * scale, layer)) * w.y + texture(uDetail, vec3(p.xy * scale, layer)) * w.z;
#endif
}
vec3 bumpNormal(vec3 n, vec3 dpx, vec3 dpy, float h, float k) {
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = (dFdx(h) * r1 + dFdy(h) * r2) * sign(det);
  return normalize(abs(det) * n - g * k);
}
float ign() { return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); }
float shadowAt(vec3 n) {
  if (uShadowStrength <= 0.0) return 1.0;
  vec3 c = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float nl = clamp(dot(n, uSunDir), 0.05, 1.0);
  float z = c.z - uShadowBias * (1.0 + min(4.0, sqrt(1.0 - nl * nl) / nl));
  float sum = 0.0;
#if QUALITY == 0
  vec2 o = vec2(0.5, -0.5) * uShadowTexel;
  sum += texture(uShadowMap, vec3(c.xy + o.xx, z)) + texture(uShadowMap, vec3(c.xy + o.xy, z)) + texture(uShadowMap, vec3(c.xy + o.yx, z)) + texture(uShadowMap, vec3(c.xy + o.yy, z));
  sum *= 0.25;
#else
  float a = ign() * 6.2831853; vec2 cs = vec2(cos(a), sin(a));
  mat2 rot = mat2(cs.x, cs.y, -cs.y, cs.x) * uShadowTexel * ${level === 2 ? '2.4' : '1.9'};
  sum += texture(uShadowMap, vec3(c.xy, z));
  sum += texture(uShadowMap, vec3(c.xy + rot * vec2(-0.94, -0.34), z));
  sum += texture(uShadowMap, vec3(c.xy + rot * vec2(0.94, 0.34), z));
  sum += texture(uShadowMap, vec3(c.xy + rot * vec2(-0.09, -0.92), z));
  sum += texture(uShadowMap, vec3(c.xy + rot * vec2(0.34, 0.94), z));
  sum += texture(uShadowMap, vec3(c.xy + rot * vec2(-0.82, 0.57), z));
  sum += texture(uShadowMap, vec3(c.xy + rot * vec2(0.8, -0.6), z));
  sum += texture(uShadowMap, vec3(c.xy + rot * vec2(-0.4, 0.2) * 1.6, z));
  sum += texture(uShadowMap, vec3(c.xy + rot * vec2(0.45, -0.15) * 1.6, z));
  sum /= 9.0;
#endif
  float edge = smoothstep(0.0, 0.06, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));
  return mix(1.0, sum, uShadowStrength * edge);
}
vec3 envColor(vec3 r) {
  vec3 up = mix(uHorizonColor, uSkyColor * 1.25, smoothstep(0.0, 0.65, r.z));
  return mix(uGroundColor * 0.6, up, smoothstep(-0.18, 0.04, r.z));
}
vec3 envBRDF(vec3 f0, float rough, float nv) {
  vec4 r = rough * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
  float a = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04) * a + r.zw;
  return f0 * ab.x + ab.y;
}
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 finish(vec3 c) {
  c = aces(c * uExposure);
#if QUALITY == 0
  return sqrt(c);
#else
  return pow(c, vec3(1.0 / 2.2));
#endif
}
void main() {
  if (uUnlit) { outColor = vec4(mix(pow(vColor, vec3(1.0 / 2.2)), uHighlight.rgb, uHighlight.a), uAlpha); return; }
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 base = vColor;
  vec3 d = vWorld - uCamPos;
  float dist = length(d);
  vec3 V = -d / max(dist, 1e-4);
  float rough = vMatA.x, metal = vMatA.y, coat = vMatB.x, wrap = vMatB.y;
  vec3 f0d = vec3(vMatB.w);
  float ao = vAo, alpha = uAlpha;
#if QUALITY > 0
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
#endif
  if (uWave > 0.0 || vMatA.z > 6.5) {
    float depth = vAo; ao = 1.0;
    vec2 q = vWorld.xy * 0.085;
    vec4 w1 = texture(uDetail, vec3(q + vec2(uTime * 0.013, uTime * 0.008), 7.0));
#if QUALITY > 0
    vec4 w2 = texture(uDetail, vec3(q * 2.7 + vec2(-uTime * 0.021, uTime * 0.017), 7.0));
#else
    vec4 w2 = vec4(0.5, 0.5, w1.b, w1.a);
#endif
    vec2 slope = ((w1.rg - 0.5) * 1.2 + (w2.rg - 0.5) * 0.8) * uDetailOn;
    n = normalize(vec3(slope * (uWave > 0.0 ? 1.0 : 0.5), 1.0));
    rough = 0.05; metal = 0.0; f0d = vec3(0.02); wrap = 0.0; coat = 0.0;
    if (uWave > 0.0) {
      base = mix(base, base * vec3(0.45, 0.72, 0.9), smoothstep(0.15, 1.0, depth) * 0.6);
      float foam = (1.0 - smoothstep(0.02, 0.2, depth)) * smoothstep(0.3, 0.75, w1.b * 0.7 + w2.b * 0.5) * uDetailOn;
      base = mix(base, vec3(0.8, 0.86, 0.88), foam);
      rough = mix(rough, 0.75, foam);
      alpha = clamp(mix(0.55, 0.97, smoothstep(0.0, 0.8, depth)) + foam, 0.0, 1.0);
    }
  } else if (uDetailOn > 0.0 && vMatA.z >= 0.0) {
    float fade = 1.0 - smoothstep(40.0, 160.0, dist);
    if (uGround > 0.0) {
      vec4 t = texture(uDetail, vec3(vWorld.xy * vMatA.w, vMatA.z));
#if QUALITY > 0
      vec4 macro = texture(uDetail, vec3(vWorld.xy * 0.019 + 0.37, 5.0));
#else
      vec4 macro = vec4(0.5, 0.5, t.b, 0.5);
#endif
      float g = clamp((base.g - max(base.r, base.b)) * 5.0, 0.0, 1.0) * uGround;
      base *= mix(1.0, 0.78 + macro.g * 0.44, uGround);
      float dirt = smoothstep(0.58, 0.82, macro.b * 0.75 + t.b * 0.35) * g;
      base = mix(base, base * vec3(1.35, 0.92, 0.6), dirt * 0.55);
      base = mix(base, base * vec3(1.1, 1.0, 0.78), g * clamp(macro.g - 0.45, 0.0, 1.0) * 0.8);
      base *= mix(1.0, 0.8 + t.g * 0.4, fade);
      ao *= mix(1.0, t.a, 0.55 * fade);
      rough = clamp(rough * (0.8 + t.b * 0.4), 0.04, 1.0);
#if QUALITY > 0
      n = bumpNormal(n, dpx, dpy, t.r, vMatB.z * 0.012 / vMatA.w * fade);
#endif
    } else {
      vec4 t = detailTri(vWorld, n, vMatA.z, vMatA.w);
      base *= mix(1.0, 0.76 + t.g * 0.48, fade);
      rough = clamp(rough * (0.7 + t.b * 0.6), 0.04, 1.0);
      ao *= mix(1.0, t.a, 0.7 * fade);
#if QUALITY > 0
      n = bumpNormal(n, dpx, dpy, t.r, vMatB.z * 0.006 / vMatA.w * fade);
#endif
    }
  }
  rough = clamp(rough, 0.045, 1.0);
  float sh = shadowAt(n);
  vec3 L = uSunDir;
  vec3 H = normalize(L + V);
  float nl = dot(n, L), nlc = clamp(nl, 0.0, 1.0), nv = clamp(dot(n, V), 1e-3, 1.0), nh = clamp(dot(n, H), 0.0, 1.0), vh = clamp(dot(V, H), 0.0, 1.0);
  float nlw = clamp((nl + wrap) / ((1.0 + wrap) * (1.0 + wrap)), 0.0, 1.0);
  vec3 f0 = mix(f0d, base, metal);
  vec3 diffuseColor = base * (1.0 - metal);
  float a2 = rough * rough * rough * rough;
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float k = rough * rough * 0.5;
  float Vis = 0.25 / ((nlc * (1.0 - k) + k) * (nv * (1.0 - k) + k));
  float fw = pow(1.0 - vh, 5.0);
  vec3 F = f0 + (1.0 - f0) * fw;
  vec3 spec = PI * D * Vis * F * nlc * uSpecular;
  vec3 direct = (diffuseColor * (1.0 - F) * nlw + spec);
#if QUALITY > 0
  if (coat > 0.0) {
    float cdd = nh * nh * (0.0016 - 1.0) + 1.0;
    float Fc = (0.04 + 0.96 * fw) * coat;
    direct = direct * (1.0 - Fc) + vec3(0.0016 / (cdd * cdd) * 0.25 / max(vh * vh, 0.1) * Fc * nlc);
  }
#endif
  vec3 lit = direct * uSunColor * sh;
  float hemi = n.z * 0.5 + 0.5;
  float normalAo = mix(0.72, 1.0, smoothstep(-0.6, 0.9, n.z));
  ao *= normalAo;
  vec3 ambient = mix(uGroundColor, uSkyColor, hemi) + uHorizonColor * (1.0 - abs(n.z)) * 0.35;
  vec3 R = reflect(-V, n);
#if QUALITY == 0
  vec3 specAmb = envColor(R) * (f0 + (1.0 - f0) * pow(1.0 - nv, 5.0) * (1.0 - rough)) * (1.0 - rough * 0.7) * ao * uSpecular;
#else
  vec3 specAmb = envColor(R) * envBRDF(f0, rough, nv) * mix(1.0, ao, 0.6) * mix(0.55, 1.0, sh) * uSpecular;
  if (coat > 0.0) specAmb += envColor(R) * (0.04 + 0.96 * pow(1.0 - nv, 5.0)) * coat * 0.6 * ao;
#endif
  vec3 c = lit + diffuseColor * ambient * ao + specAmb + base * uEmissive;
  if (vMatA.z < -1.5) {
    float flash = 0.35 + 0.65 * smoothstep(-0.3, 0.5, sin(uTime * 5.0));
    float on = vNeon < 0.002 ? flash : 0.06 + 0.94 * smoothstep(-0.15, 0.4, sin(uTime * 6.0 - vNeon * 6.2831853));
    c += base * uNeon * on;
  }
  c = mix(c, toLinear(uHighlight.rgb) * 1.6, uHighlight.a);
#if QUALITY == 0
  float fog = 1.0 - exp(-uFogDensity * dist * exp(-uFogFalloff * max(0.0, (uCamPos.z + vWorld.z) * 0.5)));
#else
  float rdz = d.z / max(dist, 1e-4);
  float fall = uFogFalloff;
  float h0 = exp(-fall * max(uCamPos.z, 0.0));
  float integral = abs(rdz * fall * dist) > 1e-3 ? h0 * (1.0 - exp(-fall * rdz * dist)) / (fall * rdz) : h0 * dist;
  float fog = 1.0 - exp(-uFogDensity * max(integral, 0.0));
#endif
  vec3 fogCol = mix(uFogColor, uSunScatter, pow(max(dot(-V, uSunDir), 0.0), 6.0));
  c = mix(c, fogCol, fog);
  outColor = vec4(finish(c), alpha);
}`
}

const DEPTH_FRAG = `#version 300 es
precision mediump float;
void main() {}`

const SKY_VERT = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vNdc;
void main(){ vNdc = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`
const SKY_FRAG = `#version 300 es
precision highp float; in vec2 vNdc; uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSunScatter; uniform mat4 uInvViewProj; uniform float uExposure; out vec4 outColor;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0), b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(b.xyz / b.w - a.xyz / a.w);
  float up = clamp(dir.z, 0.0, 1.0);
  vec3 c = mix(uBottom, uTop, pow(up, 0.38));
  float sd = max(dot(dir, uSunDir), 0.0);
  c += uSunScatter * pow(sd, 6.0) * 0.6 + uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 60.0) * 0.12);
  c = pow(aces(c * uExposure), vec3(1.0 / 2.2));
  outColor = vec4(c, 1.0);
}`

const DETAIL_SIZE = 256, DETAIL_LAYERS = 8

const DETAIL_FRAG = `#version 300 es
precision highp float;
uniform int uLayer; out vec4 o;
float hsh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float pn(vec2 p, vec2 P) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  vec2 j = mod(i + 1.0, P); i = mod(i, P);
  return mix(mix(hsh(i), hsh(vec2(j.x, i.y)), u.x), mix(hsh(vec2(i.x, j.y)), hsh(j), u.x), u.y);
}
float fbm(vec2 uv, vec2 P, int oct) {
  float s = 0.0, a = 0.5, t = 0.0;
  for (int k = 0; k < 6; k++) { if (k >= oct) break; s += pn(uv * P, P) * a; t += a; P *= 2.0; a *= 0.5; }
  return s / t;
}
float wave(vec2 uv) { return fbm(uv, vec2(5.0), 5); }
void main() {
  vec2 uv = gl_FragCoord.xy / ${DETAIL_SIZE}.0;
  vec4 r = vec4(0.5, 0.5, 0.5, 1.0);
  if (uLayer == 0) {
    float h = 0.55 * fbm(uv, vec2(3.0, 128.0), 4) + 0.45 * fbm(uv, vec2(2.0, 40.0), 3);
    r = vec4(h, 0.5 + (h - 0.5) * 0.3, 0.5 + (h - 0.5) * 0.6, 1.0);
  } else if (uLayer == 1) {
    float peel = fbm(uv, vec2(20.0), 3);
    vec2 d = vec2(uv.x + uv.y, uv.x - uv.y);
    float sc = smoothstep(0.88, 0.93, pn(d * vec2(3.0, 190.0), vec2(3.0, 190.0))) * smoothstep(0.45, 0.75, pn(uv * 7.0, vec2(7.0)));
    sc = max(sc, smoothstep(0.9, 0.95, pn(uv * vec2(2.0, 230.0), vec2(2.0, 230.0))) * smoothstep(0.5, 0.8, pn(uv * 5.0 + 3.0, vec2(5.0))));
    r = vec4(0.5 + (peel - 0.5) * 0.4 - sc * 0.35, 0.5 + sc * 0.22 + (peel - 0.5) * 0.06, 0.5 + sc * 0.35, 1.0 - sc * 0.25);
  } else if (uLayer == 2) {
    float b = fbm(uv, vec2(6.0), 5), agg = pn(uv * 44.0, vec2(44.0)), pit = smoothstep(0.78, 0.9, pn(uv * 70.0, vec2(70.0)));
    r = vec4(b * 0.55 + agg * 0.3 - pit * 0.45 + 0.1, 0.5 + (b - 0.5) * 0.55 + (agg - 0.5) * 0.18 - pit * 0.18, 0.5 + (agg - 0.5) * 0.3, 1.0 - pit * 0.55);
  } else if (uLayer == 3) {
    float row = floor(uv.y * 4.0), fy = fract(uv.y * 4.0), rnd = hsh(vec2(row, 7.0));
    float fx = fract(uv.x + rnd * 0.73);
    float seam = smoothstep(0.0, 0.05, fy) * smoothstep(1.0, 0.95, fy) * smoothstep(0.0, 0.012, fx) * smoothstep(1.0, 0.988, fx);
    float grain = fract((uv.y * 4.0 + pn(uv * vec2(2.0, 16.0), vec2(2.0, 16.0)) * 0.9 + rnd) * 6.0);
    grain = smoothstep(0.0, 0.5, grain) * smoothstep(1.0, 0.6, grain);
    float fine = pn(uv * vec2(4.0, 160.0), vec2(4.0, 160.0));
    r = vec4(seam * (0.72 + grain * 0.12 + fine * 0.08), 0.32 + rnd * 0.32 + grain * 0.16 + fine * 0.06 - (1.0 - seam) * 0.25, 0.5 + (fine - 0.5) * 0.3, mix(0.35, 1.0, seam));
  } else if (uLayer == 4) {
    float w = fbm(uv, vec2(3.0), 3), s = pn(uv * 90.0, vec2(90.0));
    r = vec4(0.5 + (w - 0.5) * 0.4 + (s - 0.5) * 0.04, 0.5 + (w - 0.5) * 0.06, 0.5 + (w - 0.5) * 0.25, 1.0);
  } else if (uLayer == 5) {
    float bl = fbm(uv, vec2(40.0), 3), cl = fbm(uv, vec2(5.0), 4), dm = fbm(uv + 0.31, vec2(3.0), 5);
    r = vec4(bl * 0.7 + cl * 0.3, 0.5 + (bl - 0.5) * 0.55 + (cl - 0.5) * 0.45, dm, 0.62 + bl * 0.38);
  } else if (uLayer == 6) {
    float row = floor(uv.y * 4.0), x = uv.x * 2.0 + mod(row, 2.0) * 0.5;
    float fx = fract(x), fy = fract(uv.y * 4.0);
    float e = min(min(fx, 1.0 - fx) * 0.5, min(fy, 1.0 - fy) * 0.25);
    float mortar = 1.0 - smoothstep(0.004, 0.011, e);
    float id = hsh(vec2(floor(x), row) + 3.0), nz = fbm(uv, vec2(24.0), 3);
    r = vec4((1.0 - mortar) * (0.7 + nz * 0.2) + e * 2.0, 0.5 + (id - 0.5) * 0.4 - mortar * 0.3 + (nz - 0.5) * 0.12, 0.5 + (nz - 0.5) * 0.3 + mortar * 0.2, 1.0 - mortar * 0.6);
  } else {
    float e = 1.0 / ${DETAIL_SIZE}.0;
    float h = wave(uv), hx = wave(uv + vec2(e, 0.0)) - wave(uv - vec2(e, 0.0)), hy = wave(uv + vec2(0.0, e)) - wave(uv - vec2(0.0, e));
    vec3 n = normalize(vec3(-hx * 18.0, -hy * 18.0, 1.0));
    r = vec4(n.xy * 0.5 + 0.5, smoothstep(0.55, 0.78, fbm(uv + 0.5, vec2(10.0), 4)), h);
  }
  o = clamp(r, 0.0, 1.0);
}`

const FXAA_FRAG = `#version 300 es
precision highp float; in vec2 vNdc; uniform sampler2D uScene; uniform vec2 uTexel; out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  vec3 m = texture(uScene, uv).rgb;
  vec3 nw = texture(uScene, uv + vec2(-1.0, 1.0) * uTexel).rgb, ne = texture(uScene, uv + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 sw = texture(uScene, uv + vec2(-1.0, -1.0) * uTexel).rgb, se = texture(uScene, uv + vec2(1.0, -1.0) * uTexel).rgb;
  float lm = luma(m), lnw = luma(nw), lne = luma(ne), lsw = luma(sw), lse = luma(se);
  float lo = min(lm, min(min(lnw, lne), min(lsw, lse))), hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
  if (hi - lo < max(0.0312, hi * 0.125)) { o = vec4(m, 1.0); return; }
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * uTexel;
  vec3 a = 0.5 * (texture(uScene, uv - dir / 6.0).rgb + texture(uScene, uv + dir / 6.0).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture(uScene, uv - dir * 0.5).rgb + texture(uScene, uv + dir * 0.5).rgb);
  float lb = luma(b);
  o = vec4(lb < lo || lb > hi ? a : b, 1.0);
}`

const SHADOW_SIZE = 2048
const UNIFORMS = ['uDetail', 'uDetailOn', 'uViewProj', 'uModel', 'uLightViewProj', 'uInstanced', 'uTint', 'uSunDir', 'uSunColor', 'uSkyColor', 'uGroundColor', 'uHorizonColor', 'uFogColor', 'uSunScatter', 'uCamPos', 'uFogDensity', 'uFogFalloff', 'uExposure', 'uAlpha', 'uEmissive', 'uUnlit', 'uHighlight', 'uTime', 'uWave', 'uWind', 'uGround', 'uSpecular', 'uShadowMap', 'uShadowStrength', 'uShadowTexel', 'uShadowOffset', 'uShadowBias', 'uMatA', 'uMatB', 'uSlots', 'uNeon']
const SKY_UNIFORMS = ['uTop', 'uBottom', 'uSunDir', 'uSunColor', 'uSunScatter', 'uInvViewProj', 'uExposure']

type Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }

export class Gl {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  depthProgram: WebGLProgram
  sky: WebGLProgram
  skyU: Record<string, WebGLUniformLocation | null> = {}
  skyVao: WebGLVertexArrayObject
  u: Record<string, WebGLUniformLocation | null> = {}
  mainU: Record<string, WebGLUniformLocation | null> = {}
  depthU: Record<string, WebGLUniformLocation | null> = {}
  viewProj: Mat4 = mat4.identity()
  invViewProj: Mat4 = mat4.identity()
  lightViewProj: Mat4 = mat4.identity()
  camPos: Vec3 = [0, 0, 0]
  identity = mat4.identity()
  shadowPass = false
  shadowTexture: WebGLTexture | null = null
  shadowFbo: WebGLFramebuffer | null = null
  detail: WebGLTexture | null = null
  shadowTexel = 1 / SHADOW_SIZE
  shadowOffset = 0.05
  shadowBias = 0.0004
  level = 1
  stats = { shadowDraws: 0, mainDraws: 0, shadowVerts: 0, mainVerts: 0, instanceBytes: 0 }
  extensions = { anisotropic: null as EXT_texture_filter_anisotropic | null, colorBufferFloat: false }
  private programs = new Map<number, Program>()
  private materials = materialTable()

  constructor(canvas: HTMLCanvasElement, level = 1) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })
    if (!gl) throw new Error('Your browser does not support WebGL 2, which the park needs to draw in 3D.')
    this.gl = gl
    this.extensions.anisotropic = gl.getExtension('EXT_texture_filter_anisotropic')
    this.extensions.colorBufferFloat = !!gl.getExtension('EXT_color_buffer_float')
    this.depthProgram = this.compile(vertexShader(true), DEPTH_FRAG)
    for (const name of UNIFORMS) this.depthU[name] = gl.getUniformLocation(this.depthProgram, name)
    this.level = level
    const main = this.mainProgram(level)
    this.program = main.program; this.mainU = main.u
    this.sky = this.compile(SKY_VERT, SKY_FRAG)
    for (const name of SKY_UNIFORMS) this.skyU[name] = gl.getUniformLocation(this.sky, name)
    this.u = this.mainU
    this.skyVao = gl.createVertexArray()!
    gl.bindVertexArray(this.skyVao)
    const b = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.initShadows()
    this.initDetail()
  }

  private initDetail() {
    const gl = this.gl
    try {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(DETAIL_SIZE) + 1, gl.RGBA8, DETAIL_SIZE, DETAIL_SIZE, DETAIL_LAYERS)
      const program = this.compile(SKY_VERT, DETAIL_FRAG), layerU = gl.getUniformLocation(program, 'uLayer')
      const fbo = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.useProgram(program); gl.viewport(0, 0, DETAIL_SIZE, DETAIL_SIZE); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND)
      gl.bindVertexArray(this.skyVao)
      for (let layer = 0; layer < DETAIL_LAYERS; layer++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, layer)
        gl.uniform1i(layerU, layer)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      gl.bindVertexArray(null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(fbo); gl.deleteProgram(program)
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
      this.detail = tex
      this.setAnisotropy(this.level === 2 ? 8 : this.level === 1 ? 2 : 1)
    } catch { this.detail = null }
  }

  private setAnisotropy(amount: number) {
    const gl = this.gl, ext = this.extensions.anisotropic
    if (!ext || !this.detail) return
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.detail)
    gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(amount, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
  }

  private mainProgram(level: number): Program {
    let entry = this.programs.get(level)
    if (!entry) {
      const gl = this.gl
      const program = this.compile(vertexShader(false), fragmentShader(level))
      const u: Record<string, WebGLUniformLocation | null> = {}
      for (const name of UNIFORMS) u[name] = gl.getUniformLocation(program, name)
      gl.useProgram(program)
      gl.uniform4fv(u.uMatA, this.materials.a); gl.uniform4fv(u.uMatB, this.materials.b)
      entry = { program, u }
      this.programs.set(level, entry)
    }
    return entry
  }

  setLevel(level: number) {
    if (level === this.level) return
    const entry = this.mainProgram(level)
    this.level = level; this.program = entry.program; this.mainU = entry.u
    this.setAnisotropy(level === 2 ? 8 : level === 1 ? 2 : 1)
    if (!this.shadowPass) this.u = this.mainU
  }

  private initShadows() {
    const gl = this.gl
    try {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL)
      const fbo = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0)
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE)
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.bindTexture(gl.TEXTURE_2D, null)
      if (ok) { this.shadowTexture = tex; this.shadowFbo = fbo }
      else { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo) }
    } catch { this.shadowTexture = null; this.shadowFbo = null }
  }

  get shadowsAvailable() { return !!this.shadowFbo }

  compile(vs: string, fs: string) {
    const gl = this.gl
    const make = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader failed to compile.')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs)); gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Shader failed to link.')
    return p
  }

  upload(builder: MeshBuilder, previous?: GpuMesh | null, instanced = false): GpuMesh | null {
    const gl = this.gl
    if (previous) this.free(previous)
    if (!builder.count) return null
    const { vertices, indices, unique } = packMesh(builder)
    const vao = gl.createVertexArray()!, buffer = gl.createBuffer()!, index = gl.createBuffer()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, BYTES, 0)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.BYTE, true, BYTES, 12)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, BYTES, 16)
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, false, BYTES, 20)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    const mesh: GpuMesh = { vao, buffer, index, indexType: indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, count: indices.length, vertexCount: unique, mode: builder.lines ? gl.LINES : gl.TRIANGLES, instanceCount: 0, instanceCapacity: 0 }
    if (instanced) {
      mesh.instance = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instance)
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(3, 1)
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(4, 1)
    }
    gl.bindVertexArray(null)
    return mesh
  }

  setInstances(mesh: GpuMesh | null, data: Float32Array, count: number) {
    if (!mesh?.instance) return
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instance)
    if (count > mesh.instanceCapacity) { mesh.instanceCapacity = Math.max(count, Math.ceil(mesh.instanceCapacity * 1.5), 64); gl.bufferData(gl.ARRAY_BUFFER, mesh.instanceCapacity * 32, gl.DYNAMIC_DRAW) }
    if (count > 0) { gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 8); this.stats.instanceBytes += count * 32 }
    mesh.instanceCount = count
  }

  free(mesh: GpuMesh) {
    const gl = this.gl
    gl.deleteVertexArray(mesh.vao); gl.deleteBuffer(mesh.buffer); gl.deleteBuffer(mesh.index)
    if (mesh.instance) gl.deleteBuffer(mesh.instance)
  }

  beginShadow(lightViewProj: Mat4, texelWorld: number, time = 0) {
    const gl = this.gl
    if (!this.shadowFbo) return false
    this.lightViewProj = lightViewProj
    this.shadowTexel = 1 / SHADOW_SIZE
    this.shadowOffset = Math.max(0.02, texelWorld * 1.5)
    this.shadowPass = true
    this.u = this.depthU
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo)
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.disable(gl.BLEND); gl.depthMask(true)
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.6, 2.5)
    gl.useProgram(this.depthProgram)
    gl.uniformMatrix4fv(this.u.uViewProj, false, lightViewProj)
    gl.uniform1f(this.u.uWave, 0); gl.uniform1i(this.u.uInstanced, 0); gl.uniform1f(this.u.uWind, 0); gl.uniform1f(this.u.uTime, time)
    return true
  }

  endShadow() {
    const gl = this.gl
    gl.disable(gl.POLYGON_OFFSET_FILL)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.shadowPass = false
    this.u = this.mainU
  }

  windLevel = 0

  private post: { fbo: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer; resolveFbo: WebGLFramebuffer; resolve: WebGLTexture; w: number; h: number } | null = null
  private postProgram: Program | null = null
  private postActive = false

  /** Routes the next frame into a multisampled target so `endPost` can resolve it and run FXAA. Returns false if unsupported. */
  beginPost(width: number, height: number) {
    const gl = this.gl
    try {
      if (!this.post || this.post.w !== width || this.post.h !== height) {
        if (this.post) { gl.deleteFramebuffer(this.post.fbo); gl.deleteRenderbuffer(this.post.color); gl.deleteRenderbuffer(this.post.depth); gl.deleteFramebuffer(this.post.resolveFbo); gl.deleteTexture(this.post.resolve) }
        const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number)
        const fbo = gl.createFramebuffer()!, color = gl.createRenderbuffer()!, depth = gl.createRenderbuffer()!
        gl.bindRenderbuffer(gl.RENDERBUFFER, color); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height)
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height)
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color)
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth)
        const resolve = gl.createTexture()!, resolveFbo = gl.createFramebuffer()!
        gl.bindTexture(gl.TEXTURE_2D, resolve); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resolve, 0)
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null)
        this.post = { fbo, color, depth, resolveFbo, resolve, w: width, h: height }
        if (!ok) { this.post = null; return false }
      }
      if (!this.postProgram) {
        const program = this.compile(SKY_VERT, FXAA_FRAG)
        this.postProgram = { program, u: { uScene: gl.getUniformLocation(program, 'uScene'), uTexel: gl.getUniformLocation(program, 'uTexel') } }
      }
      this.postActive = true
      return true
    } catch { this.post = null; return false }
  }

  freePost() {
    const gl = this.gl, p = this.post
    if (!p) return
    gl.deleteFramebuffer(p.fbo); gl.deleteRenderbuffer(p.color); gl.deleteRenderbuffer(p.depth); gl.deleteFramebuffer(p.resolveFbo); gl.deleteTexture(p.resolve)
    this.post = null
  }

  endPost() {
    if (!this.postActive || !this.post || !this.postProgram) return
    const gl = this.gl, p = this.post
    this.postActive = false
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, p.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, p.resolveFbo)
    gl.blitFramebuffer(0, 0, p.w, p.h, 0, 0, p.w, p.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, p.w, p.h)
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true)
    gl.useProgram(this.postProgram.program)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, p.resolve)
    gl.uniform1i(this.postProgram.u.uScene, 2); gl.uniform2f(this.postProgram.u.uTexel, 1 / p.w, 1 / p.h)
    gl.bindVertexArray(this.skyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null)
    gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0)
    gl.enable(gl.DEPTH_TEST)
  }

  begin(width: number, height: number, view: Mat4, proj: Mat4, cam: Vec3, light: Lighting, time: number, shadowStrength = 0) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.postActive && this.post ? this.post.fbo : null)
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    mat4.multiply(proj, view, this.viewProj)
    mat4.invert(this.viewProj, this.invViewProj)
    gl.useProgram(this.sky)
    gl.disable(gl.DEPTH_TEST)
    const su = this.skyU
    gl.uniform3fv(su.uTop, light.skyTop); gl.uniform3fv(su.uBottom, light.skyBottom); gl.uniform3fv(su.uSunDir, light.sunDir); gl.uniform3fv(su.uSunColor, light.sunColor)
    gl.uniform3fv(su.uSunScatter, light.sunScatter); gl.uniformMatrix4fv(su.uInvViewProj, false, this.invViewProj); gl.uniform1f(su.uExposure, light.exposure)
    gl.bindVertexArray(this.skyVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    gl.useProgram(this.program)
    this.u = this.mainU
    this.camPos = cam
    const u = this.u
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj)
    gl.uniform3fv(u.uSunDir, light.sunDir); gl.uniform3fv(u.uSunColor, light.sunColor); gl.uniform3fv(u.uSkyColor, light.sky); gl.uniform3fv(u.uGroundColor, light.ground)
    gl.uniform3fv(u.uHorizonColor, light.horizon); gl.uniform3fv(u.uSunScatter, light.sunScatter); gl.uniform1f(u.uExposure, light.exposure)
    gl.uniform3fv(u.uFogColor, light.fog); gl.uniform3fv(u.uCamPos, cam); gl.uniform1f(u.uFogDensity, light.fogDensity); gl.uniform1f(u.uFogFalloff, light.fogFalloff)
    gl.uniform1f(u.uTime, time); gl.uniform1f(u.uWave, 0); gl.uniform1f(u.uWind, 0); gl.uniform1f(u.uNeon, light.neon ?? 0.6)
    this.windLevel = light.wind
    const shadows = shadowStrength > 0 && !!this.shadowTexture
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, shadows ? this.shadowTexture : null)
    gl.uniform1i(u.uShadowMap, 0)
    gl.uniform1f(u.uShadowStrength, shadows ? shadowStrength : 0)
    gl.uniform1f(u.uShadowTexel, this.shadowTexel)
    gl.uniform1f(u.uShadowOffset, shadows ? this.shadowOffset : 0)
    gl.uniform1f(u.uShadowBias, this.shadowBias)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.detail)
    gl.uniform1i(u.uDetail, 1); gl.uniform1f(u.uDetailOn, this.detail ? 1 : 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniformMatrix4fv(u.uLightViewProj, false, this.lightViewProj)
    this.reset()
  }

  private slotBuffer = new Float32Array(27)

  reset() {
    const gl = this.gl, u = this.u
    gl.uniform1f(u.uAlpha, 1); gl.uniform1f(u.uEmissive, 0); gl.uniform1i(u.uUnlit, 0); gl.uniform4f(u.uHighlight, 0, 0, 0, 0); gl.uniform3f(u.uTint, 1, 1, 1)
    gl.uniform1f(u.uGround, 0); gl.uniform1f(u.uSpecular, 1)
    gl.disable(gl.BLEND); gl.depthMask(true)
  }

  draw(mesh: GpuMesh | null, model: Mat4 = this.identity, opts: { tint?: Vec3; slots?: Vec3[]; alpha?: number; emissive?: number; unlit?: boolean; highlight?: [number, number, number, number]; wave?: number; noCull?: boolean; noDepthWrite?: boolean; ground?: number; specular?: number } = {}) {
    if (!mesh) return
    if (this.shadowPass && ((opts.alpha !== undefined && opts.alpha < 1) || opts.unlit || opts.wave || mesh.mode !== this.gl.TRIANGLES)) return
    const gl = this.gl, u = this.u
    gl.uniformMatrix4fv(u.uModel, false, model)
    gl.uniform1i(u.uInstanced, 0)
    if (this.shadowPass) {
      this.stats.shadowDraws++; this.stats.shadowVerts += mesh.count
      if (opts.noCull) gl.disable(gl.CULL_FACE)
      gl.bindVertexArray(mesh.vao); gl.drawElements(mesh.mode, mesh.count, mesh.indexType, 0)
      if (opts.noCull) gl.enable(gl.CULL_FACE)
      return
    }
    this.stats.mainDraws++; this.stats.mainVerts += mesh.count
    if (opts.tint) gl.uniform3fv(u.uTint, opts.tint)
    if (opts.slots) { const f = this.slotBuffer; for (let i = 0; i < 9; i++) { const c = opts.slots[i + 1]; f[i * 3] = c ? c[0] : 1; f[i * 3 + 1] = c ? c[1] : 1; f[i * 3 + 2] = c ? c[2] : 1 } gl.uniform3fv(u.uSlots, f); if (!opts.tint && opts.slots[0]) gl.uniform3fv(u.uTint, opts.slots[0]) }
    if (opts.alpha !== undefined && opts.alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(u.uAlpha, opts.alpha); gl.depthMask(false) }
    if (opts.noDepthWrite) gl.depthMask(false)
    if (opts.emissive) gl.uniform1f(u.uEmissive, opts.emissive)
    if (opts.unlit) gl.uniform1i(u.uUnlit, 1)
    if (opts.highlight) gl.uniform4fv(u.uHighlight, opts.highlight)
    if (opts.wave) gl.uniform1f(u.uWave, opts.wave)
    if (opts.ground) gl.uniform1f(u.uGround, opts.ground)
    if (opts.specular !== undefined) gl.uniform1f(u.uSpecular, opts.specular)
    if (opts.noCull) gl.disable(gl.CULL_FACE)
    gl.bindVertexArray(mesh.vao)
    gl.drawElements(mesh.mode, mesh.count, mesh.indexType, 0)
    if (opts.noCull) gl.enable(gl.CULL_FACE)
    if (opts.wave) gl.uniform1f(u.uWave, 0)
    if (opts.tint || opts.slots || opts.alpha !== undefined || opts.emissive || opts.unlit || opts.highlight || opts.noDepthWrite || opts.ground || opts.specular !== undefined) this.reset()
  }

  drawInstanced(mesh: GpuMesh | null, opts: { emissive?: number; alpha?: number; specular?: number; wind?: number } = {}) {
    if (!mesh || !mesh.instanceCount) return
    if (this.shadowPass && ((opts.alpha !== undefined && opts.alpha < 1) || opts.emissive)) return
    const gl = this.gl, u = this.u
    gl.uniformMatrix4fv(u.uModel, false, this.identity)
    gl.uniform1i(u.uInstanced, 1)
    const wind = opts.wind ? opts.wind * this.windLevel : 0
    if (wind) gl.uniform1f(u.uWind, wind)
    if (this.shadowPass) {
      this.stats.shadowDraws++; this.stats.shadowVerts += mesh.count * mesh.instanceCount
      gl.bindVertexArray(mesh.vao); gl.drawElementsInstanced(mesh.mode, mesh.count, mesh.indexType, 0, mesh.instanceCount)
      gl.uniform1i(u.uInstanced, 0); if (wind) gl.uniform1f(u.uWind, 0); return
    }
    this.stats.mainDraws++; this.stats.mainVerts += mesh.count * mesh.instanceCount
    if (opts.emissive) gl.uniform1f(u.uEmissive, opts.emissive)
    if (opts.specular !== undefined) gl.uniform1f(u.uSpecular, opts.specular)
    if (opts.alpha !== undefined && opts.alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(u.uAlpha, opts.alpha); gl.depthMask(false) }
    gl.bindVertexArray(mesh.vao)
    gl.drawElementsInstanced(mesh.mode, mesh.count, mesh.indexType, 0, mesh.instanceCount)
    gl.uniform1i(u.uInstanced, 0)
    if (wind) gl.uniform1f(u.uWind, 0)
    if (opts.emissive || opts.alpha !== undefined || opts.specular !== undefined) this.reset()
  }

  /** Times a fixed fragment workload (synchronised with a 1-pixel read) to pick a quality tier. */
  probe(): number {
    const gl = this.gl
    try {
      const size = 256
      const tex = gl.createTexture(), fbo = gl.createFramebuffer()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      const program = this.compile(SKY_VERT, `#version 300 es
precision highp float; in vec2 vNdc; out vec4 o;
void main(){ vec2 p = vNdc * 9.0; float a = 0.0; for (int i = 0; i < 48; i++) { p = vec2(p.x * p.x - p.y * p.y, 2.0 * p.x * p.y) * 0.5 + vNdc; a += sin(p.x) * cos(p.y); } o = vec4(a, a * 0.5, 0.2, 1.0); }`)
      gl.useProgram(program)
      gl.viewport(0, 0, size, size)
      gl.disable(gl.DEPTH_TEST)
      gl.bindVertexArray(this.skyVao)
      const px = new Uint8Array(4)
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      const t0 = performance.now()
      for (let i = 0; i < 4; i++) gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      const ms = performance.now() - t0
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteProgram(program)
      gl.bindVertexArray(null)
      return ms
    } catch { return 99 }
  }
}

export class InstanceList {
  data: Float32Array
  count = 0
  constructor(capacity = 256) { this.data = new Float32Array(capacity * 8) }
  clear() { this.count = 0 }
  push(x: number, y: number, z: number, yaw: number, r: number, g: number, b: number, scale = 1) {
    if ((this.count + 1) * 8 > this.data.length) { const next = new Float32Array(this.data.length * 2); next.set(this.data); this.data = next }
    const o = this.count * 8
    this.data[o] = x; this.data[o + 1] = y; this.data[o + 2] = z; this.data[o + 3] = yaw; this.data[o + 4] = r; this.data[o + 5] = g; this.data[o + 6] = b; this.data[o + 7] = scale
    this.count++
  }
}
