/**
 * Colyseus client transport. colyseus.js is loaded as a classic UMD <script>
 * from unpkg and read from `window.Colyseus`, so it runs entirely in the page. All protocol traffic rides one message type
 * ('m') so the server room is a thin wrapper around NeighborhoodLogic.
 * Reconnects with exponential backoff if the socket drops.
 */
import type { ClientMsg, JoinOptions, ServerMsg } from '../../shared/Protocol';
import type { NetStatus, Transport } from './Transport';

interface ColyRoom {
  sessionId: string;
  send(type: string, msg: unknown): void;
  onMessage(type: string, cb: (msg: unknown) => void): void;
  onLeave(cb: (code: number) => void): void;
  leave(consented?: boolean): Promise<unknown>;
}

export class ColyseusTransport implements Transport {
  readonly label: string;
  private room: ColyRoom | null = null;
  private msgCb: (m: ServerMsg) => void = () => {};
  private statusCb: (s: NetStatus) => void = () => {};
  private opts: JoinOptions | null = null;
  private closed = false;
  private backoff = 1000;

  constructor(private url: string, private roomName = 'neighborhood') {
    this.label = `Colyseus ${url}`;
  }

  async connect(opts: JoinOptions) {
    this.opts = opts;
    this.statusCb('connecting');
    const Colyseus = (window as unknown as { Colyseus?: { Client: new (url: string) => { joinOrCreate(name: string, opts: unknown): Promise<unknown> } } }).Colyseus;
    if (!Colyseus) throw new Error('colyseus.js did not load');
    const client = new Colyseus.Client(this.url);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Colyseus server timed out')), 6000));
    const room = (await Promise.race([client.joinOrCreate(this.roomName, opts), timeout])) as unknown as ColyRoom;
    this.room = room;
    this.backoff = 1000;
    room.onMessage('m', m => this.msgCb(m as ServerMsg));
    room.onLeave(() => {
      this.room = null;
      this.statusCb('offline');
      if (!this.closed) setTimeout(() => this.reconnect(), this.backoff);
    });
    this.statusCb('online');
  }

  private async reconnect() {
    if (this.closed || !this.opts) return;
    try { await this.connect(this.opts); }
    catch { this.backoff = Math.min(this.backoff * 2, 15000); setTimeout(() => this.reconnect(), this.backoff); }
  }

  send(msg: ClientMsg) { this.room?.send('m', msg); }
  onMessage(cb: (m: ServerMsg) => void) { this.msgCb = cb; }
  onStatus(cb: (s: NetStatus) => void) { this.statusCb = cb; }
  close() { this.closed = true; this.room?.leave(true); }
}
