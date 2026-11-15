/**
 * The window at Montello Body & Wheel: repairs, paint, tint, rims, lift and performance parts for a car you own that is
 * parked in the shop's lot. The quote is priced by the same rules as the shared world (maplestreet/shared/BodyShop.ts),
 * which checks the car is at the shop and answers with your account.
 */
import { cleanOrder, LIFT_LABEL, PERF_BLURB, PERF_LABEL, quote, repairPrice, RIM_FINISH_LABEL, RIM_LABEL, RIM_SIZE_LABEL, TINT_LABEL, type ServiceOrder } from '../../maplestreet/shared/BodyShop'
import { cleanCar, FINISH_LABEL, LIFT_MAX, LIFT_MIN, PAINT_FINISHES, PAINT_SWATCHES, PERF_MAX, RIM_FINISHES, RIM_SIZES, RIM_STYLES, type OwnedCar, type PerfPart } from '../../maplestreet/shared/Cars'
import type { Account } from '../../maplestreet/shared/Economy'
import { isPaintable, VEHICLES } from '../../maplestreet/shared/Economy'
import type { ClientMsg, VehicleKind } from '../../maplestreet/shared/Protocol'
import { el, money, type PanelKit } from './panelKit'

export class BodyShopView {
  private kind: VehicleKind | null = null
  private car: OwnedCar | null = null
  private want: OwnedCar | null = null
  private repair = false

  constructor(
    private readonly send: (m: ClientMsg) => void,
    private readonly redraw: () => void,
    private readonly parked: () => VehicleKind[],
  ) {}

  reset(): void {
    this.kind = null
    this.car = null
    this.want = null
  }

  private load(kind: VehicleKind, acc: Account): void {
    this.kind = kind
    this.car = cleanCar(acc.cars[kind], kind)
    this.want = cleanCar(this.car, kind)
    this.repair = this.car.damage > 0 || this.car.dents.length > 0
  }

  render(kit: PanelKit, acc: Account): HTMLElement {
    const section = kit.section('The shop floor')
    const here = this.parked()
    if (!here.length) {
      section.append(el('small', undefined, 'Drive one of your cars into the lot out front, then walk up to the counter.'))
      this.reset()
      return section
    }
    if (!this.kind || !here.includes(this.kind)) this.load(here[0], acc)
    const kind = this.kind!
    const now = cleanCar(acc.cars[kind], kind)
    if (JSON.stringify(now) !== JSON.stringify(this.car)) this.load(kind, acc)
    const car = this.car!
    const want = this.want!
    if (here.length > 1) {
      const row = el('div', 'fl-bank-row')
      row.append(el('span', 'fl-bank-label', 'Car'))
      for (const k of here) {
        const b = kit.button(`car:${k}`, VEHICLES[k]?.name ?? k, `Work on the ${VEHICLES[k]?.name ?? k}`, true, () => {
          this.load(k, acc)
          this.redraw()
        })
        if (k === kind) b.classList.add('primary')
        row.append(b)
      }
      section.append(row)
    }
    const set = (change: Partial<OwnedCar>) => {
      this.want = { ...want, ...change }
      this.redraw()
    }
    const choice = <T extends string | number>(label: string, options: readonly T[], current: T, name: (v: T) => string, pick: (v: T) => void, blurb?: (v: T) => string) => {
      const row = el('div', 'fl-bank-row')
      row.append(el('span', 'fl-bank-label', label))
      for (const o of options) {
        const b = kit.button(`${label}:${o}`, name(o), `${label}: ${name(o)}`, true, () => pick(o))
        b.setAttribute('aria-pressed', String(o === current))
        if (o === current) b.classList.add('primary')
        const tip = blurb?.(o)
        if (tip) b.title = tip
        row.append(b)
      }
      section.append(row)
    }
    section.append(el('small', undefined, `${VEHICLES[kind]?.name ?? kind}: ${Math.round((1 - car.damage) * 100)}% condition, ${car.dents.length} dent${car.dents.length === 1 ? '' : 's'}`))
    if (car.damage > 0 || car.dents.length) {
      const b = kit.button('repair', this.repair ? `Repair · ${money(repairPrice(kind, car))}` : 'Skip the repair', 'Repair damage and dents', true, () => {
        this.repair = !this.repair
        this.redraw()
      })
      b.setAttribute('aria-pressed', String(this.repair))
      section.append(b)
    }
    if (isPaintable(kind)) {
      const swatches = el('div', 'fl-swatches')
      for (const s of PAINT_SWATCHES) {
        const b = el('button', 'fl-swatch')
        b.type = 'button'
        b.style.background = s.color
        b.title = s.name
        b.dataset.key = `paint:${s.color}`
        b.setAttribute('aria-label', `Paint ${s.name}`)
        b.setAttribute('aria-pressed', String(want.color === s.color))
        b.addEventListener('click', () => set({ color: s.color }))
        swatches.append(b)
      }
      const paint = el('div', 'fl-pick')
      paint.append(el('span', 'fl-bank-label', 'Paint'), swatches)
      section.append(paint)
      choice('Finish', PAINT_FINISHES, want.finish, (f) => FINISH_LABEL[f], (finish) => set({ finish }))
    }
    choice('Tint', [0, 1, 2, 3] as const, want.tint, (t) => TINT_LABEL[t], (tint) => set({ tint }))
    choice('Rims', RIM_STYLES, want.rims.style, (s) => RIM_LABEL[s], (style) => set({ rims: { ...want.rims, style } }))
    if (want.rims.style !== 'factory') {
      choice('Size', RIM_SIZES.map((_, i) => i), want.rims.size, (i) => RIM_SIZE_LABEL[i], (size) => set({ rims: { ...want.rims, size } }))
      choice('Rim finish', RIM_FINISHES, want.rims.finish, (f) => RIM_FINISH_LABEL[f], (finish) => set({ rims: { ...want.rims, finish } }))
    }
    choice('Ride height', Array.from({ length: LIFT_MAX - LIFT_MIN + 1 }, (_, i) => LIFT_MIN + i), want.lift, LIFT_LABEL, (lift) => set({ lift }))
    for (const part of Object.keys(PERF_MAX) as PerfPart[]) {
      choice(part[0].toUpperCase() + part.slice(1), Array.from({ length: PERF_MAX[part] + 1 }, (_, i) => i), want.perf[part], (l) => PERF_LABEL[part][l], (level) => set({ perf: { ...want.perf, [part]: level } }), (l) => PERF_BLURB[part][l])
    }
    const order: ServiceOrder = cleanOrder({ repair: this.repair, color: want.color, finish: want.finish, tint: want.tint, rims: want.rims, lift: want.lift, perf: want.perf }, car)
    const q = quote(kind, car, order)
    const total = el('div', 'panel-row')
    const text = el('div')
    text.append(el('strong', undefined, q.lines.length ? `Quote · ${money(q.total)}` : 'Pick some work'))
    for (const line of q.lines) text.append(el('small', undefined, `${line.label} · ${money(line.price)}`))
    const pay = kit.button('pay', 'Do the work', `Pay ${money(q.total)} for the work`, q.lines.length > 0 && q.total <= acc.money, () => this.send({ t: 'service', kind, order }))
    total.append(text, pay)
    section.append(total)
    return section
  }
}
