/**
 * The casino cage. Everyone plays with their own Fox Lake money, the same
 * balance their town jobs and the lake country pay into: online, spins, hands
 * and beers are decided and paid on the server (`/api/casino`, signed-in
 * players by account, guests by this browser's town key); playing the town on
 * this device (solo), the same rules run here against the solo town's money.
 */
import { cryptoRng } from './math/rng'
import { MACHINE_BY_ID, playSpin, type MachineState, type SpinResult } from './math/machines'
import { act, deal, publicView, type Action, type BlackjackView, type Table } from './math/blackjack'
import { BAR } from './CasinoLayout'

const GUEST_HEADER = 'x-foxlake-guest'

export class CasinoClient {
  signedIn = false
  /** The player's Fox Lake money (null until it is known). */
  balance: number | null = null
  private online = false
  private guest = ''
  private readonly rng = cryptoRng()
  private readonly states = new Map<string, MachineState>()
  private table: Table | null = null

  /** Online (the shared Fox Lake world) or solo, and this browser's town guest key. */
  configure(online: boolean, guest: string): void {
    this.online = online
    this.guest = guest
  }

  /** What the credit meter is called. */
  get label(): string {
    return this.signedIn ? 'WALLET' : 'TOWN CASH'
  }

  /** The town's word on the balance (account updates from the world). */
  sync(money: number): void {
    this.balance = money
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = { [GUEST_HEADER]: this.guest }
    if (json) h['content-type'] = 'application/json'
    return h
  }

  async refresh(): Promise<void> {
    if (!this.online) return
    try {
      const res = await fetch('/api/casino', { credentials: 'same-origin', cache: 'no-store', headers: this.headers() })
      const data = (await res.json()) as { signedIn?: boolean; balance?: number | null }
      this.signedIn = Boolean(data.signedIn)
      if (typeof data.balance === 'number') this.balance = data.balance
    } catch {
      /* the town's account update still sets the balance */
    }
  }

  private async post<T>(body: Record<string, unknown>): Promise<T> {
    const res = await fetch('/api/casino', { method: 'POST', credentials: 'same-origin', headers: this.headers(true), body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) throw new Error(data.error ?? 'The cage is closed right now.')
    return data
  }

  private take(amount: number, what: string): void {
    if (this.balance === null) throw new Error('Your money hasn\'t loaded yet. Try again in a moment.')
    if (this.balance < amount) throw new Error(`Not enough money ${what}.`)
    this.balance = Math.round((this.balance - amount) * 100) / 100
  }

  async spin(machine: string, bet: number): Promise<SpinResult> {
    if (this.online) {
      const r = await this.post<{ result: SpinResult; balance: number | null }>({ action: 'spin', machine, bet })
      if (r.balance !== null) this.balance = r.balance
      return r.result
    }
    this.take(bet, 'for that bet')
    const result = playSpin(MACHINE_BY_ID[machine], bet, this.rng, this.states.get(machine) ?? {})
    this.states.set(machine, result.state)
    this.balance = Math.round(((this.balance ?? 0) + result.totalWin) * 100) / 100
    return result
  }

  meters(machine: string): MachineState['meters'] {
    return this.states.get(machine)?.meters
  }

  async drink(): Promise<void> {
    if (this.online) {
      const r = await this.post<{ balance: number }>({ action: 'drink' })
      this.balance = r.balance
      return
    }
    this.take(BAR.beerPrice, 'for a beer')
  }

  async blackjack(action: 'deal' | Action, bet = 0): Promise<BlackjackView> {
    if (this.online) {
      const r = await this.post<{ table: BlackjackView; balance: number | null }>(action === 'deal' ? { action: 'bj-deal', bet } : { action: 'bj-act', act: action })
      if (r.balance !== null) this.balance = r.balance
      else if (action === 'deal' && this.balance !== null) this.balance -= bet
      return r.table
    }
    if (action === 'deal') {
      this.take(bet, 'for that bet')
      this.table = deal(bet, this.rng, this.table?.shoe ?? null)
    } else {
      if (!this.table) throw new Error('Place a bet first.')
      const before = structuredClone(this.table)
      const stake = act(this.table, action, this.rng)
      if (stake === null) throw new Error('You can\'t do that with this hand.')
      try {
        this.take(stake, 'to cover that')
      } catch (error) {
        this.table = before
        throw error
      }
    }
    if (this.table.phase === 'settled') this.balance = (this.balance ?? 0) + this.table.payout
    return publicView(this.table)
  }
}
