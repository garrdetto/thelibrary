/**
 * Lawn model shared by the authority and the client.
 *
 * Every 1 m cell of a lot remembers when it was last cut and which way its
 * blades were pushed. Real stripes come from blades bent toward or away from
 * the viewer, so the direction is what matters; a second pass at an angle
 * pushes the blades partly the new way and partly keeps the old lean, which
 * is what turns crossed stripes into a diamond (checkerboard) pattern.
 *
 * Grass grows back over GROW_DAYS in-game days: freshly cut it is short and
 * the stripes are crisp, by day five it is at full height again, the stripes
 * have faded out and it is due for another cut.
 */
import type { MowStroke } from './Protocol';
import type { LotDef } from './WorldLayout';

/** In-game days for cut grass to grow back to full height. */
export const GROW_DAYS = 5;
/** Time stamps are stored in 1/48 day steps (30 in-game minutes). */
export const TICKS_PER_DAY = 48;
/** How much of the old lean survives a new pass (the rest follows the mower). */
export const KEEP_OLD_LEAN = 0.6;
/** Grass shorter than this fraction of full height doesn't pay to mow again. */
export const MIN_PAY_GROWTH = 0.2;

export const BLADE_MIN = 0.035;      // m, just cut
export const BLADE_MAX = 0.11;       // m, five days of growth: long enough to notice, not a meadow

export interface LawnCells {
  /** Tick (game day × TICKS_PER_DAY, wrapped to 16 bits) of the last cut; 0 = full height. */
  t: Uint16Array;
  /** Blade lean direction, 0..255 around the circle. */
  a: Uint8Array;
}

export const emptyCells = (n: number): LawnCells => ({ t: new Uint16Array(n), a: new Uint8Array(n) });

/** Game clock in days: day 1 starts at 0. */
export const gameDays = (day: number, hours: number) => (day - 1) + hours / 24;
export const tickOf = (days: number) => (Math.floor(days * TICKS_PER_DAY) % 65535) + 1;

/** Days since the cell was cut (Infinity when it has grown out). */
export function ageDays(stamp: number, nowDays: number): number {
  if (!stamp) return Infinity;
  const ticks = (tickOf(nowDays) - stamp + 65535) % 65535;
  return ticks / TICKS_PER_DAY;
}

/** 0 = just cut, 1 = full height. */
export const growthOf = (age: number) => (Number.isFinite(age) ? Math.min(1, Math.max(0, age / GROW_DAYS)) : 1);
export const bladeHeight = (growth: number) => BLADE_MIN + (BLADE_MAX - BLADE_MIN) * growth;

export const angleToByte = (rad: number) => Math.round(((rad / (Math.PI * 2)) % 1 + 1) % 1 * 256) & 255;
export const byteToAngle = (b: number) => (b / 256) * Math.PI * 2;

/**
 * New blade direction after a pass heading (hx, hz) over grass that last lay
 * at `oldAngle` with `oldGrowth`: mostly the mower's way, partly the old lean
 * (less of it the longer the grass has grown since).
 */
export function blendLean(hx: number, hz: number, oldAngle: number | null, oldGrowth: number): number {
  const l = Math.hypot(hx, hz) || 1;
  let x = hx / l, z = hz / l;
  if (oldAngle !== null) {
    const keep = KEEP_OLD_LEAN * (1 - oldGrowth);
    x += Math.cos(oldAngle) * keep; z += Math.sin(oldAngle) * keep;
  }
  return Math.atan2(z, x);
}

/** Cells touched by a stroke (sampled on a 0.4 m lattice across the deck). */
export function strokeCells(lot: LotDef, s: MowStroke): number[] {
  const out = new Set<number>();
  const len = Math.hypot(s.hx, s.hz) || 1;
  const fx = s.hx / len, fz = s.hz / len;     // forward
  const rx = -fz, rz = fx;                    // right
  for (let a = -s.len / 2; a <= s.len / 2 + 1e-6; a += 0.4) {
    for (let b = -s.width / 2; b <= s.width / 2 + 1e-6; b += 0.4) {
      const x = Math.floor(s.x + fx * a + rx * b) - lot.x;
      const z = Math.floor(s.z + fz * a + rz * b) - lot.z;
      if (x >= 0 && z >= 0 && x < lot.w && z < lot.d) out.add(z * lot.w + x);
    }
  }
  return [...out];
}

/**
 * Applies a stroke to the authoritative cells. Returns how much grass it cut,
 * in m² weighted by how grown each cell was (only cells worth mowing count).
 */
export function mowCells(cells: LawnCells, lot: LotDef, s: MowStroke, nowDays: number): number {
  let cut = 0;
  const stamp = tickOf(nowDays);
  for (const i of strokeCells(lot, s)) {
    const g = growthOf(ageDays(cells.t[i], nowDays));
    if (g >= MIN_PAY_GROWTH) cut += g;
    const old = cells.t[i] ? byteToAngle(cells.a[i]) : null;
    cells.a[i] = angleToByte(blendLean(s.hx, s.hz, old, g));
    cells.t[i] = stamp;
  }
  return cut;
}

/** Cells that have grown back to full height forget their cut (keeps the saved data small). */
export function sweepGrown(cells: LawnCells, nowDays: number): boolean {
  let changed = false;
  for (let i = 0; i < cells.t.length; i++) if (cells.t[i] && ageDays(cells.t[i], nowDays) >= GROW_DAYS) { cells.t[i] = 0; cells.a[i] = 0; changed = true; }
  return changed;
}

/* Encoding: run-length (count, tick hi, tick lo, angle) groups, base64. An untouched lawn is ''. */
const toB64 = (bytes: number[]) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (s: string) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

export function encodeCells(c: LawnCells): string {
  if (!c.t.some(Boolean)) return '';
  const bytes: number[] = [];
  for (let i = 0; i < c.t.length;) {
    let n = 1;
    while (i + n < c.t.length && n < 255 && c.t[i + n] === c.t[i] && c.a[i + n] === c.a[i]) n++;
    bytes.push(n, c.t[i] >> 8, c.t[i] & 255, c.a[i]);
    i += n;
  }
  return toB64(bytes);
}

export function decodeCells(s: string | undefined, n: number): LawnCells {
  const c = emptyCells(n);
  if (!s) return c;
  try {
    const b = fromB64(s);
    let i = 0;
    for (let k = 0; k + 3 < b.length && i < n; k += 4) {
      const t = (b[k + 1] << 8) | b[k + 2];
      for (let r = 0; r < b[k] && i < n; r++, i++) { c.t[i] = t; c.a[i] = b[k + 3]; }
    }
  } catch { /* corrupt: treat as grown out */ }
  return c;
}
