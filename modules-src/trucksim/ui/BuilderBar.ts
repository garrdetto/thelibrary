/**
 * The bottom toolbar of the lot builder: category tabs, a button per build definition with its cost unit, Rotate, colour inputs for
 * colourable definitions, a Demolish toggle, the cash on hand, a hint line and Done, plus a Land tab that shows the lot's size and
 * sells the next strip of land. The game owns the placing and buying; this only reports picks.
 */
import { BUILDINGS } from '../shared/Catalog'
import type { BuildCategory, BuildDef } from '../shared/Catalog'
import { h, money, prepareRoot } from './dom'

export interface BuilderBarOptions {
  defs?: readonly BuildDef[]
  cash: number
  onPick(defId: string): void
  onRotate(): void
  onColor(color: string, color2: string | undefined): void
  onDemolish(on: boolean): void
  onDone(): void
  land?: LandOffer
  onBuyLand?(): void
  onPreviewLand?(on: boolean): void
}

/** The lot's land as the Land tab shows it. */
export interface LandOffer {
  strips: number
  max: number
  stripM: number
  width: number
  depth: number
  price: number | null
}

type BarTab = BuildCategory | 'land'

const CATEGORIES: readonly [BarTab, string][] = [['paving', 'Paving'], ['structure', 'Buildings'], ['addon', 'Add-ons'], ['fence', 'Fences'], ['land', 'Land']]

/** The cost unit shown beside a definition's price. */
export function costUnit(def: BuildDef): string {
  return def.mode === 'line' ? 'per m' : def.mode === 'drag' ? 'per m²' : 'each'
}

/** The lot builder toolbar. Mount once when build mode starts and `dispose()` when it ends. */
export class BuilderBar {
  private readonly bar: HTMLElement
  private readonly defs: readonly BuildDef[]
  private readonly options: BuilderBarOptions
  private readonly tabs = h('div', { class: 'ts-tabs', attrs: { role: 'tablist' } })
  private readonly items = h('div', { class: 'ts-build-items' })
  private readonly cash = h('b', { class: 'ts-cash' })
  private readonly hint = h('p', { class: 'ts-hint', attrs: { 'aria-live': 'polite' } })
  private readonly colorOne = h('input', { class: 'ts-color', attrs: { type: 'color', 'aria-label': 'Main colour', value: '#8d969e' } })
  private readonly colorTwo = h('input', { class: 'ts-color', attrs: { type: 'color', 'aria-label': 'Trim colour', value: '#2b4f7a' } })
  private readonly colors = h('div', { class: 'ts-build-colors' })
  private readonly demolish = h('button', { class: 'ts-btn', text: 'Demolish', attrs: { type: 'button', 'aria-pressed': 'false' } })
  private category: BarTab = 'paving'
  private land: LandOffer | null
  private selected: string | null = null
  private demolishing = false

  constructor(root: HTMLElement, options: BuilderBarOptions) {
    prepareRoot(root)
    this.options = options
    this.land = options.land ?? null
    this.defs = options.defs ?? BUILDINGS
    const rotate = h('button', { class: 'ts-btn', attrs: { type: 'button' }, on: { click: () => options.onRotate() } }, 'Rotate ', h('kbd', { text: 'R' }))
    const done = h('button', { class: 'ts-btn primary', text: 'Done', attrs: { type: 'button' }, on: { click: () => options.onDone() } })
    this.demolish.addEventListener('click', () => this.options.onDemolish(!this.demolishing))
    const report = (): void => options.onColor(this.colorOne.value, this.colorTwo.hidden ? undefined : this.colorTwo.value)
    this.colorOne.addEventListener('input', report)
    this.colorTwo.addEventListener('input', report)
    this.colors.append(h('label', { class: 'ts-label' }, 'Colour ', this.colorOne), h('label', { class: 'ts-label' }, 'Trim ', this.colorTwo))
    this.colors.hidden = true
    this.bar = h('div', { class: 'ts-builder', attrs: { role: 'toolbar', 'aria-label': 'Lot builder' } },
      h('div', { class: 'ts-build-top' }, this.tabs, h('span', { class: 'ts-note' }, 'Cash ', this.cash)),
      this.items,
      h('div', { class: 'ts-build-bottom' }, rotate, this.colors, this.demolish, this.hint, done))
    root.appendChild(this.bar)
    this.setCash(options.cash)
    this.renderTabs()
    this.renderItems()
  }

  setCash(cash: number): void {
    this.cash.textContent = money(cash)
  }

  setSelected(id: string | null): void {
    this.selected = id
    const def = this.defs.find((entry) => entry.id === id)
    if (def) {
      this.category = def.category
      this.colors.hidden = !def.colorable
      this.colorOne.value = def.defaultColor
      this.colorTwo.hidden = !def.defaultColor2
      this.colorTwo.parentElement!.hidden = !def.defaultColor2
      if (def.defaultColor2) this.colorTwo.value = def.defaultColor2
    } else {
      this.colors.hidden = true
    }
    this.renderTabs()
    this.renderItems()
  }

  /** Updates the Land tab after a purchase. */
  setLand(land: LandOffer): void {
    this.land = land
    if (this.category === 'land') this.renderItems()
  }

  setHint(text: string): void {
    this.hint.textContent = text
  }

  setDemolish(on: boolean): void {
    this.demolishing = on
    this.demolish.setAttribute('aria-pressed', on ? 'true' : 'false')
    this.demolish.classList.toggle('bad', on)
  }

  dispose(): void {
    this.bar.remove()
  }

  private renderTabs(): void {
    this.tabs.replaceChildren()
    for (const [id, label] of CATEGORIES) {
      if (id === 'land' && !this.land) continue
      this.tabs.appendChild(h('button', { class: `ts-tab${this.category === id ? ' on' : ''}`, text: label, attrs: { type: 'button', role: 'tab', 'aria-selected': this.category === id ? 'true' : 'false' }, on: { click: () => { this.category = id; this.renderTabs(); this.renderItems() } } }))
    }
  }

  private renderItems(): void {
    this.items.replaceChildren()
    if (this.category === 'land') {
      this.renderLand()
      return
    }
    for (const def of this.defs) {
      if (def.category !== this.category) continue
      const on = def.id === this.selected
      this.items.appendChild(h('button', {
        class: `ts-build-item${on ? ' on' : ''}`,
        attrs: { type: 'button', 'aria-pressed': on ? 'true' : 'false', title: def.blurb },
        on: { click: () => this.options.onPick(def.id) },
      }, h('b', { text: def.name }), h('span', { text: `${money(def.cost)} ${costUnit(def)}` })))
    }
  }

  private renderLand(): void {
    const land = this.land
    if (!land) return
    const size = h('div', { class: 'ts-build-item' }, h('b', { text: `${land.width} × ${land.depth} m` }), h('span', { text: `${land.strips} of ${land.max} extra strips` }))
    this.items.appendChild(size)
    if (land.price === null) {
      this.items.appendChild(h('div', { class: 'ts-build-item' }, h('b', { text: 'Fully grown' }), h('span', { text: 'No more land next to this lot' })))
      return
    }
    const preview = (on: boolean) => () => this.options.onPreviewLand?.(on)
    this.items.appendChild(h('button', {
      class: 'ts-build-item',
      attrs: { type: 'button', title: `Adds a ${land.stripM} m strip along the back of the lot` },
      on: { click: () => this.options.onBuyLand?.(), mouseenter: preview(true), mouseleave: preview(false), focus: preview(true), blur: preview(false) },
    }, h('b', { text: `Buy ${land.stripM} m more land` }), h('span', { text: money(land.price) })))
  }
}
