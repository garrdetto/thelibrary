import { SKY_VERT, DETAIL_FRAG, DETAIL_SIZE, DETAIL_LAYERS } from '../park/gl'

export type ScratchResult = { probeMs: number; renderer: string; detail: Uint8Array[] | null }

const PROBE_FRAG = `#version 300 es
precision highp float; in vec2 vNdc; out vec4 o;
void main(){ vec2 p = vNdc * 9.0; float a = 0.0; for (int i = 0; i < 48; i++) { p = vec2(p.x * p.x - p.y * p.y, 2.0 * p.x * p.y) * 0.5 + vNdc; a += sin(p.x) * cos(p.y); } o = vec4(a, a * 0.5, 0.2, 1.0); }`

/**
 * Uses a throwaway WebGL2 context (never PlayCanvas's) to time the same
 * fragment workload the classic renderer probes with, read the GPU name, and
 * bake the classic renderer's eight procedural detail layers to pixels.
 */
export function runScratch(): ScratchResult {
  const fallback: ScratchResult = { probeMs: 99, renderer: '', detail: null }
  if (typeof document === 'undefined') return fallback
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
  if (!gl) return fallback
  const compile = (fs: string) => {
    const make = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, make(gl.VERTEX_SHADER, SKY_VERT)); gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    return p
  }
  const result: ScratchResult = { ...fallback }
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    result.renderer = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '')
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.disable(gl.DEPTH_TEST)
    const target = (size: number) => {
      const tex = gl.createTexture(), fbo = gl.createFramebuffer()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.viewport(0, 0, size, size)
      return { tex, fbo }
    }
    const probe = compile(PROBE_FRAG)
    const pt = target(256)
    gl.useProgram(probe)
    const px = new Uint8Array(4)
    gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const t0 = performance.now()
    for (let i = 0; i < 4; i++) gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    result.probeMs = performance.now() - t0
    gl.deleteFramebuffer(pt.fbo); gl.deleteTexture(pt.tex)
    const detail = compile(DETAIL_FRAG), layerU = gl.getUniformLocation(detail, 'uLayer')
    target(DETAIL_SIZE)
    gl.useProgram(detail)
    const layers: Uint8Array[] = []
    for (let layer = 0; layer < DETAIL_LAYERS; layer++) {
      gl.uniform1i(layerU, layer)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const pixels = new Uint8Array(DETAIL_SIZE * DETAIL_SIZE * 4)
      gl.readPixels(0, 0, DETAIL_SIZE, DETAIL_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      layers.push(pixels)
    }
    result.detail = layers
  } catch { /* keep what was measured */ }
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return result
}
