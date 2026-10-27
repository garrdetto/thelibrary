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

  cylinder(m: Mat4 | null, cx: number, cy: number, z0: number, r0: number, r1: number, h: number, segments: number, color: Vec3, tint = 0, caps = true) {
    for (let i = 0; i < segments; i++) {
      const a0 = i / segments * Math.PI * 2, a1 = (i + 1) / segments * Math.PI * 2
      const p0: Vec3 = [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, z0], p1: Vec3 = [cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0, z0]
      const q0: Vec3 = [cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1, z0 + h], q1: Vec3 = [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, z0 + h]
      if (r1 > 0.0001) this.quad(m, p0, p1, q1, q0, color, tint)
      else this.tri(m, p0, p1, q0, color, tint)
      if (caps) {
        this.tri(m, [cx, cy, z0], p1, p0, color, tint)
        if (r1 > 0.0001) this.tri(m, [cx, cy, z0 + h], q0, q1, color, tint)
      }
    }
  }

  sphere(m: Mat4 | null, cx: number, cy: number, cz: number, r: number, color: Vec3, tint = 0, rings = 5, segments = 8, squashZ = 1) {
    for (let i = 0; i < rings; i++) {
      const t0 = i / rings * Math.PI - Math.PI / 2, t1 = (i + 1) / rings * Math.PI - Math.PI / 2
      for (let j = 0; j < segments; j++) {
        const p0 = j / segments * Math.PI * 2, p1 = (j + 1) / segments * Math.PI * 2
        const v = (t: number, p: number): Vec3 => [cx + Math.cos(t) * Math.cos(p) * r, cy + Math.cos(t) * Math.sin(p) * r, cz + Math.sin(t) * r * squashZ]
        const a = v(t0, p0), b = v(t0, p1), c = v(t1, p1), d = v(t1, p0)
        if (i === 0) this.tri(m, a, c, d, color, tint)
        else if (i === rings - 1) this.tri(m, a, b, c, color, tint)
        else this.quad(m, a, b, c, d, color, tint)
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
        const o0: Vec3 = [(Math.cos(a0) * ux + Math.sin(a0) * vx) * radius, (Math.cos(a0) * uy + Math.sin(a0) * vy) * radius, (Math.cos(a0) * uz + Math.sin(a0) * vz) * radius]
        const o1: Vec3 = [(Math.cos(a1) * ux + Math.sin(a1) * vx) * radius, (Math.cos(a1) * uy + Math.sin(a1) * vy) * radius, (Math.cos(a1) * uz + Math.sin(a1) * vz) * radius]
        this.quad(null, [a[0] + o0[0], a[1] + o0[1], a[2] + o0[2]], [a[0] + o1[0], a[1] + o1[1], a[2] + o1[2]], [b[0] + o1[0], b[1] + o1[1], b[2] + o1[2]], [b[0] + o0[0], b[1] + o0[1], b[2] + o0[2]], color, tint)
      }
    }
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
uniform bool uInstanced;
uniform vec3 uTint;
uniform float uTime;
uniform float uWave;
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
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
  gl_Position = uViewProj * w;
}`

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal; in vec3 vColor; in vec3 vWorld;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uGroundColor; uniform vec3 uFogColor; uniform vec3 uCamPos;
uniform float uFogNear; uniform float uFogFar; uniform float uAlpha; uniform float uEmissive; uniform bool uUnlit;
uniform vec4 uHighlight;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 c;
  if (uUnlit) c = vColor;
  else {
    float d = max(dot(n, uSunDir), 0.0);
    float h = n.z * 0.5 + 0.5;
    vec3 amb = mix(uGroundColor, uSkyColor, h);
    c = vColor * (amb + uSunColor * d) + vColor * uEmissive;
  }
  c = mix(c, uHighlight.rgb, uHighlight.a);
  float dist = length(vWorld - uCamPos);
  float f = smoothstep(uFogNear, uFogFar, dist);
  outColor = vec4(mix(c, uFogColor, f), uAlpha);
}`

