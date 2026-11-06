/** DOM bindings for the setup card, score bug, banner, matchup strip, play-by-play, pitch picker and meter, and the final box score. */
import { PITCH_SPECS, TEAMS, inningsPitched, parkById, teamById, type Contest, type PitchGrade, type TeamBox } from '../sim'
import { config, type Difficulty, type DifficultyLevel } from '../config'
import type { TimeOfDay } from '../looks'

export type SideChoice = 'away' | 'home' | 'both' | 'watch'

export interface SetupChoice {
  team: string
  opponent: string
  side: SideChoice
  innings: 3 | 6 | 9
  difficulty: Difficulty | 'custom'
  /** Resolved difficulty numbers (a preset, or the custom sliders). */
  level: DifficultyLevel
  dh: boolean
  autoRunner: boolean
  mercy: boolean
  time: TimeOfDay
  trail: boolean
  assist: boolean
  colorSafe: boolean
  replays: boolean
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}

function chips<T extends string>(container: HTMLElement, options: readonly { value: T; label: string }[], initial: T, onChange: (value: T) => void): () => T {
  let current = initial
  container.replaceChildren()
  for (const option of options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'bl-chip'
    button.textContent = option.label
    button.setAttribute('aria-pressed', String(option.value === current))
    button.addEventListener('click', () => {
      current = option.value
      for (const child of container.children) child.setAttribute('aria-pressed', String(child === button))
      onChange(current)
    })
    container.append(button)
  }
  return () => current
}

function cell(row: HTMLTableRowElement, text: string | number, header = false): void {
  const element = document.createElement(header ? 'th' : 'td')
  element.textContent = String(text)
  row.append(element)
}

export class Screens {
  readonly setup = byId<HTMLElement>('screen-setup')
  readonly final = byId<HTMLElement>('screen-final')
  private readonly bug = byId<HTMLElement>('bug')
  private readonly banner = byId<HTMLElement>('banner')
  private readonly hint = byId<HTMLElement>('hint')
  private readonly pitchInfo = byId<HTMLElement>('pitch-info')
  private readonly matchup = byId<HTMLElement>('matchup')
  private readonly log = byId<HTMLDetailsElement>('log')
  private readonly logList = byId<HTMLOListElement>('log-list')
  private readonly picker = byId<HTMLElement>('picker')
  private readonly pitchButtons = byId<HTMLElement>('pitch-buttons')
  private readonly meterFill = byId<HTMLElement>('meter-fill')
  private readonly meterEffort = byId<HTMLElement>('meter-effort')
  private readonly meterLabel = byId<HTMLElement>('meter-label')
  private readonly stealFlag = byId<HTMLElement>('steal-flag')
  private bannerTimer = 0
  private logged = 0

