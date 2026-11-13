/**
 * Finds the window panes of a scanned vehicle. Generated models are one mesh
 * with the glass painted into the colour texture, so a pane is found by what
 * is painted under each triangle and where the triangle sits on the body:
 *
 *  - the texture under it is glass-coloured (dark and unsaturated, or a
 *    grey-blue sky reflection),
 *  - its centre is in the greenhouse band of the body's height,
 *  - it faces sideways rather than up or down,
 *  - on the sides of the body it faces outward.
 *
 * The result is then cleaned up across shared edges and small patches are
 * dropped. Renderer-free: positions are in the chassis frame (x forward, y up,
 * z right, metres) and colours are 0..1 sRGB.
 */

export interface WindowOptions {
  /** A texel is dark glass below this luminance and this saturation. */
  darkLuminance: number;
  darkSaturation: number;
  /** A texel is a sky reflection below this luminance and saturation when blue leads red and keeps up with green. */
  skyLuminance: number;
  skySaturation: number;
  skyBlueOverRed: number;
  skyBlueUnderGreen: number;
  /** The greenhouse band, as fractions of the body's height. */
  bandLow: number;
  bandHigh: number;
  /** Panes face sideways: the largest |normal.y| a window triangle may have. */
  maxNormalY: number;
  /** A triangle whose |normal.z| is above this is on a side and must face away from the middle. */
  sideNormalZ: number;
  /** How far the three extra samples are pulled from the corners toward the centre (0..1). */
  cornerPull: number;
  /** How many of the four samples must be glass. */
  minSamples: number;
  /** Clean-up passes over shared edges. */
  passes: number;
  /** A body triangle is filled in when at least this share of its neighbours (and at least two) are windows. */
  fillShare: number;
  /** Connected patches smaller than this (m²) are dropped. */
  minPatchArea: number;
  /** Fewer window triangles than this counts as no windows found. */
  minTriangles: number;
}

export const WINDOW_DEFAULTS: WindowOptions = {
  darkLuminance: 0.2,
  darkSaturation: 0.38,
  skyLuminance: 0.5,
  skySaturation: 0.42,
  skyBlueOverRed: 0.02,
  skyBlueUnderGreen: 0.02,
  bandLow: 0.55,
  bandHigh: 0.95,
  maxNormalY: 0.82,
  sideNormalZ: 0.55,
  cornerPull: 0.3,
  minSamples: 3,
  passes: 2,
  fillShare: 0.66,
  minPatchArea: 0.06,
  minTriangles: 24,
};

/** One texel per byte, 1 where the colour texture is glass-coloured. Row 0 is v = 0 unless `flipV`. */
export interface GlassMask { width: number; height: number; data: Uint8Array; flipV?: boolean }

export interface WindowMesh {
  positions: ArrayLike<number>;
  /** Vertex normals; the triangle's own normal is used when missing. */
  normals?: ArrayLike<number> | null;
  uvs: ArrayLike<number> | null;
  /** Triangle list; every three vertices in order when missing. */
  indices?: ArrayLike<number> | null;
  mask: GlassMask | null;
}

export interface BodyBounds { minY: number; maxY: number; midZ: number }

export function isGlassColor(r: number, g: number, b: number, options: WindowOptions = WINDOW_DEFAULTS): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const saturation = max > 0 ? (max - min) / max : 0;
  if (luminance < options.darkLuminance && saturation < options.darkSaturation) return true;
  return luminance < options.skyLuminance && saturation < options.skySaturation && b >= r + options.skyBlueOverRed && b >= g - options.skyBlueUnderGreen;
}

/** The glass mask of an RGBA image (8 bits per channel). Transparent texels are never glass. */
export function glassMask(rgba: ArrayLike<number>, width: number, height: number, options: Partial<WindowOptions> = {}, flipV = false): GlassMask {
  const o = { ...WINDOW_DEFAULTS, ...options };
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    if (rgba[p + 3] < 8) continue;
    if (isGlassColor(rgba[p] / 255, rgba[p + 1] / 255, rgba[p + 2] / 255, o)) data[i] = 1;
  }
  return { width, height, data, flipV };
}

