/**
 * In-page authority. Wraps the same NeighborhoodLogic the Colyseus server
 * runs, ticks it, injects simulated neighbors into snapshots and persists
 * the neighborhood to storage. Offline mode, same-device tabs and PeerJS
 * online rooms all host through this class; only the delivery differs.
 */
import { NeighborhoodLogic, Persisted } from '../../shared/RoomLogic';
import type { ClientMsg, ServerMsg } from '../../shared/Protocol';
import { store } from '../core/Storage';
import { NpcTraffic } from '../../shared/Npc';

export type Deliver = (to: string | '*', msg: ServerMsg, except?: string) => void;

export class Host {
  readonly logic: NeighborhoodLogic;
  private npcs = new NpcTraffic();
  private timers: number[] = [];
  private last = performance.now();

  constructor(private saveKey: string | null, rawDeliver: Deliver, opts: { npcs?: boolean; reapMs?: number; selfId?: string } = {}) {
    // Clone on the way out so no client ever shares object identity with authority state.
    const deliver: Deliver = (to, msg, except) => rawDeliver(to, structuredClone(msg), except);
    const saved = saveKey ? store.json<Persisted>(saveKey) : null;
    const withNpcs = opts.npcs !== false;
    this.logic = new NeighborhoodLogic({
      send: (to, msg) => deliver(to, msg),
      broadcast: (msg, except) => {
        if (msg.t === 'snap' && withNpcs) {
          const n = this.npcs.snapshot();
          this.npcs.obstacles = [...msg.players, ...msg.vehicles].map(e => ({ x: e.x, z: e.z }));
          msg = { ...msg, players: [...msg.players, ...n.players], vehicles: [...msg.vehicles, ...n.vehicles] };
        }
        deliver('*', msg, except);
      },
    }, saved);

    this.timers.push(window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      if (withNpcs) this.npcs.step(dt);
      this.logic.tick(dt);
      if (opts.reapMs) this.logic.reap(opts.reapMs, opts.selfId);
    }, 1000 / 30));
    if (saveKey) {
      this.timers.push(window.setInterval(() => this.save(), 5000));
      addEventListener('pagehide', () => this.save());
    }
  }

  receive(from: string, msg: ClientMsg) {
    if (msg.t === 'hello') {
      if (!this.logic.hasSession(from)) this.logic.join(from, msg.opts);
      return;
    }
    if (!this.logic.hasSession(from)) return;
    this.logic.message(from, msg);
  }

  leave(id: string) { this.logic.leave(id); }

  save() { if (this.saveKey) store.set(this.saveKey, JSON.stringify(this.logic.serialize())); }

  stop() { this.save(); this.timers.forEach(clearInterval); this.timers = []; }
}
