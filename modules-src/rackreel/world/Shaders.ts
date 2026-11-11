/** The sky dome and lake surface shaders, written twice: GLSL for the WebGL2 engine and WGSL for the WebGPU engine. */
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { Effect } from '@babylonjs/core/Materials/effect'
import { FLOOD } from '../game/BowBoat'

const skyFunctions = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 moonDir;
uniform float night;
uniform float glow;
vec3 skyColor(vec3 d) {
  float y = clamp(d.y, -0.2, 1.0);
  vec3 zenith = mix(vec3(0.16, 0.3, 0.55), vec3(0.012, 0.02, 0.05), night);
  vec3 horizon = mix(vec3(0.66, 0.72, 0.74), vec3(0.045, 0.065, 0.11), night);
  vec3 col = mix(horizon, zenith, pow(max(y, 0.0), 0.55));
  float toward = max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(sunDir.x, 0.0, sunDir.z) + 1e-4)), 0.0);
  float sunUp = smoothstep(-0.16, 0.04, sunDir.y);
  col = mix(col, vec3(1.0, 0.52, 0.26), pow(toward, 4.0) * (1.0 - smoothstep(0.0, 0.5, y)) * (0.3 + glow * 0.6) * sunUp);
  col += vec3(0.95, 0.38, 0.16) * glow * pow(1.0 - max(y, 0.0), 7.0) * 0.3 * (0.4 + 0.6 * toward);
  float sun = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.82, 0.6) * (pow(sun, 1200.0) * 40.0 + pow(sun, 60.0) * 0.6 + pow(sun, 8.0) * 0.12) * smoothstep(-0.03, 0.02, sunDir.y);
  float moon = max(dot(d, moonDir), 0.0);
  col += vec3(0.55, 0.64, 0.85) * (pow(moon, 60.0) * 0.22 + pow(moon, 6.0) * 0.04) * night * smoothstep(-0.05, 0.05, moonDir.y);
  return col;
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm2(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += vnoise(p) * a; p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`

Effect.ShadersStore.rrSkyVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = worldViewProjection * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = p.w * 0.99999;
}`

Effect.ShadersStore.rrSkyFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float time;
${skyFunctions}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d);
  if (d.y > 0.0) {
    vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 95.0;
    vec2 cell = floor(sp);
    float h = hash12(cell);
    vec2 off = vec2(hash12(cell + 7.31), hash12(cell + 3.17)) - 0.5;
    float star = step(0.982, h) * smoothstep(0.2, 0.0, length(fract(sp) - 0.5 - off * 0.55)) * (0.65 + 0.35 * sin(time * (1.5 + h * 3.0) + h * 60.0));
    col += vec3(0.85, 0.9, 1.0) * star * night * smoothstep(0.03, 0.22, d.y) * (1.0 + step(0.997, h) * 1.5);
    float md = dot(d, moonDir);
    float disc = smoothstep(0.99989, 0.99993, md) * smoothstep(-0.02, 0.02, moonDir.y);
    vec2 mare = d.xz * 900.0;
    vec3 moonCol = vec3(0.96, 0.95, 0.88) * (1.55 - 0.35 * smoothstep(0.4, 0.7, fbm2(mare)));
    col = mix(col, moonCol, disc);
    vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(time * 0.004, time * 0.0015);
    float c = smoothstep(0.5, 0.85, fbm2(uv));
    float shade = fbm2(uv * 1.7 + 4.0);
    vec3 cloud = mix(vec3(0.95, 0.88, 0.8), vec3(0.52, 0.55, 0.6), shade);
    float sunLit = pow(max(dot(d, sunDir), 0.0), 6.0);
    cloud += vec3(1.0, 0.6, 0.3) * sunLit * (0.6 + glow * 0.8);
    cloud = mix(cloud, vec3(1.0, 0.55, 0.35) * (1.1 - shade * 0.5), glow * 0.55);
    vec3 nightCloud = vec3(0.05, 0.06, 0.085) + vec3(0.12, 0.13, 0.16) * pow(max(dot(d, moonDir), 0.0), 4.0) * (1.0 - shade);
    cloud = mix(cloud, nightCloud, night);
    col = mix(col, cloud, c * smoothstep(0.0, 0.18, d.y) * 0.85);
  }
  gl_FragColor = vec4(col, 1.0);
}`

Effect.ShadersStore.rrWaterVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vWorld;
void main() {
  vec4 w = world * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = viewProjection * w;
}`

