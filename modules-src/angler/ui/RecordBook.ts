/** In-module record book: the Hall of Records (biggest of every species) and per-species top 20 boards by lake and month. */
import { SPECIES, formatLength, formatWeight, speciesIds } from '../shared/Species'
import type { SpeciesId } from '../shared/Species'
import { LAKES, lakeIds } from '../shared/Lakes'
import type { LakeId } from '../shared/Lakes'

interface Row { id: string; username: string; weight: number; length: number; lake: LakeId; spot: string; tier: string; rig: string; date: string; species?: SpeciesId }

const $ = (id: string) => document.getElementById(id) as HTMLElement
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export class RecordBook {
  private view: 'hall' | SpeciesId = 'hall'
  private lake: LakeId | 'all' = 'all'
  private period: 'all' | 'month' = 'all'
  private bound = false

  open(lake: LakeId | 'all'): void {
    this.lake = lake
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
    species.innerHTML = `<option value="hall">Hall of Records</option>` + speciesIds.map(id => `<option value="${id}">${SPECIES[id].name}</option>`).join('')
    const lake = $('rec-lake') as HTMLSelectElement
    lake.innerHTML = `<option value="all">All lakes</option>` + lakeIds.map(id => `<option value="${id}">${LAKES[id].name}</option>`).join('')
    species.addEventListener('change', () => { this.view = species.value as RecordBook['view']; void this.render() })
    lake.addEventListener('change', () => { this.lake = lake.value as LakeId | 'all'; void this.render() })
    ;($('rec-period') as HTMLSelectElement).addEventListener('change', e => { this.period = (e.target as HTMLSelectElement).value as 'all' | 'month'; void this.render() })
    $('records-close').addEventListener('click', () => this.close())
  }

  private async render(): Promise<void> {
    ;($('rec-species') as HTMLSelectElement).value = this.view
    ;($('rec-lake') as HTMLSelectElement).value = this.lake
    const body = $('rec-body')
    const note = $('rec-note')
    const filters = $('rec-filters')
    filters.hidden = this.view === 'hall'
    body.innerHTML = '<p class="ang-note">Loading…</p>'
    try {
      if (this.view === 'hall') {
        const r = await fetch('/api/angler?hall=1', { credentials: 'same-origin' })
        if (!r.ok) throw new Error('The record book is unavailable right now.')
        const { hall } = await r.json() as { hall: Row[] }
        const bySpecies = new Map(hall.map(h => [h.species, h]))
        note.textContent = 'The heaviest fish of every species ever landed on the library.'
        body.innerHTML = `<div class="rec-hall">${speciesIds.map(id => {
          const h = bySpecies.get(id)
          return `<button type="button" class="rec-card" data-species="${id}"><span>${SPECIES[id].name}</span>${h ? `<strong>${formatWeight(h.weight / 160)}</strong><em>${esc(h.username)} · ${LAKES[h.lake]?.name ?? ''} · ${h.date.slice(0, 10)}</em>` : '<em>Unclaimed. Be the first.</em>'}</button>`
        }).join('')}</div>`
        body.querySelectorAll<HTMLButtonElement>('[data-species]').forEach(b => b.addEventListener('click', () => { this.view = b.dataset.species as SpeciesId; void this.render() }))
        return
      }
      const r = await fetch(`/api/angler?board=${this.view}&lake=${this.lake}&period=${this.period}`, { credentials: 'same-origin' })
      if (!r.ok) throw new Error('The record book is unavailable right now.')
      const board = await r.json() as { records: Row[]; personalBest: number | null }
      const s = SPECIES[this.view]
      note.textContent = `${s.name} · top 20 by weight${board.personalBest ? ` · your best ${formatWeight(board.personalBest / 160)}` : ''}`
      body.innerHTML = board.records.length
        ? `<div class="rec-scroll"><table class="rec-table"><thead><tr><th>#</th><th>Angler</th><th>Weight</th><th>Length</th><th>Lake</th><th>Date</th></tr></thead><tbody>${board.records.map((row, i) => `<tr class="${i < 3 ? `podium-${i + 1}` : ''}"><td>${i + 1}</td><td>${esc(row.username)}</td><td><strong>${formatWeight(row.weight / 160)}</strong> <small class="tier-${row.tier.toLowerCase()}">${row.tier}</small></td><td>${formatLength(row.length / 4)}</td><td>${LAKES[row.lake]?.name ?? ''}<small>${esc(row.spot)}</small></td><td>${row.date.slice(0, 10)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="ang-note">No fish on this board yet. Set the first record.</p>'
    } catch (error) {
      body.innerHTML = `<p class="ang-note">${error instanceof Error ? esc(error.message) : 'The record book is unavailable.'}</p>`
    }
  }
}
