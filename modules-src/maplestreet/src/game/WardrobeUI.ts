/**
 * Character creator / wardrobe (C, or the Maple Threads counter downtown).
 * A side panel next to a close-up of your character.
 *   - Creating your neighbor (once): pick male or female, hair, face and a
 *     starter outfit. The body choice is final.
 *   - Wardrobe (C): hair, eyes and skin stay free to change; the outfit is
 *     shown but locked.
 *   - Maple Threads: the only place clothes change — try anything on, buy it,
 *     or put back on something you already own.
 */
import type { Account } from '../../shared/Economy';
import {
  CLOTH_COLORS, cleanLook, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, WARDROBE, WARDROBE_BY_ID,
  type Body, type Look, type Slot, type WardrobeItem,
} from '../../shared/Wardrobe';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

type Tab = 'hair' | 'face' | 'top' | 'pants' | 'shoes' | 'hat';
const TABS: [Tab, string][] = [['hair', 'Hair'], ['face', 'Face'], ['top', 'Tops'], ['pants', 'Bottoms'], ['shoes', 'Shoes'], ['hat', 'Hats']];
const COLOR_KEYS: Record<Slot, [keyof Look, keyof Look]> = {
  top: ['topColor', 'topColor2'], pants: ['pantsColor', 'pantsColor2'], shoes: ['shoesColor', 'shoesColor2'], hat: ['hatColor', 'hatColor2'],
};
const SECOND_LABEL: Record<string, string> = {
  solid: '', stripes: 'Stripe', plaid: 'Check', camo: 'Camo', sleeves: 'Sleeves', denim: '', checker: 'Checks', shorts: '', hightop: 'Soles',
};

export interface WardrobeEvents {
  preview(look: Look): void;
  save(look: Look, note?: string): void;
  buy(itemId: string): void;
  closed(): void;
}

export class WardrobeUI {
  private look: Look | null = null;
  private saved: Look | null = null;
  private account: Account | null = null;
  private tab: Tab = 'top';
  private shop = false;
  private firstTime = false;

  constructor(private ev: WardrobeEvents) {
    const tabs = $('wdTabs');
    for (const [id, label] of TABS) {
      const b = document.createElement('button');
      b.className = 'wd-tab'; b.dataset.tab = id; b.textContent = label;
      b.onclick = () => { this.tab = id; this.render(); };
      tabs.appendChild(b);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#wdBody button')) {
      b.onclick = () => this.setBody(b.dataset.body as Body);
    }
    $('wdDone').onclick = () => this.done();
    $('wdCancel').onclick = () => this.cancel();
  }

  get isOpen() { return $('wardrobe').classList.contains('show'); }
  get isShop() { return this.isOpen && this.shop; }

  /** Opens on your current look; `shop` lists every piece with prices and Buy buttons. */
  open(look: Look, account: Account | null, shop: boolean, firstTime = false) {
    this.saved = { ...look };
    this.look = { ...look };
    this.account = account;
    this.shop = shop;
    this.firstTime = firstTime;
    if (shop && (this.tab === 'hair' || this.tab === 'face')) this.tab = 'top';
    $('wardrobe').classList.add('show');
    document.body.classList.add('dressing');
    this.render();
  }

  /** Called with every account update (purchases land here). */
  updateAccount(acc: Account) {
    this.account = acc;
    if (this.isOpen) this.render();
  }

  close(apply: boolean, note?: string) {
    if (!this.isOpen) return;
    if (this.firstTime) apply = true;
    $('wardrobe').classList.remove('show');
    document.body.classList.remove('dressing');
    if (apply && this.look) this.ev.save(this.sanitized(), note);
    else if (this.saved) this.ev.preview(this.saved);
    (document.activeElement as HTMLElement | null)?.blur();
    this.ev.closed();
  }

  private owned(item: WardrobeItem) { return item.price === 0 || !!this.account?.wardrobe.includes(item.id); }

  /** Pieces you're only trying on come off when you leave. */
  private sanitized(): Look {
    return cleanLook(this.look, this.account?.wardrobe ?? [], this.saved);
  }

