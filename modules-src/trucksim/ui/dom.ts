/**
 * Small DOM helpers for Truck Simulator's interface: an element factory, money and number formatting, a colour swatch picker, and
 * the modal shell every panel uses (backdrop, focus trap, Escape to close, focus restored on close). Plain DOM, no framework.
 */

export type Child = Node | string | null | undefined | false

export interface ElementProps {
  class?: string
  text?: string
  attrs?: Record<string, string>
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>
}

/** Creates an element with a class, text, attributes, listeners and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElementProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.class) node.className = props.class
  if (props.text !== undefined) node.textContent = props.text
  if (props.attrs) for (const key of Object.keys(props.attrs)) node.setAttribute(key, props.attrs[key])
  if (props.on) {
    for (const key of Object.keys(props.on) as (keyof HTMLElementEventMap)[]) {
      node.addEventListener(key, props.on[key] as EventListener)
    }
  }
  append(node, children)
  return node
}

/** Appends strings as text nodes and skips null, undefined and false. */
export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
}

/** Removes every child of `node`. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const DECIMAL = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

/** `$12,345`; the `$` shows as the fox dollar through the site font. */
export function money(value: number): string {
  return MONEY.format(Math.round(value))
}

export function whole(value: number): string {
  return NUMBER.format(value)
}

export function decimal(value: number): string {
  return DECIMAL.format(value)
}

/** Tonnes with one decimal from kilograms. */
export function tonnes(kg: number): string {
  return `${DECIMAL.format(kg / 1000)} t`
}

const KEY_TOKEN = /^(?:[A-Z0-9]|Space|Shift|Ctrl|Esc|Tab|Enter|Click|Wheel)$/

/** Turns "Hold R" or "Press E to couple" into text with key caps for the key words. */
export function keyText(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  let buffer = ''
  for (const word of text.split(' ')) {
    if (KEY_TOKEN.test(word) && word !== 'A' && word !== 'I') {
      if (buffer) fragment.appendChild(document.createTextNode(`${buffer} `))
      buffer = ''
      fragment.appendChild(h('kbd', { text: word }))
      buffer = ''
      continue
    }
    buffer = buffer === '' ? (fragment.lastChild ? ` ${word}` : word) : `${buffer} ${word}`
  }
  if (buffer) fragment.appendChild(document.createTextNode(buffer))
  return fragment
}

/** A friendly name for a `KeyboardEvent.code`. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Escape') return 'Esc'
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift'
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl'
  if (code.startsWith('Arrow')) return code.slice(5)
  if (code === 'PageUp') return 'PgUp'
  if (code === 'PageDown') return 'PgDn'
  return code
}

export const SWATCHES: readonly string[] = [
  '#d8a21c', '#c4302b', '#e07a2b', '#2c6db5', '#1f3f6e', '#2f6b3a', '#d7d9dd', '#8d969e',
  '#3c4046', '#1d1f22', '#6b2e5f', '#e9dcc0',
]

export interface ColorPicker {
  element: HTMLElement
  set(value: string): void
}

/** A labelled row of swatch buttons plus a native colour input; calls `onChange` with a `#rrggbb` string. */
export function colorPicker(label: string, value: string, onChange: (value: string) => void): ColorPicker {
  const buttons: HTMLButtonElement[] = []
  const input = h('input', { class: 'ts-color', attrs: { type: 'color', 'aria-label': `${label} custom colour`, value } })
  const row = h('div', { class: 'ts-swatches', attrs: { role: 'radiogroup', 'aria-label': label } })
  let current = value.toLowerCase()
  const paint = (): void => {
    for (const button of buttons) {
      const on = button.dataset.color === current
      button.setAttribute('aria-checked', on ? 'true' : 'false')
      button.classList.toggle('on', on)
    }
    input.value = current
  }
  for (const color of SWATCHES) {
    const button = h('button', {
      class: 'ts-swatch',
      attrs: { type: 'button', role: 'radio', 'aria-label': color, 'data-color': color },
      on: { click: () => { current = color; paint(); onChange(color) } },
    })
    button.style.background = color
    buttons.push(button)
    row.appendChild(button)
  }
  input.addEventListener('input', () => { current = input.value.toLowerCase(); paint(); onChange(current) })
  row.appendChild(input)
  paint()
  return {
    element: h('div', { class: 'ts-field' }, h('span', { class: 'ts-label', text: label }), row),
    set(next: string) { current = next.toLowerCase(); paint() },
  }
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export interface ModalOptions {
  title: string
  className?: string
  onClose?: () => void
  initialFocus?: () => HTMLElement | null
}

export interface Modal {
  overlay: HTMLElement
  body: HTMLElement
  close(): void
  setTitle(text: string): void
}

/** Makes sure a host root can position the interface layers. */
export function prepareRoot(root: HTMLElement): void {
  root.classList.add('ts-root')
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative'
}

let modalCounter = 0

/** A modal dialog over `root`: backdrop, header with a close button, focus trapped, Escape closes, focus returns on close. */
export function openModal(root: HTMLElement, options: ModalOptions): Modal {
  prepareRoot(root)
  const previous = document.activeElement as HTMLElement | null
  const titleId = `ts-modal-title-${++modalCounter}`
  const title = h('h2', { class: 'ts-title', text: options.title, attrs: { id: titleId } })
  let closed = false
  const closeButton = h('button', { class: 'ts-btn ts-close', text: 'Close', attrs: { type: 'button', 'aria-label': 'Close' }, on: { click: () => close() } })
  const body = h('div', { class: 'ts-body' })
  const dialog = h('div', { class: `ts-dialog ${options.className ?? ''}`.trim(), attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' } },
    h('header', { class: 'ts-head' }, title, closeButton), body)
  const overlay = h('div', { class: 'ts-overlay' }, dialog)

  const trap = (event: KeyboardEvent): void => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.offsetParent !== null)
    if (items.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }
  overlay.addEventListener('keydown', trap)
  overlay.addEventListener('keyup', (event) => event.stopPropagation())
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) closeButton.focus() })

  function close(): void {
    if (closed) return
    closed = true
    overlay.removeEventListener('keydown', trap)
    overlay.remove()
    if (previous && previous.isConnected) previous.focus()
    options.onClose?.()
  }

  root.appendChild(overlay)
  queueMicrotask(() => {
    const target = options.initialFocus?.() ?? body.querySelector<HTMLElement>(FOCUSABLE) ?? closeButton
    ;(target.isConnected ? target : closeButton).focus()
  })
  return { overlay, body, close, setTitle: (text: string) => { title.textContent = text } }
}

/** Re-renders `container` with `render`, keeping keyboard focus on the element with the same `data-key`. */
export function rerender(container: HTMLElement, render: () => void): void {
  const active = document.activeElement as HTMLElement | null
  const key = active && container.contains(active) ? active.dataset.key : undefined
  const scroll = container.scrollTop
  clear(container)
  render()
  container.scrollTop = scroll
  if (key) container.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus()
}
