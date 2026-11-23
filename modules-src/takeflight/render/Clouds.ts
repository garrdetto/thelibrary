/**
 * The cloud layer: a slab of 3D value-noise cloud between a base and a top altitude, ray-marched per pixel. It is drawn on two
 * big horizontal planes that follow the camera, one at the base and one at the top: below the layer only the base plane draws,
 * above it only the top plane, inside it both (each marches from the camera to its own plane), so terrain and the aircraft occlude
 * it through the depth buffer and nothing is counted twice. Cover, base, depth, drift with the wind, sun and ambient light and the
 * scene fog all come in as uniforms. Written twice, GLSL for WebGL2 and WGSL for WebGPU; if either fails to compile the layer is
 * hidden rather than breaking the frame. Step counts follow the quality tier. Inside a thick layer a camera-centred bubble of cloud
 * colour fades in with depth into the layer (the planes cannot reach the horizon), so the view whites out but the aircraft close
 * by still shows.
 */
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { Constants } from '@babylonjs/core/Engines/constants'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { QualityTier } from './Quality'

const STEPS: Record<QualityTier, number> = { low: 10, medium: 16, high: 24, ultra: 32 }
const PLANE_SIZE = 90000

const GLSL_VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vPos;
void main() {
  vec4 w = world * vec4(position, 1.0);
  vPos = w.xyz;
  gl_Position = viewProjection * w;
}`

const GLSL_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vPos;
uniform vec3 cameraPos;
uniform vec4 layer;
uniform vec4 shape;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 ambient;
uniform vec3 fogColor;
uniform float fogDensity;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}
float density(vec3 p) {
  float h = (p.y - layer.x) / max(1.0, layer.y - layer.x);
  if (h < 0.0 || h > 1.0) return 0.0;
  vec3 q = vec3(p.x + shape.x, p.y * 1.6, p.z + shape.y);
  float n = noise3(q * 0.00042) * 0.55 + noise3(q * 0.0013 + 11.0) * 0.3 + noise3(q * 0.0041 + 37.0) * 0.15;
  float profile = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.35, 1.0, h));
  return clamp((n * profile - (1.0 - layer.z) * 0.62) * 5.0, 0.0, 1.0);
}
void main() {
  vec3 ro = cameraPos;
  vec3 rd = normalize(vPos - ro);
  float dy = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  float tb = (layer.x - ro.y) / dy;
  float tt = (layer.y - ro.y) / dy;
  float t0 = max(min(tb, tt), 0.0);
  float t1 = max(tb, tt);
  if (t1 <= 0.0 || t0 > shape.z) discard;
  t1 = min(t1, t0 + 7000.0);
  float steps = layer.w;
  float dt = (t1 - t0) / steps;
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float transmittance = 1.0;
  vec3 light = vec3(0.0);
  for (int i = 0; i < 32; i++) {
    if (float(i) >= steps) break;
    vec3 p = ro + rd * (t0 + dt * (float(i) + jitter));
    float d = density(p);
    if (d > 0.002) {
      float shade = exp(-density(p + sunDir * 120.0) * 2.4);
      float height = clamp((p.y - layer.x) / max(1.0, layer.y - layer.x), 0.0, 1.0);
      vec3 lit = ambient * (0.55 + 0.45 * height) + sunColor * shade * 0.9;
      float absorb = 1.0 - exp(-d * dt * 0.006 * shape.w);
      light += transmittance * absorb * lit;
      transmittance *= 1.0 - absorb;
      if (transmittance < 0.02) break;
    }
  }
  float alpha = 1.0 - transmittance;
  float fog = exp(-pow(fogDensity * t0, 2.0));
  float fade = 1.0 - smoothstep(shape.z * 0.6, shape.z, t0);
  vec3 col = mix(fogColor * alpha, light, fog);
  gl_FragColor = vec4(col * fade, alpha * fade);
}`

const WGSL_VERTEX = /* wgsl */ `
attribute position: vec3f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
varying vPos: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let w = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vPos = w.xyz;
  vertexOutputs.position = uniforms.viewProjection * w;
}`

