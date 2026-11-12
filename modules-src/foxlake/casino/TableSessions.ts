/**
 * The blackjack table and the bar, as overlays over the 3D room (the camera
 * looks at the table or the bartender while one is open). Blackjack hands are
 * dealt by `CasinoClient` (the server for signed-in players); the bar sells a
 * beer from the wallet and puts it on the counter in front of you.
 */
import type { CasinoClient } from './CasinoClient'
import { BAR, BLACKJACK_BETS } from './CasinoLayout'
import type { BlackjackView } from './math/blackjack'
import { money } from './screen/MachineDisplay'

const SUITS: Record<string, { glyph: string; red: boolean }> = { S: { glyph: '♠', red: false }, H: { glyph: '♥', red: true }, D: { glyph: '♦', red: true }, C: { glyph: '♣', red: false } }
const PIPS: Record<string, [number, number][]> = {
  A: [[50, 50]], '2': [[50, 20], [50, 80]], '3': [[50, 20], [50, 50], [50, 80]], '4': [[30, 20], [70, 20], [30, 80], [70, 80]],
  '5': [[30, 20], [70, 20], [50, 50], [30, 80], [70, 80]], '6': [[30, 20], [70, 20], [30, 50], [70, 50], [30, 80], [70, 80]],
  '7': [[30, 20], [70, 20], [50, 35], [30, 50], [70, 50], [30, 80], [70, 80]], '8': [[30, 20], [70, 20], [50, 35], [30, 50], [70, 50], [50, 65], [30, 80], [70, 80]],
  '9': [[30, 18], [70, 18], [30, 39], [70, 39], [50, 50], [30, 61], [70, 61], [30, 82], [70, 82]],
  '10': [[30, 18], [70, 18], [50, 29], [30, 40], [70, 40], [30, 60], [70, 60], [50, 71], [30, 82], [70, 82]],
}
const FACE: Record<string, string> = { J: '🤴', Q: '👸', K: '🤴' }

function cardHtml(card: string, i: number): string {
  if (card === '??') return `<div class="card back" style="--i:${i}"></div>`
  const rank = card.slice(0, -1)
  const s = SUITS[card.slice(-1)]
  const pips = PIPS[rank]
  const body = pips
    ? pips.map(([x, y]) => `<span class="pip" style="left:${x}%;top:${y}%;${y > 50 ? 'transform:translate(-50%,-50%) rotate(180deg)' : ''}">${s.glyph}</span>`).join('')
    : `<span class="face">${FACE[rank]}<i>${s.glyph}</i></span>`
  return `<div class="card${s.red ? ' red' : ''}" style="--i:${i}"><b class="tl">${rank}<br>${s.glyph}</b>${body}<b class="br">${rank}<br>${s.glyph}</b></div>`
}

export class BlackjackSession {
  private readonly el: HTMLElement
  private bet: number = BLACKJACK_BETS[1]
  private view: BlackjackView | null = null
  private busy = false
  private readonly keys = (e: KeyboardEvent) => { if (e.code === 'Escape') this.close() }

