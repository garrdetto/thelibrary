/** DOM for online matchups: the setup card's ranked, private-room and join controls, the ranked ladder, the lobby card while waiting, the in-contest opponent tag and the final card's rating line. */
import { teamById } from '../sim'
import type { Side } from '../sim/types'
import { isRoomCode, type PlayerView, type RatingChange } from '../shared/Online'
import { onlineStatus } from '../systems/Online'

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}

export interface OnlineActions {
  ranked(): void
  create(): void
  join(code: string): void
  leave(): void
  concede(): void
}

export class OnlinePanel {
  private readonly lobby = byId<HTMLElement>('screen-lobby')
  private readonly note = byId<HTMLElement>('online-note')
  private readonly tag = byId<HTMLElement>('bl-online-tag')
  private readonly tagText = byId<HTMLElement>('bl-online-name')
  private readonly concede = byId<HTMLButtonElement>('bl-concede')
  private signedIn = false
  private armedConcede = 0

  bind(actions: OnlineActions): void {
    const code = byId<HTMLInputElement>('online-code')
    byId('online-ranked').addEventListener('click', () => {
      if (!this.signedIn) return this.setNote('Sign in to the library to play ranked matchups. Private rooms work for everyone.')
      actions.ranked()
    })
    byId('online-create').addEventListener('click', () => actions.create())
    const join = () => {
      const value = code.value.trim().toUpperCase()
      if (!isRoomCode(value)) return this.setNote('Room codes are six letters and numbers.')
      actions.join(value)
    }
    byId('online-join').addEventListener('click', join)
    code.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        join()
      }
    })
    byId('lobby-cancel').addEventListener('click', () => actions.leave())
    this.concede.addEventListener('click', () => {
      if (Date.now() - this.armedConcede < 4000) {
        this.armedConcede = 0
        this.concede.textContent = 'Concede'
        actions.concede()
        return
      }
      this.armedConcede = Date.now()
      this.concede.textContent = 'Click again to concede'
      window.setTimeout(() => {
        if (Date.now() - this.armedConcede >= 4000) this.concede.textContent = 'Concede'
      }, 4100)
    })
    byId('lobby-copy').addEventListener('click', () => {
      const value = byId('lobby-code').textContent ?? ''
      void navigator.clipboard?.writeText(value).then(() => (byId('lobby-text').textContent = 'Code copied.')).catch(() => undefined)
    })
    void this.refreshRatings()
  }

  setNote(text: string): void {
    this.note.textContent = text
  }

  async refreshRatings(): Promise<void> {
    const table = byId<HTMLTableElement>('ratings-table')
    const mine = byId('ratings-mine')
    try {
      const status = await onlineStatus()
      this.signedIn = status.signedIn
      table.replaceChildren()
      const head = table.createTHead().insertRow()
      for (const label of ['#', 'Player', 'Rating', 'W', 'L']) head.append(Object.assign(document.createElement('th'), { textContent: label }))
      const body = table.createTBody()
      if (!status.ratings.length) {
        const row = body.insertRow()
        const cell = row.insertCell()
        cell.colSpan = 5
        cell.textContent = 'No ranked results yet. Be the first.'
      }
      status.ratings.forEach((entry, index) => {
        const row = body.insertRow()
        for (const value of [index + 1, entry.username, entry.rating, entry.wins, entry.losses]) row.insertCell().textContent = String(value)
      })
      mine.textContent = status.mine ? `Your rating: ${status.mine.rating} (${status.mine.wins}–${status.mine.losses}).` : 'Sign in to the library to earn a rating.'
    } catch {
      mine.textContent = 'The ladder is not available right now.'
    }
  }

  showLobby(title: string, text: string, players: PlayerView[], code: string | null): void {
    this.lobby.hidden = false
    byId('lobby-title').textContent = title
    byId('lobby-text').textContent = text
    const codeBox = byId('lobby-code')
    codeBox.hidden = !code
    codeBox.textContent = code ?? ''
    byId('lobby-copy').hidden = !code
    const list = byId<HTMLUListElement>('lobby-players')
    list.replaceChildren()
    for (const player of players) {
      const item = document.createElement('li')
      item.classList.toggle('is-away', !player.connected)
      const team = teamById(player.team)
      item.append(Object.assign(document.createElement('b'), { textContent: player.name }), Object.assign(document.createElement('span'), { textContent: `${team.city} ${team.name} · ${player.side === 1 ? 'home' : 'visitors'}${player.rating !== null ? ` · ${player.rating}` : ''}` }))
      list.append(item)
    }
  }

  hideLobby(): void {
    this.lobby.hidden = true
  }

  /** The small "vs. name" tag shown during an online contest. */
  setOpponent(players: PlayerView[], side: Side | null, ranked: boolean): void {
    const other = side === null ? undefined : players.find((player) => player.side !== side)
    this.tag.hidden = !other
    if (!other) return
    this.tagText.textContent = `${ranked ? 'Ranked' : 'Online'} vs. ${other.name}${other.connected ? '' : ' (reconnecting)'}`
  }

  /** Hides the concede button once the contest is over. */
  setConcede(visible: boolean): void {
    this.concede.hidden = !visible
  }

  showResult(text: string, change: RatingChange | null): void {
    const line = byId('final-online')
    line.hidden = !text && !change
    const delta = change ? change.after - change.before : 0
    line.textContent = `${text}${change ? ` Rating ${change.before} → ${change.after} (${delta >= 0 ? '+' : ''}${delta}).` : ''}`
  }

  clearResult(): void {
    byId('final-online').hidden = true
  }
}
