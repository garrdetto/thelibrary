/** Live HUD built on the engine Hud: a hole card (number badge, name, par, stroke, total, length), a wind compass, and the shot dock along the bottom with the club and bag, lie and distance, shot-type picker, spin ball with its vertical meter, planned power bar, aim buttons and a controls help popover. */
import type { Hud } from '../../../engine'
import type { HudCopy, SpinDialLook, WindDialLook } from '../config'
import { SHOT_KINDS, type ClubId, type ClubSpec, type LieKind, type ShotKind } from '../tuning'
import { clubIcon, lieSwatch, shotIcon } from './Icons'
import { createSpinDial } from './SpinDial'
import { createWindDial } from './WindDial'

export interface HudModel {
  holeNumber: string
  holeName: string
  par: string
  stroke: string
  total: string
  holeLength: string
  windSpeed: string
  /** Wind direction relative to the camera view, in radians (0 blows straight away from the viewer). */
  windAngle: number
  /** Wind strength as a fraction of the strongest wind. */
  windStrength: number
  club: ClubId | null
  clubName: string
  clubDetail: string
  lie: LieKind
  lieLabel: string
  toPin: string
  /** Spin setting in [−1, 1] (positive backspin) and its readout. */
  spin: number
  spinLabel: string
  spinDetail: string
  /** The selected shot type, or null when no choice applies (putting, or someone else's turn). */
  shotKind: ShotKind | null
  shotHint: string
  /** Planned power in [0, 1], or null when it is not the local player's shot. */
  power: number | null
  powerLabel: string
  distanceLabel: string
  /** True while the local player is aiming, so the setup can be changed. */
  editable: boolean
  putting: boolean
}

export interface HudActions {
  club(delta: number): void
  selectClub(club: ClubId): void
  aim(delta: number): void
  spin(delta: number): void
  setSpin(value: number): void
  power(delta: number): void
  shot(kind: ShotKind): void
  menu(): void
}

export interface HudView {
  update(model: HudModel, time: number): void
  setVisible(visible: boolean): void
  dispose(): void
}

export interface HudLooks {
  spinDial: SpinDialLook
  windDial: WindDialLook
  spinStep: number
  clubs: readonly ClubSpec[]
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  parent?.appendChild(node)
  return node
}

