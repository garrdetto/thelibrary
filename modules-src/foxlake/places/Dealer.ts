/**
 * The dealership's window (H A Freitag & Son on Main Street): the vehicles of Fox Plains' Maple Motors, with its paint
 * picker, and the three lake rides. Pure view: each purchase goes to the shared world, which checks you are at the door.
 */
import type { Account } from '../../maplestreet/shared/Economy'
import { isPaintable, shopItems } from '../../maplestreet/shared/Economy'
import { FINISH_LABEL, PAINT_FINISHES, PAINT_SWATCHES, type PaintFinish } from '../../maplestreet/shared/Cars'
import type { ClientMsg } from '../../maplestreet/shared/Protocol'
import { el, money, type PanelKit } from './panelKit'

export interface DealerPaint {
  color: string
  finish: PaintFinish
}

export const DEFAULT_PAINT: DealerPaint = { color: PAINT_SWATCHES[0].color, finish: 'gloss' }

export function dealerSection(kit: PanelKit, shop: string, acc: Account, send: (m: ClientMsg) => void, paint: DealerPaint, repaint: () => void): HTMLElement {
  const section = kit.section('On the lot')
  const items = shopItems('dealer', true)
  const vehicles = items.filter((i) => i.vehicle)
  if (vehicles.some((i) => i.vehicle && isPaintable(i.vehicle))) {
    const picker = el('div', 'fl-pick')
    picker.append(el('span', 'fl-bank-label', 'Paint'))
    const swatches = el('div', 'fl-swatches')
    for (const s of PAINT_SWATCHES) {
      const b = el('button', 'fl-swatch')
      b.type = 'button'
      b.style.background = s.color
      b.title = s.name
      b.setAttribute('aria-label', `Paint ${s.name}`)
      b.setAttribute('aria-pressed', String(paint.color === s.color))
      b.dataset.key = `paint:${s.color}`
      b.addEventListener('click', () => {
        paint.color = s.color
        repaint()
      })
      swatches.append(b)
    }
    picker.append(swatches)
    const finishes = el('div', 'fl-bank-row')
    for (const f of PAINT_FINISHES) {
      const b = kit.button(`finish:${f}`, FINISH_LABEL[f], `${FINISH_LABEL[f]} finish`, true, () => {
        paint.finish = f
        repaint()
      })
      b.setAttribute('aria-pressed', String(paint.finish === f))
      if (paint.finish === f) b.classList.add('primary')
      finishes.append(b)
    }
    section.append(picker, finishes)
  }
  for (const item of items) {
    const owned = item.vehicle ? acc.garage.includes(item.vehicle) : item.ride ? acc.rides.includes(item.ride) : false
    const row = el('div', 'panel-row')
    const text = el('div')
    text.append(el('strong', undefined, item.name), el('small', undefined, item.blurb))
    const label = owned ? 'Owned' : `Buy · ${money(item.price)}`
    const b = kit.button(`buy:${item.id}`, label, `Buy ${item.name} for ${money(item.price)}`, !owned && acc.money >= item.price, () => {
      const car = item.vehicle && isPaintable(item.vehicle) ? { color: paint.color, finish: paint.finish } : undefined
      send({ t: 'buy', shop, item: item.id, ...(car ? { car } : {}) })
    })
    row.append(text, b)
    section.append(row)
  }
  if (!items.length) section.append(el('small', undefined, 'Nothing on the lot right now.'))
  return section
}