  private done() {
    if (!this.look) return;
    const clean = this.sanitized();
    const dropped = (['top', 'pants', 'shoes', 'hat'] as Slot[]).filter(s => clean[s] !== this.look![s]).map(s => WARDROBE_BY_ID[this.look![s]]?.name);
    this.look = clean;
    this.close(true, dropped.length ? `Not bought yet, so it stays on the rack: ${dropped.join(', ')}` : undefined);
  }

  private cancel() {
    if (this.firstTime && this.look) return this.close(true);
    this.close(false);
  }

  private setBody(body: Body) {
    if (!this.firstTime || !this.look || this.look.body === body) return;
    const owned = this.account?.wardrobe ?? [];
    this.look = cleanLook({ ...this.look, body, hair: 'natural' }, owned, this.look);
    this.changed();
  }

  private changed() {
    if (!this.look) return;
    this.ev.preview(this.look);
    this.render();
  }

  private set<K extends keyof Look>(key: K, value: Look[K]) {
    if (!this.look) return;
    this.look = { ...this.look, [key]: value };
    this.changed();
  }

  private wear(item: WardrobeItem) {
    if (!this.look) return;
    const [k1, k2] = COLOR_KEYS[item.slot];
    const was = this.look[item.slot];
    const next: Look = { ...this.look, [item.slot]: item.id };
    if (was !== item.id) { (next[k1] as string) = item.colors[0]; (next[k2] as string) = item.colors[1]; }
    this.look = next;
    this.changed();
  }

  private swatches(title: string, colors: string[], current: string, pick: (c: string) => void) {
    const wrap = document.createElement('div');
    wrap.className = 'wd-sw';
    wrap.innerHTML = `<span>${esc(title)}</span>`;
    const row = document.createElement('div');
    for (const c of colors) {
      const b = document.createElement('button');
      b.className = 'swatch' + (c.toLowerCase() === current.toLowerCase() ? ' on' : '');
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', `${title} ${c}`);
      b.onclick = () => pick(c);
      row.appendChild(b);
    }
    const custom = document.createElement('input');
    custom.type = 'color'; custom.value = current; custom.title = 'Custom color';
    custom.setAttribute('aria-label', `${title}: custom color`);
    custom.oninput = () => pick(custom.value);
    row.appendChild(custom);
    wrap.appendChild(row);
    return wrap;
  }

