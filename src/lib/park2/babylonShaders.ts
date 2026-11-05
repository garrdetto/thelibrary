/**
 * Shaders for Thrill Park 2's Babylon.js backend, in GLSL (WebGL2) and WGSL (WebGPU).
 *
 * The park's meshes keep their packed vertex format (see `babylonBackend.ts`):
 * `position`, `pnormal` (xyz normal, w unused), `color` (sRGB base colour with the
 * tint weight in alpha) and `misc` (material id, wind sway / neon phase, baked AO,
 * all 0..1 unorm so the id is `x * 255`). Instanced meshes are Babylon thin
 * instances: `world0..3` carry the instance matrix and `instanceColor` the tint.
 * Park space is z-up and right-handed; the scene is right-handed, so nothing is
 * converted.
 *
 * Uniform layout shared by every material (Float32Arrays mutated each frame):
 *  uG rows  0 sunDir.xyz shadowStrength | 1 sunColor.xyz neon | 2 sky.xyz exposure | 3 ground.xyz time
 *           4 horizon.xyz fogDensity | 5 fogColor.xyz fogFalloff | 6 sunScatter.xyz detailOn | 7 camPos.xyz direct
 *           8 shadowBias, texelWorld0, cascades, lampCount | 9 zoom1, zoom2, shadowRes, taps
 *           10..21 three cascade matrices (4 columns each)
 *  uD rows  0 tint.xyz alpha | 1 emissive unlit wave wind | 2 ground specular 0 0 | 3 highlight | 4..12 slot colours
 *  uL       lamp positions (xyz) for the night lights
 */

export const G_ROWS = 22
export const D_ROWS = 13
export const LAMP_MAX = 32
export const MAT_ROWS = 24

const glG = (row: number, sw: string) => `uG[${row}].${sw}`
const wgG = (row: number, sw: string) => `uniforms.uG[${row}].${sw}`

const GLSL_COMMON = `
vec3 toLinear(vec3 c) { return c * (c * (c * 0.305306 + 0.682171) + 0.012523); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
`

const GLSL_VERTEX_BODY = (depth: boolean) => `
  mat4 fw = world;
#ifdef INSTANCES
  fw = world * mat4(world0, world1, world2, world3);
#endif
  vec3 p = position;
  vec3 tint = uD[0].xyz;
  float weight = color.a;
  float phase = 0.0;
#ifdef INSTANCES
#ifdef INSTANCESCOLOR
  tint = instanceColor.rgb;
#endif
  weight = weight > 0.02 ? 1.0 : 0.0;
  phase = fw[3].x * 0.21 + fw[3].y * 0.17;
#else
  if (weight > 0.05 && weight < 0.95) {
    tint = uD[4 + clamp(int(weight * 10.0 + 0.5) - 1, 0, 8)].xyz;
    weight = 1.0;
  }
#endif
  vec4 w = fw * vec4(p, 1.0);
  float time = ${glG(3, 'w')};
  if (uD[1].w > 0.0 && misc.y > 0.0) {
    float k = misc.y * uD[1].w, t = time + phase;
    w.xy += vec2(sin(t * 1.7 + w.z * 0.45) + 0.4 * sin(t * 4.1 + w.x), cos(t * 1.31 + w.z * 0.37) + 0.4 * cos(t * 3.7 + w.y)) * k;
  }
  if (uD[1].z > 0.0) w.z += sin(w.x * 0.35 + time * 1.3) * cos(w.y * 0.3 + time) * uD[1].z;
${depth ? `
  vec4 clip = mat4(uC[0], uC[1], uC[2], uC[3]) * vec4(w.xyz, 1.0);
  vDepth = clip.z * 0.5 + 0.5;
  gl_Position = clip;
` : `
  vNormal = mat3(fw) * pnormal.xyz;
  vec3 c0 = mix(color.rgb, color.rgb * tint, weight);
  vColor = toLinear(c0);
  vWorld = w.xyz;
  vAo = misc.z;
  vNeon = misc.y;
  int id = int(misc.x * 255.0 + 0.5);
  vMatA = uMatA[id];
  vMatB = uMatB[id];
  gl_Position = viewProjection * w;
`}`

const GLSL_VERTEX_HEAD = `
precision highp float;
attribute vec3 position;
attribute vec4 pnormal;
attribute vec4 color;
attribute vec4 misc;
#ifdef INSTANCES
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
#ifdef INSTANCESCOLOR
attribute vec4 instanceColor;
#endif
#endif
uniform mat4 world;
uniform mat4 viewProjection;
uniform vec4 uG[${G_ROWS}];
uniform vec4 uD[${D_ROWS}];
uniform vec4 uMatA[${MAT_ROWS}];
uniform vec4 uMatB[${MAT_ROWS}];
`

const GLSL_MAIN_VERTEX = `${GLSL_VERTEX_HEAD}
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
varying float vAo;
varying float vNeon;
flat varying vec4 vMatA;
flat varying vec4 vMatB;
${GLSL_COMMON}
void main() {${GLSL_VERTEX_BODY(false)}}
`

const GLSL_DEPTH_VERTEX = `${GLSL_VERTEX_HEAD}
uniform vec4 uC[4];
varying float vDepth;
${GLSL_COMMON}
void main() {${GLSL_VERTEX_BODY(true)}}
`

const GLSL_DEPTH_FRAGMENT = `
precision highp float;
varying float vDepth;
void main() {
  float d = clamp(vDepth, 0.0, 0.99999);
  vec3 enc = fract(d * vec3(1.0, 255.0, 65025.0));
  enc -= enc.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
  gl_FragColor = vec4(enc, 1.0);
}
`

