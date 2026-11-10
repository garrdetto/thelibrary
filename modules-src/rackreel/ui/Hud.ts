import type { Specimen } from '../systems/LootTableManager'
import { SIZE_CLASS_LABEL, SPECIES, SPECIES_BY_ID, formatValue } from '../systems/LootTableManager'
import { BOARD_SIZE, categoriesFor, categoryValues, formatRecord, rankOn } from '../shared/Records'
import type { HighScore, RecordBoard, RecordCategory } from '../shared/Records'
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
    el('reel-state').textContent = snap.strain ? 'Too tight — ease off!' : snap.slack ? 'Slack line — reel!' : 'Holding steady'
  }

  showCatch(specimen: Specimen, onClose: () => void): void {
    const t = SPECIES_BY_ID[specimen.species]
    const doe = t.kind === 'game' && specimen.value === 0
    el('catch-name').textContent = doe ? 'Whitetail doe' : t.name
    el('catch-value').textContent = doe ? `${Math.round(specimen.weightLb)} lb` : formatValue(specimen.species, specimen.value)
    const tier = el('catch-tier')
    tier.className = `tier${specimen.legendary ? ' legend' : ''}`
    tier.textContent = doe ? 'Antlerless tag' : SIZE_CLASS_LABEL[specimen.sizeClass]
    el('catch-l1').textContent = t.kind === 'fish' ? 'Length' : t.unit === 'in' ? 'Field dressed' : 'Skull'
    el('catch-v1').textContent = t.kind === 'fish' ? `${specimen.lengthIn.toFixed(1)}″`
      : t.unit === 'in' ? `${Math.round(specimen.weightLb)} lb`
        : specimen.measures.skull ? formatRecord('blackbear.skull', specimen.measures.skull) : '—'
    el('catch-points').textContent = specimen.trophyPoints.toLocaleString()
    el('catch-rank').textContent = doe ? '—' : '…'
    el('catch-fact').textContent = t.facts
    el('catch-scores').replaceChildren()
    const box = el('catch')
    box.hidden = false
    const ok = el<HTMLButtonElement>('catch-ok')
    ok.focus()
    ok.onclick = () => {
      box.hidden = true
      onClose()
    }
  }

  /**
   * The top three of every high-score category this animal counts toward, with its own
   * measurement and placing. `placed` is null while the result is still being saved.
   */
  showCatchScores(specimen: Specimen, board: RecordBoard, placed: Record<string, number> | null, you: string): void {
    const wrap = el('catch-scores')
    wrap.replaceChildren()
    const values = categoryValues(specimen.species, specimen.value, specimen.measures)
    let best: { rank: number; label: string } | null = null
    for (const c of categoriesFor(specimen.species)) {
      const value = values[c.id]
      if (value === undefined) continue
      const rank = placed ? placed[c.id] ?? 0 : rankOn(board[c.id] ?? [], value)
      if (rank && (!best || rank < best.rank)) best = { rank, label: c.label }
      wrap.append(scoreSection(c, board[c.id] ?? [], { value, rank, you, pending: !placed }))
    }
    if (!wrap.childElementCount) return
    el('catch-rank').textContent = best ? `#${best.rank} ${best.label.toLowerCase()}` : placed ? 'Not top 3' : '…'
  }

  get modalOpen(): boolean {
    return !el('catch').hidden || !el('book').hidden || document.getElementById('panel')?.hidden === false
  }

  showBook(board: RecordBoard, you: string, onClose: () => void): void {
    this.renderBook(board, you)
    const box = el('book')
    box.hidden = false
    const close = el<HTMLButtonElement>('book-close')
    close.focus()
    close.onclick = () => {
      box.hidden = true
      onClose()
    }
  }

  /** Redraws the open high-score book, e.g. once the latest board arrives from the server. */
  renderBook(board: RecordBoard, you: string): void {
    const grid = el('book-grid')
    grid.replaceChildren()
    for (const s of SPECIES) {
      const section = document.createElement('section')
      const h = document.createElement('h3')
      h.textContent = s.name
      section.append(h)
      for (const c of categoriesFor(s.id)) section.append(scoreSection(c, board[c.id] ?? [], { you }))
      const p = document.createElement('p')
      p.textContent = s.facts
      section.append(p)
      grid.append(section)
    }
  }

  closeBook(): void {
    el('book').hidden = true
  }
}

function scoreSection(c: RecordCategory, list: HighScore[], opts: { value?: number; rank?: number; you: string; pending?: boolean }): HTMLElement {
  const box = document.createElement('div')
  box.className = 'score-cat'
  const head = document.createElement('div')
  head.className = 'score-head'
  const label = document.createElement('b')
  label.textContent = c.label
  head.append(label)
  if (opts.value !== undefined) {
    const mine = document.createElement('span')
    mine.className = `score-mine${opts.rank ? ' placed' : ''}`
    mine.textContent = `${formatRecord(c.id, opts.value)}${opts.rank ? ` · #${opts.rank}${opts.pending ? '?' : ''}` : ''}`
    head.append(mine)
  }
  const ol = document.createElement('ol')
  for (let i = 0; i < BOARD_SIZE; i++) {
    const li = document.createElement('li')
    const entry = list[i]
    if (entry) {
      const strong = document.createElement('strong')
      strong.textContent = formatRecord(c.id, entry.value)
      li.append(strong, ` — ${entry.username}`)
      if (entry.username === opts.you && (opts.value === undefined || entry.value === opts.value)) li.className = 'you'
    } else {
      li.className = 'empty'
      li.textContent = 'Open — be the first'
    }
    ol.append(li)
  }
  const state = document.createElement('small')
  state.className = 'score-state'
  state.textContent = `State record ${formatRecord(c.id, c.state.value)} · ${c.state.note}`
  box.append(head, ol, state)
  return box
}
