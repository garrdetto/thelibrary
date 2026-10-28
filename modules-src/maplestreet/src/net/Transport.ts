import type { ClientMsg, JoinOptions, ServerMsg } from '../../shared/Protocol';

export type NetStatus = 'connecting' | 'online' | 'offline' | 'host';

/**
 * Anything that can carry the protocol: a Colyseus room, or the zero-server
 * BroadcastChannel mesh used for local multi-tab play. Game code only sees this.
 */
export interface Transport {
  readonly label: string;
  connect(opts: JoinOptions): Promise<void>;
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): void;
  onStatus(cb: (s: NetStatus) => void): void;
  close(): void;
}