const GLSL_MAIN_FRAGMENT = `
precision highp float;
precision highp sampler2DArray;
#ifdef PARK_LOW
#define QUALITY 0
#else
#define QUALITY 1
#endif
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
varying float vAo;
varying float vNeon;
flat varying vec4 vMatA;
flat varying vec4 vMatB;
uniform vec4 uG[${G_ROWS}];
uniform vec4 uD[${D_ROWS}];
uniform vec4 uL[${LAMP_MAX}];
uniform sampler2DArray uDetail;
uniform sampler2D uShadow0;
uniform sampler2D uShadow1;
uniform sampler2D uShadow2;
${GLSL_COMMON}
const float PI = 3.14159265;
float ign() { return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); }
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
float depthAt(int k, vec2 uv) {
  vec3 c = k == 0 ? texture(uShadow0, uv).rgb : (k == 1 ? texture(uShadow1, uv).rgb : texture(uShadow2, uv).rgb);
  return dot(c, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
}
float shadowAt(vec3 n) {
  float strength = ${glG(0, 'w')};
  if (strength <= 0.0) return 1.0;
  int cascades = int(${glG(8, 'z')} + 0.5);
  vec3 L = ${glG(0, 'xyz')};
  float nl = clamp(dot(n, L), 0.05, 1.0);
  float slope = sqrt(1.0 - nl * nl);
  float ang = ign() * 6.2831853;
  int taps = int(${glG(9, 'w')} + 0.5);
  float res = ${glG(9, 'z')};
  for (int ci = 0; ci < 3; ci++) {
    if (ci >= cascades) break;
    int c = cascades - 1 - ci;
    float zoom = c == 0 ? 1.0 : (c == 1 ? ${glG(9, 'x')} : ${glG(9, 'y')});
    float texel = ${glG(8, 'y')} / zoom;
    vec3 p = vWorld + n * texel * (0.35 + 1.4 * slope);
    vec4 clip = mat4(uG[10 + c * 4], uG[11 + c * 4], uG[12 + c * 4], uG[13 + c * 4]) * vec4(p, 1.0);
    float extent = max(abs(clip.x), abs(clip.y));
    if (extent > (c == 0 ? 1.0 : 0.94) || clip.z < -1.0 || clip.z > 1.0) continue;
    vec2 uv = clip.xy * 0.5 + 0.5;
    float z = clip.z * 0.5 + 0.5 - ${glG(8, 'x')} * inversesqrt(zoom) * (1.0 + min(4.0, slope / nl));
    float radius = (taps > 8 ? 2.4 : 1.9) / res;
    float sum = 0.0;
    for (int i = 0; i < 12; i++) {
      if (i >= taps) break;
      float fi = float(i);
      float r = sqrt((fi + 0.5) / float(taps)) * radius, a = fi * 2.39996 + ang;
      vec2 o = taps <= 4 ? vec2(i < 2 ? -0.5 : 0.5, (i == 0 || i == 3) ? -0.5 : 0.5) / res : vec2(cos(a), sin(a)) * r;
      sum += depthAt(c, uv + o) < z ? 0.0 : 1.0;
    }
    sum /= float(taps);
    float edge = c == 0 ? smoothstep(0.0, 0.1, 1.0 - extent) : 1.0;
    return mix(1.0, sum, strength * edge);
  }
  return 1.0;
}
vec3 envColor(vec3 r) {
  vec3 up = mix(${glG(4, 'xyz')}, ${glG(2, 'xyz')} * 1.25, smoothstep(0.0, 0.65, r.z));
  return mix(${glG(3, 'xyz')} * 0.6, up, smoothstep(-0.18, 0.04, r.z));
}
vec3 envBRDF(vec3 f0, float rough, float nv) {
  vec4 r = rough * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
  float a = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04) * a + r.zw;
  return f0 * ab.x + ab.y;
}
vec3 finish(vec3 c) {
  c = aces(c * ${glG(2, 'w')});
#if QUALITY == 0
  return sqrt(c);
#else
  return pow(c, vec3(1.0 / 2.2));
#endif
}
void main() {
  float time = ${glG(3, 'w')};
  vec3 camPos = ${glG(7, 'xyz')};
  bool direct = ${glG(7, 'w')} > 0.5;
  float uAlpha = uD[0].w, uEmissive = uD[1].x, uWave = uD[1].z, uGround = uD[2].x, uSpecular = uD[2].y;
  vec4 uHighlight = uD[3];
  float detailOn = ${glG(6, 'w')};
  if (uD[1].y > 0.5) {
    vec3 u = mix(vColor, toLinear(uHighlight.rgb), uHighlight.a);
    gl_FragColor = vec4(direct ? pow(u, vec3(1.0 / 2.2)) : u, uAlpha);
    return;
  }
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 base = vColor;
  vec3 d = vWorld - camPos;
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
    vec4 w1 = texture(uDetail, vec3(q + vec2(time * 0.013, time * 0.008), 7.0));
#if QUALITY > 0
    vec4 w2 = texture(uDetail, vec3(q * 2.7 + vec2(-time * 0.021, time * 0.017), 7.0));
#else
    vec4 w2 = vec4(0.5, 0.5, w1.b, w1.a);
#endif
    vec2 slope = ((w1.rg - 0.5) * 1.2 + (w2.rg - 0.5) * 0.8) * detailOn;
    n = normalize(vec3(slope * (uWave > 0.0 ? 1.0 : 0.5), 1.0));
    rough = 0.05; metal = 0.0; f0d = vec3(0.02); wrap = 0.0; coat = 0.0;
    if (uWave > 0.0) {
      base = mix(base, base * vec3(0.45, 0.72, 0.9), smoothstep(0.15, 1.0, depth) * 0.6);
      float foam = (1.0 - smoothstep(0.02, 0.2, depth)) * smoothstep(0.3, 0.75, w1.b * 0.7 + w2.b * 0.5) * detailOn;
      base = mix(base, vec3(0.8, 0.86, 0.88), foam);
      rough = mix(rough, 0.75, foam);
      alpha = clamp(mix(0.55, 0.97, smoothstep(0.0, 0.8, depth)) + foam, 0.0, 1.0);
    }
  } else if (detailOn > 0.0 && vMatA.z >= 0.0) {
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
  vec3 L = ${glG(0, 'xyz')};
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
  vec3 dir = (diffuseColor * (1.0 - F) * nlw + spec);
#if QUALITY > 0
  if (coat > 0.0) {
    float cdd = nh * nh * (0.0016 - 1.0) + 1.0;
    float Fc = (0.04 + 0.96 * fw) * coat;
    dir = dir * (1.0 - Fc) + vec3(0.0016 / (cdd * cdd) * 0.25 / max(vh * vh, 0.1) * Fc * nlc);
  }
#endif
  vec3 lit = dir * ${glG(1, 'xyz')} * sh;
  float hemi = n.z * 0.5 + 0.5;
  ao *= mix(0.72, 1.0, smoothstep(-0.6, 0.9, n.z));
  vec3 ambient = mix(${glG(3, 'xyz')}, ${glG(2, 'xyz')}, hemi) + ${glG(4, 'xyz')} * (1.0 - abs(n.z)) * 0.35;
  vec3 R = reflect(-V, n);
#if QUALITY == 0
  vec3 specAmb = envColor(R) * (f0 + (1.0 - f0) * pow(1.0 - nv, 5.0) * (1.0 - rough)) * (1.0 - rough * 0.7) * ao * uSpecular;
#else
  vec3 specAmb = envColor(R) * envBRDF(f0, rough, nv) * mix(1.0, ao, 0.6) * mix(0.55, 1.0, sh) * uSpecular;
  if (coat > 0.0) specAmb += envColor(R) * (0.04 + 0.96 * pow(1.0 - nv, 5.0)) * coat * 0.6 * ao;
#endif
  vec3 c = lit + diffuseColor * ambient * ao + specAmb + base * uEmissive;
  int lampCount = int(${glG(8, 'w')} + 0.5);
  if (lampCount > 0) {
    vec3 lamp = vec3(0.0);
    for (int i = 0; i < ${LAMP_MAX}; i++) {
      if (i >= lampCount) break;
      vec3 ld = uL[i].xyz - vWorld;
      float r2 = dot(ld, ld);
      if (r2 < 100.0) {
        float win = 1.0 - r2 * 0.01;
        float att = win * win / (r2 + 1.0);
        lamp += vec3(1.0, 0.9, 0.78) * (max(dot(n, ld * inversesqrt(max(r2, 1e-4))), 0.0) * att * 28.0);
      }
    }
    c += diffuseColor * lamp * mix(1.0, ao, 0.6);
  }
  if (vMatA.z < -1.5) {
    float flash = 0.35 + 0.65 * smoothstep(-0.3, 0.5, sin(time * 5.0));
    float on = vNeon < 0.002 ? flash : 0.06 + 0.94 * smoothstep(-0.15, 0.4, sin(time * 6.0 - vNeon * 6.2831853));
    c += base * ${glG(1, 'w')} * on;
  }
  c = mix(c, toLinear(uHighlight.rgb) * 1.6, uHighlight.a);
  float fog;
#if QUALITY == 0
  fog = 1.0 - exp(-${glG(4, 'w')} * dist * exp(-${glG(5, 'w')} * max(0.0, (camPos.z + vWorld.z) * 0.5)));
#else
  float rdz = d.z / max(dist, 1e-4);
  float fall = ${glG(5, 'w')};
  float h0 = exp(-fall * max(camPos.z, 0.0));
  float integral = abs(rdz * fall * dist) > 1e-3 ? h0 * (1.0 - exp(-fall * rdz * dist)) / (fall * rdz) : h0 * dist;
  fog = 1.0 - exp(-${glG(4, 'w')} * max(integral, 0.0));
#endif
  vec3 fogCol = mix(${glG(5, 'xyz')}, ${glG(6, 'xyz')}, pow(max(dot(-V, L), 0.0), 6.0));
  c = mix(c, fogCol, fog);
  gl_FragColor = vec4(direct ? finish(c) : c, alpha);
}
`

