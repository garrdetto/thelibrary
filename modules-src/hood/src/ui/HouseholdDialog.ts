/** Move-in dialog: name the household and design up to four residents. */
import { BUILDS, HAIR_COLORS, HAIR_STYLES, OUTFIT_COLORS, SKIN_TONES, defaultLook, type Look } from '../../shared/Look'
import { MAX_SIMS } from '../../shared/Lot'
import { button, el } from './Ui'

export interface HouseholdDraft {
  name: string
  sims: { name: string; look: Look }[]
}

const STYLE_LABELS: Record<string, string> = { short: 'Short', long: 'Long', bun: 'Bun', curly: 'Curly', bald: 'Shaved' }
const BUILD_LABELS: Record<string, string> = { slim: 'Slim', average: 'Average', broad: 'Broad' }

function swatches(colors: readonly string[], value: number, label: string, onPick: (index: number) => void): HTMLElement {
  const row = el('div', { class: 'row', role: 'radiogroup', 'aria-label': label })
  const buttons = colors.map((color, index) => {
    const b = el('button', { type: 'button', class: `sw${index === value ? ' on' : ''}`, style: `background:${color}`, role: 'radio', 'aria-checked': String(index === value), 'aria-label': `${label} ${index + 1}` })
    b.addEventListener('click', () => {
      buttons.forEach((other, i) => { other.classList.toggle('on', i === index); other.setAttribute('aria-checked', String(i === index)) })
      onPick(index)
    })
    return b
  })
  row.append(...buttons)
  return row
}

function choices(options: readonly string[], labels: Record<string, string>, value: string, label: string, onPick: (value: string) => void): HTMLElement {
  const row = el('div', { class: 'row', role: 'radiogroup', 'aria-label': label })
  const buttons = options.map(option => {
    const b = el('button', { type: 'button', class: `btn${option === value ? ' on' : ''}`, role: 'radio', 'aria-checked': String(option === value) }, labels[option] ?? option)
    b.addEventListener('click', () => {
      buttons.forEach(other => { const on = other === b; other.classList.toggle('on', on); other.setAttribute('aria-checked', String(on)) })
      onPick(option)
    })
    return b
  })
  row.append(...buttons)
  return row
}

export function openHouseholdDialog(host: HTMLElement, address: string, ownerName: string): Promise<HouseholdDraft | null> {
  return new Promise(resolve => {
    const draft: HouseholdDraft = { name: `The ${ownerName.charAt(0).toUpperCase()}${ownerName.slice(1)} Household`.slice(0, 30), sims: [{ name: ownerName.slice(0, 24) || 'Resident', look: defaultLook() }] }
    const cards = el('div', { class: 'simcards' })
    const nameInput = el('input', { type: 'text', value: draft.name, maxlength: '30', 'aria-label': 'Household name' }) as HTMLInputElement
    nameInput.addEventListener('input', () => { draft.name = nameInput.value })
    const addButton = button('Add a resident', () => {
      if (draft.sims.length >= MAX_SIMS) return
      draft.sims.push({ name: '', look: { ...defaultLook(), top: draft.sims.length + 1, hair: (draft.sims.length * 3) % HAIR_COLORS.length } })
      render()
    })
    const error = el('div', { class: 'hint', role: 'alert' })

    const render = () => {
      cards.replaceChildren(...draft.sims.map((sim, index) => {
        const nameField = el('input', { type: 'text', value: sim.name, maxlength: '24', placeholder: 'First name', 'aria-label': `Resident ${index + 1} name` }) as HTMLInputElement
        nameField.addEventListener('input', () => { sim.name = nameField.value })
        const set = (patch: Partial<Look>) => { sim.look = { ...sim.look, ...patch } }
        const height = el('input', { type: 'range', min: '90', max: '110', value: String(Math.round(sim.look.height * 100)), 'aria-label': 'Height' }) as HTMLInputElement
        height.addEventListener('input', () => set({ height: Number(height.value) / 100 }))
        return el('div', { class: 'simcard' },
          el('div', { class: 'row', style: 'justify-content:space-between' }, el('b', {}, `Resident ${index + 1}`), draft.sims.length > 1 ? button('Remove', () => { draft.sims.splice(index, 1); render() }) : null),
          el('label', { class: 'field' }, el('span', {}, 'Name'), nameField),
          el('div', { class: 'field' }, el('span', {}, 'Skin'), swatches(SKIN_TONES, sim.look.skin, 'Skin tone', i => set({ skin: i }))),
          el('div', { class: 'field' }, el('span', {}, 'Hair'), choices(HAIR_STYLES, STYLE_LABELS, sim.look.hairStyle, 'Hair style', v => set({ hairStyle: v as Look['hairStyle'] }))),
          el('div', { class: 'field' }, el('span', {}, 'Hair color'), swatches(HAIR_COLORS, sim.look.hair, 'Hair color', i => set({ hair: i }))),
          el('div', { class: 'field' }, el('span', {}, 'Top'), swatches(OUTFIT_COLORS, sim.look.top, 'Top color', i => set({ top: i }))),
          el('div', { class: 'field' }, el('span', {}, 'Bottoms'), swatches(OUTFIT_COLORS, sim.look.bottom, 'Bottoms color', i => set({ bottom: i }))),
          el('div', { class: 'field' }, el('span', {}, 'Build'), choices(BUILDS, BUILD_LABELS, sim.look.build, 'Build', v => set({ build: v as Look['build'] }))),
          el('label', { class: 'field' }, el('span', {}, 'Height'), height),
        )
      }))
      addButton.disabled = draft.sims.length >= MAX_SIMS
    }

    const close = (value: HouseholdDraft | null) => {
      modal.remove()
      removeEventListener('keydown', onKey)
      resolve(value)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(null) }
    addEventListener('keydown', onKey)
    const submit = button('Move in', () => {
      draft.name = draft.name.trim()
      for (const sim of draft.sims) sim.name = sim.name.trim()
      if (!draft.name) { error.textContent = 'Give your household a name.'; return }
      if (draft.sims.some(s => !s.name)) { error.textContent = 'Every resident needs a first name.'; return }
      close(draft)
    }, 'btn primary')
    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Move in' },
      el('div', { class: 'panel dialog' },
        el('h2', {}, `Move in at ${address}`),
        el('p', {}, 'Name your household and make up to four residents. Everyone on the street can stop by your yard; only people you let in at the door come inside.'),
        el('label', { class: 'field' }, el('span', {}, 'Household name'), nameInput),
        cards,
        el('div', { class: 'row', style: 'margin-top:10px;justify-content:space-between' }, addButton, el('div', { class: 'row' }, button('Cancel', () => close(null)), submit)),
        error,
      ),
    )
    render()
    host.append(modal)
    nameInput.focus()
  })
}

export function confirmDialog(host: HTMLElement, title: string, body: string, choicesList: { label: string; value: string; primary?: boolean }[]): Promise<string | null> {
  return new Promise(resolve => {
    const close = (value: string | null) => { modal.remove(); resolve(value) }
    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'panel dialog', style: 'max-width:420px' },
        el('h2', {}, title),
        el('p', {}, body),
        el('div', { class: 'row', style: 'justify-content:flex-end' }, ...choicesList.map(c => button(c.label, () => close(c.value), c.primary ? 'btn primary' : 'btn'))),
      ),
    )
    host.append(modal)
    ;(modal.querySelector('.btn.primary') as HTMLButtonElement | null)?.focus()
  })
}

