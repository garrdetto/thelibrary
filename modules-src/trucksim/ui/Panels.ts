/**
 * The menu panels that are not shops: the start screen, the job board, the map, the pause menu and the help page. Each mounts a modal
 * into the root it is given and returns a handle; the job board can be refreshed while open. Copy says haul, drive and career.
 */
import { BINDINGS } from '../systems/Keys'
import type { KeyGroup } from '../systems/Keys'
import { CARGO_BY_ID } from '../shared/Catalog'
import type { HaulKind } from '../shared/Catalog'
import type { Profile } from '../shared/Economy'
import type { Job } from '../shared/Jobs'
import type { SiteKind } from '../shared/WorldLayout'
import { decimal, h, keyLabel, money, openModal, rerender, tonnes } from './dom'

export interface PanelOptions {
  onClose?: () => void
}

export interface PanelHandle {
  close(): void
}

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra'

export interface StartOptions extends PanelOptions {
  signedIn: boolean
  username: string | null
  company: string
  onStart(company: string): void
}

/** The title screen: a pitch, who is driving, the company name (signed in) and the controls. */
export function showStart(root: HTMLElement, options: StartOptions): PanelHandle {
  const input = h('input', { class: 'ts-input', attrs: { type: 'text', maxlength: '32', value: options.company, 'aria-label': 'Company name', autocomplete: 'off', spellcheck: 'false' } })
  let started = false
  const start = (): void => {
    if (started) return
    started = true
    const company = input.value.trim() || options.company
    modal.close()
    options.onStart(company)
  }
  const identity = options.signedIn
    ? h('div', { class: 'ts-field' }, h('span', { class: 'ts-label', text: `Driving as ${options.username ?? 'you'}` }), h('label', { class: 'ts-label', text: 'Company name' }, input))
    : h('p', { class: 'ts-note', text: 'You are playing as a guest — progress resets when you leave.' })
  const body = h('div', { class: 'ts-stack' },
    h('p', { class: 'ts-pitch', text: 'Haul gravel, fuel, grain, steel and heavy equipment around a 4 km county, earn your way into a semi, and build your own truck lot.' }),
    identity,
    h('div', { class: 'ts-actions' }, h('button', { class: 'ts-btn primary big', text: 'Start driving', attrs: { type: 'button', 'data-key': 'start' }, on: { click: start } })),
    controlsList(['drive', 'rig', 'menu']))
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') start() })
  const modal = openModal(root, { title: 'Truck Simulator', className: 'ts-start', onClose: options.onClose, initialFocus: () => root.querySelector<HTMLElement>('[data-key="start"]') })
  modal.body.appendChild(body)
  return { close: modal.close }
}

const GROUP_TITLES: Record<KeyGroup, string> = { drive: 'Driving', rig: 'Rig and loads', menu: 'Menus' }

function controlsList(groups: readonly KeyGroup[]): HTMLElement {
  const wrap = h('div', { class: 'ts-controls' })
  for (const group of groups) {
    const list = h('dl', { class: 'ts-keys' })
    for (const binding of BINDINGS) {
      if (binding.group !== group) continue
      const caps = h('dd', { class: 'ts-caps' })
      binding.codes.forEach((code, i) => {
        if (i > 0) caps.appendChild(document.createTextNode(' / '))
        caps.appendChild(h('kbd', { text: keyLabel(code) }))
      })
      list.appendChild(h('div', {}, h('dt', { text: binding.label }), caps))
    }
    wrap.appendChild(h('section', {}, h('h3', { class: 'ts-sub', text: GROUP_TITLES[group] }), list))
  }
  return wrap
}

const HAUL_TITLES: Record<HaulKind, string> = {
  dump: 'Dump hauls',
  tanker: 'Tanker hauls',
  flatbed: 'Flatbed hauls',
  grain: 'Grain hauls',
  reefer: 'Reefer hauls',
  lowboy: 'Equipment hauls (lowboy)',
}

const HAUL_ORDER: readonly HaulKind[] = ['dump', 'tanker', 'flatbed', 'grain', 'reefer', 'lowboy']

export interface JobBoardOptions extends PanelOptions {
  jobs: readonly Job[]
  profile: Profile
  canTake(job: Job): string | null
  onAccept(job: Job): void
  onAbandon(): void
  siteName?(id: string): string
}

