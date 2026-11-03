/**
 * The Maple Body & Wheel window: pick repairs and upgrades for the car parked
 * in a bay, see an itemized quote (priced by the same rules the authority
 * uses), and pay. Pure view: the order goes out through `onOrder`.
 */
import { BODY_SHOP, cleanOrder, LIFT_LABEL, PERF_BLURB, PERF_LABEL, quote, repairPrice, RIM_FINISH_LABEL, RIM_LABEL, RIM_SIZE_LABEL, TINT_LABEL, type ServiceOrder } from '../../shared/BodyShop';
import { cleanCar, FINISH_LABEL, LIFT_MAX, LIFT_MIN, PAINT_FINISHES, PAINT_SWATCHES, PERF_MAX, RIM_FINISHES, RIM_SIZES, RIM_STYLES, type OwnedCar, type PerfPart } from '../../shared/Cars';
import { isPaintable, UNLIMITED_MONEY, VEHICLES, type Account } from '../../shared/Economy';
import { isBuiltinVehicleKind, type VehicleKind } from '../../shared/Vehicles';

const money = (n: number) => (n >= UNLIMITED_MONEY ? 'Unlimited' : `$${Math.round(n).toLocaleString()}`);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

export class BodyShopUI {
  private readonly root: HTMLElement;
  private kind: VehicleKind | null = null;
  private car: OwnedCar | null = null;
  private want: OwnedCar | null = null;
  private repair = false;
  private account: Account | null = null;

  constructor(private readonly onOrder: (kind: VehicleKind, order: ServiceOrder) => void, private readonly onClose: () => void) {
    this.root = el('div', 'ui hud modal');
    this.root.id = 'bodyshop';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', BODY_SHOP.name);
    document.body.append(this.root);
  }

  get isOpen() { return this.root.classList.contains('show'); }

  open(kind: VehicleKind, account: Account) {
    this.kind = kind;
    this.account = account;
    this.car = cleanCar(account.cars[kind], kind);
    this.want = cleanCar(this.car, kind);
    this.repair = this.car.damage > 0 || this.car.dents.length > 0;
    this.root.classList.add('show');
    this.render();
  }

  /** New account state: the work went through (or money changed), so start over from the car as it is now. */
  update(account: Account) {
    if (!this.isOpen || !this.kind) return;
    const before = this.car ? JSON.stringify(this.car) : '', money = this.account?.money;
    this.account = account;
    const now = cleanCar(account.cars[this.kind], this.kind);
    const changed = JSON.stringify(now) !== before;
    if (changed) { this.car = now; this.want = cleanCar(now, this.kind); this.repair = now.damage > 0 || now.dents.length > 0; }
    if (changed || account.money !== money) this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('show');
    (document.activeElement as HTMLElement | null)?.blur();
    this.onClose();
  }

  private order(): ServiceOrder {
    const w = this.want!;
    return cleanOrder({ repair: this.repair, color: w.color, finish: w.finish, tint: w.tint, rims: w.rims, lift: w.lift, perf: w.perf }, this.car!);
  }

  private set(change: Partial<OwnedCar>) { this.want = { ...this.want!, ...change }; this.render(); }

  private choice<T extends string | number>(label: string, options: readonly T[], current: T, name: (v: T) => string, pick: (v: T) => void, blurb?: (v: T) => string) {
    const box = el('div', 'bs-row');
    box.append(el('span', 'bs-label', label));
    const group = el('div', 'bs-options');
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
    for (const o of options) {
      const b = el('button', 'btn' + (o === current ? ' on' : ''), name(o));
      b.setAttribute('aria-pressed', String(o === current));
      if (blurb?.(o)) b.title = blurb(o);
      b.onclick = () => pick(o);
      group.append(b);
    }
    box.append(group);
    return box;
  }

  private section(title: string, ...children: HTMLElement[]) {
    const s = el('section', 'bs-section');
    s.append(el('h3', '', title), ...children);
    return s;
  }

