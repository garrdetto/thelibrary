/** The tackle-shop window: Wardrobe (face and outfit), Boat (which boat, livery and colours), Shop (rods, reels, boats, motors, electronics, clothes, liveries), Achievements and the Guide's Almanac. Changes preview live on the angler and boat. */
import { ACHIEVEMENTS, TIER_NAMES, anglerTitle } from '../shared/Achievements'
import type { AchievementGroup } from '../shared/Achievements'
import { BOATS, LIVERY_LABELS, liveries } from '../shared/Boats'
import type { BoatKind, BoatPaint } from '../shared/Boats'
import { HAIR_COLORS, PALETTE, SKIN_TONES, STYLE_GROUPS, STYLE_LABELS, bottomStyles, facialHairStyles, hatStyles, paletteColors, shoeStyles, topStyles } from '../shared/Wardrobe'
import type { Look, PaletteColor } from '../shared/Wardrobe'
import { catalog, owns } from '../shared/Shop'
import type { ShopCategory } from '../shared/Shop'
import type { AnglerProfile } from '../shared/Profile'

export type PanelTab = 'wardrobe' | 'boat' | 'shop' | 'achievements' | 'almanac'

export interface PanelHost {
  profile(): AnglerProfile
  signedIn(): boolean
  previewLook(look: Look): void
  saveLook(look: Look): Promise<void>
  previewBoat(kind: BoatKind, paint: BoatPaint): void
  saveBoat(kind: BoatKind, paint: BoatPaint): Promise<void>
  buy(item: string): Promise<void>
  almanac(): string
  closed(): void
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const label = (s: string) => STYLE_LABELS[s] ?? s
const colorName = (c: string) => c.replace(/([A-Z])/g, ' $1').replace(/^./, m => m.toUpperCase())

export class Panels {
  private tab: PanelTab = 'wardrobe'
  private look: Look | null = null
  private boatKind: BoatKind = 'bass'
  private paint: BoatPaint | null = null
  private shopCategory: ShopCategory | 'all' = 'all'
  private readonly root: HTMLElement
  private readonly body: HTMLElement
  private readonly status: HTMLElement
  private busy = false

  constructor(private host: PanelHost) {
    this.root = document.getElementById('panel')!
    this.body = document.getElementById('panel-body')!
    this.status = document.getElementById('panel-status')!
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.addEventListener('click', () => this.show(b.dataset.tab as PanelTab)))
    document.getElementById('panel-close')!.addEventListener('click', () => this.close())
    this.body.addEventListener('click', e => this.click(e))
  }

  get isOpen(): boolean {
    return !this.root.hidden
  }

  open(tab: PanelTab): void {
    const p = this.host.profile()
    this.look = { ...p.look }
    this.boatKind = p.boat
    this.paint = { ...p.paint[p.boat] }
    this.root.hidden = false
    this.show(tab)
  }

  close(): void {
    if (this.root.hidden) return
    this.root.hidden = true
    const p = this.host.profile()
    this.host.previewLook(p.look)
    this.host.previewBoat(p.boat, p.paint[p.boat])
    this.host.closed()
  }

  refresh(): void {
    if (!this.root.hidden) this.render()
  }

