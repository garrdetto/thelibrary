/**
 * The persistent, always-on Maple Street.
 *
 * One WorldServer owns the shared neighborhood: anyone can connect, leave,
 * and come back later to find their lot, house, money and loan exactly as
 * they left them. It wraps NeighborhoodLogic with:
 *   - durable storage (one record per lot, one per account, one for shared
 *     state) written incrementally from the logic's dirty sets,
 *   - verified identities supplied by the host (a signed-in library member
 *     or a browser-keyed guest), so nobody can claim someone else's house,
 *   - connection limits, message size limits and per-connection rate limits,
 *   - a simulation timer that runs only while someone is connected; the
 *     time of day follows the wall clock, so the world wakes at the right hour.
 *
 * Runtime-agnostic: the Cloudflare Durable Object (src/server/maplestreet-world.ts)
 * supplies storage and sockets; tests use in-memory fakes.
 */
import type { LotBuild, LotState } from './BuildRules';
import type { Account } from './Economy';
import { NpcTraffic, obstaclesFrom } from './Npc';
import { AUTOSAVE_EVERY_MS, type ClientMsg, type JoinOptions, type ServerMsg } from './Protocol';
import { Identity, NeighborhoodLogic, Persisted } from './RoomLogic';

export interface WorldStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  list<T>(prefix: string): Promise<Map<string, T>>;
}

export interface WorldSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Meta { version: number; epochDay: number; coverage: Record<string, string>; seedVersion?: number }
interface LotRecord { lot: LotState; build: LotBuild }

/**
 * Storage generation. Bumping it starts everyone over on a fresh neighborhood:
 * records from earlier generations are simply never read again.
 * g2 (Nov 2026): reset for Willow Bend, growing lawns and one-time characters.
 */
export const WORLD_GENERATION = 'g2:';
const K = { meta: `${WORLD_GENERATION}meta`, lot: `${WORLD_GENERATION}lot:`, acct: `${WORLD_GENERATION}acct:` };

export const WORLD_LIMITS = {
  maxConnections: 48,
  maxMessageBytes: 32_768,
  messagesPerSecond: 40,
  tickHz: 30,
  saveEveryMs: AUTOSAVE_EVERY_MS,
};

export class WorldServer {
  private logic: NeighborhoodLogic | null = null;
  private loading: Promise<void> | null = null;
  private sockets = new Map<string, WorldSocket>();
  private budget = new Map<string, { tokens: number; at: number }>();
  private npcs = new NpcTraffic();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private nextId = 1;

  constructor(private storage: WorldStorage) {}

  /** Loads the world from storage once (seeding a fresh neighborhood the first time). */
  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load() {
    const [meta, lots] = await Promise.all([this.storage.get<Meta>(K.meta), this.storage.list<LotRecord>(K.lot)]);
    let saved: Persisted | null = null;
    if (meta && lots.size) {
      const world: Persisted['world'] = { lots: {}, builds: {}, version: meta.version, seedVersion: meta.seedVersion };
      for (const rec of lots.values()) { world.lots[rec.lot.id] = rec.lot; world.builds[rec.lot.id] = rec.build; }
      saved = { world, accounts: {}, hours: 0, day: 1, coverage: meta.coverage ?? {}, epochDay: meta.epochDay };
    }
    this.logic = new NeighborhoodLogic({
      send: (to, msg) => this.deliver(to, msg),
      broadcast: (msg, except) => this.broadcast(msg, except),
    }, saved, { clock: 'wall' });
    await this.save();                                    // persists the seed on first boot
  }

  // ------------------------------------------------------------ connections

