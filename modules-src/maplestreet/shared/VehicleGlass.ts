/**
 * Traced windows: which triangles of a scanned vehicle body are glass, as
 * chosen by the administrator in Fox Lake's developer panel (Trace windows).
 * Stored in the vehicle's spec (`glass`) and used instead of the automatic
 * detection (WindowDetect.ts) by every page that draws the vehicle.
 *
 * Triangles are numbered as they come in the model file: `mesh` is the body
 * mesh's place among the model's meshes, and triangle t is indices 3t..3t+2
 * of that mesh. `tris` and `verts` fingerprint the mesh, so a part saved for
 * an older model is ignored rather than painting glass on the wrong faces.
 * `runs` lists the glass triangles as alternating gaps and lengths in base 36
 * joined by dots ("5.5.6.2" is triangles 5-9 and 16-17), which keeps a pane
 * of a few thousand triangles to a few hundred bytes.
 *
 * Renderer-free and deterministic.
 */

export interface GlassPart { mesh: number; tris: number; verts: number; runs: string }
export interface VehicleGlass { v: 1; parts: GlassPart[] }

export const GLASS_LIMITS = {
  parts: 32,
  meshIndex: 255,
  tris: 2_000_000,
  verts: 4_000_000,
  /** Characters of `runs` per part, and in all parts together. */
  runsChars: 400_000,
  totalChars: 600_000,
} as const;

export const GLASS_RUNS_PATTERN = /^(?:[0-9a-z]+(?:\.[0-9a-z]+)*)?$/;

/** The runs of a flag list (1 = glass). */
export function encodeGlassRuns(flags: ArrayLike<number>): string {
  const out: string[] = [];
  let end = 0;
  for (let t = 0; t < flags.length; t++) {
    if (!flags[t]) continue;
    let k = t;
    while (k + 1 < flags.length && flags[k + 1]) k++;
    out.push((t - end).toString(36), (k - t + 1).toString(36));
    end = k + 1;
    t = k;
  }
  return out.join('.');
}

/** The flags of `tris` triangles from runs, or null when the runs are malformed or run past the end. */
export function decodeGlassRuns(runs: string, tris: number): Uint8Array | null {
  if (typeof runs !== 'string' || !GLASS_RUNS_PATTERN.test(runs) || !Number.isInteger(tris) || tris < 0) return null;
  const flags = new Uint8Array(tris);
  if (!runs) return flags;
  const parts = runs.split('.');
  if (parts.length % 2) return null;
  let at = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const gap = parseInt(parts[i], 36), length = parseInt(parts[i + 1], 36);
    if (!Number.isSafeInteger(gap) || !Number.isSafeInteger(length) || length < 1) return null;
    at += gap;
    if (at + length > tris) return null;
    flags.fill(1, at, at + length);
    at += length;
  }
  return flags;
}

export function isValidGlassPart(p: unknown): p is GlassPart {
  const o = p as GlassPart;
  return !!o && typeof o === 'object'
    && Number.isInteger(o.mesh) && o.mesh >= 0 && o.mesh <= GLASS_LIMITS.meshIndex
    && Number.isInteger(o.tris) && o.tris >= 1 && o.tris <= GLASS_LIMITS.tris
    && Number.isInteger(o.verts) && o.verts >= 3 && o.verts <= GLASS_LIMITS.verts
    && typeof o.runs === 'string' && o.runs.length <= GLASS_LIMITS.runsChars
    && decodeGlassRuns(o.runs, o.tris) !== null;
}

export function isValidVehicleGlass(g: unknown): g is VehicleGlass {
  const o = g as VehicleGlass;
  if (!o || typeof o !== 'object' || o.v !== 1 || !Array.isArray(o.parts) || o.parts.length > GLASS_LIMITS.parts) return false;
  const seen = new Set<number>();
  let chars = 0;
  for (const part of o.parts) {
    if (!isValidGlassPart(part) || seen.has(part.mesh)) return false;
    seen.add(part.mesh);
    chars += part.runs.length;
  }
  return chars <= GLASS_LIMITS.totalChars;
}

/** The traced flags of one body mesh, or null when nothing was traced for it or the model changed since. */
export function tracedFlags(glass: VehicleGlass | null | undefined, mesh: number, tris: number, verts: number): Uint8Array | null {
  if (!glass || !Array.isArray(glass.parts)) return null;
  const part = glass.parts.find(p => p && p.mesh === mesh);
  if (!part || part.tris !== tris || part.verts !== verts) return null;
  return decodeGlassRuns(part.runs, tris);
}

export interface ScreenPoint { x: number; y: number }

/** Even-odd test of a point against a closed outline. */
export function pointInPolygon(x: number, y: number, polygon: readonly ScreenPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * Applies a lasso to a flag list: every triangle that faces the viewer (`facing[t]`) and whose centre on screen
 * (`screen[2t]`, `screen[2t+1]`; NaN when off screen or behind the eye) is inside `polygon` becomes glass (`add`)
 * or stops being glass (`remove`). Returns how many flags changed.
 */
export function lassoTriangles(screen: ArrayLike<number>, facing: ArrayLike<number>, polygon: readonly ScreenPoint[], flags: Uint8Array, mode: 'add' | 'remove'): number {
  if (polygon.length < 3) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const want = mode === 'add' ? 1 : 0;
  let changed = 0;
  for (let t = 0; t < flags.length; t++) {
    if (flags[t] === want || !facing[t]) continue;
    const x = screen[t * 2], y = screen[t * 2 + 1];
    if (!(x >= minX && x <= maxX && y >= minY && y <= maxY) || !pointInPolygon(x, y, polygon)) continue;
    flags[t] = want;
    changed++;
  }
  return changed;
}
