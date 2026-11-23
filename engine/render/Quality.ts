/** Resolves the quality tier into concrete render settings: ?quality= wins, then the player's saved Graphics choice, then the config (which defaults to the lowest tier). */
import type { QualityConfig, QualitySettings, QualityTier, RenderBackend } from '../config'

export interface ResolvedQuality {
  tier: QualityTier
  settings: QualitySettings
}

const TIER_ORDER: readonly QualityTier[] = ['low', 'medium', 'high', 'ultra']
const TIER_LABELS: Readonly<Record<QualityTier, string>> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' }

function storageKey(): string {
  return `tl-graphics:${location.pathname.replace(/\/index\.html$/, '/')}`
}

export function savedQuality(): QualityTier | null {
  try {
    const value = localStorage.getItem(storageKey())
    return value && (TIER_ORDER as readonly string[]).includes(value) ? (value as QualityTier) : null
  } catch {
    return null
  }
}

export function saveQuality(tier: QualityTier): void {
  try {
    localStorage.setItem(storageKey(), tier)
  } catch {}
}

export function resolveQuality(config: QualityConfig, backend: RenderBackend): ResolvedQuality {
  const override = new URLSearchParams(location.search).get('quality')
  const saved = savedQuality()
  const requested = override && override in config.tiers ? (override as QualityTier) : saved && saved in config.tiers ? saved : config.requested
  const tier = requested === 'auto' ? config.autoTier[backend] : requested
  return { tier, settings: config.tiers[tier] }
}

/** A labelled Graphics select for a module's settings or pause panel; changing it saves the choice and reloads the page so every scene is rebuilt at the new tier. */
export function createGraphicsSetting(current: QualityTier, options: { className?: string; label?: string } = {}): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = options.className ?? 'tl-graphics-setting'
  label.style.cssText = 'display:flex;align-items:center;gap:.5em;justify-content:center;flex-wrap:wrap'
  const text = document.createElement('span')
  text.textContent = options.label ?? 'Graphics'
  const select = document.createElement('select')
  select.setAttribute('aria-label', options.label ?? 'Graphics')
  select.style.cssText = 'font:inherit;padding:.25em .5em;border-radius:.4em'
  for (const tier of TIER_ORDER) {
    const option = document.createElement('option')
    option.value = tier
    option.textContent = TIER_LABELS[tier]
    option.selected = tier === current
    select.append(option)
  }
  select.addEventListener('change', () => {
    const tier = select.value as QualityTier
    saveQuality(tier)
    const url = new URL(location.href)
    url.searchParams.delete('quality')
    location.replace(url.toString())
  })
  label.append(text, select)
  return label
}

/** Fills every element marked data-tl-graphics with a Graphics select; the attribute's value, when set, is the label's class. */
export function mountGraphicsSettings(current: QualityTier, root: ParentNode = document): void {
  for (const slot of root.querySelectorAll<HTMLElement>('[data-tl-graphics]')) {
    slot.replaceChildren(createGraphicsSetting(current, { className: slot.dataset.tlGraphics || undefined }))
  }
}
