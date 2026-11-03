/**
 * What each car a player owns looks like: its paint color and finish, picked
 * at Maple Motors when it's bought, and any crash damage it has taken (a
 * condition plus the dents where it was hit). Stored per vehicle kind on the
 * account (`Account.cars`), validated here by every authority, and stamped
 * onto the player's vehicle snapshots so neighbors see the same car.
 */
import { TUNING } from './Vehicles';

export const PAINT_FINISHES = ['gloss', 'metallic', 'matte'] as const;
export type PaintFinish = (typeof PAINT_FINISHES)[number];
export const FINISH_LABEL: Record<PaintFinish, string> = { gloss: 'Gloss', metallic: 'Metallic', matte: 'Matte' };

/** A dent in chassis space (metres, +x forward): where the car was hit and how deep. */
export interface Dent { x: number; y: number; z: number; depth: number }

export interface CarStyle {
  color: string;
  finish: PaintFinish;
  /** 0 = like new, 1 = wrecked. Costs engine power and grip until repaired. */
  damage?: number;
  dents?: Dent[];
}
export interface OwnedCar extends CarStyle { damage: number; dents: Dent[] }

export const MAX_DENTS = 12;
/** Horizontal speed change (m/s) in one physics step that counts as a crash: far beyond any braking. */
export const CRASH_MIN_DV = 4;
const CRASH_FULL_DV = 40;

/** Damage one crash adds: nothing below the threshold, a quarter for a ~30 mph wall hit, at most half. */
export function crashDamage(dv: number): number {
  if (!(dv > CRASH_MIN_DV)) return 0;
  return Math.min(0.5, (Math.min(dv, CRASH_FULL_DV) - CRASH_MIN_DV) / 36);
}

/** How deep the dent from a crash of this severity is. */
export const dentDepth = (dv: number) => Math.min(0.16, 0.03 + crashDamage(dv) * 0.3);

/** What damage does to the drive: less engine, less grip and a slight pull. */
export function conditionEffects(damage: number) {
  const d = Math.min(1, Math.max(0, damage || 0));
  return { engine: 1 - 0.35 * d, grip: 1 - 0.2 * d, pull: d > 0.25 ? 0.05 * (d - 0.25) / 0.75 : 0 };
}

/** Adds a crash to a car: more damage and a dent where it was hit (nearby dents deepen instead). */
export function addCrash(car: OwnedCar, dv: number, at: { x: number; y: number; z: number }): number {
  const added = crashDamage(dv);
  if (!added) return 0;
  car.damage = round3(Math.min(1, car.damage + added));
  const p = { x: round3(clampTo(at.x, 6)), y: round3(clampTo(at.y, 4)), z: round3(clampTo(at.z, 3)) };
  const depth = round3(dentDepth(dv));
  const near = car.dents.find(d => Math.hypot(d.x - p.x, d.y - p.y, d.z - p.z) < 0.45);
  if (near) near.depth = round3(Math.min(0.22, near.depth + depth * 0.6));
  else { car.dents.push({ ...p, depth }); if (car.dents.length > MAX_DENTS) car.dents.shift(); }
  return added;
}

const clampTo = (v: unknown, limit: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-limit, Math.min(limit, v)) : 0);
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function cleanDents(raw: unknown): Dent[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_DENTS).filter(d => d && typeof d === 'object').map(d => ({
    x: round3(clampTo(d.x, 6)), y: round3(clampTo(d.y, 4)), z: round3(clampTo(d.z, 3)),
    depth: round3(Math.max(0, Math.min(0.22, typeof d.depth === 'number' && Number.isFinite(d.depth) ? d.depth : 0))),
  }));
}

/** Dealer swatches; any other color can be picked too. */
export const PAINT_SWATCHES: { name: string; color: string }[] = [
  { name: 'Arctic White', color: '#f1f1ec' },
  { name: 'Silver', color: '#b8bdc3' },
  { name: 'Graphite', color: '#4a4f56' },
  { name: 'Midnight Black', color: '#16181b' },
  { name: 'Fire Red', color: '#b3171d' },
  { name: 'Sunset Orange', color: '#e0601b' },
  { name: 'Bus Yellow', color: '#f2c12e' },
  { name: 'Forest Green', color: '#2f5d2a' },
  { name: 'Lime', color: '#8fc93a' },
  { name: 'Ocean Blue', color: '#1f5fae' },
  { name: 'Navy', color: '#1d2b4a' },
  { name: 'Teal', color: '#1f8a8a' },
  { name: 'Plum', color: '#5b2a6e' },
  { name: 'Sand', color: '#c9b38a' },
  { name: 'Copper', color: '#9a5a32' },
];

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
export const isPaintFinish = (v: unknown): v is PaintFinish => (PAINT_FINISHES as readonly unknown[]).includes(v);

/** The showroom color the vehicle was designed in. */
export function factoryColor(kind: string): string {
  const paint = TUNING[kind]?.paint;
  return typeof paint === 'number' ? `#${paint.toString(16).padStart(6, '0')}` : '#8a8f96';
}

export function defaultCar(kind: string): OwnedCar {
  return { color: factoryColor(kind), finish: 'metallic', damage: 0, dents: [] };
}

/** A stored or requested car with anything missing or malformed replaced by the factory look. */
export function cleanCar(raw: unknown, kind: string): OwnedCar {
  const base = defaultCar(kind);
  const r = raw && typeof raw === 'object' ? raw as Partial<OwnedCar> : {};
  return {
    color: isHexColor(r.color) ? r.color.toLowerCase() : base.color,
    finish: isPaintFinish(r.finish) ? r.finish : base.finish,
    damage: typeof r.damage === 'number' && Number.isFinite(r.damage) ? round3(Math.max(0, Math.min(1, r.damage))) : 0,
    dents: cleanDents(r.dents),
  };
}

/** A purchase only chooses the paint; a new car always leaves the lot undamaged. */
export const newCar = (requested: unknown, kind: string): OwnedCar => ({ ...cleanCar(requested, kind), damage: 0, dents: [] });

/** Changes whenever anything visible about the car changes, so renderers know to rebuild it. */
export const carStyleKey = (c: CarStyle | null | undefined) =>
  c ? `${c.color}|${c.finish}|${Math.round((c.damage ?? 0) * 20)}|${(c.dents ?? []).map(d => `${d.x},${d.y},${d.z},${d.depth}`).join(';')}` : '';