export interface JobBoardHandle extends PanelHandle {
  update(profile: Profile, jobs?: readonly Job[]): void
}

/** Jobs grouped by haul with an Accept button that carries the reason it is disabled; the active job shows with Abandon. */
export function openJobBoard(root: HTMLElement, options: JobBoardOptions): JobBoardHandle {
  let profile = options.profile
  let jobs = options.jobs
  const name = options.siteName ?? ((id: string) => id)
  const list = h('div', { class: 'ts-stack' })
  const modal = openModal(root, { title: 'Job board', className: 'ts-wide', onClose: options.onClose })
  modal.body.appendChild(list)

  const card = (job: Job, active: boolean): HTMLElement => {
    const cargo = CARGO_BY_ID[job.cargo]
    const reason = active ? null : options.canTake(job)
    const actions = active
      ? h('button', { class: 'ts-btn bad', text: 'Abandon', attrs: { type: 'button', 'data-key': 'abandon' }, on: { click: () => options.onAbandon() } })
      : h('button', { class: 'ts-btn primary', text: 'Accept', attrs: { type: 'button', 'data-key': `accept-${job.id}`, ...(reason ? { disabled: '', 'aria-describedby': `why-${job.id}` } : {}) }, on: { click: () => options.onAccept(job) } })
    return h('article', { class: `ts-card${active ? ' active' : ''}` },
      h('div', { class: 'ts-card-main' },
        h('h4', { text: `${cargo?.name ?? job.cargo} · ${tonnes(job.massKg)}` }),
        h('p', { class: 'ts-route', text: `${name(job.from)} → ${name(job.to)}` }),
        h('p', { class: 'ts-meta', text: `${decimal(job.distanceM / 1000)} km · about ${Math.round(job.minutes)} min` })),
      h('div', { class: 'ts-card-side' }, h('b', { class: 'ts-price', text: money(job.pay) }), actions,
        reason ? h('span', { class: 'ts-why', text: reason, attrs: { id: `why-${job.id}` } }) : null))
  }

  const render = (): void => {
    rerender(list, () => {
      const active = profile.job
      if (active) list.appendChild(h('section', {}, h('h3', { class: 'ts-sub', text: 'Your active job' }), card(active.job, true)))
      for (const haul of HAUL_ORDER) {
        const group = jobs.filter((job) => job.haul === haul && job.id !== active?.job.id)
        if (group.length === 0) continue
        const section = h('section', {}, h('h3', { class: 'ts-sub', text: HAUL_TITLES[haul] }))
        const grid = h('div', { class: 'ts-grid' })
        for (const job of group) grid.appendChild(card(job, false))
        section.appendChild(grid)
        list.appendChild(section)
      }
      if (!active && jobs.length === 0) list.appendChild(h('p', { class: 'ts-note', text: 'No jobs right now. New hauls are posted every half hour.' }))
    })
  }
  render()
  return {
    close: modal.close,
    update(next: Profile, nextJobs?: readonly Job[]) {
      profile = next
      if (nextJobs) jobs = nextJobs
      render()
    },
  }
}

export const SITE_KIND_COLORS: Record<SiteKind, string> = {
  dealership: '#f2a33a', truckStop: '#e0a12b', fuelStation: '#e05a3a', quarry: '#9a8f7a', construction: '#d8a21c', equipmentYard: '#c9ccd1',
  refinery: '#7a8896', farm: '#7fc46a', elevator: '#c9b26a', coldStorage: '#6fb7e0', distribution: '#4f93c4', steelMill: '#8d969e',
  lumberYard: '#a8794a', buildingSupply: '#b48a5a', town: '#d7d9dd', lotDistrict: '#f2a33a',
}

const SITE_KIND_NAMES: Record<SiteKind, string> = {
  dealership: 'Dealership', truckStop: 'Truck stop', fuelStation: 'Fuel station', quarry: 'Quarry', construction: 'Construction site',
  equipmentYard: 'Equipment yard', refinery: 'Refinery', farm: 'Farm', elevator: 'Grain elevator', coldStorage: 'Cold storage',
  distribution: 'Distribution centre', steelMill: 'Steel works', lumberYard: 'Lumber yard', buildingSupply: 'Building supply', town: 'Town', lotDistrict: 'Haulers Row',
}

