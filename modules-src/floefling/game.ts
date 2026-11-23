import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder'
import { TrailMesh } from '@babylonjs/core/Meshes/trailMesh'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Scene } from '@babylonjs/core/scene'
import { Sfx } from './audio'
import type { LookId } from './looks'
import { LOOKS, siteLook } from './looks'
import { Bear } from './render/bear'
import type { Backend } from './render/engine'
import { Effects } from './render/fx'
import { Fish } from './render/fish'
import { matte } from './render/materials'
import { World, drift } from './render/world'
import { CLIFF_HEIGHT, FEET_PER_METER, SHOTS_PER_ROUND, STEP, SWEET_SHARE, SWING_DELAY, TOSS_START_Y, ZONE_HALF, ZONE_Y } from './sim/constants'
import type { EndReason, FlightEvent, FlightState } from './sim/flight'
import { groundHeight, launch, stepFlight } from './sim/flight'
import { seededRng } from './sim/rng'
import type { HitKind, SwingResult } from './sim/swing'
import { resolveSwing, tossHeight, tossLandTime } from './sim/swing'
import { Track } from './sim/track'

type Phase = 'title' | 'ready' | 'toss' | 'swing' | 'fall' | 'flight' | 'result' | 'end'
type Shot = { distance: number; kind: HitKind | 'dropped'; reason: EndReason | null; combo: number; angle: number; power: number }
type LocalScore = { best: number; total: number; at: number }

const MODULE_ID = 'floefling'
const FISH_X = -0.15
const BEAR_BASE = new Vector3(-0.15, CLIFF_HEIGHT, 0.95)
const STORE_LOOK = 'floefling-look'
const STORE_SOUND = 'floefling-sound'
const STORE_SCORES = 'floefling-scores'
const GAUGE_TOP = 3.4

declare global {
  interface Window {
    tlScores?: { submit(module: string, value: number, extra?: unknown): void; progress(module: string, value: number): void }
    __floe?: { phase: () => string; shots: () => Shot[]; backend: Backend; press: () => void; fish: () => { x: number; y: number } }
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const store = {
  get(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } },
  set(key: string, value: string): void { try { localStorage.setItem(key, value) } catch { /* storage unavailable */ } },
}
const meters = (m: number) => `${m.toFixed(1)} m`
const feet = (m: number) => `${Math.round(m * FEET_PER_METER).toLocaleString('en-US')} ft`
const tenthsOfFeet = (m: number) => Math.round(m * FEET_PER_METER * 10)
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)

export class Game {
  private engine: AbstractEngine
  private scene: Scene
  private camera: FreeCamera
  private camTarget = new Vector3()
  private shake = 0
  private hitStop = 0
  private bear: Bear
  private fish: Fish
  private shadow: Mesh
  private world: World
  private fx: Effects
  private sfx = new Sfx()
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private lookId: LookId
  private phase: Phase = 'title'
  private phaseTime = 0
  private track: Track
  private seed = 1
  private wind = 0
  private shots: Shot[] = []
  private tossT = 0
  private swing: SwingResult | null = null
  private flight: FlightState | null = null
  private prevPos = new Vector3()
  private accumulator = 0
  private fishRoll = 0
  private fishSpin = 0
  private fishPitch = 0
  private fallY = 0
  private fallVy = 0
  private calloutTimer = 0
  private lastDistance = 0
  private hidden = false
  private timeScale = 1
  private trail: TrailMesh | null = null
  private trailMaterial: StandardMaterial

