import * as THREE from 'three'
import type { Controls, SimCar } from './next/sim/car'
import { STEP } from './next/sim/config'
import { mod } from './next/sim/math'
import { place } from './next/sim/physics'
import { parseRailVehicle } from './next/sim/railCar'
import type { RailVehicle } from './next/sim/railCar'
import { newRailState } from './next/sim/railDynamics'
import type { RailState } from './next/sim/railDynamics'
import { lineLat, newRailDriver, railDriverControls, railDriverLap, railDriverRelearn, railPhase, railRecover } from './next/sim/railDriver'
import type { RailDriver } from './next/sim/railDriver'
import { Pedals, PEDAL_CSS, mountPedalPanel } from './rail-pedals'
import { CHASSIS_CSS, mountChassis } from './rail-chassis'
import { createCutaway } from './rail-cutaway'
import type { World } from './next/sim/world'

/**
 * The Straight Rail Setup Lab's track test (`?lab=1`): Short Track Showdown's Super Late Model on a track shaped by the
 * Lab (corner radius and banking) in the Thrill Park Speedway setting. The car runs on `railDynamics.ts` with the
 * setup the Lab posts (`{type: 'rail-setup', vehicle, name}`); drive it yourself or hand it to the test driver, then
 * replay any lap from eight camera angles, alone or four at once, with the telemetry that went with it.
 */

type CarModel = { root: THREE.Group; body: THREE.Group; tmg?: THREE.Group; wheels: { pivot: THREE.Object3D; front: boolean }[]; railRig?: Rig }
type Rig = { gq: THREE.Quaternion; rest: THREE.Vector3[]; corner: number[] }
export type LabCar = SimCar & { m: CarModel; wheelRot: number }

export type RailTestApi = {
  world: World
  wrap: HTMLElement
  camera: THREE.PerspectiveCamera
  carScale: number
  /** Starts the run with the Super Late Model and returns the player's car. */
  start(): LabCar
  /** The keyboard and touch controls. */
  manual(): Controls
  toast(text: string): void
}

type CamId = 'chase' | 'tv' | 'heli' | 'incar' | 'side' | 'front' | 'nose' | 'wheel'
const CAMS: [CamId, string][] = [['chase', 'Chase'], ['tv', 'Trackside'], ['heli', 'Overhead'], ['incar', 'In car'], ['side', 'Side (pitch)'], ['front', 'Front (roll)'], ['nose', 'Nose to track'], ['wheel', 'RF corner']]

/** Fields of one recorded sample (60 per second). */
const F = { t: 0, x: 1, z: 2, h: 3, vf: 4, steer: 5, bz: 6, th: 7, pf: 8, pr: 9, tr: 10, fz: 14, thr: 18, brk: 19, rpm: 20, ay: 21, ax: 22, clr: 23, scrape: 24, bump: 25, stop: 26, stL: 27, stR: 28, bal: 29, spin: 30, s: 31, lat: 32, stRear: 33, nose: 34, down: 35 }
const NF = 36
const REC_HZ = 60
const MAX_LAPS = 24
const IN = 0.0254, LB = 4.4482216, DEG = 180 / Math.PI

type LapStats = { minClear: number; bottomT: number; bumpT: number; liftT: number; maxRoll: number; maxPitch: number; minPitch: number; balance: number; balN: number; top: number; low: number }
const PHASE_NAMES = { straight: 'Straight, on the wall', entry: 'Corner entry', apex: 'Apex, on the apron', exit: 'Corner exit' } as const

type Lap = { id: number; n: number; setup: string; driver: 'Test driver' | 'You'; time: number | null; incident: boolean; data: Float32Array; len: number; stats: LapStats }

const newStats = (): LapStats => ({ minClear: Infinity, bottomT: 0, bumpT: 0, liftT: 0, maxRoll: 0, maxPitch: -Infinity, minPitch: Infinity, balance: 0, balN: 0, top: 0, low: Infinity })

