import { ARENA_CODE_PATTERN } from '../../../../server/arena/protocol.mjs'
import type { ModeRequest, PlayModeId } from '../modes/types'

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function newRoomCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => CODE_LETTERS[byte % CODE_LETTERS.length]).join('')
}

export function cleanCode(value: string): string | null {
  const code = value.trim().toUpperCase()
  return ARENA_CODE_PATTERN.test(code) ? code : null
}

export class Menu {
  private readonly box = document.getElementById('menu') as HTMLDivElement | null
  private readonly codeInput = document.getElementById('menu-code') as HTMLInputElement | null
  private readonly codeError = document.getElementById('menu-code-error')
  private readonly closeButton = document.getElementById('menu-close') as HTMLButtonElement | null
  private canClose = false

  constructor(private readonly pick: (request: ModeRequest) => void) {
    this.box?.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]')
      if (!button) return
      const mode = button.dataset.mode as PlayModeId
      const action = button.dataset.action
      if (action === 'host') this.choose({ mode, code: newRoomCode() })
      else this.choose({ mode })
    })
    document.getElementById('menu-join')?.addEventListener('click', () => this.joinCode())
    this.codeInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') this.joinCode()
    })
    this.closeButton?.addEventListener('click', () => this.hide())
    window.addEventListener('keydown', event => {
      if (event.code === 'Escape' && this.open && this.canClose) this.hide()
    })
  }

  get open(): boolean {
    return Boolean(this.box && !this.box.hidden)
  }

  private joinCode(): void {
    const code = cleanCode(this.codeInput?.value ?? '')
    if (!code) {
      if (this.codeError) this.codeError.textContent = 'Codes are six letters and numbers.'
      this.codeInput?.focus()
      return
    }
    if (this.codeError) this.codeError.textContent = ''
    this.choose({ mode: 'duel', code })
  }

  private choose(request: ModeRequest): void {
    this.hide()
    this.pick(request)
  }

  show(canClose: boolean): void {
    if (!this.box) return
    this.canClose = canClose
    if (this.closeButton) this.closeButton.hidden = !canClose
    this.box.hidden = false
    document.body.classList.add('overlay')
    if (document.pointerLockElement) document.exitPointerLock()
    this.box.querySelector<HTMLButtonElement>('button[data-mode]')?.focus()
  }

  hide(): void {
    if (!this.box) return
    this.box.hidden = true
    document.body.classList.remove('overlay')
  }
}
