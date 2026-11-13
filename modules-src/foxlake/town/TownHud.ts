/**
 * Fox Lake's own chips beside Rack & Reel's HUD: the wallet (one balance for
 * signed-in players, shared by Fox Lake, Fox Plains and Rack & Reel), who is
 * around, which part of Fox Lake you are in and the connection. The corner map
 * is FoxMinimap.ts.
 */
import type { Account } from '../../maplestreet/shared/Economy'

export class TownHud {
  private readonly wallet = document.getElementById('town-wallet')
  private readonly walletAmount = document.getElementById('town-wallet-amount')
  private readonly walletLabel = document.getElementById('town-wallet-label')
  private readonly lakeCash = document.getElementById('cash')
  private readonly status = document.getElementById('town-status')
  private lastStatus = ''

  setAccount(acc: Account, signedIn: boolean): void {
    if (this.walletAmount) this.walletAmount.textContent = `$${Math.round(acc.money).toLocaleString()}`
    if (this.walletLabel) this.walletLabel.textContent = signedIn ? 'Wallet' : 'Town cash'
    if (this.wallet) this.wallet.hidden = false
    if (this.lakeCash) this.lakeCash.hidden = signedIn
  }

  setStatus(net: string, neighbors: number, zone: 'town' | 'country'): void {
    const text = `${zone === 'town' ? 'Fox Plains' : 'Bear Paw Lake country'} · ${neighbors} neighbor${neighbors === 1 ? '' : 's'} · ${net}`
    if (text === this.lastStatus || !this.status) return
    this.lastStatus = text
    this.status.textContent = text
  }
}