export const triangleCount = (mesh: WindowMesh) => Math.floor((mesh.indices ? mesh.indices.length : mesh.positions.length / 3) / 3);

/** The height range and middle of the whole body, shared by every mesh of one vehicle. */
export function bodyBounds(meshes: readonly WindowMesh[]): BodyBounds {
  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      if (p[i + 1] < minY) minY = p[i + 1];
      if (p[i + 1] > maxY) maxY = p[i + 1];
      if (p[i + 2] < minZ) minZ = p[i + 2];
      if (p[i + 2] > maxZ) maxZ = p[i + 2];
    }
  }
  if (minY > maxY) return { minY: 0, maxY: 1, midZ: 0 };
  return { minY, maxY, midZ: (minZ + maxZ) / 2 };
}

function sample(mask: GlassMask, u: number, v: number) {
  const fu = u - Math.floor(u), fv = v - Math.floor(v);
  const x = Math.min(mask.width - 1, Math.floor(fu * mask.width));
  const row = Math.min(mask.height - 1, Math.floor(fv * mask.height));
  return mask.data[(mask.flipV ? mask.height - 1 - row : row) * mask.width + x];
}

/** Triangles joined across shared edges, with vertices at the same position welded (scans split them along UV seams). */
function neighbours(mesh: WindowMesh, count: number): Int32Array {
  const p = mesh.positions, index = mesh.indices ?? null;
  const vertices = Math.floor(p.length / 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const span = Math.max(1e-6, maxX - minX, maxY - minY, maxZ - minZ);
  const q = 100000 / span, side = 131072;
  const welded = new Int32Array(vertices);
  const ids = new Map<number, number>();
  for (let i = 0; i < vertices; i++) {
    const key = Math.round((p[i * 3] - minX) * q) + Math.round((p[i * 3 + 1] - minY) * q) * side + Math.round((p[i * 3 + 2] - minZ) * q) * side * side;
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    welded[i] = id;
  }
  const total = ids.size;
  const near = new Int32Array(count * 3).fill(-1);
  const open = new Map<number, number>();
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const a = welded[index ? index[t * 3 + e] : t * 3 + e], b = welded[index ? index[t * 3 + ((e + 1) % 3)] : t * 3 + ((e + 1) % 3)];
      if (a === b) continue;
      const key = a < b ? a * total + b : b * total + a;
      const other = open.get(key);
      if (other === undefined) { open.set(key, t * 3 + e); continue; }
      near[t * 3 + e] = Math.floor(other / 3);
      near[other] = t;
      open.delete(key);
    }
  }
  return near;
}

function findWindows(mesh: WindowMesh, o: WindowOptions, bounds: BodyBounds): { flags: Uint8Array; area: Float32Array } {
  const count = triangleCount(mesh);
  const flags = new Uint8Array(count);
  const area = new Float32Array(count);
  const { positions: p, uvs, mask } = mesh;
  const index = mesh.indices ?? null, normals = mesh.normals ?? null;
  const height = Math.max(1e-6, bounds.maxY - bounds.minY);
  const pull = Math.min(0.95, Math.max(0.05, o.cornerPull));
  for (let t = 0; t < count; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
    const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const twice = Math.hypot(nx, ny, nz);
    area[t] = twice / 2;
    if (!mask || !uvs || twice < 1e-12) continue;
    const share = ((ay + by + cy) / 3 - bounds.minY) / height;
    if (share < o.bandLow || share > o.bandHigh) continue;
    if (normals) {
      nx = normals[a * 3] + normals[b * 3] + normals[c * 3];
      ny = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
      nz = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
    }
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) continue;
    ny /= length; nz /= length;
    if (Math.abs(ny) > o.maxNormalY) continue;
    if (Math.abs(nz) > o.sideNormalZ && nz * ((az + bz + cz) / 3 - bounds.midZ) <= 0) continue;
    const au = uvs[a * 2], av = uvs[a * 2 + 1], bu = uvs[b * 2], bv = uvs[b * 2 + 1], cu = uvs[c * 2], cv = uvs[c * 2 + 1];
    const mu = (au + bu + cu) / 3, mv = (av + bv + cv) / 3;
    const hits = sample(mask, mu, mv)
      + sample(mask, au + (mu - au) * pull, av + (mv - av) * pull)
      + sample(mask, bu + (mu - bu) * pull, bv + (mv - bv) * pull)
      + sample(mask, cu + (mu - cu) * pull, cv + (mv - cv) * pull);
    if (hits >= o.minSamples) flags[t] = 1;
  }
  return { flags, area };
}

