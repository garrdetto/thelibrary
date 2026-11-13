/**
 * A world's developer tools (Fox Lake's F8 panel): vehicles an administrator
 * spawns for anyone to drive, and cash gifts. Off unless the authority is
 * started with `LogicOptions.devTools`, so classic Fox Plains never runs it.
 *
 * A spawned vehicle belongs to nobody and is in nobody's garage. The authority
 * keeps it in every snapshot like any other vehicle, and it alone decides who
 * is driving: one driver at a time, first to ask. The driver's client
 * simulates the car and reports its pose with `state.s`; when the driver gets
 * out (or leaves) it stays parked where it was. It is removed
 * SHARED_VEHICLE_TTL_MS after it was spawned, or as soon as it is empty when
 * someone is still sitting in it then.
 *
 * `dev` messages are checked against the session's host-verified
 * administrator flag, never against anything the client sends.
 */
import { VEHICLES } from './Economy';
import type { ClientMsg, PlayerSnap, ServerMsg, SharedVehicleInfo, VehicleKind, VehicleSnap } from './Protocol';
import { TUNING } from './Vehicles';

export const SHARED_VEHICLE_TTL_MS = 5 * 60 * 1000;
export const SHARED_VEHICLE_LIMIT = 12;
export const SHARED_VEHICLE_PREFIX = 'shared:';
/** `owner` of a parked spawned vehicle in snapshots; a driven one carries its driver's session id. */
export const SHARED_OWNER = 'shared';
/** A spawn has to land this close to the player it is for (metres). */
export const SPAWN_REACH = 30;
/** Getting in needs the player this close to the vehicle (metres). */
export const CLAIM_REACH = 12;
/** The most one cash gift can be. */
export const CASH_LIMIT = 1_000_000;

export const isSharedVehicleId = (id: unknown): id is string => typeof id === 'string' && id.startsWith(SHARED_VEHICLE_PREFIX);

/** A player who is in the world right now, as the authority knows them. */
export interface DevPlayer { id: string; key: string; name: string; x: number; y: number; z: number }

/** What the tools need from the authority (RoomLogic). */
export interface DevHost {
  send(sessionId: string, msg: ServerMsg): void;
  broadcast(msg: ServerMsg): void;
  /** Null for a session that is gone, was taken over by a newer connection or has not reported a position yet. */
  locate(sessionId: string): DevPlayer | null;
  /** Credits a player's money (RoomLogic.adjustMoney): the new balance, or null when it was refused. */
  pay(key: string, name: string, amount: number): number | null;
  /** Solo play: money never runs out, so there is nothing to give. */
  unlimitedMoney: boolean;
}

interface Shared {
  id: string; kind: VehicleKind; driver: string | null; expiresAt: number;
  x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; steer: number; speed: number;
}

type Result = [ok: boolean, text: string];

