export const GLOBALS_WGSL = /* wgsl */ `
struct Globals {
  resolution: vec2f,
  time: f32,
  dt: f32,
  flags: vec4f,
  shimmerMask: u32,
  particleCount: u32,
  pad0: u32,
  pad1: u32,
}
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var atlasSampler: sampler;

fn toClip(pixel: vec2f) -> vec4f {
  let ndc = pixel / globals.resolution * 2.0 - 1.0;
  return vec4f(ndc.x, -ndc.y, 0.0, 1.0);
}

const CORNERS = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
  vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
);

fn shimmerSweep(local: vec2f, phase: f32) -> f32 {
  let travel = fract(globals.time * 0.38 + phase) * 3.2 - 1.1;
  let d = (local.x * 0.75 + local.y * 0.45) - travel;
  return exp(-d * d * 55.0) + 0.35 * exp(-d * d * 8.0);
}
`

export const SPRITE_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(1) @binding(0) var spriteTexture: texture_2d<f32>;

struct SpriteIn {
  @builtin(vertex_index) vertex: u32,
  @location(0) placement: vec4f,
  @location(1) style: vec4f,
  @location(2) uvRect: vec4f,
  @location(3) color: vec4f,
}

struct SpriteOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) local: vec2f,
  @location(2) color: vec4f,
  @location(3) @interpolate(flat) style: vec4f,
  @location(4) @interpolate(flat) phase: f32,
}

@vertex
fn spriteVertex(input: SpriteIn) -> SpriteOut {
  let corner = CORNERS[input.vertex];
  let offset = (corner - 0.5) * 2.0 * input.placement.zw;
  let c = cos(input.style.x);
  let s = sin(input.style.x);
  let rotated = vec2f(offset.x * c - offset.y * s, offset.x * s + offset.y * c);
  var out: SpriteOut;
  out.position = toClip(input.placement.xy + rotated);
  out.uv = mix(input.uvRect.xy, input.uvRect.zw, corner);
  out.local = corner;
  out.color = input.color;
  out.style = input.style;
  out.phase = fract(input.placement.x * 0.0013 + input.placement.y * 0.0007);
  return out;
}

@fragment
fn spriteFragment(input: SpriteOut) -> @location(0) vec4f {
  let texel = textureSample(spriteTexture, atlasSampler, input.uv);
  var rgb = texel.rgb * input.color.rgb * input.color.a;
  var alpha = texel.a * input.color.a;
  let shimmer = input.style.z * globals.flags.z;
  if (shimmer > 0.0) {
    rgb += vec3f(1.0, 0.94, 0.78) * shimmerSweep(input.local, input.phase) * shimmer * texel.a * input.color.a;
  }
  alpha *= 1.0 - input.style.y;
  return vec4f(rgb, alpha);
}
`

export const REEL_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(1) @binding(0) var atlasTexture: texture_2d<f32>;

struct ReelWindow {
  rect: vec4f,
  params: vec4f,
  tint: vec4f,
  extra: vec4f,
  slotsA: vec4u,
  slotsB: vec4u,
}
@group(1) @binding(1) var<storage, read> windows: array<ReelWindow>;

struct ReelOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) index: u32,
}

@vertex
fn reelVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> ReelOut {
  let w = windows[instance];
  let corner = CORNERS[vertex];
  var out: ReelOut;
  out.position = toClip(w.rect.xy + corner * w.rect.zw);
  out.local = corner;
  out.index = instance;
  return out;
}

fn slotCell(w: ReelWindow, j: i32) -> u32 {
  let k = clamp(j, 0, 7);
  if (k < 4) { return w.slotsA[k]; }
  return w.slotsB[k - 4];
}

fn cellOrigin(cell: u32) -> vec2f {
  return vec2f(f32(cell % 8u), f32(cell / 8u)) / 8.0;
}

fn sampleStrip(w: ReelWindow, p: f32, x: f32, lod: f32) -> vec4f {
  let j = floor(p);
  let f = p - j;
  let cell = slotCell(w, i32(j));
  let uv = cellOrigin(cell) + vec2f(clamp(x, 0.004, 0.996), clamp(f, 0.004, 0.996)) / 8.0;
  return textureSampleLevel(atlasTexture, atlasSampler, uv, lod);
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn sandNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}

@fragment
fn reelFragment(input: ReelOut) -> @location(0) vec4f {
  let w = windows[input.index];
  let rows = w.params.x;
  let yn = input.local.y * 2.0 - 1.0;
  let curve = w.params.y * globals.flags.y;
  var t = yn;
  var shade = 1.0;
  if (curve > 0.001) {
    t = asin(clamp(yn * sin(curve), -1.0, 1.0)) / curve;
    shade = mix(1.0, cos(t * curve), 2.6);
    shade = clamp(shade, 0.25, 1.0);
  }
  let s = (t * 0.5 + 0.5) * rows;
  let p = w.params.z + s + 1.0;
  let cellScreen = max(1.0, w.rect.z);
  let lod = clamp(log2(256.0 / cellScreen), 0.0, 3.0);
  let blur = w.params.w * globals.flags.x;
  var symbol = vec4f(0.0);
  var weight = 0.0;
  for (var k = 0; k < 9; k++) {
    let step = f32(k) / 8.0;
    let tap = sampleStrip(w, p + blur * step, input.local.x, lod);
    let wk = 1.0 - step * 0.6;
    symbol += tap * wk;
    weight += wk;
  }
  symbol /= weight;

  let pixel = input.local * w.rect.zw;
  let grain = sandNoise(pixel * 0.06) * 0.6 + sandNoise(pixel * 0.21) * 0.4;
  var bg: vec3f;
  if (w.extra.z > 0.5) {
    let edge = min(min(input.local.x, 1.0 - input.local.x), min(input.local.y, 1.0 - input.local.y));
    bg = mix(vec3f(0.05, 0.03, 0.02), vec3f(0.17, 0.10, 0.05), smoothstep(0.0, 0.18, edge)) * (0.85 + 0.3 * grain);
  } else {
    let lit = 1.0 - abs(input.local.x - 0.5) * 0.9;
    bg = mix(vec3f(0.10, 0.06, 0.03), vec3f(0.30, 0.19, 0.09), lit) * (0.8 + 0.35 * grain);
    let rowLine = fract(p);
    bg *= 1.0 - 0.18 * exp(-pow((rowLine - 0.0) * 30.0, 2.0)) - 0.18 * exp(-pow((rowLine - 1.0) * 30.0, 2.0));
  }

  var rgb = bg * (1.0 - symbol.a) + symbol.rgb;

  let center = p - blur * 0.25;
  let cell = slotCell(w, i32(floor(center)));
  let maskBit = (globals.shimmerMask >> cell) & 1u;
  if (maskBit == 1u && globals.flags.z > 0.5) {
    let local = vec2f(input.local.x, fract(center));
    let phase = fract(w.rect.x * 0.0021 + floor(center) * 0.37);
    rgb += vec3f(1.0, 0.92, 0.7) * shimmerSweep(local, phase) * symbol.a * 0.55 * (1.0 - clamp(blur, 0.0, 1.0));
  }

  let rowIndex = clamp(floor(s), 0.0, rows - 1.0);
  let dimMask = u32(w.extra.x + 0.5);
  if (((dimMask >> u32(rowIndex)) & 1u) == 1u) {
    rgb *= 0.32;
  }
  rgb *= w.tint.rgb * shade;
  let inner = smoothstep(0.0, 0.035, input.local.y) * smoothstep(0.0, 0.035, 1.0 - input.local.y);
  rgb *= mix(0.55, 1.0, inner);
  return vec4f(rgb, 1.0);
}
`

