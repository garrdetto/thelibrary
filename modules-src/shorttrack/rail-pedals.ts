import type { Controls } from './next/sim/car'

/**
 * Keyboard-friendly pedals for Drive yourself on the Setup Lab's track test. Keys are on or off, so each pedal moves
 * toward the key at its own speed (`attack` seconds from 0 to full, `release` back to 0) and the pedal position goes
 * through a curve (`out = max · pos^curve`): a curve above 1 keeps the first part of the travel gentle. Holding Shift
 * aims the pedals at half travel for feathering. The settings are a view preference kept in this browser.
 */
export type PedalCurve = { attack: number; release: number; curve: number; max: number }
export type PedalSettings = { thr: PedalCurve; brk: PedalCurve }

export const PEDAL_DEFAULTS: PedalSettings = {
  thr: { attack: 0.7, release: 0.15, curve: 1.6, max: 1 },
  brk: { attack: 0.35, release: 0.12, curve: 1.3, max: 0.85 },
}

const KEY = 'rail-test-pedals'
const LIMITS = { attack: [0, 2.5], release: [0, 1.5], curve: [0.4, 3], max: [0.1, 1] } as const

const fit = (c: Partial<PedalCurve> | undefined, d: PedalCurve): PedalCurve => {
  const out = { ...d }
  for (const k of Object.keys(LIMITS) as (keyof PedalCurve)[]) {
    const v = Number(c?.[k])
    if (Number.isFinite(v)) out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v))
  }
  return out
}

export function loadPedals(): PedalSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<PedalSettings> | null
    return { thr: fit(raw?.thr, PEDAL_DEFAULTS.thr), brk: fit(raw?.brk, PEDAL_DEFAULTS.brk) }
  } catch {
    return structuredClone(PEDAL_DEFAULTS)
  }
}

function savePedals(s: PedalSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode */
  }
}

export const pedalOut = (c: PedalCurve, pos: number): number => c.max * Math.pow(Math.min(1, Math.max(0, pos)), c.curve)

export class Pedals {
  s: PedalSettings = loadPedals()
  pos = { thr: 0, brk: 0 }
  out = { thr: 0, brk: 0 }
  feather = false

  reset() {
    this.pos.thr = this.pos.brk = this.out.thr = this.out.brk = 0
  }

  apply(raw: Controls, dt: number): Controls {
    const want = (v: Controls['thr']) => (typeof v === 'number' ? v : v ? 1 : 0) * (this.feather ? 0.5 : 1)
    const move = (k: 'thr' | 'brk', target: number) => {
      const c = this.s[k], p = this.pos[k], up = target > p
      const rate = (up ? c.attack : c.release) <= 0.001 ? Infinity : 1 / (up ? c.attack : c.release)
      this.pos[k] = up ? Math.min(target, p + rate * dt) : Math.max(target, p - rate * dt)
      this.out[k] = pedalOut(c, this.pos[k])
    }
    move('thr', want(raw.thr))
    move('brk', want(raw.brk))
    return { thr: this.out.thr, brk: this.out.brk, steer: raw.steer }
  }
}

const ROWS: [keyof PedalCurve, string, number, string][] = [
  ['attack', 'Time to full', 0.05, 's'],
  ['release', 'Time to let off', 0.05, 's'],
  ['curve', 'Curve', 0.1, ''],
  ['max', 'Strength', 0.05, '%'],
]

export const PEDAL_CSS = `
#rtPed{position:absolute;left:12px;top:72px;width:300px;padding:10px 12px;display:none;max-height:calc(100% - 150px);overflow:auto}
#wrap.lab.ped #rtPed{display:block}
#rtPed h3{margin:8px 0 4px;font:900 12px "Arial Black",Impact,sans-serif;letter-spacing:.5px;color:var(--acc)}
#rtPed h3:first-child{margin-top:0}
#rtPed label{display:grid;grid-template-columns:96px 1fr 46px;gap:6px;align-items:center;margin:3px 0}
#rtPed input[type=range]{accent-color:var(--acc);width:100%}
#rtPed output{font-variant-numeric:tabular-nums;text-align:right}
#rtPed canvas{width:100%;height:120px;display:block;border-radius:6px;background:#0d131c;margin:6px 0}
#rtPed p{color:var(--dim);margin:6px 0;font-weight:600;font-size:11.5px}
@media (max-width:860px){#rtPed{top:auto;bottom:12px;max-height:46%}}
`

