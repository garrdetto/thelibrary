/** Game flow: profile, lake picker, entering a lake, anchoring and fishing, the HUD, catch cards, record book and keyboard shortcuts. */
import { now } from '../shared/Clock'
import { World } from './World'
import { Fishing } from './Fishing'
import { LocalAuthority, ServerAuthority, api } from './Authority'
import type { Authority, BiteResult, Progress, TickResult } from './Authority'
import { LakeMap } from '../ui/LakeMap'
import { Sonar } from '../ui/Sonar'
import { RecordBook } from '../ui/RecordBook'
import { LAKES, depthFeetAt, lakeIds, nearestSpot, waterTempF } from '../shared/Lakes'
import type { LakeId } from '../shared/Lakes'
import { centralTime, moonPhase, moonPhaseName } from '../shared/Astro'
import { windCompass } from '../shared/Weather'
import { outlook } from '../shared/Catch'
import { PRESENTATIONS, RODS } from '../shared/Gear'
import type { Rig, RodId } from '../shared/Gear'
import { SPECIES, formatLength, formatWeight } from '../shared/Species'
import type { Presentation } from '../shared/Species'
import { defaultProfile, lakeOpen, normalizeProfile } from '../shared/Profile'
import type { AnglerProfile } from '../shared/Profile'
import { anglerTitle, TIER_NAMES } from '../shared/Achievements'
import type { Unlock } from '../shared/Achievements'
import { MOTORS } from '../shared/Shop'
import { toMph } from '../systems/BoatPhysics'
import { DriveInput } from '../systems/Input'
import type { QualityTier } from '../config'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

export interface Account {
  signedIn: boolean
  username: string
  isAdmin: boolean
}

export class Game {
  readonly world: World
  readonly map = new LakeMap()
  readonly input: DriveInput
  fishing: Fishing | null = null
  profile: AnglerProfile = defaultProfile()
  account: Account = { signedIn: false, username: '', isAdmin: false }
  authority: Authority = new LocalAuthority()
  private sonar: Sonar
  readonly records = new RecordBook()
  private hudTimer = 0
  private stillTime = 0
  private progressSeconds = 0
  private progressOdometer = 0
  private log: BiteResult[] = []
  private cardTimer = 0

  constructor(canvas: HTMLCanvasElement, quality: QualityTier) {
    this.world = new World(canvas, quality)
    this.input = new DriveInput($('stick'))
    this.input.onKey = code => this.key(code)
    this.sonar = new Sonar($<HTMLCanvasElement>('sonar'))
  }

  async start(): Promise<void> {
    const status = $('loading-text')
    await this.world.load(text => { status.textContent = text })
    await this.loadAccount()
    this.fishing = new Fishing(this.world, this.authority, {
      onBite: r => this.onBite(r),
      onLanded: r => this.onLanded(r),
      onLost: r => this.onLost(r),
      onMissed: () => this.toast('Missed a bite. Re-baiting.', 'soft'),
      onTick: t => this.onTick(t),
      onError: message => this.toast(message, 'warn'),
      progress: () => this.takeProgress(),
      crowd: () => this.crowd(),
    })
    $('loading').hidden = true
    this.world.onFrame(dt => this.frame(dt))
    this.bindUi()
    this.showLakes()
  }

  crowd(): number {
    return 0
  }

  private async loadAccount(): Promise<void> {
    try {
      const response = await fetch('/api/angler', { credentials: 'same-origin' })
      const data = await response.json() as { signedIn: boolean; username?: string; isAdmin?: boolean; profile?: unknown }
      if (data.signedIn && data.profile) {
        this.account = { signedIn: true, username: data.username ?? '', isAdmin: Boolean(data.isAdmin) }
        this.profile = normalizeProfile(data.profile)
        this.authority = new ServerAuthority()
      }
    } catch {
      this.account = { signedIn: false, username: '', isAdmin: false }
    }
    if (!this.account.signedIn) this.profile = (this.authority as LocalAuthority).profile
    $('guest-note').hidden = this.account.signedIn
    this.refreshProfile()
  }

