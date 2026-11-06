/** Broadcast overlays: the batter's lower-third, the stats overlay (Tab), the Gutter Report ticker, subtitles for every voice line, the replay badge and the key remapping dialog. */
import type { Input } from '../../../engine'
import type { InputBinding } from '../../../engine'
import { ACTION_LABELS, config, type Action } from '../config'
import { inningsPitched, type Contest, type Player } from '../sim'
import { liveNote, tickerHeadlines } from './Ticker'

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}

const STORAGE_KEY = 'tl-bushleague-keys'

function keyLabel(binding: InputBinding | undefined): string {
  if (!binding) return '—'
  if (binding.kind === 'key') return binding.code.replace(/^Key/, '').replace(/^Digit/, '')
  if (binding.kind === 'mouse') return ['Left click', 'Middle click', 'Right click'][binding.button] ?? 'Mouse'
  if (binding.kind === 'pad') return `Pad ${binding.button}`
  return binding.kind
}

export class Broadcast {
  private readonly lowerThird = byId<HTMLElement>('lower-third')
  private readonly stats = byId<HTMLElement>('stats-panel')
  private readonly statsBody = byId<HTMLElement>('stats-body')
  private readonly ticker = byId<HTMLElement>('ticker')
  private readonly track = byId<HTMLElement>('ticker-track')
  private readonly subtitle = byId<HTMLElement>('subtitle')
  private readonly replay = byId<HTMLElement>('replay-badge')
  private lowerTimer = 0
  private subtitleTimer = 0
  private headlines: string[] = []

  constructor(private readonly input: Input<Action>) {
    this.loadBindings()
    byId('controls-button').addEventListener('click', () => this.openControls())
    byId('controls-close').addEventListener('click', () => byId<HTMLDialogElement>('controls-dialog').close())
    byId('controls-reset').addEventListener('click', () => {
      for (const action of Object.keys(config.bindings) as Action[]) this.input.rebind(action, config.bindings[action])
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        return
      }
      this.renderControls()
    })
  }

  start(contest: Contest): void {
    this.headlines = tickerHeadlines(contest)
    this.renderTicker(null)
    this.ticker.hidden = false
  }

  hide(): void {
    this.ticker.hidden = true
    this.stats.hidden = true
    this.lowerThird.classList.remove('is-in')
    this.replay.hidden = true
  }

  private renderTicker(note: string | null): void {
    const items = note ? [note, ...this.headlines] : this.headlines
    this.track.textContent = items.join('   •   ')
  }

  refreshTicker(contest: Contest): void {
    this.renderTicker(liveNote(contest))
  }

  introduce(contest: Contest, batter: Player, seconds: number): void {
    const team = contest.offense.roster.team
    const line = contest.offense.box.batting.find((item) => item.id === batter.id)
    byId('lt-name').textContent = `#${batter.number} ${batter.first} ${batter.last}`
    byId('lt-nick').textContent = `"${batter.nickname}" · ${batter.position} · ${batter.bats === 'S' ? 'switch' : batter.bats === 'L' ? 'bats left' : 'bats right'}`
    byId('lt-line').textContent = line && line.ab + line.bb > 0 ? `Today ${line.h}-for-${line.ab}${line.hr ? `, ${line.hr} HR` : ''}${line.rbi ? `, ${line.rbi} RBI` : ''}${line.bb ? `, ${line.bb} BB` : ''}` : `First trip to the plate · contact ${batter.ratings.contact}, power ${batter.ratings.power}, speed ${batter.ratings.speed}`
    this.lowerThird.style.setProperty('--team', team.colors.primary)
    this.lowerThird.classList.add('is-in')
    clearTimeout(this.lowerTimer)
    this.lowerTimer = window.setTimeout(() => this.lowerThird.classList.remove('is-in'), seconds * 1000)
  }

  toggleStats(contest: Contest | null): void {
    this.stats.hidden = !this.stats.hidden
    if (contest) this.updateStats(contest)
  }

  updateStats(contest: Contest): void {
    if (this.stats.hidden) return
    const pitcher = contest.pitcher
    const pitchLine = contest.defenseTeam.box.pitching.find((item) => item.id === pitcher.id)
    const batter = contest.batter
    const batLine = contest.offense.box.batting.find((item) => item.id === batter.id)
    const rows: [string, string][] = [
      [`P ${pitcher.last}`, pitchLine ? `${inningsPitched(pitchLine.outs)} IP, ${pitchLine.h} H, ${pitchLine.er} ER, ${pitchLine.bb} BB, ${pitchLine.so} K · ${pitchLine.pitches} pitches (${pitchLine.strikes} strikes)` : '—'],
      [`AB ${batter.last}`, batLine ? `${batLine.h}-for-${batLine.ab}, ${batLine.rbi} RBI, ${batLine.bb} BB, ${batLine.so} K` : 'First trip'],
      ['Line', `${contest.teams[0].roster.team.abbr} ${contest.teams[0].box.runs}-${contest.teams[0].box.hits}-${contest.teams[0].box.errors} · ${contest.teams[1].roster.team.abbr} ${contest.teams[1].box.runs}-${contest.teams[1].box.hits}-${contest.teams[1].box.errors}`],
      ['Pitches', String(contest.pitchCount)],
    ]
    this.statsBody.replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement('div')
      const name = document.createElement('b')
      name.textContent = `${label}: `
      row.append(name, document.createTextNode(value))
      return row
    }))
  }

  say(text: string, seconds = 3.2): void {
    this.subtitle.textContent = text
    this.subtitle.hidden = !text
    clearTimeout(this.subtitleTimer)
    this.subtitleTimer = window.setTimeout(() => (this.subtitle.hidden = true), seconds * 1000)
  }

  showReplay(visible: boolean): void {
    this.replay.hidden = !visible
  }

  private loadBindings(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Record<Action, string>> | null
      if (!saved) return
      for (const [action, code] of Object.entries(saved) as [Action, string][]) {
        if (!(action in config.bindings) || typeof code !== 'string') continue
        this.input.rebind(action, [{ kind: 'key', code }, ...config.bindings[action].filter((binding) => binding.kind !== 'key')])
      }
    } catch {
      return
    }
  }

  private saveBinding(action: Action, code: string): void {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<Action, string>>
      saved[action] = code
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    } catch {
      return
    }
  }

  private openControls(): void {
    this.renderControls()
    byId<HTMLDialogElement>('controls-dialog').showModal()
  }

  private renderControls(): void {
    const list = byId('controls-list')
    list.replaceChildren()
    for (const action of Object.keys(ACTION_LABELS) as Action[]) {
      const label = document.createElement('span')
      label.textContent = ACTION_LABELS[action]
      const current = document.createElement('code')
      current.textContent = keyLabel(this.input.bindings(action).find((binding) => binding.kind === 'key') ?? this.input.bindings(action)[0])
      const change = document.createElement('button')
      change.type = 'button'
      change.className = 'bl-chip'
      change.textContent = 'Change'
      change.addEventListener('click', () => {
        change.textContent = 'Press a key…'
        const capture = (event: KeyboardEvent) => {
          event.preventDefault()
          event.stopPropagation()
          removeEventListener('keydown', capture, true)
          if (event.code !== 'Escape') {
            this.input.rebind(action, [{ kind: 'key', code: event.code }, ...this.input.bindings(action).filter((binding) => binding.kind !== 'key')])
            this.saveBinding(action, event.code)
          }
          this.renderControls()
        }
        addEventListener('keydown', capture, true)
      })
      list.append(label, current, change)
    }
  }
}
