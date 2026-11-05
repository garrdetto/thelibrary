/** In-module record book: the three biggest fish of every species and when each was caught. */
import { SPECIES, formatCaught, formatLength, formatWeight, speciesIds } from '../shared/Species'
import type { SpeciesId } from '../shared/Species'
import { LAKES } from '../shared/Lakes'
import type { LakeId } from '../shared/Lakes'

interface Row { id: string; username: string; weight: number; length: number; lake: LakeId; spot: string; tier: string; rig: string; date: string; species?: SpeciesId }

const $ = (id: string) => document.getElementById(id) as HTMLElement
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const MEDALS = ['🥇', '🥈', '🥉']

export class RecordBook {
  private species: 'all' | SpeciesId = 'all'
  private bound = false
  private renders = 0

  open(_lake?: LakeId | 'all'): void {
    if (!this.bound) this.bind()
    $('records-panel').hidden = false
    void this.render()
  }

  close(): void {
    $('records-panel').hidden = true
  }

  private bind(): void {
    this.bound = true
    const species = $('rec-species') as HTMLSelectElement
    species.innerHTML = `<option value="all">Every species</option>` + speciesIds.map(id => `<option value="${id}">${SPECIES[id].name}</option>`).join('')
    species.addEventListener('change', () => { this.species = species.value as RecordBook['species']; void this.render() })
    $('records-close').addEventListener('click', () => this.close())
  }

  private async render(): Promise<void> {
    ;($('rec-species') as HTMLSelectElement).value = this.species
    const body = $('rec-body')
    $('rec-note').textContent = 'The three biggest fish of every species landed on the library, and when they were caught (central time).'
    body.innerHTML = '<p class="ang-note">Loading…</p>'
    const token = ++this.renders
    try {
      const r = await fetch('/api/angler?hall=1', { credentials: 'same-origin' })
      if (!r.ok) throw new Error('The record book is unavailable right now.')
      const { hall } = await r.json() as { hall: Row[] }
      if (token !== this.renders) return
      const ids = this.species === 'all' ? speciesIds : [this.species]
      body.innerHTML = `<div class="rec-hall">${ids.map(id => {
        const top = hall.filter(h => h.species === id).sort((a, b) => b.weight - a.weight).slice(0, 3)
        const rows = top.length
          ? top.map((h, i) => `<li><span class="rec-medal" aria-label="Place ${i + 1}">${MEDALS[i]}</span><span class="rec-fish"><strong>${formatWeight(h.weight / 160)}</strong> <small>${formatLength(h.length / 4)}</small><em>${esc(h.username)} · ${LAKES[h.lake]?.name ?? ''}</em><time datetime="${esc(h.date)}">${formatCaught(h.date)}</time></span></li>`).join('')
          : '<li class="is-empty">Unclaimed. Be the first.</li>'
        return `<section class="rec-card"><span>${SPECIES[id].name}</span><ol>${rows}</ol></section>`
      }).join('')}</div>`
    } catch (error) {
      if (token !== this.renders) return
      body.innerHTML = `<p class="ang-note">${error instanceof Error ? esc(error.message) : 'The record book is unavailable.'}</p>`
    }
  }
}