  private render() {
    const L = this.look;
    if (!L) return;
    const locked = !this.shop && !this.firstTime;
    $('wdTitle').textContent = this.shop ? 'Maple Threads' : this.firstTime ? 'Create your neighbor' : 'Wardrobe';
    $('wdSub').textContent = this.shop
      ? `Try anything on and buy it to wear it. Pieces you already own can go back on for free.${this.account ? ` Balance ${this.account.money >= 1e9 ? 'unlimited' : money(this.account.money)}` : ''}`
      : this.firstTime ? 'Pick your body, hair, face and a starter outfit. Your body is final, and after today clothes only change by shopping at Maple Threads.'
      : 'Hair, eyes and skin are free to change. Your outfit is set — shop at Maple Threads downtown for new clothes.';
    $('wdBodyBox').hidden = !this.firstTime;
    $('wdCancel').hidden = this.firstTime;
    $('wdDone').textContent = this.firstTime ? 'Looks good' : this.shop ? 'Done shopping' : 'Done';
    for (const b of document.querySelectorAll<HTMLButtonElement>('#wdBody button')) { b.classList.toggle('on', b.dataset.body === L.body); b.setAttribute('aria-checked', String(b.dataset.body === L.body)); }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#wdTabs button')) {
      b.classList.toggle('on', b.dataset.tab === this.tab);
      b.hidden = this.shop && (b.dataset.tab === 'hair' || b.dataset.tab === 'face');
    }
    const body = $('wdContent');
    body.innerHTML = '';
    if (this.tab === 'hair') {
      const grid = document.createElement('div');
      grid.className = 'wd-grid';
      for (const h of HAIR_STYLES[L.body]) {
        const b = document.createElement('button');
        b.className = 'wd-item' + (L.hair === h.id ? ' on' : '');
        b.innerHTML = `<b>${esc(h.name)}</b><small>${L.hair === h.id ? 'Wearing' : 'Free'}</small>`;
        b.onclick = () => this.set('hair', h.id);
        grid.appendChild(b);
      }
      body.appendChild(grid);
      body.appendChild(this.swatches('Hair color', HAIR_COLORS, L.hairColor, c => this.set('hairColor', c)));
      return;
    }
    if (this.tab === 'face') {
      body.appendChild(this.swatches('Eye color', EYE_COLORS, L.eyes, c => this.set('eyes', c)));
      body.appendChild(this.swatches('Skin tone', SKIN_TONES, L.skin, c => this.set('skin', c)));
      return;
    }
    const slot = this.tab as Slot;
    const grid = document.createElement('div');
    grid.className = 'wd-grid';
    if (locked) {
      const worn = WARDROBE_BY_ID[L[slot]];
      const [k1, k2] = COLOR_KEYS[slot];
      const card = document.createElement('div');
      card.className = 'wd-item on';
      card.innerHTML = `<i style="background:linear-gradient(135deg, ${L[k1]} 0 55%, ${L[k2]} 55% 100%)"></i><b>${esc(worn.name)}</b><small>${esc(worn.blurb)}</small><span class="wd-tag">Wearing</span>`;
      grid.appendChild(card);
      body.appendChild(grid);
      const note = document.createElement('p');
      note.className = 'wd-lock';
      note.textContent = 'Outfits are locked in. To change clothes, head to Maple Threads on Main Street downtown — anything you own can go back on there, and everything else is for sale.';
      body.appendChild(note);
      return;
    }
    for (const item of WARDROBE.filter(i => i.slot === slot)) {
      const owned = this.owned(item);
      if (!owned && !this.shop) continue;
      const wearing = L[slot] === item.id;
      const b = document.createElement('div');
      b.className = 'wd-item' + (wearing ? ' on' : '') + (owned ? '' : ' locked');
      b.tabIndex = 0;
      b.setAttribute('role', 'button');
      b.innerHTML = `<i style="background:linear-gradient(135deg, ${item.colors[0]} 0 55%, ${item.colors[1]} 55% 100%)"></i><b>${esc(item.name)}</b><small>${esc(item.blurb)}</small>`;
      const tag = document.createElement('span');
      tag.className = 'wd-tag';
      tag.textContent = wearing ? (owned ? 'Wearing' : 'Trying on') : owned ? (item.price ? 'Owned' : 'Starter') : money(item.price);
      b.appendChild(tag);
      b.onclick = () => this.wear(item);
      b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.wear(item); } };
      if (!owned && this.shop) {
        const buy = document.createElement('button');
        buy.className = 'btn accent';
        buy.textContent = `Buy ${money(item.price)}`;
        buy.disabled = (this.account?.money ?? 0) < item.price;
        buy.onclick = e => { e.stopPropagation(); this.ev.buy(item.id); };
        b.appendChild(buy);
      }
      grid.appendChild(b);
    }
    body.appendChild(grid);
    if (!this.shop && WARDROBE.some(i => i.slot === slot && !this.owned(i))) {
      const more = document.createElement('p');
      more.className = 'wd-more';
      more.textContent = 'These are the starter pieces. More styles are for sale at Maple Threads, downtown on Main Street.';
      body.appendChild(more);
    }
    const item = WARDROBE_BY_ID[L[slot]];
    if (slot === 'hat' && item.id === 'no-hat') return;
    const [k1, k2] = COLOR_KEYS[slot];
    body.appendChild(this.swatches(slot === 'shoes' ? 'Upper' : 'Main color', CLOTH_COLORS, L[k1] as string, c => this.set(k1, c)));
    const second = slot === 'shoes' ? (item.pattern === 'checker' ? 'Checks' : 'Soles') : slot === 'hat' ? (item.hat === 'beanie' ? 'Cuff' : item.hat === 'cap' ? 'Brim' : 'Band') : SECOND_LABEL[item.pattern];
    if (second) body.appendChild(this.swatches(second, CLOTH_COLORS, L[k2] as string, c => this.set(k2, c)));
    if (slot === 'top') body.appendChild(this.swatches('Undershirt', CLOTH_COLORS, L.tee, c => this.set('tee', c)));
  }
}
