/**
 * The administrators' developer panel (F10). Everything that changes the career runs on a sandbox copy that is never saved:
 * entering the sandbox swaps in a rich copy of the profile, so new trucks, designs, trailers, lots and washes can be tried freely,
 * and reloading the page brings back the real career. Teleport, time of day, graphics tier and the memory report work anywhere.
 */
import { DESIGNS, TRAILERS, TRUCKS } from '../shared/Catalog'
import { SITES } from '../shared/WorldLayout'
import type { QualityTier } from '../render/Quality'
import { QUALITY_TIERS } from '../render/Quality'
import { h, openModal } from './dom'
import type { PanelHandle, PanelOptions } from './Panels'

export interface DevPanelOptions extends PanelOptions {
  sandboxed: boolean
  tier: QualityTier
  hours: number
  onSandbox(): void
  onSpawnTruck(modelId: string, designId: string): void
  onSpawnTrailer(modelId: string): void
  onTeleport(x: number, z: number): void
  onHours(hours: number): void
  onTier(tier: QualityTier): void
  onTruckState(change: 'dirty' | 'clean' | 'refuel' | 'repair' | 'damage'): void
  memory(): string
}

function select(label: string, options: readonly [string, string][]): HTMLSelectElement {
  const element = h('select', { class: 'ts-input', attrs: { 'aria-label': label } })
  for (const [value, text] of options) element.appendChild(h('option', { text, attrs: { value } }))
  return element
}

function row(label: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h('div', { class: 'ts-field' }, h('span', { class: 'ts-label', text: label }), h('div', { class: 'ts-row' }, ...children))
}

function button(text: string, key: string, onClick: () => void, disabled = false): HTMLButtonElement {
  return h('button', { class: 'ts-btn', text, attrs: { type: 'button', 'data-key': key, ...(disabled ? { disabled: '' } : {}) }, on: { click: onClick } })
}

export function openDevPanel(root: HTMLElement, options: DevPanelOptions): PanelHandle {
  const modal = openModal(root, { title: 'Developer panel', className: 'ts-wide', onClose: options.onClose })
  const locked = !options.sandboxed
  const truck = select('Truck model', TRUCKS.map((model) => [model.id, `${model.brand} ${model.name}`]))
  const design = select('Design', [['factory', 'Factory'], ...DESIGNS.map((d): [string, string] => [d.id, d.name])])
  const trailer = select('Trailer model', TRAILERS.map((model) => [model.id, model.name]))
  const site = select('Teleport to', SITES.map((s): [string, string] => [s.id, s.name]))
  const tier = select('Graphics quality', QUALITY_TIERS.map((t): [string, string] => [t, t[0].toUpperCase() + t.slice(1)]))
  tier.value = options.tier
  tier.addEventListener('change', () => options.onTier(tier.value as QualityTier))
  const clock = h('output', { class: 'ts-readout', text: hoursText(options.hours) })
  const time = h('input', { class: 'ts-range', attrs: { type: 'range', min: '0', max: '23.75', step: '0.25', value: String(options.hours), 'aria-label': 'Time of day' } })
  time.addEventListener('input', () => {
    clock.textContent = hoursText(Number(time.value))
    options.onHours(Number(time.value))
  })
  const memory = h('pre', { class: 'ts-note', text: options.memory() })
  const sandbox = options.sandboxed
    ? h('p', { class: 'ts-note', text: 'Sandbox on: nothing you do now is saved. Reload the page to get your real career back.' })
    : h('div', { class: 'ts-row' },
      h('p', { class: 'ts-note', text: 'Trucks, trailers and truck changes run on a sandbox copy with $5,000,000 that is never saved.' }),
      button('Enter sandbox', 'sandbox', () => { options.onSandbox(); modal.close() }))
  modal.body.append(h('div', { class: 'ts-stack' },
    sandbox,
    row('Truck', truck, design, button('Drive it', 'spawn-truck', () => options.onSpawnTruck(truck.value, design.value), locked)),
    row('Trailer', trailer, button('Hitch it', 'spawn-trailer', () => options.onSpawnTrailer(trailer.value), locked)),
    row('Truck state',
      button('Dirty', 'dirty', () => options.onTruckState('dirty'), locked),
      button('Clean', 'clean', () => options.onTruckState('clean'), locked),
      button('Damage', 'damage', () => options.onTruckState('damage'), locked),
      button('Repair', 'repair', () => options.onTruckState('repair'), locked),
      button('Fill tank', 'refuel', () => options.onTruckState('refuel'), locked)),
    row('Teleport', site, button('Go', 'teleport', () => {
      const target = SITES.find((s) => s.id === site.value)
      if (target) options.onTeleport(target.x, target.z)
    })),
    row('Time of day', time, clock),
    row('Graphics', tier),
    row('Memory', button('Refresh', 'memory', () => { memory.textContent = options.memory() })),
    memory))
  return { close: modal.close }
}

function hoursText(hours: number): string {
  const whole = Math.floor(hours)
  const minutes = Math.round((hours - whole) * 60)
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
