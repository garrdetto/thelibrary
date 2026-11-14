/**
 * The counter at a place you walk into: a menu to buy from (bars, diners,
 * the candy store, Kwik Trip, groceries, hardware), the bank's loans and
 * repayments, and the work on offer (deliveries, fire calls). Every purchase
 * and loan goes to the shared world, which checks you are at the door and
 * answers with your account; the panel redraws from it.
 */
import type { Account, ShopItem } from '../../maplestreet/shared/Economy'
import { LOAN_DAILY_RATE, SHOP_ITEMS, availableCredit } from '../../maplestreet/shared/Economy'
import type { ClientMsg, Job, JobOffer } from '../../maplestreet/shared/Protocol'
import type { ShopKind } from '../../maplestreet/shared/WorldLayout'

export type PlaceKind = ShopKind | 'depot' | 'fire'

export interface Place {
  /** The shop id the authority knows (`buy`), or the desk's own id. */
  id: string
  kind: PlaceKind
  name: string
  /** The front door, in the town frame. */
  x: number
  z: number
  area: 'foxplains' | 'montello'
  street?: string
  /** The job on offer at this counter. */
  work?: JobOffer
}

export interface PanelHooks {
  send(m: ClientMsg): void
  account(): Account | null
  job(): Job | null
  signedIn(): boolean
  onClose(): void
}

const KIND_LABEL: Record<PlaceKind, string> = {
  gas: 'Fuel and convenience',
  bar: 'Bar and grill',
  diner: 'Restaurant',
  cafe: 'Sweets and coffee',
  grocery: 'Groceries',
  hardware: 'Hardware',
  bank: 'Bank',
  clothing: 'Clothing',
  dealer: 'Vehicles',
  depot: 'Freight depot',
  fire: 'Fire department',
}

const WORK: Record<JobOffer, { title: string; blurb: string; button: string }> = {
  delivery: { title: 'Delivery work', blurb: 'Load cargo here in your pickup and drive it to a house in Fox Plains. Pay goes up with the distance.', button: 'Take a delivery' },
  montello: { title: 'Deliveries for Kwik Trip', blurb: 'Load an order into your pickup and drive it to a house in Montello. Pay goes up with the distance.', button: 'Take a delivery' },
  fire: { title: 'Volunteer firefighter', blurb: 'Gear up, drive to the house on fire and hold the hose on it until it is out. $600 a call plus the drive.', button: 'Answer a fire call' },
}