const WGSL_FRAGMENT = /* wgsl */ `
varying vPos: vec3f;
uniform cameraPos: vec3f;
uniform layer: vec4f;
uniform shape: vec4f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform ambient: vec3f;
uniform fogColor: vec3f;
uniform fogDensity: f32;
fn hash13(q: vec3f) -> f32 {
  var p = fract(q * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
fn noise3(p: vec3f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash13(i), hash13(i + vec3f(1.0, 0.0, 0.0)), f.x), mix(hash13(i + vec3f(0.0, 1.0, 0.0)), hash13(i + vec3f(1.0, 1.0, 0.0)), f.x), f.y);
  let b = mix(mix(hash13(i + vec3f(0.0, 0.0, 1.0)), hash13(i + vec3f(1.0, 0.0, 1.0)), f.x), mix(hash13(i + vec3f(0.0, 1.0, 1.0)), hash13(i + vec3f(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}
fn density(p: vec3f) -> f32 {
  let h = (p.y - uniforms.layer.x) / max(1.0, uniforms.layer.y - uniforms.layer.x);
  if (h < 0.0 || h > 1.0) { return 0.0; }
  let q = vec3f(p.x + uniforms.shape.x, p.y * 1.6, p.z + uniforms.shape.y);
  let n = noise3(q * 0.00042) * 0.55 + noise3(q * 0.0013 + 11.0) * 0.3 + noise3(q * 0.0041 + 37.0) * 0.15;
  let profile = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.35, 1.0, h));
  return clamp((n * profile - (1.0 - uniforms.layer.z) * 0.62) * 5.0, 0.0, 1.0);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let ro = uniforms.cameraPos;
  let rd = normalize(fragmentInputs.vPos - ro);
  var dy = rd.y;
  if (abs(dy) < 1e-4) { dy = 1e-4; }
  let tb = (uniforms.layer.x - ro.y) / dy;
  let tt = (uniforms.layer.y - ro.y) / dy;
  let t0 = max(min(tb, tt), 0.0);
  var t1 = max(tb, tt);
  if (t1 <= 0.0 || t0 > uniforms.shape.z) { discard; }
  t1 = min(t1, t0 + 7000.0);
  let steps = uniforms.layer.w;
  let dt = (t1 - t0) / steps;
  let jitter = fract(52.9829189 * fract(dot(fragmentInputs.position.xy, vec2f(0.06711056, 0.00583715))));
  var transmittance = 1.0;
  var light = vec3f(0.0);
  for (var i = 0; i < 32; i++) {
    if (f32(i) >= steps) { break; }
    let p = ro + rd * (t0 + dt * (f32(i) + jitter));
    let d = density(p);
    if (d > 0.002) {
      let shade = exp(-density(p + uniforms.sunDir * 120.0) * 2.4);
      let height = clamp((p.y - uniforms.layer.x) / max(1.0, uniforms.layer.y - uniforms.layer.x), 0.0, 1.0);
      let lit = uniforms.ambient * (0.55 + 0.45 * height) + uniforms.sunColor * shade * 0.9;
      let absorb = 1.0 - exp(-d * dt * 0.006 * uniforms.shape.w);
      light += transmittance * absorb * lit;
      transmittance *= 1.0 - absorb;
      if (transmittance < 0.02) { break; }
    }
  }
  let alpha = 1.0 - transmittance;
  let fog = exp(-pow(uniforms.fogDensity * t0, 2.0));
  let fade = 1.0 - smoothstep(uniforms.shape.z * 0.6, uniforms.shape.z, t0);
  let col = mix(uniforms.fogColor * alpha, light, fog);
  fragmentOutputs.color = vec4f(col * fade, alpha * fade);
}`

ShaderStore.ShadersStore.tfCloudsVertexShader = GLSL_VERTEX
ShaderStore.ShadersStore.tfCloudsFragmentShader = GLSL_FRAGMENT
ShaderStore.ShadersStoreWGSL.tfCloudsVertexShader = WGSL_VERTEX
ShaderStore.ShadersStoreWGSL.tfCloudsFragmentShader = WGSL_FRAGMENT

export interface CloudLight {
  /** Unit vector toward the sun (or moon) and its colour, and the ambient sky colour. */
  sunDir: Vector3
  sunColor: Color3
  ambient: Color3
}

export class Clouds {
  private readonly material: ShaderMaterial
  private readonly bottom: Mesh
  private readonly top: Mesh
  private readonly bubble: Mesh
  private readonly bubbleMaterial: StandardMaterial
  private readonly layer = new Vector4()
  private readonly shape = new Vector4()
  private readonly camera = new Vector3()
  private failed = false
  private steps: number
  private cover = 0