export function createHudView(hud: Hud, copy: HudCopy, looks: HudLooks, actions: HudActions): HudView {
  const card = hud.panel('top-left')
  card.classList.add('fw-hole-card')
  const badge = element('div', 'fw-hole-badge', card)
  const badgeLabel = element('span', '', badge)
  badgeLabel.textContent = copy.hole
  const badgeNumber = element('b', '', badge)
  const cardBody = element('div', 'fw-hole-body', card)
  const holeName = element('div', 'fw-hole-name', cardBody)
  const holeLength = element('div', 'fw-hole-length', cardBody)
  const chips = element('div', 'fw-hole-chips', cardBody)
  const chip = (label: string) => {
    const box = element('div', 'fw-chip', chips)
    element('span', '', box).textContent = label
    return element('b', '', box)
  }
  const parValue = chip(copy.par)
  const strokeValue = chip(copy.stroke)
  const totalValue = chip(copy.total)

  const windPanel = hud.panel('top-right')
  windPanel.classList.add('fw-wind-panel')
  const windDial = createWindDial(looks.windDial)
  windPanel.appendChild(windDial.element)
  const windText = element('div', 'fw-wind-text', windPanel)
  element('span', '', windText).textContent = copy.wind
  const windSpeed = element('b', '', windText)

  const dock = hud.panel('bottom-left')
  dock.classList.add('fw-dock')

  const clubSection = element('section', 'fw-dock-section fw-dock-club', dock)
  element('h3', 'fw-dock-title', clubSection).textContent = copy.club
  const clubRow = element('div', 'fw-club-row', clubSection)
  const button = (parent: HTMLElement, label: string, name: string, run: () => void, extra = '') => {
    const node = hud.button(parent, label, () => {
      run()
      node.blur()
    })
    node.setAttribute('aria-label', name)
    if (extra) node.classList.add(extra)
    return node
  }
  const labels = copy.buttons
  const clubDown = button(clubRow, '‹', labels.clubDown[1], () => actions.club(1), 'fw-step')
  const clubFace = element('div', 'fw-club-face', clubRow)
  const clubIconBox = element('div', 'fw-club-icon', clubFace)
  const clubText = element('div', 'fw-club-text', clubFace)
  const clubName = element('b', '', clubText)
  const clubDetail = element('span', '', clubText)
  const clubUp = button(clubRow, '›', labels.clubUp[1], () => actions.club(-1), 'fw-step')
  const bag = element('div', 'fw-bag', clubSection)
  bag.setAttribute('role', 'group')
  bag.setAttribute('aria-label', copy.bag)
  const bagButtons = new Map<ClubId, HTMLButtonElement>()
  for (const club of looks.clubs) {
    const node = hud.button(bag, '', () => {
      actions.selectClub(club.id)
      node.blur()
    })
    node.classList.add('fw-bag-club')
    node.innerHTML = `${clubIcon(club.id, 18)}<span>${club.short}</span>`
    node.title = club.name
    node.setAttribute('aria-label', club.name)
    node.setAttribute('aria-pressed', 'false')
    bagButtons.set(club.id, node)
  }

  const lieRow = element('div', 'fw-lie-row', clubSection)
  const lieIcon = element('span', 'fw-lie-icon', lieRow)
  lieIcon.title = copy.lie
  const lieLabel = element('b', '', lieRow)
  element('span', 'fw-lie-sep', lieRow).textContent = copy.toPin
  const toPin = element('b', 'fw-to-pin', lieRow)

  const shotSection = element('section', 'fw-dock-section fw-dock-shot', dock)
  element('h3', 'fw-dock-title', shotSection).textContent = copy.shot
  const picker = element('div', 'fw-shot-picker', shotSection)
  picker.setAttribute('role', 'group')
  picker.setAttribute('aria-label', copy.shot)
  const shotButtons = new Map<ShotKind, HTMLButtonElement>()
  SHOT_KINDS.forEach((kind, index) => {
    const node = hud.button(picker, '', () => {
      actions.shot(kind)
      node.blur()
    })
    node.classList.add('fw-shot-button')
    node.innerHTML = `${shotIcon(kind, 30)}<span><kbd>${index + 1}</kbd>${copy.shotNames[kind]}</span>`
    node.title = copy.shotHints[kind]
    node.setAttribute('aria-pressed', 'false')
    shotButtons.set(kind, node)
  })
  const shotHint = element('div', 'fw-shot-hint', shotSection)

  const spinSection = element('section', 'fw-dock-section fw-dock-spin', dock)
  element('h3', 'fw-dock-title', spinSection).textContent = copy.spin
  const spinBody = element('div', 'fw-spin-body', spinSection)
  const spinDial = createSpinDial(looks.spinDial, looks.spinStep, (value) => actions.setSpin(value))
  spinBody.appendChild(spinDial.element)
  const spinSide = element('div', 'fw-spin-side', spinBody)
  const spinUp = button(spinSide, '▲', labels.spinUp[1], () => actions.spin(1), 'fw-step')
  const spinLabel = element('b', 'fw-spin-label', spinSide)
  const spinDetail = element('span', 'fw-spin-detail', spinSide)
  const spinDown = button(spinSide, '▼', labels.spinDown[1], () => actions.spin(-1), 'fw-step')

  const powerSection = element('section', 'fw-dock-section fw-dock-power', dock)
  element('h3', 'fw-dock-title', powerSection).textContent = copy.power
  const powerValue = element('b', 'fw-power-value', powerSection)
  const bar = element('div', 'fw-power-bar', powerSection)
  const fill = element('div', 'fw-power-fill', bar)
  for (const mark of [0.25, 0.5, 0.75]) element('i', 'fw-power-mark', bar).style.left = `${mark * 100}%`
  const distance = element('div', 'fw-power-distance', powerSection)
  const powerRow = element('div', 'fw-power-row', powerSection)
  const powerDown = button(powerRow, labels.powerDown[0], labels.powerDown[1], () => actions.power(-1), 'fw-step')
  const powerUp = button(powerRow, labels.powerUp[0], labels.powerUp[1], () => actions.power(1), 'fw-step')
  element('span', 'fw-row-gap', powerRow)
  const aimLeft = button(powerRow, labels.aimLeft[0], labels.aimLeft[1], () => actions.aim(1), 'fw-step')
  const aimRight = button(powerRow, labels.aimRight[0], labels.aimRight[1], () => actions.aim(-1), 'fw-step')
  const utilRow = powerRow
  const help = element('details', 'fw-help', utilRow)
  const helpSummary = element('summary', 'tl-hud-button fw-step', help)
  helpSummary.textContent = '?'
  helpSummary.setAttribute('aria-label', copy.helpLabel)
  element('div', 'fw-help-text', help).textContent = copy.controlsHint
  button(utilRow, labels.menu[0], labels.menu[1], () => actions.menu(), 'fw-step')

  const editables: HTMLButtonElement[] = [clubDown, clubUp, spinUp, spinDown, powerDown, powerUp, aimLeft, aimRight]
  let last: Partial<Record<keyof HudModel, unknown>> = {}
  const changed = (model: HudModel, ...keys: (keyof HudModel)[]) => {
    const differs = keys.some((key) => last[key] !== model[key])
    return differs
  }

  return {
    update(model, time) {
      if (changed(model, 'holeNumber', 'holeName', 'holeLength', 'par', 'stroke', 'total')) {
        badgeNumber.textContent = model.holeNumber
        holeName.textContent = model.holeName
        holeLength.textContent = model.holeLength
        parValue.textContent = model.par
        strokeValue.textContent = model.stroke
        totalValue.textContent = model.total
      }
      windDial.draw(model.windAngle, model.windStrength)
      if (changed(model, 'windSpeed')) windSpeed.textContent = model.windSpeed
      if (changed(model, 'club', 'clubName', 'clubDetail', 'editable', 'putting')) {
        clubIconBox.innerHTML = model.club ? clubIcon(model.club, 40) : ''
        clubName.textContent = model.clubName
        clubDetail.textContent = model.clubDetail
        for (const [id, node] of bagButtons) {
          node.setAttribute('aria-pressed', String(id === model.club))
          node.disabled = !model.editable || (model.putting && id !== 'putter')
        }
        for (const node of editables) node.disabled = !model.editable
        clubDown.disabled = clubUp.disabled = !model.editable || model.putting
      }
      if (changed(model, 'lie', 'lieLabel')) {
        lieIcon.innerHTML = lieSwatch(model.lie, 22)
        lieLabel.textContent = model.lieLabel
      }
      if (changed(model, 'toPin')) toPin.textContent = model.toPin
      if (changed(model, 'shotKind', 'shotHint', 'editable')) {
        shotSection.hidden = model.shotKind === null
        for (const [kind, node] of shotButtons) {
          node.setAttribute('aria-pressed', String(kind === model.shotKind))
          node.disabled = !model.editable
        }
        shotHint.textContent = model.shotHint
      }
      spinDial.draw(model.spin, model.editable && !model.putting, time)
      if (changed(model, 'spinLabel', 'spinDetail', 'spin', 'putting')) {
        spinSection.hidden = model.putting
        spinLabel.textContent = model.spinLabel
        spinDetail.textContent = model.spinDetail
        spinSection.dataset.spin = model.spin > 0 ? 'back' : model.spin < 0 ? 'top' : 'none'
      }
      if (changed(model, 'power', 'powerLabel', 'distanceLabel')) {
        powerSection.hidden = model.power === null
        fill.style.width = `${Math.round((model.power ?? 0) * 100)}%`
        powerValue.textContent = model.powerLabel
        distance.textContent = model.distanceLabel
      }
      last = { ...model }
    },
    setVisible(visible) {
      hud.setVisible(visible)
    },
    dispose() {
      spinDial.dispose()
      hud.dispose()
    },
  }
}
