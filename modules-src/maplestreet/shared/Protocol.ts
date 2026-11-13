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
import type { FreightJob } from './Freight';
import type { FoxHome, HomeOp } from './HoodHomes';

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
  | { t: 'state'; p: PlayerSnap; v: VehicleSnap[] }
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
  /** Fox Lake freight: take a load off the dispatch board, load it at its pickup, deliver it, or give it up. */
  | { t: 'freight'; a: 'take'; load: string }
  | { t: 'freight'; a: 'load' | 'deliver' | 'cancel' }
  /** Fox Lake: one step of The Hood's home builder on your own lot (`start` turns the lot's house into a Hood home). */
  | { t: 'home'; seq: number; lotId: string; op: HomeOp }
  | { t: 'bye' };

export type ServerMsg =
  | { t: 'welcome'; you: string; world: WorldState; account: Account; hours: number; day: number; mowed: Record<string, string> }
  | { t: 'snap'; time: number; hours: number; players: PlayerSnap[]; vehicles: VehicleSnap[] }
  | { t: 'build'; seq: number; by: string; actorId: string; actorName: string; op: BuildOp }
  | { t: 'buildRejected'; seq: number; reason: string }
  | { t: 'account'; account: Account; note?: string }
  | { t: 'mow'; by: string; strokes: MowStroke[] }
  | { t: 'job'; job: Job | null; note?: string }
  | { t: 'freight'; job: FreightJob | null; note?: string; paid?: number }
  | { t: 'home'; seq: number; by: string; lotId: string; home: FoxHome; cost: number }
  | { t: 'homeRejected'; seq: number; lotId: string; reason: string }
  | { t: 'newDay'; day: number }
  | { t: 'left'; id: string }
  | { t: 'toast'; text: string };