Effect.ShadersStore.rrWaterFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform vec3 cameraPos;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float time;
uniform float worldSize;
uniform sampler2D depthMap;
uniform vec3 lampPos;
uniform vec3 lampDir;
uniform vec3 lampColor;
${skyFunctions}
vec2 waveGrad(vec2 p) {
  vec2 g = vec2(0.0);
  vec4 dirs[4];
  dirs[0] = vec4(0.8, 0.6, 0.55, 0.05);
  dirs[1] = vec4(-0.4, 0.9, 1.1, 0.03);
  dirs[2] = vec4(0.95, -0.3, 2.3, 0.012);
  dirs[3] = vec4(-0.7, -0.7, 3.7, 0.008);
  for (int i = 0; i < 4; i++) {
    vec2 dir = normalize(dirs[i].xy);
    float k = dirs[i].z;
    float ph = dot(dir, p) * k + time * sqrt(9.8 * k);
    g += dir * k * dirs[i].w * cos(ph);
  }
  vec2 q = p * 0.9 + vec2(time * 0.4, time * 0.25);
  g += (vec2(vnoise(q), vnoise(q + 9.1)) - 0.5) * 0.06;
  return g;
}
void main() {
  vec2 uv = (vWorld.xz + worldSize * 0.5) / worldSize;
  float depth = texture2D(depthMap, uv).r * 24.0;
  if (depth < 0.001) discard;
  vec3 V = normalize(cameraPos - vWorld);
  float dist = length(cameraPos - vWorld);
  vec2 g = waveGrad(vWorld.xz) * mix(1.0, 0.35, smoothstep(40.0, 260.0, dist));
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R) * 0.92;
  vec3 shallow = vec3(0.16, 0.24, 0.17);
  vec3 deep = vec3(0.012, 0.045, 0.055);
  vec3 body = mix(shallow, deep, smoothstep(0.2, 7.0, depth)) * mix(1.0, 0.16, night);
  float spec = (pow(max(dot(R, sunDir), 0.0), 520.0) * 9.0 + pow(max(dot(R, sunDir), 0.0), 40.0) * 0.18) * smoothstep(-0.02, 0.06, sunDir.y);
  float mspec = (pow(max(dot(R, moonDir), 0.0), 380.0) * 4.0 + pow(max(dot(R, moonDir), 0.0), 28.0) * 0.07) * night * smoothstep(-0.02, 0.06, moonDir.y);
  vec3 col = mix(body, refl, fres) + vec3(1.0, 0.86, 0.66) * spec + vec3(0.72, 0.8, 0.95) * mspec;
  float foam = (1.0 - smoothstep(0.0, 0.32, depth)) * smoothstep(0.35, 0.75, vnoise(vWorld.xz * 2.2 + time * 0.3)) * (1.0 - night * 0.8);
  col = mix(col, vec3(0.86, 0.88, 0.84), foam * 0.6);
  float alpha = clamp(mix(0.25, 0.97, smoothstep(0.0, 2.2, depth)) + fres * 0.5, 0.0, 1.0);
  alpha = mix(alpha, max(alpha, 0.94), night);
  float lampOn = step(0.001, lampColor.r + lampColor.g + lampColor.b) * step(-0.5, lampDir.y);
  float lampDist = length(vWorld.xz - lampPos.xz);
  float lit = (1.0 - smoothstep(${FLOOD.bright.toFixed(2)}, ${FLOOD.reach.toFixed(2)}, lampDist)) * lampOn;
  vec3 murk = vec3(0.3, 0.29, 0.17) * lampColor * (0.75 + 0.25 * vnoise(vWorld.xz * 0.7 + time * 0.05));
  col = mix(col, murk + refl * fres * 0.2, lit * 0.62);
  alpha = mix(alpha, 0.22 + fres * 0.18, lit);
  float f = 1.0 - exp(-pow(fogDensity * dist, 2.0));
  col = mix(col, fogColor, f);
  gl_FragColor = vec4(col, alpha);
}`

const skyFunctionsWgsl = /* wgsl */ `
uniform sunDir: vec3f;
uniform moonDir: vec3f;
uniform night: f32;
uniform glow: f32;
fn skyColor(d: vec3f) -> vec3f {
  let y = clamp(d.y, -0.2, 1.0);
  let zenith = mix(vec3f(0.16, 0.3, 0.55), vec3f(0.012, 0.02, 0.05), uniforms.night);
  let horizon = mix(vec3f(0.66, 0.72, 0.74), vec3f(0.045, 0.065, 0.11), uniforms.night);
  var col = mix(horizon, zenith, pow(max(y, 0.0), 0.55));
  let toward = max(dot(normalize(vec3f(d.x, 0.0, d.z) + 1e-4), normalize(vec3f(uniforms.sunDir.x, 0.0, uniforms.sunDir.z) + 1e-4)), 0.0);
  let sunUp = smoothstep(-0.16, 0.04, uniforms.sunDir.y);
  col = mix(col, vec3f(1.0, 0.52, 0.26), pow(toward, 4.0) * (1.0 - smoothstep(0.0, 0.5, y)) * (0.3 + uniforms.glow * 0.6) * sunUp);
  col += vec3f(0.95, 0.38, 0.16) * uniforms.glow * pow(1.0 - max(y, 0.0), 7.0) * 0.3 * (0.4 + 0.6 * toward);
  let sun = max(dot(d, uniforms.sunDir), 0.0);
  col += vec3f(1.0, 0.82, 0.6) * (pow(sun, 1200.0) * 40.0 + pow(sun, 60.0) * 0.6 + pow(sun, 8.0) * 0.12) * smoothstep(-0.03, 0.02, uniforms.sunDir.y);
  let moon = max(dot(d, uniforms.moonDir), 0.0);
  col += vec3f(0.55, 0.64, 0.85) * (pow(moon, 60.0) * 0.22 + pow(moon, 6.0) * 0.04) * uniforms.night * smoothstep(-0.05, 0.05, uniforms.moonDir.y);
  return col;
}
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x), mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm2(q: vec2f) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var p = q;
  for (var i = 0; i < 5; i++) {
    s += vnoise(p) * a;
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
`

ShaderStore.ShadersStoreWGSL.rrSkyVertexShader = /* wgsl */ `
attribute position: vec3f;
uniform worldViewProjection: mat4x4f;
varying vDir: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vDir = vertexInputs.position;
  let p = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = vec4f(p.x, p.y, p.w * 0.99999, p.w);
}`

ShaderStore.ShadersStoreWGSL.rrSkyFragmentShader = /* wgsl */ `
varying vDir: vec3f;
uniform time: f32;
${skyFunctionsWgsl}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = normalize(fragmentInputs.vDir);
  var col = skyColor(d);
  if (d.y > 0.0) {
    let sp = vec2f(atan2(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 95.0;
    let cell = floor(sp);
    let h = hash12(cell);
    let off = vec2f(hash12(cell + 7.31), hash12(cell + 3.17)) - 0.5;
    let star = step(0.982, h) * (1.0 - smoothstep(0.0, 0.2, length(fract(sp) - 0.5 - off * 0.55))) * (0.65 + 0.35 * sin(uniforms.time * (1.5 + h * 3.0) + h * 60.0));
    col += vec3f(0.85, 0.9, 1.0) * star * uniforms.night * smoothstep(0.03, 0.22, d.y) * (1.0 + step(0.997, h) * 1.5);
    let md = dot(d, uniforms.moonDir);
    let disc = smoothstep(0.99989, 0.99993, md) * smoothstep(-0.02, 0.02, uniforms.moonDir.y);
    let mare = d.xz * 900.0;
    let moonCol = vec3f(0.96, 0.95, 0.88) * (1.55 - 0.35 * smoothstep(0.4, 0.7, fbm2(mare)));
    col = mix(col, moonCol, disc);
    let uv = d.xz / (d.y + 0.12) * 1.6 + vec2f(uniforms.time * 0.004, uniforms.time * 0.0015);
    let c = smoothstep(0.5, 0.85, fbm2(uv));
    let shade = fbm2(uv * 1.7 + 4.0);
    var cloud = mix(vec3f(0.95, 0.88, 0.8), vec3f(0.52, 0.55, 0.6), shade);
    let sunLit = pow(max(dot(d, uniforms.sunDir), 0.0), 6.0);
    cloud += vec3f(1.0, 0.6, 0.3) * sunLit * (0.6 + uniforms.glow * 0.8);
    cloud = mix(cloud, vec3f(1.0, 0.55, 0.35) * (1.1 - shade * 0.5), uniforms.glow * 0.55);
    let nightCloud = vec3f(0.05, 0.06, 0.085) + vec3f(0.12, 0.13, 0.16) * pow(max(dot(d, uniforms.moonDir), 0.0), 4.0) * (1.0 - shade);
    cloud = mix(cloud, nightCloud, uniforms.night);
    col = mix(col, cloud, c * smoothstep(0.0, 0.18, d.y) * 0.85);
  }
  fragmentOutputs.color = vec4f(col, 1.0);
}`

ShaderStore.ShadersStoreWGSL.rrWaterVertexShader = /* wgsl */ `
attribute position: vec3f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
varying vWorld: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let w = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vWorld = w.xyz;
  vertexOutputs.position = uniforms.viewProjection * w;
}`

ShaderStore.ShadersStoreWGSL.rrWaterFragmentShader = /* wgsl */ `
varying vWorld: vec3f;
uniform cameraPos: vec3f;
uniform fogColor: vec3f;
uniform fogDensity: f32;
uniform time: f32;
uniform worldSize: f32;
var depthMapSampler: sampler;
var depthMap: texture_2d<f32>;
uniform lampPos: vec3f;
uniform lampDir: vec3f;
uniform lampColor: vec3f;
${skyFunctionsWgsl}
fn waveGrad(p: vec2f) -> vec2f {
  var g = vec2f(0.0);
  var dirs = array<vec4f, 4>(vec4f(0.8, 0.6, 0.55, 0.05), vec4f(-0.4, 0.9, 1.1, 0.03), vec4f(0.95, -0.3, 2.3, 0.012), vec4f(-0.7, -0.7, 3.7, 0.008));
  for (var i = 0; i < 4; i++) {
    let dir = normalize(dirs[i].xy);
    let k = dirs[i].z;
    let ph = dot(dir, p) * k + uniforms.time * sqrt(9.8 * k);
    g += dir * k * dirs[i].w * cos(ph);
  }
  let q = p * 0.9 + vec2f(uniforms.time * 0.4, uniforms.time * 0.25);
  g += (vec2f(vnoise(q), vnoise(q + 9.1)) - 0.5) * 0.06;
  return g;
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let at = fragmentInputs.vWorld;
  let uv = (at.xz + uniforms.worldSize * 0.5) / uniforms.worldSize;
  let depth = textureSample(depthMap, depthMapSampler, uv).r * 24.0;
  if (depth < 0.001) {
    discard;
  }
  let V = normalize(uniforms.cameraPos - at);
  let dist = length(uniforms.cameraPos - at);
  let g = waveGrad(at.xz) * mix(1.0, 0.35, smoothstep(40.0, 260.0, dist));
  let N = normalize(vec3f(-g.x, 1.0, -g.y));
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  var R = reflect(-V, N);
  R.y = abs(R.y);
  let refl = skyColor(R) * 0.92;
  let shallow = vec3f(0.16, 0.24, 0.17);
  let deep = vec3f(0.012, 0.045, 0.055);
  let body = mix(shallow, deep, smoothstep(0.2, 7.0, depth)) * mix(1.0, 0.16, uniforms.night);
  let sunGlint = max(dot(R, uniforms.sunDir), 0.0);
  let moonGlint = max(dot(R, uniforms.moonDir), 0.0);
  let spec = (pow(sunGlint, 520.0) * 9.0 + pow(sunGlint, 40.0) * 0.18) * smoothstep(-0.02, 0.06, uniforms.sunDir.y);
  let mspec = (pow(moonGlint, 380.0) * 4.0 + pow(moonGlint, 28.0) * 0.07) * uniforms.night * smoothstep(-0.02, 0.06, uniforms.moonDir.y);
  var col = mix(body, refl, fres) + vec3f(1.0, 0.86, 0.66) * spec + vec3f(0.72, 0.8, 0.95) * mspec;
  let foam = (1.0 - smoothstep(0.0, 0.32, depth)) * smoothstep(0.35, 0.75, vnoise(at.xz * 2.2 + uniforms.time * 0.3)) * (1.0 - uniforms.night * 0.8);
  col = mix(col, vec3f(0.86, 0.88, 0.84), foam * 0.6);
  var alpha = clamp(mix(0.25, 0.97, smoothstep(0.0, 2.2, depth)) + fres * 0.5, 0.0, 1.0);
  alpha = mix(alpha, max(alpha, 0.94), uniforms.night);
  let lampOn = step(0.001, uniforms.lampColor.r + uniforms.lampColor.g + uniforms.lampColor.b) * step(-0.5, uniforms.lampDir.y);
  let lampDist = length(at.xz - uniforms.lampPos.xz);
  let lit = (1.0 - smoothstep(${FLOOD.bright.toFixed(2)}, ${FLOOD.reach.toFixed(2)}, lampDist)) * lampOn;
  let murk = vec3f(0.3, 0.29, 0.17) * uniforms.lampColor * (0.75 + 0.25 * vnoise(at.xz * 0.7 + uniforms.time * 0.05));
  col = mix(col, murk + refl * fres * 0.2, lit * 0.62);
  alpha = mix(alpha, 0.22 + fres * 0.18, lit);
  let f = 1.0 - exp(-pow(uniforms.fogDensity * dist, 2.0));
  col = mix(col, uniforms.fogColor, f);
  fragmentOutputs.color = vec4f(col, alpha);
}`
