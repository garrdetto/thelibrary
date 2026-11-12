/**
 * Fox Lake's own chips beside Rack & Reel's HUD: the wallet (one balance for
 * signed-in players, shared by Fox Lake, Fox Plains and Rack & Reel), who is
 * around, which part of Fox Lake you are in and the connection.
 */
import type { Account } from '../../maplestreet/shared/Economy'
import type { WorldState } from '../../maplestreet/shared/BuildRules'
import { MiniMap } from '../../maplestreet/src/game/MiniMap'

export class TownHud {
  private readonly wallet = document.getElementById('town-wallet')
  private readonly walletAmount = document.getElementById('town-wallet-amount')
  private readonly walletLabel = document.getElementById('town-wallet-label')
  private readonly lakeCash = document.getElementById('cash')
  private readonly status = document.getElementById('town-status')
  private lastStatus = ''
  /** In town the corner map is the Fox Plains street map (lots, your home, roads); out at the lake it is Rack & Reel's. */
  private readonly townMap: MiniMap | null
  private readonly townCanvas: HTMLCanvasElement | null
  private mapAcc = 0

  constructor() {
    const holder = document.getElementById('minimap')
    if (holder) {
      const canvas = document.createElement('canvas')
      canvas.id = 'town-minimap'
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none'
      holder.style.position = 'fixed'
      holder.append(canvas)
      this.townCanvas = canvas
      this.townMap = new MiniMap(canvas)
    } else {
      this.townCanvas = null
      this.townMap = null
    }
  }

  /** Draws the town map (town coordinates; `heading` is the camera's look direction there) or hides it at the lake. */
  updateMap(dt: number, inTown: boolean, me: { x: number; z: number }, heading: { x: number; y: number }, world: WorldState | null, myId: string | null): void {
    if (!this.townCanvas || !this.townMap) return
    this.townCanvas.style.display = inTown ? 'block' : 'none'
    this.mapAcc += dt
    if (!inTown || this.mapAcc < 0.1) return
    this.townMap.update(this.mapAcc, me, heading, world, myId, null)
    this.mapAcc = 0
  }

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
