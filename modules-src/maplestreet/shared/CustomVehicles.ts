/**
 * Admin-published vehicles. The vehicle editor (src/components/maplestreet/)
 * uploads a .glb plus this record; /api/maplestreet-vehicles keeps the model
 * in KV and the record in D1. Every authority (the shared-world Durable
 * Object, solo and PeerJS hosts) and every client registers the same records
 * here before accounts and worlds load, so garages, the dealer, fuel and NPC
 * traffic accept `custom:<uuid>` kinds exactly like built-in ones.
 *
 * The model is drawn inside the chassis frame (x forward, y up, z right,
 * origin at the physics body's center): rotate by `model.yaw` (degrees) >
 * scale by `model.scale` > translate by `model.x/y/z`.
 */
import { isAssetStatus, type AssetStatus } from './Assets';
import { BUNDLED_VEHICLES } from './BundledVehicles';
import { refreshDealer, VEHICLES, type VehicleSpec } from './Economy';
import { isValidLampShapes, isValidShape, type LampShapes, type Shape } from './Shapes';
import type { VehicleGlass } from './VehicleGlass';
import { CUSTOM_VEHICLE_PREFIX, TUNING, type AxleTuning, type CustomVehicleKind, type VehicleTuning } from './Vehicles';

export const DRIVE_TEMPLATES = ['sedan', 'truck', 'coupe', 'hdtruck', 'golfcart', 'atv'] as const;
export type DriveTemplate = (typeof DRIVE_TEMPLATES)[number];
export const TRAFFIC_ROUTES = ['ringA', 'ringB', 'downtown'] as const;
export type TrafficRoute = (typeof TRAFFIC_ROUTES)[number];

export const VEHICLE_LIMITS = {
  nameMin: 2,
  nameMax: 40,
  priceMax: 500_000,
  lengthMin: 0.8,
  lengthMax: 8,
  widthMax: 3,
  massMin: 80,
  massMax: 6000,
  wheelRadiusMin: 0.08,
  wheelRadiusMax: 0.7,
  axlesMax: 3,
  lightsMax: 4,
  topSpeedMphMax: 200,
  modelBytes: 15 * 1024 * 1024,
  wheelBytes: 3 * 1024 * 1024,
  /** The HD texture pack; Workers KV values stop at 25 MiB. */
  hdBytes: 24 * 1024 * 1024,
  trianglesDefault: 150_000,
  trianglesMax: 300_000,
  /** Longest texture side in the base model, which loads first. */
  baseTexture: 1024,
  /** Longest texture side in the HD pack. */
  hdTexture: 4096,
} as const;

/**
 * Vehicles in the game are original designs (AGENTS.md); names that carry a
 * real manufacturer or model badge are refused by the server and flagged in
 * the editor.
 */
export const BRAND_PATTERN = /\b(ford|chevy|chevrolet|gmc|dodge|jeep|chrysler|cadillac|buick|tesla|toyota|lexus|honda|acura|nissan|infiniti|mazda|subaru|mitsubishi|hyundai|kia|volkswagen|vw|audi|porsche|bmw|mercedes|benz|volvo|polestar|land ?rover|range ?rover|ferrari|lamborghini|maserati|alfa ?romeo|fiat|bugatti|bentley|rolls-?royce|mclaren|aston ?martin|rivian|corvette|mustang|camaro|silverado|f-?150|tacoma|wrangler|bronco|prius|civic|polaris|can-?am|yamaha|kawasaki|suzuki|club ?car|ez-?go|john ?deere|kubota|cub ?cadet|husqvarna)\b/i;

export interface Point3 { x: number; y: number; z: number }

export interface CustomVehiclePhysics {
  chassis: { hx: number; hy: number; hz: number };
  mass: number;
  comY: number;
  axles: AxleTuning[];
  wheelY: number;
  suspension: { rest: number; travel: number; stiffness: number; compression: number; relaxation: number };
  frictionSlip: number;
  sideStiffness: number;
  engineForce: number;
  topSpeed: number;
  brake: number;
  maxSteer: number;
  seat: { x: number; y: number; z: number; straddle?: boolean };
  hitch: { x: number; y: number } | null;
  cam: { dist: number; height: number };
}