  bindSetup(onStart: (choice: SetupChoice) => void): void {
    const team = byId<HTMLSelectElement>('team-select')
    const opponent = byId<HTMLSelectElement>('opponent-select')
    for (const select of [team, opponent]) {
      select.replaceChildren()
      for (const league of ['Lowbrow', 'Gutter'] as const) {
        const group = document.createElement('optgroup')
        group.label = `${league} League`
        for (const item of TEAMS.filter((entry) => entry.league === league)) {
          const option = document.createElement('option')
          option.value = item.id
          option.textContent = `${item.city} ${item.name}`
          group.append(option)
        }
        select.append(group)
      }
    }
    team.value = 'frt'
    opponent.value = 'sal'
    const side = chips(byId('side-chips'), [{ value: 'home' as SideChoice, label: 'Home team' }, { value: 'away' as SideChoice, label: 'Visitors' }, { value: 'both' as SideChoice, label: 'Two players' }, { value: 'watch' as SideChoice, label: 'Just watch' }], 'home', () => updateNote())
    const innings = chips(byId('innings-chips'), [{ value: '3', label: '3 innings' }, { value: '6', label: '6 innings' }, { value: '9', label: '9 innings' }], '3', () => undefined)
    const sliders = byId<HTMLElement>('custom-sliders')
    const difficultyOptions = [...(Object.entries(config.difficulty) as [Difficulty, DifficultyLevel][]).map(([value, level]) => ({ value: value as Difficulty | 'custom', label: level.label })), { value: 'custom' as const, label: 'Custom' }]
    const difficulty = chips(byId('difficulty-chips'), difficultyOptions, 'rookie', (value) => (sliders.hidden = value !== 'custom'))
    const slider = (id: string, format: (value: number) => string) => {
      const input = byId<HTMLInputElement>(id)
      const output = byId<HTMLOutputElement>(`${id}-out`)
      const sync = () => (output.textContent = format(Number(input.value)))
      input.addEventListener('input', sync)
      sync()
      return () => Number(input.value)
    }
    const customPace = slider('custom-pace', (value) => `${(value / 100).toFixed(2)}×`)
    const customPci = slider('custom-pci', (value) => `${value}%`)
    const customSkill = slider('custom-skill', (value) => (value > 0 ? `+${value}` : String(value)))
    const level = (): DifficultyLevel => {
      const pick = difficulty()
      return pick === 'custom' ? { label: 'Custom', pace: customPace() / 100, pci: customPci() / 100, skill: customSkill() / 100 } : config.difficulty[pick]
    }
    const time = chips(byId('time-chips'), [{ value: 'day' as TimeOfDay, label: 'Day' }, { value: 'dusk' as TimeOfDay, label: 'Golden hour' }, { value: 'night' as TimeOfDay, label: 'Night' }], 'night', () => undefined)
    const note = byId('park-note')
    const updateNote = () => {
      const home = teamById(side() === 'away' ? opponent.value : team.value)
      const park = parkById(home.park)
      note.textContent = `Home park: ${home.parkName}${home.parkName === park.name ? '' : ` (${park.name} layout)`}, ${park.altitude} m above sea level${park.dome ? ', under a dome' : ''}.`
    }
    team.addEventListener('change', updateNote)
    opponent.addEventListener('change', updateNote)
    updateNote()
    byId<HTMLFormElement>('setup-form').addEventListener('submit', (event) => {
      event.preventDefault()
      const rival = opponent.value === team.value ? TEAMS.find((item) => item.id !== team.value)!.id : opponent.value
      const checked = (id: string) => byId<HTMLInputElement>(id).checked
      onStart({ team: team.value, opponent: rival, side: side(), innings: Number(innings()) as 3 | 6 | 9, difficulty: difficulty(), level: level(), dh: checked('dh-check'), autoRunner: checked('runner-check'), mercy: checked('mercy-check'), time: time(), trail: checked('trail-check'), assist: checked('assist-check'), colorSafe: checked('safe-check'), replays: checked('replay-check') })
    })
  }

  showSetup(visible: boolean): void {
    this.setup.hidden = !visible
    this.bug.hidden = visible
    this.matchup.hidden = visible
    this.log.hidden = visible
    if (visible) {
      this.picker.hidden = true
      this.pitchInfo.hidden = true
      this.hint.textContent = ''
    }
  }

  resetLog(): void {
    this.logList.replaceChildren()
    this.logged = 0
  }

