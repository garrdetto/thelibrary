/**
 * Shader chunks for the big flat surfaces (wild grass, lawns, asphalt,
 * concrete): the same PBR maps, without the visible repeat and with lawn
 * stripes from the mowing atlas.
 *
 * Anti-tiling: every map is read twice, at its own UV and at a rotated,
 * rescaled copy, and the two are blended by a world-space macro noise
 * (`uMacro`, one copy every 1 / uGround.z metres). Normals from the rotated
 * read are turned back into the base UV frame before blending. The macro
 * texture also carries a brightness drift (G) and dry or worn patches (B),
 * which tint the albedo and roughen the gloss.
 *
 * Lawns: the diffuse detail map is the lawn atlas (Town.ts), one texel per
 * 1 m cell: R = how freshly cut (1 just mown, 0 grown out), G/B = the blade
 * lean in world XZ (×0.5 + 0.5). Bilinear filtering blends neighbouring cells,
 * so edges stay soft. Blades leaning away from the camera show their lit
 * upper sides (lighter), toward it their shaded undersides (darker), which is
 * what makes real stripes swap shade when you walk around them. Cut grass is
 * also flatter: its normal map is damped and tilted along the lean.
 */
import * as pc from 'playcanvas';

const DIFFUSE = /* glsl */ `
uniform vec3 material_diffuse;
uniform sampler2D uMacro;
uniform vec4 uGround;
uniform vec3 uDry;
const mat2 GROUND_ROT = mat2(0.8, 0.6, -0.6, 0.8);
vec4 gMacro;
float gBlend;
vec4 gMow;
vec2 groundUvB(vec2 uv) { return GROUND_ROT * uv * 0.613 + vec2(0.37, 0.71); }
void getAlbedo() {
  gMacro = texture2D(uMacro, vPositionW.xz * uGround.z);
  gBlend = smoothstep(0.32, 0.68, gMacro.r) * uGround.y;
  vec2 uv = {STD_DIFFUSE_TEXTURE_UV};
  vec3 a = {STD_DIFFUSE_TEXTURE_DECODE}(texture2DBias({STD_DIFFUSE_TEXTURE_NAME}, uv, {STD_TEXTURE_BIAS})).rgb;
  vec3 b = {STD_DIFFUSE_TEXTURE_DECODE}(texture2DBias({STD_DIFFUSE_TEXTURE_NAME}, groundUvB(uv), {STD_TEXTURE_BIAS})).rgb;
  vec3 tex = mix(a, b, gBlend);
  tex *= 1.0 + (gMacro.g - 0.5) * uGround.x;
  tex = mix(tex, tex * uDry, smoothstep(0.55, 0.85, gMacro.b) * 0.65);
  dAlbedo = material_diffuse.rgb * tex;
  gMow = vec4(0.0, 0.5, 0.5, 0.0);
  #ifdef STD_DIFFUSEDETAIL_TEXTURE
    gMow = texture2D({STD_DIFFUSEDETAIL_TEXTURE_NAME}, {STD_DIFFUSEDETAIL_TEXTURE_UV});
    float cut = gMow.r;
    vec2 lean = gMow.gb * 2.0 - 1.0;
    vec3 toFrag = vPositionW - view_position;
    vec2 look = toFrag.xz / max(length(toFrag.xz), 0.001);
    float fade = mix(1.0, 0.6, clamp(length(toFrag) / 140.0, 0.0, 1.0));
    float stripe = dot(lean, look) * cut * 0.3 * fade;
    dAlbedo *= (1.0 + stripe) * mix(vec3(0.9, 0.92, 0.8), vec3(1.03), cut);
  #endif
  #ifdef STD_DIFFUSE_VERTEX
    dAlbedo *= saturate(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
  #endif
}
`;

const NORMAL = /* glsl */ `
#ifdef STD_NORMAL_TEXTURE
uniform float material_bumpiness;
#endif
void getNormal() {
  #ifdef STD_NORMAL_TEXTURE
    vec2 uv = {STD_NORMAL_TEXTURE_UV};
    vec3 na = {STD_NORMAL_TEXTURE_DECODE}(texture2DBias({STD_NORMAL_TEXTURE_NAME}, uv, {STD_TEXTURE_BIAS}));
    vec3 nb = {STD_NORMAL_TEXTURE_DECODE}(texture2DBias({STD_NORMAL_TEXTURE_NAME}, groundUvB(uv), {STD_TEXTURE_BIAS}));
    nb.xy = transpose(GROUND_ROT) * nb.xy;
    vec3 n = normalize(mix(na, nb, gBlend));
    float cutFlat = 1.0 - gMow.r * 0.55;
    n = mix(vec3(0.0, 0.0, 1.0), n, material_bumpiness * cutFlat);
    dNormalW = normalize(dTBN * n);
  #else
    dNormalW = dVertexNormalW;
  #endif
  vec2 lean = gMow.gb * 2.0 - 1.0;
  dNormalW = normalize(dNormalW + vec3(lean.x, 0.0, lean.y) * gMow.r * 0.22);
}
`;

const GLOSS = /* glsl */ `
uniform float material_gloss;
void getGlossiness() {
  dGlossiness = material_gloss;
  #ifdef STD_GLOSS_TEXTURE
    vec2 uv = {STD_GLOSS_TEXTURE_UV};
    float ga = texture2DBias({STD_GLOSS_TEXTURE_NAME}, uv, {STD_TEXTURE_BIAS}).{STD_GLOSS_TEXTURE_CHANNEL};
    float gb = texture2DBias({STD_GLOSS_TEXTURE_NAME}, groundUvB(uv), {STD_TEXTURE_BIAS}).{STD_GLOSS_TEXTURE_CHANNEL};
    dGlossiness *= mix(ga, gb, gBlend);
  #endif
  dGlossiness *= 1.0 - smoothstep(0.55, 0.85, gMacro.b) * 0.35;
  dGlossiness *= 1.0 + gMow.r * 0.25;
  dGlossiness += 0.0000001;
}
`;

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

/** Installs the ground chunks on a textured material (diffuse, normal and gloss maps). */
export function groundShader(m: pc.StandardMaterial, macro: pc.Texture, look: GroundLook) {
  const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
  chunks.set('diffusePS', DIFFUSE);
  chunks.set('normalMapPS', NORMAL);
  chunks.set('glossPS', GLOSS);
  m.shaderChunksVersion = '2.8';
  m.setParameter('uMacro', macro);
  m.setParameter('uGround', [look.variation, look.antiTile, 1 / look.macroSize, 0]);
  m.setParameter('uDry', look.dry);
  m.update();
}
