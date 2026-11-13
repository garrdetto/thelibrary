/**
 * Fox Lake's freight runs (renderer-free, town coordinates; the lake country is beyond the town's square, south of
 * it at town z > 640). The dispatch board at Fox Lake Freight & Gravel offers loads that change every
 * BOARD_MINUTES: general freight in the dry van to the stores, fuel in the tanker to both gas stations, lumber,
 * steel and building supplies on the flatbed to building sites and the hardware store, saw logs on the log trailer
 * from the landing in the woods to the sawmill, and gravel in the dump truck from the pit to building sites and the
 * Lake Road works. A load names its rig, where to pick it up and where to drop it, and pays by distance.
 *
 * The authority (shared/RoomLogic.ts) checks every step: the player must be driving the right truck (a tractor
 * with the right trailer hitched, or the dump truck) within STOP_RADIUS of the stop.
 */
import type { FleetKind, SemiTrailerKind } from './FleetVehicles';

export type FreightRig = 'dumptruck' | SemiTrailerKind;
export type FreightCargo = 'general' | 'fuel' | 'lumber' | 'steel' | 'pallets' | 'logs' | 'gravel';

export interface FreightSite {
  id: string;
  name: string;
  /** Where the truck stops (town coordinates). */
  x: number;
  z: number;
}

export interface LoadType {
  cargo: FreightCargo;
  label: string;
  rig: FreightRig;
  /** Pickup sites, then drop sites. */
  from: string[];
  to: string[];
  /** Kilograms on board. */
  mass: number;
}

export interface Load {
  id: string;
  cargo: FreightCargo;
  label: string;
  rig: FreightRig;
  from: string;
  to: string;
  pay: number;
  /** Straight-line distance in metres (pay is by it). */
  distance: number;
  mass: number;
}

export interface FreightJob extends Load {
  stage: 'toPickup' | 'toDrop';
}

export const BOARD_MINUTES = 10;
export const BOARD_SIZE = 8;
export const STOP_RADIUS = 18;
export const FREIGHT_BASE_PAY = { semi: 450, dumptruck: 300 } as const;
export const FREIGHT_PAY_PER_M = { semi: 2.4, dumptruck: 1.9 } as const;

/** The yard sits west of the county road's bend (scene x -365..-295, z 530..590). */
export const YARD = { x0: -9, x1: 61, z0: 546, z1: 622, gate: { x: 61, z: 582 } } as const;
/** The sawmill east of downtown, at the end of Main St. */
export const MILL = { x0: 575, x1: 616, z0: -36, z1: 36 } as const;
/** The logging landing in the woods east of the lake, off the Lake Road. */
export const LANDING = { x: 690, z: 1252, r: 26 } as const;

export const FREIGHT_SITES: readonly FreightSite[] = [
  { id: 'yard-dock', name: 'Fox Lake Freight dock', x: 16, z: 574 },
  { id: 'yard-fuel', name: 'Fox Lake Freight fuel rack', x: 44, z: 612 },
  { id: 'yard-pit', name: 'Fox Lake gravel pit', x: 8, z: 610 },
  { id: 'yard-steel', name: 'Fox Lake Freight steel yard', x: 44, z: 574 },
  { id: 'mill-logs', name: 'Fox Plains Sawmill log deck', x: 590, z: 22 },
  { id: 'mill-lumber', name: 'Fox Plains Sawmill lumber shed', x: 584, z: -8 },
  { id: 'landing', name: 'Pine Ridge logging landing', x: 690, z: 1252 },
  { id: 'gas-town', name: 'Gas & Go', x: 100, z: 18 },
  { id: 'gas-county', name: 'Bear Paw Fuel & Bait', x: 98, z: 520 },
  { id: 'market', name: 'Fresh Market', x: 210, z: 54 },
  { id: 'hardware', name: 'Maple Hardware', x: 182, z: 54 },
  { id: 'hotel', name: 'Lakeside Hotel', x: 500, z: 2 },
  { id: 'casino', name: 'Northwoods Lodge Casino & Bar', x: 116, z: 54 },
  { id: 'outfitters', name: 'Fox Outfitters', x: 503, z: 1254 },
  { id: 'tavern', name: 'The Rusty Lure Tavern', x: 99, z: 384 },
  { id: 'motel', name: 'Pine Cone Motel', x: 75, z: 428 },
  { id: 'site-juniper', name: 'New build on Juniper St', x: 40, z: 262 },
  { id: 'site-willow', name: 'New build on Willow Bend', x: -200, z: 134 },
  { id: 'site-mill', name: 'New shops on Mill St', x: 452, z: -110 },
  { id: 'roadworks', name: 'Lake Road works', x: 618, z: 1196 },
];

