import { CHAPTERS, LEVEL_COUNT, getLevel } from '../shared/Levels'
import { starsFor } from '../shared/Design'
import type { Design, Level } from '../shared/Design'
import { MATERIALS } from '../shared/Materials'
import type { MaterialId } from '../shared/Materials'
import { FRAME, Sim } from '../shared/Sim'
import { VEHICLES } from '../shared/Vehicles'
import { Editor } from './Editor'
import type { Placement } from './Editor'
import { Renderer, drawVehicleIcon } from './Renderer'
import { Sound } from './Sound'
import { loadSaved, loadSummary, readDraft, saveSolve, writeDraft } from './api'
import type { Summary } from './api'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const money = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`

type Mode = 'menu' | 'build' | 'test'

export class App {
  private readonly canvas = $<HTMLCanvasElement>('stage')
  private readonly renderer: Renderer
  private readonly sound = new Sound()
  private summary: Summary = { signedIn: false, progress: {}, points: 0, stars: 0 }
  private mode: Mode = 'menu'
  private level: Level = getLevel(1)
  private editor = new Editor(this.level)
  private sim: Sim | null = null
  private material: MaterialId = 'road'
  private deleting = false
  private stressView = true
  private speed = 1
  private dragStart: [number, number] | null = null
  private placement: Placement | null = null
  private hoverJoint: [number, number] | null = null
  private hoverBeam = -1
  private time = 0
  private accumulator = 0
  private last = performance.now()
  private resultShown = false
  private statusTimer = 0
  private brokenSeen = 0
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private dpr = 1

  constructor() {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    this.renderer = new Renderer(ctx)
    this.bind()
    this.resize()
    window.addEventListener('resize', () => this.resize())
    void this.refresh()
    this.renderMenu()
    requestAnimationFrame(now => this.frame(now))
    ;(window as unknown as { __bridge: unknown }).__bridge = this
  }

  private async refresh() {
    this.summary = await loadSummary()
    this.renderMenu()
  }

  private highestSolved(): number {
    return Object.keys(this.summary.progress).map(Number).reduce((max, n) => Math.max(max, n), 0)
  }

  private unlocked(index: number): boolean {
    return index <= this.highestSolved() + 3
  }

  private renderMenu() {
    const host = $('chapters')
    host.textContent = ''
    $('totalStars').textContent = `★ ${this.summary.stars}`
    $('totalPoints').textContent = this.summary.points ? `${this.summary.points.toLocaleString()} points` : ''
    CHAPTERS.forEach((chapter, c) => {
      const section = document.createElement('section')
      section.className = `bb-chapter t${chapter.theme}`
      const earned = Array.from({ length: 10 }, (_, k) => this.summary.progress[c * 10 + k + 1]?.stars ?? 0).reduce((a, b) => a + b, 0)
      section.innerHTML = `<header><h2>${c + 1}. ${chapter.name}</h2><p>${chapter.blurb}</p><span>★ ${earned}/30</span></header><div class="bb-levels"></div>`
      const grid = section.querySelector('.bb-levels') as HTMLElement
      for (let k = 0; k < 10; k++) {
        const index = c * 10 + k + 1
        const button = document.createElement('button')
        button.type = 'button'
        const open = this.unlocked(index)
        const stars = this.summary.progress[index]?.stars ?? 0
        button.className = `bb-level${open ? '' : ' locked'}${stars ? ' solved' : ''}`
        button.disabled = !open
        button.setAttribute('aria-label', `Level ${index}, ${getLevel(index).name}${open ? '' : ', locked'}${stars ? `, ${stars} stars` : ''}`)
        button.innerHTML = `<b>${index}</b><small>${open ? getLevel(index).name : '🔒'}</small><i>${'★'.repeat(stars)}<em>${'★'.repeat(3 - stars)}</em></i>`
        button.addEventListener('click', () => void this.openLevel(index))
        grid.append(button)
      }
      host.append(section)
    })
  }

  private async openLevel(index: number) {
    this.level = getLevel(index)
    this.editor = new Editor(this.level)
    this.editor.load(readDraft(index))
    this.sim = null
    this.mode = 'build'
    this.deleting = false
    this.material = this.level.materials.includes('road') ? 'road' : this.level.materials[0]
    $('menu').hidden = true
    $('buildTop').hidden = false
    $('tools').hidden = false
    $('result').hidden = true
    $('levelNum').textContent = String(index)
    $('levelName').textContent = this.level.name
    $('levelVehicles').textContent = this.level.vehicles.map(id => VEHICLES[id].name).join(' + ') + ` · up to ${(Math.max(...this.level.vehicles.map(id => VEHICLES[id].mass)) / 1000).toLocaleString()} t`
    $('budgetText').textContent = money(this.level.budget)
    const tip = $('tip')
    tip.textContent = this.level.tip
    tip.hidden = !this.level.tip
    this.renderMaterials()
    this.resize()
    this.updateHud()
    if (!this.editor.beams.length && this.summary.progress[index]) {
      const saved = await loadSaved(index)
      if (saved && this.level.index === index && !this.editor.beams.length) {
        this.editor.load(saved)
        this.updateHud()
      }
    }
  }

  private toMenu() {
    this.mode = 'menu'
    this.sim = null
    $('menu').hidden = false
    $('buildTop').hidden = true
    $('tools').hidden = true
    $('tip').hidden = true
    $('result').hidden = true
    this.renderMenu()
  }

  private renderMaterials() {
    const host = $('materials')
    host.textContent = ''
    this.level.materials.forEach((id, n) => {
      const material = MATERIALS[id]
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'bb-mat'
      button.setAttribute('role', 'radio')
      button.dataset.id = id
      button.title = `${material.name} (${n + 1}) · $${material.costPerMetre}/m · ${material.hint}`
      button.innerHTML = `<i style="--c:${material.color};--e:${material.edge}" class="sw ${id}"></i><span>${material.name}</span><small>$${material.costPerMetre}/m</small>`
      button.addEventListener('click', () => this.pickMaterial(id))
      host.append(button)
    })
    this.syncTools()
  }

  private pickMaterial(id: MaterialId) {
    if (this.mode !== 'build') return
    this.material = id
    this.deleting = false
    this.syncTools()
  }

  private syncTools() {
    for (const button of Array.from($('materials').children) as HTMLElement[]) {
      const on = !this.deleting && button.dataset.id === this.material
      button.classList.toggle('on', on)
      button.setAttribute('aria-checked', String(on))
    }
    $('deleteBtn').classList.toggle('on', this.deleting)
    $('deleteBtn').setAttribute('aria-pressed', String(this.deleting))
    $('stressBtn').classList.toggle('on', this.stressView)
    $('stressBtn').setAttribute('aria-pressed', String(this.stressView))
    $<HTMLButtonElement>('undoBtn').disabled = this.mode !== 'build' || !this.editor.canUndo()
    $<HTMLButtonElement>('redoBtn').disabled = this.mode !== 'build' || !this.editor.canRedo()
    $<HTMLButtonElement>('clearBtn').disabled = this.mode !== 'build' || !this.editor.beams.length
    $('speedBtn').firstChild!.textContent = `×${this.speed}`
    const test = $('testBtn')
    test.textContent = this.mode === 'test' ? '■ Stop' : '▶ Test'
    test.classList.toggle('stop', this.mode === 'test')
    $('tools').classList.toggle('testing', this.mode === 'test')
  }

  private updateHud() {
    const cost = this.editor.cost()
    const budget = this.level.budget
    $('costText').textContent = money(cost)
    const box = $('costBox')
    box.classList.toggle('over', cost > budget)
    const bar = $('costBar')
    bar.style.width = `${Math.min(100, (cost / budget) * 100)}%`
    const stars = starsFor(this.level, cost)
    bar.dataset.stars = String(stars)
    this.syncTools()
  }

  private flash(text: string, ms = 1800) {
    const status = $('status')
    status.textContent = text
    status.classList.add('show')
    clearTimeout(this.statusTimer)
    this.statusTimer = window.setTimeout(() => status.classList.remove('show'), ms)
  }

  private changed() {
    writeDraft(this.level.index, this.editor.design())
    this.updateHud()
  }

  private startTest() {
    if (this.mode !== 'build') return
    if (!this.editor.beams.some(beam => MATERIALS[beam.m].road)) {
      this.flash('Lay some road first: vehicles only drive on road.')
      this.sound.deny()
      return
    }
    this.sim = new Sim(this.level, this.editor.design())
    this.mode = 'test'
    this.resultShown = false
    this.brokenSeen = 0
    this.accumulator = 0
    this.placement = null
    this.dragStart = null
    $('tip').hidden = true
    this.sound.start()
    this.syncTools()
  }

  private stopTest() {
    this.sim = null
    this.mode = 'build'
    $('result').hidden = true
    $('tip').hidden = !this.level.tip
    this.syncTools()
  }

  private async finish(sim: Sim) {
    this.resultShown = true
    const cost = this.editor.cost()
    const passed = sim.status === 'passed'
    const stars = passed ? starsFor(this.level, cost) : 0
    const title = $('resultTitle')
    const text = $('resultText')
    const next = $<HTMLButtonElement>('nextBtn')
    $('resultStars').innerHTML = passed ? [1, 2, 3].map(n => `<span class="${n <= stars ? 'on' : ''}">★</span>`).join('') : ''
    if (passed && stars) {
      this.sound.win()
      title.textContent = 'Bridge held!'
      text.textContent = `${money(cost)} of ${money(this.level.budget)}. ${stars < 3 ? `Spend ${money(this.level.budget * (stars === 1 ? 0.92 : 0.8))} or less for ${stars === 1 ? 'two' : 'three'} stars.` : 'Top marks.'}`
      next.hidden = this.level.index >= LEVEL_COUNT
      const previous = this.summary.progress[this.level.index]
      if (!previous || cost < previous.cost) {
        this.summary.progress[this.level.index] = { cost, stars }
        const saved = await saveSolve(this.level.index, this.editor.design())
        if ('error' in saved) {
          if (this.summary.signedIn) text.textContent += ` ${saved.error}`
        } else {
          this.summary = saved
          window.parent?.postMessage({ type: 'tl-score-saved', module: 'bridge' }, location.origin)
        }
      }
    } else if (passed) {
      this.sound.lose()
      title.textContent = 'Over budget'
      text.textContent = `Everyone crossed, but it cost ${money(cost)} against a budget of ${money(this.level.budget)}. Trim ${money(cost - this.level.budget)} and try again.`
      next.hidden = true
    } else {
      this.sound.lose()
      title.textContent = 'Bridge failed'
      text.textContent = `${sim.reason} ${sim.breaks ? `${sim.breaks} beam${sim.breaks === 1 ? '' : 's'} snapped. Red beams were working hardest: add triangles or stronger material there.` : 'Make sure the road reaches all the way across.'}`
      next.hidden = true
    }
    $('result').hidden = false
    ;(passed && stars && !next.hidden ? next : $('retryBtn')).focus()
  }

  private bind() {
    $('backBtn').addEventListener('click', () => this.toMenu())
    $('testBtn').addEventListener('click', () => (this.mode === 'test' ? this.stopTest() : this.startTest()))
    $('deleteBtn').addEventListener('click', () => { this.deleting = !this.deleting; this.syncTools() })
    $('undoBtn').addEventListener('click', () => { if (this.editor.undo()) { this.sound.remove(); this.changed() } })
    $('redoBtn').addEventListener('click', () => { if (this.editor.redo()) { this.sound.place(); this.changed() } })
    $('clearBtn').addEventListener('click', () => { if (this.mode === 'build' && confirm('Remove every beam from this bridge?')) { this.editor.clear(); this.changed() } })
    $('stressBtn').addEventListener('click', () => { this.stressView = !this.stressView; this.syncTools() })
    $('speedBtn').addEventListener('click', () => { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1; this.syncTools() })
    $('retryBtn').addEventListener('click', () => this.stopTest())
    $('nextBtn').addEventListener('click', () => void this.openLevel(Math.min(LEVEL_COUNT, this.level.index + 1)))
    const canvas = this.canvas
    canvas.addEventListener('contextmenu', event => event.preventDefault())
    canvas.addEventListener('pointerdown', event => this.pointerDown(event))
    canvas.addEventListener('pointermove', event => this.pointerMove(event))
    canvas.addEventListener('pointerup', event => this.pointerUp(event))
    canvas.addEventListener('pointercancel', () => { this.dragStart = null; this.placement = null })
    canvas.addEventListener('pointerleave', () => { if (!this.dragStart) { this.hoverJoint = null; this.hoverBeam = -1 } })
    window.addEventListener('keydown', event => this.key(event))
  }

  private grid(event: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect()
    return this.renderer.toGrid(event.clientX - rect.left, event.clientY - rect.top)
  }

  private pointerDown(event: PointerEvent) {
    if (this.mode !== 'build') return
    const [gx, gy] = this.grid(event)
    const reach = event.pointerType === 'touch' ? 0.7 : 0.45
    if (this.deleting || event.button === 2) {
      const index = this.editor.nearestBeam(gx, gy, event.pointerType === 'touch' ? 0.45 : 0.3)
      if (index >= 0) {
        this.editor.remove(index)
        this.sound.remove()
        this.changed()
      }
      return
    }
    const joint = this.editor.nearestJoint(gx, gy, reach)
    if (!joint) {
      this.flash('Start a beam from an anchor or a joint.')
      return
    }
    this.dragStart = joint
    this.canvas.setPointerCapture(event.pointerId)
    this.placement = null
  }

  private pointerMove(event: PointerEvent) {
    if (this.mode !== 'build') return
    const [gx, gy] = this.grid(event)
    if (this.dragStart) {
      const distance = Math.hypot(gx - this.dragStart[0], gy - this.dragStart[1])
      this.placement = distance > 0.35 ? this.editor.plan(this.dragStart, gx, gy, this.material) : null
      this.hoverJoint = this.placement ? this.placement.end : this.dragStart
      const status = $('status')
      if (this.placement?.problem) { status.textContent = this.placement.problem; status.classList.add('show') }
      else if (this.placement) status.classList.remove('show')
      return
    }
    this.hoverJoint = this.deleting ? null : this.editor.nearestJoint(gx, gy)
    this.hoverBeam = this.deleting ? this.editor.nearestBeam(gx, gy) : -1
    this.canvas.style.cursor = this.deleting ? (this.hoverBeam >= 0 ? 'pointer' : 'default') : this.hoverJoint ? 'crosshair' : 'default'
  }

  private pointerUp(event: PointerEvent) {
    if (!this.dragStart) return
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    const placement = this.placement
    this.dragStart = null
    this.placement = null
    if (!placement) return
    if (placement.problem) {
      this.flash(placement.problem)
      this.sound.deny()
      return
    }
    if (this.editor.place(placement)) {
      this.sound.place()
      this.changed()
      $('status').classList.remove('show')
    }
  }

  private key(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement) return
    if (this.mode === 'menu') return
    const k = event.key.toLowerCase()
    if ((event.ctrlKey || event.metaKey) && k === 'z') {
      event.preventDefault()
      if (event.shiftKey ? this.editor.redo() : this.editor.undo()) this.changed()
      return
    }
    if ((event.ctrlKey || event.metaKey) && k === 'y') {
      event.preventDefault()
      if (this.editor.redo()) this.changed()
      return
    }
    if (k === ' ' || k === 'enter') {
      if (event.target instanceof HTMLButtonElement && k === 'enter') return
      event.preventDefault()
      if (!$('result').hidden) { this.stopTest(); return }
      if (this.mode === 'test') this.stopTest()
      else this.startTest()
      return
    }
    if (k === 'escape') {
      if (this.dragStart) { this.dragStart = null; this.placement = null }
      else if (this.mode === 'test') this.stopTest()
      else this.toMenu()
      return
    }
    if (k === 'd' || k === 'delete') { this.deleting = !this.deleting; this.syncTools(); return }
    if (k === 's') { this.stressView = !this.stressView; this.syncTools(); return }
    if (k === 'f') { $('speedBtn').click(); return }
    const n = Number(k)
    if (n >= 1 && n <= this.level.materials.length) this.pickMaterial(this.level.materials[n - 1])
  }

  private resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    const width = window.innerWidth
    const height = window.innerHeight
    this.canvas.width = Math.round(width * this.dpr)
    this.canvas.height = Math.round(height * this.dpr)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    const top = this.mode === 'menu' ? 0 : ($('buildTop').offsetHeight || 60) + 12
    const bottom = this.mode === 'menu' ? 0 : ($('tools').offsetHeight || 70) + 12
    this.renderer.fit(this.level, width, height, top, bottom)
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.time += dt
    const sim = this.sim
    if (sim) {
      this.accumulator += dt * this.speed
      let steps = 0
      while (this.accumulator >= FRAME && steps < 8) {
        sim.step()
        this.accumulator -= FRAME
        steps++
      }
      if (sim.breaks > this.brokenSeen) {
        this.brokenSeen = sim.breaks
        this.sound.snap()
      }
      if (sim.status !== 'running' && !this.resultShown && sim.time > 0) {
        this.resultShown = true
        window.setTimeout(() => { if (this.sim === sim) void this.finish(sim) }, sim.status === 'passed' ? 400 : 1200)
      }
    }
    const ctx = this.canvas.getContext('2d')!
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.renderer.draw({
      level: this.level,
      beams: this.editor.beams,
      sim: this.mode === 'test' ? this.sim : null,
      stressView: this.stressView,
      placement: this.placement,
      hoverJoint: this.hoverJoint,
      hoverBeam: this.hoverBeam,
      deleting: this.deleting,
      time: this.time,
      reduced: this.reduced,
    })
    requestAnimationFrame(next => this.frame(next))
  }

  vehicleIcon(canvas: HTMLCanvasElement, id: keyof typeof VEHICLES) {
    const ctx = canvas.getContext('2d')
    if (ctx) drawVehicleIcon(ctx, VEHICLES[id], canvas.width, canvas.height)
  }

  loadDesign(design: Design) {
    this.editor.load(design)
    this.changed()
  }
}