/**
 * Opening parts of a published model, marked in the editor as boxes in chassis
 * space (+x forward, +y up, metres). Doors are given for the right side and
 * mirrored to the left; each is hinged at its front edge. The hood is hinged
 * at its back edge (by the windshield), the trunk or tailgate at its front edge.
 * At load the model's triangles inside each box are cut out into a swinging leaf.
 */
export interface PartBox {
  /** Custom outline inside the box (see Shapes.ts); the whole box when missing. */
  shape?: Shape;
  front: number; back: number; bottom: number; top: number;
  /** Trunk only: a pickup tailgate that folds down from its bottom edge instead of lifting. */
  drop?: boolean;
}
export interface VehicleParts { doors: PartBox[]; hood: PartBox | null; trunk: PartBox | null }
export const MAX_DOOR_ROWS = 2;

const partBox = (b: unknown): b is PartBox => {
  const o = b as PartBox;
  return !!o && typeof o === 'object' && [o.front, o.back, o.bottom, o.top].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10) && o.front > o.back && o.top > o.bottom && (o.drop === undefined || typeof o.drop === 'boolean') && (o.shape === undefined || isValidShape(o.shape));
};
export const isValidParts = (p: unknown): p is VehicleParts => {
  const o = p as VehicleParts;
  return !!o && typeof o === 'object' && Array.isArray(o.doors) && o.doors.length <= MAX_DOOR_ROWS && o.doors.every(partBox)
    && (o.hood === null || partBox(o.hood)) && (o.trunk === null || partBox(o.trunk));
};

export interface CustomVehicleSpec {
  template: DriveTemplate;
  model: { scale: number; yaw: number; x: number; y: number; z: number };
  physics: CustomVehiclePhysics;
  /** Lamp positions on the right side (+z); each is mirrored to the left. */
  lights: { head: Point3[]; tail: Point3[] };
  /**
   * Which part of the model takes the vehicle's paint color: a named
   * material, or every texel close to a picked key color.
   */
  paint: { mode: 'none' | 'material' | 'color'; material: string; key: string; tolerance: number; color: string };
  /** Targets the engine numbers were solved for (what the test drive checks). */
  targets: { topSpeedMph: number; zeroToMph: number; zeroToSeconds: number };
  dealer: { forSale: boolean; price: number; fuel: 'gas' | 'electric'; tank: number; mpg: number };
  /**
   * Neighbor traffic. `count` puts several of them on the road (default 1);
   * driver n takes `routes[n]` (else `route`) and paint `colors[n]` (else the
   * vehicle color), so one model can drive around town in different colors.
   */
  traffic: { enabled: boolean; driver: string; route: TrafficRoute; mph: number; count?: number; routes?: TrafficRoute[]; colors?: string[] };
  /** The editor removed the model's baked-in wheels before upload. */
  wheelsRemoved: boolean;
  /** Doors, hood and trunk that open (missing on vehicles published before they existed). */
  parts?: VehicleParts;
  /** Custom headlight and taillight outlines, mirrored to both sides. */
  lampShapes?: LampShapes;
  /**
   * Windows traced by the administrator in Fox Lake's developer panel (VehicleGlass.ts): which triangles of the
   * scanned body are glass, used instead of the automatic detection. Dropped when a new model is saved.
   */
  glass?: VehicleGlass;
}

/** The public shape returned by GET /api/maplestreet-vehicles. */
export interface CustomVehicleRecord extends CustomVehicleSpec {
  id: string;
  name: string;
  modelUrl: string;
  wheelUrl: string | null;
  /**
   * The HD pack: a tiny .glb whose materials carry this model's textures at
   * full resolution, matched to the model's materials by name. Games load the
   * model first and swap these in when the vehicle is close. Missing on older
   * records and on vehicles whose textures already fit the base model.
   */
  hdUrl?: string | null;
  active: boolean;
  /** Missing on records cached before drafts existed: those were all published or retired. */
  status?: AssetStatus;
  updatedAt: number;
}

export const customVehicleKind = (id: string): CustomVehicleKind => `${CUSTOM_VEHICLE_PREFIX}${id}`;