  private bindUi(): void {
    $('btn-anchor').addEventListener('click', () => this.toggleAnchor())
    $('btn-map').addEventListener('click', () => this.toggleMap())
    $('btn-lakes').addEventListener('click', () => this.showLakes())
    $('btn-records').addEventListener('click', () => this.records.open(this.world.lake?.id ?? 'all'))
    $('btn-troll').addEventListener('click', () => { this.world.controls.trolling = !this.world.controls.trolling; this.refreshButtons() })
    $('map-close').addEventListener('click', () => this.toggleMap(false))
    $('catch-close').addEventListener('click', () => { $('catch-card').hidden = true })
    $('rig-rod').addEventListener('change', () => this.changeRig())
    $('rig-bait').addEventListener('change', () => this.changeRig(true))
    $('lakes-close').addEventListener('click', () => { if (this.world.lake) $('screen-lakes').hidden = true })
    const big = $<HTMLCanvasElement>('map-canvas')
    big.addEventListener('click', e => {
      const r = big.getBoundingClientRect()
      const [x, z] = this.map.toWorld(((e.clientX - r.left) / r.width) * big.width, ((e.clientY - r.top) / r.height) * big.height, big.width)
      this.map.pin = this.world.lake && depthFeetAt(this.world.lake, x, z) > 2 ? { x, z } : null
      this.world.autopilot = this.map.pin
      if (this.map.pin) {
        this.toast('Heading for your pin. Steer or throttle to take over.', 'soft')
        this.toggleMap(false)
        this.stopFishing()
      }
    })
    document.addEventListener('visibilitychange', () => {
      this.world.setBackground(document.hidden)
      if (!document.hidden && this.away.length) {
        const best = [...this.away].sort((a, b) => b.percentile - a.percentile)[0]
        this.toast(`While you were away: ${this.away.length} fish landed. Best: ${formatWeight(best.weight)} ${SPECIES[best.species].name.toLowerCase()} (${best.tier}).`, 'gold', 9)
        this.away = []
      }
    })
  }

  private key(code: string): void {
    if ((document.activeElement as HTMLElement | null)?.closest?.('select, input')) return
    if (code === 'Space') this.toggleAnchor()
    if (code === 'KeyM') this.toggleMap()
    if (code === 'KeyR') this.records.open(this.world.lake?.id ?? 'all')
    if (code === 'KeyT') { this.world.controls.trolling = !this.world.controls.trolling; this.refreshButtons() }
    if (code === 'Escape') { this.toggleMap(false); this.records.close(); $('catch-card').hidden = true }
  }

  toggleAnchor(): void {
    if (!this.world.physics || !this.world.lake) return
    if (this.world.anchored) { this.stopFishing(); return }
    const s = this.world.physics.state
    if (Math.abs(s.speed) > 3) { this.toast('Slow down before dropping anchor.', 'warn'); return }
    if (depthFeetAt(this.world.lake, s.x, s.z) < 1.5) { this.toast('Too shallow to fish here.', 'warn'); return }
    this.world.anchored = true
    this.world.autopilot = null
    this.refreshButtons()
    void this.fishing?.begin(this.profile.rig)
  }

