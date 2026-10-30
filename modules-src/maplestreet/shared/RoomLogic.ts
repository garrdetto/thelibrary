/**
 * NeighborhoodLogic — the single source of truth for a neighborhood.
 *
 * Transport-agnostic: the persistent world (WorldServer, run by a Cloudflare
 * Durable Object), the in-browser hosts (offline, tabs, PeerJS rooms) and the
 * optional Colyseus room all wrap this class and just forward messages in and
 * out. That keeps "can't wreck your neighbor's house", money, loans and
 * payouts enforced in one place.
 */
import { applyOp, emptyBuild, levelBase, makeWorld, normalizeBuild, opCost, own, validateOp, WorldState } from './BuildRules';
import { CATALOG, footprint } from './Catalog';
import { Account, availableCredit, clampNeed, DELIVERY_BASE_PAY, DELIVERY_PAY_PER_M, FUEL_PRICE, LOAN_DAILY_RATE, MOW_PAY_PER_M2, NEED_DECAY_PER_MIN, Needs, newAccount, normalizeAccount, SHOP_ITEMS, VEHICLES } from './Economy';
import { seedNeighborhood } from './Seed';
import { decodeCoverage, encodeCoverage, strokeCells, stripeShade } from './Mowing';
import type { ClientMsg, Job, JoinOptions, MowStroke, PlayerSnap, ServerMsg, VehicleKind, VehicleSnap } from './Protocol';
import { DEPOT, GAS_STATION, makeLots, PUMP_RADIUS, SHOP_DOORS, SHOP_RADIUS } from './WorldLayout';

export interface LogicIO {
  send(sessionId: string, msg: ServerMsg): void;
  broadcast(msg: ServerMsg, exceptSessionId?: string): void;
}

export interface Persisted {
  world: WorldState;
  accounts: Record<string, Account>;
  hours: number;
  day: number;
  coverage: Record<string, string>;
  /** Wall-clock mode: the day index (since 1970) that counts as day 1. */
  epochDay?: number;
}

/** Server-verified identity (persistent world). Overrides what the client claims. */
export interface Identity { key: string; name: string; member: boolean }

export interface LogicOptions {
  /**
   * 'sim': the clock advances only while ticked (offline/hosted modes).
   * 'wall': time of day comes from the real clock, so a persistent world that
   * sleeps while empty wakes up at the right hour.
   */
  clock?: 'sim' | 'wall';
}

const KINDS = Object.keys(VEHICLES) as VehicleKind[];
const USE_COOLDOWN_MS = 20_000;
const MAX_OPS_PER_MSG = 240;
const num = (v: unknown, lo = -1e5, hi = 1e5) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

interface Session {
  key: string;
  player: PlayerSnap | null;
  vehicles: VehicleSnap[];
  job: Job | null;
  lastSeen: number;
}

export const DAY_LENGTH_SEC = 24 * 60;   // one in-game day = 24 real minutes
const SNAP_HZ = 15;

export class NeighborhoodLogic {
  world: WorldState;
  accounts: Record<string, Account>;
  hours: number;
  day: number;
  epochDay: number;
  private coverage = new Map<string, Uint8Array>();
  private sessions = new Map<string, Session>();
  private snapAcc = 0;
  private readonly wallClock: boolean;
  /** Persistence hints for the persistent world: what changed since the last save. */
  readonly dirty = { lots: new Set<string>(), accounts: new Set<string>(), meta: false };

  constructor(private io: LogicIO, saved?: Persisted | null, opts: LogicOptions = {}) {
    if (saved?.world) {
      this.world = saved.world;
      for (const id in this.world.builds) normalizeBuild(this.world.builds[id]);
      // Lots added to the layout after this world was saved become available too.
      for (const l of makeLots()) {
        if (this.world.lots[l.id]) continue;
        this.world.lots[l.id] = { ...l, owner: null, ownerName: null };
        this.world.builds[l.id] = emptyBuild();
        this.dirty.lots.add(l.id);
      }
    } else {
      this.world = makeWorld(makeLots());
      seedNeighborhood(this.world);
      for (const id in this.world.lots) this.dirty.lots.add(id);
      this.dirty.meta = true;
    }
    this.wallClock = opts.clock === 'wall';
    this.accounts = saved?.accounts ?? {};
    for (const k in this.accounts) normalizeAccount(this.accounts[k]);
    this.epochDay = saved?.epochDay ?? Math.floor(Date.now() / 1000 / DAY_LENGTH_SEC);
    this.hours = this.wallClock ? this.wallHours() : saved?.hours ?? 8.5;
    this.day = this.wallClock ? this.wallDay() : saved?.day ?? 1;
    for (const id in this.world.lots) {
      const l = this.world.lots[id];
      const n = l.w * l.d;
      this.coverage.set(id, saved?.coverage?.[id] ? decodeCoverage(saved.coverage[id], n) : new Uint8Array(n));
    }
  }