export const PARTICLE_WGSL = /* wgsl */ `
${GLOBALS_WGSL}

struct Particle {
  pos: vec2f,
  vel: vec2f,
  life: f32,
  maxLife: f32,
  size: f32,
  cell: f32,
  color: vec4f,
  rot: f32,
  spin: f32,
  gravity: f32,
  drag: f32,
}

@group(1) @binding(0) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= globals.particleCount) { return; }
  var p = particles[i];
  if (p.life >= p.maxLife) { return; }
  let dt = globals.dt;
  p.vel.y += p.gravity * dt;
  p.vel *= exp(-p.drag * dt);
  if (p.cell >= 100.0) {
    p.vel.x += sin(globals.time * 3.0 + p.pos.y * 0.02 + f32(i)) * 20.0 * dt;
  }
  p.pos += p.vel * dt;
  p.rot += p.spin * dt;
  p.life += dt;
  particles[i] = p;
}
`

export const PARTICLE_RENDER_WGSL = /* wgsl */ `
${GLOBALS_WGSL}

struct Particle {
  pos: vec2f,
  vel: vec2f,
  life: f32,
  maxLife: f32,
  size: f32,
  cell: f32,
  color: vec4f,
  rot: f32,
  spin: f32,
  gravity: f32,
  drag: f32,
}

@group(1) @binding(0) var<storage, read> particles: array<Particle>;
@group(1) @binding(1) var atlasTexture: texture_2d<f32>;

struct ParticleOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) additive: f32,
}

@vertex
fn particleVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> ParticleOut {
  let p = particles[instance];
  var out: ParticleOut;
  if (p.life >= p.maxLife || p.maxLife <= 0.0) {
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);
    out.uv = vec2f(0.0);
    out.color = vec4f(0.0);
    out.additive = 0.0;
    return out;
  }
  let t = clamp(p.life / p.maxLife, 0.0, 1.0);
  let corner = CORNERS[vertex];
  var cellId = p.cell;
  var additive = 0.0;
  if (cellId >= 100.0) {
    cellId -= 100.0;
    additive = 1.0;
  }
  let grow = mix(0.6, 1.0, smoothstep(0.0, 0.15, t)) * mix(1.0, 0.35, t * t);
  let half = p.size * grow;
  let offset = (corner - 0.5) * 2.0 * half;
  let c = cos(p.rot);
  let s = sin(p.rot);
  let rotated = vec2f(offset.x * c - offset.y * s, offset.x * s + offset.y * c);
  out.position = toClip(p.pos + rotated);
  let cell = u32(cellId);
  out.uv = (vec2f(f32(cell % 8u), f32(cell / 8u)) + corner) / 8.0;
  let fade = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.55, 1.0, t));
  out.color = vec4f(p.color.rgb, p.color.a * fade);
  out.additive = additive;
  return out;
}

@fragment
fn particleFragment(input: ParticleOut) -> @location(0) vec4f {
  let texel = textureSample(atlasTexture, atlasSampler, input.uv);
  let rgb = texel.rgb * input.color.rgb * input.color.a;
  let alpha = texel.a * input.color.a * (1.0 - input.additive);
  return vec4f(rgb, alpha);
}
`
