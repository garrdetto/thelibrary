/** The town directory: every workplace with what its crews are doing, and the dispatch feed. */
import { JOBS, JOB_IDS } from '../../shared/Jobs'
import { PLACES, PLACE_IDS, type PlaceId } from '../../shared/Town'
import type { FeedItem, TownState } from '../../shared/TownSim'
import { button, el } from './Ui'

function ago(now: number, at: number): string {
  const s = Math.max(0, Math.round(now / 1000 - at))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`
}

export function feedList(state: TownState, limit = 8): HTMLElement {
  const items = state.feed.slice(0, limit)
  return el('div', { class: 'feed', role: 'log', 'aria-live': 'polite' },
    ...(items.length ? items.map((f: FeedItem) => el('div', { class: 'item2' }, el('span', { class: 'time' }, ago(state.now, f.at)), el('span', { class: `k-${f.kind}` }, f.text))) : [el('div', { class: 'hint' }, 'A quiet moment in town.')]))
}

export function placeJobs(place: PlaceId): string {
  return JOB_IDS.filter(id => JOBS[id].place === place).map(id => JOBS[id].title).join(', ')
}

/** Fills the side panel with the directory and the feed. */
export function renderTownPanel(node: HTMLElement, state: TownState, focus: ((place: PlaceId) => void) | null, close: () => void): void {
  const key = JSON.stringify([state.feed.map(f => [f.text, Math.floor((state.now / 1000 - f.at) / 60)]), state.status])
  if (node.dataset.key === key) return
  node.dataset.key = key
  const places = el('div', { class: 'places' }, ...PLACE_IDS.map(id => {
    const b = el(focus ? 'button' : 'div', { type: focus ? 'button' : undefined, class: 'place' },
      el('b', {}, PLACES[id].name),
      el('small', {}, placeJobs(id)),
      el('span', { class: 'sub' }, state.status[id] ?? ''),
    )
    if (focus) b.addEventListener('click', () => focus(id))
    return b
  }))
  node.replaceChildren(
    el('div', { class: 'row', style: 'justify-content:space-between' }, el('div', { class: 'title' }, 'Around town'), button('Close', close)),
    el('p', { class: 'sub' }, 'The town works around the clock, with or without anyone watching. Calls go out as they happen, and the crews answer them.'),
    el('b', {}, 'Dispatch'),
    feedList(state, 8),
    el('b', { style: 'display:block;margin-top:8px' }, 'Workplaces'),
    places,
  )
}

export function tickerText(state: TownState): HTMLElement | null {
  const latest = state.feed[0]
  if (!latest) return null
  return el('span', {}, el('b', {}, 'Dispatch: '), latest.text)
}
