/** Economy, needs, shops and vehicles: shared by the authority and the client UI. */
import type { VehicleKind } from './Protocol';

export const START_MONEY = 35_000;
export const LOT_PRICE = 20_000;

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

export interface VehicleSpec { kind: VehicleKind; name: string; price: number; tank: number; mpg: number; fuel: 'gas' | 'electric' | 'none' }

/** Fuel use is scaled up ×30 so a tank lasts an evening of driving, not a month. */
export const FUEL_SCALE = 30;
export const FUEL_PRICE = 3.49;     // per gallon (or per "charge unit" for electric)

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
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
export const STARTER_GARAGE: VehicleKind[] = ['truck', 'trailer', 'mower'];

// ---------------------------------------------------------------- shops

export interface ShopItem {
  id: string; name: string; price: number; blurb: string;
  needs?: Partial<Needs>;          // instant effect
  groceries?: number;              // adds meals to the fridge at home
  upgrade?: string;                // permanent perk
  vehicle?: VehicleKind;           // dealership
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
  dealer: (Object.values(VEHICLES).filter(v => v.price > 0)).map(v => ({ id: v.kind, name: v.name, price: v.price, blurb: `${v.fuel === 'electric' ? 'Electric' : `${v.mpg} mpg`} · ${v.tank} ${v.fuel === 'electric' ? 'kWh pack' : 'gal tank'}`, vehicle: v.kind })),
};

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
  fuel: Partial<Record<VehicleKind, number>>;
  needs: Needs;
  groceries: number;
  upgrades: string[];
}

/** Fills fields added after an account was first saved. */
export function normalizeAccount(a: Account): Account {
  a.garage = Array.isArray(a.garage) && a.garage.length ? a.garage.filter(k => k in VEHICLES) : [...STARTER_GARAGE];
  for (const k of STARTER_GARAGE) if (!a.garage.includes(k)) a.garage.push(k);
  a.fuel = a.fuel && typeof a.fuel === 'object' ? a.fuel : {};
  for (const k of a.garage) if (typeof a.fuel[k] !== 'number') a.fuel[k] = VEHICLES[k].tank;
  a.needs = a.needs && typeof a.needs === 'object' ? a.needs : { hunger: 80, energy: 85, fun: 70 };
  a.groceries = Number.isFinite(a.groceries) ? a.groceries : 2;
  a.upgrades = Array.isArray(a.upgrades) ? a.upgrades : [];
  return a;
}

export function newAccount(id: string, key: string, name: string, color: string): Account {
  return normalizeAccount({ id, key, name, color, money: START_MONEY, debt: 0, earned: 0, garage: [], fuel: {}, needs: { hunger: 80, energy: 85, fun: 70 }, groceries: 2, upgrades: [] });
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