  private wallHours() { return (((Date.now() / 1000) % DAY_LENGTH_SEC) / DAY_LENGTH_SEC) * 24; }
  private wallDay() { return Math.floor(Date.now() / 1000 / DAY_LENGTH_SEC) - this.epochDay + 1; }

  /** The owner's own view of an account: never includes the identity key. */
  private publicAccount(acc: Account): Account { return { ...acc, key: '' }; }
  private sendAccount(sessionId: string, acc: Account, note?: string) {
    this.dirty.accounts.add(acc.key);
    this.io.send(sessionId, { t: 'account', account: this.publicAccount(acc), note });
  }

  // ------------------------------------------------------------ lifecycle

  join(sessionId: string, opts: JoinOptions, identity?: Identity): void {
    const key = identity?.key ?? (String(opts?.key ?? '').slice(0, 96) || sessionId);
    const name = (identity?.name ?? String(opts?.name ?? 'Neighbor')).replace(/[<>&"]/g, '').slice(0, 24) || 'Neighbor';
    const color = /^#[0-9a-f]{6}$/i.test(opts?.color ?? '') ? opts.color : '#3a7bd5';
    let acc = this.accounts[key];
    const returning = !!acc;
    if (!acc) acc = this.accounts[key] = newAccount(Math.random().toString(36).slice(2, 12), key, name, color);
    acc.name = name; acc.color = color;
    this.dirty.accounts.add(key);
    // Keep the owner name on their lot current (members can be renamed by the admin).
    for (const id in this.world.lots) {
      const lot = this.world.lots[id];
      if (lot.owner === acc.id && lot.ownerName !== name) { lot.ownerName = name; this.dirty.lots.add(id); }
    }
    this.sessions.set(sessionId, { key, player: null, vehicles: [], job: null, lastSeen: Date.now() });

    const mowed: Record<string, string> = {};
    this.coverage.forEach((c, id) => (mowed[id] = encodeCoverage(c)));
    this.io.send(sessionId, { t: 'welcome', you: sessionId, world: this.world, account: this.publicAccount(acc), hours: this.hours, day: this.day, mowed });
    this.io.broadcast({ t: 'toast', text: returning ? `${name} is back on Maple Street` : `${name} moved into the neighborhood` }, sessionId);
  }

  /** Accounts the persistent world loads lazily from storage before a join. */
  hasAccount(key: string) { return !!this.accounts[key]; }
  addAccount(acc: Account) { this.accounts[acc.key] = normalizeAccount(acc); }
  get sessionCount() { return this.sessions.size; }

  leave(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.dirty.accounts.add(s.key);
    this.sessions.delete(sessionId);
    this.io.broadcast({ t: 'left', id: sessionId });
  }

  /** Drop sessions that stopped sending state (used by the local host). */
  reap(timeoutMs: number, keep?: string): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (id !== keep && now - s.lastSeen > timeoutMs) this.leave(id);
  }

  hasSession(id: string) { return this.sessions.has(id); }

  /** Marks everyone in town for the next save, so needs that drift while playing are kept too. */
  touchPresentAccounts(): void {
    this.sessions.forEach(s => this.dirty.accounts.add(s.key));
    this.dirty.meta = true;
  }

  // ------------------------------------------------------------ messages

  message(sessionId: string, msg: ClientMsg): void {
    const s = this.sessions.get(sessionId);
    if (!s || !msg || typeof msg !== 'object') return;
    s.lastSeen = Date.now();
    const acc = this.accounts[s.key];

    switch (msg.t) {
      case 'state': {
        // Rebuild snapshots field by field: only finite numbers and known kinds reach other players.
        const p = msg.p;
        if (p && typeof p === 'object') {
          s.player = {
            id: sessionId, name: acc.name, color: acc.color,
            x: num(p.x), y: num(p.y, -50, 500), z: num(p.z), yaw: num(p.yaw, -10, 10), speed: num(p.speed, 0, 20),
            vehicleId: typeof p.vehicleId === 'string' ? `${sessionId}:${p.vehicleId.split(':').pop()!.slice(0, 12)}` : null,
          };
        }
        s.vehicles = (Array.isArray(msg.v) ? msg.v.slice(0, 3) : [])
          .filter(v => v && KINDS.includes(v.kind))
          .map(v => ({
            id: `${sessionId}:${String(v.id).split(':').pop()!.slice(0, 12)}`, owner: sessionId, kind: v.kind,
            x: num(v.x), y: num(v.y, -50, 500), z: num(v.z), qx: num(v.qx, -1, 1), qy: num(v.qy, -1, 1), qz: num(v.qz, -1, 1), qw: num(v.qw, -1, 1),
            steer: num(v.steer, -1, 1), speed: num(v.speed, -100, 100),
            hitchedTo: typeof v.hitchedTo === 'string' ? `${sessionId}:${v.hitchedTo.split(':').pop()!.slice(0, 12)}` : null,
          }));
        break;
      }
      case 'build': this.handleBuild(sessionId, acc, msg.seq, [msg.op]); break;
      case 'builds': this.handleBuild(sessionId, acc, msg.seq, msg.ops); break;
      case 'loan': {
        const amt = Math.floor(Number(msg.amount));
        const avail = availableCredit(acc);
        if (!(amt > 0)) return;
        if (amt > avail) return this.sendAccount(sessionId, acc, `Loan declined — your available credit is $${avail.toLocaleString()}`);
        acc.debt += amt; acc.money += amt;
        this.sendAccount(sessionId, acc, `Approved: $${amt.toLocaleString()} deposited`);
        break;
      }
      case 'repay': {
        const amt = Math.min(Math.floor(Number(msg.amount)), acc.debt, acc.money);
        if (!(amt > 0)) return;
        acc.debt -= amt; acc.money -= amt;
        this.sendAccount(sessionId, acc, `Repaid $${amt.toLocaleString()}`);
        break;
      }
      case 'mow': this.handleMow(sessionId, s, acc, msg.strokes); break;
      case 'jobRequest': this.issueJob(sessionId, s); break;
      case 'jobProgress': this.progressJob(sessionId, s, acc, msg.jobId); break;
      case 'buy': this.handleBuy(sessionId, s, acc, msg.shop, msg.item); break;
      case 'refuel': this.handleRefuel(sessionId, s, acc, msg.kind, msg.gallons); break;
      case 'fuel': {
        // Clients report fuel burned; levels may only go down here (refuelling goes through the pump).
        if (!msg.levels || typeof msg.levels !== 'object') break;
        for (const k of acc.garage) {
          const v = msg.levels[k];
          if (typeof v === 'number' && Number.isFinite(v)) acc.fuel[k] = Math.max(0, Math.min(acc.fuel[k] ?? 0, v));
        }
        this.dirty.accounts.add(acc.key);
        break;
      }
      case 'use': this.handleUse(sessionId, s, acc, msg.lotId, msg.objectId); break;
      case 'bye': this.leave(sessionId); break;
    }
  }

  /**
   * One build gesture (a room = walls + floor, an undo, a whole-room paint job)
   * arrives as a list and is applied in order; the first op that fails stops
   * the rest and is reported, so nothing after it half-applies.
   */
  private handleBuild(sessionId: string, acc: Account, seq: unknown, ops: unknown) {
    const n = typeof seq === 'number' && Number.isFinite(seq) ? seq : 0;
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_OPS_PER_MSG) return this.io.send(sessionId, { t: 'buildRejected', seq: n, reason: 'Invalid request' });
    for (const op of ops) {
      if (!op || typeof op !== 'object') return this.io.send(sessionId, { t: 'buildRejected', seq: n, reason: 'Invalid request' });
      const reason = validateOp(this.world, op, acc.id);
      if (reason) return this.io.send(sessionId, { t: 'buildRejected', seq: n, reason });
      const cost = opCost(this.world, op);
      if (cost > acc.money) return this.io.send(sessionId, { t: 'buildRejected', seq: n, reason: `Not enough money ($${cost.toLocaleString()} needed)` });
      applyOp(this.world, op, acc.id, acc.name);
      acc.money -= cost;
      this.dirty.lots.add((op as { lotId: string }).lotId);
      this.io.broadcast({ t: 'build', seq: n, by: sessionId, actorId: acc.id, actorName: acc.name, op });
    }
    this.sendAccount(sessionId, acc);
  }

