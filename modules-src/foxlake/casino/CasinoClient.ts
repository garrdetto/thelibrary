/**
 * The casino cage: signed-in players play for their wallet through
 * /api/casino (spins and hands decided on the server); guests and solo play
 * run the same rules here with fun money that is never saved.
 */
import { cryptoRng } from './math/rng'
import { MACHINE_BY_ID, playSpin, type MachineState, type SpinResult } from './math/machines'
import { act, deal, publicView, type Action, type BlackjackView, type Table } from './math/blackjack'
import { BAR } from './CasinoLayout'

const FUN_START = 1000

export class CasinoClient {
  signedIn = false
  /** The wallet (signed in) or fun money (guests). */
  balance: number | null = null
  private readonly local = typeof location === 'undefined' || !/^https?:$/.test(location.protocol) || new URLSearchParams(location.search).has('solo')
  private readonly rng = cryptoRng()
  private readonly states = new Map<string, MachineState>()
  private table: Table | null = null

  get fun(): boolean {
    return !this.signedIn
  }

  async refresh(): Promise<void> {
    if (this.local) {
      this.balance ??= FUN_START
      return
    }
    try {
      const res = await fetch('/api/casino', { credentials: 'same-origin', cache: 'no-store' })
      const data = (await res.json()) as { signedIn?: boolean; balance?: number | null }
      this.signedIn = Boolean(data.signedIn)
      this.balance = this.signedIn ? data.balance ?? null : this.balance ?? FUN_START
    } catch {
      this.balance ??= FUN_START
    }
  }

  private async post<T>(body: Record<string, unknown>): Promise<T> {
    const res = await fetch('/api/casino', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) throw new Error(data.error ?? 'The cage is closed right now.')
    return data
  }

  async spin(machine: string, bet: number): Promise<SpinResult> {
    if (this.signedIn) {
      const r = await this.post<{ result: SpinResult; balance: number | null }>({ action: 'spin', machine, bet })
      if (r.balance !== null) this.balance = r.balance
      return r.result
    }
    const def = MACHINE_BY_ID[machine]
    if ((this.balance ?? 0) < bet) throw new Error('Out of fun money. Stand up and sit back down for a fresh $1,000.')
    const result = playSpin(def, bet, this.rng, this.states.get(machine) ?? {})
    this.states.set(machine, result.state)
    this.balance = Math.round(((this.balance ?? 0) - bet + result.totalWin) * 100) / 100
    return result
  }

  /** Tops guests back up when they sit down broke. */
  refill(): void {
    if (this.fun && (this.balance ?? 0) < 1) this.balance = FUN_START
  }

  meters(machine: string): MachineState['meters'] {
    return this.states.get(machine)?.meters
  }

  async drink(): Promise<void> {
    if (this.signedIn) {
      const r = await this.post<{ balance: number }>({ action: 'drink' })
      this.balance = r.balance
      return
    }
    if ((this.balance ?? 0) < BAR.beerPrice) throw new Error('Not enough fun money for a beer.')
    this.balance = (this.balance ?? 0) - BAR.beerPrice
  }

  async blackjack(action: 'deal' | Action, bet = 0): Promise<BlackjackView> {
    if (this.signedIn) {
      const r = await this.post<{ table: BlackjackView; balance: number | null }>(action === 'deal' ? { action: 'bj-deal', bet } : { action: 'bj-act', act: action })
      if (r.balance !== null) this.balance = r.balance
      else if (action === 'deal') this.balance = (this.balance ?? 0) - bet
      return r.table
    }
    if (action === 'deal') {
      if ((this.balance ?? 0) < bet) throw new Error('Not enough fun money for that bet.')
      this.balance = (this.balance ?? 0) - bet
      this.table = deal(bet, this.rng, this.table?.shoe ?? null)
    } else {
      if (!this.table) throw new Error('Place a bet first.')
      const stake = act(this.table, action, this.rng)
      if (stake === null) throw new Error('You can\'t do that with this hand.')
      if (stake > (this.balance ?? 0)) throw new Error('Not enough fun money to cover that.')
      this.balance = (this.balance ?? 0) - stake
    }
    if (this.table.phase === 'settled') this.balance = (this.balance ?? 0) + this.table.payout
    return publicView(this.table)
  }
}
