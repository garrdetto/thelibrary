/** Game flow: the lake picker, entering a lake, the HUD and the keyboard shortcuts. */
import { now } from '../shared/Clock'
import { World } from './World'
import { LakeMap } from '../ui/LakeMap'
import { LAKES, depthFeetAt, lakeIds, waterTempF } from '../shared/Lakes'
import type { LakeId } from '../shared/Lakes'
import { centralTime, moonPhase, moonPhaseName } from '../shared/Astro'
import { windCompass } from '../shared/Weather'
import { toMph } from '../systems/BoatPhysics'
import { DriveInput } from '../systems/Input'
import type { QualityTier } from '../config'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

export class Game {
  readonly world: World
  readonly map = new LakeMap()
  readonly input: DriveInput
  private hudTimer = 0

  constructor(canvas: HTMLCanvasElement, quality: QualityTier) {
    this.world = new World(canvas, quality)
    this.input = new DriveInput($('stick'))
    this.input.onKey = code => this.key(code)
  }

  async start(): Promise<void> {
    const status = $('loading-text')
    await this.world.load(text => { status.textContent = text })
    $('loading').hidden = true
    this.world.onFrame(dt => this.frame(dt))
    this.bindUi()
    this.showLakes()
  }

  private bindUi(): void {
    $('btn-anchor').addEventListener('click', () => this.toggleAnchor())
    $('btn-map').addEventListener('click', () => this.toggleMap())
    $('btn-lakes').addEventListener('click', () => this.showLakes())
    $('btn-troll').addEventListener('click', () => { this.world.controls.trolling = !this.world.controls.trolling; this.refreshButtons() })
    $('map-close').addEventListener('click', () => this.toggleMap(false))
    const big = $<HTMLCanvasElement>('map-canvas')
    big.addEventListener('click', e => {
      const r = big.getBoundingClientRect()
      const [x, z] = this.map.toWorld(((e.clientX - r.left) / r.width) * big.width, ((e.clientY - r.top) / r.height) * big.height, big.width)
      this.map.pin = this.world.lake && depthFeetAt(this.world.lake, x, z) > 2 ? { x, z } : null
    })
  }

  private key(code: string): void {
    if (code === 'Space') this.toggleAnchor()
    if (code === 'KeyM') this.toggleMap()
    if (code === 'KeyT') { this.world.controls.trolling = !this.world.controls.trolling; this.refreshButtons() }
    if (code === 'Escape') this.toggleMap(false)
  }

  toggleAnchor(): void {
    if (!this.world.physics) return
    this.world.anchored = !this.world.anchored
    this.refreshButtons()
  }

  private refreshButtons(): void {
    $('btn-anchor').setAttribute('aria-pressed', String(this.world.anchored))
    $('btn-anchor').textContent = this.world.anchored ? 'Pull anchor' : 'Drop anchor'
    $('btn-troll').setAttribute('aria-pressed', String(this.world.controls.trolling))
  }

  toggleMap(force?: boolean): void {
    const panel = $('map-panel')
    panel.hidden = force === undefined ? !panel.hidden : !force
  }

  showLakes(): void {
    const list = $('lake-list')
    list.innerHTML = ''
    for (const id of lakeIds) {
      const lake = LAKES[id]
      const button = document.createElement('button')
      button.className = 'ang-lake'
      button.type = 'button'
      button.innerHTML = `<strong>${lake.name}</strong><span>${lake.type} · ${lake.acres.toLocaleString()} acres · ${lake.maxDepth} ft deep</span><em>${lake.blurb}</em>`
      button.addEventListener('click', () => void this.enter(id))
      list.appendChild(button)
    }
    $('screen-lakes').hidden = false
  }

  async enter(id: LakeId): Promise<void> {
    $('screen-lakes').hidden = true
    $('loading').hidden = false
    $('loading-text').textContent = `Launching at ${LAKES[id].name}`
    await new Promise(r => setTimeout(r, 30))
    await this.world.enterLake(id, 'bass')
    this.map.setLake(LAKES[id])
    $('loading').hidden = true
    $('hud').hidden = false
    $('lake-name').textContent = LAKES[id].name
    this.refreshButtons()
  }

  private frame(dt: number): void {
    this.input.update(dt)
    this.world.controls.throttle = this.input.throttle
    this.world.controls.steer = this.input.steer
    if (this.input.active && this.world.anchored) { this.world.anchored = false; this.refreshButtons() }
    this.hudTimer += dt
    if (this.hudTimer > 0.2) {
      this.hudTimer = 0
      this.updateHud()
    }
  }

  private updateHud(): void {
    const w = this.world
    if (!w.lake || !w.physics) return
    const s = w.physics.state
    const date = now()
    const ct = centralTime(date)
    const depth = depthFeetAt(w.lake, s.x, s.z)
    $('stat-speed').textContent = `${Math.abs(toMph(s.speed)).toFixed(0)} mph`
    $('stat-depth').textContent = `${depth.toFixed(1)} ft`
    $('stat-temp').textContent = `${Math.round(waterTempF(w.lake, date, 0))}°F water`
    const hour12 = ((ct.hour + 11) % 12) + 1
    $('stat-time').textContent = `${hour12}:${String(ct.minute).padStart(2, '0')} ${ct.hour < 12 ? 'am' : 'pm'} CT`
    if (w.weather) $('stat-weather').textContent = `${w.weather.label} · ${w.weather.airTempF}°F · wind ${windCompass(w.weather.windDir)} ${Math.round(w.weather.windMph)} mph · ${moonPhaseName(moonPhase(date))}`
    const mini = $<HTMLCanvasElement>('minimap')
    this.map.draw(mini, [{ x: s.x, z: s.z, heading: s.heading, you: true }], false)
    if (!$('map-panel').hidden) this.map.draw($<HTMLCanvasElement>('map-canvas'), [{ x: s.x, z: s.z, heading: s.heading, you: true }])
  }
}