  private handleMow(sessionId: string, s: Session, acc: Account, strokes: unknown) {
    if (!Array.isArray(strokes)) return;
    const mower = s.vehicles.find(v => (v.kind === 'mower' || v.kind === 'zeroturn') && s.player?.vehicleId === v.id);
    if (!mower || s.player?.vehicleId !== mower.id) return;     // must be driving a mower
    const accepted: MowStroke[] = [];
    let paidCells = 0;
    for (const st of strokes.slice(0, 20)) {
      if (!st || typeof st !== 'object' || ![st.x, st.z, st.hx, st.hz, st.width, st.len].every(v => typeof v === 'number' && Number.isFinite(v))) continue;
      if (!own(this.world.lots, st.lotId)) continue;
      const lot = this.world.lots[st.lotId];
      if (!lot || !(st.width > 0 && st.width <= 1.5 && st.len > 0 && st.len <= 3)) continue;
      if (Math.hypot(st.x - mower.x, st.z - mower.z) > 6) continue;  // anti-teleport
      const cov = this.coverage.get(lot.id)!;
      const shade = stripeShade(st.hx, st.hz);
      for (const idx of strokeCells(lot, st)) {
        if (cov[idx] === 0 && lot.owner !== acc.id) paidCells++;
        cov[idx] = shade;
      }
      accepted.push(st);
    }
    if (!accepted.length) return;
    this.dirty.meta = true;
    this.io.broadcast({ t: 'mow', by: sessionId, strokes: accepted }, sessionId);
    if (paidCells > 0) {
      const pay = Math.round(paidCells * MOW_PAY_PER_M2 * (acc.upgrades.includes('blades') ? 1.25 : 1) * 100) / 100;
      acc.money += pay; acc.earned += pay;
      this.sendAccount(sessionId, acc);
    }
  }

