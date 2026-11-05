/** Game flow: profile, lake picker, entering a lake, anchoring and fishing, the HUD, catch cards, record book and keyboard shortcuts. */
import { now } from '../shared/Clock'
import { World } from './World'
import { Fishing } from './Fishing'
import { LocalAuthority, ServerAuthority, api } from './Authority'
import type { Authority, BiteResult, Progress, TickResult } from './Authority'
import { LakeMap } from '../ui/LakeMap'
import { Sonar } from '../ui/Sonar'
import { RecordBook } from '../ui/RecordBook'
import { Panels } from '../ui/Panels'
import { renderAlmanac } from '../ui/Almanac'
import type { PanelTab } from '../ui/Panels'
import { catalog, equip, owns, purchase } from '../shared/Shop'
import type { BoatKind, BoatPaint } from '../shared/Boats'
import type { Look } from '../shared/Wardrobe'
import { LAKES, depthFeetAt, lakeIds, nearestSpot, waterTempF } from '../shared/Lakes'
import type { LakeId } from '../shared/Lakes'
import { centralTime, moonPhase, moonPhaseName } from '../shared/Astro'
import { windCompass } from '../shared/Weather'
import { outlook } from '../shared/Catch'
import { PRESENTATIONS, RODS } from '../shared/Gear'
import type { Rig, RodId } from '../shared/Gear'
import { SPECIES, formatCaught, formatLength, formatWeight } from '../shared/Species'
import type { Presentation } from '../shared/Species'
import { defaultProfile, lakeOpen, normalizeProfile } from '../shared/Profile'
import type { AnglerProfile } from '../shared/Profile'
import { anglerTitle, evaluateAchievements, TIER_NAMES } from '../shared/Achievements'
import type { Unlock } from '../shared/Achievements'
import { MOTORS } from '../shared/Shop'
import { toMph } from '../systems/BoatPhysics'
import { DriveInput } from '../systems/Input'
import { Online } from './Online'
import { LakeAudio } from '../systems/Audio'
import type { RemotePhase } from '../shared/Online'
import { BOATS_PER_INSTANCE, parseInvite } from '../shared/Online'
import { Celebrate } from '../ui/Celebrate'
import { saveCatchPhoto } from '../ui/CatchPhoto'
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
  panels!: Panels
  online!: Online
  readonly audio = new LakeAudio()
  private zoomedForPanel = false
  private lakeCounts: Record<string, { boats: number; anglers: number }> = {}
  private crewKey = ''
  private reelHeld = false
  private reelPulse = 0
  private reelKey = ''
  private streak = 0
  private doubleHeader = false
  private lastCatch: BiteResult | null = null
  private celebrate!: Celebrate

  constructor(canvas: HTMLCanvasElement, quality: QualityTier) {
    this.world = new World(canvas, quality)
    this.input = new DriveInput($('stick'))
    this.input.onKey = code => this.key(code)
    this.sonar = new Sonar($<HTMLCanvasElement>('sonar'))
  }

  async start(): Promise<void> {
    const status = $('loading-text')
    await this.world.load(text => { status.textContent = text })
    this.celebrate = new Celebrate(this.world, $('tags'))
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
      onHookSet: clean => { if (clean) { this.audio.hookSet(); this.toast('Hook set! Keep reeling, ease off when it runs.', 'good', 3) } },
      onRun: () => { this.audio.scream(); if (this.fishing?.reeling) this.toast('It is running! Ease off the reel.', 'warn', 2.5) },
      onSlip: () => this.toast('Drag slipping! Let go of Reel In before the line gives.', 'warn', 2.5),
      onJig: () => this.audio.jig(),
      onJump: () => { this.audio.thrash(); if (this.fishing?.reeling) this.toast('It is jumping! Let go and bow the rod to it.', 'warn', 2) },
      onBow: () => this.toast('Bowed to the jump. Line stayed tight.', 'good', 2),
      onNetReady: () => { this.audio.cue(); this.toast('Fish at the boat. Tap Reel In to net it!', 'gold', 2) },
      onNetMiss: final => { this.audio.thrash(); this.toast(final ? 'Scooped it on the second try.' : 'Missed the net! It surged off. Reel it back.', final ? 'soft' : 'warn', 2.5) },
    })
    this.panels = new Panels({
      profile: () => this.profile,
      signedIn: () => this.account.signedIn,
      previewLook: look => this.world.player?.character.setLook(look),
      saveLook: look => this.saveLook(look),
      previewBoat: (kind, paint) => this.previewBoat(kind, paint),
      saveBoat: (kind, paint) => this.saveBoat(kind, paint),
      buy: item => this.buy(item),
      almanac: () => this.almanac(),
      closed: () => { this.world.focusOnPlayer(false); this.world.setViewportWidth(1); if (this.zoomedForPanel) this.world.camera.zoom(1 / 0.45); this.zoomedForPanel = false },
    })
    this.online = new Online(this.world, {
      toast: (text, kind, seconds) => this.toast(text, kind, seconds),
      changed: () => this.onlineChanged(),
      fishing: () => this.fishingState(),
      crewChanged: aboard => this.crewChanged(aboard),
      gear: () => ({ boat: this.profile.boat, paint: this.profile.paint[this.profile.boat], look: this.profile.look }),
      signedIn: () => this.account.signedIn,
      chime: big => this.audio.chime(big),
    }, $('tags'))
    $('loading').hidden = true
    this.world.onFrame(dt => this.frame(dt))
    this.bindUi()
    const invite = parseInvite(new URLSearchParams(location.search).get('room') ?? '')
    if (invite && lakeOpen(this.profile, invite.lake)) void this.enter(invite.lake, { instance: invite.instance, board: invite.boat })
    else {
      if (invite) this.toast(`That invite is for ${LAKES[invite.lake].name}, which opens after ${LAKES[invite.lake].opensAt} landed fish.`, 'warn', 8)
      this.showLakes()
    }
  }

  crowd(): number {
    return this.online?.crowd() ?? 0
  }

  private fishingState(): { phase: RemotePhase; fish?: { species: string; length: number } } {
    const f = this.fishing
    if (!f || !f.active || !this.world.anchored) return { phase: 'off' }
    const phase: RemotePhase = f.phase === 'idle' ? 'off' : f.phase
    return { phase, fish: f.heldFish }
  }

  private onlineChanged(): void {
    if (this.authority instanceof ServerAuthority) this.authority.room = this.online.connected ? this.online.instance : undefined
    this.refreshCrew()
  }

  private crewChanged(aboard: boolean): void {
    this.world.anchored = false
    this.fishing?.end()
    this.world.focusOnPlayer(false)
    this.map.pin = null
    this.refreshButtons()
    if (aboard && this.online.captainAnchored()) this.followCaptain()
    this.refreshButtons()
  }

  /** Crew fish whenever their captain has the anchor down. */
  private followCaptain(): void {
    const anchored = this.online.captainAnchored()
    if (anchored && !this.world.anchored) {
      this.world.anchored = true
      this.refreshButtons()
      void this.fishing?.begin(this.profile.rig)
    } else if (!anchored && this.world.anchored) this.stopFishing()
  }

  private boardOrLeave(): void {
    if (!this.online.connected) return
    if (this.online.aboard) { this.online.leaveBoat(); return }
    const near = this.online.boardable()
    if (near) { this.stopFishing(); this.online.board(near.view.id) }
    else this.toast('Pull up within a boat length of another angler (both stopped) to climb aboard.', 'soft', 5)
  }

  private refreshCrew(): void {
    const el = $('crew')
    const o = this.online
    if (!o || !this.world.lake) { el.hidden = true; return }
    const crew = o.crew()
    const near = o.boardable()
    const key = JSON.stringify([o.connected, o.boatsOut(), crew, near?.view.id, o.locked, o.aboard, o.captainAnchored()])
    if (key === this.crewKey && !el.hidden) return
    this.crewKey = key
    el.hidden = false
    const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    if (!o.connected) { el.innerHTML = '<header><span><i></i>Shared lake</span><span>connecting…</span></header>'; return }
    const others = o.boatsOut() - 1
    let html = `<header><span><i class="is-on"></i>Shared lake</span><span>${o.boatsOut()}/${BOATS_PER_INSTANCE} boats${others ? '' : crew.length > 1 ? ' · just your crew' : ' · just you so far'}</span></header>`
    if (crew.length > 1) {
      const captain = !o.aboard
      html += `<ul aria-label="Crew">${crew.map(c => `<li><span>${esc(c.you ? 'You' : c.name)}${c.seat === 0 ? ' · captain' : ''}</span>${captain && !c.you ? `<button type="button" data-kick="${c.id}" aria-label="Send ${esc(c.name)} back to their boat">✕</button>` : ''}</li>`).join('')}</ul>`
    }
    const actions: string[] = []
    if (o.aboard) {
      html += `<p>Aboard ${esc(o.captainName())}'s boat. ${o.captainAnchored() ? 'Anchored, so you are fishing.' : 'You fish when the captain anchors.'}</p>`
      actions.push('<button class="ang-btn" type="button" data-act="leave">Back to my boat (E)</button>')
    } else {
      if (near) actions.push(`<button class="ang-btn is-primary" type="button" data-act="board">Board ${esc(near.view.name)}'s boat (E)</button>`)
      actions.push(`<button class="ang-btn" type="button" data-act="lock" aria-pressed="${o.locked}">${o.locked ? 'Unlock my boat' : 'Lock my boat'}</button>`)
      if (crew.length < 2 && !near) html += `<p>${window.parent !== window ? 'Invite friends from the library chat, or pull' : 'Pull'} alongside a stopped boat to climb aboard. Two anglers to a boat, up to four boats on the lake.</p>`
    }
    html += `<div class="crew-actions">${actions.join('')}</div>`
    el.innerHTML = html
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
    const reel = $('btn-reel')
    reel.addEventListener('pointerdown', e => { reel.setPointerCapture(e.pointerId); this.reelHeld = true })
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) reel.addEventListener(type, () => { this.reelHeld = false })
    reel.addEventListener('click', e => { if (e.detail === 0) this.reelPulse = 0.6 })
    reel.addEventListener('contextmenu', e => e.preventDefault())
    $('btn-map').addEventListener('click', () => this.toggleMap())
    $('btn-lakes').addEventListener('click', () => this.showLakes())
    $('btn-records').addEventListener('click', () => this.records.open(this.world.lake?.id ?? 'all'))
    $('btn-troll').addEventListener('click', () => { this.world.controls.trolling = !this.world.controls.trolling; this.refreshButtons() })
    $('map-close').addEventListener('click', () => this.toggleMap(false))
    $('catch-close').addEventListener('click', () => { $('catch-card').hidden = true })
    $('catch-photo').addEventListener('click', () => void this.photo())
    $('rig-rod').addEventListener('change', () => this.changeRig())
    $('rig-bait').addEventListener('change', () => this.changeRig(true))
    $('btn-wardrobe').addEventListener('click', () => this.openPanel('wardrobe'))
    $('btn-boat').addEventListener('click', () => this.openPanel('boat'))
    $('btn-shop').addEventListener('click', () => this.openPanel('shop'))
    $('btn-achievements').addEventListener('click', () => this.openPanel('achievements'))
    $('btn-almanac').addEventListener('click', () => this.openPanel('almanac'))
    $('btn-sound').addEventListener('click', () => this.toggleSound())
    this.refreshSound()
    $('lakes-close').addEventListener('click', () => { if (this.world.lake) $('screen-lakes').hidden = true })
    $('crew').addEventListener('click', e => {
      const target = (e.target as HTMLElement).closest('button')
      if (!target) return
      const kick = target.getAttribute('data-kick')
      if (kick) { this.online.kick(kick); return }
      const act = target.getAttribute('data-act')
      if (act === 'board' || act === 'leave') this.boardOrLeave()
      if (act === 'lock') this.online.setLocked(!this.online.locked)
    })
    addEventListener('message', e => {
      if (e.origin !== location.origin || e.source !== window.parent || (e.data as { type?: string } | null)?.type !== 'tl-host') return
      const code = this.online.inviteCode()
      if (code) window.parent.postMessage({ type: 'tl-room', code }, location.origin)
      else this.toast('Launch on a lake first, then send the invite.', 'soft')
    })
    const big = $<HTMLCanvasElement>('map-canvas')
    big.addEventListener('click', e => {
      const r = big.getBoundingClientRect()
      const [x, z] = this.map.toWorld(((e.clientX - r.left) / r.width) * big.width, ((e.clientY - r.top) / r.height) * big.height, big.width)
      this.map.pin = this.world.lake && depthFeetAt(this.world.lake, x, z) > 2 ? { x, z } : null
      if (this.online.aboard) { this.map.pin = null; this.toast('Your captain is driving.', 'soft'); return }
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
    if (code === 'KeyC') this.openPanel('wardrobe')
    if (code === 'KeyB') this.openPanel('boat')
    if (code === 'KeyP') this.openPanel('shop')
    if (code === 'KeyJ') this.openPanel('achievements')
    if (code === 'KeyG') this.openPanel('almanac')
    if (code === 'KeyN') this.toggleSound()
    if (code === 'KeyE') this.boardOrLeave()
    if (code === 'KeyT') { this.world.controls.trolling = !this.world.controls.trolling; this.refreshButtons() }
    if (code === 'Escape') { this.toggleMap(false); this.records.close(); this.panels.close(); $('catch-card').hidden = true }
  }

  private toggleSound(): void {
    this.audio.toggle()
    this.refreshSound()
  }

  private refreshSound(): void {
    $('btn-sound').setAttribute('aria-pressed', String(this.audio.enabled))
    $('btn-sound').textContent = this.audio.enabled ? 'Sound on' : 'Sound off'
  }

  toggleAnchor(): void {
    if (!this.world.physics || !this.world.lake) return
    if (this.online.aboard) { this.toast('Your captain handles the anchor. Press E to head back to your own boat.', 'soft'); return }
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
    const crew = this.online?.aboard ?? false
    $('btn-anchor').setAttribute('aria-pressed', String(this.world.anchored))
    $('btn-anchor').textContent = crew ? 'Captain anchors' : this.world.anchored ? 'Pull anchor' : 'Drop anchor'
    ;($('btn-anchor') as HTMLButtonElement).disabled = crew
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
      const out = this.lakeCounts[id]?.boats ?? 0
      button.innerHTML = `<strong>${lake.name}</strong><span>${lake.type} · ${lake.acres.toLocaleString()} acres · ${lake.maxDepth} ft deep${out ? ` · <b class="is-out">${out} boat${out === 1 ? '' : 's'} out now</b>` : ''}</span><em>${lake.blurb}</em>${open ? '' : `<b>Opens after ${lake.opensAt} landed fish (${this.profile.stats.landed} so far)</b>`}`
      button.addEventListener('click', () => void this.enter(id))
      list.appendChild(button)
    }
    $('lakes-close').hidden = !this.world.lake
    $('screen-lakes').hidden = false
    void this.loadLakeCounts()
  }

  private countsAt = 0

  private async loadLakeCounts(): Promise<void> {
    if (Date.now() - this.countsAt < 20_000) return
    this.countsAt = Date.now()
    try {
      const r = await fetch('/api/angler-lake', { credentials: 'same-origin' })
      if (!r.ok) return
      const data = await r.json() as { lakes?: Record<string, { boats: number; anglers: number }> }
      this.lakeCounts = data.lakes ?? {}
      if (!$('screen-lakes').hidden) { this.countsAt = Date.now(); this.redrawLakeList() }
    } catch { /* counts are optional */ }
  }

  private redrawLakeList(): void {
    const keep = this.countsAt
    this.showLakes()
    this.countsAt = keep
  }

  async enter(id: LakeId, invite?: { instance: number; board: string }): Promise<void> {
    this.online.disconnect()
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
    this.online.connect(id, invite)
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

  openPanel(tab: PanelTab): void {
    if (!this.world.lake) return
    if (this.panels.isOpen) { this.panels.close(); return }
    if (tab === 'wardrobe' || tab === 'boat') {
      if (!this.world.anchored) this.world.controls.throttle = 0
      this.world.focusOnPlayer(tab === 'wardrobe')
      if (tab === 'wardrobe') { this.world.camera.zoom(0.45); this.zoomedForPanel = true }
    }
    this.panels.open(tab)
    if (innerWidth > 900) this.world.setViewportWidth(1 - Math.min(560, innerWidth) / innerWidth)
  }

  private almanac(): string {
    const w = this.world
    if (!w.lake || !w.physics) return '<p class="ang-note">Launch on a lake to read the almanac.</p>'
    const s = w.physics.state
    return renderAlmanac({ lake: w.lake, x: s.x, z: s.z, rig: this.profile.rig, crowd: this.crowd() }, now(), owns(this.profile, 'almanac'), catalog().find(i => i.id === 'almanac')?.price ?? 0)
  }

  private async post(body: Record<string, unknown>): Promise<void> {
    if (this.account.signedIn) {
      const r = await api<{ profile: unknown }>(body)
      this.profile = normalizeProfile(r.profile)
    } else {
      const p = this.profile
      const result = body.action === 'buy' ? purchase(p, body.item as string) : equip(p, body.patch as Record<string, unknown>)
      if (!result.ok) throw new Error(result.error)
      for (const u of evaluateAchievements(p)) this.announce(u)
    }
    this.refreshProfile()
  }

  private async saveLook(look: Look): Promise<void> {
    await this.post({ action: 'equip', patch: { look } })
    this.world.player?.character.setLook(this.profile.look)
    this.online.sendGear()
  }

  private previewBoat(kind: BoatKind, paint: BoatPaint): void {
    if (this.world.boat?.spec.kind !== kind) this.stopFishing()
    this.world.setBoat(kind, paint)
  }

  private async saveBoat(kind: BoatKind, paint: BoatPaint): Promise<void> {
    await this.post({ action: 'equip', patch: { boat: kind, paint: { kind, paint } } })
    this.world.setBoat(this.profile.boat, this.profile.paint[this.profile.boat])
    this.online.sendGear()
  }

  private async buy(item: string): Promise<void> {
    await this.post({ action: 'buy', item })
    const p = this.profile
    if (this.world.physics) this.world.physics.motorBoost = MOTORS[p.motor].boost
    this.sonar.level = p.sonar
    this.fillRig()
    this.toast(`Bought: ${item.startsWith('rod:') ? RODS[item.slice(4) as RodId].name : item === 'almanac' ? "the Guide's Almanac" : 'new gear'}. ${p.tc.toLocaleString()} TC left.`, 'good')
  }

  private takeProgress(): Progress {
    const seconds = Math.round(this.progressSeconds)
    this.progressSeconds -= seconds
    const odo = this.world.physics?.state.odometer ?? 0
    const miles = Math.max(0, odo - this.progressOdometer) / 1609.34
    this.progressOdometer = odo
    const crew = this.online?.crew().length ?? 0
    return { seconds, miles: Math.round(miles * 1000) / 1000, ...(crew > 1 ? { social: Math.min(4, crew) } : {}) }
  }

  private onBite(r: BiteResult): void {
    if (r.kind !== 'missed') this.toast(r.weight > 15 ? 'Fish on! Something heavy…' : 'Fish on!', 'good')
    this.world.focusOnPlayer(true)
  }

  private onLost(r: BiteResult): void {
    const s = SPECIES[r.species]
    this.toast(`Snapped off! It looked like a ${s.name.toLowerCase()}, ${formatWeight(r.weight * 0.85)} to ${formatWeight(r.weight * 1.15)}.`, 'warn', 6)
    if (this.streak >= 3) this.toast(`Streak over at ${this.streak} in a row.`, 'soft')
    this.streak = 0
    this.pushLog(r)
    this.world.focusOnPlayer(false)
  }

  private away: BiteResult[] = []

  private onLanded(r: BiteResult): void {
    if (this.world.background) this.away.push(r)
    this.streak++
    this.pushLog(r)
    this.showCard(r)
    if ([3, 5, 10, 15, 25].includes(this.streak)) this.toast(`Hot streak: ${this.streak} landed in a row!`, 'gold', 5)
    this.lastCatch = r
    if (!this.world.background) {
      this.celebrate.float(`+${formatWeight(r.weight)}`, r.tier)
      const big = ['Trophy', 'Legendary'].includes(r.tier) || r.siteRecord
      if (big || r.personalBest) this.celebrate.confetti(big ? 120 : 60)
      if (r.tier === 'Legendary' || r.siteRecord) this.celebrate.flash()
    }
    if (['Quality', 'Trophy', 'Legendary'].includes(r.tier) || r.personalBest || r.siteRecord) this.audio.chime(['Trophy', 'Legendary'].includes(r.tier) || r.siteRecord)
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
    const grade = this.fishing?.grade ?? 'Auto'
    const bows = this.fishing?.bows ?? 0
    const extras = [bows ? `bowed to ${bows} jump${bows === 1 ? '' : 's'}` : '', this.fishing?.netClean ? 'netted first try' : '', this.streak > 1 ? `${this.streak} in a row` : ''].filter(Boolean)
    $('card-fight').textContent = grade === 'Auto' ? '' : `${grade === 'Clean' ? 'Clean fight: hook set, drag held, netted first try' : grade === 'Steady' ? 'Steady fight' : 'Rough fight: the drag slipped a lot'}${extras.length ? ` · ${extras.join(' · ')}` : ''}`
    $('card-fight').hidden = !$('card-fight').textContent
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
    this.panels?.refresh()
    $('tc-chip').textContent = `${p.tc.toLocaleString()} TC`
    $('title-chip').textContent = this.account.signedIn ? `${this.account.username} · ${anglerTitle(p)}` : 'Guest angler'
  }

  private frame(dt: number): void {
    this.input.update(dt)
    const w = this.world
    const aboard = this.online.aboard
    w.controls.throttle = aboard ? 0 : this.input.throttle
    w.controls.steer = aboard ? 0 : this.input.steer
    if (aboard) this.followCaptain()
    else if (this.input.active) {
      if (w.anchored) this.stopFishing()
      if (w.autopilot) { w.autopilot = null; this.map.pin = null }
    } else if (w.autopilot && w.driveAutopilot()) {
      this.map.pin = null
      this.toast('Arrived. Anchor down.', 'soft')
      this.toggleAnchor()
    }
    if (w.lake) this.progressSeconds += dt
    this.reelPulse = Math.max(0, this.reelPulse - dt)
    const typing = (document.activeElement as HTMLElement | null)?.closest?.('select, input')
    const reeling = this.reelHeld || this.reelPulse > 0 || (!typing && this.input.held('KeyF'))
    if (this.fishing) this.fishing.reeling = reeling && w.anchored
    this.audio.reeling = reeling
    this.fishing?.update(dt)
    if (!w.background) this.updateReel(reeling)
    this.online.update(dt)
    const s = w.physics?.state
    if (s && w.lake) this.audio.update(dt, s.speed, aboard ? 0 : w.controls.throttle, w.weather?.windMph ?? 0, w.sky.state.day, this.fishingState().phase)
    if (s && w.lake) {
      this.stillTime = Math.abs(s.speed) < 0.3 ? this.stillTime + dt : 0
      if (!w.background) this.sonar.update(dt, { lake: w.lake, x: s.x, z: s.z, date: now(), rig: this.profile.rig, settled: this.stillTime, crowd: this.crowd() }, s.speed)
    }
    this.hudTimer += dt
    if (this.hudTimer > 0.25 && !w.background) {
      this.hudTimer = 0
      this.updateHud()
    }
  }

  private async photo(): Promise<void> {
    const r = this.lastCatch
    if (!r) return
    try {
      await saveCatchPhoto(this.world, {
        species: SPECIES[r.species].name,
        weight: formatWeight(r.weight),
        length: formatLength(r.length),
        tier: r.tier,
        lake: this.world.lake?.name ?? '',
        when: formatCaught(now().toISOString()),
        angler: this.account.signedIn ? this.account.username : 'Guest angler',
      })
      this.toast('Catch photo saved to your downloads.', 'good')
    } catch {
      this.toast('The photo could not be saved.', 'warn')
    }
  }

  /** The Reel In button and its tension and line meters, every frame while anchored. */
  private updateReel(reeling: boolean): void {
    const f = this.fishing
    const show = Boolean(f && f.active && this.world.anchored)
    const phase = show ? f!.phase : 'off'
    const fighting = phase === 'fight'
    const charging = phase === 'wait' && (f?.castCharge ?? -1) >= 0
    const net = fighting && Boolean(f?.netReady)
    const jumping = fighting && Boolean(f?.jumping)
    const label = phase === 'bite' ? 'Set the hook!' : net ? 'Net it!' : jumping ? 'Let go! It jumped' : fighting ? (reeling ? 'Reeling…' : 'Reel in (hold)') : charging ? 'Release to cast' : phase === 'wait' ? 'Tap: jig · Hold: cast' : 'Reel in'
    const key = `${show}|${phase}|${label}|${reeling}|${charging}`
    if (key !== this.reelKey) {
      this.reelKey = key
      $('reel').hidden = !show
      $('reel-meters').hidden = !fighting && !charging
      $('reel-fight-meters').hidden = !fighting
      $('reel-cast-meter').hidden = !charging
      const btn = $<HTMLButtonElement>('btn-reel')
      btn.textContent = label
      btn.disabled = !['wait', 'bite', 'fight'].includes(phase)
      btn.classList.toggle('is-strike', phase === 'bite' || net)
      btn.classList.toggle('is-jump', jumping)
      btn.classList.toggle('is-held', reeling)
    }
    if (charging && f) {
      $('reel-cast').style.width = `${(f.castCharge * 100).toFixed(1)}%`
      $('reel-cast-text').textContent = `${Math.round(7 + f.castCharge * 24)} yd`
    }
    if (!fighting || !f) return
    const tension = Math.min(1.2, f.tension) / 1.2
    $('reel-tension').style.width = `${(tension * 100).toFixed(1)}%`
    $('reel-tension-bar').classList.toggle('is-hot', f.tension > 1)
    $('reel-tension-text').textContent = f.tension > 1 ? 'SLIPPING' : f.tension > 0.85 ? 'High' : ''
    const out = 1 - f.progress
    $('reel-line').style.width = `${(out * 100).toFixed(1)}%`
    $('reel-line-text').textContent = `${Math.round(out * 30 + 3)} yd`
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
    const look = outlook({ lake: w.lake, x: s.x, z: s.z, date, rig: this.profile.rig, settled: 60, crowd: this.crowd() })
    $('stat-outlook').textContent = look.text
    const f = this.fishing
    let status = ''
    if (w.anchored && f) {
      if (f.phase === 'wait') status = 'Waiting for a bite…'
      else if (f.phase === 'fight' || f.phase === 'bite') status = 'Fish on!'
      else if (f.phase === 'cast') status = 'Casting'
      else if (f.phase === 'show' || f.phase === 'land') status = 'Landed!'
    } else if (this.online.aboard) status = `Riding with ${this.online.captainName()}`
    else if (w.autopilot) status = 'Autopilot to your pin'
    if (w.anchored && f?.phase === 'fight') {
      const mate = this.online.crewFighting()
      if (mate && !this.doubleHeader) { this.doubleHeader = true; this.toast(`Double header! You and ${mate} both have fish on.`, 'gold', 5); this.audio.chime(false) }
      if (mate) status = `Double header with ${mate}!`
    } else this.doubleHeader = false
    $('fish-status').textContent = status
    $('fish-status').hidden = !status
    const mini = $<HTMLCanvasElement>('minimap')
    const boats = [...this.online.markers(), { x: s.x, z: s.z, heading: s.heading, you: true }]
    this.map.draw(mini, boats, false)
    if (!$('map-panel').hidden) this.map.draw($<HTMLCanvasElement>('map-canvas'), boats)
    this.refreshCrew()
  }
}
