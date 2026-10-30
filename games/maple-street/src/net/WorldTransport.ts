/**
 * The shared, persistent Maple Street: one WebSocket to /api/maplestreet on
 * the site, which a Cloudflare Durable Object answers. Signed-in library
 * members are identified by their session cookie; everyone else by a random
 * key kept in this browser. Drops reconnect automatically with backoff, and
 * each reconnect receives a fresh welcome with the full, current world.
 */
import type { ClientMsg, JoinOptions, ServerMsg } from '../../shared/Protocol';
import { randomId, store } from '../core/Storage';
import type { NetStatus, Transport } from './Transport';

const GUEST_KEY = 'maplestreet/guest-key';

export function worldEndpoint(name: string): string | null {
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return null;
  let guest = store.get(GUEST_KEY);
  if (!guest || !/^[A-Za-z0-9]{12,64}$/.test(guest)) { guest = randomId(24); store.set(GUEST_KEY, guest); }
  const u = new URL('/api/maplestreet', location.href);
  u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('guest', guest);
  u.searchParams.set('name', name.slice(0, 16));
  return u.toString();
}

export class WorldTransport implements Transport {
  readonly label = 'Maple Street (shared world)';
  private ws: WebSocket | null = null;
  private msgCb: (m: ServerMsg) => void = () => {};
  private statusCb: (s: NetStatus) => void = () => {};
  private opts: JoinOptions | null = null;
  private closed = false;
  private backoff = 1000;
  private queue: ClientMsg[] = [];

  constructor(private url: string) {}

  connect(opts: JoinOptions): Promise<void> {
    this.opts = opts;
    return new Promise((resolve, reject) => {
      let welcomed = false;
      const timer = setTimeout(() => { if (!welcomed) { this.ws?.close(); reject(new Error('The shared world did not answer')); } }, 25000);
      this.open(() => { if (!welcomed) { welcomed = true; clearTimeout(timer); resolve(); } }, err => { if (!welcomed) { clearTimeout(timer); reject(err); } });
    });
  }

  private open(onWelcome: () => void, onFail: (e: Error) => void) {
    this.statusCb('connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch (e) { onFail(e as Error); return; }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.backoff = 1000;
      if (this.opts) ws.send(JSON.stringify({ t: 'hello', opts: this.opts } satisfies ClientMsg));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = e => {
      let msg: ServerMsg;
      try { msg = JSON.parse(e.data as string); } catch { return; }
      if (msg.t === 'welcome') { this.statusCb('online'); onWelcome(); }
      this.msgCb(msg);
    };
    ws.onclose = e => {
      this.ws = null;
      if (this.closed) return;
      if (!opened) { onFail(new Error(e.reason || 'Could not reach the shared world')); }
      this.statusCb('offline');
      if (opened || this.backoff > 1000) {
        setTimeout(() => this.open(() => {}, () => {}), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 20000);
      }
    };
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t === 'build' || msg.t === 'loan' || msg.t === 'repay') this.queue.push(msg);   // state/mow are recreated next tick
  }

  onMessage(cb: (m: ServerMsg) => void) { this.msgCb = cb; }
  onStatus(cb: (s: NetStatus) => void) { this.statusCb = cb; }
  close() { this.closed = true; this.ws?.close(1000, 'bye'); }
}