function cleanUp(flags: Uint8Array, area: Float32Array, near: Int32Array, o: WindowOptions) {
  const count = flags.length;
  for (let pass = 0; pass < o.passes; pass++) {
    let before = Uint8Array.from(flags);
    for (let t = 0; t < count; t++) {
      if (!before[t]) continue;
      let joined = false;
      for (let e = 0; e < 3; e++) { const n = near[t * 3 + e]; if (n >= 0 && before[n]) { joined = true; break; } }
      if (!joined) flags[t] = 0;
    }
    before = Uint8Array.from(flags);
    for (let t = 0; t < count; t++) {
      if (before[t]) continue;
      let around = 0, glass = 0;
      for (let e = 0; e < 3; e++) { const n = near[t * 3 + e]; if (n < 0) continue; around++; if (before[n]) glass++; }
      if (glass >= 2 && glass / around >= o.fillShare) flags[t] = 1;
    }
  }
  const seen = new Uint8Array(count);
  const stack: number[] = [], patch: number[] = [];
  for (let start = 0; start < count; start++) {
    if (!flags[start] || seen[start]) continue;
    let total = 0;
    patch.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const t = stack.pop()!;
      patch.push(t);
      total += area[t];
      for (let e = 0; e < 3; e++) { const n = near[t * 3 + e]; if (n >= 0 && flags[n] && !seen[n]) { seen[n] = 1; stack.push(n); } }
    }
    if (total < o.minPatchArea) for (const t of patch) flags[t] = 0;
  }
}

function detect(mesh: WindowMesh, o: WindowOptions, bounds: BodyBounds) {
  const { flags, area } = findWindows(mesh, o, bounds);
  let any = false;
  for (let t = 0; t < flags.length; t++) if (flags[t]) { any = true; break; }
  if (any) cleanUp(flags, area, neighbours(mesh, flags.length), o);
  let triangles = 0, total = 0;
  for (let t = 0; t < flags.length; t++) if (flags[t]) { triangles++; total += area[t]; }
  return { flags, triangles, area: total };
}

/** One flag per triangle of a single-mesh body: 1 for a window. All zero when fewer than `minTriangles` are found. */
export function detectWindows(mesh: WindowMesh, options: Partial<WindowOptions> = {}, bounds: BodyBounds = bodyBounds([mesh])): Uint8Array {
  const o = { ...WINDOW_DEFAULTS, ...options };
  const found = detect(mesh, o, bounds);
  return found.triangles < o.minTriangles ? new Uint8Array(found.flags.length) : found.flags;
}

export interface VehicleWindows { flags: Uint8Array[]; triangles: number; area: number }

/** The same for a body made of several meshes, which share one height band and one middle. */
export function detectVehicleWindows(meshes: readonly WindowMesh[], options: Partial<WindowOptions> = {}): VehicleWindows {
  const o = { ...WINDOW_DEFAULTS, ...options };
  const bounds = bodyBounds(meshes);
  const found = meshes.map(mesh => detect(mesh, o, bounds));
  const triangles = found.reduce((n, f) => n + f.triangles, 0);
  if (triangles < o.minTriangles) return { flags: found.map(f => new Uint8Array(f.flags.length)), triangles: 0, area: 0 };
  return { flags: found.map(f => f.flags), triangles, area: found.reduce((n, f) => n + f.area, 0) };
}
