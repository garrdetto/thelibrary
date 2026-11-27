import * as K from '../sim/kin'
import { ADJ0, RADJ0 } from '../sim/inputs'
import { GX, RX, SW, tblAt } from '../sim/lab'
import type { Lab, MrTable, Side } from '../sim/lab'

type Series = { p: number[][]; c: string; d?: number; n?: string }
type Fmt = { u: string; dp: number; sg?: number; pad?: number }
export type ChartSpec = Fmt & { g: string; t: string; x: string; xu: string; ax: string; s: Series[] }
type FigureEl = HTMLElement & { _sp?: ChartSpec; _at?: string }

export const PGRP: Record<'front' | 'rear', string[]> = { front: ['Alignment', 'Tire position', 'Roll', 'Springs and forces', 'Steering'], rear: ['Roll', 'Rear steer', 'Anti-squat and pinion', '3rd link', 'Axle and springs'] }

export function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

export function interp(p: number[][], x: number): number {
  p = p.filter(q => Number.isFinite(q[1]))
  if (!p.length) return NaN
  if (x <= p[0][0]) return p[0][1]
  for (let i = 1; i < p.length; i++) if (x <= p[i][0]) { const a = p[i - 1], b = p[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) || 1) }
  return p[p.length - 1][1]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export function plotSVG(svg: SVGSVGElement, sp: ChartSpec) {
  const W = 320, H = 190, l = 44, r = 10, t = 22, b = 32, pts = sp.s.flatMap(q => q.p).filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1]))
  if (!pts.length) { svg.innerHTML = `<text x="${l}" y="13" style="fill:var(--ink)">${esc(sp.t)}</text><text x="${l}" y="60">Not available</text>`; return }
  const x0 = Math.min(...pts.map(q => q[0])), x1 = Math.max(...pts.map(q => q[0]))
  let lo = Math.min(...pts.map(q => q[1])), hi = Math.max(...pts.map(q => q[1]))
  const pad = Math.max(sp.pad || 0.1, (hi - lo) * 0.08)
  lo -= pad; hi += pad
  const X = (v: number) => l + (v - x0) / ((x1 - x0) || 1) * (W - l - r), Y = (v: number) => t + (hi - v) / (hi - lo) * (H - t - b)
  const path = (p: number[][]) => p.filter(q => Number.isFinite(q[1])).map((q, i) => (i ? 'L' : 'M') + X(q[0]).toFixed(1) + ' ' + Y(q[1]).toFixed(1)).join(' ')
  const ys = niceStep((hi - lo) / 4), xs = niceStep((x1 - x0) / 6)
  let g = ''
  for (let v = Math.ceil(lo / ys) * ys; v <= hi; v += ys) g += `<line class="ax" x1="${l}" x2="${W - r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${l - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${+v.toFixed(3)}</text>`
  for (let v = Math.ceil(x0 / xs - 1e-9) * xs; v <= x1 + 1e-9; v += xs) g += `<text x="${X(v).toFixed(1)}" y="${H - 17}" text-anchor="middle">${+v.toFixed(2)}</text>`
  if (x0 < 0 && x1 > 0) g += `<line class="ax" x1="${X(0)}" x2="${X(0)}" y1="${t}" y2="${H - b}"/>`
  svg.innerHTML = `<text x="${l}" y="13" style="fill:var(--ink);font-size:11px">${esc(sp.t)}</text>${g}<text x="${(l + W - r) / 2}" y="${H - 3}" text-anchor="middle">${esc(sp.x)}</text>` +
    sp.s.map(q => `<path d="${path(q.p)}" fill="none" stroke="${q.c}" stroke-width="${q.d ? 1.3 : 2}"${q.d ? ' stroke-dasharray="4 3" opacity=".75"' : ''}/>`).join('') +
    `<line class="mk" x1="0" x2="0" y1="${t}" y2="${H - b}" style="stroke:var(--ink);stroke-dasharray:2 2"/>`
  Object.assign(svg.dataset, { ax: sp.ax || '', x0: String(x0), x1: String(x1), l: String(l), w: String(W - l - r) })
}

