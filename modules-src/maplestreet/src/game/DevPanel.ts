/**
 * The developer instance's panel (F8, only with `?dev=1`): every admin-
 * published item and vehicle, drafts first, with one click to place an item
 * on your lot in Buy mode or to drive a vehicle right where you stand.
 * Editing and publishing stay in the admin editors; the panel links there.
 */
import { CATALOG } from '../../shared/Catalog';
import { isCustomCatalogId } from '../../shared/CustomItems';
import { VEHICLES } from '../../shared/Economy';
import { devDrafts } from '../core/DevMode';

export interface DevApi {
  place(catalogId: string): void;
  drive(kind: string): void;
  hasLot(): boolean;
}

const idOf = (key: string) => key.slice(key.indexOf(':') + 1);

export class DevPanel {
  private readonly el = document.createElement('aside');
  private open = false;

  constructor(private readonly api: DevApi) {
    this.el.id = 'devPanel';
    this.el.className = 'ui panel';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Developer panel');
    document.body.append(this.el);
    addEventListener('keydown', e => {
      if (e.code !== 'F8' || e.repeat) return;
      e.preventDefault();
      this.toggle();
    });
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.el.hidden = !this.open;
    if (this.open) this.render();
  }

  private row(name: string, draft: boolean, action: string, run: () => void, disabled = false) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = name;
    const badge = document.createElement('b');
    badge.className = draft ? 'dev-draft' : 'dev-live';
    badge.textContent = draft ? 'Draft' : 'Live';
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = action;
    btn.disabled = disabled;
    btn.onclick = () => { run(); this.toggle(false); };
    li.append(badge, label, btn);
    return li;
  }

  private section(title: string, rows: HTMLLIElement[], empty: string) {
    const h = document.createElement('h3');
    h.textContent = `${title} (${rows.length})`;
    const ul = document.createElement('ul');
    if (rows.length) ul.append(...rows);
    else { const li = document.createElement('li'); li.className = 'dev-empty'; li.textContent = empty; ul.append(li); }
    return [h, ul];
  }

  private render() {
    const byDraft = <T extends { draft: boolean; name: string }>(a: T, b: T) => Number(b.draft) - Number(a.draft) || a.name.localeCompare(b.name);
    const items = Object.values(CATALOG).filter(i => isCustomCatalogId(i.id) && !i.hidden)
      .map(i => ({ id: i.id, name: i.name, draft: devDrafts.ids.has(idOf(i.id)) })).sort(byDraft);
    const vehicles = Object.keys(VEHICLES).filter(k => k.startsWith('custom:'))
      .map(k => ({ kind: k, name: VEHICLES[k].name, draft: devDrafts.ids.has(idOf(k)) })).sort(byDraft);
    const lot = this.api.hasLot();

    const head = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = 'Developer instance';
    const close = document.createElement('button');
    close.className = 'btn'; close.textContent = 'Close'; close.onclick = () => this.toggle(false);
    head.append(title, close);
    const note = document.createElement('p');
    note.textContent = devDrafts.allowed
      ? `Drafts are visible only here. ${lot ? '' : 'Buy a lot first to place items. '}F8 toggles this panel.`
      : 'Sign in to the library as the administrator to load drafts. F8 toggles this panel.';
    const foot = document.createElement('p');
    const link = document.createElement('a');
    link.href = '/'; link.target = '_blank'; link.rel = 'noopener';
    link.textContent = 'Edit and publish in Admin → Maple Street items / vehicles';
    const reload = document.createElement('button');
    reload.className = 'btn'; reload.textContent = 'Reload drafts';
    reload.onclick = () => location.reload();
    foot.append(link, reload);

    this.el.replaceChildren(head, note,
      ...this.section('Items', items.map(i => this.row(i.name, i.draft, 'Place', () => this.api.place(i.id), !lot)), 'No published or draft items yet.'),
      ...this.section('Vehicles', vehicles.map(v => this.row(v.name, v.draft, 'Drive', () => this.api.drive(v.kind))), 'No published or draft vehicles yet.'),
      foot);
  }
}
