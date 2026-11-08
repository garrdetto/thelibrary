/** Careers in the lot view: the job board, the live work panel for residents on a shift, and the services a household can call. */
import { BASE_PERF, JOBS, JOB_IDS, RESPOND_BONUS, RESPOND_PERF, SERVICES, SERVICE_KINDS, SHIFT_SECONDS, jobTitle, perfLabel, type JobId, type ServiceKind } from '../../shared/Jobs'
import type { AwayView, CareerView, Command, OrderView, WorkView } from '../../shared/Protocol'
import { PLACES } from '../../shared/Town'
import { button, el, money } from './Ui'

export interface JobBoardSim {
  id: string
  name: string
  career: CareerView | null | undefined
}

export function renderJobBoard(node: HTMLElement, sim: JobBoardSim, send: (command: Command) => void, close: () => void): void {
  const current = sim.career?.job ?? null
  const cards = JOB_IDS.map(id => {
    const def = JOBS[id]
    const mine = current === id
    const swatch = el('i', { class: 'sw2', style: `background:${def.uniform.top}` })
    return el('div', { class: 'job', style: mine ? 'border-color:var(--hood-accent)' : '' },
      el('b', {}, swatch, def.title),
      el('span', { class: 'sub' }, `${PLACES[def.place].name} · from ${money(def.pay[0])} a shift`),
      el('span', {}, def.blurb),
      el('span', { class: 'hint' }, def.links),
      el('div', { class: 'row' }, mine
        ? button('Quit this job', () => send({ t: 'job', sim: sim.id, job: null }))
        : button(current ? 'Switch to this job' : 'Take this job', () => send({ t: 'job', sim: sim.id, job: id }), 'btn primary')),
    )
  })
  node.replaceChildren(
    el('div', { class: 'row', style: 'justify-content:space-between' }, el('div', { class: 'title' }, `Jobs in town for ${sim.name}`), button('Close', close)),
    el('p', { class: 'sub' }, `A shift lasts ${Math.round(SHIFT_SECONDS / 60)} real minutes and pays more the better it goes. Pick tasks during the shift, and answer live calls for a bonus. Switching jobs starts over at the first title.`),
    el('div', { class: 'jobs' }, ...cards),
  )
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface WorkPanel {
  update(work: WorkView[], away: AwayView[], now: number): void
}

/** The work panel. It rebuilds only when something you can click changes, and moves its bars in place in between. */
export function workPanel(node: HTMLElement, send: (command: Command) => void, close: () => void): WorkPanel {
  let key = ''
  let live: { id: string; left: HTMLElement; bar: HTMLElement; perf: HTMLElement; perfBar: HTMLElement; earned: HTMLElement; task: HTMLElement | null; taskBar: HTMLElement | null }[] = []
  let awayNodes: { id: string; left: HTMLElement }[] = []
  return {
    update(work, away, now) {
      const nextKey = JSON.stringify([work.map(w => [w.id, w.task?.id, w.calls.map(c => c.id), w.counts, w.career.level]), away.map(a => a.id)])
      if (nextKey !== key) {
        key = nextKey
        live = []
        awayNodes = []
        const blocks: HTMLElement[] = []
        for (const w of work) {
          const def = JOBS[w.career.job]
          const left = el('span', { class: 'sub' })
          const fill = el('i')
          const perf = el('span', { class: 'sub' })
          const perfFill = el('i')
          const earned = el('span', { class: 'sub' })
          let task: HTMLElement | null = null
          let taskBar: HTMLElement | null = null
          const parts: HTMLElement[] = [
            el('div', { class: 'row', style: 'justify-content:space-between' }, el('b', {}, `${w.name} · ${w.career.title}`), left),
            el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Shift' }, fill),
            el('div', { class: 'row', style: 'justify-content:space-between;margin-top:4px' }, perf, earned),
            el('div', { class: 'progress', role: 'meter', 'aria-label': 'Performance' }, perfFill),
          ]
          if (w.task) {
            taskBar = el('i')
            task = el('span', { class: 'sub', style: 'display:block' })
            parts.push(el('div', { class: 'card', style: 'padding:6px 0' }, el('b', {}, `Now: ${w.task.label}`), task, el('div', { class: 'progress' }, taskBar)))
          }
          if (w.calls.length) {
            parts.push(el('b', { style: 'display:block;margin-top:6px' }, 'Live calls'))
            parts.push(el('div', { class: 'tasks' }, ...w.calls.map(c => {
              const b = el('button', { type: 'button', class: 'task call', disabled: !!w.task }, el('b', {}, c.label), el('small', {}, `+${RESPOND_PERF} performance · ${money(RESPOND_BONUS)} bonus`))
              b.addEventListener('click', () => send({ t: 'task', sim: w.id, task: `call:${c.id}` }))
              return b
            })))
          }
          parts.push(el('b', { style: 'display:block;margin-top:6px' }, `${def.title} tasks`))
          parts.push(el('div', { class: 'tasks' }, ...def.tasks.map(t => {
            const done = w.counts[t.id] ?? 0
            const gain = Math.round(t.perf * Math.pow(0.7, done) * 10) / 10
            const note = [`${t.seconds}s`, `+${gain} performance`, t.bonus ? `${money(t.bonus)} tip` : '', t.with ? `with the ${JOBS[t.with].title.toLowerCase()}s` : ''].filter(Boolean).join(' · ')
            const b = el('button', { type: 'button', class: 'task', disabled: !!w.task }, el('b', {}, t.label), el('small', {}, note))
            b.addEventListener('click', () => send({ t: 'task', sim: w.id, task: t.id }))
            return b
          })))
          parts.push(el('div', { class: 'row', style: 'margin-top:6px' }, button('Clock out early', () => send({ t: 'clockOut', sim: w.id }), 'btn', 'Come home now for part of the pay')))
          blocks.push(el('div', { class: 'job' }, ...parts))
          live.push({ id: w.id, left, bar: fill, perf, perfBar: perfFill, earned, task, taskBar })
        }
        for (const a of away) {
          const left = el('span', { class: 'sub' })
          blocks.push(el('div', { class: 'job' }, el('div', { class: 'row', style: 'justify-content:space-between' }, el('b', {}, `${a.name} · ${a.where}`), left), el('span', { class: 'hint' }, 'Lounging by the pool and the lake. Back rested and happy.')))
          awayNodes.push({ id: a.id, left })
        }
        node.replaceChildren(
          el('div', { class: 'row', style: 'justify-content:space-between' }, el('div', { class: 'title' }, 'At work'), button('Close', close)),
          ...(blocks.length ? blocks : [el('p', { class: 'sub' }, 'Nobody is at work right now. Pick a resident and press Go to work.')]),
        )
      }
      for (const n of live) {
        const w = work.find(x => x.id === n.id)
        if (!w) continue
        n.left.textContent = `${clock(w.until - now)} left`
        n.bar.style.width = `${Math.min(100, ((now - w.start) / (w.until - w.start)) * 100)}%`
        n.perf.textContent = `Performance ${w.perf} · ${perfLabel(w.perf)}`
        n.perfBar.style.width = `${w.perf}%`
        n.perfBar.style.background = w.perf >= 65 ? '#5bd77d' : w.perf >= BASE_PERF ? '#e8c94a' : '#e8913c'
        n.earned.textContent = w.earned ? `Bonuses ${money(w.earned)}` : ''
        if (w.task && n.task && n.taskBar) {
          n.task.textContent = `${clock(w.task.ends - now)} to go`
          n.taskBar.style.width = `${Math.min(100, ((now - w.task.starts) / Math.max(1, w.task.ends - w.task.starts)) * 100)}%`
        }
      }
      for (const n of awayNodes) {
        const a = away.find(x => x.id === n.id)
        if (a) n.left.textContent = `back in ${clock(a.until - now)}`
      }
    },
  }
}

export interface ServiceSim {
  id: string
  name: string
}

export interface ServicesPanel {
  update(orders: OrderView[], funds: number, sims: ServiceSim[], now: number): void
}

export function servicesPanel(node: HTMLElement, send: (command: Command) => void, close: () => void): ServicesPanel {
  let key = ''
  let etas: { kind: ServiceKind; node: HTMLElement }[] = []
  return {
    update(orders, funds, sims, now) {
      const nextKey = JSON.stringify([orders.map(o => o.kind), sims.map(s => s.id), Math.floor(funds / 50)])
      if (nextKey !== key) {
        key = nextKey
        etas = []
        let resortSim = sims[0]?.id ?? ''
        const cards = SERVICE_KINDS.map(kind => {
          const def = SERVICES[kind]
          const pending = orders.find(o => o.kind === kind)
          const eta = el('span', { class: 'sub' })
          if (pending) etas.push({ kind, node: eta })
          const controls: HTMLElement[] = []
          if (def.needsSim) {
            const select = el('select', { 'aria-label': 'Who goes', style: 'background:var(--lib-panel2,#18213a);color:var(--lib-text);border:1px solid var(--lib-line);border-radius:8px;padding:5px' }) as HTMLSelectElement
            for (const s of sims) select.append(el('option', { value: s.id }, s.name))
            select.addEventListener('change', () => { resortSim = select.value })
            if (sims.length) controls.push(select)
          }
          const disabled = !!pending || def.cost > funds || (!!def.needsSim && !sims.length)
          const b = button(`${def.verb}${def.cost ? ` · ${money(def.cost)}` : ''}`, () => send({ t: 'order', kind, sim: def.needsSim ? resortSim : undefined }), 'btn primary')
          b.disabled = disabled
          controls.push(b)
          return el('div', { class: 'job' }, el('b', {}, def.label), el('span', { class: 'hint' }, def.blurb), pending ? eta : null, el('div', { class: 'row' }, ...controls))
        })
        node.replaceChildren(
          el('div', { class: 'row', style: 'justify-content:space-between' }, el('div', { class: 'title' }, 'Call around town'), button('Close', close)),
          el('p', { class: 'sub' }, 'The crews come out to the house in their own trucks. Watch the street to see them arrive.'),
          ...cards,
        )
      }
      for (const e of etas) {
        const o = orders.find(x => x.kind === e.kind)
        if (o) e.node.textContent = o.eta > now ? `On the way: ${clock(o.eta - now)}` : 'Arriving now'
      }
    },
  }
}

export function careerLine(career: CareerView | null | undefined): string {
  if (!career) return 'No job yet'
  return `${JOBS[career.job].title} · ${career.title} · ${career.xp}/${career.next} toward ${career.level < 5 ? jobTitle(career.job, career.level + 1) : 'the top'}`
}

export function jobName(job: JobId): string {
  return JOBS[job].title
}
