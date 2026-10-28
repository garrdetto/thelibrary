/**
 * Online rooms over WebRTC (PeerJS, loaded from unpkg like the other online
 * modules on the site). The host's browser runs the authority (Host) and
 * relays to up to 8 neighbors; everyone else joins with a 6-letter code.
 * Works on any static page — no game backend required.
 */
import type { ClientMsg, JoinOptions, ServerMsg } from '../../shared/Protocol';
import { Host } from './Host';
import type { NetStatus, Transport } from './Transport';

interface PeerConn {
  peer: string; open: boolean;
  send(d: unknown): void; close(): void;
  on(ev: 'open' | 'close' | 'error', cb: () => void): void;
  on(ev: 'data', cb: (d: unknown) => void): void;
}
interface PeerLike {
  id: string; open: boolean;
  on(ev: 'open', cb: (id: string) => void): void;
  on(ev: 'connection', cb: (c: PeerConn) => void): void;
  on(ev: 'error', cb: (e: { type: string }) => void): void;
  on(ev: 'disconnected', cb: () => void): void;
  connect(id: string, o?: { reliable?: boolean }): PeerConn;
  reconnect(): void; destroy(): void;
}
type PeerCtor = new (id?: string) => PeerLike;

const PREFIX = 'tl-maplestreet-';
const MAX_NEIGHBORS = 8;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const peerAvailable = () => typeof (window as unknown as { Peer?: PeerCtor }).Peer === 'function';
export const newRoomCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class PeerTransport implements Transport {
  readonly label: string;
  private peer: PeerLike | null = null;
  private host: Host | null = null;
  private conns = new Map<string, PeerConn>();
  private hostConn: PeerConn | null = null;
  private msgCb: (m: ServerMsg) => void = () => {};
  private statusCb: (s: NetStatus) => void = () => {};
  private closed = false;
  private retry = 0;
  code: string;

  constructor(readonly role: 'host' | 'join', code: string) {
    this.code = code.toUpperCase();
    this.label = role === 'host' ? `Hosting room ${this.code}` : `Room ${this.code}`;
  }

  private get Peer(): PeerCtor {
    const P = (window as unknown as { Peer?: PeerCtor }).Peer;
    if (!P) throw new Error('Online rooms need an internet connection (PeerJS did not load)');
    return P;
  }

  async connect(opts: JoinOptions) {
    this.statusCb('connecting');
    if (this.role === 'host') await this.startHost(opts);
    else await this.startJoin(opts);
  }

  // ------------------------------------------------------------ host

  private startHost(opts: JoinOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new this.Peer(PREFIX + this.code.toLowerCase());
      this.peer = peer;
      const timer = setTimeout(() => reject(new Error('Could not reach the PeerJS signaling server')), 10000);
      peer.on('open', () => {
        clearTimeout(timer);
        const self = peer.id;
        this.host = new Host('maplestreet/hosted/v1', (to, msg, except) => {
          if ((to === '*' || to === self) && except !== self) this.msgCb(msg);
          if (to === '*') { for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg); }
          else if (to !== self) { const c = this.conns.get(to); if (c?.open) c.send(msg); }
        });
        this.host.receive(self, { t: 'hello', opts });
        this.statusCb('host');
        resolve();
      });
      peer.on('connection', c => {
        if (this.conns.size >= MAX_NEIGHBORS) { c.on('open', () => c.close()); return; }
        c.on('open', () => this.conns.set(c.peer, c));
        c.on('data', d => this.host?.receive(c.peer, d as ClientMsg));
        const drop = () => { this.conns.delete(c.peer); this.host?.leave(c.peer); };
        c.on('close', drop); c.on('error', drop);
      });
      peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });
      peer.on('error', e => {
        if (e.type === 'unavailable-id' && !this.host) { clearTimeout(timer); peer.destroy(); reject(new Error('unavailable-id')); }
        else if (!this.host) { clearTimeout(timer); reject(new Error(`Network error: ${e.type}`)); }
      });
    });
  }

  // ------------------------------------------------------------ join

  private startJoin(opts: JoinOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new this.Peer();
      this.peer = peer;
      let welcomed = false;
      const timer = setTimeout(() => { if (!welcomed) reject(new Error(`No neighborhood is open with code ${this.code}`)); }, 12000);
      const dial = () => {
        const c = peer.connect(PREFIX + this.code.toLowerCase(), { reliable: true });
        this.hostConn = c;
        c.on('open', () => { this.retry = 0; c.send({ t: 'hello', opts } satisfies ClientMsg); });
        c.on('data', d => {
          const msg = d as ServerMsg;
          if (msg.t === 'welcome' && !welcomed) { welcomed = true; clearTimeout(timer); this.statusCb('online'); resolve(); }
          this.msgCb(msg);
        });
        c.on('close', () => {
          this.statusCb('offline');
          if (!this.closed && welcomed) setTimeout(dial, Math.min(15000, 2000 * ++this.retry));
        });
      };
      peer.on('open', dial);
      peer.on('error', e => {
        if (!welcomed) { clearTimeout(timer); reject(new Error(e.type === 'peer-unavailable' ? `No neighborhood is open with code ${this.code}` : `Network error: ${e.type}`)); }
      });
    });
  }

  send(msg: ClientMsg) {
    if (this.host && this.peer) this.host.receive(this.peer.id, msg);
    else if (this.hostConn?.open) this.hostConn.send(msg);
  }

  onMessage(cb: (m: ServerMsg) => void) { this.msgCb = cb; }
  onStatus(cb: (s: NetStatus) => void) { this.statusCb = cb; }
  get neighbors() { return this.conns.size; }

  close() {
    this.closed = true;
    try { this.send({ t: 'bye' }); } catch { /* closing */ }
    this.host?.stop();
    try { this.peer?.destroy(); } catch { /* closing */ }
  }
}
