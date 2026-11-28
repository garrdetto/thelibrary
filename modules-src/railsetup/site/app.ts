import type { Snapshot } from '../sim/lab'
import { BASELINE_NAME, TrackTest } from '../ui/track-test'
import { useAccount } from './account'
import { labFromPage, railPage } from './page'

const $ = (id: string) => document.getElementById(id)

function button(id: string, text: string, cls = '', title = ''): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.id = id
  b.textContent = text
  if (cls) b.className = cls
  if (title) b.title = title
  return b
}

/** Adds the library's pieces around the original page: the track test, its baseline, account saves and full screen. */
export function startSite() {
  const p = railPage()

  const note = [...document.querySelectorAll('#p-setup p.note')].find(n => n.textContent?.includes('Saved on this computer.'))
  if (note) {
    const span = document.createElement('span')
    span.id = 'sv-where'
    span.textContent = 'Not signed in: setups stay until you leave this page.'
    note.textContent = (note.textContent ?? '').replace('Saved on this computer.', '').trimEnd() + ' '
    note.append(span)
  }

  const views = $('v-help')
  const vTrack = button('v-track', '▶ Test on track', 'go', 'Drive this setup on a short oval with the corner radius and banking you set')
  views?.after(vTrack)

  const radRow = $('rad')?.closest('.row')
  const open = button('tt-open', '▶ Test on track', 'go')
  const save = button('tt-base', 'Save as Test Drive Baseline')
  const reset = button('tt-base-reset', 'Use default baseline')
  const baseNote = document.createElement('p')
  baseNote.className = 'note'
  baseNote.id = 'tt-base-note'
  const runs = document.createElement('p')
  runs.className = 'note'
  runs.textContent = 'Runs this setup on a short oval with this corner radius and the Banking under Move the car. A new radius or banking rebuilds the track.'
  const row1 = document.createElement('div')
  row1.className = 'btnrow'
  row1.append(open)
  const row2 = document.createElement('div')
  row2.className = 'btnrow'
  row2.append(save, reset)
  radRow?.after(row1, row2, baseNote, runs)

  const help = $('help')?.querySelector('ul')
  if (help) {
    const li = document.createElement('li')
    li.innerHTML = '<b>Test on track</b> drives this setup on a short oval built from your corner radius and banking, in Short Track Showdown\'s Super Late Model. Springs, bump springs, bars, ride heights, scales, stagger and the link geometry all change how it handles; let the test driver run laps or drive it yourself.'
    help.append(li)
  }

  const exit = document.createElement('button')
  exit.type = 'button'
  exit.className = 'tl-full-only rs-exit'
  exit.dataset.tlExitFull = ''
  exit.textContent = 'Exit full screen'
  document.body.append(exit)

  const setupName = () => {
    const typed = ($('sv-name') as HTMLInputElement | null)?.value.trim()
    if (typed) return typed
    const list = $('sv-list') as HTMLSelectElement | null
    const picked = list && list.selectedIndex >= 0 ? list.options[list.selectedIndex]?.text : ''
    return picked || 'Current setup'
  }
  const writeSaved = () => (window as unknown as { writeSaved: () => void }).writeSaved()
  const track = new TrackTest(() => labFromPage(p), (base) => labFromPage(p, base), setupName, () => vTrack.focus())
  const baseline = () => p.saved.find(x => x.name === BASELINE_NAME) ?? null
  const showBaseline = () => {
    const b = baseline()
    track.setBaseline(b)
    baseNote.textContent = `Test drive baseline: ${b ? BASELINE_NAME : 'Lab defaults'}. On the baseline the test driver runs at the limit with balanced handling; changes from it make the car tighter or looser in entry, center and exit.`
    reset.disabled = !b
  }
  showBaseline()

  const openTrack = () => {
    if (!p.loaded) return
    track.show()
  }
  vTrack.onclick = openTrack
  open.onclick = openTrack
  save.onclick = () => {
    const x: Snapshot = p.snapshot(BASELINE_NAME)
    const i = p.saved.findIndex(s => s.name === BASELINE_NAME)
    if (i >= 0) p.saved[i] = x
    else p.saved.push(x)
    writeSaved()
    p.fillLists()
  }
  reset.onclick = () => {
    p.saved = p.saved.filter(s => s.name !== BASELINE_NAME)
    writeSaved()
    p.fillLists()
  }
  void useAccount(p, showBaseline)
}
