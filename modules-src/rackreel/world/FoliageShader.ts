/**
 * The foliage material: one custom `ShaderMaterial` for grass, ferns, cattails, weeds, trunks and crowns, drawn as thin instances.
 * The vertex shader takes the thin-instance matrix (`world0`..`world3`) and a per-instance `instanceColor` (rgb tint, alpha = wind phase),
 * and bends everything above a height threshold with the wind in world space, so roots and trunk bases stay put. The fragment shader
 * alpha-tests leaf cards (`discard` under 0.3) and lights them the way the scene's standard materials are lit: the sun or moon with its
 * shadow map, the hemispheric sky, the scene ambient, the lamps among a mesh's first four lights and exponential fog. Written twice,
 * GLSL for WebGL2 and WGSL for WebGPU.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { Effect } from '@babylonjs/core/Materials/effect'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import { Light } from '@babylonjs/core/Lights/light'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Vector2, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Observer } from '@babylonjs/core/Misc/observable'
import type { Nullable } from '@babylonjs/core/types'
import type { Scene } from '@babylonjs/core/scene'
import type { EngineContext } from '../core/EngineSetup'

export const ALPHA_CUTOFF = 0.3
const SHADER = 'rrFoliage'

Effect.ShadersStore[`${SHADER}VertexShader`] = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
#ifdef VERTEXCOLOR
attribute vec4 color;
#endif
#ifdef DIFFUSE
attribute vec2 uv;
varying vec2 vUV;
#endif
#ifdef INSTANCES
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
#endif
#ifdef INSTANCESCOLOR
attribute vec4 instanceColor;
#endif
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
uniform vec4 wind;
uniform vec4 windDir;
uniform vec4 fade;
uniform vec4 shape;
uniform mat4 lightMatrix;
uniform vec2 depthValues;
varying vec3 vPositionW;
varying vec3 vNormalW;
varying vec4 vColor;
varying vec4 vPositionFromLight;
varying float vDepthMetric;
void main() {
#ifdef INSTANCES
  mat4 finalWorld = world * mat4(world0, world1, world2, world3);
#else
  mat4 finalWorld = world;
#endif
  vec4 tint = vec4(1.0);
#ifdef INSTANCESCOLOR
  tint = instanceColor;
#endif
  vec3 origin = finalWorld[3].xyz;
  float keep = 1.0 - smoothstep(0.0, 1.0, (distance(origin.xz, fade.xy) - fade.z) * fade.w);
  vec3 local = vec3(position.x * shape.x, position.y * keep, position.z * shape.x);
  vec4 worldPos = finalWorld * vec4(local, 1.0);
  vPositionFromLight = lightMatrix * worldPos;
  vDepthMetric = (vPositionFromLight.z + depthValues.x) / depthValues.y;
  float lift = max(position.y - wind.x, 0.0) * wind.y;
  float weight = lift * lift * keep;
  float stretch = length(finalWorld[1].xyz);
  float along = dot(origin.xz, windDir.xy);
  float phase = along * windDir.z + tint.a * 6.2831853;
  float gust = sin(time * wind.w + phase) + 0.45 * sin(time * wind.w * 2.17 + phase * 1.31);
  float swell = 0.4 + 0.6 * (0.5 + 0.5 * sin(time * 0.31 - along * 0.021));
  float push = (0.55 + 0.45 * gust) * swell * wind.z * weight * stretch;
  float flutter = sin(time * 4.3 + dot(position, vec3(3.1, 2.3, 4.7)) + phase) * windDir.w * weight;
  worldPos.xz += windDir.xy * push + vec2(-windDir.y, windDir.x) * (flutter + gust * 0.18 * wind.z * weight * stretch);
  worldPos.y -= abs(push) * 0.3 * min(lift, 1.0);
  vPositionW = worldPos.xyz;
  vNormalW = normalize(mat3(finalWorld) * normal);
  vColor = vec4(tint.rgb, 1.0);
#ifdef VERTEXCOLOR
  vColor.rgb *= color.rgb;
#endif
#ifdef DIFFUSE
  vUV = uv;
#endif
  gl_Position = viewProjection * worldPos;
}`

Effect.ShadersStore[`${SHADER}FragmentShader`] = /* glsl */ `
precision highp float;
varying vec3 vPositionW;
varying vec3 vNormalW;
varying vec4 vColor;
varying vec4 vPositionFromLight;
varying float vDepthMetric;
#ifdef DIFFUSE
varying vec2 vUV;
uniform sampler2D diffuseSampler;
#endif
uniform sampler2D shadowSampler;
uniform vec3 cameraPosition;
uniform vec4 shape;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyDir;
uniform vec3 skyColor;
uniform vec3 groundColor;
uniform vec3 ambient;
uniform vec4 point0;
uniform vec3 point0Color;
uniform vec4 point1;
uniform vec3 point1Color;
uniform vec4 shadowInfo;
#ifdef FOG
uniform vec4 vFogInfos;
uniform vec3 vFogColor;
#endif
float shadowTerm() {
  vec3 clip = vPositionFromLight.xyz / vPositionFromLight.w;
  vec2 uv = 0.5 * clip.xy + vec2(0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  float depth = clamp(vDepthMetric, 0.0, 1.0);
#ifdef SHADOWFLOAT
  float stored = texture2D(shadowSampler, uv).x;
#else
  float stored = dot(texture2D(shadowSampler, uv), vec4(1.0 / (255.0 * 255.0 * 255.0), 1.0 / (255.0 * 255.0), 1.0 / 255.0, 1.0));
#endif
  float esm = clamp(exp(min(87.0, -shadowInfo.y * (depth - stored))), shadowInfo.x, 1.0);
  float mask = smoothstep(1.0 - shadowInfo.z, 1.00000012, clamp(dot(clip.xy, clip.xy), 0.0, 1.0));
  return mix(esm, 1.0, mask);
}
vec3 lamp(vec4 at, vec3 color, vec3 n) {
  vec3 to = at.xyz - vPositionW;
  float reach = max(0.0, 1.0 - length(to) / at.w);
  return color * max(dot(n, normalize(to)), 0.0) * reach;
}
void main() {
  vec3 base = vColor.rgb;
  float alpha = 1.0;
#ifdef DIFFUSE
  vec4 texel = texture2D(diffuseSampler, vUV);
  base *= texel.rgb;
  alpha = texel.a;
#endif
#ifdef ALPHATEST
  if (alpha < ${ALPHA_CUTOFF.toFixed(2)}) discard;
#endif
  vec3 n = normalize(vNormalW);
#ifdef TWOSIDED
  n = gl_FrontFacing ? n : -n;
#endif
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), shape.y));
  float shadow = shadowInfo.w * shape.w > 0.5 ? shadowTerm() : 1.0;
  float facing = dot(n, -sunDir);
  vec3 light = sunColor * (max(facing, 0.0) + max(-facing, 0.0) * shape.z) * shadow;
  light += mix(groundColor, skyColor, dot(n, skyDir) * 0.5 + 0.5);
  light += lamp(point0, point0Color, n) + lamp(point1, point1Color, n);
  vec3 lit = clamp(light + ambient, 0.0, 1.0) * base;
#ifdef FOG
  float haze = length(vPositionW - cameraPosition) * vFogInfos.w;
  lit = mix(vFogColor, lit, clamp(exp(-haze * haze), 0.0, 1.0));
#endif
#ifdef LINEAROUT
  lit = pow(max(lit, vec3(0.0)), vec3(2.2));
#endif
  gl_FragColor = vec4(lit, 1.0);
}`

