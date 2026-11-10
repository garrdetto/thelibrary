/** The setup form's line-up editors: teams (up to four teams of up to two, each person at the oche or the computer at a level, shared or separate scores) and the eight-player tournament field. They keep what was typed while the counts change and hand back plain line-ups. */
import type { CpuLevel, TeamMember } from '../shared/interfaces'
import { MAX_TEAMS, TEAM_SIZE } from '../shared/Rules'
import type { Entrant } from '../shared/Tournament'
import { TOURNAMENT_SIZE } from '../shared/Tournament'

type Kind = 'person' | CpuLevel

const KINDS: { value: Kind; label: string }[] = [
  { value: 'person', label: 'Person' },
  { value: 'pub', label: 'Computer · Pub' },
  { value: 'league', label: 'Computer · League' },
  { value: 'county', label: 'Computer · County' },
  { value: 'pro', label: 'Computer · Pro' },
]

export const TEAM_NAMES = ['Red Team', 'Blue Team', 'Gold Team', 'Green Team'] as const
const COMPUTER_NAMES = ['Big Stan', 'Lefty Lou', 'Tungsten Tess', 'Dash Delgado', 'Mags McCall', 'Oche Otto', 'Bullseye Bev', 'Treble Trev', 'Pip Pembers', 'Sal Shanks', 'Nan Nettles']

interface Person {
  name: string
  kind: Kind
}

export interface TeamLineup {
  name: string
  members: TeamMember[]
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function personRow(person: Person, label: string, placeholder: string): HTMLElement {
  const row = make('div', 'd-person')
  const nameField = make('label', 'd-field')
  nameField.append(document.createTextNode(label))
  const name = make('input')
  name.type = 'text'
  name.maxLength = 16
  name.value = person.name
  name.placeholder = placeholder
  name.addEventListener('input', () => {
    person.name = name.value
  })
  nameField.append(name)
  const kindField = make('label', 'd-field')
  kindField.append(document.createTextNode('Thrown by'))
  const kind = make('select')
  for (const option of KINDS) {
    const item = make('option', '', option.label)
    item.value = option.value
    item.selected = option.value === person.kind
    kind.append(item)
  }
  kind.addEventListener('change', () => {
    person.kind = kind.value as Kind
  })
  kindField.append(kind)
  row.append(nameField, kindField)
  return row
}

function member(person: Person, fallback: string): TeamMember {
  const cpu = person.kind !== 'person'
  return { name: person.name.trim().slice(0, 16) || fallback, cpu, cpuLevel: cpu ? (person.kind as CpuLevel) : 'league' }
}

export class TeamSetup {
  private readonly teams: { name: string; people: Person[] }[] = TEAM_NAMES.map((name, team) => ({
    name,
    people: Array.from({ length: TEAM_SIZE }, (_, slot): Person =>
      team === 0 ? { name: slot === 0 ? 'You' : 'Partner', kind: 'person' } : { name: COMPUTER_NAMES[(team - 1) * TEAM_SIZE + slot], kind: (['league', 'county', 'pub'] as const)[(team - 1) % 3] },
    ),
  }))
  private shown = ''

  constructor(private readonly root: HTMLElement) {}

  render(teamCount: number, size: number): void {
    const key = `${teamCount}:${size}`
    if (key === this.shown) return
    this.shown = key
    this.root.replaceChildren(
      ...this.teams.slice(0, teamCount).map((team, index) => {
        const box = make('fieldset', 'd-team')
        box.style.setProperty('--card-color', ['#ff4d5e', '#39d0ff', '#ffcf4a', '#7cdc6a'][index])
        const legend = make('legend')
        const name = make('input')
        name.type = 'text'
        name.maxLength = 16
        name.value = team.name
        name.setAttribute('aria-label', `Team ${index + 1} name`)
        name.addEventListener('input', () => {
          team.name = name.value
        })
        legend.append(name)
        box.append(legend, ...team.people.slice(0, size).map((person, slot) => personRow(person, size > 1 ? `Player ${slot + 1}` : 'Player', `Player ${slot + 1}`)))
        return box
      }),
    )
  }

  read(teamCount: number, size: number): TeamLineup[] {
    return this.teams.slice(0, Math.min(MAX_TEAMS, teamCount)).map((team, index) => ({
      name: team.name.trim().slice(0, 16) || TEAM_NAMES[index],
      members: team.people.slice(0, size).map((person, slot) => member(person, `${TEAM_NAMES[index].split(' ')[0]} ${slot + 1}`)),
    }))
  }
}

export class TournamentSetup {
  private readonly people: Person[] = Array.from({ length: TOURNAMENT_SIZE }, (_, i): Person =>
    i === 0 ? { name: 'You', kind: 'person' } : { name: COMPUTER_NAMES[i - 1], kind: (['pub', 'league', 'county', 'league', 'pro', 'pub', 'county'] as const)[i - 1] },
  )
  private built = false

  constructor(private readonly root: HTMLElement) {}

  render(): void {
    if (this.built) return
    this.built = true
    this.root.replaceChildren(...this.people.map((person, i) => personRow(person, `Player ${i + 1}`, `Player ${i + 1}`)))
  }

  /** The field, with ids p1–p8 (Player 1, p1, is the signed-in player when a person throws for them). */
  read(): Entrant[] {
    return this.people.map((person, i) => {
      const thrown = member(person, `Player ${i + 1}`)
      return { id: `p${i + 1}`, name: thrown.name, cpu: thrown.cpu, cpuLevel: thrown.cpuLevel }
    })
  }
}
