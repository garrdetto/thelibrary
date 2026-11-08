/**
 * Ground material plugin for the big flat surfaces (wild grass, lawns,
 * asphalt, concrete): the same PBR maps, without the visible repeat and with
 * lawn stripes from the mowing atlas. Written in WGSL (WebGPU) and GLSL
 * (the WebGL2 fallback) so neither needs a shader translator at run time.
 *
 * Anti-tiling: the albedo and normal maps are read a second time at a
 * rotated, rescaled copy of the UV and the two are blended by a world-space
 * macro noise (`groundMacro`, one copy every 1 / groundLook.z metres).
 * Normals from the rotated read are turned back into the base UV frame
 * before blending. The macro texture also carries a brightness drift (G)
 * and dry or worn patches (B), which tint the albedo and roughen the
 * surface.
 *
 * Lawns (`mow`): the per-vertex `mowUV` attribute addresses the lawn atlas
 * (Town.ts), one texel per 1 m cell: R = how freshly cut (1 just mown, 0
 * grown out), G/B = the blade lean in world XZ (×0.5 + 0.5). Bilinear
 * filtering blends neighbouring cells, so edges stay soft. Blades leaning
 * away from the camera show their lit upper sides (lighter), toward it their
 * shaded undersides (darker), which is what makes real stripes swap shade
 * when you walk around them. Cut grass is also flatter: its normal is damped
 * and tilted along the lean, with a little more sheen.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';

export interface GroundLook {
  /** Macro brightness drift (0 = none). */
  variation: number;
  /** How much of the rotated second read shows through (0 = plain tiling). */
  antiTile: number;
  /** Metres per copy of the macro noise. */
  macroSize: number;
  /** Multiplier for dry or worn patches. */
  dry: [number, number, number];
}

const GLSL_DEFS = `
#ifdef GROUND
uniform sampler2D groundMacroSampler;
#ifdef GROUND_MOW
uniform sampler2D groundMowSampler;
varying vec2 vMowUV;
#endif
const mat2 GROUND_ROT = mat2(0.8, 0.6, -0.6, 0.8);
vec2 groundUvB(vec2 uv) { return GROUND_ROT * uv * 0.613 + vec2(0.37, 0.71); }
float gRoughK = 1.0;
#endif
`;

const GLSL_MAIN = `
#ifdef GROUND
{
  vec4 gMacro = texture2D(groundMacroSampler, vPositionW.xz * groundLook.z);
  float gBlend = smoothstep(0.32, 0.68, gMacro.r) * groundLook.y;
  vec3 ta = texture2D(albedoSampler, vAlbedoUV).rgb;
  vec3 tb = texture2D(albedoSampler, groundUvB(vAlbedoUV)).rgb;
  #ifdef GAMMAALBEDO
    ta = toLinearSpace(ta); tb = toLinearSpace(tb);
  #endif
  surfaceAlbedo *= mix(vec3(1.0), tb / max(ta, vec3(0.004)), gBlend);
  surfaceAlbedo *= 1.0 + (gMacro.g - 0.5) * groundLook.x;
  float dryK = smoothstep(0.55, 0.85, gMacro.b);
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * groundDry.rgb, dryK * 0.65);
  vec4 gMow = vec4(0.0, 0.5, 0.5, 0.0);
  #ifdef GROUND_MOW
    gMow = texture2D(groundMowSampler, vMowUV);
    vec2 lean = gMow.gb * 2.0 - 1.0;
    vec3 toFrag = vPositionW - vEyePosition.xyz;
    vec2 look = toFrag.xz / max(length(toFrag.xz), 0.001);
    float fade = mix(1.0, 0.6, clamp(length(toFrag) / 140.0, 0.0, 1.0));
    float stripe = dot(lean, look) * gMow.r * 0.3 * fade;
    surfaceAlbedo *= (1.0 + stripe) * mix(vec3(0.9, 0.92, 0.8), vec3(1.03), gMow.r);
  #endif
  #ifdef BUMP
    vec3 na = texture2D(bumpSampler, vBumpUV).xyz * 2.0 - 1.0;
    vec3 nb = texture2D(bumpSampler, groundUvB(vBumpUV)).xyz * 2.0 - 1.0;
    nb.xy = transpose(GROUND_ROT) * nb.xy;
    vec3 n = normalize(mix(na, nb, gBlend));
    n.xy *= 1.0 - gMow.r * 0.55;
    normalW = perturbNormalBase(TBN, normalize(n), vBumpInfos.y);
  #endif
  vec2 leanW = gMow.gb * 2.0 - 1.0;
  normalW = normalize(normalW + vec3(leanW.x, 0.0, leanW.y) * gMow.r * 0.22);
  gRoughK = (1.0 + dryK * 0.5) * (1.0 - gMow.r * 0.2);
}
#endif
`;

