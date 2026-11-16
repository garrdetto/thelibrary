export interface ResultLine {
  label: string
  value: string
}

export interface ResultCard {
  title: string
  headline: string
  lines: ResultLine[]
  note?: string
  again: string
}

export class Results {
  private readonly box = document.getElementById('results') as HTMLDivElement | null
  private readonly title = document.getElementById('results-title')
  private readonly headline = document.getElementById('results-headline')
  private readonly list = document.getElementById('results-lines')
  private readonly note = document.getElementById('results-note')
  private readonly again = document.getElementById('results-again') as HTMLButtonElement | null
  private readonly modes = document.getElementById('results-modes') as HTMLButtonElement | null
  private onAgain: () => void = () => {}
  private onModes: () => void = () => {}

  constructor() {
    this.again?.addEventListener('click', () => { this.hide(); this.onAgain() })
    this.modes?.addEventListener('click', () => { this.hide(); this.onModes() })
  }

  get open(): boolean {
    return Boolean(this.box && !this.box.hidden)
  }

  show(card: ResultCard, again: () => void, modes: () => void): void {
    if (!this.box) return
    this.onAgain = again
    this.onModes = modes
    if (this.title) this.title.textContent = card.title
    if (this.headline) this.headline.textContent = card.headline
    if (this.list) {
      this.list.replaceChildren(...card.lines.map(line => {
        const row = document.createElement('div')
        const label = document.createElement('dt')
        label.textContent = line.label
        const value = document.createElement('dd')
        value.textContent = line.value
        row.append(label, value)
        return row
      }))
    }
    if (this.note) {
      this.note.textContent = card.note ?? ''
      this.note.hidden = !card.note
    }
    if (this.again) this.again.textContent = card.again
    this.box.hidden = false
    document.body.classList.add('overlay')
    if (document.pointerLockElement) document.exitPointerLock()
    this.again?.focus()
  }

  hide(): void {
    if (!this.box) return
    this.box.hidden = true
    document.body.classList.remove('overlay')
  }

  update(card: Partial<ResultCard>): void {
    if (card.note !== undefined && this.note) {
      this.note.textContent = card.note
      this.note.hidden = !card.note
    }
  }
}
