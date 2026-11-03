/** Live HUD built on the engine Hud: hole, par, stroke and total; wind arrow and speed; club, lie, distance and spin; touch-friendly control buttons. */
import type { Hud } from '../../../engine'
import type { HudCopy } from '../config'

export interface HudModel {
  hole: string
  par: string
  stroke: string
  total: string
  windSpeed: string
  /** Wind direction relative to the camera view, in radians (0 blows straight away from the viewer). */
  windAngle: number
  club: string
  lie: string
  toPin: string
  spin: string
}

export interface HudActions {
  club(delta: number): void
  aim(delta: number): void
  spin(delta: number): void
  menu(): void
}

export interface HudView {
  update(model: HudModel): void
  setVisible(visible: boolean): void
  dispose(): void
}

export function createHudView(hud: Hud, copy: HudCopy, title: string, actions: HudActions): HudView {
  const status = hud.panel('top-left', title)
  const setHole = hud.stat(status, copy.hole)
  const setPar = hud.stat(status, copy.par)
  const setStroke = hud.stat(status, copy.stroke)
  const setTotal = hud.stat(status, copy.total)

  const windPanel = hud.panel('top-right', copy.wind)
  const windRow = document.createElement('div')
  windRow.className = 'tl-hud-stat'
  const arrow = document.createElement('span')
  arrow.className = 'fw-wind-arrow'
  arrow.textContent = copy.windArrow
  arrow.setAttribute('aria-hidden', 'true')
  const windText = document.createElement('b')
  windRow.append(arrow, windText)
  windPanel.appendChild(windRow)

  const shot = hud.panel('bottom-left')
  const setClub = hud.stat(shot, copy.club)
  const setLie = hud.stat(shot, copy.lie)
  const setPin = hud.stat(shot, copy.toPin)
  const setSpin = hud.stat(shot, copy.spin)
  const controls = document.createElement('div')
  controls.className = 'fw-controls'
  shot.appendChild(controls)
  const button = (label: string, name: string, run: () => void) => {
    const element = hud.button(controls, label, () => {
      run()
      element.blur()
    })
    element.setAttribute('aria-label', name)
  }
  const labels = copy.buttons
  button(labels.aimLeft[0], labels.aimLeft[1], () => actions.aim(1))
  button(labels.aimRight[0], labels.aimRight[1], () => actions.aim(-1))
  button(labels.clubDown[0], labels.clubDown[1], () => actions.club(1))
  button(labels.clubUp[0], labels.clubUp[1], () => actions.club(-1))
  button(labels.spinDown[0], labels.spinDown[1], () => actions.spin(-1))
  button(labels.spinUp[0], labels.spinUp[1], () => actions.spin(1))
  button(labels.menu[0], labels.menu[1], () => actions.menu())

  const hint = hud.panel('bottom-right')
  hint.textContent = copy.controlsHint
  hint.classList.add('fw-hint')

  let lastAngle = Number.NaN
  return {
    update(model) {
      setHole(model.hole)
      setPar(model.par)
      setStroke(model.stroke)
      setTotal(model.total)
      windText.textContent = model.windSpeed
      if (Math.abs(model.windAngle - lastAngle) > 0.01) {
        arrow.style.transform = `rotate(${model.windAngle}rad)`
        lastAngle = model.windAngle
      }
      setClub(model.club)
      setLie(model.lie)
      setPin(model.toPin)
      setSpin(model.spin)
    },
    setVisible(visible) {
      hud.setVisible(visible)
    },
    dispose() {
      hud.dispose()
    },
  }
}
