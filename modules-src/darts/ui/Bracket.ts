/** The tournament panel between legs: the bracket (quarter-finals, semi-finals, final) with legs won, the game rotation, what just happened and the buttons for the next match (play it, watch the computers, or simulate). */
import { config } from '../config'
import { ROTATION_NAMES, ROUND_NAMES, entrantOf, legsWon, nextLegMode, nextTournamentMatch, rotationLabel, type Tournament } from '../shared/Tournament'

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export class Bracket {
  private readonly grid = el<HTMLDivElement>('bracket-grid')
  private readonly title = el<HTMLHeadingElement>('bracket-title')
  private readonly rotation = el<HTMLParagraphElement>('bracket-rotation')
  private readonly note = el<HTMLParagraphElement>('bracket-note')
  private readonly next = el<HTMLParagraphElement>('bracket-next')
  readonly play = el<HTMLButtonElement>('bracket-play')
  readonly watch = el<HTMLButtonElement>('bracket-watch')
  readonly sim = el<HTMLButtonElement>('bracket-sim')
  readonly simAll = el<HTMLButtonElement>('bracket-sim-all')
  readonly quit = el<HTMLButtonElement>('bracket-quit')

  render(tournament: Tournament, note: string): void {
    const champion = entrantOf(tournament, tournament.championId)
    const upcoming = nextTournamentMatch(tournament)
    this.title.textContent = champion ? `${champion.name} wins the tournament!` : 'Tournament'
    this.rotation.textContent = `${tournament.rules.board === 'spider' ? 'Soft Tip' : 'Steel Tip'} · best of 3 · ${rotationLabel(tournament)}`
    this.note.textContent = note
    const colour = (id: string | null) => {
      const index = tournament.entrants.findIndex((entrant) => entrant.id === id)
      return config.dart.flightColors[Math.max(0, index) % config.dart.flightColors.length]
    }
    this.grid.replaceChildren(
      ...ROUND_NAMES.map((roundName, round) => {
        const column = make('div', 'd-round')
        column.append(make('h3', '', roundName))
        for (const match of tournament.matches.filter((item) => item.round === round)) {
          const card = make('div', `d-match${match === upcoming ? ' is-next' : ''}${match.winnerId ? ' is-done' : ''}`)
          for (const id of [match.a, match.b]) {
            const entrant = entrantOf(tournament, id)
            const line = make('div', `d-match-line${match.winnerId && match.winnerId === id ? ' is-winner' : match.winnerId ? ' is-out' : ''}`)
            line.style.setProperty('--card-color', entrant ? colour(id) : 'transparent')
            line.append(make('span', 'd-match-name', entrant ? `${entrant.name}${entrant.cpu ? '' : ' ★'}` : '—'), make('b', '', entrant ? String(legsWon(match, id)) : ''))
            card.append(line)
          }
          column.append(card)
        }
        return column
      }),
    )
    const a = upcoming ? entrantOf(tournament, upcoming.a) : null
    const b = upcoming ? entrantOf(tournament, upcoming.b) : null
    const people = !!upcoming && (!a?.cpu || !b?.cpu)
    const peopleLeft = tournament.entrants.some((entrant) => !entrant.cpu && tournament.matches.some((match) => !match.winnerId && (match.a === entrant.id || match.b === entrant.id)))
    if (upcoming && a && b) {
      const round = ROUND_NAMES[upcoming.round]
      this.next.textContent = `Next: ${round}, ${a.name} v ${b.name} · leg ${upcoming.legs.length + 1} (${ROTATION_NAMES[nextLegMode(tournament, upcoming)]})`
    } else this.next.textContent = ''
    this.play.hidden = !people
    this.watch.hidden = !upcoming || people
    this.sim.hidden = !upcoming || people
    this.simAll.hidden = !upcoming || people
    this.simAll.textContent = peopleLeft ? 'Simulate to your next match' : 'Simulate to the end'
    this.quit.textContent = champion ? 'Back to the menu' : 'Leave tournament'
  }
}