  constructor(engine: AbstractEngine, backend: Backend) {
    this.engine = engine
    const saved = store.get(STORE_LOOK)
    this.lookId = saved === 'wics' || saved === 'original' ? saved : siteLook() ?? 'original'
    const look = LOOKS[this.lookId]
    this.sfx.enabled = store.get(STORE_SOUND) !== 'off'
    this.scene = new Scene(engine)
    this.scene.skipPointerMovePicking = true
    this.camera = new FreeCamera('cam', new Vector3(-1.6, CLIFF_HEIGHT + 2.4, -7.2), this.scene)
    this.camera.fov = 0.85
    this.camera.minZ = 0.1
    this.camera.maxZ = 4000
    this.camera.inputs.clear()
    this.camTarget.set(0.9, CLIFF_HEIGHT + 1.4, 0)
    const hemi = new HemisphericLight('sky-light', new Vector3(0.2, 1, -0.3), this.scene)
    hemi.intensity = 0.78
    hemi.groundColor = new Color3(0.62, 0.7, 0.82)
    hemi.specular = Color3.Black()
    const sun = new DirectionalLight('sun-light', new Vector3(-0.35, -0.8, 0.45), this.scene)
    sun.intensity = 0.72
    sun.diffuse = new Color3(1, 0.97, 0.9)
    this.track = new Track(this.seed)
    this.world = new World(this.scene, this.track, look)
    this.bear = new Bear(this.scene, BEAR_BASE, look)
    this.fish = new Fish(this.scene)
    this.shadow = CreateDisc('fish-shadow', { radius: 0.35, tessellation: 20 }, this.scene)
    this.shadow.rotation.x = Math.PI / 2
    const shadowMat = matte(this.scene, 'fish-shadow', '#203448')
    shadowMat.alpha = 0.28
    this.shadow.material = shadowMat
    this.shadow.isPickable = false
    this.fx = new Effects(this.scene, this.reduced)
    this.trailMaterial = matte(this.scene, 'fish-trail', '#ffffff', 1)
    this.trailMaterial.disableLighting = true
    this.trailMaterial.alpha = 0.4
    this.trailMaterial.backFaceCulling = false
    this.applyLook()
    this.bindUi()
    const badge = $('badge')
    badge.textContent = backend === 'webgpu' ? 'WebGPU' : 'WebGL2'
    badge.classList.add(backend)
    this.renderLocalScores('localScores')
    window.__floe = { phase: () => this.phase, shots: () => this.shots, backend, press: () => this.press(), fish: () => ({ x: this.fish.root.position.x, y: this.fish.root.position.y }) }
    document.addEventListener('visibilitychange', () => { this.hidden = document.hidden; if (this.hidden) this.sfx.stopWind() })
    engine.runRenderLoop(() => {
      const dt = Math.min(0.05, engine.getDeltaTime() / 1000)
      if (!this.hidden) this.update(dt)
      this.scene.render()
    })
    window.addEventListener('resize', () => engine.resize())
    this.update(0)
  }