export interface MapOptions extends PanelOptions {
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void
  refreshMs?: number
  /** A click on the map at (x, y) in a `width` × `height` canvas; the map redraws afterwards. */
  onPick?(x: number, y: number, width: number, height: number): void
  /** Clears the picked destination (shows a Clear route button when given). */
  onClearPick?(): void
}

export interface MapHandle extends PanelHandle {
  redraw(): void
}

/** A big canvas the game paints the county on, with a legend of site kinds. Repaints on resize and every `refreshMs` (default 250). */
export function openMap(root: HTMLElement, options: MapOptions): MapHandle {
  const canvas = h('canvas', { class: 'ts-map-canvas', attrs: { role: 'img', 'aria-label': 'County map' } })
  const legend = h('ul', { class: 'ts-legend', attrs: { 'aria-label': 'Map legend' } })
  for (const kind of Object.keys(SITE_KIND_NAMES) as SiteKind[]) {
    const swatch = h('i', { attrs: { 'aria-hidden': 'true' } })
    swatch.style.background = SITE_KIND_COLORS[kind]
    legend.appendChild(h('li', {}, swatch, h('span', { text: SITE_KIND_NAMES[kind] })))
  }
  const frame = h('div', { class: 'ts-map-frame' }, canvas)
  const modal = openModal(root, { title: 'County map', className: 'ts-wide ts-map', onClose: () => { window.clearInterval(timer); observer.disconnect(); options.onClose?.() } })
  if (options.onPick) {
    canvas.style.cursor = 'crosshair'
    canvas.addEventListener('click', (event) => {
      const rect = canvas.getBoundingClientRect()
      options.onPick?.(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height)
      redraw()
    })
    const clear = options.onClearPick
      ? h('button', { class: 'ts-btn', text: 'Clear route', attrs: { type: 'button', 'data-key': 'clear-route' }, on: { click: () => { options.onClearPick?.(); redraw() } } })
      : null
    modal.body.append(h('div', { class: 'ts-bar' }, h('p', { class: 'ts-note', text: 'Click where you want to go and the route shows on your minimap. Esc or M closes the map.' }), clear))
  }
  modal.body.append(frame, legend)
  const redraw = (): void => {
    const rect = frame.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.max(200, Math.floor(rect.width))
    const height = Math.max(200, Math.floor(rect.height))
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    options.draw(ctx, width, height)
  }
  const observer = new ResizeObserver(redraw)
  observer.observe(frame)
  const timer = window.setInterval(redraw, options.refreshMs ?? 250)
  redraw()
  return { close: modal.close, redraw }
}

export interface PauseOptions extends PanelOptions {
  tier: QualityTier
  volume: number
  onTier(tier: QualityTier): void
  onVolume(volume: number): void
  onResume(): void
}

const TIERS: readonly QualityTier[] = ['low', 'medium', 'high', 'ultra']

/** Resume, graphics quality, volume, the controls list, and a Help button. Any way of closing it calls `onResume` once. */
export function openPause(root: HTMLElement, options: PauseOptions): PanelHandle {
  const select = h('select', { class: 'ts-input', attrs: { 'aria-label': 'Graphics quality' }, on: { change: () => options.onTier(select.value as QualityTier) } })
  for (const tier of TIERS) select.appendChild(h('option', { text: tier[0].toUpperCase() + tier.slice(1), attrs: { value: tier, ...(tier === options.tier ? { selected: '' } : {}) } }))
  const readout = h('output', { class: 'ts-readout', text: `${Math.round(options.volume * 100)}%` })
  const slider = h('input', { class: 'ts-range', attrs: { type: 'range', min: '0', max: '1', step: '0.05', value: String(options.volume), 'aria-label': 'Volume' }, on: { input: () => {
    const value = Number(slider.value)
    readout.textContent = `${Math.round(value * 100)}%`
    options.onVolume(value)
  } } })
  let resumed = false
  const resume = (): void => {
    if (resumed) return
    resumed = true
    options.onResume()
  }
  const modal = openModal(root, { title: 'Paused', className: 'ts-pause', onClose: () => { resume(); options.onClose?.() }, initialFocus: () => root.querySelector<HTMLElement>('[data-key="resume"]') })
  modal.body.appendChild(h('div', { class: 'ts-stack' },
    h('div', { class: 'ts-actions' },
      h('button', { class: 'ts-btn primary big', text: 'Resume', attrs: { type: 'button', 'data-key': 'resume' }, on: { click: () => modal.close() } }),
      h('button', { class: 'ts-btn', text: 'Help', attrs: { type: 'button' }, on: { click: () => openHelp(root) } })),
    h('div', { class: 'ts-settings' },
      h('label', { class: 'ts-field' }, h('span', { class: 'ts-label', text: 'Graphics quality' }), select),
      h('label', { class: 'ts-field' }, h('span', { class: 'ts-label', text: 'Volume' }), h('span', { class: 'ts-row' }, slider, readout))),
    controlsList(['drive', 'rig', 'menu'])))
  return { close: modal.close }
}

