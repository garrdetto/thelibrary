/**
 * Maple Body & Wheel: a three-bay garage on Commerce St (east of the police
 * station) that repairs crash damage and sells paint, window tint, rims, lift
 * and lowering kits and performance parts. The layout, the menu and every
 * price live here so the authority prices each order itself.
 */
import { cleanCar, FINISH_LABEL, isHexColor, isPaintFinish, LIFT_MAX, LIFT_MIN, PERF_MAX, RIM_FINISHES, RIM_SIZES, RIM_STYLES, type OwnedCar, type PaintFinish, type PerfPart, type RimFinish, type RimStyle } from './Cars';
import { VEHICLES } from './Economy';

export const BODY_SHOP = {
  id: 'bodyshop',
  name: 'Maple Body & Wheel',
  x: 205, z: -72, w: 30, d: 22, h: 7.5,
  /** The open bay fronts face +z, onto Commerce St. */
  frontZ: -61,
};

/** The three bays, inside the building: park a car inside one and walk up to it. */
export const BODY_SHOP_BAYS = [0, 1, 2].map(i => {
  const inner = BODY_SHOP.w - 0.8, bayW = inner / 3;
  return { id: i + 1, x: BODY_SHOP.x - inner / 2 + bayW * (i + 0.5), z: BODY_SHOP.z + 0.6, w: bayW - 0.6, d: BODY_SHOP.d - 2.4 };
});

export const inBay = (x: number, z: number) => BODY_SHOP_BAYS.find(b => Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) ?? null;
/** On foot: anywhere in the building or on its apron counts as being at the shop. */
export const atBodyShop = (x: number, z: number) => Math.abs(x - BODY_SHOP.x) <= BODY_SHOP.w / 2 + 2 && z >= BODY_SHOP.z - BODY_SHOP.d / 2 - 1 && z <= BODY_SHOP.frontZ + 8;

export const RIM_LABEL: Record<RimStyle, string> = { factory: 'Factory', fivespoke: 'Five-Spoke', mesh: 'Mesh', dish: 'Deep Dish', turbine: 'Turbine', beadlock: 'Beadlock (off-road)' };
export const RIM_FINISH_LABEL: Record<RimFinish, string> = { silver: 'Silver', chrome: 'Chrome', black: 'Gloss black', gunmetal: 'Gunmetal', gold: 'Gold', body: 'Body color' };
export const RIM_SIZE_LABEL = ['Stock size', '+1 inch', '+2 inches'];
export const TINT_LABEL = ['No tint', 'Light (35%)', 'Dark (20%)', 'Limo (5%)'];
export const LIFT_LABEL = (lift: number) => lift === 0 ? 'Stock height' : lift < 0 ? `Lowered ${-lift * 4} cm` : `Lifted ${lift * 5} cm${lift >= 2 ? ' + bigger tires' : ''}`;
export const PERF_LABEL: Record<PerfPart, string[]> = {
  engine: ['Stock engine', 'Stage 1 tune', 'Stage 2 tune', 'Stage 3 tune'],
  exhaust: ['Stock exhaust', 'Performance exhaust'],
  brakes: ['Stock brakes', 'Sport brakes', 'Race brakes'],
  tires: ['All-season tires', 'Sport tires', 'All-terrain tires'],
};
export const PERF_BLURB: Record<PerfPart, string[]> = {
  engine: ['', '+8% power, +4% top speed', '+16% power, +8% top speed', '+24% power, +12% top speed'],
  exhaust: ['', '+4% power'],
  brakes: ['', '+15% stopping', '+30% stopping'],
  tires: ['', '+10% grip', '+4% grip'],
};

const PERF_PRICE: Record<PerfPart, number[]> = { engine: [0, 1200, 2600, 4500], exhaust: [0, 700], brakes: [0, 600, 1500], tires: [0, 800, 700] };
const RIM_PRICE: Record<RimStyle, number> = { factory: 0, fivespoke: 650, mesh: 800, dish: 900, turbine: 750, beadlock: 1100 };
const RIM_FINISH_PRICE: Record<RimFinish, number> = { silver: 0, chrome: 250, black: 100, gunmetal: 100, gold: 300, body: 150 };
const LABOR = 95;

/** What the car is worth for pricing repairs: its sticker price, or a typical value for the free starters. */
export function carValue(kind: string) {
  const price = VEHICLES[kind]?.price ?? 0;
  if (price > 0) return price;
  return kind === 'trailer' ? 2500 : kind === 'mower' ? 3000 : 18_000;
}

export const repairPrice = (kind: string, car: OwnedCar) => car.damage > 0 || car.dents.length ? Math.max(120, Math.round((car.damage * carValue(kind) * 0.18 + car.dents.length * 40) / 5) * 5) : 0;

