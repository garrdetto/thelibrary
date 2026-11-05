/**
 * PlayCanvas shader chunks for Thrill Park 2.
 *
 * The park's meshes keep their packed vertex format (see `pcBackend.ts`):
 * vertex_color is the sRGB base colour with the tint weight in alpha, and
 * vertex_texCoord2 is (material id, wind sway / neon phase, baked AO, 0).
 * Instanced meshes read (x, y, z, yaw) from vertex_texCoord6 and
 * (r, g, b, scale) from vertex_texCoord7, the classic renderer's
 * InstanceList layout. Park space is z-up; PlayCanvas world space is y-up,
 * reached by the world root's rotation (park (x, y, z) -> world (x, z, -y)).
 *
 * The surface (albedo, roughness, metalness, AO, normal, emission, opacity)
 * is evaluated once per fragment in `parkEval`, ported from the classic
 * renderer, and handed to PlayCanvas's lighting through the standard getters.
 */

const PARK_VS_DECL = `
attribute vec4 vertex_texCoord2;
#ifdef INSTANCING
attribute vec4 vertex_texCoord6;
attribute vec4 vertex_texCoord7;
#endif
uniform vec3 uTint;
uniform vec3 uSlots[9];
uniform float uWave;
uniform float uWind;
uniform float uParkTime;
uniform vec4 uMatA[24];
uniform vec4 uMatB[24];
varying vec3 vParkColor;
varying float vParkAo;
varying float vParkNeon;
varying vec4 vParkMatA;
varying vec4 vParkMatB;
`

const PARK_VS_END = `
#ifdef VERTEX_COLOR
  {
    vec4 col = vertex_color;
    float weight = col.a;
    vec3 tint = uTint;
#ifdef INSTANCING
    tint = vertex_texCoord7.rgb;
    weight = weight > 0.02 ? 1.0 : 0.0;
#else
    if (weight > 0.05 && weight < 0.95) {
      tint = uSlots[clamp(int(weight * 10.0 + 0.5) - 1, 0, 8)];
      weight = 1.0;
    }
#endif
    vec3 c = mix(col.rgb, col.rgb * tint, weight);
    vParkColor = c * (c * (c * 0.305306 + 0.682171) + 0.012523);
    vParkAo = vertex_texCoord2.z / 255.0;
    vParkNeon = vertex_texCoord2.y / 255.0;
    int id = int(vertex_texCoord2.x + 0.5);
    vParkMatA = uMatA[id];
    vParkMatB = uMatB[id];
  }
#endif
`

/** Instancing: yaw about park z, uniform scale, then translate; matrix_model is the park-to-world root. */
const PARK_INSTANCING = `
mat4 getModelMatrix() {
  float c = cos(vertex_texCoord6.w), s = sin(vertex_texCoord6.w), k = vertex_texCoord7.w;
  mat4 inst = mat4(c * k, s * k, 0.0, 0.0, -s * k, c * k, 0.0, 0.0, 0.0, 0.0, k, 0.0, vertex_texCoord6.x, vertex_texCoord6.y, vertex_texCoord6.z, 1.0);
  return matrix_model * inst;
}
`

/** The stock transform chunk plus the classic renderer's wind sway and wave bob, applied in park space. */
const PARK_TRANSFORM = `
#ifdef PIXELSNAP
uniform vec4 screen_size;
#endif
vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
  vec3 localPos = getLocalPosition(vertexPosition);
  vec4 posW = modelMatrix * vec4(localPos, 1.0);
  vec3 w = vec3(posW.x, -posW.z, posW.y);
  float phase = 0.0;
#ifdef INSTANCING
  phase = vertex_texCoord6.x * 0.21 + vertex_texCoord6.y * 0.17;
#endif
  if (uWind > 0.0 && vertex_texCoord2.y > 0.0) {
    float k = vertex_texCoord2.y / 255.0 * uWind, t = uParkTime + phase;
    w.xy += vec2(sin(t * 1.7 + w.z * 0.45) + 0.4 * sin(t * 4.1 + w.x), cos(t * 1.31 + w.z * 0.37) + 0.4 * cos(t * 3.7 + w.y)) * k;
  }
  if (uWave > 0.0) w.z += sin(w.x * 0.35 + uParkTime * 1.3) * cos(w.y * 0.3 + uParkTime) * uWave;
  return vec4(w.x, w.z, -w.y, posW.w);
}
vec4 getPosition() {
  dModelMatrix = getModelMatrix();
  vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
  dPositionW = posW.xyz;
  return matrix_viewProjection * posW;
}
vec3 getWorldPosition() {
  return dPositionW;
}
`

