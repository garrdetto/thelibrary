/**
 * NeighborhoodLogic — the single source of truth for a neighborhood.
 *
 * Transport-agnostic: the persistent world (WorldServer, run by a Cloudflare
 * Durable Object), the in-browser hosts (offline, tabs, PeerJS rooms) and the
 * optional Colyseus room all wrap this class and just forward messages in and
 * out. That keeps "can't wreck your neighbor's house", money, loans and
 * payouts enforced in one place.
 */
import { applyOp, emptyBuild, makeWorld, opCost, own, validateOp, WorldState } from './BuildRules';
import { Account, availableCredit, DELIVERY_BASE_PAY, DELIVERY_PAY_PER_M, LOAN_DAILY_RATE, MOW_PAY_PER_M2, START_MONEY } from './Economy';
import { seedNeighborhood } from './Seed';
import { decodeCoverage, encodeCoverage, strokeCells, stripeShade } from './Mowing';
import type { ClientMsg, Job, JoinOptions, PlayerSnap, ServerMsg, VehicleKind, VehicleSnap } from './Protocol';
import { DEPOT, makeLots } from './WorldLayout';

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

const KINDS: VehicleKind[] = ['truck', 'sedan', 'golfcart', 'atv', 'mower', 'trailer'];
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
    if (!acc) acc = this.accounts[key] = { id: Math.random().toString(36).slice(2, 12), key, name, color, money: START_MONEY, debt: 0, earned: 0 };
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
  addAccount(acc: Account) { this.accounts[acc.key] = acc; }
  get sessionCount() { return this.sessions.size; }

  leave(sessionId: string): void {
    if (!this.sessions.delete(sessionId)) return;
    this.io.broadcast({ t: 'left', id: sessionId });
  }

  /** Drop sessions that stopped sending state (used by the local host). */
  reap(timeoutMs: number, keep?: string): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (id !== keep && now - s.lastSeen > timeoutMs) this.leave(id);
  }

  hasSession(id: string) { return this.sessions.has(id); }

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
      case 'build': {
        if (!msg.op || typeof msg.op !== 'object') return;
        const reason = validateOp(this.world, msg.op, acc.id);
        if (reason) return this.io.send(sessionId, { t: 'buildRejected', seq: msg.seq, reason });
        const cost = opCost(this.world, msg.op);
        if (cost > acc.money) return this.io.send(sessionId, { t: 'buildRejected', seq: msg.seq, reason: `Not enough money ($${cost.toLocaleString()} needed)` });
        applyOp(this.world, msg.op, acc.id, acc.name);
        acc.money -= cost;
        this.dirty.lots.add((msg.op as { lotId: string }).lotId);
        this.io.broadcast({ t: 'build', seq: msg.seq, by: sessionId, actorId: acc.id, actorName: acc.name, op: msg.op });
        this.sendAccount(sessionId, acc);
        break;
      }
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
      case 'bye': this.leave(sessionId); break;
    }
  }

  private handleMow(sessionId: string, s: Session, acc: Account, strokes: unknown) {
    if (!Array.isArray(strokes)) return;
    const mower = s.vehicles.find(v => v.kind === 'mower');
    if (!mower || s.player?.vehicleId !== mower.id) return;     // must be driving a mower
    const accepted = [];
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
      const pay = Math.round(paidCells * MOW_PAY_PER_M2 * 100) / 100;
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
    const truck = s.vehicles.find(v => v.kind === 'truck' && s.player?.vehicleId === v.id);
    if (!truck) return this.io.send(sessionId, { t: 'toast', text: 'Deliveries need the pickup truck' });
    const target = job.stage === 'toPickup' ? job.pickup : job.drop;
    if (Math.hypot(truck.x - target.x, truck.z - target.z) > 8) return;  // authority checks position
    if (job.stage === 'toPickup') {
      job.stage = 'toDrop';
      this.io.send(sessionId, { t: 'job', job, note: 'Cargo loaded — deliver it to the marked house' });
    } else {
      acc.money += job.pay; acc.earned += job.pay;
      s.job = null;
      this.io.send(sessionId, { t: 'job', job: null, note: `Delivery complete: +$${job.pay}` });
      this.sendAccount(sessionId, acc);
    }
  }

  // ------------------------------------------------------------ tick

  tick(dtSec: number): void {
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
