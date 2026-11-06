/**
 * The natural ground of the county before anything is built: rolling farm
 * country, a gentler bowl where the town sits, a level plateau for the
 * airport, wooded hills to the north and a rising backdrop beyond the 4 km
 * map edge. Pure and deterministic, so the page, the server and tests agree.
 */
import { fbm } from './Noise';

export const WORLD = { half: 2000 };
export const TOWN = { x0: -1520, x1: -520, z0: 120, z1: 640 };
export const AIRPORT = { x0: 450, x1: 1900, z0: -700, z1: 700, elev: 14 };

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const smoothstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function rectFade(r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number, fade: number) {
  const d = Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
  return 1 - smoothstep(0, fade, d);
}

export function baseHeight(x: number, z: number) {
  const broad = (fbm(x / 1100 + 11.3, z / 1100 - 4.1, 5) - 0.5) * 70;
  const detail = (fbm(x / 260 - 2.7, z / 260 + 8.9, 3) - 0.5) * 10;
  const hills = smoothstep(500, 1800, z) * 70 * fbm(x / 600 + 1.3, z / 600 + 2.2, 4);
  let h = 12 + broad + detail + hills;
  h = mix(h, 12 + broad * 0.3 + detail * 0.12, rectFade(TOWN, x, z, 260));
  h = mix(h, AIRPORT.elev, rectFade(AIRPORT, x, z, 320));
  const out = Math.max(Math.abs(x), Math.abs(z)) - WORLD.half;
  if (out > 0) h += Math.min(1, out / 2500) ** 1.5 * 260 * fbm(x / 1500 - 3, z / 1500 + 5, 4);
  return h;
}

/** Ground height averaged over a 25 m ring, used to grade roads so they ride over small bumps. */
export function smoothBase(x: number, z: number) {
  let s = baseHeight(x, z) * 2;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; s += baseHeight(x + Math.cos(a) * 25, z + Math.sin(a) * 25); }
  return s / 10;
}