export interface HelpSection {
  title: string
  load: string[]
  unload: string[]
}

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    title: 'Dump truck',
    load: ['Drive into the loading zone and stop.', 'Set the parking brake.', 'Wait while the excavator or wheel loader fills the bed.'],
    unload: ['Stop in the drop zone and set the parking brake.', 'Raise the bed until the load has poured out.', 'Lower the bed again before you drive off.'],
  },
  {
    title: 'Fuel tanker',
    load: ['Stop at the loading rack and set the parking brake.', 'Connect the loading arm.', 'Wait for the tank to fill, then disconnect.'],
    unload: ['Stop at the station tank and set the parking brake.', 'Connect the hose.', 'Wait while the tank drains, then disconnect.'],
  },
  {
    title: 'Flatbed',
    load: ['Stop at the bay and set the parking brake.', 'Wait while the forklift or crane places the load.', 'Strap down every tie point.'],
    unload: ['Stop at the drop bay and set the parking brake.', 'Release every strap.', 'Wait while the load is taken off.'],
  },
  {
    title: 'Grain hopper',
    load: ['Line the hopper up under the spout.', 'Open the tarp.', 'Wait for the fill, then close the tarp.'],
    unload: ['Line up over the pit.', 'Open the hopper gates.', 'Wait until the hopper is empty, then close the gates.'],
  },
  {
    title: 'Reefer',
    load: ['Back square into the dock: within 1 m and 5 degrees of straight.', 'Open the rear doors.', 'Wait for the forklift, then close the doors. The cooling unit keeps the load cold.'],
    unload: ['Back into the receiving dock the same way.', 'Open the doors.', 'Wait while the pallets come out.'],
  },
  {
    title: 'Lowboy and equipment',
    load: ['Park on level ground at the yard.', 'Lower the deck and detach the gooseneck.', 'Pull the tractor forward and drive the excavator onto the deck.', 'Back the tractor in to reconnect, raise the deck, then chain down all four points.'],
    unload: ['Lower the deck and detach the gooseneck.', 'Drive the excavator off into the drop zone.', 'Reconnect the tractor to the trailer.'],
  },
]

/** The realistic loading and unloading steps for every haul, in plain words. */
export function openHelp(root: HTMLElement, options: PanelOptions = {}): PanelHandle {
  const modal = openModal(root, { title: 'How hauls work', className: 'ts-wide', onClose: options.onClose })
  const wrap = h('div', { class: 'ts-grid' })
  for (const section of HELP_SECTIONS) {
    const steps = (items: readonly string[]): HTMLElement => {
      const list = h('ol', { class: 'ts-help-steps' })
      for (const item of items) list.appendChild(h('li', { text: item }))
      return list
    }
    wrap.appendChild(h('article', { class: 'ts-card help' },
      h('h4', { text: section.title }),
      h('h5', { class: 'ts-sub', text: 'Loading' }), steps(section.load),
      h('h5', { class: 'ts-sub', text: 'Unloading' }), steps(section.unload)))
  }
  modal.body.appendChild(h('div', { class: 'ts-stack' },
    h('p', { class: 'ts-note', text: 'Pay grows with distance and weight, drops by up to 40 percent for damaged cargo, and gains 15 percent when you arrive on time. Follow the step list on the left of the screen.' }),
    wrap))
  return { close: modal.close }
}