/** The Pedals panel: sliders for both pedals and a chart of pedal output against time the key is held. */
export function mountPedalPanel(box: HTMLElement, pedals: Pedals) {
  const fmt = (k: keyof PedalCurve, v: number) => (k === 'max' ? `${Math.round(v * 100)}%` : k === 'curve' ? v.toFixed(1) : `${v.toFixed(2)} s`)
  const section = (p: 'thr' | 'brk', title: string) => `<h3>${title}</h3>${ROWS.map(([k, label, step]) => {
    const [lo, hi] = LIMITS[k]
    return `<label><span>${label}</span><input type="range" data-p="${p}" data-k="${k}" min="${lo}" max="${hi}" step="${step}" value="${pedals.s[p][k]}" aria-label="${title} ${label}"><output id="rtPed-${p}-${k}">${fmt(k, pedals.s[p][k])}</output></label>`
  }).join('')}`
  box.innerHTML = `${section('thr', 'THROTTLE')}${section('brk', 'BRAKE')}
    <canvas id="rtPedChart" width="560" height="240" aria-label="Pedal output against time the key is held: green throttle, red brake"></canvas>
    <p>For Drive yourself. A key press moves the pedal in over "Time to full". Curve above 1 makes the start of the pedal gentler; Strength is the most it gives. Hold Shift for half pedal.</p>
    <button type="button" id="rtPedReset">Reset to defaults</button>`
  const chart = box.querySelector('#rtPedChart') as HTMLCanvasElement
  const draw = () => {
    const g = chart.getContext('2d')
    if (!g) return
    const w = chart.width, h = chart.height, pad = 22
    const span = Math.max(0.3, pedals.s.thr.attack, pedals.s.brk.attack) * 1.25
    g.clearRect(0, 0, w, h)
    g.strokeStyle = '#263042'
    g.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = pad + ((h - 2 * pad) * i) / 4
      g.beginPath(); g.moveTo(pad, y); g.lineTo(w - 8, y); g.stroke()
    }
    g.fillStyle = '#8a96a8'
    g.font = '600 18px system-ui'
    g.fillText('100%', 2, pad - 4)
    g.fillText(`${span.toFixed(2)} s held`, w - 150, h - 3)
    const line = (c: PedalCurve, color: string) => {
      g.strokeStyle = color
      g.lineWidth = 3
      g.beginPath()
      for (let x = 0; x <= 100; x++) {
        const t = (x / 100) * span, pos = c.attack <= 0.001 ? 1 : t / c.attack
        const px = pad + ((w - pad - 8) * x) / 100, py = h - pad - (h - 2 * pad) * pedalOut(c, pos)
        if (x) g.lineTo(px, py)
        else g.moveTo(px, py)
      }
      g.stroke()
    }
    line(pedals.s.thr, '#5ad17a')
    line(pedals.s.brk, '#ff6a5a')
  }
  box.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement
    const p = el.dataset.p as 'thr' | 'brk' | undefined, k = el.dataset.k as keyof PedalCurve | undefined
    if (!p || !k) return
    pedals.s[p][k] = Number(el.value)
    const o = box.querySelector(`#rtPed-${p}-${k}`)
    if (o) o.textContent = fmt(k, pedals.s[p][k])
    savePedals(pedals.s)
    draw()
  })
  box.querySelector('#rtPedReset')?.addEventListener('click', () => {
    pedals.s = structuredClone(PEDAL_DEFAULTS)
    savePedals(pedals.s)
    box.querySelectorAll<HTMLInputElement>('input[data-p]').forEach((el) => {
      const p = el.dataset.p as 'thr' | 'brk', k = el.dataset.k as keyof PedalCurve
      el.value = String(pedals.s[p][k])
      const o = box.querySelector(`#rtPed-${p}-${k}`)
      if (o) o.textContent = fmt(k, pedals.s[p][k])
    })
    draw()
  })
  draw()
}
