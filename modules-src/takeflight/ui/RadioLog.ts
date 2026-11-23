/**
 * The radio log: the last few transmissions (who spoke and what they said), newest at the bottom, announced politely to screen
 * readers. Each line fades after a while; `clear` empties it for a new flight.
 */
const MAX_LINES = 3
const LINE_SECONDS = 20

interface Line {
  node: HTMLElement
  age: number
}

export class RadioLog {
  private readonly root: HTMLDivElement
  private readonly lines: Line[] = []

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'tf-radio'
    this.root.setAttribute('role', 'log')
    this.root.setAttribute('aria-live', 'polite')
    this.root.setAttribute('aria-label', 'Radio')
    parent.append(this.root)
  }

  add(from: string, text: string): void {
    const node = document.createElement('p')
    const who = document.createElement('b')
    who.textContent = `${from}: `
    node.append(who, text)
    this.root.append(node)
    this.lines.push({ node, age: 0 })
    while (this.lines.length > MAX_LINES) this.lines.shift()?.node.remove()
  }

  update(dt: number): void {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i]
      line.age += dt
      if (line.age > LINE_SECONDS) {
        line.node.remove()
        this.lines.splice(i, 1)
      } else if (line.age > LINE_SECONDS - 2) line.node.style.opacity = String((LINE_SECONDS - line.age) / 2)
    }
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible
  }

  clear(): void {
    for (const line of this.lines) line.node.remove()
    this.lines.length = 0
  }

  dispose(): void {
    this.root.remove()
  }
}