const PARK_PS_DECL = `
varying vec3 vParkColor;
varying float vParkAo;
varying float vParkNeon;
varying vec4 vParkMatA;
varying vec4 vParkMatB;
uniform float uParkTime;
uniform float uNeon;
uniform float uSunFill;
uniform float uEmissive;
uniform vec4 uHighlight;
uniform float uWave;
uniform float uGround;
uniform float uSpecular;
uniform float uAlpha;
uniform float uUnlit;
uniform float uDetailOn;
uniform vec3 uCamPark;
uniform mediump sampler2DArray uDetail;

vec3 pBase; float pRough; float pMetal; float pAo; vec3 pNormal; vec3 pEmit; float pAlpha; float pF0;
bool pDone = false;

vec3 parkToWorld(vec3 v) { return vec3(v.x, v.z, -v.y); }
vec3 worldToPark(vec3 v) { return vec3(v.x, -v.z, v.y); }
vec3 parkLinear(vec3 c) { return c * (c * (c * 0.305306 + 0.682171) + 0.012523); }

vec4 parkDetail(vec3 p, vec3 n, float layer, float scale) {
  vec3 w = abs(n);
#ifdef PARK_LOW
  vec2 uv = w.z >= max(w.x, w.y) ? p.xy : (w.x >= w.y ? p.yz : p.xz);
  return texture(uDetail, vec3(uv * scale, layer));
#else
  w = w * w; w = w * w; w /= (w.x + w.y + w.z);
  return texture(uDetail, vec3(p.yz * scale, layer)) * w.x + texture(uDetail, vec3(p.xz * scale, layer)) * w.y + texture(uDetail, vec3(p.xy * scale, layer)) * w.z;
#endif
}

vec3 parkBump(vec3 n, vec3 dpx, vec3 dpy, float h, float k) {
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = (dFdx(h) * r1 + dFdy(h) * r2) * sign(det);
  return normalize(abs(det) * n - g * k);
}

#ifndef FORWARD_PASS
void parkEval() { pDone = true; pAlpha = uAlpha; }
#else
void parkEval() {
  if (pDone) return;
  pDone = true;
  vec3 world = worldToPark(vPositionW);
  vec3 n = normalize(worldToPark(vNormalW));
  if (!gl_FrontFacing) n = -n;
  vec3 base = vParkColor;
  float dist = length(world - uCamPark);
  float rough = vParkMatA.x, metal = vParkMatA.y;
  float ao = vParkAo, alpha = uAlpha;
  pF0 = vParkMatB.w;
  vec3 emit = vec3(0.0);
#ifndef PARK_LOW
  vec3 dpx = dFdx(world), dpy = dFdy(world);
#endif
  if (uUnlit > 0.5) {
    pBase = vec3(0.0); pRough = 1.0; pMetal = 0.0; pAo = 1.0; pNormal = n;
    pEmit = mix(base, parkLinear(uHighlight.rgb), uHighlight.a);
    pAlpha = alpha;
    return;
  }
  if (uWave > 0.0 || vParkMatA.z > 6.5) {
    float depth = vParkAo; ao = 1.0;
    vec2 q = world.xy * 0.085;
    vec4 w1 = texture(uDetail, vec3(q + vec2(uParkTime * 0.013, uParkTime * 0.008), 7.0));
#ifndef PARK_LOW
    vec4 w2 = texture(uDetail, vec3(q * 2.7 + vec2(-uParkTime * 0.021, uParkTime * 0.017), 7.0));
#else
    vec4 w2 = vec4(0.5, 0.5, w1.b, w1.a);
#endif
    vec2 slope = ((w1.rg - 0.5) * 1.2 + (w2.rg - 0.5) * 0.8) * uDetailOn;
    n = normalize(vec3(slope * (uWave > 0.0 ? 1.0 : 0.5), 1.0));
    rough = 0.04; metal = 0.0; pF0 = 0.02;
    if (uWave > 0.0) {
      base = mix(base, base * vec3(0.45, 0.72, 0.9), smoothstep(0.15, 1.0, depth) * 0.6);
      float foam = (1.0 - smoothstep(0.02, 0.2, depth)) * smoothstep(0.3, 0.75, w1.b * 0.7 + w2.b * 0.5) * uDetailOn;
      base = mix(base, vec3(0.8, 0.86, 0.88), foam);
      rough = mix(rough, 0.75, foam);
      alpha = clamp(mix(0.5, 0.95, smoothstep(0.0, 0.8, depth)) + foam, 0.0, 1.0);
    }
  } else if (uDetailOn > 0.0 && vParkMatA.z >= 0.0) {
    float fade = 1.0 - smoothstep(40.0, 160.0, dist);
    if (uGround > 0.0) {
      vec4 t = texture(uDetail, vec3(world.xy * vParkMatA.w, vParkMatA.z));
#ifndef PARK_LOW
      vec4 macro = texture(uDetail, vec3(world.xy * 0.019 + 0.37, 5.0));
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
#ifndef PARK_LOW
      n = parkBump(n, dpx, dpy, t.r, vParkMatB.z * 0.012 / vParkMatA.w * fade);
#endif
    } else {
      vec4 t = parkDetail(world, n, vParkMatA.z, vParkMatA.w);
      base *= mix(1.0, 0.76 + t.g * 0.48, fade);
      rough = clamp(rough * (0.7 + t.b * 0.6), 0.04, 1.0);
      ao *= mix(1.0, t.a, 0.7 * fade);
#ifndef PARK_LOW
      n = parkBump(n, dpx, dpy, t.r, vParkMatB.z * 0.006 / vParkMatA.w * fade);
#endif
    }
  }
  ao *= mix(0.72, 1.0, smoothstep(-0.6, 0.9, n.z));
  if (uSpecular < 1.0) rough = mix(1.0, rough, uSpecular);
  if (vParkMatA.z < -1.5) {
    float flash = 0.35 + 0.65 * smoothstep(-0.3, 0.5, sin(uParkTime * 5.0));
    float on = vParkNeon < 0.002 ? flash : 0.06 + 0.94 * smoothstep(-0.15, 0.4, sin(uParkTime * 6.0 - vParkNeon * 6.2831853));
    emit += base * uNeon * on;
  }
  emit += base * uEmissive;
  emit += base * vParkMatB.y * 0.12 * uSunFill;
  if (uHighlight.a > 0.0) {
    emit = mix(emit, parkLinear(uHighlight.rgb) * 1.6, uHighlight.a);
    base *= 1.0 - uHighlight.a;
  }
  pBase = base;
  pRough = clamp(rough, 0.045, 1.0);
  pMetal = metal;
  pAo = clamp(ao, 0.0, 1.0);
  pNormal = normalize(parkToWorld(n));
  pEmit = emit;
  pAlpha = alpha;
}
#endif
`