  constructor(private readonly scene: Scene, tier: QualityTier, webgpu: boolean) {
    this.steps = STEPS[tier]
    this.material = new ShaderMaterial('takeflight-clouds', scene, 'tfClouds', {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'cameraPos', 'layer', 'shape', 'sunDir', 'sunColor', 'ambient', 'fogColor', 'fogDensity'],
      shaderLanguage: webgpu ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
      needAlphaBlending: true,
    })
    this.material.backFaceCulling = false
    this.material.disableDepthWrite = true
    this.material.alphaMode = Constants.ALPHA_PREMULTIPLIED
    this.material.onError = (_effect, errors) => {
      console.warn('Take Flight: clouds unavailable', errors)
      this.failed = true
      this.bottom.isVisible = false
      this.top.isVisible = false
    }
    this.bottom = this.plane('takeflight-clouds-base')
    this.top = this.plane('takeflight-clouds-top')
    this.bubble = CreateSphere('takeflight-cloud-bubble', { diameter: 260, segments: 12, sideOrientation: Mesh.BACKSIDE }, scene)
    this.bubbleMaterial = new StandardMaterial('takeflight-cloud-bubble', scene)
    this.bubbleMaterial.disableLighting = true
    this.bubbleMaterial.diffuseColor = Color3.Black()
    this.bubbleMaterial.specularColor = Color3.Black()
    this.bubbleMaterial.emissiveColor = new Color3(0.7, 0.72, 0.75)
    this.bubbleMaterial.disableDepthWrite = true
    this.bubble.material = this.bubbleMaterial
    this.bubble.isPickable = false
    this.bubble.applyFog = false
    this.bubble.alwaysSelectAsActiveMesh = true
    this.bubble.isVisible = false
  }

  private plane(name: string): Mesh {
    const mesh = CreateGround(name, { width: PLANE_SIZE, height: PLANE_SIZE, subdivisions: 1 }, this.scene)
    mesh.material = this.material
    mesh.isPickable = false
    mesh.applyFog = false
    mesh.alwaysSelectAsActiveMesh = true
    mesh.isVisible = false
    return mesh
  }

  setQuality(tier: QualityTier): void {
    this.steps = STEPS[tier]
  }

  /**
   * Per frame. `base`/`top` are altitudes in metres; `cover` 0..1; `offsetX`/`offsetZ` move the noise with the wind and the floating
   * origin (world x/z of the scene origin plus wind drift); `reach` is how far clouds are drawn.
   */
  update(eye: Vector3, base: number, top: number, cover: number, offsetX: number, offsetZ: number, reach: number, light: CloudLight, fogColor: Color3, fogDensity: number, groundFog = false): void {
    this.cover = cover
    const visible = !this.failed && cover > 0.03
    const below = eye.y < base
    const above = eye.y > top
    this.bottom.isVisible = visible && !above
    this.top.isVisible = visible && !below
    const depthIn = groundFog ? (eye.y > base ? top - eye.y : 0) : Math.min(eye.y - base, top - eye.y)
    const inside = cover > 0.5 && depthIn > 0 ? Math.min(1, depthIn / 60) * Math.min(1, (cover - 0.5) * 4) * (groundFog ? 0.75 : 1) : 0
    this.bubble.isVisible = inside > 0.01
    if (inside > 0.01) {
      this.bubble.position.copyFrom(eye)
      this.bubbleMaterial.alpha = 0.94 * inside
      this.bubbleMaterial.emissiveColor.set(light.ambient.r * 0.95 + light.sunColor.r * 0.3, light.ambient.g * 0.95 + light.sunColor.g * 0.3, light.ambient.b * 0.95 + light.sunColor.b * 0.3)
    }
    if (!visible) return
    this.bottom.position.set(eye.x, base, eye.z)
    this.top.position.set(eye.x, top, eye.z)
    this.camera.copyFrom(eye)
    this.layer.set(base, top, cover, this.steps)
    this.shape.set(offsetX, offsetZ, reach, 1)
    const m = this.material
    m.setVector3('cameraPos', this.camera)
    m.setVector4('layer', this.layer)
    m.setVector4('shape', this.shape)
    m.setVector3('sunDir', light.sunDir)
    m.setColor3('sunColor', light.sunColor)
    m.setColor3('ambient', light.ambient)
    m.setColor3('fogColor', fogColor)
    m.setFloat('fogDensity', fogDensity)
  }

  /** True while the eye is inside a layer thick enough to hide the view (the page closes in the fog). */
  inside(eye: Vector3, base: number, top: number): boolean {
    return this.cover > 0.5 && eye.y > base + 15 && eye.y < top - 15
  }

  dispose(): void {
    this.bubble.dispose()
    this.bubbleMaterial.dispose()
    this.bottom.dispose()
    this.top.dispose()
    this.material.dispose()
  }
}
