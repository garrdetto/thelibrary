import { ITEMS, ITEM_BY_ID, TASK_BY_ID } from '../shared/Economy'
import type { Item, Slot } from '../shared/Economy'
import type { Progress } from '../game/Progress'
import { SPECIES_BY_ID, formatValue } from '../systems/LootTableManager'
import type { Specimen } from '../systems/LootTableManager'
import type { CabinSpot } from '../world/Cabin'

export type PanelTab = 'gear' | 'wardrobe' | 'shop' | 'tasks' | 'bag'

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'gear', label: 'Gear' },
  { id: 'wardrobe', label: 'Wardrobe' },
  { id: 'shop', label: 'Catalog' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'bag', label: 'Bag' },
]

const GEAR_SLOTS: { slot: Slot; label: string }[] = [
  { slot: 'rod', label: 'Rod' }, { slot: 'reel', label: 'Reel' }, { slot: 'line', label: 'Line' }, { slot: 'bait', label: 'Bait' },
  { slot: 'rifle', label: 'Rifle' }, { slot: 'scope', label: 'Scope' }, { slot: 'call', label: 'Call' }, { slot: 'scent', label: 'Scent' },
  { slot: 'motor', label: 'Boat motor' }, { slot: 'utvKit', label: 'UTV' },
]
const WARDROBE_SLOTS: { slot: Slot; label: string }[] = [
  { slot: 'jacket', label: 'Jacket' }, { slot: 'vest', label: 'Vest' }, { slot: 'cap', label: 'Hat' }, { slot: 'pants', label: 'Pants' }, { slot: 'pack', label: 'Pack' },
]

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

export class Panels {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly cash: HTMLElement
  private readonly note: HTMLElement
  private readonly tabs = new Map<PanelTab, HTMLButtonElement>()
  private tab: PanelTab = 'gear'
  private spot: CabinSpot | null = null
  private onClose: () => void = () => undefined
  bag: () => Specimen[] = () => []

