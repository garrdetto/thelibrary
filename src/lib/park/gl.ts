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
  invert(a: Mat4): Mat4 | null {
    const m = new Float32Array(16)
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

export const STRIDE = 10

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

export class MeshBuilder {
  data: number[] = []
  lines = false

  vertex(p: Vec3, n: Vec3, c: Vec3, tint = 0) { this.data.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], tint) }

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
}

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in vec4 iPosYaw;
layout(location=4) in vec4 iColorScale;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat4 uLightViewProj;
uniform bool uInstanced;
uniform vec3 uTint;
uniform float uTime;
uniform float uWave;
uniform float uShadowOffset;
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
out vec4 vShadow;
void main() {
  vec3 p = aPos; vec3 n = aNormal; vec3 tint = uTint;
  if (uInstanced) {
    float c = cos(iPosYaw.w), s = sin(iPosYaw.w);
    p = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z) * iColorScale.w + iPosYaw.xyz;
    n = vec3(c * n.x - s * n.y, s * n.x + c * n.y, n.z);
    tint = iColorScale.rgb;
  }
  vec4 w = uModel * vec4(p, 1.0);
  if (uWave > 0.0) w.z += sin(w.x * 0.35 + uTime * 1.3) * cos(w.y * 0.3 + uTime) * uWave;
  vNormal = mat3(uModel) * n;
  vColor = mix(aColor.rgb, aColor.rgb * tint, aColor.a);
  vWorld = w.xyz;
  vShadow = uLightViewProj * vec4(w.xyz + normalize(vNormal) * uShadowOffset, 1.0);
  gl_Position = uViewProj * w;
}`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vNormal; in vec3 vColor; in vec3 vWorld; in vec4 vShadow;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uGroundColor; uniform vec3 uFogColor; uniform vec3 uCamPos;
uniform float uFogNear; uniform float uFogFar; uniform float uAlpha; uniform float uEmissive; uniform bool uUnlit;
uniform vec4 uHighlight;
uniform float uWave; uniform float uTime; uniform float uGround; uniform float uSpecular;
uniform sampler2DShadow uShadowMap; uniform float uShadowStrength; uniform float uShadowTexel;
out vec4 outColor;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.5 + vnoise(p * 2.03 + 17.1) * 0.27 + vnoise(p * 4.11 + 3.7) * 0.15 + vnoise(p * 8.3 - 9.2) * 0.08; }
float shadowAt() {
  if (uShadowStrength <= 0.0) return 1.0;
  vec3 c = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) sum += texture(uShadowMap, vec3(c.xy + vec2(float(x), float(y)) * uShadowTexel, c.z - 0.0008));
  float edge = smoothstep(0.0, 0.08, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));
  return mix(1.0, sum / 9.0, uShadowStrength * edge);
}
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 base = vColor;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 c;
  if (uUnlit) c = base;
  else {
    if (uGround > 0.0) {
      float big = fbm(vWorld.xy * 0.045), mid = fbm(vWorld.xy * 0.22 + 31.0), fine = vnoise(vWorld.xy * 2.7);
      base *= mix(1.0, 0.82 + big * 0.3 + (mid - 0.5) * 0.16 + (fine - 0.5) * 0.1, uGround);
      float g = max(0.0, base.g - max(base.r, base.b));
      base = mix(base, base * vec3(1.08, 0.96, 0.78), g * (big - 0.45) * 1.6 * uGround);
    }
    if (uWave > 0.0) {
      vec2 q = vWorld.xy * 0.6 + vec2(uTime * 0.35, uTime * 0.22);
      n = normalize(n + vec3(vnoise(q) - 0.5, vnoise(q * 1.7 + 8.0) - 0.5, 0.0) * 0.35);
    }
    float sh = shadowAt();
    float d = max(dot(n, uSunDir), 0.0);
    float wrap = max((dot(n, uSunDir) + 0.25) / 1.25, 0.0);
    float h = n.z * 0.5 + 0.5;
    vec3 amb = mix(uGroundColor, uSkyColor, h);
    float ao = mix(0.72, 1.0, smoothstep(-0.6, 0.9, n.z));
    vec3 diffuse = uSunColor * mix(d, wrap, 0.35) * sh;
    c = base * (amb * ao + diffuse) + base * uEmissive;
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(n, H), 0.0), uWave > 0.0 ? 90.0 : 28.0) * (uWave > 0.0 ? 1.4 : uSpecular);
    c += uSunColor * spec * sh;
    float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
    c += uSkyColor * fres * (uWave > 0.0 ? 0.55 : 0.12);
  }
  c = mix(c, uHighlight.rgb, uHighlight.a);
  c = c * (1.0 + c * 0.12) / (1.0 + c * 0.55);
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.06);
  float dist = length(vWorld - uCamPos);
  float f = smoothstep(uFogNear, uFogFar, dist);
  outColor = vec4(mix(c, uFogColor, f), uAlpha);
}`

const DEPTH_FRAG = `#version 300 es
precision mediump float;
void main() {}`

