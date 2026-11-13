/**
 * Solo mode: the whole neighborhood runs inside this page with no network at
 * all — authority, economy, jobs and simulated neighbors — with unlimited
 * money, so it's a sandbox for building. Also the fallback whenever the
 * shared world can't be reached.
 */
import type { ClientMsg, JoinOptions, ServerMsg } from '../../shared/Protocol';
import { Host } from './Host';
import type { NetStatus, Transport } from './Transport';
import { DEV_MODE, DEV_SAVE } from '../core/DevMode';

export const OFFLINE_SAVE = 'maplestreet/solo/v3';

export class OfflineTransport implements Transport {
  readonly label = DEV_MODE ? 'Developer instance (drafts on)' : 'Solo — unlimited money';
  private readonly self = 'local-player';
  private host: Host | null = null;
  private msgCb: (m: ServerMsg) => void = () => {};
  private statusCb: (s: NetStatus) => void = () => {};

  /** `devTools`: this device's solo game also runs the developer tools (Fox Lake's `?solo=1`). */
  constructor(private readonly options: { devTools?: boolean } = {}) {}

  async connect(opts: JoinOptions) {
    this.host = new Host(DEV_MODE ? DEV_SAVE : OFFLINE_SAVE, (to, msg, except) => {
      if ((to === '*' || to === this.self) && except !== this.self) queueMicrotask(() => this.msgCb(msg));
    }, { unlimitedMoney: true, devTools: this.options.devTools });
    this.host.receive(this.self, { t: 'hello', opts });
    this.statusCb('offline');
  }

  send(msg: ClientMsg) { this.host?.receive(this.self, msg); }
  onMessage(cb: (m: ServerMsg) => void) { this.msgCb = cb; }
  onStatus(cb: (s: NetStatus) => void) { this.statusCb = cb; }
  close() { this.host?.stop(); this.host = null; }
}
