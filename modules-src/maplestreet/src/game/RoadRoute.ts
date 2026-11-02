/**
 * Shortest drive along the town's streets, for the minimap's objective path.
 * The roads (straight and curved, plus curb cuts and the gas-station and depot yards) are rasterised
 * once onto a 2 m grid; A* runs from the road cell nearest the start to the
 * one nearest the goal, and the result is reduced to its corners.
 */
import { CURB_CUTS, curveDistance, DEPOT, GAS_STATION, MAP_BOUNDS, ROAD_W, ROADS, type RectXZ } from '../../shared/WorldLayout';

const CELL = 2;
const X0 = MAP_BOUNDS.x0, Z0 = MAP_BOUNDS.z0;
const W = Math.ceil((MAP_BOUNDS.x1 - MAP_BOUNDS.x0) / CELL), H = Math.ceil((MAP_BOUNDS.z1 - MAP_BOUNDS.z0) / CELL);

export interface RoutePoint { x: number; z: number }

let grid: Uint8Array | null = null;

function drivable(): Uint8Array {
  if (grid) return grid;
  const g = new Uint8Array(W * H);
  const yards: RectXZ[] = [
    { cx: GAS_STATION.canopy.x, cz: GAS_STATION.canopy.z, sx: GAS_STATION.canopy.w + 8, sz: GAS_STATION.canopy.d + 8 },
    { cx: DEPOT.padX, cz: DEPOT.padZ, sx: DEPOT.zoneR * 2, sz: DEPOT.zoneR * 2 },
  ];
  for (const r of [...ROADS, ...CURB_CUTS, ...yards]) {
    const i0 = Math.max(0, Math.floor((r.cx - r.sx / 2 - X0) / CELL)), i1 = Math.min(W - 1, Math.floor((r.cx + r.sx / 2 - X0) / CELL));
    const j0 = Math.max(0, Math.floor((r.cz - r.sz / 2 - Z0) / CELL)), j1 = Math.min(H - 1, Math.floor((r.cz + r.sz / 2 - Z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g[j * W + i] = 1;
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = X0 + (i + 0.5) * CELL, z = Z0 + (j + 0.5) * CELL;
    if (x < -100 && curveDistance(x, z) < ROAD_W / 2 - 0.5) g[j * W + i] = 1;
  }
  return (grid = g);
}

const cellOf = (x: number, z: number) => [Math.min(W - 1, Math.max(0, Math.floor((x - X0) / CELL))), Math.min(H - 1, Math.max(0, Math.floor((z - Z0) / CELL)))] as const;
const center = (i: number, j: number): RoutePoint => ({ x: X0 + (i + 0.5) * CELL, z: Z0 + (j + 0.5) * CELL });

/** Nearest drivable cell, searching outward ring by ring (up to ~120 m). */
function nearestRoad(x: number, z: number): number | null {
  const g = drivable();
  const [ci, cj] = cellOf(x, z);
  for (let r = 0; r < 60; r++) {
    let best = -1, bestD = Infinity;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || i < 0 || j < 0 || i >= W || j >= H || !g[j * W + i]) continue;
      const d = (i - ci) ** 2 + (j - cj) ** 2;
      if (d < bestD) { bestD = d; best = j * W + i; }
    }
    if (best >= 0) return best;
  }
  return null;
}

/** Binary min-heap of numbers (score and cell packed into one key, so stale entries are simply skipped). */
class Heap {
  private items: number[] = [];
  get size() { return this.items.length; }
  push(v: number) {
    const a = this.items; a.push(v);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p] <= a[i]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.items, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l] < a[m]) m = l;
        if (r < a.length && a[r] < a[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

const SLOTS = 1 << 20;
const pack = (score: number, cell: number) => Math.round(score * 10) * SLOTS + cell;

/** Corner points of the shortest street route from `from` to `to` (both included), or a straight line if there's none. */
export function roadRoute(from: RoutePoint, to: RoutePoint): RoutePoint[] {
  const g = drivable();
  const start = nearestRoad(from.x, from.z), goal = nearestRoad(to.x, to.z);
  if (start === null || goal === null) return [from, to];
  const gx = goal % W, gz = Math.floor(goal / W);
  const cost = new Float32Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const done = new Uint8Array(W * H);
  const heap = new Heap();
  cost[start] = 0;
  heap.push(pack(Math.abs(start % W - gx) + Math.abs(Math.floor(start / W) - gz), start));
  while (heap.size) {
    const c = heap.pop() % SLOTS;
    if (done[c]) continue;
    done[c] = 1;
    if (c === goal) break;
    const ci = c % W, cj = Math.floor(c / W);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (!g[n]) continue;
      const turn = prev[c] >= 0 && (prev[c] % W - ci !== -di || Math.floor(prev[c] / W) - cj !== -dj) ? 0.4 : 0;
      const next = cost[c] + 1 + turn;
      if (next >= cost[n]) continue;
      cost[n] = next; prev[n] = c;
      heap.push(pack(next + Math.abs(ni - gx) + Math.abs(nj - gz), n));
    }
  }
  if (prev[goal] < 0 && goal !== start) return [from, to];
  const cells: number[] = [];
  for (let c = goal; c >= 0; c = prev[c]) { cells.push(c); if (c === start) break; }
  cells.reverse();
  const pts: RoutePoint[] = [from];
  for (let k = 0; k < cells.length; k++) {
    const a = cells[k - 1], b = cells[k], c = cells[k + 1];
    if (a === undefined || c === undefined || (b - a) !== (c - b)) pts.push(center(b % W, Math.floor(b / W)));
  }
  pts.push(to);
  return pts;
}

/** Total length of a route in meters. */
export const routeLength = (pts: RoutePoint[]) => pts.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0, 0);
