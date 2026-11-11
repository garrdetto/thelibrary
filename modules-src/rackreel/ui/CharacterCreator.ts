import { BEARDS, BODY_SLIDERS, DEFAULT_APPEARANCE, FACES, HAIR, SHAPE_SLIDERS, SLIDER_LABEL } from '../shared/Appearance'
import type { Appearance, BodySlider, HeadOption, ShapeSlider } from '../shared/Appearance'
import { CHARACTER_CHOICES, ITEM_BY_ID, LOOK_SLOTS } from '../shared/Economy'
import type { Look, LookSlot } from '../shared/Economy'

const SLOT_LABEL: Record<LookSlot, string> = { jacket: 'Top', vest: 'Vest', cap: 'Hat', pants: 'Pants', pack: 'Pack' }

export type CreatorTab = 'face' | 'body' | 'clothes'
/** `create` makes a new character; `makeover` is the one free change of face, hair and build for a character made earlier. */
export type CreatorMode = 'create' | 'makeover'

const TAB_LABEL: Record<CreatorTab, string> = { face: 'Face', body: 'Body', clothes: 'Clothes' }
const COPY: Record<CreatorMode, { eyebrow: string; title: string; intro: string; confirm: string; saving: string }> = {
  create: {
    eyebrow: 'Before you head out',
    title: 'Create your character',
    intro: 'Pick how your hunter looks. Everything you choose is yours to keep, and you can change clothes later at the cabin armoire.',
    confirm: 'Create character',
    saving: 'Saving your character…',
  },
  makeover: {
    eyebrow: 'New this season',
    title: 'Update your look',
    intro: 'Faces, hair, beards and body sizes are new. Set yours now: this change can be made once, and your clothes stay as they are.',
    confirm: 'Save my look',
    saving: 'Saving your look…',
  },
}

export interface CreatorHooks {
  preview: (look: Look, appearance: Appearance) => void
  /** Called when a tab opens, so the camera can frame the face or the whole body. */
  focus: (tab: CreatorTab) => void
  submit: (look: Look, appearance: Appearance) => Promise<string | null>
  done: () => void
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * The character creator shown before a player's first outing (and to anyone whose profile is not
 * yet verified), and once more to earlier characters when new looks arrive. Each pick is previewed
 * on the hunter in the world; the button saves it.
 */
export class CharacterCreator {
  private readonly root: HTMLDivElement
  private readonly eyebrow: HTMLDivElement
  private readonly title: HTMLHeadingElement
  private readonly intro: HTMLParagraphElement
  private readonly tabs: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly status: HTMLParagraphElement
  private readonly confirm: HTMLButtonElement
  private look: Look = { jacket: '', vest: '', cap: '', pants: '', pack: '' }
  private appearance: Appearance = { ...DEFAULT_APPEARANCE }
  private mode: CreatorMode = 'create'
  private tab: CreatorTab = 'face'
  private hooks: CreatorHooks = { preview: () => undefined, focus: () => undefined, submit: async () => null, done: () => undefined }

  constructor() {
    this.root = h('div', 'rr-screen creator-screen')
    this.root.id = 'creator'
    this.root.hidden = true
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-labelledby', 'creator-title')
    const card = h('div', 'rr-card creator-card')
    this.eyebrow = h('div', 'rr-eyebrow')
    this.title = h('h2')
    this.title.id = 'creator-title'
    this.intro = h('p')
    this.tabs = h('div', 'creator-tabs')
    this.tabs.setAttribute('role', 'tablist')
    this.tabs.setAttribute('aria-label', 'What to change')
    this.body = h('div', 'creator-body')
    this.body.id = 'creator-panel'
    this.body.setAttribute('role', 'tabpanel')
    this.status = h('p', 'creator-status')
    this.status.setAttribute('role', 'status')
    const actions = h('div', 'rr-actions')
    this.confirm = h('button', 'rr-btn primary')
    this.confirm.type = 'button'
    this.confirm.addEventListener('click', () => void this.finish())
    actions.append(this.confirm)
    card.append(this.eyebrow, this.title, this.intro, this.tabs, this.body, this.status, actions)
    this.root.append(card)
    document.body.append(this.root)
  }

  get open(): boolean {
    return !this.root.hidden
  }

  show(start: { look: Look; appearance: Appearance }, mode: CreatorMode, hooks: CreatorHooks): void {
    this.look = { ...start.look }
    this.appearance = { ...start.appearance }
    this.mode = mode
    this.hooks = hooks
    for (const slot of LOOK_SLOTS) if (mode === 'create' && !CHARACTER_CHOICES[slot].includes(this.look[slot])) this.look[slot] = CHARACTER_CHOICES[slot][0]
    const copy = COPY[mode]
    this.eyebrow.textContent = copy.eyebrow
    this.title.textContent = copy.title
    this.intro.textContent = copy.intro
    this.confirm.textContent = copy.confirm
    this.status.textContent = ''
    this.confirm.disabled = false
    this.tab = 'face'
    this.renderTabs()
    this.render()
    this.root.hidden = false
    this.hooks.preview(this.look, this.appearance)
    this.hooks.focus(this.tab)
    this.tabs.querySelector<HTMLButtonElement>('button')?.focus()
  }

