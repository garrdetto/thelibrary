/** The owner's Family panel: everyone in the household, how old they are, where they are, and adding, renaming and moving out. */
import { MAX_SIMS } from '../../shared/Lot'
import { BABY_FRIENDSHIP, STAGE_LABELS, nextStage } from '../../shared/Family'
import type { Command, FamilyView } from '../../shared/Protocol'
import { avatarDot, confirmDialog, openResidentDialog, promptDialog } from './HouseholdDialog'
import { button, el } from './Ui'

export interface FamilyPanel {
  update(family: FamilyView[], selected: string | null): void
}

const STATUS: Record<FamilyView['status'], string> = { home: 'At home', work: 'At work', visiting: 'Visiting', resort: 'At the resort' }

/** Household minutes as a short "in 5 h 20 m" style duration. */
function minutesLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} m` : ''}`.trim()
  return `${m} m`
}

function daysLabel(days: number): string {
  if (days < 1) return minutesLabel(days * 1440)
  const d = Math.round(days * 10) / 10
  return `${d} day${d === 1 ? '' : 's'}`
}

export function familyPanel(node: HTMLElement, host: HTMLElement, send: (command: Command) => void, select: (id: string) => void, shut: () => void): FamilyPanel {
  let key = ''
  let live: { id: string; age: HTMLElement; due: HTMLElement | null }[] = []
  let current: FamilyView[] = []

  const add = async () => {
    const draft = await openResidentDialog(host, { title: 'Add a resident', intro: `Move a new adult, teen or child into the house (up to ${MAX_SIMS} residents, babies on the way included).`, submit: 'Move in', showStage: true })
    if (draft) send({ t: 'addSim', name: draft.name, look: draft.look, stage: draft.stage })
  }

  const render = (selected: string | null) => {
    const expecting = current.filter(f => f.expecting !== null).length
    const room = current.length + expecting < MAX_SIMS
    live = []
    const rows = current.map(f => {
      const age = el('span', { class: 'sub' })
      const due = f.expecting !== null ? el('span', { class: 'chip baby' }) : null
      live.push({ id: f.id, age, due })
      const home = f.status === 'home'
      const canMoveOut = home && f.stage !== 'baby' && f.stage !== 'toddler'
      const isSelected = selected === `h-${f.id}`
      return el('div', { class: `famrow${isSelected ? ' on' : ''}` },
        el('div', { class: 'row', style: 'gap:10px;flex-wrap:nowrap' },
          avatarDot(f.look, f.stage === 'baby' ? 16 : f.stage === 'toddler' ? 18 : f.stage === 'child' ? 22 : 26),
          el('div', { style: 'flex:1;min-width:0' },
            el('div', { class: 'row', style: 'gap:6px' }, el('b', {}, f.name), el('span', { class: `chip stage-${f.stage}` }, STAGE_LABELS[f.stage]), el('span', { class: `chip st-${f.status}` }, STATUS[f.status]), due),
            age,
            f.parents.length ? el('div', { class: 'sub' }, `Child of ${f.parents.join(' and ')}`) : null,
            f.job ? el('div', { class: 'sub' }, f.job) : null,
          ),
        ),
        el('div', { class: 'row', style: 'margin-top:6px;gap:4px' },
          home ? button(isSelected ? 'Selected' : 'Select', () => select(`h-${f.id}`), `btn sm${isSelected ? ' on' : ''}`, `Control ${f.name}`) : null,
          button('Rename', async () => {
            const name = await promptDialog(host, `Rename ${f.name}`, 'First name', f.name)
            if (name) send({ t: 'renameSim', sim: f.id, name })
          }, 'btn sm'),
          button('Edit look', async () => {
            const draft = await openResidentDialog(host, { title: `${f.name}'s look`, intro: 'Change hair, clothes and build. Free, any time.', submit: 'Save look', initial: { name: f.name, look: f.look }, showStage: false, showName: false })
            if (draft) send({ t: 'restyleSim', sim: f.id, look: draft.look })
          }, 'btn sm'),
          canMoveOut ? button('Move out', async () => {
            const answer = await confirmDialog(host, `Move ${f.name} out?`, `${f.name} leaves the household for good. Their job and friendships here go with them.`, [{ label: 'Keep them', value: 'no' }, { label: 'Move out', value: 'yes', primary: true }])
            if (answer === 'yes') send({ t: 'moveOut', sim: f.id })
          }, 'btn sm danger') : null,
        ),
      )
    })
    node.replaceChildren(
      el('div', { class: 'row', style: 'justify-content:space-between' }, el('div', { class: 'title' }, 'Family'), button('✕', shut, 'btn sm', 'Close (Esc)')),
      el('div', { class: 'row', style: 'justify-content:space-between;margin:6px 0' },
        el('span', { class: 'sub' }, `${current.length} of ${MAX_SIMS} residents${expecting ? ` · ${expecting} on the way` : ''}`),
        (() => { const b = button('+ Add a resident', add, 'btn primary sm'); b.disabled = !room; return b })(),
      ),
      el('details', { class: 'tip' },
        el('summary', {}, 'How families grow'),
        el('ul', {},
          el('li', {}, 'Children grow up as household time passes: baby, toddler, child, teen, then adult after nine days.'),
          el('li', {}, `Two adults who live together can try for a baby once they are close (${BABY_FRIENDSHIP}+). Select one, click the other, then pick Try for a baby. Flirting and hugging bring them closer.`),
          el('li', {}, 'Babies and toddlers need feeding, changing and rocking to sleep. Click them with a teen or adult selected, or buy a crib and high chair from Babies & kids.'),
          el('li', {}, 'Only adults can take jobs. Kids have toys, the swing set, the slide and more.'),
        ),
      ),
      el('div', { class: 'list' }, ...rows),
    )
    tick()
  }

  const tick = () => {
    for (const ref of live) {
      const f = current.find(x => x.id === ref.id)
      if (!f) continue
      const next = nextStage(f.stage)
      ref.age.textContent = `Age ${daysLabel(f.age)}${next && f.nextIn !== null ? ` · ${STAGE_LABELS[next].toLowerCase()} in ${daysLabel(f.nextIn)}` : ''}`
      if (ref.due && f.expecting !== null) ref.due.textContent = `🍼 Baby in ${minutesLabel(f.expecting)}`
    }
  }

  return {
    update(family, selected) {
      current = family
      const next = JSON.stringify([family.map(f => [f.id, f.name, f.look, f.stage, f.status, f.job, f.parents, f.expecting !== null]), selected])
      if (next !== key) { key = next; render(selected) }
      else tick()
    },
  }
}
