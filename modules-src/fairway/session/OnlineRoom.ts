/** Online room over the engine's PeerRoom: roster handshake, host-only broadcasts, sender checks, hub bridge and ?room= auto-join. Match rules stay in systems/Match.ts. */
import { PeerRoom, type NetConfig, type RoomFormat, type RoomStatus } from '../../../engine'
import type { PlayerSeat } from '../systems/Match'
import { parseMessage, type FairwayMessage } from '../systems/Protocol'

export interface OnlineHandlers {
  roster(players: readonly PlayerSeat[], hostId: string): void
  status(status: RoomStatus, detail?: string): void
  /** Host only: a guest asked to join after the match began, or rejoined; reply with the current state. */
  lateJoin(peerId: string, seat: PlayerSeat): void
  /** Host only: a guest disconnected after the match began. */
  dropped(playerId: string): void
  message(message: FairwayMessage, fromPlayerId: string | null): void
}

export class OnlineRoom {
  readonly room: PeerRoom<FairwayMessage>
  private readonly seats = new Map<string, PlayerSeat>()
  private started = false
  private hostId = ''

  constructor(
    format: RoomFormat,
    net: NetConfig,
    private readonly self: PlayerSeat,
    private readonly maxPlayers: number,
    private readonly handlers: OnlineHandlers,
  ) {
    this.room = new PeerRoom<FairwayMessage>(format, net, {
      message: (raw, from) => this.receive(raw, from),
      join: (peerId) => {
        if (!this.room.isHost) this.room.send({ type: 'hello', playerId: self.id, name: self.name })
        else this.handlers.status(this.room.status, peerId)
      },
      leave: (peerId) => this.leave(peerId),
      status: (status, detail) => handlers.status(status, detail),
    })
  }

  get isHost(): boolean {
    return this.room.isHost
  }

  get code(): string {
    return this.room.code
  }

  roster(): PlayerSeat[] {
    return this.room.isHost ? [this.self, ...this.seats.values()] : [...this.seats.values()]
  }

  async host(): Promise<string> {
    this.seats.clear()
    this.started = false
    this.hostId = this.self.id
    const code = await this.room.host()
    this.handlers.roster(this.roster(), this.hostId)
    return code
  }

  async join(code: string): Promise<void> {
    this.seats.clear()
    this.started = false
    await this.room.join(code)
  }

  /** Answers the hub's tl-host request (chat invite) with this room's code, hosting one first if needed. */
  bridgeHub(onHostRequest: () => Promise<unknown>): void {
    this.room.bridgeHub(onHostRequest)
  }

  autoJoinFromQuery(): string | null {
    return this.room.autoJoinFromQuery()
  }

  markStarted(): void {
    this.started = true
  }

  broadcast(message: FairwayMessage): void {
    this.room.send(message)
  }

  sendTo(peerId: string, message: FairwayMessage): void {
    this.room.sendTo(peerId, message)
  }

  close(): void {
    this.room.close()
    this.seats.clear()
    this.started = false
  }

  dispose(): void {
    this.room.dispose()
    this.seats.clear()
  }

  /**
   * Message handler. Every payload is validated by parseMessage first. On the host, "hello" registers the sender's seat
   * (the first four players; later arrivals and rejoins receive the state instead) and every other message is checked
   * against the seat that peer registered, so a guest can never act for someone else. Guests trust only the host.
   */
  private receive(raw: unknown, peerId: string): void {
    const message = parseMessage(raw)
    if (!message) return
    if (this.room.isHost) {
      if (message.type === 'hello') {
        const known = [...this.seats.entries()].find(([, seat]) => seat.id === message.playerId)
        if (known && known[0] !== peerId) this.seats.delete(known[0])
        if (message.playerId === this.self.id) return
        const seat: PlayerSeat = { id: message.playerId, name: message.name }
        if (this.started) {
          this.seats.set(peerId, seat)
          this.handlers.lateJoin(peerId, seat)
          return
        }
        if (this.roster().length >= this.maxPlayers && !known) return
        this.seats.set(peerId, seat)
        const roster = this.roster()
        this.broadcast({ type: 'roster', hostId: this.self.id, players: roster })
        this.handlers.roster(roster, this.self.id)
        return
      }
      const sender = this.seats.get(peerId)
      if (!sender) return
      if (message.type === 'shot' && message.playerId !== sender.id) return
      this.handlers.message(message, sender.id)
      return
    }
    if (message.type === 'roster') {
      this.seats.clear()
      for (const seat of message.players) this.seats.set(seat.id, seat)
      this.hostId = message.hostId
      this.handlers.roster(message.players, message.hostId)
      return
    }
    this.handlers.message(message, this.hostId || null)
  }

  private leave(peerId: string): void {
    if (!this.room.isHost) return
    const seat = this.seats.get(peerId)
    if (!seat) return
    this.seats.delete(peerId)
    if (this.started) {
      this.handlers.dropped(seat.id)
      return
    }
    const roster = this.roster()
    this.broadcast({ type: 'roster', hostId: this.self.id, players: roster })
    this.handlers.roster(roster, this.self.id)
  }
}
