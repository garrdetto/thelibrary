/**
 * Local Offline Simulation Mode: the whole neighborhood runs inside this page
 * with no network at all — authority, economy, bank, jobs and simulated
 * neighbors. Used for solo play and as the fallback whenever a server or
 * online room can't be reached.
 */
import type { ClientMsg, JoinOptions, ServerMsg } from '../../shared/Protocol';
import { Host } from './Host';
import type { NetStatus, Transport } from './Transport';

export const OFFLINE_SAVE = 'maplestreet/offline/v2';

export class OfflineTransport implements Transport {
  readonly label = 'Offline simulation';
  private readonly self = 'local-player';
  private host: Host | null = null;
  private msgCb: (m: ServerMsg) => void = () => {};
  private statusCb: (s: NetStatus) => void = () => {};

  async connect(opts: JoinOptions) {
    this.host = new Host(OFFLINE_SAVE, (to, msg, except) => {
      if ((to === '*' || to === this.self) && except !== this.self) queueMicrotask(() => this.msgCb(msg));
    });
    this.host.receive(this.self, { t: 'hello', opts });
    this.statusCb('offline');
  }

  send(msg: ClientMsg) { this.host?.receive(this.self, msg); }
  onMessage(cb: (m: ServerMsg) => void) { this.msgCb = cb; }
  onStatus(cb: (s: NetStatus) => void) { this.statusCb = cb; }
  close() { this.host?.stop(); this.host = null; }
}