const SKY_VERT = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.9999, 1.0); }`
const SKY_FRAG = `#version 300 es
precision highp float; in vec2 vUv; uniform vec3 uTop; uniform vec3 uBottom; out vec4 outColor;
void main(){ outColor = vec4(mix(uBottom, uTop, pow(vUv.y, 0.8)), 1.0); }`

export type GpuMesh = { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number; mode: number; instance?: WebGLBuffer; instanceCount: number; instanceCapacity: number }

export type Lighting = { sunDir: Vec3; sunColor: Vec3; sky: Vec3; ground: Vec3; fog: Vec3; fogNear: number; fogFar: number; skyTop: Vec3; skyBottom: Vec3 }

export class Gl {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  sky: WebGLProgram
  skyVao: WebGLVertexArrayObject
  u: Record<string, WebGLUniformLocation | null> = {}
  viewProj: Mat4 = mat4.identity()
  camPos: Vec3 = [0, 0, 0]
  identity = mat4.identity()

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })
    if (!gl) throw new Error('Your browser does not support WebGL 2, which the park needs to draw in 3D.')
    this.gl = gl
    this.program = this.compile(VERT, FRAG)
    this.sky = this.compile(SKY_VERT, SKY_FRAG)
    for (const name of ['uViewProj', 'uModel', 'uInstanced', 'uTint', 'uSunDir', 'uSunColor', 'uSkyColor', 'uGroundColor', 'uFogColor', 'uCamPos', 'uFogNear', 'uFogFar', 'uAlpha', 'uEmissive', 'uUnlit', 'uHighlight', 'uTime', 'uWave']) this.u[name] = gl.getUniformLocation(this.program, name)
    this.skyVao = gl.createVertexArray()!
    gl.bindVertexArray(this.skyVao)
    const b = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  }

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
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 8)
    mesh.instanceCount = count
  }

  free(mesh: GpuMesh) {
    const gl = this.gl
    gl.deleteVertexArray(mesh.vao); gl.deleteBuffer(mesh.buffer)
    if (mesh.instance) gl.deleteBuffer(mesh.instance)
  }

  begin(width: number, height: number, view: Mat4, proj: Mat4, cam: Vec3, light: Lighting, time: number) {
    const gl = this.gl
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
    this.viewProj = mat4.multiply(proj, view)
    this.camPos = cam
    const u = this.u
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj)
    gl.uniform3fv(u.uSunDir, light.sunDir); gl.uniform3fv(u.uSunColor, light.sunColor); gl.uniform3fv(u.uSkyColor, light.sky); gl.uniform3fv(u.uGroundColor, light.ground)
    gl.uniform3fv(u.uFogColor, light.fog); gl.uniform3fv(u.uCamPos, cam); gl.uniform1f(u.uFogNear, light.fogNear); gl.uniform1f(u.uFogFar, light.fogFar)
    gl.uniform1f(u.uTime, time); gl.uniform1f(u.uWave, 0)
    this.reset()
  }

  reset() {
    const gl = this.gl, u = this.u
    gl.uniform1f(u.uAlpha, 1); gl.uniform1f(u.uEmissive, 0); gl.uniform1i(u.uUnlit, 0); gl.uniform4f(u.uHighlight, 0, 0, 0, 0); gl.uniform3f(u.uTint, 1, 1, 1)
    gl.disable(gl.BLEND); gl.depthMask(true)
  }

  draw(mesh: GpuMesh | null, model: Mat4 = this.identity, opts: { tint?: Vec3; alpha?: number; emissive?: number; unlit?: boolean; highlight?: [number, number, number, number]; wave?: number; noCull?: boolean; noDepthWrite?: boolean } = {}) {
    if (!mesh) return
    const gl = this.gl, u = this.u
    gl.uniformMatrix4fv(u.uModel, false, model)
    gl.uniform1i(u.uInstanced, 0)
    if (opts.tint) gl.uniform3fv(u.uTint, opts.tint)
    if (opts.alpha !== undefined && opts.alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(u.uAlpha, opts.alpha); gl.depthMask(false) }
    if (opts.noDepthWrite) gl.depthMask(false)
    if (opts.emissive) gl.uniform1f(u.uEmissive, opts.emissive)
    if (opts.unlit) gl.uniform1i(u.uUnlit, 1)
    if (opts.highlight) gl.uniform4fv(u.uHighlight, opts.highlight)
    if (opts.wave) gl.uniform1f(u.uWave, opts.wave)
    if (opts.noCull) gl.disable(gl.CULL_FACE)
    gl.bindVertexArray(mesh.vao)
    gl.drawArrays(mesh.mode, 0, mesh.count)
    if (opts.noCull) gl.enable(gl.CULL_FACE)
    if (opts.wave) gl.uniform1f(u.uWave, 0)
    if (opts.tint || opts.alpha !== undefined || opts.emissive || opts.unlit || opts.highlight || opts.noDepthWrite) this.reset()
  }

  drawInstanced(mesh: GpuMesh | null, opts: { emissive?: number; alpha?: number } = {}) {
    if (!mesh || !mesh.instanceCount) return
    const gl = this.gl, u = this.u
    gl.uniformMatrix4fv(u.uModel, false, this.identity)
    gl.uniform1i(u.uInstanced, 1)
    if (opts.emissive) gl.uniform1f(u.uEmissive, opts.emissive)
    if (opts.alpha !== undefined && opts.alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(u.uAlpha, opts.alpha); gl.depthMask(false) }
    gl.bindVertexArray(mesh.vao)
    gl.drawArraysInstanced(mesh.mode, 0, mesh.count, mesh.instanceCount)
    gl.uniform1i(u.uInstanced, 0)
    if (opts.emissive || opts.alpha !== undefined) this.reset()
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