const GLSL_SKY_VERTEX = `
precision highp float;
attribute vec3 position;
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`

const GLSL_SKY_FRAGMENT = `
precision highp float;
varying vec2 vNdc;
uniform vec4 uG[${G_ROWS}];
uniform mat4 uInvViewProj;
uniform vec3 uTop;
uniform vec3 uBottom;
${GLSL_COMMON}
void main() {
  vec4 a = uInvViewProj * vec4(vNdc, 0.5, 1.0);
  vec3 dir = normalize(a.xyz / a.w - ${glG(7, 'xyz')});
  float up = clamp(dir.z, 0.0, 1.0);
  vec3 c = mix(uBottom, uTop, pow(up, 0.38));
  float sd = max(dot(dir, ${glG(0, 'xyz')}), 0.0);
  c += ${glG(6, 'xyz')} * pow(sd, 6.0) * 0.6 + ${glG(1, 'xyz')} * (pow(sd, 900.0) * 6.0 + pow(sd, 60.0) * 0.12);
  if (${glG(7, 'w')} > 0.5) c = pow(aces(c * ${glG(2, 'w')}), vec3(1.0 / 2.2));
  gl_FragColor = vec4(c, 1.0);
}
`

const WGSL_VERTEX_HEAD = `
attribute position : vec3f;
attribute pnormal : vec4f;
attribute color : vec4f;
attribute misc : vec4f;
#ifdef INSTANCES
attribute world0 : vec4f;
attribute world1 : vec4f;
attribute world2 : vec4f;
attribute world3 : vec4f;
#ifdef INSTANCESCOLOR
attribute instanceColor : vec4f;
#endif
#endif
uniform world : mat4x4f;
uniform viewProjection : mat4x4f;
uniform uG : array<vec4f, ${G_ROWS}>;
uniform uD : array<vec4f, ${D_ROWS}>;
uniform uMatA : array<vec4f, ${MAT_ROWS}>;
uniform uMatB : array<vec4f, ${MAT_ROWS}>;
fn toLinear(c : vec3f) -> vec3f { return c * (c * (c * 0.305306 + 0.682171) + 0.012523); }
`