const num = (v: unknown, lo = -1e5, hi = 1e5) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export class DevTools {
  private vehicles = new Map<string, Shared>();
  private seq = 0;

  constructor(private host: DevHost, private now: () => number = () => Date.now()) {}

  get count() { return this.vehicles.size; }

  list(): SharedVehicleInfo[] {
    const now = this.now();
    return [...this.vehicles.values()].map(v => ({ id: v.id, kind: v.kind, driver: v.driver, left: Math.max(0, v.expiresAt - now) }));
  }

  /** The whole list, to one session or (after a change) to everyone. */
  private publish(to?: string) {
    const msg: ServerMsg = { t: 'shared', vehicles: this.list() };
    if (to) this.host.send(to, msg); else this.host.broadcast(msg);
  }

  /** A session joined: it needs the list before the first snapshot shows the vehicles. */
  greet(sessionId: string) { this.publish(sessionId); }

  private park(v: Shared) { v.driver = null; v.steer = 0; v.speed = 0; }

  /** A session left, or a newer connection took its place: what it was driving stays parked where it is. */
  dropped(sessionId: string) {
    let changed = false;
    for (const v of this.vehicles.values()) if (v.driver === sessionId) { this.park(v); changed = true; }
    if (changed) { this.sweep(); this.publish(); }
  }

  /**
   * From a `state` message: the pose of the spawned vehicle this session is driving, and its seat in the player's
   * snapshot (`seat` is the vehicle id the client says it sits in). A vehicle the session isn't driving is ignored.
   */
  driven(sessionId: string, player: PlayerSnap | null, seat: unknown, snap: unknown) {
    const s = snap && typeof snap === 'object' ? snap as Partial<VehicleSnap> : null;
    const v = s && typeof s.id === 'string' ? this.vehicles.get(s.id) : undefined;
    if (s && v && v.driver === sessionId) {
      v.x = num(s.x); v.y = num(s.y, -50, 500); v.z = num(s.z);
      v.qx = num(s.qx, -1, 1); v.qy = num(s.qy, -1, 1); v.qz = num(s.qz, -1, 1); v.qw = num(s.qw, -1, 1);
      v.steer = num(s.steer, -1, 1); v.speed = num(s.speed, -100, 100);
    }
    if (player && typeof seat === 'string' && this.vehicles.get(seat)?.driver === sessionId) player.vehicleId = seat;
  }

  /** `shared` messages, from anyone: get in (claim) or get out (release). */
  shared(sessionId: string, msg: Extract<ClientMsg, { t: 'shared' }>) {
    const v = typeof msg.id === 'string' ? this.vehicles.get(msg.id) : undefined;
    if (msg.op === 'release') {
      if (!v || v.driver !== sessionId) return;
      this.park(v);
      this.sweep();
      this.publish();
      return;
    }
    if (msg.op !== 'claim') return;
    // A refusal still answers with the list, so the asking client always learns how its request ended.
    const refuse = (text: string) => { this.host.send(sessionId, { t: 'toast', text }); this.publish(sessionId); };
    if (!v) return refuse('That vehicle is gone.');
    if (v.driver === sessionId) return this.publish(sessionId);
    if (v.driver) return refuse('Someone else is driving that one.');
    for (const other of this.vehicles.values()) if (other.driver === sessionId) return refuse('Get out of the other spawned vehicle first.');
    const who = this.host.locate(sessionId);
    if (!who || Math.hypot(who.x - v.x, who.z - v.z) > CLAIM_REACH) return refuse('Walk up to the vehicle first.');
    v.driver = sessionId;
    this.publish();
  }

  /** `dev` messages. `allowed` is the session's host-verified administrator flag. */
  admin(sessionId: string, allowed: boolean, msg: Extract<ClientMsg, { t: 'dev' }>) {
    let result: Result;
    if (!allowed) result = [false, 'The developer panel is for the administrator.'];
    else if (msg.op === 'spawn') result = this.spawn(sessionId, msg.kind, msg.to, msg.at);
    else if (msg.op === 'remove') result = this.remove(msg.id);
    else if (msg.op === 'cash') result = this.cash(sessionId, msg.to, msg.amount);
    else result = [false, 'Unknown developer action.'];
    this.host.send(sessionId, { t: 'dev', ok: result[0], text: result[1] });
  }

  private target(sessionId: string, to: unknown): DevPlayer | null {
    return typeof to === 'string' ? this.host.locate(to === 'me' ? sessionId : to) : null;
  }

  private spawn(sessionId: string, kind: unknown, to: unknown, at: unknown): Result {
    if (typeof kind !== 'string' || !VEHICLES[kind] || !TUNING[kind]) return [false, 'That vehicle is not registered in this world.'];
    const who = this.target(sessionId, to);
    if (!who) return [false, 'That player is not in the world right now.'];
    const { x, y, z, qx, qy, qz, qw } = (at && typeof at === 'object' ? at : {}) as Record<string, unknown>;
    if (!finite(x) || !finite(y) || !finite(z) || !finite(qx) || !finite(qy) || !finite(qz) || !finite(qw)) return [false, 'That spot is not valid.'];
    const turn = Math.hypot(qx, qy, qz, qw);
    if (turn < 1e-6) return [false, 'That spot is not valid.'];
    if (Math.hypot(x - who.x, z - who.z) > SPAWN_REACH) return [false, `That spot is too far from ${who.id === sessionId ? 'you' : who.name}.`];
    if (this.vehicles.size >= SHARED_VEHICLE_LIMIT) return [false, `Only ${SHARED_VEHICLE_LIMIT} spawned vehicles at a time. Remove one first.`];
    const id = `${SHARED_VEHICLE_PREFIX}${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.vehicles.set(id, {
      id, kind: kind as VehicleKind, driver: null, expiresAt: this.now() + SHARED_VEHICLE_TTL_MS,
      x: num(x), y: num(y, -50, 500), z: num(z), qx: qx / turn, qy: qy / turn, qz: qz / turn, qw: qw / turn, steer: 0, speed: 0,
    });
    this.publish();
    const name = VEHICLES[kind].name;
    const minutes = SHARED_VEHICLE_TTL_MS / 60000;
    if (who.id !== sessionId) this.host.send(who.id, { t: 'toast', text: `A ${name} was parked beside you. Anyone can drive it for the next ${minutes} minutes.` });
    return [true, `${name} spawned ${who.id === sessionId ? 'in front of you' : `beside ${who.name}`}. It disappears in ${minutes} minutes.`];
  }

  private remove(id: unknown): Result {
    const v = typeof id === 'string' ? this.vehicles.get(id) : undefined;
    if (!v) return [false, 'That vehicle is already gone.'];
    const name = VEHICLES[v.kind]?.name ?? 'vehicle';
    this.vehicles.delete(v.id);
    this.publish();
    if (v.driver) this.host.send(v.driver, { t: 'toast', text: `The ${name} you were driving was removed.` });
    return [true, `${name} removed.`];
  }

  private cash(sessionId: string, to: unknown, amount: unknown): Result {
    const who = this.target(sessionId, to);
    if (!who) return [false, 'That player is not in the world right now.'];
    const n = finite(amount) ? Math.floor(amount) : 0;
    if (n < 1 || n > CASH_LIMIT) return [false, `Enter a whole amount from $1 to ${dollars(CASH_LIMIT)}.`];
    if (this.host.unlimitedMoney) return [false, 'Solo: money is unlimited on this device, so there is nothing to give.'];
    const balance = this.host.pay(who.key, who.name, n);
    if (balance === null) return [false, `${who.name}'s wallet could not take that.`];
    const mine = who.id === sessionId;
    if (!mine) this.host.send(who.id, { t: 'toast', text: `${this.host.locate(sessionId)?.name ?? 'The administrator'} gave you ${dollars(n)}.` });
    if (mine) return [true, `${dollars(n)} added to your Fox Lake wallet. It now holds ${dollars(balance)}.`];
    if (who.key.startsWith('member:')) return [true, `${dollars(n)} given to ${who.name}. Their Fox Lake wallet now holds ${dollars(balance)}.`];
    return [true, `${dollars(n)} added to ${who.name}'s town cash (now ${dollars(balance)}). They are a guest: it is kept under their browser's guest key, and their lake cash stays in their own tab and was not changed.`];
  }

  /** Removes vehicles whose time is up and that nobody is sitting in. True when any went. */
  private sweep(): boolean {
    const now = this.now();
    let removed = false;
    for (const [id, v] of this.vehicles) if (!v.driver && now >= v.expiresAt) { this.vehicles.delete(id); removed = true; }
    return removed;
  }

  tick() { if (this.vehicles.size && this.sweep()) this.publish(); }

  /** Adds every spawned vehicle to a snapshot's vehicles. */
  snapshots(out: VehicleSnap[]) {
    for (const v of this.vehicles.values()) {
      out.push({ id: v.id, owner: v.driver ?? SHARED_OWNER, kind: v.kind, x: v.x, y: v.y, z: v.z, qx: v.qx, qy: v.qy, qz: v.qz, qw: v.qw, steer: v.steer, speed: v.speed, hitchedTo: null, style: null });
    }
  }
}
