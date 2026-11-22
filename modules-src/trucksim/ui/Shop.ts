/**
 * The shop panels: the dealer (trucks and trailers), the paint and parts garage with a live preview, and the fleet screen with
 * select, sell, repair and refuel. Dealer and fleet re-render through `update(profile)` while open so cash and stock stay current.
 */
import { LOOK_PRICES, TRAILERS, TRAILER_BY_ID, TRUCKS, TRUCK_BY_ID, defaultLook } from '../shared/Catalog'
import type { TrailerModel, TruckLook, TruckModel } from '../shared/Catalog'
import { LOOK_OPTIONS } from '../shared/Economy'
import type { OwnedTruck, OwnedTrailer, Profile } from '../shared/Economy'
import { colorPicker, h, money, openModal, rerender, whole } from './dom'
import type { PanelHandle, PanelOptions } from './Panels'

export interface UpdatableHandle extends PanelHandle {
  update(profile: Profile): void
}

export interface DealerOptions extends PanelOptions {
  profile: Profile
  onBuyTruck(modelId: string, look: TruckLook): void
  onBuyTrailer(modelId: string): void
}

const STYLE_NAMES: Record<string, string> = { dump: 'Dump truck', cabover: 'Cab-over', longnose: 'Long-hood conventional', aero: 'Aero conventional' }
const CAB_NAMES: Record<string, string> = { day: 'Day cab', sleeper: 'Sleeper', raised: 'Raised sleeper' }
const KIND_NAMES: Record<string, string> = { tanker: 'Tanker', flatbed: 'Flatbed', grain: 'Grain hopper', reefer: 'Reefer', lowboy: 'Lowboy' }

function stat(label: string, value: string): HTMLElement {
  return h('div', {}, h('dt', { text: label }), h('dd', { text: value }))
}