  updateBug(contest: Contest): void {
    const [away, home] = contest.teams
    byId('bug-away-abbr').textContent = away.roster.team.abbr
    byId('bug-home-abbr').textContent = home.roster.team.abbr
    byId('bug-away').style.boxShadow = `inset 4px 0 0 ${away.roster.team.colors.primary}`
    byId('bug-home').style.boxShadow = `inset 4px 0 0 ${home.roster.team.colors.primary}`
    byId('bug-away-runs').textContent = String(contest.score[0])
    byId('bug-home-runs').textContent = String(contest.score[1])
    byId('bug-inning').textContent = contest.phase === 'final' ? 'FINAL' : `${contest.half === 'top' ? '▲' : '▼'} ${contest.inning}`
    byId('bug-count').textContent = `${contest.balls}-${contest.strikes}`
    for (const base of [1, 2, 3]) byId(`bug-b${base}`).classList.toggle('on', !!contest.bases[base])
    byId('bug-o1').classList.toggle('on', contest.outs >= 1)
    byId('bug-o2').classList.toggle('on', contest.outs >= 2)
    const batter = contest.batter
    const pitcher = contest.pitcher
    const line = contest.offense.box.batting.find((item) => item.id === batter.id)
    const pitchLine = contest.defenseTeam.box.pitching.find((item) => item.id === pitcher.id)
    byId('matchup-batter').innerHTML = ''
    byId('matchup-batter').append(Object.assign(document.createElement('span'), { textContent: 'AB ' }), Object.assign(document.createElement('b'), { textContent: `${batter.first} ${batter.last}` }), document.createTextNode(` #${batter.number} · ${batter.bats === 'S' ? 'switch' : batter.bats === 'L' ? 'bats left' : 'bats right'} · ${line ? `${line.h}-for-${line.ab}` : 'first trip'}`))
    byId('matchup-pitcher').innerHTML = ''
    byId('matchup-pitcher').append(Object.assign(document.createElement('span'), { textContent: 'P ' }), Object.assign(document.createElement('b'), { textContent: `${pitcher.first} ${pitcher.last}` }), document.createTextNode(` #${pitcher.number} · ${pitcher.throws === 'L' ? 'lefty' : 'righty'} · ${pitchLine?.pitches ?? 0} pitches`))
    this.appendLog(contest)
  }

  private appendLog(contest: Contest): void {
    while (this.logged < contest.plays.length) {
      const entry = contest.plays[this.logged++]
      const item = document.createElement('li')
      item.textContent = `${entry.half === 'top' ? '▲' : '▼'}${entry.inning} ${entry.text}`
      this.logList.prepend(item)
    }
  }

  say(text: string, seconds = 2.4, big = false): void {
    this.banner.textContent = text
    this.banner.hidden = !text
    this.banner.classList.toggle('is-big', big)
    clearTimeout(this.bannerTimer)
    if (text && seconds > 0) this.bannerTimer = window.setTimeout(() => (this.banner.hidden = true), seconds * 1000)
  }

  setHint(text: string): void {
    this.hint.textContent = text
  }

  showPitch(type: string, mph: number, call: string): void {
    this.pitchInfo.hidden = false
    byId('pitch-type').textContent = type
    byId('pitch-mph').textContent = `${mph} mph`
    byId('pitch-call').textContent = call
  }

  hidePitch(): void {
    this.pitchInfo.hidden = true
  }

  setSteal(armed: boolean): void {
    this.stealFlag.hidden = !armed
  }

