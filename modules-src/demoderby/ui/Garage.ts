/** Garage screen: body, paint, number, spray style and field pickers bound to a CarLook plus heat settings; the results screen; all plain DOM. */
import { config } from '../config'
import { cleanNumber, type CarLook } from '../systems/Look'

export interface HeatSettings {
  opponents: number
  level: string
  /** Damage preset id: light, realistic or brutal. */
  damage: string
}

export interface ResultRow {
  place: number
  label: string
  hits: number
  knockouts: number
  points: number
  isPlayer: boolean
}

export interface GarageHandlers {
  onLook(look: CarLook): void
  onStart(look: CarLook, settings: HeatSettings): void
  onAgain(): void
  onWatch(): void
  onGarage(): void
}

export interface GarageScreens {
  showGarage(): void
  showResults(title: string, line: string, rows: ResultRow[], eyebrow: string, canWatch: boolean): void
  hideAll(): void
  setBestNote(text: string): void
  /** Names the Thrill Park the arena stands in. */
  setParkNote(text: string): void
  dispose(): void
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}

function chipGroup(container: HTMLElement, items: readonly { id: string; name: string }[], selected: () => string, onPick: (id: string) => void): () => void {
  container.replaceChildren()
  const buttons: HTMLButtonElement[] = []
  for (const item of items) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dd-chip'
    button.textContent = item.name
    button.dataset.id = item.id
    button.addEventListener('click', () => onPick(item.id))
    container.appendChild(button)
    buttons.push(button)
  }
  const refresh = () => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.id === selected()))
  }
  refresh()
  return refresh
}

function swatchGroup(container: HTMLElement, items: readonly { id: string; name: string; hex: string }[], selected: () => string, onPick: (id: string) => void): () => void {
  container.replaceChildren()
  const buttons: HTMLButtonElement[] = []
  for (const item of items) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dd-swatch'
    button.title = item.name
    button.setAttribute('aria-label', item.name)
    button.style.background = item.hex
    button.dataset.id = item.id
    button.addEventListener('click', () => onPick(item.id))
    container.appendChild(button)
    buttons.push(button)
  }
  const refresh = () => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.id === selected()))
  }
  refresh()
  return refresh
}

export function createGarage(initial: CarLook, handlers: GarageHandlers): GarageScreens {
  const look: CarLook = { ...initial }
  const settings: HeatSettings = { opponents: config.heat.defaultOpponents, level: 'local', damage: 'realistic' }
  const garage = byId<HTMLElement>('screen-garage')
  const results = byId<HTMLElement>('screen-results')
  const form = byId<HTMLFormElement>('garage-form')
  const numberInput = byId<HTMLInputElement>('number-input')
  const outline = byId<HTMLInputElement>('outline-check')
  const opponents = byId<HTMLInputElement>('opponents-range')
  const opponentsText = byId<HTMLElement>('opponents-text')
  const bestNote = byId<HTMLElement>('best-note')
  const parkNote = byId<HTMLElement>('park-note')

  const refreshers: (() => void)[] = []
  const changed = () => {
    for (const refresh of refreshers) refresh()
    handlers.onLook({ ...look })
  }
  refreshers.push(chipGroup(byId('body-chips'), config.bodies, () => look.body, (id) => {
    look.body = id as CarLook['body']
    changed()
  }))
  refreshers.push(swatchGroup(byId('paint-swatches'), config.paints, () => look.paint, (id) => {
    look.paint = id
    changed()
  }))
  refreshers.push(swatchGroup(byId('number-swatches'), config.numberColors, () => look.numberColor, (id) => {
    look.numberColor = id
    changed()
  }))
  refreshers.push(chipGroup(byId('font-chips'), config.fonts, () => look.font, (id) => {
    look.font = id as CarLook['font']
    changed()
  }))
  refreshers.push(chipGroup(byId('level-chips'), config.ai, () => settings.level, (id) => {
    settings.level = id
    for (const refresh of refreshers) refresh()
  }))
  refreshers.push(chipGroup(byId('damage-chips'), config.damagePresets, () => settings.damage, (id) => {
    settings.damage = id
    for (const refresh of refreshers) refresh()
  }))
  numberInput.value = look.number
  outline.checked = look.outline
  opponents.min = String(config.heat.minOpponents)
  opponents.max = String(config.heat.maxOpponents)
  opponents.value = String(settings.opponents)
  opponentsText.textContent = String(settings.opponents)

  const onNumber = () => {
    const next = cleanNumber(numberInput.value)
    if (numberInput.value !== next && document.activeElement !== numberInput) numberInput.value = next
    if (next !== look.number) {
      look.number = next
      changed()
    }
  }
  const onNumberBlur = () => {
    numberInput.value = cleanNumber(numberInput.value)
    onNumber()
  }
  const onOutline = () => {
    look.outline = outline.checked
    changed()
  }
  const onOpponents = () => {
    settings.opponents = Number(opponents.value)
    opponentsText.textContent = String(settings.opponents)
  }
  const onSubmit = (event: Event) => {
    event.preventDefault()
    numberInput.value = cleanNumber(numberInput.value)
    look.number = numberInput.value
    handlers.onStart({ ...look }, { ...settings })
  }
  numberInput.addEventListener('input', onNumber)
  numberInput.addEventListener('blur', onNumberBlur)
  outline.addEventListener('change', onOutline)
  opponents.addEventListener('input', onOpponents)
  form.addEventListener('submit', onSubmit)
  const again = byId<HTMLButtonElement>('again-button')
  const watch = byId<HTMLButtonElement>('watch-button')
  const back = byId<HTMLButtonElement>('garage-button')
  again.addEventListener('click', handlers.onAgain)
  watch.addEventListener('click', handlers.onWatch)
  back.addEventListener('click', handlers.onGarage)

  return {
    showGarage() {
      garage.hidden = false
      results.hidden = true
      numberInput.value = look.number
    },
    showResults(title, line, rows, eyebrow, canWatch) {
      byId('results-title').textContent = title
      byId('results-line').textContent = line
      byId('results-eyebrow').textContent = eyebrow
      const body = byId<HTMLTableSectionElement>('results-body')
      body.replaceChildren()
      for (const row of rows) {
        const tr = document.createElement('tr')
        if (row.isPlayer) tr.className = 'is-you'
        for (const cell of [String(row.place), row.label, String(row.hits), String(row.knockouts), row.points.toLocaleString()]) {
          const td = document.createElement('td')
          td.textContent = cell
          tr.appendChild(td)
        }
        body.appendChild(tr)
      }
      watch.hidden = !canWatch
      garage.hidden = true
      results.hidden = false
    },
    hideAll() {
      garage.hidden = true
      results.hidden = true
    },
    setBestNote(text) {
      bestNote.textContent = text
    },
    setParkNote(text) {
      parkNote.textContent = text
      parkNote.hidden = !text
    },
    dispose() {
      numberInput.removeEventListener('input', onNumber)
      numberInput.removeEventListener('blur', onNumberBlur)
      outline.removeEventListener('change', onOutline)
      opponents.removeEventListener('input', onOpponents)
      form.removeEventListener('submit', onSubmit)
      again.removeEventListener('click', handlers.onAgain)
      watch.removeEventListener('click', handlers.onWatch)
      back.removeEventListener('click', handlers.onGarage)
    },
  }
}