export const LOAD_TYPES: readonly LoadType[] = [
  { cargo: 'general', label: 'General freight', rig: 'dryvan', from: ['yard-dock'], to: ['market', 'hardware', 'hotel', 'casino', 'outfitters', 'tavern', 'motel'], mass: 9000 },
  { cargo: 'fuel', label: 'Unleaded and diesel', rig: 'tanker', from: ['yard-fuel'], to: ['gas-town', 'gas-county'], mass: 12000 },
  { cargo: 'lumber', label: 'Lumber', rig: 'flatbed', from: ['mill-lumber'], to: ['site-juniper', 'site-willow', 'site-mill', 'hardware'], mass: 11000 },
  { cargo: 'steel', label: 'Steel beams', rig: 'flatbed', from: ['yard-steel'], to: ['site-juniper', 'site-mill', 'site-willow'], mass: 14000 },
  { cargo: 'pallets', label: 'Building supplies', rig: 'flatbed', from: ['yard-dock'], to: ['hardware', 'site-juniper', 'site-willow', 'site-mill'], mass: 8000 },
  { cargo: 'logs', label: 'Saw logs', rig: 'logger', from: ['landing'], to: ['mill-logs'], mass: 16000 },
  { cargo: 'gravel', label: 'Gravel', rig: 'dumptruck', from: ['yard-pit'], to: ['site-juniper', 'site-willow', 'site-mill', 'roadworks'], mass: 13000 },
];

export const siteOf = (id: string): FreightSite | undefined => FREIGHT_SITES.find(s => s.id === id);

/** The tractor or truck a rig needs. */
export const rigTruck = (rig: FreightRig): FleetKind => (rig === 'dumptruck' ? 'dumptruck' : 'semi');

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function payFor(rig: FreightRig, distance: number): number {
  const truck = rig === 'dumptruck' ? 'dumptruck' : 'semi';
  return Math.round((FREIGHT_BASE_PAY[truck] + distance * FREIGHT_PAY_PER_M[truck]) / 5) * 5;
}

/** The board for the slot holding `timeMs`: the same loads for everyone, at least one of every rig. */
export function boardAt(timeMs: number): Load[] {
  const slot = Math.floor(timeMs / (BOARD_MINUTES * 60_000));
  const rnd = mulberry(slot * 2654435761);
  const out: Load[] = [];
  const types = [...LOAD_TYPES];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const t = i < types.length ? types[i] : types[Math.floor(rnd() * types.length)];
    const from = t.from[Math.floor(rnd() * t.from.length)];
    const to = t.to[Math.floor(rnd() * t.to.length)];
    const a = siteOf(from)!, b = siteOf(to)!;
    const distance = Math.round(Math.hypot(a.x - b.x, a.z - b.z));
    out.push({ id: `${slot}-${i}`, cargo: t.cargo, label: t.label, rig: t.rig, from, to, distance, pay: payFor(t.rig, distance), mass: t.mass });
  }
  return out;
}

/** A load id on the current or the previous board (so a load taken as the board turns over still counts). */
export function findLoad(id: string, timeMs: number): Load | null {
  for (const t of [timeMs, timeMs - BOARD_MINUTES * 60_000]) {
    const hit = boardAt(t).find(l => l.id === id);
    if (hit) return hit;
  }
  return null;
}

export const RIG_LABEL: Record<FreightRig, string> = {
  dumptruck: 'Dump truck',
  dryvan: 'Tractor + dry van',
  flatbed: 'Tractor + flatbed',
  logger: 'Tractor + log trailer',
  tanker: 'Tractor + tanker',
};