const WGSL_VERTEX_BODY = (depth: boolean) => `
  var fw : mat4x4f = uniforms.world;
#ifdef INSTANCES
  fw = uniforms.world * mat4x4f(vertexInputs.world0, vertexInputs.world1, vertexInputs.world2, vertexInputs.world3);
#endif
  var tint : vec3f = uniforms.uD[0].xyz;
  var weight : f32 = vertexInputs.color.a;
  var phase : f32 = 0.0;
#ifdef INSTANCES
#ifdef INSTANCESCOLOR
  tint = vertexInputs.instanceColor.rgb;
#endif
  weight = select(0.0, 1.0, weight > 0.02);
  phase = fw[3].x * 0.21 + fw[3].y * 0.17;
#else
  if (weight > 0.05 && weight < 0.95) {
    tint = uniforms.uD[4 + clamp(i32(weight * 10.0 + 0.5) - 1, 0, 8)].xyz;
    weight = 1.0;
  }
#endif
  var w : vec4f = fw * vec4f(vertexInputs.position, 1.0);
  let time : f32 = ${wgG(3, 'w')};
  if (uniforms.uD[1].w > 0.0 && vertexInputs.misc.y > 0.0) {
    let k : f32 = vertexInputs.misc.y * uniforms.uD[1].w;
    let t : f32 = time + phase;
    w = vec4f(w.xy + vec2f(sin(t * 1.7 + w.z * 0.45) + 0.4 * sin(t * 4.1 + w.x), cos(t * 1.31 + w.z * 0.37) + 0.4 * cos(t * 3.7 + w.y)) * k, w.z, w.w);
  }
  if (uniforms.uD[1].z > 0.0) { w.z = w.z + sin(w.x * 0.35 + time * 1.3) * cos(w.y * 0.3 + time) * uniforms.uD[1].z; }
${depth ? `
  let clip : vec4f = mat4x4f(uniforms.uC[0], uniforms.uC[1], uniforms.uC[2], uniforms.uC[3]) * vec4f(w.xyz, 1.0);
  vertexOutputs.vDepth = clip.z * 0.5 + 0.5;
  vertexOutputs.position = vec4f(clip.x, clip.y, clip.z * 0.5 + 0.5, 1.0);
` : `
  vertexOutputs.vNormal = (fw * vec4f(vertexInputs.pnormal.xyz, 0.0)).xyz;
  vertexOutputs.vColor = toLinear(mix(vertexInputs.color.rgb, vertexInputs.color.rgb * tint, weight));
  vertexOutputs.vWorld = w.xyz;
  vertexOutputs.vAo = vertexInputs.misc.z;
  vertexOutputs.vNeon = vertexInputs.misc.y;
  let id : i32 = i32(vertexInputs.misc.x * 255.0 + 0.5);
  vertexOutputs.vMatA = uniforms.uMatA[id];
  vertexOutputs.vMatB = uniforms.uMatB[id];
  vertexOutputs.position = uniforms.viewProjection * w;
`}`

const WGSL_MAIN_VERTEX = `${WGSL_VERTEX_HEAD}
varying vNormal : vec3f;
varying vColor : vec3f;
varying vWorld : vec3f;
varying vAo : f32;
varying vNeon : f32;
flat varying vMatA : vec4f;
flat varying vMatB : vec4f;
@vertex
fn main(input : VertexInputs) -> FragmentInputs {${WGSL_VERTEX_BODY(false)}}
`

const WGSL_DEPTH_VERTEX = `${WGSL_VERTEX_HEAD}
uniform uC : array<vec4f, 4>;
varying vDepth : f32;
@vertex
fn main(input : VertexInputs) -> FragmentInputs {${WGSL_VERTEX_BODY(true)}}
`

const WGSL_DEPTH_FRAGMENT = `
varying vDepth : f32;
@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
  let d : f32 = clamp(fragmentInputs.vDepth, 0.0, 0.99999);
  var enc : vec3f = fract(d * vec3f(1.0, 255.0, 65025.0));
  enc = enc - enc.yzz * vec3f(1.0 / 255.0, 1.0 / 255.0, 0.0);
  fragmentOutputs.color = vec4f(enc, 1.0);
}
`

