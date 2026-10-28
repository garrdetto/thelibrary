/**
 * NeighborhoodLogic — the single source of truth for a neighborhood.
 *
 * Transport-agnostic: the Colyseus room (server/src/NeighborhoodRoom.ts) and
 * the in-browser host (src/net/LocalTransport.ts) both wrap this class and
 * just forward messages in and out. That keeps "can't wreck your neighbor's
 * house", money, loans and payouts enforced in one place.
 */
import { applyOp, makeWorld, opCost, validateOp, WorldState } from './BuildRules';
import { Account, availableCredit, DELIVERY_BASE_PAY, DELIVERY_PAY_PER_M, LOAN_DAILY_RATE, MOW_PAY_PER_M2, START_MONEY } from './Economy';
import { seedNeighborhood } from './Seed';
import { decodeCoverage, encodeCoverage, strokeCells, stripeShade } from './Mowing';
import type { ClientMsg, Job, JoinOptions, PlayerSnap, ServerMsg, VehicleSnap } from './Protocol';
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
}

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
  private coverage = new Map<string, Uint8Array>();
  private sessions = new Map<string, Session>();
  private snapAcc = 0;

  constructor(private io: LogicIO, saved?: Persisted | null) {
    if (saved?.world) this.world = saved.world;
    else { this.world = makeWorld(makeLots()); seedNeighborhood(this.world); }
    this.accounts = saved?.accounts ?? {};
    this.hours = saved?.hours ?? 8.5;
    this.day = saved?.day ?? 1;
    for (const id in this.world.lots) {
      const l = this.world.lots[id];
      const n = l.w * l.d;
      this.coverage.set(id, saved?.coverage?.[id] ? decodeCoverage(saved.coverage[id], n) : new Uint8Array(n));
    }
  }

  // ------------------------------------------------------------ lifecycle

  join(sessionId: string, opts: JoinOptions): void {
    const key = String(opts?.key ?? '').slice(0, 64) || sessionId;
    const name = String(opts?.name ?? 'Neighbor').replace(/[<>]/g, '').slice(0, 20) || 'Neighbor';
    const color = /^#[0-9a-f]{6}$/i.test(opts?.color ?? '') ? opts.color : '#3a7bd5';
    let acc = this.accounts[key];
    if (!acc) acc = this.accounts[key] = { id: Math.random().toString(36).slice(2, 12), key, name, color, money: START_MONEY, debt: 0, earned: 0 };
    acc.name = name; acc.color = color;
    this.sessions.set(sessionId, { key, player: null, vehicles: [], job: null, lastSeen: Date.now() });

    const mowed: Record<string, string> = {};
    this.coverage.forEach((c, id) => (mowed[id] = encodeCoverage(c)));
    this.io.send(sessionId, { t: 'welcome', you: sessionId, world: this.world, account: acc, hours: this.hours, day: this.day, mowed });
    this.io.broadcast({ t: 'toast', text: `${name} moved into the neighborhood` }, sessionId);
  }

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
        if (msg.p) s.player = { ...msg.p, id: sessionId, name: acc.name, color: acc.color };
        s.vehicles = (Array.isArray(msg.v) ? msg.v.slice(0, 3) : []).map(v => ({ ...v, owner: sessionId, id: `${sessionId}:${String(v.id).split(':').pop()}` }));
        break;
      }
      case 'build': {
        const reason = validateOp(this.world, msg.op, acc.id);
        if (reason) return this.io.send(sessionId, { t: 'buildRejected', seq: msg.seq, reason });
        const cost = opCost(this.world, msg.op);
        if (cost > acc.money) return this.io.send(sessionId, { t: 'buildRejected', seq: msg.seq, reason: `Not enough money ($${cost.toLocaleString()} needed)` });
        applyOp(this.world, msg.op, acc.id, acc.name);
        acc.money -= cost;
        this.io.broadcast({ t: 'build', seq: msg.seq, by: sessionId, actorId: acc.id, actorName: acc.name, op: msg.op });
        this.io.send(sessionId, { t: 'account', account: acc });
        break;
      }
      case 'loan': {
        const amt = Math.floor(Number(msg.amount));
        const avail = availableCredit(acc);
        if (!(amt > 0)) return;
        if (amt > avail) return this.io.send(sessionId, { t: 'account', account: acc, note: `Loan declined — your available credit is $${avail.toLocaleString()}` });
        acc.debt += amt; acc.money += amt;
        this.io.send(sessionId, { t: 'account', account: acc, note: `Approved: $${amt.toLocaleString()} deposited` });
        break;
      }
      case 'repay': {
        const amt = Math.min(Math.floor(Number(msg.amount)), acc.debt, acc.money);
        if (!(amt > 0)) return;
        acc.debt -= amt; acc.money -= amt;
        this.io.send(sessionId, { t: 'account', account: acc, note: `Repaid $${amt.toLocaleString()}` });
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
      const lot = this.world.lots[st?.lotId];
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
    this.io.broadcast({ t: 'mow', by: sessionId, strokes: accepted }, sessionId);
    if (paidCells > 0) {
      const pay = Math.round(paidCells * MOW_PAY_PER_M2 * 100) / 100;
      acc.money += pay; acc.earned += pay;
      this.io.send(sessionId, { t: 'account', account: acc });
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
      this.io.send(sessionId, { t: 'account', account: acc });
    }
  }

  // ------------------------------------------------------------ tick

  tick(dtSec: number): void {
    const prevHours = this.hours;
    this.hours = (this.hours + (dtSec * 24) / DAY_LENGTH_SEC) % 24;
    if (this.hours < prevHours) this.newDay();

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
    for (const key in this.accounts) {
      const a = this.accounts[key];
      if (a.debt > 0) a.debt = Math.round(a.debt * (1 + LOAN_DAILY_RATE));
    }
    this.coverage.forEach(c => c.fill(0));        // grass grows back overnight
    this.io.broadcast({ t: 'newDay', day: this.day });
    this.sessions.forEach((s, id) => this.io.send(id, { t: 'account', account: this.accounts[s.key] }));
  }

  serialize(): Persisted {
    const coverage: Record<string, string> = {};
    this.coverage.forEach((c, id) => (coverage[id] = encodeCoverage(c)));
    return { world: this.world, accounts: this.accounts, hours: this.hours, day: this.day, coverage };
  }
}