ShaderStore.ShadersStoreWGSL[`${SHADER}VertexShader`] = /* wgsl */ `
attribute position: vec3f;
attribute normal: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
#ifdef DIFFUSE
attribute uv: vec2f;
varying vUV: vec2f;
#endif
#ifdef INSTANCES
attribute world0: vec4f;
attribute world1: vec4f;
attribute world2: vec4f;
attribute world3: vec4f;
#endif
#ifdef INSTANCESCOLOR
attribute instanceColor: vec4f;
#endif
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
uniform time: f32;
uniform wind: vec4f;
uniform windDir: vec4f;
uniform fade: vec4f;
uniform shape: vec4f;
uniform lightMatrix: mat4x4f;
uniform depthValues: vec2f;
varying vPositionW: vec3f;
varying vNormalW: vec3f;
varying vColor: vec4f;
varying vPositionFromLight: vec4f;
varying vDepthMetric: f32;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#ifdef INSTANCES
  let finalWorld = uniforms.world * mat4x4f(vertexInputs.world0, vertexInputs.world1, vertexInputs.world2, vertexInputs.world3);
#else
  let finalWorld = uniforms.world;
#endif
  var tint = vec4f(1.0);
#ifdef INSTANCESCOLOR
  tint = vertexInputs.instanceColor;
#endif
  let position = vertexInputs.position;
  let origin = finalWorld[3].xyz;
  let keep = 1.0 - smoothstep(0.0, 1.0, (distance(origin.xz, uniforms.fade.xy) - uniforms.fade.z) * uniforms.fade.w);
  let local = vec3f(position.x * uniforms.shape.x, position.y * keep, position.z * uniforms.shape.x);
  var worldPos = finalWorld * vec4f(local, 1.0);
  let fromLight = uniforms.lightMatrix * worldPos;
  vertexOutputs.vPositionFromLight = fromLight;
  vertexOutputs.vDepthMetric = (fromLight.z + uniforms.depthValues.x) / uniforms.depthValues.y;
  let lift = max(position.y - uniforms.wind.x, 0.0) * uniforms.wind.y;
  let weight = lift * lift * keep;
  let stretch = length(finalWorld[1].xyz);
  let along = dot(origin.xz, uniforms.windDir.xy);
  let phase = along * uniforms.windDir.z + tint.a * 6.2831853;
  let gust = sin(uniforms.time * uniforms.wind.w + phase) + 0.45 * sin(uniforms.time * uniforms.wind.w * 2.17 + phase * 1.31);
  let swell = 0.4 + 0.6 * (0.5 + 0.5 * sin(uniforms.time * 0.31 - along * 0.021));
  let push = (0.55 + 0.45 * gust) * swell * uniforms.wind.z * weight * stretch;
  let flutter = sin(uniforms.time * 4.3 + dot(position, vec3f(3.1, 2.3, 4.7)) + phase) * uniforms.windDir.w * weight;
  let sway = uniforms.windDir.xy * push + vec2f(-uniforms.windDir.y, uniforms.windDir.x) * (flutter + gust * 0.18 * uniforms.wind.z * weight * stretch);
  worldPos = vec4f(worldPos.x + sway.x, worldPos.y - abs(push) * 0.3 * min(lift, 1.0), worldPos.z + sway.y, worldPos.w);
  vertexOutputs.vPositionW = worldPos.xyz;
  vertexOutputs.vNormalW = normalize(mat3x3f(finalWorld[0].xyz, finalWorld[1].xyz, finalWorld[2].xyz) * vertexInputs.normal);
  var shade = tint.rgb;
#ifdef VERTEXCOLOR
  shade = shade * vertexInputs.color.rgb;
#endif
  vertexOutputs.vColor = vec4f(shade, 1.0);
#ifdef DIFFUSE
  vertexOutputs.vUV = vertexInputs.uv;
#endif
  vertexOutputs.position = uniforms.viewProjection * worldPos;
}`