const SKY_VERT = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.9999, 1.0); }`
const SKY_FRAG = `#version 300 es
precision highp float; in vec2 vUv; uniform vec3 uTop; uniform vec3 uBottom; out vec4 outColor;
void main(){
  vec3 c = mix(uBottom, uTop, pow(clamp(vUv.y, 0.0, 1.0), 0.8));
  c = c * (1.0 + c * 0.12) / (1.0 + c * 0.55);
  outColor = vec4(c, 1.0);
}`

export type GpuMesh = { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number; mode: number; instance?: WebGLBuffer; instanceCount: number; instanceCapacity: number }

export type Lighting = { sunDir: Vec3; sunColor: Vec3; sky: Vec3; ground: Vec3; fog: Vec3; fogNear: number; fogFar: number; skyTop: Vec3; skyBottom: Vec3; shadow?: number }

const SHADOW_SIZE = 2048
const UNIFORMS = ['uViewProj', 'uModel', 'uLightViewProj', 'uInstanced', 'uTint', 'uSunDir', 'uSunColor', 'uSkyColor', 'uGroundColor', 'uFogColor', 'uCamPos', 'uFogNear', 'uFogFar', 'uAlpha', 'uEmissive', 'uUnlit', 'uHighlight', 'uTime', 'uWave', 'uGround', 'uSpecular', 'uShadowMap', 'uShadowStrength', 'uShadowTexel', 'uShadowOffset']

export class Gl {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  depthProgram: WebGLProgram
  sky: WebGLProgram
  skyVao: WebGLVertexArrayObject
  u: Record<string, WebGLUniformLocation | null> = {}
  mainU: Record<string, WebGLUniformLocation | null> = {}
  depthU: Record<string, WebGLUniformLocation | null> = {}
  viewProj: Mat4 = mat4.identity()
  lightViewProj: Mat4 = mat4.identity()
  camPos: Vec3 = [0, 0, 0]
  identity = mat4.identity()
  shadowPass = false
  shadowTexture: WebGLTexture | null = null
  shadowFbo: WebGLFramebuffer | null = null
  shadowTexel = 1 / SHADOW_SIZE
  shadowOffset = 0.05
  stats = { shadowDraws: 0, mainDraws: 0, shadowVerts: 0, mainVerts: 0, instanceBytes: 0 }

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })
    if (!gl) throw new Error('Your browser does not support WebGL 2, which the park needs to draw in 3D.')
    this.gl = gl
    this.program = this.compile(VERT, FRAG)
    this.depthProgram = this.compile(VERT, DEPTH_FRAG)
    this.sky = this.compile(SKY_VERT, SKY_FRAG)
    for (const name of UNIFORMS) { this.mainU[name] = gl.getUniformLocation(this.program, name); this.depthU[name] = gl.getUniformLocation(this.depthProgram, name) }
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
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs)); gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Shader failed to link.')
    return p
  }

  upload(builder: MeshBuilder, previous?: GpuMesh | null, instanced = false): GpuMesh | null {
    const gl = this.gl
    if (previous) this.free(previous)
    if (!builder.count) return null
    const vao = gl.createVertexArray()!, buffer = gl.createBuffer()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(builder.data), gl.STATIC_DRAW)
    const bytes = STRIDE * 4
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, bytes, 12)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, bytes, 24)
    const mesh: GpuMesh = { vao, buffer, count: builder.count, mode: builder.lines ? gl.LINES : gl.TRIANGLES, instanceCount: 0, instanceCapacity: 0 }
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
    gl.deleteVertexArray(mesh.vao); gl.deleteBuffer(mesh.buffer)
    if (mesh.instance) gl.deleteBuffer(mesh.instance)
  }

  beginShadow(lightViewProj: Mat4, extent: number) {
    const gl = this.gl
    if (!this.shadowFbo) return false
    this.lightViewProj = lightViewProj
    this.shadowTexel = 1 / SHADOW_SIZE
    this.shadowOffset = Math.max(0.03, extent * 2 / SHADOW_SIZE * 1.2)
    this.shadowPass = true
    this.u = this.depthU
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo)
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true)
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.5, 4)
    gl.useProgram(this.depthProgram)
    gl.uniformMatrix4fv(this.u.uViewProj, false, lightViewProj)
    gl.uniformMatrix4fv(this.u.uLightViewProj, false, lightViewProj)
    gl.uniform1f(this.u.uShadowOffset, 0); gl.uniform1f(this.u.uWave, 0); gl.uniform1i(this.u.uInstanced, 0)
    return true
  }

  endShadow() {
    const gl = this.gl
    gl.disable(gl.POLYGON_OFFSET_FILL)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.shadowPass = false
    this.u = this.mainU
  }

  begin(width: number, height: number, view: Mat4, proj: Mat4, cam: Vec3, light: Lighting, time: number, shadowStrength = 0) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.clearColor(light.skyBottom[0], light.skyBottom[1], light.skyBottom[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(this.sky)
    gl.disable(gl.DEPTH_TEST)
    gl.uniform3fv(gl.getUniformLocation(this.sky, 'uTop'), light.skyTop)
    gl.uniform3fv(gl.getUniformLocation(this.sky, 'uBottom'), light.skyBottom)
    gl.bindVertexArray(this.skyVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    gl.useProgram(this.program)
    this.u = this.mainU
    this.viewProj = mat4.multiply(proj, view)
    this.camPos = cam
    const u = this.u
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj)
    gl.uniform3fv(u.uSunDir, light.sunDir); gl.uniform3fv(u.uSunColor, light.sunColor); gl.uniform3fv(u.uSkyColor, light.sky); gl.uniform3fv(u.uGroundColor, light.ground)
    gl.uniform3fv(u.uFogColor, light.fog); gl.uniform3fv(u.uCamPos, cam); gl.uniform1f(u.uFogNear, light.fogNear); gl.uniform1f(u.uFogFar, light.fogFar)
    gl.uniform1f(u.uTime, time); gl.uniform1f(u.uWave, 0)
    const shadows = shadowStrength > 0 && !!this.shadowTexture
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, shadows ? this.shadowTexture : null)
    gl.uniform1i(u.uShadowMap, 0)
    gl.uniform1f(u.uShadowStrength, shadows ? shadowStrength : 0)
    gl.uniform1f(u.uShadowTexel, this.shadowTexel)
    gl.uniform1f(u.uShadowOffset, shadows ? this.shadowOffset : 0)
    gl.uniformMatrix4fv(u.uLightViewProj, false, this.lightViewProj)
    this.reset()
  }

  reset() {
    const gl = this.gl, u = this.u
    gl.uniform1f(u.uAlpha, 1); gl.uniform1f(u.uEmissive, 0); gl.uniform1i(u.uUnlit, 0); gl.uniform4f(u.uHighlight, 0, 0, 0, 0); gl.uniform3f(u.uTint, 1, 1, 1)
    gl.uniform1f(u.uGround, 0); gl.uniform1f(u.uSpecular, 0.22)
    gl.disable(gl.BLEND); gl.depthMask(true)
  }

  draw(mesh: GpuMesh | null, model: Mat4 = this.identity, opts: { tint?: Vec3; alpha?: number; emissive?: number; unlit?: boolean; highlight?: [number, number, number, number]; wave?: number; noCull?: boolean; noDepthWrite?: boolean; ground?: number; specular?: number } = {}) {
    if (!mesh) return
    if (this.shadowPass && ((opts.alpha !== undefined && opts.alpha < 1) || opts.unlit || opts.wave || mesh.mode !== this.gl.TRIANGLES)) return
    const gl = this.gl, u = this.u
    gl.uniformMatrix4fv(u.uModel, false, model)
    gl.uniform1i(u.uInstanced, 0)
    if (this.shadowPass) { this.stats.shadowDraws++; this.stats.shadowVerts += mesh.count; gl.bindVertexArray(mesh.vao); gl.drawArrays(mesh.mode, 0, mesh.count); return }
    this.stats.mainDraws++; this.stats.mainVerts += mesh.count
    if (opts.tint) gl.uniform3fv(u.uTint, opts.tint)
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
    gl.drawArrays(mesh.mode, 0, mesh.count)
    if (opts.noCull) gl.enable(gl.CULL_FACE)
    if (opts.wave) gl.uniform1f(u.uWave, 0)
    if (opts.tint || opts.alpha !== undefined || opts.emissive || opts.unlit || opts.highlight || opts.noDepthWrite || opts.ground || opts.specular !== undefined) this.reset()
  }

  drawInstanced(mesh: GpuMesh | null, opts: { emissive?: number; alpha?: number; specular?: number } = {}) {
    if (!mesh || !mesh.instanceCount) return
    if (this.shadowPass && ((opts.alpha !== undefined && opts.alpha < 1) || opts.emissive)) return
    const gl = this.gl, u = this.u
    gl.uniformMatrix4fv(u.uModel, false, this.identity)
    gl.uniform1i(u.uInstanced, 1)
    if (this.shadowPass) { this.stats.shadowDraws++; this.stats.shadowVerts += mesh.count * mesh.instanceCount; gl.bindVertexArray(mesh.vao); gl.drawArraysInstanced(mesh.mode, 0, mesh.count, mesh.instanceCount); gl.uniform1i(u.uInstanced, 0); return }
    this.stats.mainDraws++; this.stats.mainVerts += mesh.count * mesh.instanceCount
    if (opts.emissive) gl.uniform1f(u.uEmissive, opts.emissive)
    if (opts.specular !== undefined) gl.uniform1f(u.uSpecular, opts.specular)
    if (opts.alpha !== undefined && opts.alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(u.uAlpha, opts.alpha); gl.depthMask(false) }
    gl.bindVertexArray(mesh.vao)
    gl.drawArraysInstanced(mesh.mode, 0, mesh.count, mesh.instanceCount)
    gl.uniform1i(u.uInstanced, 0)
    if (opts.emissive || opts.alpha !== undefined || opts.specular !== undefined) this.reset()
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