/** Published vehicles with traffic turned on, in id order so every host builds the same traffic. */
export const CUSTOM_TRAFFIC: { kind: CustomVehicleKind; id: string; n: number; count: number; driver: string; route: TrafficRoute; speed: number; paint?: string }[] = [];
export const TRAFFIC_COUNT_MAX = 8;
const HEX = /^#[0-9a-f]{6}$/i;
/** Bumped on every registration so long-running hosts can pick up traffic changes. */
export let customVehiclesVersion = 0;

const RECORDS = new Map<string, CustomVehicleRecord>();
export const customVehicleRecord = (kind: string) => RECORDS.get(kind);

/** Swaps the traced windows of a registered record on this page (after the administrator saved them); null removes them. */
export function setCustomVehicleGlass(kind: string, glass: VehicleGlass | null): boolean {
  const r = RECORDS.get(kind);
  if (!r) return false;
  const next: CustomVehicleRecord = { ...r };
  if (glass) next.glass = glass; else delete next.glass;
  RECORDS.set(kind, next);
  return true;
}

export function tuningFromRecord(r: CustomVehicleRecord): VehicleTuning {
  const p = r.physics;
  return {
    kind: customVehicleKind(r.id),
    label: r.name,
    chassis: { ...p.chassis },
    mass: p.mass,
    comY: p.comY,
    axles: p.axles.map(a => ({ ...a })),
    wheelY: p.wheelY,
    suspension: { ...p.suspension },
    frictionSlip: p.frictionSlip,
    sideStiffness: p.sideStiffness,
    engineForce: p.engineForce,
    topSpeed: p.topSpeed,
    brake: p.brake,
    maxSteer: p.maxSteer,
    seat: { ...p.seat },
    ...(p.hitch ? { hitch: { ...p.hitch } } : {}),
    cam: { ...p.cam },
    paint: parseInt(r.paint.color.slice(1), 16) || 0x888888,
    ...(r.template === 'truck' || r.template === 'hdtruck' ? { role: 'hauler' as const } : {}),
  };
}

function specFromRecord(r: CustomVehicleRecord): VehicleSpec {
  return {
    kind: customVehicleKind(r.id),
    name: r.name,
    price: r.dealer.price,
    tank: r.dealer.tank,
    mpg: r.dealer.mpg,
    fuel: r.dealer.fuel,
    forSale: r.active && r.dealer.forSale && r.dealer.price > 0,
    paintable: r.paint.mode !== 'none',
  };
}

/**
 * Adds or refreshes published vehicles, plus the bundled ones that ship with
 * the game (shared/BundledVehicles.ts; a published record with the same id
 * wins). Records that disappear (or are retired) stay registered but leave
 * the dealer and traffic, so players who own one keep driving it.
 */
export function registerCustomVehicles(records: readonly CustomVehicleRecord[]): CustomVehicleRecord[] {
  const added: CustomVehicleRecord[] = [];
  const seen = new Set<string>();
  const ids = new Set(records.map(r => r?.id));
  for (const r of [...BUNDLED_VEHICLES.filter(b => !ids.has(b.id)), ...records]) {
    if (!isValidVehicleRecord(r)) continue;
    const kind = customVehicleKind(r.id);
    RECORDS.set(kind, r);
    TUNING[kind] = tuningFromRecord(r);
    VEHICLES[kind] = specFromRecord(r);
    seen.add(kind);
    added.push(r);
  }
  for (const [kind, r] of RECORDS) if (!seen.has(kind)) VEHICLES[kind] = { ...specFromRecord(r), forSale: false };
  CUSTOM_TRAFFIC.length = 0;
  for (const r of [...added].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!r.active || !r.traffic.enabled) continue;
    const t = r.traffic;
    const count = Math.max(1, Math.min(TRAFFIC_COUNT_MAX, Math.floor(Number(t.count) || 1)));
    for (let n = 0; n < count; n++) {
      const route = Array.isArray(t.routes) && (TRAFFIC_ROUTES as readonly string[]).includes(t.routes[n]) ? t.routes[n] : t.route;
      const paint = Array.isArray(t.colors) && typeof t.colors[n] === 'string' && HEX.test(t.colors[n]) ? t.colors[n].toLowerCase() : undefined;
      CUSTOM_TRAFFIC.push({ kind: customVehicleKind(r.id), id: r.id, n, count, driver: t.driver || r.name, route, speed: t.mph * 0.44704, ...(paint ? { paint } : {}) });
    }
  }
  refreshDealer();
  customVehiclesVersion++;
  return added;
}