const BORROW = [1_000, 5_000, 10_000]
const REPAY = [1_000, 5_000]

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`

export class PlacePanel {
  private readonly root: HTMLDivElement
  private readonly eyebrow: HTMLElement
  private readonly title: HTMLElement
  private readonly cash: HTMLElement
  private readonly note: HTMLElement
  private readonly body: HTMLDivElement
  private readonly close: HTMLButtonElement
  private place: Place | null = null

  constructor(private readonly hooks: PanelHooks) {
    this.root = el('div', 'rr-screen panel-screen fl-place-screen')
    this.root.hidden = true
    this.root.dataset.hostModal = ''
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    const card = el('div', 'rr-card panel-card fl-place-card')
    const head = el('div', 'panel-head')
    const titles = el('div', 'fl-place-titles')
    this.eyebrow = el('span', 'rr-eyebrow')
    this.title = el('h2')
    this.title.id = 'fl-place-title'
    this.root.setAttribute('aria-labelledby', this.title.id)
    titles.append(this.eyebrow, this.title)
    this.cash = el('b', 'panel-cash')
    head.append(titles, this.cash)
    this.note = el('p', 'panel-note')
    this.body = el('div', 'panel-body')
    const actions = el('div', 'rr-actions')
    this.close = el('button', 'rr-btn primary', 'Leave (Esc)')
    this.close.type = 'button'
    this.close.addEventListener('click', () => this.hide())
    actions.append(this.close)
    card.append(head, this.note, this.body, actions)
    this.root.append(card)
    document.body.append(this.root)
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) {
        e.preventDefault()
        e.stopPropagation()
        this.hide()
      }
    })
  }

  get open(): boolean {
    return !this.root.hidden
  }

  show(place: Place): void {
    this.place = place
    this.root.hidden = false
    if (document.pointerLockElement) document.exitPointerLock()
    this.render()
    const first = this.body.querySelector<HTMLButtonElement>('button:not(:disabled)')
    ;(first ?? this.close).focus()
  }

  hide(): void {
    if (this.root.hidden) return
    this.root.hidden = true
    this.place = null
    this.hooks.onClose()
  }

  /** The account or the job changed: redraw what the buttons allow. */
  refresh(): void {
    if (!this.root.hidden) this.render()
  }

  private render(): void {
    const place = this.place
    if (!place) return
    const acc = this.hooks.account()
    const focused = document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement) ? document.activeElement.dataset.key : undefined
    this.eyebrow.textContent = `${KIND_LABEL[place.kind]}${place.area === 'montello' ? ' · Montello' : ' · Fox Plains'}`
    this.title.textContent = place.name
    this.cash.textContent = acc ? `${money(acc.money)}${this.hooks.signedIn() ? '' : ' · guest'}` : ''
    this.note.textContent = place.street ? `${place.street}` : ''
    this.note.hidden = !place.street
    this.body.replaceChildren()
    if (!acc) {
      this.body.append(el('p', 'panel-note', 'Connecting to the shared world…'))
      return
    }
    if (place.kind === 'bank') this.body.append(this.bank(acc))
    const items = place.kind === 'bank' || place.kind === 'fire' || place.kind === 'depot' ? [] : SHOP_ITEMS[place.kind] ?? []
    if (items.length) this.body.append(this.menu(place, acc, items))
    if (place.work) this.body.append(this.work(place.work))
    if (focused) this.body.querySelector<HTMLElement>(`[data-key="${CSS.escape(focused)}"]`)?.focus()
  }

  private section(title: string): HTMLElement {
    const s = el('section', 'panel-section')
    s.append(el('h3', undefined, title))
    return s
  }

  private button(key: string, text: string, label: string, enabled: boolean, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'rr-btn', text)
    b.type = 'button'
    b.dataset.key = key
    b.disabled = !enabled
    b.setAttribute('aria-label', label)
    b.addEventListener('click', onClick)
    return b
  }

  private menu(place: Place, acc: Account, items: ShopItem[]): HTMLElement {
    const s = this.section(place.kind === 'bar' ? 'Behind the bar' : place.kind === 'hardware' ? 'Upgrades' : 'Menu')
    for (const item of items) {
      const row = el('div', 'panel-row')
      const text = el('div')
      text.append(el('strong', undefined, item.name), el('small', undefined, item.blurb))
      const owned = !!item.upgrade && acc.upgrades.includes(item.upgrade)
      const b = this.button(`buy:${item.id}`, owned ? 'Owned' : `Buy · ${money(item.price)}`, `Buy ${item.name} for ${money(item.price)}`, !owned && acc.money >= item.price, () => this.hooks.send({ t: 'buy', shop: place.id, item: item.id }))
      row.append(text, b)
      s.append(row)
    }
    return s
  }

  private bank(acc: Account): HTMLElement {
    const s = this.section('Your accounts')
    const credit = availableCredit(acc)
    const facts = el('div', 'fl-bank-facts')
    const fact = (label: string, value: string) => {
      const f = el('div', 'fl-bank-fact')
      f.append(el('small', undefined, label), el('strong', undefined, value))
      return f
    }
    facts.append(fact('Wallet', money(acc.money)), fact('Loan balance', money(acc.debt)), fact('You can borrow', money(credit)))
    s.append(facts)
    s.append(el('small', 'fl-bank-terms', `Loans cost ${Math.round(LOAN_DAILY_RATE * 100)}% a day while you are in town when the day turns. Your limit grows with what you earn.`))
    const borrow = el('div', 'fl-bank-row')
    borrow.append(el('span', 'fl-bank-label', 'Borrow'))
    for (const amount of BORROW) borrow.append(this.button(`loan:${amount}`, money(amount), `Borrow ${money(amount)}`, amount <= credit, () => this.hooks.send({ t: 'loan', amount })))
    if (credit > 0 && !BORROW.includes(credit)) borrow.append(this.button('loan:all', `All · ${money(credit)}`, `Borrow all ${money(credit)} of your credit`, true, () => this.hooks.send({ t: 'loan', amount: credit })))
    const repay = el('div', 'fl-bank-row')
    repay.append(el('span', 'fl-bank-label', 'Repay'))
    const most = Math.floor(Math.min(acc.debt, acc.money))
    for (const amount of REPAY) repay.append(this.button(`repay:${amount}`, money(amount), `Repay ${money(amount)}`, acc.debt >= amount && acc.money >= amount, () => this.hooks.send({ t: 'repay', amount })))
    repay.append(this.button('repay:all', most > 0 ? `All I can · ${money(most)}` : 'Nothing owed', `Repay ${money(most)}`, most > 0, () => this.hooks.send({ t: 'repay', amount: most })))
    s.append(borrow, repay)
    return s
  }

  private work(offer: JobOffer): HTMLElement {
    const w = WORK[offer]
    const s = this.section(w.title)
    const row = el('div', 'panel-row')
    const text = el('div')
    const job = this.hooks.job()
    text.append(el('small', undefined, job ? 'Finish the job you are on first.' : w.blurb))
    const b = this.button(`work:${offer}`, job ? 'On a job' : w.button, w.button, !job, () => {
      this.hooks.send({ t: 'jobRequest', kind: offer })
      this.hide()
    })
    row.append(text, b)
    s.append(row)
    return s
  }
}