  private issueJob(sessionId: string, s: Session) {
    if (s.job) return this.io.send(sessionId, { t: 'job', job: s.job, note: 'Finish your current delivery first' });
    const lots = Object.values(this.world.lots);
    const lot = lots[Math.floor(Math.random() * lots.length)];
    const drop = { x: lot.x + 5, z: lot.front === '+z' ? lot.z + lot.d - 2 : lot.z + 2, lotId: lot.id };
    const dist = Math.hypot(drop.x - DEPOT.padX, drop.z - DEPOT.padZ);
    s.job = {
      id: Math.random().toString(36).slice(2, 10),
      kind: 'delivery', stage: 'toPickup',
      pickup: { x: DEPOT.padX, z: DEPOT.padZ }, drop,
      pay: Math.round(DELIVERY_BASE_PAY + dist * DELIVERY_PAY_PER_M),
    };
    this.io.send(sessionId, { t: 'job', job: s.job });
  }

  private progressJob(sessionId: string, s: Session, acc: Account, jobId: string) {
    const job = s.job;
    if (!job || job.id !== jobId) return;
    const truck = s.vehicles.find(v => (v.kind === 'truck' || v.kind === 'hdtruck') && s.player?.vehicleId === v.id);
    if (!truck) return this.io.send(sessionId, { t: 'toast', text: 'Deliveries need the pickup truck' });
    const target = job.stage === 'toPickup' ? job.pickup : job.drop;
    if (Math.hypot(truck.x - target.x, truck.z - target.z) > 8) return;  // authority checks position
    if (job.stage === 'toPickup') {
      job.stage = 'toDrop';
      this.io.send(sessionId, { t: 'job', job, note: 'Cargo loaded — deliver it to the marked house' });
    } else {
      const pay = Math.round(job.pay * (acc.upgrades.includes('license') ? 1.2 : 1));
      acc.money += pay; acc.earned += pay;
      job.pay = pay;
      s.job = null;
      this.io.send(sessionId, { t: 'job', job: null, note: `Delivery complete: +$${job.pay}` });
      this.sendAccount(sessionId, acc);
    }
  }

  // ------------------------------------------------------------ shops, fuel, needs

  /** Where the authority believes this player is (their car if they're driving). */
  private position(s: Session): { x: number; z: number; y: number } | null {
    const p = s.player;
    if (!p) return null;
    const v = p.vehicleId ? s.vehicles.find(x => x.id === p.vehicleId) : null;
    return v ? { x: v.x, z: v.z, y: v.y } : { x: p.x, z: p.z, y: p.y };
  }