  stopFishing(): void {
    if (!this.world.anchored) return
    this.world.anchored = false
    this.fishing?.end()
    this.world.focusOnPlayer(false)
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
      const open = lakeOpen(this.profile, id)
      const button = document.createElement('button')
      button.className = 'ang-lake'
      button.type = 'button'
      button.disabled = !open
      button.innerHTML = `<strong>${lake.name}</strong><span>${lake.type} · ${lake.acres.toLocaleString()} acres · ${lake.maxDepth} ft deep</span><em>${lake.blurb}</em>${open ? '' : `<b>Opens after ${lake.opensAt} landed fish (${this.profile.stats.landed} so far)</b>`}`
      button.addEventListener('click', () => void this.enter(id))
      list.appendChild(button)
    }
    $('lakes-close').hidden = !this.world.lake
    $('screen-lakes').hidden = false
  }

  async enter(id: LakeId): Promise<void> {
    this.stopFishing()
    $('screen-lakes').hidden = true
    $('loading').hidden = false
    $('loading-text').textContent = `Launching at ${LAKES[id].name}`
    await new Promise(r => setTimeout(r, 30))
    const p = this.profile
    await this.world.enterLake(id, p.boat, p.paint[p.boat], p.look)
    if (this.world.physics) this.world.physics.motorBoost = MOTORS[p.motor].boost
    this.progressOdometer = this.world.physics?.state.odometer ?? 0
    this.map.setLake(LAKES[id])
    this.map.pin = null
    $('loading').hidden = true
    $('hud').hidden = false
    $('lake-name').textContent = LAKES[id].name
    this.sonar.level = p.sonar
    this.refreshButtons()
    this.fillRig()
  }

  fillRig(): void {
    const rod = $<HTMLSelectElement>('rig-rod'), bait = $<HTMLSelectElement>('rig-bait')
    rod.innerHTML = this.profile.rods.map(id => `<option value="${id}">${RODS[id].name} · ${RODS[id].lineTest} lb</option>`).join('')
    rod.value = this.profile.rig.rod
    bait.innerHTML = RODS[this.profile.rig.rod].presentations.map(id => `<option value="${id}">${PRESENTATIONS[id].short}</option>`).join('')
    bait.value = this.profile.rig.presentation
  }

  private changeRig(baitOnly = false): void {
    const rod = $<HTMLSelectElement>('rig-rod').value as RodId
    const presentations = RODS[rod].presentations
    const wanted = $<HTMLSelectElement>('rig-bait').value as Presentation
    const rig: Rig = { rod, presentation: baitOnly && presentations.includes(wanted) ? wanted : presentations[0] }
    this.profile.rig = rig
    this.fillRig()
    if (this.account.signedIn) void api({ action: 'equip', patch: { rig } }).catch(() => undefined)
    if (this.world.anchored) {
      this.fishing?.end()
      this.world.anchored = true
      void this.fishing?.begin(rig)
    }
  }

  private takeProgress(): Progress {
    const seconds = Math.round(this.progressSeconds)
    this.progressSeconds -= seconds
    const odo = this.world.physics?.state.odometer ?? 0
    const miles = Math.max(0, odo - this.progressOdometer) / 1609.34
    this.progressOdometer = odo
    return { seconds, miles: Math.round(miles * 1000) / 1000 }
  }

  private onBite(r: BiteResult): void {
    if (r.kind !== 'missed') this.toast(r.weight > 15 ? 'Fish on! Something heavy…' : 'Fish on!', 'good')
    this.world.focusOnPlayer(true)
  }

  private onLost(r: BiteResult): void {
    const s = SPECIES[r.species]
    this.toast(`Snapped off! It looked like a ${s.name.toLowerCase()}, ${formatWeight(r.weight * 0.85)} to ${formatWeight(r.weight * 1.15)}.`, 'warn', 6)
    this.pushLog(r)
    this.world.focusOnPlayer(false)
  }

  private away: BiteResult[] = []

  private onLanded(r: BiteResult): void {
    if (this.world.background) this.away.push(r)
    this.pushLog(r)
    this.showCard(r)
    try { window.parent?.postMessage({ type: 'tl-angler', species: r.species }, location.origin) } catch { /* not embedded */ }
    if (document.hidden && ['Trophy', 'Legendary'].includes(r.tier)) this.flashTitle(`${r.tier}! ${formatWeight(r.weight)} ${SPECIES[r.species].name}`)
    setTimeout(() => this.world.focusOnPlayer(false), 9000)
  }

  private onTick(t: TickResult): void {
    if (t.profile) { this.profile = normalizeProfile(t.profile); this.refreshProfile() }
    for (const u of t.unlocked ?? []) this.announce(u)
  }

  announce(u: Unlock): void {
    this.toast(`Achievement: ${u.name} (${TIER_NAMES[u.tier - 1]}) · ${u.text} · +${u.reward.toLocaleString()} TC`, 'gold', 7)
  }

  private pushLog(r: BiteResult): void {
    this.log.unshift(r)
    this.log = this.log.slice(0, 6)
    $('catch-log').innerHTML = this.log.map(c => `<li class="tier-${c.tier.toLowerCase()}${c.kind === 'lost' ? ' is-lost' : ''}"><strong>${SPECIES[c.species].name}</strong><span>${c.kind === 'lost' ? 'lost' : formatWeight(c.weight)}</span></li>`).join('')
    $('catch-log').hidden = false
  }

  private showCard(r: BiteResult): void {
    const s = SPECIES[r.species]
    const ct = centralTime(now())
    const w = this.world
    const banner = r.siteRecord ? 'New site record!' : r.personalBest ? 'Personal best!' : ''
    $('card-tier').textContent = r.tier
    $('card-tier').className = `card-tier tier-${r.tier.toLowerCase()}`
    $('card-species').textContent = s.name
    $('card-latin').textContent = s.latin
    $('card-weight').textContent = formatWeight(r.weight)
    $('card-length').textContent = formatLength(r.length)
    $('card-banner').textContent = banner
    $('card-banner').hidden = !banner
    let spot = ''
    if (w.lake && w.physics) {
      const n = nearestSpot(w.lake, w.physics.state.x, w.physics.state.z)
      spot = n.distance < 160 ? n.spot.name : 'Open water'
    }
    const hour12 = ((ct.hour + 11) % 12) + 1
    const top = Math.max(0.01, (1 - r.percentile) * 100)
    $('card-meta').textContent = `${w.lake?.name ?? ''} · ${spot} · ${hour12}:${String(ct.minute).padStart(2, '0')} ${ct.hour < 12 ? 'am' : 'pm'} · ${PRESENTATIONS[this.profile.rig.presentation].short} · bigger than ${(100 - top).toFixed(top < 1 ? 2 : 0)}% of ${s.name.toLowerCase()}`
    $('card-credits').textContent = this.authority.saved ? `+${(r.credits + r.daily).toLocaleString()} TC${r.daily ? ' (includes the daily bonus)' : ''}` : 'Sign in on the library to keep catches and credits'
    $('card-fact').textContent = s.facts[Math.floor(Math.random() * s.facts.length)]
    $('catch-card').hidden = false
    clearTimeout(this.cardTimer)
    this.cardTimer = window.setTimeout(() => { $('catch-card').hidden = true }, ['Trophy', 'Legendary'].includes(r.tier) ? 14000 : 9000)
  }

  private flashTitle(text: string): void {
    const original = document.title
    let on = false
    const id = window.setInterval(() => { document.title = (on = !on) ? text : original }, 900)
    const stop = () => { clearInterval(id); document.title = original; document.removeEventListener('visibilitychange', stop) }
    document.addEventListener('visibilitychange', stop)
  }

  toast(text: string, kind: 'good' | 'warn' | 'soft' | 'gold' = 'soft', seconds = 4): void {
    const stack = $('toasts')
    const el = document.createElement('div')
    el.className = `ang-toast is-${kind}`
    el.textContent = text
    stack.prepend(el)
    while (stack.children.length > 4) stack.lastElementChild?.remove()
    setTimeout(() => el.remove(), seconds * 1000)
  }

  refreshProfile(): void {
    const p = this.profile
    $('tc-chip').textContent = `${p.tc.toLocaleString()} TC`
    $('title-chip').textContent = this.account.signedIn ? `${this.account.username} · ${anglerTitle(p)}` : 'Guest angler'
  }

  private frame(dt: number): void {
    this.input.update(dt)
    const w = this.world
    w.controls.throttle = this.input.throttle
    w.controls.steer = this.input.steer
    if (this.input.active) {
      if (w.anchored) this.stopFishing()
      if (w.autopilot) { w.autopilot = null; this.map.pin = null }
    } else if (w.autopilot && w.driveAutopilot()) {
      this.map.pin = null
      this.toast('Arrived. Anchor down.', 'soft')
      this.toggleAnchor()
    }
    if (w.lake) this.progressSeconds += dt
    this.fishing?.update(dt)
    const s = w.physics?.state
    if (s && w.lake) {
      this.stillTime = Math.abs(s.speed) < 0.3 ? this.stillTime + dt : 0
      if (!w.background) this.sonar.update(dt, { lake: w.lake, x: s.x, z: s.z, date: now(), rig: this.profile.rig, settled: this.stillTime, crowd: 0 }, s.speed)
    }
    this.hudTimer += dt
    if (this.hudTimer > 0.25 && !w.background) {
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
    $('stat-temp').textContent = `${Math.round(waterTempF(w.lake, date, 0))}°F`
    const hour12 = ((ct.hour + 11) % 12) + 1
    $('stat-time').textContent = `${hour12}:${String(ct.minute).padStart(2, '0')} ${ct.hour < 12 ? 'am' : 'pm'}`
    if (w.weather) $('stat-weather').textContent = `${w.weather.label} · ${w.weather.airTempF}°F · wind ${windCompass(w.weather.windDir)} ${Math.round(w.weather.windMph)} mph · ${moonPhaseName(moonPhase(date))}`
    const look = outlook({ lake: w.lake, x: s.x, z: s.z, date, rig: this.profile.rig, settled: 60, crowd: 0 })
    $('stat-outlook').textContent = look.text
    const f = this.fishing
    let status = ''
    if (w.anchored && f) {
      if (f.phase === 'wait') status = 'Waiting for a bite…'
      else if (f.phase === 'fight' || f.phase === 'bite') status = 'Fish on!'
      else if (f.phase === 'cast') status = 'Casting'
      else if (f.phase === 'show' || f.phase === 'land') status = 'Landed!'
    } else if (w.autopilot) status = 'Autopilot to your pin'
    $('fish-status').textContent = status
    $('fish-status').hidden = !status
    const mini = $<HTMLCanvasElement>('minimap')
    this.map.draw(mini, [{ x: s.x, z: s.z, heading: s.heading, you: true }], false)
    if (!$('map-panel').hidden) this.map.draw($<HTMLCanvasElement>('map-canvas'), [{ x: s.x, z: s.z, heading: s.heading, you: true }])
  }
}