  private show(tab: PanelTab): void {
    this.tab = tab
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)))
    this.status.textContent = ''
    this.root.scrollTop = 0
    this.render()
  }

  private render(): void {
    const p = this.host.profile()
    document.getElementById('panel-tc')!.textContent = `${p.tc.toLocaleString()} Tackle Credits`
    if (this.tab === 'wardrobe') this.body.innerHTML = this.wardrobe(p)
    else if (this.tab === 'boat') this.body.innerHTML = this.boat(p)
    else if (this.tab === 'shop') this.body.innerHTML = this.shop(p)
    else if (this.tab === 'almanac') this.body.innerHTML = this.host.almanac()
    else this.body.innerHTML = this.achievements(p)
  }

  private swatches(field: string, value: string, colors: readonly string[], hex: (c: string) => string): string {
    return `<div class="sw-row" role="radiogroup" aria-label="${esc(field)}">${colors.map(c => `<button type="button" class="sw" role="radio" aria-checked="${c === value}" aria-label="${esc(colorName(c))}" title="${esc(colorName(c))}" data-field="${field}" data-value="${c}" style="background:${hex(c)}"></button>`).join('')}</div>`
  }

  private styles(field: string, kind: string, value: string, list: readonly string[], p: AnglerProfile): string {
    return `<div class="opt-row">${list.map(s => {
      const id = `${kind}:${s}`
      const have = kind === 'face' || owns(p, id)
      const price = catalog().find(i => i.id === id)?.price
      return `<button type="button" class="opt" aria-pressed="${s === value}" data-field="${field}" data-value="${s}" ${have ? '' : `data-locked="${id}"`}>${esc(label(s))}${STYLE_GROUPS[s] ? `<small>${STYLE_GROUPS[s]}</small>` : ''}${have ? '' : `<em>${price?.toLocaleString()} TC</em>`}</button>`
    }).join('')}</div>`
  }

  private wardrobe(p: AnglerProfile): string {
    const l = this.look!
    const pal = (c: string) => PALETTE[c as PaletteColor]
    return `
      <div class="pan-grid">
        <section><h3>Face</h3>
          <label>Skin tone</label>${this.swatches('skin', String(l.skin), SKIN_TONES.map((_, i) => String(i)), c => SKIN_TONES[Number(c)])}
          <label>Hair and beard colour</label>${this.swatches('hair', String(l.hair), HAIR_COLORS.map((_, i) => String(i)), c => HAIR_COLORS[Number(c)])}
          <label>Facial hair</label>${this.styles('facialHair', 'face', l.facialHair, facialHairStyles, p)}
          <label>Hat</label>${this.styles('hat', 'hat', l.hat, hatStyles, p)}
          ${l.hat === 'none' ? '' : `<label>Hat colour</label>${this.swatches('hatColor', l.hatColor, paletteColors, pal)}`}
          <div class="opt-row"><button type="button" class="opt" aria-pressed="${l.sunglasses}" data-toggle="sunglasses" ${owns(p, 'acc:sunglasses') ? '' : 'data-locked="acc:sunglasses"'}>Sunglasses${owns(p, 'acc:sunglasses') ? '' : '<em>400 TC</em>'}</button><button type="button" class="opt" aria-pressed="${l.gloves}" data-toggle="gloves">Gloves</button></div>
        </section>
        <section><h3>Top</h3>${this.styles('top', 'top', l.top, topStyles, p)}
          <label>Colour</label>${this.swatches('topColor', l.topColor, paletteColors, pal)}
          <label>${l.top === 'parka' ? 'Sweater' : l.top === 'flannel' ? 'Plaid crossing' : 'Accent'}</label>${this.swatches('topAccent', l.topAccent, paletteColors, pal)}
        </section>
        <section><h3>Bottoms</h3>${this.styles('bottom', 'bottom', l.bottom, bottomStyles, p)}
          <label>Colour</label>${this.swatches('bottomColor', l.bottomColor, paletteColors, pal)}
          <h3>Shoes</h3>${this.styles('shoes', 'shoes', l.shoes, shoeStyles, p)}
          <label>Colour</label>${this.swatches('shoeColor', l.shoeColor, paletteColors, pal)}
        </section>
      </div>
      <div class="pan-actions"><button type="button" class="ang-btn" data-action="reset-look">Undo changes</button><button type="button" class="ang-btn is-primary" data-action="save-look">Wear this</button></div>`
  }

  private boat(p: AnglerProfile): string {
    const paint = this.paint!
    const pal = (c: string) => PALETTE[c as PaletteColor]
    const kinds = Object.keys(BOATS) as BoatKind[]
    const color = (field: keyof BoatPaint, name: string) => `<label>${name}</label>${this.swatches(`paint.${field}`, String(paint[field]), paletteColors, pal)}`
    return `
      <div class="pan-grid">
        <section><h3>Boat</h3><div class="opt-row">${kinds.map(k => {
          const have = p.boats.includes(k)
          return `<button type="button" class="opt" aria-pressed="${k === this.boatKind}" data-boat="${k}" ${have ? '' : `data-locked="boat:${k}"`}>${esc(BOATS[k].name)}<small>${BOATS[k].maxMph} mph · seats 4</small>${have ? '' : `<em>${catalog().find(i => i.id === `boat:${k}`)?.price.toLocaleString()} TC</em>`}</button>`
        }).join('')}</div>
          ${this.boatKind === 'bass' ? `<h3>Livery</h3><div class="opt-row">${liveries.map(l => `<button type="button" class="opt" aria-pressed="${l === paint.livery}" data-field="paint.livery" data-value="${l}" ${owns(p, `livery:${l}`) ? '' : `data-locked="livery:${l}"`}>${LIVERY_LABELS[l]}${owns(p, `livery:${l}`) ? '' : `<em>${catalog().find(i => i.id === `livery:${l}`)?.price.toLocaleString()} TC</em>`}</button>`).join('')}</div>
          <div class="opt-row"><button type="button" class="opt" aria-pressed="${paint.flake}" data-toggle="paint.flake">Metal flake</button></div>` : ''}
        </section>
        <section>${color('primary', this.boatKind === 'pontoon' ? 'Fence panels' : 'Hull')}${color('secondary', 'Lower hull')}${color('trim', 'Stripe and trim')}</section>
        <section>${color('seats', 'Seats')}${color('carpet', this.boatKind === 'pontoon' ? 'Deck' : 'Carpet')}${color('motor', 'Outboard')}</section>
      </div>
      <div class="pan-actions"><button type="button" class="ang-btn" data-action="reset-boat">Undo changes</button><button type="button" class="ang-btn is-primary" data-action="save-boat">${this.boatKind === p.boat ? 'Save paint' : 'Take this boat out'}</button></div>`
  }

  private shop(p: AnglerProfile): string {
    const cats: [ShopCategory | 'all', string][] = [['all', 'Everything'], ['rods', 'Rods'], ['reels', 'Reels'], ['boats', 'Boats'], ['motors', 'Motors'], ['electronics', 'Electronics'], ['tops', 'Tops'], ['bottoms', 'Bottoms'], ['shoes', 'Shoes'], ['hats', 'Hats'], ['extras', 'Extras'], ['paint', 'Liveries']]
    const items = catalog().filter(i => this.shopCategory === 'all' || i.category === this.shopCategory)
    return `
      ${this.host.signedIn() ? '' : '<p class="ang-note">You are fishing as a guest. Purchases last until you close the page; sign in on the library to keep them.</p>'}
      <div class="opt-row">${cats.map(([c, n]) => `<button type="button" class="chip-btn" aria-pressed="${c === this.shopCategory}" data-cat="${c}">${n}</button>`).join('')}</div>
      <div class="shop-grid">${items.map(i => {
        const have = owns(p, i.id)
        const locked = i.requires && !owns(p, i.requires)
        return `<article class="shop-item${have ? ' is-owned' : ''}"><strong>${esc(i.name)}</strong><p>${esc(i.blurb)}</p><div class="ang-row"><span class="price">${have ? 'Owned' : `${i.price.toLocaleString()} TC`}</span>${have ? '' : `<button type="button" class="ang-btn${p.tc >= i.price && !locked ? ' is-primary' : ''}" data-buy="${i.id}" ${p.tc < i.price || locked ? 'disabled' : ''}>${locked ? 'Needs the previous upgrade' : 'Buy'}</button>`}</div></article>`
      }).join('')}</div>`
  }

  private achievements(p: AnglerProfile): string {
    const s = p.stats
    const groups: AchievementGroup[] = ['Playtime', 'Driving', 'Species', 'Size', 'Heartbreak', 'Social']
    const earned = Object.values(p.achievements).reduce((a, b) => a + b, 0)
    const total = ACHIEVEMENTS.reduce((a, b) => a + b.tiers.length, 0)
    return `
      <div class="stat-row">
        <div><small>Title</small><strong>${esc(anglerTitle(p))}</strong></div>
        <div><small>Landed</small><strong>${s.landed.toLocaleString()}</strong></div>
        <div><small>Lost</small><strong>${s.lost.toLocaleString()}</strong></div>
        <div><small>Hours</small><strong>${(s.seconds / 3600).toFixed(1)}</strong></div>
        <div><small>Miles</small><strong>${s.miles.toFixed(1)}</strong></div>
        <div><small>Trophies</small><strong>${((s.tiers.Trophy ?? 0) + (s.tiers.Legendary ?? 0)).toLocaleString()}</strong></div>
        <div><small>Earned</small><strong>${s.tcEarned.toLocaleString()} TC</strong></div>
        <div><small>Achievements</small><strong>${earned} / ${total}</strong></div>
      </div>
      ${groups.map(g => `<h3>${g}</h3><div class="ach-grid">${ACHIEVEMENTS.filter(a => a.group === g).map(a => {
        const tier = p.achievements[a.id] ?? 0
        const value = a.value(p)
        const next = a.tiers[tier]
        const prev = tier > 0 ? a.tiers[tier - 1] : 0
        const pct = next === undefined ? 100 : Math.max(0, Math.min(100, ((value - prev) / (next - prev)) * 100))
        return `<article class="ach${tier ? ` tier-${tier}` : ''}"><div class="ang-row"><strong>${esc(a.name)}</strong><span>${tier ? TIER_NAMES[tier - 1] : 'Locked'}</span></div><p>${esc(next === undefined ? 'Complete' : a.describe(next))}${next === undefined ? '' : ` · ${a.rewards[tier].toLocaleString()} TC`}</p><div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div></article>`
      }).join('')}</div>`).join('')}`
  }

  private click(e: Event): void {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null
    if (!t || this.busy) return
    const d = t.dataset
    if (d.locked) {
      this.status.textContent = `${t.textContent?.replace(/\d[\d,]* TC$/, '').trim()} is sold in the shop.`
      this.shopCategory = 'all'
      this.show('shop')
      return
    }
    if (d.cat) { this.shopCategory = d.cat as ShopCategory | 'all'; this.render(); return }
    if (d.buy) { void this.run(() => this.host.buy(d.buy!), 'Bought it.'); return }
    if (d.boat) {
      this.boatKind = d.boat as BoatKind
      this.paint = { ...this.host.profile().paint[this.boatKind] }
      this.host.previewBoat(this.boatKind, this.paint)
      this.render()
      return
    }
    if (d.toggle) {
      if (d.toggle.startsWith('paint.')) { const k = d.toggle.slice(6) as 'flake'; this.paint = { ...this.paint!, [k]: !this.paint![k] }; this.host.previewBoat(this.boatKind, this.paint!) }
      else { const k = d.toggle as 'sunglasses' | 'gloves'; this.look = { ...this.look!, [k]: !this.look![k] }; this.host.previewLook(this.look!) }
      this.render()
      return
    }
    if (d.field && d.value !== undefined) { this.set(d.field, d.value); return }
    if (d.action === 'reset-look') { this.look = { ...this.host.profile().look }; this.host.previewLook(this.look); this.render() }
    if (d.action === 'reset-boat') { const p = this.host.profile(); this.boatKind = p.boat; this.paint = { ...p.paint[p.boat] }; this.host.previewBoat(this.boatKind, this.paint); this.render() }
    if (d.action === 'save-look') void this.run(() => this.host.saveLook(this.look!), 'Outfit saved.')
    if (d.action === 'save-boat') void this.run(() => this.host.saveBoat(this.boatKind, this.paint!), 'Boat saved.')
  }

  private set(field: string, value: string): void {
    if (field.startsWith('paint.')) {
      const k = field.slice(6) as keyof BoatPaint
      this.paint = { ...this.paint!, [k]: value } as BoatPaint
      this.host.previewBoat(this.boatKind, this.paint)
    } else {
      const numeric = field === 'skin' || field === 'hair'
      this.look = { ...this.look!, [field]: numeric ? Number(value) : value } as Look
      this.host.previewLook(this.look)
    }
    this.render()
  }

  private async run(task: () => Promise<void>, done: string): Promise<void> {
    this.busy = true
    this.status.textContent = 'Saving…'
    try {
      await task()
      this.status.textContent = done
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : 'That did not work. Try again.'
    } finally {
      this.busy = false
      this.render()
    }
  }
}
