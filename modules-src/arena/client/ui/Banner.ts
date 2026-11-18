function element(id: string): HTMLElement | null {
  return document.getElementById(id)
}

export function clock(ms: number, tenths = false): string {
  const total = Math.max(0, ms)
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const base = `${minutes}:${String(seconds).padStart(2, '0')}`
  return tenths ? `${base}.${Math.floor((total % 1000) / 100)}` : base
}

export class Banner {
  private readonly box = element('objective')
  private readonly title = element('objective-title')
  private readonly line = element('objective-line')
  private readonly center = element('center-message')
  private readonly big = element('countdown')
  private lastBig = ''
  private lastTitle = ''
  private lastLine = ''
  private lastCenter = ''

  show(title: string, line: string): void {
    if (this.box) this.box.hidden = false
    if (this.title && title !== this.lastTitle) {
      this.title.textContent = title
      this.lastTitle = title
    }
    if (this.line && line !== this.lastLine) {
      this.line.textContent = line
      this.lastLine = line
    }
  }

  message(text: string): void {
    if (!this.center || text === this.lastCenter) return
    this.center.textContent = text
    this.center.classList.toggle('show', Boolean(text))
    this.lastCenter = text
  }

  countdown(text: string): void {
    if (!this.big || text === this.lastBig) return
    this.lastBig = text
    this.big.textContent = text
    this.big.classList.toggle('small', text.length > 3)
    this.big.classList.remove('pop')
    if (!text) return
    void this.big.offsetWidth
    this.big.classList.add('pop')
  }

  hide(): void {
    if (this.box) this.box.hidden = true
    this.message('')
    this.countdown('')
    this.lastTitle = ''
    this.lastLine = ''
  }
}
