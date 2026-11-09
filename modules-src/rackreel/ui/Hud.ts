import type { LootTableManager, Specimen, SpeciesId } from '../systems/LootTableManager'
import { SPECIES, SPECIES_BY_ID, formatValue } from '../systems/LootTableManager'
import type { ReelSnapshot } from '../systems/SkillCheckManager'

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export function compassWord(yaw: number): string {
  const deg = ((yaw * 180) / Math.PI + 360) % 360
  return COMPASS[Math.round(deg / 45) % 8]
}

export class Hud {
  private readonly prompt = el('prompt')
  private readonly toasts = el('toasts')
  private readonly reel = el('reel')
  private readonly cast = el('cast')
  private readonly breath = el('breath')
  private readonly crosshair = el('crosshair')
  private readonly scope = el('scope')
  private readonly legend = el('legend')
  private lastPrompt = ''

  showPlaying(on: boolean): void {
    for (const id of ['hud-tl', 'hud-tr', 'help-hint', 'minimap']) el(id).hidden = !on
  }

  setLoading(fraction: number, text: string): void {
    el('load-bar').style.width = `${Math.round(fraction * 100)}%`
    el('load-text').textContent = text
  }

  setPlace(place: string, mode: string): void {
    el('place').textContent = place
    el('mode').textContent = mode
  }

  setTool(tool: 'rod' | 'rifle'): void {
    for (const chip of document.querySelectorAll<HTMLElement>('#tools .chip')) chip.setAttribute('aria-current', String(chip.dataset.tool === tool))
  }

  setBag(count: number, points: number): void {
    el('bag-count').textContent = String(count)
    el('bag-points').textContent = points.toLocaleString()
  }

  setCompass(yaw: number): void {
    const word = compassWord(yaw)
    const node = el('compass')
    if (node.textContent !== word) node.textContent = word
  }

  setActivity(text: string): void {
    const node = el('activity-text')
    if (node.textContent !== text) node.textContent = text
  }

  setLegend(text: string | null): void {
    this.legend.hidden = !text
    if (text && this.legend.textContent !== text) this.legend.textContent = text
  }

  setPrompt(text: string): void {
    if (text === this.lastPrompt) return
    this.lastPrompt = text
    this.prompt.textContent = text
  }

  toast(text: string, kind: '' | 'big' | 'warn' = ''): void {
    const node = document.createElement('div')
    node.className = `toast ${kind}`
    node.textContent = text
    this.toasts.prepend(node)
    setTimeout(() => node.remove(), 4300)
    while (this.toasts.children.length > 4) this.toasts.lastElementChild?.remove()
  }

  setAim(mode: 'none' | 'hip' | 'scope', spread = 0): void {
    this.crosshair.hidden = mode !== 'hip'
    this.scope.hidden = mode !== 'scope'
    if (mode === 'hip') {
      const size = 18 + spread * 900
      this.crosshair.style.width = this.crosshair.style.height = `${size}px`
      this.crosshair.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`
    }
  }

  setCast(power: number | null): void {
    this.cast.hidden = power === null
    if (power !== null) {
      el('cast-bar').style.width = `${Math.round(power * 100)}%`
      el('cast-pct').textContent = `${Math.round(power * 100)}%`
    }
  }

  setBreath(value: number | null): void {
    this.breath.hidden = value === null
    if (value !== null) el('breath-bar').style.width = `${Math.round(value * 100)}%`
  }

  setReel(snap: ReelSnapshot | null, label: string): void {
    this.reel.hidden = !snap
    if (!snap) return
    el('reel-species').textContent = label
    el('tension-mark').style.left = `${snap.tension}%`
    el('progress-bar').style.width = `${snap.progress}%`
    el('health-bar').style.width = `${snap.lineHealth}%`
    el('reel-pct').textContent = `${Math.round(snap.progress)}%`
    el('reel-state').textContent = snap.strain ? 'Too tight — ease off!' : snap.slack ? 'Slack line — crank!' : 'Holding steady'
  }

  showCatch(specimen: Specimen, rank: number, onClose: () => void): void {
    const t = SPECIES_BY_ID[specimen.species]
    el('catch-name').textContent = t.name
    el('catch-value').textContent = formatValue(specimen.species, specimen.value)
    const tier = el('catch-tier')
    tier.className = `tier${specimen.legendary ? ' legend' : ''}`
    tier.textContent = specimen.legendary ? 'Record-class trophy' : specimen.value >= t.trophyAt ? 'Trophy' : t.kind === 'fish' ? 'Keeper' : 'Tagged'
    el('catch-l1').textContent = t.kind === 'fish' ? 'Length' : t.unit === 'in' ? 'Field weight' : 'Weight'
    el('catch-v1').textContent = t.kind === 'fish' ? `${specimen.lengthIn.toFixed(1)}″` : `${Math.round(specimen.weightLb)} lb`
    el('catch-points').textContent = specimen.trophyPoints.toLocaleString()
    el('catch-rank').textContent = rank ? `#${rank} all-time` : '—'
    el('catch-fact').textContent = t.facts
    const box = el('catch')
    box.hidden = false
    const ok = el<HTMLButtonElement>('catch-ok')
    ok.focus()
    ok.onclick = () => {
      box.hidden = true
      onClose()
    }
  }

  get modalOpen(): boolean {
    return !el('catch').hidden || !el('book').hidden || document.getElementById('panel')?.hidden === false
  }

  showBook(loot: LootTableManager, you: Set<string>, onClose: () => void): void {
    const grid = el('book-grid')
    grid.replaceChildren()
    for (const s of SPECIES) {
      const section = document.createElement('section')
      const h = document.createElement('h3')
      h.textContent = `${s.name} · ${s.measure.toLowerCase()}`
      const ol = document.createElement('ol')
      for (const entry of loot.records[s.id as SpeciesId]) {
        const li = document.createElement('li')
        if (you.has(`${s.id}:${entry.value}:${entry.holder}`)) li.className = 'you'
        const strong = document.createElement('strong')
        strong.textContent = formatValue(s.id, entry.value)
        li.append(strong, ` — ${entry.holder}, ${entry.place}, ${entry.year}`)
        ol.append(li)
      }
      const p = document.createElement('p')
      p.textContent = s.facts
      section.append(h, ol, p)
      grid.append(section)
    }
    const box = el('book')
    box.hidden = false
    const close = el<HTMLButtonElement>('book-close')
    close.focus()
    close.onclick = () => {
      box.hidden = true
      onClose()
    }
  }

  closeBook(): void {
    el('book').hidden = true
  }
}
