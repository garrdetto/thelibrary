/** Move-in dialog, the resident editor (add a resident, edit a look) and small prompts. */
import { BODIES, BUILDS, HAIR_COLORS, HAIR_STYLES, OUTFIT_COLORS, SKIN_TONES, defaultLook, type Look } from '../../shared/Look'
import { MAX_SIMS } from '../../shared/Lot'
import { STAGE_LABELS, STARTING_STAGES, type StartingStage } from '../../shared/Family'
import { button, el } from './Ui'

export interface ResidentDraft {
  name: string
  look: Look
  stage: StartingStage
}

export interface HouseholdDraft {
  name: string
  sims: ResidentDraft[]
}

const STYLE_LABELS: Record<string, string> = { short: 'Short', long: 'Long', bun: 'Bun', curly: 'Curly', bald: 'Shaved' }
const BUILD_LABELS: Record<string, string> = { slim: 'Slim', average: 'Average', broad: 'Broad' }
const BODY_LABELS: Record<string, string> = { masculine: 'Masculine', feminine: 'Feminine' }
const STAGE_HINTS: Record<StartingStage, string> = { adult: 'Can work and start a family', teen: 'Grows up in about 3 days', child: 'Grows up in about 6 days' }

function swatches(colors: readonly string[], value: number, label: string, onPick: (index: number) => void): HTMLElement {
  const row = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': label })
  const buttons = colors.map((color, index) => {
    const b = el('button', { type: 'button', class: `sw sm${index === value ? ' on' : ''}`, style: `background:${color}`, role: 'radio', 'aria-checked': String(index === value), 'aria-label': `${label} ${index + 1}` })
    b.addEventListener('click', () => {
      buttons.forEach((other, i) => { other.classList.toggle('on', i === index); other.setAttribute('aria-checked', String(i === index)) })
      onPick(index)
    })
    return b
  })
  row.append(...buttons)
  return row
}