/** A dealer with Trucks and Trailers tabs, spec cards, owned badges and a primary and secondary colour pick for each truck. */
export function openDealer(root: HTMLElement, options: DealerOptions): UpdatableHandle {
  let profile = options.profile
  let tab: 'trucks' | 'trailers' = 'trucks'
  const picks = new Map<string, { primary: string; secondary: string }>()
  const content = h('div', { class: 'ts-grid' })
  const cash = h('b', { class: 'ts-cash' })
  const tabs = h('div', { class: 'ts-tabs', attrs: { role: 'tablist' } })
  const modal = openModal(root, { title: 'Big Rig Motors', className: 'ts-wide', onClose: options.onClose })
  modal.body.append(h('div', { class: 'ts-bar' }, tabs, h('span', { class: 'ts-note', text: 'Cash ' }, cash)), content)

  const truckCard = (model: TruckModel): HTMLElement => {
    const stock = defaultLook(model)
    const pick = picks.get(model.id) ?? { primary: stock.paint.primary, secondary: stock.paint.secondary }
    picks.set(model.id, pick)
    const owned = profile.trucks.filter((truck) => truck.model === model.id).length
    const short = profile.cash < model.price
    const capacity = model.dump ? `${decimal1(model.dump.capacityKg / 1000)} t bed` : 'Fifth wheel'
    const buy = h('button', { class: 'ts-btn primary', text: short ? `Need ${money(model.price - profile.cash)} more` : `Buy ${money(model.price)}`, attrs: { type: 'button', 'data-key': `buy-${model.id}`, ...(short ? { disabled: '' } : {}) }, on: { click: () => options.onBuyTruck(model.id, { ...stock, paint: { ...stock.paint, primary: pick.primary, secondary: pick.secondary } }) } })
    const primary = colorPicker('Primary colour', pick.primary, (value) => { pick.primary = value })
    const secondary = colorPicker('Secondary colour', pick.secondary, (value) => { pick.secondary = value })
    return h('article', { class: 'ts-card tall' },
      h('div', { class: 'ts-card-main' },
        h('p', { class: 'ts-eyebrow', text: model.brand }),
        h('h4', { text: model.name }, owned > 0 ? h('span', { class: 'ts-badge', text: `Owned ${owned}` }) : null),
        h('p', { class: 'ts-meta', text: `${STYLE_NAMES[model.style] ?? model.style} · ${CAB_NAMES[model.cab] ?? model.cab}` }),
        h('p', { class: 'ts-blurb', text: model.blurb }),
        h('dl', { class: 'ts-stats' },
          stat('Power', `${whole(model.powerKw * 1.34102)} hp / ${whole(model.powerKw)} kW`),
          stat('Torque', `${whole(model.torqueNm)} N·m`),
          stat('Axles', String(model.axles.length)),
          stat('Carries', capacity)),
        primary.element, secondary.element),
      h('div', { class: 'ts-card-side' }, buy))
  }

  const trailerCard = (model: TrailerModel): HTMLElement => {
    const owned = profile.trailers.filter((trailer) => trailer.model === model.id).length
    const short = profile.cash < model.price
    return h('article', { class: 'ts-card tall' },
      h('div', { class: 'ts-card-main' },
        h('p', { class: 'ts-eyebrow', text: KIND_NAMES[model.kind] ?? model.kind }),
        h('h4', { text: model.name }, owned > 0 ? h('span', { class: 'ts-badge', text: `Owned ${owned}` }) : null),
        h('p', { class: 'ts-blurb', text: model.blurb }),
        h('dl', { class: 'ts-stats' },
          stat('Payload', `${decimal1(model.maxPayloadKg / 1000)} t`),
          stat('Empty weight', `${decimal1(model.emptyMassKg / 1000)} t`),
          stat('Axles', String(model.axles.length)),
          model.capacityL ? stat('Capacity', `${whole(model.capacityL)} L`) : null)),
      h('div', { class: 'ts-card-side' },
        h('button', { class: 'ts-btn primary', text: short ? `Need ${money(model.price - profile.cash)} more` : `Buy ${money(model.price)}`, attrs: { type: 'button', 'data-key': `buy-${model.id}`, ...(short ? { disabled: '' } : {}) }, on: { click: () => options.onBuyTrailer(model.id) } })))
  }

  const renderTabs = (): void => {
    tabs.replaceChildren()
    for (const [id, label] of [['trucks', 'Trucks'], ['trailers', 'Trailers']] as const) {
      tabs.appendChild(h('button', { class: `ts-tab${tab === id ? ' on' : ''}`, text: label, attrs: { type: 'button', role: 'tab', 'aria-selected': tab === id ? 'true' : 'false', 'data-key': `tab-${id}` }, on: { click: () => { tab = id; render() } } }))
    }
  }
  const render = (): void => {
    cash.textContent = money(profile.cash)
    rerender(tabs, renderTabs)
    rerender(content, () => {
      if (tab === 'trucks') for (const model of TRUCKS) content.appendChild(truckCard(model))
      else for (const model of TRAILERS) content.appendChild(trailerCard(model))
    })
  }
  render()
  return { close: modal.close, update(next: Profile) { profile = next; render() } }
}

function decimal1(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}

export interface GarageOptions extends PanelOptions {
  profile: Profile
  truck: OwnedTruck
  onPreview(look: TruckLook): void
  onSave(look: TruckLook): void
  price(look: TruckLook): number
}

const OPTION_LABELS: Record<string, string> = {
  gloss: 'Gloss', metallic: 'Metallic', matte: 'Matte', none: 'None', pinstripe: 'Pinstripe', band: 'Band', swoosh: 'Swoosh',
  single: 'Single', dual: 'Dual', dualTall: 'Dual tall', stock: 'Stock', chrome: 'Chrome', heavy: 'Heavy', cabBar: 'Cab bar', full: 'Full set',
  steel: 'Steel', polished: 'Polished', black: 'Black', plain: 'Plain', air: 'Air horn',
}

function cloneLook(look: TruckLook): TruckLook {
  return { ...look, paint: { ...look.paint } }
}

