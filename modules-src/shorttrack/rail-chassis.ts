import type { RailState } from './next/sim/railDynamics'
import type { RailNote } from './next/sim/railDriver'

/**
 * Live driver inputs (throttle, brake, steering bars) and the Show chassis view for the Setup Lab's track test. The
 * chassis view is a top-down drawing of the car redrawn every frame: each tire sized and coloured by its load and the
 * share of its grip in use, the fronts turned by their real road-wheel steer, travel bars at each corner, body roll and
 * pitch, the g the car is pulling, the grip the setup's handling change takes off each end, and what the test driver is
 * reacting to.
 */
export type LiveInputs = { thr: number; brk: number; steer: number; note: RailNote; driver: boolean }

export const NOTE_TEXT: Record<RailNote, string> = {
  '': '',
  push: 'Tight: pushing up the track',
  'tight-exit': 'Tight off: waiting on the throttle',
  loose: 'Loose: counter-steering, feathering the throttle',
  catch: 'Loose: lifted to catch it',
  spin: 'Spinning out',
}

export const CHASSIS_CSS = `
#rtIn{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;gap:10px;align-items:flex-end;padding:8px 12px;pointer-events:none!important}
#rtIn .pd{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10.5px;color:var(--dim);font-weight:800}
#rtIn .pd div{width:18px;height:64px;border-radius:5px;background:#263042;position:relative;overflow:hidden}
#rtIn .pd i{position:absolute;left:0;right:0;bottom:0}
#rtIn .pd b{font-variant-numeric:tabular-nums;color:var(--txt);min-width:34px;text-align:center}
#rtIn .st{display:flex;flex-direction:column;gap:3px;align-items:center;font-size:10.5px;color:var(--dim);font-weight:800}
#rtIn .st div{width:150px;height:14px;border-radius:7px;background:#263042;position:relative}
#rtIn .st div::after{content:'';position:absolute;left:50%;top:-2px;bottom:-2px;border-left:1px solid #8a96a8}
#rtIn .st i{position:absolute;top:2px;bottom:2px;border-radius:5px;background:#ffcc00}
#rtIn .nt{min-height:15px;color:var(--txt);font-size:11.5px;font-weight:800;white-space:nowrap}
#rtIn .nt.w{color:#ffb15a}
#wrap.lab.replay #rtIn{bottom:156px}
#rtCh{position:absolute;left:12px;top:72px;width:290px;padding:10px 12px;display:none}
#wrap.lab.chassis #rtCh{display:block}
#wrap.lab.chassis.ped #rtPed{left:314px}
#rtCh h3{margin:0 0 6px;font:900 12px "Arial Black",Impact,sans-serif;letter-spacing:.5px;color:var(--acc)}
#rtCh canvas{width:100%;display:block;border-radius:6px;background:#0d131c}
#rtCh .ph{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:6px;text-align:center;font-size:11px}
#rtCh .ph span{border:1px solid var(--line);border-radius:6px;padding:3px 2px;color:var(--dim)}
#rtCh .ph span.on{border-color:var(--acc);color:var(--txt)}
#rtCh .ph b{display:block;font-variant-numeric:tabular-nums}
@media (max-width:860px){#rtIn{bottom:auto;top:96px;left:auto;right:6px;transform:none;padding:6px}#rtIn .st div{width:90px}#rtIn .pd div{height:44px}#rtCh{top:96px;left:6px;width:200px}#wrap.lab.chassis.ped #rtPed{display:none}}
`

