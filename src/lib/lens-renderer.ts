import { maxWarps } from '@/lib/lens-geometry'
import type { FaceWarp } from '@/lib/lens-geometry'
import type { FilterId, LensSettings } from '@/lib/lens-types'

type FilterLook = { brightness: number; contrast: number; saturation: number; tint: [number, number, number]; hue: number; glow: number }

const neutralLook: FilterLook = { brightness: 0, contrast: 1, saturation: 1, tint: [1, 1, 1], hue: 0, glow: 0 }

const filterLooks: Record<FilterId, FilterLook> = {
  none: neutralLook,
  warm: { brightness: 0.03, contrast: 1.05, saturation: 1.12, tint: [1.08, 1, 0.86], hue: 0, glow: 0.1 },
  cool: { brightness: 0.02, contrast: 1.04, saturation: 0.95, tint: [0.88, 0.98, 1.12], hue: 0, glow: 0.05 },
  vivid: { brightness: 0.02, contrast: 1.18, saturation: 1.45, tint: [1, 1, 1], hue: 0, glow: 0 },
  mono: { brightness: 0.02, contrast: 1.1, saturation: 0, tint: [1, 1, 1], hue: 0, glow: 0 },
  noir: { brightness: -0.05, contrast: 1.45, saturation: 0, tint: [1, 0.98, 0.95], hue: 0, glow: 0 },
  vintage: { brightness: 0.04, contrast: 0.88, saturation: 0.7, tint: [1.1, 0.98, 0.78], hue: 0, glow: 0.12 },
  dream: { brightness: 0.06, contrast: 0.92, saturation: 1.1, tint: [1.05, 0.96, 1.08], hue: 0, glow: 0.45 },
  alien: { brightness: 0, contrast: 1.15, saturation: 1.3, tint: [0.8, 1.15, 0.9], hue: 2.2, glow: 0.15 },
}

const vertexSource = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

const fragmentSource = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform sampler2D uHairMask;
uniform sampler2D uFaceMask;
uniform vec2 uResolution;
uniform vec4 uWarps[${maxWarps}];
uniform vec2 uShifts[${maxWarps}];
uniform int uWarpCount;
uniform float uSmooth;
uniform float uHairMix;
uniform vec3 uHairColor;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uTint;
uniform float uHue;
uniform float uGlow;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;

vec3 rotateHue(vec3 color, float angle) {
  const vec3 k = vec3(0.57735);
  float c = cos(angle);
  return color * c + cross(k, color) * sin(angle) + k * dot(k, color) * (1.0 - c);
}

void main() {
  vec2 pixel = vUv * uResolution;
  vec2 source = pixel;
  for (int i = 0; i < ${maxWarps}; i++) {
    if (i >= uWarpCount) break;
    vec4 warp = uWarps[i];
    vec2 delta = pixel - warp.xy;
    float ratio = length(delta) / warp.z;
    if (ratio < 1.0) {
      float falloff = (1.0 - ratio * ratio);
      falloff *= falloff;
      source -= delta * warp.w * falloff + uShifts[i] * falloff;
    }
  }
  vec2 uv = clamp(source / uResolution, 0.0, 1.0);
  vec3 color = texture2D(uImage, uv).rgb;

  float faceMask = texture2D(uFaceMask, uv).r;
  if (uSmooth > 0.0 && faceMask > 0.01) {
    vec3 total = color;
    float weight = 1.0;
    for (int ring = 1; ring <= 2; ring++) {
      for (int tap = 0; tap < 8; tap++) {
        float angle = float(tap) * 0.785398 + float(ring) * 0.39;
        vec2 offset = vec2(cos(angle), sin(angle)) * float(ring) * 2.6 / uResolution;
        vec3 neighbour = texture2D(uImage, uv + offset).rgb;
        vec3 diff = neighbour - color;
        float w = exp(-dot(diff, diff) * 40.0);
        total += neighbour * w;
        weight += w;
      }
    }
    color = mix(color, total / weight, uSmooth * faceMask);
  }

  float hairMask = texture2D(uHairMask, uv).r * uHairMix;
  if (hairMask > 0.01) {
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    vec3 dyed = uHairColor * (0.25 + luma * 1.5);
    color = mix(color, clamp(dyed, 0.0, 1.0), hairMask);
  }

  if (uGlow > 0.0) {
    vec3 blur = vec3(0.0);
    for (int tap = 0; tap < 8; tap++) {
      float angle = float(tap) * 0.785398;
      blur += texture2D(uImage, uv + vec2(cos(angle), sin(angle)) * 7.0 / uResolution).rgb;
    }
    color = mix(color, max(color, blur / 8.0), uGlow);
  }

  color = rotateHue(color, uHue);
  color *= uTint;
  color += uBrightness;
  color = (color - 0.5) * uContrast + 0.5;
  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(gray), color, uSaturation);

  vec2 centered = vUv - 0.5;
  color *= 1.0 - uVignette * smoothstep(0.25, 0.75, length(centered) * 1.2);
  float noise = fract(sin(dot(pixel + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  color += noise * uGrain * 0.18;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Shader could not be created')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader failed to compile')
  return shader
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255]
}