  private renderTabs(): void {
    this.tabs.replaceChildren()
    const list: CreatorTab[] = this.mode === 'create' ? ['face', 'body', 'clothes'] : ['face', 'body']
    for (const tab of list) {
      const b = h('button', 'rr-btn creator-tab', TAB_LABEL[tab])
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-controls', 'creator-panel')
      b.setAttribute('aria-selected', String(tab === this.tab))
      b.addEventListener('click', () => {
        this.tab = tab
        for (const other of this.tabs.querySelectorAll('button')) other.setAttribute('aria-selected', String(other === b))
        this.render()
        this.hooks.focus(tab)
      })
      this.tabs.append(b)
    }
  }

  private changed(): void {
    this.hooks.preview(this.look, this.appearance)
  }

  private render(): void {
    this.body.replaceChildren()
    if (this.tab === 'face') {
      this.body.append(
        this.picker('Face', FACES, this.appearance.face, (id) => (this.appearance.face = id)),
        this.picker('Hair', HAIR, this.appearance.hair, (id) => (this.appearance.hair = id)),
        this.picker('Facial hair', BEARDS, this.appearance.beard, (id) => (this.appearance.beard = id)),
        this.sliders('Face shape', SHAPE_SLIDERS),
      )
    } else if (this.tab === 'body') {
      this.body.append(this.sliders('Body', BODY_SLIDERS))
    } else {
      for (const slot of LOOK_SLOTS) {
        const choices = CHARACTER_CHOICES[slot]
        if (choices.length < 2) continue
        const options = choices.map((id) => ({ id, name: ITEM_BY_ID[id]?.name ?? id }))
        this.body.append(this.picker(SLOT_LABEL[slot], options, this.look[slot], (id) => (this.look[slot] = id)))
      }
    }
  }

  private picker(label: string, options: HeadOption[], current: string, pick: (id: string) => void): HTMLFieldSetElement {
    const group = h('fieldset', 'creator-group')
    const legend = h('legend', undefined, label)
    const row = h('div', 'creator-row')
    row.setAttribute('role', 'radiogroup')
    row.setAttribute('aria-label', label)
    for (const option of options) {
      const b = h('button', 'rr-btn creator-pick', option.name)
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(current === option.id))
      b.addEventListener('click', () => {
        pick(option.id)
        for (const other of row.querySelectorAll('button')) other.setAttribute('aria-checked', String(other === b))
        this.changed()
      })
      row.append(b)
    }
    group.append(legend, row)
    return group
  }

  private sliders(label: string, keys: readonly (ShapeSlider | BodySlider)[]): HTMLFieldSetElement {
    const group = h('fieldset', 'creator-group')
    const legend = h('legend', undefined, label)
    const list = h('div', 'creator-sliders')
    const inputs: HTMLInputElement[] = []
    for (const key of keys) {
      const copy = SLIDER_LABEL[key]
      const row = h('label', 'creator-slider')
      const name = h('span', 'creator-slider-name', copy.name)
      const input = h('input')
      input.type = 'range'
      input.min = '-1'
      input.max = '1'
      input.step = '0.1'
      input.value = String(this.appearance[key])
      input.setAttribute('aria-valuetext', this.describe(key, this.appearance[key]))
      input.addEventListener('input', () => {
        this.appearance[key] = Number(input.value)
        input.setAttribute('aria-valuetext', this.describe(key, this.appearance[key]))
        this.changed()
      })
      const ends = h('span', 'creator-slider-ends')
      ends.append(h('span', undefined, copy.low), h('span', undefined, copy.high))
      row.append(name, input, ends)
      list.append(row)
      inputs.push(input)
    }
    const reset = h('button', 'rr-btn creator-reset', 'Reset')
    reset.type = 'button'
    reset.addEventListener('click', () => {
      keys.forEach((key, i) => {
        this.appearance[key] = 0
        inputs[i].value = '0'
        inputs[i].setAttribute('aria-valuetext', this.describe(key, 0))
      })
      this.changed()
    })
    group.append(legend, list, reset)
    return group
  }

  private describe(key: ShapeSlider | BodySlider, value: number): string {
    const copy = SLIDER_LABEL[key]
    if (value === 0) return 'As modelled'
    return `${value < 0 ? copy.low : copy.high}, ${Math.round(Math.abs(value) * 100)}%`
  }

  private async finish(): Promise<void> {
    this.confirm.disabled = true
    this.status.textContent = COPY[this.mode].saving
    const error = await this.hooks.submit(this.look, this.appearance)
    if (error) {
      this.status.textContent = error
      this.confirm.disabled = false
      return
    }
    this.root.hidden = true
    this.hooks.done()
  }
}