  private handleBuy(sessionId: string, s: Session, acc: Account, shopId: unknown, itemId: unknown) {
    const door = SHOP_DOORS.find(d => d.id === shopId);
    if (!door) return;
    const pos = this.position(s);
    if (!pos || Math.hypot(pos.x - door.x, pos.z - door.z) > SHOP_RADIUS + 2) return this.sendAccount(sessionId, acc, `Walk up to ${door.name} first`);
    const item = (SHOP_ITEMS[door.kind] ?? []).find(i => i.id === itemId);
    if (!item) return;
    if (item.vehicle && acc.garage.includes(item.vehicle)) return this.sendAccount(sessionId, acc, `You already own the ${item.name}`);
    if (item.upgrade && acc.upgrades.includes(item.upgrade)) return this.sendAccount(sessionId, acc, 'You already have that');
    if (item.price > acc.money) return this.sendAccount(sessionId, acc, `Not enough money — ${item.name} costs $${item.price.toLocaleString()}`);
    acc.money -= item.price;
    if (item.needs) this.addNeeds(acc, item.needs);
    if (item.groceries) acc.groceries = Math.min(20, acc.groceries + item.groceries);
    if (item.upgrade) acc.upgrades.push(item.upgrade);
    if (item.vehicle) { acc.garage.push(item.vehicle); acc.fuel[item.vehicle] = VEHICLES[item.vehicle].tank; }
    this.sendAccount(sessionId, acc, item.vehicle ? `The ${item.name} is yours — find it in your garage list` : `Bought: ${item.name}`);
  }

  private handleRefuel(sessionId: string, s: Session, acc: Account, kind: VehicleKind, gallons: unknown) {
    if (!acc.garage.includes(kind) || VEHICLES[kind].fuel === 'none') return;
    const pos = this.position(s);
    if (!pos || !GAS_STATION.pumps.some(p => Math.hypot(p.x - pos.x, p.z - pos.z) < PUMP_RADIUS + 1)) return this.sendAccount(sessionId, acc, 'Pull up to a pump at Gas & Go');
    const want = Math.max(0, Math.min(Number(gallons) || 0, VEHICLES[kind].tank - (acc.fuel[kind] ?? 0)));
    const affordable = Math.min(want, acc.money / FUEL_PRICE);
    if (affordable < 0.05) return this.sendAccount(sessionId, acc, want < 0.05 ? 'The tank is already full' : 'Not enough money for fuel');
    const cost = Math.round(affordable * FUEL_PRICE * 100) / 100;
    acc.money = Math.round((acc.money - cost) * 100) / 100;
    acc.fuel[kind] = (acc.fuel[kind] ?? 0) + affordable;
    this.sendAccount(sessionId, acc, `${VEHICLES[kind].fuel === 'electric' ? 'Charged' : 'Filled up'}: ${affordable.toFixed(1)} ${VEHICLES[kind].fuel === 'electric' ? 'kWh' : 'gal'} for $${cost.toFixed(2)}`);
  }

  private cooldowns = new Map<string, number>();

  /** Sim-style object interactions at home (or on any lot for the public ones). */
  private handleUse(sessionId: string, s: Session, acc: Account, lotId: unknown, objectId: unknown) {
    if (!own(this.world.lots, lotId)) return;
    const lot = this.world.lots[lotId as string], b = this.world.builds[lot.id];
    if (!own(b.objects, objectId)) return;
    const o = b.objects[objectId as string], item = CATALOG[o.catalogId];
    if (!item?.use) return;
    if (lot.owner !== acc.id) return this.sendAccount(sessionId, acc, `That belongs to ${lot.ownerName ?? 'a neighbor'}`);
    const pos = this.position(s);
    const { w, d } = footprint(item, o.rot);
    const cx = o.gx + w / 2, cz = o.gz + d / 2;
    if (!pos || Math.hypot(pos.x - cx, pos.z - cz) > Math.max(w, d) / 2 + 3 || Math.abs(pos.y - levelBase(o.level)) > 2.5 && o.level > 0) return this.sendAccount(sessionId, acc, `Walk over to the ${item.name}`);
    const cdKey = `${acc.key}|${item.use}|${o.id}`;
    const now = Date.now();
    if ((this.cooldowns.get(cdKey) ?? 0) > now) return this.sendAccount(sessionId, acc, 'Give it a moment');
    this.cooldowns.set(cdKey, now + USE_COOLDOWN_MS);
    let note = '';
    switch (item.use) {
      case 'sleep': this.addNeeds(acc, { energy: 70 }); note = 'You took a good nap — Energy +70'; break;
      case 'eat':
        if (o.catalogId === 'grill') { this.addNeeds(acc, { hunger: 35, fun: 10 }); note = 'Grilled burgers — Hunger +35'; break; }
        if (acc.groceries <= 0) return this.sendAccount(sessionId, acc, 'The fridge is empty — buy groceries at Fresh Market');
        acc.groceries--; this.addNeeds(acc, { hunger: 40 }); note = `Cooked a home meal — Hunger +40 (${acc.groceries} meals left)`; break;
      case 'refresh': this.addNeeds(acc, { energy: 10, fun: 5 }); note = 'Refreshed — Energy +10'; break;
      case 'fun': this.addNeeds(acc, { fun: 22 }); note = `Had fun with the ${item.name} — Fun +22`; break;
    }
    this.sendAccount(sessionId, acc, note);
  }