  showPicker(repertoire: PitchGrade[], selected: number, onPick: (index: number) => void): void {
    this.picker.hidden = false
    this.pitchButtons.replaceChildren()
    repertoire.forEach((item, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'bl-pitch'
      button.setAttribute('aria-pressed', String(index === selected))
      button.append(document.createTextNode(`${index + 1} ${PITCH_SPECS[item.type].short}`), Object.assign(document.createElement('small'), { textContent: String(item.grade) }))
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        onPick(index)
      })
      this.pitchButtons.append(button)
    })
  }

  selectPitch(index: number): void {
    ;[...this.pitchButtons.children].forEach((child, position) => child.setAttribute('aria-pressed', String(position === index)))
  }

  hidePicker(): void {
    this.picker.hidden = true
  }

  setMeter(fill: number, effort: number | null, label: string): void {
    this.meterFill.style.width = `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%`
    this.meterEffort.style.display = effort === null ? 'none' : 'block'
    if (effort !== null) this.meterEffort.style.left = `${Math.round(effort * 100)}%`
    this.meterLabel.textContent = label
  }

  showFinal(contest: Contest, youSide: 0 | 1 | null): void {
    this.final.hidden = false
    this.bug.hidden = false
    this.picker.hidden = true
    const [away, home] = contest.teams
    const winner = contest.teams[contest.winner ?? 0].roster.team
    byId('final-eyebrow').textContent = contest.inning > contest.setup.innings ? `Final · ${contest.inning} innings` : 'Final'
    byId('final-title').textContent = `${away.roster.team.abbr} ${contest.score[0]}, ${home.roster.team.abbr} ${contest.score[1]}`
    byId('final-line').textContent = youSide === null ? `${winner.city} ${winner.name} win.` : contest.winner === youSide ? `You win! The ${winner.name} take it.` : `The ${winner.name} take this one. Run it back?`

    const table = byId<HTMLTableElement>('line-score')
    table.replaceChildren()
    const innings = Math.max(away.box.lineScore.length, home.box.lineScore.length, contest.setup.innings)
    const head = table.createTHead().insertRow()
    cell(head, '', true)
    for (let inning = 1; inning <= innings; inning++) cell(head, inning, true)
    for (const label of ['R', 'H', 'E']) cell(head, label, true)
    const body = table.createTBody()
    for (const team of [away, home]) {
      const row = body.insertRow()
      cell(row, team.roster.team.abbr)
      for (let inning = 0; inning < innings; inning++) cell(row, team.box.lineScore[inning] ?? (team === home && inning === innings - 1 ? 'X' : ''))
      cell(row, team.box.runs)
      cell(row, team.box.hits)
      cell(row, team.box.errors)
    }

    const tables = byId('box-tables')
    tables.replaceChildren()
    for (const team of [away, home]) tables.append(this.teamBox(team.box, `${team.roster.team.city} ${team.roster.team.name}`))
  }

  private teamBox(box: TeamBox, title: string): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'bl-scroll'
    const heading = document.createElement('h3')
    heading.textContent = title
    wrap.append(heading)
    const batting = document.createElement('table')
    batting.className = 'bl-table'
    batting.setAttribute('aria-label', `${title} batting`)
    const head = batting.createTHead().insertRow()
    for (const label of ['Batter', 'AB', 'R', 'H', 'RBI', 'BB', 'SO', 'HR']) cell(head, label, true)
    const body = batting.createTBody()
    const totals = { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0, hr: 0 }
    for (const line of box.batting) {
      const row = body.insertRow()
      cell(row, `${line.name} ${line.pos}`)
      for (const key of ['ab', 'r', 'h', 'rbi', 'bb', 'so', 'hr'] as const) {
        cell(row, line[key])
        totals[key] += line[key]
      }
    }
    const total = body.insertRow()
    total.className = 'is-total'
    cell(total, 'Totals')
    for (const key of ['ab', 'r', 'h', 'rbi', 'bb', 'so', 'hr'] as const) cell(total, totals[key])
    wrap.append(batting)

    const pitching = document.createElement('table')
    pitching.className = 'bl-table'
    pitching.setAttribute('aria-label', `${title} pitching`)
    const pitchHead = pitching.createTHead().insertRow()
    for (const label of ['Pitcher', 'IP', 'H', 'R', 'ER', 'BB', 'SO', 'P']) cell(pitchHead, label, true)
    const pitchBody = pitching.createTBody()
    for (const line of box.pitching) {
      const row = pitchBody.insertRow()
      const decisions = line.decisions.filter((item) => item !== 'BS' || line.decisions.length === 1)
      cell(row, `${line.name}${decisions.length ? ` (${decisions.join(', ')})` : ''}${line.qualityStart ? ' QS' : ''}`)
      cell(row, inningsPitched(line.outs))
      for (const key of ['h', 'r', 'er', 'bb', 'so', 'pitches'] as const) cell(row, line[key])
    }
    wrap.append(pitching)
    return wrap
  }

  hideFinal(): void {
    this.final.hidden = true
  }
}
