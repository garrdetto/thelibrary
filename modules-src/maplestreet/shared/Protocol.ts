/**
 * Wire protocol. Every message is a small JSON object tagged by `t`.
 * Clients send intents; the authority (Colyseus room or in-browser host)
 * validates, mutates world state, and broadcasts results.
 */
import type { BuildOp, WorldState } from './BuildRules';
import type { Account } from './Economy';

export type VehicleKind = 'truck' | 'sedan' | 'golfcart' | 'atv' | 'mower' | 'trailer';

export interface PlayerSnap {
  id: string;            // session id
  name: string;
  color: string;
  x: number; y: number; z: number;
  yaw: number;
  speed: number;         // drives walk-cycle on remotes
  vehicleId: string | null;
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

export interface JoinOptions { key: string; name: string; color: string }

export type ClientMsg =
  | { t: 'hello'; opts: JoinOptions }
  | { t: 'state'; p: PlayerSnap; v: VehicleSnap[] }
  | { t: 'build'; seq: number; op: BuildOp }
  | { t: 'loan'; amount: number }
  | { t: 'repay'; amount: number }
  | { t: 'mow'; strokes: MowStroke[] }
  | { t: 'jobRequest' }
  | { t: 'jobProgress'; jobId: string }
  | { t: 'bye' };

export type ServerMsg =
  | { t: 'welcome'; you: string; world: WorldState; account: Account; hours: number; day: number; mowed: Record<string, string> }
  | { t: 'snap'; time: number; hours: number; players: PlayerSnap[]; vehicles: VehicleSnap[] }
  | { t: 'build'; seq: number; by: string; actorId: string; actorName: string; op: BuildOp }
  | { t: 'buildRejected'; seq: number; reason: string }
  | { t: 'account'; account: Account; note?: string }
  | { t: 'mow'; by: string; strokes: MowStroke[] }
  | { t: 'job'; job: Job | null; note?: string }
  | { t: 'newDay'; day: number }
  | { t: 'left'; id: string }
  | { t: 'toast'; text: string };