const hand = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} ${v > 0.4 ? 'tight' : v < -0.4 ? 'loose' : 'even'}`

export function mountChassis(inBox: HTMLElement, chBox: HTMLElement) {
  inBox.innerHTML = `<div class="pd"><div><i id="rtInT" style="background:#5ad17a"></i></div><b id="rtInTv">0%</b>Throttle</div>
    <div class="pd"><div><i id="rtInB" style="background:#ff6a5a"></i></div><b id="rtInBv">0%</b>Brake</div>
    <div class="st"><span class="nt" id="rtInN"></span><div><i id="rtInS"></i></div><b id="rtInSv" style="color:var(--txt)">0°</b>Steering</div>`
  chBox.innerHTML = `<h3>CHASSIS</h3><canvas id="rtChC" width="520" height="600" aria-label="Top view of the chassis: tire loads, grip in use, travel, roll and g"></canvas>
    <div class="ph" aria-label="Handling against the test drive baseline"><span id="rtPhE">Entry<b></b></span><span id="rtPhC">Center<b></b></span><span id="rtPhX">Exit<b></b></span></div>`
  const q = <E extends HTMLElement>(id: string) => (inBox.querySelector('#' + id) ?? chBox.querySelector('#' + id)) as E
  const T = q('rtInT'), Tv = q('rtInTv'), B = q('rtInB'), Bv = q('rtInBv'), S = q('rtInS'), Sv = q('rtInSv'), N = q('rtInN')
  const canvas = q<HTMLCanvasElement>('rtChC')
  const ph = [q('rtPhE'), q('rtPhC'), q('rtPhX')]

  function inputs(i: LiveInputs, steerDeg: number) {
    T.style.height = `${Math.round(i.thr * 100)}%`
    Tv.textContent = `${Math.round(i.thr * 100)}%`
    B.style.height = `${Math.round(i.brk * 100)}%`
    Bv.textContent = `${Math.round(i.brk * 100)}%`
    const s = Math.max(-1, Math.min(1, i.steer))
    S.style.left = s >= 0 ? `${50 - s * 50}%` : '50%'
    S.style.right = s >= 0 ? '50%' : `${50 + s * 50}%`
    Sv.textContent = `${Math.abs(steerDeg).toFixed(1)}° ${steerDeg > 0.2 ? 'left' : steerDeg < -0.2 ? 'right' : ''}`
    N.textContent = i.driver ? NOTE_TEXT[i.note] : ''
    N.classList.toggle('w', i.note !== '')
  }

  function chassis(st: RailState) {
    const g = canvas.getContext('2d')
    if (!g) return
    const v = st.veh, w = canvas.width, h = canvas.height
    g.clearRect(0, 0, w, h)
    const cx = w / 2, cy = h / 2 + 10, sc = 150
    const P = (x: number, y: number): [number, number] => [cx - y * sc, cy - x * sc]
    const roll = (st.pf + st.pr) / 2
    const xF = Math.max(v.tires[0][0], v.tires[1][0]) + 0.75, xR = Math.min(v.tires[2][0], v.tires[3][0]) - 0.45
    const half = Math.max(v.trackF, v.trackR) / 2 - 0.18
    const shade = Math.max(-1, Math.min(1, roll / 0.06))
    const grad = g.createLinearGradient(cx - half * sc, 0, cx + half * sc, 0)
    grad.addColorStop(0, shade < 0 ? `rgba(79,179,255,${0.15 - shade * 0.35})` : 'rgba(79,179,255,0.15)')
    grad.addColorStop(1, shade > 0 ? `rgba(79,179,255,${0.15 + shade * 0.35})` : 'rgba(79,179,255,0.15)')
    const [ax, ay] = P(xF, half), [bx, by] = P(xR, -half)
    g.fillStyle = grad
    g.strokeStyle = '#8a96a8'
    g.lineWidth = 2
    g.beginPath()
    g.roundRect(ax, ay, bx - ax, by - ay, 18)
    g.fill()
    g.stroke()
    const pitchY = Math.max(-1, Math.min(1, st.th / 0.03))
    g.fillStyle = pitchY > 0 ? '#5ad17a' : '#ff6a5a'
    g.font = '700 20px system-ui'
    g.textAlign = 'center'
    g.fillText(`${pitchY >= 0 ? 'Nose up' : 'Dive'} ${(Math.abs(st.th) * 57.3).toFixed(2)}°`, cx, ay - 10)
    g.fillStyle = '#c9d2e0'
    g.fillText(`Roll ${(roll * 57.3).toFixed(2)}°`, cx, by + 26)
    const steer = [st.steerL, st.steerR, st.steerRear, st.steerRear]
    for (let i = 0; i < 4; i++) {
      const [tx, ty] = P(v.tires[i][0], v.tires[i][1])
      const use = Math.max(0, Math.min(1.2, st.use[i])), load = Math.max(0, st.fz[i] / 4.448)
      const hue = Math.max(0, 120 - use * 120)
      const tw = 22 + Math.min(1, load / 1600) * 18, tl = 64
      g.save()
      g.translate(tx, ty)
      g.rotate(-steer[i])
      g.fillStyle = st.fz[i] <= 0 ? '#3a4458' : `hsl(${hue},75%,${use > 1 ? 45 : 50}%)`
      g.fillRect(-tw / 2, -tl / 2, tw, tl)
      g.strokeStyle = '#0d131c'
      g.strokeRect(-tw / 2, -tl / 2, tw, tl)
      g.restore()
      const left = v.tires[i][1] > 0, lx = left ? tx - 70 : tx + 70
      g.fillStyle = '#e8edf5'
      g.font = '800 19px system-ui'
      g.fillText(`${load.toFixed(0)} lb`, lx, ty - 6)
      g.fillStyle = '#8a96a8'
      g.font = '600 16px system-ui'
      g.fillText(`${Math.round(use * 100)}% grip`, lx, ty + 14)
      const tr = st.travel[i] / 0.0254, bx0 = left ? tx - 40 : tx + 34, bh = 56
      g.fillStyle = '#263042'
      g.fillRect(bx0, ty - bh / 2, 6, bh)
      g.fillStyle = st.stop[i] ? '#ff5a5a' : st.bump[i] ? '#ffcc00' : '#4fb3ff'
      const f = Math.max(-1, Math.min(1, tr / 3.5))
      g.fillRect(bx0, f >= 0 ? ty - f * bh / 2 : ty, 6, Math.abs(f) * bh / 2)
    }
    const gx = -st.ay / 9.81, gy = -st.ax / 9.81
    g.strokeStyle = '#ffcc00'
    g.lineWidth = 4
    g.beginPath()
    g.moveTo(cx, cy)
    g.lineTo(cx - gx * 60, cy + gy * 60)
    g.stroke()
    g.fillStyle = '#ffcc00'
    g.beginPath()
    g.arc(cx, cy, 6, 0, Math.PI * 2)
    g.fill()
    g.font = '700 17px system-ui'
    g.fillText(`${Math.hypot(st.ay, st.ax) / 9.81 > 0 ? (Math.hypot(st.ay, st.ax) / 9.81).toFixed(2) : '0.00'} g`, cx, cy + 30)
    g.font = '800 18px system-ui'
    const trim = (t: number, y: number, name: string) => {
      g.fillStyle = t < 0.995 ? '#ffb15a' : '#5f6b80'
      g.fillText(t < 0.995 ? `${name} grip −${Math.round((1 - t) * 100)}%` : `${name} grip full`, cx, y)
    }
    trim(st.trimF, 26, 'Front')
    trim(st.trimR, h - 10, 'Rear')
    const hd = v.handling ?? { entry: 0, center: 0, exit: 0 }
    const vals = [hd.entry, hd.center, hd.exit], wts = [st.phaseW.entry, st.phaseW.center, st.phaseW.exit]
    const top = wts.indexOf(Math.max(...wts))
    ph.forEach((el, i) => {
      el.classList.toggle('on', i === top && Math.abs(st.ay) > 2)
      const b = el.querySelector('b')
      if (b) b.textContent = hand(vals[i])
    })
  }

  return { inputs, chassis }
}
