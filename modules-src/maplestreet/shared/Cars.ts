/**
 * What each car a player owns looks like: its paint color and finish, picked
 * at Maple Motors when it's bought. Stored per vehicle kind on the account
 * (`Account.cars`), validated here by every authority, and stamped onto the
 * player's vehicle snapshots so neighbors see the same car.
 */
import { TUNING } from './Vehicles';

export const PAINT_FINISHES = ['gloss', 'metallic', 'matte'] as const;
export type PaintFinish = (typeof PAINT_FINISHES)[number];
export const FINISH_LABEL: Record<PaintFinish, string> = { gloss: 'Gloss', metallic: 'Metallic', matte: 'Matte' };

export interface CarStyle { color: string; finish: PaintFinish }
export interface OwnedCar extends CarStyle {}

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
  return { color: factoryColor(kind), finish: 'metallic' };
}

/** A stored or requested car with anything missing or malformed replaced by the factory look. */
export function cleanCar(raw: unknown, kind: string): OwnedCar {
  const base = defaultCar(kind);
  const r = raw && typeof raw === 'object' ? raw as Partial<OwnedCar> : {};
  return {
    color: isHexColor(r.color) ? r.color.toLowerCase() : base.color,
    finish: isPaintFinish(r.finish) ? r.finish : base.finish,
  };
}

/** Changes whenever anything visible about the car changes, so renderers know to rebuild it. */
export const carStyleKey = (c: CarStyle | null | undefined) => c ? `${c.color}|${c.finish}` : '';