  private bindUi(): void {
    const canvas = this.engine.getRenderingCanvas()
    canvas?.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      event.preventDefault()
      canvas.focus({ preventScroll: true })
      this.press()
    })
    window.addEventListener('keydown', event => {
      const target = event.target as HTMLElement | null
      const onButton = target?.tagName === 'BUTTON'
      if ((event.code === 'Space' || event.code === 'Enter') && !onButton) {
        event.preventDefault()
        if (!event.repeat) this.press()
        return
      }
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'm') this.toggleSound()
      else if (key === 't') this.setLook(this.lookId === 'wics' ? 'original' : 'wics')
      else if (key === 'r' && this.phase !== 'title') this.newRound()
    })
    $('startBtn').addEventListener('click', () => this.newRound())
    $('againBtn').addEventListener('click', () => this.newRound())
    $('restartBtn').addEventListener('click', () => this.newRound())
    $('soundBtn').addEventListener('click', () => this.toggleSound())
    $('lookBtn').addEventListener('click', () => this.setLook(this.lookId === 'wics' ? 'original' : 'wics'))
    $('lookOriginal').addEventListener('click', () => this.setLook('original'))
    $('lookWics').addEventListener('click', () => this.setLook('wics'))
    const gauge = $('gauge')
    const pct = (y: number) => `${(Math.max(0, Math.min(GAUGE_TOP, y)) / GAUGE_TOP) * 100}%`
    gauge.style.setProperty('--zone-bottom', pct(ZONE_Y - ZONE_HALF))
    gauge.style.setProperty('--zone-height', pct(ZONE_HALF * 2))
    gauge.style.setProperty('--sweet-bottom', pct(ZONE_Y - ZONE_HALF * SWEET_SHARE))
    gauge.style.setProperty('--sweet-height', pct(ZONE_HALF * SWEET_SHARE * 2))
  }

  private toggleSound(): void {
    this.sfx.enabled = !this.sfx.enabled
    if (!this.sfx.enabled) this.sfx.stopWind()
    store.set(STORE_SOUND, this.sfx.enabled ? 'on' : 'off')
    const button = $('soundBtn')
    button.setAttribute('aria-pressed', String(this.sfx.enabled))
    button.textContent = this.sfx.enabled ? '🔊' : '🔈'
  }

  private setLook(id: LookId): void {
    this.lookId = id
    store.set(STORE_LOOK, id)
    this.applyLook()
    this.world.setLook(LOOKS[id])
    this.bear.setLook(LOOKS[id])
  }

  private applyLook(): void {
    document.documentElement.dataset.look = this.lookId
    $('lookOriginal').setAttribute('aria-pressed', String(this.lookId === 'original'))
    $('lookWics').setAttribute('aria-pressed', String(this.lookId === 'wics'))
    this.fx.setStarColor(LOOKS[this.lookId].scarfStripe)
    const sound = $('soundBtn')
    sound.setAttribute('aria-pressed', String(this.sfx.enabled))
    sound.textContent = this.sfx.enabled ? '🔊' : '🔈'
  }

  private newRound(): void {
    this.sfx.unlock()
    this.seed = (Math.random() * 2 ** 32) >>> 0
    this.track = new Track(this.seed)
    this.world.setTrack(this.track)
    this.shots = []
    $('titleCard').hidden = true
    $('endCard').hidden = true
    for (const id of ['hud', 'tools', 'gauge', 'wind']) $(id).hidden = false
    this.engine.getRenderingCanvas()?.focus({ preventScroll: true })
    this.startShot()
  }

  private startShot(): void {
    const rng = seededRng(this.seed + this.shots.length * 7919)
    this.wind = Math.round((rng() * 2 - 1) * 35) / 10
    this.swing = null
    this.flight = null
    this.tossT = 0
    this.timeScale = 1
    this.trail?.dispose()
    this.trail = null
    this.fx.clear()
    this.fish.setVisible(true)
    this.bear.setPose('idle')
    this.setPhase('ready')
    this.updateHud()
    this.say(`Fish ${this.shots.length + 1} of ${SHOTS_PER_ROUND}. Wind ${this.windLabel()}. Press Space to toss.`)
  }

  private press(): void {
    this.sfx.unlock()
    switch (this.phase) {
      case 'title':
        this.newRound()
        break
      case 'ready':
        this.tossT = 0
        this.bear.setPose('toss')
        this.sfx.toss()
        this.setPhase('toss')
        break
      case 'toss':
        this.swing = resolveSwing(this.tossT)
        this.bear.setPose(this.swing.kind === 'whiff' ? 'whiff' : 'swing')
        this.sfx.swish()
        this.setPhase('swing')
        break
      case 'result':
        if (this.phaseTime > 0.6) this.nextShot()
        break
      case 'flight':
        if (this.phaseTime > 0.4 && this.timeScale === 1) { this.timeScale = 3; $('prompt').hidden = true }
        break
      default:
        break
    }
  }

  private setPhase(phase: Phase): void {
    this.phase = phase
    this.phaseTime = 0
    const prompt = $('prompt')
    const text: Partial<Record<Phase, string>> = {
      ready: 'Press <kbd>Space</kbd> or tap to toss',
      toss: 'Swing when the fish drops into the zone!',
      flight: 'Press <kbd>Space</kbd> to fast-forward',
      result: this.shots.length >= SHOTS_PER_ROUND ? 'Press <kbd>Space</kbd> for the results' : 'Press <kbd>Space</kbd> for the next fish',
    }
    const html = text[phase]
    prompt.hidden = !html
    if (html) prompt.innerHTML = html
    $('readout').hidden = !(phase === 'flight' || phase === 'result') || !this.swing || this.swing.kind === 'whiff'
  }

  private update(dt: number): void {
    this.phaseTime += dt
    if (this.hitStop > 0) {
      this.hitStop -= dt
      this.updateCamera(dt * 0.15)
      return
    }
    this.bear.update(dt)
    this.fx.update(dt)
    switch (this.phase) {
      case 'title':
      case 'ready':
        this.holdFish(dt)
        break
      case 'toss':
        this.tossT += dt
        this.tossFish(dt)
        if (this.tossT >= tossLandTime()) this.dropped('dropped')
        break
      case 'swing':
        this.tossT += dt
        this.tossFish(dt)
        if (this.phaseTime >= SWING_DELAY && this.swing) this.contact(this.swing)
        break
      case 'fall':
        this.fallFish(dt)
        break
      case 'flight':
        this.flyFish(dt)
        break
      case 'result':
        this.restFish(dt)
        if (this.phaseTime > 3.2) this.nextShot()
        break
      default:
        break
    }
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt
      if (this.calloutTimer <= 0) $('callout').classList.remove('show')
    }
    this.updateGauge()
    this.updateShadow()
    this.updateCamera(dt)
    this.world.update(this.camera.position.x + 20, dt)
  }

  private holdFish(dt: number): void {
    const paw = this.bear.pawPosition()
    this.fish.place(paw.x, paw.y + 0.05, paw.z - 0.05, 0.3 + Math.sin(this.phaseTime * 7) * 0.25, Math.PI / 2, 0)
    this.fish.flap(dt, 14)
  }

  private tossFish(dt: number): void {
    const t = this.tossT
    const k = Math.min(1, t / 0.3)
    const start = this.bear.pawPosition()
    const x = start.x + (FISH_X - start.x) * k
    const z = start.z + (0 - start.z) * k
    const y = CLIFF_HEIGHT + tossHeight(t)
    this.fishRoll += dt * 5
    this.fish.place(x, y, z, Math.sin(t * 6) * 0.9 + 0.4, this.fishRoll, 0)
    this.fish.flap(dt, 22)
  }

  private contact(swing: SwingResult): void {
    if (swing.kind === 'whiff') {
      this.fallY = this.fish.root.position.y
      this.fallVy = -2
      this.setPhase('fall')
      this.callout('Whiff!', 'Missed it')
      return
    }
    const at = this.fish.root.position.clone()
    const sweet = swing.kind === 'homer'
    this.sfx.crack(swing.power, sweet)
    if (sweet) {
      this.sfx.chime()
      if (!this.reduced) { this.hitStop = 0.05; this.shake = 0.6 }
      this.fx.starburst(at, true)
      this.callout('Home run!', `${Math.round(swing.angleDeg)}° line drive`)
    } else {
      this.shake = this.reduced ? 0 : 0.18
      this.fx.starburst(at, false)
      this.callout(swing.kind === 'pop' ? 'Pop fly' : 'Grounder', swing.kind === 'pop' ? 'A touch early' : 'A touch late')
    }
    this.flight = launch(swing)
    this.prevPos.set(this.flight.x, this.flight.y, 0)
    this.accumulator = 0
    this.fishSpin = 8 + swing.power * 14
    this.fishPitch = (swing.angleDeg * Math.PI) / 180
    $('readout').textContent = `Power ${Math.round(swing.power * 100)}% · Angle ${Math.round(swing.angleDeg)}°`
    this.trail = new TrailMesh('fish-trail', this.fish.root, this.scene, 0.09, 45, true)
    this.trail.material = this.trailMaterial
    this.trail.isPickable = false
    this.setPhase('flight')
    $('readout').hidden = false
  }

  private dropped(kind: 'dropped' | 'whiff'): void {
    this.sfx.flop()
    this.fx.snowPuff(this.fish.root.position.clone(), 3)
    this.fish.place(this.fish.root.position.x, CLIFF_HEIGHT + 0.08, this.fish.root.position.z, 0, Math.PI / 2, 0)
    this.bear.setPose('slump')
    if (kind === 'dropped') this.callout('Dropped!', 'Swing before it lands')
    this.finishShot({ distance: 0, kind: kind === 'dropped' ? 'dropped' : 'whiff', reason: 'dropped', combo: 0, angle: 0, power: 0 })
  }

  private fallFish(dt: number): void {
    this.fallVy -= 5.5 * dt
    this.fallY += this.fallVy * dt
    const p = this.fish.root.position
    this.fishRoll += dt * 9
    if (this.fallY <= CLIFF_HEIGHT + 0.08) { this.dropped('whiff'); return }
    this.fish.place(p.x, this.fallY, p.z, Math.sin(this.phaseTime * 8), this.fishRoll, 0)
    this.fish.flap(dt, 26)
  }

  private flyFish(dt: number): void {
    const flight = this.flight
    if (!flight) return
    this.accumulator += dt * this.timeScale
    const events: FlightEvent[] = []
    while (this.accumulator >= STEP && flight.mode !== 'stopped') {
      this.prevPos.set(flight.x, flight.y, 0)
      stepFlight(flight, this.track, this.wind, events)
      this.accumulator -= STEP
    }
    for (const event of events) this.onFlightEvent(event)
    const alpha = flight.mode === 'stopped' ? 1 : this.accumulator / STEP
    const x = this.prevPos.x + (flight.x - this.prevPos.x) * alpha
    const y = this.prevPos.y + (flight.y - this.prevPos.y) * alpha
    const speed = Math.hypot(flight.vx, flight.vy)
    if (flight.mode === 'air') {
      const target = Math.atan2(flight.vy, Math.max(0.1, flight.vx))
      this.fishPitch += (target - this.fishPitch) * damp(10, dt)
      this.fishRoll += this.fishSpin * dt
      this.fish.place(x, y + 0.12, 0, this.fishPitch, this.fishRoll, Math.sin(this.fishRoll * 0.3) * 0.15)
      this.fish.flap(dt, 30)
      this.sfx.setWind(speed)
    } else if (flight.mode === 'slide') {
      this.fishPitch += (0 - this.fishPitch) * damp(8, dt)
      this.fishRoll += ((Math.PI / 2) - (this.fishRoll % (Math.PI * 2))) * damp(6, dt)
      this.fish.place(x, groundHeight(x) + 0.09, 0, this.fishPitch, Math.PI / 2, Math.sin(this.phaseTime * 9) * 0.2)
      this.fish.flap(dt, 8)
      this.fx.skidSpray(this.fish.root.position, speed)
      this.sfx.setWind(speed * 0.4)
    }
    this.lastDistance = Math.max(0, x)
    $('dist').textContent = this.lastDistance.toFixed(1)
    $('distFt').textContent = feet(this.lastDistance)
    if (flight.mode === 'stopped') this.landed(flight)
  }

  private onFlightEvent(event: FlightEvent): void {
    const at = new Vector3(event.x, groundHeight(event.x), 0)
    if (event.type === 'bounce') {
      this.fx.snowPuff(at, event.speed)
      this.sfx.thud(event.speed)
      if (event.surface === 'ice') this.sfx.skid()
      if (!this.reduced) this.shake = Math.max(this.shake, Math.min(0.25, event.speed * 0.008))
    } else if (event.type === 'slide') {
      if (event.surface === 'ice') this.callout('Slick ice!', 'Zero grip')
    } else if (event.type === 'bouncer') {
      this.world.hitBouncer(event.id)
      this.sfx.boing()
      this.fx.starburst(at.add(new Vector3(0, 1.2, 0)), false)
      this.callout(event.combo > 1 ? `Boing ×${event.combo}!` : 'Boing!', 'Combo boost')
    } else if (event.type === 'stop') {
      if (event.reason === 'hole') { this.fx.splashUp(at); this.sfx.splash() }
      else if (event.reason === 'nosedive' || event.reason === 'bank') { this.fx.snowPuff(at.add(new Vector3(0, event.reason === 'bank' ? 0.8 : 0, 0)), 16); this.sfx.thud(30) }
    }
  }

  private landed(flight: FlightState): void {
    this.sfx.stopWind()
    const reason = flight.reason ?? 'slide'
    const p = this.fish.root.position
    if (reason === 'nosedive') this.fish.place(flight.x, 0.1, 0, -1.25, this.fishRoll, 0)
    else if (reason === 'bank') this.fish.place(flight.x, Math.max(0.3, flight.y), 0, -0.5, this.fishRoll, 0)
    else if (reason === 'hole') this.fish.setVisible(false)
    else this.fish.place(p.x, 0.09, 0, 0, Math.PI / 2, 0)
    const label: Record<EndReason, string> = { slide: 'Slid to a stop', nosedive: 'Nose-dive!', hole: 'Plop! Into the hole', bank: 'Buried in a snowbank', dropped: '' }
    const swing = this.swing
    const distance = Math.max(0, flight.x)
    this.callout(meters(distance), `${feet(distance)} · ${label[reason]}`, 2.8)
    const best = Math.max(distance, ...this.shots.map(s => s.distance))
    this.bear.setPose(distance >= best && distance > 60 ? 'cheer' : 'idle')
    this.finishShot({ distance, kind: swing?.kind ?? 'whiff', reason, combo: flight.combo, angle: swing?.angleDeg ?? 0, power: swing?.power ?? 0 })
  }

  private restFish(dt: number): void {
    if (this.flight && this.flight.reason === 'slide') this.fish.flap(dt, 10 + Math.sin(this.phaseTime * 3) * 6)
  }

  private finishShot(shot: Shot): void {
    this.shots.push(shot)
    this.lastDistance = shot.distance
    $('dist').textContent = shot.distance.toFixed(1)
    $('distFt').textContent = feet(shot.distance)
    this.setPhase('result')
    this.updateHud()
    const best = this.bestShot()
    if (best > 0) window.tlScores?.progress(MODULE_ID, tenthsOfFeet(best))
    this.say(`${shot.distance > 0 ? `${meters(shot.distance)}, ${feet(shot.distance)}` : 'No distance'}. Best ${meters(best)}.`)
  }

  private nextShot(): void {
    if (this.shots.length >= SHOTS_PER_ROUND) this.endRound()
    else this.startShot()
  }

  private endRound(): void {
    this.setPhase('end')
    const best = this.bestShot()
    const total = this.shots.reduce((sum, s) => sum + s.distance, 0)
    if (best > 0) window.tlScores?.submit(MODULE_ID, tenthsOfFeet(best))
    const list = this.readScores()
    if (best > 0) {
      list.push({ best, total, at: Date.now() })
      list.sort((a, b) => b.best - a.best)
      store.set(STORE_SCORES, JSON.stringify(list.slice(0, 5)))
    }
    const top = list[0]?.best === best && best > 0
    if (top) this.sfx.fanfare()
    $('endHeading').textContent = best <= 0 ? 'The fish got away' : top ? 'New personal best!' : best > 200 ? 'Huge flinging' : 'Nice flinging'
    $('endStats').innerHTML = `<div><span>Best shot</span><b>${meters(best)}</b><span>${feet(best)}</span></div><div><span>Total</span><b>${meters(total)}</b><span>${feet(total)}</span></div>`
    const names: Record<Shot['kind'], string> = { homer: 'Home run', pop: 'Pop fly', grounder: 'Grounder', whiff: 'Whiff', dropped: 'Dropped' }
    $('shotList').innerHTML = this.shots.map((s, i) => `<div class="${s.distance === best && best > 0 ? 'top' : ''}"><span>Fish ${i + 1} · ${names[s.kind]}${s.combo ? ` · ${s.combo}× boing` : ''}</span><b>${meters(s.distance)}</b></div>`).join('')
    this.renderLocalScores('endScores')
    this.renderLocalScores('localScores')
    for (const id of ['gauge', 'prompt', 'readout']) $(id).hidden = true
    $('endCard').hidden = false
    $('againBtn').focus()
    this.say(`Round complete. Best shot ${meters(best)}, total ${meters(total)}.`)
  }

  private readScores(): LocalScore[] {
    try {
      const data = JSON.parse(store.get(STORE_SCORES) ?? '[]') as unknown
      return Array.isArray(data) ? data.filter((s): s is LocalScore => typeof s?.best === 'number' && typeof s?.total === 'number' && typeof s?.at === 'number') : []
    } catch {
      return []
    }
  }

  private renderLocalScores(id: string): void {
    const list = this.readScores()
    const el = $(id)
    if (!list.length) { el.innerHTML = '<h3>Your best on this device</h3><p>No rounds yet: your top five will show here.</p>'; return }
    el.innerHTML = `<h3>Your best on this device</h3><ol>${list.map(s => `<li><span>${new Date(s.at).toLocaleDateString()}</span><b>${meters(s.best)}</b>&nbsp;·&nbsp;${meters(s.total)} total</li>`).join('')}</ol>`
  }

  private bestShot(): number {
    return this.shots.reduce((m, s) => Math.max(m, s.distance), 0)
  }

  private windLabel(): string {
    if (this.wind === 0) return 'calm'
    return `${this.wind > 0 ? 'tailwind' : 'headwind'} ${Math.abs(this.wind).toFixed(1)} m/s`
  }

  private updateHud(): void {
    const n = Math.min(this.shots.length + 1, SHOTS_PER_ROUND)
    $('shotNo').textContent = `${n} / ${SHOTS_PER_ROUND}`
    $('pips').innerHTML = Array.from({ length: SHOTS_PER_ROUND }, (_, i) => `<i class="${i < this.shots.length ? 'done' : i === this.shots.length ? 'now' : ''}"></i>`).join('')
    const best = this.bestShot()
    const total = this.shots.reduce((sum, s) => sum + s.distance, 0)
    $('best').textContent = best > 0 ? meters(best) : '—'
    $('total').textContent = total > 0 ? meters(total) : '—'
    $('windText').textContent = this.wind === 0 ? 'Calm' : `${this.wind > 0 ? '→' : '←'} ${Math.abs(this.wind).toFixed(1)} m/s`
    if (this.phase === 'ready') { $('dist').textContent = '0.0'; $('distFt').textContent = '0 ft' }
  }

  private updateGauge(): void {
    const show = this.phase === 'ready' || this.phase === 'toss' || this.phase === 'swing'
    const gauge = $('gauge')
    if (gauge.hidden === show && this.phase !== 'title' && this.phase !== 'end') gauge.hidden = !show
    if (!show) return
    const y = this.phase === 'ready' ? TOSS_START_Y : this.fish.root.position.y - CLIFF_HEIGHT
    gauge.style.setProperty('--fish', `${(Math.max(0, Math.min(GAUGE_TOP, y)) / GAUGE_TOP) * 100}%`)
  }

  private updateShadow(): void {
    const p = this.fish.root.position
    const ground = p.x < 2.6 ? CLIFF_HEIGHT : drift(p.x, p.z)
    const height = Math.max(0, p.y - ground)
    this.shadow.setEnabled(this.fish.root.isEnabled() && height < 40)
    this.shadow.position.set(p.x, ground + 0.04, p.z)
    const s = Math.max(0.3, 1.2 - height * 0.03)
    this.shadow.scaling.set(s * 1.4, s, 1)
  }

  private updateCamera(dt: number): void {
    const p = this.fish.root.position
    const desiredPos = new Vector3()
    const desiredTarget = new Vector3()
    if (this.phase === 'flight' || (this.phase === 'result' && this.flight)) {
      const flight = this.flight
      const vx = flight?.vx ?? 0
      const speed = flight ? Math.hypot(flight.vx, flight.vy) : 0
      const alt = Math.max(0, p.y)
      desiredTarget.set(p.x + Math.max(-2, Math.min(12, vx * 0.3)), p.y * 0.72 + 1, 0)
      desiredPos.set(p.x - 4 - Math.min(6, speed * 0.1), Math.max(2.4, p.y * 0.6 + 2.6), -(6.5 + alt * 0.45 + speed * 0.09))
      if (this.phase === 'result') { desiredPos.set(p.x - 5 + Math.sin(this.phaseTime * 0.4) * 1.5, 3.2, -8.5); desiredTarget.set(p.x, 0.6, 0) }
    } else {
      const toss = this.phase === 'toss' || this.phase === 'swing' || this.phase === 'fall'
      desiredPos.set(toss ? -2.0 : -2.8, CLIFF_HEIGHT + (toss ? 2.2 : 2.6), toss ? -7.0 : -8.2)
      desiredTarget.set(2.8, CLIFF_HEIGHT + (toss ? 1.0 : 0.6), 0)
      if (this.phase === 'title' || this.phase === 'end') {
        desiredPos.set(-3.6 + Math.sin(this.phaseTime * 0.2) * 1.2, CLIFF_HEIGHT + 3.4, -9.5)
        desiredTarget.set(6, CLIFF_HEIGHT - 0.5, 4)
      }
    }
    const instant = dt === 0
    const pk = instant ? 1 : damp(this.phase === 'flight' ? 3.2 : 4, dt)
    const tk = instant ? 1 : damp(this.phase === 'flight' ? 6 : 5, dt)
    const pos = this.camera.position
    pos.addInPlace(desiredPos.subtract(pos).scale(pk))
    this.camTarget.addInPlace(desiredTarget.subtract(this.camTarget).scale(tk))
    const target = this.camTarget.clone()
    if (this.shake > 0) {
      const s = this.shake * 0.5
      target.addInPlace(new Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s))
      this.shake = Math.max(0, this.shake - dt * 2.5)
    }
    this.camera.setTarget(target)
  }

  private callout(title: string, sub: string, seconds = 1.4): void {
    const el = $('callout')
    el.innerHTML = `${title}<small>${sub}</small>`
    el.classList.remove('show')
    void el.offsetWidth
    el.classList.add('show')
    this.calloutTimer = seconds
  }

  private say(text: string): void {
    $('live').textContent = text
  }
}
