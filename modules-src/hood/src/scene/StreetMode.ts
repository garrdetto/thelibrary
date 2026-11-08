/** The neighborhood view: every house on the street as a closed shell, with who is home, and a card to visit or move in. */
import * as THREE from 'three/webgpu'
import { LOT_D, LOT_W, LOTS_PER_STREET, lotPlacement } from '../../shared/Street'
import type { StreetInfo, StreetLotInfo } from '../net/Api'
import { detach } from '../models/Kit'
import { buildForSaleSign, buildStreetGround, type StreetGround } from '../models/Street'
import { button, el } from '../ui/Ui'
import { LotModel } from './LotModel'
import type { PointerTarget, Stage } from './Stage'
import { TownView } from './TownView'
import { renderTownPanel, tickerText } from '../ui/TownPanel'
import type { PlaceId } from '../../shared/Town'

export interface StreetActions {
  visit(lot: number): void
  moveIn(lot: number): void
  practice(): void
  changeStreet(street: number): void
}

export function worldToLot(lot: number, wx: number, wz: number): [number, number] {
  const p = lotPlacement(lot)
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw)
  const dx = wx - p.x, dz = wz - p.z
  return [dx * c - dz * s, dx * s + dz * c]
}

export function lotAt(wx: number, wz: number): number | null {
  for (let lot = 0; lot < LOTS_PER_STREET; lot++) {
    const [x, z] = worldToLot(lot, wx, wz)
    if (x >= 0 && z >= 0 && x < LOT_W && z < LOT_D) return lot
  }
  return null
}

/** Builds the houses of a street (all but `skip`) as roofed shells, for either view. */
export function buildShells(info: StreetInfo, skip: number | null): { root: THREE.Group; models: Map<number, LotModel> } {
  const root = new THREE.Group()
  const models = new Map<number, LotModel>()
  for (const lot of info.lots) {
    if (lot.lot === skip) continue
    if (lot.shell) {
      const model = new LotModel(lot.lot, lot.shell)
      model.group.traverse(node => { node.userData.lot = lot.lot })
      root.add(model.group)
      models.set(lot.lot, model)
    } else {
      const sign = buildForSaleSign()
      const place = lotPlacement(lot.lot)
      const c = Math.cos(place.yaw), s = Math.sin(place.yaw)
      sign.position.set(place.x + 10 * c + 2 * s, 0, place.z - 10 * s + 2 * c)
      sign.rotation.y = place.yaw + Math.PI
      sign.traverse(node => { node.userData.lot = lot.lot })
      root.add(sign)
    }
  }
  return { root, models }
}

export class StreetMode implements PointerTarget {
  private readonly ground: StreetGround
  private readonly shells: { root: THREE.Group; models: Map<number, LotModel> }
  private readonly hud: HTMLDivElement
  private readonly labels: { lot: StreetLotInfo; node: HTMLElement; anchor: THREE.Vector3 }[] = []
  private card: HTMLElement | null = null
  private selected: number | null = null
  private readonly town: TownView
  private readonly ticker: HTMLElement
  private townSide: HTMLElement | null = null
  private unsubscribe: () => void

  constructor(private readonly stage: Stage, private readonly info: StreetInfo, private readonly actions: StreetActions) {
    this.ground = buildStreetGround()
    stage.app.graph.add('world', this.ground.group)
    this.shells = buildShells(info, null)
    stage.app.graph.add('props', this.shells.root)
    const hour = new Date().getHours() + new Date().getMinutes() / 60
    stage.setDaylight(hour)
    this.ground.setNight(stage.night)
    for (const model of this.shells.models.values()) {
      model.setView('up', stage.app.camera.position, true)
      const lot = info.lots[model.lot]
      model.house.setNight(stage.night, lot.home)
    }
    this.town = new TownView(stage, { street: info.street, houses: info.lots.map(l => !!l.shell), poll: true })
    stage.rig.bounds = { minX: -200, maxX: 200, minZ: -72, maxZ: 48 }
    stage.rig.maxDistance = 150
    stage.rig.jump(new THREE.Vector3(0, 0, 0), 0.25, 95, 0.95)

    const me = info.me
    const nav = el('div', { class: 'row' },
      button('‹', () => actions.changeStreet(info.street - 1), 'btn', 'Previous street'),
      button('›', () => actions.changeStreet(info.street + 1), 'btn', 'Next street'),
    )
    ;(nav.firstChild as HTMLButtonElement).disabled = info.street <= 0
    ;(nav.lastChild as HTMLButtonElement).disabled = info.street >= info.streets - 1 && info.lots.every(l => !l.owner)
    const status = me.home ? (me.home.street === info.street ? 'Your home is on this street.' : 'Your home is on another street.') : me.signedIn ? 'Pick an empty lot to move in.' : 'Sign in to the library to move in. You can still walk around and visit yards.'
    this.hud = el('div', { class: 'top' },
      el('div', { class: 'panel card' },
        el('div', { class: 'title' }, `The Hood · ${info.name}`),
        el('div', { class: 'sub' }, status),
      ),
      el('div', { class: 'panel card row' },
        nav,
        me.home && (me.home.street !== info.street) ? button('My street', () => actions.changeStreet(me.home!.street)) : null,
        me.home ? button('Go home', () => actions.visit(-1), 'btn primary') : null,
        button('Around town', () => this.toggleTown(), 'btn', 'The workplaces and the dispatch feed'),
        button('Practice lot', () => actions.practice(), 'btn', 'A starter house that runs only on this device'),
      ),
    )
    stage.ui.append(this.hud)
    this.ticker = el('div', { class: 'panel ticker', style: 'position:absolute;left:10px;bottom:10px;pointer-events:auto', role: 'status' })
    stage.ui.append(this.ticker)
    this.unsubscribe = this.town.onUpdate(state => {
      const text = tickerText(state)
      this.ticker.hidden = !text
      if (text) this.ticker.replaceChildren(text)
      if (this.townSide) renderTownPanel(this.townSide, state, place => this.focusPlace(place), () => this.toggleTown())
    })
    for (const lot of info.lots) {
      const label = el('div', { class: `label lotlabel${lot.mine ? ' mine' : ''}${lot.owner ? '' : ' sale'}` },
        lot.owner ? el('span', { class: lot.home ? 'home' : 'away' }) : null,
        el('b', {}, lot.owner ? lot.owner : 'For sale'),
        el('br'),
        el('span', { class: 'sub' }, `${lot.address}${lot.visitors ? ` · ${lot.visitors} visiting` : ''}`),
      )
      label.addEventListener('click', () => this.select(lot.lot))
      stage.labels.append(label)
      const place = lotPlacement(lot.lot)
      const c = Math.cos(place.yaw), s = Math.sin(place.yaw)
      this.labels.push({ lot, node: label, anchor: new THREE.Vector3(place.x + 10 * c + 10 * s, 4.2, place.z - 10 * s + 10 * c) })
    }
    stage.target = this
  }

