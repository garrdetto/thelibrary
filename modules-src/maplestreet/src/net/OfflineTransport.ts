/**
 * Solo mode: the whole neighborhood runs inside this page with no network at
 * all — authority, economy, jobs and simulated neighbors — with unlimited
 * money, so it's a sandbox for building. Also the fallback whenever the
 * shared world can't be reached.
 */
import type { ClientMsg, JoinOptions, ServerMsg } from '../../shared/Protocol';
import { Host } from './Host';
import type { NetStatus, Transport } from './Transport';

export const OFFLINE_SAVE = 'maplestreet/solo/v3';

export class OfflineTransport implements Transport {
  readonly label = 'Solo — unlimited money';
  private readonly self = 'local-player';
  private host: Host | null = null;
  private msgCb: (m: ServerMsg) => void = () => {};
  private statusCb: (s: NetStatus) => void = () => {};

  async connect(opts: JoinOptions) {
    this.host = new Host(OFFLINE_SAVE, (to, msg, except) => {
      if ((to === '*' || to === this.self) && except !== this.self) queueMicrotask(() => this.msgCb(msg));
    }, { unlimitedMoney: true });
    this.host.receive(this.self, { t: 'hello', opts });
    this.statusCb('offline');
  }

  send(msg: ClientMsg) { this.host?.receive(this.self, msg); }
  onMessage(cb: (m: ServerMsg) => void) { this.msgCb = cb; }
  onStatus(cb: (s: NetStatus) => void) { this.statusCb = cb; }
  close() { this.host?.stop(); this.host = null; }
}