export type RenderInput = {
  source: TexImageSource
  width: number
  height: number
  warps: FaceWarp[]
  faceMask: HTMLCanvasElement
  hairMask: { data: Uint8Array; width: number; height: number } | null
  settings: LensSettings
  time: number
}

export class LensRenderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext
  private program: WebGLProgram
  private textures: { image: WebGLTexture; hair: WebGLTexture; face: WebGLTexture }
  private uniforms = new Map<string, WebGLUniformLocation | null>()
  private emptyHair = new Uint8Array([0])

  constructor() {
    this.canvas = document.createElement('canvas')
    const gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false })
    if (!gl) throw new Error('WebGL is not available in this browser')
    this.gl = gl
    const program = gl.createProgram()
    if (!program) throw new Error('WebGL program could not be created')
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL program failed to link')
    this.program = program
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'aPosition')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    this.textures = { image: this.createTexture(0, 'uImage'), hair: this.createTexture(1, 'uHairMask'), face: this.createTexture(2, 'uFaceMask') }
  }

  private createTexture(unitIndex: number, name: string) {
    const gl = this.gl
    const texture = gl.createTexture()
    if (!texture) throw new Error('WebGL texture could not be created')
    gl.activeTexture(gl.TEXTURE0 + unitIndex)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.uniform1i(this.location(name), unitIndex)
    return texture
  }

  private location(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name))
    return this.uniforms.get(name) ?? null
  }

  render({ source, width, height, warps, faceMask, hairMask, settings, time }: RenderInput) {
    const gl = this.gl
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height }
    gl.viewport(0, 0, width, height)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.textures.image)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.textures.hair)
    if (hairMask) gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, hairMask.width, hairMask.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, hairMask.data)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.emptyHair)

    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.textures.face)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, faceMask)

    const warpData = new Float32Array(maxWarps * 4)
    const shiftData = new Float32Array(maxWarps * 2)
    warps.forEach((warp, index) => {
      warpData.set([warp.x, warp.y, Math.max(warp.radius, 1), warp.strength], index * 4)
      shiftData.set([warp.shiftX, warp.shiftY], index * 2)
    })
    gl.uniform4fv(this.location('uWarps'), warpData)
    gl.uniform2fv(this.location('uShifts'), shiftData)
    gl.uniform1i(this.location('uWarpCount'), warps.length)
    gl.uniform2f(this.location('uResolution'), width, height)
    gl.uniform1f(this.location('uSmooth'), settings.face.smooth * 0.85)
    gl.uniform1f(this.location('uHairMix'), settings.hair.dyeReal && hairMask ? settings.hair.dyeStrength : 0)
    gl.uniform3fv(this.location('uHairColor'), hexToRgb(settings.hair.color))

    const look = filterLooks[settings.filter.preset]
    const amount = settings.filter.preset === 'none' ? 0 : settings.filter.strength
    const blend = (from: number, to: number) => from + (to - from) * amount
    gl.uniform1f(this.location('uBrightness'), blend(0, look.brightness))
    gl.uniform1f(this.location('uContrast'), blend(1, look.contrast))
    gl.uniform1f(this.location('uSaturation'), blend(1, look.saturation))
    gl.uniform3f(this.location('uTint'), blend(1, look.tint[0]), blend(1, look.tint[1]), blend(1, look.tint[2]))
    gl.uniform1f(this.location('uHue'), blend(0, look.hue))
    gl.uniform1f(this.location('uGlow'), blend(0, look.glow))
    gl.uniform1f(this.location('uVignette'), settings.filter.vignette * 0.85)
    gl.uniform1f(this.location('uGrain'), settings.filter.grain)
    gl.uniform1f(this.location('uTime'), time % 1000)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.canvas
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