ShaderStore.ShadersStoreWGSL[`${SHADER}FragmentShader`] = /* wgsl */ `
varying vPositionW: vec3f;
varying vNormalW: vec3f;
varying vColor: vec4f;
varying vPositionFromLight: vec4f;
varying vDepthMetric: f32;
#ifdef DIFFUSE
varying vUV: vec2f;
var diffuseSamplerSampler: sampler;
var diffuseSampler: texture_2d<f32>;
#endif
var shadowSamplerSampler: sampler;
var shadowSampler: texture_2d<f32>;
uniform cameraPosition: vec3f;
uniform shape: vec4f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform skyDir: vec3f;
uniform skyColor: vec3f;
uniform groundColor: vec3f;
uniform ambient: vec3f;
uniform point0: vec4f;
uniform point0Color: vec3f;
uniform point1: vec4f;
uniform point1Color: vec3f;
uniform shadowInfo: vec4f;
#ifdef FOG
uniform vFogInfos: vec4f;
uniform vFogColor: vec3f;
#endif
fn shadowTerm(fromLight: vec4f, depthMetric: f32) -> f32 {
  let clip = fromLight.xyz / fromLight.w;
  let uv = 0.5 * clip.xy + vec2f(0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return 1.0;
  }
  let depth = clamp(depthMetric, 0.0, 1.0);
#ifdef SHADOWFLOAT
  let stored = textureSampleLevel(shadowSampler, shadowSamplerSampler, uv, 0.0).x;
#else
  let stored = dot(textureSampleLevel(shadowSampler, shadowSamplerSampler, uv, 0.0), vec4f(1.0 / (255.0 * 255.0 * 255.0), 1.0 / (255.0 * 255.0), 1.0 / 255.0, 1.0));
#endif
  let esm = clamp(exp(min(87.0, -uniforms.shadowInfo.y * (depth - stored))), uniforms.shadowInfo.x, 1.0);
  let mask = smoothstep(1.0 - uniforms.shadowInfo.z, 1.00000012, clamp(dot(clip.xy, clip.xy), 0.0, 1.0));
  return mix(esm, 1.0, mask);
}
fn lamp(at: vec4f, color: vec3f, n: vec3f, positionW: vec3f) -> vec3f {
  let to = at.xyz - positionW;
  let reach = max(0.0, 1.0 - length(to) / at.w);
  return color * max(dot(n, normalize(to)), 0.0) * reach;
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  var base = fragmentInputs.vColor.rgb;
  var alpha = 1.0;
#ifdef DIFFUSE
  let texel = textureSample(diffuseSampler, diffuseSamplerSampler, fragmentInputs.vUV);
  base = base * texel.rgb;
  alpha = texel.a;
#endif
#ifdef ALPHATEST
  if (alpha < ${ALPHA_CUTOFF.toFixed(2)}) {
    discard;
  }
#endif
  var n = normalize(fragmentInputs.vNormalW);
#ifdef TWOSIDED
  n = select(-n, n, fragmentInputs.frontFacing);
#endif
  n = normalize(mix(n, vec3f(0.0, 1.0, 0.0), uniforms.shape.y));
  var shadow = 1.0;
  if (uniforms.shadowInfo.w * uniforms.shape.w > 0.5) {
    shadow = shadowTerm(fragmentInputs.vPositionFromLight, fragmentInputs.vDepthMetric);
  }
  let facing = dot(n, -uniforms.sunDir);
  var light = uniforms.sunColor * (max(facing, 0.0) + max(-facing, 0.0) * uniforms.shape.z) * shadow;
  light = light + mix(uniforms.groundColor, uniforms.skyColor, dot(n, uniforms.skyDir) * 0.5 + 0.5);
  light = light + lamp(uniforms.point0, uniforms.point0Color, n, fragmentInputs.vPositionW) + lamp(uniforms.point1, uniforms.point1Color, n, fragmentInputs.vPositionW);
  var lit = clamp(light + uniforms.ambient, vec3f(0.0), vec3f(1.0)) * base;
#ifdef FOG
  let haze = length(fragmentInputs.vPositionW - uniforms.cameraPosition) * uniforms.vFogInfos.w;
  lit = mix(uniforms.vFogColor, lit, clamp(exp(-haze * haze), 0.0, 1.0));
#endif
#ifdef LINEAROUT
  lit = pow(max(lit, vec3f(0.0)), vec3f(2.2));
#endif
  fragmentOutputs.color = vec4f(lit, 1.0);
}`