  constructor(private readonly client: CasinoClient, private readonly toast: (t: string) => void, private readonly onLeave: () => void) {
    this.client.refill()
    this.el = document.createElement('div')
    this.el.id = 'bj-ui'
    this.el.dataset.hostModal = '1'
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button')
      if (!b) return
      if (b.dataset.chip) this.bet = Number(b.dataset.chip)
      else if (b.dataset.act === 'leave') return this.close()
      else if (b.dataset.act) void this.act(b.dataset.act as 'deal')
      this.render()
    })
    document.body.append(this.el)
    addEventListener('keydown', this.keys)
    this.render()
  }

  private async act(action: 'deal' | 'hit' | 'stand' | 'double' | 'split'): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      this.view = await this.client.blackjack(action, this.bet)
      if (this.view.phase === 'settled') {
        const won = this.view.payout
        const staked = this.view.hands.reduce((a, h) => a + h.bet, 0)
        this.toast(won > staked ? `You win ${money(won - staked)}.` : won === staked ? 'Push.' : 'Dealer wins.')
      }
    } catch (error) {
      this.toast((error as Error).message)
    } finally {
      this.busy = false
      this.render()
    }
  }

  private render(): void {
    const v = this.view
    const live = v?.phase === 'player'
    const can = (a: string) => live && v!.allowed.includes(a as never)
    const results = v?.phase === 'settled' ? v.results : []
    this.el.innerHTML = `
      <div class="bj-felt">
        <div class="bj-arc">BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON ALL 17s</div>
        <div class="bj-row dealer"><span class="bj-label">DEALER ${v ? v.dealerTotal : ''}</span><div class="bj-cards">${(v?.dealer ?? []).map(cardHtml).join('')}</div></div>
        ${(v?.hands ?? [{ cards: [], bet: 0, total: 0, done: false, doubled: false }]).map((h, i) => `
          <div class="bj-row hand${live && v!.active === i ? ' active' : ''}"><span class="bj-label">YOU ${h.total || ''}${results[i] ? ` · ${results[i].toUpperCase()}` : ''}</span><div class="bj-cards">${h.cards.map(cardHtml).join('')}</div>${h.bet ? `<span class="bj-chip">${money(h.bet)}</span>` : ''}</div>`).join('')}
      </div>
      <div class="bj-bar">
        <div class="slot-cell"><span>${this.client.fun ? 'FUN MONEY' : 'WALLET'}</span><b>${this.client.balance === null ? '—' : money(this.client.balance)}</b></div>
        <div class="bj-chips">${BLACKJACK_BETS.map((b) => `<button type="button" class="chip-btn${b === this.bet ? ' on' : ''}" data-chip="${b}" ${live ? 'disabled' : ''}>${b}</button>`).join('')}</div>
        <button type="button" data-act="deal" ${live || this.busy ? 'disabled' : ''}>DEAL</button>
        <button type="button" data-act="hit" ${can('hit') ? '' : 'disabled'}>HIT</button>
        <button type="button" data-act="stand" ${can('stand') ? '' : 'disabled'}>STAND</button>
        <button type="button" data-act="double" ${can('double') ? '' : 'disabled'}>DOUBLE</button>
        <button type="button" data-act="split" ${can('split') ? '' : 'disabled'}>SPLIT</button>
        <button type="button" class="leave" data-act="leave">STAND UP</button>
      </div>`
  }

  close(): void {
    if (this.view?.phase === 'player') {
      this.toast('Finish the hand first.')
      return
    }
    removeEventListener('keydown', this.keys)
    this.el.remove()
    this.onLeave()
  }
}

export class BarSession {
  private readonly el: HTMLElement
  private readonly keys = (e: KeyboardEvent) => { if (e.code === 'Escape') this.close() }

  constructor(private readonly client: CasinoClient, private readonly toast: (t: string) => void, private readonly pour: () => void, private readonly onLeave: () => void) {
    this.el = document.createElement('div')
    this.el.id = 'bar-ui'
    this.el.dataset.hostModal = '1'
    this.el.innerHTML = `<div class="bj-bar"><div class="slot-cell"><span>${this.client.fun ? 'FUN MONEY' : 'WALLET'}</span><b data-credit></b></div>
      <button type="button" data-act="beer">ORDER A BEER · ${money(BAR.beerPrice)}</button>
      <button type="button" class="leave" data-act="leave">STAND UP</button></div>`
    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act
      if (act === 'beer') void this.order()
      else if (act === 'leave') this.close()
    })
    document.body.append(this.el)
    addEventListener('keydown', this.keys)
    this.update()
  }

  private update(): void {
    const c = this.el.querySelector('[data-credit]')
    if (c) c.textContent = this.client.balance === null ? '—' : money(this.client.balance)
  }

  private async order(): Promise<void> {
    try {
      await this.client.drink()
      this.pour()
      this.toast(['Ice-cold draft, coming right up.', 'Here you go, bud. Lake country\'s finest.', 'One cold one. Tip jar\'s on the left.'][Math.floor(Math.random() * 3)])
    } catch (error) {
      this.toast((error as Error).message)
    }
    this.update()
  }

  close(): void {
    removeEventListener('keydown', this.keys)
    this.el.remove()
    this.onLeave()
  }
}