const WGSL_MAIN_FRAGMENT = `
const PI : f32 = 3.14159265;
#ifdef PARK_LOW
const LOWQ : bool = true;
#else
const LOWQ : bool = false;
#endif
varying vNormal : vec3f;
varying vColor : vec3f;
varying vWorld : vec3f;
varying vAo : f32;
varying vNeon : f32;
flat varying vMatA : vec4f;
flat varying vMatB : vec4f;
uniform uG : array<vec4f, ${G_ROWS}>;
uniform uD : array<vec4f, ${D_ROWS}>;
uniform uL : array<vec4f, ${LAMP_MAX}>;
var uDetailSampler : sampler;
var uDetail : texture_2d_array<f32>;
var uShadow0Sampler : sampler;
var uShadow0 : texture_2d<f32>;
var uShadow1Sampler : sampler;
var uShadow1 : texture_2d<f32>;
var uShadow2Sampler : sampler;
var uShadow2 : texture_2d<f32>;
fn toLinear(c : vec3f) -> vec3f { return c * (c * (c * 0.305306 + 0.682171) + 0.012523); }
fn aces(x : vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
fn ign(p : vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn dtex(uv : vec2f, layer : f32, gx : vec2f, gy : vec2f) -> vec4f { return textureSampleGrad(uDetail, uDetailSampler, uv, i32(layer + 0.5), gx, gy); }
fn detailTri(p : vec3f, n : vec3f, layer : f32, scale : f32, dpx : vec3f, dpy : vec3f, low : bool) -> vec4f {
  var w : vec3f = abs(n);
  if (low) {
    if (w.z >= max(w.x, w.y)) { return dtex(p.xy * scale, layer, dpx.xy * scale, dpy.xy * scale); }
    if (w.x >= w.y) { return dtex(p.yz * scale, layer, dpx.yz * scale, dpy.yz * scale); }
    return dtex(p.xz * scale, layer, dpx.xz * scale, dpy.xz * scale);
  }
  w = w * w; w = w * w; w = w / (w.x + w.y + w.z);
  return dtex(p.yz * scale, layer, dpx.yz * scale, dpy.yz * scale) * w.x + dtex(p.xz * scale, layer, dpx.xz * scale, dpy.xz * scale) * w.y + dtex(p.xy * scale, layer, dpx.xy * scale, dpy.xy * scale) * w.z;
}
fn bumpNormal(n : vec3f, dpx : vec3f, dpy : vec3f, dhx : f32, dhy : f32, k : f32) -> vec3f {
  let r1 : vec3f = cross(dpy, n);
  let r2 : vec3f = cross(n, dpx);
  let det : f32 = dot(dpx, r1);
  let g : vec3f = (dhx * r1 + dhy * r2) * sign(det);
  return normalize(abs(det) * n - g * k);
}
fn depthAt(k : i32, uv : vec2f) -> f32 {
  var c : vec3f;
  if (k == 0) { c = textureSampleLevel(uShadow0, uShadow0Sampler, uv, 0.0).rgb; }
  else if (k == 1) { c = textureSampleLevel(uShadow1, uShadow1Sampler, uv, 0.0).rgb; }
  else { c = textureSampleLevel(uShadow2, uShadow2Sampler, uv, 0.0).rgb; }
  return dot(c, vec3f(1.0, 1.0 / 255.0, 1.0 / 65025.0));
}
fn shadowAt(n : vec3f, wpos : vec3f, frag : vec2f) -> f32 {
  let strength : f32 = ${wgG(0, 'w')};
  if (strength <= 0.0) { return 1.0; }
  let cascades : i32 = i32(${wgG(8, 'z')} + 0.5);
  let L : vec3f = ${wgG(0, 'xyz')};
  let nl : f32 = clamp(dot(n, L), 0.05, 1.0);
  let slope : f32 = sqrt(1.0 - nl * nl);
  let ang : f32 = ign(frag) * 6.2831853;
  let taps : i32 = i32(${wgG(9, 'w')} + 0.5);
  let res : f32 = ${wgG(9, 'z')};
  for (var ci : i32 = 0; ci < 3; ci = ci + 1) {
    if (ci >= cascades) { break; }
    let c : i32 = cascades - 1 - ci;
    var zoom : f32 = 1.0;
    if (c == 1) { zoom = ${wgG(9, 'x')}; }
    if (c == 2) { zoom = ${wgG(9, 'y')}; }
    let texel : f32 = ${wgG(8, 'y')} / zoom;
    let p : vec3f = wpos + n * texel * (0.35 + 1.4 * slope);
    let clip : vec4f = mat4x4f(uniforms.uG[10 + c * 4], uniforms.uG[11 + c * 4], uniforms.uG[12 + c * 4], uniforms.uG[13 + c * 4]) * vec4f(p, 1.0);
    let extent : f32 = max(abs(clip.x), abs(clip.y));
    var limit : f32 = 0.94;
    if (c == 0) { limit = 1.0; }
    if (extent > limit || clip.z < -1.0 || clip.z > 1.0) { continue; }
    let uv : vec2f = vec2f(clip.x * 0.5 + 0.5, 0.5 - clip.y * 0.5);
    let z : f32 = clip.z * 0.5 + 0.5 - ${wgG(8, 'x')} * inverseSqrt(zoom) * (1.0 + min(4.0, slope / nl));
    var radius : f32 = 1.9 / res;
    if (taps > 8) { radius = 2.4 / res; }
    var sum : f32 = 0.0;
    for (var i : i32 = 0; i < 12; i = i + 1) {
      if (i >= taps) { break; }
      let fi : f32 = f32(i);
      let r : f32 = sqrt((fi + 0.5) / f32(taps)) * radius;
      let a : f32 = fi * 2.39996 + ang;
      var o : vec2f = vec2f(cos(a), sin(a)) * r;
      if (taps <= 4) {
        o = vec2f(select(0.5, -0.5, i < 2), select(0.5, -0.5, i == 0 || i == 3)) / res;
      }
      sum = sum + select(1.0, 0.0, depthAt(c, uv + o) < z);
    }
    sum = sum / f32(taps);
    var edge : f32 = 1.0;
    if (c == 0) { edge = smoothstep(0.0, 0.1, 1.0 - extent); }
    return mix(1.0, sum, strength * edge);
  }
  return 1.0;
}
fn envColor(r : vec3f) -> vec3f {
  let up : vec3f = mix(${wgG(4, 'xyz')}, ${wgG(2, 'xyz')} * 1.25, smoothstep(0.0, 0.65, r.z));
  return mix(${wgG(3, 'xyz')} * 0.6, up, smoothstep(-0.18, 0.04, r.z));
}
fn envBRDF(f0 : vec3f, rough : f32, nv : f32) -> vec3f {
  let r : vec4f = rough * vec4f(-1.0, -0.0275, -0.572, 0.022) + vec4f(1.0, 0.0425, 1.04, -0.04);
  let a : f32 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  let ab : vec2f = vec2f(-1.04, 1.04) * a + r.zw;
  return f0 * ab.x + ab.y;
}
fn finish(c0 : vec3f, low : bool) -> vec3f {
  let c : vec3f = aces(c0 * ${wgG(2, 'w')});
  if (low) { return sqrt(c); }
  return pow(c, vec3f(1.0 / 2.2));
}
@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
  let low : bool = LOWQ;
  let time : f32 = ${wgG(3, 'w')};
  let camPos : vec3f = ${wgG(7, 'xyz')};
  let direct : bool = ${wgG(7, 'w')} > 0.5;
  let uAlpha : f32 = uniforms.uD[0].w;
  let uEmissive : f32 = uniforms.uD[1].x;
  let uWave : f32 = uniforms.uD[1].z;
  let uGround : f32 = uniforms.uD[2].x;
  let uSpecular : f32 = uniforms.uD[2].y;
  let uHighlight : vec4f = uniforms.uD[3];
  let detailOn : f32 = ${wgG(6, 'w')};
  let world : vec3f = fragmentInputs.vWorld;
  let dpx : vec3f = dpdx(world);
  let dpy : vec3f = dpdy(world);
  let vMatA : vec4f = fragmentInputs.vMatA;
  let vMatB : vec4f = fragmentInputs.vMatB;
  var n : vec3f = normalize(fragmentInputs.vNormal);
  if (!fragmentInputs.frontFacing) { n = -n; }
  var result : vec4f;
  if (uniforms.uD[1].y > 0.5) {
    let u : vec3f = mix(fragmentInputs.vColor, toLinear(uHighlight.rgb), uHighlight.a);
    var shown : vec3f = u;
    if (direct) { shown = pow(u, vec3f(1.0 / 2.2)); }
    result = vec4f(shown, uAlpha);
  } else {
    var base : vec3f = fragmentInputs.vColor;
    let d : vec3f = world - camPos;
    let dist : f32 = length(d);
    let V : vec3f = -d / max(dist, 1e-4);
    var rough : f32 = vMatA.x;
    var metal : f32 = vMatA.y;
    var coat : f32 = vMatB.x;
    var wrap : f32 = vMatB.y;
    var f0d : vec3f = vec3f(vMatB.w);
    var ao : f32 = fragmentInputs.vAo;
    var alpha : f32 = uAlpha;
    if (uWave > 0.0 || vMatA.z > 6.5) {
      let depth : f32 = fragmentInputs.vAo;
      ao = 1.0;
      let q : vec2f = world.xy * 0.085;
      let g1 : vec2f = dpx.xy * 0.085;
      let g2 : vec2f = dpy.xy * 0.085;
      let w1 : vec4f = dtex(q + vec2f(time * 0.013, time * 0.008), 7.0, g1, g2);
      var w2 : vec4f = vec4f(0.5, 0.5, w1.b, w1.a);
      if (!low) { w2 = dtex(q * 2.7 + vec2f(-time * 0.021, time * 0.017), 7.0, g1 * 2.7, g2 * 2.7); }
      let slope : vec2f = ((w1.rg - 0.5) * 1.2 + (w2.rg - 0.5) * 0.8) * detailOn;
      n = normalize(vec3f(slope * select(0.5, 1.0, uWave > 0.0), 1.0));
      rough = 0.05; metal = 0.0; f0d = vec3f(0.02); wrap = 0.0; coat = 0.0;
      if (uWave > 0.0) {
        base = mix(base, base * vec3f(0.45, 0.72, 0.9), smoothstep(0.15, 1.0, depth) * 0.6);
        let foam : f32 = (1.0 - smoothstep(0.02, 0.2, depth)) * smoothstep(0.3, 0.75, w1.b * 0.7 + w2.b * 0.5) * detailOn;
        base = mix(base, vec3f(0.8, 0.86, 0.88), foam);
        rough = mix(rough, 0.75, foam);
        alpha = clamp(mix(0.55, 0.97, smoothstep(0.0, 0.8, depth)) + foam, 0.0, 1.0);
      }
    } else if (detailOn > 0.0 && vMatA.z >= 0.0) {
      let fade : f32 = 1.0 - smoothstep(40.0, 160.0, dist);
      if (uGround > 0.0) {
        let sc : f32 = vMatA.w;
        let t : vec4f = dtex(world.xy * sc, vMatA.z, dpx.xy * sc, dpy.xy * sc);
        var wide : vec4f = vec4f(0.5, 0.5, t.b, 0.5);
        if (!low) { wide = dtex(world.xy * 0.019 + 0.37, 5.0, dpx.xy * 0.019, dpy.xy * 0.019); }
        let g : f32 = clamp((base.g - max(base.r, base.b)) * 5.0, 0.0, 1.0) * uGround;
        base = base * mix(1.0, 0.78 + wide.g * 0.44, uGround);
        let dirt : f32 = smoothstep(0.58, 0.82, wide.b * 0.75 + t.b * 0.35) * g;
        base = mix(base, base * vec3f(1.35, 0.92, 0.6), dirt * 0.55);
        base = mix(base, base * vec3f(1.1, 1.0, 0.78), g * clamp(wide.g - 0.45, 0.0, 1.0) * 0.8);
        base = base * mix(1.0, 0.8 + t.g * 0.4, fade);
        ao = ao * mix(1.0, t.a, 0.55 * fade);
        rough = clamp(rough * (0.8 + t.b * 0.4), 0.04, 1.0);
        if (!low) {
          let hx : f32 = dtex((world.xy + dpx.xy) * sc, vMatA.z, dpx.xy * sc, dpy.xy * sc).r;
          let hy : f32 = dtex((world.xy + dpy.xy) * sc, vMatA.z, dpx.xy * sc, dpy.xy * sc).r;
          n = bumpNormal(n, dpx, dpy, hx - t.r, hy - t.r, vMatB.z * 0.012 / sc * fade);
        }
      } else {
        let sc : f32 = vMatA.w;
        let t : vec4f = detailTri(world, n, vMatA.z, sc, dpx, dpy, low);
        base = base * mix(1.0, 0.76 + t.g * 0.48, fade);
        rough = clamp(rough * (0.7 + t.b * 0.6), 0.04, 1.0);
        ao = ao * mix(1.0, t.a, 0.7 * fade);
        if (!low) {
          let hx : f32 = detailTri(world + dpx, n, vMatA.z, sc, dpx, dpy, false).r;
          let hy : f32 = detailTri(world + dpy, n, vMatA.z, sc, dpx, dpy, false).r;
          n = bumpNormal(n, dpx, dpy, hx - t.r, hy - t.r, vMatB.z * 0.006 / sc * fade);
        }
      }
    }
    rough = clamp(rough, 0.045, 1.0);
    let sh : f32 = shadowAt(n, world, fragmentInputs.position.xy);
    let L : vec3f = ${wgG(0, 'xyz')};
    let H : vec3f = normalize(L + V);
    let nl : f32 = dot(n, L);
    let nlc : f32 = clamp(nl, 0.0, 1.0);
    let nv : f32 = clamp(dot(n, V), 1e-3, 1.0);
    let nh : f32 = clamp(dot(n, H), 0.0, 1.0);
    let vh : f32 = clamp(dot(V, H), 0.0, 1.0);
    let nlw : f32 = clamp((nl + wrap) / ((1.0 + wrap) * (1.0 + wrap)), 0.0, 1.0);
    let f0 : vec3f = mix(f0d, base, metal);
    let diffuseColor : vec3f = base * (1.0 - metal);
    let a2 : f32 = rough * rough * rough * rough;
    let dd : f32 = nh * nh * (a2 - 1.0) + 1.0;
    let D : f32 = a2 / (PI * dd * dd);
    let k : f32 = rough * rough * 0.5;
    let Vis : f32 = 0.25 / ((nlc * (1.0 - k) + k) * (nv * (1.0 - k) + k));
    let fw : f32 = pow(1.0 - vh, 5.0);
    let F : vec3f = f0 + (1.0 - f0) * fw;
    let spec : vec3f = PI * D * Vis * F * nlc * uSpecular;
    var dir : vec3f = diffuseColor * (1.0 - F) * nlw + spec;
    if (!low && coat > 0.0) {
      let cdd : f32 = nh * nh * (0.0016 - 1.0) + 1.0;
      let Fc : f32 = (0.04 + 0.96 * fw) * coat;
      dir = dir * (1.0 - Fc) + vec3f(0.0016 / (cdd * cdd) * 0.25 / max(vh * vh, 0.1) * Fc * nlc);
    }
    let lit : vec3f = dir * ${wgG(1, 'xyz')} * sh;
    let hemi : f32 = n.z * 0.5 + 0.5;
    ao = ao * mix(0.72, 1.0, smoothstep(-0.6, 0.9, n.z));
    let ambient : vec3f = mix(${wgG(3, 'xyz')}, ${wgG(2, 'xyz')}, hemi) + ${wgG(4, 'xyz')} * (1.0 - abs(n.z)) * 0.35;
    let R : vec3f = reflect(-V, n);
    var specAmb : vec3f;
    if (low) {
      specAmb = envColor(R) * (f0 + (1.0 - f0) * pow(1.0 - nv, 5.0) * (1.0 - rough)) * (1.0 - rough * 0.7) * ao * uSpecular;
    } else {
      specAmb = envColor(R) * envBRDF(f0, rough, nv) * mix(1.0, ao, 0.6) * mix(0.55, 1.0, sh) * uSpecular;
      if (coat > 0.0) { specAmb = specAmb + envColor(R) * (0.04 + 0.96 * pow(1.0 - nv, 5.0)) * coat * 0.6 * ao; }
    }
    var c : vec3f = lit + diffuseColor * ambient * ao + specAmb + base * uEmissive;
    let lampCount : i32 = i32(${wgG(8, 'w')} + 0.5);
    if (lampCount > 0) {
      var lamp : vec3f = vec3f(0.0);
      for (var i : i32 = 0; i < ${LAMP_MAX}; i = i + 1) {
        if (i >= lampCount) { break; }
        let ld : vec3f = uniforms.uL[i].xyz - world;
        let r2 : f32 = dot(ld, ld);
        if (r2 < 100.0) {
          let win : f32 = 1.0 - r2 * 0.01;
          let att : f32 = win * win / (r2 + 1.0);
          lamp = lamp + vec3f(1.0, 0.9, 0.78) * (max(dot(n, ld * inverseSqrt(max(r2, 1e-4))), 0.0) * att * 28.0);
        }
      }
      c = c + diffuseColor * lamp * mix(1.0, ao, 0.6);
    }
    if (vMatA.z < -1.5) {
      let neon : f32 = fragmentInputs.vNeon;
      let flash : f32 = 0.35 + 0.65 * smoothstep(-0.3, 0.5, sin(time * 5.0));
      var on : f32 = 0.06 + 0.94 * smoothstep(-0.15, 0.4, sin(time * 6.0 - neon * 6.2831853));
      if (neon < 0.002) { on = flash; }
      c = c + base * ${wgG(1, 'w')} * on;
    }
    c = mix(c, toLinear(uHighlight.rgb) * 1.6, uHighlight.a);
    var fog : f32;
    if (low) {
      fog = 1.0 - exp(-${wgG(4, 'w')} * dist * exp(-${wgG(5, 'w')} * max(0.0, (camPos.z + world.z) * 0.5)));
    } else {
      let rdz : f32 = d.z / max(dist, 1e-4);
      let fall : f32 = ${wgG(5, 'w')};
      let h0 : f32 = exp(-fall * max(camPos.z, 0.0));
      var integral : f32 = h0 * dist;
      if (abs(rdz * fall * dist) > 1e-3) { integral = h0 * (1.0 - exp(-fall * rdz * dist)) / (fall * rdz); }
      fog = 1.0 - exp(-${wgG(4, 'w')} * max(integral, 0.0));
    }
    let fogCol : vec3f = mix(${wgG(5, 'xyz')}, ${wgG(6, 'xyz')}, pow(max(dot(-V, L), 0.0), 6.0));
    c = mix(c, fogCol, fog);
    var shown : vec3f = c;
    if (direct) { shown = finish(c, low); }
    result = vec4f(shown, alpha);
  }
  fragmentOutputs.color = result;
}
`