/** The paint and parts shop for one truck. `onPreview` fires on every change; closing without saving restores the saved look. */
export function openGarage(root: HTMLElement, options: GarageOptions): PanelHandle {
  const model = TRUCK_BY_ID[options.truck.model]
  const original = cloneLook(options.truck.look)
  const look = cloneLook(original)
  let saved = false
  const total = h('b', { class: 'ts-total' })
  const save = h('button', { class: 'ts-btn primary', attrs: { type: 'button', 'data-key': 'save' } })
  const cancel = h('button', { class: 'ts-btn', text: 'Cancel', attrs: { type: 'button' } })
  const modal = openModal(root, { title: `Garage · ${model ? `${model.brand} ${model.name}` : 'Truck'}`, className: 'ts-garage', onClose: () => { if (!saved) options.onPreview(original); options.onClose?.() } })
  const profileCash = (): number => options.profile.cash

  const changed = (): void => {
    options.onPreview(cloneLook(look))
    const cost = options.price(look)
    total.textContent = `Total ${money(cost)}`
    const short = cost > profileCash()
    save.textContent = cost === 0 ? 'Nothing to save' : short ? `Need ${money(cost - profileCash())} more` : `Save ${money(cost)}`
    save.disabled = cost === 0 || short
  }

  const choice = <K extends 'finish' | 'stripe'>(label: string, key: K, options2: readonly TruckLook['paint'][K][], price: (value: TruckLook['paint'][K]) => number): HTMLElement =>
    optionRow(label, options2 as readonly string[], () => look.paint[key] as string, (value) => { (look.paint as unknown as Record<string, string>)[key] = value; changed() }, (value) => price(value as TruckLook['paint'][K]))

  const part = <K extends 'stacks' | 'bumper' | 'lights' | 'wheels' | 'mudflaps' | 'horn'>(label: string, key: K, values: readonly string[], prices: Record<string, number>): HTMLElement =>
    optionRow(label, values, () => look[key] as string, (value) => { (look as unknown as Record<string, string>)[key] = value; changed() }, (value) => prices[value] ?? 0)

  const primary = colorPicker('Primary paint', look.paint.primary, (value) => { look.paint.primary = value; changed() })
  const secondary = colorPicker('Secondary paint', look.paint.secondary, (value) => { look.paint.secondary = value; changed() })
  const accent = colorPicker('Accent paint', look.paint.accent, (value) => { look.paint.accent = value; changed() })
  const visor = h('input', { attrs: { type: 'checkbox', id: 'ts-visor' }, on: { change: () => { look.visor = visor.checked; changed() } } })
  visor.checked = look.visor

  modal.body.append(h('div', { class: 'ts-stack' },
    h('p', { class: 'ts-note', text: `Cash ${money(profileCash())}. Repainting costs ${money(LOOK_PRICES.repaint)} however many colours you change.` }),
    h('div', { class: 'ts-garage-grid' },
      h('section', {}, h('h3', { class: 'ts-sub', text: 'Paint' }), primary.element, secondary.element, accent.element,
        choice('Finish', 'finish', LOOK_OPTIONS.finish, (value) => LOOK_PRICES.finish[value]),
        choice('Stripe', 'stripe', LOOK_OPTIONS.stripe, (value) => LOOK_PRICES.stripe[value])),
      h('section', {}, h('h3', { class: 'ts-sub', text: 'Parts' }),
        part('Exhaust stacks', 'stacks', LOOK_OPTIONS.stacks, LOOK_PRICES.stacks),
        h('div', { class: 'ts-field' }, h('label', { class: 'ts-check', attrs: { for: 'ts-visor' } }, visor, h('span', { text: `Sun visor (${money(LOOK_PRICES.visor)})` }))),
        part('Bumper', 'bumper', LOOK_OPTIONS.bumper, LOOK_PRICES.bumper),
        part('Lights', 'lights', LOOK_OPTIONS.lights, LOOK_PRICES.lights),
        part('Wheels', 'wheels', LOOK_OPTIONS.wheels, LOOK_PRICES.wheels),
        part('Mud flaps', 'mudflaps', LOOK_OPTIONS.mudflaps, LOOK_PRICES.mudflaps),
        part('Horn', 'horn', LOOK_OPTIONS.horn, LOOK_PRICES.horn))),
    h('div', { class: 'ts-actions end' }, total, cancel, save)))
  save.addEventListener('click', () => {
    saved = true
    options.onSave(cloneLook(look))
    modal.close()
  })
  cancel.addEventListener('click', () => modal.close())
  changed()
  return { close: modal.close }
}

