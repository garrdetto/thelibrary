/**
 * The resident recolor, as a Babylon material plugin in WGSL and GLSL: keeps
 * the scan's shading and swaps each region's colour (skin, hair, eyes,
 * jacket, tee, pants, shoes, soles from the region mask), with the
 * wardrobe's two-colour patterns painted in rest-pose model space.
 *
 * The rest-pose position of every vertex rides in its own `restPos` vertex
 * stream (added to the shared scan geometry once per body), so stripes and
 * plaid stay level and sized in real centimetres while the skeleton walks.
 * Every look is its own material, but all share one compiled shader.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { MASK_STEP } from '../../../maplestreet/src/avatar/RigData';

export interface AvatarLook {
  skin: number[]; hair: number[]; eyes: number[]; tee: number[]; top1: number[]; top2: number[];
  pants1: number[]; pants2: number[]; shoes1: number[]; shoes2: number[]; pat: number[];
}

const COLORS = ['avSkin', 'avHair', 'avEyes', 'avTee', 'avTop1', 'avTop2', 'avPants1', 'avPants2', 'avShoes1', 'avShoes2', 'avPat'] as const;
const KEYS: (keyof AvatarLook)[] = ['skin', 'hair', 'eyes', 'tee', 'top1', 'top2', 'pants1', 'pants2', 'shoes1', 'shoes2', 'pat'];

const GLSL_DEFS = `
#ifdef AVATAR
uniform sampler2D avMaskSampler;
varying vec3 vRest;
float avHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float avNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(avHash(i), avHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(avHash(i + vec3(0.0, 1.0, 0.0)), avHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(avHash(i + vec3(0.0, 0.0, 1.0)), avHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(avHash(i + vec3(0.0, 1.0, 1.0)), avHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z) * 2.0 - 1.0;
}
float avIsPat(float pat, float id) { return step(abs(pat - id), 0.5); }
vec3 avPatterned(float pat, vec3 c1, vec3 c2, vec3 p, vec4 rig) {
  float sideways = p.x + p.z * 0.7;
  float stripes = step(0.5, fract(p.y / 0.085));
  float plaidA = step(0.5, fract(sideways / 0.11)), plaidB = step(0.5, fract(p.y / 0.11));
  float over = max(step(0.93, fract(sideways / 0.11 + 0.25)), step(0.93, fract(p.y / 0.11 + 0.25)));
  float camoN = avNoise(p * 7.5) + avNoise(p * 17.0 + 3.1) * 0.45;
  float camo = smoothstep(0.02, 0.08, camoN), camoDark = smoothstep(0.32, 0.38, camoN);
  float sleeve = smoothstep(rig.x - 0.01, rig.x + 0.03, abs(p.x)) * step(p.y, rig.y + 0.06);
  float twill = (fract((p.x + p.y + p.z) * 260.0) - 0.5) * 0.16 + avNoise(p * 40.0) * 0.12 + 1.0;
  float checker = mod(floor(p.x / 0.022) + floor(p.y / 0.022) + floor(p.z / 0.022), 2.0);
  vec3 col = c1;
  col = mix(col, c2, avIsPat(pat, 1.0) * stripes);
  vec3 plaid = mix(mix(c1, c2, (plaidA + plaidB) * 0.5), vec3(0.92, 0.9, 0.84), over * 0.35);
  col = mix(col, plaid, avIsPat(pat, 2.0));
  vec3 camoCol = mix(mix(c1, mix(c1, c2, 0.5) * 1.25, camo), c2, camoDark);
  col = mix(col, camoCol, avIsPat(pat, 3.0));
  col = mix(col, c2, avIsPat(pat, 4.0) * sleeve);
  col = mix(col, c1 * twill, avIsPat(pat, 5.0));
  col = mix(col, mix(c1, c2, checker), avIsPat(pat, 6.0));
  return col;
}
float avDetail(float lum, float ref, float k) { return pow(clamp(lum / ref, 0.05, 2.4), k); }
float avIsRegion(float id, float r) { return step(abs(id - r), 0.5); }
#endif
`;

const GLSL_MAIN = `
#ifdef AVATAR
{
  vec3 base = surfaceAlbedo;
  float id = floor(texture2D(avMaskSampler, vAlbedoUV).r * (255.0 / ${MASK_STEP}.0) + 0.5);
  vec3 p = vRest;
  float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
  vec3 skin = avSkin * avDetail(lum, avRefA.x, 0.85);
  vec3 top = avPatterned(avPat.x, avTop1, avTop2, p, avRig) * avDetail(lum, avRefA.z, 0.7);
  vec3 tee = avTee * avDetail(lum, avRefA.w, 0.85);
  vec3 pantsCol = avPatterned(avPat.y, avPants1, avPants2, p, avRig) * avDetail(lum, avRefB.x, 0.8);
  vec3 shoeUpper = avPatterned(avPat.z, avShoes1, avShoes2, p, avRig) * avDetail(lum, avRefB.y, 0.75);
  float shorts = avIsPat(avPat.y, 7.0) * step(p.y, avRig.z - 0.035);
  float highTop = avIsPat(avPat.z, 8.0) * step(p.y, avRig.w + 0.075);
  vec3 legSkin = avSkin * avDetail(lum, avRefB.x, 0.45) * 0.95;
  vec3 pants = mix(pantsCol, legSkin, shorts);
  pants = mix(pants, avShoes1 * avDetail(lum, avRefB.x, 0.7), highTop * (1.0 - shorts));
  vec3 soles = mix(avShoes2 * avDetail(lum, avRefB.z, 0.6), base, 0.15);
  vec3 o = base;
  o = mix(o, skin, avIsRegion(id, 1.0));
  o = mix(o, avHair * avDetail(lum, avRefA.y, 0.9), avIsRegion(id, 2.0));
  o = mix(o, top, avIsRegion(id, 3.0));
  o = mix(o, tee, avIsRegion(id, 4.0));
  o = mix(o, pants, avIsRegion(id, 5.0));
  o = mix(o, shoeUpper, avIsRegion(id, 6.0));
  o = mix(o, soles, avIsRegion(id, 7.0));
  o = mix(o, avEyes * avDetail(lum, avRefB.w, 0.7), avIsRegion(id, 8.0));
  surfaceAlbedo = id < 0.5 ? base : o;
}
#endif
`;

const WGSL_DEFS = `
#ifdef AVATAR
var avMaskSamplerSampler: sampler;
var avMaskSampler: texture_2d<f32>;
varying vRest: vec3f;
fn avHash(q: vec3f) -> f32 { var p = fract(q * 0.3183099 + 0.1); p = p * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn avNoise(x: vec3f) -> f32 {
  let i = floor(x); var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(avHash(i), avHash(i + vec3f(1.0, 0.0, 0.0)), f.x), mix(avHash(i + vec3f(0.0, 1.0, 0.0)), avHash(i + vec3f(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(avHash(i + vec3f(0.0, 0.0, 1.0)), avHash(i + vec3f(1.0, 0.0, 1.0)), f.x), mix(avHash(i + vec3f(0.0, 1.0, 1.0)), avHash(i + vec3f(1.0, 1.0, 1.0)), f.x), f.y), f.z) * 2.0 - 1.0;
}
fn avIsPat(pat: f32, id: f32) -> f32 { return step(abs(pat - id), 0.5); }
fn avPatterned(pat: f32, c1: vec3f, c2: vec3f, p: vec3f, rig: vec4f) -> vec3f {
  let sideways = p.x + p.z * 0.7;
  let stripes = step(0.5, fract(p.y / 0.085));
  let plaidA = step(0.5, fract(sideways / 0.11)); let plaidB = step(0.5, fract(p.y / 0.11));
  let over = max(step(0.93, fract(sideways / 0.11 + 0.25)), step(0.93, fract(p.y / 0.11 + 0.25)));
  let camoN = avNoise(p * 7.5) + avNoise(p * 17.0 + 3.1) * 0.45;
  let camo = smoothstep(0.02, 0.08, camoN); let camoDark = smoothstep(0.32, 0.38, camoN);
  let sleeve = smoothstep(rig.x - 0.01, rig.x + 0.03, abs(p.x)) * step(p.y, rig.y + 0.06);
  let twill = (fract((p.x + p.y + p.z) * 260.0) - 0.5) * 0.16 + avNoise(p * 40.0) * 0.12 + 1.0;
  let cs = floor(p.x / 0.022) + floor(p.y / 0.022) + floor(p.z / 0.022);
  let checker = cs - 2.0 * floor(cs / 2.0);
  var col = c1;
  col = mix(col, c2, avIsPat(pat, 1.0) * stripes);
  let plaid = mix(mix(c1, c2, (plaidA + plaidB) * 0.5), vec3f(0.92, 0.9, 0.84), over * 0.35);
  col = mix(col, plaid, avIsPat(pat, 2.0));
  let camoCol = mix(mix(c1, mix(c1, c2, 0.5) * 1.25, camo), c2, camoDark);
  col = mix(col, camoCol, avIsPat(pat, 3.0));
  col = mix(col, c2, avIsPat(pat, 4.0) * sleeve);
  col = mix(col, c1 * twill, avIsPat(pat, 5.0));
  col = mix(col, mix(c1, c2, checker), avIsPat(pat, 6.0));
  return col;
}
fn avDetail(lum: f32, rv: f32, k: f32) -> f32 { return pow(clamp(lum / rv, 0.05, 2.4), k); }
fn avIsRegion(id: f32, r: f32) -> f32 { return step(abs(id - r), 0.5); }
#endif
`;

const WGSL_MAIN = `
#ifdef AVATAR
{
  let base = surfaceAlbedo;
  let id = floor(textureSample(avMaskSampler, avMaskSamplerSampler, fragmentInputs.vAlbedoUV).r * (255.0 / ${MASK_STEP}.0) + 0.5);
  let p = fragmentInputs.vRest;
  let lum = dot(base, vec3f(0.2126, 0.7152, 0.0722));
  let U = uniforms.avRig;
  let skin = uniforms.avSkin * avDetail(lum, uniforms.avRefA.x, 0.85);
  let top = avPatterned(uniforms.avPat.x, uniforms.avTop1, uniforms.avTop2, p, U) * avDetail(lum, uniforms.avRefA.z, 0.7);
  let tee = uniforms.avTee * avDetail(lum, uniforms.avRefA.w, 0.85);
  let pantsCol = avPatterned(uniforms.avPat.y, uniforms.avPants1, uniforms.avPants2, p, U) * avDetail(lum, uniforms.avRefB.x, 0.8);
  let shoeUpper = avPatterned(uniforms.avPat.z, uniforms.avShoes1, uniforms.avShoes2, p, U) * avDetail(lum, uniforms.avRefB.y, 0.75);
  let shorts = avIsPat(uniforms.avPat.y, 7.0) * step(p.y, U.z - 0.035);
  let highTop = avIsPat(uniforms.avPat.z, 8.0) * step(p.y, U.w + 0.075);
  let legSkin = uniforms.avSkin * avDetail(lum, uniforms.avRefB.x, 0.45) * 0.95;
  var pants = mix(pantsCol, legSkin, shorts);
  pants = mix(pants, uniforms.avShoes1 * avDetail(lum, uniforms.avRefB.x, 0.7), highTop * (1.0 - shorts));
  let soles = mix(uniforms.avShoes2 * avDetail(lum, uniforms.avRefB.z, 0.6), base, 0.15);
  var o = base;
  o = mix(o, skin, avIsRegion(id, 1.0));
  o = mix(o, uniforms.avHair * avDetail(lum, uniforms.avRefA.y, 0.9), avIsRegion(id, 2.0));
  o = mix(o, top, avIsRegion(id, 3.0));
  o = mix(o, tee, avIsRegion(id, 4.0));
  o = mix(o, pants, avIsRegion(id, 5.0));
  o = mix(o, shoeUpper, avIsRegion(id, 6.0));
  o = mix(o, soles, avIsRegion(id, 7.0));
  o = mix(o, uniforms.avEyes * avDetail(lum, uniforms.avRefB.w, 0.7), avIsRegion(id, 8.0));
  surfaceAlbedo = select(o, base, id < 0.5);
}
#endif
`;

export class AvatarPlugin extends MaterialPluginBase {
  look: AvatarLook;
  rig = [0, 0, 0, 0];
  refA = [1, 1, 1, 1];
  refB = [1, 1, 1, 1];

  constructor(material: Material, readonly mask: BaseTexture, look: AvatarLook) {
    super(material, 'Avatar', 220, { AVATAR: false });
    this.look = look;
    this._enable(true);
  }

  override getClassName() { return 'AvatarPlugin'; }
  override isCompatible() { return true; }
  override prepareDefines(defines: Record<string, unknown>) { defines.AVATAR = true; }
  override isReadyForSubMesh() { return this.mask.isReady(); }
  override getAttributes(attributes: string[]) { attributes.push('restPos'); }
  override getSamplers(samplers: string[]) { samplers.push('avMaskSampler'); }
  override getActiveTextures(list: BaseTexture[]) { list.push(this.mask); }

  override getUniforms(shaderLanguage?: ShaderLanguage) {
    const ubo = [
      ...COLORS.map(name => ({ name, size: 3, type: 'vec3' })),
      { name: 'avRig', size: 4, type: 'vec4' }, { name: 'avRefA', size: 4, type: 'vec4' }, { name: 'avRefB', size: 4, type: 'vec4' },
    ];
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo };
    return { ubo, fragment: `#ifdef AVATAR\n${COLORS.map(n => `uniform vec3 ${n};`).join('\n')}\nuniform vec4 avRig;\nuniform vec4 avRefA;\nuniform vec4 avRefB;\n#endif` };
  }

  override bindForSubMesh(ubo: UniformBuffer) {
    const L = this.look;
    for (let i = 0; i < COLORS.length; i++) { const c = L[KEYS[i]]; ubo.updateFloat3(COLORS[i], c[0], c[1], c[2]); }
    ubo.updateFloat4('avRig', this.rig[0], this.rig[1], this.rig[2], this.rig[3]);
    ubo.updateFloat4('avRefA', this.refA[0], this.refA[1], this.refA[2], this.refA[3]);
    ubo.updateFloat4('avRefB', this.refB[0], this.refB[1], this.refB[2], this.refB[3]);
    ubo.setTexture('avMaskSampler', this.mask);
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    const wgsl = shaderLanguage === ShaderLanguage.WGSL;
    if (shaderType === 'vertex') {
      return wgsl
        ? { CUSTOM_VERTEX_DEFINITIONS: '#ifdef AVATAR\nattribute restPos: vec3f;\nvarying vRest: vec3f;\n#endif', CUSTOM_VERTEX_MAIN_END: '#ifdef AVATAR\nvertexOutputs.vRest = vertexInputs.restPos;\n#endif' }
        : { CUSTOM_VERTEX_DEFINITIONS: '#ifdef AVATAR\nattribute vec3 restPos;\nvarying vec3 vRest;\n#endif', CUSTOM_VERTEX_MAIN_END: '#ifdef AVATAR\nvRest = restPos;\n#endif' };
    }
    return wgsl
      ? { CUSTOM_FRAGMENT_DEFINITIONS: WGSL_DEFS, CUSTOM_FRAGMENT_UPDATE_ALPHA: WGSL_MAIN }
      : { CUSTOM_FRAGMENT_DEFINITIONS: GLSL_DEFS, CUSTOM_FRAGMENT_UPDATE_ALPHA: GLSL_MAIN };
  }
}
