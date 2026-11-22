/**
 * The pressure-wash toolbar: where you are washing and what it costs, a meter of how clean the truck is, the controls, and Done.
 * The game sprays and scores; this only shows the numbers and reports Done.
 */
import { h, money, prepareRoot } from './dom'

export interface WashHudOptions {
  place: string
  cost: number
  onDone(): void
}

export class WashHud {
  private readonly bar: HTMLElement
  private readonly fill = h('span', { class: 'ts-wash-fill' })
  private readonly label = h('b', { class: 'ts-wash-label', text: '0 % clean' })
  private readonly meter = h('div', { class: 'ts-wash-meter', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'How clean the truck is' } }, this.fill)

  constructor(root: HTMLElement, options: WashHudOptions) {
    prepareRoot(root)
    const done = h('button', { class: 'ts-btn primary', text: 'Done', attrs: { type: 'button' }, on: { click: () => options.onDone() } })
    this.bar = h('div', { class: 'ts-builder ts-wash', attrs: { role: 'toolbar', 'aria-label': 'Pressure wash' } },
      h('div', { class: 'ts-build-top' }, h('b', { text: options.place }), h('span', { class: 'ts-note', text: `Water ${money(options.cost)}` })),
      h('div', { class: 'ts-build-bottom' }, this.meter, this.label,
        h('p', { class: 'ts-hint', text: 'Hold the left mouse button to spray the grime off. Right-drag walks around the truck, the wheel steps closer. E or Done finishes.' }),
        done))
    root.appendChild(this.bar)
  }

  setClean(share: number): void {
    const percent = Math.round(Math.max(0, Math.min(1, share)) * 100)
    this.fill.style.width = `${percent}%`
    this.label.textContent = `${percent} % clean`
    this.meter.setAttribute('aria-valuenow', String(percent))
  }

  dispose(): void {
    this.bar.remove()
  }
}
