/** Economy, needs, shops and vehicles: shared by the authority and the client UI. */
import { isCustomVehicleKind, type BuiltinVehicleKind, type VehicleKind } from './Vehicles';
import { Body, defaultLook, isBody, Look, cleanLook, STARTER_WARDROBE, WARDROBE } from './Wardrobe';
import { cleanCar, type OwnedCar } from './Cars';

export const START_MONEY = 105_000;
/** Solo mode's bottomless bank balance: purchases always go through. */
export const UNLIMITED_MONEY = 999_999_999;

/** Hard ceiling on total outstanding debt per player. */
export const LOAN_CAP = 50_000;
/** Interest charged once per in-game day, only to borrowers present when the day turns. */
export const LOAN_DAILY_RATE = 0.02;

export const MOW_PAY_PER_M2 = 0.75;     // paid only for lawns you don't own
export const DELIVERY_BASE_PAY = 350;
export const DELIVERY_PAY_PER_M = 2.2;

export const COST = {
  wall: 75, halfWall: 45, fence: 30, privacyFence: 55, railing: 40,
  door: 320, window: 260, picture: 540,
  slider: 1150, french: 980, glassdoor: 460, tall: 340, clerestory: 230, frosted: 190, garage: 1400,
  floorPerCell: 18,
  roofPerM2: 32,
  poolPerM2: 140,
  paint: 0,          // like The Sims' design tool, changing a finish is free
  refundRate: 1,     // build/buy mode refunds in full, so Undo never costs money
};

// ---------------------------------------------------------------- needs

export interface Needs { hunger: number; energy: number; fun: number }   // 0 (empty) .. 100 (full)
export const NEED_DECAY_PER_MIN: Needs = { hunger: 1.1, energy: 0.75, fun: 0.9 };

// ---------------------------------------------------------------- vehicles

export interface VehicleSpec {
  kind: VehicleKind; name: string; price: number; tank: number; mpg: number; fuel: 'gas' | 'electric' | 'none'; forSale?: boolean;
  /** False for published vehicles that keep their model's own colors, so buyers don't pick a paint. */
  paintable?: boolean;
}
export const isPaintable = (kind: string) => VEHICLES[kind]?.paintable !== false;

/** Fuel use is scaled up ×30 so a tank lasts an evening of driving, not a month. */
export const FUEL_SCALE = 30;
export const FUEL_PRICE = 3.49;     // per gallon (or per "charge unit" for electric)

const BUILTIN_VEHICLES: Record<BuiltinVehicleKind, VehicleSpec> = {
  truck:    { kind: 'truck', name: 'Work Pickup', price: 0, tank: 22, mpg: 19, fuel: 'gas' },
  hdtruck:  { kind: 'hdtruck', name: 'Heavy-Duty Crew Cab', price: 32_000, tank: 32, mpg: 14, fuel: 'gas' },
  coupe:    { kind: 'coupe', name: 'Muscle Coupe', price: 26_000, tank: 18, mpg: 17, fuel: 'gas' },
  sedan:    { kind: 'sedan', name: 'Family Sedan', price: 9_500, tank: 14, mpg: 32, fuel: 'gas' },
  golfcart: { kind: 'golfcart', name: 'Golf Cart', price: 4_200, tank: 6, mpg: 60, fuel: 'electric' },
  atv:      { kind: 'atv', name: 'Four-Wheeler', price: 6_400, tank: 4, mpg: 28, fuel: 'gas' },
  mower:    { kind: 'mower', name: 'Riding Mower', price: 0, tank: 2, mpg: 20, fuel: 'gas' },
  zeroturn: { kind: 'zeroturn', name: 'Zero-Turn Mower', price: 5_600, tank: 3, mpg: 18, fuel: 'gas' },
  trailer:  { kind: 'trailer', name: 'Utility Trailer', price: 0, tank: 0, mpg: 0, fuel: 'none' },
};
/** Every registered vehicle: built-ins plus admin-published ones (shared/CustomVehicles.ts). */
export const VEHICLES: Record<string, VehicleSpec> = { ...BUILTIN_VEHICLES };
export const STARTER_GARAGE: VehicleKind[] = ['truck', 'trailer', 'mower'];

/** The vehicle's spec, or null for a published vehicle this authority hasn't loaded. */
export const vehicleSpec = (kind: string): VehicleSpec | null => VEHICLES[kind] ?? null;
const forSale = (v: VehicleSpec) => v.forSale ?? v.price > 0;
const dealerItem = (v: VehicleSpec): ShopItem => ({ id: v.kind, name: v.name, price: v.price, blurb: `${v.fuel === 'electric' ? 'Electric' : `${v.mpg} mpg`} · ${v.tank} ${v.fuel === 'electric' ? 'kWh pack' : 'gal tank'}`, vehicle: v.kind });

// ---------------------------------------------------------------- shops

export interface ShopItem {
  id: string; name: string; price: number; blurb: string;
  needs?: Partial<Needs>;          // instant effect
  groceries?: number;              // adds meals to the fridge at home
  upgrade?: string;                // permanent perk
  vehicle?: VehicleKind;           // dealership
  clothing?: string;               // Maple Threads: a wardrobe piece
}

export const UPGRADES: Record<string, { name: string; blurb: string }> = {
  blades: { name: 'Sharpened mower blades', blurb: '+25% pay for mowing' },
  license: { name: 'Commercial delivery license', blurb: '+20% pay for deliveries' },
  cooler: { name: 'Insulated cooler', blurb: 'Hunger drops 30% slower' },
};