function optionRow(label: string, values: readonly string[], get: () => string, set: (value: string) => void, price: (value: string) => number): HTMLElement {
  const row = h('div', { class: 'ts-segments', attrs: { role: 'radiogroup', 'aria-label': label } })
  const paint = (): void => {
    row.replaceChildren()
    for (const value of values) {
      const cost = price(value)
      const on = get() === value
      row.appendChild(h('button', {
        class: `ts-seg${on ? ' on' : ''}`,
        text: `${OPTION_LABELS[value] ?? value}${cost > 0 ? ` ${money(cost)}` : ''}`,
        attrs: { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-key': `${label}-${value}` },
        on: { click: () => { set(value); const keep = `${label}-${value}`; paint(); row.querySelector<HTMLElement>(`[data-key="${keep}"]`)?.focus() } },
      }))
    }
  }
  paint()
  return h('div', { class: 'ts-field' }, h('span', { class: 'ts-label', text: label }), row)
}

export interface FleetOptions extends PanelOptions {
  profile: Profile
  onSelect(truckUid: string, trailerUid: string | null): void
  onSell(kind: 'truck' | 'trailer', uid: string): void
  onRepair(uid: string): void
  onRefuel(uid: string): void
  onCustomise?(uid: string): void
  repairCost(uid: string): number
  refuelCost(uid: string): number
  sellValue(kind: 'truck' | 'trailer', uid: string): number
}

/** Owned trucks and trailers with damage, fuel and odometer; Select, Sell (asks to confirm), Repair and Refuel show their costs. */
export function openFleet(root: HTMLElement, options: FleetOptions): UpdatableHandle {
  let profile = options.profile
  let confirming: string | null = null
  const content = h('div', { class: 'ts-stack' })
  const cash = h('b', { class: 'ts-cash' })
  const modal = openModal(root, { title: 'Fleet', className: 'ts-wide', onClose: options.onClose })
  modal.body.append(h('p', { class: 'ts-note' }, 'Cash ', cash), content)

  const sellButton = (kind: 'truck' | 'trailer', uid: string, disabled: boolean): HTMLElement => {
    const key = `${kind}-${uid}`
    const asking = confirming === key
    return h('button', {
      class: `ts-btn${asking ? ' bad' : ''}`,
      text: asking ? `Confirm sell for ${money(options.sellValue(kind, uid))}` : `Sell ${money(options.sellValue(kind, uid))}`,
      attrs: { type: 'button', 'data-key': `sell-${key}`, ...(disabled ? { disabled: '' } : {}) },
      on: { click: () => { if (asking) { confirming = null; options.onSell(kind, uid) } else { confirming = key; render() } } },
    })
  }

  const truckCard = (truck: OwnedTruck): HTMLElement => {
    const model = TRUCK_BY_ID[truck.model]
    const active = truck.uid === profile.activeTruck
    const repair = options.repairCost(truck.uid)
    const refuel = options.refuelCost(truck.uid)
    const tank = model?.fuelTankL ?? 1
    return h('article', { class: `ts-card${active ? ' active' : ''}` },
      h('div', { class: 'ts-card-main' },
        h('h4', { text: model ? `${model.brand} ${model.name}` : truck.model }, active ? h('span', { class: 'ts-badge', text: 'In use' }) : null),
        h('dl', { class: 'ts-stats' },
          stat('Damage', `${Math.round(truck.damage)}%`),
          stat('Fuel', `${Math.round(truck.fuelL)} / ${Math.round(tank)} L`),
          stat('Odometer', `${whole(truck.odometerKm)} km`))),
      h('div', { class: 'ts-card-side' },
        h('button', { class: 'ts-btn primary', text: active ? 'Selected' : 'Select', attrs: { type: 'button', 'data-key': `select-${truck.uid}`, ...(active ? { disabled: '' } : {}) }, on: { click: () => options.onSelect(truck.uid, profile.activeTrailer) } }),
        options.onCustomise ? h('button', { class: 'ts-btn', text: 'Paint and parts', attrs: { type: 'button', 'data-key': `paint-${truck.uid}` }, on: { click: () => options.onCustomise?.(truck.uid) } }) : null,
        h('button', { class: 'ts-btn', text: repair > 0 ? `Repair ${money(repair)}` : 'No repairs needed', attrs: { type: 'button', 'data-key': `repair-${truck.uid}`, ...(repair <= 0 || repair > profile.cash ? { disabled: '' } : {}) }, on: { click: () => options.onRepair(truck.uid) } }),
        h('button', { class: 'ts-btn', text: refuel > 0 ? `Refuel ${money(refuel)}` : 'Tank full', attrs: { type: 'button', 'data-key': `refuel-${truck.uid}`, ...(refuel <= 0 || refuel > profile.cash ? { disabled: '' } : {}) }, on: { click: () => options.onRefuel(truck.uid) } }),
        sellButton('truck', truck.uid, profile.trucks.length <= 1 || active)))
  }

  const trailerCard = (trailer: OwnedTrailer): HTMLElement => {
    const model = TRAILER_BY_ID[trailer.model]
    const active = trailer.uid === profile.activeTrailer
    const repair = options.repairCost(trailer.uid)
    return h('article', { class: `ts-card${active ? ' active' : ''}` },
      h('div', { class: 'ts-card-main' },
        h('h4', { text: model?.name ?? trailer.model }, active ? h('span', { class: 'ts-badge', text: 'Hitched' }) : null),
        h('dl', { class: 'ts-stats' }, stat('Damage', `${Math.round(trailer.damage)}%`), model ? stat('Payload', `${decimal1(model.maxPayloadKg / 1000)} t`) : null)),
      h('div', { class: 'ts-card-side' },
        h('button', { class: 'ts-btn primary', text: active ? 'Hitched' : 'Select', attrs: { type: 'button', 'data-key': `select-${trailer.uid}`, ...(active ? { disabled: '' } : {}) }, on: { click: () => options.onSelect(profile.activeTruck, trailer.uid) } }),
        h('button', { class: 'ts-btn', text: repair > 0 ? `Repair ${money(repair)}` : 'No repairs needed', attrs: { type: 'button', 'data-key': `repair-${trailer.uid}`, ...(repair <= 0 || repair > profile.cash ? { disabled: '' } : {}) }, on: { click: () => options.onRepair(trailer.uid) } }),
        sellButton('trailer', trailer.uid, active)))
  }

  const render = (): void => {
    cash.textContent = money(profile.cash)
    rerender(content, () => {
      content.appendChild(h('h3', { class: 'ts-sub', text: `Trucks (${profile.trucks.length})` }))
      const trucks = h('div', { class: 'ts-grid' })
      for (const truck of profile.trucks) trucks.appendChild(truckCard(truck))
      content.appendChild(trucks)
      content.appendChild(h('h3', { class: 'ts-sub', text: `Trailers (${profile.trailers.length})` }))
      const trailers = h('div', { class: 'ts-grid' })
      for (const trailer of profile.trailers) trailers.appendChild(trailerCard(trailer))
      if (profile.trailers.length === 0) trailers.appendChild(h('p', { class: 'ts-note', text: 'No trailers yet. Buy one at the dealer.' }))
      else if (profile.activeTrailer !== null) trailers.appendChild(h('button', { class: 'ts-btn', text: 'Drop trailer (drive without one)', attrs: { type: 'button', 'data-key': 'no-trailer' }, on: { click: () => options.onSelect(profile.activeTruck, null) } }))
      content.appendChild(trailers)
    })
  }
  render()
  return { close: modal.close, update(next: Profile) { profile = next; if (confirming && !hasUid(next, confirming)) confirming = null; render() } }
}

function hasUid(profile: Profile, key: string): boolean {
  const uid = key.slice(key.indexOf('-') + 1)
  return profile.trucks.some((truck) => truck.uid === uid) || profile.trailers.some((trailer) => trailer.uid === uid)
}