const WGSL_SKY_VERTEX = `
attribute position : vec3f;
varying vNdc : vec2f;
@vertex
fn main(input : VertexInputs) -> FragmentInputs {
  vertexOutputs.vNdc = vertexInputs.position.xy;
  vertexOutputs.position = vec4f(vertexInputs.position.xy, 0.9999, 1.0);
}
`

const WGSL_SKY_FRAGMENT = `
varying vNdc : vec2f;
uniform uG : array<vec4f, ${G_ROWS}>;
uniform uInvViewProj : mat4x4f;
uniform uTop : vec3f;
uniform uBottom : vec3f;
fn aces(x : vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
  let a : vec4f = uniforms.uInvViewProj * vec4f(fragmentInputs.vNdc, 0.5, 1.0);
  let dir : vec3f = normalize(a.xyz / a.w - ${wgG(7, 'xyz')});
  let up : f32 = clamp(dir.z, 0.0, 1.0);
  var c : vec3f = mix(uniforms.uBottom, uniforms.uTop, pow(up, 0.38));
  let sd : f32 = max(dot(dir, ${wgG(0, 'xyz')}), 0.0);
  c = c + ${wgG(6, 'xyz')} * pow(sd, 6.0) * 0.6 + ${wgG(1, 'xyz')} * (pow(sd, 900.0) * 6.0 + pow(sd, 60.0) * 0.12);
  if (${wgG(7, 'w')} > 0.5) { c = pow(aces(c * ${wgG(2, 'w')}), vec3f(1.0 / 2.2)); }
  fragmentOutputs.color = vec4f(c, 1.0);
}
`

export type ShaderSet = { vertex: string; fragment: string }

export const SHADERS = {
  glsl: {
    main: { vertex: GLSL_MAIN_VERTEX, fragment: GLSL_MAIN_FRAGMENT },
    depth: { vertex: GLSL_DEPTH_VERTEX, fragment: GLSL_DEPTH_FRAGMENT },
    sky: { vertex: GLSL_SKY_VERTEX, fragment: GLSL_SKY_FRAGMENT },
  },
  wgsl: {
    main: { vertex: WGSL_MAIN_VERTEX, fragment: WGSL_MAIN_FRAGMENT },
    depth: { vertex: WGSL_DEPTH_VERTEX, fragment: WGSL_DEPTH_FRAGMENT },
    sky: { vertex: WGSL_SKY_VERTEX, fragment: WGSL_SKY_FRAGMENT },
  },
}
