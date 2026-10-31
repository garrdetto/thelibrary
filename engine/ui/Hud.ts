/** DOM overlay for module HUDs styled with the site's --lib-* tokens, mirrored live from the hub page when embedded. */
import type { HudConfig } from '../config'

export type HudCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

const STYLE_ID = 'tl-hud-style'
const STYLES = `
.tl-hud{position:absolute;inset:0;pointer-events:none;font:500 13px/1.35 Inter,system-ui,sans-serif;color:var(--lib-text)}
.tl-hud-panel{position:absolute;display:grid;gap:6px;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--lib-panel) 86%,transparent);border:1px solid var(--lib-line);box-shadow:0 10px 30px -12px var(--lib-shadow);backdrop-filter:blur(6px)}
.tl-hud-panel[data-corner=top-left]{top:12px;left:12px}
.tl-hud-panel[data-corner=top-right]{top:12px;right:12px}
.tl-hud-panel[data-corner=bottom-left]{bottom:12px;left:12px}
.tl-hud-panel[data-corner=bottom-right]{bottom:12px;right:12px}
.tl-hud-panel[data-corner=center]{top:50%;left:50%;transform:translate(-50%,-50%)}
.tl-hud-title{font:700 15px/1.1 Rajdhani,Inter,sans-serif;letter-spacing:.6px;color:var(--lib-strong)}
.tl-hud-stat{display:flex;justify-content:space-between;gap:14px;color:var(--lib-muted)}
.tl-hud-stat b{color:var(--lib-text);font-variant-numeric:tabular-nums}
.tl-hud-button{pointer-events:auto;cursor:pointer;padding:7px 12px;border-radius:9px;border:1px solid color-mix(in srgb,var(--module-accent,var(--lib-accent)) 45%,transparent);background:color-mix(in srgb,var(--module-accent,var(--lib-accent)) 14%,transparent);color:var(--lib-text);font:600 13px Inter,system-ui,sans-serif}
.tl-hud-button:hover{background:color-mix(in srgb,var(--module-accent,var(--lib-accent)) 24%,transparent)}
.tl-hud-button:focus-visible{outline:2px solid var(--module-accent,var(--lib-accent));outline-offset:2px}
.tl-hud-toasts{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:grid;gap:6px;justify-items:center}
.tl-hud-toast{padding:8px 14px;border-radius:999px;background:var(--lib-panel2);border:1px solid var(--lib-line);color:var(--lib-text);animation:tl-hud-in .2s ease-out}
@keyframes tl-hud-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.tl-hud-toast{animation:none}}
`

export class Hud {
  readonly root: HTMLDivElement
  private readonly toasts: HTMLDivElement
  private readonly timers = new Set<number>()
  private themeObserver: MutationObserver | null = null

  constructor(
    private readonly config: HudConfig,
    accent?: string,
    host: HTMLElement = document.body,
  ) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLES
      document.head.appendChild(style)
    }
    this.root = document.createElement('div')
    this.root.className = 'tl-hud'
    this.root.style.zIndex = String(config.zIndex)
    if (accent) this.root.style.setProperty('--module-accent', accent)
    this.toasts = document.createElement('div')
    this.toasts.className = 'tl-hud-toasts'
    this.toasts.setAttribute('role', 'status')
    this.toasts.setAttribute('aria-live', 'polite')
    this.root.appendChild(this.toasts)
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
    host.appendChild(this.root)
    this.syncTheme()
    this.watchTheme()
  }

  panel(corner: HudCorner, title?: string): HTMLDivElement {
    const panel = document.createElement('div')
    panel.className = 'tl-hud-panel'
    panel.dataset.corner = corner
    if (title) {
      const heading = document.createElement('div')
      heading.className = 'tl-hud-title'
      heading.textContent = title
      panel.appendChild(heading)
    }
    this.root.insertBefore(panel, this.toasts)
    return panel
  }

  stat(panel: HTMLElement, label: string, initial = ''): (value: string | number) => void {
    const row = document.createElement('div')
    row.className = 'tl-hud-stat'
    const name = document.createElement('span')
    name.textContent = label
    const value = document.createElement('b')
    value.textContent = initial
    row.append(name, value)
    panel.appendChild(row)
    return (next) => {
      const text = String(next)
      if (value.textContent !== text) value.textContent = text
    }
  }

  button(panel: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'tl-hud-button'
    button.textContent = label
    button.addEventListener('click', onClick)
    panel.appendChild(button)
    return button
  }

  toast(message: string): void {
    const toast = document.createElement('div')
    toast.className = 'tl-hud-toast'
    toast.textContent = message
    this.toasts.appendChild(toast)
    const timer = window.setTimeout(() => {
      toast.remove()
      this.timers.delete(timer)
    }, this.config.toastSeconds * 1000)
    this.timers.add(timer)
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible
  }

  syncTheme(): void {
    const target = document.documentElement.style
    const source = this.parentRoot()
    const computed = source ? getComputedStyle(source) : null
    for (const [token, fallback] of Object.entries(this.config.tokenFallbacks)) {
      const value = computed?.getPropertyValue(token).trim()
      target.setProperty(token, value || fallback)
    }
  }

  private parentRoot(): HTMLElement | null {
    try {
      return window.parent !== window ? window.parent.document.documentElement : null
    } catch {
      return null
    }
  }

  private watchTheme(): void {
    const source = this.parentRoot()
    if (!source || typeof MutationObserver === 'undefined') return
    this.themeObserver = new MutationObserver(() => this.syncTheme())
    this.themeObserver.observe(source, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
  }

  dispose(): void {
    this.themeObserver?.disconnect()
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.root.remove()
  }
}