  constructor(private readonly progress: Progress) {
    this.root = h('div', 'rr-screen panel-screen')
    this.root.id = 'panel'
    this.root.hidden = true
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-label', 'Cabin and inventory')
    const card = h('div', 'rr-card panel-card')
    const head = h('div', 'panel-head')
    const title = h('h2', undefined, 'Cabin & inventory')
    this.cash = h('b', 'panel-cash')
    head.append(title, this.cash)
    const tabRow = h('div', 'panel-tabs')
    tabRow.setAttribute('role', 'tablist')
    for (const t of TABS) {
      const b = h('button', 'rr-btn panel-tab', t.label)
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.addEventListener('click', () => this.show(t.id))
      this.tabs.set(t.id, b)
      tabRow.append(b)
    }
    this.note = h('p', 'panel-note')
    this.body = h('div', 'panel-body')
    const actions = h('div', 'rr-actions')
    const close = h('button', 'rr-btn primary', 'Close')
    close.type = 'button'
    close.addEventListener('click', () => this.close())
    actions.append(close)
    card.append(head, tabRow, this.note, this.body, actions)
    this.root.append(card)
    document.body.append(this.root)
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.code === 'KeyI') {
        e.preventDefault()
        this.close()
      }
    })
    progress.onChange = () => {
      this.renderCash()
      if (!this.root.hidden) this.render()
    }
    this.renderCash()
  }

  get open(): boolean {
    return !this.root.hidden
  }

  renderCash(): void {
    this.cash.textContent = `$${this.progress.profile.cash.toLocaleString()}${this.progress.signedIn ? '' : ' · guest'}`
    const chip = document.getElementById('cash-amount')
    if (chip) chip.textContent = `$${this.progress.profile.cash.toLocaleString()}`
  }

  openAt(tab: PanelTab, spot: CabinSpot | null, onClose: () => void): void {
    this.spot = spot
    this.onClose = onClose
    this.root.hidden = false
    this.show(tab)
    this.tabs.get(tab)?.focus()
  }

  close(): void {
    if (this.root.hidden) return
    this.root.hidden = true
    this.onClose()
  }

  private show(tab: PanelTab): void {
    this.tab = tab
    for (const [id, b] of this.tabs) b.setAttribute('aria-selected', String(id === tab))
    this.render()
  }

  private render(): void {
    this.renderCash()
    this.body.replaceChildren()
    const p = this.progress.profile
    const guest = this.progress.signedIn ? '' : ' Sign in on the library to keep your cash and gear between visits.'
    if (this.tab === 'gear') {
      this.note.textContent = (this.spot === 'rack' ? 'Pick what you carry. Changes take effect right away.' : 'Change gear at the cabin gear rack.') + guest
      this.slots(GEAR_SLOTS, this.spot === 'rack')
    } else if (this.tab === 'wardrobe') {
      this.note.textContent = (this.spot === 'wardrobe' ? 'Change clothes for the outing.' : 'Change clothes at the cabin wardrobe.') + guest
      this.slots(WARDROBE_SLOTS, this.spot === 'wardrobe')
    } else if (this.tab === 'shop') {
      this.note.textContent = (this.spot === 'desk' ? 'Order from the outfitter\'s catalog. Paid in cash earned from fish, game, tasks and time outdoors.' : 'Order at the trading desk inside the cabin.') + guest
      const groups = new Map<string, Item[]>()
      for (const item of ITEMS) {
        if (item.price === 0) continue
        if (!groups.has(item.group)) groups.set(item.group, [])
        groups.get(item.group)!.push(item)
      }
      for (const [group, items] of groups) {
        const section = h('section', 'panel-section')
        section.append(h('h3', undefined, group))
        for (const item of items) {
          const owned = p.owned.includes(item.id)
          const row = this.row(item.name, item.blurb, owned ? 'Owned' : `$${item.price.toLocaleString()}`)
          const b = h('button', 'rr-btn', owned ? 'Owned' : 'Buy')
          b.type = 'button'
          b.disabled = owned || this.spot !== 'desk' || p.cash < item.price
          b.addEventListener('click', async () => {
            b.disabled = true
            const error = await this.progress.buy(item.id)
            this.flash(error ?? `${item.name} bought${item.slot === 'vehicle' ? ' — parked beside the cabin' : ' and equipped'}.`, Boolean(error))
          })
          row.append(b)
          section.append(row)
        }
        this.body.append(section)
      }
    } else if (this.tab === 'tasks') {
      this.note.textContent = 'Complete a task to collect its reward; a new one takes its place.'
      for (const t of p.tasks) {
        const def = TASK_BY_ID[t.id]
        const row = this.row(def.text, `${Math.min(t.progress, def.goal)} of ${def.goal}`, `$${def.reward}`)
        const meter = h('div', 'meter')
        const fill = h('i')
        fill.style.width = `${Math.round((Math.min(t.progress, def.goal) / def.goal) * 100)}%`
        meter.append(fill)
        row.append(meter)
        this.body.append(row)
      }
      const s = p.stats
      this.body.append(h('p', 'panel-note', `Lifetime: ${s.fish} fish, ${s.deer} deer, ${s.bears} bears, ${s.records} records · $${s.earned.toLocaleString()} earned.`))
    } else {
      this.note.textContent = 'What you have taken this outing.'
      const bag = this.bag()
      if (!bag.length) this.body.append(h('p', 'panel-note', 'Nothing yet. Fish the weed edges or glass the oak opening from a stand.'))
      for (const s of bag) {
        const name = SPECIES_BY_ID[s.species].name
        this.body.append(this.row(s.value ? `${name} · ${formatValue(s.species, s.value)}` : `${name} · antlerless, ${s.weightLb} lb`, s.legendary ? 'Record-class' : s.trophyPoints ? `${s.trophyPoints} trophy pts` : '', ''))
      }
    }
  }

  private slots(slots: { slot: Slot; label: string }[], editable: boolean): void {
    const p = this.progress.profile
    for (const { slot, label } of slots) {
      const section = h('section', 'panel-section')
      section.append(h('h3', undefined, label))
      const options = ITEMS.filter((i) => i.slot === slot && p.owned.includes(i.id))
      if (slot === 'call' || slot === 'scent') options.unshift({ id: '', name: 'None', slot, group: 'Hunting', price: 0, blurb: 'Leave it at the cabin.' })
      if (!options.length) section.append(h('p', 'panel-note', 'Nothing owned yet — see the catalog.'))
      for (const item of options) {
        const on = p.loadout[slot] === item.id
        const row = this.row(item.name, item.blurb, on ? 'Equipped' : '')
        const b = h('button', 'rr-btn', on ? 'Equipped' : 'Use')
        b.type = 'button'
        b.disabled = on || !editable
        b.addEventListener('click', async () => {
          const error = await this.progress.equip(slot, item.id)
          if (error) this.flash(error, true)
        })
        row.append(b)
        section.append(row)
      }
      const locked = ITEMS.filter((i) => i.slot === slot && !p.owned.includes(i.id))
      if (locked.length) section.append(h('p', 'panel-note', `In the catalog: ${locked.map((i) => `${i.name} ($${i.price})`).join(', ')}`))
      this.body.append(section)
    }
  }

  private row(title: string, sub: string, tag: string): HTMLDivElement {
    const row = h('div', 'panel-row')
    const text = h('div')
    text.append(h('strong', undefined, title), h('small', undefined, sub))
    row.append(text)
    if (tag) row.append(h('span', 'tier', tag))
    return row
  }

  private flash(text: string, warn: boolean): void {
    this.note.textContent = text
    this.note.classList.toggle('warn', warn)
  }
}

export function itemName(id: string): string {
  return ITEM_BY_ID[id]?.name ?? id
}