/** A `ShaderMaterial` whose alpha-tested leaf cards also cut holes in the shadow map. */
export class FoliageMaterial extends ShaderMaterial {
  alphaCutOff = ALPHA_CUTOFF
  alphaTexture: Nullable<BaseTexture> = null
  readonly wind = new Vector4(0, 1, 0, 1)
  readonly windDir = new Vector4(0.8, 0.6, 0.3, 0)
  readonly shape = new Vector4(1, 0, 0, 1)
  readonly ambient = new Color3(0, 0, 0)
  ambientScale = 0.3

  override getAlphaTestTexture(): Nullable<BaseTexture> {
    return this.alphaTexture
  }
}

export interface FoliageLook {
  /** Local height below which nothing moves, and the height over which the sway grows to full. */
  threshold: number
  range: number
  /** Sway at the top, metres per unit of instance height scale. */
  sway: number
  /** Gust rate, radians per second. */
  speed: number
  /** How quickly the gust phase changes across the ground, radians per metre along the wind. */
  ripple: number
  /** Extra quick shiver of each vertex, metres. */
  flutter?: number
  twoSided?: boolean
  /** 0 keeps the mesh normals; 1 lights the surface as if it faced straight up. */
  upward?: number
  /** Share of the key light that shows through from behind. */
  translucency?: number
  /** Multiplies the scene ambient, as `ambientColor` does on a standard material. */
  ambient?: number
  texture?: BaseTexture
  /** Uses the grass ring's shared distance fade. */
  fades?: boolean
  /** Sideways scale of the local mesh (far grass draws fewer, wider blades). */
  widen?: number
  /** False for things the sun's shadow map never darkened (the underwater weeds). */
  shadowed?: boolean
}