const CSS = `
#wrap.lab #tl,#wrap.lab #board,#wrap.lab #flag,#wrap.lab #spotter,#wrap.lab #dmgWrap,#wrap.lab #keys,#wrap.lab #mirrorFrame,#wrap.lab #boostTxt,#wrap.lab .tbtns{display:none!important}
#wrap.lab.replay #touch,#wrap.lab.replay #br{display:none!important}
#wrap.lab #menus{display:none}
#rt{position:absolute;inset:0;pointer-events:none;z-index:7;font:600 12.5px 'TL Fox Dollar',system-ui,sans-serif;color:var(--txt)}
#rt .panel{pointer-events:auto}
#rt button,#rt select{font:800 12px 'TL Fox Dollar',system-ui;border:1px solid var(--line);border-radius:7px;background:#232b38;color:var(--txt);padding:7px 10px;cursor:pointer;min-height:34px}
#rt select{width:auto;padding:6px 8px}
#rt button.on,#rt button.pri{background:var(--acc);border-color:transparent;color:#111}
#rt button:focus-visible,#rt select:focus-visible,#rt input:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
#rtTop{position:absolute;left:12px;top:12px;right:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px}
#rtTop .ttl{font:900 14px "Arial Black",Impact,sans-serif;color:var(--acc);letter-spacing:.4px;margin-right:6px}
#rtTop .grow{flex:1}
#rtTop .timer{font:900 18px "Arial Black",sans-serif;font-variant-numeric:tabular-nums;min-width:86px;text-align:right}
#rtTop small{color:var(--dim);font-weight:700}
#rtTel{position:absolute;right:12px;top:72px;width:300px;max-height:calc(100% - 250px);overflow-y:auto;padding:10px 12px;display:none}
#wrap.lab.tel #rtTel{display:block}
#rtTel h3,#rtLaps h3{margin:10px 0 6px;font:900 12px "Arial Black",Impact,sans-serif;letter-spacing:.5px;color:var(--acc)}
#rtTel h3:first-child,#rtLaps h3:first-child{margin-top:0}
#rtTel .row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;font-variant-numeric:tabular-nums;margin:2px 0}
#rtTel .row b{font-weight:800}
.rt-corners{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.rt-c{border:1px solid var(--line);border-radius:8px;padding:6px 7px;background:#121924}
.rt-c .nm{display:flex;justify-content:space-between;font-weight:900}
.rt-c .bar{height:6px;border-radius:3px;background:#263042;margin:4px 0;overflow:hidden;position:relative}
.rt-c .bar i{position:absolute;left:0;top:0;bottom:0;background:#4fb3ff}
.rt-c .tv{position:relative;height:6px;border-radius:3px;background:#263042;margin:4px 0}
.rt-c .tv i{position:absolute;top:-2px;width:3px;height:10px;background:#fff;border-radius:2px}
.rt-c .tv u{position:absolute;top:0;bottom:0;border-left:2px dashed #ffcc00}
.rt-c .tv s{position:absolute;top:0;bottom:0;right:0;width:6px;background:#ff5a5a;opacity:.7}
.rt-c small{color:var(--dim)}
.chip{display:inline-block;padding:1px 6px;border-radius:999px;font-size:10.5px;font-weight:900;margin:2px 3px 0 0;background:#263042;color:var(--dim)}
.chip.y{background:#ffcc00;color:#111}.chip.r{background:#ff5a5a;color:#111}.chip.b{background:#4fb3ff;color:#111}
.rt-bal{position:relative;height:10px;border-radius:5px;background:linear-gradient(90deg,#ff7a5a,#263042 40%,#263042 60%,#4fb3ff);margin:6px 0 2px}
.rt-bal i{position:absolute;top:-3px;width:4px;height:16px;border-radius:2px;background:#fff;transform:translateX(-50%)}
.rt-bal-l{display:flex;justify-content:space-between;color:var(--dim);font-size:11px}
#rtLaps{position:absolute;left:12px;bottom:12px;width:min(560px,calc(100% - 24px));max-height:40%;overflow:auto;padding:10px 12px}
#rtLaps table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
#rtLaps td,#rtLaps th{padding:4px 5px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
#rtLaps tr.best td{color:var(--acc)}
#rtLaps tr.sel td{background:#2a2614}
#rtLaps tbody tr{cursor:pointer}
#rtLaps .empty{color:var(--dim)}
#rtNote{color:var(--dim);margin:6px 0 0}
#rtRep{position:absolute;left:12px;right:12px;bottom:12px;padding:10px 12px;display:none;flex-direction:column;gap:8px}
#wrap.lab.replay #rtRep{display:flex}
#wrap.lab.replay #rtLaps{bottom:150px}
#rtRep .ctl{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
#rtRep input[type=range]{flex:1;min-width:160px;accent-color:var(--acc)}
#rtRep canvas{width:100%;height:58px;display:block;border-radius:6px;background:#0d131c}
#rtRep .t{font-variant-numeric:tabular-nums;font-weight:900;min-width:110px}
#rt .rt-tile{position:absolute;border:2px solid rgba(255,255,255,.55);border-radius:6px;pointer-events:auto;cursor:pointer;background:transparent;padding:0;min-height:0}
.rt-tile span{position:absolute;left:6px;top:4px;font:800 11px 'TL Fox Dollar',system-ui;color:#fff;text-shadow:0 1px 2px #000}
#rt .rt-tile:hover,#rt .rt-tile:focus-visible{border-color:var(--acc);outline:none}
#rtWait{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:16px 20px;max-width:420px;text-align:center}
@media (max-width:860px){
  #rtTop{left:6px;right:6px;top:6px;padding:6px;gap:4px}
  #rt button,#rt select{padding:5px 8px;font-size:11.5px;min-height:34px}
  #rtTop .ttl,#rtTop .lbl,#rtTop .setup,#rtTop .grow{display:none}
  #rtTop .timer{font-size:15px;min-width:64px}
  #rtTel{top:auto;bottom:12px;right:12px;width:min(300px,calc(100% - 24px));max-height:42%}
  #rtLaps{display:none}
  #wrap.lab.laps #rtLaps{display:block;bottom:12px;max-height:46%}
  #wrap.lab.laps #rtTel{display:none}
  #wrap.lab.replay #rtTel{display:none}
  #wrap.lab.replay.laps #rtLaps{bottom:160px}
  #rtRep{left:6px;right:6px;bottom:6px;padding:8px}
}
@media (prefers-reduced-motion:reduce){#rt *{transition:none!important}}
`

const fmtT = (t: number | null) => (t == null ? '--.---' : t.toFixed(3))
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)