export function markPlots(container: HTMLElement, at: Record<string, number>) {
  container.querySelectorAll<FigureEl>('figure').forEach(f => {
    const svg = f.querySelector('svg'), sp = f._sp, m = svg && svg.querySelector('.mk')
    if (!svg || !m || !sp) return
    const v = at[sp.ax], d = svg.dataset
    if (v == null || !Number.isFinite(v)) { (m as SVGElement).style.display = 'none'; return }
    const dx0 = +(d.x0 as string), dx1 = +(d.x1 as string)
    const xv = Math.max(dx0, Math.min(dx1, v)), x = +(d.l as string) + (xv - dx0) / ((dx1 - dx0) || 1) * +(d.w as string)
    ;(m as SVGElement).style.display = ''
    m.setAttribute('x1', String(x)); m.setAttribute('x2', String(x))
    const key = xv.toFixed(3)
    if (f._at === key) return
    f._at = key
    const sgn = (y: number, dp: number, plus?: number) => { const a = Math.abs(y).toFixed(dp); return (+a === 0 ? '' : y < 0 ? '−' : plus ? '+' : '') + a }
    const fmt = (y: number) => Number.isFinite(y) ? sgn(y, sp.dp, sp.sg) + sp.u : '—', sx = sgn(xv, 2, 1) + (sp.xu === '°' ? '°' : ' ' + sp.xu)
    const list = (dash: boolean) => sp.s.filter(q => !!q.d === dash).map(q => (q.n ? q.n + ' ' : '') + fmt(interp(q.p, xv))).join(' · ')
    const cap = f.querySelector('figcaption')
    if (cap) cap.innerHTML = '<i>at ' + sx + '</i>  ' + list(false) + '<br><i>baseline</i>  ' + list(true)
  })
}

