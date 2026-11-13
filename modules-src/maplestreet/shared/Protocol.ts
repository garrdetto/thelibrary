/**
 * Wire protocol. Every message is a small JSON object tagged by `t`.
 * Clients send intents; the authority (Colyseus room or in-browser host)
 * validates, mutates world state, and broadcasts results.
 */
import type { BuildOp, WorldState } from './BuildRules';
import type { Account } from './Economy';
import type { Body, Look } from './Wardrobe';
import type { CarStyle } from './Cars';
import type { ServiceOrder } from './BodyShop';

export type { VehicleKind } from './Vehicles';
import type { VehicleKind } from './Vehicles';

export interface PlayerSnap {
  id: string;            // session id
  name: string;
  color: string;
  x: number; y: number; z: number;
  yaw: number;
  speed: number;         // drives walk-cycle on remotes
  vehicleId: string | null;
  /** Filled in by the authority from the account, so everyone sees your outfit. */
  look?: Look | null;
}

export interface VehicleSnap {
  id: string;
  owner: string;         // session id of simulating client
  kind: VehicleKind;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  steer: number;
  speed: number;
  hitchedTo: string | null;
  /** Filled in by the authority from the owner's account, so everyone sees the same paint. */
  style?: CarStyle | null;
}

/**
 * A vehicle an administrator spawned for anyone to drive (shared/DevTools.ts). It travels in snapshots as a
 * VehicleSnap whose `owner` is its driver's session id, or 'shared' while it is parked.
 */
export interface SharedVehicleInfo {
  id: string;
  kind: VehicleKind;
  /** Session id of whoever is driving it, or null while it is parked. */
  driver: string | null;
  /** Milliseconds until it disappears; 0 once its time is up and it is only waiting for its driver to get out. */
  left: number;
}

/** Where a spawned vehicle is put: its chassis centre and rotation, in world coordinates. */
export interface SpawnPose { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }

export interface Job {
  id: string;
  kind: 'delivery';
  pickup: { x: number; z: number };
  drop: { x: number; z: number; lotId: string };
  pay: number;
  stage: 'toPickup' | 'toDrop';
}

export interface MowStroke { lotId: string; x: number; z: number; hx: number; hz: number; width: number; len: number }

/** How often every mode writes the neighborhood (lots, houses, money, needs, fuel) to its save. */
export const AUTOSAVE_EVERY_MS = 5 * 60 * 1000;

export interface JoinOptions { key: string; name: string; color: string; body?: Body }

export type ClientMsg =
  | { t: 'hello'; opts: JoinOptions }
  /** `s`: the spawned vehicle this client is driving (only its driver's report is used). */
  | { t: 'state'; p: PlayerSnap; v: VehicleSnap[]; s?: VehicleSnap }
  | { t: 'build'; seq: number; op: BuildOp }
  | { t: 'builds'; seq: number; ops: BuildOp[] }
  | { t: 'loan'; amount: number }
  | { t: 'repay'; amount: number }
  | { t: 'mow'; strokes: MowStroke[] }
  | { t: 'jobRequest' }
  | { t: 'jobProgress'; jobId: string }
  | { t: 'buy'; shop: string; item: string; car?: CarStyle }
  | { t: 'refuel'; kind: VehicleKind; gallons: number }
  /** One of your cars hit something: horizontal speed change (m/s) and where on the chassis it was struck. */
  | { t: 'crash'; kind: VehicleKind; dv: number; at: { x: number; y: number; z: number } }
  /** Work on one of your cars, parked in a Maple Body & Wheel bay; the authority prices it. */
  | { t: 'service'; kind: VehicleKind; order: ServiceOrder }
  | { t: 'fuel'; levels: Partial<Record<VehicleKind, number>> }
  | { t: 'use'; lotId: string; objectId: string }
  | { t: 'look'; look: Look }
  /** Get into (claim) or out of (release) a spawned vehicle. The authority allows one driver at a time. */
  | { t: 'shared'; op: 'claim' | 'release'; id: string }
  /**
   * Developer tools, for administrators only (the authority checks the session, not this message): spawn a vehicle
   * beside a player (`to` is a session id, or 'me'), remove one, or give a player cash.
   */
  | { t: 'dev'; op: 'spawn'; kind: VehicleKind; to: string; at: SpawnPose }
  | { t: 'dev'; op: 'remove'; id: string }
  | { t: 'dev'; op: 'cash'; to: string; amount: number }
  | { t: 'bye' };

export type ServerMsg =
  /** `dev`: this session may use the world's developer tools. */
  | { t: 'welcome'; you: string; world: WorldState; account: Account; hours: number; day: number; mowed: Record<string, string>; dev?: boolean }
  | { t: 'snap'; time: number; hours: number; players: PlayerSnap[]; vehicles: VehicleSnap[] }
  | { t: 'build'; seq: number; by: string; actorId: string; actorName: string; op: BuildOp }
  | { t: 'buildRejected'; seq: number; reason: string }
  | { t: 'account'; account: Account; note?: string }
  | { t: 'mow'; by: string; strokes: MowStroke[] }
  | { t: 'job'; job: Job | null; note?: string }
  | { t: 'newDay'; day: number }
  | { t: 'left'; id: string }
  /** Every spawned vehicle, sent on arrival and whenever one is spawned, taken, left, removed or expires. */
  | { t: 'shared'; vehicles: SharedVehicleInfo[] }
  /** The answer to a `dev` message. */
  | { t: 'dev'; ok: boolean; text: string }
  | { t: 'toast'; text: string };