  private toggleTown(): void {
    if (this.townSide) { this.townSide.remove(); this.townSide = null; return }
    this.closeCard()
    this.townSide = el('div', { class: 'panel side', role: 'dialog', 'aria-label': 'Around town' })
    this.stage.ui.append(this.townSide)
    if (this.town.state) renderTownPanel(this.townSide, this.town.state, place => this.focusPlace(place), () => this.toggleTown())
  }

  private focusPlace(place: PlaceId): void {
    this.stage.rig.focus(this.town.focusPoint(place))
  }

  click(ndc: THREE.Vector2): void {
    const picked = this.town.pick(ndc)
    if (picked) {
      this.closeCard()
      this.card = el('div', { class: 'panel side', role: 'dialog', 'aria-label': picked.title },
        el('div', { class: 'title' }, picked.title),
        el('p', {}, picked.text),
        el('div', { class: 'row' }, button('Close', () => this.closeCard())),
      )
      this.stage.ui.append(this.card)
      return
    }
    const hit = this.stage.pick(ndc, [this.shells.root])
    let lot = hit ? (hit.object.userData.lot as number | undefined) ?? null : null
    if (lot === null) {
      const point = this.stage.groundPoint(ndc)
      lot = point ? lotAt(point.x, point.z) : null
    }
    if (lot === null) { this.closeCard(); return }
    this.select(lot)
  }

  private select(index: number): void {
    const lot = this.info.lots[index]
    this.closeCard()
    this.selected = index
    if (this.townSide) { this.townSide.remove(); this.townSide = null }
    const me = this.info.me
    const atHome = me.home && me.home.street === this.info.street && me.home.lot === index
    const actions: HTMLElement[] = []
    if (lot.owner) {
      if (atHome) actions.push(button('Go home', () => this.actions.visit(index), 'btn primary'))
      else actions.push(button(lot.home ? 'Walk over' : 'Visit the yard', () => this.actions.visit(index), 'btn primary'))
    } else if (me.signedIn && !me.home) actions.push(button('Move in here', () => this.actions.moveIn(index), 'btn primary'))
    const text = lot.owner
      ? atHome ? 'This is your home.' : lot.home ? `${lot.owner} is home. Walk into the yard, then knock to be let in.` : `${lot.owner} is out. You can still hang out in the yard.`
      : me.home ? 'This lot is for sale.' : me.signedIn ? 'This lot is for sale. Move in to get a starter house and $20,000.' : 'This lot is for sale. Sign in to the library to move in.'
    this.card = el('div', { class: 'panel side', role: 'dialog', 'aria-label': lot.address },
      el('div', { class: 'title' }, lot.address),
      el('div', { class: 'sub' }, lot.owner ? `Home of ${lot.owner}` : 'Empty lot'),
      el('p', {}, text),
      el('div', { class: 'row' }, ...actions, button('Close', () => this.closeCard())),
    )
    this.stage.ui.append(this.card)
    const place = lotPlacement(index)
    const c = Math.cos(place.yaw), s = Math.sin(place.yaw)
    this.stage.rig.focus(new THREE.Vector3(place.x + 10 * c + 10 * s, 0, place.z - 10 * s + 10 * c))
  }

  private closeCard(): void {
    this.card?.remove()
    this.card = null
    this.selected = null
  }

  update(dt = 0): void {
    this.town.setNight(this.stage.night)
    this.town.update(dt)
    for (const { node, anchor, lot } of this.labels) {
      const at = this.stage.project(anchor)
      if (!at) { node.style.display = 'none'; continue }
      node.style.display = ''
      node.style.left = `${at.x}px`
      node.style.top = `${at.y}px`
      node.style.zIndex = this.selected === lot.lot ? '2' : '1'
    }
    this.stage.follow(this.stage.rig.target)
  }

  dispose(): void {
    if (this.stage.target === this) this.stage.target = null
    this.closeCard()
    this.unsubscribe()
    this.townSide?.remove()
    this.ticker.remove()
    this.town.dispose()
    this.hud.remove()
    for (const { node } of this.labels) node.remove()
    for (const model of this.shells.models.values()) model.dispose()
    detach(this.shells.root)
    detach(this.ground.group)
  }
}
