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

export const RIM_STYLES = ['factory', 'fivespoke', 'mesh', 'dish', 'turbine', 'beadlock'] as const;
export type RimStyle = (typeof RIM_STYLES)[number];
export const RIM_FINISHES = ['silver', 'chrome', 'black', 'gunmetal', 'gold', 'body'] as const;
export type RimFinish = (typeof RIM_FINISHES)[number];
/** Rim size steps over stock (bigger rim, thinner sidewall; the tire's outside size stays the same). */
export const RIM_SIZES = [0, 1, 2] as const;
export const LIFT_MIN = -2, LIFT_MAX = 3;
export const TINT_LEVELS = [0, 1, 2, 3] as const;
export const PERF_MAX = { engine: 3, exhaust: 1, brakes: 2, tires: 2 } as const;
export type PerfPart = keyof typeof PERF_MAX;

export interface Rims { style: RimStyle; size: number; finish: RimFinish }
export type Perf = Record<PerfPart, number>;

/** A dent in chassis space (metres, +x forward): where the car was hit and how deep. */
export interface Dent { x: number; y: number; z: number; depth: number }

export interface CarStyle {
  color: string;
  finish: PaintFinish;
  /** 0 = like new, 1 = wrecked. Costs engine power and grip until repaired. */
  damage?: number;
  dents?: Dent[];
  /** Body shop work that shows: window tint (0 none … 3 limo), rims, and lift (−2 lowered … +3 lifted). */
  tint?: number;
  rims?: Rims;
  lift?: number;
}
export interface OwnedCar extends CarStyle { damage: number; dents: Dent[]; tint: number; rims: Rims; lift: number; perf: Perf }

export const STOCK_RIMS: Rims = { style: 'factory', size: 0, finish: 'silver' };
export const STOCK_PERF: Perf = { engine: 0, exhaust: 0, brakes: 0, tires: 0 };

/** Everything the body shop's work does to the drive (multipliers, metres of lift, tire scale). */
export function tuneEffects(car: Partial<OwnedCar> | null | undefined) {
  const p = car?.perf ?? STOCK_PERF, lift = car?.lift ?? 0;
  return {
    engine: (1 + 0.08 * p.engine) * (1 + 0.04 * p.exhaust),
    topSpeed: 1 + 0.04 * p.engine + 0.02 * p.exhaust,
    brake: 1 + 0.15 * p.brakes,
    grip: (p.tires === 1 ? 1.1 : p.tires === 2 ? 1.04 : 1) * (1 - 0.03 * lift),
    lift: lift < 0 ? lift * 0.04 : lift * 0.05,
    tireScale: lift >= 2 ? 1 + 0.06 * (lift - 1) : 1,
  };
}

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
  return { color: factoryColor(kind), finish: 'metallic', damage: 0, dents: [], tint: 0, rims: { ...STOCK_RIMS }, lift: 0, perf: { ...STOCK_PERF } };
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
    tint: intIn(r.tint, 0, 3),
    rims: cleanRims(r.rims),
    lift: intIn(r.lift, LIFT_MIN, LIFT_MAX),
    perf: cleanPerf(r.perf),
  };
}

const intIn = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : 0);

function cleanRims(raw: unknown): Rims {
  const r = raw && typeof raw === 'object' ? raw as Partial<Rims> : {};
  return {
    style: (RIM_STYLES as readonly unknown[]).includes(r.style) ? r.style as RimStyle : 'factory',
    size: intIn(r.size, 0, RIM_SIZES.length - 1),
    finish: (RIM_FINISHES as readonly unknown[]).includes(r.finish) ? r.finish as RimFinish : 'silver',
  };
}

function cleanPerf(raw: unknown): Perf {
  const r = raw && typeof raw === 'object' ? raw as Partial<Perf> : {};
  return { engine: intIn(r.engine, 0, PERF_MAX.engine), exhaust: intIn(r.exhaust, 0, PERF_MAX.exhaust), brakes: intIn(r.brakes, 0, PERF_MAX.brakes), tires: intIn(r.tires, 0, PERF_MAX.tires) };
}

/** A purchase only chooses the paint; a new car always leaves the lot undamaged. */
export const newCar = (requested: unknown, kind: string): OwnedCar => {
  const { color, finish } = cleanCar(requested, kind);
  return { ...defaultCar(kind), color, finish };
};

/** Changes whenever anything visible about the car changes, so renderers know to rebuild it. */
export const carStyleKey = (c: CarStyle | null | undefined) =>
  c ? `${c.color}|${c.finish}|${Math.round((c.damage ?? 0) * 20)}|${(c.dents ?? []).map(d => `${d.x},${d.y},${d.z},${d.depth}`).join(';')}|${c.tint ?? 0}|${c.rims ? `${c.rims.style},${c.rims.size},${c.rims.finish}` : ''}|${c.lift ?? 0}` : '';
