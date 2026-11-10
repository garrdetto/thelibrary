import { CHARACTER_CHOICES, ITEM_BY_ID, LOOK_SLOTS } from '../shared/Economy'
import type { Look, LookSlot } from '../shared/Economy'

const SLOT_LABEL: Record<LookSlot, string> = { jacket: 'Top', vest: 'Vest', cap: 'Hat', pants: 'Pants', pack: 'Pack' }

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * The character creator shown before a player's first outing (and to anyone whose profile is not
 * yet verified). Each pick is previewed on the hunter in the world; Create saves it.
 */
export class CharacterCreator {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly status: HTMLParagraphElement
  private readonly confirm: HTMLButtonElement
  private look: Look = { jacket: '', vest: '', cap: '', pants: '', pack: '' }
  private preview: (look: Look) => void = () => undefined
  private submit: (look: Look) => Promise<string | null> = async () => null
  private done: () => void = () => undefined

  constructor() {
    this.root = h('div', 'rr-screen creator-screen')
    this.root.id = 'creator'
    this.root.hidden = true
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-labelledby', 'creator-title')
    const card = h('div', 'rr-card creator-card')
    const eyebrow = h('div', 'rr-eyebrow', 'Before you head out')
    const title = h('h2', undefined, 'Create your character')
    title.id = 'creator-title'
    const intro = h('p', undefined, 'Pick how your hunter looks. Everything you choose is yours to keep, and you can change clothes later at the cabin armoire.')
    this.body = h('div', 'creator-body')
    this.status = h('p', 'creator-status')
    this.status.setAttribute('role', 'status')
    const actions = h('div', 'rr-actions')
    this.confirm = h('button', 'rr-btn primary', 'Create character')
    this.confirm.type = 'button'
    this.confirm.addEventListener('click', () => void this.finish())
    actions.append(this.confirm)
    card.append(eyebrow, title, intro, this.body, this.status, actions)
    this.root.append(card)
    document.body.append(this.root)
  }

  get open(): boolean {
    return !this.root.hidden
  }

  show(start: Look, hooks: { preview: (look: Look) => void; submit: (look: Look) => Promise<string | null>; done: () => void }): void {
    this.look = { ...start }
    for (const slot of LOOK_SLOTS) if (!CHARACTER_CHOICES[slot].includes(this.look[slot])) this.look[slot] = CHARACTER_CHOICES[slot][0]
    this.preview = hooks.preview
    this.submit = hooks.submit
    this.done = hooks.done
    this.status.textContent = ''
    this.confirm.disabled = false
    this.render()
    this.root.hidden = false
    this.preview(this.look)
    this.body.querySelector<HTMLButtonElement>('button')?.focus()
  }

  private render(): void {
    this.body.replaceChildren()
    for (const slot of LOOK_SLOTS) {
      const choices = CHARACTER_CHOICES[slot]
      if (choices.length < 2) continue
      const group = h('fieldset', 'creator-group')
      const legend = h('legend', undefined, SLOT_LABEL[slot])
      const row = h('div', 'creator-row')
      row.setAttribute('role', 'radiogroup')
      row.setAttribute('aria-label', SLOT_LABEL[slot])
      for (const id of choices) {
        const b = h('button', 'rr-btn creator-pick', ITEM_BY_ID[id]?.name ?? id)
        b.type = 'button'
        b.setAttribute('role', 'radio')
        b.setAttribute('aria-checked', String(this.look[slot] === id))
        b.addEventListener('click', () => {
          this.look[slot] = id
          for (const other of row.querySelectorAll('button')) other.setAttribute('aria-checked', String(other === b))
          this.preview(this.look)
        })
        row.append(b)
      }
      group.append(legend, row)
      this.body.append(group)
    }
  }

  private async finish(): Promise<void> {
    this.confirm.disabled = true
    this.status.textContent = 'Saving your character…'
    const error = await this.submit(this.look)
    if (error) {
      this.status.textContent = error
      this.confirm.disabled = false
      return
    }
    this.root.hidden = true
    this.done()
  }
}