function choices<T extends string>(options: readonly T[], labels: Record<string, string>, value: T, label: string, onPick: (value: T) => void, titles?: Record<string, string>): HTMLElement {
  const row = el('div', { class: 'row', role: 'radiogroup', 'aria-label': label })
  const buttons = options.map(option => {
    const b = el('button', { type: 'button', class: `btn sm${option === value ? ' on' : ''}`, role: 'radio', 'aria-checked': String(option === value), title: titles?.[option] }, labels[option] ?? option)
    b.addEventListener('click', () => {
      buttons.forEach(other => { const on = other === b; other.classList.toggle('on', on); other.setAttribute('aria-checked', String(on)) })
      onPick(option)
    })
    return b
  })
  row.append(...buttons)
  return row
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

export function randomLook(): Look {
  return {
    skin: Math.floor(Math.random() * SKIN_TONES.length),
    hair: Math.floor(Math.random() * HAIR_COLORS.length),
    hairStyle: pick(HAIR_STYLES),
    top: Math.floor(Math.random() * OUTFIT_COLORS.length),
    bottom: Math.floor(Math.random() * OUTFIT_COLORS.length),
    build: pick(BUILDS),
    body: pick(BODIES),
    height: Math.round((0.92 + Math.random() * 0.16) * 100) / 100,
  }
}

/** A round avatar dot: skin over outfit, smaller for younger residents. */
export function avatarDot(look: Look, size = 22): HTMLElement {
  return el('span', { class: 'dot', style: `width:${size}px;height:${size}px;background:linear-gradient(${SKIN_TONES[look.skin]} 45%, ${OUTFIT_COLORS[look.top]} 45%)`, 'aria-hidden': 'true' })
}

/**
 * One resident's card: name, life stage (when it can be picked) and look. Edits `draft` in place.
 * `onChange` runs after anything changes so the caller can refresh previews.
 */
export function residentEditor(draft: ResidentDraft, opts: { title: string; showStage: boolean; open?: boolean; onRemove?: () => void; onChange?: () => void }): HTMLElement {
  const card = el('div', { class: 'simcard' })
  const render = () => {
    const changed = () => { opts.onChange?.(); preview.replaceWith(preview = avatarDot(draft.look, 28)) }
    let preview = avatarDot(draft.look, 28)
    const nameField = el('input', { type: 'text', value: draft.name, maxlength: '24', placeholder: 'First name', 'aria-label': `${opts.title} name` }) as HTMLInputElement
    nameField.addEventListener('input', () => { draft.name = nameField.value; opts.onChange?.() })
    const set = (patch: Partial<Look>) => { draft.look = { ...draft.look, ...patch }; changed() }
    const height = el('input', { type: 'range', min: '90', max: '110', value: String(Math.round(draft.look.height * 100)), 'aria-label': 'Height' }) as HTMLInputElement
    height.addEventListener('input', () => set({ height: Number(height.value) / 100 }))
    const surprise = button('🎲 Surprise me', () => { draft.look = randomLook(); render(); opts.onChange?.() }, 'btn sm', 'Pick a random look')
    const parts: (HTMLElement | null)[] = [
      el('div', { class: 'row', style: 'justify-content:space-between' }, el('div', { class: 'row' }, preview, el('b', {}, opts.title)), el('div', { class: 'row' }, surprise, opts.onRemove ? button('Remove', opts.onRemove, 'btn sm') : null)),
      el('label', { class: 'field' }, el('span', {}, 'Name'), nameField),
      opts.showStage ? el('div', { class: 'field' }, el('span', {}, 'Life stage'), choices(STARTING_STAGES, STAGE_LABELS, draft.stage, 'Life stage', v => { draft.stage = v; opts.onChange?.() }, STAGE_HINTS)) : null,
      el('details', { class: 'looks', open: opts.open !== false },
        el('summary', {}, 'Look'),
        el('div', { class: 'field' }, el('span', {}, 'Body'), choices(BODIES, BODY_LABELS, draft.look.body, 'Body shape', v => set({ body: v }))),
        el('div', { class: 'field' }, el('span', {}, 'Skin'), swatches(SKIN_TONES, draft.look.skin, 'Skin tone', i => set({ skin: i }))),
        el('div', { class: 'field' }, el('span', {}, 'Hair'), choices(HAIR_STYLES, STYLE_LABELS, draft.look.hairStyle, 'Hair style', v => set({ hairStyle: v }))),
        el('div', { class: 'field' }, el('span', {}, 'Hair color'), swatches(HAIR_COLORS, draft.look.hair, 'Hair color', i => set({ hair: i }))),
        el('div', { class: 'field' }, el('span', {}, 'Top'), swatches(OUTFIT_COLORS, draft.look.top, 'Top color', i => set({ top: i }))),
        el('div', { class: 'field' }, el('span', {}, 'Bottoms'), swatches(OUTFIT_COLORS, draft.look.bottom, 'Bottoms color', i => set({ bottom: i }))),
        el('div', { class: 'field' }, el('span', {}, 'Build'), choices(BUILDS, BUILD_LABELS, draft.look.build, 'Build', v => set({ build: v }))),
        el('label', { class: 'field' }, el('span', {}, 'Height'), height),
      ),
    ]
    card.replaceChildren(...parts.filter((n): n is HTMLElement => !!n))
  }
  render()
  return card
}

function modalShell(host: HTMLElement, label: string, onEscape: () => void, ...children: (HTMLElement | null)[]): { modal: HTMLElement; close: () => void } {
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onEscape() } }
  const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, el('div', { class: 'panel dialog' }, ...children))
  addEventListener('keydown', onKey, true)
  host.append(modal)
  return { modal, close: () => { modal.remove(); removeEventListener('keydown', onKey, true) } }
}

export function openHouseholdDialog(host: HTMLElement, address: string, ownerName: string): Promise<HouseholdDraft | null> {
  return new Promise(resolve => {
    const draft: HouseholdDraft = { name: `The ${ownerName.charAt(0).toUpperCase()}${ownerName.slice(1)} Household`.slice(0, 30), sims: [{ name: ownerName.slice(0, 24) || 'Resident', look: defaultLook(), stage: 'adult' }] }
    const cards = el('div', { class: 'simcards' })
    const count = el('span', { class: 'sub' })
    const nameInput = el('input', { type: 'text', value: draft.name, maxlength: '30', 'aria-label': 'Household name' }) as HTMLInputElement
    nameInput.addEventListener('input', () => { draft.name = nameInput.value })
    const add = (stage: StartingStage) => {
      if (draft.sims.length >= MAX_SIMS) return
      draft.sims.push({ name: '', look: stage === 'adult' ? { ...defaultLook(), top: draft.sims.length + 1, hair: (draft.sims.length * 3) % HAIR_COLORS.length } : randomLook(), stage })
      render()
      ;(cards.lastElementChild?.querySelector('input[type=text]') as HTMLInputElement | null)?.focus()
    }
    const addAdult = button('+ Adult', () => add('adult'), 'btn', 'Add another grown-up')
    const addKid = button('+ Child', () => add('child'), 'btn', 'Add a child')
    const error = el('div', { class: 'hint', role: 'alert' })

    const render = () => {
      cards.replaceChildren(...draft.sims.map((sim, index) => residentEditor(sim, {
        title: `Resident ${index + 1}`, showStage: true, open: index === draft.sims.length - 1,
        onRemove: draft.sims.length > 1 ? () => { draft.sims.splice(index, 1); render() } : undefined,
      })))
      addAdult.disabled = addKid.disabled = draft.sims.length >= MAX_SIMS
      count.textContent = `${draft.sims.length} of ${MAX_SIMS} residents`
    }

    const finish = (value: HouseholdDraft | null) => { shell.close(); resolve(value) }
    const submit = button('Move in', () => {
      draft.name = draft.name.trim()
      for (const sim of draft.sims) sim.name = sim.name.trim()
      if (!draft.name) { error.textContent = 'Give your household a name.'; return }
      if (draft.sims.some(s => !s.name)) { error.textContent = 'Every resident needs a first name.'; return }
      if (!draft.sims.some(s => s.stage === 'adult')) { error.textContent = 'At least one resident has to be an adult.'; return }
      finish(draft)
    }, 'btn primary')
    const shell = modalShell(host, 'Move in', () => finish(null),
      el('h2', {}, `Move in at ${address}`),
      el('p', {}, `Name your household and make up to ${MAX_SIMS} residents: adults, teens and children. Two adults who get close can have babies later, and children grow up as you play.`),
      el('label', { class: 'field' }, el('span', {}, 'Household name'), nameInput),
      el('div', { class: 'row', style: 'justify-content:space-between;margin:6px 0' }, count, el('div', { class: 'row' }, addAdult, addKid)),
      cards,
      el('div', { class: 'row', style: 'margin-top:10px;justify-content:flex-end' }, button('Cancel', () => finish(null)), submit),
      error,
    )
    render()
    nameInput.focus()
  })
}