export function buildCharts(lab: Lab, ptab: 'front' | 'rear', tbName: string): { specs: ChartSpec[]; key: string; note: string } {
  const C = { lf: 'var(--steel)', rf: 'var(--accent)', now: 'var(--accent)', was: 'var(--muted)', tot: 'var(--ink)' }
  type Row = Record<string, number>
  const ser = (xs: number[] | ((a: Row, i: number) => number), arr: Row[], key: string | ((a: Row, i: number) => number), c: string, d?: number, n?: string): Series =>
    ({ p: arr.map((a, i) => [typeof xs === 'function' ? xs(a, i) : xs[i], typeof key === 'function' ? key(a, i) : a[key]]), c, d, n })
  const two = (xs: number[], cur: Row[], bas: Row[], key: string) => [ser(xs, bas, key, C.was, 1), ser(xs, cur, key, C.now)]
  const four = (xs: number[], cL: Row[], cR: Row[], bL: Row[], bR: Row[], kL: string, kR?: string | null, nL?: string, nR?: string) =>
    [ser(xs, bL, kL, C.lf, 1, nL || 'LF'), ser(xs, bR, kR || kL, C.rf, 1, nR || 'RF'), ser(xs, cL, kL, C.lf, 0, nL || 'LF'), ser(xs, cR, kR || kL, C.rf, 0, nR || 'RF')]
  const sp: ChartSpec[] = [], BASE = lab.BASE, BA = BASE ? BASE.adj : { L: ADJ0, R: ADJ0 }, BR = BASE ? BASE.radj : RADJ0, G = PGRP[ptab]
  const bc = { L: lab.buildCorner('L', BA.L), R: lab.buildCorner('R', BA.R) }, bg = K.rearAdjust(lab.RG0, BR)
  const deg: Fmt = { u: '°', dp: 2, sg: 1 }, inch: Fmt = { u: ' in', dp: 3, sg: 1 }, pct: Fmt = { u: '%', dp: 1, sg: 1 }, lb: Fmt = { u: ' lb', dp: 0, sg: 1 }, rate: Fmt = { u: ' lb/in', dp: 0 }, ratio: Fmt = { u: '', dp: 3 }
  const baseName = BASE ? 'baseline: ' + BASE.name : 'baseline: as modeled (load or save a setup to set one)'
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const jk = lab.jackModel().ay
  let key = '', note = ''
  if (ptab === 'front') {
    key = '<span style="--c:var(--steel)">LF</span><span style="--c:var(--accent)">RF</span><span style="--c:var(--ink)">Total</span><span style="--c:var(--muted);--st:dashed">Dashed: ' + esc(baseName) + '</span>'
    const S = { L: lab.sweep(lab.kc.L) as unknown as Row[], R: lab.sweep(lab.kc.R) as unknown as Row[], bL: lab.sweep(bc.L) as unknown as Row[], bR: lab.sweep(bc.R) as unknown as Row[] }
    const MB = { L: lab.mrTable(bc.L), R: lab.mrTable(bc.R) }, k = { L: lab.num('lf'), R: lab.num('rf') }, kB = { L: lab.baseNum('lf'), R: lab.baseNum('rf') }
    const mrv = (T: Record<Side, MrTable | null>, s: Side) => (_a: Row, i: number) => { const tt = T[s]; return tt ? tblAt(tt, 'mr', SW[i]) : NaN }
    const wr = (T: Record<Side, MrTable | null>, s: Side, kk?: Record<Side, number>) => (a: Row, i: number) => (kk || k)[s] * mrv(T, s)(a, i) ** 2
    const TX = { x: 'wheel travel, in (+ bump)', xu: 'in', ax: 'ft' }, RO = { x: 'body roll, ° (+ left side up, a left turn)', xu: '°', ax: 'roll' }, ST = { x: 'average front steer, ° (+ left)', xu: '°', ax: 'steer' }
    const tr = (g: string, t: string, kk: string, f: Fmt): ChartSpec => ({ g, t, ...TX, ...f, s: four(SW, S.L, S.R, S.bL, S.bR, kk) })
    sp.push(tr(G[0], 'Camber, ° (+ top out), to the body', 'camber', deg), tr(G[0], 'Caster, ° (+ upper BJ back)', 'caster', deg), tr(G[0], 'Toe, ° (+ out): bump steer', 'toe', { ...deg, dp: 3 }), tr(G[0], 'KPI, ° (+ upper BJ inboard)', 'kpi', deg),
      tr(G[1], 'Scrub radius, in', 'scrub', inch), tr(G[1], 'Mechanical trail, in', 'trail', inch), tr(G[1], 'Track change, in (+ contact patch out)', 'dy', inch), tr(G[1], 'Wheel center fore-aft, in (+ forward)', 'wx', inch))
    const R0 = lab.frontRollAll(lab.kc.L, lab.kc.R) as unknown as Row[], RB = lab.frontRollAll(bc.L, bc.R) as unknown as Row[]
    const ro = (g: string, t: string, kL: string, kR: string | null, f: Fmt): ChartSpec => ({ g, t, ...RO, ...f, s: kR ? four(RX, R0, R0, RB, RB, kL, kR) : two(RX, R0, RB, kL) })
    sp.push(ro(G[2], 'Camber to the ground, °', 'camL', 'camR', deg), ro(G[2], 'Front roll center height, in', 'rc', null, { ...inch, dp: 2, sg: 0 }), ro(G[2], 'Front roll center lateral, in (+ left)', 'y', null, { ...inch, dp: 2 }),
      ro(G[2], 'Bar twist, ° (from ride height)', 'twist', null, { ...deg, pad: 0.2 }),
      { g: G[3], t: 'Spring motion ratio', ...TX, ...ratio, pad: 0.01, s: [ser(SW, S.bL, mrv(MB, 'L'), C.lf, 1, 'LF'), ser(SW, S.bR, mrv(MB, 'R'), C.rf, 1, 'RF'), ser(SW, S.L, mrv(lab.MRT, 'L'), C.lf, 0, 'LF'), ser(SW, S.R, mrv(lab.MRT, 'R'), C.rf, 0, 'RF')] },
      { g: G[3], t: 'Wheel rate, lb/in (spring × MR²)', ...TX, ...rate, pad: 2, s: [ser(SW, S.bL, wr(MB, 'L', kB), C.lf, 1, 'LF'), ser(SW, S.bR, wr(MB, 'R', kB), C.rf, 1, 'RF'), ser(SW, S.L, wr(lab.MRT, 'L'), C.lf, 0, 'LF'), ser(SW, S.R, wr(lab.MRT, 'R'), C.rf, 0, 'RF')] },
      tr(G[3], 'Anti-dive, %', 'ad', pct),
      { ...ro(G[3], 'Front jacking at ' + jk.toFixed(2) + ' g, lb (+ lifts)', 'jL', 'jR', { ...lb, pad: 5 }), s: [...four(RX, R0, R0, RB, RB, 'jL', 'jR'), ser(RX, RB, 'jT', C.tot, 1, 'total'), ser(RX, R0, 'jT', C.tot, 0, 'total')] })
    const T0 = lab.steerAll(lab.kc.L, lab.kc.R) as unknown as Row[], TB = lab.steerAll(bc.L, bc.R) as unknown as Row[]
    const st = (t: string, kL: string | ((a: Row) => number), kR: string | null, f: Fmt): ChartSpec => ({
      g: G[4], t, ...ST, ...f,
      s: kR ? [ser(a => a.x, TB, kL, C.lf, 1, 'LF'), ser(a => a.x, TB, kR, C.rf, 1, 'RF'), ser(a => a.x, T0, kL, C.lf, 0, 'LF'), ser(a => a.x, T0, kR, C.rf, 0, 'RF')] : [ser(a => a.x, TB, kL, C.was, 1), ser(a => a.x, T0, kL, C.now)],
    })
    sp.push(st('Wheel steer angle, ° (+ toward the turn)', 'lf', 'rf', deg), st('Ackermann: LF − RF steer, °', a => a.lf - a.rf, null, { ...deg, dp: 3, pad: 0.05 }), st('Corner lift from steering, in (caster jacking)', 'lL', 'lR', { ...inch, pad: 0.02 }))
    note = 'Front, ' + baseName + '. ' + (same(lab.adj.L, BA.L) && same(lab.adj.R, BA.R) ? 'No Kinematics tab changes from the baseline, so solid and dashed lines sit together.' : 'Solid lines include your Kinematics tab changes from the baseline.')
  } else {
    key = '<span style="--c:var(--accent)">Now (RR on two-sided plots)</span><span style="--c:var(--steel)">LR</span><span style="--c:var(--muted);--st:dashed">Dashed: ' + esc(baseName) + '</span>'
    const R0 = lab.rearRollAll(lab.RG) as unknown as Row[], RB = lab.rearRollAll(bg) as unknown as Row[], MB = lab.rearMr(bg)
    const H0 = lab.rearHeaveAll(lab.RG, lab.MRTR) as unknown as Row[], HB = lab.rearHeaveAll(bg, MB, id => lab.baseNum(id)) as unknown as Row[]
    const ro = (g: string, t: string, kk: string, f: Fmt): ChartSpec => ({ g, t, x: 'body roll, ° (+ left side up, a left turn)', xu: '°', ax: 'roll', ...f, s: two(RX, R0, RB, kk) })
    const hv = (g: string, t: string, kL: string, kR: string | null, f: Fmt): ChartSpec => ({ g, t, x: 'rear ride travel, in (+ bump)', xu: 'in', ax: 'rt', ...f, s: kR ? four(SW, H0, H0, HB, HB, kL, kR, 'LR', 'RR') : two(SW, H0, HB, kL) })
    sp.push(ro(G[0], 'Rear roll center height, in', 'rc', { ...inch, dp: 2, sg: 0 }), ro(G[0], 'Rear jacking at ' + jk.toFixed(2) + ' g, lb (+ lifts)', 'jack', { ...lb, pad: 5 }), ro(G[0], 'Axle side shift, in (+ left)', 'shift', { ...inch, pad: 0.02 }), ro(G[0], tbName + ' angle, ° (+ chassis end high)', 'tb', deg),
      ro(G[1], 'Rear steer through roll, ° (+ aims right, loose)', 'steer', { ...deg, dp: 3, pad: 0.02 }), hv(G[1], 'Rear steer through travel, ° (+ aims right, loose)', 'steer', null, { ...deg, dp: 3, pad: 0.02 }),
      ro(G[1], 'LR lead through roll, in (+ LR ahead of RR)', 'lead', { ...inch, pad: 0.02 }), hv(G[1], 'LR lead through travel, in (+ LR ahead of RR)', 'lead', null, { ...inch, pad: 0.02 }),
      hv(G[2], 'Anti-squat, % (throttle)', 'as', null, { ...pct, pad: 2 }), hv(G[2], 'Anti-lift, % (braking: the rear\'s anti-dive)', 'al', null, { ...pct, pad: 2 }), hv(G[2], 'Pinion angle change, ° (+ up)', 'pin', null, deg), hv(G[2], 'Rear roll center height through travel, in', 'rc', null, { ...inch, dp: 2, sg: 0 }),
      hv(G[4], 'Wheelbase change, in (+ longer)', 'wbL', 'wbR', { ...inch, pad: 0.02 }), hv(G[4], 'Axle side shift through travel, in (+ left)', 'shift', null, { ...inch, pad: 0.02 }), hv(G[4], 'Spring motion ratio', 'mrL', 'mrR', { ...ratio, pad: 0.01 }), hv(G[4], 'Wheel rate, lb/in (spring × MR²)', 'wrL', 'wrR', { ...rate, pad: 2 }))
    const T0 = lab.thirdAll(lab.RG) as unknown as Row[], TB = lab.thirdAll(bg) as unknown as Row[]
    const gx = (t: string, kk: string, f: Fmt): ChartSpec => ({ g: G[3], t, x: 'long g (− braking, + throttle)', xu: 'g', ax: 'gx', ...f, s: two(GX, T0, TB, kk) })
    sp.push(gx('LR load from 3rd link, lb (+ onto LR)', 'dLR', { ...lb, dp: 1, pad: 2 }), gx('3rd link force, lb (+ tension)', 'u', { ...lb, pad: 20 }),
      gx('3rd link side pull, lb (+ left)', 'side', { ...lb, pad: 20 }), hv(G[3], '3rd link angle, ° (+ chassis end high)', 'ula', null, deg))
    note = 'Rear, ' + baseName + '. ' + (same({ ...lab.radj }, { ...BR }) ? 'No link moves from the baseline, so solid and dashed lines sit together.' : 'Solid lines include your link moves from the baseline.')
  }
  return { specs: sp, key, note }
}

export function renderGroup(container: HTMLElement, specs: ChartSpec[]) {
  container.innerHTML = specs.map(() => '<figure><svg class="chart" viewBox="0 0 320 190" role="img"></svg><figcaption></figcaption></figure>').join('')
  container.querySelectorAll<FigureEl>('figure').forEach((f, i) => {
    const x = specs[i], svg = f.querySelector('svg') as SVGSVGElement
    f._sp = x
    svg.setAttribute('aria-label', x.t + ' versus ' + x.x)
    plotSVG(svg, x)
  })
}