  private addNeeds(acc: Account, n: Partial<Needs>) {
    for (const k of ['hunger', 'energy', 'fun'] as const) if (n[k]) acc.needs[k] = clampNeed(acc.needs[k] + n[k]!);
  }

  private needAcc = 0;
  /** Needs tick down only while you're here; being away never starves you. */
  private decayNeeds(dtSec: number) {
    this.needAcc += dtSec;
    if (this.needAcc < 10) return;
    const minutes = this.needAcc / 60;
    this.needAcc = 0;
    const seen = new Set<string>();
    this.sessions.forEach((s, id) => {
      if (seen.has(s.key)) return;
      seen.add(s.key);
      const a = this.accounts[s.key];
      if (!a) return;
      const slow = a.upgrades.includes('cooler') ? 0.7 : 1;
      a.needs.hunger = clampNeed(a.needs.hunger - NEED_DECAY_PER_MIN.hunger * minutes * slow);
      a.needs.energy = clampNeed(a.needs.energy - NEED_DECAY_PER_MIN.energy * minutes);
      a.needs.fun = clampNeed(a.needs.fun - NEED_DECAY_PER_MIN.fun * minutes);
      this.sendAccount(id, a);
    });
  }

  // ------------------------------------------------------------ tick

  tick(dtSec: number): void {
    this.decayNeeds(dtSec);
    if (this.wallClock) {
      this.hours = this.wallHours();
      const d = this.wallDay();
      if (d !== this.day) { this.day = d - 1; this.newDay(); }
    } else {
      const prevHours = this.hours;
      this.hours = (this.hours + (dtSec * 24) / DAY_LENGTH_SEC) % 24;
      if (this.hours < prevHours) this.newDay();
    }

    this.snapAcc += dtSec;
    if (this.snapAcc < 1 / SNAP_HZ) return;
    this.snapAcc = 0;
    const players: PlayerSnap[] = [];
    const vehicles: VehicleSnap[] = [];
    this.sessions.forEach(s => { if (s.player) players.push(s.player); vehicles.push(...s.vehicles); });
    this.io.broadcast({ t: 'snap', time: Date.now(), hours: this.hours, players, vehicles });
  }

  private newDay() {
    this.day++;
    // Interest is charged only to neighbors who are here when the day turns,
    // so coming and going as you please never piles up debt while you're away.
    const present = new Set([...this.sessions.values()].map(s => s.key));
    for (const key of present) {
      const a = this.accounts[key];
      if (a && a.debt > 0) a.debt = Math.round(a.debt * (1 + LOAN_DAILY_RATE));
    }
    this.coverage.forEach(c => c.fill(0));        // grass grows back overnight
    this.dirty.meta = true;
    this.io.broadcast({ t: 'newDay', day: this.day });
    this.sessions.forEach((s, id) => this.sendAccount(id, this.accounts[s.key]));
  }

  coverageCodes(): Record<string, string> {
    const out: Record<string, string> = {};
    this.coverage.forEach((c, id) => (out[id] = encodeCoverage(c)));
    return out;
  }

  serialize(): Persisted {
    const coverage: Record<string, string> = {};
    this.coverage.forEach((c, id) => (coverage[id] = encodeCoverage(c)));
    return { world: this.world, accounts: this.accounts, hours: this.hours, day: this.day, coverage, epochDay: this.epochDay };
  }
}