const NO_FADE = new Vector4(0, 0, 1e9, 1)
/** A standard material lights a mesh with the first four of its light sources; the foliage takes its lamps from the same four. */
const MAX_LIGHTS = 4
const UNIFORMS = [
  'world', 'viewProjection', 'cameraPosition', 'time', 'wind', 'windDir', 'fade', 'shape', 'lightMatrix', 'depthValues',
  'sunDir', 'sunColor', 'skyDir', 'skyColor', 'groundColor', 'ambient', 'point0', 'point0Color', 'point1', 'point1Color', 'shadowInfo',
]

/** Builds the foliage materials and feeds them the clock and the scene's lights once a frame. */
export class FoliageShading {
  time = 0
  /** Centre (x, z), start and 1 / length of the grass distance fade. */
  readonly fade = new Vector4(0, 0, 1e9, 1)
  /** Any foliage mesh: its light sources say which lamps reach the foliage. */
  lightProbe: Nullable<AbstractMesh> = null
  private readonly scene: Scene
  private readonly materials: FoliageMaterial[] = []
  private readonly byName = new Map<string, FoliageMaterial>()
  private readonly sunDir = new Vector3(0, -1, 0)
  private readonly sunColor = new Color3()
  private readonly skyDir = new Vector3(0, 1, 0)
  private readonly skyColor = new Color3()
  private readonly groundColor = new Color3()
  private readonly lamps = [new Vector4(0, -1000, 0, 1), new Vector4(0, -1000, 0, 1)]
  private readonly lampColors = [new Color3(), new Color3()]
  private readonly lightMatrix = Matrix.Identity()
  private readonly depthValues = new Vector2(1, 2)
  private readonly shadowInfo = new Vector4(0.6, 60, 0.25, 1)
  private readonly wgsl: boolean
  private shadowTexture: Nullable<BaseTexture> = null
  private observer: Nullable<Observer<Scene>>

  constructor(private readonly ctx: EngineContext) {
    this.scene = ctx.scene
    this.wgsl = ctx.engine.isWebGPU
    this.observer = this.scene.onBeforeRenderObservable.add(() => this.update())
    this.scene.onDisposeObservable.addOnce(() => this.dispose())
    this.update()
  }

  material(name: string, look: FoliageLook): FoliageMaterial {
    const found = this.byName.get(name)
    if (found) return found
    const defines: string[] = []
    const samplers = ['shadowSampler']
    const attributes = ['position', 'normal']
    if (look.texture) {
      defines.push('#define DIFFUSE')
      samplers.push('diffuseSampler')
      attributes.push('uv')
    }
    if (look.twoSided) defines.push('#define TWOSIDED')
    if (this.ctx.shadows.getShadowMap()?.textureType !== Constants.TEXTURETYPE_UNSIGNED_BYTE) defines.push('#define SHADOWFLOAT')
    if (this.scene.imageProcessingConfiguration.applyByPostProcess) defines.push('#define LINEAROUT')
    const mat = new FoliageMaterial(`rr-foliage-${name}`, this.scene, SHADER, {
      attributes,
      uniforms: UNIFORMS.slice(),
      samplers,
      defines,
      needAlphaTesting: !!look.texture,
      shaderLanguage: this.wgsl ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
    })
    mat.backFaceCulling = !look.twoSided
    mat.wind.set(look.threshold, 1 / look.range, look.sway, look.speed)
    mat.windDir.set(0.8, 0.6, look.ripple, look.flutter ?? 0)
    mat.shape.set(look.widen ?? 1, look.upward ?? 0, look.translucency ?? 0, look.shadowed === false ? 0 : 1)
    mat.ambientScale = look.ambient ?? 0.3
    if (look.texture) {
      mat.alphaTexture = look.texture
      mat.setTexture('diffuseSampler', look.texture)
    }
    mat.setVector4('wind', mat.wind)
    mat.setVector4('windDir', mat.windDir)
    mat.setVector4('shape', mat.shape)
    mat.setVector4('fade', look.fades ? this.fade : NO_FADE)
    mat.setColor3('ambient', mat.ambient)
    mat.setVector3('sunDir', this.sunDir)
    mat.setColor3('sunColor', this.sunColor)
    mat.setVector3('skyDir', this.skyDir)
    mat.setColor3('skyColor', this.skyColor)
    mat.setColor3('groundColor', this.groundColor)
    mat.setVector4('point0', this.lamps[0])
    mat.setColor3('point0Color', this.lampColors[0])
    mat.setVector4('point1', this.lamps[1])
    mat.setColor3('point1Color', this.lampColors[1])
    mat.setMatrix('lightMatrix', this.lightMatrix)
    mat.setVector2('depthValues', this.depthValues)
    mat.setVector4('shadowInfo', this.shadowInfo)
    mat.setFloat('time', this.time)
    if (this.shadowTexture) mat.setTexture('shadowSampler', this.shadowTexture)
    const ambient = this.scene.ambientColor
    mat.ambient.set(ambient.r * mat.ambientScale, ambient.g * mat.ambientScale, ambient.b * mat.ambientScale)
    this.materials.push(mat)
    this.byName.set(name, mat)
    return mat
  }