const finite = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const point = (p: unknown, lim = 10) => !!p && typeof p === 'object' && finite((p as Point3).x, -lim, lim) && finite((p as Point3).y, -lim, lim) && finite((p as Point3).z, -lim, lim);

/** Light structural check for records read from the network or a cache (the server validates fully with Zod). */
export function isValidVehicleRecord(r: unknown): r is CustomVehicleRecord {
  if (!r || typeof r !== 'object') return false;
  const o = r as CustomVehicleRecord;
  const p = o.physics;
  return typeof o.id === 'string' && /^[a-z0-9-]{8,64}$/.test(o.id)
    && typeof o.name === 'string' && o.name.length >= 1 && o.name.length <= VEHICLE_LIMITS.nameMax
    && typeof o.modelUrl === 'string' && o.modelUrl.length < 512
    && (o.wheelUrl === null || (typeof o.wheelUrl === 'string' && o.wheelUrl.length < 512))
    && (o.hdUrl === undefined || o.hdUrl === null || (typeof o.hdUrl === 'string' && o.hdUrl.length < 512))
    && typeof o.active === 'boolean'
    && (o.status === undefined || isAssetStatus(o.status))
    && (DRIVE_TEMPLATES as readonly string[]).includes(o.template)
    && !!o.model && finite(o.model.scale, 0.0001, 10000) && finite(o.model.yaw, -360, 360) && point(o.model, 50)
    && !!p && !!p.chassis && finite(p.chassis.hx, 0.2, 5) && finite(p.chassis.hy, 0.05, 2) && finite(p.chassis.hz, 0.2, 2)
    && finite(p.mass, VEHICLE_LIMITS.massMin, VEHICLE_LIMITS.massMax) && finite(p.comY, -3, 1)
    && Array.isArray(p.axles) && p.axles.length >= 2 && p.axles.length <= VEHICLE_LIMITS.axlesMax
    && p.axles.every(a => finite(a.x, -5, 5) && finite(a.radius, VEHICLE_LIMITS.wheelRadiusMin, VEHICLE_LIMITS.wheelRadiusMax) && finite(a.width, 0.05, 1) && finite(a.halfTrack, 0.2, 1.6) && typeof a.steer === 'boolean' && typeof a.drive === 'boolean')
    && p.axles.some(a => a.drive) && p.axles.some(a => a.steer)
    && finite(p.wheelY, -2, 2) && !!p.suspension && finite(p.suspension.rest, 0.05, 1.5) && finite(p.suspension.stiffness, 5, 120)
    && finite(p.engineForce, 1, 200_000) && finite(p.topSpeed, 0.5, 200) && finite(p.brake, 1, 1000) && finite(p.maxSteer, 0.1, 1.2)
    && point(p.seat) && (p.hitch === null || (finite(p.hitch.x, -6, 0) && finite(p.hitch.y, -2, 2)))
    && !!o.lights && Array.isArray(o.lights.head) && Array.isArray(o.lights.tail) && o.lights.head.length <= VEHICLE_LIMITS.lightsMax && o.lights.tail.length <= VEHICLE_LIMITS.lightsMax && [...o.lights.head, ...o.lights.tail].every(l => point(l))
    && !!o.paint && ['none', 'material', 'color'].includes(o.paint.mode) && /^#[0-9a-f]{6}$/i.test(o.paint.color)
    && !!o.dealer && typeof o.dealer.forSale === 'boolean' && finite(o.dealer.price, 0, VEHICLE_LIMITS.priceMax) && ['gas', 'electric'].includes(o.dealer.fuel) && finite(o.dealer.tank, 0.5, 200) && finite(o.dealer.mpg, 1, 500)
    && !!o.traffic && typeof o.traffic.enabled === 'boolean' && (TRAFFIC_ROUTES as readonly string[]).includes(o.traffic.route) && finite(o.traffic.mph, 3, 60)
    && (o.parts === undefined || isValidParts(o.parts))
    && (o.lampShapes === undefined || isValidLampShapes(o.lampShapes));
}