export interface ServiceOrder {
  repair?: boolean;
  color?: string;
  finish?: PaintFinish;
  tint?: number;
  rims?: { style: RimStyle; size: number; finish: RimFinish };
  lift?: number;
  perf?: Partial<Record<PerfPart, number>>;
}

const intIn = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** Keeps only valid changes that differ from the car as it is now. */
export function cleanOrder(raw: unknown, car: OwnedCar): ServiceOrder {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const out: ServiceOrder = {};
  if (o.repair === true && (car.damage > 0 || car.dents.length)) out.repair = true;
  const color = isHexColor(o.color) ? o.color.toLowerCase() : null;
  const finish = isPaintFinish(o.finish) ? o.finish : null;
  if ((color && color !== car.color) || (finish && finish !== car.finish)) { out.color = color ?? car.color; out.finish = finish ?? car.finish; }
  const tint = intIn(o.tint, 0, 3);
  if (tint !== null && tint !== car.tint) out.tint = tint;
  const r = o.rims && typeof o.rims === 'object' ? o.rims as Record<string, unknown> : null;
  if (r && (RIM_STYLES as readonly unknown[]).includes(r.style) && (RIM_FINISHES as readonly unknown[]).includes(r.finish) && intIn(r.size, 0, RIM_SIZES.length - 1) !== null) {
    const rims = { style: r.style as RimStyle, size: r.size as number, finish: r.finish as RimFinish };
    if (rims.style === 'factory') { rims.size = 0; rims.finish = 'silver'; }
    if (rims.style !== car.rims.style || rims.size !== car.rims.size || rims.finish !== car.rims.finish) out.rims = rims;
  }
  const lift = intIn(o.lift, LIFT_MIN, LIFT_MAX);
  if (lift !== null && lift !== car.lift) out.lift = lift;
  const p = o.perf && typeof o.perf === 'object' ? o.perf as Record<string, unknown> : {};
  for (const part of Object.keys(PERF_MAX) as PerfPart[]) {
    const level = intIn(p[part], 0, PERF_MAX[part]);
    if (level !== null && level !== car.perf[part]) (out.perf ??= {})[part] = level;
  }
  return out;
}

export interface Quote { lines: { label: string; price: number }[]; total: number }

/** Line-by-line price of an order on this car (downgrades and going back to stock cost labor only). */
export function quote(kind: string, car: OwnedCar, order: ServiceOrder): Quote {
  const lines: Quote['lines'] = [];
  if (order.repair) lines.push({ label: `Repair damage and ${car.dents.length || 'no'} dent${car.dents.length === 1 ? '' : 's'}`, price: repairPrice(kind, car) });
  if (order.color) {
    const big = carValue(kind) > 30_000 ? 1.3 : 1;
    lines.push({ label: `Repaint in ${FINISH_LABEL[order.finish ?? car.finish].toLowerCase()}`, price: Math.round(((order.finish ?? car.finish) === 'matte' ? 1400 : 900) * big) });
  }
  if (order.tint !== undefined) lines.push({ label: TINT_LABEL[order.tint], price: order.tint ? order.tint * 150 : LABOR });
  if (order.rims) {
    const r = order.rims;
    lines.push({ label: r.style === 'factory' ? 'Factory wheels' : `${RIM_LABEL[r.style]} rims, ${RIM_FINISH_LABEL[r.finish].toLowerCase()}, ${RIM_SIZE_LABEL[r.size].toLowerCase()}`, price: r.style === 'factory' ? LABOR : RIM_PRICE[r.style] + RIM_FINISH_PRICE[r.finish] + r.size * 200 });
  }
  if (order.lift !== undefined) lines.push({ label: LIFT_LABEL(order.lift), price: order.lift === 0 ? LABOR : Math.abs(order.lift) * (order.lift > 0 ? 450 : 400) });
  for (const part of Object.keys(order.perf ?? {}) as PerfPart[]) {
    const level = order.perf![part]!, now = car.perf[part];
    const price = level > now ? PERF_PRICE[part].slice(now + 1, level + 1).reduce((a, b) => a + b, 0) : part === 'tires' && level > 0 ? PERF_PRICE.tires[level] : LABOR;
    lines.push({ label: PERF_LABEL[part][level], price });
  }
  return { lines, total: lines.reduce((a, l) => a + l.price, 0) };
}

/** Applies a cleaned order to the car. */
export function applyOrder(car: OwnedCar, order: ServiceOrder, kind: string): OwnedCar {
  const next = cleanCar(car, kind);
  if (order.repair) { next.damage = 0; next.dents = []; }
  if (order.color) { next.color = order.color; next.finish = order.finish ?? next.finish; }
  if (order.tint !== undefined) next.tint = order.tint;
  if (order.rims) next.rims = { ...order.rims };
  if (order.lift !== undefined) next.lift = order.lift;
  for (const part of Object.keys(order.perf ?? {}) as PerfPart[]) next.perf[part] = order.perf![part]!;
  return next;
}