  private update(): void {
    const { ctx, scene } = this
    this.time += Math.min(0.1, ctx.engine.getDeltaTime() / 1000)
    const sun = ctx.sun
    this.sunDir.copyFrom(sun.direction).normalize()
    const sunPower = sun.isEnabled() ? sun.getScaledIntensity() : 0
    this.sunColor.set(sun.diffuse.r * sunPower, sun.diffuse.g * sunPower, sun.diffuse.b * sunPower)
    const sky = ctx.sky
    this.skyDir.copyFrom(sky.direction).normalize()
    const skyPower = sky.isEnabled() ? sky.getScaledIntensity() : 0
    this.skyColor.set(sky.diffuse.r * skyPower, sky.diffuse.g * skyPower, sky.diffuse.b * skyPower)
    this.groundColor.set(sky.groundColor.r * skyPower, sky.groundColor.g * skyPower, sky.groundColor.b * skyPower)
    this.pickLamps()
    const shadows = ctx.shadows
    const map = shadows.getShadowMapForRendering()
    this.lightMatrix.copyFrom(shadows.getTransformMatrix())
    const camera = scene.activeCamera
    if (camera) this.depthValues.set(sun.getDepthMinZ(camera), sun.getDepthMinZ(camera) + sun.getDepthMaxZ(camera))
    this.shadowInfo.set(shadows.getDarkness(), shadows.depthScale, shadows.frustumEdgeFalloff, map && sun.shadowEnabled && scene.shadowsEnabled ? 1 : 0)
    const swap = map !== this.shadowTexture
    this.shadowTexture = map
    const ambient = scene.ambientColor
    for (let i = 0; i < this.materials.length; i++) {
      const mat = this.materials[i]
      mat.setFloat('time', this.time)
      mat.ambient.set(ambient.r * mat.ambientScale, ambient.g * mat.ambientScale, ambient.b * mat.ambientScale)
      if (swap && map) mat.setTexture('shadowSampler', map)
    }
  }

  /** The point lights among the probe mesh's first four light sources: the lamps a standard material on that mesh would use. */
  private pickLamps(): void {
    const sources = this.lightProbe?.lightSources
    let slot = 0
    if (sources) {
      for (let i = 0; i < sources.length && i < MAX_LIGHTS && slot < this.lamps.length; i++) {
        const light = sources[i]
        if (light.getTypeID() === Light.LIGHTTYPEID_POINTLIGHT && light.isEnabled()) this.setLamp(slot++, light)
      }
    }
    for (; slot < this.lamps.length; slot++) this.setLamp(slot, null)
  }

  private setLamp(slot: number, light: Light | null): void {
    const at = this.lamps[slot]
    const color = this.lampColors[slot]
    if (!light) {
      at.set(0, -1000, 0, 1)
      color.set(0, 0, 0)
      return
    }
    const p = light.getAbsolutePosition()
    at.set(p.x, p.y, p.z, Math.max(0.001, light.range))
    const power = light.getScaledIntensity()
    color.set(light.diffuse.r * power, light.diffuse.g * power, light.diffuse.b * power)
  }

  dispose(): void {
    if (this.observer) this.scene.onBeforeRenderObservable.remove(this.observer)
    this.observer = null
    for (const mat of this.materials) mat.dispose()
    this.materials.length = 0
    this.byName.clear()
    this.shadowTexture = null
    this.lightProbe = null
  }
}