  /**
   * Admit a connection with a host-verified identity. Returns handlers the host
   * wires to the socket's message and close events.
   */
  async connect(socket: WorldSocket, identity: Identity) {
    await this.ready();
    const logic = this.logic!;
    if (this.sockets.size >= WORLD_LIMITS.maxConnections) {
      socket.close(1013, 'Maple Street is full right now. Try again soon.');
      return { onMessage() {}, onClose() {} };
    }
    if (!logic.hasAccount(identity.key)) {
      const stored = await this.storage.get<Account>(`${K.acct}${identity.key}`);
      if (stored && !logic.hasAccount(identity.key)) logic.addAccount(stored);
    }
    const id = `s${(this.nextId++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    let joined = false;
    this.sockets.set(id, socket);
    this.budget.set(id, { tokens: WORLD_LIMITS.messagesPerSecond, at: Date.now() });
    this.startTimers();

    return {
      onMessage: (data: string | ArrayBuffer) => {
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        if (text.length > WORLD_LIMITS.maxMessageBytes) { socket.close(1009, 'Message too large'); return; }
        if (!this.spend(id)) return;
        let msg: ClientMsg;
        try { msg = JSON.parse(text); } catch { return; }
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'hello') {
          if (!joined) { joined = true; logic.join(id, (msg.opts ?? {}) as JoinOptions, identity); }
          return;
        }
        if (!joined) return;
        try { logic.message(id, msg); } catch (e) { console.warn('[maplestreet] bad message', e); }
      },
      onClose: () => {
        if (!this.sockets.delete(id)) return;
        this.budget.delete(id);
        if (joined) logic.leave(id);
        if (this.sockets.size === 0) this.stopTimers();
        void this.save();
      },
    };
  }

  private spend(id: string) {
    const b = this.budget.get(id);
    if (!b) return false;
    const now = Date.now();
    b.tokens = Math.min(WORLD_LIMITS.messagesPerSecond, b.tokens + ((now - b.at) / 1000) * WORLD_LIMITS.messagesPerSecond);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private deliver(to: string, msg: ServerMsg) {
    const s = this.sockets.get(to);
    if (!s) return;
    try { s.send(JSON.stringify(msg)); } catch { /* socket closing */ }
  }

  private broadcast(msg: ServerMsg, except?: string) {
    if (msg.t === 'snap') {
      const n = this.npcs.snapshot();
      this.npcs.obstacles = obstaclesFrom(msg.players, msg.vehicles);
      msg = { ...msg, players: [...msg.players, ...n.players], vehicles: [...msg.vehicles, ...n.vehicles] };
    }
    const data = JSON.stringify(msg);
    for (const [id, s] of this.sockets) {
      if (id === except) continue;
      try { s.send(data); } catch { /* socket closing */ }
    }
  }

  // ------------------------------------------------------------ simulation + saving

  private startTimers() {
    if (this.tickTimer) return;
    this.lastTick = Date.now();
    this.tickTimer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.25, (now - this.lastTick) / 1000);
      this.lastTick = now;
      this.npcs.step(dt);
      this.logic?.tick(dt);
    }, 1000 / WORLD_LIMITS.tickHz);
    this.saveTimer = setInterval(() => void this.autosave(), WORLD_LIMITS.saveEveryMs);
  }

  private stopTimers() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.tickTimer = this.saveTimer = null;
  }

  /** The 5-minute checkpoint: saves everyone in town and tells them it happened. */
  async autosave() {
    if (!this.logic) return;
    this.logic.touchPresentAccounts();
    try {
      await this.save();
      this.broadcast({ t: 'toast', text: 'Progress autosaved' });
    } catch (e) {
      console.warn('[maplestreet] autosave failed', e);
    }
  }

  /** Writes only what changed: touched lots, touched accounts, and shared state. */
  async save() {
    const logic = this.logic;
    if (!logic) return;
    const { dirty } = logic;
    if (!dirty.lots.size && !dirty.accounts.size && !dirty.meta) return;
    const entries: Record<string, unknown> = {};
    for (const id of dirty.lots) entries[`${K.lot}${id}`] = { lot: logic.world.lots[id], build: logic.world.builds[id] } satisfies LotRecord;
    for (const key of dirty.accounts) if (logic.accounts[key]) entries[`${K.acct}${key}`] = logic.accounts[key];
    entries[K.meta] = { version: logic.world.version, epochDay: logic.epochDay, coverage: logic.coverageCodes(), seedVersion: logic.world.seedVersion } satisfies Meta;
    dirty.lots.clear(); dirty.accounts.clear(); dirty.meta = false;
    await this.storage.put(structuredClone(entries));
  }

  status() {
    const lots = this.logic ? Object.values(this.logic.world.lots) : [];
    return {
      online: this.sockets.size,
      lots: lots.length,
      available: lots.filter(l => !l.owner).length,
      hours: this.logic?.hours ?? null,
      day: this.logic?.day ?? null,
    };
  }
}