const DIFFUSE = `
void getAlbedo() { parkEval(); dAlbedo = pBase; }
`
const NORMAL = `
void getNormal() { parkEval(); dNormalW = pNormal; }
`
const GLOSS = `
void getGlossiness() { parkEval(); dGlossiness = 1.0 - pRough + 0.0000001; }
`
const METALNESS = `
void getMetalness() { parkEval(); dMetalness = pMetal; }
`
const AO = `
void getAO() { parkEval(); dAo = pAo; }
`
const EMISSIVE = `
void getEmission() { parkEval(); dEmission = pEmit; }
`
const OPACITY = `
void getOpacity() { parkEval(); dAlpha = pAlpha; }
`

export type ParkChunkSet = Record<string, string>

/** Chunk overrides for every park material. `low` trades triplanar detail, bump and the second water layer for speed. */
export function parkChunks(low: boolean): ParkChunkSet {
  return {
    litUserDeclarationVS: PARK_VS_DECL,
    litUserMainEndVS: PARK_VS_END,
    transformInstancingVS: PARK_INSTANCING,
    transformVS: PARK_TRANSFORM,
    litUserDeclarationPS: (low ? '#define PARK_LOW\n' : '') + PARK_PS_DECL,
    diffusePS: DIFFUSE,
    normalMapPS: NORMAL,
    glossPS: GLOSS,
    metalnessPS: METALNESS,
    aoPS: AO,
    emissivePS: EMISSIVE,
    opacityPS: OPACITY,
  }
}