  private render() {
    if (!this.kind || !this.car || !this.want || !this.account) return;
    const kind = this.kind, car = this.car, want = this.want, acc = this.account;
    const name = VEHICLES[kind]?.name ?? 'Your car';
    const card = el('div', 'card panel');
    card.append(el('h2', '', BODY_SHOP.name));
    const condition = Math.round((1 - car.damage) * 100);
    card.append(el('p', 'sub', `${name} · ${condition}% condition · Balance ${money(acc.money)}`));
    const body = el('div', 'bs-body');

    const fix = el('label', 'bs-repair');
    const check = el('input'); check.type = 'checkbox'; check.checked = this.repair; check.disabled = !(car.damage > 0 || car.dents.length);
    check.onchange = () => { this.repair = check.checked; this.render(); };
    fix.append(check, document.createTextNode(check.disabled ? ' Nothing to repair — it’s in perfect shape' : ` Repair all damage and ${car.dents.length} dent${car.dents.length === 1 ? '' : 's'} — ${money(repairPrice(kind, car))}`));
    body.append(this.section('Repairs', fix));

    if (isPaintable(kind)) {
      const sw = el('div', 'swatches');
      for (const s of PAINT_SWATCHES) {
        const b = el('button', 'swatch' + (s.color === want.color ? ' on' : ''));
        b.style.background = s.color; b.title = s.name; b.setAttribute('aria-label', s.name); b.setAttribute('aria-pressed', String(s.color === want.color));
        b.onclick = () => this.set({ color: s.color });
        sw.append(b);
      }
      const any = el('input'); any.type = 'color'; any.value = want.color; any.setAttribute('aria-label', 'Pick any color');
      any.onchange = () => this.set({ color: any.value.toLowerCase() });
      sw.append(any);
      body.append(this.section('Paint', sw, this.choice('Finish', PAINT_FINISHES, want.finish, f => FINISH_LABEL[f], finish => this.set({ finish }))));
    }
    if (isBuiltinVehicleKind(kind)) body.append(this.section('Window tint', this.choice('Tint', [0, 1, 2, 3] as const, want.tint as 0 | 1 | 2 | 3, t => TINT_LABEL[t], tint => this.set({ tint }))));

    body.append(this.section('Wheels',
      this.choice('Style', RIM_STYLES, want.rims.style, s => RIM_LABEL[s], style => this.set({ rims: style === 'factory' ? { style, size: 0, finish: 'silver' } : { ...want.rims, style } })),
      ...(want.rims.style === 'factory' ? [] : [
        this.choice('Finish', RIM_FINISHES, want.rims.finish, f => RIM_FINISH_LABEL[f], finish => this.set({ rims: { ...want.rims, finish } })),
        this.choice('Size', RIM_SIZES, want.rims.size as 0 | 1 | 2, s => RIM_SIZE_LABEL[s], size => this.set({ rims: { ...want.rims, size } })),
      ]),
    ));

    const lifts = Array.from({ length: LIFT_MAX - LIFT_MIN + 1 }, (_, i) => LIFT_MIN + i);
    body.append(this.section('Lift and lowering', this.choice('Height', lifts, want.lift, l => l === 0 ? 'Stock' : l < 0 ? `−${-l}` : `+${l}`, lift => this.set({ lift }), l => LIFT_LABEL(l)), el('p', 'bs-note', LIFT_LABEL(want.lift) + (want.lift < 0 ? ' · a little more grip' : want.lift > 0 ? ' · more body roll' : ''))));

    const perf = (part: PerfPart, title: string) => this.choice(title, Array.from({ length: PERF_MAX[part] + 1 }, (_, i) => i), want.perf[part], l => PERF_LABEL[part][l].replace(/ (tune|exhaust|brakes|tires)$/, '').replace(/^Stock.*/, 'Stock'), l => this.set({ perf: { ...want.perf, [part]: l } }), l => PERF_BLURB[part][l]);
    body.append(this.section('Performance', perf('engine', 'Engine'), perf('exhaust', 'Exhaust'), perf('brakes', 'Brakes'), perf('tires', 'Tires'), el('p', 'bs-note', ['engine', 'exhaust', 'brakes', 'tires'].map(p => PERF_BLURB[p as PerfPart][want.perf[p as PerfPart]]).filter(Boolean).join(' · ') || 'Stock performance')));
    card.append(body);

    const q = quote(kind, car, this.order());
    const bill = el('div', 'bs-bill');
    if (!q.lines.length) bill.append(el('p', 'bs-note', 'Pick some work above to get a quote.'));
    for (const l of q.lines) { const row = el('div', 'bs-line'); row.append(el('span', '', l.label), el('b', '', money(l.price))); bill.append(row); }
    if (q.lines.length) { const row = el('div', 'bs-line bs-total'); row.append(el('span', '', 'Total'), el('b', '', money(q.total))); bill.append(row); }
    card.append(bill);

    const actions = el('div', 'actions');
    const pay = el('button', 'btn accent', q.lines.length ? `Pay ${money(q.total)} and do the work` : 'Nothing to do yet');
    pay.disabled = !q.lines.length || q.total > acc.money;
    if (q.lines.length && q.total > acc.money) pay.textContent = `Not enough money — ${money(q.total)}`;
    pay.onclick = () => this.onOrder(kind, this.order());
    const close = el('button', 'btn', 'Close (E)');
    close.onclick = () => this.close();
    actions.append(pay, close);
    card.append(actions);
    const scroll = this.root.querySelector('.bs-body')?.scrollTop ?? 0;
    this.root.replaceChildren(card);
    body.scrollTop = scroll;
  }
}
