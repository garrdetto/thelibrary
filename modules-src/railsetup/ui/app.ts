import * as THREE from 'three'
import * as K from '../sim/kin'
import type { Pose } from '../sim/kin'
import { CAD, parseHardpoints } from '../sim/hardpoints'
import type { Hardpoints } from '../sim/hardpoints'
import { ADJ0, DEFAULTS, RADJ0, SETUP_INPUTS, SLUGS, WEIGHTS } from '../sim/inputs'
import type { FrontAdj, RearAdj } from '../sim/inputs'
import { Lab, OUTROWS } from '../sim/lab'
import type { Model, Side, Snapshot } from '../sim/lab'
import { fileName, parseSetupFile, setupFile } from '../sim/files'
import { ChassisScene } from './scene'
import { BASELINE_NAME, TrackTest } from './track-test'
import { PGRP, buildCharts, markPlots, renderGroup } from './plots'
import { clearHardpoints, deleteSetup, loadRemote, readPrefs, saveHardpoints, saveSetup, writePrefs } from './store'
import type { Remote } from './store'

type El = HTMLInputElement & Pick<HTMLSelectElement, 'add' | 'options'>
const $ = (id: string) => document.getElementById(id) as El
const D = 180 / Math.PI
const sgn = (x: number) => x >= 0 ? '+' : '−'
const frac = (v: number) => (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(3)
const SIDES_LR: Side[] = ['L', 'R']
const KCTL: [string, keyof FrontAdj][] = [['k-ufz', 'ufz'], ['k-urz', 'urz'], ['k-ufx', 'ufx'], ['k-urx', 'urx'], ['k-lfz', 'lfz'], ['k-lrz', 'lrz'], ['k-lfx', 'lfx'], ['k-lrx', 'lrx'], ['k-cam', 'camber'], ['k-cas', 'caster'], ['k-tro', 'tro'], ['k-toe', 'toeIn'], ['k-ulen', 'ucaLen'], ['k-llen', 'lcaLen'], ['k-uax', 'ucaX'], ['k-tri', 'tri'], ['k-umh', 'umh'], ['k-lmh', 'lmh']]
const RK = Object.keys(RADJ0) as (keyof RearAdj)[]
const CAMDEF: Record<string, number[][]> = { main: [[200, -175, 115], [5, 0, 10]], 'kin-rear': [[-200, -45, 22], [-60, 0, 12]] }
const DRIVE = [[0, 0, 0.3], [1.2, 0, 0.3], [1.6, 0.05, -0.6], [2.6, 0.45, -0.45], [3.4, 1, -0.1], [4.6, 1, 0], [5.4, 0.85, 0.3], [6.6, 0.3, 0.35], [7.4, 0, 0.3], [8.4, 0, 0.3]]
const PHASES: [number, string][] = [[1.2, 'Straight'], [2.6, 'Braking'], [3.4, 'Turn-in, trail brake'], [4.6, 'Mid-corner'], [6.6, 'Throttle, exit'], [9, 'Straight']]
const LIVE_TIPS: Record<string, string> = { 'Camber to ground, °': 'Wheel tilt seen from the front, measured to the track. + = top of tire out.', 'Caster, °': 'Kingpin tilt seen from the side. + = upper ball joint behind the lower.', 'KPI, °': 'Kingpin inclination: kingpin tilt seen from the front. + = upper ball joint inboard.', 'Toe-out, °': 'Wheel steer angle. + = front of tire points out.', 'Bump steer, °/in': 'Toe change per inch of wheel travel around ride height. Zero is ideal.', 'Scrub radius, in': 'Distance at the ground from the kingpin line to the tire center, seen from the front.', 'Mech. trail, in': 'Distance at the ground from the kingpin line to the tire center, seen from the side.', 'Jacking force, lb': 'Vertical push of this tire on the chassis through the arm geometry: its cornering force along the instant-center line, plus its share of anti-dive under braking. Uses the Setup tab g. + lifts.', 'Anti-dive, %': 'How much of the braking dive the arm geometry resists. 100% = no dive.' }

export class App {
  readonly lab = new Lab()
  readonly scene: ChassisScene
  private tab: 'setup' | 'kin' | 'plots' = 'setup'
  private sel: Side | 'rear' = 'R'
  private ptab: 'front' | 'rear' = 'front'
  private pgrp: Record<'front' | 'rear', string> = { front: 'Alignment', rear: 'Roll' }
  private plotsDirty = true
  private plotsAt = 0
  private driving = false
  private driveT = 0
  private driveKeep = { g: 0, gx: 0 }
  private sweeping = false
  private sweepT = 0
  private exag = false
  private shown = 0
  private shownF = 0
  private shownR = 0
  private target = 0
  private lastKey = ''
  private lastT = 0
  private guess: Record<Side, Pose | null> = { L: null, R: null }
  private camMem: Record<string, { p: number[]; t: number[] }> = {}
  private saved: Snapshot[] = []
  private signedIn = false
  private readonly reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  private readonly tmpV = new THREE.Vector3()
  private readonly track: TrackTest

  constructor() {
    this.scene = new ChassisScene($('stage'), this.lab)
    this.track = new TrackTest(this.lab, () => $('sv-name').value.trim() || this.lab.BASE?.name || 'Current setup', () => $('tt-open').focus())
    this.buildInputs()
    this.bind()
    this.syncInputs()
    this.loadCorner()
    this.recompute()
    this.fold()
    const prefs = readPrefs()
    this.showHelp(!prefs.help)
    this.scene.load(() => { $('loading').hidden = true; this.recompute() }, () => { $('loading').textContent = 'Could not load the chassis model' })
    loadRemote().then(r => this.useRemote(r, true))
    requestAnimationFrame(t => this.frame(t))
  }

  private get m(): Model { return this.lab.model }

  private buildInputs() {
    const wsel = $('wt')
    for (const w of WEIGHTS) { const o = document.createElement('option'); o.value = String(w); o.textContent = w.toLocaleString('en-US'); wsel.appendChild(o) }
    for (const id of ['k-lslug', 'k-uslug']) for (const v of SLUGS) { const o = document.createElement('option'); o.value = String(v); o.textContent = v ? '+' + v + ' in' : 'As modeled'; $(id).appendChild(o) }
  }

  private syncInputs() {
    for (const s of SETUP_INPUTS) { const el = $(s.id); if (el && s.id !== 'adv') el.value = String(this.lab.inputs[s.id]) }
    $('adv').value = String(this.lab.inputs.adv)
    $('k-heave').value = String(this.lab.heave)
    $('k-roll').value = String(this.lab.roll)
    $('mr-fixed').checked = this.lab.mrFixedFlag
  }

  private readInput(id: string) {
    const raw = $(id).value
    this.lab.inputs[id] = raw === '' || Number.isNaN(+raw) ? DEFAULTS[id] : +raw
  }

  private bind() {
    const setupIds = SETUP_INPUTS.map(s => s.id).filter(id => id !== 'adv')
    for (const id of setupIds) {
      const el = $(id)
      if (!el) continue
      el.addEventListener('input', () => { this.readInput(id); this.update() })
    }
    $('mr-fixed').addEventListener('change', () => { this.lab.mrFixedFlag = $('mr-fixed').checked; this.recompute() })
    $('m-std').onclick = () => { this.lab.inputs.adv = 0; $('adv').value = '0'; this.update() }
    $('m-adv').onclick = () => { this.lab.inputs.adv = 1; $('adv').value = '1'; this.update() }
    $('t-setup').onclick = () => this.setTab('setup')
    $('t-kin').onclick = () => { this.setTab('kin'); this.recompute() }
    $('t-plots').onclick = () => this.setTab('plots')
    $('v-front').onclick = () => this.scene.view([270, 0, 30], [5, 0, 10])
    $('v-34').onclick = () => this.scene.view([200, -175, 115], [5, 0, 10])
    $('v-top').onclick = () => this.scene.view([5, -1, 330], [5, 0, 10])
    $('v-side').onclick = () => this.scene.view([5, -300, 25], [5, 0, 10])
    $('v-exag').onclick = () => { this.exag = !this.exag; $('v-exag').setAttribute('aria-pressed', String(this.exag)); this.lastKey = '' }
    $('v-help').onclick = () => this.showHelp($('help').hidden)
    $('help-close').onclick = () => { this.showHelp(false); writePrefs({ help: true }) }
    for (const t of ['front', 'rear'] as const) $('pt-' + t).onclick = () => {
      this.ptab = t
      $('pt-front').setAttribute('aria-selected', String(t === 'front')); $('pt-rear').setAttribute('aria-selected', String(t === 'rear'))
      $('pl-front').hidden = t !== 'front'; $('pl-rear').hidden = t !== 'rear'
      this.plotsDirty = true; this.plotsAt = 0
    }
    KCTL.forEach(([id, key]) => $(id).addEventListener('input', () => this.kinInput(id, key)))
    ;(['k-lslug', 'k-uslug'] as const).forEach(id => $(id).addEventListener('change', () => { if (this.sel === 'rear') return; this.lab.adj[this.sel][id === 'k-lslug' ? 'lslug' : 'uslug'] = +$(id).value; this.recompute() }))
    $('k-steer').addEventListener('input', () => { this.lab.setSteer(+$('k-steer').value); $('k-steer-o').textContent = frac(+$('k-steer').value); this.update() })
    const camFront = () => this.scene.view([200, -60, 40], [48, 0, 12])
    const pick = (s: Side) => { const w = this.sel === 'rear'; if (w) this.saveCam(); this.sel = s; this.loadCorner(); if (w) this.restoreCam() }
    $('c-lf').onclick = () => pick('L')
    $('c-rf').onclick = () => pick('R')
    $('k-casview').onclick = () => this.scene.view(this.sel === 'L' ? [52, 150, 16] : [52, -150, 16], [52, 0, 12])
    $('k-frview').onclick = camFront
    $('c-rear').onclick = () => { if (this.sel !== 'rear') this.saveCam(); this.sel = 'rear'; this.loadCorner(); this.restoreCam(); this.lastKey = '' }
    RK.forEach(k => $('r-' + k).addEventListener('input', () => this.rearInput(k)))
    $('k-reset').onclick = () => {
      if (this.sel === 'rear') { this.lab.radj = { ...RADJ0 }; this.lab.rearSet(); this.loadCorner(); this.update(); this.lastKey = ''; return }
      this.lab.adj[this.sel] = { ...ADJ0 }; this.loadCorner(); this.recompute()
    }
    ;(['k-heave', 'k-roll'] as const).forEach(id => $(id).addEventListener('input', () => { this.stopSweep(); this.readPose(); this.outputs(); this.update() }))
    $('k-sweep').onclick = () => { this.sweeping = !this.sweeping; this.sweepT = 0; $('k-sweep').textContent = this.sweeping ? 'Stop sweep' : 'Sweep bump and droop' }
    $('k-zero').onclick = () => { this.stopSweep(); $('k-heave').value = '0'; $('k-roll').value = '0'; this.readPose(); this.outputs(); this.update() }
    for (const id of ['tt-open', 'v-track']) $(id).onclick = () => { this.stopDrive(); this.stopSweep(); this.track.show() }
    $('tt-base').onclick = () => { void this.saveBaseline() }
    $('tt-base-reset').onclick = () => { void this.resetBaseline() }
    $('drive').onclick = () => { if (this.driving) { this.stopDrive(); return } this.driveKeep = { g: +$('g').value, gx: +$('gx').value }; this.driving = true; this.driveT = 0; $('drive').textContent = '■ Stop' }
    ;(['g', 'gx'] as const).forEach(id => $(id).addEventListener('pointerdown', () => this.stopDrive()))
    $('reset-setup').onclick = () => { this.stopDrive(); for (const s of SETUP_INPUTS) this.lab.inputs[s.id] = DEFAULTS[s.id]; this.syncInputs(); this.update() }
    $('reset-all').onclick = () => {
      this.stopDrive(); this.lab.resetAll(); this.syncInputs()
      $('k-heave').value = '0'; $('k-roll').value = '0'; this.readPose(); this.loadCorner(); this.recompute()
    }
    $('sv-save').onclick = () => this.saveCurrent()
    $('sv-load').onclick = () => { const x = this.saved[+$('sv-list').value]; if (x) this.applySnapshot(x) }
    $('sv-del').onclick = () => this.deleteSelected()
    $('sv-exp').onclick = () => { const x = this.saved[+$('sv-list').value]; if (x) download(fileName(x.name), setupFile(x)) }
    $('sv-imp').onclick = () => $('sv-file').click()
    $('sv-file').onchange = async e => {
      const input = e.target as HTMLInputElement, f = input.files?.[0]
      input.value = ''
      if (!f) return
      try {
        const list = parseSetupFile(JSON.parse(await f.text()))
        for (const x of list) { this.saved = this.saved.filter(s => s.name !== x.name); this.saved.push(x); if (this.signedIn) await this.remote(saveSetup(x)) }
        this.fillLists(); $('sv-list').value = String(this.saved.length - 1)
      } catch (err) { alert('Could not import that file: ' + (err as Error).message) }
    }
    $('sv-cmp').onchange = () => this.compareTable()
    $('hp-load').onclick = () => $('hp-file').click()
    $('hp-file').onchange = async e => {
      const input = e.target as HTMLInputElement, f = input.files?.[0]
      input.value = ''
      if (!f) return
      try {
        const hp = parseHardpoints(JSON.parse(await f.text()))
        this.useHardpoints(hp, f.name)
        if (this.signedIn) this.remote(saveHardpoints(f.name.slice(0, 80), hp))
      } catch (err) { alert('Could not use that file: ' + (err as Error).message); this.useHardpoints(null, null) }
    }
    $('hp-save').onclick = () => download('hardpoints.json', this.lab.rawHardpoints())
  }

  private readPose() {
    this.lab.heave = +$('k-heave').value
    this.lab.roll = +$('k-roll').value
  }

  private stopSweep() {
    this.sweeping = false
    $('k-sweep').textContent = 'Sweep bump and droop'
  }

  private kinInput(id: string, key: keyof FrontAdj) {
    if (this.sel === 'rear') return
    const a = this.lab.adj[this.sel], v = +$(id).value
    if (!key.startsWith('l')) {
      if ($('k-tog').checked && (key === 'ufz' || key === 'urz')) { a.ufz = a.urz = v; $('k-ufz').value = $('k-urz').value = String(v) } else if ($('k-tog').checked && (key === 'ufx' || key === 'urx')) { a.ufx = a.urx = v; $('k-ufx').value = $('k-urx').value = String(v) } else a[key] = v
    } else if ($('k-ltog').checked && (key === 'lfz' || key === 'lrz')) { a.lfz = a.lrz = v; $('k-lfz').value = $('k-lrz').value = String(v) } else if ($('k-ltog').checked && (key === 'lfx' || key === 'lrx')) { a.lfx = a.lrx = v; $('k-lfx').value = $('k-lrx').value = String(v) } else a[key] = v
    this.recompute()
    this.outputs()
  }

  private rearInput(k: keyof RearAdj) {
    const r = this.lab.radj, v = +$('r-' + k).value
    if ($('r-tog').checked && (k === 'TBa' || k === 'TBc')) { r.TBa = r.TBc = v; $('r-TBa').value = $('r-TBc').value = String(v) } else if ($('r-utog').checked && (k === 'ULya' || k === 'ULyc')) {
      const d = v - r[k], o = k === 'ULya' ? 'ULyc' : 'ULya', e = $('r-' + o)
      r[k] = v; e.value = String(r[o] + d); r[o] = +e.value
    } else r[k] = v
    this.lab.rearSet()
    this.outputs()
    this.update()
    this.lastKey = ''
  }

  private saveCam() { this.camMem[this.camKey()] = { p: this.scene.cam.position.toArray(), t: this.scene.controls.target.toArray() } }
  private restoreCam() { const m = this.camMem[this.camKey()]; if (m) this.scene.view(m.p, m.t); else this.scene.view(CAMDEF[this.camKey()][0], CAMDEF[this.camKey()][1]) }
  private camKey() { return this.sel === 'rear' ? 'kin-rear' : 'main' }

  private setTab(t: 'setup' | 'kin' | 'plots') {
    this.tab = t
    this.lastKey = ''
    for (const x of ['setup', 'kin', 'plots']) { $('t-' + x).setAttribute('aria-selected', String(t === x)); $('p-' + x).hidden = t !== x }
    $('stage').hidden = t === 'plots'
    $('plots').hidden = t !== 'plots'
    if (t === 'plots') this.plotsDirty = true
    $('stats-setup').hidden = t !== 'setup'
    $('stats-kin').hidden = !(t === 'kin' && this.sel !== 'rear')
    $('stats-rear').hidden = !(t === 'kin' && this.sel === 'rear')
    const s = this.scene
    s.discs.forEach(d => d.visible = t === 'setup')
    s.tags.forEach(x => x.style.visibility = t === 'setup' ? 'visible' : 'hidden')
    s.axisLine.visible = s.cgDot.visible = t === 'setup'
    s.rcDot.visible = t === 'kin'
    for (const k of SIDES_LR) s.icLines[k].visible = t === 'kin'
    $('leg-axis').textContent = t === 'kin' ? 'Instant center lines' : 'Roll axis'
    $('sub').textContent = t === 'kin' ? 'Straight rail · front suspension kinematics' : 'Straight rail · steady-state corner'
    if (t !== 'plots') requestAnimationFrame(() => s.resize())
  }

  private tbName() { return this.lab.radj.TBtype ? 'J-Bar' : 'Track bar' }

  private loadCorner() {
    this.lastKey = ''
    $('c-lf').setAttribute('aria-pressed', String(this.sel === 'L')); $('c-rf').setAttribute('aria-pressed', String(this.sel === 'R')); $('c-rear').setAttribute('aria-pressed', String(this.sel === 'rear'))
    const rr = this.sel === 'rear'
    $('k-front').hidden = $('k-front-out').hidden = rr
    $('k-rear').hidden = $('k-rear-out').hidden = !rr
    RK.forEach(k => { $('r-' + k).value = String(this.lab.radj[k]) })
    $('stats-kin').hidden = !(this.tab === 'kin' && !rr)
    $('stats-rear').hidden = !(this.tab === 'kin' && rr)
    if (this.tab === 'kin') $('sub').textContent = rr ? 'Straight rail · rear ' + this.tbName().toLowerCase() + ' and jacking' : 'Straight rail · front suspension kinematics'
    if (!rr) {
      const a = this.lab.adj[this.sel as Side]
      KCTL.forEach(([id, key]) => { $(id).value = String(a[key]) })
      $('k-lslug').value = String(a.lslug); $('k-uslug').value = String(a.uslug)
    }
    this.outputs()
  }

  private outputs() {
    KCTL.forEach(([id]) => { $(id + '-o').textContent = frac(+$(id).value) })
    $('k-steer-o').textContent = frac(+$('k-steer').value)
    if (this.sel !== 'rear' && this.lab.kc[this.sel]) {
      const c = this.lab.casterNow(this.sel).toFixed(1) + '°'
      $('k-cas-o').textContent = frac(+$('k-cas').value) + ' → ' + c
      $('k-uax-o').textContent = frac(+$('k-uax').value) + ' → ' + c
    }
    RK.forEach(k => { const o = document.getElementById('r-' + k + '-o'); if (o) o.textContent = frac(+$('r-' + k).value) })
    this.tbText()
    const at = (y: number) => ' → ' + Math.abs(y).toFixed(1) + (y > 0.05 ? ' L' : y < -0.05 ? ' R' : '')
    $('r-ULya-o').textContent += at(this.lab.RG0.A.UL[1] + this.lab.radj.ULya)
    $('r-ULyc-o').textContent += at(this.lab.RG0.C.UL[1] + this.lab.radj.ULyc)
    $('k-heave-o').textContent = (+$('k-heave').value).toFixed(2)
    $('k-roll-o').textContent = (+$('k-roll').value).toFixed(2)
  }

  private tbText() {
    const j = this.lab.radj.TBtype, f = this.lab.radj.TBflip
    $('r-tbleg').textContent = this.tbName()
    if (/^Straight rail · rear /.test($('sub').textContent || '')) $('sub').textContent = 'Straight rail · rear ' + this.tbName().toLowerCase() + ' and jacking'
    $('r-tbnote').textContent = (j ? 'Axle end is near the pinion, chassis end on the ' : 'Axle end is on the ' + (f ? 'right' : 'left') + ' side of the housing, chassis end on the ') + (f ? 'left' : 'right') + ' frame rail ahead of the axle' + (f ? ' (reversed)' : '') + '. The bar length changes so the axle stays centered at ride height.'
  }

  private recompute() {
    this.lab.recompute()
    this.after()
  }

  private update() {
    this.lab.update()
    this.after()
  }

  private after() {
    this.scene.deformWheels(id => this.lab.num(id))
    this.partsTable()
    this.render()
  }

  private partsTable() {
    $('k-parts').innerHTML = this.lab.partsRows().map(r => '<tr><td>' + r.name + '</td>' + [[r.L, r.dL], [r.R, r.dR]].map(([v, d]) => '<td class="' + (Math.abs(d) > 5e-4 ? 'chg' : '') + '">' + v.toFixed(3) + (Math.abs(d) > 5e-4 ? ' (' + (d > 0 ? '+' : '−') + Math.abs(d).toFixed(3) + ')' : '') + '</td>').join('') + '</tr>').join('')
  }

  private render() {
    const lab = this.lab, m = this.m, num = (id: string) => lab.num(id)
    const fmt3 = ['bar', 'bid', 'rbar', 'hlf', 'hrf', 'hrr', 'bpre', 'glf', 'grf', 'glr', 'grr']
    for (const id of ['g', 'mrb', 'arm', 'rsb', 'unf', 'unr', 'bb', 'rad', 'gx', 'bank']) {
      const o = document.getElementById(id + '-o')
      if (!o) continue
      const v = lab.inputs[id]
      o.textContent = fmt3.includes(id) ? v.toFixed(3) : id === 'mrb' ? v.toFixed(2) : id === 'g' || id === 'gx' ? v.toFixed(2) : id === 'bank' ? v.toFixed(1) + '°' : String(v)
    }
    {
      const o = lab.wheelGeom(), f = (x: number) => sgn(x) + Math.abs(x).toFixed(2)
      $('trk-note').textContent = 'Front track ' + lab.TF.toFixed(2) + ' in (LF ' + f(o.lf) + ', RF ' + f(o.rf) + ') · rear track ' + lab.TR.toFixed(2) + ' in (LR ' + f(o.lr) + ', RR ' + f(o.rr) + '), wheel centers out vs the CAD car.'
    }
    {
      const adv = lab.inputs.adv === 1
      $('adv-box').hidden = !adv
      document.querySelectorAll<HTMLElement>('.std').forEach(e => e.hidden = adv)
      $('m-std').setAttribute('aria-pressed', String(!adv)); $('m-adv').setAttribute('aria-pressed', String(adv))
      $('cr').readOnly = adv
      if (adv && lab.adv) {
        const A = lab.adv, C = ['LF', 'RF', 'LR', 'RR']
        ;(['hlf', 'hrf', 'hrr', 'cr'] as const).forEach(id => { $(id).value = String(lab.inputs[id]) })
        ;['lf', 'rf', 'lr', 'rr'].forEach(c => { $('ak-' + c).textContent = String(num(c)) })
        const row = (n: string, a: number[], d: number) => '<tr><td>' + n + '</td>' + a.map(x => '<td>' + x.toFixed(d) + '</td>').join('') + '</tr>'
        $('adv-out').innerHTML = row('Installed length, in', A.len, 3) + row('Corner wt, lb', A.loads, 0) + row('Ride ht, in', A.hts, 3)
        const top = C.filter((_c, i) => A.top[i]), flat = C.filter((_c, i) => A.len[i] <= 0)
        $('adv-note').textContent = (!A.ok ? 'These springs can\'t hold the car up: check the numbers. ' : '') + (flat.length ? flat.join(', ') + ': spring squeezed past its free length. ' : '') + (top.length ? top.join(', ') + ': shock topped out, that tire is light or off the ground. ' : '') + 'Cross with the bar unhooked: ' + (A.cross * 100).toFixed(1) + '%.'
      }
    }
    $('bank-note').hidden = !m.bank
    if (m.bank) $('bank-note').textContent = 'On ' + (m.bank * D).toFixed(1) + '° of banking: ' + m.ay.toFixed(2) + ' g across the track (load transfer, balance) and ' + m.nz.toFixed(2) + '× weight into it (more total grip).' + (m.ay < 0 ? ' Below this g the car would slide down the banking.' : '')
    $('hlr-o').textContent = m.rs.lr.toFixed(3)
    {
      const t = m.rs.t, L = lab.scaleLoads(), k = num('tk'), row = (n: string, f: (i: number) => string) => '<tr><td>' + n + '</td>' + [0, 1, 2, 3].map(i => '<td>' + f(i) + '</td>').join('') + '</tr>'
      $('tire-tab').innerHTML = row('Loaded radius, in', i => (t[i] + K.TIRE_R).toFixed(3)) + row('Squash, in', i => (Math.max(0, L[i]) / k).toFixed(3))
      const st = num('tcrr') - num('tclr'), fs = num('tcrf') - num('tclf')
      $('tire-note').textContent = 'Stagger ' + st.toFixed(2) + ' in (RR − LR), front ' + fs.toFixed(2) + ' in (RF − LF). Squash at the scale weights. Rear tire sizes lift the RR side ' + (t[3] - t[2]).toFixed(2) + ' in over the LR.'
    }
    {
      const s3 = (x: number) => sgn(x) + Math.abs(x).toFixed(3)
      ;['rnlf', 'rnrf', 'rnlr', 'rnrr'].forEach((id, i) => { $(id + '-o').textContent = s3(m.rest.rnd[i]) })
      $('rh-now').innerHTML = '<tr><td>Ride ht now</td>' + m.rest.hNow.map(h => '<td>' + h.toFixed(3) + '</td>').join('') + '</tr>'
    }
    $('scale-leg').textContent = 'Scales, ' + m.W.toLocaleString('en-US') + ' lb'
    {
      const d = m.dStatic, big = d.some(x => Math.abs(x) >= 0.5), f = (x: number) => sgn(x) + Math.abs(x).toFixed(0)
      $('wdg-note').textContent = big ? 'Rounds and bar preload change the scaled weights: LF ' + f(d[0]) + ', RF ' + f(d[1]) + ', LR ' + f(d[2]) + ', RR ' + f(d[3]) + ' lb. Cross is now ' + (m.cross * 100).toFixed(1) + '%.' : ''
      const pre = lab.inputs.bpre
      $('bpre-note').textContent = pre < 0 ? 'Slack: the bar starts working at ' + (m.slackRoll * D).toFixed(2) + '° of roll.' + (m.phi > m.slackRoll ? ' It is working in this turn.' : ' It is not working in this turn.') : pre > 0 ? 'Preloaded: loads RF and LR at rest (see Scales).' : '− = slack, + = preload.'
    }
    {
      const t = m.bump, f = (x: number) => sgn(x) + Math.abs(x).toFixed(2)
      $('bump-tab').innerHTML = '<tr><td>Travel at shock, in</td>' + t.map(c => '<td>' + f(c.s) + '</td>').join('') + '</tr><tr><td>Into bump, in</td>' + t.map(c => '<td' + (c.into > 0 ? ' class="chg"' : '') + '>' + (c.kb ? (c.into > 0 ? c.into.toFixed(2) : 'gap ' + c.left.toFixed(2)) : '—') + '</td>').join('') + '</tr>'
    }
    this.target = m.phi
    this.plotsDirty = true
    $('roll').textContent = (m.phi * D).toFixed(2) + '°'
    const turning = m.ayH >= 0.05
    $('lltd').textContent = turning ? (m.lltd * 100).toFixed(1) + '%' : '—'
    $('rc-s').textContent = m.hf.toFixed(2) + ' in'
    { const t = m.fj.tot + m.fjL; $('fjk-s').textContent = sgn(t) + Math.abs(t).toFixed(0) + ' lb' }
    $('rrc-s').textContent = m.hr.toFixed(2) + ' in'
    { const t = m.jk.Fz + m.rjL; $('jack-s').textContent = sgn(t) + Math.abs(t).toFixed(0) + ' lb' }
    $('ride-s').textContent = sgn(m.dzF) + Math.abs(m.dzF).toFixed(2) + ' / ' + sgn(m.dzR) + Math.abs(m.dzR).toFixed(2)
    $('pitch-s').textContent = sgn(m.pitch) + Math.abs(m.pitch * D).toFixed(2) + '°'
    $('rst-s').textContent = sgn(m.ta.steer) + Math.abs(m.ta.steer).toFixed(2) + '°'
    $('bal-s').textContent = !turning ? '—' : sgn(m.bal) + Math.abs(m.bal).toFixed(1) + (Math.abs(m.bal) < 1 ? ' neutral' : m.bal > 0 ? ' tight' : ' loose')
    $('stg-s').textContent = sgn(m.stg) + Math.abs(m.stg).toFixed(2) + ' in'
    {
      const k = (x: number) => Math.round(x * Math.PI / 180).toLocaleString('en-US'), f = m.Kfront, r = m.Krear
      $('rk-note').textContent = 'Roll stiffness, in-lb/°: front ' + k(f) + ' · rear ' + k(r) + ' (' + Math.round(r / (f + r) * 100) + '% of total) · chassis twist ' + ((m.phiF - m.phiR) * D).toFixed(2) + '° in this turn.'
    }
    $('mr-note').textContent = 'Spring MR at ride height: ' + (lab.mrFixed() ? 'front fixed at 0.65' : 'LF ' + m.mrL.toFixed(2) + ', RF ' + m.mrR.toFixed(2)) + ', LR ' + lab.MRTR.L.mr0.toFixed(2) + ', RR ' + lab.MRTR.R.mr0.toFixed(2) + ' from the coilover geometry · bar length 38 in'
    { const c = (k: Side) => K.angles(lab.base[k], K.poseH(lab.base[k], 0, null)).caster.toFixed(1); $('cas-base').textContent = 'As modelled this car is LF ' + c('L') + '°, RF ' + c('R') + '°.' }
    $('geo-note').textContent = 'Wheelbase ' + lab.WB.toFixed(2) + ' in, front track ' + lab.TF0.toFixed(2) + ' in, rear track ' + lab.TR0.toFixed(2) + ' in (15 × 10 wheels as modeled).'
    this.compareTable()
    m.loads.forEach((w, i) => {
      const r = Math.sqrt(Math.max(w, 0)) * 0.55, d = this.scene.discs[i]
      d.scale.set(r, r, 1)
      const t = Math.min(Math.max(w / (m.W * 0.45), 0), 1)
      ;(d.material as THREE.MeshBasicMaterial).color.setHSL(0.6 - 0.6 * t, 0.75, 0.5)
      this.scene.tags[i].innerHTML = '<i>' + ['LF', 'RF', 'LR', 'RR'][i] + '</i>' + (w < 0 ? '0 lb · lifted' : Math.round(w) + ' lb')
      d.position.set(lab.TIRE[i][0], lab.TIRE[i][1], 0.05)
    })
    const msg = lab.warnings()
    $('warn').hidden = !msg.length
    $('warn').textContent = msg.join(' ')
    const TIRE = lab.TIRE
    this.scene.setLine(this.scene.axisLine, [[TIRE[0][0] + 12, 0, m.hf], [TIRE[2][0] - 12, 0, m.hr]])
    this.scene.cgDot.position.set(TIRE[0][0] - lab.WB * (1 - m.front), 0, m.h)
  }

  private gNote() {
    const m = this.m
    $('k-gnote').textContent = 'Jacking uses ' + m.ay.toFixed(2) + ' lateral g' + (m.bank ? ' (across the banking)' : '') + ' and ' + (m.gx > 0 ? '+' : m.gx < 0 ? '−' : '') + Math.abs(m.gx).toFixed(2) + ' long g from the Setup tab.'
  }

  private liveTable(P: Record<Side, Pose>, rollDeg: number, hb: number) {
    const L = this.lab.live(P, rollDeg, hb), { A, cg, ad, fj } = L
    this.gNote()
    $('k-fjk').textContent = sgn(fj.tot) + Math.abs(fj.tot).toFixed(0) + ' lb (' + sgn(fj.dz) + Math.abs(fj.dz).toFixed(2) + ' in)'
    const rows: [string, (s: Side) => string][] = [['Camber to ground, °', s => cg[s].toFixed(2)], ['Caster, °', s => A[s].caster.toFixed(2)], ['KPI, °', s => A[s].kpi.toFixed(2)],
      ['Toe-out, °', s => A[s].toe.toFixed(3)], ['Jacking force, lb', s => sgn(fj[s]) + Math.abs(fj[s]).toFixed(1)], ['Bump steer, °/in', s => L.bs[s].toFixed(3)], ['Scrub radius, in', s => A[s].scrub.toFixed(2)], ['Mech. trail, in', s => A[s].trail.toFixed(2)], ['Anti-dive, %', s => ad[s].toFixed(1)]]
    $('k-tab').innerHTML = rows.map(([n, f]) => '<tr><td><abbr title="' + LIVE_TIPS[n] + '">' + n + '</abbr></td><td>' + f('L') + '</td><td>' + f('R') + '</td></tr>').join('')
    $('k-lfc').textContent = cg.L.toFixed(2) + '°'
    $('k-rfc').textContent = cg.R.toFixed(2) + '°'
    if (L.rc) { $('k-rch').textContent = L.rch.toFixed(2) + ' in'; $('k-rcy').textContent = Math.abs(L.rc[0]).toFixed(2) + (L.rc[0] > 0 ? ' in L' : ' in R') }
    return L
  }

  private rearTable(rp: K.RearPose) {
    const R = this.lab.rearReport(rp), { jk, tl, as } = R, s = (x: number, d: number) => sgn(x) + Math.abs(x).toFixed(d), tb = this.tbName()
    this.gNote()
    const len = (x: { v: number; d: number }) => x.v.toFixed(3) + (Math.abs(x.d) > 5e-4 ? ' (' + (x.d > 0 ? '+' : '−') + Math.abs(x.d).toFixed(3) + ')' : '')
    const rows: [string, string, string][] = [['Rear RC height, in', 'The point the axle swings about when the body rolls, seen from the front, above the ground.', rp.rcz.toFixed(2)],
      ['Jacking force, lb', 'Vertical push of the links and track bar (cornering) plus anti-lift or anti-squat (braking or throttle) on the chassis. + lifts the rear.', s(jk.Fz, 1)],
      ['Rear ride change, in', 'Jacking force ÷ (LR + RR spring rate). + = rear rises.', s(jk.dz, 3)],
      ['Lateral force, lb', '(Rear weight − rear unsprung) × lateral g from the Setup tab.', jk.Fy.toFixed(0)],
      ['Rear steer, °', 'Axle steer at this roll and ride height. + = axle aims right (LR ahead of RR), loosens the car.', s(rp.steer, 3)],
      ['Pinion change, °', 'Pinion angle change from ride height. + = pinion up.', s(rp.pinion, 2)],
      ['Axle side shift, in', 'How far the axle moves sideways under the body. + = left.', rp.shift.toFixed(3)],
      ['LR wheelbase change, in', '+ = longer.', s(rp.wbL, 3)], ['RR wheelbase change, in', '+ = longer.', s(rp.wbR, 3)],
      ['Anti-squat, %', 'Side-view line from the rear contact patch to where each lower link meets the 3rd link, × wheelbase ÷ CG height, averaged left and right. 100% = no squat under power.', (as * 100).toFixed(0)],
      [tb + ' angle, °', 'Rise from axle end to chassis end. + = chassis end higher.', rp.tbAng.toFixed(2)],
      ['3rd link angle, °', 'Side view. + = chassis end higher.', R.ang.UL.toFixed(2)],
      ['3rd link offset, in', 'Axle end from the center of the housing. + = left.', s(tl.y, 2)],
      ['3rd link force, lb', 'Pull in the 3rd link from drive (throttle) or the rear brakes, at the Long g on the Setup tab. + = tension (throttle), − = compression (braking).', s(tl.u, 0)],
      ['3rd link side pull, lb', 'Sideways part of that force on the housing, held by the track bar or J-Bar. + = pulls the axle left.', s(tl.side, 0)],
      ['LR load from 3rd link, lb', 'Rear load moved by the up or down part of the 3rd link force acting off center. + = onto the LR (off the RR by the same amount). Grows with link angle and offset; flips between throttle and brakes.', s(tl.dLR, 1)],
      ['LR link angle, °', 'Side view. + = chassis end higher.', R.ang.LL.toFixed(2)], ['RR link angle, °', 'Side view. + = chassis end higher.', R.ang.RL.toFixed(2)],
      [tb + ' length, in', 'Follows the end moves so the axle stays centered at ride height.' + (this.lab.radj.TBtype ? ' Measured between the rod ends; the bend is not counted.' : ''), len(R.len.TB)], ['3rd link length, in', '', len(R.len.UL)],
      ['LR link length, in', '', len(R.len.LL)], ['RR link length, in', '', len(R.len.RL)]]
    $('q-rc').textContent = rp.rcz.toFixed(2) + ' in'; $('q-ang').textContent = rp.tbAng.toFixed(2) + '°'; $('q-jk').textContent = s(jk.Fz, 0) + ' lb'; $('q-sh').textContent = rp.shift.toFixed(3) + ' in'
    $('q-st').textContent = s(rp.steer, 2) + '°'; $('q-pin').textContent = s(rp.pinion, 2) + '°'
    $('q-tl').textContent = s(tl.u, 0) + ' lb'; $('q-tlr').textContent = s(tl.dLR, 1) + ' lb'
    $('r-tab').innerHTML = rows.map(([n, tip, v]) => '<tr><td>' + (tip ? '<abbr title="' + tip + '">' + n + '</abbr>' : n) + '</td><td' + (/\(/.test(v) ? ' class="chg"' : '') + '>' + v + '</td></tr>').join('')
    return jk
  }

  private drawPlots() {
    const { specs, key, note } = buildCharts(this.lab, this.ptab, this.tbName())
    $('pkey').innerHTML = key
    $('pnote').textContent = note
    const G = PGRP[this.ptab], grp = this.pgrp[this.ptab]
    $('pgroups').innerHTML = G.map(g => '<button aria-pressed="' + (g === grp) + '">' + g + '</button>').join('')
    $('pgroups').querySelectorAll('button').forEach(b => b.onclick = () => { this.pgrp[this.ptab] = b.textContent || G[0]; this.plotsDirty = true; this.plotsAt = 0 })
    renderGroup($('pl-' + this.ptab), specs.filter(x => x.g === grp))
  }

  private driveStep(dt: number) {
    this.driveT = (this.driveT + dt) % DRIVE[DRIVE.length - 1][0]
    let i = 0
    while (DRIVE[i + 1][0] < this.driveT) i++
    const [t0, a0, x0] = DRIVE[i], [t1, a1, x1] = DRIVE[i + 1], u = (this.driveT - t0) / (t1 - t0), e = u * u * (3 - 2 * u)
    $('g').value = ((a0 + (a1 - a0) * e) * this.driveKeep.g).toFixed(2)
    $('gx').value = (x0 + (x1 - x0) * e).toFixed(2)
    this.readInput('g'); this.readInput('gx')
    const ph = (PHASES.find(p => this.driveT < p[0]) as [number, string])[1]
    $('drive-phase').textContent = ph
    $('sub').textContent = 'Straight rail · ' + ph.toLowerCase()
    this.update()
  }

  private stopDrive() {
    if (!this.driving) return
    this.driving = false
    $('g').value = String(this.driveKeep.g); $('gx').value = String(this.driveKeep.gx)
    this.readInput('g'); this.readInput('gx')
    $('drive').textContent = '▶ Drive the corner'
    $('drive-phase').textContent = ''
    if (this.tab === 'setup') $('sub').textContent = 'Straight rail · steady-state corner'
    this.update()
  }

  private frame(now: number) {
    const dt = Math.min(0.1, this.lastT ? (now - this.lastT) / 1000 : 1 / 60)
    this.lastT = now
    if (this.driving) this.driveStep(dt)
    if (this.sweeping) { this.sweepT += dt; $('k-heave').value = (Math.sin(this.sweepT * 1.6) * 2.5).toFixed(2); this.readPose(); this.outputs(); this.update() }
    const lab = this.lab, m = this.m, s = this.scene
    const e = this.reduce || this.tab === 'kin' || this.sweeping ? 1 : 0.12
    this.shown += (this.target - this.shown) * e
    this.shownF += (m.dzF - this.shownF) * e
    this.shownR += (m.dzR - this.shownR) * e
    const x = this.exag ? 5 : 1, S = m.pose0
    const rollAng = this.shown * x + S.phi, zF = S.dzF + (this.shownF - S.dzF) * x, zR = S.dzR + (this.shownR - S.dzR) * x, heave = zR
    const rollF = rollAng + (m.phiF - m.phi) * x
    const hL = -zF - (lab.TF / 2) * rollF, hR = -zF + (lab.TF / 2) * rollF
    s.bodyMatrix(s.sprung.matrix, rollAng, zF, zR, m)
    s.rollMatrix(s.links.matrix, rollAng / 2, heave / 2, m)
    s.sprung.matrixWorldNeedsUpdate = s.links.matrixWorldNeedsUpdate = true
    const rearShow = this.tab === 'kin' && this.sel === 'rear', frontShow = this.tab === 'kin' && this.sel !== 'rear'
    for (const k of SIDES_LR) {
      s.fjArrows[k].visible = frontShow
      s.kpLines[k].visible = s.kpRef[k].visible = s.kpDots[k][0].visible = s.kpDots[k][1].visible = s.svLines[k].visible = frontShow && k === this.sel
    }
    if (s.loaded) {
      const tb = s.placeRear(rollAng, zR, m, lab.radj.TBtype, lab.radj.TBflip)
      s.rrcDot.visible = s.tbLine.visible = s.jackArrow.visible = rearShow
      if (rearShow) {
        s.rrcDot.position.set(lab.TIRE[2][0], 0, tb.rp.rcz - heave)
        const A = tb.Aw, C = tb.Cw, d = [A[0] - C[0], A[1] - C[1], A[2] - C[2]]
        s.setLine(s.tbLine, [[C[0] - d[0] * 0.2, C[1] - d[1] * 0.2, C[2] - d[2] * 0.2], [A[0] + d[0] * 0.2, A[1] + d[1] * 0.2, A[2] + d[2] * 0.2]])
        const key = 'r' + rollAng.toFixed(4) + heave.toFixed(3) + JSON.stringify(lab.radj) + m.ay.toFixed(3) + m.gx.toFixed(3)
        if (key !== this.lastKey) {
          this.lastKey = key
          const jk = this.rearTable(tb.rp), len = Math.max(2, Math.min(30, Math.abs(jk.Fz) * 0.15))
          s.setArrow(s.jackArrow, [tb.Cw[0], 0, tb.Cw[2] + (jk.Fz >= 0 ? 2 : -2)], jk.Fz >= 0, len)
        }
      }
    }
    if (s.loaded && !rearShow) {
      const key = hL.toFixed(3) + '|' + hR.toFixed(3) + '|' + JSON.stringify(lab.adj) + lab.STEER.toFixed(5) + m.ay.toFixed(3) + m.gx.toFixed(3)
      if (key !== this.lastKey) {
        this.lastKey = key
        const P = {} as Record<Side, Pose>
        for (const k of SIDES_LR) {
          const h = Math.max(-3.5, Math.min(3.5, k === 'L' ? hL : hR))
          P[k] = K.poseH(lab.kc[k], h, this.guess[k], lab.STEER)
          this.guess[k] = P[k]
          s.applyCorner(k, lab.kc[k], P[k], lab.adj[k])
        }
        if (this.tab === 'kin') this.kinOverlays(P, rollF, zF)
      }
    }
    s.scene.rotation.x = this.tab === 'setup' ? -m.bank : 0
    s.scene.updateMatrixWorld()
    if (this.tab === 'plots') {
      if (this.plotsDirty && now - this.plotsAt > 250) { this.plotsAt = now; this.plotsDirty = false; this.drawPlots() }
      markPlots($('pl-' + this.ptab), { ft: (hL + hR) / 2, roll: rollAng * D, steer: lab.steerDeg, rt: -zR, gx: m.gx })
    } else s.render()
    if (this.tab === 'setup') {
      const w = s.stage.clientWidth, h = s.stage.clientHeight
      lab.TIRE.forEach((p, i) => {
        const v = s.project([p[0], p[1], 28], this.tmpV), tag = s.tags[i]
        tag.style.left = ((v.x + 1) / 2 * w) + 'px'
        tag.style.top = ((1 - v.y) / 2 * h) + 'px'
        tag.hidden = v.z > 1
      })
    }
    requestAnimationFrame(t => this.frame(t))
  }

  private kinOverlays(P: Record<Side, Pose>, rollF: number, zF: number) {
    const s = this.scene, lab = this.lab
    const { A, rc, fj } = this.liveTable(P, rollF * D, -zF)
    for (const k of SIDES_LR) {
      const lb = P[k].LBJ, ub = P[k].UBJ, d = [ub[0] - lb[0], ub[1] - lb[1], ub[2] - lb[2]], t0 = -lb[2] / d[2], t1 = 1.6
      const g0 = [lb[0] + d[0] * t0, lb[1] + d[1] * t0, lb[2] + d[2] * t0]
      s.setLine(s.kpLines[k], [g0, [lb[0] + d[0] * t1, lb[1] + d[1] * t1, lb[2] + d[2] * t1]])
      s.setLine(s.kpRef[k], [g0, [g0[0], g0[1], lb[2] + d[2] * t1]])
      s.kpDots[k][0].position.set(lb[0], lb[1], lb[2]); s.kpDots[k][1].position.set(ub[0], ub[1], ub[2])
      const cp = A[k].CP, len = Math.max(2, Math.min(25, Math.abs(fj[k]) * 0.12))
      s.setArrow(s.fjArrows[k], [cp[0], cp[1], cp[2] + (fj[k] >= 0 ? 30 : -1)], fj[k] >= 0, len)
      const sv = K.ics(lab.kc[k], P[k]).sv, y = P[k].WC[1]
      if (sv) { const dx = sv[0] - cp[0], dz = sv[1] - cp[2], L = Math.hypot(dx, dz), kk = Math.min(1, 90 / L); s.setLine(s.svLines[k], [[cp[0], y, cp[2]], [cp[0] + dx * kk, y, cp[2] + dz * kk]]) }
    }
    if (rc) {
      s.rcDot.position.set(P.L.WC[0], rc[0], rc[1])
      for (const k of SIDES_LR) {
        const ic = K.ics(lab.kc[k], P[k]).fv, cp = A[k].CP
        if (ic) s.setLine(s.icLines[k], [[cp[0], cp[1], cp[2]], [cp[0], rc[0], rc[1]], [cp[0], ic[0], ic[1]]])
      }
    }
  }

  private showHelp(on: boolean) {
    $('help').hidden = !on
    $('v-help').setAttribute('aria-expanded', String(on))
  }

  private fold() {
    const fs = [...document.querySelectorAll<HTMLFieldSetElement>('aside fieldset')]
    const phone = matchMedia('(max-width: 860px)')
    const title = (f: HTMLFieldSetElement) => f.querySelector('legend')?.textContent || ''
    const key = () => phone.matches ? 'shutMobile' as const : 'shut' as const
    const save = () => writePrefs({ [key()]: fs.map(x => x.classList.contains('shut') ? 1 : 0) })
    const apply = () => {
      let shut = readPrefs()[key()]
      if (!Array.isArray(shut) || shut.length !== fs.length) shut = fs.map(f => phone.matches ? (/Move the car/.test(title(f)) ? 0 : 1) : (/Bump springs|Rear bar/.test(title(f)) ? 1 : 0))
      fs.forEach((f, i) => {
        f.classList.toggle('shut', !!(shut as number[])[i])
        f.querySelector('legend')?.setAttribute('aria-expanded', String(!f.classList.contains('shut')))
      })
    }
    fs.forEach(f => {
      const lg = f.querySelector('legend') as HTMLLegendElement
      lg.tabIndex = 0
      lg.setAttribute('role', 'button')
      const flip = () => {
        const opening = f.classList.contains('shut')
        if (opening && phone.matches) {
          for (const other of fs) if (other !== f && other.parentElement === f.parentElement && !other.classList.contains('shut')) {
            other.classList.add('shut')
            other.querySelector('legend')?.setAttribute('aria-expanded', 'false')
          }
        }
        f.classList.toggle('shut', !opening)
        lg.setAttribute('aria-expanded', String(opening))
        save()
        if (opening && phone.matches) requestAnimationFrame(() => lg.scrollIntoView({ block: 'start', behavior: this.reduce ? 'auto' : 'smooth' }))
      }
      lg.onclick = flip
      lg.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip() } }
    })
    apply()
    phone.addEventListener('change', apply)
  }

  private useRemote(r: Remote, first: boolean) {
    this.signedIn = r.signedIn
    $('sv-where').textContent = r.signedIn ? 'Saved to your library account.' : 'Not signed in: setups stay until you leave this page. Sign in to keep them, or export a file.'
    if (r.signedIn) {
      this.saved = (r.setups || []).flatMap(x => { try { return parseSetupFile(x) } catch { return [] } })
      const base = this.saved.find(x => x.name === BASELINE_NAME)
      if (first && base) this.useBaseline(base)
      this.fillLists()
      if (first && r.hardpoints) {
        try { this.useHardpoints(parseHardpoints(r.hardpoints.hardpoints), r.hardpoints.name) } catch { this.useHardpoints(null, null) }
      }
    }
  }

  private async remote(p: Promise<Remote | { error: string }>) {
    const r = await p
    if ('error' in r) { alert(r.error); return }
    this.useRemote(r, false)
  }

  private useHardpoints(hp: Hardpoints | null, name: string | null) {
    this.lab.useHardpoints(hp ?? { L: CAD.L, R: CAD.R, rear: CAD.rear }, name)
    const note = $('hp-note')
    note.hidden = !name
    note.replaceChildren()
    if (name) {
      note.append('Using hardpoints from ' + name + '. The 3D parts are still this car, stretched to fit. ')
      const b = document.createElement('button')
      b.textContent = 'Back to the straight rail chassis'
      b.onclick = () => { this.useHardpoints(null, null); if (this.signedIn) this.remote(clearHardpoints()) }
      note.append(b)
    }
    this.loadCorner()
    this.after()
  }

  private applySnapshot(x: Snapshot) {
    this.stopDrive()
    this.lab.applySnapshot(x)
    this.syncInputs()
    this.loadCorner()
    this.after()
  }

  private async saveCurrent() {
    this.stopDrive()
    const name = ($('sv-name').value.trim() || 'Setup ' + (this.saved.length + 1)).slice(0, 60)
    const x = this.lab.snapshot(name), i = this.saved.findIndex(s => s.name === name)
    if (i >= 0) this.saved[i] = x; else this.saved.push(x)
    this.lab.setBaseline(x)
    this.plotsDirty = true
    this.fillLists()
    $('sv-list').value = String(i >= 0 ? i : this.saved.length - 1)
    $('sv-name').value = ''
    if (this.signedIn) await this.remote(saveSetup(x))
  }

  private useBaseline(x: Snapshot | null) {
    this.track.setBaseline(x)
    $('tt-base-note').textContent = 'Test drive baseline: ' + this.track.baselineName + '. On the baseline the test driver runs at the limit with balanced handling; changes from it make the car tighter or looser in entry, center and exit.'
  }

  private async saveBaseline() {
    this.stopDrive()
    const x = this.lab.snapshot(BASELINE_NAME), i = this.saved.findIndex(s => s.name === BASELINE_NAME)
    if (i >= 0) this.saved[i] = x; else this.saved.push(x)
    this.useBaseline(x)
    this.fillLists()
    if (this.signedIn) await this.remote(saveSetup(x))
  }

  private async resetBaseline() {
    const had = this.saved.some(s => s.name === BASELINE_NAME)
    if (had && !confirm('Go back to the Lab defaults as the test drive baseline? This removes the saved "' + BASELINE_NAME + '" setup.')) return
    this.saved = this.saved.filter(s => s.name !== BASELINE_NAME)
    this.useBaseline(null)
    this.fillLists()
    if (had && this.signedIn) await this.remote(deleteSetup(BASELINE_NAME))
  }

  private async deleteSelected() {
    const i = +$('sv-list').value, x = this.saved[i]
    if (!x || !confirm('Delete "' + x.name + '"?')) return
    this.saved.splice(i, 1)
    if (x.name === BASELINE_NAME) this.useBaseline(null)
    this.fillLists()
    if (this.signedIn) await this.remote(deleteSetup(x.name))
  }

  private fillLists() {
    for (const id of ['sv-list', 'sv-cmp']) {
      const s = $(id), cur = s.value
      s.replaceChildren()
      if (id === 'sv-cmp') s.add(new Option('None', ''))
      this.saved.forEach((x, i) => s.add(new Option(x.name, String(i))))
      if ([...s.options].some(o => o.value === cur)) s.value = cur
    }
    this.compareTable()
  }

  private compareTable() {
    const sc = $('sv-cmp'), x = sc && sc.value !== '' ? this.saved[+sc.value] : undefined
    $('cmp-tab').hidden = !x
    if (!x || !this.m) return
    $('cmp-name').textContent = x.name.length > 14 ? x.name.slice(0, 13) + '…' : x.name
    const now = this.lab.outSummary(), tb = $('cmp-body') as unknown as HTMLTableSectionElement
    tb.replaceChildren()
    for (const [n, k, d] of OUTROWS) {
      const a = now[k], b = x.out && x.out[k]
      if (b == null) continue
      const dd = a - b, ds = Math.abs(dd).toFixed(d), moved = +ds !== 0, tr = tb.insertRow()
      ;[n, a.toFixed(d), b.toFixed(d), (moved ? (dd > 0 ? '+' : '−') : '') + ds].forEach((t, j) => { const c = tr.insertCell(); c.textContent = t; if (j === 3 && moved) c.className = 'chg' })
    }
  }
}

function download(name: string, obj: unknown) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
