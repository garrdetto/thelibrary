/**
 * Same-device multiplayer: every tab of this module on the same origin joins
 * one neighborhood over BroadcastChannel. Exactly one tab is elected host with
 * the Web Locks API and runs the authority (Host). If the host tab closes, the
 * lock passes to another tab, which reloads the saved state and tells
 * everyone to re-join.
 */
import type { ClientMsg, JoinOptions, ServerMsg } from '../../shared/Protocol';
import { randomId } from '../core/Storage';
import { Host } from './Host';
import type { NetStatus, Transport } from './Transport';

type Wire =
  | { k: 'c2h'; from: string; msg: ClientMsg }
  | { k: 'h2c'; to: string | '*'; except?: string; msg: ServerMsg }
  | { k: 'hostChanged' };

const CHANNEL = 'maplestreet-tabs';
const SAVE_KEY = 'maplestreet/tabs/v1';

export class LocalTransport implements Transport {
  readonly label = 'Same-device tabs';
  readonly sessionId = randomId(10);
  private ch: BroadcastChannel;
  private msgCb: (m: ServerMsg) => void = () => {};
  private statusCb: (s: NetStatus) => void = () => {};
  private host: Host | null = null;
  private welcomed = false;
  private opts: JoinOptions | null = null;

  constructor() {
    if (typeof BroadcastChannel === 'undefined' || !('locks' in navigator)) throw new Error('Tabs mode needs BroadcastChannel and Web Locks');
    this.ch = new BroadcastChannel(CHANNEL);
  }

  async connect(opts: JoinOptions) {
    this.opts = opts;
    this.statusCb('connecting');
    this.ch.onmessage = e => this.onWire(e.data as Wire);
    navigator.locks.request(`${CHANNEL}/host`, () => {
      this.becomeHost();
      return new Promise<void>(() => {});             // hold the lock for the tab's lifetime
    });
    addEventListener('pagehide', () => this.send({ t: 'bye' }));

    await new Promise<void>((resolve, reject) => {
      const started = performance.now();
      const hello = () => {
        if (this.welcomed) return resolve();
        if (performance.now() - started > 8000) return reject(new Error('No tab answered'));
        this.send({ t: 'hello', opts });
        setTimeout(hello, 400);
      };
      hello();
    });
  }

  private becomeHost() {
    this.host = new Host(SAVE_KEY, (to, msg, except) => {
      const w: Wire = { k: 'h2c', to, except, msg };
      this.ch.postMessage(w);
      this.onWire(w, true);                             // BroadcastChannel skips the sender
    }, { reapMs: 30000, selfId: this.sessionId });
    this.welcomed = false;
    this.ch.postMessage({ k: 'hostChanged' } satisfies Wire);
    if (this.opts) this.send({ t: 'hello', opts: this.opts });
    this.statusCb('host');
  }

  private onWire(w: Wire, local = false) {
    if (w.k === 'c2h') {
      this.host?.receive(w.from, w.msg);
    } else if (w.k === 'h2c') {
      if (w.to !== '*' && w.to !== this.sessionId) return;
      if (w.except === this.sessionId) return;
      if (w.msg.t === 'welcome') { this.welcomed = true; if (!this.host) this.statusCb('online'); }
      if (w.msg.t === 'left' && w.msg.id === this.sessionId && this.opts) this.send({ t: 'hello', opts: this.opts });   // reaped while asleep: rejoin
      this.msgCb(w.msg);
    } else if (w.k === 'hostChanged' && !local) {
      this.welcomed = false;
      if (this.opts) this.send({ t: 'hello', opts: this.opts });
    }
  }

  send(msg: ClientMsg) {
    const w: Wire = { k: 'c2h', from: this.sessionId, msg };
    if (this.host) this.onWire(w, true);
    else this.ch.postMessage(w);
  }

  onMessage(cb: (m: ServerMsg) => void) { this.msgCb = cb; }
  onStatus(cb: (s: NetStatus) => void) { this.statusCb = cb; }
  close() { this.send({ t: 'bye' }); this.host?.stop(); this.ch.close(); }
}