export function initRailTest(api: RailTestApi) {
  const W = api.world, T = W.track, cfg = W.cfg
  const style = document.createElement('style')
  style.textContent = CSS + PEDAL_CSS + CHASSIS_CSS
  document.head.append(style)
  api.wrap.classList.add('lab')

  let veh: RailVehicle | null = null, setupName = 'Setup', car: LabCar | null = null
  let auto = true, replay: { lap: Lap; t: number; playing: boolean; speed: number } | null = null
  let exag = 1, clock = 0, lapStart: number | null = null, lapNo = 0, lastCross = 0, lapAuto = true, lapIncident = false
  let cur: Lap | null = null, recTick = 0, selected: Lap | null = null, seq = 0
  const laps: Lap[] = []
  let driver: RailDriver = newRailDriver(T)
  let camMain: CamId = 'chase', multi = false
  let tiles: CamId[] = ['side', 'front', 'nose']
  const extra = [0, 1, 2].map(() => new THREE.PerspectiveCamera(50, 1, 0.05, 1500))
  const camState = new Map<THREE.PerspectiveCamera, { pos: THREE.Vector3; look: THREE.Vector3; snap: boolean }>()

  const root = document.createElement('div')
  root.id = 'rt'
  root.innerHTML = `
  <div id="rtTop" class="panel" role="toolbar" aria-label="Track test">
    <span class="ttl">SETUP LAB TEST</span>
    <button type="button" id="rtAuto" aria-pressed="true" title="The test driver drives the same line every lap and learns the car's limit, so setups compare fairly">Test driver</button>
    <button type="button" id="rtYou" aria-pressed="false" title="Drive it yourself: arrows or WASD, touch pads on phones">Drive yourself</button>
    <button type="button" id="rtReset" title="Put the car back on the groove (R)">Reset car</button>
    <button type="button" id="rtRepBtn" aria-pressed="false" title="Replay the selected lap">Replay</button>
    <label><small class="lbl">Camera</small> <select id="rtCam" aria-label="Camera">${CAMS.map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select></label>
    <button type="button" id="rtMulti" aria-pressed="false" title="Four angles at once">Multi-angle</button>
    <button type="button" id="rtExag" aria-pressed="false" title="Shows roll, pitch and ride height 3× bigger so you can see them; numbers stay true">Motion ×3</button>
    <button type="button" id="rtTelBtn" aria-pressed="false" title="Telemetry: loads, travel, clearance, balance">Data</button>
    <button type="button" id="rtLapsBtn" aria-pressed="false">Laps</button>
    <button type="button" id="rtChBtn" aria-pressed="false" title="The Setup Lab's chassis in place of the car body, its suspension moving live (arms, coilovers, axle, links, weight transfer), plus a top view of tire loads, grip in use, travel, roll, pitch and g">Show chassis</button>
    <button type="button" id="rtPedBtn" aria-pressed="false" title="Throttle and brake curves for Drive yourself">Pedals</button>
    <span class="grow"></span>
    <span class="setup"><small id="rtSetup"></small></span>
    <span class="timer" id="rtTimer">--.---</span>
    <button type="button" id="rtBack" class="pri">Back to setup</button>
  </div>
  <div id="rtTel" class="panel" aria-live="off"></div>
  <div id="rtLaps" class="panel"><h3>LAPS</h3><table><thead><tr><th>#</th><th>Time</th><th>Setup</th><th>Driver</th><th title="Lowest frame or nose clearance">Min clr</th><th title="Time the frame or nose scraped the track">Scrape</th><th title="Front minus rear slip angle mid-turn: + tight, − loose">Balance</th></tr></thead><tbody id="rtLapRows"><tr><td colspan="7" class="empty">Laps appear here. Click one to replay it.</td></tr></tbody></table><p id="rtNote"></p></div>
  <div id="rtRep" class="panel" aria-label="Replay">
    <div class="ctl"><button type="button" id="rtPlay">Pause</button><select id="rtSpeed" aria-label="Replay speed"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select>
    <input type="range" id="rtScrub" min="0" max="1000" value="0" aria-label="Replay position"><span class="t" id="rtRepT"></span><button type="button" id="rtLive">Back to live</button></div>
    <canvas id="rtTrace" width="1200" height="116" aria-label="Speed and nose clearance through the lap"></canvas>
  </div>
  <div id="rtTiles"></div>
  <div id="rtPed" class="panel" aria-label="Pedal curves"></div>
  <div id="rtCh" class="panel" aria-label="Chassis"></div>
  <div id="rtIn" class="panel" aria-label="Driver inputs"></div>
  <div id="rtWait" class="panel">Waiting for the setup from Straight Rail Setup Lab…</div>`
  api.wrap.append(root)
  const $ = <E extends HTMLElement>(id: string) => root.querySelector('#' + id) as E
  const tel = $('rtTel'), rows = $('rtLapRows'), timer = $('rtTimer'), note = $('rtNote')
  const pedals = new Pedals()
  let lastCtl = { thr: 0, brk: 0 }
  mountPedalPanel($('rtPed'), pedals)
  const live = mountChassis($('rtIn'), $('rtCh'))
  const scrub = $<HTMLInputElement>('rtScrub'), trace = $<HTMLCanvasElement>('rtTrace'), tilesBox = $('rtTiles')

  const setPressed = (id: string, on: boolean) => {
    const b = $(id)
    b.classList.toggle('on', on)
    b.setAttribute('aria-pressed', String(on))
  }
  const syncButtons = () => {
    setPressed('rtAuto', auto && !replay)
    setPressed('rtYou', !auto && !replay)
    setPressed('rtRepBtn', !!replay)
    setPressed('rtMulti', multi)
    setPressed('rtExag', exag > 1)
    api.wrap.classList.toggle('replay', !!replay)
    $<HTMLSelectElement>('rtCam').value = camMain
  }

  function post(msg: Record<string, unknown>) {
    try {
      if (window.parent !== window) window.parent.postMessage(msg, location.origin)
    } catch {
      /* not embedded */
    }
  }

  function startPos(c: LabCar) {
    const s = T.S_LINE + 12
    place(W, c, s, lineLat(T, s))
    c.vx = Math.sin(c.h) * 12
    c.vz = Math.cos(c.h) * 12
    if (veh) {
      c.rail = newRailState(veh, T)
      c.rail.omega = 12 / ((veh.rollout[2] + veh.rollout[3]) / (4 * Math.PI))
    }
    c.steer = 0
    pedals.reset()
    lastCross = c.cross
    lapStart = null
    cur = null
  }

  function useVehicle(v: RailVehicle, name: string) {
    const first = !veh
    veh = v
    setupName = name || 'Setup'
    $('rtSetup').textContent = setupName
    root.querySelector('#rtWait')?.remove()
    if (!car) car = api.start()
    car.stockCar = true
    startPos(car)
    driver = first ? newRailDriver(T) : driver
    if (!first) railDriverRelearn(driver)
    replay = null
    syncButtons()
    if (!first) api.toast(`Running ${setupName}`)
  }

  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'rail-setup') return
    const v = parseRailVehicle(e.data.vehicle)
    if (!v) {
      api.toast('That setup could not be read')
      return
    }
    useVehicle(v, typeof e.data.name === 'string' ? e.data.name.slice(0, 60) : 'Setup')
  })
  post({ type: 'rail-test-ready' })
  setTimeout(() => {
    if (veh) return
    void Promise.all([import('../railsetup/sim/lab'), import('../railsetup/sim/vehicle')]).then(([L, V]) => {
      if (!veh) useVehicle(V.railVehicle(new L.Lab(), 'Lab defaults'), 'Lab defaults')
    })
  }, window.parent !== window ? 2500 : 300)

  $('rtAuto').addEventListener('click', () => { replay = null; auto = true; lapAuto = false; syncButtons() })
  $('rtYou').addEventListener('click', () => { replay = null; auto = false; lapAuto = false; if (car?.rail) car.rail.direct = false; syncButtons() })
  $('rtReset').addEventListener('click', () => reset())
  $('rtRepBtn').addEventListener('click', () => (replay ? stopReplay() : startReplay(selected ?? laps.filter((l) => l.time != null).at(-1) ?? cur)))
  $('rtCam').addEventListener('change', (e) => { camMain = (e.target as HTMLSelectElement).value as CamId; snapAll() })
  $('rtMulti').addEventListener('click', () => { multi = !multi; syncButtons(); layoutTiles() })
  $('rtExag').addEventListener('click', () => { exag = exag > 1 ? 1 : 3; syncButtons() })
  $('rtLapsBtn').addEventListener('click', () => { const on = !api.wrap.classList.contains('laps'); api.wrap.classList.toggle('laps', on); setPressed('rtLapsBtn', on) })
  const telOn = (on: boolean) => { api.wrap.classList.toggle('tel', on); setPressed('rtTelBtn', on); layoutTiles() }
  $('rtTelBtn').addEventListener('click', () => telOn(!api.wrap.classList.contains('tel')))
  const panelToggle = (btn: string, cls: string) => $(btn).addEventListener('click', () => { const on = !api.wrap.classList.contains(cls); api.wrap.classList.toggle(cls, on); setPressed(btn, on) })
  panelToggle('rtChBtn', 'chassis')
  panelToggle('rtPedBtn', 'ped')
  const shift = (e: KeyboardEvent) => { pedals.feather = e.shiftKey }
  addEventListener('keydown', shift)
  addEventListener('keyup', shift)
  addEventListener('blur', () => { pedals.feather = false })
  $('rtBack').addEventListener('click', () => post({ type: 'rail-test-close' }))
  addEventListener('keydown', (e) => { if (e.key === 'Escape') post({ type: 'rail-test-close' }) })
  $('rtPlay').addEventListener('click', () => { if (replay) { replay.playing = !replay.playing; $('rtPlay').textContent = replay.playing ? 'Pause' : 'Play' } })
  $('rtSpeed').addEventListener('change', (e) => { if (replay) replay.speed = +(e.target as HTMLSelectElement).value })
  $('rtLive').addEventListener('click', () => stopReplay())
  scrub.addEventListener('input', () => { if (replay) { replay.t = (+scrub.value / 1000) * lapDuration(replay.lap); replay.playing = false; $('rtPlay').textContent = 'Play' } })
  rows.addEventListener('click', (e) => {
    const tr = (e.target as HTMLElement).closest('tr[data-id]') as HTMLElement | null
    if (!tr) return
    const lap = laps.find((l) => l.id === +(tr.dataset.id ?? -1))
    if (lap) startReplay(lap)
  })
  addEventListener('resize', () => layoutTiles())

  function reset() {
    if (!car?.rail) return
    replay = null
    railRecover(W, car, driver)
    lapIncident = true
    syncButtons()
  }

  function lapDuration(l: Lap) {
    return l.len ? l.data[(l.len - 1) * NF + F.t] : 0
  }

  function startReplay(l: Lap | null) {
    if (!l || l.len < 2) {
      api.toast('Drive a lap first')
      return
    }
    selected = l
    replay = { lap: l, t: 0, playing: true, speed: +$<HTMLSelectElement>('rtSpeed').value }
    $('rtPlay').textContent = 'Pause'
    if (!multi) multi = true
    syncButtons()
    layoutTiles()
    renderLaps()
    drawTrace()
    snapAll()
  }

  function stopReplay() {
    if (!replay) return
    replay = null
    if (car && veh) {
      const st = car.rail as RailState
      railRecover(W, car, driver)
      car.rail = { ...(car.rail as RailState), direct: st.direct }
      lapIncident = true
    }
    syncButtons()
    layoutTiles()
    snapAll()
  }

  // ---------- recording ----------
  function record(c: LabCar) {
    const st = c.rail as RailState
    if (!cur) cur = { id: ++seq, n: lapNo + 1, setup: setupName, driver: auto ? 'Test driver' : 'You', time: null, incident: false, data: new Float32Array(NF * REC_HZ * 30), len: 0, stats: newStats() }
    if ((cur.len + 1) * NF > cur.data.length) {
      const grown = new Float32Array(cur.data.length * 2)
      grown.set(cur.data)
      cur.data = grown
    }
    const o = cur.len * NF, d = cur.data
    const t = lapStart == null ? 0 : clock - lapStart
    d[o + F.t] = t
    d[o + F.x] = c.x
    d[o + F.z] = c.z
    d[o + F.h] = c.h
    d[o + F.vf] = c.vf
    d[o + F.steer] = c.steer
    d[o + F.bz] = st.z
    d[o + F.th] = st.th
    d[o + F.pf] = st.pf
    d[o + F.pr] = st.pr
    for (let i = 0; i < 4; i++) {
      d[o + F.tr + i] = st.travel[i]
      d[o + F.fz + i] = st.fz[i]
    }
    d[o + F.thr] = lastCtl.thr
    d[o + F.brk] = lastCtl.brk
    d[o + F.rpm] = st.rpm
    d[o + F.ay] = st.ay
    d[o + F.ax] = st.ax
    const minClr = Math.min(...st.clear)
    d[o + F.clr] = minClr
    d[o + F.scrape] = st.scrape.reduce((m, on, i) => m | (on ? 1 << i : 0), 0)
    d[o + F.bump] = st.bump.reduce((m, on, i) => m | (on ? 1 << i : 0), 0)
    d[o + F.stop] = st.stop.reduce((m, on, i) => m | (on ? 1 << i : 0), 0) | st.fz.reduce((m, f, i) => m | (f <= 0 ? 16 << i : 0), 0)
    d[o + F.stL] = st.steerL
    d[o + F.stR] = st.steerR
    d[o + F.stRear] = st.steerRear
    const bal = ((Math.abs(st.alpha[0]) + Math.abs(st.alpha[1]) - Math.abs(st.alpha[2]) - Math.abs(st.alpha[3])) / 2) * DEG
    d[o + F.bal] = bal
    d[o + F.spin] = Math.max(st.slipR[0], st.slipR[1])
    d[o + F.s] = mod(c.tp.s - T.S_LINE, T.P)
    d[o + F.lat] = c.tp.lat
    d[o + F.nose] = st.clear[st.clear.length - 1]
    d[o + F.down] = st.downF + st.downR
    cur.len++
    const S = cur.stats, dt = 1 / REC_HZ
    S.minClear = Math.min(S.minClear, minClr)
    if (st.scrape.some(Boolean)) S.bottomT += dt
    if (st.bump.some(Boolean)) S.bumpT += dt
    if (st.fz.some((f) => f <= 0)) S.liftT += dt
    S.maxRoll = Math.max(S.maxRoll, Math.abs((st.pf + st.pr) / 2) * DEG)
    S.maxPitch = Math.max(S.maxPitch, st.th * DEG)
    S.minPitch = Math.min(S.minPitch, st.th * DEG)
    S.top = Math.max(S.top, c.vf)
    const s = mod(c.tp.s, T.P), mid = (a: number) => Math.abs(s - a) < T.TURN * 0.2
    if (mid(T.L + T.TURN / 2) || mid(T.T2 + T.TURN / 2)) {
      S.balance += bal
      S.balN++
      S.low = Math.min(S.low, c.vf)
    }
  }

  function closeLap(time: number | null) {
    if (!cur) return
    cur.time = time
    cur.incident = lapIncident
    if (time == null) cur.n = 0
    if (time != null || cur.len > REC_HZ * 2) {
      laps.push(cur)
      if (laps.length > MAX_LAPS) laps.shift()
    }
    cur = null
    renderLaps()
  }

  function renderLaps() {
    const done = laps.filter((l) => l.time != null && !l.incident)
    const best = done.length ? Math.min(...done.map((l) => l.time as number)) : null
    if (!laps.length) return
    rows.innerHTML = laps.slice().reverse().map((l) => {
      const S = l.stats, bal = S.balN ? S.balance / S.balN : NaN
      const cls = [l.time != null && l.time === best && !l.incident ? 'best' : '', selected === l ? 'sel' : ''].join(' ')
      return `<tr data-id="${l.id}" class="${cls}" tabindex="0" title="Replay ${l.n ? 'lap ' + l.n : 'the out lap'}"><td>${l.n || 'Out'}</td><td>${l.time == null ? 'partial' : fmtT(l.time)}${l.incident ? ' ⚠' : ''}</td><td>${esc(l.setup)}</td><td>${l.driver}</td><td>${Number.isFinite(S.minClear) ? (S.minClear / IN).toFixed(2) + ' in' : '—'}</td><td>${S.bottomT > 0 ? S.bottomT.toFixed(2) + ' s' : '—'}</td><td>${Number.isFinite(bal) ? (bal >= 0 ? '+' : '') + bal.toFixed(1) + '°' : '—'}</td></tr>`
    }).join('')
    const lastAuto = done.filter((l) => l.driver === 'Test driver' && l.setup === setupName).slice(-3)
    note.textContent = lastAuto.length >= 3 ? `Test driver, last 3 clean laps on ${setupName}: ${(lastAuto.reduce((a, l) => a + (l.time as number), 0) / 3).toFixed(3)} s average.` : 'The test driver needs a few laps to find the limit; compare setups on its later laps.'
  }

  // ---------- simulation hooks ----------
  function controls(c: SimCar): Controls {
    if (!c.rail) return { thr: 0, brk: 0, steer: 0 }
    if (auto) {
      const out = railDriverControls(W, c, driver)
      lastCtl = { thr: Number(out.thr), brk: Number(out.brk) }
      return out
    }
    c.rail.direct = false
    const out = pedals.apply(api.manual(), 1 / 120)
    lastCtl = { thr: Number(out.thr), brk: Number(out.brk) }
    return out
  }

  function clearDriverLap() {
    driver.beta.fill(0)
    driver.err.fill(0)
    driver.wall.fill(0)
    driver.incident = false
  }

  function afterStep() {
    if (!car?.rail || replay) return
    clock += STEP
    if (auto && driver.stuck > 2) {
      railRecover(W, car, driver)
      lapIncident = true
    }
    if (car.cross !== lastCross) {
      const forward = car.cross > lastCross
      lastCross = car.cross
      if (forward) {
        if (lapStart != null) {
          lapNo++
          closeLap(clock - lapStart)
          if (lapAuto && auto) railDriverLap(driver, T)
          else clearDriverLap()
        } else {
          closeLap(null)
          clearDriverLap()
        }
        lapStart = clock
        lapAuto = auto
        lapIncident = false
      }
    }
    if (++recTick % (120 / REC_HZ) === 0) record(car)
  }

  // ---------- replay ----------
  function sampleAt(l: Lap, t: number): { o: number; k: number } {
    const n = l.len
    let lo = 0, hi = n - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (l.data[m * NF + F.t] <= t) lo = m
      else hi = m
    }
    const t0 = l.data[lo * NF + F.t], t1 = l.data[hi * NF + F.t]
    return { o: lo, k: t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0 }
  }

  function replayFrame(dt: number) {
    if (!replay || !car?.rail) return
    const l = replay.lap, dur = lapDuration(l)
    if (replay.playing) {
      replay.t += dt * replay.speed
      if (replay.t > dur) replay.t = 0
    }
    const { o, k } = sampleAt(l, replay.t)
    const d = l.data, a = o * NF, b = Math.min(l.len - 1, o + 1) * NF
    const v = (f: number) => d[a + f] + (d[b + f] - d[a + f]) * k
    const st = car.rail
    car.x = v(F.x)
    car.z = v(F.z)
    let dh = d[b + F.h] - d[a + F.h]
    while (dh > Math.PI) dh -= 2 * Math.PI
    while (dh < -Math.PI) dh += 2 * Math.PI
    car.h = d[a + F.h] + dh * k
    car.vf = v(F.vf) * replay.speed
    car.vx = Math.sin(car.h) * car.vf
    car.vz = Math.cos(car.h) * car.vf
    car.steer = v(F.steer)
    car.thr = d[a + F.thr] > 0.05 ? 1 : 0
    car.brk = d[a + F.brk] > 0.05 ? 1 : 0
    car.tp = T.toTrack(car.x, car.z)
    st.z = v(F.bz)
    st.th = v(F.th)
    st.pf = v(F.pf)
    st.pr = v(F.pr)
    for (let i = 0; i < 4; i++) {
      st.travel[i] = v(F.tr + i)
      st.fz[i] = v(F.fz + i)
    }
    st.steerL = v(F.stL)
    st.steerR = v(F.stR)
    st.steerRear = v(F.stRear)
    st.rpm = v(F.rpm)
    st.ay = v(F.ay)
    st.ax = v(F.ax)
    const scrape = d[a + F.scrape], bump = d[a + F.bump], stop = d[a + F.stop]
    st.scrape = st.scrape.map((_x, i) => !!(scrape & (1 << i)))
    st.bump = st.bump.map((_x, i) => !!(bump & (1 << i))) as RailState['bump']
    st.stop = st.stop.map((_x, i) => !!(stop & (1 << i))) as RailState['stop']
    st.clear = st.clear.map((_x, i) => (i === st.clear.length - 1 ? v(F.nose) : NaN))
    scrub.value = String(Math.round((replay.t / Math.max(dur, 1e-3)) * 1000))
    $('rtRepT').textContent = `${l.n ? 'Lap ' + l.n : 'Out lap'} · ${replay.t.toFixed(2)} / ${dur.toFixed(2)} s`
    drawTrace()
  }

  function drawTrace() {
    if (!replay) return
    const l = replay.lap, g = trace.getContext('2d')
    if (!g) return
    const w = trace.width, h = trace.height, dur = lapDuration(l) || 1
    g.clearRect(0, 0, w, h)
    let vmax = 1
    for (let i = 0; i < l.len; i++) vmax = Math.max(vmax, l.data[i * NF + F.vf])
    const line = (f: (i: number) => number, color: string) => {
      g.strokeStyle = color
      g.lineWidth = 2
      g.beginPath()
      for (let i = 0; i < l.len; i += 2) {
        const x = (l.data[i * NF + F.t] / dur) * w, y = h - 6 - f(i) * (h - 14)
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    }
    g.fillStyle = 'rgba(255,90,90,.35)'
    for (let i = 0; i < l.len; i++) if (l.data[i * NF + F.scrape]) g.fillRect((l.data[i * NF + F.t] / dur) * w, 0, 2, h)
    line((i) => l.data[i * NF + F.vf] / vmax, '#4fb3ff')
    line((i) => Math.max(0, Math.min(1, l.data[i * NF + F.nose] / (6 * IN))), '#ffcc00')
    g.fillStyle = '#fff'
    g.fillRect((replay.t / dur) * w - 1, 0, 3, h)
    g.font = '700 20px system-ui'
    g.fillStyle = '#4fb3ff'
    g.fillText('Speed', 8, 22)
    g.fillStyle = '#ffcc00'
    g.fillText('Nose clearance', 90, 22)
    g.fillStyle = '#ff8a8a'
    g.fillText('Scraping', 260, 22)
  }

  // ---------- visuals ----------
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0)
  function rig(m: CarModel): Rig | null {
    const g = m.tmg
    if (!g) return null
    if (m.railRig) return m.railRig
    g.updateMatrix()
    const rest = m.wheels.map((w) => w.pivot.position.clone().applyMatrix4(g.matrix))
    const corner = rest.map((p, i) => (m.wheels[i].front ? 0 : 2) + (p.x > 0 ? 0 : 1))
    m.railRig = { gq: g.quaternion.clone(), rest, corner }
    return m.railRig
  }

  const cutaway = createCutaway(api.carScale)
  function visual(c: LabCar) {
    const st = c.rail, m = c.m
    if (!st || !m.tmg) return
    const R = rig(m)
    if (!R) return
    const k = exag, sc = api.carScale, roll = (st.pf + st.pr) / 2
    m.body.position.set(0, (st.z * k) / sc, 0)
    m.body.rotation.set(-st.th * k, 0, roll * k)
    m.body.updateMatrix()
    m.tmg.updateMatrix()
    _m.multiplyMatrices(m.body.matrix, m.tmg.matrix).invert()
    _q.copy(m.body.quaternion).multiply(R.gq).invert()
    m.wheels.forEach((w, i) => {
      const ci = R.corner[i], v = st.veh
      const defl = (st.fz[ci] - v.staticLoad[ci]) / v.tireRate
      _v.copy(R.rest[i])
      _v.y -= defl / sc
      w.pivot.position.copy(_v.applyMatrix4(_m))
      const steer = ci === 0 ? st.steerL : ci === 1 ? st.steerR : st.steerRear
      _q2.setFromAxisAngle(_y, steer)
      w.pivot.quaternion.copy(_q).multiply(R.gq).multiply(_q2)
    })
    cutaway.update(m, st, R.corner, api.wrap.classList.contains('chassis'))
  }

  // ---------- cameras ----------
  const TV = Array.from({ length: 10 }, (_x, i) => {
    const s = (i / 10) * T.P + 6, cn = T.center(s), lat = T.HW + 14
    return new THREE.Vector3(cn.x + cn.nx * lat, T.heightAt(s, T.HW) + 7, cn.z + cn.nz * lat)
  })
  const local = (c: LabCar, x: number, y: number, z: number, out: THREE.Vector3) => out.set(x, y, z).applyQuaternion(c.m.root.quaternion).add(c.m.root.position)

  function aim(cam: THREE.PerspectiveCamera, id: CamId, c: LabCar, dt: number) {
    let s = camState.get(cam)
    if (!s) camState.set(cam, (s = { pos: new THREE.Vector3(), look: new THREE.Vector3(), snap: true }))
    const pos = new THREE.Vector3(), look = new THREE.Vector3()
    let fov = 50, smooth = 0, up: THREE.Vector3 | null = null
    const sh = Math.sin(c.h), ch = Math.cos(c.h), base = c.m.root.position
    const ground = () => new THREE.Vector3(0, 1, 0).applyQuaternion(c.m.root.quaternion)
    switch (id) {
      case 'chase':
        pos.set(base.x - sh * 8, base.y + 2.8, base.z - ch * 8)
        look.set(base.x + sh * 5, base.y + 1, base.z + ch * 5)
        smooth = 7
        fov = 52
        break
      case 'heli':
        pos.set(base.x - sh * 18 - ch * 10, base.y + 26, base.z - ch * 18 + sh * 10)
        look.copy(base)
        smooth = 3
        fov = 40
        break
      case 'tv': {
        let best = TV[0], bd = Infinity
        for (const p of TV) {
          const d = p.distanceToSquared(base)
          if (d < bd) { bd = d; best = p }
        }
        pos.copy(best)
        look.set(base.x, base.y + 0.6, base.z)
        fov = Math.max(8, Math.min(45, (2 * Math.atan(5 / Math.sqrt(bd)) * 180) / Math.PI))
        break
      }
      case 'incar':
        local(c, 0.32, 1.05, -0.35, pos)
        local(c, 0.32, 0.9, 20, look)
        up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.m.body.getWorldQuaternion(new THREE.Quaternion()))
        fov = 62
        break
      case 'side':
        local(c, 6.5, 0.7, 0.2, pos)
        local(c, 0, 0.55, 0.2, look)
        up = ground()
        fov = 40
        break
      case 'front':
        local(c, 0, 0.45, 8, pos)
        local(c, 0, 0.55, 0, look)
        up = ground()
        fov = 34
        break
      case 'nose':
        local(c, 2.6, 0.12, 2.25, pos)
        local(c, 0, 0.1, 2.25, look)
        up = ground()
        fov = 42
        break
      case 'wheel':
        local(c, -2.4, 0.45, 1.55, pos)
        local(c, -0.75, 0.32, 1.45, look)
        up = ground()
        fov = 38
        break
    }
    if (s.snap || !smooth) {
      s.pos.copy(pos)
      s.look.copy(look)
      s.snap = false
    } else {
      const kk = 1 - Math.exp(-dt * smooth)
      s.pos.lerp(pos, kk)
      s.look.lerp(look, kk)
    }
    cam.position.copy(s.pos)
    cam.up.copy(up ?? _y)
    cam.lookAt(s.look)
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
  }

  function snapAll() {
    for (const s of camState.values()) s.snap = true
  }

  function tileRects(): { x: number; y: number; w: number; h: number }[] {
    if (!multi) return []
    const W0 = api.wrap.clientWidth, narrow = W0 < 860
    const top = Math.round($('rtTop').getBoundingClientRect().bottom - api.wrap.getBoundingClientRect().top) + 6
    const tw = narrow ? Math.round(W0 / 3) - 8 : Math.round(Math.min(360, W0 * 0.26)), th = Math.round(tw * (narrow ? 0.62 : 0.56))
    if (narrow) return [0, 1, 2].map((i) => ({ x: 6 + i * (tw + 6), y: top, w: tw, h: th }))
    const right = api.wrap.classList.contains('tel') ? 324 : 12
    return [0, 1, 2].map((i) => ({ x: W0 - tw - right, y: top + i * (th + 8), w: tw, h: th }))
  }

  function layoutTiles() {
    const rects = tileRects()
    tilesBox.innerHTML = rects.map((r, i) => `<button type="button" class="rt-tile" data-i="${i}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px" title="Make this the main view"><span>${CAMS.find((x) => x[0] === tiles[i])?.[1]}</span></button>`).join('')
    rects.forEach((r, i) => {
      extra[i].aspect = r.w / r.h
      extra[i].updateProjectionMatrix()
    })
  }
  tilesBox.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.rt-tile') as HTMLElement | null
    if (!b) return
    const i = +(b.dataset.i ?? 0), was = camMain
    camMain = tiles[i]
    tiles[i] = was
    syncButtons()
    layoutTiles()
    snapAll()
  })

  function camera(dt: number): boolean {
    if (!car) return false
    aim(api.camera, camMain, car, dt)
    if (multi) tiles.forEach((id, i) => aim(extra[i], id, car as LabCar, dt))
    return true
  }

  function views() {
    if (!multi || !car) return null
    const rects = tileRects()
    return rects.map((r, i) => ({ camera: extra[i], ...r }))
  }

  // ---------- telemetry ----------
  let hudT = 0
  function hud(dt: number) {
    if (!car?.rail) return
    timer.textContent = replay ? `R ${replay.t.toFixed(2)}` : lapStart == null ? 'Out lap' : fmtT(clock - lapStart)
    {
      const st = car.rail, rep0 = replay ? sampleAt(replay.lap, replay.t) : null
      const thr = rep0 ? replay!.lap.data[rep0.o * NF + F.thr] : lastCtl.thr, brk = rep0 ? replay!.lap.data[rep0.o * NF + F.brk] : lastCtl.brk
      live.inputs({ thr, brk, steer: car.steer, note: driver.note, driver: auto && !replay }, ((st.steerL + st.steerR) / 2) * DEG)
      if (api.wrap.classList.contains('chassis')) live.chassis(st)
    }
    hudT += dt
    if (hudT < 0.1) return
    hudT = 0
    const st = car.rail, v = st.veh, names = ['LF', 'RF', 'LR', 'RR']
    const bal = ((Math.abs(st.alpha[0]) + Math.abs(st.alpha[1]) - Math.abs(st.alpha[2]) - Math.abs(st.alpha[3])) / 2) * DEG
    const balShown = replay ? (() => { const { o } = sampleAt(replay.lap, replay.t); return replay.lap.data[o * NF + F.bal] })() : bal
    const pos = Math.max(0, Math.min(100, 50 - balShown * 10))
    const corners = [0, 1, 2, 3].map((i) => {
      const tr = st.travel[i] / IN, bt = v.bumpTravel[i] < 1 ? v.bumpTravel[i] / IN : null
      const loadPct = Math.min(100, (st.fz[i] / LB / 1800) * 100), x = (t: number) => Math.max(0, Math.min(100, ((t + 2) / 6) * 100))
      const chips = [st.bump[i] ? '<span class="chip y">BUMP SPRING</span>' : '', st.stop[i] ? '<span class="chip r">BOTTOMED</span>' : '', st.fz[i] <= 0 ? '<span class="chip b">LIFTED</span>' : ''].join('')
      return `<div class="rt-c"><div class="nm"><span>${names[i]}</span><span>${(st.fz[i] / LB).toFixed(0)} lb</span></div><div class="bar"><i style="width:${loadPct}%"></i></div>
        <div class="tv" title="Wheel travel −2 to +4 in; dashed line: bump spring; red: end of travel">${bt != null ? `<u style="left:${x(bt)}%"></u>` : ''}<s></s><i style="left:calc(${x(tr)}% - 1px)"></i></div>
        <small>${tr >= 0 ? '+' : ''}${tr.toFixed(2)} in travel</small><div>${chips}</div></div>`
    }).join('')
    const clears = v.clearance.map((p, i) => `<div class="row"><span>${esc(p.name)}</span><b${st.scrape[i] ? ' style="color:#ff8a8a"' : ''}>${st.scrape[i] ? 'SCRAPING' : Number.isFinite(st.clear[i]) ? (st.clear[i] / IN).toFixed(2) + ' in' : '—'}</b></div>`).join('')
    const mph = Math.abs(car.vf) * 2.23694
    tel.innerHTML = `<h3>CAR</h3>
      <div class="row"><span>Speed</span><b>${mph.toFixed(0)} mph</b></div>
      <div class="row"><span>Lateral / long g</span><b>${(st.ay / 9.81).toFixed(2)} / ${(st.ax / 9.81).toFixed(2)}</b></div>
      <div class="row"><span>Body roll</span><b>${(((st.pf + st.pr) / 2) * DEG).toFixed(2)}°</b></div>
      <div class="row"><span title="+ nose up: nose lift on throttle, − dive on the brakes">Pitch</span><b>${st.th >= 0 ? '+' : ''}${(st.th * DEG).toFixed(2)}°${st.th * DEG > 0.6 ? ' nose lift' : st.th * DEG < -0.6 ? ' dive' : ''}</b></div>
      <div class="row"><span>Ride (body)</span><b>${st.z >= 0 ? '+' : ''}${(st.z / IN).toFixed(2)} in</b></div>
      ${auto && !replay ? `<div class="row"><span title="Where the test driver is in its corner loop">Driver</span><b>${PHASE_NAMES[railPhase(T, car.tp.s)]}</b></div><div class="row"><span>Gas / brake</span><b>${(driver.thr * 100).toFixed(0)}% / ${(driver.brk * 100).toFixed(0)}%</b></div>` : ''}
      <div class="row"><span>Engine</span><b>${st.rpm.toFixed(0)} rpm · ${st.ratio.toFixed(2)}:1</b></div>
      <div class="row"><span>Downforce</span><b>${((st.downF + st.downR) / LB).toFixed(0)} lb</b></div>
      <h3>BALANCE</h3><div class="rt-bal" role="img" aria-label="Balance ${balShown.toFixed(1)} degrees"><i style="left:${pos}%"></i></div><div class="rt-bal-l"><span>Tight</span><b>${balShown >= 0 ? '+' : ''}${balShown.toFixed(1)}°</b><span>Loose</span></div>
      <h3>CORNERS</h3><div class="rt-corners">${corners}</div>
      <h3>CLEARANCE</h3>${clears}
      <h3>SETUP</h3><div class="row"><span>Weight</span><b>${v.scales.weightLb.toFixed(0)} lb</b></div><div class="row"><span>Left / rear / cross</span><b>${v.scales.left.toFixed(1)} / ${v.scales.rear.toFixed(1)} / ${v.scales.cross.toFixed(1)} %</b></div><div class="row"><span>Stagger</span><b>${((v.rollout[3] - v.rollout[2]) / IN).toFixed(2)} in</b></div><div class="row"><span>Track</span><b>${(T.R / 0.3048).toFixed(0)} ft turns · ${cfg.turnBank}° / ${cfg.straightBank}°</b></div>`
  }

  syncButtons()
  telOn(api.wrap.clientWidth > 860)
  return {
    controls,
    afterStep,
    replaying: () => !!replay,
    replayFrame,
    camera,
    views,
    visual,
    hud,
    reset,
    ready: () => !!veh,
    debug: () => ({ laps: laps.map((l) => ({ n: l.n, time: l.time, setup: l.setup, driver: l.driver, incident: l.incident, samples: l.len })), replaying: !!replay, setup: setupName }),
    replayLap: (n: number) => startReplay(laps.find((l) => l.n === n && l.time != null) ?? null),
  }
}