export const SHOP_ITEMS: Record<string, ShopItem[]> = {
  gas: [
    { id: 'snack', name: 'Trail mix & jerky', price: 6, blurb: 'Hunger +15', needs: { hunger: 15 } },
    { id: 'energy', name: 'Energy drink', price: 4, blurb: 'Energy +15', needs: { energy: 15 } },
  ],
  diner: [
    { id: 'burger', name: 'Double burger platter', price: 14, blurb: 'Hunger +45', needs: { hunger: 45 } },
    { id: 'pancakes', name: 'Pancake stack', price: 11, blurb: 'Hunger +35, Fun +5', needs: { hunger: 35, fun: 5 } },
    { id: 'shake', name: 'Chocolate shake', price: 6, blurb: 'Hunger +10, Fun +10', needs: { hunger: 10, fun: 10 } },
  ],
  cafe: [
    { id: 'coffee', name: 'Drip coffee', price: 4, blurb: 'Energy +25', needs: { energy: 25 } },
    { id: 'latte', name: 'Maple latte', price: 6, blurb: 'Energy +30, Fun +5', needs: { energy: 30, fun: 5 } },
    { id: 'scone', name: 'Blueberry scone', price: 4, blurb: 'Hunger +12', needs: { hunger: 12 } },
  ],
  grocery: [
    { id: 'groceries', name: 'Week of groceries', price: 60, blurb: '5 home-cooked meals (use your fridge)', groceries: 5 },
    { id: 'deli', name: 'Deli sandwich', price: 9, blurb: 'Hunger +30', needs: { hunger: 30 } },
  ],
  hardware: Object.entries({ blades: 1500, license: 2500, cooler: 400 }).map(([id, price]) => ({ id, name: UPGRADES[id].name, price, blurb: UPGRADES[id].blurb, upgrade: id })),
  clothing: WARDROBE.filter(w => w.price > 0).map(w => ({ id: w.id, name: w.name, price: w.price, blurb: w.blurb, clothing: w.id })),
  dealer: [],
};

/** Rebuilds Maple Motors' list after published vehicles are registered. */
export function refreshDealer() {
  SHOP_ITEMS.dealer = Object.values(VEHICLES).filter(forSale).map(dealerItem);
}
refreshDealer();

// ---------------------------------------------------------------- accounts

export interface Account {
  id: string;        // public id: stored as lot owner, safe to broadcast
  key: string;       // identity token, never sent to clients (blanked)
  name: string;
  color: string;
  money: number;
  debt: number;
  earned: number;    // lifetime earnings, used to underwrite credit
  garage: VehicleKind[];
  /** How each owned vehicle looks (paint color and finish), keyed like `garage`. */
  cars: Partial<Record<VehicleKind, OwnedCar>>;
  fuel: Partial<Record<VehicleKind, number>>;
  needs: Needs;
  groceries: number;
  upgrades: string[];
  /** What the player's character looks like (null until they first pick a body). */
  look: Look | null;
  /** Clothing bought at Maple Threads (starter pieces are always available). */
  wardrobe: string[];
}

/** Fills fields added after an account was first saved. */
export function normalizeAccount(a: Account): Account {
  // Published vehicles are kept even if this authority hasn't loaded them yet,
  // so a failed catalog fetch can never take a car out of someone's garage.
  a.garage = Array.isArray(a.garage) && a.garage.length ? a.garage.filter(k => typeof k === 'string' && (k in VEHICLES || (isCustomVehicleKind(k) && /^custom:[a-z0-9-]{8,64}$/.test(k)))) : [...STARTER_GARAGE];
  a.garage = [...new Set(a.garage)];
  for (const k of STARTER_GARAGE) if (!a.garage.includes(k)) a.garage.push(k);
  a.fuel = a.fuel && typeof a.fuel === 'object' ? a.fuel : {};
  for (const k of a.garage) if (typeof a.fuel[k] !== 'number' && VEHICLES[k]) a.fuel[k] = VEHICLES[k].tank;
  const cars = a.cars && typeof a.cars === 'object' ? a.cars : {};
  a.cars = {};
  for (const k of a.garage) a.cars[k] = cleanCar(cars[k], k);
  a.needs = a.needs && typeof a.needs === 'object' ? a.needs : { hunger: 80, energy: 85, fun: 70 };
  a.groceries = Number.isFinite(a.groceries) ? a.groceries : 2;
  a.upgrades = Array.isArray(a.upgrades) ? a.upgrades : [];
  a.wardrobe = Array.isArray(a.wardrobe) ? a.wardrobe.filter(id => WARDROBE.some(w => w.id === id)) : [];
  for (const id of STARTER_WARDROBE) if (!a.wardrobe.includes(id)) a.wardrobe.push(id);
  a.look = a.look && typeof a.look === 'object' && isBody(a.look.body) ? cleanLook(a.look, a.wardrobe) : null;
  return a;
}

export function newAccount(id: string, key: string, name: string, color: string, body?: Body): Account {
  return normalizeAccount({ id, key, name, color, money: START_MONEY, debt: 0, earned: 0, garage: [], cars: {}, fuel: {}, needs: { hunger: 80, energy: 85, fun: 70 }, groceries: 2, upgrades: [], look: body ? defaultLook(body) : null, wardrobe: [] });
}

/**
 * Credit limit: grows with proven income but never exceeds LOAN_CAP total.
 * Returns how much MORE the player may borrow right now.
 */
export function availableCredit(a: Account): number {
  const limit = Math.min(LOAN_CAP, 10_000 + a.earned * 2);
  return Math.max(0, Math.floor(limit - a.debt));
}

export const clampNeed = (v: number) => Math.max(0, Math.min(100, v));