/** Add a resident to an existing household, or edit one's look (`stage` hidden). */
export function openResidentDialog(host: HTMLElement, opts: { title: string; intro: string; submit: string; initial?: Partial<ResidentDraft>; showStage: boolean; showName?: boolean }): Promise<ResidentDraft | null> {
  return new Promise(resolve => {
    const draft: ResidentDraft = { name: opts.initial?.name ?? '', look: opts.initial?.look ?? randomLook(), stage: opts.initial?.stage ?? 'adult' }
    const error = el('div', { class: 'hint', role: 'alert' })
    const editor = residentEditor(draft, { title: opts.initial?.name || 'New resident', showStage: opts.showStage })
    if (opts.showName === false) editor.querySelector('label.field')?.remove()
    const finish = (value: ResidentDraft | null) => { shell.close(); resolve(value) }
    const shell = modalShell(host, opts.title, () => finish(null),
      el('h2', {}, opts.title),
      el('p', {}, opts.intro),
      editor,
      el('div', { class: 'row', style: 'margin-top:10px;justify-content:flex-end' }, button('Cancel', () => finish(null)), button(opts.submit, () => {
        draft.name = draft.name.trim()
        if (opts.showName !== false && !draft.name) { error.textContent = 'Give them a first name.'; return }
        finish(draft)
      }, 'btn primary')),
      error,
    )
    ;(shell.modal.querySelector('input[type=text]') as HTMLInputElement | null)?.focus()
  })
}

export function promptDialog(host: HTMLElement, title: string, label: string, value: string, submit = 'Save'): Promise<string | null> {
  return new Promise(resolve => {
    const input = el('input', { type: 'text', value, maxlength: '24', 'aria-label': label }) as HTMLInputElement
    const finish = (v: string | null) => { shell.close(); resolve(v) }
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && input.value.trim()) finish(input.value.trim()) })
    const shell = modalShell(host, title, () => finish(null),
      el('h2', {}, title),
      el('label', { class: 'field' }, el('span', {}, label), input),
      el('div', { class: 'row', style: 'justify-content:flex-end' }, button('Cancel', () => finish(null)), button(submit, () => input.value.trim() && finish(input.value.trim()), 'btn primary')),
    )
    shell.modal.querySelector('.dialog')?.setAttribute('style', 'max-width:380px')
    input.focus()
    input.select()
  })
}

export function confirmDialog(host: HTMLElement, title: string, body: string, choicesList: { label: string; value: string; primary?: boolean }[]): Promise<string | null> {
  return new Promise(resolve => {
    const close = (value: string | null) => { shell.close(); resolve(value) }
    const shell = modalShell(host, title, () => close(null),
      el('h2', {}, title),
      el('p', {}, body),
      el('div', { class: 'row', style: 'justify-content:flex-end' }, ...choicesList.map(c => button(c.label, () => close(c.value), c.primary ? 'btn primary' : 'btn'))),
    )
    shell.modal.querySelector('.dialog')?.setAttribute('style', 'max-width:420px')
    ;(shell.modal.querySelector('.btn.primary') as HTMLButtonElement | null)?.focus()
  })
}