const WGSL_DEFS = `
#ifdef GROUND
var groundMacroSamplerSampler: sampler;
var groundMacroSampler: texture_2d<f32>;
#ifdef GROUND_MOW
var groundMowSamplerSampler: sampler;
var groundMowSampler: texture_2d<f32>;
varying vMowUV: vec2f;
#endif
const GROUND_ROT = mat2x2f(0.8, 0.6, -0.6, 0.8);
fn groundUvB(uv: vec2f) -> vec2f { return GROUND_ROT * uv * 0.613 + vec2f(0.37, 0.71); }
#endif
`;

const WGSL_MAIN = `
#ifdef GROUND
var gRoughK: f32 = 1.0;
{
  let gMacro = textureSample(groundMacroSampler, groundMacroSamplerSampler, fragmentInputs.vPositionW.xz * uniforms.groundLook.z);
  let gBlend = smoothstep(0.32, 0.68, gMacro.r) * uniforms.groundLook.y;
  var ta = textureSample(albedoSampler, albedoSamplerSampler, fragmentInputs.vAlbedoUV).rgb;
  var tb = textureSample(albedoSampler, albedoSamplerSampler, groundUvB(fragmentInputs.vAlbedoUV)).rgb;
  #ifdef GAMMAALBEDO
    ta = toLinearSpaceVec3(ta); tb = toLinearSpaceVec3(tb);
  #endif
  surfaceAlbedo = surfaceAlbedo * mix(vec3f(1.0), tb / max(ta, vec3f(0.004)), gBlend);
  surfaceAlbedo = surfaceAlbedo * (1.0 + (gMacro.g - 0.5) * uniforms.groundLook.x);
  let dryK = smoothstep(0.55, 0.85, gMacro.b);
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * uniforms.groundDry.rgb, dryK * 0.65);
  var gMow = vec4f(0.0, 0.5, 0.5, 0.0);
  #ifdef GROUND_MOW
    gMow = textureSample(groundMowSampler, groundMowSamplerSampler, fragmentInputs.vMowUV);
    let lean = gMow.gb * 2.0 - 1.0;
    let toFrag = fragmentInputs.vPositionW - scene.vEyePosition.xyz;
    let look = toFrag.xz / max(length(toFrag.xz), 0.001);
    let fade = mix(1.0, 0.6, clamp(length(toFrag) / 140.0, 0.0, 1.0));
    let stripe = dot(lean, look) * gMow.r * 0.3 * fade;
    surfaceAlbedo = surfaceAlbedo * (1.0 + stripe) * mix(vec3f(0.9, 0.92, 0.8), vec3f(1.03), gMow.r);
  #endif
  #ifdef BUMP
    let na = textureSample(bumpSampler, bumpSamplerSampler, fragmentInputs.vBumpUV).xyz * 2.0 - 1.0;
    var nb = textureSample(bumpSampler, bumpSamplerSampler, groundUvB(fragmentInputs.vBumpUV)).xyz * 2.0 - 1.0;
    nb = vec3f(transpose(GROUND_ROT) * nb.xy, nb.z);
    var n = normalize(mix(na, nb, gBlend));
    n = vec3f(n.xy * (1.0 - gMow.r * 0.55), n.z);
    normalW = perturbNormalBase(TBN, normalize(n), uniforms.vBumpInfos.y);
  #endif
  let leanW = gMow.gb * 2.0 - 1.0;
  normalW = normalize(normalW + vec3f(leanW.x, 0.0, leanW.y) * gMow.r * 0.22);
  gRoughK = (1.0 + dryK * 0.5) * (1.0 - gMow.r * 0.2);
}
#endif
`;

export class GroundPlugin extends MaterialPluginBase {
  macro: BaseTexture | null = null;
  mow: BaseTexture | null = null;
  look: GroundLook;

  constructor(material: Material, look: GroundLook, macro: BaseTexture, mow: BaseTexture | null = null) {
    super(material, 'Ground', 210, { GROUND: false, GROUND_MOW: false });
    this.look = look;
    this.macro = macro;
    this.mow = mow;
    this._enable(true);
  }

  override getClassName() { return 'GroundPlugin'; }
  override isCompatible() { return true; }

  override prepareDefines(defines: Record<string, unknown>) {
    defines.GROUND = true;
    defines.GROUND_MOW = !!this.mow;
  }

  override isReadyForSubMesh() {
    return (!this.macro || this.macro.isReady()) && (!this.mow || this.mow.isReady());
  }

  override getAttributes(attributes: string[]) { if (this.mow) attributes.push('mowUV'); }

  override getSamplers(samplers: string[]) { samplers.push('groundMacroSampler', 'groundMowSampler'); }

  override getUniforms(shaderLanguage?: ShaderLanguage) {
    const ubo = [{ name: 'groundLook', size: 4, type: 'vec4' }, { name: 'groundDry', size: 3, type: 'vec3' }];
    return shaderLanguage === ShaderLanguage.WGSL ? { ubo } : { ubo, fragment: '#ifdef GROUND\nuniform vec4 groundLook;\nuniform vec3 groundDry;\n#endif' };
  }

  override bindForSubMesh(ubo: UniformBuffer) {
    const l = this.look;
    ubo.updateFloat4('groundLook', l.variation, l.antiTile, 1 / l.macroSize, 0);
    ubo.updateFloat3('groundDry', l.dry[0], l.dry[1], l.dry[2]);
    if (this.macro) ubo.setTexture('groundMacroSampler', this.macro);
    if (this.mow) ubo.setTexture('groundMowSampler', this.mow);
  }

  override getActiveTextures(list: BaseTexture[]) { if (this.macro) list.push(this.macro); if (this.mow) list.push(this.mow); }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    const wgsl = shaderLanguage === ShaderLanguage.WGSL;
    if (shaderType === 'vertex') {
      return wgsl
        ? { CUSTOM_VERTEX_DEFINITIONS: '#ifdef GROUND_MOW\nattribute mowUV: vec2f;\nvarying vMowUV: vec2f;\n#endif', CUSTOM_VERTEX_MAIN_END: '#ifdef GROUND_MOW\nvertexOutputs.vMowUV = vertexInputs.mowUV;\n#endif' }
        : { CUSTOM_VERTEX_DEFINITIONS: '#ifdef GROUND_MOW\nattribute vec2 mowUV;\nvarying vec2 vMowUV;\n#endif', CUSTOM_VERTEX_MAIN_END: '#ifdef GROUND_MOW\nvMowUV = mowUV;\n#endif' };
    }
    return wgsl
      ? {
        CUSTOM_FRAGMENT_DEFINITIONS: WGSL_DEFS,
        CUSTOM_FRAGMENT_UPDATE_ALPHA: WGSL_MAIN,
        '!var roughness: f32=reflectivityOut\\.roughness;': '#ifdef GROUND\nvar roughness: f32=clamp(reflectivityOut.roughness*gRoughK,0.0,1.0);\n#else\nvar roughness: f32=reflectivityOut.roughness;\n#endif\n',
      }
      : {
        CUSTOM_FRAGMENT_DEFINITIONS: GLSL_DEFS,
        CUSTOM_FRAGMENT_UPDATE_ALPHA: GLSL_MAIN,
        '!float roughness=reflectivityOut\\.roughness;': '#ifdef GROUND\nfloat roughness=clamp(reflectivityOut.roughness*gRoughK,0.0,1.0);\n#else\nfloat roughness=reflectivityOut.roughness;\n#endif\n',
      };
  }
}
